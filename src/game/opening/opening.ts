/**
 * The opening (docs/opening_study.md, trimmed ~9-minute chain): the Thursday mail boat drops you at
 * Keeper's Cove; Gran's logbook and keys on the porch; her tackle along the strandline; the Little
 * Troller laid up at the dock (bail + patch); oars out between the buoys; first fish; a full box;
 * the crossing to Cedar Landing; Mae; Old Tess and Gran's tab.
 *
 * Everything lives here + quests.ts / boatstage.ts / props.ts and ui/repair.ts / ui/granstab.ts.
 * main.ts only calls prepare() / install() / update() / interact() / canCast() / compass().
 * Synthetic interacts (kind 'opening') are added to and removed from the world's interact list as
 * the quests move on, so the boat's and the walker's existing interact pickers find them.
 */
import * as THREE from 'three';
import type { Boat } from '../boat';
import { OPEN_INTERACTS, type OnFoot } from '../onfoot/onfoot';
import type { Interact, LoadedWorld } from '../../world/types';
import type { SaveData } from '../save';
import { applyBoatTier } from '../progression/tiers';
import { ERRANDS, errandsMeta, type Errand } from '../../ui/errands';
import { log as uiLog } from '../../ui/prefs';
import { repairBoat } from '../../ui/repair';
import { gransTab, type LureId } from '../../ui/granstab';
import * as P from './props';
import { applyOars, fixedModel, fixerReady, loadFixer, wreckModel, type Stage } from './boatstage';
import { ensureUpg } from '../progression/gear';
import {
  QUESTS, completeStep, fastPathOpening, hasFlag, migratedOpening, newOpening, passed, reached, setFlag, stepDone,
  type OpeningSave, type QuestId,
} from './quests';

export interface OpeningHost {
  scene: THREE.Scene;
  save: SaveData & { opening?: OpeningSave };
  writeSave(): void;
  boat(): Boat;
  foot: OnFoot;
  camera: THREE.Camera;
  /** put the boat's model back to the tier model (upgrades), re-attaching the skipper */
  restoreBoatModel(): void;
  setBoatModel(m: THREE.Object3D): void;
  toast(m: string, k?: 'info' | 'good' | 'warn' | 'log'): void;
  note(who: string, text: string): Promise<unknown>;
  ask(who: string, text: string, choices: { label: string; value: string }[]): Promise<string | null>;
  titleCard(t: string, s: string): void;
  setShells(n: number): void;
  drizzle(on: boolean): void;
  setClock(h: number): void;
  reduceMotion(): boolean;
  busy(): boolean;
  /** open the normal shop / shipwright for an interact (upgrades) */
  passThrough(it: Interact): void;
  /** the lure picked at Gran's tab (gear.ts) */
  giveLure(id: LureId): void;
}

type V2 = [number, number];
/** Kiln Point anchors (three x, z), from a walkable-ground survey of the island (scripts/_probe_kiln.mjs). */
const A = {
  arrive: [7.5, 26.4] as V2, // the middle of the mail-boat dock (it is 1.5 m wide: x 6.75–8.25)
  table: [6.5, 12] as V2,
  rod: [14.6, 0.4] as V2, // Kellan: on the FRONT beach, in the same patch as the tin (below the porch)
  pool: [16.2, -2.4] as V2, // the rock pool at the end of the front beach (the 'matchbox' tin)
  clams: [15.2, 4.6] as V2, // ...and the clam holes, so the three are one sweep before the campfire
  fire: [18, 7] as V2,
  chain: [8.2, 28.0] as V2,
  moor: [8.5, 33.2] as V2,
  gate: [-14, 46] as V2,
  fenceC: [2, 14] as V2,
};
const FENCE_R = 80;
const LEVEL = { beach: 0.3, dock: 0.55, porch: 3.3 };
const ARRIVE_R = 5;

/** Gran's voice at the start of each quest (docs/opening_study.md §5). */
const GRAN: Partial<Record<QuestId, string>> = {
  // short pages, one idea each (the dialogue box pages on sentence breaks; Kellan: "make the messages a lot shorter")
  q1: "The keys are in the spine. The long one's for her chain. She's been sulking under a tarp since spring. Be kind to her. — G.",
  q2: "My tackle went down the beach in the October blow. The beach below the porch: my old rod's by the pale log. Hooks are in a tin in the rock pool. Dig a few clams, then rig up at my campfire.",
  q3: "She takes a little water. Everything old does. Unlock her chain, bail her out, patch the stern seam. Leave the engine. It's sulking.",
  q4: 'Row out between the green buoy and the red. Not past the point till the tide turns.',
  q5: "Water wrinkling in rings — that's fish. Stop by the rings and cast. Wait for the bob, then strike.",
  q6: 'The box holds two. Plenty for a first day.',
  q7: "The tide's turned. An easy row to town now. Mark Cedar Landing on my chart. Tie up at the float.",
};
/** Q2 nudges if a pickup stays unfound for a minute (Kellan couldn't find the rod). */
const NUDGE: Record<string, string> = {
  rod: 'Try the beach below the porch, by the big pale log.',
  tin: 'The tin is in the rock pool at the end of that beach.',
  clams: "Look for the little bubbling holes in the sand. That's clams.",
  rig: 'Got it all? My campfire is just up the beach.',
};

export class Opening {
  o: OpeningSave;
  private group = new THREE.Group();
  private world: LoadedWorld | null = null;
  private ints = new Map<string, Interact>();
  private items: Record<string, { obj: THREE.Object3D; glint: THREE.Object3D; at: V2 }> = {};
  private marker = P.targetMarker();
  private bubbles: THREE.Group | null = null;
  private q2Since = 0;
  private q2Steps = -1;
  private pool: ReturnType<typeof P.rockPool> | null = null;
  private mail: THREE.Mesh | null = null;
  private mailT = 0;
  private barrelObj: THREE.Mesh | null = null;
  private barrelPos = new THREE.Vector2();
  private rip: THREE.Mesh | null = null;
  private t = 0;
  private lastQ = -1;
  private noteQueue: Promise<unknown> = Promise.resolve();
  private fenceToastAt = 0;
  private stageShown: Stage | -1 = -1;
  private drizzling = false;
  private hosted = false;

  constructor(private h: OpeningHost) {
    const s = h.save;
    if (!s.opening) {
      // a save from before the opening: count it all done and keep the troller as it is
      const legacy = s.reachedLanding || Object.keys(s.records ?? {}).length > 0 || s.shells > 0 || (uiLog.sold ?? 0) > 0;
      // automated runs (?debug) start as before (opening done) unless they ask for it with ?opening
      const qs = new URLSearchParams(location.search);
      const skip = qs.has('debug') && !qs.has('opening');
      s.opening = legacy || skip ? migratedOpening() : newOpening();
      if (!legacy && !skip) s.clock = 9.5; // a grey Thursday morning, falling tide
      h.writeSave();
    }
    this.o = s.opening;
    if (this.o.stage < 3) void loadFixer(); // the wreck / the fixed troller, ready by the time the world is
    OPEN_INTERACTS.add('opening');
    this.group.name = 'OPENING';
    h.scene.add(this.group);
    // the walker may not board her until she floats
    const foot = h.foot as OnFoot & { board: () => boolean };
    const board = foot.board.bind(foot);
    foot.board = () => {
      if (this.active && this.o.stage < 1) { this.h.toast("Half full of rainwater. See to her first.", 'warn'); return false; }
      return board();
    };
  }

  get active() { return !this.o.done; }
  get stage(): Stage { return this.o.stage; }

  /** Data fixes before the world is built (names the opening relies on). */
  prepare(w: LoadedWorld) {
    for (const n of w.gameplay.npcs ?? []) {
      if (n.npc_name === 'Marlo' || n.props?.npc_name === 'Marlo') { n.npc_name = 'Mae'; if (n.props) n.props.npc_name = 'Mae'; }
    }
  }

  /** After the world, boat and walker are in place (main.installWorld). */
  install(w: LoadedWorld) {
    this.world = w;
    this.ints.clear();
    this.group.clear();
    this.items = {};
    if (this.o.done) { this.restoreErrands(); this.applyStage(true); return; }
    this.useQuestErrands();
    this.snapAnchors();
    this.buildProps();
    this.applyStage(true);
    if (this.o.q === 0 && !this.o.steps.length && !hasFlag(this.o, 'arrived')) this.arrive();
    else if (this.o.stage < 1 && !this.h.foot.active) {
      // a world (re)load put the player back in the boat, but she's a wreck until Q3: back on the dock
      const boat = this.h.boat();
      boat.place(A.moor[0], A.moor[1], Math.PI);
      const sv = this.h.save.onfoot;
      const at = sv ?? { x: A.arrive[0], y: this.ground(A.arrive, LEVEL.dock) ?? 0.6, z: A.arrive[1], yaw: 0 };
      this.h.foot.restore(at);
    }
    this.lastQ = -1;
  }

  // ------------------------------------------------------------------ boat stages
  private applyStage(force = false) {
    if (!force && this.stageShown === this.o.stage) return;
    const s = this.o.stage;
    if (s >= 3) { // a save from before the opening: the troller as it always was
      if (this.stageShown !== 3 && this.stageShown !== -1) { applyBoatTier(ensureUpg(this.h.save).boat); this.h.restoreBoatModel(); }
      this.stageShown = 3;
      return;
    }
    void loadFixer().then(() => {
      if (!fixerReady() || !this.world) return;
      const s2 = this.o.stage;
      if (s2 === 0) {
        const m = wreckModel();
        if (m) this.h.setBoatModel(m);
        applyOars();
      } else {
        // the scruffy troller IS her BOAT_T0 from now on (paint / flags / tiers work as before)
        const m = fixedModel(s2 >= 2)!;
        if (this.world.boats) this.world.boats.BOAT_T0 = m;
        this.world.boat = m;
        this.h.restoreBoatModel();
        if (ensureUpg(this.h.save).boat === 'T0') { if (s2 >= 2) applyBoatTier('T0'); else applyOars(); }
      }
      this.stageShown = s2;
    });
  }

  setStage(s: Stage) {
    const from = this.o.stage;
    this.o.stage = s;
    if (s >= 1) {
      // she floats: tie her back up so the walker gets "Board" (while laid up she was un-moored to hide it)
      const b = this.h.boat();
      b.moored = true; b.speed = 0;
      this.h.save.boat = { x: b.pos.x, z: b.pos.z, yaw: b.yaw, moored: true };
    }
    this.h.writeSave();
    this.applyStage();
    if (from === 0 && s === 1) this.revealT = 0.001; // she rights herself
  }

  /** Q3's before→after beat: the fixed troller rises out of the wreck's sink and list. */
  private revealT = 0;
  private reveal(dt: number) {
    const m = this.h.boat().modelObject;
    if (!m || !this.revealT) return;
    this.revealT += dt;
    const k = Math.min(1, this.revealT / 1.8);
    const e = 1 - Math.pow(1 - k, 3);
    m.position.y = -0.42 * (1 - e);
    m.rotation.x = 0.26 * (1 - e) + Math.sin(this.revealT * 7) * 0.05 * (1 - k);
    if (k >= 1) { m.position.y = 0; m.rotation.x = 0; this.revealT = 0; }
  }

  // ------------------------------------------------------------------ arrival (Q0)
  private arrive() {
    setFlag(this.o, 'arrived');
    const boat = this.h.boat();
    const yaw = Math.PI; // bow north, toward the island
    boat.place(A.moor[0], A.moor[1], yaw);
    boat.moored = true;
    this.h.save.boat = { x: A.moor[0], z: A.moor[1], yaw, moored: true };
    const g = this.ground(A.arrive, LEVEL.dock);
    this.h.foot.restore({ x: A.arrive[0], y: g ?? 0.6, z: A.arrive[1], yaw: 0 });
    this.mail = P.mailBoat();
    this.mail.position.set(16, 0.2, 40);
    this.mail.rotation.y = -0.5;
    this.group.add(this.mail);
    this.mailT = 0;
    this.h.writeSave();
    setTimeout(() => {
      this.h.titleCard("Keeper's Cove", 'Thursday. The mail boat, and Gran\'s place');
      this.say('The purser', "Keeper's Cove, end of the line! Your gran's place is up the steps.");
    }, 900);
  }

  // ------------------------------------------------------------------ props + interacts
  /** Move the on-foot anchors onto open, walkable ground (the island survey is coarse; tides vary). */
  private snapAnchors() {
    const W = this.h.foot.world;
    const open = (x: number, z: number, y: number) => {
      const g = W.walkable(x, z, y);
      if (!g || g.y < 0.25) return null;
      for (const [ox, oz] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) { const n = W.walkable(x + ox, z + oz, g.y); if (!n || n.y < 0.25 || Math.abs(n.y - g.y) > 0.35) return null; }
      return g;
    };
    for (const k of ['table', 'rod', 'clams', 'chain'] as const) { // the pool brings its own rocks
      const [x0, z0] = A[k];
      const y0 = this.lvl(k);
      search: for (let r = 0; r <= 6; r += 0.5) {
        for (let i = 0; i < (r ? 16 : 1); i++) {
          const a = (i / 16) * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
          if (open(x, z, y0 + 0.4)) { A[k] = [+x.toFixed(2), +z.toFixed(2)]; break search; }
        }
      }
    }
  }

  /** Ground at an anchor, searched near its level (beach ~0.3, dock ~0.55, the porch ~3.3) so a cliff
   *  top or an overhang never wins over the beach below it. */
  private ground(p: V2, lvl = LEVEL.beach): number | null {
    const g = this.h.foot.world.groundAt(p[0], p[1], lvl + 0.4, 1.0, 1.6);
    return g ? g.y : null;
  }
  private lvl(k: string) { return k === 'table' ? LEVEL.porch : k === 'chain' || k === 'arrive' ? LEVEL.dock : LEVEL.beach; }

  private place(obj: THREE.Object3D, p: V2, yaw = 0, lvl = LEVEL.beach) {
    const y = this.ground(p, lvl) ?? lvl;
    obj.position.set(p[0], y, p[1]);
    obj.rotation.y = yaw;
    obj.updateMatrixWorld(true);
    this.group.add(obj);
    return y;
  }

  private addItem(id: string, obj: THREE.Object3D, at: V2, root?: THREE.Object3D, lvl = LEVEL.beach) {
    const gl = P.glint();
    gl.position.set(at[0], (this.ground(at, lvl) ?? lvl) + 1.5, at[1]);
    gl.userData.y0 = gl.position.y;
    this.group.add(gl);
    this.items[id] = { obj: root ?? obj, glint: gl, at };
  }

  private buildProps() {
    const t = P.logbookTable();
    this.place(t.group, A.table, 0.3, LEVEL.porch);
    this.addItem('book', t.book, A.table, undefined, LEVEL.porch);
    const d = P.driftwoodRod();
    this.place(d.group, A.rod, 0.6);
    this.addItem('rod', d.item, A.rod);
    const p = P.rockPool();
    this.place(p.group, A.pool, 0);
    this.pool = p;
    this.addItem('tin', p.item, A.pool);
    const c = P.clamBucket();
    this.place(c.group, A.clams, 0.2);
    this.addItem('clams', c.item, A.clams);
    this.bubbles = P.clamBubbles();
    this.bubbles.position.copy(c.group.position);
    this.group.add(this.bubbles);
    this.group.add(this.marker);
    this.marker.visible = false;
    this.rip = P.ripFoam(FENCE_R, 0.12 * Math.PI, 0.95 * Math.PI);
    this.rip.position.set(A.fenceC[0], 0, A.fenceC[1]);
    this.group.add(this.rip);
    this.barrelObj = P.barrel();
    this.barrelPos.set(52, 4);
    this.group.add(this.barrelObj);
    this.refreshVisibility();
  }

  private refreshVisibility() {
    const o = this.o;
    const taken = (id: string) => stepDone(o, id) || passed(o, id === 'book' ? 'q1' : 'q2');
    for (const [id, it] of Object.entries(this.items)) {
      const gone = id === 'book' ? passed(o, 'q1') : taken(id);
      it.obj.visible = !gone;
      const wanted = id === 'book' ? reached(o, 'q0') && !passed(o, 'q1') : o.q === 2 && !stepDone(o, id);
      it.glint.visible = wanted;
    }
    if (this.rip) this.rip.visible = reached(o, 'q3') && !passed(o, 'q6');
    if (this.barrelObj) this.barrelObj.visible = o.q === 6 && !hasFlag(o, 'barrel');
  }

  /** Keep exactly the interacts the current quest needs in the world's list. */
  private syncInteracts() {
    if (!this.world) return;
    const o = this.o;
    const want = new Map<string, { at: V2; prompt: string; boat?: boolean }>();
    if (o.q <= 1) want.set('book', { at: A.table, prompt: "Gran's logbook" });
    if (o.q === 2) {
      if (!stepDone(o, 'rod')) want.set('rod', { at: A.rod, prompt: 'Pick up the rod' });
      if (!stepDone(o, 'tin')) want.set('tin', { at: A.pool, prompt: 'Look in the pool' });
      if (!stepDone(o, 'clams')) want.set('clams', { at: A.clams, prompt: 'Dig clams' });
      if (['rod', 'tin', 'clams'].every((s) => stepDone(o, s))) want.set('rig', { at: A.fire, prompt: 'Rig the rod' });
    }
    if (o.q === 3) want.set(stepDone(o, 'chain') ? 'repair' : 'chain', { at: A.chain, prompt: stepDone(o, 'chain') ? 'See to the boat' : 'Unlock her chain' });
    if (o.q === 6 && !hasFlag(o, 'barrel') && this.barrelObj) want.set('barrel', { at: [this.barrelPos.x, this.barrelPos.y], prompt: 'Grab the barrel', boat: true });
    const list = this.world.gameplay.interacts;
    for (const [id, it] of [...this.ints]) {
      if (want.has(id)) continue;
      const i = list.indexOf(it);
      if (i >= 0) list.splice(i, 1);
      this.ints.delete(id);
    }
    for (const [id, w] of want) {
      let it = this.ints.get(id);
      const lv = this.lvl(id === 'book' ? 'table' : id === 'repair' ? 'chain' : id === 'rig' ? 'fire' : id);
      const y = w.boat ? 0.5 : (this.ground(w.at, lv) ?? lv) + 1.1;
      if (!it) {
        it = { name: `OPEN_${id}`, kind: 'opening', pos: [w.at[0], y, w.at[1]], props: { op: id, prompt: w.prompt } } as Interact;
        this.ints.set(id, it);
        list.push(it);
      } else { it.pos[0] = w.at[0]; it.pos[2] = w.at[1]; }
    }
  }

  // ------------------------------------------------------------------ interacts
  /** main.doInteract: true when the opening handled it. */
  interact(it: Interact): boolean {
    if (it.kind === 'opening') { void this.runOp(String(it.props?.op)); return true; }
    if (!this.active) {
      if ((it.kind === 'buy_boat' || it.kind === 'upgrade_bench') && this.o.stage === 1) { void this.shipwright(it); return true; }
      return false;
    }
    if (it.kind === 'buy_tackle' && this.o.q === 9) { void this.gransTab(it); return true; }
    if ((it.kind === 'buy_boat' || it.kind === 'upgrade_bench') && this.o.stage === 1 && passed(this.o, 'q8')) { void this.shipwright(it); return true; }
    return false;
  }

  private async runOp(op: string) {
    const o = this.o;
    switch (op) {
      case 'book':
        if (o.q === 0) this.complete('walk');
        this.complete('book');
        this.h.toast("Gran's logbook — two keys in the spine", 'log');
        break;
      case 'rod':
        this.complete('rod');
        this.h.toast("Gran's old rod — cork handle, brass reel", 'log');
        break;
      case 'tin': {
        if (!hasFlag(o, 'crab')) {
          setFlag(o, 'crab');
          this.h.writeSave();
          const v = await this.h.ask('A rock pool', 'The hook tin… with a crab sitting on it.', [
            { label: 'Wait for it', value: 'wait' }, { label: 'Tip it out gently', value: 'tip' }]);
          if (this.pool) {
            const crab = this.pool.crab;
            const from = crab.position.clone();
            const t0 = performance.now();
            const run = () => { const k = Math.min(1, (performance.now() - t0) / 900); crab.position.set(from.x - 1.1 * k, from.y - 0.12 * k, from.z + 0.6 * k); if (k < 1) requestAnimationFrame(run); else crab.visible = false; };
            run();
          }
          this.h.toast(v === 'tip' ? 'The crab sidles off, offended' : 'The crab gets bored and leaves', 'info');
        }
        this.complete('tin');
        this.h.toast('Handline, hooks and a float', 'log');
        break;
      }
      case 'clams':
        this.complete('clams');
        this.h.toast('Clam necks — everything nibbles', 'log');
        break;
      case 'rig':
        await this.h.note('Gran', "Line through the rings, hook on, float a forearm up. There. Now you're a fisher. Nearly.");
        this.complete('rig');
        break;
      case 'chain':
        this.complete('chain');
        this.h.toast('The chain drops with a sulk', 'info');
        break;
      case 'repair': {
        await repairBoat({ reduceMotion: this.h.reduceMotion() });
        this.setStage(1);
        this.complete('repair');
        this.h.toast("She floats — and she's yours", 'good');
        break;
      }
      case 'barrel':
        setFlag(o, 'barrel');
        this.h.save.shells += 6;
        this.h.setShells(this.h.save.shells);
        this.h.toast('A barrel of oddments · +6 Shells', 'good');
        this.h.writeSave();
        this.refreshVisibility();
        break;
    }
  }

  private complete(step: string) {
    const r = completeStep(this.o, step);
    if (r) { this.h.writeSave(); this.refreshVisibility(); }
    return r;
  }

  // ------------------------------------------------------------------ Gran's tab (Q9) and the shipwright
  private async gransTab(it: Interact) {
    await this.h.note('Old Tess', "So you're the one. Your gran paid ahead. Town's gone to seed, but this counter's open. One thing on her tab. Your pick.");
    const pick = await gransTab({ reduceMotion: this.h.reduceMotion() });
    if (!pick) return; // closed: come back later
    this.o.lure = pick.lure;
    this.h.giveLure(pick.lure);
    this.complete('tess');
    await this.h.note(pick.pipName, pick.pipLine);
    await this.h.note('Bosun Ade', "That engine of hers is seized, not dead. Bring me Shells. Got more to spare? The notice board by the market says what needs mending.");
    this.finish();
    void it;
  }

  /** Bosun Ade: the engine (stage 1 → 2). Her look never changes; paint and flags stay the player's to choose. */
  private async shipwright(it: Interact) {
    const price = 300;
    const v = await this.h.ask('Bosun Ade', "Rowing her still? The engine's seized, not dead. Three hundred Shells and she'll cough. The rest stays scruffy. Suits you.", [
      { label: `Get the engine going — ${price} Shells`, value: 'buy' }, { label: 'Other boat work', value: 'shop' }, { label: 'Not today', value: 'no' }]);
    if (v === 'shop') { this.h.passThrough(it); return; }
    if (v !== 'buy') return;
    if (this.h.save.shells < price) { this.h.toast(`Not enough Shells yet (${price})`, 'warn'); return; }
    this.h.save.shells -= price;
    this.h.setShells(this.h.save.shells);
    this.setStage(2);
    this.h.toast('She coughs… she runs!', 'good');
  }

  private finish() {
    this.o.done = true;
    this.h.writeSave();
    this.h.drizzle(false);
    this.refreshVisibility();
    this.syncInteracts();
    this.restoreErrands();
    setFlag(this.o, 'town_hook');
    this.h.writeSave();
    this.h.toast("The Sound is yours. Try the town notice board.", 'log');
    // hook for the town-restoration quest (docs/town_restoration_study.md, another branch): it starts here
    window.dispatchEvent(new CustomEvent('opening:done', { detail: { lure: this.o.lure, stage: this.o.stage } }));
  }

  // ------------------------------------------------------------------ gates the rest of the game asks about
  /** Cast only once the tackle is rigged (Q2). */
  canCast() { return !this.active || passed(this.o, 'q2'); }

  /** Compass target for the current step (falls back to main's own when null). */
  compass(): { name: string; pos: number[] } | null {
    if (!this.active || !this.world) return null;
    const p3 = (p: V2, n: string) => ({ name: n, pos: [p[0], 0, p[1]] });
    const o = this.o;
    switch (QUESTS[o.q]?.id) {
      case 'q0': case 'q1': return p3(A.table, "Gran's logbook — the porch");
      case 'q2': case 'q3': { const t = this.target(); return t ? p3(t.at, t.label) : null; }
      case 'q4': return p3(A.gate, 'the channel buoys');
      case 'q5': case 'q6': {
        const hs = this.world.gameplay.hotspots.find((h) => h.name.includes('HS02')) ?? this.world.gameplay.hotspots[0];
        return hs ? { name: 'the ripples', pos: hs.pos } : null;
      }
      case 'q7': case 'q8': {
        const m = this.world.gameplay.interacts.find((i) => i.name === (o.q === 7 ? 'Interact_MoorBoat' : 'Interact_SellFish'));
        return m ? { name: o.q === 7 ? 'Cedar Landing' : "Mae's market", pos: m.pos } : null;
      }
      case 'q9': { const m = this.world.gameplay.interacts.find((i) => i.name === 'Interact_BuyTackle'); return m ? { name: "Old Tess's chandlery", pos: m.pos } : null; }
    }
    return null;
  }

  /** "I know the way" (title screen): straight to Q7 with the tackle rigged and the boat patched. */
  fastPath() {
    const keep = this.o.flags ?? [];
    Object.assign(this.o, fastPathOpening(), { flags: [...keep, 'arrived'] });
    this.h.save.boat = { x: A.moor[0], z: A.moor[1], yaw: Math.PI, moored: true };
    this.h.writeSave();
    this.refreshVisibility();
    this.applyStage(true);
    this.lastQ = -1;
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    this.t += dt;
    if (!this.world) return;
    if (this.mail) this.sailMailBoat(dt);
    this.reveal(dt);
    const cam = this.h.camera;
    for (const it of Object.values(this.items)) {
      if (!it.glint.visible) continue;
      it.glint.quaternion.copy(cam.quaternion); // billboard
      const pulse = 1 + 0.22 * Math.sin(this.t * 3.4);
      it.glint.scale.setScalar(pulse * (1 + Math.min(1.2, cam.position.distanceTo(it.glint.position) / 25))); // a little bigger with distance
      it.glint.position.y = it.glint.userData.y0 + Math.sin(this.t * 2) * 0.08;
      (it.glint.userData.star as THREE.Mesh).rotation.z += dt * 0.6;
    }
    if (this.bubbles?.visible) for (const b of this.bubbles.children) { const k = ((this.t * 0.9 + b.userData.phase) % 1.6) / 1.6; b.position.y = 0.04 + k * 0.12; b.scale.setScalar(k < 0.85 ? 0.5 + k : 0.01); }
    this.updateMarker();
    if (!this.active) return;
    const o = this.o;
    const boat = this.h.boat();
    const foot = this.h.foot;
    // quest start: Gran's note (one at a time, never over another modal)
    if (o.q !== this.lastQ) {
      const q = QUESTS[o.q];
      if (this.lastQ !== -1 && q && GRAN[q.id]) this.say('Gran', GRAN[q.id]!);
      else if (this.lastQ === -1 && q && GRAN[q.id] && o.q >= 2 && !hasFlag(o, 'note_' + q.id)) this.say('Gran', GRAN[q.id]!);
      if (q) setFlag(o, 'note_' + q.id);
      this.lastQ = o.q;
      this.refreshVisibility();
      this.h.drizzle(o.q === 7);
      this.drizzling = o.q === 7;
    }
    this.syncInteracts();
    // laid up (S0): she isn't offered for boarding — the walker's "Board" needs her moored; she sits on her chain
    if (o.stage < 1 && foot.active && boat.moored) { boat.moored = false; boat.speed = 0; }
    // once she floats, a walker ashore always finds her tied up (fixes saves caught un-moored after the repair)
    else if (o.stage >= 1 && foot.active && !boat.moored) { boat.moored = true; boat.speed = 0; }
    // step conditions that are places or states rather than interacts
    switch (QUESTS[o.q]?.id) {
      case 'q0':
        if (foot.active && Math.hypot(foot.feet.x - A.table[0], foot.feet.z - A.table[1]) < ARRIVE_R) this.complete('walk');
        break;
      case 'q4':
        if (!foot.active && Math.hypot(boat.pos.x - A.gate[0], boat.pos.z - A.gate[1]) < 8) this.complete('gate');
        break;
      case 'q5':
        if (Object.keys(this.h.save.records).length > 0) this.complete('fish');
        break;
      case 'q6':
        if (this.h.save.cooler.length >= Math.min(2, this.h.save.coolerCap)) this.complete('two');
        this.driftBarrel(dt);
        break;
      case 'q7': {
        if (uiLog.dest === 'cedar_landing') this.complete('map');
        const m = this.world.gameplay.interacts.find((i) => i.name === 'Interact_MoorBoat');
        // arrived: tied up, stepped ashore, or stopped by the float (selling from the boat counts too —
        // with fish aboard the market wins the context button at the float)
        const near = m && Math.hypot(boat.pos.x - m.pos[0], boat.pos.z - m.pos[2]) < 30;
        if (near && (boat.moored || foot.active || Math.abs(boat.speed) < 0.15 || (uiLog.sold ?? 0) > 0)) {
          if (!stepDone(o, 'map')) this.complete('map');
          this.complete('tie');
        }
        break;
      }
      case 'q8':
        if ((uiLog.sold ?? 0) > 0 && !this.h.busy()) {
          this.complete('sell');
          this.say('Mae', "That's your gran's rod! Never thought I'd see it wet again. Fair price, and a bit extra. Now go and see Old Tess at the chandlery.");
        }
        break;
    }
    if (reached(o, 'q4') && !passed(o, 'q6') && !foot.active) this.fence(boat);
  }

  /** The next thing on Gran's list near Kiln Point (nearest unfound Q2 pickup, then the fire, then the boat). */
  private target(): { id: string; at: V2; label: string } | null {
    const o = this.o, f = this.h.foot.active ? this.h.foot.feet : this.h.boat().pos;
    const LABEL: Record<string, string> = { rod: "Gran's old rod — the pale log", tin: 'The hook tin — the rock pool', clams: 'Clam necks — the bubbling holes', rig: 'Her campfire', chain: 'The boat', repair: 'The boat', book: "Gran's logbook — the porch" };
    let ids: string[] = [];
    if (o.q <= 1) ids = ['book'];
    else if (o.q === 2) { ids = ['rod', 'tin', 'clams'].filter((k) => !stepDone(o, k)); if (!ids.length) ids = ['rig']; }
    else if (o.q === 3) ids = [stepDone(o, 'chain') ? 'repair' : 'chain'];
    let best: { id: string; at: V2; label: string } | null = null, bd = Infinity;
    for (const id of ids) {
      const at = id === 'book' ? A.table : id === 'rig' ? A.fire : id === 'chain' || id === 'repair' ? A.chain : id === 'tin' ? A.pool : id === 'rod' ? A.rod : A.clams;
      const d = Math.hypot(at[0] - f.x, at[1] - f.z);
      if (d < bd) { bd = d; best = { id, at, label: LABEL[id] }; }
    }
    return best;
  }

  /** Ochre chevron over the current target when it's within ~30 m (on foot), and the Q2 nudge. */
  private updateMarker() {
    const o = this.o;
    const t = this.active && o.q <= 3 ? this.target() : null;
    const foot = this.h.foot;
    const d = t && foot.active ? Math.hypot(t.at[0] - foot.feet.x, t.at[1] - foot.feet.z) : Infinity;
    this.marker.visible = !!t && d < 30 && d > 1.6 && !this.h.busy();
    if (this.marker.visible && t) {
      const lv = this.lvl(t.id === 'book' ? 'table' : t.id === 'chain' || t.id === 'repair' ? 'chain' : 'beach');
      this.marker.position.set(t.at[0], (this.ground(t.at, lv) ?? lv) + 2.6 + Math.sin(this.t * 3) * 0.15, t.at[1]);
      this.marker.rotation.y += 0.02;
      this.marker.scale.setScalar(1 + Math.min(1.2, d / 20));
    }
    // a minute on the beach without a find: Gran points the way (once per item)
    if (o.q === 2) {
      if (o.steps.length !== this.q2Steps) { this.q2Steps = o.steps.length; this.q2Since = this.t; }
      if (this.t - this.q2Since > 60 && t && !hasFlag(o, 'nudge_' + t.id) && !this.h.busy()) {
        setFlag(o, 'nudge_' + t.id); this.q2Since = this.t;
        this.say('Gran', NUDGE[t.id] ?? NUDGE.rod);
      }
    }
  }

  /** The tide rip past the point: a rowed boat is set back toward the cove until the box is full. */
  private fence(boat: Boat) {
    const dx = boat.pos.x - A.fenceC[0], dz = boat.pos.z - A.fenceC[1];
    const d = Math.hypot(dx, dz);
    if (d < FENCE_R - 2) return;
    const k = (d - (FENCE_R - 2)) / 6;
    boat.pos.x -= (dx / d) * k * 0.35;
    boat.pos.z -= (dz / d) * k * 0.35;
    boat.speed *= 0.9;
    const now = performance.now();
    if (now - this.fenceToastAt > 8000) { this.fenceToastAt = now; this.h.toast("The rip sets you back. Fill the box first.", 'warn'); }
  }

  private driftBarrel(dt: number) {
    if (!this.barrelObj || hasFlag(this.o, 'barrel')) return;
    // drifts slowly across the east shelf, bobbing
    this.barrelPos.x -= dt * 0.25;
    if (this.barrelPos.x < 20) this.barrelPos.x = 52;
    this.barrelObj.position.set(this.barrelPos.x, 0.1 + Math.sin(this.t * 1.7) * 0.08, this.barrelPos.y);
    this.barrelObj.rotation.set(Math.sin(this.t * 1.3) * 0.15, this.t * 0.2, 0);
  }

  private sailMailBoat(dt: number) {
    const m = this.mail!;
    this.mailT += dt;
    if (this.mailT < 4) return; // she lingers at the dock end while you step off
    const v = Math.min(4, (this.mailT - 4) * 0.6);
    m.position.x += Math.sin(-m.rotation.y + Math.PI / 2) * v * dt;
    m.position.z += Math.cos(-m.rotation.y + Math.PI / 2) * v * dt;
    m.position.y = 0.2 + Math.sin(this.mailT * 1.2) * 0.05;
    if (this.mailT > 70) { this.group.remove(m); this.mail = null; }
  }

  /** Queue a note so dialogues never stack. */
  private say(who: string, text: string) {
    this.noteQueue = this.noteQueue.then(async () => {
      for (let i = 0; i < 200 && this.h.busy(); i++) await new Promise((r) => setTimeout(r, 150));
      await this.h.note(who, text);
    });
  }

  // ------------------------------------------------------------------ Gran's list (the Errands tab while the opening runs)
  private saved: Errand[] | null = null;
  private savedTitle = '';
  private useQuestErrands() {
    if (this.saved) return;
    this.saved = ERRANDS.slice();
    this.savedTitle = errandsMeta.title;
    const o = this.o;
    const list: Errand[] = QUESTS.map((q, i) => ({
      id: `op_${q.id}`, stamp: q.stamp,
      get text() {
        if (o.q !== i) return q.title;
        const left = q.steps.filter((s) => !o.steps.includes(s.id));
        return left.length ? `${q.title}: ${left[0].text}` : q.title;
      },
      done: () => passed(o, q.id),
    }));
    ERRANDS.splice(0, ERRANDS.length, ...list);
    errandsMeta.title = "Gran's list";
  }
  private restoreErrands() {
    if (!this.saved) return;
    ERRANDS.splice(0, ERRANDS.length, ...this.saved);
    errandsMeta.title = this.savedTitle;
    this.saved = null;
  }

  /** Test hooks (window.__debug.opening). */
  get debug() {
    return {
      state: () => ({ q: this.o.q, quest: QUESTS[this.o.q]?.id ?? 'done', steps: [...this.o.steps], done: this.o.done, stage: this.o.stage, lure: this.o.lure, flags: [...(this.o.flags ?? [])], interacts: [...this.ints.keys()] }),
      anchors: A,
      op: (id: string) => this.runOp(id),
      complete: (id: string) => this.complete(id),
      setStage: (s: Stage) => this.setStage(s),
      fastPath: () => this.fastPath(),
      /** jump to quest index q (tests): earlier steps count as done, the boat patched */
      goto: (q: number) => { this.o.q = q; this.o.steps = []; this.o.done = false; if (this.o.stage < 1) this.setStage(1); this.h.writeSave(); this.refreshVisibility(); },
      drizzling: () => this.drizzling,
      hosted: () => this.hosted,
    };
  }
}
