/**
 * Bulldozer — the MVP machine.
 *
 * Pure data. No three.js here: the mesh lives in `bulldozer.view.ts` so this
 * definition stays headlessly testable and the renderer stays swappable.
 *
 * Note the keymap is declared per-vehicle (FR-4.1). A crawler crane will
 * declare a completely different one, and nothing in the engine cares.
 */

import { Action } from '../../sim/input/actions';
import type { VehicleDefinition } from '../../sim/vehicle/types';

export const BLADE_ID = 'blade';

const BladeAction = {
  Raise: 'bladeRaise',
  Lower: 'bladeLower',
  GradeHold: 'bladeGradeHold',
  PitchBack: 'bladePitchBack',
  PitchForward: 'bladePitchForward',
} as const;

export const bulldozerDef: VehicleDefinition = {
  id: 'bulldozer',
  displayName: 'Bulldozer',
  family: 'dozer',
  description: 'Tracked earthmover. Pushes soil with a hydraulic blade.',

  dimensions: { length: 5.2, width: 3.4, height: 3.0 },

  // Uprated from the M3 values: the machine bogged to a crawl under a full
  // blade, which was realistic and not much fun. All of these are live-editable
  // from the settings panel (Esc).
  locomotion: {
    kind: 'tracked',
    maxSpeed: 5.4,
    maxReverseSpeed: 3.4,
    acceleration: 4.2,
    braking: 7.5,
    turnRate: 1.35,
  },

  implements: [
    {
      kind: 'blade',
      id: BLADE_ID,
      raiseAction: BladeAction.Raise,
      lowerAction: BladeAction.Lower,
      gradeHoldAction: BladeAction.GradeHold,

      width: 4.0,
      height: 1.3,
      thickness: 0.5,
      reach: 2.9,

      // Negative travel is what lets the blade bite below grade in M3.
      minHeight: -0.55,
      maxHeight: 1.4,
      restHeight: 0.25,
      moveSpeed: 1.15,

      capacity: 3.4,

      // About ±11°, which is roughly the adjustment range of a real dozer's
      // pitch rams. Wide enough to feel, narrow enough that neutral stays the
      // sane default rather than a trap.
      pitch: {
        backAction: BladeAction.PitchBack,
        forwardAction: BladeAction.PitchForward,
        min: -0.2,
        max: 0.2,
        rest: 0,
        speed: 0.35,
        // The edge hangs this far ahead of the trunnion, which is what turns
        // a pitch change into a change in cutting depth.
        edgeAhead: 0.42,
      },
    },
  ],

  keymap: {
    [Action.ThrottleForward]: ['KeyW', 'ArrowUp'],
    [Action.ThrottleReverse]: ['KeyS', 'ArrowDown'],
    [Action.SteerLeft]: ['KeyA', 'ArrowLeft'],
    [Action.SteerRight]: ['KeyD', 'ArrowRight'],
    [BladeAction.Raise]: ['KeyR'],
    [BladeAction.Lower]: ['KeyF'],
    [BladeAction.GradeHold]: ['KeyH'],
    [BladeAction.PitchBack]: ['KeyT'],
    [BladeAction.PitchForward]: ['KeyY'],
  },
};

/** Order and labels for the on-screen control hints (FR-4.3). */
export const BULLDOZER_CONTROL_HINTS: readonly { action: string; label: string }[] = [
  { action: Action.ThrottleForward, label: 'Forward' },
  { action: Action.ThrottleReverse, label: 'Reverse' },
  { action: Action.SteerLeft, label: 'Turn left' },
  { action: Action.SteerRight, label: 'Turn right' },
  { action: BladeAction.Raise, label: 'Blade up' },
  { action: BladeAction.Lower, label: 'Blade down' },
  { action: BladeAction.GradeHold, label: 'Hold grade (auto)' },
  { action: BladeAction.PitchBack, label: 'Pitch back — carry more' },
  { action: BladeAction.PitchForward, label: 'Pitch forward — bite harder' },
];
