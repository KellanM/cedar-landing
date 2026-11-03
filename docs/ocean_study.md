# Ocean study: a rolling, weather-driven swell (the "Sea of Thieves" request)

Branch `ocean` (from v0.9.3). Brief from Kellan: "For the weather / tide system I would like us to
experiment with waves / an ocean sim similar to Sea of Thieves." This pass covers layer 1 (real swell
plus buoyancy: the boat, floaters and bobber read the true wave height on the CPU, and the wave
height follows the weather). Tides (layer 2) are already in `src/game/tide.ts`. It ships as an
**experiment behind a toggle**: Log > Developer > "Ocean: Classic / Swell". The default is Classic
until Kellan approves.

Non-negotiables carried over: phone-first, unlit, flat-shaded low-poly, the "muted Wind Waker"
palette from `docs/water_study.md`, crest sprites and shore foam unchanged. It must be cozy, not
seasick, and stay within about +1 ms on the phone profile.

## Success criteria (for this brief)

1. **Reads as swell, not ripple.** From the chase camera you can see sets of waves roll past the
   boat, and the boat visibly rides them: it heaves, pitches over the long waves and rolls in the chop.
2. **Weather tells.** On a calm day it is small chop. Rain brings a moderate sea. A storm brings a
   big swell with whitecaps. You can tell the three apart in a still frame.
3. **Sheltered water is calmer.** The harbour and the water close in to shore stay nearly flat.
4. **One truth.** The boat, floaters, bobber, hotspot marks, crest sprites, rain marks and wake all sit
   on the same surface the player sees (a single `waterHeight(x, z)`).
5. **Still our look.** Faceted, unlit, muted. Whitecaps are drawn in our crest style, not as
   photoreal foam.
6. **Comfort and budget.** The camera does not roll, and its heave is damped. Reduced motion calms
   the sea. The phone cost is no more than about +1 ms, and there are no console errors.

## Exemplars and sources (what was inspected, how)

| Source | Access | Why it is here |
|---|---|---|
| Ang, Catling, Cifariello Ciardi, Kozin (Rare), "The Technical Art of Sea of Thieves", SIGGRAPH 2018 Talks, 2 pp. ([PDF](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf)) | **Read in full** | The primary source on the reference Kellan named |
| The same talk, recorded (YouTube `y9BOz2dFZzs`, uploaded 2023 by a third party, 41 min) | **Auto-captions read**, timestamps below; slides not seen | The practitioner's own reasoning, which goes beyond the paper |
| Rare, "Sea of Thieves Inn-side Story #3: Engineering Great Water" (YouTube `9nxlmCq4220`, 2:55) | **Watched**: frames sampled at ~0.6 s through 4 windows, plus captions | Rare's claims about determinism and calm bays vs open ocean |
| *Sea of Thieves* storm sailing, first person (`MJICjfAd6z8` @ 1:02–1:07, 3:22, 6:42) and a relaxing longplay (`hf3r9TNSsyY` @ 30:02, 1:40:02) | **Watched**: ~6 s windows at normal speed, ~10 frames each | How a storm sea and a ship riding it actually look |
| *Wind Waker HD* calm sailing (`dERxAAP4Ybo` @ 0:12–0:17) and the "Endless Storm" sail (`Jlb-eazeXd0` @ 11:41–11:46) | **Watched**: same method | Our style parent: how a cel-shaded game does storm vs calm |
| noclip.website `d_a_sea.ts` (WW's sea actor) | Read in the earlier water study (`docs/water_study.md`) | WW's sea is a sum of 4 cosine waves on a re-centred 64×64 grid, flattened near calm rooms |
| *Sailwind* storm approach (`j1LOk39auTk` @ 1:41–1:46, 6:41) | **Watched** | A stylised indie sailing sim with a dense wind-sea |
| Low-poly wave demos: "Gerstner Waves Flat Shaded" (`cDtq1gUQqds`) and "Unity Low poly waves shader 2" (`O-94KWkexms`) | **Watched** | What flat-shaded displaced water looks like, including its failure modes |
| Real Salish Sea: Juan de Fuca rough-weather sailing (`hsVYqKXcG0U` @ 1:02–1:07, 3:22–3:27), first Juan de Fuca swell (`Hj2xa70l4Gk` @ 5:02), "Sailing in whitecaps with a strong breeze" (`JwB9NPb2ve0`) | **Watched** | The sea we are actually depicting |
| Yang, García-Medina et al. 2019, "Modeling analysis of the swell and wind-sea climate in the Salish Sea", *Estuarine, Coastal and Shelf Science* 224 ([abstract](https://tethys-engineering.pnnl.gov/publications/modeling-analysis-swell-wind-sea-climate-salish-sea)) | Abstract read; Puget Sound numbers come from a search snippet of the related SSEC abstract | Wave climate by basin |
| *Windward*, *Sneaky Sasquatch*, *A Short Hike*, *Atlas*, *Raft*, *Tiny Glade* | **Not inspected.** *Windward* frames were top-down HUD play with water too small to read. Both *Sneaky Sasquatch* attempts landed on pre-roll ads. The rest were not attempted. | No conclusions drawn from them |

Footage was viewed in a real browser at normal playback speed (Playwright), with frames grabbed
every ~0.6 s. Direct clip download was blocked (YouTube 403). Frames live outside the repo
(`C:\tmp\ocean_study\frames`); the IDs and timestamps above reproduce them.

## Findings: claim / evidence / interpretation / application

### 1. Rare kept a physically behaving sea underneath and stylised only the foam and colour

- **Claim.** "the highly realistic water that we get out of the Tessendorf FFT method is very noisy
  ... doesn't really sit that well with our art style ... we mostly stylise the foam and we also
  boosted the strength of the subsurface scattering" (talk ~05:20–05:48). They "did try to simplify
  the shape of the water ... take away some of that high-frequency detail but ... the water looked
  less good" (~06:14). Inn-side Story #3 (~1:52–2:05): artists "work on top of something that behaves
  correctly ... it's easy for them to get something that looks stylised but still behaves like
  water". Closing line of the talk: "stylised art essentially has a physical basis".
- **Evidence.** In the storm windows (`MJICjfAd6z8` 1:02–1:07, `hf3r9TNSsyY` 1:40:02) the sea is
  dense, many-scaled detail. Sharp peaks carry white foam ribbons, and the wave faces are a lighter
  teal than the troughs.
- **Interpretation.** What sells SoT is *behaviour*: dispersion (long waves travel faster), many
  directions, a shared deterministic surface, crest-driven foam, and more amplitude in storms. The
  photoreal detail belongs to SoT's look, not ours. The low-poly demos show the other side: lit
  random facets glitter into white triangles and noise toward the horizon (`O-94KWkexms` 0:07–0:12).
- **Application.** Make the wave *motion* physical: deep-water dispersion ω² = gk, a few directional
  components around the wind, and one deterministic function on the CPU and GPU. Keep the
  *rendering* ours: unlit facets with only a few % value change, detail fading with distance, and
  whitecaps drawn in our crest colours. Do not attempt FFT. It costs ~8 ms on Xbox One when the
  screen is all water (talk ~08:32), and it is noisy for a phone.

### 2. Foam comes from wave geometry (the Jacobian), not a texture, and storms bias it

- **Claim.** "take the Jacobian determinant of the transform and generate foam where it goes
  negative ... then we bias the Jacobian to get more foam" (~06:41–07:09). For storms, "we just
  increase the amplitude of the waves and we bias the Jacobian even further to get more foam" (~08:00).
  The paper adds: "calm water will only show foam generation around intersecting objects."
- **Evidence.** Storm frames show white at the sharpest crests, streaming down the faces (`MJICjfAd6z8`
  1:06). Calm frames (`9nxlmCq4220` 1:44, the calm bay) show foam only at the shore.
- **Interpretation.** The foam marks where the surface is about to break, so it is correlated with
  the swell. That correlation is what makes it read as weather rather than decoration.
- **Application.** Our waves are a height field (see the design below), so the analogue of the
  Jacobian is the **downward acceleration at the crest**. A real wave breaks when that exceeds
  roughly half of g. The shader can compute it exactly from the same sum, so whitecaps appear where
  the crests are steepest. The threshold drops with the storm, which is Rare's bias. Calm days get
  essentially none (crest sprites and shore foam only, as now).

### 3. The wave peak and side get a lighter "subsurface" colour

- **Claim.** "we use the choppiness vertex offsets ... to generate a mask for where the sides of the
  waves are, and then we just use a dot product of the light and view vector" (~06:14–06:41). The
  paper says this was boosted "beyond what would be considered realistic".
- **Evidence.** In the storm frames the backlit wave faces are visibly lighter and greener than the
  troughs (`MJICjfAd6z8` 1:02).
- **Application.** Apply a muted version: facets above mean height, looking toward the sun, step
  toward our TOD shallow tint (≤ 25%). It is gone at night and in fog because the sun cone is.

### 4. Sea state varies by place: calm bays vs open water

- **Claim.** Inn-side Story #3 (~1:49–2:01): "around shorelines you've got water that's much more
  like a pond and then you've got deep ocean where the waves can be several metres high". WW
  flattens its sea near calm rooms (`flatInter`, water study).
- **Evidence.** The calm-bay shot (`9nxlmCq4220` 1:44) is near glassy, with only a shore wash.
- **Application.** A shelter factor from our existing shore field (distance to shore and depth),
  evaluated per vertex on the GPU and per query on the CPU. Short chop dies within ~20 m of shore
  and in shallow water. Long swell wraps in a little further.

### 5. Everyone must agree on the surface

- **Claim.** "everyone needs to see the same big waves ... it's all deterministic so we can recreate
  it from a starting value and a time" (Inn-side #3 ~1:29–1:34).
- **Application.** Single-player here, but the same rule holds between *systems*. `waterHeight(x, z)`
  in `src/game/swell.ts` is the only truth. The sea shader, the overlay shaders (crests, rain marks,
  hotspot marks, wake) and the CPU (boat, floaters, bobber, birds) evaluate the same waves with the
  same phases and the same shelter. The time is wrapped per wave on the CPU, so there is no float
  drift.

### 6. How boats ride, and how the player's view is kept comfortable

- **Evidence.** SoT, first person, storm (`MJICjfAd6z8` 1:02–1:07): the bow climbs a wave face
  taller than the rail and the horizon swings by large angles. Rough Juan de Fuca from a real
  cockpit (`hsVYqKXcG0U` 3:22–3:27): a steady ~10–15° heel, a pitch of a few degrees per wave and a
  short, jerky period. WW (`dERxAAP4Ybo` 0:12–0:17): the boat barely pitches. Motion is expressed by
  bow spray and wake lines, and the third-person camera stays level.
- **Interpretation.** SoT's first-person camera *is* the ship, which suits its stormy fantasy but
  would make a cozy phone game uncomfortable. WW keeps the camera level and lets the boat move.
- **Application.** The boat samples the wave at bow, stern, port and starboard (plus the centre).
  Heave is the mean; pitch and roll come from the differences. Each channel goes through a damped
  spring (ζ 0.7). The Packer (T1) gets lower spring rates and a slightly wider sample span, so it
  averages the chop and reads heavier. The chase camera never rolls. Its target follows only a
  low-passed half of the heave. Reduced motion scales the sea to 35%.

### 7. The real Salish Sea: mostly short chop, sometimes long swell

- **Claim.** Juan de Fuca "has the largest waves and is dominated by swells propagated from the
  Pacific Ocean". Puget Sound waves are "small and primarily dominated by the wind-sea climate"
  (Yang et al. 2019). Per the snippet, Puget Sound peak periods are "generally less than 5 s" and
  the maximum Hs is below 2 m. A skipper on Juan de Fuca: "the south swells can't get in here but the
  westerly swells can" (`Hj2xa70l4Gk` ~5:05).
- **Evidence.** In `hsVYqKXcG0U` 1:05 and 3:22 the water is dark blue-slate with short steep chop
  (wavelengths of a few boat lengths at most) and scattered small whitecaps. In `Hj2xa70l4Gk` 5:02,
  calm grey day, the water is glassy, with a long low swell barely visible as slow brightness bands.
- **Application.** Deep-water dispersion gives λ = gT²/2π. Chop at T ≈ 1.3–2.3 s gives λ ≈ 3–8 m.
  An occasional long swell at T ≈ 3.7–4.7 s gives λ ≈ 21–34 m, kept moderate because it is inland.
  Sea states: calm (Hs ~0.1–0.15 m, the long swell barely there), rain (~0.35 m), storm (~1.2 m,
  whitecaps). Storms are game-rare already (`weather.ts`, ≈ 1 day in 6).

### What we deliberately do not take

- FFT and a spectrum: too costly, and too noisy for the look (finding 1).
- Lit random low-poly facets: they glitter (finding 1). Our facets only modulate value by a few %,
  and short waves fade before they would alias.
- A first-person-style camera that rolls with the ship (finding 6).

## Design (hypotheses to test)

- **Wave model** (`src/game/swell.ts`). There are 6 directional components: 4 wind-sea chop
  (λ 3.1–8.3 m, ±41° around the wind) and 2 swell (λ 21 and 34 m). It is a **height field**, not
  Gerstner, so the CPU height is exact (no inverse solve). Peaked crests come from a sharpened
  sine, `a·exp(s·(sin θ − 1)) + b`, which gives broad troughs and narrow crests (trochoid-like).
  The sharpness `s` rises with the storm. Zero-mean offsets are precomputed. Each wave's phase
  advances at ω = √(gk) on the CPU, wrapped to 2π.
- **Weather coupling.** The sea state target is `0.12 + 0.35·rain + 0.6·storm`, eased over ~15 s.
  Amplitude is set through slope (kA): chop 0.035 (calm) → 0.085 (storm), plus swell A 0.05 → 0.55 m.
- **Shelter.** The shore field (shared with the sea shader) gives chop `ss(2, 24, sd)·ss(0.3, 3, depth)`
  and swell `ss(0.5, 14, sd)·ss(0.2, 2, depth)`.
- **Mesh.** A camera-following near grid, 176² (high) or 128² (low), warped
  `x = 160·(0.3u + 0.7u³)`: ~0.55 m cells at the boat, ~5 m at the edge. It snaps to the centre cell
  size so near vertices stay world-locked. Each wave fades out at a radius proportional to its
  wavelength, so short waves are gone before cells get too coarse to carry them. Everything fades
  flat by 135 m, where the flat far ring takes over.
- **Shading.** The flat normal comes from `dFdx/dFdy`, giving a few % of value per facet toward
  the sun, plus a backlit crest tint (finding 3). Whitecaps sit where crest acceleration > 0.55 g
  (lowered to 0.34 g in storms), drawn as a hard-edged crest-coloured core with a bead-coloured
  apron, broken by noise.
- **Buoyancy** (`Buoyancy` in `swell.ts`): see finding 6.

## Results

See the "Results and evaluation" section below (filled in after the experiment).
