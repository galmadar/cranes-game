/**
 * Payload — a rigid load the crane picks up, carries and sets down.
 *
 * The second entity class in the simulation, and the reason a crane is not
 * just a dozer with a longer arm. Everything the dozer does is a change to a
 * height field; a load has a position, a bearing, and an identity that
 * survives being moved. Volume conservation says nothing about it.
 *
 * Deliberately NOT a rigid body. A load stands on the ground or hangs from a
 * hook, and it has one degree of freedom in between — falling. Bodies that
 * tumble and stack would be a physics engine, and a physics engine is not what
 * makes setting a beam on a pad hard. The pendulum on the hook is.
 */

import { clamp, vec3, type Vec3 } from '../math/Vec';
import type { Terrain } from '../Terrain';

export type PayloadKind = 'beam' | 'pipe' | 'crate' | 'block';

export interface PayloadSpec {
  readonly id: string;
  readonly kind: PayloadKind;
  readonly displayName: string;
  /** Metres in the load's own frame: x across, y up, z along its length. */
  readonly size: { x: number; y: number; z: number };
  /** Tonnes. What the crane's capacity chart is measured against. */
  readonly mass: number;
}

export interface PayloadInit extends PayloadSpec {
  /** Where it starts, on the ground. Y is found from the terrain. */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Terminal velocity for a dropped load, m/s. A cap, not a drag model. */
const MAX_FALL_SPEED = 14;
/** Gravity, m/s². Shared with the hook pendulum. */
export const GRAVITY = 9.81;

/** Below this the load has stopped moving and counts as set down. */
const REST_EPSILON = 1e-3;

/** How churned the ground gets under a load that has just landed, 0..255. */
const IMPRINT_STRENGTH = 150;

export class Payload {
  readonly spec: PayloadSpec;
  /** Centre of the load, world space. */
  readonly position: Vec3;
  yaw: number;

  /** True while the crane is holding it. The crane owns its position then. */
  hooked = false;
  /** Downward speed while falling, m/s. Zero on the ground. */
  fallSpeed = 0;
  /** True once it has come to rest on the ground. What scoring counts. */
  grounded = false;

  /** Set on the step a free load touches down, so the shell can react once. */
  landedThisStep = false;

  constructor(init: PayloadInit) {
    this.spec = {
      id: init.id,
      kind: init.kind,
      displayName: init.displayName,
      size: init.size,
      mass: init.mass,
    };
    this.position = vec3(init.x, 0, init.z);
    this.yaw = init.yaw;
  }

  get id(): string {
    return this.spec.id;
  }

  /** Height of the load's underside. What rests on the ground. */
  get baseY(): number {
    return this.position.y - this.spec.size.y / 2;
  }

  /** Where the hook attaches — the lifting lug on top, centred. */
  get lug(): Vec3 {
    return vec3(this.position.x, this.position.y + this.spec.size.y / 2, this.position.z);
  }

  /**
   * Ground the load stands on: the HIGHEST point under its footprint.
   *
   * A rigid box bridges a hollow and teeters on a high point — it does not
   * average. Same reasoning as the machine's track support plane, and the same
   * consequence: a load set on uneven ground sits proud of it.
   */
  supportHeight(terrain: Terrain): number {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const hx = this.spec.size.x / 2;
    const hz = this.spec.size.z / 2;

    let highest = -Infinity;
    for (const sx of [-hx, 0, hx]) {
      for (const sz of [-hz, 0, hz]) {
        // Local (sx, sz) rotated into world by yaw about +Y.
        const x = this.position.x + sx * cos + sz * sin;
        const z = this.position.z - sx * sin + sz * cos;
        const h = terrain.sampleHeight(x, z);
        if (h > highest) highest = h;
      }
    }
    return highest;
  }

  /** Drop it straight onto the ground. Used at spawn, and by tests. */
  settleOnGround(terrain: Terrain): void {
    this.position.y = this.supportHeight(terrain) + this.spec.size.y / 2;
    this.fallSpeed = 0;
    this.grounded = true;
    this.hooked = false;
  }

  /**
   * A free load falls until it lands, then stays put.
   *
   * No horizontal motion once released: a load leaves the hook where the hook
   * left it. Giving it the hook's sideways velocity would be more truthful and
   * would also mean a load you released cleanly slides away from the pad you
   * spent thirty seconds lining it up over.
   */
  step(dt: number, terrain: Terrain): void {
    this.landedThisStep = false;
    if (this.hooked) {
      this.grounded = false;
      this.fallSpeed = 0;
      return;
    }

    const support = this.supportHeight(terrain);
    const restY = support + this.spec.size.y / 2;

    if (this.position.y <= restY + REST_EPSILON) {
      // Already down — or the ground moved up under it, which a dozer can do.
      if (!this.grounded) this.land(terrain);
      this.position.y = restY;
      this.fallSpeed = 0;
      this.grounded = true;
      return;
    }

    this.grounded = false;
    this.fallSpeed = clamp(this.fallSpeed + GRAVITY * dt, 0, MAX_FALL_SPEED);
    this.position.y -= this.fallSpeed * dt;

    if (this.position.y <= restY) {
      this.position.y = restY;
      this.fallSpeed = 0;
      this.grounded = true;
      this.land(terrain);
    }
  }

  /** Carried by the crane: the hook dictates where it is. */
  followHook(hook: Vec3, slingLength: number, yaw: number): void {
    this.hooked = true;
    this.grounded = false;
    this.fallSpeed = 0;
    this.position.x = hook.x;
    this.position.z = hook.z;
    this.position.y = hook.y - slingLength - this.spec.size.y / 2;
    this.yaw = yaw;
  }

  private land(terrain: Terrain): void {
    this.landedThisStep = true;
    // A load's own footprint scuffs the ground it lands on. Surface only —
    // pressing the terrain down would destroy volume, and FR-3.5 forbids it.
    const radius = Math.max(this.spec.size.x, this.spec.size.z) / 2;
    terrain.disturbAround(this.position.x, this.position.z, radius, IMPRINT_STRENGTH);
  }
}
