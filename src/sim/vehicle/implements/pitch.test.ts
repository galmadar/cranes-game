/**
 * Blade pitch — the second axis.
 *
 * A real mouldboard rolls forward and back about its top mount. Rolled back it
 * carries material up its own face; tipped forward the cutting edge attacks.
 * That trade is the mechanic, and it is the player's answer to a blade that
 * keeps dumping its load: stop cutting so hard and carry what you already have.
 *
 * The tests that matter are the ones proving the trade is real in BOTH
 * directions — a pitch axis that only made the blade better would be a free
 * upgrade rather than a decision.
 */

import { describe, expect, it } from 'vitest';
import { bulldozerDef } from '../../../content/vehicles/bulldozer.def';
import { Action, type ActionState } from '../../input/actions';
import { MaterialId } from '../../materials';
import { Terrain } from '../../Terrain';
import { Vehicle } from '../Vehicle';
import type { BladeSpec, BladeState } from '../types';

const STEP = 1 / 60;
const BACK = 'bladePitchBack';
const FORWARD = 'bladePitchForward';
const LOWER = 'bladeLower';
const HOLD = 'bladeGradeHold';

const SPAWN = { position: { x: 0, z: 0 }, heading: 0 };
const DRIVE: ActionState = { [Action.ThrottleForward]: 1 };

const bladeSpec = bulldozerDef.implements.find((i): i is BladeSpec => i.kind === 'blade')!;
const PITCH = bladeSpec.pitch!;

function blade(v: Vehicle): BladeState {
  const s = v.state.implementStates['blade'];
  if (!s || s.kind !== 'blade') throw new Error('no blade');
  return s;
}

function sand(height = 2): Terrain {
  const t = new Terrain(200, 200, 0.5);
  t.material.fill(MaterialId.SAND);
  t.height.fill(height);
  return t;
}

function drive(v: Vehicle, t: Terrain, input: ActionState, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) v.update(STEP, input, t);
}

/**
 * Drive a fixed DISTANCE rather than a fixed time, and report it.
 *
 * Pitch changes how hard the machine is working, so a fixed-time pass confounds
 * "how deep does it cut" with "how far did it get" — and once an overloaded
 * blade could actually bog the machine down, the second term swamped the first
 * and the measurement inverted.
 */
function driveMetres(v: Vehicle, t: Terrain, metres: number, capSeconds = 60): number {
  const from = v.state.position.z;
  const steps = Math.round(capSeconds / STEP);
  for (let i = 0; i < steps && v.state.position.z - from < metres; i++) {
    v.update(STEP, DRIVE, t);
  }
  return v.state.position.z - from;
}

describe('pitch articulation', () => {
  it('starts at the rest angle', () => {
    expect(blade(new Vehicle(bulldozerDef, SPAWN)).pitch).toBe(PITCH.rest);
  });

  it('rolls back and forward, stopping at the limits', () => {
    const t = sand();
    const back = new Vehicle(bulldozerDef, SPAWN);
    drive(back, t, { [BACK]: 1 }, 5);
    expect(blade(back).pitch).toBeCloseTo(PITCH.min, 5);

    const fwd = new Vehicle(bulldozerDef, SPAWN);
    drive(fwd, t, { [FORWARD]: 1 }, 5);
    expect(blade(fwd).pitch).toBeCloseTo(PITCH.max, 5);
  });

  it('does not cancel grade hold, unlike the lift lever', () => {
    const t = sand();
    const v = new Vehicle(bulldozerDef, SPAWN);
    v.update(STEP, { [HOLD]: 1 }, t);
    v.update(STEP, {}, t);
    expect(blade(v).gradeHold).toBe(true);

    // Pitch and elevation are independent questions; adjusting one while the
    // other holds is the normal case, not an accident.
    drive(v, t, { [FORWARD]: 1 }, 1);
    expect(blade(v).gradeHold).toBe(true);
    expect(blade(v).pitch).toBeGreaterThan(0);
  });
});

describe('the carry / bite trade', () => {
  it('raises capacity when rolled back and drops it when tipped forward', () => {
    const t = sand();
    const neutral = new Vehicle(bulldozerDef, SPAWN);
    drive(neutral, t, {}, 0.5);
    const base = blade(neutral).effectiveCapacity;
    expect(base).toBeCloseTo(bladeSpec.capacity, 5);

    const back = new Vehicle(bulldozerDef, SPAWN);
    drive(back, t, { [BACK]: 1 }, 5);
    expect(blade(back).effectiveCapacity).toBeGreaterThan(base * 1.3);

    const fwd = new Vehicle(bulldozerDef, SPAWN);
    drive(fwd, t, { [FORWARD]: 1 }, 5);
    expect(blade(fwd).effectiveCapacity).toBeLessThan(base * 0.8);
  });

  it('cuts deeper per metre tipped forward than rolled back', () => {
    /** Excavation per metre travelled. Same blade elevation, only pitch differs. */
    function cutPerMetre(pitchKey: string): number {
      const t = sand(2);
      const before = t.totalVolume();
      const v = new Vehicle(bulldozerDef, SPAWN);
      drive(v, t, { [pitchKey]: 1 }, 5); // set pitch before digging
      drive(v, t, { [LOWER]: 1 }, 1.2); // put the edge under the surface
      const travelled = driveMetres(v, t, 8);
      // Volume must not change at all; what differs is how much got rearranged.
      expect(t.totalVolume()).toBeCloseTo(before, 2);

      // Total excavation — everything now standing below the original surface.
      // Position-independent, unlike sampling a point the blade may never
      // have reached: it starts 2.9m AHEAD of the machine.
      let excavated = 0;
      for (let i = 0; i < t.height.length; i++) excavated += Math.max(0, 2 - t.height[i]);
      return (excavated * t.cellArea) / travelled;
    }

    // Forward pitch drops the cutting edge in — that is why it digs.
    expect(cutPerMetre(FORWARD)).toBeGreaterThan(cutPerMetre(BACK));
  });

  it('drops the cutting edge as it tips forward', () => {
    const t = sand();
    const v = new Vehicle(bulldozerDef, SPAWN);
    v.update(STEP, { [HOLD]: 1 }, t);
    v.update(STEP, {}, t);
    const level = v.state.position.y + blade(v).height;

    drive(v, t, { [FORWARD]: 1 }, 5);
    // Grade hold compensates by RAISING the lever, so the edge stays put: the
    // servo tracks the edge, not the ram position.
    expect(blade(v).height).toBeGreaterThan(level - v.state.position.y);
  });
});

describe('spilling', () => {
  it('carries a bigger load before it spills when rolled back', () => {
    /** Soil left standing outside the blade's swept width after a long push. */
    function sideCast(pitchKey: string): number {
      const t = sand(2);
      const v = new Vehicle(bulldozerDef, SPAWN);
      drive(v, t, { [pitchKey]: 1 }, 5);
      drive(v, t, { [LOWER]: 1 }, 1.2);
      driveMetres(v, t, 8);

      const halfWidth = bladeSpec.width / 2 + 0.3;
      let total = 0;
      for (let cz = 0; cz < t.depth; cz++) {
        for (let cx = 0; cx < t.width; cx++) {
          if (Math.abs(t.cellToWorldX(cx)) < halfWidth) continue;
          total += Math.max(0, t.height[t.index(cx, cz)] - 2);
        }
      }
      return total * t.cellArea;
    }

    // The whole point of the axis, and the answer to "the sand spills out".
    expect(sideCast(BACK)).toBeLessThan(sideCast(FORWARD));
  });
});

describe('a machine without pitch', () => {
  it('ignores the pitch actions entirely', () => {
    const fixed = {
      ...bulldozerDef,
      implements: [{ ...bladeSpec, pitch: undefined }],
    };
    const t = sand();
    const v = new Vehicle(fixed, SPAWN);
    drive(v, t, { [FORWARD]: 1 }, 3);

    expect(blade(v).pitch).toBe(0);
    expect(blade(v).effectiveCapacity).toBeCloseTo(bladeSpec.capacity, 5);
  });
});
