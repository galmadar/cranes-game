/**
 * Measuring the gap between the ground and the job.
 *
 * Pure and read-only over terrain — nothing here may write a height. If a
 * conservation test ever fails because of this file, something is very wrong.
 */

import type { Terrain } from '../Terrain';
import { siteCellCount, siteWidth, type JobSite } from './JobSite';

export interface JobProgress {
  cellsInSite: number;
  cellsOnGrade: number;
  /** Fraction of the site within tolerance, 0..1. The headline number. */
  accuracy: number;
  /** m³ still standing above target — soil that must come off. */
  cutRemaining: number;
  /** m³ of hollow still below target — soil that must go in. */
  fillRemaining: number;
  /** Mean absolute deviation from target, metres. */
  meanError: number;
  /** Worst deviation anywhere in the site, metres. */
  maxError: number;
}

export function evaluateJob(terrain: Terrain, site: JobSite): JobProgress {
  const { bounds, tolerance } = site;
  const width = siteWidth(site);
  const area = terrain.cellArea;

  let onGrade = 0;
  let cut = 0;
  let fill = 0;
  let errorSum = 0;
  let maxError = 0;

  for (let cz = bounds.z0; cz <= bounds.z1; cz++) {
    const row = (cz - bounds.z0) * width;
    for (let cx = bounds.x0; cx <= bounds.x1; cx++) {
      const error = terrain.getHeight(cx, cz) - site.target[row + (cx - bounds.x0)];
      const magnitude = Math.abs(error);

      if (magnitude <= tolerance) onGrade++;
      if (error > 0) cut += error;
      else fill -= error;

      errorSum += magnitude;
      if (magnitude > maxError) maxError = magnitude;
    }
  }

  const cells = siteCellCount(site);
  return {
    cellsInSite: cells,
    cellsOnGrade: onGrade,
    accuracy: cells === 0 ? 0 : onGrade / cells,
    cutRemaining: cut * area,
    fillRemaining: fill * area,
    meanError: cells === 0 ? 0 : errorSum / cells,
    maxError,
  };
}

/**
 * The least soil that could possibly be moved to finish the job, in m³.
 *
 * Every m³ above target has to be shifted exactly once by a perfect operator,
 * so the standing cut volume at the start IS the theoretical minimum. Compare
 * against how much was actually cut and you have a real efficiency measure:
 * sloppy work re-cuts the same soil over and over, and the ratio shows it.
 */
export function idealMoveVolume(terrain: Terrain, site: JobSite): number {
  return evaluateJob(terrain, site).cutRemaining;
}
