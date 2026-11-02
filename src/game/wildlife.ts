import * as THREE from 'three';
import type { Gameplay } from '../world/types';
import type { LandCollision } from './collision';
import { BirdField } from './birds';
import { SeaLife } from './sealife';
import { SplashFX } from './splash';

/** All animated wildlife: birds (gull frenzies, flocks, perched), sea life, and their splashes. */
export class Wildlife {
  group = new THREE.Group();
  splash = new SplashFX();
  birds: BirdField;
  sea: SeaLife;
  /** ms spent in update() last frame (perf readout). */
  cost = 0;

  constructor(gp: Gameplay, land: LandCollision, low: boolean) {
    this.birds = new BirdField(gp.hotspots, gp.birds, low, this.splash);
    this.sea = new SeaLife(gp.hotspots, gp, land, low, this.splash);
    this.group.name = 'wildlife';
    this.group.add(this.birds.group, this.sea.group, this.splash.group);
  }

  /** Squawk-cue hook for future audio. */
  set onSquawk(fn: ((x: number, y: number, z: number, intensity: number) => void) | null) { this.birds.onSquawk = fn; }

  update(dt: number, cam: THREE.Vector3, boat: THREE.Vector3) {
    const t0 = performance.now();
    this.birds.update(dt, cam, boat);
    this.sea.update(dt, cam, boat);
    this.splash.update(dt);
    this.cost = performance.now() - t0;
  }

  /** A fish was landed at (x,z). */
  onCatch(x: number, z: number) { this.birds.excite(x, z); }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}
