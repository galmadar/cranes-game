/**
 * Lift Yard — the crane's site.
 *
 * Built on the opposite principle to the Sandbox Yard. That map is all
 * material variety, because a dozer's whole subject is what the ground is made
 * of. A crane does not care: it stands on the hardstand and works in the air.
 * So the yard is flat, non-diggable rock across the whole working area, and
 * everything interesting is the layout — where the loads are, where they have
 * to go, and what is in the way.
 *
 * The pads are placed so the capacity chart does the teaching. Every load can
 * be picked up, but only the light ones can be picked up from where you are
 * already parked. The 7.2 t crate needs the crane inside ten metres, which
 * means driving to it and thinking about where you stop — and that is the
 * lesson a crane has that a dozer does not.
 */

import { MaterialId } from '../../sim/materials';
import { fbm, makeValueNoise2D } from '../../sim/math/noise';
import { lerp, smoothstep, vec3 } from '../../sim/math/Vec';
import type { LiftTarget } from '../../sim/payload/LiftJob';
import type { PayloadInit } from '../../sim/payload/Payload';
import type { LiftContract, MapDefinition } from './types';

const WIDTH = 256;
const DEPTH = 256;
const CELL = 0.5; // -> 127.5m x 127.5m yard
const SEED = 4821;

/**
 * Half-extents of the flat hardstand, metres, and how far its edge feathers.
 *
 * Sized so the slab is DEAD flat well past anywhere the crane will stand, not
 * merely flat in the middle. The feathered edge is a ramp, and a crane parked
 * on a ramp is a crane whose boom head is not where the simulation says.
 */
const PAD_X = 34;
const PAD_Z = 30;
const PAD_FEATHER = 4;

const deg = (d: number): number => (d * Math.PI) / 180;

/** 1 inside `radius - feather`, smoothly 0 at `radius`. */
function falloff(distance: number, radius: number, feather: number): number {
  if (distance >= radius) return 0;
  if (distance <= radius - feather) return 1;
  return smoothstep((radius - distance) / feather);
}

/** Chebyshev falloff — square-edged, which is what a poured slab looks like. */
function squareFalloff(dx: number, dz: number, halfX: number, halfZ: number, feather: number) {
  const d = Math.max(Math.abs(dx) - halfX, Math.abs(dz) - halfZ);
  if (d >= 0) return 0;
  return smoothstep(-d / feather);
}

/**
 * The loads, racked side by side on the laydown along the west side.
 *
 * Spaced ACROSS the rack, not along it. Laid out down one line they were five
 * metres apart and nine metres long, so the two beams overlapped by four
 * metres and the pipe grew out of the second one — on screen it read as one
 * beam with two lifting lugs. Nothing in the simulation objects to it, because
 * loads do not collide with each other; the map is the only thing that can
 * stop it.
 *
 * Masses are chosen against the crane's chart (12 t at 6 m, constant moment):
 * the beams come up at sixteen metres, the pipe needs twelve, and the crate
 * needs ten. Read down this list and you are reading the order to do the job in.
 */
const PAYLOADS: readonly PayloadInit[] = [
  {
    id: 'beam-a',
    kind: 'beam',
    displayName: 'Steel beam',
    size: { x: 0.7, y: 0.8, z: 9 },
    mass: 4,
    x: -22,
    z: -10,
    yaw: 0,
  },
  {
    id: 'beam-b',
    kind: 'beam',
    displayName: 'Steel beam',
    size: { x: 0.7, y: 0.8, z: 9 },
    mass: 4,
    x: -18,
    z: -10,
    yaw: 0,
  },
  {
    id: 'pipe-a',
    kind: 'pipe',
    displayName: 'Culvert pipe',
    size: { x: 1.5, y: 1.5, z: 7 },
    mass: 6,
    x: -13.5,
    z: -10,
    yaw: 0,
  },
  {
    id: 'crate-a',
    kind: 'crate',
    displayName: 'Switchgear crate',
    size: { x: 2.6, y: 2.4, z: 2.6 },
    mass: 7.2,
    x: -17,
    z: 4,
    yaw: 0,
  },
];

/**
 * The pads, along the east side.
 *
 * The beams land ACROSS their pads rather than along them, which is the only
 * reason slew is a skill: get the position right and the bearing wrong and the
 * pad stays open. A crate is square, so its bearing is nearly free — the
 * tolerance says so rather than the scoring code special-casing it.
 */
const TARGETS: readonly LiftTarget[] = [
  {
    id: 'pad-beam-a',
    label: 'Beam, north bearer',
    x: 15,
    z: -13,
    radius: 1.6,
    yaw: deg(90),
    yawTolerance: deg(12),
    accepts: 'beam',
  },
  {
    id: 'pad-beam-b',
    label: 'Beam, south bearer',
    x: 15,
    z: -8,
    radius: 1.6,
    yaw: deg(90),
    yawTolerance: deg(12),
    accepts: 'beam',
  },
  {
    id: 'pad-pipe',
    label: 'Culvert trench',
    x: 16,
    z: -1,
    radius: 1.5,
    yaw: 0,
    yawTolerance: deg(10),
    accepts: 'pipe',
  },
  {
    id: 'pad-crate',
    label: 'Switchgear base',
    x: 13,
    z: 6,
    radius: 1.4,
    yaw: 0,
    yawTolerance: deg(45),
    accepts: 'crate',
  },
];

/**
 * Second contract — the chart stops being advice and starts being a wall.
 *
 * The first job teaches the controls: four loads, none heavier than 7.2 t, all
 * liftable somewhere sensible. This one is about the one number a crane
 * operator actually plans around. The transformer is 10.5 t, so it comes off
 * the ground only inside 6.9 m — barely past the machine's own tail — and it
 * has to travel the length of the yard on the hook. There is no stance that
 * lifts it and no stance that sets it down; you carry it.
 *
 * Everything runs east to west, opposite to the first job, so the yard reads
 * differently rather than reading as the same contract with new numbers. The
 * stack sits square in the middle of that line.
 */
const SECOND_PAYLOADS: readonly PayloadInit[] = [
  {
    id: 'transformer',
    kind: 'crate',
    displayName: 'Transformer',
    size: { x: 2.8, y: 2.6, z: 3.2 },
    mass: 10.5,
    x: 17,
    z: -6,
    yaw: 0,
  },
  {
    id: 'pipe-b',
    kind: 'pipe',
    displayName: 'Culvert pipe',
    size: { x: 1.5, y: 1.5, z: 7 },
    mass: 6,
    x: 17,
    z: 2,
    yaw: 0,
  },
  {
    id: 'pipe-c',
    kind: 'pipe',
    displayName: 'Culvert pipe',
    size: { x: 1.5, y: 1.5, z: 7 },
    mass: 6,
    x: 17,
    z: 7,
    yaw: 0,
  },
];

const SECOND_TARGETS: readonly LiftTarget[] = [
  {
    id: 'pad-transformer',
    label: 'Transformer plinth',
    x: -18,
    z: -6,
    radius: 1.2,
    yaw: 0,
    yawTolerance: deg(20),
    accepts: 'crate',
  },
  // Tighter than the first job's culvert, and laid across the run rather than
  // along it: the tag line is the only control that can finish these.
  {
    id: 'pad-pipe-north',
    label: 'Culvert run, north',
    x: -17,
    z: 2,
    radius: 1.3,
    yaw: deg(90),
    yawTolerance: deg(8),
    accepts: 'pipe',
  },
  {
    id: 'pad-pipe-south',
    label: 'Culvert run, south',
    x: -17,
    z: 7,
    radius: 1.3,
    yaw: deg(90),
    yawTolerance: deg(8),
    accepts: 'pipe',
  },
];

const CONTRACTS: readonly LiftContract[] = [
  {
    id: 'foundations',
    title: 'Set the foundations',
    brief:
      'Hook (Space) under a load, hoist (T), slew (Q/E) and set it on its pad. ' +
      'Watch the load chart — boom up (R) to lift more.',
    parSeconds: 420,
    payloads: PAYLOADS,
    targets: TARGETS,
  },
  {
    id: 'transformer',
    title: 'Land the transformer',
    brief:
      'The transformer is 10.5 t — it only comes up inside 7 m, and it will not ' +
      'go down again anywhere else. Pick it up, then drive it across with the ' +
      'load on the hook. Pipes lie ACROSS their run: turn them with Z and X.',
    parSeconds: 480,
    payloads: SECOND_PAYLOADS,
    targets: SECOND_TARGETS,
  },
];

export const liftYardMap: MapDefinition = {
  id: 'liftYard',
  displayName: 'Lift Yard',
  description: 'Flat hardstand with a laydown, four foundation pads and a stack in the way.',

  width: WIDTH,
  depth: DEPTH,
  cellSize: CELL,

  // Parked at the south end facing the yard, with the whole job in front. Far
  // enough out that the first thing you do is drive somewhere and decide where
  // to stop, which is the crane's opening move.
  spawn: { position: vec3(0, 0, -22), heading: 0 },
  defaultVehicleId: 'crawlerCrane',

  liftContracts: CONTRACTS,

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

        // --- base: scrubby ground outside the yard -------------------------
        let h =
          fbm(noise, wx * 0.02, wz * 0.02, 4) * 1.9 +
          fbm(noise, wx * 0.07 - 30, wz * 0.07 + 12, 2) * 0.3;
        let m: MaterialId = MaterialId.GRASS;

        // --- soft ground: the corner you do not want to stand a crane on ---
        const kMud = falloff(Math.hypot(wx + 34, wz - 26), 13, 6);
        if (kMud > 0) {
          m = MaterialId.MUD;
          h -= 0.8 * kMud;
        }

        // --- spoil heap, purely so the yard has a horizon ------------------
        const kSpoil = falloff(Math.hypot(wx - 40, wz + 34), 14, 10);
        if (kSpoil > 0) {
          m = MaterialId.SAND;
          h += 5.5 * kSpoil;
        }

        // --- the hardstand -------------------------------------------------
        // Applied over everything: dead flat, dead level, and not diggable.
        // A crane's boom geometry assumes the machine is standing level, and
        // this is the map keeping that promise rather than the sim pretending.
        const kSlab = squareFalloff(wx, wz, PAD_X, PAD_Z, PAD_FEATHER);
        if (kSlab > 0) {
          h = lerp(h, 0, kSlab);
          if (kSlab > 0.6) m = MaterialId.ROCK;
        }

        // --- the stack: what you have to boom over or drive around ---------
        // Sits between the laydown and the pads, on the line you would take if
        // you were not thinking about it.
        const kStack = squareFalloff(wx - 1, wz + 8, 3.2, 2.4, 1.2);
        if (kStack > 0) {
          m = MaterialId.ROCK;
          h += 3.6 * kStack;
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
