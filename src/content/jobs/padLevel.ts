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
    brief: 'Cut the mound into the pit until the whole site sits flat, ±20 cm.',

    centerX: -24,
    centerZ: -6,
    width: 22,
    depth: 22,

    // Loose enough that the endgame is not cell-by-cell fiddling. Tunable
    // live from the settings drawer while we work out what plays well.
    tolerance: 0.2,
    requiredAccuracy: 0.9,
    parSeconds: 300,
  });
}
