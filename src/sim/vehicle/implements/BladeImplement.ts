/**
 * BladeImplement — articulation plus the dig loop.
 *
 * FR-2.4 calls blade articulation non-negotiable, and it is: a fixed blade
 * could never choose between driving over terrain and cutting into it, so
 * there would be no dig loop to author at all.
 *
 * The deformation itself lives in `sim/deform/blade.ts` so it can be tested
 * without constructing a vehicle. This file owns the binding: where the
 * cutting edge is, and what the resulting load does to the machine.
 */

import { actionValue } from '../../input/actions';
import { applyBladeCut } from '../../deform/blade';
import { clamp } from '../../math/Vec';
import type { BladeSpec, BladeState } from '../types';
import type { Implement, ImplementContext } from './Implement';

/**
 * Cells beyond the edited region that slumping is allowed to reach into.
 *
 * This has to cover the whole prow, not just the cells the blade touched.
 * A strong machine heaps soil several metres ahead of the cutting edge, and
 * anything outside this margin never relaxes — it freezes at whatever angle it
 * happened to be pushed to, which on sand looks like a cliff.
 */
const SLUMP_MARGIN = 8;

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
      cutRate: 0,
      blocked: false,
    };
  }

  update(ctx: ImplementContext): void {
    const state = ctx.vehicle.implementStates[this.id];
    if (!state || state.kind !== 'blade') return;

    // --- articulation --------------------------------------------------------
    const drive =
      actionValue(ctx.input, this.spec.raiseAction) - actionValue(ctx.input, this.spec.lowerAction);
    if (drive !== 0) {
      state.height = clamp(
        state.height + drive * this.spec.moveSpeed * ctx.dt,
        this.spec.minHeight,
        this.spec.maxHeight,
      );
    }

    // --- dig -----------------------------------------------------------------
    const pos = ctx.vehicle.position;
    const fx = Math.sin(ctx.vehicle.heading);
    const fz = Math.cos(ctx.vehicle.heading);

    // The cutting edge is measured from the MACHINE's ground line, not from
    // the terrain under the blade. That is what lets the blade bite into
    // ground that rises ahead of the tracks instead of skating over it.
    //
    // Chassis pitch is deliberately ignored for now: on a slope a real blade
    // tips with the machine. Folding that in is an M4 feel question, and it
    // would only muddy the cut model before the loop is tuned.
    const result = applyBladeCut({
      terrain: ctx.terrain,
      centerX: pos.x + fx * this.spec.reach,
      centerZ: pos.z + fz * this.spec.reach,
      heading: ctx.vehicle.heading,
      width: this.spec.width,
      bladeHeight: this.spec.height,
      thickness: this.spec.thickness,
      edgeY: pos.y + state.height,
      capacity: this.spec.capacity,
    });

    state.carriedVolume = result.prowVolume;
    state.cutRate = ctx.dt > 0 ? result.volumeCut / ctx.dt : 0;
    state.blocked = result.blocked;

    if (result.resistance > 0) ctx.addResistance(result.resistance);

    if (result.region) {
      ctx.requestSlump({
        x0: result.region.x0 - SLUMP_MARGIN,
        z0: result.region.z0 - SLUMP_MARGIN,
        x1: result.region.x1 + SLUMP_MARGIN,
        z1: result.region.z1 + SLUMP_MARGIN,
      });
    }
  }
}
