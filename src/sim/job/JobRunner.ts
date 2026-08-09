/**
 * A job in progress: the clock, the tally, and whether it is done.
 *
 * Stepped inside the fixed timestep by `World`, so elapsed time and the volume
 * tally cannot drift with frame rate (NFR-2).
 */

import type { Terrain } from '../Terrain';
import type { JobSite } from './JobSite';
import { evaluateJob, type JobProgress } from './scoring';

/** Re-scoring cadence. A site is a couple of thousand cells; 10Hz is plenty. */
const EVALUATE_INTERVAL = 0.1;

export interface JobResult {
  accuracy: number;
  /** Seconds taken to reach the required accuracy. */
  elapsed: number;
  underPar: boolean;
  volumeMoved: number;
  idealVolume: number;
  /** 0..1 — how close to the theoretical minimum amount of digging. */
  efficiency: number;
}

export class JobRunner {
  readonly site: JobSite;
  /** Standing cut volume when the job began — the perfect-operator baseline. */
  readonly idealVolume: number;

  private elapsedSeconds = 0;
  private movedVolume = 0;
  private sinceEvaluate = 0;
  private progress: JobProgress;
  private finishedAt: number | null = null;

  constructor(terrain: Terrain, site: JobSite) {
    this.site = site;
    this.progress = evaluateJob(terrain, site);
    this.idealVolume = this.progress.cutRemaining;
  }

  get elapsed(): number {
    return this.finishedAt ?? this.elapsedSeconds;
  }

  get volumeMoved(): number {
    return this.movedVolume;
  }

  get current(): JobProgress {
    return this.progress;
  }

  get isComplete(): boolean {
    return this.finishedAt !== null;
  }

  /**
   * Share of the earthworks done, 0..1 — how much of the soil that had to move
   * has moved.
   *
   * This exists because **accuracy is a terrible progress signal**. It counts
   * cells inside tolerance, so it barely moves while the player shifts tonnes
   * of soil and then leaps at the very end. A player watching it work hard for
   * two minutes and see 12% concludes the job is impossible. Volume remaining
   * falls steadily from the first push, which is the honest picture of effort.
   */
  get earthMovedFraction(): number {
    if (this.idealVolume <= 0) return 1;
    const remaining = this.progress.cutRemaining / this.idealVolume;
    return Math.min(1, Math.max(0, 1 - remaining));
  }

  /**
   * How close to a perfect operator, 0..1.
   *
   * Capped at 1: you cannot beat the theoretical minimum, and floating-point
   * slack near zero should not read as 300% efficient.
   */
  get efficiency(): number {
    if (this.idealVolume <= 0) return 1;
    if (this.movedVolume <= 0) return 1;
    return Math.min(1, this.idealVolume / this.movedVolume);
  }

  get result(): JobResult | null {
    if (this.finishedAt === null) return null;
    return {
      accuracy: this.progress.accuracy,
      elapsed: this.finishedAt,
      underPar: this.finishedAt <= this.site.parSeconds,
      volumeMoved: this.movedVolume,
      idealVolume: this.idealVolume,
      efficiency: this.efficiency,
    };
  }

  /**
   * @param cutVolume m³ cut by every implement during this step. The clock and
   *        the tally both stop once the job is finished, so idling afterwards
   *        cannot spoil a good score.
   */
  step(dt: number, terrain: Terrain, cutVolume: number): void {
    if (this.finishedAt !== null) return;

    this.elapsedSeconds += dt;
    this.movedVolume += Math.max(0, cutVolume);

    this.sinceEvaluate += dt;
    if (this.sinceEvaluate < EVALUATE_INTERVAL) return;
    this.sinceEvaluate = 0;

    this.progress = evaluateJob(terrain, this.site);
    if (this.progress.accuracy >= this.site.requiredAccuracy) {
      this.finishedAt = this.elapsedSeconds;
    }
  }

  /** Force a re-score now — used on load and by tests. */
  refresh(terrain: Terrain): void {
    this.progress = evaluateJob(terrain, this.site);
  }
}
