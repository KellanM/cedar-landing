# Cedar Landing audio: study record

This is a short record of the research, decisions and evidence behind `src/audio/`. Read it before redoing the research.

## Brief

- **Game:** a cozy Puget Sound fishing game, phone-first, set before about 1930.
- **Scope:** sound effects for fishing, the world and the UI, place and time-of-day ambience, and an adaptive score.
- **Fixed requirements:**
  - No audio work before the first gesture; suspend when the tab is hidden.
  - Low CPU.
  - Music and Sound volume settings, persisted in the save.
  - Must sound good on a phone speaker over long play.
  - Respectful culture: no imitation of Indigenous songs, drums or vocals, and no "native flute" pentatonic clichés.
- **Success criteria:**
  1. The music rests more than it plays and never nags.
  2. The fishing fight feels lifted, then resolved.
  3. Every action has a clear sound.
  4. Nothing clips, and the voice count stays bounded.
  5. The mix still works with the bottom octave removed (phone speakers).

## Exemplars inspected, and what they show

**Limits.** No audio could be played in this environment. The evidence comes from:
- soundtrack listings with track durations (Bandcamp);
- composer and developer interviews;
- official developer posts and wiki data.

Every "how it sounds" claim below is therefore secondhand. Some assumptions in the brief were corrected along the way, noted in the table.

| Exemplar | Source | What it shows | Mechanism we took |
|---|---|---|---|
| Sneaky Sasquatch (RAC7) | Music by A Shell in the Pit and scntfc, not RAC7. Bandcamp, *Stealthy Snacks* | 19 tracks, 0:48–4:13, median about 2:36. Named by place or weather ("The Ocean", "Rainy Day", "Windy Pines"), with ~1 min stingers for minigames. | One cue per place or mood, short pieces, separate short fight/catch cues |
| A Short Hike (Mark Sparling) | Bandcamp liner notes; uppercutcrit.com/?p=5137 | Music "changes depending on the player's location". Each "Long Hike" track lays out the layers. Sparling: "You don't want to get tired of the music… little pockets of respirable layers". | Place-driven variants plus rest zones. Arrival at a place can cue music. |
| Animal Crossing (Totaka et al.) | societymusictheory.org/node/1162; nintendoworldreport (New Leaf); nookipedia (Animalese) | Hourly loops tied together by shared motifs. Evening gets "more bass", late night turns "mysterious". Animalese voices are one clip per letter, sped up, with pitch set per character. | A gentler, lower and slower night variant. Per-NPC pitched murmur blips with spaces and punctuation as pauses. |
| Alba (ustwo; composer Lorena Alvarez) | cassinisound.com/casestudy-alba | Music is kept mostly for quest events so the ambience can breathe. Birdsong is clean and species-specific. | Ambience first; bird calls come from the real bird spots in the world data. |
| Dredge (composer David Mason, not Ben Prunty) | simplegamer.co.uk; player threads | Sparse location music, with dread carried by sound effects. No designer source was found for the fishing-layer logic. | Treated as inference: the fight layer is a separate stem driven by line tension. |
| Stardew Valley (ConcernedApe) | stardewvalley.net dev post (?p=854) | "Seasonal songs don't loop… ambient seasonal soundscapes fill the void between songs." Players ask for an option to adjust the time between tracks. | Play a piece, then rest on ambience. The gap is a tunable knob. |
| Minecraft (C418) | minecraft.wiki/w/Music | Gaps of 10–20 minutes between tracks; mods exist to shorten them. | Cap our gaps well below that (75–210 s). |

**Phone and loudness evidence:**
- One measured phone speaker covered roughly 230 Hz – 10 kHz ±3.5 dB (Sound & Vision).
- Bass is heard on small speakers through its harmonics (the missing fundamental).
- Sony's mobile loudness target is about −18 LUFS, or −16 in noisy settings (Rob Bridgett, Audio Media International).

**Maritime folk:** concertinas are documented aboard ship (Mystic Seaport / Folkways). "Drunken Sailor" is Dorian. Fiddle, mandolin, reed organ and ship's bell are plausible for the period but not specifically sourced.

## Hypotheses → decisions

1. **Play, then rest.** Each piece runs about 50–140 s, followed by 75–210 s of ambience only. The first piece starts about 7 s after the first gesture. Night gaps are ×1.3. In fog, 60 % of music slots are skipped and the weather sounds (foghorn, bell buoy) carry the scene. Arriving in town (harbour zone above 0.6) brings the next piece forward.
2. **Variants by context.** All variants are generated from seeds; there are no audio files.

   | Variant | Mode | Tempo and meter | Accompaniment | Lead |
   |---|---|---|---|---|
   | Day | major, Mixolydian or Dorian | 78–94 bpm 4/4, or a 6/8 lilt | fingerpicked guitar, reed-organ pad, upright-bass pluck | marimba, concertina, mandolin or vibes |
   | Dusk | major, Dorian or Mixolydian | slower | harp arpeggios | — |
   | Night | — | 60–68 bpm, or 44–50 in 6/8 | sparse harp, pad; no bass until the last A section | celesta, vibes or harp |
   | Town | — | 3/4 waltz | oom-pah-pah: bass, then concertina chord stabs | — |
3. **Form for memorability:** intro, A, (A2), B, A3, outro.
   - A2 and A3 replay the A tune exactly; only the cadence bar is rewritten.
   - B changes the lead instrument, halves the accompaniment and moves to a bridge progression ending on V.
   - Melodies follow an arch contour: chord tones on strong beats, passing or neighbour tones between, no pitch three times in a row.
   - The last three bars slow down (ritardando).
4. **Fight layer.** When the reel phase starts, the explore piece fades out over 1.6 s. A separate stem in the same key then plays:
   - a palm-muted guitar ostinato (3+3+2 accents) over I I vi V;
   - a low pulse;
   - a reed drone that swells with tension;
   - a mandolin tremolo above tension 0.6 or during a thrash.

   Tension sets the ostinato's filter cutoff and velocity. On the catch, a IV→I or V→I reed cadence plays, with a harp arpeggio (two octaves for big catches) and a bass note. The catch chime is a separate sound effect, so it still plays with the music off.
5. **Instruments are synthesised, not sampled.**
   - Karplus-Strong plucks (guitar, harp, mandolin, bass, muted guitar). Tuning measured at 0–1 cent error from midi 36 to 88.
   - Modal synthesis for marimba, celesta, vibes, bell, chime, wood and coins.
   - Detuned reed oscillator pairs for the harmonium and concertina.
   - A generated 2.4 s convolution reverb.
   - **Download cost:** 0 bytes of audio. Samples are rendered lazily in JS after the first gesture and cached (about 260 buffers maximum).
6. **Phone voicing.**
   - Bass parts are rich plucks (harmonics carry the pitch).
   - Footsteps, engine putts and grass steps were moved up an octave, or had harmonics added, after a band analysis showed 58–69 % of their energy below 200 Hz.
   - The forest rustle bed was darkened after it measured 33 % of its energy above 4 kHz.
7. **Mix.**
   - Buses: music, sfx, ambience, ui.
   - Master chain: 35 Hz high-pass → glue compressor (−20 dB threshold, 2.5:1) → +3.2 dB makeup → limiter (−3 dB) → soft clip with a −0.2 dBFS ceiling.
   - The player volume curve is squared (a perceptual taper).
8. **Era- and culture-appropriate palette.** Guitar, mandolin, concertina, reed organ, harp, ship and buoy bells, lighthouse diaphone. Modes are major, Mixolydian and Dorian. There is no flute, no drums and no vocal imitation.
9. **The soundscape is data-driven.** Sea-lion barks and seal grunts come from the world's haul-out spots, positioned by distance and pan. The world's bird spots supply eagle, heron, guillemot and kittiwake calls; gull frenzies use the birds' own `onSquawk` hook. Places add laps, creaks, a distant hammer, crows, songbirds, Swainson's-thrush-like spirals at dusk, chorus frogs and owls at night, and a foghorn in fog.
10. **Footstep surfaces.**
    - If there is geometry under the surface (a pier, deck or boardwalk), the step is **wood**.
    - Otherwise the step is classed by vertex colour converted to sRGB: green is grass, pale tan below 2.5 m is sand, grey is gravel, red-brown is wood.
    - Calibrated on a 30 × 25 probe grid around Cedar Landing: 52 wood and 2 gravel steps on the wharf-to-plaza route.

## Evidence (scripts/audio_verify.mjs, offline renders in screenshots/audio/)

All renders run through the real in-game graph on an OfflineAudioContext. The numbers below are from the final run; see `screenshots/audio/levels.json`.
- No render clips.
- Music is about −23 to −27 dBFS RMS with peaks of −2 to −3 dBFS.
- Ambience beds are −28 to −35 dBFS RMS, sitting under the music.
- 77–84 % of music energy falls between 200 Hz and 4 kHz, the band a phone plays.

These measurements show level, headroom and spectral balance. They do **not** show that the music is pleasant.

## Needs a human ear (on a real phone and on headphones)

- Whether the generated melodies are charming or aimless. Compare day seeds; `__debug.audio.forceMusic('day')` cycles through them.
- Whether the Karplus-Strong guitar and the reed concertina read as instruments rather than as synths.
- Whether the town waltz is too busy.
- The music-to-ambience balance (?tune → Audio mix: music, amb).
- How long the rests feel (?tune gapMin / gapMax).
- Engine putt character and level over a long sail (?tune engine). Is the 4.4–12 Hz "putt-putt" charming or tiring?
- Gull density near frenzies; currently rate-limited to one call per 0.8–1.4 s.
- Footstep surfaces in other villages; the heuristic was calibrated only around Cedar Landing.
- NPC murmur pitch and speed per character.
- Whether the catch chime and the resolve cadence feel rewarding without being too much on repeat catches.
