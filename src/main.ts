/**
 * Boot. The shell wires the layers together and owns nothing else.
 *
 * FR-6.2: the MVP boots straight into the map with the dozer. No menus — they
 * are not the risky part of this project and they cost days.
 */

import { getMap, DEFAULT_MAP_ID } from './content/maps/registry';
import { getVehicle, DEFAULT_VEHICLE_ID } from './content/vehicles/registry';
import { Keyboard } from './input/Keyboard';
import { Renderer } from './render/Renderer';
import { Terrain } from './sim/Terrain';
import { Vehicle } from './sim/vehicle/Vehicle';
import { World } from './sim/World';
import { GameLoop } from './shell/GameLoop';
import { Hud } from './shell/Hud';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

const map = getMap(DEFAULT_MAP_ID);
const terrain = new Terrain(map.width, map.depth, map.cellSize, map.generate());
const world = new World(terrain);

const entry = getVehicle(DEFAULT_VEHICLE_ID);
const vehicle = world.addVehicle(new Vehicle(entry.def, map.spawn));

const keyboard = new Keyboard();
const renderer = new Renderer(container, world);
const hud = new Hud(document.body, entry.def.keymap, entry.hints);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') renderer.chase.recenter();
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
      carriedVolume: blade ? blade.carriedVolume : null,
      bladeBlocked: blade ? blade.blocked : false,
      load: vehicle.implementLoad,
    });
  },
});

loop.start();

console.info(
  `[cranes] "${map.displayName}" — ${map.width}x${map.depth} cells @ ${map.cellSize}m ` +
    `(${terrain.worldWidth.toFixed(1)}m x ${terrain.worldDepth.toFixed(1)}m) — ` +
    `driving ${entry.def.displayName}`,
);
