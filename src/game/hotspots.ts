import * as THREE from 'three';
import type { Hotspot } from '../world/types';

/**
 * Hotspot visuals: two staggered expanding ripple rings plus a few lazily circling fish
 * shadows (Animal Crossing lesson: visible shadows let players choose a target).
 */
export class HotspotFX {
  group = new THREE.Group();
  private items: { hs: Hotspot; rings: THREE.Mesh[]; shadows: { m: THREE.Mesh; r: number; w: number; a: number }[] }[] = [];
  private t = 0;

  constructor(hotspots: Hotspot[]) {
    const ringG = new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2);
    const shadowG = new THREE.CircleGeometry(1, 14).scale(0.3, 1, 1).rotateX(-Math.PI / 2);
    for (const hs of hotspots) {
      const rings: THREE.Mesh[] = [];
      for (let i = 0; i < 2; i++) {
        const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0xf4f6f2, transparent: true, opacity: 0.5, depthWrite: false }));
        m.position.set(hs.pos[0], 0.04, hs.pos[2]);
        m.renderOrder = 1;
        this.group.add(m);
        rings.push(m);
      }
      const shadows = [];
      const n = hs.tier === 'rare' ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(shadowG, new THREE.MeshBasicMaterial({ color: 0x0d1a1f, transparent: true, opacity: 0.32, depthWrite: false }));
        const s = 0.5 + Math.random() * 0.5 + (hs.tier === 'uncommon' ? 0.3 : hs.tier === 'rare' ? 0.7 : 0);
        m.scale.setScalar(s);
        this.group.add(m);
        shadows.push({ m, r: 1.5 + Math.random() * 3, w: (0.25 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1), a: Math.random() * 6.28 });
      }
      this.items.push({ hs, rings, shadows });
    }
  }

  update(dt: number, cam: THREE.Vector3, hideShadowsOf: Hotspot | null) {
    this.t += dt;
    for (const it of this.items) {
      const far = Math.hypot(it.hs.pos[0] - cam.x, it.hs.pos[2] - cam.z) > 260;
      it.rings.forEach((m, i) => {
        m.visible = !far;
        const k = ((this.t * 0.35 + i * 0.5) % 1);
        m.scale.setScalar(1.5 + k * 4.5);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k) * Math.min(1, k * 6);
      });
      for (const s of it.shadows) {
        s.m.visible = !far && it.hs !== hideShadowsOf;
        s.a += s.w * dt;
        const x = it.hs.pos[0] + Math.cos(s.a) * s.r, z = it.hs.pos[2] + Math.sin(s.a) * s.r;
        s.m.position.set(x, 0.02, z);
        s.m.rotation.y = -s.a + (s.w > 0 ? Math.PI : 0);
      }
    }
  }
}
