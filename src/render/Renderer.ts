/**
 * Renderer — the ONLY module tree permitted to import three.js.
 *
 * Data flows one way: World -> Renderer. Nothing here writes simulation state.
 * Swapping this folder out is what "we could go 2D later" actually means.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { World } from '../sim/World';
import { TerrainMesh } from './TerrainMesh';

const SKY = 0x121820;

export class Renderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly terrainMesh: TerrainMesh;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, world: World) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.FogExp2(SKY, 0.0042);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.5, 2000);
    this.camera.position.set(34, 26, 42);

    // Low sun angle: hillshading is what makes elevation legible (FR-1.3),
    // and it is doing most of the work here since there are no textures yet.
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(-70, 52, 38);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x40382a, 0.85));

    this.terrainMesh = new TerrainMesh(world.terrain);
    this.scene.add(this.terrainMesh.object);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 280;
    this.controls.maxPolarAngle = Math.PI * 0.49; // never look from underground
    this.controls.update();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Pull any pending simulation changes into the scene graph. */
  sync(world: World): void {
    this.terrainMesh.sync(world.terrain);
  }

  /**
   * `alpha` is the fraction of a sim step already elapsed — M2 uses it to
   * interpolate vehicle pose so motion stays smooth above 60fps (NFR-2).
   */
  render(_alpha: number): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  get info(): { calls: number; triangles: number } {
    const { render } = this.renderer.info;
    return { calls: render.calls, triangles: render.triangles };
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.terrainMesh.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
