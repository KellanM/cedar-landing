import * as THREE from 'three';
import type { LandCollision } from './collision';
import { boatMat } from '../render/materials';

/** Tier-0 cedar canoe tuning — slow & cozy (study_record: 3 m/s starter). */
export const BOAT_T0 = {
  maxSpeed: 3.0,
  maxReverse: 1.0,
  accel: 1.1, // m/s^2 at full throttle
  coastDrag: 0.28, // 1/s exponential drag when coasting (long momentum = feels like water)
  brakeDrag: 0.9, // extra drag when throttling against motion
  turnRate: 0.95, // rad/s at cruising speed
  pivotTurn: 0.45, // fraction of turn rate available at standstill (a paddler can pivot)
  radius: 1.1, // collision footprint
};

/**
 * Model forward axis. The export maps Blender +Y (north) to three −Z; boats modelled bow-to-+Y
 * therefore face −Z, which is what the physics assumes. Flip with BOAT_MODEL_YAW if needed.
 */
export const BOAT_MODEL_YAW = 0;

export class Boat {
  root = new THREE.Group();
  private visual = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  private yawRate = 0;
  private t = 0;
  moored = false;

  constructor(model: THREE.Object3D) {
    this.setModel(model);
    this.root.add(this.visual);
  }

  setModel(model: THREE.Object3D) {
    this.visual.clear();
    model.rotation.y = BOAT_MODEL_YAW + Math.PI / 2; // BOAT_T0 bow points along local +X (export extras bow_axis)
    model.position.set(0, 0, 0);
    model.updateMatrix();
    model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.getAttribute('color')) m.material = boatMat; });
    this.visual.add(model);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  place(x: number, z: number, yaw: number) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.speed = 0;
    this.yawRate = 0;
  }

  update(dt: number, throttle: number, steer: number, land: LandCollision) {
    const P = BOAT_T0;
    this.t += dt;
    if (this.moored) { throttle = 0; steer = 0; }

    // Throttle / drag
    if (throttle !== 0) {
      const against = Math.sign(throttle) !== Math.sign(this.speed) && Math.abs(this.speed) > 0.05;
      this.speed += throttle * P.accel * dt;
      if (against) this.speed *= Math.exp(-P.brakeDrag * dt);
    } else {
      this.speed *= Math.exp(-P.coastDrag * dt);
      if (Math.abs(this.speed) < 0.02) this.speed = 0;
    }
    this.speed = Math.max(-P.maxReverse, Math.min(P.maxSpeed, this.speed));

    // Turning: more authority with speed, some pivot at rest; reversed when backing up.
    const auth = P.pivotTurn + (1 - P.pivotTurn) * Math.min(1, Math.abs(this.speed) / 1.5);
    const dir = this.speed < -0.05 ? -1 : 1;
    const targetRate = -steer * P.turnRate * auth * dir;
    this.yawRate += (targetRate - this.yawRate) * Math.min(1, dt * 3.5);
    this.yaw += this.yawRate * dt;

    // Move with land sliding
    const f = this.forward();
    const res = land.move(this.pos.x, this.pos.z, f.x * this.speed * dt, f.z * this.speed * dt, P.radius);
    if (res.hit) this.speed *= Math.exp(-2.5 * dt); // scrape along the shore, lose speed gently
    this.pos.x = res.x;
    this.pos.z = res.z;

    // Visual: gentle bob, roll into turns, slight bow rise with speed
    const bob = Math.sin(this.t * 1.3) * 0.04 + Math.sin(this.t * 2.1 + 1) * 0.02;
    const roll = -this.yawRate * 0.18 + Math.sin(this.t * 0.9) * 0.025;
    const pitch = Math.sin(this.t * 1.1 + 0.5) * 0.015 + (this.speed / P.maxSpeed) * 0.03;
    this.root.position.set(this.pos.x, bob, this.pos.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.visual.rotation.set(pitch, 0, roll);
  }
}
