import * as THREE from 'three';
import { WATER } from './tide';
import { SWELL, Buoyancy } from './swell';
import type { LandCollision } from './collision';
import { boatMat } from '../render/materials';

/** Per-tier boat handling. Snappy arcade feel (Sneaky Sasquatch-like); upgrades add tiers. */
export interface BoatTuning {
  maxSpeed: number; // m/s forward
  maxReverse: number; // m/s backward
  accel: number; // m/s² at full throttle (≈ near-max in 1.2 s)
  brake: number; // m/s² when pulling back against forward motion
  coastDrag: number; // 1/s exponential drag when coasting
  turnRate: number; // rad/s at speed (≈ 80°/s)
  pivotTurn: number; // fraction of turnRate available at standstill
  turnResponse: number; // 1/s how fast the yaw rate follows the stick
  grip: number; // 1/s lateral (sideways) velocity decay — higher = more keel, less slide
  deadzone: number; // stick deadzone (0..1)
  expo: number; // stick response curve exponent (1 = linear, >1 = finer control near centre)
  camLookAhead: number; // m the camera looks ahead of the boat at full speed
  camPullBack: number; // m the camera pulls back at full speed
  camFovBoost: number; // degrees of extra FOV at full speed
  radius: number; // collision footprint (m)
}

export const BOAT_T0: BoatTuning = {
  maxSpeed: 7,
  maxReverse: 2.5,
  accel: 6,
  brake: 11,
  coastDrag: 0.45,
  turnRate: 1.45,
  pivotTurn: 0.35,
  turnResponse: 9,
  grip: 5,
  deadzone: 0.08,
  expo: 1.5,
  camLookAhead: 5,
  camPullBack: 2.5,
  camFovBoost: 5,
  radius: 1.1,
};

/** Live tuning (current tier; the ?tune overlay edits this object in place). */
export const BOAT_TUNING: BoatTuning = { ...BOAT_T0 };

/**
 * Model forward axis. Physics assumes the bow points down three −Z. The exported BOAT_T0
 * (fishing troller) is modelled bow along local +X (node extras `bow_axis: "+X"`), so it is
 * turned a quarter (+X → −Z). The placeholder canoe is already bow-to-−Z.
 */
const BOW_YAW: Record<string, number> = { '+X': Math.PI / 2, '-X': -Math.PI / 2, '-Z': 0, '+Z': Math.PI };

export class Boat {
  root = new THREE.Group();
  private visual = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  /** 0..1 sea roughness (storm), set by main */
  rough = 0;
  /** a heavier boat (T1) rocks less */
  steady = false;
  private yawRate = 0;
  /** world-space planar velocity (forward + a little sideways slide) */
  vel = new THREE.Vector2();
  private t = 0;
  moored = false;
  /** Tides: ground under the hull (world y; the boat never sinks below it). Set by main. */
  floor = -99;
  private tmpF = new THREE.Vector3();
  /** Hull half-length / half-beam (m) from the model bounds, for wake placement. */
  halfLen = 2.4;
  halfBeam = 0.5;
  /** Smoke-stack position in the model's own space (export troller only). */
  private stackLocal: THREE.Vector3 | null = null;
  private model: THREE.Object3D | null = null;
  /** ocean experiment (src/game/swell.ts): the hull riding the real swell */
  private buoy = new Buoyancy();

  constructor(model: THREE.Object3D) {
    this.setModel(model);
    this.root.add(this.visual);
  }

  setModel(model: THREE.Object3D) {
    this.visual.clear();
    const axis = typeof model.userData.bow_axis === 'string' ? model.userData.bow_axis.toUpperCase() : /^BOAT_T\d+$/.test(model.name) ? '+X' : '-Z';
    model.rotation.set(0, BOW_YAW[axis] ?? 0, 0);
    model.position.set(0, 0, 0);
    model.updateMatrix(); // world meshes have matrixAutoUpdate off
    model.updateMatrixWorld(true);
    // Pivot at the hull's plan-view centre so turning and roll happen about the middle of the
    // boat; keep local y as exported (waterline ≈ y 0.0–0.1, which the bob is centred on).
    const bb = new THREE.Box3().setFromObject(model);
    const c = bb.getCenter(new THREE.Vector3());
    model.position.set(-c.x, 0, -c.z);
    model.updateMatrix();
    const size = bb.getSize(new THREE.Vector3());
    this.halfLen = Math.max(1, size.z / 2);
    // bounds include the troller's outrigger poles, so cap the beam by a hull-like proportion
    this.halfBeam = Math.max(0.3, Math.min(size.x / 2, size.z * 0.19));
    this.model = model;
    // Troller funnel: BOAT_T0 local (−1.25, 3.55, 0) (bow +X). Canoe / placeholder: none.
    // Upgrade tiers carry their stack in node extras (socket_stack_top, three coords, bow +X).
    const sock = model.userData.socket_stack_top as number[] | undefined;
    this.stackLocal = Array.isArray(sock) && sock.length === 3 ? new THREE.Vector3(sock[0], sock[1], sock[2])
      : model.name === 'BOAT_T0' && size.y > 2.5 ? new THREE.Vector3(-1.25, 3.55, 0) : null;
    model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.getAttribute('color')) m.material = boatMat; });
    this.visual.add(model);
  }

  get turnRate() { return this.yawRate; }
  /** The exported hull (BOAT_T0 local space, bow +X) — sockets attach here. */
  get modelObject() { return this.model; }

  /** World position of the smoke stack, or null if this boat has none. */
  stackWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.stackLocal || !this.model) return null;
    this.model.updateWorldMatrix(true, false);
    return out.copy(this.stackLocal).applyMatrix4(this.model.matrixWorld);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  place(x: number, z: number, yaw: number) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.speed = 0;
    this.yawRate = 0;
    this.vel.set(0, 0);
  }

  update(dt: number, throttle: number, steer: number, land: LandCollision) {
    const P = BOAT_TUNING;
    this.t += dt;
    if (this.moored) { throttle = 0; steer = 0; this.vel.set(0, 0); }
    // `speed` may have been zeroed externally (casting, mooring): keep the velocity in sync
    const fwd = this.forward(this.tmpF);
    let vf = this.vel.x * fwd.x + this.vel.y * fwd.z; // forward component
    let vs = this.vel.x * -fwd.z + this.vel.y * fwd.x; // sideways component (right)
    if (this.speed === 0 && Math.abs(vf) > 0) { vf = 0; vs = 0; }

    // Throttle: accelerate toward the target, brake hard when pulling against motion
    const target = throttle > 0 ? P.maxSpeed * throttle : throttle < 0 ? -P.maxReverse * -throttle : 0;
    if (throttle !== 0 && Math.sign(vf) === -Math.sign(throttle) && Math.abs(vf) > 0.05) {
      vf += Math.sign(throttle) * P.brake * Math.abs(throttle) * dt; // braking against motion
    } else if (throttle !== 0 && Math.abs(vf) < Math.abs(target)) {
      const a = (throttle > 0 ? P.accel : P.accel * 0.6) * throttle * dt;
      vf = throttle > 0 ? Math.min(target, vf + a) : Math.max(target, vf + a);
    } else {
      vf *= Math.exp(-P.coastDrag * (throttle === 0 ? 1 : 2) * dt); // coasting, or easing down to a lower stick
    }
    if (Math.abs(vf) < 0.03 && throttle === 0) vf = 0;
    vf = Math.max(-P.maxReverse, Math.min(P.maxSpeed, vf));

    // Turning: strong authority with speed, some pivot at rest; reversed when backing up
    const auth = P.pivotTurn + (1 - P.pivotTurn) * Math.min(1, Math.abs(vf) / 2);
    const dir = vf < -0.05 ? -1 : 1;
    const targetRate = -steer * P.turnRate * auth * dir;
    this.yawRate += (targetRate - this.yawRate) * Math.min(1, dt * P.turnResponse);
    this.yaw += this.yawRate * dt;

    // Keel grip: the old velocity is now partly sideways relative to the new heading → slide decays
    vs *= Math.exp(-P.grip * dt);
    const nf = this.forward(this.tmpF);
    // re-express: vf along the new heading, plus the carried-over slide (from turning)
    const turnSlide = vf * Math.sin(this.yawRate * dt) * 0.5; // a bit of the old momentum slides out sideways
    vs += turnSlide;
    this.vel.set(nf.x * vf - nf.z * vs, nf.z * vf + nf.x * vs);
    this.speed = vf;

    // Move with land sliding
    // moored: tied up, never nudged (a berth that dries at low tide just sits the boat on the mud)
    const res = this.moored ? { x: this.pos.x, z: this.pos.z, hit: false } : land.move(this.pos.x, this.pos.z, this.vel.x * dt, this.vel.y * dt, P.radius);
    if (res.hit && dt > 0) {
      // Pushing into the shore: report the speed we actually made (sliding along the coast), not the
      // throttle's wish — the wake, funnel smoke and "Slow down" all read boat.speed.
      const mx = (res.x - this.pos.x) / dt, mz = (res.z - this.pos.z) / dt;
      const along = mx * nf.x + mz * nf.z;
      this.speed = Math.sign(this.speed) * Math.min(Math.abs(this.speed), Math.abs(along));
      this.vel.set(mx, mz);
    }
    this.pos.x = res.x;
    this.pos.z = res.z;

    // Visual: gentle bob, roll into turns, slight bow rise with speed
    // storms (docs/rain_study.md): a heavier swell rocks and rolls her more (the Packer rides it better)
    // Swell (ocean experiment): the waves carry the heave / pitch / roll, the sines stay as a small idle life
    const sw = SWELL.on && !(this.floor > WATER.y - 0.05);
    if (sw) this.buoy.update(dt, this.pos.x, this.pos.z, this.yaw, this.halfLen, this.halfBeam, this.steady); else this.buoy.reset();
    const R = sw ? 0.45 : 1 + this.rough * (this.steady ? 1.6 : 2.6);
    const bob = (Math.sin(this.t * 1.3) * 0.04 + Math.sin(this.t * 2.1 + 1) * 0.02) * R;
    let roll = -this.yawRate * 0.18 + (Math.sin(this.t * 0.9) * 0.025 + (sw ? 0 : this.rough * 0.03 * Math.sin(this.t * 0.53 + 2))) * R;
    let pitch = (Math.sin(this.t * 1.1 + 0.5) * 0.015) * R + (this.speed / P.maxSpeed) * 0.04;
    if (sw) { roll += this.buoy.roll; pitch += this.buoy.pitch; }
    this.root.position.set(this.pos.x, Math.max(WATER.y + (sw ? this.buoy.heave : 0), this.floor) + bob, this.pos.z); // rides the tide (or sits on the mud)
    this.root.rotation.set(0, this.yaw, 0);
    this.visual.rotation.set(pitch, 0, roll);
  }
}
