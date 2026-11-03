# Music study: evolving chord fields for Cedar Landing

Brief (Kellan): "Can we also do a music pass? What about Skyrim's / the Elder Scrolls series' evolving
chords?" The goal is an original, generative score that keeps the slow-breathing harmony of Jeremy
Soule's exploration cues, stays cozy, sounds like the Pacific Northwest, and adapts to time of day,
weather, place and fishing. It has to run on a phone.

Read with `docs/audio_study.md` (the v0.9 audio pass: buses, gaps, fight layer, levels).

## Limits of this study (read first)

- **I cannot hear audio.** "Listening" here means signal analysis of the actual recordings:
  chromagrams, a chord-change detector, bass pitch tracking, loudness and onset density
  (`scripts/music_ref_analysis.py`). I also read practitioner interviews and docs.
  Timbre judgements (warmth, choir vowel, "cozy") come from the analysis plus well-known
  orchestration practice. They are not perceptual observations. Kellan's ears are the real test.
- The chord charts are template matches on chroma from mixed orchestral recordings with
  long reverb tails. Chord roots and colours are often right; inversions and voicings are
  not recoverable. They are evidence about rhythm and colour, not transcriptions.
  None of them is reproduced in the game.
- Mode estimates assume the strongest pitch class is the tonic. That assumption fails for
  cues sitting on IV or vi, and Phrygian readings are mostly mis-rooted Aeolian or Ionian
  (for example, "D Phrygian" for Far Horizons has the same notes as B♭ Lydian).
- The reference audio was downloaded only for analysis, kept outside the repo, and deleted
  afterwards. The URLs are listed below so the analysis can be rerun.

Analysis figures are in `screenshots/music_ref_<track>.png` (chroma with detected changes,
bass pitch class, RMS) and `screenshots/music_ref_analysis.json` (full charts).
The screenshots folder is git-ignored. Run
`python scripts/music_ref_analysis.py <wav dir> screenshots` to rebuild it.

## References analysed (signal) — YouTube "Topic" uploads unless noted

| id | cue | source |
|---|---|---|
| sky_far_horizons | Skyrim, Far Horizons (5:31) | youtube.com/watch?v=ZarbRbkV4ak |
| sky_secunda | Skyrim, Secunda (2:03) | VPgZFgOvJDE |
| sky_kynes_peace | Skyrim, Kyne's Peace (3:50) | LbNMvsSRThw |
| sky_frostfall | Skyrim, Frostfall (3:26) | 2-ggCHn4Zjo |
| sky_dawn | Skyrim, Dawn (3:58) | vlc-c6ZOOk4 |
| sky_past_to_present | Skyrim, From Past to Present (5:04) | hOxOJ1Zp9Yg |
| sky_aurora | Skyrim, Aurora (7:22) | SR1HOltzolY |
| obl_wings_of_kynareth | Oblivion, Wings of Kynareth (3:30) | X2Y39ffjvkw |
| obl_through_the_valleys | Oblivion, Through the Valleys (4:19) | 6XJCRO50ZUo |
| obl_peace_of_akatosh | Oblivion, Peace of Akatosh (4:11) | _zclZQK3yn0 |
| mw_peaceful_waters | Morrowind, Peaceful Waters (3:06) | dy6lfsOX6Yo |
| ash_short_hike | A Short Hike, "Somewhere in the Woods" (3:44) | R8p2YMww4WU |
| acnh_5pm | Animal Crossing NH, 5 PM (sunny) (fan upload) | 4F59lA8c3lk |
| ww_sailing | Wind Waker, The Great Sea (fan "extended" loop) | or8y5EC1_Rs |
| dredge_marrows | Dredge, The Marrows ambience (night) (fan upload) | 6huU35YpIDo |
| stardew_spring | Stardew Valley, Spring (It's a Big World Outside) (fan upload) | FO9WXi9gxQg |

### Measured (selected; full table in the JSON)

| cue | chord length median (p25–p75) | common tones kept (of top 4) | bass on one pitch | loudness p10/p50/p90 dB | onsets/s | centroid |
|---|---|---|---|---|---|---|
| Secunda | 4.7 s (3.4–10.2) | **2.9** | G 43 % | −44 / −29 / −23 | 0.53 | 678 Hz |
| Dawn | 4.6 s (3.2–7.6) | 2.3 | G 40 % | −43 / −32 / −24 | 0.22 | 1087 Hz |
| Kyne's Peace | 4.2 s (3.8–7.3) | 1.2 | G 40 % | −35 / −27 / −23 | 0.03 | 758 Hz |
| Frostfall | 6.7 s (5.6–8.0) | 2.1 | B 15 % | −34 / −21 / −16 | 0.06 | 719 Hz |
| Aurora | 6.2 s (4.3–10.1) | 2.1 | B♭ 17 % | −39 / −29 / −22 | 0.04 | 945 Hz |
| Wings of Kynareth | 5.4 s (4.0–8.1) | 2.4 | A 34 % | −33 / −25 / −20 | 0.10 | 1088 Hz |
| Peace of Akatosh | 7.2 s (4.4–10.1) | 1.8 | B 40 % | −40 / −26 / −21 | 0.50 | 725 Hz |
| Peaceful Waters | 4.3 s (3.4–8.2) | 2.4 | A 30 % | −42 / −33 / −22 | 0.19 | 793 Hz |
| A Short Hike (woods) | 5.0 s (4.4–5.8) | 2.2 | 29 % | −27 / −19 / −17 | 1.56 | 1830 Hz |
| ACNH 5 PM | 7.4 s (3.9–9.6) | 2.4 | 21 % | −37 / −32 / −27 | 1.37 | 1615 Hz |
| Stardew Spring | 3.3 s (3.1–3.6) | 2.0 | D 41 % | −32 / −22 / −20 | 1.41 | 1041 Hz |
| Wind Waker sea | 3.6 s (3.4–6.8) | 1.9 | 20 % | −20 / −17 / −15 | ~0 | 1536 Hz |

The detector cannot report changes closer than 2.5 s apart, and it splits one long
chord into several when the colour moves inside it. Read the medians as "a colour
change every ~4–7 s" and the p75 as "harmonies that sit 8–10 s".

## Findings

Each finding gives the claim, the evidence, an interpretation, and how it is applied here.

### 1. The "evolving chord" is mostly one chord whose colour changes, over a pedal

- **Evidence.** Wings of Kynareth reads `Dm(add9) 0 s → Dm7 9 s → D5 22 s … Dsus2 84 s
  → Dm(add9) 92–113 s → D5 116 s`: one root, with inner voices moving through the 9th,
  7th and 3rd. Secunda reads `Cm(add9)` six times in a row from 0 to 22 s, then
  `E♭maj7 25 s → Cm7 39 s → Cm(add9) 49 s → Cm7 65 s`. Dawn holds G in the bass about
  40 % of the time while the chords above go `Fadd9 32 s → G5 35 s → Fadd9 42 s
  → Gm(add9) 45 s → G 49 s → Gmaj7 66–74 s`. That is ♭VII colour and a major/minor
  3rd over one pedal. On average **about 2 of the 4 strongest pitch classes survive
  each change** (Secunda 2.9).
- **Practitioner.** Kamp & Sweeney ("Musical Landscapes in Skyrim", 2019, read via the
  Wikipedia summary only) describe "long-held chord clusters" and a static *Naturklang*
  surface animated from inside by small cells. Soule (Music4Games interview, 2007, via
  GameBanshee): "The minimalism … was very intentional." Also: "I tried to paint in soft
  tones so the ear wouldn't get worn out playing the game for 100 hours."
- **Interpretation.** The sense of movement comes from **one or two inner voices
  stepping** (a 3rd becomes a 2nd or a 4th, a 5th becomes a 6th or 7th) while the bass
  and the other voices hold. The listener hears time passing without being told where
  the music is going, so it never becomes a tune the ear tires of.
- **Applied.** A voice-leading chord engine (`src/audio/harmony.ts`). There are 4 upper
  voices plus a bass. At rest, each change may move **at most 2 voices**, each by up to
  4 semitones, and held voices are *not re-struck*. A "same root, new colour" move
  (triad → sus2/sus4/add9/7) gets the highest weight. The bass sits on a tonic pedal for
  several chords, then walks to a chord root and comes back.

### 2. Harmonic rhythm: slow, but not uniform

- **Evidence.** Changes have a median of 4–7 s and a p75 of 8–10 s across the 11 Soule
  cues. Frostfall's first chord (`Em7`) holds 28 s, and `Am7` holds 33→84 s (about
  50 s with only inner motion). The cozy references are faster: Stardew 3.3 s and Wind
  Waker 3.6 s, both metrical tunes.
- **Applied.** Chords last 6–16 s at rest, set per mood. Dawn is 8–13 s, day 6–11 s,
  dusk 9–14 s, night 12–18 s and rain 10–16 s. Every 4–6 chords one is held about 1.6×
  longer, as a breath. Durations snap to a slow 3/4 bar grid so the town and village
  layers can play metrically over the free-floating pads.

### 3. Sparse onsets and soft, dark spectra; dynamics swell rather than pulse

- **Evidence.** Soule cues have **0.02–0.5 onsets/s** (Kyne's Peace 0.03, Far Horizons
  0.02). The cozy pieces have 1.4–1.6/s. Spectral centroid is **680–1100 Hz** for Soule
  against 1600–1800 Hz for A Short Hike and ACNH. Loudness spans 15–20 dB from p10 to p90
  (Dawn −43 → −24 dB) against about 10 dB for ACNH. The RMS traces (for example
  `music_ref_obl_wings_of_kynareth.png`) show cues opening from near-silence over 10–20 s
  and dying away over about 15 s.
- **Applied.** Pads have slow attacks (2.5–5 s) and long releases (4–7 s). They pass
  through a section low-pass (1.1–2.6 kHz, darker at night and in rain). Each cue has a
  dynamic arc: it fades in from pp, swells mid-cue and dies away over the last chord.
  Onsets come only from melody fragments, occasional harp broken chords, and the
  town/village layers. The engine targets fewer than 0.5 onsets/s at sea and about
  1–1.5/s in town.

### 4. Fragments, not tunes, and silence between cues

- **Evidence.** The onset density above and the chroma show melody as short high
  streaks between long stretches of pad, for example in Secunda and Peaceful Waters.
  The Creation Kit's Music Type / Music Track pages (search snippets only, since
  ck.uesp.net returned 403) describe pools that "only play one Music Track from the
  list", silent tracks "useful in creating periods of silence in between", and per-type
  ducking with fade durations. Alba's audio case study (cassinisound.com) says: "keen to
  have plenty of space to let the environmental ambiences 'breath'".
- **Applied.** Each cue gets 2–5 melodic fragments of 3–7 notes, never in two
  consecutive chords, each ending open (on the 2nd or 5th). Gaps of 75–210 s between
  cues are kept (×1.3 at night), as is the fog rule. Storm and fog cues have no melody
  at all.

### 5. Modal colour, plus mediant and key drift late in a cue

- **Evidence.** The pitch-class profiles favour the natural 7th and avoid a leading tone.
  Wings of Kynareth uses C natural over D: `Dm7, Cadd9, Csus2`. Dawn mixes B and B♭ over
  G. Frostfall moves from an E-minor area to D, then `F → F#m → F#maj7 → C#` in its last
  minute, which is a mediant drift. A forum discussion (Delcamp, unverified) notes
  Soule's avoidance of the leading tone.
- **Applied.** Modes are chosen by mood. Dawn is **Lydian** (♯4 brightness, II major
  chord). Day is **Dorian** (IV major) or **Mixolydian** (♭VII). Dusk is **Aeolian**
  (♭VI, ♭VII). Night is Aeolian or Dorian, kept sparse. Rain uses Dorian or Aeolian in a
  lower register. Storm uses Aeolian with ♭2 tension over a pedal. Each mode boosts its
  characteristic chord. No V–I with a leading tone appears anywhere: cadences are
  ♭VII–I, IV–I or sus4–I. A new cue relates to the last one by a common tonic, a 4th or
  5th, or a relative mode, so the key changes over the day are gentle.

### 6. Cozy references: layers by place, weather removes rather than adds, and a recurring motif

- **A Short Hike** (Adam Robinson-Yu, nintendoeverything interview): "created unique
  layers for each piece that fade in and out depending on where you are." Mark Sparling
  (uppercutcrit.com): "little pockets of respirable layers".
- **Animal Crossing NH.** In the rain, "a vertical layer system removes percussion from
  the background music" (gamemusic.net). Totaka paraphrased: the music is meant to enhance
  the sound of rain, not depict it. Hourly pieces change their tonal centre and density,
  measured here as ACNH 5 PM at 7.4 s chords and 1.37 onsets/s.
- **Winifred Phillips** (GDC Q&A, 2021): "the action and ambient music share some common
  stylistic elements, such as motifs".
- **Eno** ("Generative Music", 1996): loops of "23 1/2 … 25 7/8 … 29 15/16 seconds" that
  "are not likely to come back into sync again".
- **Wind Waker sea** and **Stardew** are metrical tunes (3.3–3.6 s changes, 0.2 dB
  dynamics). They are useful as a contrast for the town layer only. **Dredge** (David
  Mason) "The Marrows (night)" is close to a single-chord ambience (0.24 onsets/s), which
  supports making the storm cue a drone, not a piece.
- **Applied.**
  - Each cue carries **all its layers**: bed (strings + low strings), choir, melody,
    harp, folk (town) and wood (village). Gains follow the live place/weather/time mix
    and crossfade over about 5 s, so sailing into Cedar Landing blooms the folk layer in
    without restarting the music.
  - Rain lowers the choir and melody and darkens the section filters, but does not start
    a new piece.
  - Storm swaps to a drone cue with timpani swells.
  - The village layer's soft log taps loop on lengths of 7, 11 and 13 eighths, so they
    never re-align, after Eno.
  - The **Cedar Landing motif** (original, see below) appears in the title, on arrival
    in town, on a first or rare catch, at Keeper's Cove and in some open-water cues.

## Hit list

| # | change | expected benefit | cost / trade-off | review |
|---|---|---|---|---|
| 1 | Voice-led chord field (≤ 2 voices move, held notes not re-struck, tonic pedal) | the "evolving" feel; no repetition fatigue | new module; compose cost ~ms | chord chart log + renders |
| 2 | Pad sections: detuned strings, choir "ah" (shared formant bank), low strings, shared chorus + long tail | warm, wide, cheap (shared filters) | oscillator voices (CPU) | CPU render ratio, voice peak |
| 3 | Mood → mode/register/rhythm map; key relation between cues | time of day audible as colour | — | renders per state |
| 4 | Fragments + motif guises | memorable without nagging | motif must be original | listen; note count |
| 5 | Layers by place (folk town, wood village), weather subtracts | A Short Hike blooming | events for silent layers skipped | crossfade render |
| 6 | Storm drone cue + timpani swells | unease without action music | — | storm render |
| 7 | Title swell timed to the sepia bloom (2.2 s) | the colour arrives with the chord | first gesture timing | title render |
| 8 | Duck under dialogue / catch stings; Settings > Music unchanged | clarity | — | live check |

Rejected: a convolution hall per section (a phone pays for every convolver). A shared
feedback-delay "bloom" plus the existing 2.4 s convolver send is used instead.
Also rejected: per-note filters on pads. One filter per section is enough, and the
filter is linear, so the result is the same.

## The Cedar Landing motif (original)

In scale steps from the tonic, (beats): `2 (1) · 4 (1) · 8 (2.5) · 7 (0.5) · 5 (1.5) · 4 (3)`.
It rises a third, leaps a fifth to the upper 9th, then falls back by step and third to
the 5th, ending open. It is written for this game and is not derived from any reference
melody. Guises:

| guise | where | treatment |
|---|---|---|
| title | sepia → colour bloom | solo violin over the resolved chord, harp echo of the last 3 notes |
| landing | first cue after arriving in Cedar Landing | first 4 notes on fiddle, 3/4, the accordion holds the chord |
| firstfish | rare / first catch (resolve big) | celesta, notes 1–3 rising into the tonic, fast |
| cove / gran | Keeper's Cove cues, `gameAudio.motif('gran')` | harp, augmented ×1.5, Lydian or Dorian colour |
| sea | ~25 % of open-water cues | flute or violin, inside a fragment slot |

## Results

See the end of this file (filled in after the build).
