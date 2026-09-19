/**
 * Boot. The shell wires the layers together and owns nothing else.
 *
 * FR-6.2 said boot straight into the map with the dozer, and that held while
 * there was one of each. With two sites and two machines the choice has to
 * exist somewhere, so it lives in the URL and on one key. Not a menu: menus
 * are not the risky part of this project and they still cost days.
 *
 * A site and a machine are chosen together — each map names the machine it is
 * for. Turning up to a lift yard in a bulldozer is a mistake the game should
 * not make it possible to make by accident, though `?vehicle=` still allows it
 * on purpose.
 */

import { getMap, MAPS, DEFAULT_MAP_ID } from './content/maps/registry';
import { getVehicle, DEFAULT_VEHICLE_ID } from './content/vehicles/registry.view';
import { Keyboard } from './input/Keyboard';
import { Renderer } from './render/Renderer';
import { JobRunner } from './sim/job/JobRunner';
import { targetAt } from './sim/job/JobSite';
import { LiftRunner } from './sim/payload/LiftJob';
import { Payload } from './sim/payload/Payload';
import { Terrain } from './sim/Terrain';
import { Vehicle } from './sim/vehicle/Vehicle';
import { World } from './sim/World';
import { GameLoop } from './shell/GameLoop';
import { Hud, type MachineRow } from './shell/Hud';
import { JobHud } from './shell/JobHud';
import { LiftHud } from './shell/LiftHud';
import { bladeRows, craneRows, excavatorRows } from './shell/readouts';
import { SettingsPanel } from './shell/SettingsPanel';
import { buildSettings } from './shell/settingsSchema';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

const params = new URLSearchParams(window.location.search);
const map = getMap(params.get('map') ?? DEFAULT_MAP_ID);
const entry = getVehicle(params.get('vehicle') ?? map.defaultVehicleId ?? DEFAULT_VEHICLE_ID);

const terrain = new Terrain(map.width, map.depth, map.cellSize, map.generate());
const world = new World(terrain);

const site = map.createJob?.(terrain);

// A site can offer several contracts. `?job=` picks one; otherwise you get the
// first, which is the one written to be attempted first.
const contracts = map.liftContracts ?? [];
const wantedJob = params.get('job');
const contract = contracts.find((c) => c.id === wantedJob) ?? contracts[0];

// Built before the machine so saved tuning is applied to the vehicle
// definition and the contract before anything reads them.
const settings = new SettingsPanel(document.body, buildSettings(entry.def, site));
// A contract sets where you start; free roam falls back to the map spawn.
const vehicle = world.addVehicle(new Vehicle(entry.def, site?.spawn ?? map.spawn));

if (site) world.job = new JobRunner(terrain, site);

if (contract) {
  for (const init of contract.payloads) world.addPayload(new Payload(init));
  world.lift = new LiftRunner(contract);
}

const keyboard = new Keyboard();
const renderer = new Renderer(container, world);
const hud = new Hud(document.body, entry.def.keymap, entry.hints, entry.tip);
const jobHud = new JobHud(document.body);
const liftHud = new LiftHud(document.body);
renderer.refreshJobSite(world);

settings.onVisibilityChange = (open) => {
  document.body.classList.toggle('settings-open', open);
};

// Grade tolerance is a settings knob, and the overlay is drawn from it — so a
// change has to repaint the site rather than wait for the next terrain edit.
settings.onChange = () => renderer.refreshJobSite(world);

/**
 * Move to the next site in the registry.
 *
 * A reload rather than a swap in place. Rebuilding the terrain, the world, the
 * scene graph and every view live is real work for a choice made twice a
 * session, and a static app reloads in well under a second.
 */
function cycleMap(): void {
  const index = MAPS.findIndex((m) => m.id === map.id);
  const next = MAPS[(index + 1) % MAPS.length];
  window.location.search = `?map=${next.id}`;
}

/** Move to the next contract on this site. Same reload, same reasoning. */
function cycleContract(): void {
  if (contracts.length < 2 || !contract) return;
  const index = contracts.findIndex((c) => c.id === contract.id);
  const next = contracts[(index + 1) % contracts.length];
  window.location.search = `?map=${map.id}&job=${next.id}`;
}

/** Every key the machine on screen has claimed. The shell keeps off these. */
const vehicleKeys = new Set(Object.values(entry.def.keymap).flat());

window.addEventListener('keydown', (e) => {
  const typing =
    e.target instanceof HTMLElement &&
    (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

  if (e.code === 'Escape') {
    e.preventDefault();
    // Esc while typing should leave the field, not close the whole drawer.
    if (typing) (e.target as HTMLElement).blur();
    else settings.toggle();
    return;
  }
  // `?` as well as F1: F1 is muscle memory on Windows and a function-row
  // gymnastic on a Mac, and `?` is what every game with a help panel uses.
  // Matched on `key` rather than `code` so it works on any keyboard layout.
  if (e.code === 'F1' || e.key === '?') {
    e.preventDefault(); // or the browser opens its own help
    hud.toggleHelp();
    return;
  }
  if (typing) return;
  // The machine's keymap wins (FR-4.1). The shell's shortcuts are conveniences
  // bolted on around whatever is being driven, and when the excavator bound
  // its bucket curl to C and V — the obvious keys — tipping a load out also
  // flipped the camera. A vehicle that claims a key owns it.
  if (vehicleKeys.has(e.code)) return;

  if (e.code === 'KeyC') renderer.chase.recenter();
  if (e.code === 'KeyV') renderer.chase.cycleMode();
  if (e.code === 'KeyG') renderer.toggleJobOverlay(world);
  if (e.code === 'KeyP') renderer.togglePostFx();
  if (e.code === 'KeyN') cycleMap();
  if (e.code === 'KeyJ') cycleContract();
});

// Volume is an O(cells) scan. It only needs to be readable, not per-frame
// accurate — M3 will watch it for drift rather than for precision.
let cachedVolume = terrain.totalVolume();
let sinceVolumeRefresh = 0;

const loop = new GameLoop({
  step: 1 / 60,
  update: (dt) => {
    world.step(dt, keyboard.sample(entry.def.keymap));
    sinceVolumeRefresh += dt;
    if (sinceVolumeRefresh >= 0.5) {
      cachedVolume = terrain.totalVolume();
      sinceVolumeRefresh = 0;
    }
  },
  render: (alpha, frameDt) => {
    renderer.sync(world);
    renderer.render(world, frameDt, alpha);

    const info = renderer.info;
    const ground = vehicle.groundMaterial(terrain);

    hud.update({
      fps: loop.fps,
      frameMs: loop.frameMs,
      simTime: world.elapsed,
      volume: cachedVolume,
      drawCalls: info.calls,
      triangles: info.triangles,

      vehicleName: entry.def.displayName,
      speedKph: vehicle.state.speed * 3.6,
      groundMaterial: ground.displayName,
      traction: ground.tractionMultiplier,
      machine: machineReadout(),
      load: vehicle.implementLoad,
      cameraMode: renderer.chase.modeLabel,
    });

    jobHud.update(world.job);
    liftHud.update(world.lift);
  },
});

/** Whatever the machine currently on screen has worth saying. */
function machineReadout(): MachineRow[] {
  const rows: MachineRow[] = [];
  for (const state of Object.values(vehicle.state.implementStates)) {
    if (state.kind === 'blade') rows.push(...bladeRows(state, gradeUnderBlade()));
    if (state.kind === 'excavator') {
      const spec = entry.def.implements.find((i) => i.kind === 'excavator');
      rows.push(
        ...excavatorRows(
          state,
          spec?.kind === 'excavator' ? spec.capacity : 1,
          targetUnder(state.teeth.x, state.teeth.z),
        ),
      );
    }
    if (state.kind === 'crane') {
      const held = world.payloads.find((p) => p.id === state.hookedPayloadId);
      rows.push(
        ...craneRows(
          state,
          terrain.sampleHeight(state.hook.x, state.hook.z),
          held ? { name: held.spec.displayName, yaw: held.yaw } : null,
        ),
      );
    }
  }
  return rows;
}

/** Design elevation at a world point, or null where the contract says nothing. */
function targetUnder(x: number, z: number): number | null {
  const job = world.job;
  if (!job) return null;
  return targetAt(
    job.site,
    Math.round(terrain.worldToCellX(x)),
    Math.round(terrain.worldToCellZ(z)),
  );
}

/** How far the ground at the blade sits above (+) or below (-) target grade. */
function gradeUnderBlade(): number | null {
  const s = vehicle.state;
  const bx = s.position.x + Math.sin(s.heading) * 3;
  const bz = s.position.z + Math.cos(s.heading) * 3;
  const target = targetUnder(bx, bz);
  return target === null ? null : terrain.sampleHeight(bx, bz) - target;
}

loop.start();

console.info(
  `[cranes] "${map.displayName}" — ${map.width}x${map.depth} cells @ ${map.cellSize}m ` +
    `(${terrain.worldWidth.toFixed(1)}m x ${terrain.worldDepth.toFixed(1)}m) — ` +
    `driving ${entry.def.displayName}. Sites: ${MAPS.map((m) => m.id).join(', ')} (N to cycle)`,
);
