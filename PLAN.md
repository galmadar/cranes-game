# Cranes Game — Development Plan

A browser game about operating heavy machinery on deformable terrain.
MVP: drive a bulldozer around a map and push dirt into piles.

> **Status:** M0–M2 complete. `npm run dev` → drive a bulldozer around the
> sandbox yard, blade articulating, tracks bogging in mud. Next up is
> **M3 — the MVP**: making the blade actually cut.

---

## 0. Decisions already locked

| Decision | Choice | Why |
|---|---|---|
| Core entity | `Vehicle`, not `Crane` | A bulldozer is not a crane. Cranes lift (boom/cable/hook), dozers push (blade/tracks). `Crane` as the base type breaks on the first MVP vehicle. Cranes become one *family* of vehicle. |
| Terrain model | Heightmap + parallel material grid | Diggability is a property of the *material*; the blade edits the *height*. Separating them lets mud behave differently from sand without touching deformation code. |
| Soil behaviour | Volume is conserved | If scraped soil vanishes, it's a paint tool. If it accumulates on the blade and dumps into a pile, it's a game. This is the core loop. |
| Movement | Kinematic, sampled off the heightmap | No physics engine until suspended loads actually need one. Terrain edits stay a pure array write. |
| Renderer | Three.js, behind a hard boundary | A tower crane is inherently vertical. 3D is not meaningfully slower to MVP here — Three gives you camera, lighting and a shaded mesh for free. |
| Networking | None. Static single-player build. | Zero architectural cost. Deploy to any static host. |

**The one rule that keeps everything else reversible:** `sim/` must never import `three`.

---

## 1. Functional Requirements

`[M]` = in the MVP. `[L]` = later.

### FR-1 — Terrain & Maps
- **FR-1.1** `[M]` A map defines grid dimensions, cell size, an initial height field, and a material per cell.
- **FR-1.2** `[M]` Materials exist with distinct behaviour. MVP set: `ROCK` (not diggable), `SAND` (diggable, loose), `MUD` (diggable, reduces traction), `GRASS` (diggable, packed).
- **FR-1.3** `[M]` Terrain renders with material-based colouring and lighting such that **elevation changes are visually obvious**.
- **FR-1.4** `[L]` Multiple maps, selectable from a menu.
- **FR-1.5** `[L]` Procedural generation and/or a map editor.

### FR-2 — Vehicles
- **FR-2.1** `[M]` One playable vehicle: the bulldozer.
- **FR-2.2** `[M]` Differential ("tank") steering — it is a tracked machine. Forward, reverse, turn in place.
- **FR-2.3** `[M]` The vehicle conforms to the ground: Y from the height field, pitch and roll from the surface normal.
- **FR-2.4** `[M]` The blade raises and lowers. **Non-negotiable** — a fixed blade can never choose between driving over terrain and cutting into it.
- **FR-2.5** `[M]` Traction is material-dependent (mud is slower than grass).
- **FR-2.6** `[L]` Vehicle selection screen.
- **FR-2.7** `[L]` Further vehicles: excavator, mobile truck crane, crawler crane, tower crane.
- **FR-2.8** `[L]` Crane mechanics: boom slew/luff, trolley, hook winch, cable, load attach/detach, load swing, outriggers, tipping limits.

### FR-3 — Terrain Deformation
- **FR-3.1** `[M]` The blade defines a swept cutting volume. Cells intersecting it whose height exceeds the blade's cutting edge are scraped.
- **FR-3.2** `[M]` Only diggable materials scrape. Rock refuses the cut and stalls forward progress.
- **FR-3.3** `[M]` Scraped soil accumulates as *carried volume* on the blade, up to a per-vehicle capacity.
- **FR-3.4** `[M]` Carried soil deposits into the cells ahead of the blade when capacity is exceeded, or when the blade is raised.
- **FR-3.5** `[M]` **Volume conservation.** `sum(height) * cellArea + carriedVolume` is invariant. This is an automated test, not an aspiration.
- **FR-3.6** `[M]` **Angle of repose.** Piles slump: any cell exceeding a neighbour by more than `tan(θ) * cellSize` sheds material downhill over successive ticks. Without this you get impossible vertical spikes and the piles look wrong.
- **FR-3.7** `[L]` Depth layers — digging past a threshold reveals a different material beneath.

### FR-4 — Controls
- **FR-4.1** `[M]` Keyboard control. **Each vehicle declares its own keymap** in its definition.
- **FR-4.2** `[M]` Raw keys are translated into named *actions* before the vehicle sees them. A vehicle never reads `KeyboardEvent`.
- **FR-4.3** `[M]` On-screen control hints for the active vehicle, generated from its keymap.
- **FR-4.4** `[L]` User-rebindable keys, persisted to `localStorage`.
- **FR-4.5** `[L]` Gamepad support.

### FR-5 — Extensibility *(your explicit requirement)*
- **FR-5.1** `[M]` Adding a vehicle means adding one definition file and one registry line. **No engine code changes.**
- **FR-5.2** `[M]` A vehicle definition declares: id, display name, family, locomotion parameters, implements (attachments), keymap, and a mesh factory.
- **FR-5.3** `[M]` The *implement* abstraction is what makes a blade and a boom siblings rather than special cases.
- **FR-5.4** `[L]` Maps use the same registry pattern.
- **FR-5.5** `[L]` Definitions loadable from JSON so a non-programmer can add a vehicle.

### FR-6 — Camera & Shell
- **FR-6.1** `[M]` Chase camera following the vehicle; mouse orbit and zoom.
- **FR-6.2** `[M]` The MVP boots **straight into the map with the dozer**. No menus — menus are not the risky part and cost days.
- **FR-6.3** `[L]` Title → map select → vehicle select → play.
- **FR-6.4** `[L]` Save/load terrain state.

---

## 2. Non-Functional Requirements

- **NFR-1 — Purity.** `sim/` is plain TypeScript with no rendering dependency. This is what buys testability, a swappable renderer, and the option of networking later.
- **NFR-2 — Fixed timestep.** The simulation steps at a fixed rate (60 Hz) decoupled from `requestAnimationFrame`. Otherwise a fast machine digs faster than a slow one — a real bug, not a theoretical one.
- **NFR-3 — Performance.** 60 fps at 256×256 cells. Deformation **must not** rebuild the whole mesh; the sim publishes dirty rectangles and the renderer updates only those vertex ranges. Design this in from M1 — retrofitting it is painful.
- **NFR-4 — Testability.** Volume conservation, slump convergence, and material immutability are headless unit tests (Vitest). The sim being pure is what makes this free.
- **NFR-5 — Extensibility cost.** Adding a vehicle touches exactly two new files (`.def.ts`, `.view.ts`) plus one registry line.
- **NFR-6 — Portability.** Static build. No backend, no server assumptions, no environment config. Drops onto any static host as-is.
- **NFR-7 — Zero art dependency in MVP.** All geometry is procedural primitives. Do not let asset sourcing block the core loop.
- **NFR-8 — Strict TypeScript.** `strict: true`, no implicit `any`.

---

## 3. Core Entities

### Terrain
```ts
class Terrain {
  readonly width: number;      // cells
  readonly depth: number;      // cells
  readonly cellSize: number;   // world units per cell

  readonly height: Float32Array;   // width * depth, world units
  readonly material: Uint8Array;   // width * depth, MaterialId

  dirty: Rect | null;          // consumed by the renderer each frame

  sampleHeight(x: number, z: number): number;   // bilinear
  sampleNormal(x: number, z: number): Vec3;
  totalVolume(): number;                        // for the conservation test
}
```

### Material
```ts
enum MaterialId { ROCK, SAND, MUD, GRASS }

interface MaterialDef {
  id: MaterialId;
  displayName: string;
  color: [number, number, number];
  diggable: boolean;
  tractionMultiplier: number;   // MUD < GRASS
  angleOfRepose: number;        // radians; SAND slumps more than GRASS
}
```

### Vehicle — definition (static data) vs. state (runtime)
```ts
interface VehicleDefinition {
  id: string;
  displayName: string;
  family: 'dozer' | 'excavator' | 'mobileCrane' | 'crawlerCrane' | 'towerCrane';
  locomotion: LocomotionSpec;      // tracked | wheeled | static
  implements: ImplementSpec[];     // blade | boom | bucket | outriggers
  keymap: KeyMap;
}

interface VehicleState {
  defId: string;
  position: Vec3;
  heading: number;                 // yaw, radians
  pitch: number;                   // derived from terrain normal
  roll: number;
  speed: number;
  implementStates: Record<string, ImplementState>;
}
```

### Implement — *the abstraction that makes cranes and dozers siblings*
```ts
interface Implement {
  readonly id: string;
  update(dt: number, input: ActionState,
         vehicle: VehicleState, terrain: Terrain): void;
}

// MVP:   BladeImplement  { widthCells, heightOffset, capacity, carriedVolume }
// Later: BoomImplement, HookImplement, BucketImplement, OutriggerImplement
```
An implement is the only thing permitted to mutate terrain. When cranes arrive they add new implements — they do not modify the vehicle or terrain code.

### Input
```ts
type ActionId = 'throttleFwd' | 'throttleRev' | 'steerLeft' | 'steerRight'
              | 'bladeUp' | 'bladeDown' | string;

type KeyMap      = Record<ActionId, string[]>;      // KeyboardEvent.code values
type ActionState = Record<ActionId, number>;        // 0..1
```
Keys → actions happens once, centrally. Per-vehicle keymaps then cost nothing.

### MapDefinition
```ts
interface MapDefinition {
  id: string;
  displayName: string;
  width: number; depth: number; cellSize: number;
  generate(): { height: Float32Array; material: Uint8Array };
  spawn: { position: Vec3; heading: number };
}
```

### World
```ts
class World {
  terrain: Terrain;
  vehicles: VehicleState[];
  activeVehicleId: string;
  step(dt: number, input: ActionState): void;   // fixed dt
}
```

---

## 4. High-Level Design

### Layers

```
┌─────────────────────────────────────────────────┐
│ shell/     boot, game loop, (later) menus        │
├─────────────────────────────────────────────────┤
│ render/    ◄── the ONLY place `three` is imported│
│            TerrainMesh · VehicleView · Camera    │
├─────────────────────────────────────────────────┤
│ input/     raw keys ──► ActionState              │
├─────────────────────────────────────────────────┤
│ sim/       PURE TypeScript. No renderer.         │
│            World · Terrain · Deformer · Slump    │
│            Locomotion · Implements               │
├─────────────────────────────────────────────────┤
│ content/   registries + definitions              │
│            vehicles/bulldozer.def.ts   → sim     │
│            vehicles/bulldozer.view.ts  → render  │
│            maps/sandbox.ts                       │
└─────────────────────────────────────────────────┘
```

**Dependency rule:** `sim/` imports nothing above it. `render/` reads sim state one-directionally and never writes it. Each vehicle is split `.def.ts` (pure, sim-side) / `.view.ts` (mesh factory, render-side) so the boundary survives content growth.

### Frame

```
requestAnimationFrame(t):
    acc += min(t - last, MAX_FRAME)      // clamp to survive tab-out
    while (acc >= STEP):                 // STEP = 1/60
        world.step(STEP, input.sample())
        acc -= STEP
    renderer.sync(world)                 // consume terrain dirty rect
    renderer.render(alpha = acc / STEP)  // interpolate vehicle pose
```

### Deformation algorithm — the heart of the MVP

1. Compute the blade's world-space cutting rectangle (`width × thickness`) at its current edge height, oriented to vehicle heading.
2. Rasterise that rectangle to cell indices.
3. For each cell:
   - Material not diggable → skip, and flag resistance (stalls forward motion).
   - Otherwise `cut = clamp(height[i] - bladeEdgeY, 0, remainingCapacity)`.
4. `height[i] -= cut`  ·  `carriedVolume += cut * cellArea`.
5. **Deposit:** overflow beyond capacity — or everything, if the blade is raised — spills into the cells immediately ahead of the blade, filling lowest-first.
6. **Slump:** relax the dirty region plus a one-cell border. For each neighbour pair where `Δh > tan(θ) * cellSize`, transfer half the excess downhill. A few passes per tick; it converges.
7. Mark the dirty rectangle for the renderer.

**Invariant (automated test):** `terrain.totalVolume() + Σ carriedVolume` is constant across any sequence of operations.

### Stack
Vite · TypeScript (strict) · Three.js · Vitest. No physics engine, no backend, no state library.

---

## 5. Milestones — the fastest path to a playable MVP

| # | Deliverable | Est. |
|---|---|---|
| ~~**M0**~~ ✅ | Skeleton: Vite + TS + Three, lit ground plane, orbit camera, fixed-step loop, FPS readout. Deployable from day one. | ½ day |
| ~~**M1**~~ ✅ | Terrain: heightmap + material grid, procedural sandbox map (flat ground, a sand pit, a mud patch, a rock outcrop), vertex-coloured shaded mesh, dirty-rect updates wired but unused. | 1 day |
| ~~**M2**~~ ✅ | Driving: dozer as primitive boxes, tank steering, terrain-conforming Y/pitch/roll, chase camera, keys routed through the action layer. *Do not shortcut the action layer* — it is FR-5. | 1 day |
| **M3** | **← THE MVP.** Blade raise/lower. Scrape → carry → deposit. Slumping. Rock refuses. Mud slows. Volume-conservation test green. | 2–3 days |
| **M4** | Feel: tune capacity, cut rate, angle of repose, blade speed. Track marks and dust. This is what separates a game from a tech demo — do not skip it. | 1 day |
| **M5** | **Architecture validation:** add an excavator *without touching `sim/` engine code*. If that's impossible, the registry design has failed — fix it now, with two vehicles, not with six. | 1–2 days |
| **M6+** | Cranes: introduce Rapier for cable + suspended load only. Boom/hook/outrigger implements. Map and vehicle select screens. | — |

**M3 is the finish line you asked for.** Everything before it exists only to reach it.

---

## 6. Risks

- **Blade feel is the whole game, and it's tuning work, not code work.** M4 is load-bearing; budget it honestly.
- **Naive mesh rebuilds will tank the frame rate.** Mitigated by dirty rects from M1 — cheap now, expensive later.
- **Scope creep into vehicle variety before the dozer is fun.** M5 is a *test of the architecture*, not a content push. Resist adding a third vehicle until M4 feels good.
- **Slump instability.** Too aggressive a transfer factor oscillates. Transfer half the excess, cap passes per tick, unit-test convergence.
