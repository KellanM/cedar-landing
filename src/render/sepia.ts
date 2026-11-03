import * as THREE from 'three';

/**
 * Title screen only (docs/sepia_title_study.md): the live harbour drawn as a sepia pen-and-wash
 * sketch on the Logbook paper, and on "Tap to set out" colour wicks out from the boat across the
 * world until the frame is the normal game look, then the pass switches itself off and frees its
 * render target (zero cost after hand-off).
 *
 * One fullscreen pass over the scene rendered into a target with a depth texture:
 *  - wash: luminance posterised to 4 soft steps on a paper → sepia ramp, granulated by the paper
 *    grain; distance fades to paper (period aerial perspective: the sky and far islands are paper);
 *  - ink: depth silhouettes + creases (as the old outline pass, without material ink classes),
 *    tapered and faded with distance so the near boat is the drawn hero;
 *  - strokes: level surfaces (the sea) get broken horizontal engraver's lines, denser in the darks;
 *    upright ones a 45° hatch in the darks only;
 *  - paper: screen-anchored grain + fibres (paper doesn't move with the camera), wash stopping short
 *    of the plate edge;
 *  - bloom: colour front grows from the boat in view-space distance (log scale), with an irregular
 *    noise edge and a darker wet rim; ink and grain go as the colour arrives.
 */
export const SEPIA = {
  /** bloom length, s (the camera swing is 1.8 s) */
  bloom: 2.2,
  /** reduced motion: plain crossfade, s */
  fade: 0.8,
  /** line width, CSS px */
  width: 1.6,
  ink: 0.9,
  /** m: ink full up to fadeNear, gone by fadeFar */
  inkNear: 30, inkFar: 260,
  /** m: wash fades toward paper (aerial perspective) */
  airNear: 70, airFar: 650, air: 0.72,
  crease: 34, silhouette: 0.04,
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uPx;
uniform float uWidth;
uniform float uNear;
uniform float uFar;
uniform vec2 uTan;      // tan(fov/2) * aspect, tan(fov/2)
uniform vec3 uUp;       // world up in view space
uniform vec3 uBoat;     // boat (deck) in view space
uniform float uFront;   // bloom front, log2(1 + d / 2.5) units; < -2 = all drawing
uniform float uFlat;    // reduced motion crossfade 0..1 (used when uFront < -50)
uniform float uLate;    // 0..1 global fade of ink / grain at the end of the bloom
uniform vec4 uPlate;
uniform float uEdge;    // 1 = the wash stops short of the plate edge (0 once the mount lifts)    // plate rect in device px (x0, y0, x1, y1), GL origin bottom-left
uniform float uInk;
uniform vec2 uInkFade;
uniform vec3 uAir;      // near, far, amount
uniform float uCrease;
uniform float uSil;
uniform float uPixAng;
varying vec2 vUv;

const vec3 PAPER = vec3(0.957, 0.937, 0.890);   // --paper #F4EFE3
const vec3 WASH1 = vec3(0.855, 0.776, 0.643);
const vec3 WASH2 = vec3(0.643, 0.510, 0.365);
const vec3 WASH3 = vec3(0.373, 0.271, 0.192);
const vec3 INK   = vec3(0.200, 0.145, 0.110);

// paper noise, 256 px tile (built once on the CPU): r fine grain, g horizontal fibres,
// b medium (~16 px), a coarse lobes (~48 px)
uniform sampler2D tPaper;
vec4 paper(vec2 cssPx) { return texture2D(tPaper, cssPx / 256.0); }

float dist(float d) { return -perspectiveDepthToViewZ(d, uNear, uFar); }
vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTan * z, -z); }
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

void main() {
  vec4 c = texture2D(tColor, vUv);
  vec3 col = c.rgb;                       // linear
  vec3 s = toSrgb(col);
  float d0 = texture2D(tDepth, vUv).r;
  bool sky = d0 >= 0.99999;
  float z0 = sky ? 1e5 : dist(d0);
  vec2 css = gl_FragCoord.xy / uPx;       // CSS px, screen-anchored

  // ---- bloom mask (1 = colour has arrived)
  float k;
  float rim = 0.0;
  if (uFront < -50.0) k = uFlat;
  else {
    float dB = sky ? 4000.0 : length(viewPos(vUv, z0) - uBoat);
    float sB = log2(1.0 + dB / 2.5);
    // paper wicking: an irregular edge, coarse lobes + fine fibre
    float n = (paper(css * 0.8).a - 0.5) * 1.7 + (paper(css * 1.7).b - 0.5) * 0.5;
    float e = uFront - (sB + n);
    k = smoothstep(-0.05, 0.35, e);
    rim = k * (1.0 - smoothstep(0.0, 0.9, e));
  }

  // ---- paper
  vec4 pp = paper(css);
  float grain = pp.r * 0.6 + pp.g * 0.4;                                  // speckle + horizontal fibres
  float blot = paper(css * 0.3 + 91.0).a;

  // ---- wash: 4 soft steps, granulated
  float l = dot(s, vec3(0.299, 0.587, 0.114));
  l = clamp((l - 0.03) / 0.55, 0.0, 1.0);    // lifted: the sea sits in the light wash, darks stay dark
  float air = sky ? 1.0 : smoothstep(uAir.x, uAir.y, z0) * uAir.z;
  float f = clamp(l + (grain - 0.5) * 0.1 + (blot - 0.5) * 0.08, 0.0, 1.0) * 3.0;
  float q = (floor(f) + smoothstep(0.38, 0.62, fract(f))) / 3.0;
  q = mix(q, 1.0, air);
  // Kaguya: the wash stops short of the plate edge, ragged
  vec2 fc = gl_FragCoord.xy;
  float edge = min(min(fc.x - uPlate.x, uPlate.z - fc.x), min(fc.y - uPlate.y, uPlate.w - fc.y)) / uPx;
  q = mix(q, mix(1.0, q, smoothstep(4.0, 26.0, edge + (pp.b - 0.5) * 30.0)), uEdge);
  vec3 wash = q > 0.666 ? mix(WASH1, PAPER, (q - 0.666) * 3.0) : q > 0.333 ? mix(WASH2, WASH1, (q - 0.333) * 3.0) : mix(WASH3, WASH2, q * 3.0);

  // ---- ink: silhouettes + creases from depth
  float ink = 0.0, hatch = 0.0;
  if (!sky) {
    float fade = 1.0 - smoothstep(uInkFade.x, uInkFade.y, z0);
    float w = max(1.0, uWidth * mix(1.15, 0.5, smoothstep(6.0, uInkFade.y, z0)));
    vec3 P = viewPos(vUv, z0);
    vec3 nrm = vec3(0.0, 0.0, 1.0);
    if (fade > 0.01) {
      float sil = 0.0, cr = 0.0;
      #if AXES == 4
      vec2 dirs[4] = vec2[4](vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.7071, 0.7071), vec2(0.7071, -0.7071));
      #else
      vec2 dirs[2] = vec2[2](vec2(1.0, 0.0), vec2(0.0, 1.0));
      #endif
      for (int i = 0; i < AXES; i++) {
        vec2 o = dirs[i] * uTexel * w;
        float za = dist(texture2D(tDepth, vUv - o).r), zb = dist(texture2D(tDepth, vUv + o).r);
        float L = z0 / za + z0 / zb - 2.0;
        sil = max(sil, smoothstep(uSil, uSil * 2.0, -L));
        if (abs(L) < uSil) {
          float sl = z0 * uPixAng * w * length(dirs[i]);
          float ta = atan((z0 - za) / sl), tb = atan((zb - z0) / sl);
          cr = max(cr, smoothstep(uCrease, uCrease * 1.3, abs(tb - ta)));
        }
      }
      float crFade = 1.0 - smoothstep(uInkFade.x * 0.4, uInkFade.y * 0.45, z0);
      // a slightly broken pen line: pressure varies along the stroke
      float press = 0.7 + 0.3 * paper(css * 3.0 + 17.0).b;
      ink = max(sil, cr * crFade) * fade * press;
    }
    // surface normal from the depth neighbours (for the hatch direction)
    vec3 px = viewPos(vUv + vec2(uTexel.x, 0.0), dist(texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).r)) - P;
    vec3 py = viewPos(vUv + vec2(0.0, uTexel.y), dist(texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).r)) - P;
    nrm = normalize(cross(px, py));
    float level = smoothstep(0.75, 0.92, abs(dot(nrm, uUp)));
    // ---- strokes. Level surfaces (the sea, decks): broken, wavering horizontal engraver's lines,
    // denser where the tone is darker; upright ones: a 45° hatch in the darks only
    float near = 1.0 - smoothstep(20.0, 150.0, z0);
    float tone = 1.0 - q;
    if (near > 0.01) {
      float y = css.y + 1.6 * sin(css.x * 0.04 + paper(css * 0.6 + 33.0).a * 6.0);
      float row = floor(y / 5.0);
      float hl = 1.0 - smoothstep(0.25, 0.75, abs(fract(y / 5.0) - 0.5) * 4.0);
      float dash = step(0.7 - 0.5 * tone, paper(vec2(css.x * 0.55 + row * 37.0, row * 23.0)).b);
      float hz = hl * dash * level * 0.42;
      float dg = (css.x + css.y) / 4.5;
      float hd = (1.0 - smoothstep(0.3, 0.8, abs(fract(dg) - 0.5) * 4.0)) * (1.0 - level) * (1.0 - smoothstep(0.2, 0.5, q)) * 0.5;
      hatch = max(hz, hd) * near;
    }
  }

  vec3 drawing = wash;
  drawing = mix(drawing, INK, clamp(hatch, 0.0, 1.0) * 0.75);
  drawing = mix(drawing, INK, clamp(ink * uInk, 0.0, 1.0));
  drawing *= 0.962 + 0.05 * grain;                                  // tooth of the paper

  // ---- colour arrives: watercolour over the drawing, darker where the wash is still wet; the
  // last of the ink and the paper tooth lift off over the end of the bloom
  vec3 colS = s * (1.0 - 0.16 * rim);
  vec3 wet = mix(colS, INK, clamp(ink * uInk, 0.0, 1.0) * 0.55) * (0.975 + 0.04 * grain);
  vec3 outS = mix(drawing, mix(wet, s, uLate), k);
  gl_FragColor = vec4(toLin(outS), 1.0);
  #include <colorspace_fragment>
}`;

/** Tileable value-noise fbm, 256², four channels (see the shader's paper()). */
function paperTexture() {
  const N = 256;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const layer = (cx: number, cy: number) => {
    const g = new Float32Array(cx * cy).map(rnd);
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * cx, fy = (y / N) * cy, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = g[iy * cx + ix], b = g[iy * cx + ((ix + 1) % cx)], c = g[((iy + 1) % cy) * cx + ix], d = g[((iy + 1) % cy) * cx + ((ix + 1) % cx)];
      out[y * N + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
    return out;
  };
  const mixL = (ls: [Float32Array, number][]) => { const o = new Float32Array(N * N); for (const [l, w] of ls) for (let i = 0; i < o.length; i++) o[i] += l[i] * w; return o; };
  const r = mixL([[layer(128, 128), 0.6], [layer(64, 64), 0.4]]);
  const g = mixL([[layer(16, 96), 0.7], [layer(32, 128), 0.3]]);
  const b = mixL([[layer(16, 16), 0.6], [layer(32, 32), 0.4]]);
  const a = mixL([[layer(5, 5), 0.6], [layer(10, 10), 0.4]]);
  const data = new Uint8Array(N * N * 4);
  // stretch each channel to the full range (fbm bunches up around 0.5)
  const ch = [r, g, b, a].map((c) => { let lo = 1, hi = 0; for (const v of c) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return { c, lo, k: 1 / Math.max(1e-3, hi - lo) }; });
  for (let i = 0; i < N * N; i++) for (let j = 0; j < 4; j++) data[i * 4 + j] = Math.round((ch[j].c[i] - ch[j].lo) * ch[j].k * 255);
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class SepiaTitle {
  private paperTex: THREE.DataTexture | null = null;
  private rt: THREE.WebGLRenderTarget | null = null;
  private mat: THREE.ShaderMaterial;
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();
  private low = false;
  private v = new THREE.Vector3();
  /** 'off' | 'drawn' (title up) | 'bloom' (hand-off running) */
  state: 'off' | 'drawn' | 'bloom' = 'off';
  private t = 0;
  private reduced = false;
  /** plate rect in CSS px (left, top, right, bottom) */
  plate = { l: 0, t: 0, r: 1e5, b: 1e5 };
  /** ms of the last pass (CPU submit only) */
  lastMs = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, defines: { AXES: 4 },
      uniforms: {
        tColor: { value: null }, tPaper: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uPx: { value: 1 },
        uWidth: { value: 1.6 }, uNear: { value: 0.3 }, uFar: { value: 1000 }, uTan: { value: new THREE.Vector2(1, 1) },
        uUp: { value: new THREE.Vector3(0, 1, 0) }, uBoat: { value: new THREE.Vector3() }, uFront: { value: -100 }, uFlat: { value: 0 },
        uLate: { value: 0 }, uEdge: { value: 1 }, uPlate: { value: new THREE.Vector4(0, 0, 1e5, 1e5) }, uInk: { value: 0.9 },
        uInkFade: { value: new THREE.Vector2(30, 260) }, uAir: { value: new THREE.Vector3(70, 650, 0.7) },
        uCrease: { value: 0.6 }, uSil: { value: 0.04 }, uPixAng: { value: 0.001 },
      },
      depthTest: false, depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const q = new THREE.Mesh(tri, this.mat);
    q.frustumCulled = false;
    this.fsScene.add(q);
  }

  setQuality(q: 'high' | 'low') {
    this.low = q === 'low';
    const axes = this.low ? 2 : 4;
    if (this.mat.defines.AXES !== axes) { this.mat.defines.AXES = axes; this.mat.needsUpdate = true; }
    this.rt?.dispose(); this.rt = null;
  }

  get active() { return this.state !== 'off'; }

  /** Title up: the world is a drawing. */
  begin() { this.state = 'drawn'; this.t = 0; }
  /** "Tap to set out": colour blooms from the boat (or a plain crossfade with reduced motion). */
  bloom(reduced: boolean) { if (this.state === 'off') return; this.state = 'bloom'; this.t = 0; this.reduced = reduced; }
  /** Straight to the game look and free everything (quick path, or the end of the bloom). */
  off() {
    this.state = 'off';
    this.rt?.dispose(); this.rt = null;
    this.paperTex?.dispose(); this.paperTex = null;
  }
  /** bloom progress 0..1 (debug / captures) */
  get progress() { return this.state === 'bloom' ? Math.min(1, this.t / (this.reduced ? SEPIA.fade : SEPIA.bloom)) : this.state === 'drawn' ? 0 : 1; }

  update(dt: number) {
    if (this.state !== 'bloom') return;
    this.t += dt;
    if (this.t >= (this.reduced ? SEPIA.fade : SEPIA.bloom)) this.off();
  }

  /** Renders the frame through the pass. Returns false when off (caller renders normally). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, boat: THREE.Vector3) {
    if (this.state === 'off') return false;
    const t0 = performance.now();
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      const dt = new THREE.DepthTexture(w, h);
      dt.type = THREE.UnsignedIntType;
      this.rt = new THREE.WebGLRenderTarget(w, h, { samples: this.low ? 0 : 4, depthTexture: dt, depthBuffer: true });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const pr = renderer.getPixelRatio();
    const u = this.mat.uniforms;
    if (!this.paperTex) this.paperTex = paperTexture();
    u.tPaper.value = this.paperTex;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uPx.value = pr;
    u.uWidth.value = SEPIA.width * pr;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    u.uTan.value.set(th * camera.aspect, th);
    u.uPixAng.value = THREE.MathUtils.degToRad(camera.fov) / h;
    u.uInk.value = SEPIA.ink;
    u.uInkFade.value.set(SEPIA.inkNear, SEPIA.inkFar);
    u.uAir.value.set(SEPIA.airNear, SEPIA.airFar, SEPIA.air);
    u.uCrease.value = THREE.MathUtils.degToRad(SEPIA.crease);
    u.uSil.value = SEPIA.silhouette;
    camera.updateMatrixWorld();
    (u.uUp.value as THREE.Vector3).set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    (u.uBoat.value as THREE.Vector3).copy(this.v.set(boat.x, boat.y + 1.2, boat.z).applyMatrix4(camera.matrixWorldInverse));
    const p = this.plate;
    // CSS rect (top-left origin) → device px, GL origin bottom-left
    const ch = h / pr;
    u.uPlate.value.set(p.l * pr, (ch - p.b) * pr, p.r * pr, (ch - p.t) * pr);
    // timeline
    const k = this.progress;
    // the ragged plate edge goes as the mount lifts (the paper margin fades over ~0.7 s)
    u.uEdge.value = this.state === 'drawn' ? 1 : 1 - THREE.MathUtils.smoothstep(k, 0, this.reduced ? 0.5 : 0.25);
    if (this.state === 'drawn') { u.uFront.value = -3; u.uFlat.value = 0; u.uLate.value = 0; }
    else if (this.reduced) { u.uFront.value = -100; u.uFlat.value = k * k * (3 - 2 * k); u.uLate.value = k; }
    else {
      // boat first (log distance: the near field takes most of the time), the sky last
      u.uFront.value = -0.3 + 13.3 * Math.pow(k, 1.15);
      u.uLate.value = THREE.MathUtils.smoothstep(k, 0.55, 1);
    }

    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.fsScene, this.fsCam);
    renderer.autoClear = ac;
    this.lastMs = performance.now() - t0;
    return true;
  }
}
