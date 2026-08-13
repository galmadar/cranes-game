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
import { clamp, moveToward } from '../../math/Vec';
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

/**
 * How much faster the servo drives the blade than the operator's lever.
 *
 * Grade control that cannot outrun the terrain is worse than none: the blade
 * sags into every hollow it was meant to bridge, which is exactly the failure
 * it exists to prevent.
 */
const GRADE_HOLD_GAIN = 3;

/** Travel still unused at each end before hold reports itself saturated, metres. */
const SATURATION_EPSILON = 1e-3;

export class BladeImplement implements Implement {
  readonly id: string;
  readonly spec: BladeSpec;

  /** Edge detection for the hold toggle. Per-vehicle: implements are not shared. */
  private holdWasDown = false;
  /** Elevation held when no contract defines one. See the note in `update`. */
  private holdY = 0;

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
      gradeHold: false,
      gradeHoldSaturated: false,
    };
  }

  update(ctx: ImplementContext): void {
    const state = ctx.vehicle.implementStates[this.id];
    if (!state || state.kind !== 'blade') return;

    const pos = ctx.vehicle.position;
    const fx = Math.sin(ctx.vehicle.heading);
    const fz = Math.cos(ctx.vehicle.heading);

    // --- articulation --------------------------------------------------------
    const drive =
      actionValue(ctx.input, this.spec.raiseAction) - actionValue(ctx.input, this.spec.lowerAction);
    if (drive !== 0) {
      // Touching the lever drops out of auto, as on a real machine. Manual
      // input silently fighting a servo is the worst of both.
      state.gradeHold = false;
      state.height = clamp(
        state.height + drive * this.spec.moveSpeed * ctx.dt,
        this.spec.minHeight,
        this.spec.maxHeight,
      );
    }

    this.updateGradeHold(ctx, state, pos.x + fx * this.spec.reach, pos.z + fz * this.spec.reach);

    // --- dig -----------------------------------------------------------------

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

  /**
   * Automatic grade control — hold the cutting edge at a fixed ELEVATION while
   * the machine pitches and climbs beneath it.
   *
   * This is the answer to the real complaint about manual blade control: the
   * lever sets height relative to the machine's own ground line, so the number
   * you need changes continuously as you drive over ground you already cut.
   * The player ends up doing arithmetic instead of dozing.
   *
   * Not an assist bolted on to make the game easy — it is what 3D machine
   * control does on any modern dozer, and it is what makes a flat pad a
   * question of where you drive rather than how steady your thumb is.
   */
  private updateGradeHold(
    ctx: ImplementContext,
    state: BladeState,
    edgeX: number,
    edgeZ: number,
  ): void {
    const action = this.spec.gradeHoldAction;
    const down = action ? actionValue(ctx.input, action) > 0 : false;
    if (down && !this.holdWasDown) {
      state.gradeHold = !state.gradeHold;
      // Off a job site there is no design surface, so latch wherever the edge
      // is right now. An absolute lock is what makes free-roam levelling work
      // at all, and it is the same servo either way.
      if (state.gradeHold) this.holdY = ctx.vehicle.position.y + state.height;
    }
    this.holdWasDown = down;

    if (!state.gradeHold) {
      state.gradeHoldSaturated = false;
      return;
    }

    const target = ctx.gradeAt(edgeX, edgeZ) ?? this.holdY;
    const wanted = target - ctx.vehicle.position.y;
    const reachable = clamp(wanted, this.spec.minHeight, this.spec.maxHeight);
    state.gradeHoldSaturated = Math.abs(reachable - wanted) > SATURATION_EPSILON;
    state.height = moveToward(
      state.height,
      reachable,
      this.spec.moveSpeed * GRADE_HOLD_GAIN * ctx.dt,
    );
  }
}
