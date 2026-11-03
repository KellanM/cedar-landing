import * as THREE from 'three';
import { addSunShading, prepareFlutter } from './lighting';

/**
 * All exported scenery is unlit flat vertex colour. The time-of-day tint is applied as a
 * multiply through `material.color`, which MeshBasicMaterial multiplies into vertex colours.
 * Every material that should take the tint is registered here.
 */
const tinted = new Set<THREE.MeshBasicMaterial>();
const tint = new THREE.Color(1, 1, 1);

export const backdropHaze = { value: 0.3 };

export function register(m: THREE.MeshBasicMaterial) {
  tinted.add(m);
  m.color.copy(tint);
  return m;
}

export function setTint(rgb: [number, number, number]) {
  tint.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
  for (const m of tinted) m.color.copy(tint);
}

/** Chunks, protos, boat: full distance fog. */
export const worldMat = register(new THREE.MeshBasicMaterial({ vertexColors: true }));
/** The boat: double-sided so the open canoe hull never shows see-through faces. */
export const boatMat = register(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));

/** Meshes without COLOR_0 fall back to a plain colour (should not happen with the real export). */
export const worldMatNoVC = register(new THREE.MeshBasicMaterial({ vertexColors: false }));
worldMatNoVC.userData.base = new THREE.Color(0.6, 0.6, 0.6);

/** Backdrops (mountains, hills, shores): constant weak haze instead of distance fog. */
export const backdropMat = register(new THREE.MeshBasicMaterial({ vertexColors: true }));
backdropMat.onBeforeCompile = (shader) => {
  shader.uniforms.uBackdropHaze = backdropHaze;
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uBackdropHaze;\nvoid main() {')
    .replace(
      '#include <fog_fragment>',
      '#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, uBackdropHaze);\n#endif',
    );
};
backdropMat.customProgramCacheKey = () => 'backdrop-haze';

/** Clouds: no fog at all. */
export const cloudMat = register(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));

/**
 * Sun-plane shading (see lighting.ts). `lightStrength` per material, 0..1:
 * scenery, protos and the boat take the full ramp; backdrops (mountains, shores, PTL far forests)
 * already have painted lit/shadow planes, so only a whisper; clouds none. Sea and sky use their
 * own materials and are untouched.
 */
export const LIGHT_STRENGTH = { world: 1, boat: 1, noVC: 1, backdrop: 0.15, clouds: 0 };
addSunShading(worldMat, LIGHT_STRENGTH.world);
addSunShading(boatMat, LIGHT_STRENGTH.boat);
addSunShading(worldMatNoVC, LIGHT_STRENGTH.noVC);
addSunShading(backdropMat, LIGHT_STRENGTH.backdrop);
/**
 * Characters (rigged NPCs, world/npcs.glb): same vertex colours, tint and sun ramp as worldMat, but shaded
 * from their own smooth vertex normals (soft two-tone) instead of per-face derivatives. Only meshes that
 * ship normals use it (npcs.glb since the direction-A people pass); the skipper keeps worldMat.
 */
export const charMat = register(addSunShading(new THREE.MeshBasicMaterial({ vertexColors: true }), LIGHT_STRENGTH.world, 'none', 0, 1, 'smooth'));

/**
 * Wind (see lighting.ts). Instanced protos sway; `leaf` adds canopy flutter. PTL* far forests keep
 * backdropMat (no wind). Flags / laundry (extras anim:"flutter") get flutterMat.
 */
export const WIND = { conifer: { leaf: 0.25, scale: 1 }, broadleaf: { leaf: 1, scale: 1.3 }, shrub: { leaf: 0.8, scale: 1.2 }, flutter: { scale: 1 } };
/** Conifers (fir, hemlock, cedar, pine, spruce). */
export const treeMat = register(addSunShading(new THREE.MeshBasicMaterial({ vertexColors: true }), LIGHT_STRENGTH.world, 'tree', WIND.conifer.leaf, WIND.conifer.scale));
/** Broadleaf trees (madrona, alder, oak, maple): a bit more movement and leaf flutter. */
export const leafyMat = register(addSunShading(new THREE.MeshBasicMaterial({ vertexColors: true }), LIGHT_STRENGTH.world, 'tree', WIND.broadleaf.leaf, WIND.broadleaf.scale));
/** Shrubs, ferns, grasses (FOL_P*). */
export const shrubMat = register(addSunShading(new THREE.MeshBasicMaterial({ vertexColors: true }), LIGHT_STRENGTH.world, 'tree', WIND.shrub.leaf, WIND.shrub.scale));
/** Cloth: flags, pennants, bunting, laundry. Double-sided, waves along its length. */
export const flutterMat = register(addSunShading(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), LIGHT_STRENGTH.world, 'flutter', 0, WIND.flutter.scale));

const BROADLEAF = /madrona|alder|oak|maple|arbutus|willow|cottonwood|birch/i;
const CONIFER_RE = /fir|hemlock|cedar|pine|spruce|yew|juniper/i;
/** Material for an instanced proto by name (far PTL* forests are handled by the caller). */
export function protoMaterial(name: string): THREE.MeshBasicMaterial {
  if (BROADLEAF.test(name)) return leafyMat;
  if (CONIFER_RE.test(name)) return treeMat;
  if (/^FOL_/i.test(name)) return shrubMat;
  if (/^PT_/i.test(name)) return treeMat;
  return worldMat;
}

/** Pick the right world material for a mesh, based on whether it has vertex colours. */
export function applyWorldMaterial(root: THREE.Object3D, kind: 'chunk' | 'backdrop' | 'clouds' | 'dynamic' = 'chunk') {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const hasVC = !!mesh.geometry.getAttribute('color');
    if (kind === 'backdrop') mesh.material = hasVC ? backdropMat : worldMatNoVC;
    else if (kind === 'clouds') mesh.material = hasVC ? cloudMat : worldMatNoVC;
    else mesh.material = hasVC ? worldMat : worldMatNoVC;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
  });
  // dynamic.glb: anything tagged anim:"flutter" (glTF extras) waves in the wind
  if (kind === 'dynamic') prepareFlutter(root, flutterMat);
}
