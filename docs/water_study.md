# Water study: a Wind Waker sea in a muted Puget Sound palette

Branch `water` (from v0.6.2). Brief: the sea is `Sea` in `src/render/environment.ts`, a flat
MeshBasicMaterial with a tiny vertex ripple. Kellan approved "let's do them! let's focus on muted
for the first pass": Wind Waker's water techniques, kept in our grey-green → slate-teal palette and
never a saturated tropical sea. Phone-first and unlit.

## Success criteria (for this brief)

1. It still reads as *our* sea: the open-water average stays the authored TOD `sea` colour, and the foam is off-white and sits in the palette.
2. Drawn crests are sparse and soft, change over time, and calm out toward the horizon. No shimmer or aliasing at 390×844 @3x.
3. Islands, docks and rocks get a waterline that matches the visible mesh, plus surf that moves.
4. Every TOD still matches its sky (overcast, sunbreak, dusk, fog, night). The game has no dawn, day or golden TOD; dusk plays the golden-hour role.
5. Fishing hotspot ripples stay readable. Birds are untouched.
6. No extra draw calls or passes, no depth-texture reads, no fps drop on desktop. Phones run a simpler path on `quality: low`.

## Exemplars and sources (what was inspected and what was inferred)

| Source | How accessed | What it gave |
|---|---|---|
| noclip.website `src/ZeldaWindWaker/d_a_sea.ts` (Jasper St. Pierre's reimplementation of WW's `d_a_sea` actor) | **Read directly** (raw GitHub, 2026-11-02) | The sea is one 64×64 grid of 800-unit cells, re-centred on the player (±25,600). Height is a sum of 4 cosine waves (`wi_prm_ocean`) with a 6-row edge fade. Three texture maps feed the TEV: the sea texture `0x6F` and a "wyurayura" (wobble) texture `0x70`, at world UV scale 5e-4. Only one layer animates (`animCounter / 300` in V), and it doubles as an **indirect warp** (scale 0.3) on the others. There is **no shore foam** in the sea actor, so in WW the shoreline foam belongs to the island models (inferred from its absence). Wave amplitude flattens near calm rooms (`flatInter`), which also drives the colour. |
| Nathan Gordon, "Wind Waker Graphics Analysis" (Medium, 2016) | **Snippet only** (HTTP 403) | Says the ocean was studied through texture rips and Dolphin wireframes and recreated in three.js. No facts extracted. |
| Jasper St. Pierre, "The Water of Super Mario Sunshine" | **Read via the Habr translation** (habr.com/ru/articles/351656), not the original | A 64×64 wave texture plus a second copy scrolling on one axis gives moiré "bubbling". Hand-made mip levels: clear near, bright glare band far. An alpha test discards 0.13–0.92 brightness, so only the dim film and **hard-edged glare** survive. |
| Scott Michaud, "The Graphics Technology of Super Mario Sunshine" (PC Perspective, 2018) | **Read directly** | Brighter far mips fake Brewster-angle glare. The effect depends on resolution. |
| Erik Roystan Ross, "Toon Water Shader" | **Read directly** | Noise cut at 0.777 gives sparse white marks. Scroll 0.03 UV/s with a distortion map (0.27). Foam width from depth and the surface normal (wide on rocks, thin on beaches). `smoothstep` AA. Normal alpha blending, not additive. |
| Texel Raptor, "Croakwood devlog #5: Water" | **Read directly** | A top-down ortho camera just above the water renders what crosses the surface. That gets turned into a **distance field to the shoreline**, which allows animated bands that travel toward shore and collars around any object. The depth-threshold method cannot animate inward. |
| Rare, "The Technical Art of Sea of Thieves" (SIGGRAPH 2018) | **Snippet only** | FFT ocean. A foam mask with feedback blended with painted textures. Not transferable to phones. |
| Wind Waker footage (GC / HD) | **Not inspected in this session**: no video access from the tools | Everything said below about crest shape, density, glints and scroll speed *in WW itself* is from memory of the game, not frame-checked. **Provisional.** |

Footage remembered (provisional): crests are white brush curls, arcs with a hooked end, lying across the swell. They are sparse, drift slowly and pop in and out. Shore foam is a bright band hugging islands with a second band that pulses. Sun sparkles are small four-point stars that twinkle in the sun's reflection. All of it is unlit and hard-edged.

## Mechanisms distilled → hypotheses

1. **Crest marks come from a pattern that gets switched off, not from geometry** (WW texture layer, Roystan threshold). *Hypothesis:* a procedural crest per grid cell, gated by low-frequency noise, gives sparse marks that appear and vanish without a texture budget. *Review:* density and pop in the open and wake views.
2. **Two layers moving differently stop the eye from reading a tile** (WW's animated warp layer, Sunshine's one-axis second layer). *Hypothesis:* two crest grids (7 m and 5.3 m cells) about 34° apart, drifting at different speeds downwind.
3. **Detail must fade with distance on purpose** (Sunshine's hand-made mips). *Hypothesis:* fade the crests by distance **and** by on-screen pattern size (`fwidth(world)`), so phones never get sub-pixel crest noise.
4. **Shoreline from a distance field, not a depth test** (Croakwood). *Hypothesis:* build the field at load from the chunks we already ship. Bands at `mix(reach, edge, phase)` roll toward land. No exporter run is needed.
5. **Glints are a hard threshold inside the sun's reflection** (Sunshine's alpha test). *Hypothesis:* per-cell four-point stars with their own twinkle clocks, gated by a reflection cone, coloured per TOD.
6. **Colour by value steps, not hue** (Roystan's depth tint, desaturated for us). *Hypothesis:* two hard-edged steps from deep to shallow, derived from TOD `sea` / `shallow`, then desaturated.

## Build (what shipped)

- `src/render/shorefield.ts`: the **shore field**, built once per world load (and on a quality change).
  1. *Slab pass:* the chunk meshes are drawn by an ortho camera at y = +0.15 looking down, 30 m deep. Land above the slab is clipped, along with docks and roofs, so water under piers stays water. The seabed height goes into RGBA8 as 16-bit fixed point.
  2. *Wire pass:* the edges of steep faces that pierce the surface are drawn as lines: pilings, posts, stacks, and the hull sides of `dynamic.glb` buoys and moored boats (kelp excluded). Lines rasterise even edge-on, so these mark themselves as land and get foam collars. Dock beams that sit just above the water are excluded.
  3. *Cover pass:* everything 0.15–4 m above the water (pier decks, boardwalks, floating docks) is drawn from above. Water under a deck gets no foam and is 7% darker. This is stored as depth −(d + 1) so the flag survives filtering.
  4. *Cleared regions:* a flood fill classifies each one. Inside the gameplay land grid the grid's majority wins; outside it, the region is land if more than 60% of its rim is a shore slope shallower than 1.5 m.
  5. *Field:* an exact Felzenszwalb–Huttenlocher EDT, run twice for a signed distance, stored as an **RG16F** `DataTexture` (signed distance in metres, depth in metres) with linear filtering. Size is 990×1024 (0.48 m/texel) on high and 512 on low. It takes about 170–260 ms once at load on this desktop. No exporter changes.
- `src/render/sea.ts`: one unlit `ShaderMaterial` shared by the near patch and the far ring (fog-aware, no extra passes, no depth reads). Layers:
  - **Shallow → deep:** two AA'd hard steps from depth (0–4.5 m) and shore distance (1–9 m). Deep = TOD `sea` × 0.97. Shallow = TOD `shallow` pulled 30% back to `sea` and desaturated 30%.
  - **Swell (item 7):** a 3-tone banded brightness of ±2.5% downwind. It fades out with the crests.
  - **Crests (items 1 and 6):** a brush-stroke SDF. It is a sliver bowed downwind, thickest near its leading end and tapering to points, with a small curl at the leading tip. Each crest lives on its own clock: it grows, holds, then **erodes**, shortening and thinning rather than alpha-fading. Two layers drift with `LIGHT_U.uWindDir`, which is the same wind that bends the trees. A noise mask means only about half the sea carries crests at any moment. Crests fade by distance (gone at 95 m), by pixel footprint (gone below about 0.12–0.42 m/px), and within 2.5–6 m of shore, where the surf takes over. AA widths come from the continuous world footprint, not `fwidth(d)`, which drew faint seams at the cell edges (v1 bug, below).
  - **Shore foam (item 2):** a broken waterline 0.3–0.6 m wide, narrower around deep-water pilings, plus 2 surf bands per 5.5 s cycle. They start 3.2 m out, roll in and thin, and only on shelving shores (depth below about 1.2–3 m), so the harbour pilings get a quiet collar rather than surf.
  - **Glints (item 4):** star SDFs in 1.4 m cells inside a reflection cone (cos 0.86) around `LIGHT_U.uSunDir`. Each twinkles on its own clock. They are warm at dusk (`#ffd8a6`), white-warm at sunbreak, cool at night (moon, `#cfdcf4`, 0.7 strength), and off in overcast and fog.
  - **Variants** for A/B: `?sea=classic|flat|crests|full|field` (`classic` is the old material, `field` is a debug view).
- `src/render/wake.ts` (item 5): the bow arms break into tapered brush-stroke dashes, the stern trail is scalloped and breaks into strokes as it ages, and a thin broken **hull collar** breathes around the waterline. All of it uses the same draw call, with alpha-to-coverage for smooth edges and foam derived from the TOD sea.
- `src/render/windlines.ts` (item 6): at most 3 camera-facing swooshes, one every 2.5–6 s, 9–16 m long. Each draws downwind and curls at the end. They are off in fog and under reduced motion, at 0.45 at night, in one draw call that is skipped when idle.
- Reduced motion (`reduceMotion()`): the sea clock eases to 0.15× (slowed, no phase jump), crest drift stops, and wind lines are off.
- Quality `low`: a 512 field, one crest layer, crests gone by 66 m, and glints only within 80 m.

## Experiments and results

All captures are in `screenshots/`. The views are harbour (Cedar Landing from the hill), open, shore (Hermit's Key), sunward (toward the TOD sun or moon), hotspot (`LIFE_HS02`, chase cam) and wake (under way, chase cam).

| Run | What changed | Result |
|---|---|---|
| `water_base_*` | baseline (v0.6.2) | A flat slab per TOD. Islands sit on the water with no contact line. |
| `water_field_map.png`, `water_field_*` | debug field | Islands, the reef crescent, stilts and stacks are all found. The open sea past the terrain is classified as water. |
| `water_v1_*` | first full pass | **Rejected:** the crests were too big, dense and bright (comma blobs). Faint dotted **grid seams** came from `fwidth(d)` across cell edges. The harbour shallows were too cyan and marbled, with white surf around every piling. |
| `water_v2_*` | footprint-based AA, smaller and sparser crests, desaturated shallows, surf only on shelving shores | The seams are gone and the harbour reads grey-green. The crests now read as **moons or smiles (C shapes)** rather than waves. |
| `water_v3_*` | brush-stroke crest SDF with a curl | Reads as drawn wave strokes. This is the keeper. |
| `water_v4_*` | all TODs + sunward view | Every TOD keeps its sky match. Glints show at sunbreak and dusk. Found a debug-only artifact: a teleport stretches the wake strip across the map. The capture now runs the wake view last. |
| `water_v5`–`v7_*` | wake restyle, hull collar, wind lines, buoy and boat collars | The hull collar and dashed bow arms match the crest language. The stern trail stays solid near the boat, which is fine (churn). |
| spawn dock (`smoke` `phone_01_spawn.png`, `spawn_full.png`) | — | **Bug:** a white slab of foam under the Keeper's Cove dock. Fixed in three steps: lower the slab ceiling to 0.15 m, take only steep faces that pierce the water into the wire pass, and add a cover pass so there is no foam under decks or floating docks. A thin collar now remains along the float's edge. |
| `water_final_*`, `water_crests_*`, `water_classic_*` | final full set / crests only / old sea, same views | Contact sheets below. |

### Contact sheets (phone 390×844 @3x and desktop 1280×800; rows overcast, sunbreak, dusk, fog, night; columns harbour, open, shore, sunward, hotspot, wake)

- Baseline v0.6.2 (5 views, before the sunward view existed): `screenshots/water_base_phone_sheet.png`, `screenshots/water_base_desktop_sheet.png`
- Old sea in the current build (`?sea=classic`, all 6 views): `screenshots/water_classic_phone_sheet.png`, `screenshots/water_classic_desktop_sheet.png`
- Crests only (`?sea=crests`): `screenshots/water_crests_phone_sheet.png`, `screenshots/water_crests_desktop_sheet.png`
- Full set (items 1–7): `screenshots/water_final_phone_sheet.png`, `screenshots/water_final_desktop_sheet.png`

There is no separate "items 1–4 only" sheet. Items 5–7 are small by comparison (collars, wake strokes, swell at ±2.5%, sparse wind lines), so the `crests` → `final` step shows 2 + 3 + 4 together.

### Perf (`scripts/water_perf.mjs`, `screenshots/water_perf.txt`)

The bench is ms per synchronous `renderer.render` of the same view (median of 5×120 frames, synced with `readPixels`) on this desktop GPU, with "sea" = frame minus frame with the sea hidden. The phone viewport renders at DPR 2 (780×1688) on high and 1.5 on low. **fps was 60 (vsync-locked) in every cell, before and after.** Draw calls are unchanged (±3 from birds and smoke).

| viewport / quality | view | classic sea ms | full sea ms |
|---|---|---|---|
| phone high | open | 0.19 | 0.32 |
| phone high | harbour | 0.33 | 0.69 |
| phone high | chase (under way) | 0.44 | 0.85 |
| phone low | open | 0.18 | 0.14 |
| phone low | harbour | 0.20 | 0.40 |
| phone low | chase | 0.15 | 0.41 |
| desktop high | open | 0.05 | 0.37 |
| desktop high | harbour | 0.77 | 0.66 |
| desktop high | chase | 0.17 | 0.44 |

Reading: the new sea costs roughly +0.1 to +0.4 ms of GPU per frame on this machine. That is within run-to-run noise in some cells (the desktop harbour comes out cheaper than classic). There are no new passes and no depth reads. Wind lines and the hull collar add no draw calls (the collar shares the wake mesh; wind lines are one mesh, hidden when idle). On a real mid-range phone the fragment cost scales with the GPU; the low path (one crest layer, shorter crest and glint ranges, 512² field) is the fallback. One-time CPU cost: the shore field build takes about 170–280 ms on this desktop at 1024² (field + 2 EDTs + flood fill + 4 small render passes).

### Reduced motion (verified, `prefers-reduced-motion: reduce`)

Over 2 s of wall time the sea clock advanced 0.30 s instead of 2.0 s, crest drift was 0, and the wind lines were disabled.

## Open questions / weak spots

- WW footage was not frame-checked in this session. The crest shape, density and speed are tuned by eye against the brief, not measured against the game.
- The field is built from chunk geometry at load (about 0.2 s on desktop; expect about 0.5–1 s on a phone at 1024², or less at 512 on low). If that hurts phone load times, bake it in the exporter as a PNG instead.
- The field only covers the chunk bounds plus 24 m. Backdrop shores (far mountains and shores) get no foam, which is acceptable because they sit in the haze.
- Open water past the terrain reads as 30 m deep, so the shallow tint relies on shore distance there.
- The wind lines use `Math.random`, so screenshots differ run to run.
- The bench measures a desktop GPU at phone resolution. A real mid-range phone has to be checked on device.

## Tuning knobs (`?tune` → "Water"; `WATER_TUNE` in `src/render/sea.ts`, persisted as `salish-water-tune-v1`)

`crest` (opacity), `crestDensity` (share of the sea with crests), `crestScale`, `crestSpeed` (m/s downwind), `crestFar` (m),
`shore` (foam opacity), `surfPeriod` (s), `surfReach` (m), `shallow` (tint strength), `shallowDepth` (m),
`glint` (strength ×), `glintCone` (cos of the reflection cone), `swell` (banding amplitude), `windLines` (0/1).
For A/B: `?sea=classic|flat|crests|full|field`. Debug: `__debug.seaFieldImage()`, `__debug.benchFrame(n)`, `__debug.state.seaField`.

## Test results (final build, preview :5198)

smoke, foot_verify (PASS), birds_capture, shop_capture (PASS), mammals_capture, people_capture (PASS), fishing_capture: all exited 0 with **0 console errors** on both phone and desktop. Logs are in `screenshots/tests/`.
