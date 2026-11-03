# Catch victory: study record

Short record of the research behind the catch "victory" sequence (`src/game/catchshow.ts`, the
catch fanfares in `src/audio/sfx.ts`, the speech box in `src/ui/catchline.ts`). Read before redoing.

## Brief

- Kellan: "the catch scene from the fishing mini game [should be] much more satisfying. It should
  feel victorious and vary based on rarity of the fish. Use Animal Crossing as a reference."
- Fixed: phone portrait first; Logbook paper/ink UI; the 15-bone skipper rig is being replaced in
  parallel (branch `chars`), so only pose timing / procedural layers here, no geometry; reduced
  motion, Screen flashes and Sound volume respected; no Indigenous musical clichés (audio_study.md).
- Success criteria (what the result must show, judged on the GIFs/stills, not the code):
  1. A clear **reveal beat**: the moment the fish is in hand reads as a win (pose + sound + frame).
  2. **Escalation** a player can feel without reading: common < uncommon < rare < legendary.
  3. **Never annoying**: a repeat common is over in ≤ 2.5 s to the slip; every beat can be tapped through.
  4. The fish is the hero of the frame (big, broadside, unobstructed by UI).

## Baseline (v0.9.4)

`screenshots/catch_before_rare_phone.gif` (lingcod 104 cm, first catch), sheet observations:
- 0.0–0.6 s the fish arcs up; **0.5–0.9 s the camera blend passes through the cabin** (a full-frame
  close-up of the red wheelhouse at 0.75 s) — the landing shot lerps the eye in a straight line.
- 1.1 s fish is overhead, but small in the portrait frame (≈ 30 % of width); the skipper is static.
- 2.25 s a small bubble "Lingcod! 104.0 cm"; 2.3–3.0 s the card slides over the bottom half.
- Audio: slap + a 2-note chime (5 notes + bell when "big"); the music resolves.
- Nothing differs between a shiner perch and the sixgill except the card's stamp and the bell.

## Exemplars inspected

Inspection method: YouTube in a real browser (Playwright), frames at 0.5 s (and 0.1 s around the
reveal) with timestamps; audio captured from the video element and analysed (spectrogram + per-100 ms
dominant pitch); Stardew + Zelda clips downloaded and stepped with ffmpeg. Two Animal Crossing
clips are **edited** (zoom-ins by the uploader; marked). No developer interviews about the catch
moment were located in this pass, so there are no practitioner claims below — only observed
evidence; treat interpretations as ours.

| ref | source | why |
|---|---|---|
| ACNH whale shark | youtu.be/i-VMrW42J-0 (unedited, night beach) | the brief's reference; biggest fish → most visible beats |
| ACNH sea bass | youtu.be/N3RTZdMMKHs (meme edit after 13 s) | the commonest fish: the "repeat" baseline |
| ACNH coelacanth | youtu.be/xtnRBu61wlU (guide, two catches) | a rare fish, for the rarity difference |
| Pocket Camp marlin + shark | youtu.be/tTfUjiRXkCg | **phone-native portrait** Animal Crossing; record vs non-record |
| Stardew Valley Legend | youtu.be/PkF0OxGYmgs | a cozy 2D catch, legendary tier |
| Zelda: Ocarina of Time chest | youtu.be/69AyYUJUBTg | the "item get" archetype ACNH's hoist riffs on |
| A Short Hike | youtu.be/IFem-aFPxu8 | minimal cozy catch card |
| Dredge | youtu.be/yihgTyUayLQ | utility catch (contrast) |

Frames: `screenshots/catch_ref_*.png` (full resolution, one beat per file).

## Findings

**F1 — The pull-out is a vertical "rocket", then an arc over the head.** *Evidence:* whale shark
14.5 s white crown splash; 14.6–15.1 s the shark leaves the water **nose-up, vertical**, taller than
the frame; 15.2–15.8 s it arcs over the player; 15.9–16.0 s lands in the hands (≈ 1.4 s total).
Sea bass: 10.5–11.5 s, ≈ 0.6–0.8 s, low arc. *Interpretation:* the size of the arc *is* the size
of the fish — the throw advertises the reward before any UI. *Application:* arc duration and height
scale with tier (0.6 s/1.4 m → 1.25 s/3.4 m), fish pitched nose-up out of the water; crown splash
and a water column scale with tier. (`catch_ref_acnh_whaleshark_14.5_splash`, `_14.8_breach`, `_15.4_overhead_arc`)

**F2 — Settle, then a fast push-in.** *Evidence:* whale shark 16.0–16.7 s held in the *wide* shot
(~0.7 s), 16.7→16.9 s a fast cut/push to a close two-shot where the fish spans the whole frame
width and overflows it (16.9 s). Sea bass: wide hold 11.5–12.0 s, push at 12.5 s. Pocket Camp: only
the **Record!** marlin got a close-up (7.0 s); the non-record shark stayed wide (23–24 s).
*Interpretation:* a short wide beat lets the eye register "it's in the hands"; the push says
"look at this". A record earns a closer shot. *Application:* camera eases (not straight-lines) into
the hold shot; rare+ / records frame the fish to ~95 % of width; a slow dolly-in continues during the hold.
Fix the baseline's through-the-cabin blend by orbiting around the skipper's head.
(`_16.3_wide_hold`, `_16.9_pushin_box`, `catch_ref_pocketcamp_07.0_record_closeup`)

**F3 — The hero pose is two hands overhead, broadside, facing camera.** *Evidence:* whale shark
17.0–24 s, coelacanth 80–88 s: both arms up, fish horizontal above the head, character looking at
camera; Zelda 10.0–10.5 s Link raises the item over his head; Stardew 33.5 s same pose in 2D.
Pocket Camp holds medium fish vertically beside the body. *Application:* rare+ always use the
two-hand hoist (even small ones), plus a little **hop + arm pump** at the moment of catch (rig-generic,
procedural). Commons keep the one-hand "show".

**F4 — The text box speaks in first person, with a pun; big/rare fish get an exclamation first.**
*Evidence:* sea bass 12.5 s box appears empty, 13.0–14.5 s types "I caught a sea bass! No, wait—it's
at least a C+!" (no preamble). Whale shark 17.0 s empty box, 17.4 s "Yes!", 20.5 s **"Thar she
blows!" in a larger font**, 21.5–23.5 s "I caught a whale shark! I'm tellin' ya, it was
thiiiiiis big!" Coelacanth 14 s "Yes!", 82 s **"Blast from the past!"** large, 88 s "I caught a
coelacanth! Think positive! Be a coela-CAN!". Pocket Camp: "Wow! I caught a **blue marlin**!" with
the name in colour + "247.1 cm" + a red **Record!** tag (8.0 s). Zelda: item name in red.
*Interpretation:* the escalation in ACNH is mostly *verbal*: an extra exclamation beat in big type
for the special fish; the pun is the reward for reading. Names in colour make the line scannable.
*Application:* an ACNH-like paper speech box (Logbook paper, ink text, fish name in ochre-red),
typed in the skipper's voice: rare+ get a big-type headline line first ("Got it!" / tier lines),
then "I caught a lingcod! …pun". Size + Record tag on the box. Lines for every species.
(`catch_ref_acnh_seabass_12.5_pushin`, `_coelacanth_14.0_yes`, `_82.0_big_exclaim`, `_88.0_pun`, `catch_ref_pocketcamp_08.0_record_box`)

**F5 — Sound: a rising whoosh into a sparkly descending run on the reveal, then a looping jingle
under the text.** *Evidence (spectrogram `catch_ref_acnh_whaleshark_spectrogram_13.5-25s.png`):*
14.5 s broadband splash; 16.85–17.0 s a fast **rising glissando** (~200 Hz → 1.5 kHz in ~0.15 s)
exactly on the push-in; 17.0–17.5 s a **descending sparkle run** (D6 A♯5 G♯5 F5 D5, ~0.1 s/note);
from 17.6 s a regular pulsed figure (≈ 2 beats/s, bass around A3) that continues under the dialogue
with Animalese voice bands at 20.0, 21.0, 21.6–22.8 s. Zelda: a rising chromatic suspense line
2–8.8 s, **~0.7 s of near-silence (9.0–9.7 s)**, then the fanfare 9.8–11.8 s (~2 s) on the reveal.
*Limits:* only one ACNH clip analysed for audio; it doesn't establish whether rare fish get a
different jingle (we found no evidence they do — the visible differences are verbal + size).
*Interpretation:* the sting marks *the moment*, the loop gives the text room; a breath of silence
before the fanfare makes it land (Zelda). *Application:* per-tier synthesized fanfare starting on the
catch: whoosh-up + sparkle-down for uncommon+; a cornet "item-get" figure for rare; legendary adds a
timpani roll + string swell **before** the reveal, a short gap, then a longer fanfare. Commons: 2–3
note chime. The music bed's own cadence is suppressed for rare+ so it doesn't fight the fanfare.

**F6 — Size is a number in the reveal.** *Evidence:* Stardew 33.5 s card "Legend — Length: 49 in"
over the player's head + "You've caught one of the legendary fish."; Pocket Camp size in the box;
A Short Hike 28.0 s card "Pumpkinseed Fish 20.1 cm". *Application:* keep size in the box/bubble;
the card's ruler stays the size display.

**F7 — Contrast: utility catches are a banner.** *Evidence:* Dredge 52.0 s a slim top banner
"BLUE MACKEREL — Species data added to Encyclopedia", no pose, no camera. A Short Hike 27–28 s a
small popup and card, no camera. *Interpretation:* minimal is fine for the routine catch — it is
what keeps repetition pleasant. *Application:* the repeat common is a "Dredge-weight" beat:
arc, slap, chime, bubble, slip; no text box, no push-in hold.

**F8 — Zelda's light.** *Evidence:* 2.0–8.0 s rays pour from the chest; 9.0–10.5 s the item rises
in front of rays. *Application:* legendary only — a soft fan of paper-gold rays behind the fish
(static under reduced motion, never a flash).

## Hit list (prioritised)

| # | change | benefit | cost / risk | check |
|---|---|---|---|---|
| 1 | tier plan (quick / common-first / uncommon / rare / legendary + NEW/PB/PERFECT) driving all beats from one dt-driven timeline | escalation + skippable + deterministic | one new module | beat log in captures |
| 2 | arc height/duration + nose-up exit + bigger splash per tier; legendary slow-mo at the apex | F1 | fishing.ts only | GIF frames |
| 3 | camera orbit-blend (no cabin clip), tier framing, slow push | F2 + baseline bug | camera.ts | GIF frame at 0.75 s |
| 4 | hop + arm pump; rare+ force hoist | F3 | procedural, rig-generic | stills |
| 5 | ACNH-like speech box with headline + pun per species | F4 | text for 34 species | stills |
| 6 | per-tier fanfares (cornet voice, timpani, strings) | F5 | sfx + instruments; level checks | WAV peak/RMS |
| 7 | sparkle burst + Logbook-colour paper confetti (rare+), rays (legendary) | F3/F8 | one instanced mesh each | perf: draw calls |
| 8 | card stamps NEW / RECORD / PERFECT thump in one after another | F4 | CSS | stills |

Tuning guesses (not researched): exact durations below, the confetti count, the fanfare notes.

## Result

See the bottom of this file (filled after the build).
