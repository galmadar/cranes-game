/**
 * Minimal vector math for the simulation layer.
 *
 * Deliberately NOT three.js `Vector3`: `sim/` must stay renderer-free (NFR-1).
 * These are plain objects so simulation state stays serialisable and testable.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) return vec3(0, 1, 0);
  return vec3(v.x / len, v.y / len, v.z / len);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Step `current` toward `target` by at most `maxDelta`, landing exactly on it. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/** Hermite fade, 0 at t<=0 and 1 at t>=1, with zero derivative at both ends. */
export function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}
