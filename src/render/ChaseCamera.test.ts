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

  it('switching modes does not move the camera', () => {
    const cam = new ChaseCamera(stubElement());
    settle(cam, at(0, 0));
    const before = cam.camera.position.clone();

    cam.cycleMode();
    cam.update(1 / 60, at(0, 0), 0, FLAT);
    expect(cam.mode).toBe('fixed');
    expect(cam.camera.position.distanceTo(before)).toBeLessThan(1e-6);
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
    // thing that can have changed is where it points.
    expect(panned.angleTo(straightOn)).toBeGreaterThan(0.3);
  });

  it('slides once the machine pulls past the leash', () => {
    const cam = new ChaseCamera(stubElement());
    settle(cam, at(0, 0));
    cam.setMode('fixed');
    cam.update(1 / 60, at(0, 0), 0, FLAT);
    const planted = cam.camera.position.clone();

    settle(cam, at(0, 60), 900);
    expect(cam.camera.position.distanceTo(planted)).toBeGreaterThan(20);
    // And it caught up: never further off than the leash plus the zoom distance.
    expect(cam.camera.position.distanceTo(cab(0, 60))).toBeLessThan(12 + 16 + 1);
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
