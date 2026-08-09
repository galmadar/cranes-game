/**
 * A job site — the target surface the player is trying to produce.
 *
 * This is the thing the game was missing. Until now any arrangement of soil
 * was as good as any other, so there was nothing to be good at. A job says
 * "the ground should look like THIS", and everything else — scoring, the
 * overlay, payout later — is derived from the gap between wish and reality.
 *
 * Stored as a sub-rectangle rather than a full-grid array: scoring loops only
 * walk the site, and the renderer's per-vertex lookup is a bounds check plus
 * an offset.
 */

import type { Vec3 } from '../math/Vec';
import { vec3 } from '../math/Vec';
import type { Rect, Terrain } from '../Terrain';

export interface JobSite {
  readonly id: string;
  readonly title: string;
  readonly brief: string;

  /** Inclusive cell bounds. */
  readonly bounds: Rect;
  /** Target height per cell, row-major over `bounds`. */
  readonly target: Float32Array;
  // Difficulty knobs are mutable: finding the right values is a question only
  // playing can answer, so the settings drawer edits them live.

  /** Metres either side of target that still counts as on grade. */
  tolerance: number;
  /** Fraction of cells on grade needed to call the job done, 0..1. */
  requiredAccuracy: number;
  /** Seconds the job is expected to take. Beating it is worth stars later. */
  parSeconds: number;

  /**
   * Where the machine starts, if the job overrides the map's spawn.
   *
   * A contract you cannot find is not a contract. Dropping the player 30m away
   * from a 14m site on a 128m map turns "level this pad" into "locate this
   * pad", which is a different and much worse game.
   */
  readonly spawn?: { position: Vec3; heading: number };
}

export function siteWidth(site: JobSite): number {
  return site.bounds.x1 - site.bounds.x0 + 1;
}

export function siteDepth(site: JobSite): number {
  return site.bounds.z1 - site.bounds.z0 + 1;
}

export function siteCellCount(site: JobSite): number {
  return siteWidth(site) * siteDepth(site);
}

/** Target height at a cell, or null if the cell is outside the job. */
export function targetAt(site: JobSite, cx: number, cz: number): number | null {
  const b = site.bounds;
  if (cx < b.x0 || cx > b.x1 || cz < b.z0 || cz > b.z1) return null;
  return site.target[(cz - b.z0) * siteWidth(site) + (cx - b.x0)];
}

export interface FlatPadOptions {
  id: string;
  title: string;
  brief: string;
  /** Centre in world units. */
  centerX: number;
  centerZ: number;
  /** Extent in world units. */
  width: number;
  depth: number;
  tolerance: number;
  requiredAccuracy: number;
  parSeconds: number;
  /** Metres back from the site's south edge to park the machine. */
  spawnOffset?: number;
  /**
   * Target elevation. Defaults to the MEAN of the ground currently inside the
   * site, which makes cut and fill balance: every m³ that has to come off a
   * high spot has a low spot waiting for it. That keeps the job solvable with
   * a bulldozer alone — no importing or dumping soil required.
   */
  targetHeight?: number;
}

export function createFlatPad(terrain: Terrain, options: FlatPadOptions): JobSite {
  const bounds = worldRectToCells(terrain, options);

  const w = bounds.x1 - bounds.x0 + 1;
  const d = bounds.z1 - bounds.z0 + 1;

  let height = options.targetHeight;
  if (height === undefined) {
    let sum = 0;
    for (let cz = bounds.z0; cz <= bounds.z1; cz++) {
      for (let cx = bounds.x0; cx <= bounds.x1; cx++) sum += terrain.getHeight(cx, cz);
    }
    height = sum / (w * d);
  }

  // Park just outside the southern edge, nose pointing into the work.
  const back = options.spawnOffset ?? 8;
  const spawn = {
    position: vec3(options.centerX, 0, options.centerZ - options.depth / 2 - back),
    heading: 0, // +Z, facing the site
  };

  return {
    id: options.id,
    title: options.title,
    brief: options.brief,
    bounds,
    target: new Float32Array(w * d).fill(height),
    tolerance: options.tolerance,
    requiredAccuracy: options.requiredAccuracy,
    parSeconds: options.parSeconds,
    spawn,
  };
}

function worldRectToCells(
  terrain: Terrain,
  o: { centerX: number; centerZ: number; width: number; depth: number },
): Rect {
  const clampX = (v: number) => Math.max(0, Math.min(terrain.width - 1, v));
  const clampZ = (v: number) => Math.max(0, Math.min(terrain.depth - 1, v));

  const x0 = clampX(Math.round(terrain.worldToCellX(o.centerX - o.width / 2)));
  const x1 = clampX(Math.round(terrain.worldToCellX(o.centerX + o.width / 2)));
  const z0 = clampZ(Math.round(terrain.worldToCellZ(o.centerZ - o.depth / 2)));
  const z1 = clampZ(Math.round(terrain.worldToCellZ(o.centerZ + o.depth / 2)));

  return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) };
}
