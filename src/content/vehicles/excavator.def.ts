/**
 * Tracked excavator — the third machine, and the one the registry was a bet on.
 *
 * PLAN.md called for exactly this as the test of FR-5.1: adding a machine
 * should be two content files and one registry line, with nothing in `sim/` or
 * `render/` changing. Held, apart from the implement itself and its factory
 * case, which is the part that is genuinely new behaviour rather than plumbing.
 *
 * Controls follow the crane's shape so the second machine you learn is cheaper
 * than the first: WASD tracks, Q/E slews, and the right hand works the arm. The
 * one that has to be learnt is the curl — Z holds the load in, X tips it out,
 * and that is the difference between carrying a bucket and dribbling it across
 * the site.
 */

import { Action } from '../../sim/input/actions';
import type { VehicleDefinition } from '../../sim/vehicle/types';

export const ARM_ID = 'arm';

const ArmAction = {
  SlewLeft: 'armSlewLeft',
  SlewRight: 'armSlewRight',
  BoomUp: 'armBoomUp',
  BoomDown: 'armBoomDown',
  StickIn: 'armStickIn',
  StickOut: 'armStickOut',
  CurlIn: 'armCurlIn',
  CurlOut: 'armCurlOut',
} as const;

export const excavatorDef: VehicleDefinition = {
  id: 'excavator',
  displayName: 'Excavator',
  family: 'excavator',
  description: 'Tracked digger. Cuts with a bucket and swings the spoil clear.',

  dimensions: { length: 4.6, width: 3.2, height: 3.0 },

  // Excavators barely travel — they dig from a stance, swing, and shuffle
  // along. Fast enough not to be a chore between cuts, slow enough that you
  // plan where to stand.
  locomotion: {
    kind: 'tracked',
    maxSpeed: 2.4,
    maxReverseSpeed: 2.0,
    acceleration: 2.0,
    braking: 3.6,
    turnRate: 0.7,
  },

  implements: [
    {
      kind: 'excavator',
      id: ARM_ID,

      slew: {
        leftAction: ArmAction.SlewLeft,
        rightAction: ArmAction.SlewRight,
        speed: 0.75,
      },

      // Boom above horizontal. It goes BELOW zero, which is the whole point:
      // an excavator's reach is mostly downward, and a boom that stops at
      // horizontal can only ever scrape.
      //
      // Slow. Every one of these three was roughly twice this and the machine
      // was unusable: a tap of the boom moved the teeth most of a metre, so
      // there was no such thing as taking a careful 200 mm off the floor of a
      // trench that only wants 1.25 m in total.
      boom: {
        increaseAction: ArmAction.BoomUp,
        decreaseAction: ArmAction.BoomDown,
        min: -0.32,
        max: 0.95,
        rest: 0.5,
        speed: 0.3,
      },

      // How far the stick is closed on the boom. Larger tucks it under the
      // machine; this is the joint you drag a cut with.
      stick: {
        increaseAction: ArmAction.StickIn,
        decreaseAction: ArmAction.StickOut,
        min: 0.45,
        max: 2.3,
        rest: 1.55,
        speed: 0.45,
      },

      // Curl. High holds the load; below `dumpCurl` the bucket is open.
      curl: {
        increaseAction: ArmAction.CurlIn,
        decreaseAction: ArmAction.CurlOut,
        min: -0.7,
        max: 1.5,
        rest: 0.9,
        speed: 0.95,
      },

      pivot: { y: 1.9, z: 1.0 },
      boomLength: 4.6,
      stickLength: 2.8,
      bucketLength: 1.1,
      bucketWidth: 1.4,

      capacity: 2.0,
      // m³ per METRE dragged, not per second. Two metres of pass fills it.
      digRate: 1.0,
      dumpRate: 3.0,
      dumpCurl: -0.15,
    },
  ],

  keymap: {
    [Action.ThrottleForward]: ['KeyW', 'ArrowUp'],
    [Action.ThrottleReverse]: ['KeyS', 'ArrowDown'],
    [Action.SteerLeft]: ['KeyA', 'ArrowLeft'],
    [Action.SteerRight]: ['KeyD', 'ArrowRight'],
    [ArmAction.SlewLeft]: ['KeyQ'],
    [ArmAction.SlewRight]: ['KeyE'],
    [ArmAction.BoomUp]: ['KeyR'],
    [ArmAction.BoomDown]: ['KeyF'],
    [ArmAction.StickIn]: ['KeyT'],
    [ArmAction.StickOut]: ['KeyY'],
    // Z and X, matching the crane's tag line: on both machines these two turn
    // whatever is on the end of the arm. C and V would have been the obvious
    // pick and are already the shell's camera keys.
    [ArmAction.CurlIn]: ['KeyZ'],
    [ArmAction.CurlOut]: ['KeyX'],
  },
};

/** Order and labels for the on-screen control hints (FR-4.3). */
export const EXCAVATOR_CONTROL_HINTS: readonly { action: string; label: string }[] = [
  { action: Action.ThrottleForward, label: 'Track forward' },
  { action: Action.ThrottleReverse, label: 'Track back' },
  { action: Action.SteerLeft, label: 'Steer left' },
  { action: Action.SteerRight, label: 'Steer right' },
  { action: ArmAction.SlewLeft, label: 'Slew left' },
  { action: ArmAction.SlewRight, label: 'Slew right' },
  { action: ArmAction.BoomUp, label: 'Boom up' },
  { action: ArmAction.BoomDown, label: 'Boom down — reach into the cut' },
  { action: ArmAction.StickIn, label: 'Stick in — drag the cut' },
  { action: ArmAction.StickOut, label: 'Stick out — reach further' },
  { action: ArmAction.CurlIn, label: 'Curl in — hold the load' },
  { action: ArmAction.CurlOut, label: 'Curl out — tip it out' },
];
