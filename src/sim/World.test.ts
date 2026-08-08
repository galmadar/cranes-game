/**
 * End-to-end simulation tests.
 *
 * The unit tests pin each algorithm on its own. These drive the whole loop the
 * way the game does — locomotion, cutting, depositing and slump relaxation all
 * interacting — because FR-3.5 has to hold for the *composition*, not just for
 * the parts. A deformer that conserves volume and a slump that conserves
 * volume can still leak between them.
 */

import { describe, expect, it } from 'vitest';
import { bulldozerDef } from '../content/vehicles/bulldozer.def';
import { sandboxMap } from '../content/maps/sandbox';
import { Action, type ActionState } from './input/actions';
import { MaterialId } from './materials';
import { Terrain } from './Terrain';
import { Vehicle } from './vehicle/Vehicle';
import { World } from './World';

const STEP = 1 / 60;

function sandboxWorld(): World {
  const terrain = new Terrain(
    sandboxMap.width,
    sandboxMap.depth,
    sandboxMap.cellSize,
    sandboxMap.generate(),
  );
  const world = new World(terrain);
  world.addVehicle(new Vehicle(bulldozerDef, sandboxMap.spawn));
  return world;
}

function flatWorld(material: MaterialId, height: number, heading = 0): World {
  const terrain = new Terrain(160, 160, 0.5);
  terrain.material.fill(material);
  terrain.height.fill(height);
  const world = new World(terrain);
  world.addVehicle(new Vehicle(bulldozerDef, { position: { x: 0, z: -20 }, heading }));
  return world;
}

function run(world: World, input: ActionState, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) world.step(STEP, input);
}

const dig: ActionState = { [Action.ThrottleForward]: 1, bladeLower: 1 };
const drive: ActionState = { [Action.ThrottleForward]: 1, bladeRaise: 1 };

describe('volume conservation through the whole loop (FR-3.5)', () => {
  it('holds while digging across the real sandbox map', () => {
    const world = sandboxWorld();
    const before = world.terrain.totalVolume();
    run(world, dig, 20);
    expect(world.terrain.totalVolume()).toBeCloseTo(before, 3);
  });

  it('holds while turning under load', () => {
    const world = sandboxWorld();
    const before = world.terrain.totalVolume();
    run(world, { ...dig, [Action.SteerLeft]: 1 }, 15);
    expect(world.terrain.totalVolume()).toBeCloseTo(before, 3);
  });

  it('holds while shuttling back and forth over its own spoil', () => {
    const world = flatWorld(MaterialId.SAND, 2);
    const before = world.terrain.totalVolume();
    for (let lap = 0; lap < 4; lap++) {
      run(world, dig, 3);
      run(world, { [Action.ThrottleReverse]: 1 }, 2);
    }
    expect(world.terrain.totalVolume()).toBeCloseTo(before, 3);
  });

  it('holds when the machine works into the map perimeter', () => {
    const world = sandboxWorld();
    const before = world.terrain.totalVolume();
    run(world, dig, 60); // long enough to reach and grind against the edge clamp
    expect(world.terrain.totalVolume()).toBeCloseTo(before, 3);
  });
});

describe('the dig loop actually works', () => {
  it('moves soil when the blade is down, and leaves it alone when up', () => {
    const changed = (input: ActionState): number => {
      const world = flatWorld(MaterialId.SAND, 2);
      const before = Float32Array.from(world.terrain.height);
      run(world, input, 5);
      let cells = 0;
      for (let i = 0; i < before.length; i++) {
        if (Math.abs(world.terrain.height[i] - before[i]) > 1e-3) cells++;
      }
      return cells;
    };

    expect(changed(dig)).toBeGreaterThan(100);
    expect(changed(drive)).toBe(0);
  });

  it('cuts a trench behind the machine and heaps soil ahead of it', () => {
    const world = flatWorld(MaterialId.SAND, 2);
    const spawnZ = world.activeVehicle!.state.position.z;
    run(world, dig, 6);

    const pos = world.activeVehicle!.state.position;
    // A point the blade has definitely swept. The machine bogs down under load,
    // so this must be anchored to the spawn, not to how far it happened to get.
    const cut = world.terrain.sampleHeight(pos.x, spawnZ + 3);
    const ahead = world.terrain.sampleHeight(pos.x, pos.z + 4);

    expect(pos.z).toBeGreaterThan(spawnZ + 3); // it did actually move past it
    expect(cut).toBeLessThan(2); // material was removed
    expect(ahead).toBeGreaterThan(2); // and it ended up in front
  });

  it('refuses to cut the rock outcrop', () => {
    const world = sandboxWorld();
    const terrain = world.terrain;

    // Park the machine facing the outcrop at (20, -26) and shove.
    const vehicle = world.activeVehicle!;
    vehicle.state.position.x = 20;
    vehicle.state.position.z = -34;
    vehicle.state.heading = 0; // +Z, toward the rock

    const peakCell = terrain.index(
      Math.round(terrain.worldToCellX(20)),
      Math.round(terrain.worldToCellZ(-26)),
    );
    expect(terrain.material[peakCell]).toBe(MaterialId.ROCK);
    const peakBefore = terrain.height[peakCell];

    run(world, dig, 12);
    expect(terrain.height[peakCell]).toBeCloseTo(peakBefore, 6);
  });

  it('slows the machine down once the blade loads up', () => {
    const loaded = flatWorld(MaterialId.SAND, 2);
    run(loaded, dig, 6);

    const free = flatWorld(MaterialId.SAND, 2);
    run(free, drive, 6);

    expect(loaded.activeVehicle!.state.speed).toBeLessThan(
      free.activeVehicle!.state.speed * 0.8,
    );
  });

  it('leaves no slope steeper than the material can stand', () => {
    const world = flatWorld(MaterialId.SAND, 2);
    run(world, dig, 8);
    // The blade must come UP before this means anything. Left buried, it keeps
    // cutting the soil that slumps into it and shoving it forward, holding a
    // face far steeper than sand could stand on its own — which is exactly
    // what a real mouldboard does, and not something slump should undo.
    run(world, { bladeRaise: 1 }, 4);

    const t = world.terrain;
    const limit = Math.tan(Math.PI / 4); // generous: sand repose is 34 degrees
    let worst = 0;
    for (let cz = 1; cz < t.depth - 1; cz++) {
      for (let cx = 1; cx < t.width - 1; cx++) {
        const h = t.getHeight(cx, cz);
        worst = Math.max(worst, Math.abs(h - t.getHeight(cx + 1, cz)) / t.cellSize);
        worst = Math.max(worst, Math.abs(h - t.getHeight(cx, cz + 1)) / t.cellSize);
      }
    }
    expect(worst).toBeLessThan(limit);
  });
});

describe('terrain stays quiet when nothing is happening', () => {
  it('reports no dirty region once a parked machine has settled', () => {
    const world = flatWorld(MaterialId.SAND, 2);
    run(world, {}, 3); // blade at rest height, above ground
    world.terrain.consumeDirty();
    run(world, {}, 2);

    // A parked dozer must not keep re-dirtying terrain every frame — that
    // would re-upload geometry forever for no visible change.
    expect(world.terrain.consumeDirty()).toBeNull();
  });
});
