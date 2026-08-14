import { describe, expect, it } from 'vitest';
import { MaterialId } from '../materials';
import { Terrain } from '../Terrain';
import { TUNING } from '../tuning';
import { applyBladeCut, type BladeCutParams } from './blade';

function make(material: MaterialId = MaterialId.SAND, flatHeight = 0): Terrain {
  const t = new Terrain(81, 81, 0.5);
  t.material.fill(material);
  t.height.fill(flatHeight);
  return t;
}

function cut(terrain: Terrain, overrides: Partial<BladeCutParams> = {}) {
  return applyBladeCut({
    terrain,
    centerX: 0,
    centerZ: 0,
    heading: 0,
    width: 4,
    bladeHeight: 1.3,
    thickness: 0.5,
    edgeY: -0.4,
    capacity: 2.4,
    ...overrides,
  });
}

describe('volume conservation (FR-3.5)', () => {
  it('holds for a single cut', () => {
    const t = make(MaterialId.SAND, 1);
    const before = t.totalVolume();
    const result = cut(t);
    expect(result.volumeCut).toBeGreaterThan(0);
    expect(t.totalVolume()).toBeCloseTo(before, 6);
  });

  it('holds across a long push at many blade heights and headings', () => {
    const t = make(MaterialId.SAND, 1.5);
    const before = t.totalVolume();

    let x = -8;
    let heading = 0;
    for (let step = 0; step < 400; step++) {
      x += 0.07;
      heading += 0.004;
      cut(t, {
        centerX: x,
        centerZ: Math.sin(step * 0.02) * 3,
        heading,
        edgeY: -0.4 + Math.sin(step * 0.05) * 0.5,
      });
    }
    expect(t.totalVolume()).toBeCloseTo(before, 4);
  });

  it('holds even when the blade is overloaded and spilling sideways', () => {
    const t = make(MaterialId.SAND, 4); // deep material, forces overload
    const before = t.totalVolume();
    for (let i = 0; i < 120; i++) cut(t, { centerX: -4 + i * 0.06, edgeY: -0.5 });
    expect(t.totalVolume()).toBeCloseTo(before, 4);
  });

  it('holds when the blade works right at the map edge', () => {
    const t = make(MaterialId.SAND, 2);
    const before = t.totalVolume();
    const edge = t.worldWidth / 2;
    for (let i = 0; i < 60; i++) {
      cut(t, { centerX: edge - 0.5 + i * 0.02, centerZ: 0, heading: Math.PI / 2 });
    }
    expect(t.totalVolume()).toBeCloseTo(before, 4);
  });
});

describe('cutting (FR-3.1)', () => {
  it('cuts ground down to the cutting edge', () => {
    const t = make(MaterialId.SAND, 1);
    cut(t, { edgeY: 0.25 });
    const under = t.getHeight(
      Math.round(t.worldToCellX(0)),
      Math.round(t.worldToCellZ(0)),
    );
    expect(under).toBeCloseTo(0.25, 6);
  });

  it('takes nothing when the blade rides above the ground', () => {
    const t = make(MaterialId.SAND, 0);
    const result = cut(t, { edgeY: 1.5 });
    expect(result.volumeCut).toBe(0);
  });

  it('cuts nothing more once the ground is already at the edge', () => {
    const t = make(MaterialId.SAND, 1);
    const first = cut(t, { edgeY: 0.2 });
    const second = cut(t, { edgeY: 0.2 });
    expect(first.volumeCut).toBeGreaterThan(0);
    expect(second.volumeCut).toBeCloseTo(0, 9);
  });

  it('cuts while parked if the blade is driven downward', () => {
    const t = make(MaterialId.SAND, 1);
    cut(t, { edgeY: 0.5 });
    const deeper = cut(t, { edgeY: 0.2 });
    expect(deeper.volumeCut).toBeGreaterThan(0);
  });

  it('scales the cut with blade width', () => {
    const narrow = cut(make(MaterialId.SAND, 1), { width: 2 });
    const wide = cut(make(MaterialId.SAND, 1), { width: 6 });
    expect(wide.volumeCut).toBeGreaterThan(narrow.volumeCut * 2);
  });
});

describe('rock refuses the cut (FR-3.2)', () => {
  it('does not move rock and reports blocked', () => {
    const t = make(MaterialId.ROCK, 2);
    const before = Float32Array.from(t.height);
    const result = cut(t, { edgeY: 0 });

    expect(result.blocked).toBe(true);
    expect(result.volumeCut).toBe(0);
    for (let i = 0; i < before.length; i++) expect(t.height[i]).toBe(before[i]);
  });

  it('nearly stops the machine when buried in rock', () => {
    const result = cut(make(MaterialId.ROCK, 2), { edgeY: 0 });
    expect(result.resistance).toBeGreaterThan(0.9);
  });

  it('cuts the soil beside an outcrop without touching the rock', () => {
    const t = make(MaterialId.SAND, 1);
    const rockCell = t.index(Math.round(t.worldToCellX(1)), Math.round(t.worldToCellZ(0)));
    t.material[rockCell] = MaterialId.ROCK;

    const result = cut(t, { edgeY: 0 });
    expect(result.blocked).toBe(true);
    expect(result.volumeCut).toBeGreaterThan(0); // the sand still went
    expect(t.height[rockCell]).toBe(1); // the rock did not
  });
});

describe('carry and deposit (FR-3.3, FR-3.4)', () => {
  it('builds a prow ahead of the blade rather than hiding the soil', () => {
    const t = make(MaterialId.SAND, 1);
    const result = cut(t, { edgeY: -0.2 });
    expect(result.prowVolume).toBeGreaterThan(0);

    // The soil is real terrain, standing in front of the cutting edge.
    const ahead = t.getHeight(
      Math.round(t.worldToCellX(0)),
      Math.round(t.worldToCellZ(1.2)),
    );
    expect(ahead).toBeGreaterThan(1);
  });

  it('grows the prow as the machine keeps pushing', () => {
    // Geometry the game can actually produce: the blade hangs below the
    // MACHINE's ground line, so on flat ground the cut is at most ~0.5m deep.
    const GROUND = 1.2;
    const t = make(MaterialId.SAND, GROUND);

    const first = cut(t, { centerZ: -3, edgeY: GROUND - 0.4 });
    let latest = first;
    for (let i = 1; i < 30; i++) {
      latest = cut(t, { centerZ: -3 + i * 0.067, edgeY: GROUND - 0.4 });
    }
    expect(latest.prowVolume).toBeGreaterThan(first.prowVolume * 2);
  });

  it('deposits ahead along the heading, not behind', () => {
    const t = make(MaterialId.SAND, 1);
    cut(t, { heading: 0, edgeY: -0.3 });

    const ahead = t.sampleHeight(0, 1.4);
    const behind = t.sampleHeight(0, -1.4);
    expect(ahead).toBeGreaterThan(behind);
  });

  it('follows the heading when the machine is turned', () => {
    const t = make(MaterialId.SAND, 1);
    cut(t, { heading: Math.PI / 2, edgeY: -0.3 }); // facing +X

    expect(t.sampleHeight(1.4, 0)).toBeGreaterThan(t.sampleHeight(-1.4, 0));
  });

  it('carries sand out over topsoil, leaving a sand trail', () => {
    const t = make(MaterialId.GRASS, 0);
    // A band of sand for the blade to pick up.
    for (let cz = 0; cz < t.depth; cz++) {
      for (let cx = 0; cx < t.width; cx++) {
        if (t.cellToWorldZ(cz) < 0.5) {
          t.material[t.index(cx, cz)] = MaterialId.SAND;
          t.height[t.index(cx, cz)] = 1;
        }
      }
    }
    cut(t, { centerZ: 0, edgeY: -0.2 });
    expect(t.sampleMaterial(0, 1.4)).toBe(MaterialId.SAND);
  });

  it('spills off the ends once the blade is overloaded', () => {
    const t = make(MaterialId.SAND, 3);
    let sawSideSpill = false;
    for (let i = 0; i < 80; i++) {
      cut(t, { centerZ: -2 + i * 0.05, edgeY: -0.5 });
      // Beyond the 4m blade's half-width, soil should start appearing.
      if (t.sampleHeight(2.6, -2 + i * 0.05) > 3.05) sawSideSpill = true;
    }
    expect(sawSideSpill).toBe(true);
  });

  /**
   * Regression: spill used to be a THRESHOLD — nothing at all below capacity,
   * then 45% of every cut dumped sideways the instant it was crossed. Volume
   * was conserved perfectly and it felt like the load randomly falling out of
   * the blade, because there was no build-up to feel. A real blade sheds more
   * as it fills, so the fraction now ramps with how far over capacity it is.
   */
  describe('side spill ramps with load', () => {
    const GROUND = 3;

    /** Soil left standing outside the blade's swept width, m³. */
    function sideCast(t: Terrain): number {
      let total = 0;
      for (let cz = 0; cz < t.depth; cz++) {
        for (let cx = 0; cx < t.width; cx++) {
          if (Math.abs(t.cellToWorldX(cx)) < 2.1) continue;
          total += Math.max(0, t.height[t.index(cx, cz)] - GROUND);
        }
      }
      return total * t.cellArea;
    }

    /** A long shallow push, sampling cumulative cut and side-cast as it goes. */
    function push(pushes: number) {
      const t = make(MaterialId.SAND, GROUND);
      const marks: { at: number; cut: number; side: number }[] = [];
      let cutTotal = 0;
      for (let i = 0; i < pushes; i++) {
        cutTotal += cut(t, { centerZ: -3 + i * 0.05, edgeY: GROUND - 0.3 }).volumeCut;
        if (i % 25 === 24) marks.push({ at: i + 1, cut: cutTotal, side: sideCast(t) });
      }
      return marks;
    }

    it('casts nothing aside while the blade is still filling', () => {
      // Measured: 50 shallow pushes leave the prow under the 2.4m³ capacity.
      const marks = push(50);
      expect(marks[marks.length - 1].side).toBeCloseTo(0, 9);
    });

    it('sheds gently just past capacity and harder well beyond it', () => {
      const marks = push(150);
      const spillFraction = (a: number, b: number) =>
        (marks[b].side - marks[a].side) / (marks[b].cut - marks[a].cut);

      const justOver = spillFraction(1, 2); // pushes 50 -> 75
      const wellOver = spillFraction(3, 5); // pushes 100 -> 150

      expect(justOver).toBeGreaterThan(0);
      // The old threshold model would have jumped straight to the maximum, so
      // these two numbers would have been equal.
      expect(wellOver).toBeGreaterThan(justOver * 2);
      expect(justOver).toBeLessThan(TUNING.sideSpillFraction * 0.25);
    });
  });
});

describe('resistance', () => {
  it('is zero when the blade is riding clear of the ground', () => {
    expect(cut(make(MaterialId.SAND, 0), { edgeY: 2 }).resistance).toBe(0);
  });

  it('rises with the load being pushed', () => {
    const GROUND = 2;
    const t = make(MaterialId.SAND, GROUND);
    const first = cut(t, { centerZ: -2, edgeY: GROUND - 0.4 });
    let latest = first;
    for (let i = 1; i < 30; i++) {
      latest = cut(t, { centerZ: -2 + i * 0.067, edgeY: GROUND - 0.4 });
    }
    expect(first.resistance).toBeLessThan(0.4);
    expect(latest.resistance).toBeGreaterThan(first.resistance * 2);
  });

  // Regression: an earlier model derived resistance from volume/dt, which
  // pinned it at maximum on the very first tick because one bite into a bank
  // removes a whole cell row at once. A normal cut must start light.
  it('does not spike on the first bite into deep material', () => {
    const GROUND = 6;
    const first = cut(make(MaterialId.SAND, GROUND), { edgeY: GROUND - 0.4 });
    expect(first.resistance).toBeLessThan(0.4);
  });

  it('does report a heavy load when the blade is buried deep', () => {
    // Ramming the blade well below grade SHOULD bog the machine down — at
    // least as hard as a full blade, expressed against the tunable rather than
    // a magic number that goes stale the moment someone retunes the game.
    // Not yet a stall, though: one bite is not an overload.
    const GROUND = 3;
    const deep = cut(make(MaterialId.SAND, GROUND), { edgeY: GROUND - 1.3 });
    expect(deep.resistance).toBeGreaterThanOrEqual(TUNING.fullBladeResistance);
    expect(deep.resistance).toBeLessThan(1);
  });

  // A blade that drags no harder at three times capacity than at capacity is a
  // blade with no limit: measured in play, the machine pushed 10 m3 at exactly
  // the same 1.62 m/s it pushed 3.4. Drag has to keep climbing past full.
  it('keeps dragging harder as the prow grows past a full blade', () => {
    const t = make(MaterialId.SAND, 6);
    let atCapacity = 0;
    let overloaded = 0;
    for (let i = 0; i < 40; i++) {
      const r = cut(t, { centerZ: -1 + i * 0.05, edgeY: -0.5 });
      if (r.prowVolume > 2.4 && atCapacity === 0) atCapacity = r.resistance;
      if (r.prowVolume > 2.4 * TUNING.stallFill) overloaded = r.resistance;
    }
    expect(atCapacity).toBeGreaterThan(0);
    expect(overloaded).toBeGreaterThan(atCapacity);
    expect(overloaded).toBeCloseTo(1, 5); // a prow this size stops the machine
  });
});

describe('reported region', () => {
  it('covers both the cut and the deposit', () => {
    const t = make(MaterialId.SAND, 1);
    const result = cut(t, { edgeY: -0.3 });
    expect(result.region).not.toBeNull();

    const cellZ = Math.round(t.worldToCellZ(0));
    expect(result.region!.z0).toBeLessThanOrEqual(cellZ);
    expect(result.region!.z1).toBeGreaterThan(cellZ); // reaches ahead
  });

  it('marks the terrain dirty so the renderer picks the change up', () => {
    const t = make(MaterialId.SAND, 1);
    t.consumeDirty();
    cut(t, { edgeY: -0.3 });
    expect(t.consumeDirty()).not.toBeNull();
  });
});
