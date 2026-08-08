/**
 * Track marks and churned ground.
 *
 * The point of these is mostly the negative claim: disturbance is a SURFACE
 * property and must never touch soil volume. Doing marks as a height change
 * would look right and quietly break FR-3.5.
 */

import { describe, expect, it } from 'vitest';
import { bulldozerDef } from '../content/vehicles/bulldozer.def';
import { Action, type ActionState } from './input/actions';
import { MaterialId } from './materials';
import { Terrain } from './Terrain';
import { Vehicle } from './vehicle/Vehicle';
import { World } from './World';

const STEP = 1 / 60;

function world(material = MaterialId.GRASS): World {
  const terrain = new Terrain(160, 160, 0.5);
  terrain.material.fill(material);
  terrain.height.fill(1);
  const w = new World(terrain);
  w.addVehicle(new Vehicle(bulldozerDef, { position: { x: 0, z: -20 }, heading: 0 }));
  return w;
}

function run(w: World, input: ActionState, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) w.step(STEP, input);
}

const drive: ActionState = { [Action.ThrottleForward]: 1, bladeRaise: 1 };

function disturbedCells(w: World): number {
  let n = 0;
  for (const d of w.terrain.disturbance) if (d > 0) n++;
  return n;
}

describe('disturbance', () => {
  it('starts clean', () => {
    expect(disturbedCells(world())).toBe(0);
  });

  it('lays track marks as the machine drives', () => {
    const w = world();
    run(w, drive, 4);
    expect(disturbedCells(w)).toBeGreaterThan(40);
  });

  it('lays none while parked', () => {
    const w = world();
    run(w, { bladeRaise: 1 }, 3);
    expect(disturbedCells(w)).toBe(0);
  });

  it('leaves a continuous trail, not a dotted one', () => {
    const w = world();
    run(w, drive, 4);
    const t = w.terrain;

    // Walk the path the machine took and confirm no gap along it.
    const cx = Math.round(t.worldToCellX(0));
    let gaps = 0;
    let inTrail = false;
    for (let cz = Math.round(t.worldToCellZ(-19)); cz < Math.round(t.worldToCellZ(-14)); cz++) {
      // Either track counts: sample across the machine's width.
      let marked = false;
      for (let dx = -4; dx <= 4; dx++) {
        if (t.disturbance[t.index(cx + dx, cz)] > 0) marked = true;
      }
      if (marked) inTrail = true;
      else if (inTrail) gaps++;
    }
    expect(gaps).toBe(0);
  });

  it('never changes soil volume (FR-3.5)', () => {
    const w = world();
    const before = w.terrain.totalVolume();
    run(w, drive, 6);
    expect(w.terrain.totalVolume()).toBeCloseTo(before, 6);
  });

  it('never changes terrain height at all when only driving', () => {
    const w = world();
    const before = Float32Array.from(w.terrain.height);
    run(w, drive, 6);
    for (let i = 0; i < before.length; i++) expect(w.terrain.height[i]).toBe(before[i]);
  });

  it('marks freshly cut ground as fully churned', () => {
    const w = world(MaterialId.SAND);
    run(w, { [Action.ThrottleForward]: 1, bladeLower: 1 }, 4);
    let maxed = 0;
    for (const d of w.terrain.disturbance) if (d === 255) maxed++;
    expect(maxed).toBeGreaterThan(20);
  });

  it('only ever increases — ground does not un-churn', () => {
    const t = new Terrain(16, 16, 0.5);
    t.disturb(4, 4, 200);
    t.disturb(4, 4, 50);
    expect(t.disturbance[t.index(4, 4)]).toBe(200);
  });

  it('clamps to the 0..255 byte range', () => {
    const t = new Terrain(16, 16, 0.5);
    t.disturb(1, 1, 9999);
    t.disturb(2, 2, -50);
    expect(t.disturbance[t.index(1, 1)]).toBe(255);
    expect(t.disturbance[t.index(2, 2)]).toBe(0);
  });

  it('does not re-dirty terrain when driving over ground already churned', () => {
    const t = new Terrain(16, 16, 0.5);
    t.disturb(4, 4, 200);
    t.consumeDirty();
    t.disturb(4, 4, 120);
    expect(t.consumeDirty()).toBeNull();
  });
});
