/**
 * ExcavatorImplement — an arm that takes soil out of the world and carries it.
 *
 * The third machine, and the one that tests whether the implement abstraction
 * was worth building. It needed nothing new from `ImplementContext`: the arm
 * reads the terrain and writes the terrain, which is exactly what a blade does.
 * Only the crane, which had to find an OBJECT, ever forced a change.
 *
 * The cycle it is built around: get the teeth into the ground, drag them
 * through it until the bucket is full, curl to hold the load, slew, tip out.
 * Every one of those is a separate control, and the reason the machine is
 * satisfying is that they have to be done in that order.
 *
 * **Conservation.** This is the first thing in the game that removes soil from
 * the height field and keeps it. Terrain volume alone is therefore NOT constant
 * while an excavator is working — terrain plus `carried` is. Anything checking
 * FR-3.5 against a world containing one of these has to add the bucket.
 */

import { actionValue } from '../../input/actions';
import { bucketBite, bucketDump } from '../../deform/bucket';
import type { MaterialId } from '../../materials';
import { clamp, vec3 } from '../../math/Vec';
import type { AxisSpec, ExcavatorSpec, ExcavatorState } from '../types';
import type { Implement, ImplementContext } from './Implement';

/**
 * Cells beyond the edited region that slumping may reach into.
 *
 * Smaller than the blade's margin: a bucket works a disc a metre or two
 * across, where a dozer heaps a prow several metres ahead of the machine.
 */
const SLUMP_MARGIN = 5;

/** Chassis drag from a bucket dragging through the ground, at full dig rate. */
const DIG_DRAG = 0.5;
/** Chassis drag when the teeth are against rock. */
const ROCK_DRAG = 0.85;

export class ExcavatorImplement implements Implement {
  readonly id: string;
  readonly spec: ExcavatorSpec;

  /** What is in the bucket, so spoil looks like the ground it came from. */
  private carriedMaterial: MaterialId | null = null;

  /** Last frame's teeth position — digging is charged against how far they moved. */
  private lastTeeth: { x: number; y: number; z: number } | null = null;

  constructor(spec: ExcavatorSpec) {
    this.id = spec.id;
    this.spec = spec;
  }

  createState(): ExcavatorState {
    return {
      kind: 'excavator',
      slew: 0,
      boom: clamp(this.spec.boom.rest, this.spec.boom.min, this.spec.boom.max),
      stick: clamp(this.spec.stick.rest, this.spec.stick.min, this.spec.stick.max),
      curl: clamp(this.spec.curl.rest, this.spec.curl.min, this.spec.curl.max),
      teeth: vec3(),
      radius: 0,
      groundAtTeeth: 0,
      carried: 0,
      flowRate: 0,
      blocked: false,
      dumping: false,
    };
  }

  update(ctx: ImplementContext): void {
    const state = ctx.vehicle.implementStates[this.id];
    if (!state || state.kind !== 'excavator') return;

    this.drive(ctx, state);

    const teeth = this.teethAt(ctx, state);
    // Horizontal travel only. Dropping the boom straight down is how you SET
    // the depth of a cut; it is not the cut. Counting the plunge filled the
    // bucket before the pass had started and let the machine sink to twice the
    // depth the contract asked for without the player choosing to.
    const travel = this.lastTeeth
      ? Math.hypot(teeth.x - this.lastTeeth.x, teeth.z - this.lastTeeth.z)
      : 0;
    this.lastTeeth = { x: teeth.x, y: teeth.y, z: teeth.z };

    state.teeth.x = teeth.x;
    state.teeth.y = teeth.y;
    state.teeth.z = teeth.z;
    state.radius = Math.hypot(
      teeth.x - ctx.vehicle.position.x,
      teeth.z - ctx.vehicle.position.z,
    );
    state.groundAtTeeth = ctx.terrain.sampleHeight(teeth.x, teeth.z);
    state.dumping = state.curl <= this.spec.dumpCurl;

    if (state.dumping) this.dump(ctx, state);
    else this.dig(ctx, state, travel);
  }

  // --------------------------------------------------------------- the arm

  private drive(ctx: ImplementContext, state: ExcavatorState): void {
    const slew =
      actionValue(ctx.input, this.spec.slew.leftAction) -
      actionValue(ctx.input, this.spec.slew.rightAction);
    // Continuous: a house has no stops.
    if (slew !== 0) state.slew += slew * this.spec.slew.speed * ctx.dt;

    state.boom = step(ctx, this.spec.boom, state.boom);
    state.stick = step(ctx, this.spec.stick, state.stick);
    state.curl = step(ctx, this.spec.curl, state.curl);
  }

  /**
   * Where the teeth are.
   *
   * A plain two-link arm in the vertical plane, swung round by the house. The
   * angles compose the way the linkage does: the stick hangs from the boom, so
   * its world angle is the boom's plus its own, and the bucket hangs off that.
   * Getting this wrong is invisible in the numbers and obvious the moment you
   * watch the machine, because the teeth stop being where the bucket is.
   */
  private teethAt(ctx: ImplementContext, state: ExcavatorState) {
    const boomAngle = state.boom;
    const stickAngle = state.boom - state.stick;
    const teethAngle = stickAngle - state.curl;

    const out =
      this.spec.pivot.z +
      this.spec.boomLength * Math.cos(boomAngle) +
      this.spec.stickLength * Math.cos(stickAngle) +
      this.spec.bucketLength * Math.cos(teethAngle);
    const up =
      this.spec.pivot.y +
      this.spec.boomLength * Math.sin(boomAngle) +
      this.spec.stickLength * Math.sin(stickAngle) +
      this.spec.bucketLength * Math.sin(teethAngle);

    const bearing = ctx.vehicle.heading + state.slew;
    return vec3(
      ctx.vehicle.position.x + Math.sin(bearing) * out,
      ctx.vehicle.position.y + up,
      ctx.vehicle.position.z + Math.cos(bearing) * out,
    );
  }

  // ------------------------------------------------------------ dig / dump

  /**
   * @param travel metres the teeth moved this step — the thing that fills the bucket.
   */
  private dig(ctx: ImplementContext, state: ExcavatorState, travel: number): void {
    const room = this.spec.capacity - state.carried;
    const result = bucketBite({
      terrain: ctx.terrain,
      x: state.teeth.x,
      z: state.teeth.z,
      teethY: state.teeth.y,
      width: this.spec.bucketWidth,
      room,
      maxVolume: this.spec.digRate * travel,
    });

    state.blocked = result.blocked;
    state.carried += result.volume;
    state.flowRate = ctx.dt > 0 ? result.volume / ctx.dt : 0;
    // Whatever is already aboard keeps its identity until the bucket empties;
    // a first bite of sand does not become topsoil because the second one was.
    if (result.material !== null && this.carriedMaterial === null) {
      this.carriedMaterial = result.material;
    }

    if (result.blocked) ctx.addResistance(ROCK_DRAG);
    else if (result.volume > 0) {
      const share = clamp(result.volume / (this.spec.digRate * travel || 1), 0, 1);
      ctx.addResistance(share * DIG_DRAG);
    }

    this.requestSlump(ctx, result.region);
  }

  private dump(ctx: ImplementContext, state: ExcavatorState): void {
    state.blocked = false;
    if (state.carried <= 0) {
      state.flowRate = 0;
      this.carriedMaterial = null;
      return;
    }

    const wanted = Math.min(state.carried, this.spec.dumpRate * ctx.dt);
    const result = bucketDump({
      terrain: ctx.terrain,
      x: state.teeth.x,
      z: state.teeth.z,
      width: this.spec.bucketWidth,
      volume: wanted,
      material: this.carriedMaterial,
    });

    state.carried -= result.placed;
    state.flowRate = ctx.dt > 0 ? -result.placed / ctx.dt : 0;
    if (state.carried <= 1e-9) {
      state.carried = 0;
      this.carriedMaterial = null;
    }

    this.requestSlump(ctx, result.region);
  }

  private requestSlump(
    ctx: ImplementContext,
    region: { x0: number; z0: number; x1: number; z1: number } | null,
  ): void {
    if (!region) return;
    ctx.requestSlump({
      x0: region.x0 - SLUMP_MARGIN,
      z0: region.z0 - SLUMP_MARGIN,
      x1: region.x1 + SLUMP_MARGIN,
      z1: region.z1 + SLUMP_MARGIN,
    });
  }
}

/** Drive one limited axis by its two actions. */
function step(ctx: ImplementContext, spec: AxisSpec, value: number): number {
  const drive =
    actionValue(ctx.input, spec.increaseAction) - actionValue(ctx.input, spec.decreaseAction);
  if (drive === 0) return value;
  return clamp(value + drive * spec.speed * ctx.dt, spec.min, spec.max);
}
