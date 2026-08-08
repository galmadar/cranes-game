/**
 * Angle-of-repose relaxation (FR-3.6).
 *
 * Without this you don't get piles, you get impossible vertical spikes: a
 * bulldozer would carve pillars of sand that stand up like concrete.
 *
 * Stability is the real risk here (PLAN.md §6). Two properties keep it from
 * oscillating, and both are load-bearing:
 *
 *   1. Each cell sheds to its STEEPEST downhill neighbour only. Shedding to
 *      all four at once can move more soil out of a cell than the cell was
 *      taller by, which flips the gradient and rings forever.
 *   2. A transfer is capped at half the height difference, then damped. The
 *      pair can therefore never cross over, whatever the terrain looks like.
 *
 * Volume is conserved exactly: every transfer subtracts from one cell and adds
 * the identical amount to another, and all cells share one area.
 */

import { materialOf } from '../materials';
import type { Rect, Terrain } from '../Terrain';
import { TUNING } from '../tuning';

/**
 * Transfers smaller than this count as rest, in metres.
 *
 * Damped relaxation approaches the repose angle asymptotically, so without a
 * floor there is always *some* nonzero transfer left and the solver can never
 * report itself settled — it would grind through every pass, every tick,
 * forever, over ground that is visually static. 1µm of soil is not a physical
 * quantity anyone can see.
 */
const MIN_TRANSFER = 1e-6;

export interface SlumpResult {
  /** Passes actually run before the region went quiet. */
  passes: number;
  /** True if the region reached rest rather than running out of passes. */
  settled: boolean;
}

export function relaxSlump(terrain: Terrain, rect: Rect, maxPasses = 2): SlumpResult {
  const x0 = Math.max(0, rect.x0);
  const z0 = Math.max(0, rect.z0);
  const x1 = Math.min(terrain.width - 1, rect.x1);
  const z1 = Math.min(terrain.depth - 1, rect.z1);
  if (x1 < x0 || z1 < z0) return { passes: 0, settled: true };

  const height = terrain.height;
  const cell = terrain.cellSize;
  const lastX = terrain.width - 1;
  const lastZ = terrain.depth - 1;

  let passes = 0;
  let settled = true;
  let touchedTerrain = false;

  for (let pass = 0; pass < maxPasses; pass++) {
    passes++;
    let moved = false;

    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cz * terrain.width + cx;

        // Rock holds any slope; it neither slumps nor erodes. It can still
        // RECEIVE soil, which is why the check is on the source cell only.
        const material = materialOf(terrain.material[i]);
        if (!material.diggable) continue;

        const h = height[i];
        const maxDrop = Math.tan(material.angleOfRepose) * cell;

        let target = -1;
        let targetH = h;
        if (cx > 0 && height[i - 1] < targetH) {
          targetH = height[i - 1];
          target = i - 1;
        }
        if (cx < lastX && height[i + 1] < targetH) {
          targetH = height[i + 1];
          target = i + 1;
        }
        if (cz > 0 && height[i - terrain.width] < targetH) {
          targetH = height[i - terrain.width];
          target = i - terrain.width;
        }
        if (cz < lastZ && height[i + terrain.width] < targetH) {
          targetH = height[i + terrain.width];
          target = i + terrain.width;
        }
        if (target < 0) continue;

        const drop = h - targetH;
        if (drop <= maxDrop) continue;

        const transfer = Math.min(drop - maxDrop, drop * 0.5) * TUNING.slumpRelaxation;
        if (transfer < MIN_TRANSFER) continue;

        height[i] = h - transfer;
        height[target] = targetH + transfer;
        moved = true;
      }
    }

    if (!moved) break;
    settled = false;
    touchedTerrain = true;
  }

  // Only if soil actually moved. Marking unconditionally would keep a parked
  // machine re-uploading terrain geometry every single frame for no change.
  if (touchedTerrain) {
    // Neighbours one cell outside the region may have received soil.
    terrain.markDirty(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
  }

  return { passes, settled };
}
