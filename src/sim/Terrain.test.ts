import { describe, expect, it } from 'vitest';
import { MaterialId } from './materials';
import { Terrain } from './Terrain';

const make = (w = 8, d = 8, cell = 0.5) => new Terrain(w, d, cell);

describe('Terrain construction', () => {
  it('defaults to flat topsoil', () => {
    const t = make();
    expect(t.height.every((h) => h === 0)).toBe(true);
    expect(t.material.every((m) => m === MaterialId.GRASS)).toBe(true);
  });

  it('rejects degenerate grids', () => {
    expect(() => new Terrain(1, 8, 0.5)).toThrow(/at least 2x2/);
    expect(() => new Terrain(8, 8, 0)).toThrow(/cellSize/);
  });

  it('rejects mis-sized init arrays', () => {
    expect(
      () => new Terrain(4, 4, 1, { height: new Float32Array(9), material: new Uint8Array(16) }),
    ).toThrow(/must be 16 long/);
  });
});

describe('coordinate mapping', () => {
  it('centres the grid on the origin', () => {
    const t = make(9, 9, 1); // 8m x 8m
    expect(t.worldWidth).toBe(8);
    expect(t.cellToWorldX(0)).toBe(-4);
    expect(t.cellToWorldX(8)).toBe(4);
    expect(t.cellToWorldX(4)).toBe(0);
  });

  it('round-trips world <-> cell', () => {
    const t = make(16, 16, 0.25);
    for (const cx of [0, 3, 15]) {
      expect(t.worldToCellX(t.cellToWorldX(cx))).toBeCloseTo(cx, 10);
    }
  });
});

describe('sampling', () => {
  it('returns exact heights at cell corners', () => {
    const t = make(4, 4, 1);
    t.setHeight(1, 2, 5);
    expect(t.sampleHeight(t.cellToWorldX(1), t.cellToWorldZ(2))).toBeCloseTo(5, 6);
  });

  it('interpolates linearly between corners', () => {
    const t = make(4, 4, 1);
    t.setHeight(1, 1, 0);
    t.setHeight(2, 1, 4);
    const midX = (t.cellToWorldX(1) + t.cellToWorldX(2)) / 2;
    expect(t.sampleHeight(midX, t.cellToWorldZ(1))).toBeCloseTo(2, 6);
  });

  it('clamps outside the grid instead of returning garbage', () => {
    const t = make(4, 4, 1);
    t.setHeight(0, 0, 3);
    expect(Number.isFinite(t.sampleHeight(-1000, -1000))).toBe(true);
    expect(t.sampleHeight(-1000, -1000)).toBeCloseTo(3, 6);
  });

  it('reports a flat surface as straight up', () => {
    const n = make().sampleNormal(0, 0);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeCloseTo(1, 6);
    expect(n.z).toBeCloseTo(0, 6);
  });

  it('tilts the normal away from an uphill slope', () => {
    const t = make(16, 16, 1);
    // Ground rising towards +x.
    for (let cz = 0; cz < t.depth; cz++) {
      for (let cx = 0; cx < t.width; cx++) t.setHeight(cx, cz, cx * 0.5);
    }
    const n = t.sampleNormal(0, 0);
    expect(n.x).toBeLessThan(0); // normal leans back down the slope
    expect(n.y).toBeGreaterThan(0);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
  });
});

describe('volume', () => {
  it('is height sum scaled by cell area', () => {
    const t = make(4, 4, 2); // cellArea = 4
    t.setHeight(0, 0, 1);
    t.setHeight(1, 0, 2);
    expect(t.totalVolume()).toBeCloseTo(12, 6);
  });

  // The FR-3.5 invariant M3 is built around: moving soil between cells must
  // never create or destroy it.
  it('is unchanged by a soil transfer between cells', () => {
    const t = make(8, 8, 0.5);
    for (let i = 0; i < t.height.length; i++) t.height[i] = 2;
    const before = t.totalVolume();
    t.addHeight(3, 3, -0.75);
    t.addHeight(4, 3, +0.75);
    expect(t.totalVolume()).toBeCloseTo(before, 6);
  });
});

describe('dirty tracking', () => {
  it('starts fully dirty so the first render populates everything', () => {
    const t = make(4, 4, 1);
    expect(t.consumeDirty()).toEqual({ x0: 0, z0: 0, x1: 3, z1: 3 });
  });

  it('clears after being consumed', () => {
    const t = make();
    t.consumeDirty();
    expect(t.consumeDirty()).toBeNull();
  });

  it('merges separate edits into one bounding rect', () => {
    const t = make(16, 16, 1);
    t.consumeDirty();
    t.setHeight(2, 3, 1);
    t.setHeight(7, 5, 1);
    expect(t.consumeDirty()).toEqual({ x0: 2, z0: 3, x1: 7, z1: 5 });
  });

  it('stays clean when a write falls outside the grid', () => {
    const t = make(4, 4, 1);
    t.consumeDirty();
    t.setHeight(-5, 0, 99);
    t.setHeight(0, 400, 99);
    expect(t.consumeDirty()).toBeNull();
  });
});
