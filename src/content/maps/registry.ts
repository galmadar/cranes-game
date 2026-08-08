/**
 * Map registry (FR-5.4).
 *
 * Adding a map = one import + one array entry. Nothing in `sim/` or `render/`
 * changes. The vehicle registry lands in M2 with exactly this shape.
 */

import { sandboxMap } from './sandbox';
import type { MapDefinition } from './types';

export const MAPS: readonly MapDefinition[] = [sandboxMap];

export const DEFAULT_MAP_ID = sandboxMap.id;

export function getMap(id: string): MapDefinition {
  const map = MAPS.find((m) => m.id === id);
  if (!map) {
    throw new Error(`Unknown map "${id}". Known: ${MAPS.map((m) => m.id).join(', ')}`);
  }
  return map;
}
