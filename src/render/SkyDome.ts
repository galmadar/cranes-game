/**
 * Gradient sky.
 *
 * A flat background colour gives the scene no horizon, so the terrain reads as
 * a slab floating in a void. A two-stop vertical gradient costs one inverted
 * sphere and immediately grounds everything, at no asset cost (NFR-7).
 */

import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vWorldDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  varying vec3 vWorldDirection;

  void main() {
    float h = vWorldDirection.y;
    vec3 color = h > 0.0
      ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55))
      : mix(horizonColor, groundColor, pow(clamp(-h, 0.0, 1.0), 0.35));
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export class SkyDome {
  readonly object: THREE.Mesh;
  /** Fog should match the horizon, or the terrain fades into the wrong colour. */
  readonly horizonColor: THREE.Color;

  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const top = new THREE.Color().setRGB(0.24, 0.42, 0.66, THREE.SRGBColorSpace);
    const horizon = new THREE.Color().setRGB(0.62, 0.68, 0.72, THREE.SRGBColorSpace);
    const ground = new THREE.Color().setRGB(0.18, 0.17, 0.16, THREE.SRGBColorSpace);
    this.horizonColor = horizon;

    this.geometry = new THREE.SphereGeometry(1, 32, 16);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: top },
        horizonColor: { value: horizon },
        groundColor: { value: ground },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = 'sky';
    this.object.frustumCulled = false;
    // Drawn before everything else, and never occludes anything.
    this.object.renderOrder = -1;
    this.object.scale.setScalar(900);
  }

  /** Keep the dome centred on the camera so it can never be driven out of. */
  follow(camera: THREE.Camera): void {
    this.object.position.copy(camera.position);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
