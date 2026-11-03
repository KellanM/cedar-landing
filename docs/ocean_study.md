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
- **Mesh.** A camera-following near grid, 144² (high) or 112² (low; first tried 176²/128², see Results), warped
  `x = 160·(0.3u + 0.7u³)`: ~0.67 m cells at the boat, ~5 m at the edge. It snaps to the centre cell
  size so near vertices stay world-locked. Each wave fades out at a radius proportional to its
  wavelength, so short waves are gone before cells get too coarse to carry them. Everything fades
  flat by 135 m, where the flat far ring takes over.
- **Shading.** The flat normal comes from `dFdx/dFdy`, giving a few % of value per facet toward
  the sun, plus a backlit crest tint (finding 3). Whitecaps sit where crest acceleration > 0.55 g
  (lowered to 0.34 g in storms), drawn as a hard-edged crest-coloured core with a bead-coloured
  apron, broken by noise.
- **Buoyancy** (`Buoyancy` in `swell.ts`): see finding 6.

## Results and evaluation

Captures come from `scripts/ocean_capture.mjs` (Classic vs Swell). The scenes are open water in
clear, rain and storm, each idle and under way, plus fishing in calm and in a storm, at phone
(390×844 @3) and desktop (1280×800) sizes. `scripts/ocean_gif.py` turns them into side-by-side
GIFs at the captured real-time pace. `scripts/ocean_probe.mjs` gives a low side view of the hull.
Output goes to `screenshots/ocean/` (gitignored).

**What changed during the experiment (and why):**
1. *First whitecaps were sheets of white "ice floes"* (threshold 0.28 g, solid fill). The long-swell
   crest pushed the metric over the threshold along its whole length, which drew one continuous
   ribbon. Three fixes: the swell's share of the metric dropped to 35% (it lifts the chop toward
   breaking but does not break by itself), the storm threshold went up to 0.34 g, and the foam is
   now **drawn like our crests**: a white rim stroke round each breaking patch with a bead-tinted
   wash inside. That reads as WW-style drawn foam rather than photoreal coverage.
2. *Facets were invisible* at a 0.9 slope gain, because real slopes are only a few %. The gain went
   to 2.2 (clamped −12% / +9%). Calm water now shows soft, large triangular value shifts that roll
   with the swell. Storms show clear faceting.
3. *The hull perched on the waves* (the bottom paint showed in the side view). The heave springs
   were stiffened (ω 6.5 light / 4.2 Packer), and the hull settles 3–12 cm deeper as the sea builds.
4. *Cost.* The high grid went from 176² to 144² (0.67 m cells at the boat; 112² on low). Waves
   past their fade radius are skipped in the vertex shader.

**Judgement against the criteria (my assessment; not tested with players):**
1. Swell reads: yes in motion. The boat heaves and rolls, the flag swings, and wave sets move
   through. In a single top-down phone still the long swell is subtle. It shows as broad facet
   bands, not as visible humps, because the chase camera looks almost straight down. The side
   view shows it clearly.
2. Weather tells: yes. Calm is soft facets with no whitecaps. Rain adds a stronger, slower
   banding. A storm adds drawn whitecaps everywhere, a visibly rocking boat, and crest sprites born
   on the wave tops.
3. Shelter: the harbour and the water within ~20 m of shore flatten. Surf bands and the shore foam
   are unchanged.
4. One truth: the boat, float, floaters, birds, crest sprites, rain marks, hotspot marks and wake
   all ride `waterHeight` / `swellEval`. The CPU and GPU share the same constants each frame.
5. Look: unlit, faceted and muted. The whitecaps use the crest and bead colours from the TOD.
6. Comfort: the camera never rolls or pitches with the boat. Its target follows half the heave,
   low-passed over 1.4 s. Reduced motion takes the sea to 35%.

**Perf** (`scripts/ocean_perf.mjs`): phone viewport, storm, open water, chase view. Swell and
Classic are interleaved on the same page, with the median of 7×90-frame synchronous benches. This
desktop GPU was shared with other agents, so single numbers swing by ±1 ms. Read these as ranges:
- quality **low**: the Classic sea costs 0.45–0.52 ms. Swell costs 1.23–1.30 ms in a storm and
  0.74–0.82 ms flat, so it adds **+0.3 to +0.8 ms**.
- quality **high**: four paired runs ranged from −1.2 to +1.2 ms against Classic. That is within
  the noise. Expect it to be above low, since it has 145² vs 113² vertices.
- CPU: ~0.12 µs per `waterHeight()` query. The boat uses 5 per frame, and floaters, the float and
  birds a few dozen, so the total is under 0.01 ms.
- The whitecap branch itself is not measurable (Swell with and without foam are within the noise).
- The phone-hardware cost is **not yet measured on a real phone**. The +1 ms budget is met on the
  low profile in this emulation, but high is unverified.

**Weak spots / next steps:**
- The phone chase camera is high and steep, so the long swell's *shape* barely reads in stills.
  Possible fixes: a little more swell amplitude, or more facet gain on the long waves only.
- Wildlife sea creatures and the splash FX still sit on `WATER.y` (they are small and brief).
  Moored boats are `dynamic.glb` floaters and ride the swell; the docks do not (they are fixed
  structures).
- The wave directions follow the eased wind, so a sudden wind change swings the whole sea. A
  fixed westerly for the long swell (the Juan de Fuca entrance) would be more truthful.
- Layer 4 (the interactive ripple sim for wake, splashes and rain) is not built. The plan is a
  camera-centred 128² height-field ripple texture (2 ping-pong render targets, ~0.2 ms, as
  SoT's deck sim), added to the sea's height and normal only within ~25 m of the boat.
- Hotspot marks in **Classic** do not follow the tide (their shader ignores the group's y). That
  is a pre-existing issue, which the `tides2` branch may be fixing. In Swell they sit on tide +
  swell.

---

# Pass 2: from "a morphing sheet" to a spectrum ocean (branch `ocean2`, from v0.10.1)

Kellan, after trying pass 1: *"The sea mesh looks like it is just getting morphed. How do other
ocean sims create their physically based looking ocean renders? I think we need to add noise
textures for the height map. And are they smooth? We need to iterate on the swells more; please
add a slider that allows me to adjust the amount. It should feel dangerous after a certain level."*

**Diagnosis of pass 1.** It had six smooth waves on a coarse grid, and every bit of shading came
from the triangles themselves. The eye read one rubber sheet bending, because nothing in it was
finer than the mesh: there was no small-scale surface texture, no horizontal motion, and no foam
that outlived a crest.

## How the physically based oceans are actually built (sources inspected)

| Source | Access | What it contributes |
|---|---|---|
| J. Tessendorf, *Simulating Ocean Water* (course notes 1999–2004) | **Read**: §4.2 dispersion, §4.3 the FFT patch and its tiling, §4.6 choppy waves and the Jacobian | The foundation everyone cites |
| Mihelich (Grapeshot) & Tcheblokov (NVIDIA), *Wakes, Explosions and Lighting: Interactive Water Simulation in Atlas*, GDC 2019 ([slides](https://gpuopen.com/gdc-presentations/2019/gdc-2019-agtd6-interactive-water-simulation-in-atlas.pdf)) | **Read all 75 slides** (text) | A production recipe: bands, spectrum, buoyancy, shading, foam, spray |
| Acerola, *I Tried Simulating The Entire Ocean* (YouTube `yPfagLeUa7k`, 27 min) and *How Games Fake Water* (`PH9q0HNBjT4`) | **Captions read**; frames watched at 15:30, 23:40, 24:30, 26:15 | A practitioner rebuilding SoT-style FFT water and showing each step and its failure |
| Rare, *The Technical Art of Sea of Thieves* (paper + talk) | Read in pass 1 | Foam, scatter, stylising on top of a correct sim |
| Crest Ocean (Unity) docs ([waves](https://crest.readthedocs.io/en/4.20/user/waves.html), system notes) | Search summaries of the docs (not opened directly) | LOD cascades, per-wavelength shape LODs, shallow-water damping |
| Unreal Engine Water plugin: `UGerstnerWaterWaveGeneratorSpectrum` ([API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/Water/UGerstnerWaterWaveGeneratorSpect-)) | API page (via search) | Gerstner *octaves* (each one doubles the wavelength), generated from known ocean spectra |
| Real dangerous sea: North Sea storm from a ship's bridge (`AvxFzD2rZv4` @ 5:02–5:07, 15:02–15:07) | **Watched** (frames ~0.6 s apart) | What "dangerous" looks like |
| *Assassin's Creed IV* ocean talk; *Ghost of Tsushima* water | **Not found.** Wronski's GDC 2014 talk is on AC4 graphics generally, and no Sucker Punch water talk turned up | No claims made |
| Crest 5.7 trailer (`meMmaogDL4U`) | Watched; the windows hit a waterfall and a lake, not open sea | No claims made |

### Findings (claim / evidence / interpretation / application)

1. **The ocean is a sum of thousands of waves, chosen by a spectrum, not a few hand-picked sines.**
   - *Claim:* Tessendorf builds a height field from a spectrum by inverse FFT. Atlas slide 8 gives
     the loop: "generate spectrum, evolve in frequency domain, inverse FFT, rinse and repeat".
     Acerola (~7:46–9:49) uses JONSWAP after Atlas: "basically better in every conceivable
     fashion". It has wind speed, fetch, peak, spreading, amplitude override and a low-pass.
   - *Evidence:* his scenes at 26:15 range from calm to storm off one parameter set.
   - *Application:* a JONSWAP-shaped spectrum drives everything. The sea state sets the
     significant height Hs and the peak wavelength; energy is spread over ~100 waves.

2. **One tile always tiles; cascades of different sizes hide it.**
   - *Claim:* Tessendorf says the patch "can be tiled seamlessly... an artificial periodicity...
     may be apparent as repeated structures across the field of view". Atlas slide 11 uses "small
     FFTs, split spectrum to 4 frequency bands... recombine in the shaders". Acerola (~23:30–24:24)
     says "you can still see the tiling" until "four simulations of differing scales... with
     different tiling rates".
   - *Evidence:* his frame at 23:40 shows the diagonal repetition clearly.
   - *Application:* three cascades with tiles of 256 m, 53.7 m and 11.3 m. The sizes are
     incommensurate, so the tiles never line up. Each cascade holds only its own wavelength band.

3. **"Noise textures for the height map" is close: per-band height/normal textures.**
   - *Claim:* the FFT outputs are textures, a displacement map plus slopes. Atlas slide 38 shows
     them as RGBA16F arrays: displacement XYZ, slopes, foam, Jacobian.
   - *Interpretation:* the convincing detail is **per-pixel normals from those textures**, not
     more geometry. Static noise would just scroll; a spectrum texture *evolves*, because each
     wave moves at its own dispersion speed.
   - *Application:* each frame, every cascade is rendered into a 64² **displacement** texture
     (dx, h, dz) and a **slope + Jacobian** texture. The sea samples them per vertex (shape) and
     per pixel (normals and foam).
   - On WebGL2 a real FFT would need ~7 butterfly passes per axis per output per cascade, so instead
     each texel sums its cascade's ~36 lattice waves directly: a sparse inverse DFT. The wave
     vectors sit on the tile's lattice, so every texture tiles exactly.

4. **Choppiness is horizontal displacement, and it gives you foam for free.**
   - *Claim:* Tessendorf §4.6 says peaks are "sharply peaked at their tops and flattened at the
     bottoms... (slope > ~1/6) eventually break". Points move by λ·D(x), and the Jacobian of that
     map tells you where the surface folds: "a useful effect to signal the production of spray,
     foam and/or breaking waves". Acerola (~15:14) says that with height alone "it looks kind of
     weird and the movement feels too linear".
   - *Application:* the vertices move in x/z as well as y, with λ 0.55 → 1.0 by sea state. The
     Jacobian per texel drives the foam.

5. **Foam persists: inject where the Jacobian dips, then decay and blur.**
   - *Claim:* Atlas slide 56 says "inject 'turbulent energy'... dissipate over time (blur + fade)".
     Acerola (~22:45) applies "an exponential decay function to the whole texture... foam
     accumulating in busier areas". Rare blurs progressively and blends artist textures.
   - *Application:* a foam ping-pong per displaced cascade (decay 1/e in 1.6 s, a 5-tap blur,
     drifting 0.35 m/s downwind). It is drawn in our crest style: a white rim stroke and a
     bead-coloured wash, broken by noise.

6. **Shading: microfacet normals, Fresnel, crest scatter.**
   - *Claim:* Atlas slides 30–55: sun specular, sky reflection weighted by Fresnel, and a fake
     scatter term driven by wave height H, view-toward-sun and normal-toward-view. Rare's
     subsurface mask comes from the choppiness offsets.
   - *Application, kept unlit and muted:* a few % of value toward the sun; Fresnel (Schlick, n=5)
     to a sky/haze colour from the time of day; Atlas' scatter term, scaled down, to a greener tint
     high on the crests; the star glints reflect off the per-pixel normal.

7. **Distance: fade the bands, or the surface crawls.**
   - *Claim:* Atlas slide 60 fades displacements at distance: "bands start fading away at ~30
     world space periods". Crest gives each wavelength its own LOD.
   - *Application:* cascade 1 displacement fades over 38–75 m, everything is flat by 140 m (where
     the flat far ring takes over), and each band's normals fade with pixel footprint. The far ring
     keeps the long cascade's normals, so the horizon still rolls.

8. **Buoyancy: samples → plane → spring, for "epic wave size without making players sick".**
   - *Claim:* Atlas slides 25–28: physical forces were "noisy... add latency and instability",
     so they fit a plane to the samples and "apply spring to filter noise". Getting the height
     under a choppy surface needs an "iterative approximation".
   - *Application:* this is the pass-1 Buoyancy (five samples and springs), now softer in big seas.
     `waterHeight()` inverts the horizontal displacement by fixed-point steps on the CPU, using the
     same waves as the GPU.

9. **What dangerous looks like (North Sea, from a ship's bridge).**
   - *Evidence:* at 5:02–5:07 and 15:02–15:07 the wave faces rise above the horizon and fill the
     window. The faces are dark slate with **white streaks running down them along the wind**, and
     spindrift flies off the crests. The horizon swings from mid-frame to out of shot in about 3 s
     as the bow climbs.
   - *Application (sea state 7–10):* heights up to Hs 5 m (crest to trough ~6 m+); faces that
     darken toward a green-grey; wind-streak foam lines; spindrift and crest spray; bow slams
     that throw water over the deck.

### "Are they smooth?" (Kellan's question)

**Yes.** Every PB ocean above renders a *smooth* surface: dense, smooth geometry carrying very
detailed per-pixel normals (Tessendorf's renders use 2.5–10 cm facets; Atlas and Acerola use
tessellation or concentric LOD rings). The detail lives in the normals, not the triangles. Our
pass-1 look was faceted, with large triangles doing all the shading, and that is exactly what read
as "morphing".

Pass 2 offers both, on a Dev toggle "Sea look":
- **Smooth** (default): the shape from the cascades plus per-pixel normals from all three bands.
- **Faceted but detailed**: flat triangle normals for the large shape, plus the finest cascade's
  normals on top, so facets still read but each one shimmers like water.

**Recommendation: Smooth.** It is what makes the sea read as water. The game's other water is
already unlit and stylised (crest sprites, drawn foam, surf bands, star glints), so the low-poly
identity survives in the drawn layers. Faceted reads as low-poly at storm heights. It is a valid
alternative if the style needs it, but at calm states it is nearly indistinguishable.

## Build (pass 2)

- `src/game/swell.ts` (rewritten, same API):
  - **Sea state S 0–10.** A table maps S to Hs and peak wavelength: 0 glassy (0.03 m),
    3 normal (0.48 m, λp 14 m), 5 storm (1.05 m), 8 (2.8 m, λp 55 m), 10 (5 m, λp 85 m).
  - **Spectrum.** JONSWAP shape in wavenumber (Pierson–Moskowitz × peak enhancement γ = 3.3) ×
    directional spreading cos² round the wind, normalised so Σa²/2 = (Hs/4)².
  - **Waves.** Three cascades, 36 + 40 + 32 lattice waves, chosen once and stratified in log k.
    Choppiness λ goes from 0.55 to 1.0.
  - **Whitecaps.** The threshold on the Jacobian is tuned from its measured percentiles: none
    calm, scattered at 3, a few % at 5, ~10% at 8.
  - **CPU.** It uses each displaced cascade's 14 strongest waves, one fixed-point step for
    height, two when foam is wanted.
  - **Auto.** Weather maps rain/storm to S 1.2–6 (`autoMax` 6). The dangerous band is reachable
    only from the slider for now.
- `src/render/oceangpu.ts`: per frame, three 64² MRT passes (displacement; slope + Jacobian) and
  two foam ping-pongs. Low quality skips the fine cascade.
- `src/render/sea.ts` (SWELL path only; Classic is untouched):
  - the vertex shader displaces in x/y/z;
  - the fragment shader adds per-pixel normals, Smooth/Faceted, Fresnel to the sky, crest scatter,
    the danger tint, persistent drawn foam, wind streaks and glints off the wave normal;
  - the fake 3-tone "swell banding" is off in Swell.
- `src/render/spray.ts`: one instanced draw of off-white flecks, stretched along their velocity:
  crest spray, spindrift and bow-slam bursts. Off on low quality.
- `src/game/roughsea.ts`: the dangerous-sea gameplay (below).
- Log > Developer:
  - Ocean (Classic/Swell);
  - Sea look (Smooth/Faceted);
  - Sea state: an **Auto** button plus a 0–10 slider in 0.5 steps, with words from "Glassy" to
    "Dangerous". The slider, look and ocean mode all persist.

### Dangerous seas, cozy-safe (what S 7–10 does; all reversible, nothing lost)
- **The boat is shoved.** Wave slope and wind push her about (≤ 3.5 m/s, decaying), and bow slams
  kick her heading. She still steers.
- **Bow slams.** When the bow buries itself in a rising face: a spray burst over the bow (and
  "green water" over the deck when it's bad), a crash sound, a small camera shake (skipped
  under Reduce motion), and the hull creaks every few seconds.
- **Too rough to fish.** The cast button shows "Too rough", and pressing it says "Too rough to
  fish — find calmer water".
- **HUD warning.** "Rough seas — head for shelter" (every 25 s while exposed), and "Calmer water
  in the lee" once sheltered.
- **Shelter really works.** Danger = the sea's danger × exposure from the shore field, so the lee
  of an island, the harbour and the shallows are the refuge.
- **Weather on.** A dangerous sea drives any rain harder and whips up the wind lines and crests.
- **Camera.** It follows more of the heave (50% → 75%, low-passed); it never rolls. Reduce motion:
  the sea is at 35% and the follow is reduced.
- **Proposed, not built (needs Kellan's OK):** above S 9, an unsecured catch could slide out of
  the cooler (a "secure the catch" upgrade would stop it).

## Pass 2 results and evaluation

Captures come from `scripts/ocean_capture2.mjs`: pass 2 vs the v0.10.1 Swell (served from a
build of main), at sea states 0, 3, 5, 8 and 10, phone and desktop. They include low side views
at 8 and 10, Smooth vs Faceted at 5, and fishing at 3 and 8. `scripts/ocean_probe.mjs` was used
for tuning. Output goes to `screenshots/ocean2/` (gitignored).

**What changed while tuning:**
1. *Foam.* The first threshold left the Jacobian never crossing it, so there was no foam. Measured
   percentiles (`__debug.jStats()`): the 1st percentile of J is 0.97 at S1, 0.90 at S3, 0.76 at
   S5, 0.46 at S8 and 0.19 at S10. The threshold table was set from those. The next try was
   snow-white at S8, so the table came down a step and the persistent foam now fades in 1.6 s.
2. *Detail.* The finest cascade at full weight read as busy noise. It is now at 55% and fades by
   pixel footprint.
3. *Wind streaks.* At S10 they dominated, so their threshold went up.
4. *CPU.* The first version cost 5–17 µs per height query, ~180 queries per frame. Now: the 14
   strongest waves per cascade, one fixed-point step (two when foam is wanted), and floaters only
   query within 120 m (lean within 45 m). That is ~75–110 queries × ~4–5 µs ≈ 0.4 ms on the dev
   desktop.

**Judgement (my assessment, not player-tested):**
- *Morphing:* gone. The surface has detail at three scales, the faces move sideways, foam
  lingers and drifts, and the far sea keeps rolling normals. At S3 it reads as water, not a sheet.
- *Swell amount:* the slider covers glassy → dangerous continuously. Auto stays within 1.2–6.
- *Dangerous:* at 8–10 there are walls of water with foam rims and wind streaks, dark steep
  faces, spray and spindrift. The boat pitches and rolls hard and shows its bottom paint on the
  crests, and gets shoved. "Rough seas — head for shelter" shows, and the cast button reads "Too
  rough". The camera never rolls (`scripts/ocean_camera_check.mjs`: max roll 0 at S10; camera
  swing 1.3 m vs the boat's 2.8 m; Reduce motion takes the boat to 0.74 m and the camera to 0.16 m).
- *Smooth vs Faceted:* at S5 the difference is subtle (the shape is the same; faceted adds triangle
  value steps). **Smooth recommended** (see "Are they smooth?").

**Perf** (`scripts/ocean_perf.mjs`): phone viewport, interleaved on one page, median of 7×90-frame
synchronous benches, on a shared desktop GPU (±1 ms noise). The cascade passes are drawn
separately each frame, so they are not inside the sea figure.

| Quality | Classic sea | Swell S3 | Swell S8 | Added |
|---|---|---|---|---|
| Low | 0.22–0.29 ms | 0.61–0.83 ms | 0.29–0.92 ms | +0.1 to +0.7 ms |
| High | 0.37–0.88 ms | 1.57–2.38 ms | 1.80–2.18 ms | +0.7 to +2.0 ms (over the +1 ms budget) |

CPU: the cascade passes take ~0.25–0.3 ms to issue (5 tiny draws), rough-sea logic ≤ 0.1 ms, and
height queries ~0.4 ms.

**Weak spots / next:**
- High quality is over budget in this emulation. The next step would be a 128² high grid, the fine
  cascade only within ~40 m, and an on-device phone measurement (not done).
- The CPU uses the 14 strongest waves per cascade, so a bobber or floater can sit a few cm off the
  drawn surface in big seas. The boat hides it (heave springs + settling).
- Spray is sparse at S5–6 and only reads in the dangerous band.
- The phone chase camera frames the boat at the left edge after a teleport in both builds, so this
  is the camera rework, not the sea.
- Foam is per cascade on the GPU but uses the combined Jacobian on the CPU (spray, crest sprites).
  They correlate but are not identical.
- Not built: the ripple sim (layer 4) and the cooler slosh (needs Kellan's OK).

---

# Pass 3: hull splashes, "when the ship crashes off a wave back into the ocean" (branch `ocean3`)

Kellan: *"We also need particle effects when the ship crashes off a wave back into the ocean. Use
Wind Waker as a reference."*

## Sources inspected (frame-stepped by seeking the video 0.10–0.20 s at a time, normal speed in between)

| Source | Windows | What it shows |
|---|---|---|
| *Wind Waker HD*, "1 Hour Of Free Roaming The Sea" (YouTube `DbylHgL6XTg`) | 10:48–11:00 (four hops: lands at 10:50.7, 10:52.6, 10:55.0, 10:56.5); 19:08–19:19 (airborne 19:14.2–19:14.9, lands 19:15.05; crown at 19:17.6–19:17.9) | The King of Red Lions leaving the water and landing |
| *Wind Waker HD*, "Random Sailing" 4K (`2jy92OpGEig`) | 2:17–2:27, 3:47–3:56, 4:11–4:19 (sampled every 0.2 s) | Bow spray at full sail, three lighting conditions |
| Sea of Thieves storm footage (pass 1, `MJICjfAd6z8` 1:02–1:07) | — | A realistic slam for contrast |
| *A Short Hike*, motorboat challenge (`CkD1tSyxZwY`, 0:02–0:30, every 1 s) | — | A stylised indie boat in a top-down view |
| *Sneaky Sasquatch*, every boat's speed (`8LQgVW6numE`, 0:05–1:00, every 2 s) | — | The minimal end of the range |

Reference strips are in `docs/refs/ocean3/` (kept locally, gitignored): `ww_landing_puffs.jpg`,
`ww_landing_crown.jpg` and `ww_bow_spray_at_speed.jpg`.

## Findings (observed; no practitioner statements found for these effects)

1. **The landing is a burst of round puffs at the hull's waterline, and it is short.**
   - *Observed:* at 19:15.05 the hull meets the water and a cluster of small round white puffs
     (each a soft white disc, varied sizes, some with a faint blue-grey rim) appears along both
     sides. By 19:15.20 they have spread outward and backward and are half gone. By 19:15.35 only a
     few remain. Same timing at 10:55.05 → 10:55.20.
   - *Interpretation:* the impact reads because many simple shapes pop at once and vanish fast
     (~0.3–0.45 s), with no realistic mist.
   - *Application:* puffs pop in (≈ 80 ms to full size, with a slight overshoot), drift outward
     and back, and shrink to nothing in 0.3–0.6 s.

2. **Two white "crown" arcs stand up on either side, then are left behind.**
   - *Observed:* at 19:17.60 a thick white arch (a crescent, open side down) stands at the
     boat's side. At 19:17.75 two of them sit side by side behind the boat (the boat has sailed on;
     the arcs stay where the water was hit). At 19:17.90 they are gone.
   - *Application:* two flat white crescent sheets, one per side, spawned in world space at the
     hull and splayed outward. They rise for ~0.15 s, hold, then sink and thin (erode, like our
     crests) by ~0.55 s. The boat sails out of them.

3. **Droplets and the ring.**
   - *Observed:* at 10:55.20–10:55.50 the impact leaves an open U-shaped foam outline on the water
     (the hull's footprint, its wake arms broadening), plus two small separate white shards that
     fall back.
   - *Application:* a broken foam ring on the water that spreads from the hull and thins out
     (~1 s), plus a few droplet arcs. Where each droplet lands, a tiny ring dimple (our rain-ring
     language).

4. **Hang, then impact.**
   - *Observed:* airborne ~0.6–0.8 s; the boat's shadow separates from it on the water (19:14.2–19:14.9).
     The splash happens on the frame the hull meets its shadow.
   - *Application:* the hull really leaves the water. The heave spring can't pull it down faster
     than gravity, so over a sharp crest at speed it flies on a ballistic arc. The impact speed
     drives everything (count, size, height, sound, haptics, camera bump).

5. **At speed, the bow churns continuously.**
   - *Observed (2:21–2:26, 3:49–3:56):* a constant cluster of the same round puffs boils at the bow
     and the sides of the hull, plus the white V wake arms.
   - *Application:* bow puffs at a rate ∝ speed × sea state. Calm water gives a few small ones;
     a big sea gives a steady churn.

6. **Contrast.** Sea of Thieves sends a translucent spray sheet and mist (realistic, soft) up over
   the bow. *A Short Hike* uses chunky white bubbles plus pale V arcs in the wake. *Sneaky
   Sasquatch* has only faint streaks. Our game sits with WW / *A Short Hike*: opaque, flat,
   drawn shapes with no soft alpha mist.

## Scaling (from the observations + physics)
- **Impact speed** v (m/s, the hull's downward speed at touchdown) maps to k = clamp((v − 0.6) / 3,
  0, 1). That k sets puffs 6 → 24, droplets 4 → 18, crown height 0.5 → 1.9 m, foam ring
  1.1 → 2.2 × the hull length, the sound gain, haptics 15 → 65 ms, and a camera bump of
  0.06 → 0.3 trauma (none under Reduce motion, never a roll).
- **The Packer (T1) is heavier.** Its crown is ×1.35 wider and ×0.7 lower, its droplets are lower
  and slower, its thump deeper, and its heave springs softer (so it leaves the water less often).
- **Calm water** (sea state < 3): the same shapes at ≤ 40% size. The boat rarely leaves the
  water.
