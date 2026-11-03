import * as THREE from 'three';
import { CASCADES, NC, NW, SWELL, SWELL_U, WAVES } from '../game/swell';

/**
 * Ocean pass 2 (docs/ocean_study.md): renders the swell cascades into small tiling textures every
 * frame (a sparse inverse DFT: each texel sums its cascade's lattice waves), the way Atlas / Acerola
 * run small FFTs per frequency band. Per cascade, one 64² MRT pass:
 *   D: (dx, h, dz)   horizontal + vertical displacement (Tessendorf choppy waves)
 *   S: (∂h/∂x, ∂h/∂z, Jacobian)   slopes for per-pixel normals, Jacobian for foam
 * and for cascades 0–1 a persistent foam ping-pong (Atlas: inject "turbulent energy" where the
 * Jacobian dips, fade and blur it over time; Acerola: exponential decay), drifting downwind.
 * Cost: 3 × 4096 texels × ≤ 40 waves + 2 × 4096 foam texels per frame; low quality skips cascade 2.
 */

const RES = 64;

const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const WAVE_FRAG = /* glsl */ `
precision highp float;
uniform vec4 uW[${NW}]; // kx, kz, amplitude, phase
uniform int uN;
uniform float uL;
uniform float uChop;
in vec2 vUv;
layout(location = 0) out vec4 oD;
layout(location = 1) out vec4 oS;
void main() {
  vec2 p = vUv * uL;
  float h = 0.0, dx = 0.0, dz = 0.0, sx = 0.0, sz = 0.0, jxx = 0.0, jzz = 0.0, jxz = 0.0;
  for (int i = 0; i < ${NW}; i++) {
    if (i >= uN) break;
    vec4 w = uW[i];
    if (w.z <= 0.0) continue;
    float k = length(w.xy);
    float th = dot(w.xy, p) - w.w;
    float c = cos(th), s = sin(th);
    h += w.z * c;
    dx -= uChop * (w.x / k) * w.z * s;
    dz -= uChop * (w.y / k) * w.z * s;
    sx -= w.x * w.z * s;
    sz -= w.y * w.z * s;
    float ac = w.z * c / k;
    jxx -= uChop * w.x * w.x * ac;
    jzz -= uChop * w.y * w.y * ac;
    jxz -= uChop * w.x * w.y * ac;
  }
  oD = vec4(dx, h, dz, 1.0);
  oS = vec4(sx, sz, (1.0 + jxx) * (1.0 + jzz) - jxz * jxz, 1.0);
}`;

const FOAM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uS;
uniform float uDecay;
uniform float uThr;
uniform vec2 uDrift;
in vec2 vUv;
layout(location = 0) out vec4 oF;
void main() {
  vec2 uv = vUv - uDrift;
  float t = 1.0 / ${RES}.0;
  float f = texture(uPrev, uv).r * 0.6 + (texture(uPrev, uv + vec2(t, 0.0)).r + texture(uPrev, uv - vec2(t, 0.0)).r + texture(uPrev, uv + vec2(0.0, t)).r + texture(uPrev, uv - vec2(0.0, t)).r) * 0.1;
  float J = texture(uS, vUv).b;
  float inj = clamp((uThr - J) * 6.0, 0.0, 1.0);
  oF = vec4(max(f * uDecay, inj), 0.0, 0.0, 1.0);
}`;

function rt(count: number) {
  const r = new THREE.WebGLRenderTarget(RES, RES, { count, type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
  for (const t of r.textures) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  return r;
}

export class OceanGPU {
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private waveMat: THREE.RawShaderMaterial;
  private foamMat: THREE.RawShaderMaterial;
  private casc: THREE.WebGLRenderTarget[] = [];
  private foam: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget][] = [];
  private flip = [0, 0];
  private w = Array.from({ length: NW }, () => new THREE.Vector4());
  low = false;
  /** ms of CPU time spent issuing the passes (EMA) */
  cost = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.waveMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: WAVE_FRAG, depthTest: false, depthWrite: false,
      uniforms: { uW: { value: this.w }, uN: { value: 0 }, uL: { value: 1 }, uChop: { value: 0.6 } },
    });
    this.foamMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FOAM_FRAG, depthTest: false, depthWrite: false,
      uniforms: { uPrev: { value: null }, uS: { value: null }, uDecay: { value: 0.98 }, uThr: { value: 0 }, uDrift: { value: new THREE.Vector2() } },
    });
    this.quad = new THREE.Mesh(g, this.waveMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    for (let c = 0; c < NC; c++) this.casc.push(rt(2));
    for (let c = 0; c < 2; c++) this.foam.push([rt(1), rt(1)]);
    const U = SWELL_U;
    U.uSwD0.value = this.casc[0].textures[0]; U.uSwS0.value = this.casc[0].textures[1];
    U.uSwD1.value = this.casc[1].textures[0]; U.uSwS1.value = this.casc[1].textures[1];
    U.uSwS2.value = this.casc[2].textures[1];
    U.uSwF0.value = this.foam[0][0].texture; U.uSwF1.value = this.foam[1][0].texture;
  }

  /** Per frame, after updateSwell(). Skipped (cheaply) when the swell is off. */
  render(renderer: THREE.WebGLRenderer, dt: number, wind: THREE.Vector2) {
    if (!SWELL.on || !WAVES.length) return;
    const t0 = performance.now();
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
    renderer.autoClear = false;
    const u = this.waveMat.uniforms;
    u.uChop.value = SWELL.chop;
    const nc = this.low ? 2 : NC;
    for (let c = 0; c < nc; c++) {
      const ws = WAVES[c];
      for (let i = 0; i < NW; i++) { const w = ws[i]; if (w) this.w[i].set(w.kx, w.kz, w.a, w.ph); else this.w[i].set(1, 0, 0, 0); }
      u.uN.value = ws.length;
      u.uL.value = CASCADES[c].L;
      this.quad.material = this.waveMat;
      renderer.setRenderTarget(this.casc[c]);
      renderer.render(this.scene, this.cam);
    }
    SWELL_U.uSwDetail.value = this.low ? 0 : 1;
    // persistent foam: decay to 1/e over foamDecay s, drift slowly downwind (0.35 m/s)
    const fu = this.foamMat.uniforms;
    fu.uDecay.value = Math.exp(-dt / 1.6);
    // one cascade's Jacobian swings less than the sum: its threshold sits closer to 1
    fu.uThr.value = 1 - (1 - SWELL.foamJ) * 0.75;
    for (let c = 0; c < 2; c++) {
      const [a, b] = this.foam[c], src = this.flip[c] ? b : a, dst = this.flip[c] ? a : b;
      fu.uPrev.value = src.texture;
      fu.uS.value = this.casc[c].textures[1];
      fu.uDrift.value.set(wind.x, wind.y).multiplyScalar((0.35 * dt) / CASCADES[c].L);
      this.quad.material = this.foamMat;
      renderer.setRenderTarget(dst);
      renderer.render(this.scene, this.cam);
      this.flip[c] ^= 1;
      (c === 0 ? SWELL_U.uSwF0 : SWELL_U.uSwF1).value = dst.texture;
    }
    renderer.setRenderTarget(prev);
    renderer.autoClear = auto;
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }
}
