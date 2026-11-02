import * as THREE from 'three';

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

/** Pick the right world material for a mesh, based on whether it has vertex colours. */
export function applyWorldMaterial(root: THREE.Object3D, kind: 'chunk' | 'backdrop' | 'clouds' = 'chunk') {
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
}
