/**
 * Dust thrown up by the blade.
 *
 * Purely cosmetic — it reads nothing back into the simulation. A fixed pool of
 * points recycled in place, so there is no allocation per frame and no upper
 * bound to blow past however long the machine works.
 *
 * This is the cheapest thing in the project that makes the dig feel physical:
 * without it soil moves in total silence, like a cursor dragging pixels.
 */

import * as THREE from 'three';
import type { Vec3 } from '../sim/math/Vec';

const MAX_PARTICLES = 240;
const LIFETIME = 1.15;
/** Particles per m³/s of cutting. */
const EMISSION_PER_CUT_RATE = 9;

export class DustSystem {
  readonly object: THREE.Points;

  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  private next = 0;
  private pending = 0;

  constructor() {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.alphas = new Float32Array(MAX_PARTICLES);
    this.life = new Float32Array(MAX_PARTICLES);

    // Park the pool far below the map until a particle is first used.
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -1000;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.PointsMaterial({
      size: 0.85,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
      color: new THREE.Color().setRGB(0.72, 0.65, 0.52, THREE.SRGBColorSpace),
    });

    // Fade each particle individually via the per-point alpha attribute.
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float alpha;\nvarying float vAlpha;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAlpha = alpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying float vAlpha;\nvoid main() {')
        .replace(
          '#include <opaque_fragment>',
          'diffuseColor.a *= vAlpha;\n#include <opaque_fragment>',
        );
    };

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.name = 'dust';
    this.object.frustumCulled = false;
  }

  /**
   * @param cutRate m³/s currently being cut — drives emission.
   * @param at      where the blade is working.
   * @param heading machine yaw, so dust trails off the sides rather than ahead.
   */
  update(dt: number, cutRate: number, at: Vec3 | null, heading: number): void {
    if (at && cutRate > 0) {
      this.pending += cutRate * EMISSION_PER_CUT_RATE * dt;
      const spawn = Math.min(Math.floor(this.pending), 12);
      this.pending -= spawn;

      const rx = -Math.cos(heading);
      const rz = Math.sin(heading);
      for (let n = 0; n < spawn; n++) {
        // Deterministic-ish scatter without Math.random bias concerns; the
        // index cycling gives plenty of variety at 60Hz.
        const t = (this.next * 2.3999632) % (Math.PI * 2);
        const across = Math.sin(t) * 2.0;
        const i = this.next;
        this.next = (this.next + 1) % MAX_PARTICLES;

        this.positions[i * 3 + 0] = at.x + rx * across;
        this.positions[i * 3 + 1] = at.y + 0.15;
        this.positions[i * 3 + 2] = at.z + rz * across;

        this.velocities[i * 3 + 0] = rx * across * 0.35 + Math.cos(t * 3.1) * 0.25;
        this.velocities[i * 3 + 1] = 0.55 + Math.abs(Math.sin(t * 1.7)) * 0.5;
        this.velocities[i * 3 + 2] = rz * across * 0.35 + Math.sin(t * 2.7) * 0.25;

        this.life[i] = LIFETIME;
      }
    }

    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      anyAlive = true;
      this.life[i] -= dt;

      const o = i * 3;
      this.positions[o + 0] += this.velocities[o + 0] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;

      // Rising dust slows and settles rather than flying off.
      this.velocities[o + 1] -= 0.75 * dt;
      const drag = Math.max(0, 1 - 1.1 * dt);
      this.velocities[o + 0] *= drag;
      this.velocities[o + 2] *= drag;

      this.alphas[i] = Math.max(0, this.life[i] / LIFETIME) * 0.85;
    }

    if (anyAlive || this.pending > 0) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
