/**
 * Renderer — the ONLY module tree permitted to import three.js.
 *
 * Data flows one way: World -> Renderer. Nothing here writes simulation state.
 * Swapping this folder out is what "we could go 2D later" actually means.
 */

import * as THREE from 'three';
import { getVehicle } from '../content/vehicles/registry';
import type { World } from '../sim/World';
import { ChaseCamera } from './ChaseCamera';
import { TerrainMesh } from './TerrainMesh';
import { VehicleView } from './VehicleView';

const SKY = 0x121820;
/** Half-extent of the sun's shadow frustum, in metres. */
const SHADOW_SPAN = 34;

export class Renderer {
  readonly scene: THREE.Scene;
  readonly chase: ChaseCamera;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly terrainMesh: TerrainMesh;
  private readonly vehicleViews = new Map<number, VehicleView>();
  private readonly sun: THREE.DirectionalLight;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, world: World) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.FogExp2(SKY, 0.0042);

    // Low sun angle: hillshading is what makes elevation legible (FR-1.3),
    // and it is doing most of the work here since there are no textures yet.
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.camera.left = -SHADOW_SPAN;
    this.sun.shadow.camera.right = SHADOW_SPAN;
    this.sun.shadow.camera.top = SHADOW_SPAN;
    this.sun.shadow.camera.bottom = -SHADOW_SPAN;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x40382a, 0.85));

    this.terrainMesh = new TerrainMesh(world.terrain);
    this.scene.add(this.terrainMesh.object);

    world.vehicles.forEach((vehicle, index) => {
      const entry = getVehicle(vehicle.def.id);
      const view = new VehicleView(vehicle.def, entry.view);
      view.sync(vehicle.state);
      this.vehicleViews.set(index, view);
      this.scene.add(view.object);
    });

    this.chase = new ChaseCamera(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Pull pending simulation changes into the scene graph. */
  sync(world: World): void {
    this.terrainMesh.sync(world.terrain);

    world.vehicles.forEach((vehicle, index) => {
      this.vehicleViews.get(index)?.sync(vehicle.state);
    });

    // Keep the shadow frustum tight around the action rather than the whole
    // 128m yard — a fixed map-wide frustum would waste the entire shadow map.
    const focus = world.activeVehicle?.state.position;
    if (focus) {
      this.sun.target.position.set(focus.x, focus.y, focus.z);
      this.sun.position.set(focus.x - 58, focus.y + 62, focus.z + 34);
      this.sun.target.updateMatrixWorld();
    }
  }

  /**
   * `alpha` is the fraction of a sim step already elapsed. Camera easing is
   * frame-rate independent, so it consumes real frame time rather than alpha;
   * `alpha` becomes useful when vehicle pose interpolation lands in M4.
   */
  render(world: World, frameDt: number, _alpha: number): void {
    const active = world.activeVehicle;
    if (active) {
      this.chase.update(frameDt, active.state.position, active.state.heading, (x, z) =>
        world.terrain.sampleHeight(x, z),
      );
    }
    this.renderer.render(this.scene, this.chase.camera);
  }

  get info(): { calls: number; triangles: number } {
    const { render } = this.renderer.info;
    return { calls: render.calls, triangles: render.triangles };
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.chase.setAspect(w / h);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.chase.dispose();
    this.terrainMesh.dispose();
    this.vehicleViews.forEach((v) => v.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
