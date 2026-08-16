/**
 * World — owns all simulation state and advances it in fixed steps.
 *
 * M3 adds the deformation + slump passes after vehicle update. Everything it
 * touches stays renderer-free so the whole thing can be stepped headlessly
 * in tests (NFR-4).
 */

import { relaxSlump } from './deform/slump';
import { EMPTY_ACTION_STATE, type ActionState } from './input/actions';
import type { JobRunner } from './job/JobRunner';
import { targetAtWorld } from './job/JobSite';
import type { LiftRunner } from './payload/LiftJob';
import type { Payload } from './payload/Payload';
import type { Rect, Terrain } from './Terrain';
import { TUNING } from './tuning';
import type { Vehicle } from './vehicle/Vehicle';

/**
 * Ground is settled a tile at a time, in cells.
 *
 * Small enough that a tile which has come to rest drops out of the work set
 * quickly, large enough that the per-tile overhead is not the cost.
 */
const SETTLE_TILE = 16;
/** Tiles worked per step. The whole budget for keeping the world honest. */
const SETTLE_TILES_PER_STEP = 10;
/** Tiles are relaxed one cell wide of themselves, so soil can cross a seam. */
const SETTLE_OVERLAP = 1;

export class World {
  readonly terrain: Terrain;
  readonly vehicles: Vehicle[] = [];

  /**
   * Loose loads. The world's second kind of thing.
   *
   * Everything before this was a height field, and a height field has no
   * identity: soil that moves is soil somewhere else. A load is the same load
   * wherever it ends up, which is what makes "put THAT there" a goal the game
   * can set and score.
   */
  readonly payloads: Payload[] = [];

  /**
   * Ground that has been disturbed and has not yet reached its repose angle.
   *
   * Relaxation used to run only where a machine was standing, so a cut face
   * stopped collapsing the moment you drove away from it and froze at whatever
   * angle it happened to be left at: measured, 358 neighbouring pairs standing
   * up to 0.93 m steeper than sand can hold, still there ten seconds later.
   * Soil does not know whether anyone is watching. Disturbed tiles stay in
   * this set until they report themselves at rest.
   */
  private readonly settling = new Set<number>();

  /** The active grading contract, if any. Null means free roam. */
  job: JobRunner | null = null;
  /** The active lift contract, if any. A map has one or the other, not both. */
  lift: LiftRunner | null = null;

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

  /** Loads arrive standing on the ground, wherever the map said to put them. */
  addPayload(payload: Payload): Payload {
    payload.settleOnGround(this.terrain);
    this.payloads.push(payload);
    return payload;
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
    let dropped = 0;
    for (const vehicle of this.vehicles) {
      vehicle.update(
        dt,
        vehicle === this.activeVehicle ? input : EMPTY_ACTION_STATE,
        this.terrain,
        this.gradeAt,
        this.payloads,
      );
      dropped += vehicle.consumeDroppedLoads();
    }

    // After the machines, so a load released this step starts falling from
    // where the hook actually left it rather than from a step-old position.
    for (const payload of this.payloads) payload.step(dt, this.terrain);

    // FR-3.6 — settle everything that moved, after every machine has had its
    // turn, so overlapping edits relax together instead of fighting.
    for (const vehicle of this.vehicles) {
      const region = vehicle.consumeSlumpRegion();
      if (region) {
        relaxSlump(this.terrain, region, TUNING.slumpPasses);
        this.markSettling(region);
      }
    }
    this.stepSettling();

    // Score after settling, so the job is measured against ground that has
    // finished moving rather than mid-collapse.
    if (this.job) this.job.step(dt, this.terrain, this.cutVolumeThisStep(dt));
    if (this.lift) this.lift.step(dt, this.payloads, dropped);

    this.elapsedSeconds += dt;
    this.stepCount++;
  }

  /** How many tiles are still moving. Zero means the ground has stopped. */
  get settlingTiles(): number {
    return this.settling.size;
  }

  /**
   * Soil currently held in buckets, m³.
   *
   * FR-3.5 used to be checkable against the height field alone, because nothing
   * could hold soil — a blade's load is measured off the terrain it is pushing,
   * so it was never missing from the world. An excavator genuinely removes
   * soil and carries it, so the invariant is now `terrain.totalVolume() + this`.
   */
  get carriedVolume(): number {
    let total = 0;
    for (const vehicle of this.vehicles) {
      for (const state of Object.values(vehicle.state.implementStates)) {
        if (state.kind === 'excavator') total += state.carried;
      }
    }
    return total;
  }

  private get tilesX(): number {
    return Math.ceil(this.terrain.width / SETTLE_TILE);
  }

  private markSettling(rect: Rect): void {
    const tx0 = Math.max(0, Math.floor(rect.x0 / SETTLE_TILE));
    const tz0 = Math.max(0, Math.floor(rect.z0 / SETTLE_TILE));
    const tx1 = Math.min(this.tilesX - 1, Math.floor(rect.x1 / SETTLE_TILE));
    const tz1 = Math.min(
      Math.ceil(this.terrain.depth / SETTLE_TILE) - 1,
      Math.floor(rect.z1 / SETTLE_TILE),
    );
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) this.settling.add(tz * this.tilesX + tx);
    }
  }

  /**
   * Work through the backlog of unsettled ground, oldest first.
   *
   * Round-robin rather than draining: a tile that is still moving goes to the
   * BACK of the set, so one stubborn face cannot starve the rest of the site.
   */
  private stepSettling(): void {
    if (this.settling.size === 0) return;

    const due: number[] = [];
    for (const key of this.settling) {
      due.push(key);
      if (due.length >= SETTLE_TILES_PER_STEP) break;
    }

    for (const key of due) {
      this.settling.delete(key);
      const tx = key % this.tilesX;
      const tz = (key - tx) / this.tilesX;
      const result = relaxSlump(
        this.terrain,
        {
          x0: tx * SETTLE_TILE - SETTLE_OVERLAP,
          z0: tz * SETTLE_TILE - SETTLE_OVERLAP,
          x1: (tx + 1) * SETTLE_TILE - 1 + SETTLE_OVERLAP,
          z1: (tz + 1) * SETTLE_TILE - 1 + SETTLE_OVERLAP,
        },
        TUNING.slumpPasses,
      );
      if (!result.settled) this.settling.add(key);
    }
  }

  /** Design elevation for grade control. Free roam has none, hence null. */
  private readonly gradeAt = (x: number, z: number): number | null =>
    this.job ? targetAtWorld(this.terrain, this.job.site, x, z) : null;

  /** Soil cut by every implement on every machine during this step, m³. */
  private cutVolumeThisStep(dt: number): number {
    let total = 0;
    for (const vehicle of this.vehicles) {
      for (const state of Object.values(vehicle.state.implementStates)) {
        if (state.kind === 'blade') total += state.cutRate * dt;
      }
    }
    return total;
  }
}
