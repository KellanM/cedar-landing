import * as THREE from 'three';
import { Sky, Sea } from './render/environment';
import { buildShoreField } from './render/shorefield';
import type { SeaVariant } from './render/sea';
import { backdropHaze, setTint } from './render/materials';
import { InstanceField } from './render/instances';
import { makeTestFlag, mountSunShadingSetting, mountWindSetting, setLightingBlend, updateLighting } from './render/lighting';
import { setLineContext, setNpcRoster } from './game/onfoot/npclines';
import { DAY_REAL_MIN, LOOK_HOUR, START_HOUR, clockText, lookAt, lookWords, wrapHour, type ClockLook } from './game/clock';
import { flutterMat } from './render/materials';
import { buildPlaceholderWorld, placeholderBoat } from './world/placeholder';
import { checkReady, loadExportWorld } from './world/loader';
import type { Hotspot, Interact, LoadedWorld, TimeOfDay } from './world/types';
import { Input } from './game/input';
import { LandCollision } from './game/collision';
import { Boat, BOAT_TUNING } from './game/boat';
import { CAMERA_TUNING, ChaseCamera } from './game/camera';
import { Fishing } from './game/fishing';
import { HotspotFX, hideBakedHotspotMarkers } from './game/hotspots';
import { Skipper } from './game/skipper';
import { reduceMotion } from './ui/ctx';
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
import { NpcCrowd } from './game/npcs/npcs';
import { FOOT_CAM } from './game/onfoot/footcamera';
import { createUpgrades } from './game/progression/upgrades';
import { gameAudio, renderOffline, composePiece, surfaceFromColor } from './audio';

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
const sea = new Sea((new URLSearchParams(location.search).get('sea') ?? 'full') as SeaVariant);
scene.add(sky.mesh, sea.group);

const save: SaveData = loadSave();
let quality = QUALITY[save.settings.quality];
gameAudio.setVolumes(save.settings.music, save.settings.sound);
sea.setQuality(save.settings.quality);

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
// ---------------------------------------------------------------- fishing juice: actor clock (hit-stop / slow-mo)
// Freezes only the fishing actors (float, line, fish, splashes, skipper) — never the UI, sea or camera.
const actorClock = { scale: 1, until: 0, slowUntil: 0, slow: 1 };
function hitStop(ms: number) { actorClock.until = Math.max(actorClock.until, performance.now() + ms); }
function slowMo(ms: number, k: number) { if (reduceMotion()) return; actorClock.slowUntil = performance.now() + ms; actorClock.slow = k; }
function actorScale(now: number) { return now < actorClock.until ? 0.04 : now < actorClock.slowUntil ? actorClock.slow : 1; }
const fv = new THREE.Vector3();
const fishing = new Fishing({
  toast: (m, k) => hud.toast(m, k),
  bite: () => { hud.onBite(); chase.shake(0.12); gameAudio.bite(); },
  nibble: () => { hud.onNibble(); gameAudio.nibble(); },
  slip: () => { hud.onSlip(); chase.shake(0.2); gameAudio.slip(); },
  landed: (fish, sp, perfect) => onLanded(fish, sp, perfect),
  // hook-set: hit-stop scaled by rarity + a punch toward the float + a little trauma
  strike: (x, z, r) => { hitStop(55 + 15 * r); chase.punch(fv.set(x, 0, z)); chase.shake(0.22 * r); gameAudio.strike(x, z, r); },
  thrash: (x, z, _pull, r) => { chase.shake(0.1 * r); gameAudio.thrash(x, z, r); },
  leap: (x, z, r) => { chase.punch(fv.set(x, 0.8, z), 0.18, 1.5); if (r >= 1.5) slowMo(240, 0.4); gameAudio.leap(x, z, r); },
  breach: (x, z, r) => { chase.shake(0.08 * r); gameAudio.breach(x, z, r); },
});
// Audio (src/audio): nothing starts until the first tap / key (mobile autoplay rules).
gameAudio.attach();
fishing.autoReel = save.settings.autoReel;
scene.add(fishing.group);
// The skipper on deck (rod in hand) — feeds the rod tip and does the hold-up.
const skipper = new Skipper();
skipper.load().then(() => { if (boat) skipper.attachTo(boat.modelObject); });
// UI hook: the catch bubble / slip / card wait for the "show it off" beat of the hold-up.
hud.catchHooks.holdUp = (fish) => {
  if (!skipper.attached) return;
  // Two-hand overhead "item get" for every catch (the baked hold_show pose puts a hand to the face).
  skipper.showRod(false);
  skipper.pose('hold_hoist', 0.22);
  return new Promise<void>((res) => setTimeout(res, reduceMotion() ? 120 : 650));
};

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
/** game clock (hours) and the current blend of time-of-day looks */
let clockHour = START_HOUR;
let look: ClockLook = { a: 'overcast', b: 'overcast', f: 0, key: 'overcast' };
let todTimer = 0;
const todBlend: TimeOfDay = { zenith: '', horizon: '', sea: '', haze: '', tint: [1, 1, 1] };
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
foot.onTalk = (name) => crowd?.react(name);
foot.onFootstep = (sp, feet, surf) => gameAudio.step(surfaceFromColor(surf, feet.y), sp);
foot.onSay = (name, text, role, x, z) => gameAudio.talk(name, text, role, x, z);
let footCtx: FootContext | null = null;
let ashoreOnAction: FootContext | null = null;

// ---------------------------------------------------------------- world
let crowd: NpcCrowd | null = null;
function disposeWorld() {
  crowd?.dispose();
  crowd = null;
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
  const removed = hideBakedHotspotMarkers(w.chunks.map((c) => c.object), w.gameplay.hotspots);
  if (removed) console.info(`[hotspots] collapsed ${removed} baked marker triangles (procedural marker replaces them)`);
  buildSeaField(w);
  hotspotFX = new HotspotFX(w.gameplay.hotspots);
  worldRoot.add(hotspotFX.group);
  buildWildlife();
  floaters = w.dynamic?.length ? new Floaters(w.dynamic) : null;
  if (floaters) worldRoot.add(floaters.group);
  // rigged NPCs (world/npcs.glb); older exports bake their NPCs into the chunks and have none
  crowd = w.npcs ? new NpcCrowd(w.npcs, w.gameplay.npcs ?? []) : null;
  if (crowd) scene.add(crowd.group); // not in worldRoot: the capture 'isolate' mode hides worldRoot only
  gameAudio.setWorld(w.gameplay.interacts, w.gameplay.birds ?? [], (w.gameplay.mammals ?? []) as { species?: string; kind?: string; pos?: number[] }[], (x, z, r) => !!land && land.hitsCircle(x, z, r));

  const model = upg.pickModel(w) ?? w.boat ?? placeholderBoat();
  if (!boat) { boat = new Boat(model); scene.add(boat.root); } else boat.setModel(model);
  skipper.attachTo(boat.modelObject);

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
  setNpcRoster(w.gameplay.npcs ?? []);
  if (save.onfoot && boat.moored && save.worldTag === w.source && !foot.active) foot.restore(save.onfoot);

  const ints = w.gameplay.interacts;
  landing = ints.find((i) => i.name === 'Interact_SellFish') ?? ints.find((i) => i.kind === 'sell_fish') ?? null;

  todKeys = Object.keys(w.gameplay.time_of_day);
  // the clock carries on from the save; old saves with a fixed look start at that look's hour
  clockHour = typeof save.clock === 'number' ? wrapHour(save.clock) : save.settings.tod && LOOK_HOUR[save.settings.tod] !== undefined ? LOOK_HOUR[save.settings.tod] : START_HOUR;
  applyTOD();

  fishing.cancel();
  hud.setWorld(w, { renderer, root: worldRoot, hide: [...w.backdrops, ...w.clouds], show: () => instances?.group.children ?? [] }, w.source === 'export' ? `export ${worldVersion.slice(0, 24)}` : 'placeholder');
  const badge = $('world-badge');
  badge.textContent = 'placeholder world — waiting for export';
  badge.classList.toggle('hidden', w.source !== 'placeholder');
}

/** Sea shore field (distance to shore + depth) from the chunks, once per world / quality change. */
let seaFieldInfo: { ms: number; res: [number, number] } | null = null;
function buildSeaField(w: LoadedWorld) {
  const f = buildShoreField(renderer, w.chunks, land, save.settings.quality === 'low' ? 512 : 1024, w.dynamic ?? []);
  sea.setShoreField(f);
  seaFieldInfo = f && { ms: +f.ms.toFixed(1), res: f.res };
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
  wildlife = new Wildlife(world.gameplay, land, save.settings.quality === 'low', world.chunks);
  wildlife.onSquawk = (x, _y, z, k) => { squawks++; gameAudio.squawk(x, z, k); };
  wildlife.mammals.onSound = (kind, x, z, sp) => gameAudio.mammal(kind, x, z, sp);
  worldRoot.add(wildlife.group);
  // smoke + fog banks are quality-dependent pools too
  for (const fx of [smoke?.mesh, fogBanks?.mesh]) if (fx) { fx.removeFromParent(); fx.geometry.dispose(); }
  smoke = new SmokeFX(world.gameplay.smoke, save.settings.quality === 'low');
  fogBanks = new FogBanks(save.settings.quality === 'low');
  scene.add(smoke.mesh, fogBanks.mesh);
}

const _ca = new THREE.Color(), _cb = new THREE.Color();
const mixHex = (a: string | undefined, b: string | undefined, f: number) => {
  if (!a) return b ?? '#000000';
  if (!b || f <= 0) return a;
  return '#' + _ca.set(a).lerp(_cb.set(b), f).getHexString();
};
function applyTOD() {
  if (!world) return;
  look = lookAt(clockHour, todKeys);
  const key = look.key;
  const A = world.gameplay.time_of_day[look.a], B = world.gameplay.time_of_day[look.b] ?? A;
  const f = look.f;
  todBlend.zenith = mixHex(A.zenith, B.zenith, f); todBlend.horizon = mixHex(A.horizon, B.horizon, f);
  todBlend.sea = mixHex(A.sea, B.sea, f); todBlend.haze = mixHex(A.haze, B.haze, f);
  todBlend.shallow = A.shallow || B.shallow ? mixHex(A.shallow ?? A.sea, B.shallow ?? B.sea, f) : undefined;
  todBlend.tint = [0, 1, 2].map((i) => A.tint[i] + (B.tint[i] - A.tint[i]) * f) as [number, number, number];
  const t = { ...(f < 0.5 ? A : B), ...todBlend } as typeof A;
  sky.apply(t);
  sea.apply(t, key);
  (scene.fog as THREE.Fog).color.set(t.haze);
  renderer.setClearColor(t.haze);
  setTint(t.tint);
  setLightingBlend(look.a, A as Parameters<typeof setLightingBlend>[1], look.b, B as Parameters<typeof setLightingBlend>[1], f);
  // fog weight blends with the clock (misty dawn thins into the grey morning)
  const w = (k: string) => (look.a === k ? 1 - f : 0) + (look.b === k ? f : 0);
  const fogW = /fog/i.test(look.a) || /fog/i.test(look.b) ? w(/fog/i.test(look.a) ? look.a : look.b) : 0;
  (scene.fog as THREE.Fog).near = THREE.MathUtils.lerp(quality.fogNear, 12, fogW);
  (scene.fog as THREE.Fog).far = THREE.MathUtils.lerp(quality.fogFar, 210, fogW);
  // low fog banks: full in the fog look, light morning wisps on overcast
  fogBanks?.set(fogW + w('overcast') * 0.25, t.haze);
  wake.setSea(t.sea);
  backdropHaze.value = THREE.MathUtils.lerp(quality.haze, 0.92, fogW);
  hud.setTOD(key, clockText(clockHour), lookWords(key));
  setLineContext(key, clockHour);
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
  gameAudio.landed(!rec || fish.rarity === 'rare' || fish.rarity === 'legendary');
  hud.showCard(fish, sp, stamp, save.cooler.length >= save.coolerCap, perfect);
}
let pendingPerfect = false;
function closeCard(keep: boolean) {
  const f = pendingCatch;
  pendingCatch = null;
  hud.hideCard();
  fishing.finish();
  chase.endLanding();
  skipper.showRod(true);
  if (!f) return;
  const rec = save.records[f.speciesId] ?? { size: 0, stars: 0, count: 0 };
  save.records[f.speciesId] = { size: Math.max(rec.size, f.size), stars: Math.max(rec.stars, f.stars), count: rec.count + 1 };
  hud.logCatch(f, pendingPerfect);
  if (keep && !f.releaseOnly && save.cooler.length < save.coolerCap) {
    gameAudio.keep();
    save.cooler.push(f);
    hud.renderCooler(save.cooler, save.coolerCap, true); // a full cooler shows on the strip, no toast
    hud.noteKept();
  } else { gameAudio.release(); hud.toast(`Let the ${f.name.toLowerCase()} go`); }
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
const tipV = new THREE.Vector3();
/** Rod tip: the skipper's rod when the rig is on deck; otherwise a point off the stern rail (troller, bow +X) or the canoe bow. */
function rodTip() {
  if (skipper.attached && !foot.active && skipper.rodTip(tipV)) return tipV;
  const m = boat.modelObject;
  if (m && m.name === 'BOAT_T0') { m.updateWorldMatrix(true, false); return tipV.set(-2.2, 2.6, 1.4).applyMatrix4(m.matrixWorld); }
  return boat.root.localToWorld(tipV.set(0.45, 1.7, -0.6));
}

const fishFace = new THREE.Vector3(), handsV = new THREE.Vector3(), headV = new THREE.Vector3(), fwdV = new THREE.Vector3(), leanV = new THREE.Vector3();
let landingShot = false;
/** Skipper pose + camera layers that follow the fishing state (runs after fishing.update). */
function fishingDirector(adt: number) {
  const ph = fishing.phase;
  chase.motion = !reduceMotion();
  // on deck only for the fishing minigame (cast → fight → hold-up); the boat sails unmanned otherwise
  skipper.root.visible = skipper.ready && !foot.active && !!skipper.root.parent && (fishing.active || !!pendingCatch);
  if (fishing.active && ph !== 'landed' && ph !== 'idle') swingStern(adt);
  if (fishing.active) {
    skipper.face = ph === 'landed' && fishing.handTarget ? fishFace.copy(camera.position) : fishFace.copy(ph === 'reeling' ? fishing.lineEnd : fishing.bobberPos);
    skipper.aimRod = ph !== 'landed';
    if (ph === 'casting') skipper.pose(fishingCastT < 0.22 ? 'cast_windup' : 'reel', fishingCastT < 0.22 ? 0.1 : 0.12);
    else if (ph !== 'landed') skipper.pose('reel');
    skipper.crank += ((ph === 'reeling' ? (fishing.reelHeld ? 1 : 0.15) : 0) - skipper.crank) * Math.min(1, adt * 8);
    skipper.strain += ((ph === 'reeling' ? fishing.tension : 0) - skipper.strain) * Math.min(1, adt * 6);
  } else {
    skipper.face = null;
    skipper.crank = 0; skipper.strain = 0;
    if (!pendingCatch) skipper.pose('stand', 0.3);
  }
  // the rod is in hand only while fishing (it rests in the holder otherwise; hidden in the hold-up)
  skipper.showRod(fishing.active && !(ph === 'landed' && fishing.handTarget));
  skipper.update(adt);
  // the fish flies to the hands (or the deck if there is no rig)
  fishing.handTarget = skipper.attached && ph === 'landed' ? skipper.hands(handsV) : null;
  if (fishing.handTarget) fishing.handTarget.y += 0.45; // held clear above the sou'wester (hand bones sit at the wrists)
  // camera: frame boat + float/fish; lean toward the pull side during a thrash
  chase.focus = fishing.active && ph !== 'landed' ? (ph === 'reeling' ? fishing.lineEnd : fishing.bobber.position) : null;
  chase.fishAt = ph === 'reeling' ? fishing.lineEnd : null;
  chase.fishAxis = fishing.active ? fishing.bobberPos : null;
  if (ph === 'reeling' && fishing.thrashing) {
    const dx = fishing.lineEnd.x - boat.pos.x, dz = fishing.lineEnd.z - boat.pos.z, l = Math.hypot(dx, dz) || 1;
    leanV.set(-dz / l * fishing.pull + dx / l * 0.5, 0, dx / l * fishing.pull + dz / l * 0.5);
    chase.lean(leanV.x, leanV.z);
  } else chase.lean(null);
  // hold-up shot once the fish is in hand
  if (ph === 'landed' && fishing.handTarget && !landingShot && skipper.head(headV)) {
    landingShot = true;
    fwdV.set(camera.position.x - headV.x, 0, camera.position.z - headV.z).normalize();
    chase.landing(headV, fwdV, fishing.handTarget);
  } else if (ph === 'landed' && !fishing.handTarget && !landingShot) {
    landingShot = true; // no rig: keep the chase view
  }
  if (!fishing.active) { landingShot = false; swingSide = 0; }
}
let fishingCastT = 0;
/** While fishing, the boat slowly swings so the float sits abaft the beam (≈105° off the bow):
 *  the skipper fishes off the stern quarter and the cabin never hides the line. */
const STERN_BEARING = 105 * Math.PI / 180;
let swingSide = 0;
function swingStern(adt: number) {
  const dx = fishing.bobberPos.x - boat.pos.x, dz = fishing.bobberPos.z - boat.pos.z;
  if (Math.hypot(dx, dz) < 1) return;
  const b = Math.atan2(-dx, -dz); // yaw that points the bow at the float
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  if (!swingSide) swingSide = wrap(boat.yaw - b) >= 0 ? 1 : -1;
  const d = wrap(b + swingSide * STERN_BEARING - boat.yaw);
  boat.yaw += Math.sign(d) * Math.min(Math.abs(d), 0.45 * adt * Math.min(1, Math.abs(d) * 2 + 0.2));
}

// ---------------------------------------------------------------- settings (rows live in the Log → Settings tab)
function refreshSettingsUI() {
  $('fps').classList.toggle('hidden', !save.settings.showFps);
}
/** Debug: jump the clock to the next look's hour. */
function cycleTOD() {
  const order = ['fog', 'overcast', 'sunbreak', 'dusk', 'night'].filter((k) => todKeys.includes(k));
  const next = order[(order.indexOf(look.key) + 1) % Math.max(1, order.length)] ?? look.key;
  clockHour = LOOK_HOUR[next] ?? clockHour;
  save.clock = clockHour;
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
      sea.setQuality(save.settings.quality);
      if (world) buildSeaField(world);
      applyTOD();
      writeSave(save);
    },
    autoReel: () => { save.settings.autoReel = !save.settings.autoReel; fishing.autoReel = save.settings.autoReel; writeSave(save); },
    tod: () => cycleTOD(),
    fps: () => { save.settings.showFps = !save.settings.showFps; writeSave(save); refreshSettingsUI(); },
    volume: (which, v) => { save.settings[which] = Math.min(1, Math.max(0, v)); writeSave(save); gameAudio.setVolumes(save.settings.music, save.settings.sound); },
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
/** Test hooks: a fixed-step clock (captures step exact frames) and a camera override. */
let stepClock: { dt: number; steps: number } | null = null;
let debugCam: { pos?: THREE.Vector3; target?: THREE.Vector3; follow?: { side: number; back: number; up: number; look: number }; fov: number; near: number } | null = null;
function applyDebugCam() {
  const d = debugCam;
  if (!d) return;
  if (d.follow && foot.active) {
    const f = foot.feet, y = foot.yaw, fx = -Math.sin(y), fz = -Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y);
    camera.position.set(f.x + rx * d.follow.side - fx * d.follow.back, f.y + d.follow.up, f.z + rz * d.follow.side - fz * d.follow.back);
    camera.lookAt(f.x, f.y + d.follow.look, f.z);
  } else if (d.pos && d.target) { camera.position.copy(d.pos); camera.lookAt(d.target); }
  if (camera.fov !== d.fov || camera.near !== d.near) { camera.fov = d.fov; camera.near = d.near; camera.updateProjectionMatrix(); }
}
function frame(now: number) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (stepClock) { if (stepClock.steps > 0) { stepClock.steps--; dt = stepClock.dt; } else dt = 0; }
  input.update();

  if (world && !hud.paused()) {
    // the day turns while you play (paused in the Log, shops and menus)
    if (!modalOpen && dt > 0) {
      clockHour = wrapHour(clockHour + (dt * 24) / (DAY_REAL_MIN * 60));
      save.clock = clockHour;
      todTimer += dt;
      if (todTimer > 0.5) { todTimer = 0; applyTOD(); }
    }
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
    lastThrottle = 0;
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
    lastThrottle = throttle;
    const adt = dt * actorScale(now);
    fishingCastT = fishing.phase === 'casting' ? fishingCastT + adt : 0;
    fishing.update(adt, input.actionHeld, rodTip(), boat.pos, camera.position);
    fishingDirector(adt);
    if (foot.active) foot.update(dt, modalOpen || chase.inShot);
    else {
      chase.update(dt, boat, input.takeOrbit(), input.lastOrbitTime, land);
      foot.afterChase(dt);
      foot.boatTick(boat);
    }
    maybeReveal();
    sky.follow(camera.position);
    sea.reduceMotion = reduceMotion();
    sea.update(dt, boat.pos, camera);
    hotspotFX?.update(dt, camera.position, fishing.active ? fishing.hotspot : null, fishing.active && fishing.phase !== 'reeling' && fishing.phase !== 'landed' ? fishing.bobber.position : null);
    wildlife?.update(dt, camera.position, boat.pos);
    if (wildlife) wake.update(dt, boat, wildlife.splash);
    smoke?.update(dt, camera.position, boat.stackWorld(stackPos), Math.max(Math.abs(throttle), Math.abs(boat.speed) / BOAT_TUNING.maxSpeed));
    fogBanks?.update(dt, camera.position);
    floaters?.update(dt, camera.position);
    crowd?.update(dt, camera.position, foot.active ? foot.feet : null);
    cull();
    updateUI(dt);
    upg.tick(dt, camera, window.innerHeight > window.innerWidth);
  }

  updateLighting(dt);
  applyDebugCam();
  renderer.render(scene, camera);
  if (world && boat) audioFrame(dt);

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

// ---------------------------------------------------------------- audio frame
let lastThrottle = 0;
const camDir = new THREE.Vector3();
function audioFrame(dt: number) {
  camera.getWorldDirection(camDir);
  const bp = fishing.bobberPos;
  gameAudio.frame(dt, {
    cam: { x: camera.position.x, z: camera.position.z, yaw: Math.atan2(-camDir.x, -camDir.z) },
    boat: { x: boat.pos.x, z: boat.pos.z, speed: boat.speed, maxSpeed: BOAT_TUNING.maxSpeed, throttle: lastThrottle, moored: boat.moored, heavy: boat.modelObject?.name === 'BOAT_T1' },
    onFoot: foot.active,
    feet: foot.active ? { x: foot.feet.x, z: foot.feet.z } : undefined,
    tod: look.key,
    fishing: { phase: fishing.phase, tension: fishing.tension, reelHeld: fishing.reelHeld, thrashing: fishing.thrashing, distance: fishing.distance, bobber: { x: bp.x, z: bp.z } },
  });
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
      tod: look.key, clock: clockText(clockHour), nearestHotspot: nearestHotspot()?.hs.name, nearestHotspotDist: nearestHotspot()?.d,
      wildlife: wildlife ? { ...wildlife.birds.stats(), mammals: wildlife.mammals.count, blows: wildlife.mammals.blows.count, ms: +wildlife.cost.toFixed(3), squawks } : null,
      fx: { smokeEmitters: smoke?.emitterCount ?? 0, floaters: floaters?.count ?? 0, fogBanks: fogBanks?.mesh.visible ? fogBanks.mesh.count : 0 },
      interact: footCtx?.name ?? currentInteract?.name, foot: foot.debugState, npcAnim: crowd ? { ...crowd.stats, ms: +crowd.stats.ms.toFixed(3) } : null, inShot: chase.inShot, seaField: seaFieldInfo, drawCalls: renderer.info.render.calls, tris: renderer.info.render.triangles,
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
  /** Freeze the sim clock (true) and step it in fixed 1/60 s ticks with advance(ms); false = real time. */
  clock: (fixed: boolean) => { stepClock = fixed ? { dt: 1 / 60, steps: 0 } : null; },
  advance: (ms: number) => { if (stepClock) stepClock.steps += Math.round(ms / (1000 * stepClock.dt)); return stepClock?.steps ?? -1; },
  stepsLeft: () => stepClock?.steps ?? 0,
  /** Hold the camera: { pos, target } world points, or follow the on-foot player { side, back, up, look }; null = normal. */
  cam: (c: { pos?: [number, number, number]; target?: [number, number, number]; follow?: { side: number; back: number; up: number; look: number }; fov?: number; near?: number } | null) => {
    if (!c) { debugCam = null; camera.fov = 55; camera.near = 0.3; camera.updateProjectionMatrix(); return; }
    // near > 0.3 clips foreground clutter (posts, walls) between a capture camera and its subject
    debugCam = { pos: c.pos && new THREE.Vector3(...c.pos), target: c.target && new THREE.Vector3(...c.target), follow: c.follow, fov: c.fov ?? 40, near: c.near ?? 0.3 };
  },
  footFace: (yaw: number) => { foot.yaw = yaw; },
  npcProbe: () => crowd?.actors.slice(0, 6).map((a) => {
    const out: Record<string, unknown> = { name: a.name, kind: a.kind, pos: a.pos.toArray().map((v) => +v.toFixed(2)) };
    a.root.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) { m.updateMatrixWorld(true); const bs = m.geometry.boundingSphere; out.mesh = { name: m.name, vis: m.visible, wpos: m.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)), bs: bs ? [bs.center.toArray().map((v) => +v.toFixed(2)), +bs.radius.toFixed(2)] : null, bones: m.skeleton.bones.length, hips: m.skeleton.bones[0].getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)) }; } });
    return out;
  }),
  /** Studio mode for animation captures: hide the scenery (collision still works), keep player + NPCs. */
  isolate: (on: boolean) => { worldRoot.visible = !on; },
  npcs: () => world?.gameplay.npcs?.map((n) => ({ name: n.name, pos: n.pos, rotY: n.rotY, role: n.props?.npc_role, pose: n.props?.npc_pose })),
  footTeleport: (x: number, z: number, y = 3) => { if (!foot.active) return false; foot.restore({ x, y, z, yaw: foot.yaw }); return foot.debugState; },
  footProbe: (x: number, z: number, y = 3, up = 3, down = 6) => foot.world.groundAt(x, z, y, up, down),
  footPush: (x: number, z: number, y: number) => foot.world.pushOut(new THREE.Vector3(x, y, z), 0.28, 1.65),
  footPushH: (x: number, z: number, y: number, h: number) => foot.world.pushOut(new THREE.Vector3(x, y, z), 0.28, h),
  forceBite: () => fishing.debugForceBite(),
  forceThrash: () => fishing.debugThrash(),
  /** Draw calls with each new fishing system hidden in turn (same frame, same view). */
  drawBreakdown: () => {
    const count = () => { renderer.render(scene, camera); return renderer.info.render.calls; };
    const all = count();
    const parts: Record<string, THREE.Object3D | undefined> = { fishing: fishing.group, skipper: skipper.root, hotspots: hotspotFX?.group };
    const out: Record<string, number> = { all };
    for (const [k, o] of Object.entries(parts)) { if (!o) continue; const v = o.visible; o.visible = false; out[k] = all - count(); o.visible = v; }
    return out;
  },
  /** GPU bench (water study): ms per synchronous render of the current view, with and without the sea. */
  benchFrame: (n = 60) => {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const time = () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); for (let i = 0; i < n; i++) renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t) / n; };
    time();
    const full = time();
    sea.group.visible = false;
    const noSea = time();
    sea.group.visible = true;
    return { full: +full.toFixed(3), noSea: +noSea.toFixed(3), sea: +(full - noSea).toFixed(3) };
  },
  seaFieldImage: () => sea.fieldImage(),
  seaObj: () => sea,
  /** slow the actor clock (captures): k = 1 normal */
  actorSlow: (k: number, ms = 60000) => { actorClock.slowUntil = performance.now() + ms; actorClock.slow = k; },
  skipperObj: () => skipper,
  /** captures (app icon etc.): override chase-camera tuning */
  camTune: (o: Partial<typeof CAMERA_TUNING>) => { Object.assign(CAMERA_TUNING, o); chase.snap(boat); },
  /** jump the game clock (hours) */
  setClock: (h: number) => { clockHour = wrapHour(h); save.clock = clockHour; applyTOD(); return clockText(clockHour); },
  skipperState: () => ({ ready: skipper.ready, attached: skipper.attached, pose: skipper.currentPose, landingK: chase.landingK }),
  keep: () => closeCard(true),
  sellAll: () => sellFish(save.cooler.map((_, i) => i)),
  closeModals: () => { hud.hideSell(); hud.hideCard(); hud.closeLog(); },
  ui: hud.debug,
  upg: upg.debug,
  /** Audio (src/audio): live state, forced music, and offline renders (WAV base64 + level stats). */
  audio: {
    state: () => gameAudio.state(),
    forceMusic: (v: 'day' | 'night' | 'dusk' | 'town') => gameAudio.forceMusic(v),
    setGap: (min: number, max: number) => gameAudio.setGap(min, max),
    render: (kind: string, secs: number, seed?: number) => renderOffline(kind, secs, seed),
    compose: (v: 'day' | 'night' | 'dusk' | 'town', seed: number) => { const p = composePiece(v, seed); return { ...p, events: p.events.length }; },
    volumes: (m: number, s: number) => gameAudio.setVolumes(m, s),
    /** footstep surface probe: vertex colour under (x,z) and its class */
    surface: (x: number, z: number, y = 2) => { const c = foot.world.surfaceColor(x, z, y); return { ...c, s: surfaceFromColor(c, y) }; },
  },
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
  mammals: () => wildlife?.mammals.stats(),
  mammalState: (q: string) => wildlife?.mammals.state(q),
  bringMammals: (q: string, x: number, z: number) => wildlife?.mammals.bring(q, x, z),
  /**
   * Captures: frame a marine-mammal group ('orca' | 'fluke' | 'dolphin' | 'porpoise' | 'haulout' | 'heads' |
   * 'lion' | 'otter') and trigger `action` ('surface' | 'breach' | 'spyhop' | 'taillob' | 'fluke' | 'wide' |
   * 'approach' | 'near' | 'idle' | 'boat' | 'track' = re-aim only).
   */
  viewMammals: (q: string, action = 'idle') => {
    const mf = wildlife?.mammals;
    if (!mf) return false;
    const whale = /orca|fluke|humpback|dolphin|porpoise/.test(q);
    if (whale && action !== 'track' && action !== 'boat') {
      // bring the pod in front of a free stretch of water near the boat's current spot
      const L0 = mf.locate(q);
      if (!L0) return false;
      if (Math.hypot(L0.x - boat.pos.x, L0.z - boat.pos.z) > 120) mf.bring(q, L0.x, L0.z);
    }
    if (['breach', 'spyhop', 'taillob'].includes(action)) mf.force(q, action, boat.pos);
    const L = mf.locate(q);
    if (!L) return false;
    const big = L.kind === 'orca' || L.kind === 'humpback';
    const side = L.yaw + Math.PI / 2;
    const special = ['breach', 'spyhop', 'taillob', 'fluke'].includes(action);
    const portrait = innerWidth < innerHeight ? 0.72 : 1; // phones: come closer, the frame is narrow
    const dist = portrait * (action === 'wide' ? 75 : big ? (action === 'surface' ? 34 : special ? 24 : 30) : L.kind === 'seal' ? 10 : L.kind === 'otter' ? 7 : 18);
    const lead = L.spd * (action === 'track' ? 0.6 : 2.2);
    const tx = L.x + Math.sin(L.yaw) * lead, tz = L.z + Math.cos(L.yaw) * lead;
    let px = tx + Math.sin(side) * dist, pz = tz + Math.cos(side) * dist;
    // camera over water with water between it and the animals (narrow coves)
    for (let k = 0; k < 16; k++) {
      const a = side + Math.ceil(k / 2) * 0.4 * (k % 2 ? -1 : 1);
      const cx = tx + Math.sin(a) * dist, cz = tz + Math.cos(a) * dist;
      if (!land.blocked(cx, cz) && !land.blocked((cx + tx) / 2, (cz + tz) / 2) && !land.blocked(cx * 0.75 + tx * 0.25, cz * 0.75 + tz * 0.25)) { px = cx; pz = cz; break; }
    }
    if (action === 'bowride') {
      // boat just behind the pod, heading the way the pod travels (its path ahead is open water)
      const f = land.nearestFree(L.x - Math.sin(L.yaw) * 22, L.z - Math.cos(L.yaw) * 22, 1.1);
      boat.place(f.x, f.z, L.yaw + Math.PI);
      boat.speed = 0;
      chase.snap(boat);
      chase.skipShot();
      mf.force(q, 'bowride', boat.pos);
      return true;
    }
    if (action !== 'track') {
      const bd = action === 'near' ? 6 : action === 'approach' ? 30 : action === 'boat' ? 70 : Math.max(dist + 25, big ? 85 : 30);
      const bs = action === 'near' ? side + 2.2 : side; // close boat comes in from another side (not in front of the lens)
      const f = land.nearestFree(tx + Math.sin(bs) * bd, tz + Math.cos(bs) * bd, 1.1);
      boat.place(f.x, f.z, Math.atan2(-(tx - f.x), -(tz - f.z)));
      boat.speed = 0;
      chase.snap(boat);
      if (action === 'boat') { chase.skipShot(); return true; }
    }
    const h = action === 'wide' ? 16 : big ? 5.5 : L.kind === 'otter' ? 1.8 : 3.6;
    const ty = action === 'spyhop' || action === 'breach' ? 2 : L.kind === 'seal' ? 0.6 : 0.3;
    chase.playShot({ name: 'debug', pos: [px, h, pz], target: [tx, ty, tz], fov: action === 'wide' ? 55 : 50 }, 600);
    if (action === 'surface' || action === 'fluke') mf.force(q, action, boat.pos);
    return { x: Math.round(L.x), z: Math.round(L.z), kind: L.kind };
  },
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
