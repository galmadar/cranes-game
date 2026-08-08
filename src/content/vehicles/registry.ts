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
import type { VehicleViewFactory } from '../../render/VehicleView';
import { bulldozerDef, BULLDOZER_CONTROL_HINTS } from './bulldozer.def';
import { buildBulldozer } from './bulldozer.view';

export interface VehicleEntry {
  readonly def: VehicleDefinition;
  readonly view: VehicleViewFactory;
  /** Ordered labels for the on-screen control hints. */
  readonly hints: readonly { action: string; label: string }[];
}

export const VEHICLES: readonly VehicleEntry[] = [
  { def: bulldozerDef, view: buildBulldozer, hints: BULLDOZER_CONTROL_HINTS },
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
