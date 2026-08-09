/**
 * Boot. The shell wires the layers together and owns nothing else.
 *
 * FR-6.2: the MVP boots straight into the map with the dozer. No menus — they
 * are not the risky part of this project and they cost days.
 */

import { createPadLevelJob } from './content/jobs/padLevel';
import { getMap, DEFAULT_MAP_ID } from './content/maps/registry';
import { getVehicle, DEFAULT_VEHICLE_ID } from './content/vehicles/registry';
import { Keyboard } from './input/Keyboard';
import { Renderer } from './render/Renderer';
import { JobRunner } from './sim/job/JobRunner';
import { targetAt } from './sim/job/JobSite';
import { Terrain } from './sim/Terrain';
import { Vehicle } from './sim/vehicle/Vehicle';
import { World } from './sim/World';
import { GameLoop } from './shell/GameLoop';
import { Hud } from './shell/Hud';
import { JobHud } from './shell/JobHud';
import { SettingsPanel } from './shell/SettingsPanel';
import { buildSettings } from './shell/settingsSchema';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

const entry = getVehicle(DEFAULT_VEHICLE_ID);

const map = getMap(DEFAULT_MAP_ID);
const terrain = new Terrain(map.width, map.depth, map.cellSize, map.generate());
const world = new World(terrain);

// M6 Phase A: one hard-coded contract. Job selection arrives with Phase B.
const site = createPadLevelJob(terrain);

// Built before the machine so saved tuning is applied to the vehicle
// definition and the contract before anything reads them.
const settings = new SettingsPanel(document.body, buildSettings(entry.def, site));
// A contract sets where you start; free roam falls back to the map spawn.
const vehicle = world.addVehicle(new Vehicle(entry.def, site.spawn ?? map.spawn));

world.job = new JobRunner(terrain, site);

const keyboard = new Keyboard();
const renderer = new Renderer(container, world);
const hud = new Hud(document.body, entry.def.keymap, entry.hints);
const jobHud = new JobHud(document.body);
renderer.refreshJobSite(world);

settings.onVisibilityChange = (open) => {
  document.body.classList.toggle('settings-open', open);
};

// Grade tolerance is a settings knob, and the overlay is drawn from it — so a
// change has to repaint the site rather than wait for the next terrain edit.
settings.onChange = () => renderer.refreshJobSite(world);

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
  if (typing) return;
  if (e.code === 'KeyC') renderer.chase.recenter();
  if (e.code === 'KeyG') renderer.toggleJobOverlay(world);
  if (e.code === 'KeyP') renderer.togglePostFx();
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
    const blade = Object.values(vehicle.state.implementStates).find((s) => s.kind === 'blade');
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
      bladeHeight: blade ? blade.height : null,
      gradeAtBlade: gradeUnderBlade(),
      carriedVolume: blade ? blade.carriedVolume : null,
      bladeBlocked: blade ? blade.blocked : false,
      load: vehicle.implementLoad,
    });

    jobHud.update(world.job);
  },
});

/** How far the ground at the blade sits above (+) or below (-) target grade. */
function gradeUnderBlade(): number | null {
  const job = world.job;
  if (!job) return null;

  const s = vehicle.state;
  const bx = s.position.x + Math.sin(s.heading) * 3;
  const bz = s.position.z + Math.cos(s.heading) * 3;
  const target = targetAt(
    job.site,
    Math.round(terrain.worldToCellX(bx)),
    Math.round(terrain.worldToCellZ(bz)),
  );
  return target === null ? null : terrain.sampleHeight(bx, bz) - target;
}

loop.start();

console.info(
  `[cranes] "${map.displayName}" — ${map.width}x${map.depth} cells @ ${map.cellSize}m ` +
    `(${terrain.worldWidth.toFixed(1)}m x ${terrain.worldDepth.toFixed(1)}m) — ` +
    `driving ${entry.def.displayName}`,
);
