/**
 * Bucket digging and dumping.
 *
 * The difference from the blade, and it is the whole reason an excavator is a
 * different machine rather than a differently-shaped dozer: a blade never
 * HOLDS anything. Its "load" is soil heaped in front of it, measured off the
 * terrain every step, and it exists only while the machine keeps pushing. A
 * bucket takes soil out of the world, carries it wherever the arm goes, and
 * puts it back somewhere else entirely.
 *
 * That makes volume conservation a two-part invariant here. The height field
 * alone is no longer constant — terrain PLUS whatever is in the bucket is.
 * Every function below reports exactly how much it moved so the caller can
 * hold up the other end of that.
 */

import { isDiggable, materialOf, MaterialId } from '../materials';
import type { Rect, Terrain } from '../Terrain';
import { fillLowestFirst, takeFromHighest } from './transfer';

export interface BucketBite {
  terrain: Terrain;
  /** Bucket teeth, world position. */
  x: number;
  z: number;
  /** Teeth elevation. Nothing below this is taken — that is the cut floor. */
  teethY: number;
  /** Bucket width across the cut, metres. */
  width: number;
  /** m³ the bucket still has room for. */
  room: number;
  /** Most that may be taken this step, m³. Rate limiting lives with the caller. */
  maxVolume: number;
}

export interface BucketBiteResult {
  /** m³ actually taken out of the terrain, and so added to the bucket. */
  volume: number;
  /** Cells touched, for slump and for the renderer. Null if nothing moved. */
  region: Rect | null;
  /** True when the teeth are up against something they cannot cut (FR-3.2). */
  blocked: boolean;
  /** Dominant material taken, so spoil looks like what it came from. */
  material: MaterialId | null;
}

export interface BucketDump {
  terrain: Terrain;
  x: number;
  z: number;
  /** Bucket width, metres. Spread is a little wider — soil does not stack. */
  width: number;
  /** m³ leaving the bucket this step. */
  volume: number;
  /** What it is made of, so a heap of sand looks like sand. */
  material: MaterialId | null;
}

export interface BucketDumpResult {
  /** m³ that actually landed. Anything short stays in the bucket. */
  placed: number;
  region: Rect | null;
}

/** Cells whose centres fall inside a circle, plus the rect that bounds them. */
function disc(terrain: Terrain, x: number, z: number, radius: number) {
  const cells: number[] = [];
  const cx0 = Math.floor(terrain.worldToCellX(x - radius));
  const cx1 = Math.ceil(terrain.worldToCellX(x + radius));
  const cz0 = Math.floor(terrain.worldToCellZ(z - radius));
  const cz1 = Math.ceil(terrain.worldToCellZ(z + radius));
  const r2 = radius * radius;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (let cz = cz0; cz <= cz1; cz++) {
    const dz = terrain.cellToWorldZ(cz) - z;
    for (let cx = cx0; cx <= cx1; cx++) {
      if (!terrain.inBounds(cx, cz)) continue;
      const dx = terrain.cellToWorldX(cx) - x;
      if (dx * dx + dz * dz > r2) continue;
      cells.push(terrain.index(cx, cz));
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cz < minZ) minZ = cz;
      if (cz > maxZ) maxZ = cz;
    }
  }

  const rect: Rect | null =
    cells.length === 0 ? null : { x0: minX, z0: minZ, x1: maxX, z1: maxZ };
  return { cells, rect };
}

/** The material most of a set of cells is made of. Spoil should look like its source. */
function dominantMaterial(terrain: Terrain, cells: readonly number[]): MaterialId | null {
  const counts = new Map<number, number>();
  for (const cell of cells) {
    const m = terrain.material[cell];
    if (!isDiggable(m)) continue;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let best: MaterialId | null = null;
  let bestCount = 0;
  for (const [m, n] of counts) {
    if (n > bestCount) {
      best = m as MaterialId;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Take a bite.
 *
 * Only ground standing ABOVE the teeth is available, which is what makes the
 * arm's geometry the control: to dig deeper you have to get the teeth lower,
 * not hold the button down for longer. Rock refuses, and says so rather than
 * silently doing nothing — an excavator that quietly fails to dig reads as
 * broken, where one that shudders to a stop reads as rock.
 */
export function bucketBite(params: BucketBite): BucketBiteResult {
  const { terrain } = params;
  const { cells, rect } = disc(terrain, params.x, params.z, params.width / 2);
  if (cells.length === 0) return { volume: 0, region: null, blocked: false, material: null };

  const diggable = cells.filter((c) => isDiggable(terrain.material[c]));
  const solid = cells.filter((c) => !isDiggable(terrain.material[c]));

  // Standing on rock that is above the teeth is what "blocked" means: there is
  // something in the way, not merely nothing left to take.
  const blocked = solid.some((c) => terrain.height[c] > params.teethY + 1e-4);

  const wanted = Math.min(params.room, params.maxVolume);
  if (wanted <= 0 || diggable.length === 0) {
    return { volume: 0, region: null, blocked, material: null };
  }

  const material = dominantMaterial(terrain, diggable);
  const volume = takeFromHighest(terrain, diggable, wanted, params.teethY);
  if (volume <= 0) return { volume: 0, region: null, blocked, material: null };

  for (const cell of diggable) terrain.disturbance[cell] = 255;
  if (rect) terrain.markDirty(rect.x0, rect.z0, rect.x1, rect.z1);

  return { volume, region: rect, blocked, material };
}

/**
 * Tip the bucket out.
 *
 * Spread over a wider disc than the cut, because a dropped load spills — and
 * because dumping through the same narrow footprint it was dug from would let
 * a player rebuild a spike of soil one bucket at a time. The slump pass tidies
 * the rest, which is why the caller hands back a region.
 */
export function bucketDump(params: BucketDump): BucketDumpResult {
  const { terrain } = params;
  if (params.volume <= 0) return { placed: 0, region: null };

  const { cells, rect } = disc(terrain, params.x, params.z, params.width * 0.75);
  if (cells.length === 0) return { placed: 0, region: null };

  // Rock takes a heap on top of it perfectly well; it just cannot be cut.
  const placed = fillLowestFirst(terrain, cells, params.volume, params.material);
  if (placed <= 0) return { placed: 0, region: null };

  for (const cell of cells) {
    if (materialOf(terrain.material[cell]).diggable) terrain.disturbance[cell] = 255;
  }
  if (rect) terrain.markDirty(rect.x0, rect.z0, rect.x1, rect.z1);

  return { placed, region: rect };
}
