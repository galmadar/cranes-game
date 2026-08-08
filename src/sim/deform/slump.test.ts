import { describe, expect, it } from 'vitest';
import { MaterialId, MATERIALS } from '../materials';
import { Terrain } from '../Terrain';
import { relaxSlump } from './slump';

const WHOLE = (t: Terrain) => ({ x0: 0, z0: 0, x1: t.width - 1, z1: t.depth - 1 });

function make(material: MaterialId = MaterialId.SAND, size = 21, cell = 0.5): Terrain {
  const t = new Terrain(size, size, cell);
  t.material.fill(material);
  return t;
}

/** Steepest slope anywhere in the grid, as a ratio (rise / run). */
function maxGradient(t: Terrain): number {
  let worst = 0;
  for (let cz = 0; cz < t.depth; cz++) {
    for (let cx = 0; cx < t.width; cx++) {
      const h = t.getHeight(cx, cz);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= t.width || nz >= t.depth) continue;
        worst = Math.max(worst, (h - t.getHeight(nx, nz)) / t.cellSize);
      }
    }
  }
  return worst;
}

describe('volume conservation (FR-3.5)', () => {
  it('holds while a spike collapses', () => {
    const t = make();
    t.setHeight(10, 10, 12);
    const before = t.totalVolume();
    relaxSlump(t, WHOLE(t), 200);
    expect(t.totalVolume()).toBeCloseTo(before, 6);
  });

  it('holds across a jagged random field', () => {
    const t = make();
    let seed = 7;
    for (let i = 0; i < t.height.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      t.height[i] = (seed / 0x7fffffff) * 9;
    }
    const before = t.totalVolume();
    relaxSlump(t, WHOLE(t), 120);
    expect(t.totalVolume()).toBeCloseTo(before, 5);
  });

  it('holds when soil slumps out past the relaxed region', () => {
    const t = make();
    t.setHeight(10, 10, 14);
    const before = t.totalVolume();
    // A window that the collapsing pile will spill beyond.
    relaxSlump(t, { x0: 9, z0: 9, x1: 11, z1: 11 }, 60);
    expect(t.totalVolume()).toBeCloseTo(before, 6);
  });
});

describe('convergence', () => {
  it('brings a spike down to the material angle of repose', () => {
    const t = make(MaterialId.SAND);
    t.setHeight(10, 10, 10);
    relaxSlump(t, WHOLE(t), 4000);

    const limit = Math.tan(MATERIALS[MaterialId.SAND].angleOfRepose);
    // Tolerance covers the damped final approach, not a violated constraint.
    expect(maxGradient(t)).toBeLessThan(limit * 1.05);
  });

  it('settles rather than oscillating — it reports quiet and stays put', () => {
    const t = make();
    t.setHeight(10, 10, 8);
    relaxSlump(t, WHOLE(t), 4000);

    const snapshot = Float32Array.from(t.height);
    const result = relaxSlump(t, WHOLE(t), 50);

    expect(result.settled).toBe(true);
    expect(result.passes).toBe(1); // detected rest immediately
    for (let i = 0; i < snapshot.length; i++) {
      expect(t.height[i]).toBeCloseTo(snapshot[i], 9);
    }
  });

  it('never lets a cell overshoot below its neighbour', () => {
    const t = make();
    t.setHeight(10, 10, 6);
    for (let i = 0; i < 200; i++) {
      relaxSlump(t, WHOLE(t), 1);
      // The peak must fall monotonically toward rest, never dip under the ring
      // around it — that would be the signature of an oscillating solver.
      expect(t.getHeight(10, 10)).toBeGreaterThanOrEqual(t.getHeight(11, 10) - 1e-6);
    }
  });

  it('leaves ground that already obeys the repose angle untouched', () => {
    const t = make();
    for (let cz = 0; cz < t.depth; cz++) {
      for (let cx = 0; cx < t.width; cx++) t.setHeight(cx, cz, cx * 0.05); // very gentle
    }
    const before = Float32Array.from(t.height);
    const result = relaxSlump(t, WHOLE(t), 10);
    expect(result.settled).toBe(true);
    for (let i = 0; i < before.length; i++) expect(t.height[i]).toBeCloseTo(before[i], 9);
  });
});

describe('material behaviour', () => {
  it('lets mud spread flatter than sand', () => {
    const spread = (material: MaterialId): number => {
      const t = make(material);
      t.setHeight(10, 10, 8);
      relaxSlump(t, WHOLE(t), 4000);
      return t.getHeight(10, 10);
    };
    // Mud has the lower angle of repose, so the same pile ends up shorter.
    expect(spread(MaterialId.MUD)).toBeLessThan(spread(MaterialId.SAND));
  });

  it('does not erode rock', () => {
    const t = make(MaterialId.ROCK);
    t.setHeight(10, 10, 20);
    relaxSlump(t, WHOLE(t), 500);
    expect(t.getHeight(10, 10)).toBe(20);
  });

  it('still lets soil pile onto rock', () => {
    const t = make(MaterialId.SAND);
    t.setMaterial(11, 10, MaterialId.ROCK);
    t.setHeight(10, 10, 8);
    const before = t.totalVolume();
    relaxSlump(t, WHOLE(t), 500);
    expect(t.getHeight(11, 10)).toBeGreaterThan(0);
    expect(t.totalVolume()).toBeCloseTo(before, 6);
  });
});
