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
} as const;

export const bulldozerDef: VehicleDefinition = {
  id: 'bulldozer',
  displayName: 'Bulldozer',
  family: 'dozer',
  description: 'Tracked earthmover. Pushes soil with a hydraulic blade.',

  dimensions: { length: 5.2, width: 3.4, height: 3.0 },

  locomotion: {
    kind: 'tracked',
    maxSpeed: 4.2,
    maxReverseSpeed: 2.6,
    acceleration: 3.0,
    braking: 6.0,
    turnRate: 1.1,
  },

  implements: [
    {
      kind: 'blade',
      id: BLADE_ID,
      raiseAction: BladeAction.Raise,
      lowerAction: BladeAction.Lower,

      width: 4.0,
      height: 1.3,
      thickness: 0.5,
      reach: 2.9,

      // Negative travel is what lets the blade bite below grade in M3.
      minHeight: -0.55,
      maxHeight: 1.4,
      restHeight: 0.25,
      moveSpeed: 0.9,

      capacity: 2.4,
    },
  ],

  keymap: {
    [Action.ThrottleForward]: ['KeyW', 'ArrowUp'],
    [Action.ThrottleReverse]: ['KeyS', 'ArrowDown'],
    [Action.SteerLeft]: ['KeyA', 'ArrowLeft'],
    [Action.SteerRight]: ['KeyD', 'ArrowRight'],
    [BladeAction.Raise]: ['KeyR'],
    [BladeAction.Lower]: ['KeyF'],
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
];
