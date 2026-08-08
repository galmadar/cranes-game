/**
 * Terrain materials.
 *
 * Per the locked decision in PLAN.md: diggability is a property of the
 * MATERIAL, height is a property of the CELL. Keeping them separate is what
 * lets mud behave differently from sand without touching deformation code.
 */

export enum MaterialId {
  ROCK = 0,
  SAND = 1,
  MUD = 2,
  GRASS = 3,
}

export interface MaterialDef {
  readonly id: MaterialId;
  readonly displayName: string;
  /** Base colour in sRGB, components 0..1. Converted to linear by the renderer. */
  readonly color: readonly [number, number, number];
  /** FR-3.2 — can a blade cut this? */
  readonly diggable: boolean;
  /** FR-2.5 — multiplier on vehicle ground speed. */
  readonly tractionMultiplier: number;
  /** FR-3.6 — max stable slope, in radians. Steeper than this and it slumps. */
  readonly angleOfRepose: number;
}

const deg = (d: number): number => (d * Math.PI) / 180;

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  [MaterialId.ROCK]: {
    id: MaterialId.ROCK,
    displayName: 'Rock',
    color: [0.44, 0.45, 0.47],
    diggable: false,
    tractionMultiplier: 1.0,
    angleOfRepose: deg(89), // effectively "holds any slope"
  },
  [MaterialId.SAND]: {
    id: MaterialId.SAND,
    displayName: 'Sand',
    color: [0.8, 0.7, 0.44],
    diggable: true,
    tractionMultiplier: 0.75,
    angleOfRepose: deg(34), // loose granular — slumps readily
  },
  [MaterialId.MUD]: {
    id: MaterialId.MUD,
    displayName: 'Mud',
    color: [0.32, 0.24, 0.17],
    diggable: true,
    tractionMultiplier: 0.45, // bogs the tracks
    angleOfRepose: deg(25),
  },
  [MaterialId.GRASS]: {
    id: MaterialId.GRASS,
    displayName: 'Topsoil',
    color: [0.33, 0.45, 0.24],
    diggable: true,
    tractionMultiplier: 1.0,
    angleOfRepose: deg(40), // packed
  },
};

export const MATERIAL_LIST: readonly MaterialDef[] = [
  MATERIALS[MaterialId.GRASS],
  MATERIALS[MaterialId.SAND],
  MATERIALS[MaterialId.MUD],
  MATERIALS[MaterialId.ROCK],
];

export function materialOf(id: number): MaterialDef {
  return MATERIALS[id as MaterialId] ?? MATERIALS[MaterialId.GRASS];
}

export function isDiggable(id: number): boolean {
  return materialOf(id).diggable;
}
