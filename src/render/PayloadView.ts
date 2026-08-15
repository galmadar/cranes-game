/**
 * Loads and the pads they belong on.
 *
 * Two jobs in one file because they answer the same question — "where does
 * this go?" — and the answer only works if the load and its pad read as a
 * matched pair. A pad is coloured by the load it accepts, and it goes quiet
 * once that load is standing on it: the same idea as the grading overlay
 * fading out as the pad comes to grade. Completion is something you see stop
 * being asked for, not something a banner tells you about.
 */

import * as THREE from 'three';
import type { LiftProgress, LiftTarget } from '../sim/payload/LiftJob';
import type { Payload, PayloadKind } from '../sim/payload/Payload';
import type { Terrain } from '../sim/Terrain';

/** One colour per kind, shared by the load and its pad. */
const KIND_COLOR: Record<PayloadKind, number> = {
  beam: 0xd8563f,
  pipe: 0x3f8fd8,
  crate: 0xd8a83f,
  block: 0x9a8f80,
};

/** How high the pad markers stand, metres. Visible from across the yard. */
const MARKER_HEIGHT = 3.4;

function srgb(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

/** Every load in the world, kept in step with the simulation. */
export class PayloadView {
  readonly object = new THREE.Group();

  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(payloads: readonly Payload[]) {
    this.object.name = 'payloads';

    for (const payload of payloads) {
      const mesh = this.build(payload);
      this.meshes.set(payload.id, mesh);
      this.object.add(mesh);
    }
  }

  sync(payloads: readonly Payload[]): void {
    for (const payload of payloads) {
      const mesh = this.meshes.get(payload.id);
      if (!mesh) continue;
      mesh.position.set(payload.position.x, payload.position.y, payload.position.z);
      mesh.rotation.y = payload.yaw;
    }
  }

  private build(payload: Payload): THREE.Object3D {
    const { size, kind } = payload.spec;
    const color = KIND_COLOR[kind];

    const group = new THREE.Group();
    group.name = payload.id;

    const material = new THREE.MeshStandardMaterial({
      color: srgb(color),
      roughness: kind === 'pipe' ? 0.35 : 0.72,
      metalness: kind === 'pipe' ? 0.6 : 0.18,
    });
    this.materials.push(material);

    // A pipe is round, everything else is a box. Shape is the fastest way to
    // tell one load from another at fifty metres.
    const body =
      kind === 'pipe'
        ? new THREE.CylinderGeometry(size.x / 2, size.x / 2, size.z, 16)
        : new THREE.BoxGeometry(size.x, size.y, size.z);
    if (kind === 'pipe') body.rotateX(Math.PI / 2); // lie it down along +Z
    this.geometries.push(body);

    const mesh = new THREE.Mesh(body, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Lifting lug on top, so where the hook has to go is a thing you can see.
    const lugGeo = new THREE.TorusGeometry(0.22, 0.06, 6, 12);
    const lugMat = new THREE.MeshStandardMaterial({
      color: srgb(0x2a2d33),
      roughness: 0.5,
      metalness: 0.7,
    });
    this.geometries.push(lugGeo);
    this.materials.push(lugMat);
    const lug = new THREE.Mesh(lugGeo, lugMat);
    lug.position.y = size.y / 2 + 0.18;
    lug.castShadow = true;
    group.add(lug);

    return group;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

/**
 * The pads, staked out on the ground.
 *
 * Flat markings alone are useless — you cannot see them from the cab of a
 * machine with a 22 m boom, which is exactly where the player is. So each pad
 * gets a vertical beacon as well, on the same reasoning as the grade plane's
 * corner stakes: a thing you have to already be standing on to find is not a
 * marker.
 */
export class LiftTargetView {
  readonly object = new THREE.Group();

  private readonly beacons = new Map<string, THREE.Object3D>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(terrain: Terrain, targets: readonly LiftTarget[]) {
    this.object.name = 'liftTargets';

    for (const target of targets) {
      const color = srgb(KIND_COLOR[target.accepts]);
      const y = terrain.sampleHeight(target.x, target.z);

      const group = new THREE.Group();
      group.position.set(target.x, y, target.z);
      group.rotation.y = target.yaw;

      const ringGeo = new THREE.RingGeometry(target.radius - 0.18, target.radius, 32);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        // The pad is painted ON the hardstand; without this it z-fights the
        // very ground it is describing.
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      this.geometries.push(ringGeo);
      this.materials.push(ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.02;
      group.add(ring);

      // A bar along the target bearing. Position is half the job; a beam laid
      // across its pad instead of along it is not placed, and the player has to
      // be able to see which way "along" is.
      const barGeo = new THREE.PlaneGeometry(0.3, target.radius * 1.7);
      barGeo.rotateX(-Math.PI / 2);
      this.geometries.push(barGeo);
      const bar = new THREE.Mesh(barGeo, ringMat);
      bar.position.y = 0.02;
      group.add(bar);

      const beaconGeo = new THREE.CylinderGeometry(0.09, 0.09, MARKER_HEIGHT, 6);
      const beaconMat = new THREE.MeshBasicMaterial({ color, fog: false });
      this.geometries.push(beaconGeo);
      this.materials.push(beaconMat);
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(0, MARKER_HEIGHT / 2, 0);
      group.add(beacon);
      this.beacons.set(target.id, beacon);

      this.object.add(group);
    }
  }

  /** Drop the beacon on a pad that is done, so only open work stands up. */
  sync(progress: LiftProgress): void {
    for (const status of progress.statuses) {
      const beacon = this.beacons.get(status.target.id);
      if (beacon) beacon.visible = !status.placed;
    }
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
