/**
 * Vehicle — chassis locomotion plus a bag of implements.
 *
 * Pure simulation: no renderer, no DOM, no input devices. It reads an
 * `ActionState` and the terrain, and writes its own state.
 */

import { Action, actionAxis, type ActionState } from '../input/actions';
import { materialOf } from '../materials';
import { clamp, moveToward, vec3 } from '../math/Vec';
import type { Rect, Terrain } from '../Terrain';
import { BladeImplement } from './implements/BladeImplement';
import {
  NO_GRADE,
  type GradeQuery,
  type Implement,
  type ImplementContext,
} from './implements/Implement';
import type { ImplementSpec, VehicleDefinition, VehicleState } from './types';

/** Keeps the machine clear of the perimeter berm rather than climbing it. */
const EDGE_MARGIN = 16;

/** Below this ground speed the tracks are not laying a mark. */
const TRACK_MARK_MIN_SPEED = 0.05;
/** How churned tracks leave the ground behind them, 0..255. */
const TRACK_MARK_STRENGTH = 190;

function buildImplement(spec: ImplementSpec): Implement {
  switch (spec.kind) {
    case 'blade':
      return new BladeImplement(spec);
    default: {
      // Exhaustiveness guard: adding an implement kind without a factory is a
      // compile error, not a silent no-op at runtime.
      const never: never = spec.kind;
      throw new Error(`Unsupported implement kind: ${String(never)}`);
    }
  }
}

export class Vehicle {
  readonly def: VehicleDefinition;
  readonly state: VehicleState;
  readonly implements: readonly Implement[];

  constructor(def: VehicleDefinition, spawn: { position: { x: number; z: number }; heading: number }) {
    this.def = def;
    this.implements = def.implements.map(buildImplement);

    this.state = {
      defId: def.id,
      position: vec3(spawn.position.x, 0, spawn.position.z),
      heading: spawn.heading,
      pitch: 0,
      roll: 0,
      speed: 0,
      implementStates: {},
    };

    for (const impl of this.implements) {
      this.state.implementStates[impl.id] = impl.createState();
    }
  }

  /** Ground material currently under the machine (FR-2.5). */
  groundMaterial(terrain: Terrain) {
    return materialOf(terrain.sampleMaterial(this.state.position.x, this.state.position.z));
  }

  /**
   * Drag from the implements, applied to locomotion on the FOLLOWING step.
   * One frame of lag at 60Hz is imperceptible, and the alternative — running
   * implements before locomotion — would have the blade cutting against a
   * position the machine has not reached yet.
   */
  private resistance = 0;
  private pendingSlump: Rect | null = null;

  update(dt: number, input: ActionState, terrain: Terrain, gradeAt: GradeQuery = NO_GRADE): void {
    this.updateLocomotion(dt, input, terrain);

    // A plain object rather than closed-over locals: implements write to it
    // from callbacks, and this keeps the accumulation obvious.
    const collected = { resistance: 0, slump: null as Rect | null };

    const ctx: ImplementContext = {
      dt,
      input,
      vehicle: this.state,
      terrain,
      def: this.def,
      gradeAt,
      addResistance(value) {
        if (value > collected.resistance) collected.resistance = value;
      },
      requestSlump(rect) {
        collected.slump = collected.slump
          ? {
              x0: Math.min(collected.slump.x0, rect.x0),
              z0: Math.min(collected.slump.z0, rect.z0),
              x1: Math.max(collected.slump.x1, rect.x1),
              z1: Math.max(collected.slump.z1, rect.z1),
            }
          : { ...rect };
      },
    };

    for (const impl of this.implements) impl.update(ctx);

    this.resistance = collected.resistance;
    this.pendingSlump = collected.slump;
  }

  /** Taken by the World after every vehicle has stepped. */
  consumeSlumpRegion(): Rect | null {
    const rect = this.pendingSlump;
    this.pendingSlump = null;
    return rect;
  }

  /** 0..1 drag currently coming from the implements. */
  get implementLoad(): number {
    return this.resistance;
  }

  private updateLocomotion(dt: number, input: ActionState, terrain: Terrain): void {
    const loco = this.def.locomotion;
    const s = this.state;

    const throttle = clamp(actionAxis(input, Action.ThrottleForward, Action.ThrottleReverse), -1, 1);
    const steer = clamp(actionAxis(input, Action.SteerLeft, Action.SteerRight), -1, 1);

    // Mud bogs the tracks; sand is loose. This is the whole of FR-2.5.
    const traction = this.groundMaterial(terrain).tractionMultiplier;

    // A loaded blade drags the machine down; one buried in rock nearly stops
    // it. This is what makes the dig feel like work rather than like painting.
    const load = 1 - clamp(this.resistance, 0, 0.98);

    const targetSpeed =
      (throttle >= 0 ? loco.maxSpeed * throttle : loco.maxReverseSpeed * throttle) *
      traction *
      load;

    // Slowing down is quicker than speeding up — tracks brake hard.
    const closingOnZero = Math.abs(targetSpeed) < Math.abs(s.speed);
    const rate = closingOnZero ? loco.braking : loco.acceleration;
    s.speed = moveToward(s.speed, targetSpeed, rate * dt);

    // Tracked machines pivot on the spot, so steering does not require motion.
    // Deliberately NOT inverted in reverse: direct yaw control is predictable,
    // and M4 is where this gets tuned against actual feel.
    if (steer !== 0) {
      s.heading += steer * loco.turnRate * traction * dt;
      s.heading = wrapAngle(s.heading);
    }

    if (s.speed !== 0) {
      s.position.x += Math.sin(s.heading) * s.speed * dt;
      s.position.z += Math.cos(s.heading) * s.speed * dt;

      const limitX = terrain.worldWidth / 2 - EDGE_MARGIN;
      const limitZ = terrain.worldDepth / 2 - EDGE_MARGIN;
      s.position.x = clamp(s.position.x, -limitX, limitX);
      s.position.z = clamp(s.position.z, -limitZ, limitZ);
    }

    // FR-2.3 — conform to the ground.
    s.position.y = terrain.sampleHeight(s.position.x, s.position.z);
    const n = terrain.sampleNormal(s.position.x, s.position.z);

    // Height-field gradient from the normal, then resolve it along the
    // machine's own forward and right axes.
    const dhdx = -n.x / n.y;
    const dhdz = -n.z / n.y;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    // right = forward x up
    const rx = -fz;
    const rz = fx;

    s.pitch = -Math.atan(dhdx * fx + dhdz * fz); // nose up when climbing
    s.roll = -Math.atan(dhdx * rx + dhdz * rz);

    this.layTrackMarks(terrain, fx, fz, rx, rz);
  }

  /**
   * Churn the ground under the tracks.
   *
   * Marks are a SURFACE property, not a height change: pressing the terrain
   * down under the tracks would look plausible and quietly destroy volume,
   * which is the one thing FR-3.5 does not allow. Rock does not scuff.
   */
  private layTrackMarks(terrain: Terrain, fx: number, fz: number, rx: number, rz: number): void {
    const s = this.state;
    if (Math.abs(s.speed) < TRACK_MARK_MIN_SPEED) return;

    const halfTrack = this.def.dimensions.width / 2 - 0.45;
    const halfLength = this.def.dimensions.length / 2;

    for (const side of [-1, 1]) {
      const baseX = s.position.x + rx * side * halfTrack;
      const baseZ = s.position.z + rz * side * halfTrack;
      // Two samples per track so a fast machine cannot skip over cells
      // between steps and leave a dotted line.
      for (const along of [-halfLength * 0.5, halfLength * 0.5]) {
        terrain.disturbAround(
          baseX + fx * along,
          baseZ + fz * along,
          terrain.cellSize * 1.1,
          TRACK_MARK_STRENGTH,
        );
      }
    }
  }
}

function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}
