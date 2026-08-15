/**
 * VehicleView — drives a vehicle's scene graph from its simulation state.
 *
 * Reads state, never writes it. A vehicle contributes a *factory* that builds
 * primitives and names the movable nodes; this class knows how to pose them.
 */

import * as THREE from 'three';
import type { VehicleState, VehicleDefinition } from '../sim/vehicle/types';

export interface VehicleParts {
  root: THREE.Group;
  /** Optional articulated nodes the view knows how to drive. */
  blade?: THREE.Group;
  /** Mouldboard node, rotated for pitch. Nested inside `blade`. */
  bladePitch?: THREE.Object3D;

  /** Slewing superstructure, rotated about Y. */
  craneHouse?: THREE.Object3D;
  /** Boom, pivoted about X at its foot. Nested inside `craneHouse`. */
  craneBoom?: THREE.Object3D;
  /** Empty at the boom head. The rope is measured from where this ends up. */
  craneHead?: THREE.Object3D;
  /** Rope, hanging from its own origin down -Y at unit length. */
  craneRope?: THREE.Object3D;
  craneHook?: THREE.Object3D;
}

export type VehicleViewFactory = (def: VehicleDefinition) => VehicleParts;

/** The rope geometry's own axis, before it is aimed at the hook. */
const ROPE_AXIS = new THREE.Vector3(0, -1, 0);

export class VehicleView {
  readonly object: THREE.Group;

  private readonly blade: THREE.Group | undefined;
  private readonly bladePitch: THREE.Object3D | undefined;
  private readonly bladeRestY: number;

  private readonly craneHouse: THREE.Object3D | undefined;
  private readonly craneBoom: THREE.Object3D | undefined;
  private readonly craneHead: THREE.Object3D | undefined;
  private readonly craneRope: THREE.Object3D | undefined;
  private readonly craneHook: THREE.Object3D | undefined;

  private readonly headWorld = new THREE.Vector3();
  private readonly hookWorld = new THREE.Vector3();
  private readonly ropeVector = new THREE.Vector3();
  private readonly rootFacing = new THREE.Quaternion();

  constructor(def: VehicleDefinition, factory: VehicleViewFactory) {
    const parts = factory(def);
    this.object = parts.root;
    this.blade = parts.blade;
    this.bladePitch = parts.bladePitch;
    this.bladeRestY = parts.blade ? parts.blade.position.y : 0;

    this.craneHouse = parts.craneHouse;
    this.craneBoom = parts.craneBoom;
    this.craneHead = parts.craneHead;
    this.craneRope = parts.craneRope;
    this.craneHook = parts.craneHook;
  }

  sync(state: VehicleState): void {
    this.object.position.set(state.position.x, state.position.y, state.position.z);
    // YXZ: yaw first, then pitch, then roll — the correct order for a vehicle
    // sitting on a slope.
    this.object.rotation.set(state.pitch, state.heading, state.roll, 'YXZ');

    const implementStates = Object.values(state.implementStates);

    const bladeState = implementStates.find((s) => s.kind === 'blade');
    if (this.blade && bladeState) {
      this.blade.position.y = this.bladeRestY + bladeState.height;
      // Positive pitch tips the top of the mouldboard forward, which swings
      // the cutting edge down — exactly what `edgeDrop` computes in the sim.
      if (this.bladePitch) this.bladePitch.rotation.x = bladeState.pitch;
    }

    const craneState = implementStates.find((s) => s.kind === 'crane');
    if (craneState) this.syncCrane(craneState.slew, craneState.luff, craneState.hook, craneState.head);
  }

  /**
   * Pose the boom, then hang the rope from where the boom actually ended up.
   *
   * The rope is measured from the boom head NODE rather than from the
   * simulation's `head`, and the hook is placed at that node plus the
   * simulation's head-to-hook offset. Those two numbers agree on flat ground
   * and disagree when the chassis is tilted — because the sim's boom does not
   * lean with the machine and the mesh's does. Taking the offset rather than
   * the absolute position means the rope always hangs off the visible boom.
   */
  private syncCrane(
    slew: number,
    luff: number,
    hook: { x: number; y: number; z: number },
    head: { x: number; y: number; z: number },
  ): void {
    if (this.craneHouse) this.craneHouse.rotation.y = slew;
    // Negative: a rotation about +X swings +Z downward, and luffing lifts it.
    if (this.craneBoom) this.craneBoom.rotation.x = -luff;
    if (!this.craneHead || !this.craneHook || !this.craneRope) return;

    this.object.updateMatrixWorld(true);
    this.craneHead.getWorldPosition(this.headWorld);

    this.hookWorld.set(
      this.headWorld.x + (hook.x - head.x),
      this.headWorld.y + (hook.y - head.y),
      this.headWorld.z + (hook.z - head.z),
    );

    this.object.worldToLocal(this.hookWorld);
    this.craneHook.position.copy(this.hookWorld);
    // A hook block hangs plumb. Parented to the chassis it would inherit the
    // machine's heading and roll, and yaw about as the operator steers.
    this.craneHook.quaternion.copy(this.object.getWorldQuaternion(this.rootFacing).invert());

    this.object.worldToLocal(this.headWorld);
    this.craneRope.position.copy(this.headWorld);
    this.ropeVector.copy(this.hookWorld).sub(this.headWorld);
    const length = this.ropeVector.length();
    this.craneRope.scale.set(1, Math.max(length, 1e-3), 1);
    if (length > 1e-6) {
      this.craneRope.quaternion.setFromUnitVectors(
        ROPE_AXIS,
        this.ropeVector.divideScalar(length),
      );
    }
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const material = node.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });
  }
}
