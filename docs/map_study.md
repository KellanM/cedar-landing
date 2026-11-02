# Map study — Log → Map tab redesign (branch `map`, from v0.6.2)

Brief: the in-game chart "doesn't look the greatest". Keep it inside the paper Logbook, phone first
(390×844 @3x), pre-1930s Salish Sea, fictional peoples / abstract motifs only. Keep the sight-mask reveal,
visited places, localStorage data and compass behaviour save-compatible. Cheap to open on phones.

Success criteria used here (not a universal score):
1. **Reads as a chart at a glance on a phone**: crisp coasts, land vs sea vs unexplored distinguishable
   without colour alone, the canoe findable in under a second.
2. **Labels are legible and honest**: no duplicates, no clipped names, no labels under controls.
3. **Place kinds are distinguishable without reading** (town / island / stone / landmark / pots / fish).
4. **Period-true**: borrows survey-chart conventions of 1850s–1910s Puget Sound charts.
5. **Cheap**: first Map open does not stall the game on a slow phone.

## References pulled (local copies in `docs/refs/map/`)

Historical charts are public domain (Wikimedia Commons). Full-size files are in `docs/refs/map/full/`
and game captures in `docs/refs/map/games/` — both gitignored (size / copyright). Committed: the PD
detail crops `crop_*.jpg`. `view_*.jpg` are local downsized overviews (gitignored).

| # | Reference | Source | Inspected | What it taught (mechanism) |
|---|-----------|--------|-----------|----------------------------|
| H1 | Admiralty Chart 2689, *Haro and Rosario Straits*, surveyed Capt. G.H. Richards, 1859 | [Commons](https://commons.wikimedia.org/wiki/File:Admiralty_Chart_No_2689_Haro_and_Rosario_Straits_Surveyed_By_Captn._G.H._Richards,_Published_1859.jpg) (UK Hydrographic Office, PD) | full sheet + `crop_2689_sanjuan.jpg`, `crop_2689_title.jpg` | Coast is **one thin ink line**; land carries scattered **conifer tree signs** (stem + two arms) and radial hill hachures; sea is **plain paper with sparse soundings** densest near shore; island names are **spaced roman capitals laid across the land** ("SAN JUAN ISL<sup>D</sup>", "SHAW I."); water features in italic following the channel; drying banks **stippled** inside a dotted limit; title in a shield cartouche. |
| H2 | Admiralty Chart 2840, *Haro and Rosario Straits*, 1911 (surveys to 1908) | [Commons](https://commons.wikimedia.org/wiki/File:Admiralty_Chart_No_2840_Haro_and_Rosario_Straits_Compiled_From_The_Latest_British_and_United_States_Government_Surveys_to_1908,_Published_1911.jpg) (PD) | full + `crop_2840_sanjuan.jpg`, `crop_2840_rose.jpg`, `crop_2840_title.jpg` | **Lights are the only colour**: small red/magenta flares at light stations → a single accent colour for the most important marks. Roses are **thin ticked rings** with a light star — ornament kept quiet so soundings read through. Channel names spaced along the water. "Soundings in fathoms" note by the title. |
| H3 | US Coast Survey, *Puget Sound, Washington Territory*, 1867 (Geographicus scan) | [Commons](https://commons.wikimedia.org/wiki/File:1867_U.S._Coast_Survey_Chart_or_Map_of_Puget_Sound,_Washington_-_Geographicus_-_PugetSound-uscs-1867.jpg) (PD) | full + `crop_uscs1867_detail.jpg` | Hand-tinted **green watercolour band just inside the coast fading inland**, land interior left pale; **pale blue tint hugging the shore** in the water; **dashed depth curve offset from the coast**; red/black alternating **scale bar**; heavy ruled border. |
| H4 | US Coast Survey reconnaissance of the Washington coast, 1857 | [Commons](https://commons.wikimedia.org/wiki/File:1857_U.S._Coast_Survey_Chart_or_Map_of_the_Washington_Coast,_Puget_Sound,_Vancouver_-_Geographicus_-_WashingtonCoast-uscs-1857.jpg) (PD) | full + `crop_uscs1857_detail.jpg` | **Unsurveyed = blank paper**; the known coast is tinted and then just *stops*. Survey stations are joined by **dashed triangulation lines** — a period precedent for drawing the player's track as a dashed line and the unexplored as "not yet surveyed" rather than fog. |
| H5 | Wilkes / U.S. Exploring Expedition, *Holmes Harbour, Whidby's Island*, 1841 | [Commons](https://commons.wikimedia.org/wiki/File:Section_of_the_chart_of_Holmes_Harbor,_Whidbey_Island,_from_the_U.S._Exploring_Expedition.png) (PD) | full | Coast as a dense band of tree-like hachure on the land side only; soundings along the sailed track; tiny roman point names ("Pt. Maury"). Confirms "tree marks on the land edge" as a regional convention. |
| H6 | Admiralty Chart 1911, *Strait of Juan de Fuca*, 1849 (NYPL scan) | [Commons](https://commons.wikimedia.org/wiki/File:Admiralty_Chart_No_1911_America,_N.W._Coast,_Strait_of_Juan_de_Fuca_(NYPL_b20749013-5452693),_Published_1849.jpg) (PD) | overview only | Earlier, sparser survey: coast only where sailed, open water bare. |
| G1 | **Dredge** (Black Salt Games, 2023) map screen | [Dredge wiki: DREDGE Map.png / Main Map.png](https://dredge.fandom.com/wiki/Map) (fan capture of the game UI) | full | Islands = flat fill + **dark outline + pale inner offset stroke**; **faint offset contour lines** around island groups; faint rhumb lines from a small 4-point rose; black dots for POIs (the same weakness we had). A modern fishing game using offset contours as its whole sea treatment. |
| G2 | **Sneaky Sasquatch** (RAC7) area maps (Ocean, Sasquatch Valley) | [Sneaky Sasquatch wiki: Ocean map.png, Map with fast travel.png](https://sneaky-sasquatch.fandom.com/) (fan captures) | full | Our art-direction anchor. **Pictorial icons by kind** (houses, trees, docks, snorkel) instead of text; **two-tone sea** (lighter shallows band around land, darker channel); fish silhouettes in the sea mark fishing; one region-name tab, almost no on-map text; large round markers for the player. |
| G3 | **Wind Waker** Great Sea chart screen | [Zelda Wiki: TWW Great Sea Map Screen.png, Great Sea Chart.jpg](https://zelda.fandom.com/) (fan captures) | full | Names are **not printed on the map** — the selected square's name appears in a banner; a big ornamental rose shows **the player's heading**; faded decorative drawings (ships, waves) make empty sea feel charted rather than blank. |
| G4 | **Tchia** world map | [Tchia wiki: Map Overview.png](https://tchia.fandom.com/) (fan capture, small) | low-res only (provisional) | Lighter shallow band with **smooth curved** limit around islands; an undiscovered island shown as a **dashed outline**. |
| G5 | **Breath of the Wild** map at 100% | [Zelda Wiki: BotW Map Screen 100%.jpg](https://zelda.fandom.com/) (fan capture) | full | Cautionary: icon-by-kind works, but **icon density overwhelms** when every POI shows at every zoom; region labels only at this zoom. → thin labels by zoom/priority. |

Practitioner / specialist accounts (secondary where noted):
- **Eduard Imhof, "Positioning Names on Maps" (The American Cartographer, 1975)** — via secondary summaries
  (e.g. Kern & Brewer, *Cartographic Perspectives* 60; Auto-Carto 6/9 name-placement papers): labels must be
  legible, clearly associated with their feature, and never overlap other names or symbols; point names go
  **above-right first**, then above-left, below-right…; names above a point are preferred over below.
  I could not access the 1975 paper itself — the rule order is taken from those summaries.
- **Riot Games, "A Story of Fog and War"** (technology.riotgames.com) — League's fog of war is a **128×128
  grid** (same as our sight mask) and the visual quality comes from how that grid is *resampled and drawn*,
  not its resolution. Supports keeping our save format and changing only the drawing.
- Not found: a first-hand talk/post by the Dredge, Sneaky Sasquatch or A Short Hike developers about their map
  screens (A Short Hike and Alba map captures were not available from the wikis tried). Game observations
  above are from inspecting captures, not creator statements.

## Baseline (v0.6.2) — `screenshots/map/cur_*.png`
Raster land at ≤640 px, upsampled → stair-stepped coasts; shallow halos from a 4-neighbour BFS → **diamond**
shapes (Manhattan distance); dotted forest hatch reads as noise; labels duplicated ("Twinbar Islets" ×2) and
clipped at frame edges; one black dot for every kind; double-ring hotspots louder than places; 11 px canoe;
blank sea; tiny two-triangle north arrow; places list shows dev-ish crab-pot names; fog edge = 3 px blur.

## Hypotheses → what was built → result

| Hypothesis (source) | Built | Result |
|---|---|---|
| Vector coast from the land field removes stair-steps (H1 single ink line) | `chartart.ts`: 1024-px land render → 3×3 box blur → marching squares (iso 0.5) → Chaikin ×2 → `Path2D`, stroked live at any zoom | **Kept.** Crisp at every zoom (see `v5_*_zoomed`). |
| Offset ripple lines from a *Euclidean* distance field replace diamond halos (Dredge, H3 depth curve) | Felzenszwalb EDT (half-res) → iso-lines at 3.2 / 7 / 12 m, fading alpha; neighbours merge like real depth curves | **Kept.** Round, merging contours; the strongest single improvement in the "sea" read. |
| Watercolour coastal band + pale shore tint (H3) instead of flat fills | field-res wash: land parchment + green band fading over 9 m; pale teal shoal tint to 12 m | **Kept.** Gives land/sea separation without heavy fills. |
| Conifer signs replace noise-hatch (H1, H5) | stem + two arms on a jittered 5.5 m grid on forest pixels | **Kept.** Reads as forest; fits low-poly firs. |
| Stippled shallows (H1, H3) | dots inside the first ripple, sparser outward | **Kept**, subtle. |
| Soundings make the empty sea feel charted (H1/H2, TWW decorative sea) | italic Fraunces numerals on a 38 m jittered grid, thinned with zoom, never under labels/glyphs | **Kept**, but they are **invented** (distance-to-land formula), not real depths — see open questions. |
| Unexplored = unsurveyed paper, not fog (H4) | hatched darker paper outside; seen area = clip of a noisy contour of the upsampled 128² mask, edged with a pencil line | **Kept.** Reads as a hand-drawn survey limit; save data unchanged. |
| Glyphs by kind (Sneaky Sasquatch, BotW) | `mapglyphs.ts`: town houses, island (list only), standing stone, cairn, beacon flare (H2 light), wreck (chart wreck sign), kelp, rock cross, crab-pot float, mark, fish; same paths drive canvas + list SVG | **Kept.** List doubles as the legend. |
| Imhof placement with collision + frame rules | greedy by priority (dest > town > island > stones > landmarks > pots); 8 candidate positions above-right first; reject outside frame or overlapping; must-show labels clamped inside and steered off the controls; island names on the island's most inland pixel in spaced caps | **Kept.** No clipping, no duplicates (same-name places within 220 m merge). Low-priority names drop out when crowded instead of overlapping. |
| Big heading canoe (TWW player arrow) | 26 px canoe on a paper halo with an ochre ring + bow tick; edge pointer when off-chart | **Kept.** |
| Ornament quiet but present (H2 rose, H3 scale, H1 cartouche) | ticked-ring rose of two-tone trigons; scale in fathoms (metres when that unit is chosen); "CEDAR LANDING / and the islands about" cartouche; neatline band of alternating 100 m ink/paper ticks | **Kept.** Neatline doubles as a scale. |
| Phone: map first, places on demand | Places = pull-up drawer showing count + current compass target; grouped list (Towns / Islands / Stones & cairns / Landmarks / Crab pots collapsed) | **Kept.** The chart grows from ~475 to ~630 css px tall on a 390×844 phone. |
| Islands with no exported land | dashed "position doubtful" ring (period P.D. convention, Tchia dashed outline) | Added after finding 5 islands with interacts but no geometry. |
| Rejected: label every POI as on the old map | — | Too dense on a 390 px phone at default zoom; crab-pot names only on zoom ≥ 2.4 or when targeted. |
| Rejected (v1): island label at the interact point | — | Interacts sit on docks/beaches; names floated in the water. Fixed with the inland anchor. |

## Performance (scripts/map_perf.mjs, phone viewport, Chromium CPU throttle 4×; workers are not throttled)
- First full build ran ~2.4 s on the main thread at 4× (EDT 0.5 s, contours 1.1 s with `Map`s). Fixes:
  half-res EDT, typed-array marching squares, and a **Web Worker** (`chartworker.ts`) for all field work.
- Now: the chart is **prebuilt in idle time ~2.5 s after load** (worker for field work). Measured at 4×
  throttle, phone viewport, on a desktop shared with other agents' browser tests (numbers vary ~3× with load):
  main-thread one-off cost 160–650 ms (GPU top-down render + `readPixels` stall + raster paint); first Map open
  45–200 ms; pan/zoom frame draw median 1–11 ms (wide fully-revealed view 3–22 ms); fog rebuild after new sight
  65–320 ms (only when the mask changed). At 1×: first open ~27 ms, frame draw ~1–2.5 ms. Worker stages total
  85–270 ms unthrottled.
- Memory: 2048-px chart raster (~11 MB RGBA for this 682×1063 m world).

## Before / after
`screenshots/map/` (gitignored; regenerate with `node scripts/map_shots.mjs <base> <tag>`):
- before: `cur_phone_fresh.png`, `cur_phone_revealed.png`, `cur_desktop_fresh.png`, `cur_desktop_revealed.png`
- after: `new_{phone,desktop}_{fresh,partial,revealed,zoomed,dest}.png`, `new_phone_drawer.png`
- landscape (from ui_shots.mjs): `screenshots/ui_landscape_18_log_map.png`
- intermediate iterations kept for the record: `v1_*` (labels clipped by frame rule, island names in water), `v3_*`, `v5_*`
- contact sheet: `screenshots/map/contact_before_after.png` (`python scripts/map_contact.py cur new`)
- perf: `node scripts/map_perf.mjs <base> 4`

## Open questions
- **Soundings are invented** from distance-to-land. If the export carries seabed depth, sample it instead.
- **Islands without land**: Eagle Snag Islet, Sentinel Fir Isle, Gooseberry Isle, Orchard Isle, Drying Rack
  Isle (and the Marigold Deep / Turtle Crescent stones' surroundings) have interacts but no exported chunk
  geometry (manifest chunks stop around z ≈ 283, x ≈ 213). Drawn as dashed "position doubtful" rings.
- **Off-theme names** (not renamed — they come from the Blender export): "Lone Palm Cay" (palms and "cay"
  are Caribbean) and "Mangrove Tangle" (no mangroves in the Salish Sea). Possible directions: eelgrass,
  bull kelp, driftwood, madrona, Garry oak.
- Water names in italic along the channel (H1) need named water bodies in the export; none exist yet.
- Not tested on a real phone/GPU; perf numbers are emulated.
