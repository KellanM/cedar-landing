import * as THREE from 'three';
import { fishStudio, type StudioView } from './game/fishstudio';
import { Sky, Sea } from './render/environment';
import { buildShoreField } from './render/shorefield';
import type { SeaVariant, CrestMode } from './render/sea';
import { backdropHaze, setTint } from './render/materials';
import { InstanceField } from './render/instances';
import { makeTestFlag, setLightingBlend, setSunShading, setWind, sunShadingEnabled, windOn, updateLighting } from './render/lighting';
import { setLineContext, setNpcRoster } from './game/onfoot/npclines';
import { DAY_REAL_MIN, LOOK_HOUR, START_HOUR, clockText, lookAt, lookWords, mistAt, wrapHour, type ClockLook } from './game/clock';
import { flutterMat } from './render/materials';
import { buildPlaceholderWorld, placeholderBoat } from './world/placeholder';
import { checkReady, loadExportWorld } from './world/loader';
import type { Hotspot, Interact, LoadedWorld, TimeOfDay } from './world/types';
import { Input } from './game/input';
import { LandCollision } from './game/collision';
import { Boat, BOAT_TUNING } from './game/boat';
import { CAMERA_TUNING, ChaseCamera } from './game/camera';
import { cameraFrame, cameraSubject, smallThingCull } from './game/camerahooks';
import { updateSeeThrough } from './render/seethrough';
import { PhotoMode } from './ui/photo';
import { chart } from './ui/chart';
import { Fishing } from './game/fishing';
import { HotspotFX, hideBakedHotspotMarkers } from './game/hotspots';
import { Skipper } from './game/skipper';
import { CatchShow, planCatch, type CatchPlan } from './game/catchshow';
import { CatchFX } from './game/catchfx';
import { reduceMotion, type DevWeather, type DevMist, type DevTide } from './ui/ctx';
import { Wildlife } from './game/wildlife';
import { Floaters } from './game/floaters';
import { flotsamId, kindOf, noteFor, isGone } from './game/flotsam';
import { fx } from './ui/fx';
import { BoatWake } from './render/wake';
import { SmokeFX } from './render/smoke';
import { FogBanks } from './render/fogbanks';
import { RainFX, RAIN_TUNE, WIND_DIR } from './render/rain';
import { WIND as SMOKE_WIND } from './render/smoke';
import { WEATHER_TUNE, weatherAt, weatherKey, weatherStats, weatherWords, type WeatherNow } from './game/weather';
import { LIGHT_U, setLightingWeather } from './render/lighting';
import { ctx as uiCtx } from './ui/ctx';
import { SepiaTitle } from './render/sepia';
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
import { Tides } from './game/tides';
import { WATER, tideAt, tideTurns } from './game/tide';
import { Opening } from './game/opening/opening';
import { applyGear } from './game/progression/gear';
import { SWELL, SWELL_TUNE, snapSwell, swellStats, updateSwell, waterHeight } from './game/swell';

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
const sea = new Sea((new URLSearchParams(location.search).get('sea') ?? 'full') as SeaVariant, (new URLSearchParams(location.search).get('crests') ?? 'sprites') as CrestMode);
scene.add(sky.mesh, sea.group);

const save: SaveData = loadSave();
let quality = QUALITY[save.settings.quality];
gameAudio.setVolumes(save.settings.music, save.settings.sound);
sea.setQuality(save.settings.quality);
// Ocean experiment (docs/ocean_study.md): Log > Developer > Ocean, or ?ocean=swell|classic; default Classic
const OCEAN_KEY = 'salish-ocean';
let oceanMode: 'classic' | 'swell' = 'classic';
try { oceanMode = localStorage.getItem(OCEAN_KEY) === 'swell' ? 'swell' : 'classic'; } catch { /* private mode */ }
{ const q = new URLSearchParams(location.search).get('ocean'); if (q === 'swell' || q === 'classic') oceanMode = q; }
sea.setOcean(oceanMode);
/** title screen only: the harbour as a sepia drawing, colour blooming in on "set out" (off after) */
const sepia = new SepiaTitle();
sepia.setQuality(save.settings.quality);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (sepia.active) measurePlate();
}
/** the title's plate (the hole in the paper mount) in CSS px: the drawing's wash stops short of its edge */
function measurePlate() {
  const r = document.querySelector('.ld-plate')?.getBoundingClientRect();
  if (r) sepia.plate = { l: r.left, t: r.top, r: r.right, b: r.bottom };
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- game state
const input = new Input(canvas, $('btn-action'), $('btn-interact'));
const chase = new ChaseCamera(camera);
{
  // hold-up shot: is the boat (cabin roof, wheelhouse, stack) between the subject and the lens?
  const ray = new THREE.Raycaster(), dir = new THREE.Vector3();
  chase.blocked = (from, to) => {
    const m = boat?.modelObject;
    if (!m) return false;
    dir.copy(to).sub(from);
    const len = dir.length();
    ray.set(from, dir.normalize());
    ray.far = len;
    ray.near = 0.25; // skip the skipper's own hands / the fish at the start
    return ray.intersectObject(m, true).some((h) => !skipper.root.getObjectById(h.object.id) && (h.object as THREE.Mesh).isMesh && h.object.visible);
  };
}
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
  pullout: (fish, sp, perfect) => onPullout(fish, sp, perfect),
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
const bubbleV = new THREE.Vector3();
hud.catchHooks.bubbleAt = () => (fishing.phase === 'landed' && fishing.handTarget ? fishing.fishTop(bubbleV) : null);
hud.catchHooks.holdUp = (fish) => {
  if (!skipper.attached) return;
  // Big fish: two-hand overhead "item get"; small ones are shown in one hand by the face (hold_show).
  skipper.showRod(false);
  skipper.pose(fishing.holdMode === 'hand' ? 'hold_show' : 'hold_hoist', 0.22);
  return new Promise<void>((res) => setTimeout(res, reduceMotion() ? 120 : 650));
};

// ---------------------------------------------------------------- catch victory (docs/catch_study.md)
const catchFX = new CatchFX();
scene.add(catchFX.group);
const fishWorld = new THREE.Vector3(), cheerV = new THREE.Vector3();
let showStamp: 'NEW!' | 'RECORD!' | null = null;
const show = new CatchShow({
  pullout: (p) => {
    // legendary: the suspense swell runs until the reveal (the arc plus its slow-mo stretch)
    gameAudio.catchPullout(p.tier, p.arc.dur * (p.slow && !reduceMotion() ? 1.35 : 1));
    if (p.slow) setTimeout(() => { if (show.beat === 'arc') slowMo(620, 0.38); }, p.arc.dur * 0.3 * 1000);
    if (p.level >= 3) chase.shake(0.08 * p.level);
  },
  pose: () => {
    if (!skipper.attached) return;
    skipper.showRod(false);
    skipper.pose(fishing.holdMode === 'hand' ? 'hold_show' : 'hold_hoist', 0.22);
  },
  reveal: (p) => {
    const rm = reduceMotion();
    gameAudio.catchReveal(p.tier, { first: p.mods.first, pb: p.mods.pb, perfect: p.mods.perfect });
    hud.haptic(p.haptic);
    if (!rm) skipper.cheer(p.cheer);
    catchFX.calm = rm;
    fishing.fish.group.getWorldPosition(fishWorld);
    catchFX.burst(fishWorld, rm ? Math.ceil(p.sparks / 3) : p.sparks, 1.4 + 0.3 * p.level + fishing.shownLen, rm ? 0 : p.twinkle, 0.25 + fishing.shownLen * 0.6, 0.7 + 0.8 * Math.min(1.5, fishing.shownLen));
    if (p.confetti && skipper.head(cheerV)) catchFX.confetti(cheerV.setY(cheerV.y + 0.5), p.confetti, 0.8 + 0.2 * p.level);
    if (p.rays) catchFX.raysOnAt(fishWorld);
    if (p.flash && !rm && uiCtx.h?.flashes()) hud.catchFlash(p.flash);
    if (p.level >= 1) chase.punch(fishWorld, 0.1 + 0.06 * p.level, 1 + p.level);
    if (p.tier === 'quick') hud.catchBubble(p.fish, 3200);
  },
  head: (p, text) => hud.catchHead(text, p.tier),
  line: (p, text) => {
    const tags = [p.mods.first ? 'New' : '', p.mods.pb && !p.mods.first ? 'Record!' : '', p.mods.perfect ? 'Perfect' : ''].filter(Boolean);
    hud.catchLine(text, p.fish.name, { speciesId: p.fish.speciesId, size: p.fish.size, tags }, p.tier, p.cps);
  },
  result: (p) => {
    hud.hideCatchLine();
    catchFX.stop();
    if (p.mode === 'card') hud.killCatchBubble();
    hud.showCard(p.fish, p.species, showStamp, save.cooler.length >= save.coolerCap, p.mods.perfect, { direct: true, mode: p.mode, stamps: p.stamps });
  },
});
/** tap / Space anywhere during the show: straight to the card */
function skipShow(e: Event) {
  if (!show.active || show.beat === 'arc') return;
  if (e instanceof KeyboardEvent && ![' ', 'Enter', 'e', 'E', 'Escape'].includes(e.key)) return;
  if (show.skip()) e.preventDefault();
}
window.addEventListener('pointerdown', skipShow, { capture: true });
window.addEventListener('keydown', skipShow, { capture: true });

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
// Weather (docs/rain_study.md): rain streaks, sea marks, veils, lightning. One draw call per layer.
const rain = new RainFX(sea.uniforms);
rain.setQuality(save.settings.quality);
scene.add(rain.group);
const FLASH_KEY = 'salish-flashes';
let flashSetting: 'on' | 'off' = 'on';
try { flashSetting = localStorage.getItem(FLASH_KEY) === 'off' ? 'off' : 'on'; } catch { /* private mode */ }
let weatherNow: WeatherNow = { rain: 0, storm: 0, trend: 0, shower: false };
let rainOverride: number | null = null;
/** Developer tab selections (Log > Developer); 'auto' = the clock / weather / tide models decide */
const dev = { weather: 'auto' as DevWeather, mist: 'auto' as DevMist, tide: 'auto' as DevTide };
let stormOverride: number | null = null;
const SMOKE_WIND_BASE = SMOKE_WIND.clone();
rain.onStrike = (s) => {
  gameAudio.thunder(s.dist, s.near, s.x, s.z);
  if (s.near && !reduceMotion()) chase.shake(0.06);
};
const stackPos = new THREE.Vector3();
let squawks = 0;
let boat: Boat;
let landing: Interact | null = null; // Cedar Landing fish market (compass + reveal)
let todKeys: string[] = [];
/** game clock (hours) and the current blend of time-of-day looks */
let clockHour = START_HOUR;
let mistNow = 0;
let mistOverride: number | null = null;
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
// Photo mode (src/ui/photo.ts): HUD hidden, world held still, orbit / pinch, filters + frames, PNG out
const photo = new PhotoMode({
  camera,
  subject: (out) => (foot.active ? out.copy(foot.feet).setY(foot.feet.y + 1.1) : out.set(boat.pos.x, boat.root.position.y + 1.2, boat.pos.z)),
  canEnter: () => !!world && !!boat && !titleOpen && !modalOpen && !chase.inShot && !fishing.active && !pendingCatch,
  render: () => { renderer.render(scene, camera); return renderer.domElement; },
  waterY: () => WATER.y,
  clip: (from, dir, far) => (foot.active ? foot.world.raycast(from, dir, far) : far),
  place: () => {
    const p = foot.active ? foot.feet : boat.pos;
    let best = 'The Salish Sea', bd = Infinity;
    for (const pl of chart.places) { if (pl.kind !== 'town' && pl.kind !== 'island') continue; const d = Math.hypot(pl.x - p.x, pl.z - p.z); if (d < Math.max(260, pl.r * 1.5) && d < bd) { bd = d; best = pl.name; } }
    return best;
  },
}, canvas);
photo.mountButton();
/** the runner-up in reach (hud_flow_study P2): a second, smaller context button */
let footCtx2: FootContext | null = null;
// ---------------------------------------------------------------- tides (src/game/tides.ts)
// ?tide=<y> pins the water level (captures / tests at a fixed tide)
{ const t = new URLSearchParams(location.search).get('tide'); if (t !== null && t !== '' && isFinite(Number(t))) WATER.pinned = Number(t); }
const tides = new Tides({
  boat: () => boat, floaters: () => floaters, wildlife: () => wildlife, hotspots: () => hotspotFX?.group ?? null, crowd: () => crowd,
  wake, fishing, foot, toast: (m, k) => hud.toast(m, k), camera, renderer, save, writeSave: () => writeSave(save),
  note: (who, text) => { void hud.readNote(who, text); }, shells: (n) => hud.setShells(n), reduceMotion,
  peek: (x, y, z, r) => foot.cam.peek(new THREE.Vector3(x, y, z), r, () => modalOpen), // camera: look into the pool while its note is open
});

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
  opening.prepare(w); // opening: names the quests rely on (Mae)
  world = w;
  for (const c of w.chunks) worldRoot.add(c.object);
  tides.setWorld(w, worldRoot, worldVersion); // tides: intertidal bands on the chunks + tide-pool shelves
  for (const b of w.backdrops) worldRoot.add(b);
  for (const c of w.clouds) worldRoot.add(c);
  if (new URLSearchParams(location.search).has('flagtest')) worldRoot.add(makeTestFlag(flutterMat, w.gameplay.spawn.pos));
  buildInstances();

  land = new LandCollision(w.gameplay);
  const removed = hideBakedHotspotMarkers(w.chunks.map((c) => c.object), w.gameplay.hotspots);
  if (removed) console.info(`[hotspots] collapsed ${removed} baked marker triangles (procedural marker replaces them)`);
  buildSeaField(w);
  hotspotFX = new HotspotFX(w.gameplay.hotspots, new URLSearchParams(location.search).get('spot') === 'contour' ? 'contour' : 'boil');
  hotspotFX.useSea(sea.uniforms);
  worldRoot.add(hotspotFX.group);
  buildWildlife();
  floaters = w.dynamic?.length ? new Floaters(w.dynamic) : null;
  if (floaters) worldRoot.add(floaters.group);
  syncFlotsam();
  // rigged NPCs (world/npcs.glb); older exports bake their NPCs into the chunks and have none
  crowd = w.npcs ? new NpcCrowd(w.npcs, w.gameplay.npcs ?? []) : null;
  if (crowd) scene.add(crowd.group); // not in worldRoot: the capture 'isolate' mode hides worldRoot only
  gameAudio.setWorld(w.gameplay.interacts, w.gameplay.birds ?? [], (w.gameplay.mammals ?? []) as { species?: string; kind?: string; pos?: number[] }[], (x, z, r) => !!land && land.hitsCircle(x, z, r),
    (w.gameplay.npcs ?? []) as { pos?: number[]; props?: Record<string, unknown> }[], w.gameplay.spawn?.pos);

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
  tides.footWorld(foot.world, w.chunks); // tides: walk out on the tide-pool terraces
  setNpcRoster(w.gameplay.npcs ?? []);
  if (save.onfoot && boat.moored && save.worldTag === w.source && !foot.active) foot.restore(save.onfoot);
  opening.install(w); // opening: quests, props, boat stage, arrival

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
  if (land) land.extra = null; // tides: the field classifies against the exported grid alone
  // tides: water-surface decals (anim "surface") ring with foam like shore; floats and boats are extras (collars, cover)
  const dyn = w.dynamic ?? [];
  const f = buildShoreField(renderer, [...w.chunks, ...tides.fieldChunks], land, save.settings.quality === 'low' ? 512 : 1024, dyn.filter((o) => o.userData.anim !== 'surface'), undefined, dyn.filter((o) => o.userData.anim === 'surface'));
  sea.setShoreField(f);
  tides.setField(f, land); // tides: low-water land grid from the field's heights
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
/** the storm palette: a bruised grey-green (ACNH mauve-grey / WW dark teal, pulled into our muted sea) */
const STORM_SKY = { zenith: '#4c5754', horizon: '#76827c', haze: '#7b8781', sea: '#3c4b48', shallow: '#56655e' };
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
  // sea mist (game/clock.ts mistAt): always some, varying through the day and from day to day.
  // Heavy mist should feel like the dawn fog rolling in: the fog distance closes right down and, by
  // daylight, the sky / haze / sea take on the fog look's pale colours (nights stay dark).
  const w = (k: string) => (look.a === k ? 1 - f : 0) + (look.b === k ? f : 0);
  const lookFog = /fog/i.test(look.a) || /fog/i.test(look.b) ? w(/fog/i.test(look.a) ? look.a : look.b) : 0;
  mistNow = mistOverride ?? mistAt(clockHour, save.day ?? 0);
  const ss = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const mistK = 0.12 + 0.88 * ss(0.2, 0.88, mistNow); // 0.22 → light haze, 0.5 → ~half, 0.85+ → dawn-fog thick
  const fogW = Math.max(lookFog, mistK);
  const F = world.gameplay.time_of_day.fog;
  const dayF = Math.max(0, 1 - w('night') - 0.7 * w('dusk'));
  const tintK = F ? ss(0.5, 0.95, mistNow) * dayF * (1 - lookFog) * 0.9 : 0;
  if (tintK > 0 && F) {
    todBlend.zenith = mixHex(todBlend.zenith, F.zenith, tintK); todBlend.horizon = mixHex(todBlend.horizon, F.horizon, tintK);
    todBlend.haze = mixHex(todBlend.haze, F.haze, tintK); todBlend.sea = mixHex(todBlend.sea, F.sea, tintK * 0.6);
  }
  // weather (docs/rain_study.md): rain greys, darkens and flattens the whole frame (WW: one dark teal;
  // PNW drizzle: the distance goes grey); a storm pulls toward a bruised grey-green and closes in further
  weatherNow = weatherAt(clockHour, save.day ?? 0);
  if (stormOverride !== null) { weatherNow.storm = stormOverride; weatherNow.rain = Math.max(rainOverride ?? 0, stormOverride > 0 ? 0.75 + 0.25 * stormOverride : 0); }
  if (rainOverride !== null) weatherNow.rain = rainOverride;
  const R = weatherNow.rain, S = weatherNow.storm, nightK = w('night');
  if (R > 0.001 || S > 0.001) {
    const grey = (hex: string, k: number, dark: number) => {
      _ca.set(hex); const l = _ca.r * 0.3 + _ca.g * 0.55 + _ca.b * 0.15;
      return '#' + _ca.lerp(_cb.setRGB(l, l, l), k).multiplyScalar(1 - dark).getHexString();
    };
    todBlend.zenith = grey(mixHex(todBlend.zenith, todBlend.horizon, 0.35 * R), 0.55 * R, 0.16 * R);
    todBlend.horizon = grey(mixHex(todBlend.horizon, todBlend.haze, 0.3 * R), 0.5 * R, 0.1 * R);
    todBlend.haze = grey(todBlend.haze, 0.45 * R, 0.1 * R);
    todBlend.sea = grey(todBlend.sea, 0.3 * R, 0.14 * R);
    if (todBlend.shallow) todBlend.shallow = grey(todBlend.shallow, 0.35 * R, 0.14 * R);
    if (S > 0.001) {
      const dk = dayF * S;
      todBlend.zenith = mixHex(todBlend.zenith, STORM_SKY.zenith, 0.75 * dk); todBlend.horizon = mixHex(todBlend.horizon, STORM_SKY.horizon, 0.7 * dk);
      todBlend.haze = mixHex(todBlend.haze, STORM_SKY.haze, 0.7 * dk); todBlend.sea = mixHex(todBlend.sea, STORM_SKY.sea, 0.6 * dk);
      if (todBlend.shallow) todBlend.shallow = mixHex(todBlend.shallow, STORM_SKY.shallow, 0.5 * dk);
      const nd = 0.2 * S * nightK;
      todBlend.zenith = grey(todBlend.zenith, 0, nd); todBlend.haze = grey(todBlend.haze, 0, nd); todBlend.sea = grey(todBlend.sea, 0, nd);
    }
    // wet and dull: the world (decks, docks, roofs) a shade darker
    const wet = 1 - 0.09 * R - 0.06 * S;
    todBlend.tint = todBlend.tint.map((v) => v * wet) as [number, number, number];
  }
  const fogR = Math.min(0.85, Math.max(fogW, 0.5 * R + 0.3 * S));
  setLightingWeather(Math.min(1, R * 0.85), 1 + 1.5 * S + 0.2 * R);
  sea.rain = R; sea.storm = S;
  const t = { ...(f < 0.5 ? A : B), ...todBlend } as typeof A;
  sky.apply(t);
  sea.apply(t, key);
  (scene.fog as THREE.Fog).color.set(t.haze);
  renderer.setClearColor(t.haze);
  setTint(t.tint);
  setLightingBlend(look.a, A as Parameters<typeof setLightingBlend>[1], look.b, B as Parameters<typeof setLightingBlend>[1], f);
  (scene.fog as THREE.Fog).near = THREE.MathUtils.lerp(quality.fogNear, 12, fogR);
  (scene.fog as THREE.Fog).far = THREE.MathUtils.lerp(quality.fogFar, 210, fogR);
  rain.set(R, S, t.haze, nightK, (scene.fog as THREE.Fog).far);
  if (hotspotFX) hotspotFX.storm = S;
  if (boat) { boat.rough = S; boat.steady = boat.modelObject?.name === 'BOAT_T1'; }
  SMOKE_WIND.copy(SMOKE_WIND_BASE).multiplyScalar(1 + 1.6 * S);
  // low fog banks drift in with the mist (full in the fog look)
  fogBanks?.set(Math.max(lookFog, Math.min(1, mistK * 1.05)), t.haze);
  wake.setSea(t.sea);
  backdropHaze.value = THREE.MathUtils.lerp(quality.haze, 0.92, fogW);
  syncFlotsam();
  const wk = weatherKey(weatherNow);
  uiCtx.weather = wk ?? ''; uiCtx.weatherTrend = weatherNow.trend;
  hud.setTOD(key, clockText(clockHour), weatherWords(weatherNow) ?? lookWords(key), wk === 'storm' ? 'storm' : wk ? 'rain' : undefined);
  setLineContext(key, clockHour, wk ?? '');
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
      if (initial) hud.setLoadProgress(msg, f);
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
    if (it.kind === 'collect_flotsam' && flotsamGoneNow(it)) continue;
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

// ---------------------------------------------------------------- flotsam pick-up (game/flotsam.ts)
function flotsamGoneNow(it: Interact) { const id = flotsamId(it); return !!id && isGone(save.flotsam, id, save.day ?? 0); }
/** hide what's been collected, bring back what has drifted back (runs with the clock) */
function syncFlotsam() {
  if (!world || !floaters) return;
  for (const it of world.gameplay.interacts) {
    if (it.kind !== 'collect_flotsam') continue;
    const id = flotsamId(it);
    if (id) floaters.setGone(`LIFE_${id}_Flotsam`, isGone(save.flotsam, id, save.day ?? 0));
  }
}
function pickUpFlotsam(it: Interact) {
  const id = flotsamId(it);
  if (!id || flotsamGoneNow(it)) return;
  const key = `LIFE_${id}_Flotsam`;
  const kind = kindOf(floaters?.nameOf(key) ?? '');
  const note = noteFor(id);
  save.flotsam = { ...(save.flotsam ?? {}), [id]: kind.once || note ? -1 : save.day ?? 0 };
  save.shells += kind.shells;
  writeSave(save);
  floaters?.collect(key, boat.pos.clone().setY(1.2));
  gameAudio.leap(it.pos[0], it.pos[2], 0.6);
  fx('sell');
  hud.setShells(save.shells);
  hud.toast(`Hauled aboard ${kind.noun} · +${kind.shells} Shells`, 'good');
  if (note) setTimeout(() => hud.readNote(note.from, note.text), 650);
}

function doInteract(it: Interact) {
  if (opening.interact(it)) return; // opening: its own interacts, Gran's tab, the boat's repair stages
  switch (it.kind) {
    case 'collect_flotsam':
      pickUpFlotsam(it);
      break;
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

/** The fish leaves the water: plan the victory sequence (tier from rarity, firsts, records, perfect). */
function onPullout(fish: CaughtFish, sp: ReturnType<typeof lookupSpecies>, perfect: boolean) {
  if (debugPerfect !== null) perfect = debugPerfect;
  const rec = save.records[fish.speciesId];
  const mods = { first: !rec, pb: !!rec && fish.size > rec.size, perfect, count: rec?.count ?? 0 };
  showStamp = mods.first ? 'NEW!' : mods.pb ? 'RECORD!' : null;
  const plan: CatchPlan = planCatch(fish, sp, mods);
  fishing.landArc = plan.arc;
  fishing.forceHoist = plan.hoist;
  show.start(plan);
}
let debugPerfect: boolean | null = null;

function onLanded(fish: CaughtFish, _sp: ReturnType<typeof lookupSpecies>, perfect: boolean) {
  pendingCatch = fish;
  const hs = fishing.hotspot;
  if (hs) wildlife?.onCatch(hs.pos[0], hs.pos[2]);
  pendingPerfect = debugPerfect ?? perfect;
  show.caught();
}
let pendingPerfect = false;
function closeCard(keep: boolean, swapOut = -1) {
  const f = pendingCatch;
  pendingCatch = null;
  hud.hideCard();
  hud.hideCatchLine();
  show.reset();
  catchFX.clear();
  fishing.finish();
  chase.endLanding();
  skipper.showRod(true);
  if (!f) return;
  const rec = save.records[f.speciesId] ?? { size: 0, stars: 0, count: 0 };
  save.records[f.speciesId] = { size: Math.max(rec.size, f.size), stars: Math.max(rec.stars, f.stars), count: rec.count + 1 };
  hud.logCatch(f, pendingPerfect);
  // full cooler (P3): swap the new fish in for the one the player chose to give back
  const swapped = keep && !f.releaseOnly && save.cooler.length >= save.coolerCap && swapOut >= 0 && save.cooler[swapOut] ? save.cooler.splice(swapOut, 1)[0] : null;
  if (keep && !f.releaseOnly && save.cooler.length < save.coolerCap) {
    gameAudio.keep();
    save.cooler.push(f);
    hud.renderCooler(save.cooler, save.coolerCap, true); // a full cooler shows on the strip, no toast
    hud.noteKept();
    if (swapped) hud.toast(`Swapped in the ${f.name.toLowerCase()} · let the ${swapped.name.toLowerCase()} go`, 'good');
  } else { gameAudio.release(); hud.toast(`Let the ${f.name.toLowerCase()} go`); }
  writeSave(save);
}

function onAction() {
  if (modalOpen || chase.inShot) return;
  if (fishing.active) { fishing.press(); return; }
  const near = nearestHotspot();
  // the button label already says why (Find ripples / Slow down / Cooler full): just shake it
  if (!near || near.d > HOTSPOT_RANGE) { hud.refuse(); return; }
  if (Math.abs(boat.speed) > CAST_MAX_SPEED) { hud.refuse(); return; }
  // a full cooler doesn't stop the fishing (P3): the catch card offers a swap or a let-go
  if (!upg.canFish(near.hs)) { hud.refuse(); return; } // upgrades: rough water / line depth
  if (!opening.canCast()) { hud.refuse(); hud.toast("Gran's tackle is still somewhere along the beach", 'warn'); return; }
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

const headPosV = new THREE.Vector3();
const fishFace = new THREE.Vector3(), handsV = new THREE.Vector3(), headV = new THREE.Vector3(), fwdV = new THREE.Vector3(), leanV = new THREE.Vector3();
let landingShot = false, reframed = false;
const landFwd = new THREE.Vector3();
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
  // two-hand hold: the fists close in to cradle a short fish (about half its drawn length apart)
  skipper.gripSpread = ph === 'landed' && fishing.holdMode === 'hoist' ? Math.max(0.3, 0.5 * fishing.shownLen + 0.08) : null;
  skipper.update(adt);
  // the fish flies to the hands (or the deck if there is no rig)
  // grip point: both wrists (hoist) or the raised right wrist (one-hand hold); fishing.placeHeld rests
  // the fish on the fists / in the hand from there, using the model's own belly depth
  const oneHand = fishing.holdMode === 'hand';
  fishing.handTarget = skipper.attached && ph === 'landed' ? (oneHand ? skipper.hand('R', handsV) : skipper.hands(handsV)) : null;
  fishing.headPos = fishing.handTarget ? skipper.head(headPosV) : null;
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
  // the camera orbits in while the fish is in the air and arrives as it lands (study F2: the fish's
  // arc stays in frame; the reveal then adds a punch and the slow creep-in)
  if (ph === 'landed' && fishing.handTarget && !landingShot && skipper.head(headV)) {
    landingShot = true;
    fwdV.set(camera.position.x - headV.x, 0, camera.position.z - headV.z).normalize();
    landFwd.copy(fwdV);
    const P = show.plan;
    chase.cardSide = camera.aspect < 1 ? 0 : document.body.classList.contains('lefty') ? -1 : 1;
    const inT = P && show.beat === 'arc' ? P.arc.dur * (P.slow && !reduceMotion() ? 1.4 : 1) + 0.25 : 0.45;
    chase.landing(headV, fwdV, fishing.handTarget, fishing.shownLen, fishing.holdMode, P?.frame ?? 0, inT);
  } else if (ph === 'landed' && fishing.handTarget && landingShot && !reframed && show.beat !== 'arc' && skipper.head(headV)) {
    // the reveal: re-aim at the hold pose (the shot above was framed on the reel pose at the pull-out)
    reframed = true;
    const P = show.plan;
    chase.landing(headV, landFwd, fishing.handTarget, fishing.shownLen, fishing.holdMode, P?.frame ?? 0, 0.45);
  } else if (ph === 'landed' && !fishing.handTarget && !landingShot) {
    landingShot = true; // no rig: keep the chase view
  }
  if (!fishing.active) { landingShot = false; reframed = false; swingSide = 0; }
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
    swap: (i) => closeCard(true, i),
    sellAll: () => sellFish(save.cooler.map((_, i) => i)),
    sellOne: (i) => sellFish([i]),
    closeSell: () => hud.hideSell(),
    quality: () => {
      save.settings.quality = save.settings.quality === 'high' ? 'low' : 'high';
      quality = QUALITY[save.settings.quality];
      resize();
      buildInstances();
      sea.setQuality(save.settings.quality);
      rain.setQuality(save.settings.quality);
      sepia.setQuality(save.settings.quality);
      if (world) buildSeaField(world);
      applyTOD();
      writeSave(save);
    },
    autoReel: () => { save.settings.autoReel = !save.settings.autoReel; fishing.autoReel = save.settings.autoReel; writeSave(save); },
    tod: () => cycleTOD(),
    fps: () => { save.settings.showFps = !save.settings.showFps; writeSave(save); refreshSettingsUI(); },
    flashes: (on?: boolean) => { if (on !== undefined) { flashSetting = on ? 'on' : 'off'; try { localStorage.setItem(FLASH_KEY, flashSetting); } catch { /* ignore */ } } return flashSetting === 'on'; },
    dev: {
      state: () => ({
        weather: dev.weather, mist: dev.mist, tide: dev.tide, clock: clockText(clockHour), day: save.day ?? 0,
        weatherWords: weatherWords(weatherNow) ?? lookWords(look.key), tideLevel: +WATER.y.toFixed(2), tideTrend: WATER.rate >= 0 ? 'rising' : 'falling', mistNow: +mistNow.toFixed(2),
        sunShading: sunShadingEnabled(), wind: windOn(), fps: save.settings.showFps,
        ocean: sea.ocean, seaState: +SWELL.state.toFixed(2),
      }),
      weather: (v) => {
        dev.weather = v;
        const W = { auto: [null, null], clear: [0, 0], drizzle: [0.3, 0], rain: [0.8, 0], storm: [1, 1] } as const;
        [rainOverride, stormOverride] = W[v] as [number | null, number | null];
        applyTOD();
      },
      mist: (v) => { dev.mist = v; mistOverride = ({ auto: null, light: 0.22, medium: 0.5, heavy: 0.9 } as const)[v]; applyTOD(); },
      tide: (v) => { dev.tide = v; WATER.pinned = ({ auto: null, high: 0, mid: -0.85, low: -1.45, lowest: -1.72 } as const)[v]; tides.frame(0, clockHour, save.day ?? 0); applyTOD(); },
      clock: (h) => { clockHour = wrapHour(h); save.clock = clockHour; writeSave(save); applyTOD(); },
      nextDay: () => { save.day = (save.day ?? 0) + 1; writeSave(save); applyTOD(); },
      lightning: (near) => { rain.strike(near, camera); },
      sunShading: (on) => setSunShading(on),
      ocean: (v) => { sea.setOcean(v); try { localStorage.setItem(OCEAN_KEY, v); } catch { /* ignore */ } },
      wind: (on) => setWind(on),
      shells: (n) => { save.shells += n; writeSave(save); hud.setShells(save.shells); },
    },
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
  modelChanged: () => skipper.attachTo(boat.modelObject),
});
// The opening (src/game/opening): mail-boat arrival → Gran's logbook → beach tackle → the fixer-upper → … → Gran's tab
const opening = new Opening({
  scene, save, writeSave: () => writeSave(save), boat: () => boat, foot,
  restoreBoatModel: () => { const m = world ? upg.pickModel(world) : null; if (m) { boat.setModel(m); skipper.attachTo(boat.modelObject); } },
  setBoatModel: (m) => { boat.setModel(m); skipper.attachTo(boat.modelObject); },
  toast: (m, k) => hud.toast(m, k), note: (who, text) => hud.readNote(who, text),
  ask: (who, text, choices) => hud.dialogue([{ who, text, choices }]),
  titleCard: (t, s) => hud.titleCard(t, s), setShells: (n) => hud.setShells(n),
  drizzle: (on) => { rainOverride = on ? 0.3 : dev.weather === 'auto' ? null : rainOverride; applyTOD(); },
  setClock: (h) => { clockHour = wrapHour(h); save.clock = clockHour; applyTOD(); },
  reduceMotion, busy: () => modalOpen || !!uiCtx.modal || uiCtx.title || chase.inShot || titleOpen || fishing.active,
  passThrough: (it) => { upg.doInteract(it); },
  giveLure: (id) => { const u = save.upg!; const g = `lure_${id}`; if (!u.baits.includes(g)) u.baits.push(g); u.bait = g; applyGear(save); writeSave(save); },
});
initTuneOverlay();
// P6: a reload the player asked for (Log or update notice) keeps what they have
window.addEventListener('ui:beforeupdate', () => writeSave(save));
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
  footCtx = fishing.active ? null : foot.active ? (tides.poolContext() ?? foot.context()) : foot.boatContext(boat, currentInteract, save.cooler.length > 0);
  // P2/P8: the big circle always means fishing. "Ashore" is a context action: the main button when
  // nothing else is in reach, otherwise the second, smaller one beside it.
  footCtx2 = null;
  if (!fishing.active) {
    if (foot.active) footCtx2 = tides.poolContext() ? foot.context() : foot.context2();
    else if (!footCtx && currentInteract) footCtx2 = foot.ashoreContext(boat);
  }
  hud.setSecondary(footCtx2 && !modalOpen ? () => { if (!modalOpen && !fishing.active) footCtx2?.run(); } : null);
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
    action: null,
    interact: footCtx ? { label: footCtx.label, kind: footCtx.kind ?? (footCtx.name === 'step_ashore' ? 'step_ashore' : 'foot'), pos: null, tag: footCtx.pos ?? null } : currentInteract ? { label: boat.moored && currentInteract.kind === 'moor_boat' ? 'Untie' : labelFor(currentInteract), kind: currentInteract.kind, pos: currentInteract.pos } : null,
    interact2: footCtx2 ? { label: pillLabel(footCtx2), kind: footCtx2.kind ?? footCtx2.name, pos: footCtx2.pos ?? null } : null,
    errand: opening.compass() ?? (landing && !save.reachedLanding ? { name: 'Cedar Landing', pos: landing.pos } : null),
    throttle: input.throttle,
    inShot: chase.inShot,
  });
}

/** Second-button label: short, names who/what ("Talk · Crier", "Ashore", "Buy bait"). */
function pillLabel(c: FootContext) {
  const m = /^Talk to (?:The )?(.+)$/.exec(c.prompt);
  if (m) return `Talk · ${m[1]}`;
  return c.label.split(/\s+/).slice(0, 2).join(' ');
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

// ---------------------------------------------------------------- title camera
/**
 * Title screen (src/ui/loading.ts): a low, slow drift behind the moored boat looking out over the
 * harbour (boat in the lower third, sky up top for the lockup). On "set out" it eases into the
 * chase camera over TITLE_BLEND s. Gameplay input is discarded while the title is up.
 */
let titleOpen = false;
let titleT = 0, titleBlend = 1;
const TITLE_BLEND = 1.8;
const tPos = new THREE.Vector3(), tLook = new THREE.Vector3(), cPos = new THREE.Vector3(), cQ = new THREE.Quaternion(), cLook = new THREE.Vector3();
const tObj = new THREE.PerspectiveCamera(); // a camera, so lookAt aims -Z (an Object3D would face away)
let titleYaw = 0;
function titleCamera(dt: number) {
  if (titleOpen) titleT += dt; else if (titleBlend < 1) titleBlend = Math.min(1, titleBlend + dt / TITLE_BLEND); else return;
  // camera out over the water, off the boat's quarter, looking past it to open sea: boat low in
  // frame, horizon + islands beyond, sky at the top for the lockup
  const a = titleYaw + Math.sin(titleT * 0.09) * 0.12;
  // portrait frames tall (boat big, low); landscape's narrower vertical FOV needs a wider, flatter shot
  const portrait = camera.aspect < 1;
  const cam = a + (portrait ? 0.2 : 0.3), drift = Math.min(titleT, 30);
  const back = (portrait ? 15.5 : 19) - drift * 0.05, up = (portrait ? 4.6 : 4.3) + Math.sin(titleT * 0.13) * 0.35;
  tPos.set(boat.pos.x - Math.sin(cam) * back, up, boat.pos.z - Math.cos(cam) * back);
  tLook.set(boat.pos.x + Math.sin(a) * 12, portrait ? 1.6 : 3.6, boat.pos.z + Math.cos(a) * 12);
  const k = titleOpen ? 0 : titleBlend * titleBlend * (3 - 2 * titleBlend);
  cPos.copy(camera.position); cQ.copy(camera.quaternion);
  // swing around the boat (azimuth / distance / height), never through it
  const bx = boat.pos.x, bz = boat.pos.z;
  const azT = Math.atan2(tPos.x - bx, tPos.z - bz), azC = Math.atan2(cPos.x - bx, cPos.z - bz);
  const az = azT + Math.atan2(Math.sin(azC - azT), Math.cos(azC - azT)) * k;
  const d = THREE.MathUtils.lerp(Math.hypot(tPos.x - bx, tPos.z - bz), Math.hypot(cPos.x - bx, cPos.z - bz), k);
  camera.position.set(bx + Math.sin(az) * d, THREE.MathUtils.lerp(tPos.y, cPos.y, k), bz + Math.cos(az) * d);
  // aim: from the title's look point to where the chase camera looks (its forward ray at the boat's range)
  const cr = Math.hypot(cPos.x - bx, cPos.y - boat.pos.y, cPos.z - bz);
  cLook.set(0, 0, -1).applyQuaternion(cQ).multiplyScalar(cr).add(cPos);
  tObj.position.copy(camera.position); tObj.lookAt(tLook.lerp(cLook, k)); camera.quaternion.copy(tObj.quaternion);
}
/** Direction (azimuth, sin/cos convention x=sin, z=cos) of the longest open-water run from the boat. */
function openWaterYaw() {
  let best = 0, bestRun = -1;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    let run = 0;
    for (let d = 4; d <= 140; d += 4) { if (land.blocked(boat.pos.x + Math.sin(a) * d, boat.pos.z + Math.cos(a) * d)) break; run = d; }
    // the camera sits on the far side of this ray (a + 0.2–0.3 rad, behind the boat): it must be water too
    const ca = a + 0.25 + Math.PI;
    let ok = true;
    for (let d = 4; d <= 24; d += 4) if (land.blocked(boat.pos.x + Math.sin(ca) * d, boat.pos.z + Math.cos(ca) * d)) { ok = false; break; }
    const score = run + (ok ? 60 : 0);
    if (score > bestRun) { bestRun = score; best = a; }
  }
  return best;
}
function beginTitle() {
  titleOpen = true; titleT = 0; titleBlend = 0;
  titleYaw = openWaterYaw();
  sepia.begin();
  measurePlate();
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
  const realDt = dt;
  if (photo.active && photo.still) dt = 0; // photo mode: the world holds its breath
  input.update();

  if (world && !hud.paused()) {
    // the day turns while you play (paused in the Log, shops and menus)
    if (!modalOpen && dt > 0) {
      const nextHour = wrapHour(clockHour + (dt * 24) / (DAY_REAL_MIN * 60));
      if (nextHour < clockHour) save.day = (save.day ?? 0) + 1; // past midnight: a new day (new mist)
      clockHour = nextHour;
      save.clock = clockHour;
      todTimer += dt;
      if (todTimer > 0.5) { todTimer = 0; applyTOD(); }
    }
    if (titleOpen) { input.consumeTap(); input.consumeAction(); input.consumeInteract(); input.takeOrbit(); }
    const tapped = input.consumeTap();
    if (chase.inShot) {
      if (tapped || input.consumeAction()) chase.skipShot();
    }
    if (!chase.inShot && document.body.classList.contains('cinematic')) {
      document.body.classList.remove('cinematic');
      $('skip-hint').classList.add('hidden');
    }

    if (photo.active) { input.consumeAction(); input.consumeInteract(); input.takeOrbit(); }
    if (input.consumeAction() && !foot.active) onAction();
    if (input.consumeInteract() && !modalOpen && !fishing.active) {
      if (footCtx) footCtx.run();
      else if (currentInteract) doInteract(currentInteract);
    }

    let throttle = input.throttle, steer = input.steer;
    lastThrottle = 0;
    if (modalOpen || chase.inShot || foot.active || titleOpen || photo.active) { throttle = 0; steer = 0; }
    if (fishing.active) {
      // Paddling away while waiting reels the line in; during the fight the boat holds still.
      if ((fishing.phase === 'casting' || fishing.phase === 'waiting' || fishing.phase === 'missed') && Math.abs(throttle) > 0.3) {
        fishing.cancel();
        hud.toast('Reeled in');
      } else { throttle = 0; steer = fishing.phase === 'reeling' ? 0 : steer * 0.5; }
    }
    if (boat.moored && Math.abs(throttle) > 0.3) { boat.moored = false; hud.toast('Cast off!'); }

    updateSwell(dt, weatherNow, LIGHT_U.uWindDir.value, reduceMotion()); // ocean experiment: before anything reads the water
    boat.update(dt, throttle, steer, land);
    cameraFrame({ chase, foot, boat, world, tides, reduce: reduceMotion() });
    lastThrottle = throttle;
    const adt = dt * actorScale(now);
    fishingCastT = fishing.phase === 'casting' ? fishingCastT + adt : 0;
    fishing.update(adt, input.actionHeld, rodTip(), boat.pos, camera.position);
    fishingDirector(adt);
    show.update(dt, adt);
    if (catchFX.group.visible) catchFX.update(dt, camera, fishing.phase === 'landed' && fishing.fish.group.visible ? fishing.fish.group.getWorldPosition(fishWorld) : null);
    if (foot.active) foot.update(dt, modalOpen || chase.inShot);
    else {
      chase.update(dt, boat, input.takeOrbit(), input.lastOrbitTime, land);
      foot.afterChase(dt);
      foot.boatTick(boat);
    }
    tides.frame(dt, clockHour, save.day ?? 0); // tides (src/game/tides.ts): water level + everything afloat
    opening.update(dt);
    maybeReveal();
    sky.follow(camera.position);
    sea.reduceMotion = reduceMotion();
    sea.update(dt, boat.pos, camera);
    hotspotFX?.update(dt, camera.position, fishing.active ? fishing.hotspot : null, fishing.active && fishing.phase !== 'reeling' && fishing.phase !== 'landed' ? fishing.bobber.position : null);
    wildlife?.update(dt, camera.position, boat.pos);
    if (wildlife) wake.update(dt, boat, wildlife.splash);
    smoke?.update(dt, camera.position, boat.stackWorld(stackPos), Math.max(Math.abs(throttle), Math.abs(boat.speed) / BOAT_TUNING.maxSpeed));
    fogBanks?.update(dt, camera.position);
    WIND_DIR.copy(LIGHT_U.uWindDir.value);
    rain.flashMode = flashSetting === 'off' ? 'off' : reduceMotion() ? 'soft' : 'on';
    rain.onFoot = foot.active;
    rain.update(dt, camera, reduceMotion());
    floaters?.update(dt, camera.position);
    crowd?.update(dt, camera.position, foot.active ? foot.feet : null);
    titleCamera(dt);
    photo.update(realDt);
    cull();
    smallThingCull(realDt, camera.position, floaters?.group ?? null, crowd?.group ?? null);
    if (!titleOpen) updateUI(dt);
    upg.tick(dt, camera, window.innerHeight > window.innerWidth);
  }

  updateLighting(dt);
  applyDebugCam();
  if (boat) { const sub = cameraSubject({ chase, foot, boat, titleOpen: titleOpen || titleBlend < 1, debugCam: !!debugCam }); updateSeeThrough(renderer, camera, sub?.at ?? null, sub?.r); }
  sepia.update(dt);
  // the Logbook HUD arrives once the colour has (it would sit on the drawing otherwise)
  if (sepia.progress > 0.55 && document.body.classList.contains('title-bloom')) document.body.classList.remove('title-bloom');
  if (!(boat && sepia.render(renderer, scene, camera, boat.pos))) renderer.render(scene, camera);
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
    tod: look.key, hour: clockHour,
    rain: rain.rain, storm: rain.storm,
    fishing: { phase: fishing.phase, tension: fishing.tension, reelHeld: fishing.reelHeld, thrashing: fishing.thrashing, distance: fishing.distance, bobber: { x: bp.x, z: bp.z } },
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  hud.setShells(save.shells);
  hud.renderCooler(save.cooler, save.coolerCap);
  await loadWorld(true);
  // Title screen on every cold launch (one tap; a tap during loading skips it). Automated runs
  // (?debug) go straight in unless they ask for it with ?title.
  const qs = new URLSearchParams(location.search);
  const title = !qs.has('debug') || qs.has('title');
  if (title) beginTitle();
  requestAnimationFrame(frame);
  // opening: "I know the way" on the title for a fresh start (skips to the crossing, Q7)
  if (title && opening.active && opening.o.q === 0) {
    const b = document.createElement('button');
    b.className = 'ld-skip'; b.type = 'button'; b.textContent = 'I know the way';
    const st = document.createElement('style');
    st.textContent = '.ld-skip{display:none;margin:8px auto 0;pointer-events:auto;background:none;border:0;font:700 22px var(--f-hand);color:var(--ink);text-decoration:underline;opacity:.8;cursor:pointer}#loading.title .ld-skip{display:block}';
    document.head.appendChild(st);
    b.addEventListener('click', () => { opening.fastPath(); }, { capture: true });
    $('ld-go').after(b);
  }
  const shown = await hud.loadingDone(title);
  titleOpen = false;
  // the drawing comes to life with the camera swing; a tap during loading skipped the title: no bloom
  if (shown) { sepia.bloom(reduceMotion()); document.body.classList.add('title-bloom'); gameAudio.title(); } else sepia.off();
  // Poll for a (new) export; swap in live when READY appears or changes.
  setInterval(() => { if (!fishing.active && !modalOpen) loadWorld(false); }, 5000);
}
boot();

// ---------------------------------------------------------------- debug hook (automated tests)
declare global { interface Window { __debug: unknown } }
window.__debug = {
  get opening() { return opening.debug; },
  get state() {
    return {
      world: world?.source, worldVersion, chunks: world?.chunks.length ?? 0, instances: instances?.count ?? 0,
      boat: { x: boat?.pos.x, z: boat?.pos.z, yaw: boat?.yaw, speed: boat?.speed, moored: boat?.moored },
      phase: fishing.phase, tension: fishing.tension, distance: fishing.distance, species: fishing.species?.name,
      shells: save.shells, cooler: save.cooler.map((f) => `${f.name} ${f.size}cm ${f.stars}★ ${f.price}`), fps: Math.round(fps),
      tod: look.key, clock: clockText(clockHour), nearestHotspot: nearestHotspot()?.hs.name, nearestHotspotDist: nearestHotspot()?.d,
      wildlife: wildlife ? { ...wildlife.birds.stats(), mammals: wildlife.mammals.count, blows: wildlife.mammals.blows.count, ms: +wildlife.cost.toFixed(3), squawks } : null,
      fx: { smokeEmitters: smoke?.emitterCount ?? 0, floaters: floaters?.count ?? 0, fogBanks: fogBanks?.mesh.visible ? fogBanks.mesh.count : 0 },
      interact: footCtx?.name ?? currentInteract?.name, interact2: footCtx2?.name ?? null, foot: foot.debugState, npcAnim: crowd ? { ...crowd.stats, ms: +crowd.stats.ms.toFixed(3) } : null, inShot: chase.inShot, seaField: seaFieldInfo, drawCalls: renderer.info.render.calls, tris: renderer.info.render.triangles,
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
  npcSmooth: (on: boolean) => crowd?.setSmooth(on),
  crowdStats: () => {
    if (!crowd) return null;
    let tris = 0, meshes = 0, smooth = 0;
    crowd.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      if (g.getAttribute('normal')) smooth++;
    });
    return { actors: crowd.actors.length, meshes, smoothMeshes: smooth, tris: Math.round(tris) };
  },
  npcs: () => world?.gameplay.npcs?.map((n) => ({ name: n.name, pos: n.pos, rotY: n.rotY, role: n.props?.npc_role, pose: n.props?.npc_pose })),
  footTeleport: (x: number, z: number, y = 3) => { if (!foot.active) return false; foot.restore({ x, y, z, yaw: foot.yaw }); return foot.debugState; },
  footProbe: (x: number, z: number, y = 3, up = 3, down = 6) => foot.world.groundAt(x, z, y, up, down),
  footPush: (x: number, z: number, y: number) => foot.world.pushOut(new THREE.Vector3(x, y, z), 0.28, 1.65),
  footPushH: (x: number, z: number, y: number, h: number) => foot.world.pushOut(new THREE.Vector3(x, y, z), 0.28, h),
  forceBite: () => fishing.debugForceBite(),
  forceThrash: () => fishing.debugThrash(),
  /** Force the next catch: species id + size (cm); null clears. landNow() reels it straight in. */
  nextCatch: (id: string | null, size?: number) => { fishing.debugNext = id ? { id, size } : null; },
  landNow: () => fishing.debugLand(),
  /** Catch show (docs/catch_study.md): force the next catch: species, size (cm), first-of-kind or a
   *  repeat (seeds the record a bit bigger unless pb), perfect reel; cast: also cast + hook it now. */
  forceCatch: (id: string, size: number, o: { first?: boolean; pb?: boolean; perfect?: boolean; count?: number; cast?: boolean } = {}) => {
    fishing.debugNext = { id, size };
    if (o.first ?? true) delete save.records[id];
    else save.records[id] = { size: o.pb ? size - 4 : size + 5, stars: 1, count: o.count ?? 4 };
    debugPerfect = o.perfect ?? false;
    if (o.cast) { onAction(); setTimeout(() => { fishing.debugForceBite(); setTimeout(() => { fishing.press(); setTimeout(() => fishing.debugLand(), 600); }, 80); }, 1200); }
    return true;
  },
  seedRecord: (id: string, size: number, count = 4) => { save.records[id] = { size, stars: 1, count }; },
  catchBeat: () => (show.beat === 'result' ? (document.querySelector('#card:not(.hidden)') ? 'card' : 'slip') : show.beat),
  catchLog: () => show.log.slice(),
  catchPlan: () => (show.plan ? { tier: show.plan.tier, arc: show.plan.arc, at: show.plan.at, head: show.plan.head, line: show.plan.line, frame: show.plan.frame } : null),
  catchFX: () => ({ ...catchFX.stats, visible: catchFX.group.visible }),
  skipCatch: () => show.skip(),
  flashes: (on?: boolean) => uiCtx.h?.flashes(on),
  closeCatch: (keep: boolean) => { if (pendingCatch) closeCard(keep); },
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
  /** photo mode (src/ui/photo.ts) */
  photo: {
    enter: () => { photo.enter(); return photo.active; },
    exit: () => photo.exit(),
    set: (o: { filter?: 'none' | 'logbook' | 'mono' | 'warm' | 'dusk'; frame?: 'none' | 'postcard' | 'logbook'; still?: boolean }) => { if (o.filter) photo.setFilter(o.filter); if (o.frame) photo.setFrame(o.frame); if (o.still !== undefined) photo.still = o.still; },
    nudge: (y: number, p: number, z = 1) => photo.nudge(y, p, z),
    capture: async () => { const b = await photo.compose(); return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); }); },
    get active() { return photo.active; },
  },
  /** camera study: draw calls by layer (all minus the count with that layer hidden) */
  drawSplit: () => {
    const count = () => { renderer.render(scene, camera); return renderer.info.render.calls; };
    const all = count();
    const parts: Record<string, THREE.Object3D[]> = {
      chunks: world?.chunks.map((c) => c.object) ?? [], instances: instances ? [instances.group] : [], backdrops: world?.backdrops ?? [], clouds: world?.clouds ?? [],
      wildlife: wildlife ? [wildlife.group] : [], sea: [sea.group], npcs: crowd ? [crowd.group] : [], fx: [smoke?.mesh, fogBanks?.mesh, rain.group, wake.mesh].filter((o): o is THREE.Mesh => !!o),
      floaters: floaters ? [floaters.group] : [], tides: tides.pools ? [tides.pools.group] : [],
    };
    const out: Record<string, number> = { all };
    for (const [k, os] of Object.entries(parts)) { const v = os.map((o) => o.visible); os.forEach((o) => (o.visible = false)); out[k] = all - count(); os.forEach((o, i) => (o.visible = v[i])); }
    out.instBatches = instances?.batches.filter((b) => b.mesh.visible).length ?? 0;
    return out;
  },
  /** camera study: instance batches inside the view frustum, by proto and distance band */
  instProbe: () => {
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const by: Record<string, number> = {}, band: Record<string, number> = {};
    for (const m of instances?.group.children ?? []) {
      const im = m as THREE.InstancedMesh;
      if (!im.visible || !im.boundingSphere || !fr.intersectsSphere(im.boundingSphere)) continue;
      const k = im.name.replace(/_\d.*$/, '').slice(0, 14); by[k] = (by[k] ?? 0) + 1;
      const d = Math.hypot(im.boundingSphere.center.x - camera.position.x, im.boundingSphere.center.z - camera.position.z);
      const bk = d < 120 ? '<120' : d < 240 ? '<240' : d < 480 ? '<480' : '480+'; band[bk] = (band[bk] ?? 0) + 1;
    }
    return { by: Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 14)), band };
  },
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
  /** title drawing: state, bloom progress, ms of the last pass (CPU), whether a target is held */
  sepia: () => ({ state: sepia.state, progress: +sepia.progress.toFixed(3), ms: +sepia.lastMs.toFixed(3) }),
  sepiaObj: () => sepia,
  /** GPU bench: ms per synchronous frame of the current view through the title drawing vs plain */
  benchSepia: (n = 60) => {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const time = (f: () => void) => { sync(); const t = performance.now(); for (let i = 0; i < n; i++) f(); sync(); return (performance.now() - t) / n; };
    const plain = () => renderer.render(scene, camera);
    const state = sepia.state;
    if (state === 'off') sepia.begin();
    const drawn = () => { sepia.render(renderer, scene, camera, boat.pos); };
    time(plain); time(drawn);
    const r = { plain: +time(plain).toFixed(3), drawn: +time(drawn).toFixed(3) };
    if (state === 'off') sepia.off();
    return r;
  },
  crestStats: () => sea.crests.stats(),
  /** ocean experiment: ocean('swell'|'classic'), swell(state 0..1 | null = weather) pins the sea state, waterAt(x,z) */
  ocean: (v?: 'classic' | 'swell') => { if (v) sea.setOcean(v); return sea.ocean; },
  swell: (v?: number | null, snap = true) => { if (v !== undefined) { SWELL.pinned = v; SWELL.target = v ?? SWELL.target; if (snap && v !== null) snapSwell(); } return swellStats(); },
  waterAt: (x: number, z: number) => waterHeight(x, z),
  swellSnap: () => { snapSwell(); return swellStats(); },
  /** µs per waterHeight() query near the boat (CPU cost of the swell for floaters / bobber / birds) */
  swellCpu: (n = 20000) => { const t = performance.now(); let acc = 0; for (let i = 0; i < n; i++) acc += waterHeight(boat.pos.x + (i % 40) - 20, boat.pos.z + ((i / 40) % 40) - 20); return { us: +(((performance.now() - t) * 1000) / n).toFixed(3), acc }; },
  swellTune: SWELL_TUNE,
  hotspotStats: () => hotspotFX?.stats(),
  hotspotObj: () => hotspotFX,
  /** slow the actor clock (captures): k = 1 normal */
  actorSlow: (k: number, ms = 60000) => { actorClock.slowUntil = performance.now() + ms; actorClock.slow = k; },
  skipperObj: () => skipper,
  /** the fish shadow vs the float: nose gap (m) — 0 means the mouth is on the float */
  shadowNose: () => fishing.shadowNoseGap(),
  /** captures (app icon etc.): override chase-camera tuning */
  camTune: (o: Partial<typeof CAMERA_TUNING>) => { Object.assign(CAMERA_TUNING, o); chase.snap(boat); },
  /** tides: pin the water level (world y; null = back to the clock); tideAt(h, day) = the model's level */
  tide: (y?: number | null) => { if (y !== undefined) WATER.pinned = y; tides.frame(0, clockHour, save.day ?? 0); return { y: +WATER.y.toFixed(3), rate: +WATER.rate.toFixed(3), pinned: WATER.pinned, grid: !!tides.grid }; },
  tideAt: (h: number, day = save.day ?? 0) => +tideAt(h, day).toFixed(3),
  tideTurns: (day = save.day ?? 0) => tideTurns(day).map((t) => ({ ...t, hour: +t.hour.toFixed(2), level: +t.level.toFixed(2) })),
  tideGround: (x: number, z: number) => tides.grid?.ground(x, z),
  tideStats: () => ({ frameMs: +tides.cost.toFixed(4), field: seaFieldInfo, shelves: tides.pools?.shelves.length ?? 0, visibleShelves: tides.pools?.shelves.filter((s) => s.group.visible).length ?? 0, pools: tides.pools?.pools.length ?? 0 }),
  /** tide pools: bake sites from this world (JSON for src/game/tidepool_sites.json), list pools, look into one */
  tidepoolBake: (opts?: { spacing?: number; max?: number }) => world && { world: worldVersion, ...tides.bake(foot.world, world, opts) },
  tidepools: () => tides.pools?.pools.map((p) => ({ id: p.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), h: +p.h.toFixed(2), r: +p.r.toFixed(2), zone: p.zone, critters: p.critters })),
  tidepoolSites: () => tides.pools?.shelves.map((s) => s.site),
  tidepoolLook: (id: string) => { const p = tides.pools?.pools.find((q) => q.id === id); return p ? tides.observe(p) : null; },
  /** jump the game clock (hours) */
  setClock: (h: number) => { clockHour = wrapHour(h); save.clock = clockHour; applyTOD(); return clockText(clockHour); },
  /** sea mist 0..1 now; mist(v) pins it (null = back to the clock), mist(null, day) sets the day */
  mist: (v?: number | null, day?: number) => { if (v !== undefined) mistOverride = v; if (day !== undefined) save.day = day; applyTOD(); return { mist: +mistNow.toFixed(2), day: save.day ?? 0, far: Math.round((scene.fog as THREE.Fog).far) }; },
  /** weather: rain(v) pins rain 0..1 (null = back to the schedule); storm(v) pins the storm (and enough rain) */
  rain: (v?: number | null) => { if (v !== undefined) rainOverride = v; applyTOD(); return { ...weatherNow, words: weatherWords(weatherNow), fx: rain.stats() }; },
  storm: (v?: number | null) => { if (v !== undefined) stormOverride = v; applyTOD(); return { ...weatherNow, words: weatherWords(weatherNow), fx: rain.stats() }; },
  /** force a lightning strike now (near = close crack) */
  lightning: (near = false) => { rain.strike(near, camera); return rain.stats(); },
  /** snap the eased weather to its target (captures) and stop/allow automatic strikes */
  weatherSnap: (autoStrikes = true) => { rain.rain = weatherNow.rain; rain.storm = weatherNow.storm; rain.autoStrikes = autoStrikes; return rain.stats(); },
  weatherFx: () => rain.stats(),
  weatherStats: (days = 400) => weatherStats(days),
  weatherTune: { RAIN_TUNE, WEATHER_TUNE },
  skipperState: () => ({ ready: skipper.ready, attached: skipper.attached, pose: skipper.currentPose, landingK: chase.landingK }),
  keep: () => closeCard(true),
  sellAll: () => sellFish(save.cooler.map((_, i) => i)),
  closeModals: () => { hud.hideSell(); hud.hideCard(); hud.closeLog(); },
  ui: hud.debug,
  /** 3D fish studio render (dataURL) for the model-vs-plate contact sheet */
  fishStudio: (id: string, view: StudioView = 'side', w = 512, h = 256) => fishStudio(renderer, id, view, w, h),
  upg: upg.debug,
  /** Audio (src/audio): live state, forced music, and offline renders (WAV base64 + level stats). */
  audio: {
    state: () => gameAudio.state(),
    forceMusic: (v: 'day' | 'night' | 'dusk' | 'town' | 'dawn' | 'village' | 'rain' | 'storm' | 'cove' | 'fog' | 'title') => gameAudio.forceMusic(v),
    motif: (g: 'title' | 'landing' | 'firstfish' | 'gran' | 'sea') => gameAudio.motif(g),
    setGap: (min: number, max: number) => gameAudio.setGap(min, max),
    render: (kind: string, secs: number, seed?: number) => renderOffline(kind, secs, seed),
    compose: (v: 'day' | 'night' | 'dusk' | 'town' | 'dawn' | 'village' | 'rain' | 'storm' | 'cove' | 'fog' | 'title', seed: number) => { const p = composePiece(v, seed); return { ...p, events: p.events.length }; },
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
