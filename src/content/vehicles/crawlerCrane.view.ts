/**
 * Crawler crane mesh — procedural primitives only (NFR-7).
 *
 * Local space: +Z is forward, +Y is up, origin sits on the ground line.
 *
 * The lattice boom is merged into ONE geometry before it reaches the scene.
 * Built the obvious way it is about seventy little boxes, which is seventy
 * draw calls to draw a girder — more than the entire rest of the game spends.
 * Merging costs one function call at build time and nothing per frame.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleParts } from '../../render/VehicleView';
import type { VehicleDefinition } from '../../sim/vehicle/types';
import { CRANE_ID } from './crawlerCrane.def';

const YELLOW = 0xe8a723;
const DARK = 0x23262b;
const STEEL = 0x8d949c;
const GLASS = 0x121a22;
const ROPE = 0x4a4f57;

/** Lattice bay length, metres. Sets how dense the boom reads. */
const BAY = 1.8;
/** Distance between the boom's chords, metres. */
const CHORD_SPACING = 0.95;

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

export function buildCrawlerCrane(def: VehicleDefinition): VehicleParts {
  const root = new THREE.Group();
  root.name = def.id;

  const bodyMat = mat(YELLOW);
  const darkMat = mat(DARK, 0.85, 0.1);
  const steelMat = mat(STEEL, 0.45, 0.6);
  const glassMat = mat(GLASS, 0.2, 0.3);
  const ropeMat = mat(ROPE, 0.8, 0.2);

  const spec = def.implements.find((i) => i.id === CRANE_ID);
  const crane = spec?.kind === 'crane' ? spec : undefined;
  const boomLength = crane?.boomLength ?? 22;
  const pivot = crane?.pivot ?? { y: 2.1, z: 1.1 };

  const { length, width } = def.dimensions;

  // --- crawlers -------------------------------------------------------------
  for (const side of [-1, 1]) {
    const trackX = (side * (width - 1.15)) / 2;
    root.add(box(1.15, 1.15, length, darkMat, trackX, 0.58, 0));

    for (let i = 0; i < 5; i++) {
      const z = (i / 4 - 0.5) * (length - 1.4);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 12), steelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(trackX, 0.5, z);
      wheel.castShadow = true;
      root.add(wheel);
    }
  }

  // Carbody: the beam the crawlers hang off and the turntable sits on.
  root.add(box(width - 1.4, 0.8, 3.4, darkMat, 0, 1.0, 0));
  const turntable = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.34, 20), steelMat);
  turntable.position.y = 1.5;
  turntable.castShadow = true;
  root.add(turntable);

  // --- slewing superstructure ----------------------------------------------
  // Everything above the turntable turns as one, which is what makes the house
  // pointing somewhere other than the tracks the normal state of the machine.
  const house = new THREE.Group();
  house.name = 'craneHouse';
  house.position.y = 1.62;
  root.add(house);

  house.add(box(2.9, 1.5, 4.6, bodyMat, 0, 0.75, -0.6)); // machinery deck
  house.add(box(3.4, 1.0, 1.5, darkMat, 0, 0.5, -3.1)); // counterweight
  house.add(box(3.4, 0.9, 1.5, darkMat, 0, 1.45, -3.1));
  house.add(box(1.5, 1.7, 1.6, glassMat, -1.35, 1.35, 1.0)); // cab
  house.add(box(1.7, 0.14, 1.8, bodyMat, -1.35, 2.25, 1.0)); // cab roof

  // Hoist drums, so the rope visibly comes from somewhere.
  for (const z of [-1.4, -2.2]) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.2, 14), steelMat);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, 1.75, z);
    drum.castShadow = true;
    house.add(drum);
  }

  // A-frame gantry: what the boom's pendant ropes actually run over.
  for (const side of [-1, 1]) {
    const leg = box(0.18, 3.2, 0.18, steelMat, side * 0.9, 2.1, -1.9);
    leg.rotation.x = -0.22;
    house.add(leg);
  }
  house.add(box(2.1, 0.16, 0.16, steelMat, 0, 3.6, -1.55));

  // --- boom -----------------------------------------------------------------
  // Pivots about X at the boom foot. The sim swings the same boom about the
  // same pivot, so the head the rope hangs from is the head it computes.
  const boom = new THREE.Group();
  boom.name = 'craneBoom';
  boom.position.set(0, pivot.y - house.position.y, pivot.z);
  house.add(boom);

  const lattice = new THREE.Mesh(latticeGeometry(boomLength), steelMat);
  lattice.castShadow = true;
  boom.add(lattice);

  // Boom head sheaves. Also the node the renderer measures the rope from.
  const head = new THREE.Group();
  head.name = 'craneHead';
  head.position.z = boomLength;
  boom.add(head);

  for (const side of [-1, 1]) {
    const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 14), bodyMat);
    sheave.rotation.z = Math.PI / 2;
    sheave.position.set(side * 0.22, 0, 0);
    sheave.castShadow = true;
    head.add(sheave);
  }

  // --- rope and hook block --------------------------------------------------
  // Both live under the ROOT rather than under the boom: they hang plumb (and
  // swing) in world space, and parenting them to a boom that luffs would carry
  // them round with it. The view places them from the simulation each frame.
  const ropeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true);
  ropeGeo.translate(0, -0.5, 0); // hangs downward from its own origin
  const rope = new THREE.Mesh(ropeGeo, ropeMat);
  rope.name = 'craneRope';
  root.add(rope);

  const hook = new THREE.Group();
  hook.name = 'craneHook';
  hook.add(box(0.5, 0.62, 0.28, bodyMat, 0, 0.31, 0));
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.34, 8), steelMat);
  shank.position.y = -0.15;
  shank.castShadow = true;
  hook.add(shank);
  const bill = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 6, 12, Math.PI * 1.5), steelMat);
  bill.position.y = -0.5;
  bill.rotation.y = Math.PI / 2;
  bill.castShadow = true;
  hook.add(bill);
  root.add(hook);

  return { root, craneHouse: house, craneBoom: boom, craneHead: head, craneRope: rope, craneHook: hook };
}

/**
 * One merged geometry for the whole lattice: four chords and their bracing.
 *
 * Runs along +Z from the boom foot, which is the axis the simulation's
 * `boomLength` measures along.
 */
function latticeGeometry(length: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = CHORD_SPACING / 2;
  const bays = Math.max(1, Math.round(length / BAY));
  const bay = length / bays;

  const push = (geo: THREE.BufferGeometry, m: THREE.Matrix4): void => {
    geo.applyMatrix4(m);
    parts.push(geo);
  };
  const at = (x: number, y: number, z: number): THREE.Matrix4 =>
    new THREE.Matrix4().makeTranslation(x, y, z);

  // Chords: the four long tubes that actually carry the load.
  for (const x of [-half, half]) {
    for (const y of [-half, half]) {
      push(new THREE.BoxGeometry(0.13, 0.13, length), at(x, y, length / 2));
    }
  }

  // Bracing: a zig-zag down each of the four faces, cheap and legible.
  const braceLength = Math.hypot(bay, CHORD_SPACING);
  const tilt = Math.atan2(CHORD_SPACING, bay);
  for (let i = 0; i < bays; i++) {
    const z = (i + 0.5) * bay;
    const flip = i % 2 === 0 ? 1 : -1;

    for (const x of [-half, half]) {
      const brace = new THREE.BoxGeometry(0.07, 0.07, braceLength);
      const m = new THREE.Matrix4()
        .makeRotationX(flip * tilt)
        .premultiply(at(x, 0, z));
      push(brace, m);
    }
    for (const y of [-half, half]) {
      const brace = new THREE.BoxGeometry(0.07, 0.07, braceLength);
      const m = new THREE.Matrix4()
        .makeRotationY(flip * tilt)
        .premultiply(at(0, y, z));
      push(brace, m);
    }
    // Ring at each bay joint, which is what makes it read as sections.
    push(new THREE.BoxGeometry(CHORD_SPACING, 0.08, 0.08), at(0, half, i * bay));
    push(new THREE.BoxGeometry(CHORD_SPACING, 0.08, 0.08), at(0, -half, i * bay));
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('Failed to merge crane lattice geometry');
  return merged;
}
