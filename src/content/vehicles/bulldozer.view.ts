/**
 * Bulldozer mesh — procedural primitives only (NFR-7).
 *
 * No external models: asset sourcing must never block the core loop. M4 is
 * where this gets prettier; right now it only has to read clearly as a dozer
 * and show blade articulation at a glance.
 *
 * Local space: +Z is forward, +Y is up, origin sits on the ground line.
 */

import * as THREE from 'three';
import type { VehicleDefinition } from '../../sim/vehicle/types';
import type { VehicleParts } from '../../render/VehicleView';
import { BLADE_ID } from './bulldozer.def';

const YELLOW = 0xf2b035;
const DARK = 0x25292f;
const STEEL = 0x8d949c;
const GLASS = 0x121a22;

function mat(color: number, roughness = 0.62, metalness = 0.15): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildBulldozer(def: VehicleDefinition): VehicleParts {
  const root = new THREE.Group();
  root.name = def.id;

  const bodyMat = mat(YELLOW);
  const darkMat = mat(DARK, 0.85, 0.1);
  const steelMat = mat(STEEL, 0.45, 0.6);
  const glassMat = mat(GLASS, 0.2, 0.3);

  // --- tracks ---------------------------------------------------------------
  for (const side of [-1, 1]) {
    const track = box(0.85, 0.95, 4.5, darkMat, side * 1.28, 0.48, -0.1);
    root.add(track);

    // Road wheels, just enough to break up the slab silhouette.
    for (const z of [-1.6, -0.55, 0.55, 1.6]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 12), steelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 1.28, 0.42, z - 0.1);
      wheel.castShadow = true;
      root.add(wheel);
    }
  }

  // --- hull and cab ---------------------------------------------------------
  root.add(box(2.3, 1.05, 3.5, bodyMat, 0, 1.2, -0.35));
  root.add(box(1.9, 0.35, 2.0, bodyMat, 0, 1.85, 0.55)); // engine deck
  root.add(box(1.75, 1.25, 1.7, glassMat, 0, 2.35, -0.95)); // cab
  root.add(box(1.95, 0.14, 1.9, darkMat, 0, 3.02, -0.95)); // canopy

  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.05, 10), darkMat);
  stack.position.set(0.62, 2.35, 0.72);
  stack.castShadow = true;
  root.add(stack);

  // --- blade ----------------------------------------------------------------
  // Everything that moves with the blade is parented here, so the renderer
  // only ever has to drive one node's Y.
  const bladeSpec = def.implements.find((i) => i.id === BLADE_ID);
  const bladeWidth = bladeSpec?.kind === 'blade' ? bladeSpec.width : 4.0;
  const reach = bladeSpec?.kind === 'blade' ? bladeSpec.reach : 2.9;

  const blade = new THREE.Group();
  blade.name = 'blade';
  blade.position.set(0, 0.95, reach);

  blade.add(box(bladeWidth, 1.3, 0.26, bodyMat, 0, 0, 0));
  blade.add(box(bladeWidth, 0.2, 0.42, steelMat, 0, -0.68, 0.02)); // cutting edge
  for (const side of [-1, 1]) {
    blade.add(box(0.24, 1.3, 0.62, bodyMat, (side * bladeWidth) / 2 + side * -0.12, 0, -0.42));
  }
  // Push arms running back toward the hull.
  for (const side of [-1, 1]) {
    blade.add(box(0.24, 0.24, 2.3, steelMat, side * 1.28, -0.3, -1.35));
  }
  root.add(blade);

  return { root, blade };
}
