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
import { DustSystem } from './DustSystem';
import { GradePlane } from './GradePlane';
import { LiftTargetView, PayloadView } from './PayloadView';
import { PostFX } from './PostFX';
import { SkyDome } from './SkyDome';
import { TerrainMesh } from './TerrainMesh';
import { VehicleView } from './VehicleView';

/** Half-extent of the sun's shadow frustum, in metres. */
const SHADOW_SPAN = 34;

export class Renderer {
  readonly scene: THREE.Scene;
  readonly chase: ChaseCamera;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly terrainMesh: TerrainMesh;
  private readonly vehicleViews = new Map<number, VehicleView>();
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: SkyDome;
  private readonly dust: DustSystem;
  private readonly payloads: PayloadView;
  private readonly liftTargets: LiftTargetView | null;
  private gradePlane: GradePlane | null = null;
  private postFx: PostFX | null = null;
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
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.sky = new SkyDome();
    this.scene.add(this.sky.object);
    // Fog matched to the horizon band, so distant terrain dissolves into the
    // sky instead of into an unrelated colour.
    this.scene.fog = new THREE.FogExp2(this.sky.horizonColor.getHex(), 0.0075);

    // Low sun angle: hillshading is what makes elevation legible (FR-1.3),
    // and it is doing most of the work here since there are no textures yet.
    this.sun = new THREE.DirectionalLight(0xffeccd, 2.7);
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
    // Sky/ground bounce, lifted hard. Shadows crushing to black is half of
    // what made this read as a 1990s renderer: real outdoor shade is filled by
    // light from the whole sky dome, not left at zero.
    this.scene.add(new THREE.HemisphereLight(0xaacdf5, 0x6b5f48, 1.45));

    this.terrainMesh = new TerrainMesh(world.terrain);
    this.scene.add(this.terrainMesh.object);

    this.dust = new DustSystem();
    this.scene.add(this.dust.object);

    this.payloads = new PayloadView(world.payloads);
    this.scene.add(this.payloads.object);

    // Built once from the contract's targets: pads do not move, only their
    // beacons go out as the loads land on them.
    this.liftTargets = world.lift
      ? new LiftTargetView(world.terrain, world.lift.targets)
      : null;
    if (this.liftTargets) this.scene.add(this.liftTargets.object);

    world.vehicles.forEach((vehicle, index) => {
      const entry = getVehicle(vehicle.def.id);
      const view = new VehicleView(vehicle.def, entry.view);
      view.sync(vehicle.state);
      this.vehicleViews.set(index, view);
      this.scene.add(view.object);
    });

    // Framed for whatever is being driven. The active machine's entry owns the
    // numbers, so a new machine brings its own camera rather than inheriting
    // the one the dozer was tuned with.
    const active = world.activeVehicle;
    this.chase = new ChaseCamera(
      this.renderer.domElement,
      1,
      active ? getVehicle(active.def.id).camera : undefined,
    );

    this.postFx = new PostFX(
      this.renderer,
      this.scene,
      this.chase.camera,
      container.clientWidth || 1,
      container.clientHeight || 1,
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Show or hide the grade guides: cut/fill tint AND the target surface. */
  toggleJobOverlay(world: World): boolean {
    const enabled = !this.terrainMesh.isOverlayEnabled;
    this.terrainMesh.setOverlayEnabled(enabled);
    this.gradePlane?.setVisible(enabled);
    this.liftTargets?.setVisible(enabled);

    const bounds = world.job?.site.bounds;
    if (bounds) world.terrain.markDirty(bounds.x0, bounds.z0, bounds.x1, bounds.z1);
    return enabled;
  }

  /** Rebuild the target surface and repaint the site. Call when a job starts. */
  refreshJobSite(world: World): void {
    if (this.gradePlane) {
      this.scene.remove(this.gradePlane.object);
      this.gradePlane.dispose();
      this.gradePlane = null;
    }

    const site = world.job?.site;
    if (site) {
      this.gradePlane = new GradePlane(world.terrain, site);
      this.gradePlane.setVisible(this.terrainMesh.isOverlayEnabled);
      this.scene.add(this.gradePlane.object);
      world.terrain.markDirty(site.bounds.x0, site.bounds.z0, site.bounds.x1, site.bounds.z1);
    }
  }

  /** Pull pending simulation changes into the scene graph. */
  sync(world: World): void {
    this.terrainMesh.sync(world.terrain, world.job?.site ?? null);

    world.vehicles.forEach((vehicle, index) => {
      this.vehicleViews.get(index)?.sync(vehicle.state);
    });

    this.payloads.sync(world.payloads);
    if (world.lift) this.liftTargets?.sync(world.lift.current);

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
      const implementStates = Object.values(active.state.implementStates);
      const crane = implementStates.find((s) => s.kind === 'crane');
      const arm = implementStates.find((s) => s.kind === 'excavator');

      // A slewing machine faces where its HOUSE faces, and works at the end of
      // whatever hangs off it. Following the tracks meant swinging round to the
      // work left the camera staring at the back of the crawlers.
      const facing = active.state.heading + (crane?.slew ?? arm?.slew ?? 0);
      this.chase.update(
        frameDt,
        active.state.position,
        facing,
        (x, z) => world.terrain.sampleHeight(x, z),
        crane?.hook ?? arm?.teeth ?? null,
      );

      const blade = implementStates.find((s) => s.kind === 'blade');
      const pos = active.state.position;
      this.dust.update(
        frameDt,
        blade ? blade.cutRate : 0,
        blade
          ? {
              x: pos.x + Math.sin(active.state.heading) * 3,
              y: pos.y + blade.height,
              z: pos.z + Math.cos(active.state.heading) * 3,
            }
          : null,
        active.state.heading,
      );
    } else {
      this.dust.update(frameDt, 0, null, 0);
    }

    this.sky.follow(this.chase.camera);
    if (!this.postFx?.render(frameDt)) {
      this.renderer.render(this.scene, this.chase.camera);
    }
  }

  /** Toggle the whole post chain — useful for judging what it is buying. */
  togglePostFx(): boolean {
    if (!this.postFx) return false;
    this.postFx.setEnabled(!this.postFx.isEnabled);
    return this.postFx.isEnabled;
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
    this.postFx?.setSize(w, h, Math.min(window.devicePixelRatio, 2));
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.chase.dispose();
    this.terrainMesh.dispose();
    this.sky.dispose();
    this.dust.dispose();
    this.payloads.dispose();
    this.liftTargets?.dispose();
    this.gradePlane?.dispose();
    this.postFx?.dispose();
    this.vehicleViews.forEach((v) => v.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
