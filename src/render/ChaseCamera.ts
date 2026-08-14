/**
 * ChaseCamera — follows the active machine (FR-6.1), in one of several views.
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
 * The views differ in exactly two ways, and everything else is shared. A view
 * holds its yaw either relative to the machine's HEADING — so a side view stays
 * a side view when the dozer turns — or relative to the WORLD, which is what
 * makes a camera stand still and pan to track, like a broadcast camera on a
 * tripod. And a world-framed view carries a leash: it drifts only once the
 * machine pulls past it. Same gesture, different frame of reference.
 */

import * as THREE from 'three';
import type { Vec3 } from '../sim/math/Vec';

export type CameraMode = 'chase' | 'fixed' | 'cab' | 'top';

interface View {
  label: string;
  /** Which frame the yaw is held in. World-relative is what stands the camera still. */
  frame: 'heading' | 'world';
  distance: number;
  pitch: number;
  /** Metres the machine may stray before the camera gives up and follows. */
  leash: number;
  /** How far ahead of the machine to aim, metres. The blade is not the cab. */
  focusAhead: number;
}

/**
 * The cycle, in order.
 *
 * Deliberately a list rather than a pair: the ask was to toggle BETWEEN views,
 * and a boolean can only ever hold two. Adding one is a line here.
 */
const VIEWS: Record<CameraMode, View> = {
  chase: { label: 'Chase · follows', frame: 'heading', distance: 16, pitch: 0.44, leash: 0, focusAhead: 0 },
  fixed: { label: 'Fixed · locked', frame: 'world', distance: 34, pitch: 0.3, leash: 12, focusAhead: 0 },
  cab: { label: 'Cab · over the blade', frame: 'heading', distance: 8, pitch: 0.3, leash: 0, focusAhead: 3.2 },
  top: { label: 'Top · reads grade', frame: 'heading', distance: 30, pitch: 1.15, leash: 0, focusAhead: 0 },
};

const ORDER: readonly CameraMode[] = ['chase', 'fixed', 'cab', 'top'];

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
/** How lazily the tripod slides once the leash is taut. Slow enough to read as drift. */
const LEASH_RATE = 2.2;

/** Wrap to (-pi, pi] so recentring always takes the short way round. */
function wrapPi(a: number): number {
  const twoPi = Math.PI * 2;
  const r = (((a + Math.PI) % twoPi) + twoPi) % twoPi;
  return r - Math.PI;
}

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private mode_: CameraMode = 'chase';

  /** Heading-framed views: yaw relative to the machine. */
  private yawOffset = 0;
  /** World-framed views: yaw relative to the world, which is what stands still. */
  private worldYaw = 0;

  /**
   * Zoom and elevation, remembered per view.
   *
   * Shared state would mean framing the cab view close ruined the locked view
   * you had set up, and you would stop switching.
   */
  private readonly framing: Record<CameraMode, { distance: number; pitch: number }>;

  /** What the camera points at. */
  private readonly lookAt = new THREE.Vector3();
  /** What a world-framed view orbits. Decoupling this from `lookAt` is the mode. */
  private readonly anchor = new THREE.Vector3();
  private lastHeading = 0;

  private readonly domElement: HTMLElement;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private recentering = false;
  private initialised = false;

  constructor(domElement: HTMLElement, aspect = 1) {
    this.domElement = domElement;
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.3, 2000);

    this.framing = Object.fromEntries(
      ORDER.map((m) => [m, { distance: VIEWS[m].distance, pitch: VIEWS[m].pitch }]),
    ) as Record<CameraMode, { distance: number; pitch: number }>;

    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('pointerup', this.onPointerUp);
    domElement.addEventListener('pointercancel', this.onPointerUp);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    domElement.addEventListener('contextmenu', this.onContextMenu);
  }

  get mode(): CameraMode {
    return this.mode_;
  }

  get modeLabel(): string {
    return VIEWS[this.mode_].label;
  }

  /** Step to the next view in the cycle. */
  cycleMode(): CameraMode {
    const next = ORDER[(ORDER.indexOf(this.mode_) + 1) % ORDER.length];
    this.setMode(next);
    return this.mode_;
  }

  /**
   * Switching never spins the picture. Converting the yaw between frames of
   * reference costs one line and saves the player re-finding their bearing.
   */
  setMode(mode: CameraMode): void {
    if (mode === this.mode_) return;
    const wasWorld = VIEWS[this.mode_].frame === 'world';
    const isWorld = VIEWS[mode].frame === 'world';

    if (isWorld && !wasWorld) {
      this.worldYaw = wrapPi(this.lastHeading + this.yawOffset);
      this.anchor.copy(this.lookAt);
    } else if (!isWorld && wasWorld) {
      this.yawOffset = wrapPi(this.worldYaw - this.lastHeading);
    }

    this.recentering = false;
    this.mode_ = mode;
  }

  /** Ease back behind the machine. The only thing that moves the angle on its own. */
  recenter(): void {
    if (VIEWS[this.mode_].frame === 'world') {
      // Nothing to ease — re-plant the tripod behind the machine instead.
      this.worldYaw = this.lastHeading;
      this.anchor.copy(this.lookAt);
      return;
    }
    this.recentering = true;
  }

  update(
    dt: number,
    position: Vec3,
    heading: number,
    groundHeightAt: (x: number, z: number) => number,
  ): void {
    this.lastHeading = heading;
    const view = VIEWS[this.mode_];
    const framing = this.framing[this.mode_];

    // Look slightly above the origin — at the cab, not the tracks — and, for
    // views that ask for it, ahead of the machine at the work itself.
    const focusX = position.x + Math.sin(heading) * view.focusAhead;
    const focusY = position.y + 1.7;
    const focusZ = position.z + Math.cos(heading) * view.focusAhead;

    if (!this.initialised) {
      this.lookAt.set(focusX, focusY, focusZ);
      this.anchor.copy(this.lookAt);
      this.initialised = true;
    } else {
      this.lookAt.set(
        damp(this.lookAt.x, focusX, 9, dt),
        damp(this.lookAt.y, focusY, 5, dt),
        damp(this.lookAt.z, focusZ, 9, dt),
      );
    }

    let yaw: number;
    let pivot: THREE.Vector3;
    if (view.frame === 'world') {
      yaw = this.worldYaw;
      pivot = this.updateAnchor(dt, view.leash, groundHeightAt);
    } else {
      if (this.recentering) {
        this.yawOffset = damp(this.yawOffset, 0, RECENTER_RATE, dt);
        if (Math.abs(this.yawOffset) < 0.002) {
          this.yawOffset = 0;
          this.recentering = false;
        }
      }
      yaw = heading + this.yawOffset;
      pivot = this.lookAt;
    }

    const horizontal = framing.distance * Math.cos(framing.pitch);
    const camX = pivot.x - Math.sin(yaw) * horizontal;
    const camZ = pivot.z - Math.cos(yaw) * horizontal;
    let camY = pivot.y + framing.distance * Math.sin(framing.pitch);

    // Never let a hill swallow the camera.
    const floor = groundHeightAt(camX, camZ) + 1.2;
    if (camY < floor) camY = floor;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.lookAt);
  }

  /** Drag the tripod's subject point along, but only once the leash is taut. */
  private updateAnchor(
    dt: number,
    leash: number,
    groundHeightAt: (x: number, z: number) => number,
  ): THREE.Vector3 {
    const dx = this.lookAt.x - this.anchor.x;
    const dz = this.lookAt.z - this.anchor.z;
    const away = Math.hypot(dx, dz);
    if (away > leash) {
      const k = (away - leash) / away;
      this.anchor.x = damp(this.anchor.x, this.anchor.x + dx * k, LEASH_RATE, dt);
      this.anchor.z = damp(this.anchor.z, this.anchor.z + dz * k, LEASH_RATE, dt);
      // Follow the ground it slid over, or the camera sinks into a rise.
      this.anchor.y = damp(
        this.anchor.y,
        groundHeightAt(this.anchor.x, this.anchor.z) + 1.7,
        LEASH_RATE,
        dt,
      );
    }
    return this.anchor;
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

    if (VIEWS[this.mode_].frame === 'world') {
      this.worldYaw = wrapPi(this.worldYaw - dx * 0.006);
    } else {
      this.yawOffset = wrapPi(this.yawOffset - dx * 0.006);
    }
    const framing = this.framing[this.mode_];
    framing.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, framing.pitch + dy * 0.005));
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
    const framing = this.framing[this.mode_];
    framing.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, framing.distance * factor));
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
