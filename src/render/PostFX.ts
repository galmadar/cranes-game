/**
 * Post-processing.
 *
 * The player described the look as "like a 90s game", and that diagnosis is
 * more precise than it sounds. What dates a real-time scene is almost never
 * polygon count — it is **no ambient occlusion, one hard light, and shadows
 * that crush to black**. Every surface gets lit by exactly one directional
 * term plus a flat ambient, so nothing has contact, and creases look painted
 * on rather than shaded.
 *
 * Ground-truth ambient occlusion is the single biggest correction: it darkens
 * where geometry closes in on itself, which is what gives a modern renderer
 * its sense of depth. Terrain benefits enormously — every trench the blade
 * cuts and every pile it heaps suddenly reads as a real hollow or a real
 * mound rather than as shading on a flat sheet.
 *
 * A multisampled half-float target carries MSAA and HDR through the chain, so
 * bloom has real highlight range to work with and geometry edges stay smooth
 * without a separate AA pass.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class PostFX {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly target: THREE.WebGLRenderTarget;

  private enabled = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    // samples: MSAA survives the composer, so we do not need a separate AA
    // pass. HalfFloat keeps highlights above 1.0 for bloom to find.
    this.target = new THREE.WebGLRenderTarget(width, height, {
      samples: 4,
      type: THREE.HalfFloatType,
    });

    this.composer = new EffectComposer(renderer, this.target);
    this.composer.addPass(new RenderPass(scene, camera));

    this.gtao = new GTAOPass(scene, camera, width, height);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    // Radius is in world units: ~1.5m picks up blade trenches and track ruts
    // without smearing occlusion across the whole yard.
    this.gtao.updateGtaoMaterial({
      radius: 1.6,
      distanceExponent: 1.0,
      thickness: 1.0,
      scale: 1.0,
      samples: 16,
      screenSpaceRadius: false,
    });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);

    // Deliberately restrained. Bloom is the easiest way to make a scene look
    // cheap; here it is only meant to give the sunlit sand a little bite.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.22, 0.7, 0.92);
    this.composer.addPass(this.bloom);

    // Applies tone mapping and the output colour space; must be last.
    this.composer.addPass(new OutputPass());
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  /** @returns true if it rendered; false means the caller should render plainly. */
  render(deltaSeconds: number): boolean {
    if (!this.enabled) return false;
    this.composer.render(deltaSeconds);
    return true;
  }

  dispose(): void {
    this.composer.dispose();
    this.target.dispose();
  }
}
