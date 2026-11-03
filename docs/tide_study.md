# Tide study: real tides and tide pools for the Sound

Status: study + first build, 2026-11-02, branch `tides`. Brief from Kellan: an "actual ocean sim for the Sound", starting with real tides, and "ensure that tide pools appear at low tides". Swell, tidal currents and local ripples come later and must plug into the same water level.

Read this before touching `src/game/tide*.ts`, `src/render/tidebands.ts` or `src/render/tidepoolart.ts`.

## 1. Question and success criteria

- **Purpose.** The water should visibly breathe over a game day, and a low tide should be an *event* you can walk out into. The rocks are uncovered, the pools hold small lives, and Gran's Log keeps the tide table and what you saw.
- **Fixed constraints.**
  - The style is unlit, flat-shaded, low-poly vertex colour, phone-first.
  - The world was modelled with the water at y = 0.
  - Guardrails (`docs/salish_sea_bible.md`): fictional peoples, nothing after the ~1930s, no sacred things or named beings.
- **Criteria.**
  1. You can read the tide state from any shore view in one glance.
  2. The tide pools are discoverable, reachable on foot, and readable at phone size.
  3. Nothing afloat ends up in the air or in the rock as the water moves.
  4. The boat never gets stuck.
  5. It costs nothing measurable per frame.

## 2. Sources inspected

Reference frames are in `screenshots/tide_ref_*.png` (gitignored, like all captures). Inspection limits: I looked at game screenshots and wiki or press material, not live play or video at speed. So anything below about game *motion* is marked provisional.

| # | Source | Why it merits study |
|---|---|---|
| G1 | Stardew Valley, the Beach tide pools (wiki overview, Wayback; `tide_ref_game_stardew_*`) | The best-known cozy-game tide pools, at the same top-down readable scale problem |
| G2 | A Short Hike, shoreline and rock foam (Steam; `tide_ref_game_shorthike_*`) | The closest stylised low-poly coast to ours |
| G3 | Alba: A Wildlife Adventure, photo-to-identify (Steam, reviews; `tide_ref_game_alba_photo`) | The closest *observe-not-harvest* collection loop |
| G4 | Dredge (`tide_ref_game_dredge_shore`), Animal Crossing (Nookipedia: no tides), Sneaky Sasquatch, Coral Island, Tchia | Checked for tides; none move the water with the clock |
| G5 | Low Tide Tales (Steam, 2026) | The one game found that is *about* low tide: a timed ~3-minute dig run, not tied to a day clock |
| R1 | Tofino ochre stars + giant green anemones (Commons; `tide_ref_real_ochre_anemone_tofino`) | Shows creature scale, colour, and clustering |
| R2 | Rialto Beach pool, Olympic stars-in-a-row, purple urchin, tidepool sculpin, hairy hermit (Commons/USFWS) | Shows pool composition and each inhabitant's silhouette |
| R3 | Hevenor Inlet zonation, Puget Sound piling barnacles, Olympic rockweed (Commons; `tide_ref_real_zonation_*`, `_barnacles`, `_rockweed_*`) | Shows the vertical "bathtub ring" |
| R4 | Whidbey flat, Discovery Park c.1980 low tide, exposed eelgrass (Commons) | Shows the wet band and the sheen of flats |
| R5 | NOAA CO-OPS station 9447130 Seattle: datums + 2026 predictions (`tide_ref_noaa_seattle_june2026`) | The shape of a real Sound tide |
| P | `docs/ref_flora_fauna.md` §2 (zonation + Logbook colours), `docs/review_world_layout.md` (the Teeth), log page 6 ("At low tide the crescent shows its teeth") | Project canon |

## 3. Findings: claim, evidence, interpretation, application

**F1. A Sound tide is mixed semidiurnal, and its lows are the unequal ones.**
- *Evidence (R5):*
  - Seattle MHHW is 11.36 ft and MLLW is 0.
  - The two daily lows differ by 2.84 ft on average, the highs by only 0.87 ft.
  - The spring/neap beat is about 14–15 days.
  - Summer's deep lows (−4 ft) fall around midday; winter's fall at night.
  - In the June plot, each day shows two similar highs and one deep low plus one shallow low.
- *Interpretation:* "two tides a day" alone reads as a sine wave. The *Sound* signature is one big low and one lazy low.
- *Application:* `src/game/tide.ts` sums the six main constituents (M2, S2, N2, K1, O1, P1) with Seattle's amplitude ratios and real speeds, on the game clock (1 game hour = 1 tidal hour).
  - The phases are tuned so day 0 has its big low at about 15:30, under the afternoon sun. That is a nod to the summer daytime lows.
  - Turns come about 50 minutes later each day, and ranges swell and shrink over about two weeks of game days.

**F2. The world can only afford to *lose* water, not gain it.**
- *Evidence (survey, `scripts/tide_survey.mjs`):*
  - Chunk geometry in the 0 to +0.25 m band has about 46,000 m² of projected area (beach tops, flat shore). Even a +0.3 m flood would drown it.
  - Between −1.5 m and 0 there is only about 27,000 m², mostly steep skirts under beach plates and the toes of stacks.
- *Interpretation:* the modelled waterline has to be *high water*. A symmetric ±1.5 m tide would flood the village twice a day.
- *Application:* `TIDE_RANGE = { high: +0.04, low: −1.72 }`.
  - World y 0 is treated as higher high water. The village is as modelled at high tide, and every low uncovers ground.
  - The Log prints chart-datum heights (0.0 m at the lowest low, about 1.8 m at high water), like a real table.

**F3. Exposure is a band, not a shoreline.**
- *Evidence:*
  - R3 (Hevenor): flat, horizontal bands parallel to the water — grey rock, a tan-orange band, a dark band, a pale band.
  - R3 (barnacles): a piling crusted grey-tan with black mussels and bright sea lettuce.
  - R4: the widest light-catching band on a low beach is the *wet* sand just above the water.
- *Interpretation:* what makes a low tide legible from a boat is the "bathtub ring": zones fixed to the rock, and a wet band that trails the falling water. The waterline moving is not enough. Our geometry has steep skirts, so without the ring a low tide just looks like the sea moved down a plinth.
- *Application:* `src/render/tidebands.ts` adds hard-edged bands on the world chunks only.
  - The bands are a barnacle band (0 to −0.3 m, pale grey-tan), a rockweed band (−0.3 to −0.85 m, olive-brown), and a low zone (dark green weed).
  - Sand gets no weed, only wet sand (darker, cooler).
  - Bands are fixed to absolute height, so the water uncovers them; it does not carry them.
  - A wet band runs above the water: wide on the ebb, thin on the flood.
  - The bands are stylised to our palette: the barnacle crust is lighter than the photographed grey-tan so it reads as a ring at phone size.

**F4. Cozy tide pools are rock rims around dull, still water, with tiny contents.**
- *Evidence (G1, the Stardew crop):*
  - About 6 irregular pools, each with a 2–4-tile rim of brown cobbles and a stepped edge.
  - The water is flat and opaque blue-grey, much duller than the sea.
  - Contents are pale star and shell icons smaller than one cobble, 1–3 per pool, with ferny anemones on the rims.
- *Evidence (R1, R2):* the stars cluster; anemones pack into cobbles; the pool floor is dark; still water mirrors.
- *Interpretation:* the *rim* is what makes a pool a pool at small size. The water must be quieter than the sea. The creatures are discoveries, not the composition.
- *Application:* each pool is
  - a ring of 10–13 faceted rim rocks (with mussel clumps),
  - a dark floor,
  - a still disc of greener, darker water at 55% opacity, with a thin pale meniscus,
  - inhabitants a few cm to 30 cm across, in the Logbook colours of `ref_flora_fauna.md`.

  The first build used the sea-like pale water and isolated octagon stacks. It read as grey plates on stepping stones and was rejected. See §5.

**F5. Zonation decides who lives where, and it doubles as progression.**
- *Evidence:* project ref §2 gives barnacles high, then mussels/goose barnacles mid, then stars/anemones/kelp low. R1 shows giant green anemones and ochre stars at the low end. Tidepool sculpins and hermit crabs live in upper pools.
- *Interpretation:* a pool's height picks both its inhabitants *and* how often it is uncovered. The lowest pools only show on big lows, which is a natural rarity curve with no extra system.
- *Application:* terraces sit at −0.15, −0.5, −0.85 and (sometimes) −1.2 m, 0.35 m apart so the walker can always climb back up.
  - High pools: hermit crab, purple shore crab, sculpin.
  - Mid pools: ochre stars (purple or orange), green anemones, sometimes hermits and sculpins.
  - Low pools: urchins, giant green anemone, ochre star, and in about a third of them a **sunflower star** (rare). It is the restoration flagship in the reference doc, so it is a reward for walking out on a spring low.

**F6. Observe, don't take.**
- *Evidence (G3):* Alba identifies animals by photographing them; there are 62 species, no scoring, and nothing is harvested.
- *Evidence (G1):* Stardew's pools are harvest nodes (coral, urchins).
- *Interpretation:* harvesting live animals clashes with this game's restoration thread. Alba's loop shows that recording can carry the collection drive on its own.
- *Application:* on foot beside an uncovered pool the context button reads **"Look in"**.
  - It opens a short note in Gran's voice naming what is there.
  - New finds go to **Log → Pages → Shore notes · tide pools**, with studio plates rendered from the game's own critter models.
  - Each newly seen species gives +5 Shells. Nothing is removed.

**F7. No cozy game we found moves the water with the clock.**
- *Evidence (G4, G5):* Animal Crossing explicitly keeps the beach a fixed size. Stardew's pools are static. Low Tide Tales runs low tide as a timed mini-run.
- *Interpretation:* this is open design space. The risk is that a moving waterline breaks everything built for y = 0 (floaters, birds, collision, the boat).
- *Application:* there is one shared water level, `WATER.y`, that everything afloat reads. The checklist is in §4.

**F8. The Teeth.**
- *Evidence:* Gran's page 6 says "At low tide the crescent shows its teeth. Go round, not through." `review_world_layout.md` describes the Teeth as the reef across the Crescent mouth.
- *Application:* a reef line of 17 extra rocks across the mouth has tops between −0.2 and −1.2 m.
  - The rocks appear one by one as the tide falls, with foam collars and zonation bands.
  - At low tide they close the gaps for the boat. The page now reads literally.

## 4. What was built

- **Model** (`src/game/tide.ts`):
  - `tideAt(h, day)`, `tideTurns(day)` (today's highs/lows), `springness`, `chartHeight`.
  - `WATER = { y, rate, pinned }` is updated each frame from the game clock.
  - Swell and currents can add to `WATER` later.
- **Sea** (`src/render/sea.ts`, `shorefield.ts`, `crests.ts`):
  - The surface sits at `WATER.y`.
  - The shore field now stores the signed distance to shore at three levels (0, −0.85, −1.75; RGBA half float), and the shader blends between them. Foam, shallows tint and crest shelter follow the falling waterline.
  - Depth is relative to the current level.
  - Each level has its own wire pass, so pilings keep their foam collars all the way down.
- **Afloat:**
  - The boat (`boat.ts`) rides the tide, and a moored boat sits on the mud if its berth dries.
  - Floaters (`floaters.ts`) follow the water but never sink below the ground under them.
  - The fishing rig, hotspots, wake, sea life, mammals and splashes work in "water space" (their groups sit at the level).
  - Hauled-out seals stay on their rocks. Birds float on the water. The chase camera looks at the water.
- **Land:**
  - `TideGrid` (`src/game/tidegrid.ts`) is a 2 m height-aware grid built from the shore field's height pass.
  - Below −0.12 m water, a cell is land if its highest surface is within 0.1 m of the surface (a friendly draft). Above that level the exported land grid alone decides, so high-water behaviour is unchanged (arch pass).
  - **Stranding:**
    - `LandCollision.move`'s wedge nudge now searches in 0.15 m steps, so a falling tide eases the boat out instead of hopping it.
    - If the boat is still stuck after 0.25 s, `Tides` poles it toward the nearest free water at 3 m/s with a one-time toast.
    - Moored boats are never nudged.
- **On foot:** walkable water follows the tide (`level + 0.3`, as before at high water). You can always walk back up the beach on a rising tide (`min(level + 0.3, feet − 0.05)`).
- **Tide pools** (`src/game/tidepools.ts`, `src/render/tidepoolart.ts`):
  - 12 sites are baked from the world (`scripts/tidepool_bake.mjs` → `tidepool_sites.json`). The bake picks shoreline points from the high-water shore field that have:
    - walkable rock or sand just inland,
    - open water and depth in front,
    - a clean edge,
    - distance from docks, moorings, shops, buoys and fishing spots,
    - greedy rock-first selection with 70 m spacing.
  - Each site is a stepped rock bench:
    - terraces at most 0.38 m apart, under the walker's step-up, and walkable;
    - 2–4 pools per bench, plus loose boulders.
  - The terraces join the shore field (foam collars, tide grid) and the on-foot world. Pools are round walk-blockers.
  - Hermit crabs, shore crabs and sculpins move as instances, only near the camera and only while their pool is uncovered.
- **UI:**
  - The Log tide table is real: today's turns, past ones dimmed, the next underlined, plus a hand-written line on the state and whether the pools will be out.
  - A rising/falling arrow sits beside the HUD clock.
  - Shore notes page in the Log.
  - NPCs comment on the tide every 4th chat (town, village and kid lines; everyday and practical).
- **Debug:**
  - `__debug.tide(y|null)` pins the level.
  - `__debug.tideAt(h, day)` and `tideTurns(day)` read the model.
  - Also `tideGround`, `tidepools()`, `tidepoolSites()`, `tidepoolLook(id)`, `tidepoolBake()`.

## 5. Experiments and results

1. **Water level only** (sea, afloat, foam): mechanically right, but from the boat a low tide barely read. The beach plates have vertical skirts, so the sea just slid down a plinth (`tide_keeperclose_*` before the bands). The hypothesis that the moving waterline alone is enough was **rejected**.
2. **Zonation bands + wet band:** the same views now read as low tide at a glance. Stacks wear pale, olive and dark-green rings, and the beach skirt turns into wet sand. **Kept.**
3. **Tide pools v1:** separate octagonal stacks with pale water. They read as stepping stones with grey plates. Two causes: `register()` owns `material.color` for the time-of-day tint, so the water colour was being overwritten by the tint (nearly white); and the stacks were isolated columns. **Rejected.**
4. **Tide pools v2:** wider, overlapping 11-gon terraces with flared skirts, so they read as one bench. Water colour comes from vertex colours. The rims are bigger and boulders sit off to the sides. In close-ups the zone ladder shows (pale high bench → olive mid → dark low) and critters read at phone size. **Kept.**
5. **The Teeth:** first pass rocks were too small next to the existing white-capped teeth; they were enlarged (1.4–2.5 m). High vs low (`tide_teeth_*`) now reads as the page says.
6. **Climbing back:** terraces 0.38 m apart with ±0.06 m height jitter sometimes made a step over the walker's 0.45 m step-up (you could walk down but not back). Now 0.35 m with ±0.02 m; `scripts/tidepool_foot.mjs` walks every pool and back up on a flood tide.

## 7. Verification and cost (this desktop; phone = 390×844 @2×, low quality)

- Scripts: `tide_shots.mjs` (high vs low stills), `tide_gif.mjs` (tide-fall GIF), `tidepool_shots.mjs` (site sheet), `tidepool_foot.mjs` (walk + look + climb back), `tide_strand.mjs` (boat over drying ground), `tide_log_shots.mjs`, `tide_perf.mjs`, `tidepool_bake.mjs`; `arch_pass.mjs` takes an optional tide level; any page takes `?tide=<y>` to pin the level.
- Per frame: `Tides.frame` about 0.04–0.07 ms of JS. A visible bench adds 4 draw calls. Hidden beyond 170 m, or when the top terrace is well under water. Critters animate only within 45 m.
- Load: the shore field build is about 320 ms at 1024 (was about 170–280 ms with one level) and about 195 ms at 512. That is three EDT pairs plus two extra line passes, once at load.
- GPU: no new passes. The sea shader does one wider texture fetch, and the tide bands are a few ALU ops on the chunk material.

## 6. Open questions / weak spots

- The modelled beaches end in vertical skirts. The bands make a skirt read as a wet bank, but real gently sloping flats would need exporter-side terrain (a sloped intertidal apron in Blender) to read better.
- The pool benches are procedural add-ons at baked sites. If the world is re-exported, re-run `node scripts/tidepool_bake.mjs <url> --write` (the JSON stores the world version it was baked for).
- There is no seasonal shift (summer daytime lows vs winter night lows) because the game has no seasons yet.
- Tidal currents are not simulated yet. The plug-in point is `WATER.rate` (flood/ebb strength) together with the shore field gradient for direction.
