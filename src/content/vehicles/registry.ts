/**
 * Vehicle registry (FR-5.1).
 *
 * Adding a machine = two files (`.def.ts` pure, `.view.ts` renderer-side) and
 * ONE entry here. Nothing in `sim/` or `render/` changes.
 *
 * M5 tests exactly that claim by adding an excavator. If it can't be done
 * without touching engine code, this design failed and the time to find out
 * is with two vehicles, not six.
 */

import type { VehicleDefinition } from '../../sim/vehicle/types';
import type { CameraFraming } from '../../render/ChaseCamera';
import type { VehicleViewFactory } from '../../render/VehicleView';
import { bulldozerDef, BULLDOZER_CONTROL_HINTS } from './bulldozer.def';
import { buildBulldozer } from './bulldozer.view';
import { crawlerCraneDef, CRAWLER_CRANE_CONTROL_HINTS } from './crawlerCrane.def';
import { buildCrawlerCrane } from './crawlerCrane.view';

export interface VehicleEntry {
  readonly def: VehicleDefinition;
  readonly view: VehicleViewFactory;
  /** Ordered labels for the on-screen control hints. */
  readonly hints: readonly { action: string; label: string }[];
  /** The one thing about driving it that a list of keys cannot tell you. */
  readonly tip?: string;
  /** How far back and how high to stand. Omitted means the dozer's framing. */
  readonly camera?: CameraFraming;
}

export const VEHICLES: readonly VehicleEntry[] = [
  {
    def: bulldozerDef,
    view: buildBulldozer,
    hints: BULLDOZER_CONTROL_HINTS,
    tip:
      'Drop the blade below grade to dig, or press H and let it hold grade ' +
      'while you drive. Any manual blade input cancels the hold.',
  },
  {
    def: crawlerCraneDef,
    view: buildCrawlerCrane,
    hints: CRAWLER_CRANE_CONTROL_HINTS,
    tip:
      'Rated load falls as you reach out — park close for the heavy ones. ' +
      'Slew (Q/E) puts the load over the pad; the tag line (Z/X) turns it to lie ' +
      'the right way. Wait for Swing to read steady before you set it down.',
    // Stand well back and look at the middle of the boom, not at the tracks.
    // A 22 m boom framed like a dozer is a machine you watch from the ankles.
    camera: { scale: 2.4, eyeHeight: 9 },
  },
];

export const DEFAULT_VEHICLE_ID = bulldozerDef.id;

export function getVehicle(id: string): VehicleEntry {
  const entry = VEHICLES.find((v) => v.def.id === id);
  if (!entry) {
    throw new Error(
      `Unknown vehicle "${id}". Known: ${VEHICLES.map((v) => v.def.id).join(', ')}`,
    );
  }
  return entry;
}
