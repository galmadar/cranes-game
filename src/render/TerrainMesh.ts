/**
 * TerrainMesh — a view over `Terrain`. Reads, never writes (NFR-1).
 *
 * NFR-3: geometry is allocated ONCE. A terrain edit rewrites only the vertex
 * rows inside the dirty rectangle; it never rebuilds or reallocates the mesh.
 * That plumbing exists from M1 even though nothing deforms terrain until M3 —
 * retrofitting it later is the expensive version.
 */

import * as THREE from 'three';
import { MATERIAL_LIST } from '../sim/materials';
import type { Rect, Terrain } from '../sim/Terrain';

/** Per-cell brightness jitter so large flat areas don't read as dead colour. */
function hashUnit(cx: number, cz: number): number {
  let h = (Math.imul(cx, 374761393) + Math.imul(cz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class TerrainMesh {
  readonly object: THREE.Mesh;

  private readonly geometry: THREE.BufferGeometry;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly normalAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly width: number;
  private readonly depth: number;

  /** MaterialId -> linear-space RGB, pre-converted once. */
  private readonly palette: Float32Array;

  constructor(terrain: Terrain) {
    this.width = terrain.width;
    this.depth = terrain.depth;

    const vertexCount = terrain.width * terrain.depth;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    // Index buffer never changes, so build it once.
    // Uint32 rather than Uint16: 256x256 is already at the 16-bit ceiling and
    // larger maps are a stated goal.
    const quadCount = (terrain.width - 1) * (terrain.depth - 1);
    const indices = new Uint32Array(quadCount * 6);
    let k = 0;
    for (let cz = 0; cz < terrain.depth - 1; cz++) {
      for (let cx = 0; cx < terrain.width - 1; cx++) {
        const a = cz * terrain.width + cx;
        const b = a + 1;
        const c = a + terrain.width;
        const d = c + 1;
        // Wound counter-clockwise as seen from +Y, so faces point skyward.
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.normalAttr = new THREE.BufferAttribute(normals, 3);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.normalAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('normal', this.normalAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Terrain heights change constantly. Rather than recomputing bounds on
    // every edit (O(n)), fix a generous bound once and never cull wrongly.
    const radius = Math.hypot(terrain.worldWidth, terrain.worldDepth) / 2 + 128;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);
    this.geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-terrain.worldWidth / 2, -128, -terrain.worldDepth / 2),
      new THREE.Vector3(terrain.worldWidth / 2, 128, terrain.worldDepth / 2),
    );

    // Build the linear-space palette. Three's colour management expects
    // working (linear) values in a raw vertex-colour buffer; feeding it sRGB
    // directly washes everything out.
    const maxId = MATERIAL_LIST.reduce((acc, m) => Math.max(acc, m.id), 0);
    this.palette = new Float32Array((maxId + 1) * 3);
    const scratch = new THREE.Color();
    for (const def of MATERIAL_LIST) {
      scratch.setRGB(def.color[0], def.color[1], def.color[2], THREE.SRGBColorSpace);
      this.palette[def.id * 3 + 0] = scratch.r;
      this.palette[def.id * 3 + 1] = scratch.g;
      this.palette[def.id * 3 + 2] = scratch.b;
    }

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.0,
    });

    this.object = new THREE.Mesh(this.geometry, material);
    this.object.name = 'terrain';
    this.object.frustumCulled = false;
    this.object.receiveShadow = true;

    // Initial full population — the Terrain constructor marks everything dirty.
    this.sync(terrain);
  }

  /** Apply any pending terrain edits. Cheap when nothing changed. */
  sync(terrain: Terrain): void {
    const rect = terrain.consumeDirty();
    if (rect) this.updateRegion(terrain, rect);
  }

  private updateRegion(terrain: Terrain, rect: Rect): void {
    // Expand by one cell: a vertex just outside the edited region still has a
    // normal derived from heights inside it.
    const x0 = Math.max(0, rect.x0 - 1);
    const z0 = Math.max(0, rect.z0 - 1);
    const x1 = Math.min(this.width - 1, rect.x1 + 1);
    const z1 = Math.min(this.depth - 1, rect.z1 + 1);

    const positions = this.positionAttr.array as Float32Array;
    const normals = this.normalAttr.array as Float32Array;
    const colors = this.colorAttr.array as Float32Array;
    const inv2Cell = 1 / (2 * terrain.cellSize);

    for (let cz = z0; cz <= z1; cz++) {
      const wz = terrain.cellToWorldZ(cz);
      for (let cx = x0; cx <= x1; cx++) {
        const i = cz * this.width + cx;
        const o = i * 3;

        const h = terrain.height[i];
        positions[o + 0] = terrain.cellToWorldX(cx);
        positions[o + 1] = h;
        positions[o + 2] = wz;

        // Normal straight from the height field — exact for a heightmap and
        // O(1) per vertex, unlike geometry.computeVertexNormals().
        const dx = (terrain.getHeight(cx + 1, cz) - terrain.getHeight(cx - 1, cz)) * inv2Cell;
        const dz = (terrain.getHeight(cx, cz + 1) - terrain.getHeight(cx, cz - 1)) * inv2Cell;
        const invLen = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        normals[o + 0] = -dx * invLen;
        normals[o + 1] = invLen;
        normals[o + 2] = -dz * invLen;

        const p = terrain.material[i] * 3;
        const jitter = 0.94 + 0.12 * hashUnit(cx, cz);
        colors[o + 0] = this.palette[p + 0] * jitter;
        colors[o + 1] = this.palette[p + 1] * jitter;
        colors[o + 2] = this.palette[p + 2] * jitter;
      }
    }

    // Upload only the touched span rather than the whole buffer.
    const firstVertex = z0 * this.width + x0;
    const lastVertex = z1 * this.width + x1;
    const offset = firstVertex * 3;
    const count = (lastVertex - firstVertex + 1) * 3;

    for (const attr of [this.positionAttr, this.normalAttr, this.colorAttr]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(offset, count);
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
