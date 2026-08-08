import { describe, expect, it } from 'vitest';
import { MaterialId } from '../../sim/materials';
import { Terrain } from '../../sim/Terrain';
import { sandboxMap } from './sandbox';

const build = () =>
  new Terrain(sandboxMap.width, sandboxMap.depth, sandboxMap.cellSize, sandboxMap.generate());

describe('sandbox map', () => {
  it('produces finite heights everywhere', () => {
    const t = build();
    expect(t.height.every(Number.isFinite)).toBe(true);
  });

  it('is deterministic across runs', () => {
    const a = sandboxMap.generate();
    const b = sandboxMap.generate();
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
    expect(Array.from(a.material)).toEqual(Array.from(b.material));
  });

  it('contains every material the MVP needs to exercise', () => {
    const { material } = sandboxMap.generate();
    const present = new Set(material);
    for (const id of [MaterialId.GRASS, MaterialId.SAND, MaterialId.MUD, MaterialId.ROCK]) {
      expect(present.has(id)).toBe(true);
    }
  });

  it('gives each material a meaningful share of the yard', () => {
    const { material } = sandboxMap.generate();
    const counts = new Map<number, number>();
    for (const m of material) counts.set(m, (counts.get(m) ?? 0) + 1);
    // Nothing should be a rounding error — each feature must be drivable-to.
    for (const id of [MaterialId.SAND, MaterialId.MUD, MaterialId.ROCK]) {
      expect(counts.get(id) ?? 0).toBeGreaterThan(400);
    }
    // Topsoil should still dominate the yard.
    expect(counts.get(MaterialId.GRASS) ?? 0).toBeGreaterThan(material.length * 0.4);
  });

  it('has a flat, drivable spawn pad', () => {
    const t = build();
    const { position } = sandboxMap.spawn;
    expect(Math.abs(t.sampleHeight(position.x, position.z))).toBeLessThan(0.05);

    // The pad should be level enough that a vehicle is not spawned on a ramp.
    const n = t.sampleNormal(position.x, position.z);
    expect(n.y).toBeGreaterThan(0.99);
    expect(t.sampleMaterial(position.x, position.z)).toBe(MaterialId.GRASS);
  });

  it('walls the yard in so you cannot drive off the edge', () => {
    const t = build();
    const mid = Math.floor(t.width / 2);
    for (const [cx, cz] of [
      [0, mid],
      [t.width - 1, mid],
      [mid, 0],
      [mid, t.depth - 1],
    ] as const) {
      expect(t.getHeight(cx, cz)).toBeGreaterThan(4);
      expect(t.getMaterial(cx, cz)).toBe(MaterialId.ROCK);
    }
  });

  it('keeps relief within a sane range for a construction yard', () => {
    const t = build();
    let min = Infinity;
    let max = -Infinity;
    for (const h of t.height) {
      if (h < min) min = h;
      if (h > max) max = h;
    }
    expect(min).toBeGreaterThan(-6);
    expect(max).toBeLessThan(16);
  });
});
