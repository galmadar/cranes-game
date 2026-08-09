/**
 * TerrainMesh — a view over `Terrain`. Reads, never writes (NFR-1).
 *
 * NFR-3: geometry is allocated ONCE. A terrain edit rewrites only the vertex
 * rows inside the dirty rectangle; it never rebuilds or reallocates the mesh.
 * That plumbing exists from M1 even though nothing deforms terrain until M3 —
 * retrofitting it later is the expensive version.
 */

import * as THREE from 'three';
import { targetAt, type JobSite } from '../sim/job/JobSite';
import { MATERIAL_LIST } from '../sim/materials';
import type { Rect, Terrain } from '../sim/Terrain';

/** Deviation beyond tolerance at which the overlay reaches full strength, m. */
const OVERLAY_RANGE = 0.7;
/** How far the tint can push the underlying material colour, 0..1. */
const OVERLAY_STRENGTH = 0.82;

/**
 * Procedural surface detail, injected into the standard material.
 *
 * Vertex colours alone give every cell one exact tone, so a graded pad is a
 * single flat slab of colour and the whole yard reads as painted plastic. Three
 * octaves of world-space noise at ~5m, ~1.5m and ~0.5m break that up, and a
 * slope term darkens steep faces the way exposed cut faces actually look.
 *
 * Done in the shader rather than with a texture: still zero external assets
 * (NFR-7), and it tiles perfectly across a 128m map at any zoom.
 */
function addSurfaceDetail(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vDetailPos;\nvarying float vSlope;\nvoid main() {')
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n  vSlope = 1.0 - clamp(objectNormal.y, 0.0, 1.0);',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vDetailPos;
         varying float vSlope;
         float dHash(vec2 p) {
           p = fract(p * vec2(127.31, 311.7));
           p += dot(p, p + 47.19);
           return fract(p.x * p.y);
         }
         float dNoise(vec2 p) {
           vec2 i = floor(p);
           vec2 f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), f.x),
                      mix(dHash(i + vec2(0.0, 1.0)), dHash(i + vec2(1.0, 1.0)), f.x), f.y);
         }
         void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec2 p = vDetailPos.xz;
           float grain = dNoise(p * 0.2) * 0.5 + dNoise(p * 0.7) * 0.32 + dNoise(p * 2.1) * 0.18;
           diffuseColor.rgb *= 0.84 + 0.32 * grain;
           // Steep ground is scoured and shaded; flat ground catches the light.
           diffuseColor.rgb *= 1.0 - vSlope * 0.3;
         }`,
      );
  };
}

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

  /** Job overlay colours, linear space. */
  private readonly tooHigh = new THREE.Color();
  private readonly tooLow = new THREE.Color();
  private readonly siteEdge = new THREE.Color();

  private site: JobSite | null = null;
  private overlayEnabled = true;

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

    // Orange / blue rather than red / green: this is the one piece of UI the
    // player reads constantly, and red-green is the colour pair most people
    // with colour blindness cannot separate.
    this.tooHigh.setRGB(0.93, 0.42, 0.22, THREE.SRGBColorSpace);
    this.tooLow.setRGB(0.24, 0.58, 0.88, THREE.SRGBColorSpace);
    this.siteEdge.setRGB(1.0, 0.81, 0.33, THREE.SRGBColorSpace);

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.0,
    });
    addSurfaceDetail(material);

    this.object = new THREE.Mesh(this.geometry, material);
    this.object.name = 'terrain';
    this.object.frustumCulled = false;
    this.object.receiveShadow = true;

    // Initial full population — the Terrain constructor marks everything dirty.
    this.sync(terrain);
  }

  /** Apply any pending terrain edits. Cheap when nothing changed. */
  sync(terrain: Terrain, site: JobSite | null = null): void {
    this.site = site;
    const rect = terrain.consumeDirty();
    if (rect) this.updateRegion(terrain, rect);
  }

  /** Caller must dirty the site bounds afterwards so the colours refresh. */
  setOverlayEnabled(enabled: boolean): void {
    this.overlayEnabled = enabled;
  }

  get isOverlayEnabled(): boolean {
    return this.overlayEnabled;
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

        let r = this.palette[p + 0] * jitter;
        let g = this.palette[p + 1] * jitter;
        let b = this.palette[p + 2] * jitter;

        // Churned ground goes darker and loses saturation — turned earth reads
        // damp. This is what makes track marks and fresh cuts visible.
        const churn = terrain.disturbance[i] / 255;
        if (churn > 0) {
          const grey = (r + g + b) / 3;
          const k = churn * 0.55;
          r = (r + (grey - r) * 0.45) * (1 - k * 0.55);
          g = (g + (grey - g) * 0.45) * (1 - k * 0.55);
          b = (b + (grey - b) * 0.45) * (1 - k * 0.5);
        }

        // --- job overlay -------------------------------------------------
        // Ground that is ON GRADE is left completely alone. The overlay drains
        // away as the player succeeds, so a finished pad heals back into
        // ordinary terrain and completion is something you watch happen rather
        // than a number you read.
        const site = this.overlayEnabled ? this.site : null;
        if (site) {
          const target = targetAt(site, cx, cz);
          if (target !== null) {
            const error = terrain.height[i] - target;
            const excess = Math.abs(error) - site.tolerance;

            if (excess > 0) {
              const k = Math.min(1, excess / OVERLAY_RANGE) * OVERLAY_STRENGTH;
              const tint = error > 0 ? this.tooHigh : this.tooLow;
              r += (tint.r - r) * k;
              g += (tint.g - g) * k;
              b += (tint.b - b) * k;
            }

            // Mark the boundary so the site stays findable even once it is
            // finished and every cell inside has gone back to normal.
            const b0 = site.bounds;
            if (cx === b0.x0 || cx === b0.x1 || cz === b0.z0 || cz === b0.z1) {
              r += (this.siteEdge.r - r) * 0.65;
              g += (this.siteEdge.g - g) * 0.65;
              b += (this.siteEdge.b - b) * 0.65;
            }
          }
        }

        colors[o + 0] = r;
        colors[o + 1] = g;
        colors[o + 2] = b;
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
