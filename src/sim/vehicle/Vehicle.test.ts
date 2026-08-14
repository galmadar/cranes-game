import { describe, expect, it } from 'vitest';
import { bulldozerDef } from '../../content/vehicles/bulldozer.def';
import { Action, type ActionState } from '../input/actions';
import { MaterialId } from '../materials';
import { Terrain } from '../Terrain';
import { Vehicle } from './Vehicle';

const SPAWN = { position: { x: 0, z: 0 }, heading: 0 };

function flatWorld(material: MaterialId = MaterialId.GRASS): Terrain {
  const t = new Terrain(200, 200, 0.5);
  t.material.fill(material);
  return t;
}

function drive(v: Vehicle, terrain: Terrain, input: ActionState, seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) v.update(dt, input, terrain);
}

const forward: ActionState = { [Action.ThrottleForward]: 1 };
const reverse: ActionState = { [Action.ThrottleReverse]: 1 };
const left: ActionState = { [Action.SteerLeft]: 1 };

describe('locomotion', () => {
  it('starts at rest on the spawn point', () => {
    const v = new Vehicle(bulldozerDef, SPAWN);
    expect(v.state.speed).toBe(0);
    expect(v.state.position.x).toBe(0);
  });

  it('drives along +Z at heading 0', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, forward, 2);
    expect(v.state.position.z).toBeGreaterThan(3);
    expect(Math.abs(v.state.position.x)).toBeLessThan(1e-6);
  });

  it('reverses more slowly than it drives forward', () => {
    const terrain = flatWorld();
    const fwd = new Vehicle(bulldozerDef, SPAWN);
    const rev = new Vehicle(bulldozerDef, SPAWN);
    drive(fwd, terrain, forward, 4);
    drive(rev, terrain, reverse, 4);
    expect(fwd.state.speed).toBeCloseTo(bulldozerDef.locomotion.maxSpeed, 1);
    expect(Math.abs(rev.state.speed)).toBeLessThan(fwd.state.speed);
  });

  it('never exceeds its rated top speed', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, forward, 20);
    expect(v.state.speed).toBeLessThanOrEqual(bulldozerDef.locomotion.maxSpeed + 1e-6);
  });

  it('coasts to a full stop when the throttle is released', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, forward, 3);
    drive(v, terrain, {}, 3);
    expect(v.state.speed).toBe(0);
  });

  it('pivots on the spot — a tracked machine turns without moving', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, left, 1);
    expect(v.state.heading).toBeGreaterThan(0.5);
    expect(Math.hypot(v.state.position.x, v.state.position.z)).toBeLessThan(1e-6);
  });

  it('turns left toward +X, matching the right-handed convention', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, { ...left }, 1.4); // ~90 degrees
    drive(v, terrain, forward, 2);
    expect(v.state.position.x).toBeGreaterThan(2);
  });

  it('keeps heading wrapped into [0, 2pi)', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, left, 30);
    expect(v.state.heading).toBeGreaterThanOrEqual(0);
    expect(v.state.heading).toBeLessThan(Math.PI * 2);
  });

  // FR-2.5
  it('moves slower through mud than over topsoil', () => {
    const onGrass = new Vehicle(bulldozerDef, SPAWN);
    const onMud = new Vehicle(bulldozerDef, SPAWN);
    drive(onGrass, flatWorld(MaterialId.GRASS), forward, 5);
    drive(onMud, flatWorld(MaterialId.MUD), forward, 5);
    expect(onMud.state.speed).toBeLessThan(onGrass.state.speed * 0.6);
  });

  it('stays inside the map instead of climbing the perimeter berm', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, forward, 200);
    expect(Math.abs(v.state.position.z)).toBeLessThan(terrain.worldDepth / 2);
  });
});

describe('terrain conform (FR-2.3)', () => {
  it('sits on the ground surface', () => {
    const terrain = flatWorld();
    terrain.height.fill(3.5);
    const v = new Vehicle(bulldozerDef, SPAWN);
    v.update(1 / 60, {}, terrain);
    expect(v.state.position.y).toBeCloseTo(3.5, 6);
  });

  it('is level on flat ground', () => {
    const v = new Vehicle(bulldozerDef, SPAWN);
    v.update(1 / 60, {}, flatWorld());
    expect(v.state.pitch).toBeCloseTo(0, 6);
    expect(v.state.roll).toBeCloseTo(0, 6);
  });

  it('noses up when facing uphill and stays level side to side', () => {
    const terrain = flatWorld();
    // Ground rising toward +X.
    for (let cz = 0; cz < terrain.depth; cz++) {
      for (let cx = 0; cx < terrain.width; cx++) {
        terrain.height[terrain.index(cx, cz)] = terrain.cellToWorldX(cx) * 0.3;
      }
    }
    const v = new Vehicle(bulldozerDef, { position: { x: 0, z: 0 }, heading: Math.PI / 2 });
    v.update(1 / 60, {}, terrain);
    expect(v.state.pitch).toBeLessThan(-0.2); // negative pitch = nose up
    expect(Math.abs(v.state.roll)).toBeLessThan(1e-6);
  });

  it('rolls when traversing a slope broadside', () => {
    const terrain = flatWorld();
    for (let cz = 0; cz < terrain.depth; cz++) {
      for (let cx = 0; cx < terrain.width; cx++) {
        terrain.height[terrain.index(cx, cz)] = terrain.cellToWorldX(cx) * 0.3;
      }
    }
    const v = new Vehicle(bulldozerDef, SPAWN); // facing +Z, slope runs across
    v.update(1 / 60, {}, terrain);
    expect(Math.abs(v.state.pitch)).toBeLessThan(1e-6);
    expect(v.state.roll).toBeGreaterThan(0.2);
  });
});

describe('blade implement (FR-2.4)', () => {
  const blade = () => bulldozerDef.implements[0];

  it('starts at its rest height', () => {
    const v = new Vehicle(bulldozerDef, SPAWN);
    const state = v.state.implementStates['blade'];
    expect(state?.kind).toBe('blade');
    expect(state && state.kind === 'blade' ? state.height : null).toBeCloseTo(0.25, 6);
  });

  it('lowers and raises within its declared travel', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    const spec = blade();

    drive(v, terrain, { bladeLower: 1 }, 10);
    const low = v.state.implementStates['blade'];
    expect(low && low.kind === 'blade' ? low.height : 0).toBeCloseTo(
      spec.kind === 'blade' ? spec.minHeight : 0,
      6,
    );

    drive(v, terrain, { bladeRaise: 1 }, 10);
    const high = v.state.implementStates['blade'];
    expect(high && high.kind === 'blade' ? high.height : 0).toBeCloseTo(
      spec.kind === 'blade' ? spec.maxHeight : 0,
      6,
    );
  });

  it('can reach below grade so it can bite in M3', () => {
    const spec = blade();
    expect(spec.kind === 'blade' ? spec.minHeight : 0).toBeLessThan(0);
  });

  it('carries nothing while the blade rides clear of the ground', () => {
    const terrain = flatWorld();
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, { ...forward, bladeRaise: 1 }, 3);
    const state = v.state.implementStates['blade'];
    expect(state && state.kind === 'blade' ? state.carriedVolume : -1).toBe(0);
  });

  it('picks up a load once the blade is dropped and driven forward', () => {
    const terrain = flatWorld(MaterialId.SAND);
    terrain.height.fill(2);
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, { ...forward, bladeLower: 1 }, 3);

    const state = v.state.implementStates['blade'];
    expect(state && state.kind === 'blade' ? state.carriedVolume : 0).toBeGreaterThan(0.5);
    expect(v.implementLoad).toBeGreaterThan(0);
  });

  // The complaint this answers: "how much sand can a dozer actually push?
  // Right now there's effectively no limit." There is one now, and getting
  // stuck has to stay recoverable or it is just a dead end with extra steps.
  it('bogs down under an overloaded blade but always reverses out', () => {
    const terrain = flatWorld(MaterialId.SAND);
    terrain.height.fill(3);
    const v = new Vehicle(bulldozerDef, SPAWN);
    drive(v, terrain, { ...forward, bladeLower: 1 }, 25);

    expect(v.implementLoad).toBeGreaterThan(0.8);
    expect(v.state.speed).toBeLessThan(bulldozerDef.locomotion.maxSpeed * 0.35);

    const stuckAt = v.state.position.z;
    drive(v, terrain, { ...reverse, bladeLower: 1 }, 3);
    expect(v.state.position.z).toBeLessThan(stuckAt - 2);
  });

  it('is slowed by a loaded blade', () => {
    const build = (bladeDown: boolean) => {
      const terrain = flatWorld(MaterialId.SAND);
      terrain.height.fill(2);
      const v = new Vehicle(bulldozerDef, SPAWN);
      drive(v, terrain, bladeDown ? { ...forward, bladeLower: 1 } : { ...forward, bladeRaise: 1 }, 4);
      return v.state.speed;
    };
    expect(build(true)).toBeLessThan(build(false) * 0.9);
  });
});
