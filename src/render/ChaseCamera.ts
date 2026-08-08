/**
 * ChaseCamera — follows the active machine (FR-6.1).
 *
 * Replaces OrbitControls: orbiting a fixed origin is wrong once something is
 * driving around. Drag orbits *around the vehicle*, wheel zooms, and the view
 * eases back behind the machine on its own once you're moving and have let go.
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
/** Grace period after a drag before the camera starts swinging back. */
const REALIGN_DELAY = 0.7;

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
  private sinceDrag = REALIGN_DELAY;
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

  /** Snap straight behind the machine, no easing. */
  recenter(): void {
    this.yawOffset = 0;
    this.sinceDrag = REALIGN_DELAY;
  }

  update(
    dt: number,
    position: Vec3,
    heading: number,
    speed: number,
    groundHeightAt: (x: number, z: number) => number,
  ): void {
    this.sinceDrag += dt;

    // Ease back behind the machine, but only while it's actually moving and
    // the player isn't steering the camera themselves.
    if (!this.dragging && this.sinceDrag > REALIGN_DELAY && Math.abs(speed) > 0.4) {
      this.yawOffset = damp(this.yawOffset, 0, 1.6, dt);
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

    this.yawOffset -= dx * 0.006;
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dy * 0.005));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.sinceDrag = 0;
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
