/**
 * Deterministic value noise for terrain generation.
 *
 * Seeded on purpose: a map must generate identically every run, otherwise the
 * volume-conservation tests (FR-3.5) have no stable fixture to run against.
 */

import { smoothstep } from './Vec';

/** Small, fast, seedable PRNG. Returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TABLE_SIZE = 256;
const TABLE_MASK = TABLE_SIZE - 1;

export type Noise2D = (x: number, z: number) => number;

/** Tiling value noise in [-1, 1], smooth-interpolated over a 256x256 lattice. */
export function makeValueNoise2D(seed: number): Noise2D {
  const rand = mulberry32(seed);
  const table = new Float32Array(TABLE_SIZE * TABLE_SIZE);
  for (let i = 0; i < table.length; i++) table[i] = rand() * 2 - 1;

  return (x: number, z: number): number => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const tx = smoothstep(x - xi);
    const tz = smoothstep(z - zi);

    // Bitwise AND wraps negatives correctly (-1 & 255 === 255).
    const x0 = xi & TABLE_MASK;
    const x1 = (xi + 1) & TABLE_MASK;
    const z0 = (zi & TABLE_MASK) * TABLE_SIZE;
    const z1 = ((zi + 1) & TABLE_MASK) * TABLE_SIZE;

    const a = table[z0 + x0] + (table[z0 + x1] - table[z0 + x0]) * tx;
    const b = table[z1 + x0] + (table[z1 + x1] - table[z1 + x0]) * tx;
    return a + (b - a) * tz;
  };
}

/** Fractal Brownian motion — stacked octaves, normalised back to [-1, 1]. */
export function fbm(
  noise: Noise2D,
  x: number,
  z: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}
