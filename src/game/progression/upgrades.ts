/**
 * Upgrades glue (keeps main.ts edits to a few lines): opens the chandlery / shipwright from world
 * interacts, swaps boat tiers, applies paint + flags, gates rough water and short lines at the
 * cast, runs the showcase camera and exposes __debug.upg for scripts/shop_capture.mjs.
 */
import type * as THREE from 'three';
import type { Boat } from '../boat';
import type { LandCollision } from '../collision';
import type { SaveData } from '../save';
import { writeSave } from '../save';
import type { Hotspot, Interact, LoadedWorld } from '../../world/types';
import { applyGear, ensureUpg, gear, GEAR, poolReach, setOutOfReachHook, depthOf, pickSpeciesFor, type Track } from './gear';
import { applyBoatTier, BOAT_TIERS, needsRoughWater, type BoatTierId } from './tiers';
import { applyPaint, setFlag, updateFlag, isPaintable } from './boatpaint';
import { Showcase } from './showcase';
import { openShop, closeShop, shopOpen, shopTick, buy as shopBuy, shopDebug, type ShopHost } from '../../ui/shop';
import { openShipwright, closeShipwright, shipwrightOpen, swTick, swDebug, buyBoat, takeBoat, chooseFlag, commitPaint, type ShipwrightHost } from '../../ui/shipwright';
import { lookupSpecies, type Species } from '../fishdata';

export interface UpgradeDeps {
  save: SaveData;
  boat(): Boat;
  world(): LoadedWorld | null;
  land(): LandCollision | undefined;
  /** where the player is (feet on foot, else the boat) */
  playerPos(): { x: number; z: number };
  toast(msg: string, kind?: 'info' | 'good' | 'warn' | 'log'): void;
  setShells(n: number): void;
  renderCooler(): void;
  titleCard(title: string, sub: string): void;
  openLog(tab: string): void;
  snapCamera(): void;
}

export function createUpgrades(d: UpgradeDeps) {
  const save = d.save;
  ensureUpg(save);
  applyGear(save);
  applyBoatTier(save.upg!.boat);
  const showcase = new Showcase();
  showcase.clear = (x, z) => { const l = d.land(); return !l || !l.hitsCircle(x, z, 1.2); };
  let model: THREE.Object3D | null = null;
  let reachToastAt = 0;

  const reachHook = (sp: Species) => {
    const now = performance.now();
    if (now - reachToastAt < 45000) return;
    reachToastAt = now;
    d.toast(`Something heavy circled below — your line won't reach ${depthOf(sp)} fathoms`, 'log');
  };
  setOutOfReachHook(reachHook);

  const commit = () => {
    applyGear(save);
    writeSave(save);
    d.setShells(save.shells);
    d.renderCooler();
  };

  /** the model for the saved tier (falls back to T0 / whatever the world gave us) */
  function modelFor(w: LoadedWorld, id: BoatTierId) { return w.boats?.[BOAT_TIERS[id].model] ?? (id === 'T0' ? w.boat : null); }

  function dress(m: THREE.Object3D | null) {
    const u = ensureUpg(save);
    applyPaint(m, u.paint[u.boat]);
    setFlag(m, u.flag);
  }

  /** main.installWorld: choose the boat model for the saved tier; returns it (or null → main default) */
  function pickModel(w: LoadedWorld): THREE.Object3D | null {
    const u = ensureUpg(save);
    let m = modelFor(w, u.boat);
    if (!m && u.boat !== 'T0') { u.boat = 'T0'; applyBoatTier('T0'); applyGear(save); m = modelFor(w, 'T0'); }
    model = m;
    dress(m);
    return m;
  }

  function setTier(id: BoatTierId) {
    const w = d.world();
    const u = ensureUpg(save);
    const m = w ? modelFor(w, id) : null;
    if (!m) { d.toast('That boat is still on the ways', 'warn'); return; }
    u.boat = id;
    applyBoatTier(id);
    const b = d.boat();
    b.setModel(m);
    model = m;
    dress(m);
    // a bigger hull may need a little more water around it
    const land = d.land();
    if (land) { const f = land.nearestFree(b.pos.x, b.pos.z, BOAT_TIERS[id].tuning.radius); b.place(f.x, f.z, b.yaw); }
    commit();
  }

  const shopHost: ShopHost = { save, commit, toast: d.toast };
  const swHost: ShipwrightHost = {
    save, commit, toast: d.toast,
    boatModel: () => model,
    setTier,
    launched: (id) => {
      const t = BOAT_TIERS[id];
      d.titleCard(t.name.replace(/^the /, 'The '), `launched at Cedar Landing — ${t.plate}`);
      showcase.start('boat', 6);
    },
    focus: (p) => { if (shipwrightOpen()) showcase.start(p); },
  };

  function doInteract(it: Interact): boolean {
    switch (it.kind) {
      case 'buy_tackle': closeShipwright(); openShop(shopHost, it, 'rod'); return true;
      case 'buy_bait': closeShipwright(); openShop(shopHost, it, 'bait'); return true;
      case 'upgrade_bench': closeShop(); openShipwright(swHost, it, 'paint'); return true;
      case 'buy_boat': closeShop(); openShipwright(swHost, it, 'boats'); return true;
      case 'weigh_fish': {
        const big = [...save.cooler].sort((a, b) => b.size - a.size)[0];
        if (!big) { d.toast('Nothing to weigh — the scale is waiting', 'info'); return true; }
        const lb = (0.0105 * big.size ** 3) / 453.6; // standard length–weight curve, pounds on the old scale
        d.toast(`Your ${big.name.toLowerCase()} tips the scale at ${lb < 10 ? lb.toFixed(1) : Math.round(lb)} lb`, 'log');
        return true;
      }
      case 'trophy_wall': d.openLog('fish'); return true;
      default: return false;
    }
  }

  /** onAction gate: false (with a toast) if this boat/line can't fish this hotspot */
  function canFish(hs: Hotspot): boolean {
    const u = ensureUpg(save);
    if (needsRoughWater(hs) && !BOAT_TIERS[u.boat].roughWater) {
      d.toast(`Too rough out here for ${BOAT_TIERS[u.boat].name} — the shipwright has a bigger boat`, 'warn');
      return false;
    }
    if (!poolReach(hs).reach.length) {
      d.toast(`The fish here sit deeper than ${gear.depth} fathoms — the chandlery sells longer line`, 'warn');
      return false;
    }
    return true;
  }

  /** per frame, after the camera rigs ran, before render */
  function tick(dt: number, camera: THREE.PerspectiveCamera, portrait: boolean) {
    const p = d.playerPos();
    shopTick(p.x, p.z);
    swTick(p.x, p.z);
    const b = d.boat();
    if (shipwrightOpen() && !showcase.active) showcase.start('boat');
    if (!shipwrightOpen() && showcase.active && !showcase.timed) { showcase.stop(); d.snapCamera(); }
    const wasActive = showcase.active;
    showcase.apply(camera, b.pos, b.yaw, b.halfLen, dt, portrait);
    if (wasActive && !showcase.active) d.snapCamera();
    updateFlag(model, dt, Math.min(1, Math.abs(b.speed) / 6));
  }

  const debug = {
    give: (n: number) => { save.shells += n; commit(); return save.shells; },
    get state() {
      const u = ensureUpg(save);
      return { ...u, gear: { ...gear, bait: gear.bait.id }, coolerCap: save.coolerCap, shells: save.shells, paintable: isPaintable(model), model: model?.name ?? null, boats: Object.keys(d.world()?.boats ?? {}), shopOpen: shopOpen(), shipwrightOpen: shipwrightOpen(), showcase: showcase.active };
    },
    openShop: (tab: Track = 'rod') => { openShop(shopHost, d.world()?.gameplay.interacts.find((i) => i.kind === 'buy_tackle') ?? null, tab); return shopOpen(); },
    openShipwright: (tab: 'paint' | 'flag' | 'boats' = 'paint') => { openShipwright(swHost, d.world()?.gameplay.interacts.find((i) => i.kind === 'upgrade_bench') ?? null, tab); return shipwrightOpen(); },
    close: () => { closeShop(); closeShipwright(); },
    buy: (id: string) => { if (!shopOpen()) openShop(shopHost, null, 'rod'); return shopBuy(id); },
    shopTab: (t: Track) => shopDebug.setTab(t),
    sw: swDebug,
    paint: (part: string, hex: string) => { swDebug.setPart(part as never); swDebug.pick(hex); return commitPaint(); },
    flag: (id: string) => chooseFlag(id),
    buyBoat: (id: BoatTierId) => buyBoat(id),
    takeBoat: (id: BoatTierId) => takeBoat(id),
    /** reach test: which species of a hotspot's pool the current line reaches */
    reach: (name: string) => { const hs = d.world()?.gameplay.hotspots.find((h) => h.name.includes(name)); if (!hs) return null; const r = poolReach(hs); return { reach: r.reach.map((s) => s.name), deep: r.deep.map((s) => s.name) }; },
    depthOf: (n: string) => depthOf(lookupSpecies(n)),
    /** n bites at a hotspot through the real picker (depth gate + bait bias): species → count */
    sample: (name: string, n = 400) => {
      const hs = d.world()?.gameplay.hotspots.find((h) => h.name.includes(name)) ?? null;
      const out: Record<string, number> = {};
      setOutOfReachHook(() => {});
      for (let i = 0; i < n; i++) { const s = pickSpeciesFor(hs); out[s.name] = (out[s.name] ?? 0) + 1; }
      setOutOfReachHook(reachHook);
      return out;
    },
    GEAR,
    rareHotspots: () => d.world()?.gameplay.hotspots.filter(needsRoughWater).map((h) => h.name) ?? [],
  };

  return { doInteract, canFish, pickModel, tick, debug, get model() { return model; }, get showcaseActive() { return showcase.active; } };
}
