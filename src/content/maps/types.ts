import type { Vec3 } from '../../sim/math/Vec';

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

  /** Deterministic: the same map must generate identically every run. */
  generate(): { height: Float32Array; material: Uint8Array };
}
