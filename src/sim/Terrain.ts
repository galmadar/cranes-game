/**
 * Terrain — a height field plus a parallel material grid.
 *
 * This is the single source of truth for the ground. The renderer is a *view*
 * over this data and never writes to it (NFR-1).
 *
 * Coordinate model
 * ----------------
 * The grid is centred on the world origin. Cell (cx, cz) sits at world
 * (originX + cx * cellSize, height[i], originZ + cz * cellSize). Heights live
 * at cell CORNERS (vertices), not cell centres, so a (width x depth) grid
 * describes (width-1) x (depth-1) quads.
 */

import { MaterialId } from './materials';
import { normalize, vec3, type Vec3 } from './math/Vec';

/** Inclusive cell bounds. */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface TerrainInit {
  height: Float32Array;
  material: Uint8Array;
}

export class Terrain {
  readonly width: number;
  readonly depth: number;
  readonly cellSize: number;

  readonly height: Float32Array;
  readonly material: Uint8Array;

  /**
   * How churned-up each cell's surface is, 0..255. Purely a surface property —
   * it carries no soil and so cannot affect volume conservation.
   *
   * This is what track marks and freshly-dug ground are made of. Doing it as a
   * height change instead would look right and be wrong: compacting soil under
   * the tracks would quietly destroy volume, and FR-3.5 is the one invariant
   * this whole simulation is built around.
   */
  readonly disturbance: Uint8Array;

  readonly originX: number;
  readonly originZ: number;

  /**
   * Region changed since the renderer last synced (NFR-3). Kept as a single
   * merged rectangle: cheap to maintain, and a bulldozer blade only ever
   * touches one small contiguous patch per step.
   */
  private dirty: Rect | null = null;

  constructor(width: number, depth: number, cellSize: number, init?: TerrainInit) {
    if (width < 2 || depth < 2) {
      throw new Error(`Terrain must be at least 2x2 cells, got ${width}x${depth}`);
    }
    if (cellSize <= 0) {
      throw new Error(`Terrain cellSize must be positive, got ${cellSize}`);
    }

    this.width = width;
    this.depth = depth;
    this.cellSize = cellSize;

    const count = width * depth;
    if (init) {
      if (init.height.length !== count || init.material.length !== count) {
        throw new Error(
          `Terrain init arrays must be ${count} long ` +
            `(got height=${init.height.length}, material=${init.material.length})`,
        );
      }
      this.height = init.height;
      this.material = init.material;
    } else {
      this.height = new Float32Array(count);
      this.material = new Uint8Array(count).fill(MaterialId.GRASS);
    }
    this.disturbance = new Uint8Array(count);

    this.originX = -((width - 1) * cellSize) / 2;
    this.originZ = -((depth - 1) * cellSize) / 2;

    this.markAllDirty();
  }

  // ---------------------------------------------------------------- geometry

  get worldWidth(): number {
    return (this.width - 1) * this.cellSize;
  }

  get worldDepth(): number {
    return (this.depth - 1) * this.cellSize;
  }

  get cellArea(): number {
    return this.cellSize * this.cellSize;
  }

  index(cx: number, cz: number): number {
    return cz * this.width + cx;
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.width && cz < this.depth;
  }

  cellToWorldX(cx: number): number {
    return this.originX + cx * this.cellSize;
  }

  cellToWorldZ(cz: number): number {
    return this.originZ + cz * this.cellSize;
  }

  /** World -> continuous cell coordinate (may be fractional / out of range). */
  worldToCellX(x: number): number {
    return (x - this.originX) / this.cellSize;
  }

  worldToCellZ(z: number): number {
    return (z - this.originZ) / this.cellSize;
  }

  // ------------------------------------------------------------------ access

  private clampX(cx: number): number {
    return cx < 0 ? 0 : cx >= this.width ? this.width - 1 : cx;
  }

  private clampZ(cz: number): number {
    return cz < 0 ? 0 : cz >= this.depth ? this.depth - 1 : cz;
  }

  /** Height at a cell. Out-of-range reads clamp to the edge. */
  getHeight(cx: number, cz: number): number {
    return this.height[this.index(this.clampX(cx), this.clampZ(cz))];
  }

  /** Material at a cell. Out-of-range reads clamp to the edge. */
  getMaterial(cx: number, cz: number): MaterialId {
    return this.material[this.index(this.clampX(cx), this.clampZ(cz))] as MaterialId;
  }

  /** Out-of-range writes are ignored (the blade may overhang the map edge). */
  setHeight(cx: number, cz: number, value: number): void {
    if (!this.inBounds(cx, cz)) return;
    this.height[this.index(cx, cz)] = value;
    this.markDirty(cx, cz, cx, cz);
  }

  addHeight(cx: number, cz: number, delta: number): void {
    if (!this.inBounds(cx, cz)) return;
    this.height[this.index(cx, cz)] += delta;
    this.markDirty(cx, cz, cx, cz);
  }

  setMaterial(cx: number, cz: number, material: MaterialId): void {
    if (!this.inBounds(cx, cz)) return;
    this.material[this.index(cx, cz)] = material;
    this.markDirty(cx, cz, cx, cz);
  }

  /**
   * Raise a cell's disturbance to at least `value` (0..255). Never lowers it —
   * ground does not un-churn.
   *
   * Only dirties the terrain when the value actually changed, so a machine
   * grinding over ground it has already torn up does not re-upload geometry
   * every frame.
   */
  disturb(cx: number, cz: number, value: number): void {
    if (!this.inBounds(cx, cz)) return;
    const i = this.index(cx, cz);
    const next = value > 255 ? 255 : value < 0 ? 0 : value | 0;
    if (next <= this.disturbance[i]) return;
    this.disturbance[i] = next;
    this.markDirty(cx, cz, cx, cz);
  }

  /** Disturb every cell within `radius` world units of a point. */
  disturbAround(x: number, z: number, radius: number, value: number): void {
    const r = Math.max(radius, this.cellSize * 0.5);
    const cx0 = Math.floor(this.worldToCellX(x - r));
    const cx1 = Math.ceil(this.worldToCellX(x + r));
    const cz0 = Math.floor(this.worldToCellZ(z - r));
    const cz1 = Math.ceil(this.worldToCellZ(z + r));
    const r2 = r * r;

    for (let cz = cz0; cz <= cz1; cz++) {
      const dz = this.cellToWorldZ(cz) - z;
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = this.cellToWorldX(cx) - x;
        if (dx * dx + dz * dz > r2) continue;
        this.disturb(cx, cz, value);
      }
    }
  }

  // ---------------------------------------------------------------- sampling

  /** Bilinearly interpolated ground height at a world position. */
  sampleHeight(x: number, z: number): number {
    const fx = this.worldToCellX(x);
    const fz = this.worldToCellZ(z);
    const cx = Math.floor(fx);
    const cz = Math.floor(fz);
    const tx = fx - cx;
    const tz = fz - cz;

    const h00 = this.getHeight(cx, cz);
    const h10 = this.getHeight(cx + 1, cz);
    const h01 = this.getHeight(cx, cz + 1);
    const h11 = this.getHeight(cx + 1, cz + 1);

    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  /** Material at a world position (nearest cell — materials do not interpolate). */
  sampleMaterial(x: number, z: number): MaterialId {
    return this.getMaterial(
      Math.round(this.worldToCellX(x)),
      Math.round(this.worldToCellZ(z)),
    );
  }

  /**
   * Upward surface normal at a world position, via central differences.
   * M2 uses this for vehicle pitch/roll (FR-2.3).
   */
  sampleNormal(x: number, z: number): Vec3 {
    const e = this.cellSize;
    const dx = (this.sampleHeight(x + e, z) - this.sampleHeight(x - e, z)) / (2 * e);
    const dz = (this.sampleHeight(x, z + e) - this.sampleHeight(x, z - e)) / (2 * e);
    return normalize(vec3(-dx, 1, -dz));
  }

  /**
   * Total soil volume. FR-3.5 asserts this plus all carried volume stays
   * constant across any sequence of deformation operations.
   */
  totalVolume(): number {
    let sum = 0;
    for (let i = 0; i < this.height.length; i++) sum += this.height[i];
    return sum * this.cellArea;
  }

  // ------------------------------------------------------------ dirty region

  markDirty(x0: number, z0: number, x1: number, z1: number): void {
    const nx0 = this.clampX(Math.min(x0, x1));
    const nz0 = this.clampZ(Math.min(z0, z1));
    const nx1 = this.clampX(Math.max(x0, x1));
    const nz1 = this.clampZ(Math.max(z0, z1));

    if (this.dirty === null) {
      this.dirty = { x0: nx0, z0: nz0, x1: nx1, z1: nz1 };
      return;
    }
    if (nx0 < this.dirty.x0) this.dirty.x0 = nx0;
    if (nz0 < this.dirty.z0) this.dirty.z0 = nz0;
    if (nx1 > this.dirty.x1) this.dirty.x1 = nx1;
    if (nz1 > this.dirty.z1) this.dirty.z1 = nz1;
  }

  markAllDirty(): void {
    this.dirty = { x0: 0, z0: 0, x1: this.width - 1, z1: this.depth - 1 };
  }

  /** Non-destructive peek, mostly for tests and diagnostics. */
  peekDirty(): Readonly<Rect> | null {
    return this.dirty;
  }

  /** Take the pending dirty region and reset it. Called once per rendered frame. */
  consumeDirty(): Rect | null {
    const rect = this.dirty;
    this.dirty = null;
    return rect;
  }
}
