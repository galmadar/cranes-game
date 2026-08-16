/**
 * Pipeline Cut — the excavator's site.
 *
 * The dozer's yard is about what the ground is MADE of and the crane's is about
 * what is standing on it. This one is about depth. An excavator's whole subject
 * is the vertical: how deep the teeth are, whether the trench walls are holding,
 * where the spoil is going. So the map is soft ground with a marked pipe route
 * across it, and the contract is a trench with a floor well over a metre down —
 * far past anything a blade could reach.
 *
 * Deliberately soft: topsoil and clay-ish mud, with a repose angle low enough
 * that a trench cut too steep slumps back in while you are working further
 * along it. That is the site arguing with you, and it is the reason spoil
 * placement matters — heap it on the lip and it runs straight back into the cut.
 */

import { createShapedSite } from '../../sim/job/JobSite';
import { MaterialId } from '../../sim/materials';
import { fbm, makeValueNoise2D } from '../../sim/math/noise';
import { smoothstep, vec3 } from '../../sim/math/Vec';
import type { Terrain } from '../../sim/Terrain';
import type { MapDefinition } from './types';

const WIDTH = 256;
const DEPTH = 256;
const CELL = 0.5;
const SEED = 90210;

/** The pipe route runs along X at this Z. The trench follows it. */
const ROUTE_Z = 0;
/**
 * Trench geometry, sized against what the machine can actually move.
 *
 * These are not aesthetic numbers. A 22 m run 1.7 m deep is 242 m³ of cut,
 * which at a 2 m³ bucket and a ten-second cycle is a hundred and twenty
 * cycles — twenty minutes of identical work against an eight-minute par. The
 * contract has to be scaled to the bucket or it is a contract nobody finishes.
 * At these numbers it is about 72 m³, near enough forty cycles.
 */
/** Half-width of the trench floor, metres. */
const TRENCH_HALF = 1.2;
/** How far below existing ground the floor sits. */
const TRENCH_DEPTH = 1.25;
/** Half-length of the run that has to be dug, metres. */
const TRENCH_HALF_LENGTH = 6;

/** 1 inside `radius - feather`, smoothly 0 at `radius`. */
function falloff(distance: number, radius: number, feather: number): number {
  if (distance >= radius) return 0;
  if (distance <= radius - feather) return 1;
  return smoothstep((radius - distance) / feather);
}

/**
 * The trench profile: flat floor, battered walls, untouched ground either side.
 *
 * Walls are sloped rather than vertical on purpose. A vertical-sided target in
 * soft ground is a target the soil itself will not hold — the slump solver
 * would fight the contract, and the player would watch their accuracy fall
 * while doing everything right.
 */
function trenchTarget(x: number, z: number, ground: number): number {
  if (Math.abs(x) > TRENCH_HALF_LENGTH) return ground;

  const across = Math.abs(z - ROUTE_Z);
  if (across <= TRENCH_HALF) return ground - TRENCH_DEPTH;

  const batter = 1.9; // metres of run per metre of fall
  const rise = (across - TRENCH_HALF) / batter;
  return Math.min(ground, ground - TRENCH_DEPTH + rise);
}

export const pipelineCutMap: MapDefinition = {
  id: 'pipelineCut',
  displayName: 'Pipeline Cut',
  description: 'Soft ground with a marked pipe route. Dig the trench, keep the spoil clear.',

  width: WIDTH,
  depth: DEPTH,
  cellSize: CELL,

  spawn: { position: vec3(0, 0, -6.5), heading: 0 },
  defaultVehicleId: 'excavator',

  createJob: (terrain: Terrain) =>
    createShapedSite(terrain, {
      id: 'pipeline-trench-01',
      title: 'Cut the trench',
      brief:
        'Boom down (F) to get the teeth in, drag with the stick (T), curl (Z) to hold the ' +
        'load, slew (Q/E) and tip it out (X). Keep the spoil off the lip.',

      centerX: 0,
      centerZ: ROUTE_Z,
      // Wider than the trench so the batters and the untouched shoulders are
      // inside the scored area — spoil dumped on the lip should COST you.
      width: TRENCH_HALF_LENGTH * 2 + 4,
      // Only a little wider than the trench and its batters. A generous margin
      // is free marks: shoulders that are already at target inflate accuracy
      // before a single bucket has been lifted.
      depth: 10,

      tolerance: 0.3,
      // The site is cropped tight to the trench so this is not the free ride it
      // looks like: better than half the scored cells have to be cut, and the
      // batters have to be left roughly at their slope rather than squared off.
      requiredAccuracy: 0.85,
      parSeconds: 480,

      spawn: { position: vec3(0, 0, -6.5), heading: 0 },
      shape: trenchTarget,
    }),

  generate() {
    const count = WIDTH * DEPTH;
    const height = new Float32Array(count);
    const material = new Uint8Array(count);

    const noise = makeValueNoise2D(SEED);
    const originX = -((WIDTH - 1) * CELL) / 2;
    const originZ = -((DEPTH - 1) * CELL) / 2;

    for (let cz = 0; cz < DEPTH; cz++) {
      const wz = originZ + cz * CELL;

      for (let cx = 0; cx < WIDTH; cx++) {
        const wx = originX + cx * CELL;
        const i = cz * WIDTH + cx;

        // --- base: gently rolling topsoil -----------------------------------
        let h =
          fbm(noise, wx * 0.016, wz * 0.016, 4) * 1.4 +
          fbm(noise, wx * 0.055 + 11, wz * 0.055 - 7, 2) * 0.22;
        let m: MaterialId = MaterialId.GRASS;

        // --- the route corridor, graded flat so the trench has a datum ------
        // Without this the target floor follows every hump in the ground and
        // "level the bottom of the trench" stops being a thing you can do.
        const corridor = falloff(Math.abs(wz - ROUTE_Z), 11, 5);
        if (corridor > 0) h = h * (1 - corridor);

        // --- soft clay along the route: the reason walls slump --------------
        const clay = falloff(Math.hypot((wx) * 0.55, wz - ROUTE_Z), 9, 5);
        if (clay > 0.35) m = MaterialId.MUD;

        // --- a sand lens the trench runs straight through -------------------
        const lens = falloff(Math.hypot(wx - 7, wz - ROUTE_Z), 6, 4);
        if (lens > 0.4) m = MaterialId.SAND;

        // --- rock the trench has to stop at, at the far end -----------------
        // Something the bucket physically cannot cut, so "blocked" is a state
        // the player meets rather than a flag in a readout.
        const rock = falloff(Math.hypot(wx - 17, wz - ROUTE_Z), 5, 2.5);
        if (rock > 0) {
          m = MaterialId.ROCK;
          h += 1.6 * rock;
        }

        // --- perimeter berm -------------------------------------------------
        const edge = Math.min(cx, cz, WIDTH - 1 - cx, DEPTH - 1 - cz) * CELL;
        if (edge < 14) {
          const t = 1 - edge / 14;
          h += t * t * 7;
          if (edge < 5) m = MaterialId.ROCK;
        }

        height[i] = h;
        material[i] = m;
      }
    }

    return { height, material };
  },
};
