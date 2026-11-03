# Sepia title study: "drawn on paper, then it comes to life"

**Brief (Kellan):** "For the title screen is there a way to make a beautiful sepia filter so it looks like the boat is drawn on paper and then it comes to life as the level starts?"

**Fixed requirements:**
- Title only.
- Phone-first.
- Keep the lockup, ribbon, version stamp, quick path (tap during loading skips the title) and the 1.8 s camera swing.
- When play starts, the frame must be exactly the normal game look, with no ongoing cost.
- Reduced motion gets a plain crossfade.

**Success criteria for this brief:**
1. The boat reads as the drawn hero at phone size.
2. The drawing looks like pen and wash on the Logbook paper, not a colour filter.
3. Colour visibly *arrives*, the boat first, then the world.
4. The game look afterwards is pixel-identical, with the pass gone.

## Baseline (v0.8.6)

`screenshots/title_before_phone_title.png`: the live harbour in full colour shows through the mount under the lockup. The drawn loading card (flat colour print) dissolves straight into the colour 3D view.

## Sources inspected

**Motion.** I watched these as downloaded clips (360p, YouTube) and studied them as contact sheets: an overview at about 48 frames per clip, plus 4–6 fps sheets around each transition. The sheets are in `docs/refs/sepia/sheets/` (gitignored). I did not watch at normal speed in a player. Timing claims come from frame timestamps.

| Ref | Why | Frames |
|---|---|---|
| The Wizard of Oz (1939), the door scene | The canonical sepia-to-colour moment | `oz_door.jpg` 50–56 s |
| Pleasantville (1998), "Changing Colors" | Colour arriving locally in a monochrome world | `pville_overview.jpg` |
| Ōkami HD: Celestial Brush and restorations | The live 3D world as a sepia ink-on-paper drawing, then a bloom | `okami_brush_exit.jpg`, `okami_wave.jpg`, `okami_sakura_overview.jpg` |
| GRIS launch trailer | Watercolour washes arriving | `gris_bleed.jpg` |
| The Tale of the Princess Kaguya trailer | Wash on paper, unfinished edges | `kaguya_still.jpg` |
| Wind Waker HD, intro legend | Sepia tapestry storytelling | `windwaker_still.jpg` |
| a-ha "Take On Me" | Pencil drawing to live action | `takeonme_overview.jpg`, `takeonme_trans.jpg` |
| Obra Dinn, Season, Cuphead, Sable, Tearaway trailers | Overview sheets only | — |

**Period stills (Wikimedia Commons, in `docs/refs/sepia/period/`):**
- C. W. Eckersberg, *The Harbour of Copenhagen*, pen and grey-brown wash, 1809 (MET).
- Winslow Homer, *The Life Boat*, study for "Wreck of the Iron Crown", 1881 (Cooper Hewitt).
- Harper's Weekly wood engraving, *The collision off Folkestone*, 1878.
- Asahel Curtis, *Gillnetters … Swinomish Channel, La Conner* and *Fishing boat LARK* (UW, Puget Sound).
- Anna Atkins, algae cyanotype.

**Practitioner claims located:**
- **Wizard of Oz.** The door transition was done in camera. The farmhouse interior was painted sepia, and a stand-in (Bobbie Koshay) in a sepia-dyed dress opened the door before Garland, in blue, took over ([Creative Bloq](https://creativebloq.com/news/wizard-of-oz-transition), [Far Out](https://faroutmagazine.co.uk/story-behind-the-wizard-of-oz-technicolor-dream/)).
- **Pleasantville.** It was shot on colour negative, with about 1,700 effects shots. The film desaturates selected objects rather than adding colour. Mixed shots are about 70% black and white ([ASC](https://theasc.com/articles/pleasantville-black-and-white-in-color)).
- **Ōkami.** Kamiya (Iwata Asks) chose the ink-wash look after a staff drawing of Amaterasu "in a Japanese ink-wash style with a brush-like effect". The sepia brush-mode freeze is described by reviewers, not by the developers.
- **Obra Dinn.** Lucas Pope fought screen-space dither patterns flickering ("swimming") as the camera moved. He ended up pinning the pattern to a sphere around the camera ([PlayStation Blog](https://blog.playstation.com/archive/2019/10/17/lucas-pope-on-return-of-the-obra-dinns-art-style)).

I found no developer commentary on GRIS's, Kaguya's or Wind Waker's transitions. The findings for those are my reading of the frames.

## Findings: claim / evidence / interpretation / application

1. **The live world itself becomes the drawing.**
   - *Evidence:* Ōkami's brush mode (`okami_brush_exit.jpg`, 0.0–2.3 s) keeps the same 3D view but renders it as a flat khaki wash with 2–3 tones on paper, with the ink contours kept. The scroll frame sits around it like our mount.
   - *Interpretation:* the illusion holds because the composition doesn't change; only the medium does.
   - *Application:* a post-process on the live title camera, not a separate illustrated plate.

2. **Period drawings put their values in the foreground. Sky and distance are paper.**
   - *Evidence:* Eckersberg uses about 3–4 flat grey-brown wash steps. The sky is nearly bare paper with one cloud wash, the far ships are a single light tone, and the darkest tones are in the foreground figures and trees. The Curtis photographs blow the sky and far water out to paper white.
   - *Application:*
     - luminance is posterised to 4 soft steps;
     - the sky (depth = far) is paper;
     - an aerial fade pulls the wash toward paper from 70 m to 650 m;
     - ink lines taper and fade by 260 m, so the near boat carries the drawing.

3. **The sea is drawn in strokes, not filled.**
   - *Evidence:* the Harper's engraving sets the water in broken horizontal lines whose density follows the value. Homer draws waves as curved strokes and puts white heightening on the crests.
   - *Application:*
     - level surfaces (from depth-reconstructed normals) get broken, wavering horizontal lines, denser in darker tones;
     - upright surfaces get a 45° hatch in the darks only;
     - the game's white crest sprites already read as heightening.

4. **Pattern swim (Pope).**
   - *Claim:* screen-space patterns crawl when the camera moves.
   - *Application:* the paper grain *should* be screen-anchored, because paper doesn't move. The strokes are screen-space too, which is acceptable because the title camera drifts very slowly. During the fast 1.8 s swing, the strokes are dissolving as the colour arrives, so the swim is masked rather than solved.
   - *Weak spot:* a long title wait shows a slight "shower-door" effect on the water lines.

5. **The wash stops short of the edge.**
   - *Evidence:* the Kaguya frame at 46.5 s: washes fade out raggedly to bare paper before the frame edge, and lines are broken.
   - *Application:* the wash dissolves to paper within about 4–26 px of the plate (mount hole) rect, with a noise-ragged edge. Overshooting strokes are left visible, as a sketchbook would have them. The plate rect is measured from the DOM. Edge darkening was considered and rejected: these references lighten toward the edge, and a dark vignette fights the Logbook paper margin.

6. **Colour arrives at the hero first, then the world.**
   - *Evidence:*
     - Pleasantville colours one person in a grey street (`pville_overview.jpg`, 20–58 s);
     - in Ōkami's sakura restoration (`okami_brush_exit.jpg`, 2.5–3.2 s) the tree blooms pink first and the field greens about 0.3 s later;
     - Ōkami's field restoration (`okami_wave.jpg`) sweeps a lobed front across the frame in about 1.5 s;
     - Wind Waker's tapestry keeps one colour (Link's green) on sepia.
   - *Application:* the colour front grows from the boat in *view-space* distance, on a log scale. The boat (0–5 m) colours in the first ~0.4 s, the near sea and dock by about 1 s, the islands and sky last. Like dye in water, it spreads across the world, not as a flat screen wipe.

7. **The transition rides a camera move through an opening.**
   - *Evidence:* Oz, 51.5–55.5 s: the colour first appears as a sliver in the door, and the camera pushes through as the frame fills over about 1.5 s.
   - *Application:* the bloom (2.2 s) is locked to the existing 1.8 s swing, and both start on the same tap. The paper mount lifts in the first 0.7 s, which is our "door".

8. **Watercolour arriving has a wet edge.**
   - *Evidence:* GRIS 0–4.7 s (`gris_bleed.jpg`): the washes have soft, irregular lobed boundaries, granulation, and slightly deeper colour where the pigment pools.
   - *Application:*
     - the front's edge is perturbed by coarse lobes (~48 px) plus fine fibre noise from a paper texture;
     - the colour is 16% darker in a rim just inside the front;
     - ink and paper tooth lift off locally as colour arrives, and globally over the last 45%.

9. **Tint choice.** Sepia, not cyanotype. The Atkins cyanotype is beautiful, but it reads as cold or night and would merge with the sea's teal. The brief asked for sepia, and brown sits with the Logbook ink (#2B2622) and paper (#F4EFE3). The paper colour in the shader *is* `--paper`, so the drawing sits on the same sheet as the margin.

10. **Continuity of the loading card.** The colour print would otherwise dissolve straight into a sepia drawing (colour, then sepia, then colour). As the print lifts, a CSS filter turns it to a light sepia under-drawing first (500 ms), then it dissolves (1.1 s). The sequence becomes print, then under-drawing, then live drawing, then colour.

**Not taken:**
- Obra Dinn's 1-bit dither: wrong mood, and it swims.
- Take On Me's mostly-white pencil look: too sparse to carry the sea at phone size.
- Cuphead's page-turn: it confirms the plate-in-margin layout we already have.

## What was built

**`src/render/sepia.ts` (`SepiaTitle`).**
- Renders the scene into a target with a depth texture: 4× MSAA on High, none on Low.
- Then runs one fullscreen pass:
  - wash ramp;
  - aerial fade;
  - depth silhouettes and creases, using the old outline pass's maths without material ink classes;
  - pen pressure;
  - strokes and hatch;
  - paper grain;
  - ragged plate edge;
  - colour bloom.
- Paper noise is a 256² tileable RGBA value-noise texture built once on the CPU. It replaced about 25 per-pixel hash-noise calls, which took desktop from 41 to 25 ms and fixed blocky hash-precision artefacts at the plate edge.
- `off()` disposes the render target and the paper texture. From then on, `main.ts` calls the plain `renderer.render` path.

**`main.ts`:**
- `beginTitle()` turns the drawing on and measures the plate.
- `loadingDone()` now resolves true or false (shown or skipped). On true, the bloom starts with the camera swing. On false (quick path), the pass goes off at once and no bloom is seen.
- The HUD waits (`body.title-bloom`) until the bloom is 55% done, then fades in, so hints don't sit on the drawing.
- Debug hooks: `__debug.sepia()` and `__debug.benchSepia(n)`.

**Reduced motion:** a 0.8 s global crossfade.

**`scripts/sepia_capture.mjs`:** title still, bloom frames on a fixed 1/60 s clock, GIF, and benches (`--gif --bench --low --reduced`).

## Results

- `screenshots/sepia_final_phone.gif`: title, tap, bloom, play (phone portrait).
- Stills: `sepia_v4_desktop_title.png`, `sepia_v5_landscape_title.png`, `sepia_v5_phone_title.png`, `sepia_v5_phone_low_title.png`.
- Before: `title_before_phone_title.png`.
- Card hand-off: `handoff_strip.png`.
- Reduced motion: `sepia_rm_phone.gif`.

**Perf.** ms per frame, GPU-synced (`benchSepia(60)`). Chromium with ANGLE/D3D11 on this desktop GPU, with other agents' browsers running, so the numbers are noisy.

| view | plain | title drawing |
|---|---|---|
| phone 390×844 @2×, High | 4.2–5.7 | 8.0–13.3 (+4–7.5) |
| phone, Low (1.5×, no MSAA, 2 edge axes) | 2.9–7.1 | 2.7–5.7 (within noise of plain) |
| landscape 844×390 @2×, High | 3.0–5.3 | 8.4–11.0 |
| desktop 1440×900 @2× | 9.6 | 25.2 |

After hand-off, `__debug.sepia()` reports `state: off`, and the render target and paper texture are disposed. The frame takes the single `renderer.render` path, so the cost is zero. The play-view benches match the pre-change numbers within noise.

**Tests:**
- smoke: phone and desktop, 0 console errors.
- ui_checks: ran.
- title_frames card mode: 3 errors, all the intentional aborted-bundle `ERR_FAILED`.
- title_frames `--title` on phone, landscape and desktop: 0 errors.

## Weak spots

- Measured on a desktop GPU only. On a real phone, the High title pass will cost several ms more (MSAA resolve plus 11 depth taps per pixel). Low is the safety valve.
- The water strokes are screen-space, so they shower-door slightly while the title camera drifts.
- Small FX objects (hotspot glyph rings, a flotsam rock) are drawn in ink like everything else, and read as odd marks in the sky band on phone.
- The area card ("Keeper's Cove") letterbox comes in mid-bloom, so the two moments overlap. Its timing was not changed.
- The CSS sepia filter on the card print is applied during its dissolve on phone. It is a one-off 500 ms filter transition on a large SVG.
