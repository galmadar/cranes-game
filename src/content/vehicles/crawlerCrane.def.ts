/**
 * Crawler crane — the machine the project is named after.
 *
 * Pure data, like the dozer, and it reuses the dozer's chassis wholesale: the
 * tracked locomotion spec, the track support plane, the ground conform. What is
 * new is entirely in the implement, which was the bet `Implement.ts` made in
 * M2 and is the reason this file is data rather than an engine change.
 *
 * The controls are laid out so the two hands do different jobs: WASD drives
 * the base, and the right hand works the crane. That separation is the machine
 * — a crawler crane travels and lifts as two distinct activities, and slewing
 * the house while the tracks point somewhere else is the normal case.
 */

import { Action } from '../../sim/input/actions';
import type { VehicleDefinition } from '../../sim/vehicle/types';

export const CRANE_ID = 'crane';

const CraneAction = {
  SlewLeft: 'craneSlewLeft',
  SlewRight: 'craneSlewRight',
  BoomUp: 'craneBoomUp',
  BoomDown: 'craneBoomDown',
  HookUp: 'craneHookUp',
  HookDown: 'craneHookDown',
  Hook: 'craneHook',
  TurnLeft: 'craneTurnLeft',
  TurnRight: 'craneTurnRight',
} as const;

export const crawlerCraneDef: VehicleDefinition = {
  id: 'crawlerCrane',
  displayName: 'Crawler Crane',
  family: 'crawlerCrane',
  description: 'Tracked lattice-boom crane. Lifts, slews and sets loads on the hook.',

  // Wider and longer than the dozer, and deliberately so: a crane's tracks are
  // its stability, and the footprint is what the load moment works against.
  dimensions: { length: 7.4, width: 5.2, height: 3.4 },

  // Slow, but not a punishment. A crane that handles like a dozer would make
  // sway a decoration rather than a problem; at 1.6 m/s the repositioning
  // between stances — which is the interesting decision — was mostly waiting.
  // Played back at these numbers it still reads as heavy.
  locomotion: {
    kind: 'tracked',
    maxSpeed: 2.7,
    maxReverseSpeed: 2.1,
    acceleration: 1.9,
    braking: 3.4,
    turnRate: 0.62,
  },

  implements: [
    {
      kind: 'crane',
      id: CRANE_ID,

      // Slow enough that a load has time to swing behind you, which is the
      // entire lesson. Snap the house round and the load arrives late.
      slew: {
        leftAction: CraneAction.SlewLeft,
        rightAction: CraneAction.SlewRight,
        speed: 0.32,
      },

      // Quicker than the slew: turning a load on a rope is the small, fiddly
      // correction at the end of a lift, and it should not be the slow part.
      turn: {
        leftAction: CraneAction.TurnLeft,
        rightAction: CraneAction.TurnRight,
        speed: 0.7,
      },

      // 20°..78°. Below 20 the boom is nearly out of chart and the load moment
      // is silly; above 78 the head is over the house and there is no reach.
      luff: {
        increaseAction: CraneAction.BoomUp,
        decreaseAction: CraneAction.BoomDown,
        min: 0.35,
        max: 1.36,
        rest: 1.0,
        speed: 0.2,
      },

      // The axis is rope PAID OUT, so increasing it lowers the hook. The keys
      // are named for where the load goes, which is what the operator thinks in.
      hoist: {
        increaseAction: CraneAction.HookDown,
        decreaseAction: CraneAction.HookUp,
        min: 0.5,
        max: 22,
        rest: 4,
        speed: 2.6,
      },

      hookAction: CraneAction.Hook,

      pivot: { y: 2.1, z: 1.1 },
      boomLength: 22,

      // 12 t at 6 m, falling as a constant moment: 6 t at 12 m, 3 t at 24 m.
      // The heaviest load on the lift yard is 7.2 t, so it is pickable close in
      // and refused at reach — which is the whole point of parking well.
      maxLoad: 12,
      minRadius: 6,

      hookRadius: 1.8,
      slingLength: 1.2,
    },
  ],

  keymap: {
    [Action.ThrottleForward]: ['KeyW', 'ArrowUp'],
    [Action.ThrottleReverse]: ['KeyS', 'ArrowDown'],
    [Action.SteerLeft]: ['KeyA', 'ArrowLeft'],
    [Action.SteerRight]: ['KeyD', 'ArrowRight'],
    [CraneAction.SlewLeft]: ['KeyQ'],
    [CraneAction.SlewRight]: ['KeyE'],
    [CraneAction.BoomUp]: ['KeyR'],
    [CraneAction.BoomDown]: ['KeyF'],
    [CraneAction.HookUp]: ['KeyT'],
    [CraneAction.HookDown]: ['KeyY'],
    [CraneAction.Hook]: ['Space'],
    [CraneAction.TurnLeft]: ['KeyZ'],
    [CraneAction.TurnRight]: ['KeyX'],
  },
};

/** Order and labels for the on-screen control hints (FR-4.3). */
export const CRAWLER_CRANE_CONTROL_HINTS: readonly { action: string; label: string }[] = [
  { action: Action.ThrottleForward, label: 'Track forward' },
  { action: Action.ThrottleReverse, label: 'Track back' },
  { action: Action.SteerLeft, label: 'Steer left' },
  { action: Action.SteerRight, label: 'Steer right' },
  { action: CraneAction.SlewLeft, label: 'Slew left' },
  { action: CraneAction.SlewRight, label: 'Slew right' },
  { action: CraneAction.BoomUp, label: 'Boom up — closer, stronger' },
  { action: CraneAction.BoomDown, label: 'Boom down — further, weaker' },
  { action: CraneAction.HookUp, label: 'Hoist up' },
  { action: CraneAction.HookDown, label: 'Hoist down' },
  { action: CraneAction.TurnLeft, label: 'Turn load left' },
  { action: CraneAction.TurnRight, label: 'Turn load right' },
  { action: CraneAction.Hook, label: 'Pick up / set down' },
];
