/**
 * Excavator mesh — procedural primitives only (NFR-7).
 *
 * Local space: +Z is forward, +Y is up, origin sits on the ground line.
 *
 * The arm is built as a CHAIN of nested groups — house, boom, stick, bucket —
 * each pivoting at the joint the simulation rotates it about, with the next
 * link parented at the end of the previous one. Posing it is then four numbers
 * and no trigonometry, and the teeth you can see are the teeth that dig,
 * because both are the same composition of the same angles.
 *
 * Local space: +Z is forward, +Y is up, origin sits on the ground line.
 */

import * as THREE from 'three';
import type { VehicleParts } from '../../render/VehicleView';
import type { VehicleDefinition } from '../../sim/vehicle/types';
import { ARM_ID } from './excavator.def';

const ORANGE = 0xe2711d;
const DARK = 0x23262b;
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

/** A tapered link lying along +Z, pinned at its own origin. */
function link(length: number, thick: number, material: THREE.Material): THREE.Mesh {
  const mesh = box(thick, thick * 1.25, length, material, 0, 0, length / 2);
  return mesh;
}

export function buildExcavator(def: VehicleDefinition): VehicleParts {
  const root = new THREE.Group();
  root.name = def.id;

  const bodyMat = mat(ORANGE);
  const darkMat = mat(DARK, 0.85, 0.1);
  const steelMat = mat(STEEL, 0.45, 0.6);
  const glassMat = mat(GLASS, 0.2, 0.3);

  const spec = def.implements.find((i) => i.id === ARM_ID);
  const arm = spec?.kind === 'excavator' ? spec : undefined;
  const pivot = arm?.pivot ?? { y: 1.9, z: 1.0 };
  const boomLength = arm?.boomLength ?? 5;
  const stickLength = arm?.stickLength ?? 3.1;
  const bucketLength = arm?.bucketLength ?? 1.15;
  const bucketWidth = arm?.bucketWidth ?? 1.4;

  const { length, width } = def.dimensions;

  // --- crawlers -------------------------------------------------------------
  for (const side of [-1, 1]) {
    const trackX = (side * (width - 0.9)) / 2;
    root.add(box(0.9, 0.9, length, darkMat, trackX, 0.45, 0));
    for (let i = 0; i < 4; i++) {
      const z = (i / 3 - 0.5) * (length - 1.2);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.55, 12), steelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(trackX, 0.4, z);
      wheel.castShadow = true;
      root.add(wheel);
    }
  }
  root.add(box(width - 1.2, 0.5, 2.8, darkMat, 0, 1.05, 0));

  // --- slewing house --------------------------------------------------------
  const house = new THREE.Group();
  house.name = 'armHouse';
  house.position.y = 1.3;
  root.add(house);

  house.add(box(2.5, 1.2, 3.2, bodyMat, 0, 0.6, -0.5)); // engine deck
  house.add(box(2.6, 0.85, 0.9, darkMat, 0, 0.45, -2.0)); // counterweight
  house.add(box(1.25, 1.5, 1.4, glassMat, -0.65, 1.0, 0.9)); // cab
  house.add(box(1.4, 0.12, 1.55, bodyMat, -0.65, 1.8, 0.9)); // cab roof

  // --- the arm: boom -> stick -> bucket, each pinned at its own joint --------
  const boom = new THREE.Group();
  boom.name = 'armBoom';
  boom.position.set(0, pivot.y - house.position.y, pivot.z);
  house.add(boom);
  boom.add(link(boomLength, 0.45, bodyMat));

  const stick = new THREE.Group();
  stick.name = 'armStick';
  stick.position.z = boomLength;
  boom.add(stick);
  stick.add(link(stickLength, 0.34, bodyMat));

  const bucket = new THREE.Group();
  bucket.name = 'armBucket';
  bucket.position.z = stickLength;
  stick.add(bucket);

  // A back, two cheeks and a row of teeth — enough that the open side reads,
  // which is what makes curling out look like tipping rather than like nothing.
  bucket.add(box(bucketWidth, 0.72, 0.2, steelMat, 0, 0.28, bucketLength * 0.35));
  for (const side of [-1, 1]) {
    bucket.add(
      box(0.1, 0.72, bucketLength, steelMat, (side * bucketWidth) / 2, 0.28, bucketLength / 2),
    );
  }
  bucket.add(box(bucketWidth, 0.16, bucketLength, steelMat, 0, -0.06, bucketLength / 2));
  for (let i = 0; i < 4; i++) {
    const x = ((i / 3) * 2 - 1) * (bucketWidth / 2 - 0.14);
    bucket.add(box(0.12, 0.1, 0.28, darkMat, x, -0.06, bucketLength + 0.1));
  }

  return { root, armHouse: house, armBoom: boom, armStick: stick, armBucket: bucket };
}
