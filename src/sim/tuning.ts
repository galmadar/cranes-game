/**
 * Global feel constants, in one mutable place.
 *
 * These were scattered as `const` values across the deformer and the slump
 * solver. That was fine while they were guesses nobody could check; it stops
 * being fine the moment someone wants to tune the game by playing it.
 *
 * Everything here is read fresh every tick, so edits take effect immediately —
 * no restart, no rebuild. Per-vehicle numbers (speed, blade capacity) are NOT
 * here: they belong to each machine's definition, and the settings panel edits
 * those in place.
 */

export interface Tuning {
  /** Chassis drag from a completely full blade, 0..0.95. */
  fullBladeResistance: number;
  /** Prow size, as a multiple of blade capacity, at which the machine stalls. */
  stallFill: number;
  /** Chassis drag when the blade is buried in something it cannot cut. */
  rockResistance: number;
  /** Share of the cut rolling off the ends at double capacity. Ramps from zero. */
  sideSpillFraction: number;
  /** Relaxation passes per simulation step. Higher settles faster, costs more. */
  slumpPasses: number;
  /** Fraction of the legal correction applied per pass. Below 1 for damping. */
  slumpRelaxation: number;

  /**
   * Hook pendulum damping as a fraction of critical, 0..1.
   *
   * A real load on a long rope is very nearly undamped, and a very nearly
   * undamped load is unplayable — it never stops. This is the dial between
   * "the crane is the hard part" and "the crane is the annoying part".
   */
  swayDamping: number;
  /** Furthest the hook may swing from plumb, as a fraction of rope length. */
  maxSwingFraction: number;
}

export const DEFAULT_TUNING: Readonly<Tuning> = Object.freeze({
  fullBladeResistance: 0.6,
  stallFill: 1.6,
  rockResistance: 0.92,
  sideSpillFraction: 0.45,
  slumpPasses: 2,
  slumpRelaxation: 0.5,

  swayDamping: 0.16,
  maxSwingFraction: 0.55,
});

export const TUNING: Tuning = { ...DEFAULT_TUNING };

export function resetTuning(): void {
  Object.assign(TUNING, DEFAULT_TUNING);
}
