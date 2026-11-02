# Fish models study (branch `fishmodels`)

## Brief
The user's feedback: "the fish icons in the log book look amazing, but the 3d models of the fish when you
pull them up do not look very good at all. They should better resemble what they look like in the log
book and change scale with size."

What must not change: the Logbook plates themselves (the user approved them), the unlit, flat-shaded
low-poly look, phone performance (two draw calls, low tris), and the catch flow (bubble → slip/card).

Success criteria for this brief:
1. **Same fish:** from the hold-up camera, every species reads as its plate: silhouette, fin layout,
   palette, diagnostic markings and eye.
2. **Real scale:** a 12 cm perch is clearly smaller than a 1 m lingcod or a 1.5 m halibut, next to a
   1.75 m skipper, and the hold-up camera still frames both.
3. **Alive:** wag and flop in the hand, a leap pose, flatfish flap, crab claws wave, eels curl.

## Baseline
`src/game/fishmodel.ts` (main @ 25512ea): one 8-sided lathe spindle tinted by `Species.color` (back
colour, cream belly), a triangle dorsal fin, a triangle pectoral fin, octahedron eyes and a two-triangle
tail. The same shape was used for every species. It was drawn at `max(0.3 m, length) × 1.15` and held
0.45 m above the wrists. The baseline capture `screenshots/fish_base_phone_58_landed.png` shows a grey
blob floating well above the skipper's raised fists.

## Exemplars and what transfers
- **The plates themselves** (`public/fish/*.svg`, generator in `art/fish/_tools`) are the target, not
  an inspiration. They are generated from parametric data: body half-height profiles
  `prof(D, p, pd, …)`, `edge_fin` heights, `tail(kind, …)`, `paddle(x, y, L, W, angle)`, and clipped
  markings. *Interpretation:* the most faithful 3D model reuses those numbers rather than re-modelling
  each fish by eye.
- **The plate style rules** (art README: "markings over modelling", flat fills, a 3 px ink outline, one
  readable side-on fish) say that a model which shows the plate's own colour fields from the side wins
  over a modelled, shaded body.
- **The in-game precedent** is the float in `tackle.ts`, which already uses an inverted-hull ink
  outline. The fish body uses the same trick, so the ink line of the plates carries into 3D at one draw
  call.
- **Limits:** no external games were inspected for this pass. The billboard/alpha-card fins and the
  planar-projected side texture are standard real-time techniques chosen from first principles. The
  evidence for them is the contact sheets below, not a reference.

## Hypotheses → experiments → results
| # | Hypothesis | Experiment | Result |
|---|---|---|---|
| H1 | If the side profile, fins and texture all come from the plate generator, the side view is pixel-faithful | `scripts/build_fish_models.py` instruments `fishlib.Fish`, samples the body profiles into columns, rasterises the median layer for the fin-card extents, and moves the paddle fins and crab claws to a second atlas row | **Kept.** In sheet v2, side views match the plates for all 37 (`fishmodels_v2_sheet_*.png`). |
| H2 | Elliptical cross-sections with a per-body-plan width ratio give believable volume without hand modelling | 12 plans (fusiform, slim, rockfish, perch, sculpin, lingcod, shark, ratfish, eel, pipe, flat, crab), with the ratio at the head, mid-body and tail | **Kept.** 3/4 views read as deep and thin for perches, as broad-headed for sculpins, and as round for sharks. |
| H3 | One alpha-tested card at z = 0 can carry every median fin, so no fin geometry is needed | A strip of about 30 stations along x with the plate's alpha (alphaTest 0.5) | **Kept.** The spiny dorsals, the sand sole's free rays, the ratfish whip tail and the crab legs are exact. |
| H4 | The paired fins must leave the body texture, or they read twice | The paddles move to atlas row 1 and become hinged cards splayed 34° (pectoral) or 16° (pelvic) | **Kept.** From 3/4 the fins stand off the flank, and from the side they sit where the plate draws them. |
| H5 | A body outline needs the inverted hull: the plate's own stroke is too thin at game size | v1 had the hull winding reversed, so the body rendered solid ink (`fishmodels_v1_sheet_1.png`). The winding was fixed in v2 | **Kept** after the fix: one extra draw call for an ink line that matches the plates. |
| H6 | The real length makes size legible | `shownLength(m) = m × (1 + 0.5·clamp((0.35 − m)/0.25, 0, 1))`; hold-up shots of 12 cm, 45 cm, 150 cm and 320 cm catches | **Kept.** In `fishmodels_h7_hold_*_strip.png` the perch is a palm-sized sliver and the halibut and sixgill dwarf the skipper. |
| H7 | Two fists held 0.64 m apart cannot cradle a 45 cm fish | The skipper's `gripSpread` swings the upper arms in about local Y (measured 0.3 rad ≈ 0.156 m per hand) | **Kept.** In h7 the fish sits in the fists instead of floating between them. |
| H8 | Small fish read better in one hand by the face (the `hold_show` pose) than overhead | Three placements were tried: (a) beside the head, which floated clear of the hand; (b) the cheek offset, which hid the fish in the head; (c) gripped behind the gills with the nose to the face ("kiss the fish"), 0.1 m in front of the face | **(c) kept.** Flatfish and the crab are held out from the face, eyed side to the camera. |
| H9 | The catch bubble over the boat hides the held fish | The bubble is anchored 0.12 m over the held fish (`catchHooks.bubbleAt`) | **Kept.** The portrait framing leaves room above the fish. |

## Scale rules (as built)
- The drawn length is the rolled `CaughtFish.size` (cm/100). Below 35 cm a boost of up to ×1.5 applies
  (12 cm → 17.5 cm, 20 cm → 26 cm, 35 cm and up → true size). The model unit is snout to tail tip. For
  the crab it is the carapace width, so the legs extend beyond it.
- **The hold mode:** a drawn length under 0.42 m uses one hand (`hold_show`, right wrist grip). Longer
  fish use two fists (`hold_hoist`). The belly rests at wrist + 0.09 m + 0.9 × body depth at the hold
  point. The fins hang in front of the fists. The fists close to `max(0.3, 0.5·L + 0.08)` m apart.
- **The hold-up camera** (`ChaseCamera.landing`): the distance is `max(base, fit)`.
  - The base is `landNear (2.3) + 1.6·L` for one-hand holds and `landDist (5.6) × (0.62 + 0.25·L)` for
    two-hand holds. Portrait multiplies it by 1.15, landscape by 0.75.
  - `fit` keeps `1.05·L + 0.35 m` inside 80 % of the horizontal FOV, which makes the 3.2 m sixgill fit
    on a 390 px wide phone.
  - The eye sits at head + 0.3 m (one hand, under the sou'wester brim) or head + 0.45 + 0.1·d.
- **The leap and roll** use the same drawn length. `fish.leap = sin(πk)` during a breach (C-arch, faster
  tail) and 0.25 during a roll. Flatfish and the crab lie flat on the water (`present = 0`) and turn
  their eyed side 82 % toward the camera in the hand.

## Animation
A CPU spine bend over about 1.3–2k vertices. Per frame, an angle φ(X) is integrated outward from the
hold point (which stays fixed):
- **swim:** a tail wave whose ramp starts 30 % back from the nose;
- **flop:** a curl spring kicked by `flop()`, which snaps over, plus a U-arch that lifts the head and
  tail off the hands;
- **flap** (flatfish): the whole-body wave, which is vertical when the fish lies flat;
- **eel:** 1.1 waves along the body plus a strong curl;
- **crab:** no bend; the claws lift on a hinge about the shell axis and wave.

The paired fins flap on their hinges.

## Perf
- **Triangles:** 1,310–1,316 per fish (eel and pipe plans 2,008–2,012, crab 1,024), body and ink hull
  together.
- **Draw calls:** 2, the same as the baseline (the `drawBreakdown` "fishing" total stays at 3 with the
  line).
- **Download:** 37 files lazy-loaded per species, 5.1–9.6 KB raw, about 2.7 KB gzipped on average
  (98 KB gzipped for all of them). No PNGs: the atlas SVG is rasterised to a 1024×1040 canvas at load
  (about 5.5 MB of GPU memory with mips). At most 4 species are cached, and evicted atlases are
  disposed.

## Files
- `scripts/build_fish_models.py` builds the data. Run it with
  `python -I scripts/build_fish_models.py [--tools ../art/fish/_tools] [slug…]`. It needs Python
  Playwright + Chromium.
- `public/fish/models/<slug>.json` and `index.json` are the generated model data.
- `src/game/fishmodel.ts` builds and animates the model; `src/game/fishstudio.ts` does the debug studio
  renders.
- `src/game/fishing.ts` has the `HOLD` constants, `holdMode`, `placeHeld` and `fishTop`. Debug hooks:
  `nextCatch(id, cm)` and `landNow()`.
- `src/game/skipper.ts` has `hand()` and `gripSpread`. `src/game/camera.ts` has the size-aware hold-up
  shot. `src/main.ts` holds the wiring.
- `scripts/fish_models_capture.mjs [base] [tag] sheet|hold|leap|all [phone|desktop]` writes the
  contact sheets and the hold-up strips.

## Evidence (screenshots/, not committed)
- `fishmodels_v3_sheet_1..5.png`: plate | 3D side (same scale) | 3D 3/4 at rest | flop in hand |
  leap pose, for all 37 plates.
- `fishmodels_h7_hold_phone_strip.png` and `fishmodels_h7_hold_desktop_strip.png`: the perch (12 cm),
  copper rockfish (45), halibut (150), crab (18), lingcod (100), wolf eel (170) and sixgill (320). Each
  has a clean frame and a `_ui` frame.

## Open issues
- **Leaps in the fight are small on screen.** At the far fight camera, a 60 cm coho at about 10 m is
  roughly 20 px and is often lost in the splash foam (`fishmodels_L1_leap_*`). That is true to scale; a
  closer leap camera would be a separate change.
- **The one-hand hold is a compromise.** `hold_show` raises the hand to the cheek, so small fish are
  shown nose to face. A dedicated "hold out" pose would read better.
- **Flatfish and the crab are tilted 82 % toward the camera when held,** not lying flat. Lying flat
  would be edge-on to the hold-up camera, so they only lie flat in the water (rolls).
- **The crab model's unit is the carapace width,** so its leg span reads about 1.4× its size. That
  matches the real animal.
- **The 3D eye is painted, not modelled.** From steep angles it foreshortens like the rest of the flank.
