import * as THREE from 'three';

/**
 * Catch victory FX (docs/catch_study.md): a sparkle burst around the held fish (four-point paper-gold
 * stars that pop and twinkle), Logbook-colour paper confetti for rare+ (cream, ochre red, teal, kelp,
 * gold — tumbling scraps, not glitter) and, for legendary fish only, a soft fan of gold rays behind the
 * fish (Zelda's item-get light). Three instanced draws at most, all hidden when idle.
 */
const MAX_SPARK = 56;
const MAX_CONF = 120;
const CONF_COLORS = ['#FBF6EA', '#F4EFE3', '#D0563E', '#4E9096', '#7FA06A', '#E0C47A', '#F0D9A8'].map((c) => new THREE.Color(c).convertSRGBToLinear());

function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(32, 32);
  // soft halo + a four-point star with concave sides (the Animal Crossing "shine")
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  halo.addColorStop(0, 'rgba(255,248,220,0.35)');
  halo.addColorStop(1, 'rgba(255,248,220,0)');
  g.fillStyle = halo;
  g.fillRect(-32, -32, 64, 64);
  g.fillStyle = '#FFF8E2';
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    g.lineTo(Math.cos(a) * 30, Math.sin(a) * 30);
    g.quadraticCurveTo(0, 0, Math.cos(a + Math.PI / 2) * 30, Math.sin(a + Math.PI / 2) * 30);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function raysTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 128);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, w = (Math.PI / n) * (i % 2 ? 0.45 : 0.7);
    const grd = g.createRadialGradient(0, 0, 8, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,240,190,0.85)');
    grd.addColorStop(0.55, 'rgba(240,210,140,0.35)');
    grd.addColorStop(1, 'rgba(240,210,140,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 128, a - w / 2, a + w / 2);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Spark { p: THREE.Vector3; v: THREE.Vector3; t: number; life: number; size: number; spin: number; delay: number }
interface Scrap { p: THREE.Vector3; v: THREE.Vector3; t: number; life: number; rot: THREE.Euler; w: THREE.Vector3; size: number; ci: number }

export class CatchFX {
  readonly group = new THREE.Group();
  private sparks: Spark[] = [];
  private scraps: Scrap[] = [];
  private sparkMesh: THREE.InstancedMesh;
  private confMesh: THREE.InstancedMesh;
  private rays: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private raysK = 0;
  private raysOn = false;
  private raysSpin = 0;
  /** world point the rays / twinkles follow (the held fish) */
  readonly anchor = new THREE.Vector3();
  private twinkle = 0; // twinkles per second around the fish during the hold
  private twinkleAcc = 0;
  private twinkleR = 0.5;
  private scale = 1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private q2 = new THREE.Quaternion();
  private zAxis = new THREE.Vector3(0, 0, 1);
  private camQ = new THREE.Quaternion();
  /** reduced motion: no confetti fall, rays don't turn */
  calm = false;
  stats = { sparks: 0, scraps: 0 };

  constructor() {
    const sm = new THREE.MeshBasicMaterial({ map: starTexture(), transparent: true, depthWrite: false, toneMapped: false, fog: false });
    this.sparkMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), sm, MAX_SPARK);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.renderOrder = 5;
    const cm = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.confMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.62), cm, MAX_CONF);
    this.confMesh.frustumCulled = false;
    for (let i = 0; i < MAX_CONF; i++) this.confMesh.setColorAt(i, CONF_COLORS[i % CONF_COLORS.length]);
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: raysTexture(), transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0 }));
    this.rays.renderOrder = -1;
    this.group.add(this.rays, this.sparkMesh, this.confMesh);
    this.sparkMesh.count = 0;
    this.confMesh.count = 0;
    this.rays.visible = false;
    this.group.visible = false;
  }

  /** Star burst from `at`: `n` stars thrown outward (radius r m/s), plus a twinkle rate for the hold. */
  burst(at: THREE.Vector3, n: number, r = 1.6, twinkle = 0, twinkleR = 0.5, scale = 1) {
    this.scale = scale;
    this.anchor.copy(at);
    this.twinkle = twinkle;
    this.twinkleR = twinkleR;
    for (let i = 0; i < n && this.sparks.length < MAX_SPARK; i++) {
      const a = Math.random() * Math.PI * 2, el = (Math.random() - 0.3) * 1.2, sp = r * (0.5 + Math.random() * 0.7);
      this.sparks.push({
        p: at.clone(), v: new THREE.Vector3(Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + 0.6, Math.sin(a) * Math.cos(el) * sp),
        t: 0, life: 0.55 + Math.random() * 0.45, size: (0.06 + Math.random() * 0.08) * this.scale, spin: (Math.random() - 0.5) * 6, delay: Math.random() * 0.08,
      });
    }
    this.group.visible = true;
  }

  /** Paper confetti thrown up from `at` (above the skipper's head). */
  confetti(at: THREE.Vector3, n: number, spread = 1.2) {
    if (this.calm) return;
    for (let i = 0; i < n && this.scraps.length < MAX_CONF; i++) {
      const a = Math.random() * Math.PI * 2, sp = spread * (0.4 + Math.random());
      this.scraps.push({
        p: at.clone().add(this.s.set((Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4)),
        v: new THREE.Vector3(Math.cos(a) * sp, 2.6 + Math.random() * 2.2, Math.sin(a) * sp),
        t: -Math.random() * 0.25, life: 2.4 + Math.random() * 1.2,
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14),
        size: 0.06 + Math.random() * 0.05, ci: Math.floor(Math.random() * CONF_COLORS.length),
      });
    }
    this.group.visible = true;
  }

  /** Legendary: rays behind the fish (fade in), until stop(). */
  raysOnAt(at: THREE.Vector3) { this.anchor.copy(at); this.raysOn = true; this.rays.visible = true; this.group.visible = true; }

  /** Fade everything that lingers (twinkles, rays); in-flight sparks/scraps finish. */
  stop() { this.twinkle = 0; this.raysOn = false; }
  clear() { this.stop(); this.sparks.length = 0; this.scraps.length = 0; this.raysK = 0; }

  update(dt: number, cam: THREE.Camera, anchor?: THREE.Vector3 | null) {
    if (!this.group.visible) return;
    if (anchor) this.anchor.copy(anchor);
    cam.getWorldQuaternion(this.camQ);
    // twinkles: single stars blinking around the held fish
    if (this.twinkle > 0) {
      this.twinkleAcc += dt * this.twinkle;
      while (this.twinkleAcc >= 1 && this.sparks.length < MAX_SPARK) {
        this.twinkleAcc--;
        const a = Math.random() * Math.PI * 2, rr = this.twinkleR * (0.5 + Math.random() * 0.6);
        this.sparks.push({ p: this.anchor.clone().add(this.s.set(Math.cos(a) * rr, (Math.random() - 0.4) * rr * 0.8, Math.sin(a) * rr)), v: new THREE.Vector3(0, 0.15, 0), t: 0, life: 0.5 + Math.random() * 0.3, size: (0.06 + Math.random() * 0.07) * this.scale, spin: 2, delay: 0 });
      }
    }
    // sparks: pop in, spin, shrink out; drag so the burst hangs in the air
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t >= s.life + s.delay) { this.sparks.splice(i, 1); continue; }
      const k = Math.max(0, s.t - s.delay) / s.life;
      s.p.addScaledVector(s.v, dt);
      s.v.multiplyScalar(Math.exp(-dt * 4));
      const sc = s.size * (k < 0.2 ? k / 0.2 * 1.25 : 1.25 - 0.25 * ((k - 0.2) / 0.8)) * (1 - Math.pow(k, 3));
      this.q.copy(this.camQ).multiply(this.q2.setFromAxisAngle(this.zAxis, s.spin * s.t));
      this.m.compose(s.p, this.q, this.s.set(sc, sc, sc));
      this.sparkMesh.setMatrixAt(n++, this.m);
    }
    this.sparkMesh.count = n;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    // confetti: up, tumble, fall slow (paper drag), flutter sideways
    let c = 0;
    for (let i = this.scraps.length - 1; i >= 0; i--) {
      const s = this.scraps[i];
      s.t += dt;
      if (s.t < 0) continue;
      if (s.t >= s.life) { this.scraps.splice(i, 1); continue; }
      s.v.y -= 6.5 * dt;
      s.v.multiplyScalar(Math.exp(-dt * (s.v.y < 0 ? 2.6 : 0.9)));
      s.p.addScaledVector(s.v, dt);
      s.p.x += Math.sin(s.t * 7 + s.rot.x) * 0.25 * dt;
      s.rot.set(s.rot.x + s.w.x * dt, s.rot.y + s.w.y * dt, s.rot.z + s.w.z * dt);
      const fade = s.t > s.life - 0.4 ? (s.life - s.t) / 0.4 : 1;
      this.m.compose(s.p, this.q.setFromEuler(s.rot), this.s.set(s.size * fade, s.size * fade, s.size * fade));
      this.confMesh.setColorAt(c, CONF_COLORS[s.ci]);
      this.confMesh.setMatrixAt(c++, this.m);
    }
    this.confMesh.count = c;
    this.confMesh.instanceMatrix.needsUpdate = true;
    if (this.confMesh.instanceColor) this.confMesh.instanceColor.needsUpdate = true;
    // rays
    this.raysK += ((this.raysOn ? 1 : 0) - this.raysK) * Math.min(1, dt * (this.raysOn ? 2.2 : 3.5));
    if (this.rays.visible) {
      this.raysSpin += dt * (this.calm ? 0 : 0.25);
      this.rays.position.copy(this.anchor);
      this.rays.quaternion.copy(this.camQ).multiply(this.q.setFromAxisAngle(this.s.set(0, 0, 1), this.raysSpin));
      // behind the fish: pushed away from the camera a little
      this.rays.position.add(this.s.set(0, 0, -1).applyQuaternion(this.camQ).multiplyScalar(0.6));
      const sc = 3.2 + 0.4 * Math.sin(this.raysSpin * 3);
      this.rays.scale.set(sc, sc, 1);
      this.rays.material.opacity = 0.55 * this.raysK;
      if (!this.raysOn && this.raysK < 0.01) this.rays.visible = false;
    }
    this.stats.sparks = n; this.stats.scraps = c;
    if (!n && !c && !this.rays.visible && !this.twinkle) this.group.visible = false;
  }
}
