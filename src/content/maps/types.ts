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

  /** The loads standing on the site, and the pads they belong on. */
  populate?(): { payloads: readonly PayloadInit[]; liftTargets: readonly LiftTarget[] };

  /** Objective text for a lift contract. Ignored where `populate` is absent. */
  readonly liftBrief?: { title: string; brief: string; parSeconds: number };
}
