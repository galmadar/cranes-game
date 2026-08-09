/**
 * The first contract.
 *
 * Sited deliberately over the sand pit AND the loose pile beside it, so the
 * cut and the fill are within sight of each other: the soil that has to come
 * off the mound is exactly the soil the bowl needs. A player who understands
 * that finishes fast and efficiently; one who shoves dirt at random does not.
 *
 * The target elevation defaults to the mean of the existing ground, so the job
 * balances — no soil has to be imported or dumped, which a bulldozer alone
 * could not do anyway.
 */

import { createFlatPad, type JobSite } from '../../sim/job/JobSite';
import type { Terrain } from '../../sim/Terrain';

export function createPadLevelJob(terrain: Terrain): JobSite {
  return createFlatPad(terrain, {
    id: 'pad-level-01',
    title: 'Level the pad',
    brief: 'Blade down (F). Push everything above the white grid into the hollows below it.',

    centerX: -24,
    centerZ: -6,
    width: 14,
    depth: 14,

    // A FIRST contract, sized to teach rather than to test: about 41 m3 of
    // earth, two minutes of work. The 22m version was 185 m3 and roughly ten
    // minutes, which read as "impossible" long before it read as "hard".
    // All three are live in the settings drawer under Contract.
    tolerance: 0.25,
    requiredAccuracy: 0.85,
    parSeconds: 150,
  });
}
