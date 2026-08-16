/**
 * Blade deformation — scrape, carry, deposit (FR-3.1 … FR-3.5).
 *
 * The model, and why it is this one
 * ---------------------------------
 * The obvious design is "cut soil into a hidden `carriedVolume`, dump it when
 * the blade lifts". It looks wrong: you shove into a pile and nothing appears
 * in front of the machine until you release.
 *
 * So soil is never hidden. Every cut is deposited into the terrain AHEAD of
 * the blade in the same tick, and the "carried" figure is *measured* off the
 * prow that produces. Push, and you visibly bulldoze a growing pile forward.
 * Volume conservation becomes structural rather than something to police.
 *
 * Cut rate is self-limiting and needs no artificial throttle: cells already
 * swept sit at the cutting edge and yield nothing, so only newly-entered
 * ground contributes, which is proportional to how far the machine moved.
 * Lowering the blade while parked cuts too — same rule, no special case.
 */

import { materialOf, MaterialId } from '../materials';
import { clamp } from '../math/Vec';
import type { Rect, Terrain } from '../Terrain';
import { TUNING } from '../tuning';
import { fillLowestFirst, takeFromHighest } from './transfer';

/**
 * Soil within this distance of the cutting edge counts as already cut, in metres.
 *
 * Heights live in a Float32Array, so storing the edge height and reading it
 * back does not round-trip: writing 0.2 yields 0.20000000298. Without a floor,
 * a parked machine would shave off a few nanometres every single tick — never
 * finishing, never settling, and re-uploading terrain geometry forever.
 */
const CUT_EPSILON = 1e-5;

export interface BladeCutParams {
  terrain: Terrain;
  /** Blade centre in world space. */
  centerX: number;
  centerZ: number;
  heading: number;
  width: number;
  thickness: number;
  /**
   * Mouldboard height above the cutting edge, metres.
   *
   * This is the constraint that keeps a heightmap honest. A blade driven into
   * a six-metre bank cannot swallow the whole column in one tick — it is 1.3m
   * tall. Capping the bite at the blade's own height gives a physical limit on
   * cut rate, and the face left standing collapses naturally under slump.
   */
  bladeHeight: number;
  /** World Y of the cutting edge. Soil above this line is cut. */
  edgeY: number;
  /** m³ the blade holds before soil rolls off the ends. Pitch changes this. */
  capacity: number;
  /**
   * The machine's rated blade load, before pitch. Drag is measured against
   * THIS, not against `capacity`: how much soil you can shove is a question of
   * engine and traction, and rolling the mouldboard forward does not make the
   * machine weaker. Measured with the two conflated, pitching forward to bite
   * left the dozer stalled for 37 of every 45 seconds.
   */
  ratedCapacity?: number;
  /**
   * True when the cutting edge is at or below the machine's own ground line —
   * i.e. the blade is actually working the ground rather than riding over it.
   *
   * Only an engaged blade fills. A raised blade passing over a hollow must not
   * suck the pile backwards into it.
   */
  engaged?: boolean;
}

export interface BladeCutResult {
  /** m³ removed from the ground this tick. */
  volumeCut: number;
  /** m³ released into hollows under the blade this tick. */
  volumeFilled: number;
  /** m³ heaped against the blade. */
  prowVolume: number;
  /** 0..1 drag on the chassis from load and from refusing rock. */
  resistance: number;
  /** True when the blade is up against non-diggable material (FR-3.2). */
  blocked: boolean;
  /** Cells touched, for slump relaxation and renderer sync. */
  region: Rect | null;
}

interface Zone {
  cells: number[];
  rect: Rect | null;
}

const EMPTY_ZONE: Zone = { cells: [], rect: null };

/**
 * Cells whose vertex falls inside an oriented rectangle.
 * `halfAlong` runs with the heading, `halfAcross` runs with the right axis.
 */
function collectOrientedRect(
  terrain: Terrain,
  centerX: number,
  centerZ: number,
  fx: number,
  fz: number,
  rx: number,
  rz: number,
  halfAlong: number,
  halfAcross: number,
): Zone {
  // A rectangle thinner than a cell can slip between vertices and collect
  // nothing at all, which would make the blade intermittently stop cutting.
  const along = Math.max(halfAlong, terrain.cellSize * 0.55);
  const across = Math.max(halfAcross, terrain.cellSize * 0.55);

  const ax = fx * along;
  const az = fz * along;
  const bx = rx * across;
  const bz = rz * across;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [sa, sb] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const wx = centerX + ax * sa + bx * sb;
    const wz = centerZ + az * sa + bz * sb;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wz < minZ) minZ = wz;
    if (wz > maxZ) maxZ = wz;
  }

  const x0 = Math.max(0, Math.floor(terrain.worldToCellX(minX)));
  const x1 = Math.min(terrain.width - 1, Math.ceil(terrain.worldToCellX(maxX)));
  const z0 = Math.max(0, Math.floor(terrain.worldToCellZ(minZ)));
  const z1 = Math.min(terrain.depth - 1, Math.ceil(terrain.worldToCellZ(maxZ)));
  if (x1 < x0 || z1 < z0) return EMPTY_ZONE;

  const cells: number[] = [];
  let rx0 = Infinity;
  let rx1 = -Infinity;
  let rz0 = Infinity;
  let rz1 = -Infinity;

  for (let cz = z0; cz <= z1; cz++) {
    const wz = terrain.cellToWorldZ(cz);
    for (let cx = x0; cx <= x1; cx++) {
      const wx = terrain.cellToWorldX(cx);
      const dx = wx - centerX;
      const dz = wz - centerZ;
      if (Math.abs(dx * fx + dz * fz) > along) continue;
      if (Math.abs(dx * rx + dz * rz) > across) continue;

      cells.push(cz * terrain.width + cx);
      if (cx < rx0) rx0 = cx;
      if (cx > rx1) rx1 = cx;
      if (cz < rz0) rz0 = cz;
      if (cz > rz1) rz1 = cz;
    }
  }

  if (cells.length === 0) return EMPTY_ZONE;
  return { cells, rect: { x0: rx0, z0: rz0, x1: rx1, z1: rz1 } };
}


/** Pour into cells lowest-first, but never raise any of them above `level`. */
function fillToLevel(
  terrain: Terrain,
  cells: readonly number[],
  volume: number,
  level: number,
): number {
  const height = terrain.height;
  const area = terrain.cellArea;
  const sorted = [...cells].sort((a, b) => height[a] - height[b]);

  let remaining = volume;
  let placed = 0;
  for (const cell of sorted) {
    if (remaining <= 1e-12) break;
    const room = (level - height[cell]) * area;
    if (room <= 0) continue;
    const give = Math.min(room, remaining);
    height[cell] += give / area;
    terrain.disturbance[cell] = 255;
    remaining -= give;
    placed += give;
  }
  return placed;
}


/** Zone minus a set of cells. The bounding rect is kept (it only shrinks). */
function excluding(zone: Zone, exclude: ReadonlySet<number>): Zone {
  if (zone.cells.length === 0 || exclude.size === 0) return zone;
  const cells = zone.cells.filter((c) => !exclude.has(c));
  if (cells.length === 0) return EMPTY_ZONE;
  return { cells, rect: zone.rect };
}

function meanHeight(terrain: Terrain, cells: readonly number[]): number {
  if (cells.length === 0) return NaN;
  let total = 0;
  for (const i of cells) total += terrain.height[i];
  return total / cells.length;
}

/**
 * Soil heaped against the blade, in m³ — everything standing above `datum`.
 *
 * The datum matters more than it looks. Measuring from the cutting edge is
 * wrong: cut 0.5m into ground that happens to be 6m thick and the entire 6m
 * column counts as load, so the machine reports a full blade before it has
 * shifted a grain. Soil the blade has not reached is not on the blade.
 */
function volumeAbove(terrain: Terrain, cells: readonly number[], datum: number): number {
  let total = 0;
  for (const i of cells) {
    const d = terrain.height[i] - datum;
    if (d > 0) total += d;
  }
  return total * terrain.cellArea;
}

function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return {
    x0: Math.min(a.x0, b.x0),
    z0: Math.min(a.z0, b.z0),
    x1: Math.max(a.x1, b.x1),
    z1: Math.max(a.z1, b.z1),
  };
}

export function applyBladeCut(params: BladeCutParams): BladeCutResult {
  const { terrain, edgeY } = params;

  const fx = Math.sin(params.heading);
  const fz = Math.cos(params.heading);
  // right = forward x up
  const rx = -fz;
  const rz = fx;

  const halfWidth = params.width / 2;
  const halfThickness = params.thickness / 2;

  const cutZone = collectOrientedRect(
    terrain,
    params.centerX,
    params.centerZ,
    fx,
    fz,
    rx,
    rz,
    halfThickness,
    halfWidth,
  );

  // Undisturbed ground beyond where the prow will sit, used as the grade datum.
  // Needed before the cut pass so engagement can be judged against real ground.
  const preDepositHalf = Math.max(params.thickness * 1.6, terrain.cellSize);
  const referenceOffset = halfThickness + preDepositHalf * 2 + terrain.cellSize;
  const referenceZone = collectOrientedRect(
    terrain,
    params.centerX + fx * referenceOffset,
    params.centerZ + fz * referenceOffset,
    fx,
    fz,
    rx,
    rz,
    terrain.cellSize * 0.55,
    halfWidth,
  );
  const grade = meanHeight(terrain, referenceZone.cells);
  const datum = Math.max(Number.isFinite(grade) ? grade : edgeY, edgeY);

  // --- 1. cut, and note what is short of grade -------------------------------
  let volumeCut = 0;
  let blocked = false;
  let deficit = 0;
  let contact = false;
  const cutByMaterial = new Map<number, number>();
  const hollows: number[] = [];

  for (const i of cutZone.cells) {
    const h = terrain.height[i];

    if (h < edgeY - CUT_EPSILON) {
      // Below the cutting edge: ground the blade could FILL — but only as deep
      // as the mouldboard itself. Material cannot feed out of thin air into a
      // hollow the blade is flying well above.
      if (edgeY - h <= params.bladeHeight) {
        deficit += (edgeY - h) * terrain.cellArea;
        hollows.push(i);
      }
      continue;
    }
    contact = true;
    if (h <= edgeY + CUT_EPSILON) continue;

    const material = materialOf(terrain.material[i]);
    if (!material.diggable) {
      blocked = true; // FR-3.2 — the blade refuses rock
      continue;
    }

    // The bite is limited by the blade's own height, not by the height of the
    // bank. What is left standing is a steep face, which slump then collapses.
    const depth = Math.min(h - edgeY, params.bladeHeight);
    terrain.height[i] = h - depth;
    terrain.disturbance[i] = 255; // freshly cut ground is as churned as it gets
    volumeCut += depth * terrain.cellArea;
    cutByMaterial.set(material.id, (cutByMaterial.get(material.id) ?? 0) + depth);
  }

  // --- 2. where it goes ------------------------------------------------------
  const cutCells = new Set(cutZone.cells);
  const depositHalf = Math.max(params.thickness * 1.6, terrain.cellSize);
  const depositOffset = halfThickness + depositHalf;

  // The blade physically occupies the cut zone, so soil cannot pile up inside
  // it. Left overlapping, a cell would be cut and refilled every tick — a
  // treadmill that conserves volume but never stops "digging" the same spot.
  const depositZone = excluding(
    collectOrientedRect(
      terrain,
      params.centerX + fx * depositOffset,
      params.centerZ + fz * depositOffset,
      fx,
      fz,
      rx,
      rz,
      depositHalf,
      halfWidth,
    ),
    cutCells,
  );

  const prowBefore = volumeAbove(terrain, depositZone.cells, datum);

  // --- 2a. FILL: release soil into hollows under the blade -------------------
  //
  // This is what makes grading possible at all. Without it the blade can only
  // cut and shove forward, so a perfect operator shaves every high spot, pushes
  // the spoil off the far edge, and leaves every hollow exactly as deep as it
  // started. Measured: accuracy plateaued at 49% with 38 m3 of unfilled hollow.
  //
  // Cut soil goes into the holes first; if that is not enough, the pile in
  // front feeds back under the cutting edge, which is how a real blade fills.
  //
  // Engagement is judged against the ground, not against the blade's lever
  // position. Reading it off blade height was exactly backwards: a machine
  // standing IN a hollow holds its blade ABOVE its own tracks to reach design
  // grade, which is precisely when it should be filling.
  let volumeFilled = 0;
  const engaged =
    params.engaged === false
      ? false
      : contact || (Number.isFinite(grade) && grade >= edgeY - 0.05);

  if (engaged && deficit > 0 && hollows.length > 0) {
    let supply = Math.min(volumeCut, deficit);
    volumeCut -= supply;

    const stillShort = deficit - supply;
    if (stillShort > 0) {
      // Never rob the ground ahead below grade — only take the heaped prow.
      supply += takeFromHighest(
        terrain,
        depositZone.cells,
        stillShort,
        Math.max(edgeY, datum),
      );
    }

    if (supply > 0) {
      volumeFilled = fillToLevel(terrain, hollows, supply, edgeY);
      // Anything the hollows could not take goes back on the pile.
      volumeCut += supply - volumeFilled;
    }
  }

  let sideZones: Zone[] = [];
  let deposited = 0;

  if (volumeCut > 0) {
    let dominant: MaterialId = MaterialId.GRASS;
    let best = -1;
    for (const [id, v] of cutByMaterial) {
      if (v > best) {
        best = v;
        dominant = id as MaterialId;
      }
    }

    // Soil rolls off the ends of an overfull blade — the windrows a real dozer
    // leaves down each side. It sheds PROGRESSIVELY: a threshold made the blade
    // hold everything up to capacity and then dump 45% of every cut sideways
    // the instant it was crossed, which reads as the load randomly falling out
    // rather than as a blade you can feel filling up.
    const over = params.capacity > 0 ? (prowBefore - params.capacity) / params.capacity : 0;
    let toSides = volumeCut * clamp(over, 0, 1) * TUNING.sideSpillFraction;

    // Nothing stacks higher than the top of the mouldboard. A prow towering
    // over the blade — and over the machine — is the clearest tell that this
    // is a height field rather than a dozer, and it is what the load rolling
    // off the ends is FOR: soil that will not fit leaves out the sides, which
    // is where the windrows down each side of a real pass come from.
    const front = volumeCut - toSides;
    const placedFront = fillLowestFirst(
      terrain,
      depositZone.cells,
      front,
      dominant,
      // Measured from the material being pushed, not from the edge: a blade
      // biting a metre under grade is buried, not holding a metre-deep prow.
      Math.max(edgeY, datum) + params.bladeHeight,
    );
    deposited += placedFront;
    toSides += front - placedFront;

    if (toSides > 0) {
      const sideHalfAcross = Math.max(terrain.cellSize, 0.4);
      sideZones = [-1, 1].map((side) =>
        excluding(
          collectOrientedRect(
            terrain,
            params.centerX + rx * side * (halfWidth + sideHalfAcross),
            params.centerZ + rz * side * (halfWidth + sideHalfAcross),
            fx,
            fz,
            rx,
            rz,
            depositHalf,
            sideHalfAcross,
          ),
          cutCells,
        ),
      );
      const sideCells = sideZones.flatMap((z) => z.cells);
      deposited += fillLowestFirst(terrain, sideCells, toSides, dominant);
    }

    // FR-3.5 backstop. Only reachable if the deposit zones fall off the map,
    // which the vehicle's edge margin should prevent — but soil must never be
    // destroyed just because geometry got unlucky.
    const leftover = volumeCut - deposited;
    if (leftover > 1e-9) {
      deposited += fillLowestFirst(terrain, cutZone.cells, leftover, null);
    }
  }

  // --- 3. report -------------------------------------------------------------
  const prowVolume = volumeAbove(terrain, depositZone.cells, datum);

  // Resistance comes from WHAT IS BEING PUSHED, not from an instantaneous cut
  // rate. A rate term looks reasonable and behaves badly: one bite into a bank
  // removes a whole cell row at once, which at 60Hz reads as hundreds of m³/s
  // and pins resistance at maximum before the machine has done any work. Prow
  // volume is a state, not a rate, so it cannot spike.
  //
  // And it must keep climbing PAST a full blade. Capping it at capacity meant
  // a prow of 10 m3 dragged exactly as hard as one of 3.4 — measured: constant
  // 0.60 drag and a constant 1.62 m/s however much soil was in front. Nothing
  // could ever bog the machine down, so nothing ever taught the player that a
  // blade has a limit.
  const rated = params.ratedCapacity ?? params.capacity;
  const fill = rated > 0 ? prowVolume / rated : 0;
  const loadResistance =
    fill <= 1
      ? fill * TUNING.fullBladeResistance
      : TUNING.fullBladeResistance +
        (1 - TUNING.fullBladeResistance) *
          clamp((fill - 1) / Math.max(TUNING.stallFill - 1, 1e-3), 0, 1);
  const resistance = Math.max(blocked ? TUNING.rockResistance : 0, loadResistance);

  let region = unionRect(cutZone.rect, depositZone.rect);
  for (const zone of sideZones) region = unionRect(region, zone.rect);
  // Only when soil actually moved — see the note in slump.ts.
  if (region && (volumeCut > 0 || volumeFilled > 0)) {
    terrain.markDirty(region.x0, region.z0, region.x1, region.z1);
  }

  return { volumeCut, volumeFilled, prowVolume, resistance, blocked, region };
}
