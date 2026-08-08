/**
 * ChaseCamera — follows the active machine (FR-6.1).
 *
 * Replaces OrbitControls: orbiting a fixed origin is wrong once something is
 * driving around.
 *
 * The angle you choose is the angle you keep. Racing games swing the camera
 * back behind the car automatically, and that instinct is wrong for this game:
 * here you are watching a machine do work, and the whole point of orbiting to
 * a side view is to watch the blade move soil from that side. A camera that
 * creeps back to centre fights the player every time they line up a shot.
 *
 * The offset is held relative to the machine's HEADING, not to the world, so
 * a side view stays a side view when the dozer turns. `recenter()` (C) eases
 * back behind, and is the only thing that ever moves the angle on its own.
 */

import * as THREE from 'three';
import type { Vec3 } from '../sim/math/Vec';

/** Frame-rate independent exponential smoothing. */
function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

const MIN_PITCH = 0.06;
const MAX_PITCH = 1.35;
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 90;
/** How briskly `recenter()` swings back behind the machine. */
const RECENTER_RATE = 7;

/** Wrap to (-pi, pi] so recentring always takes the short way round. */
function wrapPi(a: number): number {
  const twoPi = Math.PI * 2;
  let r = ((a + Math.PI) % twoPi + twoPi) % twoPi;
  return r - Math.PI;
}

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private yawOffset = 0;
  private pitch = 0.44;
  private distance = 16;

  private readonly lookAt = new THREE.Vector3();
  private readonly domElement: HTMLElement;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private recentering = false;
  private initialised = false;

  constructor(domElement: HTMLElement, aspect = 1) {
    this.domElement = domElement;
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.3, 2000);

    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('pointerup', this.onPointerUp);
    domElement.addEventListener('pointercancel', this.onPointerUp);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    domElement.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Ease back behind the machine. The only thing that moves the angle on its own. */
  recenter(): void {
    this.recentering = true;
  }

  update(
    dt: number,
    position: Vec3,
    heading: number,
    groundHeightAt: (x: number, z: number) => number,
  ): void {
    if (this.recentering) {
      this.yawOffset = damp(this.yawOffset, 0, RECENTER_RATE, dt);
      if (Math.abs(this.yawOffset) < 0.002) {
        this.yawOffset = 0;
        this.recentering = false;
      }
    }

    // Look slightly above the origin — at the cab, not the tracks.
    const focusX = position.x;
    const focusY = position.y + 1.7;
    const focusZ = position.z;

    if (!this.initialised) {
      this.lookAt.set(focusX, focusY, focusZ);
      this.initialised = true;
    } else {
      this.lookAt.set(
        damp(this.lookAt.x, focusX, 9, dt),
        damp(this.lookAt.y, focusY, 5, dt),
        damp(this.lookAt.z, focusZ, 9, dt),
      );
    }

    const yaw = heading + this.yawOffset;
    const horizontal = this.distance * Math.cos(this.pitch);

    let camX = this.lookAt.x - Math.sin(yaw) * horizontal;
    let camZ = this.lookAt.z - Math.cos(yaw) * horizontal;
    let camY = this.lookAt.y + this.distance * Math.sin(this.pitch);

    // Never let a hill swallow the camera.
    const floor = groundHeightAt(camX, camZ) + 1.2;
    if (camY < floor) camY = floor;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.lookAt);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('pointercancel', this.onPointerUp);
    this.domElement.removeEventListener('wheel', this.onWheel);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    // Taking hold of the camera cancels an in-flight recentre.
    this.recentering = false;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.domElement.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;

    this.yawOffset = wrapPi(this.yawOffset - dx * 0.006);
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dy * 0.005));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.domElement.hasPointerCapture(event.pointerId)) {
      this.domElement.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0012);
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.distance * factor));
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
