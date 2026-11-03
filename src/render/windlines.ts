import * as THREE from 'three';

/**
 * Wind swooshes (docs/water_study.md item 6): a few thin off-white lines that draw themselves
 * through the air downwind, curl into a small loop at the end and wipe away, Wind Waker style,
 * kept sparse (at most MAX at once, one every few seconds). One ribbon mesh, one draw call,
 * camera-facing, rebuilt on the CPU for the live lines only. Off with reduced motion.
 */
const MAX = 3;
const SEG = 28;
const LIFE = 2.6; // s per line

interface Line { age: number; p: THREE.Vector3; dir: THREE.Vector2; len: number; curl: number; side: number; live: boolean }

export class WindLines {
  mesh: THREE.Mesh;
  /** 0 = none, 1 = full (from the time of day) */
  amount = 1;
  /** spawn rate multiplier (storms) */
  rate = 1;
  enabled = true;
  private lines: Line[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  private timer = 1.5;
  private mat: THREE.ShaderMaterial;
  private pts: THREE.Vector3[] = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  private tng = new THREE.Vector3();

  constructor() {
    const verts = MAX * (SEG + 1) * 2;
    this.pos = new Float32Array(verts * 3);
    this.alpha = new Float32Array(verts);
    const idx: number[] = [];
    for (let l = 0; l < MAX; l++) for (let k = 0; k < SEG; k++) {
      const a = (l * (SEG + 1) + k) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0xf2f4f0) }, uOpacity: { value: 0.7 } }]),
      vertexShader: /* glsl */ `attribute float aAlpha; varying float vA;
        #include <fog_pars_vertex>
        void main() { vA = aAlpha; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying float vA;
        #include <fog_pars_fragment>
        void main() { gl_FragColor = vec4(uColor, vA * uOpacity);
        #include <colorspace_fragment>
        #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'wind_lines';
    for (let i = 0; i < MAX; i++) this.lines.push({ age: 0, p: new THREE.Vector3(), dir: new THREE.Vector2(), len: 0, curl: 0, side: 1, live: false });
  }

  setTOD(key: string, haze: THREE.Color) {
    const k = key.toLowerCase();
    this.amount = /fog|mist/.test(k) ? 0 : /night/.test(k) ? 0.45 : /overcast/.test(k) ? 0.75 : 1;
    (this.mat.uniforms.uColor.value as THREE.Color).set(0xf2f4f0).lerp(haze, /night/.test(k) ? 0.6 : 0.15);
  }

  update(dt: number, cam: THREE.Camera, wind: THREE.Vector2) {
    const on = this.enabled && this.amount > 0;
    this.timer -= dt;
    if (on && this.timer <= 0) {
      this.timer = (2.5 + Math.random() * 3.5) / this.rate;
      const l = this.lines.find((x) => !x.live);
      if (l) this.spawn(l, cam, wind);
    }
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const l = this.lines[i];
      if (l.live) { l.age += dt; if (l.age > LIFE || !on) l.live = false; }
      this.build(i, l, cam);
      any ||= l.live;
    }
    this.mesh.visible = any;
    if (any) {
      this.mesh.geometry.attributes.position.needsUpdate = true;
      (this.mesh.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
      this.mat.uniforms.uOpacity.value = 0.7 * this.amount;
    }
  }

  private spawn(l: Line, cam: THREE.Camera, wind: THREE.Vector2) {
    cam.getWorldDirection(this.v);
    const yaw = Math.atan2(this.v.x, this.v.z) + (Math.random() - 0.5) * 1.1;
    const d = 14 + Math.random() * 26;
    l.p.set(cam.position.x + Math.sin(yaw) * d, 2 + Math.random() * 5, cam.position.z + Math.cos(yaw) * d);
    // start upwind of the spawn point so the line crosses it
    l.len = 9 + Math.random() * 7;
    l.dir.copy(wind).normalize();
    l.p.x -= l.dir.x * l.len * 0.5; l.p.z -= l.dir.y * l.len * 0.5;
    l.curl = 0.8 + Math.random() * 0.5;
    l.side = Math.random() < 0.5 ? -1 : 1;
    l.age = 0;
    l.live = true;
  }

  private build(i: number, l: Line, cam: THREE.Camera) {
    const base = i * (SEG + 1) * 2;
    if (!l.live) { for (let k = 0; k <= SEG; k++) { this.alpha[base + k * 2] = 0; this.alpha[base + k * 2 + 1] = 0; } return; }
    // path: a gentle S downwind that turns into a small loop at the end
    const step = l.len / SEG;
    let x = l.p.x, z = l.p.z, h = Math.atan2(l.dir.x, l.dir.y);
    for (let k = 0; k <= SEG; k++) {
      const s = k / SEG;
      const y = l.p.y + Math.sin(s * Math.PI * 1.3) * 0.5;
      this.pts[k].set(x, y, z);
      const turn = Math.sin(s * Math.PI * 2) * 0.05 + l.side * l.curl * Math.pow(Math.max(0, s - 0.6) / 0.4, 1.6) * 0.75;
      h += turn;
      x += Math.sin(h) * step * (1 - 0.55 * Math.max(0, s - 0.6));
      z += Math.cos(h) * step * (1 - 0.55 * Math.max(0, s - 0.6));
    }
    // reveal: the head draws ahead, the tail wipes after it
    const t = l.age / LIFE;
    const head = Math.min(1, t * 1.7), tail = Math.max(0, t * 1.7 - 0.7);
    for (let k = 0; k <= SEG; k++) {
      const s = k / SEG;
      const a = this.pts[Math.max(0, k - 1)], b = this.pts[Math.min(SEG, k + 1)];
      this.tng.subVectors(b, a).normalize();
      this.v.subVectors(cam.position, this.pts[k]).normalize();
      this.n.crossVectors(this.tng, this.v).normalize();
      const inside = s >= tail && s <= head;
      const span = Math.max(1e-3, head - tail);
      const u = (s - tail) / span;
      const w = inside ? 0.06 * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) + 0.012 : 0;
      const p = this.pts[k];
      const o = (base + k * 2) * 3;
      this.pos[o] = p.x - this.n.x * w; this.pos[o + 1] = p.y - this.n.y * w; this.pos[o + 2] = p.z - this.n.z * w;
      this.pos[o + 3] = p.x + this.n.x * w; this.pos[o + 4] = p.y + this.n.y * w; this.pos[o + 5] = p.z + this.n.z * w;
      const al = inside ? 1 : 0;
      this.alpha[base + k * 2] = al; this.alpha[base + k * 2 + 1] = al;
    }
  }
}
