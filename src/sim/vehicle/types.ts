/**
 * Vehicle entity types.
 *
 * Locked decision from PLAN.md: the core entity is `Vehicle`, not `Crane`.
 * A bulldozer pushes, a crane lifts; both are vehicles carrying *implements*.
 * The implement abstraction is what makes a blade and a boom siblings rather
 * than special cases, and it is the thing that has to be right now — not when
 * there are six machines.
 */

import type { ActionId, KeyMap } from '../input/actions';
import type { Vec3 } from '../math/Vec';

export type VehicleFamily =
  | 'dozer'
  | 'excavator'
  | 'mobileCrane'
  | 'crawlerCrane'
  | 'towerCrane';

// ------------------------------------------------------------------ chassis

export interface TrackedLocomotionSpec {
  kind: 'tracked';
  /** m/s */
  maxSpeed: number;
  maxReverseSpeed: number;
  /** m/s² */
  acceleration: number;
  braking: number;
  /** rad/s — tracked machines pivot on the spot, so this applies at rest too. */
  turnRate: number;
}

/** M6 adds `wheeled` (steered, no pivot turn) and `static` (tower cranes). */
export type LocomotionSpec = TrackedLocomotionSpec;

// --------------------------------------------------------------- implements

export interface BladeSpec {
  kind: 'blade';
  id: string;
  /** Actions this implement listens for — declared, not hard-coded. */
  raiseAction: ActionId;
  lowerAction: ActionId;

  /** Cutting-edge width, metres. */
  width: number;
  /** Fore-aft thickness of the cut, metres. */
  thickness: number;
  /** Distance forward of the vehicle origin. */
  reach: number;

  /** Blade travel relative to the vehicle's ground line. Negative = digs in. */
  minHeight: number;
  maxHeight: number;
  restHeight: number;
  /** m/s */
  moveSpeed: number;

  /** m³ the blade can carry before soil spills. Unused until M3. */
  capacity: number;
}

export type ImplementSpec = BladeSpec;

export interface BladeState {
  kind: 'blade';
  /** Current height relative to the vehicle's ground line. */
  height: number;
  /** m³ of soil riding on the blade. Stays 0 until M3. */
  carriedVolume: number;
}

export type ImplementState = BladeState;

// ----------------------------------------------------------------- vehicle

export interface VehicleDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly family: VehicleFamily;
  readonly description: string;

  /** Metres. Used by the view and, later, by collision. */
  readonly dimensions: { length: number; width: number; height: number };

  readonly locomotion: LocomotionSpec;
  readonly implements: readonly ImplementSpec[];
  readonly keymap: KeyMap;
}

export interface VehicleState {
  readonly defId: string;
  position: Vec3;
  /** Yaw in radians. 0 faces +Z; increasing turns left. */
  heading: number;
  /** Derived from the terrain normal each step (FR-2.3). */
  pitch: number;
  roll: number;
  /** Signed ground speed, m/s. */
  speed: number;
  implementStates: Record<string, ImplementState>;
}
