import { describe, expect, it } from 'vitest';
import { bulldozerDef } from '../../content/vehicles/bulldozer.def';
import { Action, type ActionState } from '../input/actions';
import { MaterialId } from '../materials';
import { Terrain } from '../Terrain';
import { Vehicle } from '../vehicle/Vehicle';
import { World } from '../World';
import { createFlatPad, siteCellCount, targetAt } from './JobSite';
import { JobRunner } from './JobRunner';
import { evaluateJob, idealMoveVolume } from './scoring';

function flatTerrain(height = 0, size = 80, cell = 0.5): Terrain {
  const t = new Terrain(size, size, cell);
  t.material.fill(MaterialId.SAND);
  t.height.fill(height);
  return t;
}

/** A 10x10m pad centred on the origin, target elevation 0. */
function pad(terrain: Terrain, tolerance = 0.1) {
  return createFlatPad(terrain, {
    id: 'test',
    title: 'Test pad',
    brief: '',
    centerX: 0,
    centerZ: 0,
    width: 10,
    depth: 10,
    tolerance,
    requiredAccuracy: 0.9,
    parSeconds: 60,
    targetHeight: 0,
  });
}

describe('JobSite', () => {
  it('covers the requested area in cells', () => {
    const t = flatTerrain();
    const site = pad(t);
    // 10m at 0.5m cells, inclusive of both edges.
    expect(site.bounds.x1 - site.bounds.x0 + 1).toBe(21);
    expect(siteCellCount(site)).toBe(21 * 21);
  });

  it('returns null outside its bounds', () => {
    const site = pad(flatTerrain());
    expect(targetAt(site, site.bounds.x0 - 1, site.bounds.z0)).toBeNull();
    expect(targetAt(site, site.bounds.x1 + 1, site.bounds.z0)).toBeNull();
    expect(targetAt(site, site.bounds.x0, site.bounds.z1 + 1)).toBeNull();
    expect(targetAt(site, site.bounds.x0, site.bounds.z0)).toBe(0);
  });

  it('defaults its target to the mean of the ground inside it', () => {
    const t = flatTerrain(0);
    // Half the world high, half low — mean over the pad should land between.
    for (let cz = 0; cz < t.depth; cz++) {
      for (let cx = 0; cx < t.width; cx++) {
        t.height[t.index(cx, cz)] = t.cellToWorldX(cx) < 0 ? 2 : 4;
      }
    }
    const site = createFlatPad(t, {
      id: 'm',
      title: '',
      brief: '',
      centerX: 0,
      centerZ: 0,
      width: 10,
      depth: 10,
      tolerance: 0.1,
      requiredAccuracy: 0.9,
      parSeconds: 60,
    });
    expect(targetAt(site, site.bounds.x0, site.bounds.z0)).toBeGreaterThan(2);
    expect(targetAt(site, site.bounds.x0, site.bounds.z0)).toBeLessThan(4);
  });

  it('is clamped to the terrain when it would overhang the map', () => {
    const t = flatTerrain();
    const site = createFlatPad(t, {
      id: 'edge',
      title: '',
      brief: '',
      centerX: -t.worldWidth / 2,
      centerZ: 0,
      width: 20,
      depth: 20,
      tolerance: 0.1,
      requiredAccuracy: 0.9,
      parSeconds: 60,
      targetHeight: 0,
    });
    expect(site.bounds.x0).toBe(0);
    expect(site.bounds.x1).toBeLessThan(t.width);
  });
});

describe('scoring', () => {
  it('reads 100% on ground already at target', () => {
    const t = flatTerrain(0);
    const p = evaluateJob(t, pad(t));
    expect(p.accuracy).toBe(1);
    expect(p.cutRemaining).toBeCloseTo(0, 9);
    expect(p.fillRemaining).toBeCloseTo(0, 9);
  });

  it('reads 0% on ground entirely out of tolerance', () => {
    const t = flatTerrain(5);
    const p = evaluateJob(t, pad(t));
    expect(p.accuracy).toBe(0);
    expect(p.maxError).toBeCloseTo(5, 6);
  });

  it('counts exactly the cells within tolerance', () => {
    const t = flatTerrain(0);
    const site = pad(t, 0.1);
    // Push a handful of cells clearly out of tolerance.
    let expected = 0;
    for (let cz = site.bounds.z0; cz <= site.bounds.z0 + 4; cz++) {
      for (let cx = site.bounds.x0; cx <= site.bounds.x0 + 4; cx++) {
        t.height[t.index(cx, cz)] = 1;
        expected++;
      }
    }
    const p = evaluateJob(t, site);
    expect(p.cellsOnGrade).toBe(siteCellCount(site) - expected);
  });

  it('treats the tolerance band as inclusive on both sides', () => {
    const t = flatTerrain(0);
    const site = pad(t, 0.25);
    t.height.fill(0.24);
    expect(evaluateJob(t, site).accuracy).toBe(1);
    t.height.fill(-0.24);
    expect(evaluateJob(t, site).accuracy).toBe(1);
    t.height.fill(0.26);
    expect(evaluateJob(t, site).accuracy).toBe(0);
  });

  it('splits cut and fill by sign', () => {
    const t = flatTerrain(0);
    const site = pad(t);
    t.height.fill(1); // everything is too high
    let p = evaluateJob(t, site);
    expect(p.cutRemaining).toBeGreaterThan(0);
    expect(p.fillRemaining).toBeCloseTo(0, 9);

    t.height.fill(-1); // everything is too low
    p = evaluateJob(t, site);
    expect(p.cutRemaining).toBeCloseTo(0, 9);
    expect(p.fillRemaining).toBeGreaterThan(0);
  });

  it('measures cut volume in real cubic metres', () => {
    const t = flatTerrain(0);
    const site = pad(t);
    t.height.fill(2);
    // 21x21 cells at 0.25 m2 each, 2m proud of target.
    expect(evaluateJob(t, site).cutRemaining).toBeCloseTo(21 * 21 * 0.25 * 2, 4);
  });

  it('never writes to the terrain', () => {
    const t = flatTerrain(1.7);
    const site = pad(t);
    const before = Float32Array.from(t.height);
    evaluateJob(t, site);
    idealMoveVolume(t, site);
    for (let i = 0; i < before.length; i++) expect(t.height[i]).toBe(before[i]);
  });
});

describe('JobRunner', () => {
  it('captures the ideal move volume at construction', () => {
    const t = flatTerrain(0);
    const site = pad(t);
    t.height.fill(1);
    const runner = new JobRunner(t, site);
    expect(runner.idealVolume).toBeCloseTo(21 * 21 * 0.25, 4);
  });

  it('reports perfect efficiency before any digging', () => {
    const t = flatTerrain(1);
    expect(new JobRunner(t, pad(t)).efficiency).toBe(1);
  });

  it('never reports efficiency above 1, however little was moved', () => {
    const t = flatTerrain(0);
    const site = pad(t);
    t.height.fill(1);
    const runner = new JobRunner(t, site);
    runner.step(1 / 60, t, 0.0001);
    expect(runner.efficiency).toBeLessThanOrEqual(1);
  });

  it('falls as the same soil is cut repeatedly', () => {
    const t = flatTerrain(0);
    const site = pad(t);
    t.height.fill(1);
    const runner = new JobRunner(t, site);
    for (let i = 0; i < 600; i++) runner.step(1 / 60, t, runner.idealVolume / 100);
    expect(runner.efficiency).toBeLessThan(0.25);
  });

  // The fix for "I don't understand how to complete the job": accuracy is a
  // dishonest progress signal, so the HUD leads with earth moved instead.
  describe('earth-moved progress', () => {
    it('starts at zero and reaches one when the ground hits target', () => {
      const t = flatTerrain(0);
      const site = pad(t);
      t.height.fill(1.5);

      const runner = new JobRunner(t, site);
      expect(runner.earthMovedFraction).toBe(0);

      t.height.fill(0);
      runner.refresh(t);
      expect(runner.earthMovedFraction).toBe(1);
    });

    it('climbs steadily while accuracy is still pinned at zero', () => {
      const t = flatTerrain(0);
      const site = pad(t, 0.1);
      t.height.fill(2);
      const runner = new JobRunner(t, site);

      // Shave the site down in stages. Every stage is still far outside
      // tolerance, so accuracy stays at 0 throughout — exactly the situation
      // that made the job feel impossible.
      const seen: number[] = [];
      for (const h of [1.6, 1.2, 0.8, 0.4]) {
        t.height.fill(h);
        runner.refresh(t);
        expect(runner.current.accuracy).toBe(0);
        seen.push(runner.earthMovedFraction);
      }

      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
      expect(seen[0]).toBeGreaterThan(0);
    });

    it('stays within 0..1 even if soil is pushed in from outside the site', () => {
      const t = flatTerrain(0);
      const site = pad(t);
      t.height.fill(1);
      const runner = new JobRunner(t, site);

      t.height.fill(5); // worse than we started
      runner.refresh(t);
      expect(runner.earthMovedFraction).toBeGreaterThanOrEqual(0);
      expect(runner.earthMovedFraction).toBeLessThanOrEqual(1);
    });

    it('reports complete progress for a job that needed no cutting', () => {
      const t = flatTerrain(0);
      expect(new JobRunner(t, pad(t)).earthMovedFraction).toBe(1);
    });
  });

  it('completes once accuracy passes the requirement', () => {
    const t = flatTerrain(3);
    const site = pad(t);
    const runner = new JobRunner(t, site);
    expect(runner.isComplete).toBe(false);

    t.height.fill(0); // the job, done instantly
    for (let i = 0; i < 12; i++) runner.step(1 / 60, t, 0);
    expect(runner.isComplete).toBe(true);
    expect(runner.result?.accuracy).toBe(1);
  });

  it('stops the clock at completion so idling cannot spoil the score', () => {
    const t = flatTerrain(0);
    const runner = new JobRunner(t, pad(t));
    for (let i = 0; i < 12; i++) runner.step(1 / 60, t, 0);
    const at = runner.elapsed;

    for (let i = 0; i < 600; i++) runner.step(1 / 60, t, 5);
    expect(runner.elapsed).toBe(at);
    expect(runner.volumeMoved).toBe(0);
  });

  it('marks a fast finish as under par', () => {
    const t = flatTerrain(0);
    const runner = new JobRunner(t, pad(t));
    for (let i = 0; i < 12; i++) runner.step(1 / 60, t, 0);
    expect(runner.result?.underPar).toBe(true);
  });
});

describe('a job inside the running world', () => {
  it('accumulates moved volume from real digging without breaking conservation', () => {
    const terrain = flatTerrain(2, 160);
    const world = new World(terrain);
    world.addVehicle(new Vehicle(bulldozerDef, { position: { x: 0, z: -12 }, heading: 0 }));
    world.job = new JobRunner(terrain, pad(terrain));

    const before = terrain.totalVolume();
    const dig: ActionState = { [Action.ThrottleForward]: 1, bladeLower: 1 };
    for (let i = 0; i < 60 * 6; i++) world.step(1 / 60, dig);

    expect(world.job.volumeMoved).toBeGreaterThan(0);
    // FR-3.5 — the job system is read-only over terrain.
    expect(terrain.totalVolume()).toBeCloseTo(before, 3);
  });

  it('leaves the world steppable with no job at all', () => {
    const terrain = flatTerrain(1, 160);
    const world = new World(terrain);
    world.addVehicle(new Vehicle(bulldozerDef, { position: { x: 0, z: 0 }, heading: 0 }));
    expect(world.job).toBeNull();
    for (let i = 0; i < 60; i++) world.step(1 / 60, {});
    expect(world.steps).toBe(60);
  });
});
