import * as THREE from 'three';
import { LIGHT_STRENGTH, register } from './materials';
import { addSunShading } from './lighting';

/**
 * The intertidal "bathtub ring" (docs/tide_study.md): rock and pilings between the high-water mark and
 * the water show the Salish Sea's vertical zonation as flat bands, and freshly uncovered ground is
 * dark and wet for a while after the water leaves it. Bands are fixed to the rock (absolute height):
 * the water uncovers them, it does not carry them.
 *
 *  - barnacle band  (0 → −0.3 m): pale grey-tan crust
 *  - rockweed band  (−0.3 → −0.85 m): olive-brown Fucus
 *  - low zone       (below −0.85 m): dark green weed (only bared by the big lows)
 *  - sand / gravel: no weed, just wet sand (darker, cooler) down to the water
 *
 * Only the world chunks get it (not floating things, which ride the tide).
 */
export const TIDE_U = {
  uTideY: { value: 0 },
  /** recently-uncovered wet band height above the water (m): wide on a falling tide, thin on a rising one */
  uWetH: { value: 0.35 },
  uBarnacle: { value: new THREE.Color(0xb9b09f) },
  uRockweed: { value: new THREE.Color(0x77693a) },
  uLowZone: { value: new THREE.Color(0x45563a) },
  uBandK: { value: 0.72 },
};

export const TIDE_BAND_GLSL = /* glsl */ `
  {
    float wob = 0.05 * sin(vTideW.x * 1.3 + vTideW.z * 0.7) + 0.035 * sin(vTideW.z * 2.3 - vTideW.x * 0.45);
    float y = vTideW.y + wob;
    if (y < 0.02 && vTideW.y > uTideY - 0.2) {
      #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
        vec3 vc0 = vColor.rgb;
      #else
        vec3 vc0 = vec3(0.5);
      #endif
      float sand = step(0.12, vc0.r - vc0.b) * step(0.2, vc0.g);
      vec3 band = y > -0.3 ? uBarnacle : (y > -0.85 ? uRockweed : uLowZone);
      // keep some of the painted variation so rocks stay rocks
      vec3 rock = mix(diffuseColor.rgb, band * (0.85 + 0.3 * dot(vc0, vec3(0.33))), uBandK);
      vec3 wetSand = diffuseColor.rgb * vec3(0.66, 0.68, 0.74);
      diffuseColor.rgb = mix(rock, wetSand, sand);
      // fresh wet ground just above the water: darker, a touch cooler
      float wet = 1.0 - smoothstep(0.0, uWetH, vTideW.y - uTideY);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.77, 0.82), wet);
    }
  }
`;

export function addTideBands(m: THREE.MeshBasicMaterial) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, TIDE_U);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vTideW;\nvoid main() {')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec4 tw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      tw = instanceMatrix * tw;
    #endif
    vTideW = (modelMatrix * tw).xyz;
  }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec3 vTideW;
uniform float uTideY;
uniform float uWetH;
uniform vec3 uBarnacle;
uniform vec3 uRockweed;
uniform vec3 uLowZone;
uniform float uBandK;
void main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${TIDE_BAND_GLSL}`);
  };
  m.customProgramCacheKey = () => `${prevKey()}|tidebands`;
  m.needsUpdate = true;
  return m;
}

/** World chunks' material with the bands (sun shading first, so the bands are lit like everything else). */
export const chunkTideMat = register(addTideBands(addSunShading(new THREE.MeshBasicMaterial({ vertexColors: true }), LIGHT_STRENGTH.world)));

/** Swap the plain world material for the banded one on the chunk meshes. */
export function useTideBands(roots: THREE.Object3D[], plain: THREE.Material) {
  for (const r of roots) r.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material === plain) m.material = chunkTideMat; });
}
