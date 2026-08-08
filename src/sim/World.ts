/**
 * World — owns all simulation state and advances it in fixed steps.
 *
 * M3 adds the deformation + slump passes after vehicle update. Everything it
 * touches stays renderer-free so the whole thing can be stepped headlessly
 * in tests (NFR-4).
 */

import { relaxSlump } from './deform/slump';
import { EMPTY_ACTION_STATE, type ActionState } from './input/actions';
import type { Terrain } from './Terrain';
import type { Vehicle } from './vehicle/Vehicle';

/**
 * Relaxation passes per step. Two is enough to keep up with a blade at 60Hz
 * while leaving piles visibly settling for a moment after you back off, which
 * reads better than snapping instantly to the angle of repose.
 */
const SLUMP_PASSES = 2;

export class World {
  readonly terrain: Terrain;
  readonly vehicles: Vehicle[] = [];

  private activeIndex = 0;
  private elapsedSeconds = 0;
  private stepCount = 0;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
  }

  get elapsed(): number {
    return this.elapsedSeconds;
  }

  get steps(): number {
    return this.stepCount;
  }

  get activeVehicle(): Vehicle | undefined {
    return this.vehicles[this.activeIndex];
  }

  addVehicle(vehicle: Vehicle): Vehicle {
    this.vehicles.push(vehicle);
    return vehicle;
  }

  /** FR-2.6 groundwork: the shell will drive this from a selection screen. */
  setActiveVehicle(index: number): void {
    if (index >= 0 && index < this.vehicles.length) this.activeIndex = index;
  }

  /**
   * Advance one fixed timestep. `dt` is always the same value (NFR-2) — it is
   * passed rather than hard-coded so tests can step at any rate they like.
   *
   * Only the active vehicle receives input; the rest still update so they keep
   * conforming to terrain that may have moved beneath them.
   */
  step(dt: number, input: ActionState = EMPTY_ACTION_STATE): void {
    for (const vehicle of this.vehicles) {
      vehicle.update(dt, vehicle === this.activeVehicle ? input : EMPTY_ACTION_STATE, this.terrain);
    }

    // FR-3.6 — settle everything that moved, after every machine has had its
    // turn, so overlapping edits relax together instead of fighting.
    for (const vehicle of this.vehicles) {
      const region = vehicle.consumeSlumpRegion();
      if (region) relaxSlump(this.terrain, region, SLUMP_PASSES);
    }

    this.elapsedSeconds += dt;
    this.stepCount++;
  }
}
