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
import { Boat } from './game/boat';
import { ChaseCamera } from './game/camera';
import { Fishing } from './game/fishing';
import { HotspotFX } from './game/hotspots';
import { lookupSpecies, type CaughtFish } from './game/fishdata';
import { clearSave, loadSave, writeSave, type SaveData } from './game/save';
import * as hud from './ui/hud';

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
  bite: () => { $('bite').classList.remove('hidden'); navigator.vibrate?.(90); },
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
let boat: Boat;
let landing: Interact | null = null; // Cedar Landing fish market (compass + reveal)
let todKeys: string[] = [];
let todIndex = 0;
let pendingCatch: CaughtFish | null = null;
let modalOpen = false;

// ---------------------------------------------------------------- world
function disposeWorld() {
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
  for (const d of w.dynamic ?? []) worldRoot.add(d);
  if (new URLSearchParams(location.search).has('flagtest')) worldRoot.add(makeTestFlag(flutterMat, w.gameplay.spawn.pos));
  buildInstances();

  land = new LandCollision(w.gameplay);
  hotspotFX = new HotspotFX(w.gameplay.hotspots);
  worldRoot.add(hotspotFX.group);

  const model = w.boat ?? placeholderBoat();
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

  const ints = w.gameplay.interacts;
  landing = ints.find((i) => i.name === 'Interact_SellFish') ?? ints.find((i) => i.kind === 'sell_fish') ?? null;

  todKeys = Object.keys(w.gameplay.time_of_day);
  const want = save.settings.tod && todKeys.includes(save.settings.tod) ? save.settings.tod : todKeys.includes('overcast') ? 'overcast' : todKeys[0];
  todIndex = Math.max(0, todKeys.indexOf(want));
  applyTOD();

  fishing.cancel();
  $('set-world').textContent = w.source === 'export' ? `export ${worldVersion.slice(0, 24)}` : 'placeholder';
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
  (scene.fog as THREE.Fog).near = foggy ? 20 : quality.fogNear;
  (scene.fog as THREE.Fog).far = foggy ? 260 : quality.fogFar;
  backdropHaze.value = foggy ? 0.92 : quality.haze;
  $('set-tod').textContent = key;
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
  const p = it.props?.prompt;
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
        hud.toast('Canoe tied up · progress saved', 'good');
      } else hud.toast('Cast off!');
      break;
    default:
      hud.toast(`${labelFor(it)} — coming soon`);
  }
}

function openSell() {
  modalOpen = true;
  hud.showSell(save.cooler, (i) => sellFish([i]));
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
  hud.setShells(save.shells);
  hud.renderCooler(save.cooler, save.coolerCap, true);
  hud.toast(`+${total} Shells`, 'good');
  hud.showSell(save.cooler, (i) => sellFish([i]));
}
$('sell-all').onclick = () => sellFish(save.cooler.map((_, i) => i));
$('sell-close').onclick = () => { hud.hideSell(); modalOpen = false; };

function onLanded(fish: CaughtFish, sp: ReturnType<typeof lookupSpecies>, perfect: boolean) {
  pendingCatch = fish;
  modalOpen = true;
  const rec = save.records[fish.speciesId];
  const stamp = !rec ? 'NEW!' : fish.size > rec.size ? 'RECORD!' : null;
  hud.showCard(fish, sp, stamp, save.cooler.length >= save.coolerCap, perfect);
  navigator.vibrate?.([40, 40, 40]);
}
function closeCard(keep: boolean) {
  const f = pendingCatch;
  pendingCatch = null;
  hud.hideCard();
  modalOpen = false;
  fishing.finish();
  if (!f) return;
  const rec = save.records[f.speciesId] ?? { size: 0, stars: 0, count: 0 };
  save.records[f.speciesId] = { size: Math.max(rec.size, f.size), stars: Math.max(rec.stars, f.stars), count: rec.count + 1 };
  if (keep && !f.releaseOnly && save.cooler.length < save.coolerCap) {
    save.cooler.push(f);
    hud.renderCooler(save.cooler, save.coolerCap, true);
    if (save.cooler.length >= save.coolerCap) hud.toast('Cooler full — sell at the Fish Market in Cedar Landing', 'info', 3500);
  } else hud.toast(`Released the ${f.name.toLowerCase()}`);
  writeSave(save);
}
$('card-keep').onclick = () => closeCard(true);
$('card-release').onclick = () => closeCard(false);

function onAction() {
  if (modalOpen || chase.inShot) return;
  if (fishing.active) { fishing.press(); return; }
  const near = nearestHotspot();
  if (!near || near.d > HOTSPOT_RANGE) { hud.toast('Find the ripples to fish'); return; }
  if (Math.abs(boat.speed) > CAST_MAX_SPEED) { hud.toast('Slow down to cast'); return; }
  if (save.cooler.length >= save.coolerCap) { hud.toast('Cooler full — sell at the Fish Market first', 'warn'); return; }
  boat.speed = 0;
  fishing.cast(near.hs, rodTip(), boat.pos);
}
function rodTip() { return boat.root.localToWorld(new THREE.Vector3(0.45, 1.7, -0.6)); }

// ---------------------------------------------------------------- settings
function refreshSettingsUI() {
  $('set-quality').textContent = save.settings.quality === 'high' ? 'High' : 'Low';
  $('set-autoreel').textContent = save.settings.autoReel ? 'On' : 'Off';
  $('set-fps').textContent = save.settings.showFps ? 'On' : 'Off';
  $('fps').classList.toggle('hidden', !save.settings.showFps);
}
$('btn-settings').onclick = () => { refreshSettingsUI(); $('settings').classList.remove('hidden'); modalOpen = true; };
$('settings-close').onclick = () => { $('settings').classList.add('hidden'); modalOpen = false; };
$('set-quality').onclick = () => {
  save.settings.quality = save.settings.quality === 'high' ? 'low' : 'high';
  quality = QUALITY[save.settings.quality];
  resize();
  buildInstances();
  applyTOD();
  writeSave(save);
  refreshSettingsUI();
};
$('set-autoreel').onclick = () => { save.settings.autoReel = !save.settings.autoReel; fishing.autoReel = save.settings.autoReel; writeSave(save); refreshSettingsUI(); };
$('set-fps').onclick = () => { save.settings.showFps = !save.settings.showFps; writeSave(save); refreshSettingsUI(); };
$('set-tod').onclick = () => cycleTOD();
$('set-reset').onclick = () => { clearSave(); location.reload(); };
function cycleTOD() {
  todIndex = (todIndex + 1) % Math.max(1, todKeys.length);
  save.settings.tod = todKeys[todIndex];
  writeSave(save);
  applyTOD();
}
const fsBtn = $('btn-fullscreen');
if (!document.fullscreenEnabled) fsBtn.classList.add('hidden');
fsBtn.onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
};
if (new URLSearchParams(location.search).has('debug')) { save.settings.showFps = true; }
refreshSettingsUI();
mountSunShadingSetting();
mountWindSetting();
window.addEventListener('keydown', (e) => {
  if (e.key === 't' || e.key === 'T') cycleTOD();
  if (e.key === 'f' || e.key === 'F') { save.settings.showFps = !save.settings.showFps; refreshSettingsUI(); }
});

// ---------------------------------------------------------------- per-frame UI
const tensionEl = $('tension') as unknown as SVGSVGElement;
const tensionFill = $('tension-fill') as unknown as SVGCircleElement;
const actionBtn = $('btn-action'), actionLabel = $('action-label');
const interactBtn = $('btn-interact'), promptEl = $('prompt');
let currentInteract: Interact | null = null;
let hintTimer = 0;
const v3 = new THREE.Vector3();

function updateUI(dt: number) {
  // action button
  const near = nearestHotspot();
  const canCast = !!near && near.d <= HOTSPOT_RANGE;
  let label = 'Cast';
  let enabled = canCast && Math.abs(boat.speed) <= CAST_MAX_SPEED;
  switch (fishing.phase) {
    case 'casting': case 'waiting': case 'missed': label = 'Wait…'; enabled = true; break;
    case 'bite': label = 'Hook!'; enabled = true; break;
    case 'reeling': label = fishing.autoReel ? 'Auto' : 'Reel'; enabled = true; break;
    case 'landed': label = '…'; break;
  }
  actionLabel.textContent = label;
  actionBtn.classList.toggle('disabled', !enabled);
  actionBtn.classList.toggle('reel', fishing.phase === 'reeling' || fishing.phase === 'bite');
  if (fishing.phase !== 'bite') $('bite').classList.add('hidden');

  // interact prompt
  currentInteract = fishing.active ? null : nearestInteract();
  if (currentInteract) {
    const lbl = boat.moored && currentInteract.kind === 'moor_boat' ? 'Untie' : labelFor(currentInteract);
    $('interact-label').textContent = lbl.length > 10 ? lbl.split(' ')[0] : lbl;
    promptEl.textContent = currentInteract.kind === 'sell_fish' ? `${lbl} · ${save.cooler.length} fish in cooler` : lbl;
    interactBtn.classList.remove('hidden');
    promptEl.classList.remove('hidden');
  } else if (!fishing.active && canCast && near) {
    interactBtn.classList.add('hidden');
    promptEl.textContent = Math.abs(boat.speed) > CAST_MAX_SPEED ? 'Fish here — slow down' : 'Fish here — tap Cast';
    promptEl.classList.remove('hidden');
  } else {
    interactBtn.classList.add('hidden');
    promptEl.classList.add('hidden');
  }

  // tension ring around the bobber
  if (fishing.phase === 'reeling') {
    v3.copy(fishing.bobber.position).project(camera);
    const x = Math.min(window.innerWidth - 70, Math.max(70, (v3.x * 0.5 + 0.5) * window.innerWidth));
    const y = Math.min(window.innerHeight - 160, Math.max(110, (-v3.y * 0.5 + 0.5) * window.innerHeight - 40));
    tensionEl.style.left = `${x}px`;
    tensionEl.style.top = `${y}px`;
    tensionEl.classList.remove('hidden');
    tensionEl.classList.toggle('thrash', fishing.thrashing);
    tensionFill.style.strokeDashoffset = String(276.5 * (1 - Math.min(1, fishing.tension)));
    const hot = fishing.tension > 0.75;
    tensionFill.style.stroke = fishing.thrashing ? '' : hot ? '#e2b04a' : '';
    $('tension-dist').textContent = `${Math.max(0, fishing.distance).toFixed(1)} m`;
    $('tension-hint').textContent = fishing.thrashing ? 'let go!' : fishing.reelHeld ? 'reeling' : 'hold';
  } else tensionEl.classList.add('hidden');

  // compass toward Cedar Landing until reached
  const comp = $('compass');
  if (landing && !save.reachedLanding) {
    const dx = landing.pos[0] - boat.pos.x, dz = landing.pos[2] - boat.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < LANDING_REACHED) { save.reachedLanding = true; writeSave(save); hud.toast('Welcome to Cedar Landing', 'good'); }
    camera.getWorldDirection(v3);
    const fl = Math.hypot(v3.x, v3.z) || 1;
    const fx = v3.x / fl, fz = v3.z / fl;
    const rel = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    $('compass-arrow').style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
    $('compass-label').textContent = `Cedar Landing · ${Math.round(dist)} m`;
    comp.classList.remove('hidden');
  } else comp.classList.add('hidden');

  hintTimer += dt;
  if (hintTimer > 12 || Math.abs(boat.speed) > 1.5) $('move-hint').style.opacity = '0';
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

  if (world) {
    const tapped = input.consumeTap();
    if (chase.inShot) {
      if (tapped || input.consumeAction()) chase.skipShot();
    }
    if (!chase.inShot && document.body.classList.contains('cinematic')) {
      document.body.classList.remove('cinematic');
      $('skip-hint').classList.add('hidden');
    }

    if (input.consumeAction()) onAction();
    if (input.consumeInteract() && currentInteract && !modalOpen && !fishing.active) doInteract(currentInteract);

    let throttle = input.throttle, steer = input.steer;
    if (modalOpen || chase.inShot) { throttle = 0; steer = 0; }
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
    chase.update(dt, boat, input.takeOrbit(), input.lastOrbitTime);
    maybeReveal();
    sky.follow(camera.position);
    sea.update(dt, boat.pos);
    hotspotFX?.update(dt, camera.position, fishing.active ? fishing.hotspot : null);
    cull();
    updateUI(dt);
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
  $('loading').classList.add('done');
  requestAnimationFrame(frame);
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
      interact: currentInteract?.name, inShot: chase.inShot, drawCalls: renderer.info.render.calls, tris: renderer.info.render.triangles,
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
  interact: () => { if (currentInteract) doInteract(currentInteract); return currentInteract?.name; },
  forceBite: () => fishing.debugForceBite(),
  keep: () => closeCard(true),
  sellAll: () => sellFish(save.cooler.map((_, i) => i)),
  closeModals: () => { hud.hideSell(); hud.hideCard(); $('settings').classList.add('hidden'); modalOpen = false; },
  cycleTOD,
  setAutoReel: (on: boolean) => { fishing.autoReel = on; },
  skipShot: () => chase.skipShot(),
  markRevealSeen: () => { save.seenReveal = true; },
  resetSave: () => { clearSave(); Object.assign(save, loadSave()); hud.setShells(0); hud.renderCooler([], save.coolerCap); },
  hotspots: () => world?.gameplay.hotspots.map((h) => h.name),
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
