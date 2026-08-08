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
import type { Rect, Terrain } from '../Terrain';

/** Beyond this prow load the blade stops holding soil and it rolls off the ends. */
const SIDE_SPILL_FRACTION = 0.45;
/** Drag from a completely full blade. Tuning knob for M4. */
const FULL_BLADE_RESISTANCE = 0.75;
/** Resistance applied when the blade is buried in something it cannot cut. */
const ROCK_RESISTANCE = 0.92;

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
  /** m³ the blade holds before soil rolls off the ends. */
  capacity: number;
}

export interface BladeCutResult {
  /** m³ removed from the ground this tick. */
  volumeCut: number;
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

/**
 * Pour `volume` into `cells`, filling the lowest first so soil settles into
 * hollows before it stacks. Returns how much actually landed — less than
 * requested only if there was nowhere to put it.
 */
function fillLowestFirst(
  terrain: Terrain,
  cells: readonly number[],
  volume: number,
  paint: MaterialId | null,
): number {
  if (cells.length === 0 || volume <= 0) return 0;

  const height = terrain.height;
  const area = terrain.cellArea;
  const sorted = [...cells].sort((a, b) => height[a] - height[b]);

  let remaining = volume;
  let k = 1;
  while (k <= sorted.length && remaining > 1e-12) {
    const level = height[sorted[k - 1]];
    const nextLevel = k < sorted.length ? height[sorted[k]] : Infinity;
    const roomToNext = (nextLevel - level) * k * area;

    if (remaining <= roomToNext) {
      const rise = remaining / (k * area);
      for (let j = 0; j < k; j++) height[sorted[j]] += rise;
      remaining = 0;
    } else {
      for (let j = 0; j < k; j++) height[sorted[j]] = nextLevel;
      remaining -= roomToNext;
      k++;
    }
  }

  if (paint !== null) {
    // Everything we raised takes on the material that was cut, so pushing sand
    // across topsoil leaves a sand trail. Rock is never painted over.
    for (let j = 0; j < k && j < sorted.length; j++) {
      const cell = sorted[j];
      if (!materialOf(terrain.material[cell]).diggable) continue;
      terrain.material[cell] = paint;
      terrain.disturbance[cell] = 255; // spoil is loose, freshly turned earth
    }
  }

  return volume - remaining;
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

  // --- 1. cut ---------------------------------------------------------------
  let volumeCut = 0;
  let blocked = false;
  const cutByMaterial = new Map<number, number>();

  for (const i of cutZone.cells) {
    const h = terrain.height[i];
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

  // Undisturbed ground just beyond the prow, used as the grade datum. It has
  // to be a separate zone: filling lowest-first levels the deposit zone flat,
  // so there is no untouched row left inside it to read grade from.
  const referenceOffset = depositOffset + depositHalf + terrain.cellSize;
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

  const prowBefore = volumeAbove(terrain, depositZone.cells, datum);

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

    // Once the prow is over capacity the blade cannot hold any more and soil
    // rolls off the ends — the windrows a real dozer leaves down each side.
    const overloaded = prowBefore > params.capacity;
    const toSides = overloaded ? volumeCut * SIDE_SPILL_FRACTION : 0;

    deposited += fillLowestFirst(terrain, depositZone.cells, volumeCut - toSides, dominant);

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
  const loadResistance =
    params.capacity > 0 ? Math.min(1, prowVolume / params.capacity) * FULL_BLADE_RESISTANCE : 0;
  const resistance = Math.max(blocked ? ROCK_RESISTANCE : 0, loadResistance);

  let region = unionRect(cutZone.rect, depositZone.rect);
  for (const zone of sideZones) region = unionRect(region, zone.rect);
  // Only when soil actually moved — see the note in slump.ts.
  if (region && volumeCut > 0) {
    terrain.markDirty(region.x0, region.z0, region.x1, region.z1);
  }

  return { volumeCut, prowVolume, resistance, blocked, region };
}
