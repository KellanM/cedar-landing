# Rain + storm study

Branch `rain` (from v0.8.6). Requests: *"Can we add rain to the game?"*, then *"We should have more drastic
events like lightning storms, etc."* and *"ensure we creative-study the reference projects before creating
these effects."* Read `water_study.md` and `crest_study.md` first (life cycles, brightness hierarchy,
restraint, phone cost). Birds are untouched.

This record was written **before** any rain code; the build and results sections were added after.

## Success criteria

1. You can tell drizzle, steady rain and a storm apart at a glance on a 390×844 phone at the chase camera,
   mostly from the **mood of the whole frame** (palette, distance, contrast), not from particle noise.
2. Rain marks on the sea have a life (appear, open, break, go) and stay quieter than crests, wake and shore foam.
3. Lightning is dramatic but **never strobes**: soft-attack flash, at most one flicker, ≤ 1 flash / 3 s,
   a Settings toggle, and a gentler flash under reduced motion.
4. Thunder is delayed by distance; near strikes crack, far ones roll.
5. Weather comes and goes slowly with the clock and mist; storms are rare. Nothing costs > ~0.5 ms on the phone profile.

## References inspected (and limits)

Clips were pulled as short sections with yt-dlp, watched as contact sheets and as consecutive frames at
10 fps around key moments, and measured with ffmpeg (per-frame mean luma, per-0.1 s audio RMS). Frames
are in `screenshots/rain_ref_*.png` (gitignored like all captures).

| Source | Access | What it showed |
|---|---|---|
| Wind Waker HD, rain + storm at sea ("Cozy Sailing in Rain", YouTube `6Nzt8J8uHQQ`, 20:00–20:30) | **Watched; frames stepped; luma measured** | `rain_ref_ww_rain.png`: the rain world is one **dark uniform teal** (sky, sea, horizon band), low contrast; streaks are **sparse, long, thin, grey-white, faint**, nearly vertical with a slight lean. Near flash (`rain_ref_ww_flash_near_seq.png`, frames 841–899): mean luma 58 → 138, **rise ≈ 0.3 s, hold ≈ 0.4 s, decay ≈ 0.7 s** (≈ 1.4 s total), *no strobe*. The **whole frame lifts toward pale blue-grey** (sky and sea alike, contrast flattened), **three thin white forked bolts** stand on the horizon at once and **fade with the flash** rather than vanishing. Far flash (`rain_ref_ww_flash_far_seq.png`, 4.1 s): luma +20, only the **sky and horizon band** brighten; one bolt lingers ~1 s; the sea barely changes. |
| noclip.website `ZeldaWindWaker/d_kankyo_wether.ts` (decompiled WW weather) | **Read the source** | Rain: a pool of **≤ 250 streaks** anchored ahead of the camera, wind-launched, respawned when they leave the volume; **all drawn at one faint alpha (14/255)**; **streak length grows with distance** from the camera. Splashes ("sibuki"): flat **ring** quads, half the drop count, scattered **far ahead**, faded out as the camera looks up. Thunder: far flash ≈ 0.7 %/frame, near ≈ 0.5 %/frame; flash **rises fast (addCalc 0.3) and fades slowly (0.1)**; **far flashes touch only sky, clouds and fog** (0.15–0.35), near flashes also light actors and background (0.5–0.7) in a pale blue-white (B4 EB FF); bolts spawn randomly during a flash (18 %/frame). |
| Animal Crossing: New Horizons, rain by a river (`_UkjWp4TdF4`, 30:00–30:50) and beach thunderstorm (`xOeWCPZKri8`, 4:43:20–4:44:20) | **Watched; frames stepped; luma measured** | `rain_ref_acnh_water.png`, `rain_ref_acnh_splash_seq.png`: short, thin **white slanted streaks** (≈ 20°), sparse; impacts on water are **tiny clusters of 2–4 white dots that pop in ~0.1–0.2 s**, no bullseyes. Thunderstorm (`rain_ref_acnh_storm_sheet.png`): mauve-grey sky, darker green sea, foam unchanged; **no lightning in 60 s** (luma flat 123–126). A cozy game can carry "storm" with palette + heavy rain alone. |
| Sea of Thieves, struck by lightning (`gNdo_ZeQbMA`, 0:00–1:00) | **Watched; luma measured** | `rain_ref_sot_sheet.png`: dark, driven slanted streaks; the strike is an **instant white-out** (luma 70 → 108 in one frame at 49.07 s, ~0.2 s) then a cut. Dramatic but harsh: the boundary to stay away from. |
| Dredge (`D0208rVV7Gk`, 15 s) | Partly | `rain_ref_dredge.png`: desaturated grey sea with flat white foam patches, flat grey sky, low contrast. The "lightning strikes the Dredge" result was mistitled (a vlog): **no lightning evidence for Dredge**. |
| Sneaky Sasquatch (`DezqOvWkPq0`, `kzkZxJP7X9M`) | Weak | Rain exists (a "Rainy Day" music theme, `FURzSsuFd8I`; rain washes off the smell effect) but at the available 296p the streaks are unreadable; no usable frames. **Not inspected visually.** |
| A Short Hike, Alba | Not found | No rain footage found (ASH reviews mention blizzards/wind at the peak; the Alba section was sunny). **No conclusions drawn.** |
| Real: raindrops on a pond (`iborz40Kesc`) | **Watched** | `rain_ref_real_drops.png`: each drop makes **2–3 concentric rings** that open and fade in under a second, with a small central bounce; rings overlap; the surface between is **dimpled, not choppy**. |
| Real: PNW drizzle from a deck (Puget Sound, `CYSlplcdixI`, 5:00–5:30) | **Watched** | `rain_ref_real_pnw_drizzle.png`: drizzle is **mostly distance loss**: hills and far trees go to flat grey silhouettes, streaks almost invisible, the deck darker and sheened. Drizzle is "fog that falls". |
| Real: rain curtains over a lake (`a9OqPHyt1tc`) | **Watched** | `rain_ref_real_curtains.png`: grey **vertical veils hanging from the cloud base**, a little lighter than the cloud, streaky vertically, fading out toward the ground, hiding the hills behind. |
| Real: lightning over the sea, slow motion (`UnO7GJolOAs`) | **Watched** | `rain_ref_real_bolt_slowmo.png`: a dim pre-glow, then **several separate bright pulses** (return strokes) lighting the whole sky lavender-white, one jagged channel, then darkness. |
| US National Weather Service, *Understanding Thunder* | Read | Thunder heard to ~10 miles; ~5 s per mile (≈ 3 s/km); **a crack means close, a rumble means miles away**; it rolls because sound arrives from ever farther parts of the channel. |
| WCAG 2.2, 2.3.1 Three Flashes | From memory (not fetched) | No more than three general flashes per second. Rakov & Uman (*Lightning*, 2003; not fetched): 3–5 return strokes per flash, tens of ms apart. |
| Thunder audio in the WW clip | Measured, **unreliable** | A rumble ≈ 3 s long, irregular peaks 15–20 dB over the rain bed, ~4 s after the far flash; but another rumble *precedes* the big flash, so the video's audio is probably an overlaid ambience. Not used as timing evidence. |

## Mechanisms → hypotheses

| # | Evidence | Interpretation | Application hypothesis (review method) |
|---|---|---|---|
| H1 | WW: ≤ 250 streaks at one faint alpha; the frame is one dark teal. PNW drizzle: streaks nearly invisible, distance gone. | **Mood carries the weather; streaks only confirm it.** | Rain mostly moves the palette, fog distance and contrast; streaks are sparse and faint (one draw, ≤ 700 high / half low). Drizzle = mist-in + fine sparse streaks; rain = darker + denser; storm = darkest. *Review: stills at the same spot dry / drizzle / rain / storm read as four different days with streaks hidden.* |
| H2 | WW streak length grows with distance; ACNH streaks short and slanted ~20°. | Near streaks short (they move fast across screen), far ones long so they read. | Camera-relative volume, streak length ∝ distance, slant = wind (more in storm). *Review: phone GIF, no "static scratches" near the camera.* |
| H3 | ACNH dot clusters popping; real rings open and fade < 1 s; WW ring quads far ahead, faded near. | At a 35–45° chase cam a real ring is sub-pixel; the readable mark is a **pop then a small opening ring**. | Flat sea marks with a life: pop (2–3 dots) → small broken ring that opens and thins → gone, 0.5–0.9 s, ≤ 25 m from the camera, dimmer than crests. *Review: stepped frames; no bullseyes, no grid.* |
| H4 | Real drizzle/rain flattens the sea (dimpled, not choppy); WW fair weather has no crests. | Steady rain damps the small sea. | Fewer crests, no glints, softer shore contrast under steady rain; **storms invert it** (more crests, more wind lines, more roll). |
| H5 | Real curtains hang from the cloud base, lighter, fading down. | A cheap far-field cue that "it's raining over there". | A few faint veil cards on the horizon in rain/storm (one draw). *Optional: keep only if it reads.* |
| H6 | WW near flash: soft rise 0.3 s, hold, slow decay; whole frame lifts toward pale blue; bolts fade with it. WW far flash: sky/horizon only. SoT white-out is the harsh boundary. Real lightning pulses 3–5 times. | A **lift toward a pale tint**, not additive white; far = sky only. One flicker gives the "real" pulse without strobing. | Full-screen lift (one quad, only drawn while > 0) toward pale blue-grey, max ~0.45 near / ~0.18 far (sky-weighted); attack ~0.1 s, decay ~0.8 s, at most one dip-and-re-flare; ≤ 1 per 3 s. Bolts: flat white forked ribbons on the horizon over islands, 1–3 at once, fade with the flash. Reduced motion: half amplitude, no flicker; "Screen flashes" off: bolts only, no lift. |
| H7 | NWS: ~3 s/km, crack near, rumble far, rolling. | Delay + spectrum tell distance. | Synth thunder: delay ∝ distance; far = low brown-noise rumble of several swells 3–6 s; near = bright crack then rumble. |
| H8 | ACNH carries storms without lightning; Sasquatch changes the music for rain. | Cozy = the event is atmosphere, not danger. | No damage. Music softens in rain; NPC lines and the Log talk about it; rough-water rare spots get busier in storms. |

## Build

- `src/game/weather.ts`: weather rolled per day from `save.day` (nothing new saved). A day may have a main
  spell (chance 0.3 + 0.45 × the day's mistiness): morning (ends before the sunbreak), evening or overnight,
  2–5 game hours, drizzle (peak 0.30–0.44) or steady rain (0.62–0.82, likelier on misty days), ~1 h onset and
  clear, breathing ±12 %. A passing shower in the sunbreak afternoon (25 % of days, 0.6–1.2 h, light). Storm
  days (20 % roll, never the day after a storm roll, none on days 0–1, ≈ 17 % of days): steady rain builds
  from 14:00–19:30, the storm rises over the next hour, holds 1–2 h, eases before the rain clears (~5 game h).
  Day 0 is dry. Simulated over 1000 days: rain on 67 % of days (showers included), storms on 17 %, never two
  running, ~2 wet game hours per day (~8 % of play time). `__debug.weatherStats()`.
- `src/render/rain.ts` (each layer one draw call, motion on the GPU from a clock):
  - streaks (H1, H2): world-stable streaks in a 40×17×40 m box anchored 13 m ahead of the camera
    (on foot: a 0.55× box 7 m ahead, wider and stronger, H1 failed there at first, see Results); one
    alpha for all (WW), length 0.4→1.7× with distance, slant = wind × (1 + 2.2 × storm); pale core + faint
    darker rim so they read over pale planks; count ∝ rain^1.25 (drizzle ≈ 245, rain ≈ 590, storm 760; low
    quality halves);
  - sea marks (H3): pop (2–3 dots, ACNH) → broken ring that opens fast, thins and splits into 2–3 arcs
    (real drops), 0.6–0.9 s; 0.55 m radius (a true-size ring is sub-pixel at 10–25 m); only on water (shore
    field), faded under the camera and at the tile edge; count ∝ rain² (drizzle 63, rain 234, storm 300);
  - veils (H5): ≤ 6 fogged curtain cards out on the water, a shade darker and greyer than the haze,
    streaked vertically, faded at the foot and into the cloud;
  - lightning (H6): flat drawn zigzag bolts with forks and a soft halo standing in the camera's picture
    plane on a sea point in view (a world-vertical bolt looked like a diagonal scratch from the 41° chase
    camera); 1–3 per far strike, appearing together and fading with the flash; a full-screen lift toward
    pale blue-grey: near 0.42 (whole frame) + far 0.24 (weighted to the top of the frame), attack 0.08 s,
    decay τ 0.3 s, one re-flare at 0.2 s; at least 3.2 s between flashes (auto strikes ≈ 9/min at the peak,
    gated by that); reduced motion: half amplitude, no re-flare; Settings → Screen flashes Off: bolts only.
- `main.ts applyTOD`: rain greys (0.3–0.55 × R), darkens (10–16 %) and pulls the sky toward the horizon /
  haze (lower contrast); storm lerps to `STORM_SKY` (bruised grey-green) by daylight; world tint × (1 − 0.09R
  − 0.06S) (wet docks); fog closes to at least 0.5R + 0.3S of the way to the mist minimum; light flattened
  toward the fog preset by 0.85R; wind amplitude × (1 + 1.5S + 0.2R); smoke/fog-bank wind × (1 + 1.6S).
- Sea (H4): glints off under rain; steady rain calms crests (× 1 − 0.55(R − S)) and wind lines; storms add
  crests (+1.0 × S) and wind lines (spawn rate × 3.2). Boat bob/roll × (1 + 2.6S), Packer × (1 + 1.6S).
- Rough-water rare spots (tier `rare`) feed 1 + 1.6 × storm as often (H8). No damage anywhere.
- Audio (H7, H8): beds `hiss` (white, HP 3.8 k), `patter` (pink, BP 1.5 k), `roar` (brown, LP 700); ticks
  (filtered clicks) and drips (falling "plink") up to 260/min when still or on foot; gulls/songbirds/crows
  quieter in rain; thunder = delay distance/343 s (near 250–600 m: 0.7–1.8 s; far 1.2–4.5 km: 3.5–13 s), near
  = white crack + boom then roll, far = 3–5 irregular brown-noise swells (LP 220–520 Hz) + a mid growl
  (260–420 Hz) so phone speakers hear it; music bus × (1 − 0.28R − 0.12S).
- UI: clock words (Drizzle / Rain setting in / Steady rain / A shower coming / Passing shower / Clearing /
  Storm brewing / Thunderstorm / Storm passing) and rain/storm icons; Log weather note by weather and trend
  (storm note points at the rough grounds); NPC weather lines (town / village / kid × drizzle / rain / storm)
  every other chat while it rains, replacing the sunny hour lines.
- Knobs: `?tune` → "Weather: rain + lightning" (`RAIN_TUNE`) and "Weather: schedule" (`WEATHER_TUNE`).
  Debug: `__debug.rain(v|null)`, `storm(v|null)`, `lightning(near)`, `weatherSnap(autoStrikes)`,
  `weatherFx()`, `weatherStats(days)`.

## Results

Captures: `scripts/rain_capture.mjs` (stepped 0.1 s clock), `scripts/rain_perf.mjs`, `scripts/rain_probe.mjs`.

| Experiment | What happened | Decision |
|---|---|---|
| First stills (`rain_v1_*`) | Streaks and marks **invisible**: both quads were back-face culled (a billboard's and a flat quad's winding). | DoubleSide. |
| Marks after the fix | Barely any: the GPU hash used `sin()` of large arguments, which on this GPU collapsed to a few values (marks stacked on one spot). | Fract-only hash. Then 0.34 m marks were 1–2 px rings: raised to 0.55 m, thicker, and faded under the camera (they became hoops across the screen). |
| Streak contrast on foot (`rain_final_phone_foot_*`) | H1 held at sea, **failed on the pale boardwalk**: pale streaks vanish on pale planks. | Pale core + darker rim, wider streaks and a smaller, denser box near the lens when on foot. Better, still the weakest view (below). |
| Bolt shape (`rain_v4`) | A world-vertical bolt seen from the 41° chase camera read as one long diagonal scratch. | Picture-plane zigzag sprite (WW's drawn bolts). Reads as lightning on the phone and lands on the far shore in a horizon view (`rain_horizon_storm_desktop.png`). |
| Flash timing (`rain_v4_phone_boat_storm` frames 25–39, mean luma) | Near strike 93 → 142 → 129/128 (re-flare) → 111 → 100 → 95 over ~0.9 s; far strike +11. WW measured 58 → 138, ~1.4 s. | Kept; far lift raised 0.17 → 0.24 and far bolts moved lower in the frame so they are not hidden behind the top HUD. |
| Marks vs crests (H3/H4) | At 0.62 alpha the rings dominated the sea; at 0.45 they sit under crests and the wake. | 0.45. |
| Veils (H5) | At 0.55–0.95 of the fog distance they fogged into pale haze smudges. Nearer (0.4–0.75) and darker they read as a streaky curtain over the town (`veil` horizon still). Invisible in the normal portrait chase (no horizon in frame). | Kept, cheap; honest: mostly a landscape / look-up feature. |
| Palette | Dry / drizzle / rain / storm read as four different days at the same spot (`rain_stills_*_sheet.png`); dusk turns violet-grey, night near-black with streaks still visible, heavy mist + rain goes pale grey. | Kept. |

Perf (phone profile 390×844 @3x, chase view, GPU ms per synchronous render, median of 5 × 120; noisy ±0.3 ms):
dry 2.34, drizzle 2.01, rain 2.38, storm 2.42, mid-flash 3.12; weather CPU 0.01–0.03 ms/frame. Horizon view: dry
2.86, rain 3.59, storm 3.52, mid-flash 4.70. Low quality: chase storm 2.06, horizon storm 2.14. Draw calls +2–4.
The flash is a full-screen blend at 3× density (~0.7 ms in the chase view while it is up, ≤ 1 s in every ≥ 3.2 s).

Audio (`scripts/audio_verify.mjs` offline renders, 0 clipped samples, all PASS): drizzle peak −11.0 / RMS −26.4 dBFS
(12.6 % energy above 4 kHz: the hiss), steady peak −10.9 / RMS −25.1 (more mid: the patter), storm peak −1.1 / RMS −21.6
with thunder at the expected delays (2.4 km strike at 1 s → rumble from ~8 s; a 1.5 km one at 12.5 s → ~17 s); the near
crack + roll sits ~7 dB over the storm bed, far rolls ~3–4 dB. First pass had the thunder buried (+3 dB) and dropped
voices: thunder raised, storm roar / wind lowered, thunder pool 24.

Weak spots (honest): thunder is quieter against the bed than WW's ~15–20 dB (the master glue compressor and limiter
squash it); veils only show when the horizon is in frame (landscape, dragging the camera up); drizzle on foot is
subtle; rings are uniform in size, so over a long look in the storm they can read as a pattern; the flash costs
~0.7 ms GPU at 3x phone density while it is up.

## Which decisions trace to which evidence

| Decision | Evidence |
|---|---|
| Mood first, sparse faint streaks at one alpha | WW footage (`rain_ref_ww_rain.png`) + WW source (alpha 14/255, ≤ 250); PNW drizzle clip |
| Streak length grows with distance, wind slant | WW source; ACNH frames (~20° slant) |
| Rain marks = dot pop then broken opening ring, short life | ACNH splash frames; real pond drops; WW sibuki rings |
| No glints, calmer small sea in steady rain; more caps in storms | real drops (dimpled, not choppy); WW fair vs storm (crest study) |
| Grey veils far out | real rain-curtain clip |
| Flash = lift toward pale blue-grey, soft attack / slow decay, far = top of frame only | WW frames 841–899 (luma) and decompiled flash (rise 0.3 / fade 0.1, far touches sky/fog only) |
| One re-flare, ≥ 3.2 s apart, Screen flashes toggle, soft under reduced motion | real slow-motion return strokes; SoT white-out as the boundary; WCAG 2.3.1 |
| Zigzag bolts, 1–3 at once, fading with the flash | WW near-flash frames (three bolts); our 41° camera experiment |
| Thunder delay distance/343, crack near / roll far | NWS thunder page |
| Music softens, birds quieter, no danger | Sasquatch rainy theme, ACNH storm without lightning (cozy event = atmosphere) |
