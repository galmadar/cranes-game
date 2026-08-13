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
}

export type VehicleViewFactory = (def: VehicleDefinition) => VehicleParts;

export class VehicleView {
  readonly object: THREE.Group;

  private readonly blade: THREE.Group | undefined;
  private readonly bladeRestY: number;

  constructor(def: VehicleDefinition, factory: VehicleViewFactory) {
    const parts = factory(def);
    this.object = parts.root;
    this.blade = parts.blade;
    this.bladeRestY = parts.blade ? parts.blade.position.y : 0;
  }

  sync(state: VehicleState): void {
    this.object.position.set(state.position.x, state.position.y, state.position.z);
    // YXZ: yaw first, then pitch, then roll — the correct order for a vehicle
    // sitting on a slope.
    this.object.rotation.set(state.pitch, state.heading, state.roll, 'YXZ');

    if (this.blade) {
      const bladeState = Object.values(state.implementStates).find((s) => s.kind === 'blade');
      if (bladeState) {
        this.blade.position.y = this.bladeRestY + bladeState.height;
        // Positive pitch tips the top of the mouldboard forward (-X rotation),
        // which is what the sim reads as the edge dropping in to bite.
        this.blade.rotation.x = -bladeState.pitch;
      }
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
