# Hotspot study: fishing spots as feeding water (second pass)

Branch `hotspot` (from v0.8.1). Feedback: *"Can we please take some of the lessons we learned from the wave
animation and apply them to the design of the fishing ripple areas? The concentric rings look a little
disconnected from the style of the game and the foam areas seem static instead of evolving."*

Read first: `docs/crest_study.md` (the model: marks as events with a life, one stroke language, restraint)
and the first hotspot pass in `Ocean/docs/study/fishing_polish.md` (§4, e7-e8: the spot had to be loud
enough to read at sailing distance; a dark hard polygon was rejected). Birds are untouched. The fishing
fight's own FX (`splash.ts`) are untouched.

## Success criteria

1. Reads as **water where fish are feeding**, not a target: no perfect concentric rings, no confetti of polygons.
2. Every mark **does something over its life** (wells up, spreads, breaks, dissolves); the patch never repeats.
3. Still says **"fish here, cast here"** from the chase camera on a phone, at day, dusk, heavy fog and night.
4. Same stroke language as the crests; brighter than crests (it is a gameplay marker), no brighter than shore foam.
5. No more draw calls than before; GPU cost small on the phone profile; float stays readable during the fight.

## Baseline (v0.8.1, `screenshots/hotspot_before_*`)

| Evidence | Finding |
|---|---|
| `hotspot_before_phone_inrange.png` (strip, 0.5 s apart), `hotspot_before_phone.gif` | Three perfect, evenly spaced rings expand from the centre forever: a bullseye/UI target. They dominate the frame. |
| same | The "churn" is hex/blob polygons that grow, hold and shrink **in place** (no travel, no break-up); the broken-ring bubbles are C-shaped glyphs. Nothing evolves; it loops. |
| `hotspot_ba_inrange.png` | The halo is a hard-edged pale-aqua polygon; flakes are angular confetti, unlike the crests' drawn strokes. |
| `hotspot_ba_night.png`, `_fog.png` | The rings carry readability at night and in fog. Any replacement must keep that. |

## References (reused + added) and limits

Reused, already inspected in the crest study and first hotspot pass: Wind Waker `usonami` pool (marks are
events, size-tied life, drift while active); A Short Hike open water (`game-crests/screenshots/crests_ref_ashorthike.png`:
thin, wobbly, *closed but irregular* contour loops; white reserved for shore and wake); Dredge "Disturbed Water"
still (loose scatter of broken bubbles, no concentric rings); Animal Crossing (shadows, fin for a big fish);
Sea of Thieves/Callaghan (foam outlives the break and decays piecewise).

Added for this pass (text sources only; no new footage watched):

| Source | What it says | Used for |
|---|---|---|
| Deneki, *Identifying nervous water* (deneki.com/2017/11/identifying-nervous-water) | Nervous water is "surface disturbance created by a pod of fish"; it **moves differently from the wind** (check against a landmark); "subtle flashes on the surface" from fish turning. | Chop dashes that jitter and drift *against* the wind; keep the silver glints. |
| Gink & Gasoline, *Use birds to locate bait* | Birds on/diving over the water mark bait; diving in numbers = feeding frenzy; activity comes and goes with conditions. | Birds already do this (unchanged); feeding comes in bursts. |
| Search snippets (thefisherman.com, bassresource forum, sciencenotes bait-ball) | Boils = fish breaking up through bait; "white water" as they break; bait ball churns the surface. | The boil life cycle. |
| Stardew Valley bubbles (wiki 403; from memory, unverified) | A small bubbling patch that comes and goes. | Not relied on. |

No game footage was frame-checked for this pass; A Short Hike fishing spots could not be confirmed from sources.

## Mechanisms -> hypotheses

1. **A spot is a place where events happen, not a sprite** (WW pool, crest study). Boils, dimples and flicks are
   short-lived marks spawned around the bait ball; the only standing mark is the slick, and its outline morphs.
2. **Life = well up -> spread -> break -> dissolve** (crest lip/curl/break/beads; boil observations). A boil is a glassy
   lighter bulge (not foam) with a thin brush-stroke rim that is fat on one side, spreads, splits into fingers, and leaves
   beads that drift out and pop one by one.
3. **Ripples are born, not looped** (Dredge: no concentric rings). The only rings are small dimples from rising fish and fin
   wakes, each a dot + two rings that break into dashes and die in ~1.3 s. They are scattered over the whole patch, so its
   extent reads from many small events rather than a bullseye.
4. **Nervous water = texture, not shape** (Deneki). Short chop dashes inside the patch, clumped, jittering, flickering,
   drifting against the wind.
5. **The patch reads from afar by value and a drawn outline** (A Short Hike loops): darker bait-cloud water with a broken,
   wobbling rim whose gaps travel round it. At night dark-on-dark vanishes, so the patch is lifted instead.
6. **Bursts** (birds/feeding come and go): a slow per-spot intensity drives every rate, so the spot breathes.
7. **Restraint / hierarchy**: boils keep apart; marks part around the float; the active spot calms to 35 % during the fight.

## Build

`src/game/hotspots.ts` (rewritten). One `InstancedBufferGeometry` quad pool (max 220), **one draw call** for every mark,
SDF-drawn in one shader (`FRAG`), riding the sea's vertex ripple like the crests, fogged:

- **slick** (one per spot within `drawDist`): wobbly outline from loop noise (seamless in angle) that slowly morphs; darker
  core; chop dashes in 0.9 m world cells; broken rim. Follows the wandering bait ball at 0.4×. Radius 5.4 m × tier (1 / 1.2 / 1.35).
- **boil** (0.6-0.85 /s × burst, 2.6-3.8 s, r 0.9-1.7 m × tier, gold-tinted head on rare spots): dome -> rim spreads (ease-out) ->
  fingers break 0.2-0.5 -> 11 lace beads drift out and pop 0.58-0.96.
- **dimple** (2.4-3.4 /s, 1-1.6 s, r 0.32-0.64 m): dot, ring and lagging inner ring, breaking into dashes. Also left behind fins every ~0.3 s (replaces the V-wake blobs).
- **flick** (0.28-0.45 /s, 0.75 s): six bait skip away in a fan, three tiny splashes each.
- **contour** (`?spot=contour` only): A Short Hike loops that draw on, wobble, break into segments and fade, in place of most boils.
- Kept from pass 1: circling fish shadows, dorsal fins (good/rare), silver/gold glints. Dropped: rings, halo, churn blobs, tide-line arc, bubble glyphs, bait-cloud ellipses (the slick core replaces them).
- Colours come from the sea's TOD uniforms each frame (`useSea(sea.uniforms)`; `Sea.uniforms` is now public readonly): head = sea->foam 0.94 (night: foam ×1.35), beads 0.58 (night 0.85 ×1.35), crests are 0.66/0.36. Fog depth is scaled by `fogK` so the spot shows a little further into mist.
- Knobs (`?tune` -> **Fishing spot**, `HOTSPOT_FX`): `activity` 1, `slick` 1, `fogK` 0.75, `clearR` 1.3 m, `drawDist` 260 m, `eventDist` 150 m. Old saved tune keys are ignored.
- Debug: `__debug.hotspotStats()`, `__debug.hotspotObj()`. Scripts: `scripts/hotspot_motion.mjs <url> <tag> [phone|desktop] [query]` (stepped 0.1 s clock, strips, GIFs, stills), `scripts/hotspot_perf.mjs <url> [hotspot] [dist]`.

## Experiments

| Run | Change | Result |
|---|---|---|
| `a1` | first build | Reads as a patch; but the rim was a continuous lasso, the dashes were dense paper confetti, and the boil was a thick white **donut** with a solid white dome. |
| `a2` | dome = glassy tint, thinner rim, sparser dashes, gappier rim | Life cycle reads (`hs_a2_boil_zoom.png`: dome -> spread -> break -> beads -> pop). Rim still an even loop for ~1 s; patch now too quiet. |
| `a3` / `b3` | brush rim (fat one side), earlier break; dashes back up. **B** = `?spot=contour` | `hs_ab_approach.png`, `hs_b3_zoom.png`: B's loops mostly merge into the slick rim and say "water", not "fish feeding"; A's boils give the frame a focal event. **Picked A.** |
| `a4` | night: lift the patch instead of darkening it | Night reads again (`hotspot_a4_phone_night_still.png`). |
| `after` | +20 % boil rate and a burst floor, rim 0.8, boils kept apart | `hotspot_after_phone_lifecycle.png`: mixed life stages, no stacked boils. Shipped. |

### Comparison (same views; before = v0.8.1 dist, after = this branch)

Shots (`hotspot_motion.mjs`, LIFE_HS02, chase cam): `approach` 20 m, `inrange` 9 m, `fog` (mist 1), `night` (23:00), `dusk` (19:30).

- GIFs (5 s, 10 fps, stepped): `screenshots/hotspot_before_phone.gif`, `screenshots/hotspot_after_phone.gif` (the in-range view); all shots `screenshots/hotspot_{before,after}_{phone,desktop}_{approach,inrange,fog,night,dusk}.gif`
- Strips (0.5 s apart): `screenshots/hotspot_{before,after}_{phone,desktop}_<shot>.png`
- Side-by-side stills (phone before | phone after | desktop before | desktop after): `screenshots/hotspot_ba_{approach,inrange,fog,night,dusk}.png`
- Life cycle contact sheet: `screenshots/hotspot_after_phone_lifecycle.png`; fight with the new spot: `screenshots/hotspot_after_fight_phone.png`

### Perf

`fishing_perf.mjs` (draws owned by the hotspot group, same frame): **8-11 before -> 4 after** (marks 1, shadows 1, fins 1, glints 1),
fps 59-60 in every phase on both profiles. `hotspot_perf.mjs` (phone 390×844 @3x, this desktop GPU, ms per synchronous render,
parked 9 m from the spot): hotspot group **0.20-0.28 ms** of a 2.1-2.9 ms frame; whole frame before 2.04-2.14 ms vs after 2.13-2.85 ms
(run-to-run spread is about as large). CPU: ≤220 instances written per frame, no allocation.

### Tests (preview :5210)

`smoke` and `fishing_capture` (phone + desktop): exit 0, 0 console errors; every capture run logged 0 errors. Logs: `screenshots/tests/hotspot_*.log`.

## Weak spots / open questions

- **Quieter than the bullseye.** At 20 m on a phone the spot reads as a darker patch with a drawn rim and intermittent white boils;
  the old rings were louder. Night and fog read, but nothing here was tested with real players. `activity` and the rim alpha are the knobs.
- The range (10 m) is no longer drawn by a ring at ~range; the slick (5.4-7.3 m) plus scattered dimples (to 1.12× slick) suggest it, and the Cast button does the rest.
- The fight's own splash rings (`splash.ts`) are still perfect circles and now stand apart from the spot's language; left alone by brief.
- Day fog: the patch is a dark blot in thick mist rather than a lighter one (reads, but is the least pretty state).
- The gulls' dive splashes (wildlife, untouched) are still perfect rings with white shards; over the patch they are now the most geometric marks.
- Spawns use the per-spot seeded RNG, but the spawn order depends on frame timing, so captures are exact per run, not repeatable.
- `fogK` makes the spot defy the fog slightly; if the fog is meant to hide spots, set it to 1.
- Not checked on a real phone; perf numbers are this desktop's GPU at phone resolution.
