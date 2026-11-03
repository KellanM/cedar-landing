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

*(filled in after the experiments)*

## Results

*(filled in after the experiments)*
