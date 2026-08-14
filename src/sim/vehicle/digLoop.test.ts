/**
 * The dig/climb loop, and the limits that end it.
 *
 * Reported from play: "the blade digs a pit, the dozer drives into the pit and
 * keeps digging inside it… the sand jams, the nose pitches up, it climbs out of
 * the pit, and digs again." Measured, that was three faults with one cause —
 * the machine had no footprint. It read a single terrain point for a 5.2 x 3.4 m
 * tracked chassis, so it fell into the half-metre slot its own blade had just
 * cut and re-cut from the new floor, snapping through 27 degrees of chassis
 * pitch on the way.
 *
 * These are the numbers that must not come back.
 */

import { describe, expect, it } from 'vitest';
import { bulldozerDef } from '../../content/vehicles/bulldozer.def';
import { Action, type ActionState } from '../input/actions';
import { MaterialId } from '../materials';
import { Terrain } from '../Terrain';
import { World } from '../World';
import { Vehicle } from './Vehicle';

const STEP = 1 / 60;
const SPAWN = { position: { x: 0, z: -40 }, heading: 0 };

const bladeSpec = bulldozerDef.implements[0];
const BLADE = bladeSpec.kind === 'blade' ? bladeSpec : null;
/** Deepest travel the blade has, and so the deepest cut the geometry allows. */
const REACH_BELOW = -(BLADE?.minHeight ?? -0.55);
const BLADE_HEIGHT = BLADE?.height ?? 1.3;
const BLADE_WIDTH = BLADE?.width ?? 4;

/** Ignore the first seconds: driving into the ground is a transient, not a state. */
const SETTLE_SECONDS = 8;

interface Dig {
  terrain: Terrain;
  vehicle: Vehicle;
  /** Machine elevation sampled every second, from `SETTLE_SECONDS` on. */
  floor: number[];
  worstPitch: number;
  slowest: number;
  heaviest: number;
  /** Seconds spent with the blade so full the machine cannot pull it. */
  stalledSeconds: number;
  seconds: number;
}

function dig(input: ActionState, seconds: number): Dig {
  const terrain = new Terrain(256, 256, 0.5);
  terrain.material.fill(MaterialId.SAND);
  const world = new World(terrain);
  const vehicle = world.addVehicle(new Vehicle(bulldozerDef, SPAWN));

  const floor: number[] = [];
  let worstPitch = 0;
  let slowest = Infinity;
  let heaviest = 0;
  let stalledSteps = 0;

  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    world.step(STEP, input);
    if (i < SETTLE_SECONDS * 60) continue;

    const s = vehicle.state;
    if (i % 60 === 0) floor.push(s.position.y);
    if (Math.abs(s.pitch) > worstPitch) worstPitch = Math.abs(s.pitch);
    if (s.speed < slowest) slowest = s.speed;
    if (vehicle.implementLoad > heaviest) heaviest = vehicle.implementLoad;
    if (vehicle.implementLoad > 0.98) stalledSteps++;
  }

  return {
    terrain,
    vehicle,
    floor,
    worstPitch,
    slowest,
    heaviest,
    stalledSeconds: stalledSteps * STEP,
    seconds: seconds - SETTLE_SECONDS,
  };
}

const DIG: ActionState = { [Action.ThrottleForward]: 1, bladeLower: 1 };
const BITE: ActionState = { ...DIG, bladePitchForward: 1 };

const degrees = (radians: number): number => (radians * 180) / Math.PI;

describe('the machine stands on its tracks, not on one point', () => {
  // The fault, stated exactly: holding the blade down used to sink the machine
  // without bound, because each pass re-referenced the blade from the floor the
  // last pass had cut. A dozer cuts a RAMP, and the ramp has a slope it stops at.
  it('settles at a depth instead of digging without bound', () => {
    const { floor } = dig(DIG, 60);
    const early = floor.slice(0, 5);
    const late = floor.slice(-5);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

    // Still descending after fifty seconds would mean it never stops.
    expect(mean(late)).toBeGreaterThan(mean(early) - 0.15);
  });

  it('holds a floor close to the depth its blade can actually reach', () => {
    const { floor } = dig(DIG, 60);
    // The last twenty seconds — driving the machine into the ground is a
    // transient and does briefly go deeper than where it comes to rest.
    const deepest = Math.min(...floor.slice(-20));
    // Was -0.78 m settled and -1.31 m with the blade pitched to bite, on a
    // blade with 0.55 m of travel.
    expect(deepest).toBeGreaterThan(-REACH_BELOW * 1.3);
  });

  it('does not rock through wild chassis angles on ground it barely scratched', () => {
    // Was 27.6 degrees, and oscillating, from a point sample reading one 0.5 m cell.
    expect(degrees(dig(DIG, 40).worstPitch)).toBeLessThan(12);
    expect(degrees(dig(BITE, 40).worstPitch)).toBeLessThan(15);
  });
});

describe('a blade with a limit', () => {
  // "How much sand can a dozer actually push? Right now there's effectively no
  // limit." There was not: drag saturated at capacity, so a 10 m3 prow dragged
  // exactly as hard as a 3.4 m3 one and the machine held 1.62 m/s through both.
  it('bogs the machine down instead of pushing any amount of soil', () => {
    const { slowest, heaviest } = dig(BITE, 30);
    expect(heaviest).toBeGreaterThan(0.95);
    expect(slowest).toBeLessThan(bulldozerDef.locomotion.maxSpeed * 0.15);
  });

  // The stall has to be an event, not a state. At stallFill 1.6 measured
  // against the PITCH-REDUCED capacity it was a state: pitching forward to
  // bite left the machine stalled for 37 of every 45 seconds, which is not a
  // limit, it is a machine that does not work.
  it('gets stuck sometimes without getting stuck permanently', () => {
    const { stalledSeconds, seconds } = dig(BITE, 50);
    expect(stalledSeconds).toBeGreaterThan(0.5);
    expect(stalledSeconds).toBeLessThan(seconds * 0.4);
  });

  // Rolling the mouldboard forward changes what the blade HOLDS. It must not
  // change what the machine can shove, which is engine and traction.
  it('is no weaker at pushing for being pitched forward', () => {
    const neutral = dig(DIG, 40);
    const bitten = dig(BITE, 40);
    expect(bitten.stalledSeconds).toBeLessThan(neutral.stalledSeconds + neutral.seconds * 0.3);
  });

  it('never heaps a prow that towers over the mouldboard', () => {
    const { terrain } = dig(DIG, 40);
    let tallest = 0;
    for (let i = 0; i < terrain.height.length; i++) {
      if (terrain.height[i] > tallest) tallest = terrain.height[i];
    }
    // Undisturbed grade is zero here, so this is height above the ground the
    // soil was pushed across. Nothing on the blade can stand taller than it.
    expect(tallest).toBeLessThan(BLADE_HEIGHT * 2);
  });

  it('leaves windrows down each side of the pass', () => {
    const { terrain } = dig(DIG, 40);
    const sides = [0, 0];
    for (let cz = 0; cz < terrain.depth; cz++) {
      for (let cx = 0; cx < terrain.width; cx++) {
        const x = terrain.cellToWorldX(cx);
        if (Math.abs(x) < BLADE_WIDTH / 2 + 0.3) continue;
        const h = terrain.height[terrain.index(cx, cz)];
        if (h > 0.05) sides[x < 0 ? 0 : 1] += h * terrain.cellArea;
      }
    }
    expect(sides[0]).toBeGreaterThan(0.5);
    expect(sides[1]).toBeGreaterThan(0.5);
  });
});

describe('getting stuck stays recoverable', () => {
  it('backs out of the hole it dug', () => {
    const { terrain, vehicle } = dig(BITE, 30);
    const stuckAt = vehicle.state.position.z;
    const out: ActionState = { [Action.ThrottleReverse]: 1, bladeLower: 1 };
    for (let i = 0; i < 60 * 4; i++) vehicle.update(STEP, out, terrain);
    // Reversing pulls the blade OUT of the load, so it must always work.
    expect(vehicle.state.position.z).toBeLessThan(stuckAt - 3);
  });
});
