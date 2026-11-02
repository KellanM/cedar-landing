import * as THREE from 'three';
import { FishModel } from './fishmodel';

/**
 * Debug studio (scripts/fish_models_capture.mjs): renders one species' 3D fish off-screen with the
 * game's own renderer, untinted, on the plate paper colour. 'side' uses an orthographic camera
 * that matches the 512×256 plate canvas exactly, so the render can be laid next to the plate.
 */
export type StudioView = 'side' | 'quarter' | 'top' | 'flop' | 'leap';
const scene = new THREE.Scene();
const model = new FishModel(false);
scene.add(model.group);

export async function fishStudio(renderer: THREE.WebGLRenderer, id: string, view: StudioView = 'side', w = 512, h = 256) {
  await model.setSpecies(id);
  const pf = model.plateFrame;
  if (!pf) return null;
  model.group.visible = true;
  model.group.scale.setScalar(1);
  model.group.position.set(0, 0, 0);
  model.group.rotation.set(0, 0, 0);
  model.wag = 0; model.wagBase = 0; model.leap = 0;
  model.present = view === 'side' ? 1 : 0;
  model.setTime(0.3);
  let cam: THREE.Camera;
  if (view === 'side') {
    const o = new THREE.OrthographicCamera(pf.cx - pf.w / 2, pf.cx + pf.w / 2, pf.cy + pf.h / 2, pf.cy - pf.h / 2, 0.01, 10);
    o.position.set(0, 0, 3); o.lookAt(0, 0, 0);
    o.left = -pf.w / 2 + pf.cx; o.right = pf.w / 2 + pf.cx; o.top = pf.h / 2 + pf.cy; o.bottom = -pf.h / 2 + pf.cy;
    o.position.set(0, 0, 3); o.updateProjectionMatrix();
    cam = o;
  } else {
    if (view === 'flop') { model.wag = 0.9; model.flop(1); for (let i = 0; i < 9; i++) model.update(1 / 60); model.setTime(0.55); model.present = model.isFlat ? 1 : 0; }
    if (view === 'leap') { model.leap = 1; model.wag = 0.8; model.setTime(0.21); model.group.rotation.set(0, 0, 0.5); }
    const p = new THREE.PerspectiveCamera(30, w / h, 0.05, 20);
    const az = view === 'top' ? 0.0 : view === 'leap' ? 0.25 : 0.65, el = view === 'top' ? 1.25 : view === 'leap' ? 0.15 : 0.42;
    const d = 1.55;
    p.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    p.lookAt(0, 0, 0);
    cam = p;
  }
  model.update(0);
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const bg = scene.background = new THREE.Color(0xe9e1cf);
  void bg;
  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  renderer.setRenderTarget(prevRT);
  rt.dispose();
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const im = g.createImageData(w, h);
  // rows come bottom-up; the side view is also mirrored so the fish faces left like its plate
  const mirror = view === 'side';
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    if (!mirror) { im.data.set(px.subarray(src, src + w * 4), y * w * 4); continue; }
    for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) im.data[(y * w + x) * 4 + c] = px[src + (w - 1 - x) * 4 + c];
  }
  g.putImageData(im, 0, 0);
  return { url: c.toDataURL('image/png'), tris: model.triangles, plan: model.data?.plan };
}
