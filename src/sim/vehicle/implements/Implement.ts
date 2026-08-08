/**
 * Implement — the one abstraction the crane milestone depends on.
 *
 * An implement is the ONLY thing permitted to mutate terrain. When cranes
 * arrive in M6 they add new implements (boom, hook, outriggers); they do not
 * modify Vehicle, Terrain, or the game loop. If adding a machine ever forces a
 * change in here, the abstraction was wrong and that is worth knowing early.
 */

import type { ActionState } from '../../input/actions';
import type { Terrain } from '../../Terrain';
import type { ImplementSpec, ImplementState, VehicleDefinition, VehicleState } from '../types';

export interface ImplementContext {
  dt: number;
  input: ActionState;
  vehicle: VehicleState;
  terrain: Terrain;
  def: VehicleDefinition;
}

export interface Implement {
  readonly id: string;
  readonly spec: ImplementSpec;
  /** Fresh state object, installed into VehicleState.implementStates. */
  createState(): ImplementState;
  update(ctx: ImplementContext): void;
}
