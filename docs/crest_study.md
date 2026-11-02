# Crest study: wave caps with a life (second pass)

Branch `crests` (from v0.7.4). Feedback: *"The wave crests that appear on the water look strange and out
of place, please do another pass on them. They don't seem well animated at all."* Read `docs/water_study.md`
first: it built the sea and the first crests (and admits WW footage was never frame-checked). This pass
only touches the drawn open-water crests. Shore foam, wake, glints, foam rings and wind lines are unchanged;
birds are untouched.

## Success criteria

1. Each crest visibly *does* something over its life (changes shape while it moves), instead of sliding as a sticker.
2. No grid, rows or repeated glyph at any camera angle; no dense far band.
3. Sized to the boat (a crest is smaller than the hull) and quieter than shore foam and the wake.
4. Calm in sheltered water and near the boat; fewer in fair weather.
5. Flat, unlit, no shimmer at 390×844; no measurable cost on the phone profile.

## Baseline: what was wrong (frames stepped at exactly 0.1 s, `scripts/crest_motion.mjs`)

| Evidence | Finding |
|---|---|
| `screenshots/crests_before_desktop_near_detail.png` (16 consecutive frames, 1.6 s, one crest) | **No animation to speak of.** The crest does not change shape or position visibly in 1.6 s. Life was ~9 s (`lifeRate` 0.11) with a long hold, drift 0.3 m/s. The curl at the tip is a **detached floating hook** next to the stroke. |
| `crests_before_phone_near.png`, `crests_before_desktop_near.png` | **Wrong scale and contrast.** Near the boat the sickles are as long as the hull (4–5 m) and nearly as bright as the wake. |
| `crests_before_phone_far_rows.png` (crop of the under-way view) | **One glyph, repeated.** Every far crest is the same C/ɛ mark at the same angle and size; where the two layers overlap they stack into "ɛ"/"&" doubles. It reads as a flock of birds or commas, not water. |
| `crests_before_desktop_mid.png` | Mid-distance crests become long thin scythes, all parallel. |
| Code | One crest per world cell, so on-screen density grows toward the horizon; regional noise mask switches whole patches. |

## References inspected (and limits)

| Source | Access | What it showed |
|---|---|---|
| noclip.website `ZeldaWindWaker/d_kankyo_wether.ts` (`wether_move_wave`, `dKankyo_wave_Packet.draw`, `dKy_usonami_set`) | **Read the source directly** | WW's open-sea marks ("usonami") are a **pool of 300 independent sprites**, not a texture: each is a camera-facing quad standing on the sea whose height is `scale·sin(animCounter)` (skipped while sin < 0: **rise → peak → sink, then an equal rest**). Alpha follows the sine with a lag (`cLib_addCalc`). Random scale per mark; **bigger marks cycle slower** (`0.02 + 0.05·(1−scale)` rad/frame ×1.2 → ≈1.3–4.4 s visible at 30 fps). They **drift with the wind 5× faster while visible** (`0.2 + 0.8·alpha`), lean downwind (skew), respawn at the upwind edge with alpha 0, and **fade out within 2–20 m of the player**. Only enabled by `dKy_usonami_set` (stormy areas). |
| WW HD sailing footage (YouTube 2jy92OpGEig, ~128–135 s fair, ~179–185 s storm), watched at normal speed in a browser, frames grabbed at ~8.5 fps | **Watched** | Fair weather (`screenshots/crests_ref_windwaker_fair.png`): **no crest marks at all**; the sea reads from its slowly warping foam network. Storm (`crests_ref_windwaker_storm.png`, 0.2 s apart): low, wide pale **"^" tents**, ~5:1 wide, two-tone, low contrast against the sea; each rises and sinks in ~1–2 s while others appear elsewhere; none near the boat (only the wake arms). |
| A Short Hike (YouTube Nc9dT2BbB-s, 29–33 s), watched | **Watched** | `crests_ref_ashorthike.png`: no whitecaps. Open water carries thin, pale, closed contour loops that wobble; bright white is reserved for the shore band and the wake. |
| Sneaky Sasquatch (Hj0-6vgBMCo, 62–66 s), Sea of Thieves (hf3r9TNSsyY, 1202–1206 s), watched | **Watched** | `crests_ref_others.png`: Sasquatch water is flat colour, nothing on it. Sea of Thieves: realistic foam riding wave faces and streaking off; not transferable to flat unlit phones beyond "foam outlives the break and decays". (The Dredge clip landed on a dialogue scene: no evidence; Tiny Glade not inspected.) |
| Rare, *The Technical Art of Sea of Thieves* (SIGGRAPH 2018) | Snippet | Foam mask is blurred and fed back each frame so foam **disperses rather than pops**; calm water has foam only around objects. |
| Callaghan et al. 2012 (552 breaking waves); AMS 2015 abstract | Snippets / abstract | Active whitecap ("stage A") lasts ~0.4–5 s; residual foam ("stage B") outlives it several times and decays roughly exponentially (area-weighted mean 1.4–4.8 s). |
| Monahan whitecap coverage (via secondary source); NOAA Beaufort table | Snippets | Coverage ≈ 3.84e-6·U^3.41 (~1% at 10 m/s); Beaufort 3 = "scattered whitecaps", 4 = "fairly frequent". A fetch-limited sound is mostly Beaufort 2–4. |
| Hokusai (*Great Wave*; British Museum, Christie's notes); Hiroshige, seigaiha | Snippets | Foam drawn as curls ending in **claws/hooks**, the same crest shape repeated at smaller scales; Hiroshige calmer. No sourced rules for counts. |

## Mechanisms → hypotheses

1. **A crest is an event, not a tile** (WW pool). Pool of sprites with random size, phase and placement; each lives once and is gone. *Review:* no rows/grid at high angles; nothing loops in place.
2. **Life = rise → hold → break, size-tied** (WW sine height, Callaghan stage A). Bigger crests live longer. *Review:* the stepped strip shows shape change every 0.4 s.
3. **Foam outlives the break and dissolves piecewise** (stage B, SoT dispersal, Hokusai dots). Leave dimmer beads behind; they spread back and pop out one at a time (erosion, not alpha fade).
4. **Motion = head moves relative to its foam, and drift is faster while active** (WW `0.2 + 0.8·alpha`). Something changes shape *as* it moves, so it never reads as sliding.
5. **Restraint** (WW none in fair weather and none near the player; ASH/Sasquatch reserve white for shore and wake). Fewer, smaller, dimmer than shore foam; empty right at the hull; fewer at sunbreak/dusk/fog/night; calm in sheltered water.
6. **Screen-even density** (fixes the comma band): sample spawns on the screen, not per world area, and drop crests too small to draw cleanly.

## Build

- `src/render/crests.ts`: `CREST_GLSL` `crestShape(p, t, side, seed)` is the life cycle in crest space (x across the wind, y downwind, units of the half length):
  - **rise** (t 0–0.3): a thin lip draws outward from the middle and swells (bowed downwind);
  - **curl** (0.12–0.7): an arc hooks forward and back over the lip at one end (Hokusai's claw), grows, then breaks;
  - **break** (0.4–0.82): the lip splits into fingers from the far end toward the curl and thins to nothing (an offset so no AA hairline survives);
  - **spill** (0.35→1): two rows of dimmer, lace-shaped beads appear where the head has passed, spread back, and pop out one by one;
  - the **head runs on ~1.15 half-lengths** downwind (easing out) relative to its beads.
- `CrestSprites` (default): one `InstancedBufferGeometry` quad per crest, **one draw call**, transparent, no depth write, rides the sea's vertex ripple. CPU pool (max 48):
  - spawns by casting random **screen** points to the water; rejects beyond `crestFar`, inside `near` of the boat (ramped over 4 m), below 14 px on screen, within ~2.6 crest lengths of another crest, and by **openness** (shore-field distance 5 → `shelter` m, depth 1.5 → 5 m, read on the CPU from the field texture) × moving **wave groups** (crests come in sets that travel downwind);
  - half length 0.9–1.6 m × `crestScale` × `size` (a crest is 2–3 m, about a third of the Packer), angle within ±17° of across-wind, curl end random;
  - life `life` × (0.7–1.3 by size) × jitter; drift `crestSpeed` × (0.3 + 0.7 × active), i.e. faster while the lip is up;
  - target in view = `count` × `crestDensity` × 2 × √(screen area / 390×844, 1–2) × time of day (overcast 1, sunbreak 0.85, dusk 0.75, fog 0.6, night 0.5) × 0.6 on low quality.
- `src/render/sea.ts`: head colour = sea → foam 0.66 (0.42 night), beads 0.36 (0.24), both below the shore foam. `?crests=sprites|cells|old` (default sprites); `old` is the v0.7 crescent layers for A/B in the same build. `cells` draws the same `crestShape` in jittered 10 m wind-space cells inside the sea shader, gated whole by shelter at the cell centre.
- Reduced motion: crest lives slow with the sea clock (0.15×), drift scales with it.
- Knobs: `?tune` → **Crests** (`CREST_TUNE`, `salish-crest-tune-v1`): `count` 28, `life` 4.2 s, `size` 1, `near` 4 m, `shelter` 22 m; the Water section's `crest` (opacity), `crestDensity` 0.5, `crestScale` 1, `crestSpeed` 0.3 m/s, `crestFar` 95 m still apply.
- Debug: `__debug.crestStats()`, `__debug.seaObj().crests.debugSpawn(x, z, half, life, side, seed)` (studio).

## Experiments

| Run | Change | Result |
|---|---|---|
| `crests_s1_studio` | first life cycle (top-down studio, 3 sizes) | Life cycle reads. Spent lip and curl left a 50%-AA **hairline**; beads present from the first frame. |
| `crests_s2_zoom` | hairline offset, beads only after the break, lace beads that spread back | Clean rise → curl → spill → break → dissolve. Kept. |
| `crests_v2_*`, `crests_v3_*` (phone) | in game, both approaches | **Over-corrected**: crests 1.2–2.3 m and thin were specks on a phone; the sea looked empty. Also a 7 m + 8 m clear zone emptied the bottom half of the chase view. |
| `crests_v4_*`, `crests_v5_*` | sizes 0.9–1.6 m half, thicker plateau, near 4 m | Visible but quiet. **Cells** were near-invisible at the same settings and, when made denser, bring back world-area density (thicker toward the horizon) and cannot keep crests apart or let a head travel beyond its cell. |
| `crests_v6_*` | beads die earlier, count 24, shelter 22 m | Organic scatter at the high angle, mixed life stages on screen, calm by the island. **Picked: sprites.** |
| `crests_after_*` | count 28, target scaled by √(screen area / phone), capped 2× | Desktop no longer thinner than the phone. Shipped defaults. |

### Comparison (same build; `before` = v0.7.4 served from a copy of its dist)

Strips are 6 frames 0.4 s apart; GIFs are 50 frames at 10 fps (5 s of game time, stepped exactly).
Shots: `near` (chase cam idling), `mid` (low camera over open water), `high` (looking down over open water),
`shore` (sheltered water off Hermit's Key), `underway` (chase cam at full throttle).

- Before: `screenshots/crests_before_{phone,desktop}_{near,mid,high,shore,underway}.{png,gif}`
- After: `screenshots/crests_after_{phone,desktop}_{near,mid,high,shore,underway}.{png,gif}`
- Cells alternative: `screenshots/crests_cells_{phone,desktop}_{near,mid,high}.{png,gif}`
- Life cycle studio: `screenshots/crests_after_studio.{png,gif}`

Side-by-side stills (frame 30 of each run, phone before | phone after | desktop before | desktop after): `screenshots/crests_ba_{near,mid,high,shore,underway}.png`; cells vs before at the high angle: `screenshots/crests_cells_vs_before_high.png`. References (gitignored, study only): `screenshots/crests_ref_*.png`.

### Perf (`scripts/water_perf.mjs <url> full phone high|low`, 390×844 @3x, this desktop GPU)

ms per synchronous render; "sea" = frame minus frame with the sea group hidden (the sprites live in that group). fps is vsync-bound.

| quality | view | before frame / sea | after frame / sea |
|---|---|---|---|
| high | open | 2.31 / 0.40 | 1.70–1.89 / 0.25–0.38 |
| high | harbour | 4.10 / 0.64 | 3.14–3.96 / 0.48–0.61 |
| high | chase | 2.38 / 0.84 | 1.53–2.09 / 0.45–0.70 |
| low | open | 1.58 / 0.13 | 1.23–1.83 / 0.09–0.33 |
| low | harbour | 2.96 / 0.44 | 2.27–2.82 / 0.28–0.42 |
| low | chase | 1.44 / 0.45 | 1.07–1.44 / 0.31–0.41 |

(after = two runs.) Run-to-run spread is as large as any difference: the sprites cost no measurable GPU time and +1 draw call (only when crests are alive); the sea shader skips its crest maths in sprite mode. CPU: ≤48 crests updated per frame, spawn tests cast a ray and scan the pool (a few µs). fps 54–60 in every cell before and after.

### Tests (preview :5202)

`smoke` and `fishing_capture` (phone + desktop): exit 0, **0 console errors**; every crest capture run also logged 0 errors. Logs: `screenshots/tests/crest_*.log`.

## Weak spots / open questions

- Crests are spawned with `Math.random`, so captures differ run to run (the stepped clock makes each run's frames exact, not repeatable).
- The curl is still the most "drawn" element and can read as a club at the far end of its life on a phone; the WW alternative (a low two-tone "^" tent, standing) was observed but not tried, since our camera looks down at 35–45° where standing billboards would read as cards.
- Sheltered-water calm uses distance to shore, not true fetch; a narrow channel between two islands reads as sheltered.
- Footage was watched in a browser at ~8.5 fps grabs; Dredge and Tiny Glade were not inspected.
- Not checked on a real phone; the perf numbers are this desktop's GPU at phone resolution.
