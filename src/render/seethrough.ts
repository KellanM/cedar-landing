import * as THREE from 'three';

/**
 * See-through cut-out (docs/camera_study.md F4): anything that sits between the camera and the
 * subject (piers, pilings, eaves, roofs, walls, scrub) is dithered away inside a soft circle around
 * the subject on screen, instead of the camera pushing in. Wind Waker fades its sail; Sneaky
 * Sasquatch cuts its roofs away. Works on the merged export chunks (no per-object fading needed):
 * the test is per fragment, "nearer than the subject and inside the circle".
 *
 * The world materials (lighting.ts addSunShading) include SEE_GLSL; the boat and characters opt out
 * (setSeeThrough(m, false)) so the subject itself never dithers.
 */
export const SEE_U = {
  /** xy: circle centre (drawing-buffer px), z: radius (px, 0 = off), w: subject view depth (m) */
  uSee: { value: new THREE.Vector4(0, 0, 0, 0) },
};

export const SEE_GLSL_HEAD = `uniform vec4 uSee;
uniform float uSeeMat;
float seeBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
// 4x4 ordered dither, 0..1 (a soft screen-door: reads as transparency at phone pixel density)
float seeBayer(vec2 p) { return seeBayer2(0.5 * p) * 0.25 + seeBayer2(p); }
`;

/** Fragment test; needs the view-space position varying (vSunViewPos). */
export const SEE_GLSL = `
  if (uSeeMat > 0.5 && uSee.z > 0.0) {
    float sdz = -vSunViewPos.z;
    float gap = uSee.w - sdz; // > 0: this fragment is nearer than the subject
    if (gap > 0.9) {
      float r = length(gl_FragCoord.xy - uSee.xy) / uSee.z;
      float a = (1.0 - smoothstep(0.55, 1.0, r)) * smoothstep(0.9, 2.2, gap) * 0.86;
      if (seeBayer(gl_FragCoord.xy) < a) discard;
    }
  }
`;

const _v = new THREE.Vector3();
const _size = new THREE.Vector2();

/** Per-material switch (default on for world materials). */
export function setSeeThrough(m: THREE.Material, on: boolean) {
  const u = (m.userData.seeMat ??= { value: 1 }) as { value: number };
  u.value = on ? 1 : 0;
}

/**
 * Place the circle on the subject. `radius` is in metres around the subject; null subject = off.
 * Call once per frame after the camera has its final pose.
 */
export function updateSeeThrough(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, subject: THREE.Vector3 | null, radius = 1.5) {
  const u = SEE_U.uSee.value;
  if (!subject) { u.z = 0; return; }
  camera.updateMatrixWorld();
  _v.copy(subject).applyMatrix4(camera.matrixWorldInverse);
  const depth = -_v.z;
  if (depth < 0.5) { u.z = 0; return; }
  renderer.getDrawingBufferSize(_size);
  _v.copy(subject).project(camera);
  u.x = (_v.x * 0.5 + 0.5) * _size.x;
  u.y = (_v.y * 0.5 + 0.5) * _size.y;
  const pxPerM = _size.y / 2 / (depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  u.z = radius * pxPerM;
  u.w = depth;
}
