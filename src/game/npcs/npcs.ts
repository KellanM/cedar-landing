import * as THREE from 'three';
import { worldMat } from '../../render/materials';
import type { Npc } from '../../world/types';
import { BONES, type BoneName, Spring, addLocal, ease, hash01, npcLimb } from './rigpose';

/**
 * Animated NPCs (world/npcs.glb, see docs/web_export_contract.md + docs/study/people_animation.md).
 *
 * Every NPC is a 15-bone rig whose glTF rest pose is its role pose (sitting, bent over a net, waving …).
 * This animator only ADDS small rotations on top of that pose, in layers:
 *   1. life     breathing (chest + shoulders), slow weight shift, glances — every NPC, phase/rate per NPC
 *   2. work     a role loop built from 2–3 key poses with eased timing (mend, carve, stir, gut, dig, tell, …)
 *   3. notice   head (then chest) turns to the player inside ~7 m after a short delay; interest wanes and returns
 *   4. react    talking: standing NPCs turn their body to face you, everyone nods; greeters wave; kids hop
 * Springs smooth every layer switch (no linear pops). Animation is throttled by camera distance and frozen
 * beyond FAR; nothing allocates per frame.
 */

const NEAR = 22; // full rate within this many metres of the camera
const FAR = 55; // frozen beyond
const NOTICE = 7; // m: start watching the player
const D = Math.PI / 180;

type Kind = 'stand' | 'hands_hips' | 'lean' | 'read' | 'carry' | 'carry_back' | 'sit' | 'wave' | 'wave_kid' | 'cry' | 'mend' | 'carve' | 'stir'
  | 'gut' | 'dig' | 'tell' | 'rock' | 'weave' | 'static';
/** Kinds whose feet are planted and upright: they may turn their whole body to face you. */
const CAN_TURN = new Set<Kind>(['stand', 'hands_hips', 'read', 'carry', 'carry_back', 'wave', 'wave_kid', 'cry', 'lean']);
const SEATED = new Set<Kind>(['sit', 'mend', 'tell', 'rock', 'weave']);

interface Actor {
  name: string;
  kind: Kind;
  root: THREE.Object3D;
  baseQ: THREE.Quaternion;
  bones: Partial<Record<BoneName, THREE.Object3D>>;
  rest: Partial<Record<BoneName, THREE.Quaternion>>;
  hipsPos: THREE.Vector3;
  child: boolean;
  // per-NPC rhythm
  seed: number; breath: number; shiftT: number; workT: number; t: number;
  acc: number; // throttle accumulator
  // attention
  lookYaw: Spring; lookPitch: Spring; turn: Spring; nod: Spring; hop: Spring;
  interest: number; // seconds left watching the player (negative = cooling down)
  noticeDelay: number;
  glanceT: number; glanceYaw: number;
  talkT: number; // seconds since the last talk (large = none)
  waveW: Spring; // 0 = arm down, 1 = the authored wave pose (greeters)
  greeted: boolean;
  armDown?: { shR: THREE.Quaternion; elR: THREE.Quaternion };
  pos: THREE.Vector3;
  fwdYaw: number; // world yaw the NPC faces at rest (three: forward = (sin, 0, cos))
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function wrap(a: number) { return Math.atan2(Math.sin(a), Math.cos(a)); }

export class NpcCrowd {
  group = new THREE.Group();
  actors: Actor[] = [];
  private byName = new Map<string, Actor>();
  /** stats for tests / perf */
  stats = { actors: 0, animated: 0, frozen: 0, ms: 0 };

  constructor(scene: THREE.Object3D, npcs: Npc[]) {
    this.group.name = 'NPCs';
    const meta = new Map(npcs.map((n) => [n.name ?? '', n]));
    for (const node of [...scene.children]) {
      const a = this.makeActor(node, meta.get(node.name));
      if (!a) continue;
      this.group.add(node);
      this.actors.push(a);
      this.byName.set(a.name, a);
    }
    this.stats.actors = this.actors.length;
  }

  private makeActor(node: THREE.Object3D, n: Npc | undefined): Actor | null {
    const bones: Partial<Record<BoneName, THREE.Object3D>> = {};
    let skinned: THREE.SkinnedMesh | null = null;
    node.traverse((o) => {
      if ((o as THREE.Bone).isBone && (BONES as readonly string[]).includes(o.name)) bones[o.name as BoneName] = o;
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        if (m.geometry.getAttribute('color')) m.material = worldMat;
        if (m.isSkinnedMesh) skinned = m;
      }
    });
    if (!bones.hips || !bones.head) return null;
    const ud = node.userData ?? {};
    const name = node.name;
    const kind = (String(ud.npc_idle ?? n?.idle ?? 'stand') as Kind);
    const rest: Partial<Record<BoneName, THREE.Quaternion>> = {};
    for (const b of BONES) if (bones[b]) rest[b] = bones[b]!.quaternion.clone();
    const sm = skinned as THREE.SkinnedMesh | null;
    if (sm) {
      // bind-pose bounds are fine for culling: NPCs only move a little around their rest pose
      sm.geometry.computeBoundingSphere();
      sm.frustumCulled = true;
      if (sm.geometry.boundingSphere) sm.geometry.boundingSphere.radius += 0.6;
    }
    const seed = hash01(name);
    node.updateMatrixWorld(true);
    const pos = node.getWorldPosition(new THREE.Vector3());
    const f = _v.set(0, 0, 1).applyQuaternion(node.getWorldQuaternion(_q));
    const a: Actor = {
      name, kind, root: node, baseQ: node.quaternion.clone(), bones, rest, hipsPos: bones.hips.position.clone(),
      child: String(ud.age ?? n?.props?.age ?? '') === 'child',
      seed, breath: 3.4 + seed * 1.3, shiftT: 9 + hash01(name, 3) * 4, workT: 1 + hash01(name, 5) * 0.3, t: hash01(name, 7) * 20, acc: 0,
      lookYaw: new Spring(0, 7, 0.9), lookPitch: new Spring(0, 7, 0.9), turn: new Spring(0, 4.5, 0.85), nod: new Spring(0, 14, 0.45), hop: new Spring(0, 18, 0.35),
      interest: 0, noticeDelay: 0.25 + hash01(name, 11) * 0.35, glanceT: 2 + hash01(name, 13) * 5, glanceYaw: 0,
      talkT: 99, waveW: new Spring(1, 6, 0.8), greeted: false, pos, fwdYaw: Math.atan2(f.x, f.z),
    };
    if (kind === 'wave' && bones.upper_arm_R && bones.forearm_R) {
      // greeters rest with the arm down and raise it to wave when you come near
      a.armDown = { shR: npcLimb(6, 10, -1, new THREE.Quaternion()), elR: npcLimb(14, 0, -1, new THREE.Quaternion()) };
      a.waveW.x = 0;
    }
    return a;
  }

  /** Player started talking to an NPC (by gameplay name). */
  react(name: string) {
    const a = this.byName.get(name);
    if (!a || a.kind === 'static') return;
    a.talkT = 0;
    a.interest = 8;
    a.nod.kick(2.6); // positive pitch = chin dips forward, then springs back past zero (ζ 0.45)
    if (a.child) a.hop.kick(2.2);
  }

  update(dt: number, cam: THREE.Vector3, player: THREE.Vector3 | null) {
    const t0 = performance.now();
    let animated = 0, frozen = 0;
    for (const a of this.actors) {
      if (a.kind === 'static') continue;
      const dc = a.pos.distanceTo(cam);
      if (dc > FAR) { frozen++; continue; }
      // throttle: full rate near, ~15 Hz far
      a.acc += dt;
      const step = dc < NEAR ? 0 : 1 / 15;
      if (a.acc < step) continue;
      const h = Math.min(a.acc, 0.1);
      a.acc = 0;
      this.animate(a, h, player);
      animated++;
    }
    this.stats.animated = animated;
    this.stats.frozen = frozen;
    this.stats.ms = performance.now() - t0;
  }

  private animate(a: Actor, dt: number, player: THREE.Vector3 | null) {
    a.t += dt;
    a.talkT += dt;
    const t = a.t;
    const B = a.bones, R = a.rest;

    // ---------------------------------------------------------- attention: where is the player?
    let pYaw = 0, pPitch = 0, pd = 99;
    if (player) {
      _v.copy(player).sub(a.pos);
      pd = Math.hypot(_v.x, _v.z);
      pYaw = wrap(Math.atan2(_v.x, _v.z) - a.fwdYaw); // + = to the NPC's left
      pPitch = Math.atan2(player.y + 1.45 - (a.pos.y + (SEATED.has(a.kind) ? 1.05 : 1.45)), Math.max(0.5, pd));
    }
    const near = pd < NOTICE;
    if (near) {
      if (a.interest <= 0 && a.interest > -0.001) a.interest = -a.noticeDelay; // start the reaction delay
      if (a.interest < 0) { a.interest += dt; if (a.interest >= 0) a.interest = 4 + hash01(a.name, Math.floor(t)) * 4; }
      else a.interest -= dt * (a.talkT < 6 ? 0 : 1);
      if (a.interest <= 0 && a.interest > -0.01 && a.talkT > 6) a.interest = -(3 + hash01(a.name, Math.floor(t * 3)) * 3); // look away, come back later
    } else if (a.interest > 0) a.interest = Math.max(0, a.interest - dt * 2);
    else a.interest = Math.min(0, a.interest + dt);
    const watching = near && a.interest > 0 && Math.abs(pYaw) < 2.4;

    // glances when not watching: pick a new direction every few seconds
    a.glanceT -= dt;
    if (a.glanceT <= 0) {
      const r = hash01(a.name, Math.floor(t * 10));
      a.glanceYaw = r < 0.45 ? 0 : (r - 0.725) * 1.4; // ±~20° or straight ahead
      a.glanceT = 2.5 + hash01(a.name, Math.floor(t * 7)) * 5;
    }
    const lookYawT = watching ? THREE.MathUtils.clamp(pYaw, -1.5, 1.5) : a.glanceYaw;
    const lookPitchT = watching ? THREE.MathUtils.clamp(pPitch, -0.35, 0.45) : 0;
    a.lookYaw.step(lookYawT, dt);
    a.lookPitch.step(lookPitchT, dt);
    // whole-body turn while talking (planted kinds only), back to the authored facing afterwards
    const talking = a.talkT < 7 && pd < 4.5;
    const turnT = talking && CAN_TURN.has(a.kind) ? THREE.MathUtils.clamp(pYaw, -2.6, 2.6) * 0.85 : 0;
    a.turn.step(turnT, dt);
    a.root.quaternion.copy(a.baseQ).premultiply(_qy.setFromAxisAngle(UP, a.turn.x));
    a.nod.step(0, dt);
    a.hop.step(0, dt);
    const ly = a.lookYaw.x - a.turn.x * 1.0; // head yaw relative to the (turned) body
    const lp = a.lookPitch.x;

    // ---------------------------------------------------------- life: breathing + weight shift
    const br = Math.sin((t / a.breath) * Math.PI * 2);
    const sh = Math.sin((t / a.shiftT) * Math.PI * 2);
    const sh2 = Math.sin((t / a.shiftT) * Math.PI * 4 + 1.3) * 0.3;
    const standing = !SEATED.has(a.kind) && a.kind !== 'dig' && a.kind !== 'carve' && a.kind !== 'gut' && a.kind !== 'stir';
    const shift = standing ? (sh + sh2) : 0;

    // per-bone additive offsets (radians): pitch, roll, yaw
    let hipP = 0, hipR = shift * 2.2 * D, hipY = 0;
    let spP = br * 0.9 * D, spR = -shift * 1.4 * D, spY = 0;
    let chP = br * 1.2 * D, chR = 0, chY = 0;
    let nkP = -br * 0.5 * D, nkR = shift * 1.0 * D, nkY = 0;
    let hdP = 0, hdR = 0, hdY = 0;
    let uaLP = br * 1.0 * D, uaLR = 0, uaLY = 0, uaRP = br * 1.0 * D, uaRR = 0, uaRY = 0;
    let faLP = 0, faLR = 0, faRP = 0, faRR = 0;
    let hdLP = 0, hdRP = 0;
    let thLR = -hipR, thRR = -hipR, shLP = 0, shRP = 0;
    let hipLift = 0;
    // knees soften on the weighted side
    if (standing) { shLP = Math.max(0, -sh) * 3 * D; shRP = Math.max(0, sh) * 3 * D; }

    // ---------------------------------------------------------- work loops (degrees → radians at the end)
    const w = a.workT;
    switch (a.kind) {
      case 'mend': { // hand-over-hand through the net in the lap, 1.6 s
        const p = (t / (1.6 * w)) * Math.PI * 2;
        uaRP += 9 * Math.sin(p) * D; faRP += 14 * Math.sin(p + 0.7) * D;
        uaLP += 7 * Math.sin(p + Math.PI) * D; faLP += 10 * Math.sin(p + Math.PI + 0.7) * D;
        hdRP += 10 * Math.sin(p + 1.2) * D; hdLP += 8 * Math.sin(p + Math.PI + 1.2) * D;
        nkP += (8 + 2 * Math.sin(p * 2)) * D; spY += 2.5 * Math.sin(p) * D;
        break;
      }
      case 'weave': {
        const p = (t / (2.2 * w)) * Math.PI * 2;
        faRP += 10 * Math.sin(p) * D; faLP += 10 * Math.sin(p + 2) * D; nkP += 6 * D;
        break;
      }
      case 'carve': { // lift slowly, chop fast, settle: 1.3 s
        const p = (t / (1.3 * w)) % 1;
        let k: number;
        if (p < 0.55) k = ease(p / 0.55); // raise
        else if (p < 0.66) k = 1 - ease((p - 0.55) / 0.11) * 1.15; // fast chop with a small overshoot
        else k = -0.15 + 0.15 * ease((p - 0.66) / 0.34); // settle
        uaRP += -26 * k * D; faRP += -22 * k * D; hdRP += -12 * k * D;
        spP += (k < 0 ? -k * 22 : -k * 3) * D; // body follows the chop through
        uaLP += -4 * k * D; nkP += 6 * D;
        break;
      }
      case 'gut': { // short cleaver strokes, 0.9 s
        const p = (t / (0.9 * w)) % 1;
        const k = p < 0.6 ? ease(p / 0.6) : 1 - ease((p - 0.6) / 0.4);
        faRP += -20 * k * D; uaRP += -8 * k * D; hdRP += -10 * k * D;
        spP += 2 * (1 - k) * D; nkP += 5 * D;
        break;
      }
      case 'stir': { // tending the fish over the fire: slow circling of the right arm, 2.2 s
        const p = (t / (2.2 * w)) * Math.PI * 2;
        uaRP += 9 * Math.sin(p) * D; uaRR += 7 * Math.cos(p) * D; faRP += 8 * Math.sin(p + 0.5) * D;
        spY += 4 * Math.sin(p) * D; spP += 2 * Math.cos(p) * D;
        break;
      }
      case 'dig': { // push the digging stick down, pull, 1.7 s
        const p = (t / (1.7 * w)) % 1;
        const k = p < 0.35 ? ease(p / 0.35) : 1 - ease((p - 0.35) / 0.65);
        uaRP += 14 * k * D; uaLP += 10 * k * D; faRP += 10 * k * D; spP += 6 * k * D;
        break;
      }
      case 'tell': { // story gestures: slow open-hand sweep, addressing listeners left and right
        const p = (t / (3.4 * w)) * Math.PI * 2;
        uaLR += 10 * Math.sin(p) * D; uaLP += 6 * Math.sin(p * 0.5 + 1) * D; faLP += 10 * Math.sin(p + 0.6) * D;
        if (!watching) nkY += 18 * Math.sin(p * 0.5) * D;
        chY += 5 * Math.sin(p * 0.5) * D; hdLP += 12 * Math.sin(p + 1.1) * D;
        break;
      }
      case 'rock': { // rocking chair
        const p = (t / (2.8 * w)) * Math.PI * 2;
        hipP += 3.5 * Math.sin(p) * D; nkP += -2.5 * Math.sin(p) * D;
        break;
      }
      case 'cry': { // ring the bell in bursts, paper in the other hand
        const p = t % (2.8 * w);
        const ring = p < 1.3 ? Math.sin(p * Math.PI * 2 * 2.8) * Math.sin((p / 1.3) * Math.PI) : 0;
        faRP += 22 * ring * D; uaRP += 6 * ring * D; hdRP += 15 * ring * D;
        nkP += (p < 1.3 ? -8 : 0) * D; // head up to call out
        break;
      }
      case 'wave': case 'wave_kid': {
        // greeters: arm up + waving while you approach or talk; kids wave in bursts and hop
        const want = a.kind === 'wave_kid' ? 1 : (pd < 12 && (!a.greeted || talking) ? 1 : 0);
        if (a.kind === 'wave' && pd < 12) { if (!a.greeted && a.interest > 0) a.greeted = true; }
        if (a.kind === 'wave' && pd > 16) a.greeted = false;
        a.waveW.step(want, dt);
        const burst = a.kind === 'wave_kid' ? ((t % 4.5) < 2.2 || pd < 8 ? 1 : 0.15) : 1;
        const wv = Math.sin(t * Math.PI * 2 * (a.kind === 'wave_kid' ? 2.2 : 1.6)) * burst * a.waveW.x;
        uaRR += 9 * wv * D; faRR += 20 * wv * D; hdRP += 15 * wv * D;
        if (a.kind === 'wave_kid' && burst > 0.5) hipLift += Math.max(0, Math.sin(t * Math.PI * 2 * 2.2)) * (pd < 8 ? 0.05 : 0.025);
        break;
      }
      case 'read': { // eyes run along the lines: slow sweep, quick return
        const p = (t / (3.2 * w)) % 1;
        const k = p < 0.85 ? p / 0.85 : 1 - ease((p - 0.85) / 0.15);
        if (!watching) nkY += (-10 + 20 * k) * D;
        nkP += 3 * Math.sin(p * Math.PI * 6) * D * 0.3;
        break;
      }
      case 'carry': case 'carry_back': { // hitch the load every few seconds
        const p = t % (5.5 * w);
        const k = p < 0.5 ? Math.sin((p / 0.5) * Math.PI) : 0;
        uaLP += -6 * k * D; uaRP += -6 * k * D; spP += -3 * k * D; hipLift += 0.015 * k;
        break;
      }
      case 'sit': { // tap a foot now and then
        const p = t % (6 * w);
        const k = p < 1.6 ? Math.max(0, Math.sin(p * Math.PI * 2 * 1.9)) : 0;
        shRP += -9 * k * D;
        break;
      }
      case 'hands_hips': case 'stand': case 'lean': default: {
        // occasional shoulder roll / stretch
        const p = t % (11 * w);
        const k = p < 1.2 ? Math.sin((p / 1.2) * Math.PI) : 0;
        uaLR += -5 * k * D; uaRR += -5 * k * D; spP += -2.5 * k * D; nkP += -6 * k * D;
        break;
      }
    }
    if (a.kind === 'wave_kid' || a.child) hipLift += Math.max(0, a.hop.x) * 0.05;

    // attention on top: chest takes 20 %, neck 35 %, head 45 % of the look; pitch on neck + head
    chY += ly * 0.2; nkY += ly * 0.35; hdY += ly * 0.45;
    nkP += -lp * 0.45 + a.nod.x * 0.25; hdP += -lp * 0.55 + a.nod.x * 0.15;
    // a body turn rolls through the hips first (follow-through): small counter-yaw on the spine
    spY += -a.turn.v * 0.03;

    // ---------------------------------------------------------- write bones
    if (B.hips && R.hips) {
      addLocal(B.hips, R.hips, hipP, hipR, hipY);
      B.hips.position.copy(a.hipsPos);
      B.hips.position.y += hipLift - (standing ? Math.abs(shift) * 0.004 : 0);
    }
    if (B.spine && R.spine) addLocal(B.spine, R.spine, spP, spR, spY);
    if (B.chest && R.chest) addLocal(B.chest, R.chest, chP, chR, chY);
    if (B.neck && R.neck) addLocal(B.neck, R.neck, nkP, nkR, nkY);
    if (B.head && R.head) addLocal(B.head, R.head, hdP, hdR, hdY);
    if (a.armDown && B.upper_arm_R && B.forearm_R && R.upper_arm_R && R.forearm_R) {
      const k = THREE.MathUtils.clamp(a.waveW.x, 0, 1);
      _q.copy(a.armDown.shR).slerp(R.upper_arm_R, k);
      _qi.copy(a.armDown.elR).slerp(R.forearm_R, k);
      addLocal(B.upper_arm_R, _q, uaRP, uaRR, uaRY);
      addLocal(B.forearm_R, _qi, faRP, faRR, 0);
    } else {
      if (B.upper_arm_R && R.upper_arm_R) addLocal(B.upper_arm_R, R.upper_arm_R, uaRP, uaRR, uaRY);
      if (B.forearm_R && R.forearm_R) addLocal(B.forearm_R, R.forearm_R, faRP, faRR, 0);
    }
    if (B.upper_arm_L && R.upper_arm_L) addLocal(B.upper_arm_L, R.upper_arm_L, uaLP, uaLR, uaLY);
    if (B.forearm_L && R.forearm_L) addLocal(B.forearm_L, R.forearm_L, faLP, faLR, 0);
    if (B.hand_L && R.hand_L) addLocal(B.hand_L, R.hand_L, hdLP, 0, 0);
    if (B.hand_R && R.hand_R) addLocal(B.hand_R, R.hand_R, hdRP, 0, 0);
    if (B.thigh_L && R.thigh_L) addLocal(B.thigh_L, R.thigh_L, 0, thLR, 0);
    if (B.thigh_R && R.thigh_R) addLocal(B.thigh_R, R.thigh_R, 0, thRR, 0);
    if (B.shin_L && R.shin_L) addLocal(B.shin_L, R.shin_L, shLP, 0, 0);
    if (B.shin_R && R.shin_R) addLocal(B.shin_R, R.shin_R, shRP, 0, 0);
  }

  dispose() {
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    this.group.removeFromParent();
    this.actors = [];
    this.byName.clear();
  }
}

export function npcVec(n: Npc, out = _v2) { return out.set(n.pos[0], n.pos[1], n.pos[2]); }
