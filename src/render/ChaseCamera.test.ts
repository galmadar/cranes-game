/**
 * The camera has no visual test harness, so the two claims that matter are
 * asserted here: a fixed camera really stands still, and switching modes
 * really does not move the picture.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ChaseCamera } from './ChaseCamera';

/** Enough of an element for the camera's listeners. No DOM needed. */
function stubElement(): HTMLElement {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
  } as unknown as HTMLElement;
}

const FLAT = (): number => 0;
/** Mirrors the locked view's defaults, which the class keeps private. */
const LEASH = 12;
const LOCKED_STANDOFF = 34;
const at = (x: number, z: number) => ({ x, y: 0, z });
/** What the camera is framing, at the same height the camera aims for. */
const cab = (x: number, z: number) => new THREE.Vector3(x, 1.7, z);

function settle(cam: ChaseCamera, pos: { x: number; y: number; z: number }, steps = 120): void {
  for (let i = 0; i < steps; i++) cam.update(1 / 60, pos, 0, FLAT);
}

describe('ChaseCamera modes', () => {
  it('starts chasing', () => {
    const cam = new ChaseCamera(stubElement());
    expect(cam.mode).toBe('chase');
  });

  it('cycles through every view and back to the start', () => {
    const cam = new ChaseCamera(stubElement());
    const seen = [cam.mode];
    for (let i = 0; i < 3; i++) seen.push(cam.cycleMode());
    expect(new Set(seen).size).toBe(4);
    expect(cam.cycleMode()).toBe('chase');
  });

  it('switching views keeps the bearing, so the player never gets spun round', () => {
    const cam = new ChaseCamera(stubElement());
    settle(cam, at(0, 0));
    const bearing = (): number =>
      Math.atan2(cam.camera.position.x - 0, cam.camera.position.z - 0);
    const before = bearing();

    // Framing changes between views by design; which way you are looking must not.
    for (let i = 0; i < 4; i++) {
      cam.cycleMode();
      cam.update(1 / 60, at(0, 0), 0, FLAT);
      expect(Math.abs(bearing() - before)).toBeLessThan(1e-6);
    }
  });

  it('holds position while the machine moves inside the leash', () => {
    const cam = new ChaseCamera(stubElement());
    settle(cam, at(0, 0));
    cam.setMode('fixed');
    cam.update(1 / 60, at(0, 0), 0, FLAT);
    const planted = cam.camera.position.clone();

    // 8 m of driving, well inside the 12 m leash.
    settle(cam, at(0, 8));
    expect(cam.camera.position.distanceTo(planted)).toBeLessThan(1e-6);
  });

  it('pans to keep tracking while standing still', () => {
    const cam = new ChaseCamera(stubElement());
    settle(cam, at(0, 0));
    cam.setMode('fixed');
    const straightOn = cam.camera.getWorldDirection(new THREE.Vector3());

    settle(cam, at(8, 0));
    const panned = cam.camera.getWorldDirection(new THREE.Vector3());

    // The camera did not move, so if it is still framing the machine the only
    // thing that can have changed is where it points. How far it swings for a
    // given 8 m depends on how far back the locked view sits.
    expect(panned.angleTo(straightOn)).toBeGreaterThan(0.2);
  });

  it('slides once the machine pulls past the leash', () => {
    const cam = new ChaseCamera(stubElement());
    settle(cam, at(0, 0));
    cam.setMode('fixed');
    cam.update(1 / 60, at(0, 0), 0, FLAT);
    const planted = cam.camera.position.clone();

    settle(cam, at(0, 60), 900);
    expect(cam.camera.position.distanceTo(planted)).toBeGreaterThan(20);
    // And it caught up: never further off than the leash plus the view's own
    // standoff, which is what the leash is for.
    expect(cam.camera.position.distanceTo(cab(0, 60))).toBeLessThan(LEASH + LOCKED_STANDOFF + 1);
  });

  it('chase mode keeps a constant distance instead', () => {
    const cam = new ChaseCamera(stubElement());
    settle(cam, at(0, 0));
    const near = cam.camera.position.distanceTo(cab(0, 0));

    settle(cam, at(0, 40), 600);
    const far = cam.camera.position.distanceTo(cab(0, 40));
    expect(Math.abs(far - near)).toBeLessThan(0.5);
  });
});
