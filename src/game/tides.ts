import * as THREE from 'three';
import type { ShoreField } from '../render/shorefield';
import type { LandCollision } from './collision';
import type { Boat } from './boat';
import type { Floaters } from './floaters';
import type { Wildlife } from './wildlife';
import type { BoatWake } from '../render/wake';
import type { Fishing } from './fishing';
import type { OnFoot } from './onfoot/onfoot';
import { setWalkWater } from './onfoot/footworld';
import { setTideLineContext } from './onfoot/npclines';
import { TideGrid } from './tidegrid';
import { WATER, updateTide } from './tide';
import { TIDE_U, useTideBands } from '../render/tidebands';
import { TidePools, CRITTERS, critterById, bakeSites, type CritterId } from './tidepools';
import type { FootWorld } from './onfoot/footworld';
import type { FootContext } from './onfoot/onfoot';
import type { LoadedWorld, LoadedChunk } from '../world/types';
import type { SaveData } from './save';
import { setCritterPlates, updateTideChip } from '../ui/tidelog';
import * as art from '../render/tidepoolart';
const critterMat = new THREE.MeshBasicMaterial({ vertexColors: true }); // plates: untinted, unshaded (like the fish plates)
import { worldMat } from '../render/materials';

/** What the tides need from the game (getters: these objects come and go with the world). */
export interface TideHost {
  boat: () => Boat | undefined;
  floaters: () => Floaters | null;
  wildlife: () => Wildlife | null;
  hotspots: () => THREE.Object3D | null;
  crowd: () => { actors: { root: THREE.Object3D; pos: THREE.Vector3 }[] } | null;
  wake: BoatWake;
  fishing: Fishing;
  foot: OnFoot;
  toast: (m: string, kind?: 'good') => void;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  save: SaveData;
  writeSave: () => void;
  note: (who: string, text: string) => void;
  shells: (n: number) => void;
  reduceMotion: () => boolean;
}

const BOAT_R = 1.1;

/**
 * The tide layer (docs/tide_study.md): advances the water level with the game clock, carries
 * everything afloat up and down with it, swaps in the low-water land grid, and never lets the
 * boat get stuck on a falling tide.
 */
export class Tides {
  grid: TideGrid | null = null;
  private land: LandCollision | null = null;
  private stuckT = 0;
  private freeing: { x: number; z: number } | null = null;
  private toldMud = false;

  constructor(private host: TideHost) {}

  pools: TidePools | null = null;
  private field: ShoreField | null = null;

  /** New world: the chunks take the intertidal bands; the tide-pool shelves are built (added under `root`). */
  setWorld(w: LoadedWorld, root: THREE.Object3D, tag: string) {
    useTideBands(w.chunks.map((c) => c.object), worldMat);
    this.pools?.dispose();
    this.pools = w.source === 'export' ? new TidePools(w.gameplay, tag) : null;
    if (this.pools) root.add(this.pools.group);
    setCritterPlates((id) => this.plate(id));
  }
  /** Tide-pool terraces as extra chunks (shore field, tide grid, walking). */
  get walkChunks(): LoadedChunk[] { return this.pools?.walkChunks ?? []; }
  /** Terraces + low-tide reef rocks, for the shore field (foam, depth, tide grid). */
  get fieldChunks(): LoadedChunk[] { return this.pools?.fieldChunks ?? []; }
  /** After the on-foot world is set: walk on the terraces, round the pools. */
  footWorld(fw: FootWorld, chunks: LoadedChunk[]) {
    if (this.pools) {
      fw.setChunks([...chunks, ...this.pools.walkChunks]);
      fw.circles = [...fw.circles, ...this.pools.circles];
    }
    // floats and gangways: walkable, riding the tide (the deck under your feet moves with them)
    const fl = this.host.floaters();
    if (fl) {
      fw.addMoving(fl.tidalItems.map((it) => {
        const b = it.box.clone().expandByScalar(0.5);
        return { chunk: { object: it.o, bounds: b, center: b.getCenter(new THREE.Vector3()) }, off: (x: number, z: number) => fl.offsetOf(it, x, z) };
      }));
    }
    this.npcRest.clear();
  }
  /** NPCs standing on floats: rest height, keyed by actor root */
  private npcRest = new Map<THREE.Object3D, { y: number; onFloat: boolean | null }>();
  private floatNpcs() {
    const crowd = this.host.crowd(), fl = this.host.floaters();
    if (!crowd || !fl) return;
    for (const a of crowd.actors) {
      let r = this.npcRest.get(a.root);
      if (!r) { r = { y: a.root.position.y, onFloat: null }; this.npcRest.set(a.root, r); }
      if (r.onFloat === false) continue;
      const p = a.pos;
      // decided once, at rest: is this NPC standing on a float deck?
      if (r.onFloat === null) r.onFloat = fl.tidalItems.some((it) => { const b = it.box; return p.x > b.min.x - 0.3 && p.x < b.max.x + 0.3 && p.z > b.min.z - 0.3 && p.z < b.max.z + 0.3 && p.y > b.min.y && p.y < b.max.y + 0.5; });
      if (!r.onFloat) continue;
      a.root.position.y = r.y + fl.floatDyAt(p.x, p.y, p.z);
      a.root.updateMatrix(); a.root.updateMatrixWorld(true);
    }
  }

  setField(f: ShoreField | null, land: LandCollision | null) {
    this.field = f;
    this.grid = f ? new TideGrid(f) : null;
    this.land = land;
    if (land) land.extra = this.grid ? this.grid.blocked : null;
    const fl = this.host.floaters();
    if (fl && this.grid) { const g = this.grid; fl.floor = (x, z) => g.ground(x, z); }
  }

  /** ms spent in frame() (EMA), for the perf readout */
  cost = 0;

  frame(dt: number, hour: number, day: number) {
    const t0 = performance.now();
    updateTide(hour, day);
    const y = WATER.y, h = this.host;
    TIDE_U.uTideY.value = y;
    // a falling tide leaves a wide wet band behind it; a rising one only a thin line
    const wetT = WATER.rate < 0 ? 0.5 : 0.1;
    TIDE_U.uWetH.value += (wetT - TIDE_U.uWetH.value) * Math.min(1, dt * 0.2);
    h.wake.mesh.position.y = y;
    h.fishing.group.position.y = y;
    const hs = h.hotspots();
    if (hs) hs.position.y = y;
    const w = h.wildlife();
    if (w) { w.sea.group.position.y = y; w.mammals.group.position.y = y; w.splash.group.position.y = y; }
    const fl = h.floaters();
    if (fl && !fl.floor && this.grid) { const g = this.grid; fl.floor = (x, z) => g.ground(x, z); }
    // on foot: wet ground below the water is not walkable, but you can always walk back up the beach
    const feet = h.foot.active ? h.foot.feet.y : 99;
    setWalkWater(Math.min(y + 0.3, feet - 0.05)); // + 0.3: as before at high water
    this.boat(dt);
    this.floatNpcs();
    this.pools?.update(dt, h.camera.position, h.reduceMotion());
    this.chipT -= dt;
    if (this.chipT <= 0) {
      this.chipT = 0.5;
      updateTideChip();
      setTideLineContext(y < -1.1 ? 'low' : y > -0.3 ? 'high' : WATER.rate < 0 ? 'falling' : 'rising');
    }
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }
  private chipT = 0;

  // ---------------------------------------------------------------- tide pools: look in, log it
  /** On foot beside an uncovered pool: "Look in pool". */
  poolContext(): FootContext | null {
    const f = this.host.foot;
    if (!this.pools || !f.active) return null;
    const p = this.pools.nearest(f.feet.x, f.feet.y, f.feet.z);
    if (!p) return null;
    return { name: `tidepool_${p.id}`, label: 'Look in', prompt: 'Look in the pool', run: () => this.observe(p) };
  }

  /** Catch-and-look: name what is in the pool, log anything new (a few Shells for Gran's notes). */
  observe(p: { id: string; critters: CritterId[]; zone: string; orange: boolean }) {
    const s = this.host.save;
    const seen = (s.tidepools ??= {});
    const fresh = p.critters.filter((c) => !seen[c]);
    for (const c of p.critters) seen[c] = (seen[c] ?? 0) + 1;
    const reward = fresh.length * 5;
    if (reward) { s.shells += reward; this.host.shells(s.shells); }
    this.host.writeSave();
    const words: Record<CritterId, string> = {
      hermit: 'a couple of hermit crabs pottering about in borrowed shells',
      shore_crab: 'a purple shore crab that scuttles under the rim',
      sculpin: 'a sculpin sitting so still it looks like gravel',
      ochre_star: p.orange ? 'an orange ochre star on the rocks' : 'a purple ochre star on the rocks',
      anemone: 'green anemones folded up, waiting for the water',
      urchin: 'purple urchins like little pincushions',
      sunflower: 'a sunflower star, all twenty arms of it',
    };
    const list = p.critters.map((c) => words[c]);
    const text = `${list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] ?? 'just still water and weed'}.`;
    const intro = p.zone === 'low' ? 'Way down at the low-water mark: ' : p.zone === 'mid' ? 'In the pool: ' : 'Up near the high-water line: ';
    this.host.note('Tide pool', intro + text.charAt(0) + text.slice(1) + (fresh.length ? ` New in your shore notes: ${fresh.map((c) => critterById(c)!.name).join(', ')}.` : ''));
    if (reward) this.host.toast(`Noted in the Log · +${reward} Shells`, 'good');
    return { fresh, reward };
  }

  // studio plates for the Log (rendered once per critter with the game's own renderer)
  private plates = new Map<string, string>();
  private plate(id: string): string | null {
    const hit = this.plates.get(id);
    if (hit) return hit;
    const g = id === 'hermit' ? art.hermitCrab() : id === 'shore_crab' ? art.shoreCrab() : id === 'sculpin' ? art.sculpin() : id === 'ochre_star' ? art.seaStar(false, 0.15)
      : id === 'anemone' ? art.anemone(0.12) : id === 'urchin' ? art.urchin(0.06) : id === 'sunflower' ? art.sunflowerStar(0.3) : null;
    if (!g) return null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9e1cf);
    const m = new THREE.Mesh(g, critterMat);
    scene.add(m);
    g.computeBoundingSphere();
    const bs = g.boundingSphere!;
    const W = 152, H = 108;
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 10);
    const d = bs.radius / Math.sin((15 * Math.PI) / 180) * 1.05;
    cam.position.set(bs.center.x + d * 0.35, bs.center.y + d * 0.8, bs.center.z + d * 0.5);
    cam.lookAt(bs.center);
    const r = this.host.renderer;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt);
    r.render(scene, cam);
    const px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, px);
    r.setRenderTarget(prev);
    rt.dispose(); g.dispose();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d')!, im = cx.createImageData(W, H);
    for (let y = 0; y < H; y++) im.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    cx.putImageData(im, 0, 0);
    const url = c.toDataURL('image/png');
    this.plates.set(id, url);
    return url;
  }

  /** Debug: bake tide-pool sites from the loaded world (scripts/tidepool_bake.mjs). */
  bake(fw: FootWorld, w: LoadedWorld, opts?: { spacing?: number; max?: number }) {
    return this.field ? bakeSites(this.field, fw, w.gameplay, opts) : null;
  }
  get critters() { return CRITTERS; }

  /** Moored boats sit on the mud when their berth dries; a boat caught by the falling tide is eased off into deeper water. */
  private boat(dt: number) {
    const b = this.host.boat(), land = this.land, g = this.grid;
    if (!b) return;
    b.floor = b.moored && g ? g.ground(b.pos.x, b.pos.z) + 0.12 : -99;
    if (!land || b.moored) { this.freeing = null; this.stuckT = 0; return; }
    const stuck = land.hitsCircle(b.pos.x, b.pos.z, BOAT_R);
    if (!stuck) { this.freeing = null; this.stuckT = 0; return; }
    this.stuckT += dt;
    if (this.stuckT < 0.25) return; // LandCollision.move's own nudge usually frees it within a frame or two
    if (!this.freeing) {
      const f = land.nearestFree(b.pos.x, b.pos.z, BOAT_R);
      this.freeing = f;
      if (!this.toldMud) { this.toldMud = true; this.host.toast('The tide’s gone out from under you. Poling off into deeper water.'); }
    }
    const dx = this.freeing.x - b.pos.x, dz = this.freeing.z - b.pos.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, 3 * dt);
    if (d < 0.05) { b.pos.x = this.freeing.x; b.pos.z = this.freeing.z; this.freeing = null; return; }
    b.pos.x += (dx / d) * step; b.pos.z += (dz / d) * step;
    b.speed = 0;
  }
}
