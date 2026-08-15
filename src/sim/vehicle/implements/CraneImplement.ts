/**
 * CraneImplement — boom kinematics, a swinging hook, and a capacity chart.
 *
 * The claim in `Implement.ts` was that a crane arrives as a new implement and
 * does not change Vehicle, Terrain or the loop. It very nearly held: the only
 * thing this needed that a blade did not is a way to SEE the loads, which is
 * one field on `ImplementContext`. The blade's whole world is the height field
 * it is standing in; a crane has to find an object and pick it up.
 *
 * Three mechanics carry the machine, and each is the crane's answer to
 * something the dozer already has:
 *
 *   - **Sway** is the crane's inertia. The dozer's blade load resists you in a
 *     straight line; a hook load keeps travelling after you stop slewing and
 *     you have to steer it back. It is a pendulum, driven by the boom head.
 *   - **The capacity chart** is the crane's stall point. Reach costs lifting
 *     power, so "can I pick this up" is a question about where you parked.
 *   - **The limiter** is the crane's recoverable failure. Over rated load it
 *     refuses to make things worse — never to undo what you already did.
 */

import { actionValue } from '../../input/actions';
import { GRAVITY, type Payload } from '../../payload/Payload';
import { clamp, vec3 } from '../../math/Vec';
import { TUNING } from '../../tuning';
import type { AxisSpec, CraneSpec, CraneState } from '../types';
import type { Implement, ImplementContext } from './Implement';

/** Shortest rope the pendulum maths is stable on, metres. */
const MIN_PENDULUM_LENGTH = 0.6;

/**
 * Ceiling on the boom head acceleration fed to the pendulum, m/s².
 *
 * The head's acceleration is a finite difference of a finite difference, so a
 * single frame where the player taps slew produces a spike that is numerically
 * real and physically nonsense. Clamping it costs nothing a player can feel and
 * stops the load being flung sideways by a keypress.
 */
const MAX_DRIVE_ACCEL = 26;

/** Above this rated fraction the limiter cuts out. */
const LIMIT_FRACTION = 1;

/** Load fraction at which travelling with the load has bogged the tracks. */
const TRAVEL_DRAG = 0.55;

/** How high the hook block's own body holds it off the ground, metres. */
const HOOK_BLOCK_HEIGHT = 0.55;

export class CraneImplement implements Implement {
  readonly id: string;
  readonly spec: CraneSpec;

  /** Edge detection for the hook toggle. Per-vehicle, like the blade's hold. */
  private hookWasDown = false;
  /** Previous boom head, for the velocity the pendulum is driven by. */
  private lastHead = vec3();
  private lastHeadVX = 0;
  private lastHeadVZ = 0;
  private hasLastHead = false;

  /** Loads let go clear of the ground since the last time anyone asked. */
  private droppedSinceRead = 0;

  constructor(spec: CraneSpec) {
    this.id = spec.id;
    this.spec = spec;
  }

  createState(): CraneState {
    return {
      kind: 'crane',
      slew: 0,
      luff: clamp(this.spec.luff.rest, this.spec.luff.min, this.spec.luff.max),
      rope: clamp(this.spec.hoist.rest, this.spec.hoist.min, this.spec.hoist.max),
      head: vec3(),
      hook: vec3(),
      swayX: 0,
      swayZ: 0,
      swayVX: 0,
      swayVZ: 0,
      radius: 0,
      ratedLoad: this.spec.maxLoad,
      hookLoad: 0,
      loadFraction: 0,
      limited: false,
      hookedPayloadId: null,
    };
  }

  /**
   * Rated load at a working radius, tonnes.
   *
   * Constant load moment past the minimum radius: reach out twice as far and
   * the crane holds half as much. Real charts are a table of measured points
   * and fall off faster than this at the extremes; a hyperbola gets the lesson
   * across without a table nobody will read.
   */
  ratedLoadAt(radius: number): number {
    if (radius <= this.spec.minRadius) return this.spec.maxLoad;
    return (this.spec.maxLoad * this.spec.minRadius) / radius;
  }

  /** Loads released above the ground since this was last called. Resets. */
  consumeDropped(): number {
    const n = this.droppedSinceRead;
    this.droppedSinceRead = 0;
    return n;
  }

  update(ctx: ImplementContext): void {
    const state = ctx.vehicle.implementStates[this.id];
    if (!state || state.kind !== 'crane') return;

    const held = this.heldPayload(ctx, state);
    // Read the chart BEFORE moving anything, so the limiter judges the
    // configuration the player is in rather than the one they are asking for.
    state.hookLoad = held ? held.spec.mass : 0;
    state.ratedLoad = this.ratedLoadAt(state.radius);
    state.loadFraction = state.ratedLoad > 0 ? state.hookLoad / state.ratedLoad : 0;
    state.limited = state.loadFraction >= LIMIT_FRACTION;

    this.updateSlew(ctx, state);
    this.updateLuff(ctx, state);
    this.updateHoist(ctx, state);

    const head = this.boomHead(ctx, state);
    state.head.x = head.x;
    state.head.y = head.y;
    state.head.z = head.z;

    this.updateSway(ctx, state, head);

    const ropeLength = Math.max(state.rope, MIN_PENDULUM_LENGTH);
    const swing = Math.hypot(state.swayX, state.swayZ);
    // The hook rides an arc, so swinging out also lifts it. Small-angle would
    // have a load at full swing hanging through the ground it is swinging over.
    const drop = Math.sqrt(Math.max(ropeLength * ropeLength - swing * swing, 0));
    state.hook.x = head.x + state.swayX;
    state.hook.z = head.z + state.swayZ;
    // The hook block lands on the ground and the rope goes slack. Without this
    // an empty hook winches straight through the slab and the readout tells you
    // the hook is 1.7 m BELOW a yard made of solid rock. The load already had
    // this floor; the hook was the half nobody was standing on.
    state.hook.y = Math.max(
      head.y - drop,
      ctx.terrain.sampleHeight(state.hook.x, state.hook.z) + HOOK_BLOCK_HEIGHT,
    );

    const dx = state.hook.x - ctx.vehicle.position.x;
    const dz = state.hook.z - ctx.vehicle.position.z;
    state.radius = Math.hypot(dx, dz);

    this.updateHook(ctx, state, held);
    this.carry(ctx, state);

    // Travelling with a load on the hook is slow, deliberate work. Reuses the
    // same chassis drag channel the blade's prow uses.
    if (state.hookLoad > 0) {
      ctx.addResistance(clamp(state.loadFraction, 0, 1) * TRAVEL_DRAG);
    }
  }

  // ------------------------------------------------------------------- axes

  private updateSlew(ctx: ImplementContext, state: CraneState): void {
    const drive =
      actionValue(ctx.input, this.spec.slew.leftAction) -
      actionValue(ctx.input, this.spec.slew.rightAction);
    if (drive === 0) return;
    // Slew is continuous — a turntable has no stops.
    state.slew += drive * this.spec.slew.speed * ctx.dt;
  }

  private updateLuff(ctx: ImplementContext, state: CraneState): void {
    const drive = axisDrive(ctx, this.spec.luff);
    if (drive === 0) return;
    // Booming DOWN reaches further out, which is what overloads a crane.
    // Overloaded, that direction is refused and coming back up is not.
    if (state.limited && drive < 0) return;
    state.luff = clamp(
      state.luff + drive * this.spec.luff.speed * ctx.dt,
      this.spec.luff.min,
      this.spec.luff.max,
    );
  }

  private updateHoist(ctx: ImplementContext, state: CraneState): void {
    const drive = axisDrive(ctx, this.spec.hoist);
    if (drive === 0) return;
    // Negative is rope IN, which is the direction that lifts an overload off
    // the ground. Paying out stays available: setting the load back down is how
    // you recover, and a limiter that blocked it would strand the player.
    if (state.limited && drive < 0) return;
    state.rope = clamp(
      state.rope + drive * this.spec.hoist.speed * ctx.dt,
      this.spec.hoist.min,
      this.spec.hoist.max,
    );
  }

  // -------------------------------------------------------------- kinematics

  /**
   * Boom head in world space.
   *
   * Chassis pitch and roll are deliberately ignored. A crane standing over on
   * a slope really does swing its head sideways, and modelling it properly
   * means the whole boom tilts — which is right, and which also means a crawler
   * crane on the lift yard's rolling ground never holds still. The yard is flat
   * where it matters; this becomes worth doing when a job puts the crane on a
   * grade on purpose.
   */
  private boomHead(ctx: ImplementContext, state: CraneState) {
    const bearing = ctx.vehicle.heading + state.slew;
    const out = this.spec.pivot.z + this.spec.boomLength * Math.cos(state.luff);
    const up = this.spec.pivot.y + this.spec.boomLength * Math.sin(state.luff);
    return vec3(
      ctx.vehicle.position.x + Math.sin(bearing) * out,
      ctx.vehicle.position.y + up,
      ctx.vehicle.position.z + Math.cos(bearing) * out,
    );
  }

  /**
   * The pendulum, in the boom head's frame.
   *
   * Restoring term is gravity over rope length; the driving term is the head's
   * own acceleration appearing as a pseudo-force, which is the honest reason a
   * load lags behind a slew and overshoots when you stop. Damping is critical
   * fraction `zeta` rather than a raw coefficient so the feel does not change
   * every time the rope length does.
   */
  private updateSway(ctx: ImplementContext, state: CraneState, head: { x: number; z: number }) {
    const dt = ctx.dt;
    if (dt <= 0) return;

    let accelX = 0;
    let accelZ = 0;
    const vx = this.hasLastHead ? (head.x - this.lastHead.x) / dt : 0;
    const vz = this.hasLastHead ? (head.z - this.lastHead.z) / dt : 0;
    if (this.hasLastHead) {
      accelX = clamp((vx - this.lastHeadVX) / dt, -MAX_DRIVE_ACCEL, MAX_DRIVE_ACCEL);
      accelZ = clamp((vz - this.lastHeadVZ) / dt, -MAX_DRIVE_ACCEL, MAX_DRIVE_ACCEL);
    }
    this.lastHead.x = head.x;
    this.lastHead.z = head.z;
    this.lastHeadVX = vx;
    this.lastHeadVZ = vz;
    this.hasLastHead = true;

    const length = Math.max(state.rope, MIN_PENDULUM_LENGTH);
    const omega = Math.sqrt(GRAVITY / length);
    const damping = 2 * TUNING.swayDamping * omega;

    // Semi-implicit Euler: velocity first, then position from the NEW velocity.
    // Explicit Euler adds energy to an oscillator every step, and a pendulum
    // that winds itself up is not a feature.
    state.swayVX += (-omega * omega * state.swayX - damping * state.swayVX - accelX) * dt;
    state.swayVZ += (-omega * omega * state.swayZ - damping * state.swayVZ - accelZ) * dt;
    state.swayX += state.swayVX * dt;
    state.swayZ += state.swayVZ * dt;

    // The rope cannot swing past horizontal, and long before that the small
    // corrections above stop describing anything. Clip the arc.
    const swing = Math.hypot(state.swayX, state.swayZ);
    const maxSwing = length * TUNING.maxSwingFraction;
    if (swing > maxSwing && swing > 0) {
      const k = maxSwing / swing;
      state.swayX *= k;
      state.swayZ *= k;
      state.swayVX *= k;
      state.swayVZ *= k;
    }
  }

  // -------------------------------------------------------------- the hook

  private heldPayload(ctx: ImplementContext, state: CraneState): Payload | null {
    if (!state.hookedPayloadId) return null;
    return ctx.payloads.find((p) => p.id === state.hookedPayloadId) ?? null;
  }

  private updateHook(ctx: ImplementContext, state: CraneState, held: Payload | null): void {
    const down = actionValue(ctx.input, this.spec.hookAction) > 0;
    const pressed = down && !this.hookWasDown;
    this.hookWasDown = down;
    if (!pressed) return;

    if (held) {
      held.hooked = false;
      state.hookedPayloadId = null;
      state.hookLoad = 0;
      // Letting go clear of the ground is a drop, not a set-down. Worth
      // counting: it is the difference between rigging and dumping.
      if (held.baseY > held.supportHeight(ctx.terrain) + 0.15) this.droppedSinceRead++;
      return;
    }

    const target = this.pickable(ctx, state);
    if (!target) return;
    target.hooked = true;
    target.fallSpeed = 0;
    state.hookedPayloadId = target.id;
    state.hookLoad = target.spec.mass;
  }

  /** The nearest free load whose lug is under the hook block. */
  private pickable(ctx: ImplementContext, state: CraneState): Payload | null {
    let best: Payload | null = null;
    let bestDistance = this.spec.hookRadius;

    for (const payload of ctx.payloads) {
      if (payload.hooked) continue;
      const lug = payload.lug;
      const distance = Math.hypot(
        lug.x - state.hook.x,
        lug.y + this.spec.slingLength - state.hook.y,
        lug.z - state.hook.z,
      );
      if (distance > bestDistance) continue;
      best = payload;
      bestDistance = distance;
    }
    return best;
  }

  /**
   * Drive the load from the hook, and stop it being winched through the ground.
   *
   * The floor matters more than it sounds. Without it, paying out rope over a
   * pad buries the load and the player's only cue that they have landed is that
   * nothing looks right. With it, the load stands on the ground and the rope
   * goes slack — which is what "you are down, let go" looks like on a real site.
   */
  private carry(ctx: ImplementContext, state: CraneState): void {
    const held = this.heldPayload(ctx, state);
    if (!held) return;

    // The tag line. Left to itself a hung load keeps whatever bearing it had,
    // which is both what a load on a single hook does and what makes lining one
    // up a separate thing you have to do.
    const turn =
      actionValue(ctx.input, this.spec.turn.leftAction) -
      actionValue(ctx.input, this.spec.turn.rightAction);
    if (turn !== 0) held.yaw += turn * this.spec.turn.speed * ctx.dt;

    held.followHook(state.hook, this.spec.slingLength, held.yaw);

    const restY = held.supportHeight(ctx.terrain) + held.spec.size.y / 2;
    if (held.position.y < restY) {
      held.position.y = restY;
      held.grounded = true;
    }
  }
}

/** Combine an axis's two actions into -1..1, in the direction of the number. */
function axisDrive(ctx: ImplementContext, spec: AxisSpec): number {
  return (
    actionValue(ctx.input, spec.increaseAction) - actionValue(ctx.input, spec.decreaseAction)
  );
}
