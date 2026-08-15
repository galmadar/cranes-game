/**
 * The lift yard has to be WINNABLE, not merely present.
 *
 * A crane map can fail in ways a dozer map cannot, and none of them are
 * visible by looking at it: a pad half a metre past the chart, a load standing
 * where the boom will not reach, a slab with a slope under the tracks. Every
 * one produces a site that looks completely fine and cannot be finished.
 *
 * So these tests do the arithmetic the map is asserting. The most important
 * one is the last: for every load, there is somewhere to stand from which the
 * crane can pick it up AND set it down. That is the map's whole promise.
 */

import { describe, expect, it } from 'vitest';
import { MaterialId } from '../../sim/materials';
import { Terrain } from '../../sim/Terrain';
import { crawlerCraneDef } from '../vehicles/crawlerCrane.def';
import { liftYardMap } from './liftYard';

const build = (): Terrain =>
  new Terrain(liftYardMap.width, liftYardMap.depth, liftYardMap.cellSize, liftYardMap.generate());

const craneSpec = crawlerCraneDef.implements[0];
if (craneSpec.kind !== 'crane') throw new Error('crawler crane must carry a crane implement');
const SPEC = craneSpec;

/** What the chart allows at a radius — the same hyperbola the implement uses. */
const ratedAt = (radius: number): number =>
  radius <= SPEC.minRadius ? SPEC.maxLoad : (SPEC.maxLoad * SPEC.minRadius) / radius;

/** Working radii the boom can actually reach, from steepest to flattest. */
const MIN_RADIUS = SPEC.pivot.z + SPEC.boomLength * Math.cos(SPEC.luff.max);
const MAX_RADIUS = SPEC.pivot.z + SPEC.boomLength * Math.cos(SPEC.luff.min);

const content = liftYardMap.populate?.();
if (!content) throw new Error('the lift yard must populate loads and pads');

describe('the yard itself', () => {
  it('produces finite heights everywhere', () => {
    expect(build().height.every(Number.isFinite)).toBe(true);
  });

  it('is deterministic across runs', () => {
    const a = liftYardMap.generate();
    const b = liftYardMap.generate();
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
    expect(Array.from(a.material)).toEqual(Array.from(b.material));
  });

  it('is dead flat and dead level everywhere the work happens', () => {
    const t = build();
    // The boom kinematics assume the machine is standing level. Any slope
    // inside the working area is the map quietly breaking that assumption.
    for (const load of content.payloads) {
      expect(Math.abs(t.sampleHeight(load.x, load.z))).toBeLessThan(0.01);
    }
    for (const target of content.liftTargets) {
      expect(Math.abs(t.sampleHeight(target.x, target.z))).toBeLessThan(0.01);
    }
  });

  it('is hardstand under the loads and the pads, so nothing can be dug', () => {
    const t = build();
    for (const p of [...content.payloads, ...content.liftTargets]) {
      expect(t.sampleMaterial(p.x, p.z)).toBe(MaterialId.ROCK);
    }
  });

  it('spawns the crane on the slab, clear of everything', () => {
    const t = build();
    const { x, z } = liftYardMap.spawn.position;
    expect(Math.abs(t.sampleHeight(x, z))).toBeLessThan(0.01);

    for (const load of content.payloads) {
      expect(Math.hypot(load.x - x, load.z - z)).toBeGreaterThan(6);
    }
  });

  it('puts something in the way, or the layout is a straight line', () => {
    const t = build();
    // The stack. Without an obstacle the whole job is one slew and a drive.
    let tallest = 0;
    for (let i = 0; i < t.height.length; i++) {
      const cx = i % t.width;
      const cz = (i - cx) / t.width;
      const wx = t.cellToWorldX(cx);
      const wz = t.cellToWorldZ(cz);
      if (Math.abs(wx) > 20 || Math.abs(wz) > 20) continue; // ignore berm and spoil
      if (t.height[i] > tallest) tallest = t.height[i];
    }
    expect(tallest).toBeGreaterThan(2);
  });
});

describe('every load can be lifted, and every pad can be filled', () => {
  it('pairs each pad with a load of the kind it accepts', () => {
    for (const target of content.liftTargets) {
      const matching = content.payloads.filter((p) => p.kind === target.accepts);
      expect(matching.length).toBeGreaterThan(0);
    }
    // And there are exactly as many loads as places to put them, so the job
    // has no spare — every load on the yard is one you have to move.
    expect(content.payloads.length).toBe(content.liftTargets.length);
  });

  it('leaves no load too heavy to lift at any radius the boom has', () => {
    for (const load of content.payloads) {
      expect(load.mass).toBeLessThanOrEqual(ratedAt(MIN_RADIUS));
    }
  });

  /**
   * Somewhere to stand for each half of the lift.
   *
   * Deliberately NOT the same stance for both. A crawler crane travels with a
   * load on the hook — slowly, and that slowness is modelled — so requiring one
   * stance to serve the laydown and the pad would rule out exactly the lifts
   * that make the machine interesting. What the map does have to promise is
   * that each half is possible from somewhere on the slab.
   */
  function stanceExists(x0: number, z0: number, mass: number): boolean {
    for (let x = -30; x <= 30; x += 0.5) {
      for (let z = -26; z <= 26; z += 0.5) {
        const radius = Math.hypot(x0 - x, z0 - z);
        if (radius < MIN_RADIUS || radius > MAX_RADIUS) continue;
        if (mass > ratedAt(radius)) continue;
        return true;
      }
    }
    return false;
  }

  it('has somewhere to park to pick each load up, and somewhere to set it down', () => {
    for (const load of content.payloads) {
      const pad = content.liftTargets.find((t) => t.accepts === load.kind);
      expect(pad, `nothing accepts a ${load.kind}`).toBeDefined();
      if (!pad) continue;

      expect(stanceExists(load.x, load.z, load.mass), `cannot pick up ${load.id}`).toBe(true);
      expect(stanceExists(pad.x, pad.z, load.mass), `cannot set down on ${pad.id}`).toBe(true);
    }
  });

  /** How far apart the two halves of a lift are, in stances. */
  function servedByOneStance(
    load: { x: number; z: number; mass: number },
    pad: { x: number; z: number },
  ): boolean {
    for (let x = -30; x <= 30; x += 0.5) {
      for (let z = -26; z <= 26; z += 0.5) {
        const pick = Math.hypot(load.x - x, load.z - z);
        const set = Math.hypot(pad.x - x, pad.z - z);
        if (pick < MIN_RADIUS || pick > MAX_RADIUS) continue;
        if (set < MIN_RADIUS || set > MAX_RADIUS) continue;
        // The chart has to hold at BOTH radii, not just the shorter one.
        if (load.mass > ratedAt(pick) || load.mass > ratedAt(set)) continue;
        return true;
      }
    }
    return false;
  }

  it('opens with lifts you can do standing still and closes with ones you cannot', () => {
    const oneStance = content.payloads.map((load) => {
      const pad = content.liftTargets.find((t) => t.accepts === load.kind);
      return pad ? servedByOneStance(load, pad) : false;
    });

    // Something to learn the controls on: park once, hook, slew, set down.
    expect(oneStance.some(Boolean)).toBe(true);
    // And something that forces the rest of the machine to matter. If every
    // lift were a slew, the site would be a turntable with scenery.
    expect(oneStance.some((v) => !v)).toBe(true);
  });
});
