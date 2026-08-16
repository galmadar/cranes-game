import type { JobSite } from '../../sim/job/JobSite';
import type { LiftTarget } from '../../sim/payload/LiftJob';
import type { PayloadInit } from '../../sim/payload/Payload';
import type { Vec3 } from '../../sim/math/Vec';
import type { Terrain } from '../../sim/Terrain';

/**
 * A map is data, not code (FR-5.4 direction of travel). Adding a map means
 * adding one file and one registry line — never an engine change.
 */
export interface MapDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;

  /** Grid resolution in cells. */
  readonly width: number;
  readonly depth: number;
  /** World units per cell. */
  readonly cellSize: number;

  readonly spawn: { position: Vec3; heading: number };

  /**
   * Which machine this site is for.
   *
   * A site and a machine are a pair: the lift yard is a flat hardstand with
   * nothing to dig, and the sandbox has no loads to pick up. Pairing them here
   * means choosing a map is the whole choice, rather than a choice plus a
   * second one the player has no way to get right.
   */
  readonly defaultVehicleId?: string;

  /** Deterministic: the same map must generate identically every run. */
  generate(): { height: Float32Array; material: Uint8Array };

  /** The grading contract this site sets, if it sets one. */
  createJob?(terrain: Terrain): JobSite;

  /**
   * Lift contracts this site offers, in the order they should be attempted.
   *
   * A list rather than one job, because a yard is a place and a contract is a
   * piece of work done in it — the loads and the pads move, the hardstand does
   * not. Same reasoning as the vehicle registry: adding one is an entry here.
   */
  readonly liftContracts?: readonly LiftContract[];
}

/** One lift job: what is on the ground, where it has to end up, and by when. */
export interface LiftContract {
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly parSeconds: number;
  readonly payloads: readonly PayloadInit[];
  readonly targets: readonly LiftTarget[];
}
