/**
 * World — owns all simulation state and advances it in fixed steps.
 *
 * Stays deliberately thin. M2 adds a vehicle list and locomotion here;
 * M3 adds the deformation + slump passes. Everything it touches must remain
 * renderer-free so the whole thing can be stepped headlessly in tests (NFR-4).
 */

import type { Terrain } from './Terrain';

export class World {
  readonly terrain: Terrain;

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

  /**
   * Advance one fixed timestep. `dt` is always the same value (NFR-2) — it is
   * passed rather than hard-coded so tests can step at any rate they like.
   */
  step(dt: number): void {
    // M2: vehicle input -> locomotion -> terrain conform
    // M3: implement.update() -> deformation -> slump relaxation
    this.elapsedSeconds += dt;
    this.stepCount++;
  }
}
