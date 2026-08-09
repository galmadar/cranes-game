/**
 * The target surface, drawn.
 *
 * This exists because a player reported not understanding how to finish a job.
 * The cut/fill overlay says "too high" and "too low", but it never showed
 * *where flat actually is* — so the goal was something you had to infer from
 * colours rather than something you could look at.
 *
 * Now the target is a literal surface floating in the site. Ground poking up
 * through it is what you cut; hollows below it are what you fill. Depth
 * testing does the teaching: terrain in front of the plane occludes it, so
 * "sticking out" is visually obvious.
 *
 * Built from the target FIELD rather than a single elevation, so sloped and
 * stepped targets work unchanged when Phase B adds ramps.
 */

import * as THREE from 'three';
import { siteDepth, siteWidth, targetAt, type JobSite } from '../sim/job/JobSite';
import type { Terrain } from '../sim/Terrain';

/** Draw a grid line every N cells, so the surface reads as a plane. */
const GRID_EVERY = 4;

export class GradePlane {
  readonly object: THREE.Group;

  private readonly surfaceGeometry: THREE.BufferGeometry;
  private readonly surfaceMaterial: THREE.MeshBasicMaterial;
  private readonly gridGeometry: THREE.BufferGeometry;
  private readonly gridMaterial: THREE.LineBasicMaterial;

  constructor(terrain: Terrain, site: JobSite) {
    const w = siteWidth(site);
    const d = siteDepth(site);

    const positions = new Float32Array(w * d * 3);
    for (let iz = 0; iz < d; iz++) {
      for (let ix = 0; ix < w; ix++) {
        const cx = site.bounds.x0 + ix;
        const cz = site.bounds.z0 + iz;
        const o = (iz * w + ix) * 3;
        positions[o + 0] = terrain.cellToWorldX(cx);
        positions[o + 1] = targetAt(site, cx, cz) ?? 0;
        positions[o + 2] = terrain.cellToWorldZ(cz);
      }
    }

    const indices = new Uint32Array((w - 1) * (d - 1) * 6);
    let k = 0;
    for (let iz = 0; iz < d - 1; iz++) {
      for (let ix = 0; ix < w - 1; ix++) {
        const a = iz * w + ix;
        const b = a + 1;
        const c = a + w;
        const dd = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = dd;
      }
    }

    this.surfaceGeometry = new THREE.BufferGeometry();
    this.surfaceGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.surfaceGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.surfaceMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.85, 0.95, 1.0, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      // Terrain sitting exactly at grade would otherwise z-fight with the
      // plane — which is precisely the ground the player has just finished.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    // Grid lines make it read as a measured surface rather than as haze.
    const linePoints: number[] = [];
    const at = (ix: number, iz: number): [number, number, number] => {
      const o = (iz * w + ix) * 3;
      return [positions[o], positions[o + 1], positions[o + 2]];
    };
    for (let iz = 0; iz < d; iz += GRID_EVERY) {
      for (let ix = 0; ix < w - 1; ix++) linePoints.push(...at(ix, iz), ...at(ix + 1, iz));
    }
    for (let ix = 0; ix < w; ix += GRID_EVERY) {
      for (let iz = 0; iz < d - 1; iz++) linePoints.push(...at(ix, iz), ...at(ix, iz + 1));
    }

    this.gridGeometry = new THREE.BufferGeometry();
    this.gridGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(linePoints), 3),
    );
    this.gridMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color().setRGB(0.95, 0.99, 1.0, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    this.object = new THREE.Group();
    this.object.name = 'gradePlane';
    this.object.add(new THREE.Mesh(this.surfaceGeometry, this.surfaceMaterial));
    this.object.add(new THREE.LineSegments(this.gridGeometry, this.gridMaterial));
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  dispose(): void {
    this.surfaceGeometry.dispose();
    this.surfaceMaterial.dispose();
    this.gridGeometry.dispose();
    this.gridMaterial.dispose();
  }
}
