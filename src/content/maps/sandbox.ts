/**
 * Sandbox Yard — the M1 test map.
 *
 * Built to exercise every material rule the MVP needs, in one glance:
 *   - topsoil across the yard, gently rolling (so terrain-conform is visible)
 *   - a SAND pit and a loose SAND pile  -> the primary dig/push target
 *   - a MUD patch                        -> diggable but low traction
 *   - a ROCK outcrop                     -> the blade must refuse this
 *   - a flat spawn pad at the origin     -> a sane place to start driving
 *   - a rock berm around the perimeter   -> the yard reads as bounded
 */

import { createPadLevelJob } from '../jobs/padLevel';
import { MaterialId } from '../../sim/materials';
import { fbm, makeValueNoise2D } from '../../sim/math/noise';
import { lerp, smoothstep, vec3 } from '../../sim/math/Vec';
import type { MapDefinition } from './types';

const WIDTH = 256;
const DEPTH = 256;
const CELL = 0.5; // -> 127.5m x 127.5m yard
const SEED = 1337;

/** 1 inside `radius - feather`, smoothly 0 at `radius`. */
function falloff(distance: number, radius: number, feather: number): number {
  if (distance >= radius) return 0;
  if (distance <= radius - feather) return 1;
  return smoothstep((radius - distance) / feather);
}

export const sandboxMap: MapDefinition = {
  id: 'sandbox',
  displayName: 'Sandbox Yard',
  description: 'Flat working yard with a sand pit, a mud patch and a rock outcrop.',

  width: WIDTH,
  depth: DEPTH,
  cellSize: CELL,

  spawn: { position: vec3(0, 0, 0), heading: 0 },
  defaultVehicleId: 'bulldozer',

  createJob: createPadLevelJob,

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

        // --- base: gently rolling topsoil ---------------------------------
        let h =
          fbm(noise, wx * 0.018, wz * 0.018, 4) * 1.6 +
          fbm(noise, wx * 0.06 + 40, wz * 0.06 - 25, 2) * 0.25;
        let m: MaterialId = MaterialId.GRASS;

        // --- sand pit: a shallow scooped bowl ------------------------------
        const kPit = falloff(Math.hypot(wx + 20, wz + 15), 19, 8);
        if (kPit > 0) {
          m = MaterialId.SAND;
          h = lerp(h, -1.4, kPit);
        }

        // --- sand pile: the thing you actually push around -----------------
        const kPile = falloff(Math.hypot(wx + 30, wz - 6), 8, 7.5);
        if (kPile > 0) {
          m = MaterialId.SAND;
          h += 3.2 * kPile;
        }

        // --- mud patch: diggable, but it bogs the tracks -------------------
        const kMud = falloff(Math.hypot(wx - 26, wz - 22), 15, 7);
        if (kMud > 0) {
          m = MaterialId.MUD;
          h -= 0.6 * kMud;
        }

        // --- rock outcrop: the blade must refuse this ----------------------
        const kRock = falloff(Math.hypot(wx - 20, wz + 26), 11, 5);
        if (kRock > 0) {
          m = MaterialId.ROCK;
          h += 4.5 * kRock;
        }

        // --- flat spawn pad, applied last so it always wins ----------------
        const kPad = falloff(Math.hypot(wx, wz), 10, 6);
        if (kPad > 0) {
          h = lerp(h, 0, kPad);
          if (kPad > 0.5) m = MaterialId.GRASS;
        }

        // --- perimeter berm ------------------------------------------------
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
