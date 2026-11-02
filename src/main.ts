import * as THREE from 'three';
import { Sky, Sea } from './render/environment';
import { backdropHaze, setTint } from './render/materials';
import { InstanceField } from './render/instances';
import { makeTestFlag, mountSunShadingSetting, mountWindSetting, setLightingTOD, updateLighting } from './render/lighting';
import { flutterMat } from './render/materials';
import { buildPlaceholderWorld, placeholderBoat } from './world/placeholder';
import { checkReady, loadExportWorld } from './world/loader';
import type { Hotspot, Interact, LoadedWorld } from './world/types';
import { Input } from './game/input';
import { LandCollision } from './game/collision';
import { Boat, BOAT_TUNING } from './game/boat';
import { ChaseCamera } from './game/camera';
import { Fishing } from './game/fishing';
import { HotspotFX } from './game/hotspots';
import { Wildlife } from './game/wildlife';
import { Floaters } from './game/floaters';
import { BoatWake } from './render/wake';
import { SmokeFX } from './render/smoke';
import { FogBanks } from './render/fogbanks';
import { lookupSpecies, type CaughtFish } from './game/fishdata';
import { clearSave, loadSave, writeSave, type SaveData } from './game/save';
import * as hud from './ui/hud';
import { mountVersionStamp } from './version';
mountVersionStamp();
import { initTuneOverlay } from './ui/tune';
import { OnFoot, type FootContext } from './game/onfoot/onfoot';
import { FOOT_CAM } from './game/onfoot/footcamera';
import { createUpgrades } from './game/progression/upgrades';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- tuning
const HOTSPOT_RANGE = 10; // m, cast allowed within this of a hotspot centre
const CAST_MAX_SPEED = 0.45; // m/s, must be (nearly) stopped
const INTERACT_RANGE = 10; // m, horizontal
const SELL_RANGE = 16; // market sits on the pier above the water, allow a little more
const REVEAL_TRIGGER = 90; // m from Cedar Landing
const LANDING_REACHED = 45;
const QUALITY = {
  high: { pixelRatio: 2, fogNear: 90, fogFar: 1100, small: 170, haze: 0.3 },
  low: { pixelRatio: 1.5, fogNear: 60, fogFar: 600, small: 0, haze: 0.38 },
};
const KIND_LABEL: Record<string, string> = {
  sell_fish: 'Sell fish', moor_boat: 'Tie up', buy_tackle: 'Tackle shop', buy_bait: 'Buy bait', buy_food: 'Snacks',
  buy_boat: 'Boatyard', buy_dive_gear: 'Dive shop', dive_here: 'Dive', land_here: 'Go ashore', photo: 'Photo spot',
  photograph: 'Photo spot', collect_flotsam: 'Pick up flotsam', forage: 'Forage', rest: 'Rest', talk: 'Talk',
  quest_lost_treasure: 'Treasure map', quest_clue: 'Look closer', haul_crab_pots: 'Haul crab pots', read_sunstone: 'Read sunstone',
};
/** upgrades: shop names win over the exported generic prompts ("Upgrade", "Inspect") */
const UPG_LABEL: Record<string, string> = { buy_tackle: 'Chandlery', upgrade_bench: 'Shipwright', buy_boat: 'Boatyard' };
const IGNORED_KINDS = new Set(['fish_here']); // handled by the hotspot / Cast button

// ---------------------------------------------------------------- renderer + scene
const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc7ced1, 90, 1100);
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 20000);
const sky = new Sky();
const sea = new Sea();
scene.add(sky.mesh, sea.group);

const save: SaveData = loadSave();
let quality = QUALITY[save.settings.quality];

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- game state
const input = new Input(canvas, $('btn-action'), $('btn-interact'));
const chase = new ChaseCamera(camera);
const fishing = new Fishing({
  toast: (m, k) => hud.toast(m, k),
  bite: () => hud.onBite(),
  nibble: () => hud.onNibble(),
  slip: () => hud.onSlip(),
  landed: (fish, sp, perfect) => onLanded(fish, sp, perfect),
});
fishing.autoReel = save.settings.autoReel;
scene.add(fishing.group);

let world: LoadedWorld | null = null;
let worldVersion = '';
const worldRoot = new THREE.Group();
scene.add(worldRoot);
let land: LandCollision;
let instances: InstanceField | null = null;
let hotspotFX: HotspotFX | null = null;
let wildlife: Wildlife | null = null;
let smoke: SmokeFX | null = null;
let fogBanks: FogBanks | null = null;
let floaters: Floaters | null = null;
const wake = new BoatWake(BOAT_TUNING);
scene.add(wake.mesh);
const stackPos = new THREE.Vector3();
let squawks = 0;
let boat: Boat;
let landing: Interact | null = null; // Cedar Landing fish market (compass + reveal)
let todKeys: string[] = [];
let todIndex = 0;
let pendingCatch: CaughtFish | null = null;
let modalOpen = false;
// On-foot mode (src/game/onfoot): walk around the village with the boat tied up.
const foot = new OnFoot({
  scene, camera, input, boat: () => boat,
  labelFor: (it) => labelFor(it), doInteract: (it) => doInteract(it), toast: (m, k) => hud.toast(m, k),
  setMode: (on) => {
    document.body.classList.toggle('onfoot', on);
    if (on) { fishing.cancel(); boat.moored = true; save.boat = { x: boat.pos.x, z: boat.pos.z, yaw: boat.yaw, moored: true }; save.worldTag = world?.source; }
    writeSave(save);
  },
  persist: (s) => { save.onfoot = s; writeSave(save); },
  landNear: (x, z, r) => !!land && land.hitsCircle(x, z, r),
});
let footCtx: FootContext | null = null;
let ashoreOnAction: FootContext | null = null;

// ---------------------------------------------------------------- world
function disposeWorld() {
  wildlife?.dispose();
  wildlife = null;
  floaters = null;
  instances?.dispose();
  instances = null;
  worldRoot.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  worldRoot.clear();
}

function installWorld(w: LoadedWorld) {
  disposeWorld();
  world = w;
  for (const c of w.chunks) worldRoot.add(c.object);
  for (const b of w.backdrops) worldRoot.add(b);
  for (const c of w.clouds) worldRoot.add(c);
  if (new URLSearchParams(location.search).has('flagtest')) worldRoot.add(makeTestFlag(flutterMat, w.gameplay.spawn.pos));
  buildInstances();

  land = new LandCollision(w.gameplay);
  hotspotFX = new HotspotFX(w.gameplay.hotspots);
  worldRoot.add(hotspotFX.group);
  buildWildlife();
  floaters = w.dynamic?.length ? new Floaters(w.dynamic) : null;
  if (floaters) worldRoot.add(floaters.group);

  const model = upg.pickModel(w) ?? w.boat ?? placeholderBoat();
  if (!boat) { boat = new Boat(model); scene.add(boat.root); } else boat.setModel(model);

  const sp = w.gameplay.spawn;
  let yaw = sp.rotY ?? 0;
  if (sp.dir) yaw = Math.atan2(-sp.dir[0], -sp.dir[1]);
  const free = land.nearestFree(sp.pos[0], sp.pos[2], 1.1);
  boat.place(free.x, free.z, yaw);
  if (save.boat && save.boat.moored && save.worldTag === w.source) {
    const f2 = land.nearestFree(save.boat.x, save.boat.z, 1.1);
    boat.place(f2.x, f2.z, save.boat.yaw);
    boat.moored = true;
  }
  boat.update(0, 0, 0, land);
  chase.snap(boat);
  foot.setWorld(w);
  if (save.onfoot && boat.moored && save.worldTag === w.source && !foot.active) foot.restore(save.onfoot);

  const ints = w.gameplay.interacts;
  landing = ints.find((i) => i.name === 'Interact_SellFish') ?? ints.find((i) => i.kind === 'sell_fish') ?? null;

  todKeys = Object.keys(w.gameplay.time_of_day);
  const want = save.settings.tod && todKeys.includes(save.settings.tod) ? save.settings.tod : todKeys.includes('overcast') ? 'overcast' : todKeys[0];
  todIndex = Math.max(0, todKeys.indexOf(want));
  applyTOD();

  fishing.cancel();
  hud.setWorld(w, { renderer, root: worldRoot, hide: [...w.backdrops, ...w.clouds] }, w.source === 'export' ? `export ${worldVersion.slice(0, 24)}` : 'placeholder');
  const badge = $('world-badge');
  badge.textContent = 'placeholder world — waiting for export';
  badge.classList.toggle('hidden', w.source !== 'placeholder');
}

function buildInstances() {
  if (!world) return;
  instances?.dispose();
  if (instances) worldRoot.remove(instances.group);
  instances = new InstanceField(world.instances, world.protos, save.settings.quality === 'low');
  worldRoot.add(instances.group);
}

function buildWildlife() {
  if (!world || !land) return;
  wildlife?.dispose();
  wildlife = new Wildlife(world.gameplay, land, save.settings.quality === 'low');
  wildlife.onSquawk = () => { squawks++; }; // audio hook: no sound assets yet
  worldRoot.add(wildlife.group);
  // smoke + fog banks are quality-dependent pools too
  for (const fx of [smoke?.mesh, fogBanks?.mesh]) if (fx) { fx.removeFromParent(); fx.geometry.dispose(); }
  smoke = new SmokeFX(world.gameplay.smoke, save.settings.quality === 'low');
  fogBanks = new FogBanks(save.settings.quality === 'low');
  scene.add(smoke.mesh, fogBanks.mesh);
}

function applyTOD() {
  if (!world) return;
  const key = todKeys[todIndex];
  const t = world.gameplay.time_of_day[key];
  sky.apply(t);
  sea.apply(t);
  (scene.fog as THREE.Fog).color.set(t.haze);
  renderer.setClearColor(t.haze);
  setTint(t.tint);
  setLightingTOD(key, t as Parameters<typeof setLightingTOD>[1]);
  const foggy = /fog/i.test(key);
  (scene.fog as THREE.Fog).near = foggy ? 12 : quality.fogNear;
  (scene.fog as THREE.Fog).far = foggy ? 210 : quality.fogFar;
  // low fog banks: full in the fog preset, light morning wisps on overcast
  fogBanks?.set(foggy ? 1 : key === 'overcast' ? 0.25 : 0, t.haze);
  wake.setSea(t.sea);
  backdropHaze.value = foggy ? 0.92 : quality.haze;
  hud.setTOD(key);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.haze);
}

async function loadWorld(initial: boolean) {
  const v = await checkReady();
  if (!v) {
    if (initial) { worldVersion = 'placeholder'; installWorld(buildPlaceholderWorld()); }
    return;
  }
  if (v === worldVersion) return;
  const prev = worldVersion;
  worldVersion = v;
  try {
    if (!initial) hud.toast('New world export found — loading…');
    const w = await loadExportWorld(v, (msg, f) => {
      if (initial) { $('load-msg').textContent = msg; $('load-bar').style.width = `${Math.round(f * 100)}%`; }
    });
    if (!w.chunks.length) throw new Error('export has no chunks');
    installWorld(w);
    if (!initial) hud.toast('World updated', 'good');
  } catch (e) {
    console.warn('[world] export failed to load, keeping current world', e);
    worldVersion = prev || 'placeholder';
    if (initial || !world) installWorld(buildPlaceholderWorld());
  }
}

// ---------------------------------------------------------------- interactions
function nearestInteract(): Interact | null {
  if (!world) return null;
  let best: Interact | null = null, bd = Infinity;
  for (const it of world.gameplay.interacts) {
    if (IGNORED_KINDS.has(it.kind)) continue;
    const d = Math.hypot(it.pos[0] - boat.pos.x, it.pos[2] - boat.pos.z);
    const r = it.kind === 'sell_fish' ? SELL_RANGE : INTERACT_RANGE;
    // Working interacts win over "coming soon" ones when several are in range.
    const score = d - (it.kind === 'sell_fish' ? (save.cooler.length ? 14 : 6) : it.kind === 'moor_boat' ? 4 : 0);
    if (d < r && score < bd) { bd = score; best = it; }
  }
  return best;
}

function nearestHotspot(): { hs: Hotspot; d: number } | null {
  if (!world) return null;
  let best: Hotspot | null = null, bd = Infinity;
  for (const hs of world.gameplay.hotspots) {
    const d = Math.hypot(hs.pos[0] - boat.pos.x, hs.pos[2] - boat.pos.z);
    if (d < bd) { bd = d; best = hs; }
  }
  return best ? { hs: best, d: bd } : null;
}

function labelFor(it: Interact) {
  const p = UPG_LABEL[it.kind] ?? it.props?.prompt;
  if (typeof p === 'string' && p) return p;
  return KIND_LABEL[it.kind] ?? it.kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function doInteract(it: Interact) {
  switch (it.kind) {
    case 'sell_fish':
      openSell();
      break;
    case 'moor_boat':
      boat.moored = !boat.moored;
      boat.speed = 0;
      if (boat.moored) {
        save.boat = { x: boat.pos.x, z: boat.pos.z, yaw: boat.yaw, moored: true };
        save.worldTag = world?.source;
        writeSave(save);
        hud.noteMoored();
        hud.toast('Tied up snug. Progress saved.', 'good');
      } else hud.toast('Cast off!');
      break;
    case 'read_sunstone':
      hud.readSunstone(Number(it.props?.logbook_page), String(it.props?.poi ?? 'sun'));
      break;
    case 'read_message_bottle': case 'read_warning': case 'trade_rumours': {
      const pr = it.props ?? {};
      const text = (pr.rumour ?? pr.text ?? pr.trades) as string | undefined;
      if (text) hud.readNote(typeof pr.npc === 'string' ? pr.npc : it.kind === 'read_message_bottle' ? 'A bottle' : 'A sign', text);
      else hud.toast(`${labelFor(it)} — not open yet`);
      break;
    }
    default:
      if (!upg.doInteract(it)) hud.toast(`${labelFor(it)} — not open yet`);
  }
}

function openSell() {
  hud.showSell(save.cooler, (i) => sellFish([i]), currentInteract);
}
function sellFish(idx: number[]) {
  let total = 0;
  for (const i of [...idx].sort((a, b) => b - a)) {
    const f = save.cooler[i];
    if (!f) continue;
    total += f.price;
    save.cooler.splice(i, 1);
  }
  if (!total) return;
  save.shells += total;
  writeSave(save);
  // money never toasts: the SOLD stamp, flying Shells and the counter roll carry it
  hud.onSold(idx, total, save.cooler, () => { hud.setShells(save.shells); hud.renderCooler(save.cooler, save.coolerCap, true); });
}

function onLanded(fish: CaughtFish, sp: ReturnType<typeof lookupSpecies>, perfect: boolean) {
  pendingCatch = fish;
  const hs = fishing.hotspot;
  if (hs) wildlife?.onCatch(hs.pos[0], hs.pos[2]);
  pendingPerfect = perfect;
  const rec = save.records[fish.speciesId];
  const stamp = !rec ? 'NEW!' : fish.size > rec.size ? 'RECORD!' : null;
  hud.showCard(fish, sp, stamp, save.cooler.length >= save.coolerCap, perfect);
}
let pendingPerfect = false;
function closeCard(keep: boolean) {
  const f = pendingCatch;
  pendingCatch = null;
  hud.hideCard();
  fishing.finish();
  if (!f) return;
  const rec = save.records[f.speciesId] ?? { size: 0, stars: 0, count: 0 };
  save.records[f.speciesId] = { size: Math.max(rec.size, f.size), stars: Math.max(rec.stars, f.stars), count: rec.count + 1 };
  hud.logCatch(f, pendingPerfect);
  if (keep && !f.releaseOnly && save.cooler.length < save.coolerCap) {
    save.cooler.push(f);
    hud.renderCooler(save.cooler, save.coolerCap, true); // a full cooler shows on the strip, no toast
    hud.noteKept();
  } else hud.toast(`Let the ${f.name.toLowerCase()} go`);
  writeSave(save);
}

function onAction() {
  if (modalOpen || chase.inShot) return;
  if (ashoreOnAction && !fishing.active) { ashoreOnAction.run(); return; }
  if (fishing.active) { fishing.press(); return; }
  const near = nearestHotspot();
  // the button label already says why (Find ripples / Slow down / Cooler full): just shake it
  if (!near || near.d > HOTSPOT_RANGE) { hud.refuse(); return; }
  if (Math.abs(boat.speed) > CAST_MAX_SPEED) { hud.refuse(); return; }
  if (save.cooler.length >= save.coolerCap) { hud.refuse(); return; }
  if (!upg.canFish(near.hs)) { hud.refuse(); return; } // upgrades: rough water / line depth
  boat.speed = 0;
  fishing.cast(near.hs, rodTip(), boat.pos);
}
function rodTip() { return boat.root.localToWorld(new THREE.Vector3(0.45, 1.7, -0.6)); }

// ---------------------------------------------------------------- settings (rows live in the Log → Settings tab)
function refreshSettingsUI() {
  $('fps').classList.toggle('hidden', !save.settings.showFps);
}
function cycleTOD() {
  todIndex = (todIndex + 1) % Math.max(1, todKeys.length);
  save.settings.tod = todKeys[todIndex];
  writeSave(save);
  applyTOD();
}
hud.init({
  save,
  input,
  handlers: {
    setModal: (open) => { modalOpen = open; },
    keep: () => closeCard(true),
    release: () => closeCard(false),
    sellAll: () => sellFish(save.cooler.map((_, i) => i)),
    sellOne: (i) => sellFish([i]),
    closeSell: () => hud.hideSell(),
    quality: () => {
      save.settings.quality = save.settings.quality === 'high' ? 'low' : 'high';
      quality = QUALITY[save.settings.quality];
      resize();
      buildInstances();
      applyTOD();
      writeSave(save);
    },
    autoReel: () => { save.settings.autoReel = !save.settings.autoReel; fishing.autoReel = save.settings.autoReel; writeSave(save); },
    tod: () => cycleTOD(),
    fps: () => { save.settings.showFps = !save.settings.showFps; writeSave(save); refreshSettingsUI(); },
    reset: () => { clearSave(); location.reload(); },
  },
});
if (new URLSearchParams(location.search).has('debug')) { save.settings.showFps = true; }
refreshSettingsUI();
// Upgrades: chandlery, shipwright, boat tiers, paint/flags (src/game/progression, src/ui/shop|shipwright)
const upg = createUpgrades({
  save, boat: () => boat, world: () => world, land: () => land,
  playerPos: () => (foot.active ? foot.feet : boat.pos),
  toast: (m, k) => hud.toast(m, k), setShells: (n) => hud.setShells(n), renderCooler: () => hud.renderCooler(save.cooler, save.coolerCap, true),
  titleCard: (t, s) => hud.titleCard(t, s), openLog: (t) => hud.openLog(t as Parameters<typeof hud.openLog>[0]),
  snapCamera: () => { if (!foot.active) chase.snap(boat); },
});
initTuneOverlay();
mountSunShadingSetting();
mountWindSetting();
window.addEventListener('keydown', (e) => {
  if (e.key === 't' || e.key === 'T') cycleTOD();
  if (e.key === 'f' || e.key === 'F') { save.settings.showFps = !save.settings.showFps; refreshSettingsUI(); }
});

// ---------------------------------------------------------------- per-frame UI
let currentInteract: Interact | null = null;

function updateUI(dt: number) {
  const near = nearestHotspot();
  const canCast = !!near && near.d <= HOTSPOT_RANGE;
  currentInteract = fishing.active || foot.active ? null : nearestInteract();
  footCtx = fishing.active ? null : foot.active ? foot.context() : foot.boatContext(boat, currentInteract, save.cooler.length > 0);
  // When selling from the boat holds the context button, the idle Cast button offers "Ashore".
  ashoreOnAction = !fishing.active && !foot.active && !canCast && !footCtx ? foot.ashoreContext(boat) : null;
  if (landing && !save.reachedLanding && Math.hypot(landing.pos[0] - boat.pos.x, landing.pos[2] - boat.pos.z) < LANDING_REACHED) {
    save.reachedLanding = true;
    writeSave(save);
  }
  hud.frame(dt, {
    camera,
    boat,
    fishing,
    canCast,
    slowEnough: Math.abs(boat.speed) <= CAST_MAX_SPEED,
    coolerFull: save.cooler.length >= save.coolerCap,
    action: ashoreOnAction ? 'Ashore' : null,
    interact: footCtx ? { label: footCtx.label, kind: 'foot', pos: null } : currentInteract ? { label: boat.moored && currentInteract.kind === 'moor_boat' ? 'Untie' : labelFor(currentInteract), kind: currentInteract.kind, pos: currentInteract.pos } : null,
    errand: landing && !save.reachedLanding ? { name: 'Cedar Landing', pos: landing.pos } : null,
    throttle: input.throttle,
    inShot: chase.inShot,
  });
}

// ---------------------------------------------------------------- reveal shot
function maybeReveal() {
  if (save.seenReveal || !world || !landing || chase.inShot) return;
  const shot = world.gameplay.cameras?.find((c) => c.name === 'Shot_VillageReveal');
  if (!shot) return;
  if (Math.hypot(landing.pos[0] - boat.pos.x, landing.pos[2] - boat.pos.z) > REVEAL_TRIGGER) return;
  save.seenReveal = true;
  writeSave(save);
  chase.playShot(shot, 4.5);
  document.body.classList.add('cinematic');
  $('skip-hint').classList.remove('hidden');
}

// ---------------------------------------------------------------- culling
function cull() {
  if (!world) return;
  const cp = camera.position;
  const draw = (scene.fog as THREE.Fog).far + 80;
  for (const c of world.chunks) {
    const b = c.bounds;
    const dx = Math.max(b.min.x - cp.x, 0, cp.x - b.max.x), dz = Math.max(b.min.z - cp.z, 0, cp.z - b.max.z);
    c.object.visible = Math.hypot(dx, dz) < draw;
  }
  instances?.update(cp, draw, quality.small);
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fps = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  input.update();

  if (world && !hud.paused()) {
    const tapped = input.consumeTap();
    if (chase.inShot) {
      if (tapped || input.consumeAction()) chase.skipShot();
    }
    if (!chase.inShot && document.body.classList.contains('cinematic')) {
      document.body.classList.remove('cinematic');
      $('skip-hint').classList.add('hidden');
    }

    if (input.consumeAction() && !foot.active) onAction();
    if (input.consumeInteract() && !modalOpen && !fishing.active) {
      if (footCtx) footCtx.run();
      else if (currentInteract) doInteract(currentInteract);
    }

    let throttle = input.throttle, steer = input.steer;
    if (modalOpen || chase.inShot || foot.active) { throttle = 0; steer = 0; }
    if (fishing.active) {
      // Paddling away while waiting reels the line in; during the fight the boat holds still.
      if ((fishing.phase === 'casting' || fishing.phase === 'waiting' || fishing.phase === 'missed') && Math.abs(throttle) > 0.3) {
        fishing.cancel();
        hud.toast('Reeled in');
      } else { throttle = 0; steer = fishing.phase === 'reeling' ? 0 : steer * 0.5; }
    }
    if (boat.moored && Math.abs(throttle) > 0.3) { boat.moored = false; hud.toast('Cast off!'); }

    boat.update(dt, throttle, steer, land);
    fishing.update(dt, input.actionHeld, rodTip(), boat.pos);
    chase.focus = fishing.active && fishing.phase !== 'landed' ? fishing.bobber.position : null;
    if (foot.active) foot.update(dt, modalOpen || chase.inShot);
    else {
      chase.update(dt, boat, input.takeOrbit(), input.lastOrbitTime, land);
      foot.afterChase(dt);
      foot.boatTick(boat);
    }
    maybeReveal();
    sky.follow(camera.position);
    sea.update(dt, boat.pos);
    hotspotFX?.update(dt, camera.position, fishing.active ? fishing.hotspot : null);
    wildlife?.update(dt, camera.position, boat.pos);
    if (wildlife) wake.update(dt, boat, wildlife.splash);
    smoke?.update(dt, camera.position, boat.stackWorld(stackPos), Math.max(Math.abs(throttle), Math.abs(boat.speed) / BOAT_TUNING.maxSpeed));
    fogBanks?.update(dt, camera.position);
    floaters?.update(dt, camera.position);
    cull();
    updateUI(dt);
    upg.tick(dt, camera, window.innerHeight > window.innerWidth);
  }

  updateLighting(dt);
  renderer.render(scene, camera);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    fps = fpsFrames / fpsAcc;
    fpsAcc = 0; fpsFrames = 0;
    if (save.settings.showFps) {
      const info = renderer.info.render;
      $('fps').textContent = `${fps.toFixed(0)} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris`;
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
async function boot() {
  hud.setShells(save.shells);
  hud.renderCooler(save.cooler, save.coolerCap);
  await loadWorld(true);
  requestAnimationFrame(frame);
  await hud.loadingDone();
  // Poll for a (new) export; swap in live when READY appears or changes.
  setInterval(() => { if (!fishing.active && !modalOpen) loadWorld(false); }, 5000);
}
boot();

// ---------------------------------------------------------------- debug hook (automated tests)
declare global { interface Window { __debug: unknown } }
window.__debug = {
  get state() {
    return {
      world: world?.source, worldVersion, chunks: world?.chunks.length ?? 0, instances: instances?.count ?? 0,
      boat: { x: boat?.pos.x, z: boat?.pos.z, yaw: boat?.yaw, speed: boat?.speed, moored: boat?.moored },
      phase: fishing.phase, tension: fishing.tension, distance: fishing.distance, species: fishing.species?.name,
      shells: save.shells, cooler: save.cooler.map((f) => `${f.name} ${f.size}cm ${f.stars}★ ${f.price}`), fps: Math.round(fps),
      tod: todKeys[todIndex], nearestHotspot: nearestHotspot()?.hs.name, nearestHotspotDist: nearestHotspot()?.d,
      wildlife: wildlife ? { ...wildlife.birds.stats(), ms: +wildlife.cost.toFixed(3), squawks } : null,
      fx: { smokeEmitters: smoke?.emitterCount ?? 0, floaters: floaters?.count ?? 0, fogBanks: fogBanks?.mesh.visible ? fogBanks.mesh.count : 0 },
      interact: footCtx?.name ?? currentInteract?.name, foot: foot.debugState, inShot: chase.inShot, drawCalls: renderer.info.render.calls, tris: renderer.info.render.triangles,
    };
  },
  key: (k: string, down: boolean) => input.setKey(k, down),
  teleport: (x: number, z: number, yaw = boat.yaw) => { const f = land.nearestFree(x, z, 1.1); boat.place(f.x, f.z, yaw); chase.snap(boat); },
  teleportTo: (name: string, offset = 6) => {
    const all = [...(world?.gameplay.hotspots ?? []), ...(world?.gameplay.interacts ?? [])];
    const t = all.find((h) => h.name === name || h.name.includes(name));
    if (!t) return false;
    const f = land.nearestFree(t.pos[0] + offset, t.pos[2] + offset, 1.1);
    boat.place(f.x, f.z, Math.atan2(-(t.pos[0] - f.x), -(t.pos[2] - f.z)));
    chase.snap(boat);
    return true;
  },
  action: () => onAction(),
  interact: () => { if (footCtx) { footCtx.run(); return footCtx.name; } if (currentInteract) doInteract(currentInteract); return currentInteract?.name; },
  // on-foot test hooks
  stepAshore: () => foot.stepAshore(boat),
  board: () => foot.board(),
  footWalkTo: (x: number | null, z = 0) => foot.setAutoWalk(x, z),
  footPathTo: (x: number, z: number) => foot.setAutoPath(x, z),
  footCam: FOOT_CAM,
  footTeleport: (x: number, z: number, y = 3) => { if (!foot.active) return false; foot.restore({ x, y, z, yaw: foot.yaw }); return foot.debugState; },
  footProbe: (x: number, z: number, y = 3, up = 3, down = 6) => foot.world.groundAt(x, z, y, up, down),
  footPush: (x: number, z: number, y: number) => foot.world.pushOut(new THREE.Vector3(x, y, z), 0.28, 1.65),
  footPushH: (x: number, z: number, y: number, h: number) => foot.world.pushOut(new THREE.Vector3(x, y, z), 0.28, h),
  forceBite: () => fishing.debugForceBite(),
  keep: () => closeCard(true),
  sellAll: () => sellFish(save.cooler.map((_, i) => i)),
  closeModals: () => { hud.hideSell(); hud.hideCard(); hud.closeLog(); },
  ui: hud.debug,
  upg: upg.debug,
  fishing,
  cycleTOD,
  setAutoReel: (on: boolean) => { fishing.autoReel = on; },
  skipShot: () => chase.skipShot(),
  markRevealSeen: () => { save.seenReveal = true; },
  resetSave: () => { clearSave(); Object.assign(save, loadSave()); hud.setShells(0); hud.renderCooler([], save.coolerCap); },
  hotspots: () => world?.gameplay.hotspots.map((h) => h.name),
  /** Hold a scripted camera (pos → target) for `dur` s; used by the wildlife capture. */
  shot: (pos: [number, number, number], target: [number, number, number], fov = 45, dur = 600) => chase.playShot({ name: 'debug', pos, target, fov }, dur),
  hotspotPos: (name: string) => world?.gameplay.hotspots.find((x) => x.name === name || x.name.includes(name))?.pos,
  forceDives: () => wildlife?.birds.forceDives(boat.pos.x, boat.pos.z) ?? 0,
  addSmoke: (x: number, y: number, z: number, kind = 'chimney', size = 1) => smoke?.addEmitter([x, y, z], size, kind),
  seaLife: () => wildlife?.sea.stats(),
  exciteBirds: () => wildlife?.onCatch(boat.pos.x, boat.pos.z),
  /** Park the boat `dist` m from a hotspot, facing it (for bird captures). */
  viewHotspot: (name: string, dist = 24, side = 0) => {
    const h = world?.gameplay.hotspots.find((x) => x.name === name || x.name.includes(name));
    if (!h) return false;
    for (let k = 0; k < 16; k++) {
      const a = side + (k * Math.PI) / 8;
      const x = h.pos[0] + Math.cos(a) * dist, z = h.pos[2] + Math.sin(a) * dist;
      if (land.hitsCircle(x, z, 1.5)) continue;
      boat.place(x, z, Math.atan2(-(h.pos[0] - x), -(h.pos[2] - z)));
      boat.speed = 0;
      chase.snap(boat);
      return true;
    }
    return false;
  },
  protoStats: () => {
    const out: Record<string, { tris: number; n: number; total: number; h: number }> = {};
    for (const [k, g] of world?.protos ?? []) {
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const n = world?.instances.protos[k]?.length ?? 0;
      out[k] = { tris, n, total: tris * n, h: +(g.boundingBox!.max.y - g.boundingBox!.min.y).toFixed(2) };
    }
    const chunkTris = world?.chunks.map((c) => { let t = 0; c.object.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3; }); return t; });
    const bd = world?.backdrops.map((c) => { let t = 0; c.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3; }); return t; });
    const boatBox = world?.boat ? new THREE.Box3().setFromObject(world.boat) : null;
    return { protos: out, chunkTris, backdropTris: bd, boatBox };
  },
};
