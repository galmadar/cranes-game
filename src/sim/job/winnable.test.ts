/**
 * Can a competent operator actually finish the contract?
 *
 * This is the most valuable test here, because it catches a class of bug that
 * no unit test can see. Every individual system passed its own tests while the
 * game shipped an **unwinnable job**: the blade could cut but never fill, so a
 * perfect operator shaved every high spot, pushed the spoil off the site, and
 * plateaued at 50% on grade with 38m³ of hollow that nothing could ever fill.
 *
 * The player's report was "I can't flat the ground, it just makes tiny
 * mountains". They were right, and nothing in the suite disagreed with them.
 *
 * So: drive the machine the way a real operator would — lanes across the site,
 * blade held at design elevation — and require that the job completes.
 */

import { describe, expect, it } from 'vitest';
import { createPadLevelJob } from '../../content/jobs/padLevel';
import { sandboxMap } from '../../content/maps/sandbox';
import { bulldozerDef } from '../../content/vehicles/bulldozer.def';
import { Action, type ActionState } from '../input/actions';
import { MaterialId } from '../materials';
import { Terrain } from '../Terrain';
import { Vehicle } from '../vehicle/Vehicle';
import { World } from '../World';
import { JobRunner } from './JobRunner';
import { targetAt, type JobSite } from './JobSite';
import { evaluateJob } from './scoring';

const STEP = 1 / 60;
const FORWARD: ActionState = { [Action.ThrottleForward]: 1 };

/**
 * Grade a site by driving overlapping lanes with the cutting edge held at
 * design elevation — what an operator with a GPS blade is doing by hand.
 * Returns the world so the caller can inspect the result.
 */
function gradeSite(terrain: Terrain, site: JobSite, passes = 24, stopWhenDone = true): World {
  const world = new World(terrain);
  const vehicle = world.addVehicle(new Vehicle(bulldozerDef, site.spawn!));
  world.job = new JobRunner(terrain, site);

  const targetY = targetAt(site, site.bounds.x0, site.bounds.z0)!;
  const startZ = terrain.cellToWorldZ(site.bounds.z0) - 4;
  const endZ = terrain.cellToWorldZ(site.bounds.z1) + 4;
  const x0 = terrain.cellToWorldX(site.bounds.x0);
  const x1 = terrain.cellToWorldX(site.bounds.x1);
  const lanes = 8;

  for (let pass = 0; pass < passes; pass++) {
    if (stopWhenDone && world.job.isComplete) break;
    const lane = pass % lanes;
    vehicle.state.position.x = x0 + ((x1 - x0) * (lane + 0.5)) / lanes;
    vehicle.state.position.z = startZ;
    vehicle.state.heading = 0;
    vehicle.state.speed = 0;

    let guard = 0;
    while (vehicle.state.position.z < endZ && guard++ < 60 * 40) {
      const blade = vehicle.state.implementStates['blade'];
      if (blade && blade.kind === 'blade') {
        blade.height = Math.max(-0.55, Math.min(1.4, targetY - vehicle.state.position.y));
      }
      world.step(STEP, FORWARD);
    }
  }
  return world;
}

function sandboxTerrain(): Terrain {
  return new Terrain(
    sandboxMap.width,
    sandboxMap.depth,
    sandboxMap.cellSize,
    sandboxMap.generate(),
  );
}

describe('the first contract is finishable', () => {
  it('reaches the required accuracy well inside par', () => {
    const terrain = sandboxTerrain();
    const site = createPadLevelJob(terrain);
    const world = gradeSite(terrain, site);

    expect(world.job?.isComplete).toBe(true);
    // Generous headroom: a human without perfect grade control is slower than
    // this simulated operator, and par must still be reachable for them.
    expect(world.job!.result!.elapsed).toBeLessThan(site.parSeconds * 0.75);
  });

  it('ends up genuinely flat, not merely inside tolerance', () => {
    const terrain = sandboxTerrain();
    const site = createPadLevelJob(terrain);
    // Keep working past the completion threshold: the question here is whether
    // the model can reach a genuinely flat surface, not merely a passing one.
    gradeSite(terrain, site, 24, false);

    const p = evaluateJob(terrain, site);
    expect(p.accuracy).toBeGreaterThan(0.9);
    expect(p.meanError).toBeLessThan(site.tolerance * 0.5);
  });

  it('conserves soil across the whole grading run (FR-3.5)', () => {
    const terrain = sandboxTerrain();
    const before = terrain.totalVolume();
    gradeSite(terrain, createPadLevelJob(terrain));
    expect(terrain.totalVolume()).toBeCloseTo(before, 2);
  });
});

describe('the blade can fill, not only cut', () => {
  /** Flat ground with a trench gouged across it, and a mound to fill it from. */
  function trenchAndMound(): { terrain: Terrain; site: JobSite } {
    const terrain = new Terrain(160, 160, 0.5);
    terrain.material.fill(MaterialId.SAND);
    terrain.height.fill(2);

    for (let cz = 0; cz < terrain.depth; cz++) {
      const wz = terrain.cellToWorldZ(cz);
      for (let cx = 0; cx < terrain.width; cx++) {
        const i = terrain.index(cx, cz);
        if (wz > -2 && wz < 2) terrain.height[i] = 1.3; // the trench
        if (wz > -12 && wz < -8) terrain.height[i] = 3.0; // the mound to feed it
      }
    }

    const site = {
      id: 't',
      title: '',
      brief: '',
      bounds: { x0: 40, z0: 40, x1: 120, z1: 120 },
      target: new Float32Array(81 * 81).fill(2),
      tolerance: 0.15,
      requiredAccuracy: 0.9,
      parSeconds: 600,
      spawn: { position: { x: 0, y: 0, z: -20 }, heading: 0 },
    } satisfies JobSite;

    return { terrain, site };
  }

  it('raises a trench it drives over', () => {
    const { terrain, site } = trenchAndMound();
    const before = terrain.sampleHeight(0, 0);
    gradeSite(terrain, site, 6);

    // The trench floor must come UP. Before the fill mechanism existed this
    // was impossible: the blade could only ever cut and shove forward.
    expect(terrain.sampleHeight(0, 0)).toBeGreaterThan(before + 0.2);
  });

  it('never fills above the cutting edge', () => {
    const { terrain, site } = trenchAndMound();
    gradeSite(terrain, site, 6);
    // Target is 2m; the blade must not heap the trench into a ridge.
    expect(terrain.sampleHeight(0, 0)).toBeLessThan(2.3);
  });

  it('conserves soil while filling', () => {
    const { terrain, site } = trenchAndMound();
    const before = terrain.totalVolume();
    gradeSite(terrain, site, 6);
    expect(terrain.totalVolume()).toBeCloseTo(before, 2);
  });
});
