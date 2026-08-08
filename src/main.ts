/**
 * Boot. The shell wires the layers together and owns nothing else.
 *
 * FR-6.2: the MVP boots straight into the map. No menus — they are not the
 * risky part of this project and they cost days.
 */

import { getMap, DEFAULT_MAP_ID } from './content/maps/registry';
import { Renderer } from './render/Renderer';
import { Terrain } from './sim/Terrain';
import { World } from './sim/World';
import { GameLoop } from './shell/GameLoop';
import { Hud } from './shell/Hud';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

const map = getMap(DEFAULT_MAP_ID);
const terrain = new Terrain(map.width, map.depth, map.cellSize, map.generate());
const world = new World(terrain);

const renderer = new Renderer(container, world);
const hud = new Hud(document.body);

// Volume is an O(cells) scan. Nothing edits terrain yet, and once M3 does it
// still only needs to be readable, not per-frame accurate.
let cachedVolume = terrain.totalVolume();
let sinceVolumeRefresh = 0;

const loop = new GameLoop({
  step: 1 / 60,
  update: (dt) => {
    world.step(dt);
    sinceVolumeRefresh += dt;
    if (sinceVolumeRefresh >= 0.5) {
      cachedVolume = terrain.totalVolume();
      sinceVolumeRefresh = 0;
    }
  },
  render: (alpha) => {
    renderer.sync(world);
    renderer.render(alpha);

    const info = renderer.info;
    hud.update({
      fps: loop.fps,
      frameMs: loop.frameMs,
      steps: world.steps,
      simTime: world.elapsed,
      cells: terrain.width * terrain.depth,
      volume: cachedVolume,
      drawCalls: info.calls,
      triangles: info.triangles,
    });
  },
});

loop.start();

console.info(
  `[cranes] "${map.displayName}" — ${map.width}x${map.depth} cells @ ${map.cellSize}m ` +
    `(${terrain.worldWidth.toFixed(1)}m x ${terrain.worldDepth.toFixed(1)}m)`,
);
