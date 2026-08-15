/**
 * Implement — the one abstraction the crane milestone depends on.
 *
 * An implement is the ONLY thing permitted to mutate terrain. When cranes
 * arrive in M6 they add new implements (boom, hook, outriggers); they do not
 * modify Vehicle, Terrain, or the game loop. If adding a machine ever forces a
 * change in here, the abstraction was wrong and that is worth knowing early.
 */

import type { ActionState } from '../../input/actions';
import type { Payload } from '../../payload/Payload';
import type { Rect, Terrain } from '../../Terrain';
import type { ImplementSpec, ImplementState, VehicleDefinition, VehicleState } from '../types';

/**
 * Design elevation at a world point, or null where nothing specifies one.
 *
 * The implement asks rather than the job telling: grade control is a property
 * of the machine, and free roam simply answers null everywhere.
 */
export type GradeQuery = (x: number, z: number) => number | null;

export const NO_GRADE: GradeQuery = () => null;

export interface ImplementContext {
  dt: number;
  input: ActionState;
  vehicle: VehicleState;
  terrain: Terrain;
  def: VehicleDefinition;
  gradeAt: GradeQuery;

  /**
   * Loose loads in the world. Empty for anything that only moves soil.
   *
   * The one thing the crane needed that this interface did not already have,
   * and worth being blunt about: the file above claims adding a crane would not
   * force a change in here, and it did. A blade's entire world is the height
   * field under it; a crane has to find an OBJECT and take hold of it, and no
   * amount of terrain access substitutes for that. The rest of the claim held —
   * Vehicle, Terrain and the loop are untouched.
   */
  payloads: readonly Payload[];

  /**
   * Drag on the chassis, 0..1. A loaded blade slows the machine; a blade
   * buried in rock nearly stops it. The highest value from any implement wins.
   */
  addResistance(value: number): void;

  /**
   * Ask for angle-of-repose relaxation over a region of terrain this
   * implement just disturbed. The World runs it once after every vehicle has
   * updated, so overlapping edits settle together rather than fighting.
   */
  requestSlump(rect: Rect): void;
}

export interface Implement {
  readonly id: string;
  readonly spec: ImplementSpec;
  /** Fresh state object, installed into VehicleState.implementStates. */
  createState(): ImplementState;
  update(ctx: ImplementContext): void;
}
