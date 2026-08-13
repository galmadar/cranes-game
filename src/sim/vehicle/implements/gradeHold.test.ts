/**
 * Automatic grade control.
 *
 * The manual blade lever sets height relative to the MACHINE's ground line, so
 * the number you need changes every second as the tracks climb over ground you
 * already cut. Holding a flat pad by hand is arithmetic, not dozing — which is
 * exactly what the player reported.
 *
 * Grade hold servos the cutting edge to an ELEVATION instead, and the last test
 * here is the one that matters: a machine driven with no blade input at all,
 * only the hold toggle, has to be able to finish the contract.
 */

import { describe, expect, it } from 'vitest';
import { createPadLevelJob } from '../../../content/jobs/padLevel';
import { sandboxMap } from '../../../content/maps/sandbox';
import { bulldozerDef } from '../../../content/vehicles/bulldozer.def';
import { Action, type ActionState } from '../../input/actions';
import { JobRunner } from '../../job/JobRunner';
import { targetAt } from '../../job/JobSite';
import { MaterialId } from '../../materials';
import { Terrain } from '../../Terrain';
import { World } from '../../World';
import { Vehicle } from '../Vehicle';
import type { BladeState } from '../types';
import { NO_GRADE, type GradeQuery } from './Implement';

const STEP = 1 / 60;
const HOLD = 'bladeGradeHold';
const RAISE = 'bladeRaise';

const SPAWN = { position: { x: 0, z: 0 }, heading: 0 };
const TAP: ActionState = { [HOLD]: 1 };
const FORWARD: ActionState = { [Action.ThrottleForward]: 1 };

function blade(v: Vehicle): BladeState {
  const s = v.state.implementStates['blade'];
  if (!s || s.kind !== 'blade') throw new Error('no blade');
  return s;
}

/** A press-and-release, so the toggle's edge detector sees a full cycle. */
function tapHold(v: Vehicle, terrain: Terrain, grade: GradeQuery = NO_GRADE): void {
  v.update(STEP, TAP, terrain, grade);
  v.update(STEP, {}, terrain, grade);
}

function drive(
  v: Vehicle,
  terrain: Terrain,
  input: ActionState,
  seconds: number,
  grade: GradeQuery = NO_GRADE,
): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) v.update(STEP, input, terrain, grade);
}

function flat(height = 0, material: MaterialId = MaterialId.ROCK): Terrain {
  const t = new Terrain(200, 200, 0.5);
  t.material.fill(material);
  t.height.fill(height);
  return t;
}

describe('the hold toggle', () => {
  it('starts off', () => {
    expect(blade(new Vehicle(bulldozerDef, SPAWN)).gradeHold).toBe(false);
  });

  it('turns on and off again on successive taps', () => {
    const t = flat();
    const v = new Vehicle(bulldozerDef, SPAWN);
    tapHold(v, t);
    expect(blade(v).gradeHold).toBe(true);
    tapHold(v, t);
    expect(blade(v).gradeHold).toBe(false);
  });

  it('does not re-toggle while the key is simply held down', () => {
    const t = flat();
    const v = new Vehicle(bulldozerDef, SPAWN);
    for (let i = 0; i < 60; i++) v.update(STEP, TAP, t);
    expect(blade(v).gradeHold).toBe(true);
  });

  it('is cancelled by any manual blade input', () => {
    const t = flat();
    const v = new Vehicle(bulldozerDef, SPAWN);
    tapHold(v, t);
    expect(blade(v).gradeHold).toBe(true);

    v.update(STEP, { [RAISE]: 1 }, t);
    // A servo the player is silently fighting is the worst of both modes.
    expect(blade(v).gradeHold).toBe(false);
  });
});

describe('holding a design elevation', () => {
  it('drives the cutting edge to design grade and keeps it there', () => {
    const t = flat(0);
    const v = new Vehicle(bulldozerDef, SPAWN);
    const grade: GradeQuery = () => 0.4;

    tapHold(v, t, grade);
    drive(v, t, {}, 2, grade);

    // Ground is flat at 0, so blade height and elevation coincide here.
    expect(blade(v).height).toBeCloseTo(0.4, 2);
  });

  it('holds elevation while the machine climbs, so the blade drops relative to it', () => {
    // A ramp: standing higher must mean a LOWER blade to stay on one plane.
    const t = flat(0);
    for (let cz = 0; cz < t.depth; cz++) {
      const wz = t.cellToWorldZ(cz);
      for (let cx = 0; cx < t.width; cx++) {
        t.height[t.index(cx, cz)] = Math.max(0, wz * 0.05);
      }
    }
    const v = new Vehicle(bulldozerDef, SPAWN);
    const grade: GradeQuery = () => 0.5;

    tapHold(v, t, grade);
    drive(v, t, FORWARD, 1, grade);
    const low = v.state.position.y;
    const early = blade(v).height;

    drive(v, t, FORWARD, 3, grade);
    expect(v.state.position.y).toBeGreaterThan(low + 0.2); // it really did climb
    expect(blade(v).height).toBeLessThan(early);

    // The point of the whole feature: the EDGE stayed on one plane.
    expect(v.state.position.y + blade(v).height).toBeCloseTo(0.5, 1);
  });

  it('reports saturation when design grade is out of the rams reach', () => {
    const t = flat(0);
    const v = new Vehicle(bulldozerDef, SPAWN);
    // 4m below the tracks, far past the blade's -0.55m of travel.
    const grade: GradeQuery = () => -4;

    tapHold(v, t, grade);
    drive(v, t, {}, 2, grade);

    expect(blade(v).gradeHoldSaturated).toBe(true);
    expect(blade(v).height).toBeCloseTo(-0.55, 2);
  });

  it('clears saturation once grade comes back within reach', () => {
    const t = flat(0);
    const v = new Vehicle(bulldozerDef, SPAWN);
    let target = -4;
    const grade: GradeQuery = () => target;

    tapHold(v, t, grade);
    drive(v, t, {}, 1, grade);
    expect(blade(v).gradeHoldSaturated).toBe(true);

    target = -0.2;
    drive(v, t, {}, 1, grade);
    expect(blade(v).gradeHoldSaturated).toBe(false);
  });
});

describe('off a job site', () => {
  it('latches the elevation it was at, so free roam can still level', () => {
    // No contract anywhere: gradeAt answers null everywhere.
    const t = flat(0);
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, t, { [RAISE]: 1 }, 0.5); // put the blade somewhere deliberate
    const latched = v.state.position.y + blade(v).height;

    tapHold(v, t);
    drive(v, t, FORWARD, 2);

    expect(blade(v).gradeHold).toBe(true);
    expect(v.state.position.y + blade(v).height).toBeCloseTo(latched, 2);
  });
});

describe('the contract is finishable on grade hold alone', () => {
  /**
   * No blade input at all — the operator toggles hold once and then only
   * steers. If this cannot finish the job, grade control does not work.
   */
  it('reaches the required accuracy inside par', () => {
    const terrain = new Terrain(
      sandboxMap.width,
      sandboxMap.depth,
      sandboxMap.cellSize,
      sandboxMap.generate(),
    );
    const site = createPadLevelJob(terrain);
    const world = new World(terrain);
    const vehicle = world.addVehicle(new Vehicle(bulldozerDef, site.spawn!));
    world.job = new JobRunner(terrain, site);

    // One tap, then the blade is never touched again.
    world.step(STEP, TAP);
    world.step(STEP, {});
    expect(blade(vehicle).gradeHold).toBe(true);

    const startZ = terrain.cellToWorldZ(site.bounds.z0) - 4;
    const endZ = terrain.cellToWorldZ(site.bounds.z1) + 4;
    const x0 = terrain.cellToWorldX(site.bounds.x0);
    const x1 = terrain.cellToWorldX(site.bounds.x1);
    const lanes = 8;

    for (let pass = 0; pass < 24 && !world.job.isComplete; pass++) {
      const lane = pass % lanes;
      vehicle.state.position.x = x0 + ((x1 - x0) * (lane + 0.5)) / lanes;
      vehicle.state.position.z = startZ;
      vehicle.state.heading = 0;
      vehicle.state.speed = 0;

      let guard = 0;
      while (vehicle.state.position.z < endZ && guard++ < 60 * 40) {
        world.step(STEP, FORWARD);
      }
    }

    expect(blade(vehicle).gradeHold).toBe(true); // never silently dropped out
    expect(world.job.isComplete).toBe(true);
    expect(world.job.result!.elapsed).toBeLessThan(site.parSeconds);
  });

  it('still conserves soil (FR-3.5)', () => {
    const terrain = new Terrain(
      sandboxMap.width,
      sandboxMap.depth,
      sandboxMap.cellSize,
      sandboxMap.generate(),
    );
    const site = createPadLevelJob(terrain);
    const before = terrain.totalVolume();
    const world = new World(terrain);
    world.addVehicle(new Vehicle(bulldozerDef, site.spawn!));
    world.job = new JobRunner(terrain, site);

    world.step(STEP, TAP);
    for (let i = 0; i < 60 * 30; i++) world.step(STEP, FORWARD);

    expect(terrain.totalVolume()).toBeCloseTo(before, 2);
  });
});

describe('the grade query itself', () => {
  it('answers null off site and the target height on it', () => {
    const terrain = new Terrain(
      sandboxMap.width,
      sandboxMap.depth,
      sandboxMap.cellSize,
      sandboxMap.generate(),
    );
    const site = createPadLevelJob(terrain);
    const world = new World(terrain);
    world.job = new JobRunner(terrain, site);
    const v = world.addVehicle(new Vehicle(bulldozerDef, site.spawn!));

    // Reach into the same query the blade uses, via a full step on site.
    const cx = Math.round((site.bounds.x0 + site.bounds.x1) / 2);
    const cz = Math.round((site.bounds.z0 + site.bounds.z1) / 2);
    v.state.position.x = terrain.cellToWorldX(cx);
    v.state.position.z = terrain.cellToWorldZ(cz) - bulldozerDef.implements[0].reach;
    v.state.heading = 0;

    world.step(STEP, TAP);
    world.step(STEP, {});
    for (let i = 0; i < 120; i++) world.step(STEP, {});

    const target = targetAt(site, cx, cz)!;
    expect(v.state.position.y + blade(v).height).toBeCloseTo(target, 1);
  });
});
