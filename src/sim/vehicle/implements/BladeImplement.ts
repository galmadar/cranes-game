/**
 * BladeImplement.
 *
 * M2 scope: the blade MOVES. It does not cut yet.
 *
 * FR-2.4 calls blade articulation non-negotiable, and it is: a fixed blade can
 * never choose between driving over terrain and cutting into it, so there is
 * no way to author the M3 dig loop without it. M3 adds scrape -> carry ->
 * deposit inside this same `update`; nothing outside this file changes.
 */

import { actionValue } from '../../input/actions';
import { clamp } from '../../math/Vec';
import type { BladeSpec, BladeState } from '../types';
import type { Implement, ImplementContext } from './Implement';

export class BladeImplement implements Implement {
  readonly id: string;
  readonly spec: BladeSpec;

  constructor(spec: BladeSpec) {
    this.id = spec.id;
    this.spec = spec;
  }

  createState(): BladeState {
    return {
      kind: 'blade',
      height: clamp(this.spec.restHeight, this.spec.minHeight, this.spec.maxHeight),
      carriedVolume: 0,
    };
  }

  update(ctx: ImplementContext): void {
    const state = ctx.vehicle.implementStates[this.id];
    if (!state || state.kind !== 'blade') return;

    const raise = actionValue(ctx.input, this.spec.raiseAction);
    const lower = actionValue(ctx.input, this.spec.lowerAction);
    const drive = raise - lower;
    if (drive === 0) return;

    state.height = clamp(
      state.height + drive * this.spec.moveSpeed * ctx.dt,
      this.spec.minHeight,
      this.spec.maxHeight,
    );

    // M3: rasterise the blade's swept volume, cut diggable cells down to the
    // cutting edge, accumulate into `carriedVolume`, spill the overflow ahead,
    // then run slump relaxation over the dirty region.
  }

  /** World-space Y of the cutting edge. M3 rasterises against this. */
  cuttingEdgeY(groundY: number, state: BladeState): number {
    return groundY + state.height;
  }
}
