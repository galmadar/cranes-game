/**
 * Moving soil between cells, conserving it exactly.
 *
 * Both of these were written for the blade and both turned out to be the whole
 * of what a BUCKET does too — an excavator takes off the tallest ground under
 * its teeth and tips it back out onto the lowest ground under the dump. They
 * live here rather than in `blade.ts` so the second digging machine reuses the
 * arithmetic instead of growing a second, subtly different copy of it.
 *
 * Neither function invents or destroys volume: each returns exactly how much it
 * moved, and the caller is responsible for the other half of the transfer.
 * That contract is what FR-3.5 rests on.
 */

import { materialOf, type MaterialId } from '../materials';
import type { Terrain } from '../Terrain';

/**
 * Pour `volume` m³ onto the given cells, filling the lowest ground first.
 *
 * Level-by-level rather than spread-evenly: soil finds the hollows, so a load
 * tipped into uneven ground fills the dips before it raises the ridges.
 * Returns how much actually fitted — the rest is still the caller's problem.
 */
export function fillLowestFirst(
  terrain: Terrain,
  cells: readonly number[],
  volume: number,
  paint: MaterialId | null,
  /** Height nothing may be raised above. What does not fit is returned unplaced. */
  ceiling = Infinity,
): number {
  if (cells.length === 0 || volume <= 0) return 0;

  const height = terrain.height;
  const area = terrain.cellArea;
  const sorted = [...cells].sort((a, b) => height[a] - height[b]);

  let remaining = volume;
  let k = 1;
  while (k <= sorted.length && remaining > 1e-12) {
    const level = height[sorted[k - 1]];
    if (level >= ceiling) break;
    const nextLevel = Math.min(k < sorted.length ? height[sorted[k]] : Infinity, ceiling);
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

/**
 * Take up to `wanted` m³ off the tallest cells, never cutting below `floor`.
 *
 * The mirror of `fillLowestFirst`, and the thing that makes GRADING possible.
 * Without it the blade can only ever cut and shove forward: a hollow stays a
 * hollow no matter how much soil is heaped in front of the machine, because
 * there is no mechanism for the load to come off the blade and go into the
 * low ground it is standing over.
 */
export function takeFromHighest(
  terrain: Terrain,
  cells: readonly number[],
  wanted: number,
  floor: number,
): number {
  if (cells.length === 0 || wanted <= 0) return 0;

  const height = terrain.height;
  const area = terrain.cellArea;
  // Tallest first.
  const sorted = [...cells].sort((a, b) => height[b] - height[a]);

  let taken = 0;
  for (const cell of sorted) {
    if (taken >= wanted) break;
    const available = (height[cell] - floor) * area;
    if (available <= 0) continue;
    const grab = Math.min(available, wanted - taken);
    height[cell] -= grab / area;
    taken += grab;
  }
  return taken;
}
