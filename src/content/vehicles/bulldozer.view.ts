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
  const bladeSpec = def.implements.find((i) => i.id === BLADE_ID);
  const spec = bladeSpec?.kind === 'blade' ? bladeSpec : undefined;
  const bladeWidth = spec?.width ?? 4.0;
  const bladeHeight = spec?.height ?? 1.3;
  const reach = spec?.reach ?? 2.9;
  const edgeAhead = spec?.pitch?.edgeAhead ?? 0.42;

  // Cutting edge relative to the PITCH PIVOT. `BladeImplement.edgeDrop` swings
  // the edge about that same pivot using the same two numbers, so the blade
  // the player watches is the blade the terrain is cut with.
  const edgeBelow = -bladeHeight * 0.6;

  // Outer group: elevation only. The renderer drives its Y, and the push arms
  // live here because they define the pivot rather than swinging about it.
  const blade = new THREE.Group();
  blade.name = 'blade';
  blade.position.set(0, -edgeBelow, reach - edgeAhead);

  // Inner group: pitch. Rotating here and not on the parent is what keeps the
  // rotation centred on the trunnion instead of on the blade's midpoint.
  const mould = new THREE.Group();
  mould.name = 'bladePitch';
  blade.add(mould);

  mould.add(curvedMouldboard(bladeWidth, bladeHeight, edgeAhead, bodyMat));
  mould.add(box(bladeWidth, 0.2, 0.34, steelMat, 0, edgeBelow + 0.1, edgeAhead));
  // Spill lip along the top: without it a full blade pours over the back.
  mould.add(box(bladeWidth, 0.14, 0.34, bodyMat, 0, -edgeBelow, edgeAhead - 0.04));

  // End plates, which are what actually stop the load escaping sideways.
  for (const side of [-1, 1]) {
    mould.add(
      box(0.14, bladeHeight + 0.1, 1.0, bodyMat, (side * bladeWidth) / 2, 0, edgeAhead - 0.32),
    );
  }

  // Push arms running back toward the hull, pinned at the pivot.
  for (const side of [-1, 1]) {
    blade.add(box(0.24, 0.24, 2.3, steelMat, side * 1.28, edgeBelow * 0.4, -1.05));
  }
  root.add(blade);

  return { root, blade, bladePitch: mould };
}

/**
 * The mouldboard — a concave sheet, not a flat plate.
 *
 * The curve is the entire reason pitch means anything. A flat blade rolled
 * back has no bowl for the sand to climb into, so "carries more" is a number
 * with nothing behind it. Curved, the face rolls material up itself and holds
 * it, and rolling the blade back deepens the bowl you can see.
 *
 * Built from a partial cylinder rather than an extruded profile because a
 * cylinder arrives indexed with smooth normals, and a faceted mouldboard would
 * undo the surface work the rest of the machine just got.
 */
function curvedMouldboard(
  width: number,
  height: number,
  edgeAhead: number,
  material: THREE.Material,
): THREE.Mesh {
  const halfHeight = height / 2;
  const radius = height * 0.77; // ~0.24m of bow on a 1.3m blade
  const half = Math.asin(Math.min(1, halfHeight / radius));

  const geo = new THREE.CylinderGeometry(
    radius,
    radius,
    width,
    32, // radial segments — enough that the curve reads as a curve
    1,
    true, // open ended: a mouldboard is a sheet
    Math.PI - half,
    half * 2,
  );
  // Cylinder axis runs +Y; swing it across the machine so the arc lies in the
  // fore-aft plane, concave forward.
  geo.rotateZ(Math.PI / 2);
  // Push the arc forward so its lower lip meets the cutting edge.
  geo.translate(0, 0, edgeAhead + radius * Math.cos(half));

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
