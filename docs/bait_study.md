# Bait study: the small fish at a fishing spot (third pass on hotspots)

Branch `hotspot` (merged main v0.8.4). Feedback after v0.8.3: *"The bait fish look really bad in the new
version of the fishing spot. Can we further iterate on this?"* Read `docs/hotspot_study.md` first (the
feeding-water design: slick, boils, dimples); the boils were not criticised and are unchanged. Birds untouched.

## Baseline (v0.8.4, `screenshots/bait_before_*`)

Captured close (fixed camera 6 m back, 4 m up: rail / hold-up distance) and at the normal chase camera 9 m out.

| Evidence | What reads as "bait fish", and why it is ugly |
|---|---|
| `bait_before_phone_close_still.png`, `bait_before_inrange_zoom.png` | The "nervous water" chop dashes: **hundreds of grey capsules** scattered evenly over the whole patch, flickering. Up close they are thumb-sized grey sticks; at chase distance, grey confetti. They are what reads as the bait, and they read as litter. |
| same | Glints: flat white **diamonds popping on and off in place** (no fish attached, no motion). |
| same | Fish "shadows": smooth 12-gon **dark lozenges** skating on circles at constant speed, no body motion; at the rail they are 1-2 m blobs. |
| same | Bait flicks: rows of tiny white triangles. Too small to read as fish, so they read as more confetti. |

## References and mechanisms

Reused: hotspot/crest studies (Animal Crossing / Wind Waker fish shadows: a few dark fish-shaped shadows, never a
scatter; Dredge disturbed water; crest lesson "fewer, better; marks with a life"). Added, from what is known
about bait balls (herring, sand lance) seen from above, not newly footage-checked:

- A bait school is **one coherent dark shape** that moves as a unit and changes heading suddenly;
- the signature is the **flash**: silver flanks catch the light *as the fish turn*, and because the turn runs
  through the school front-to-back, the flash runs through it as a wave (Deneki: "subtle flashes on the surface");
- chased bait **skips out of the water in low arcs**, a few at a time, from the edge of the school, with a splash in and out.

The Logbook herring plate (`public/fish/pacific-herring.svg`) gives the colours: blue-grey back `#4E7489`, silver flank `#C9D3D6`.

## Build (`src/game/hotspots.ts`)

All in the existing instanced quad pool (`fishD` SDF: lens body + forked tail, bent by a sway so it swims):

- **School** (22 / 28 / 34 fish by tier, ~0.35-0.45 m long): a centre swims at 0.55-1 m/s (faster in a feeding
  burst), holds a heading 1.4-4 s, then jinks 50-140° (or turns back toward the bait ball). Each fish steers to its
  slot in a breathing lens (2.1 × 1.3 m) at its own turn rate, front fish first. **Flash = turn rate**: a fish shows
  its silver flank only while turning hard, so each jink sends a silver wave through an otherwise dark, submerged
  (62 % alpha) school; plus a rare lone flicker. Rare spots flash some gold.
- **Leapers** (replace flicks): 1-4 baitfish jump from the school edge in a fan of low arcs (0.8-1.6 m, ~3 body
  lengths high), rolling so the flank flashes, with a dimple where they leave and land.
- **Predators** (2 per spot, replace the ellipse shadows): fish-shaped dark shadows that dart and glide round the
  ball; dorsal fins on good/rare (unchanged mesh) still leave dimples.
- **Removed**: the chop dashes, the diamond glints mesh, the ellipse shadow mesh. Half the dimples now fall over
  the school (the nervous water is where the fish are, not a texture everywhere).
- Colours follow the sea's TOD: back = sea → herring back 0.3, ×0.62; silver = herring silver → foam 0.35 (night: moonlit foam ×1.3).
- Debug: `__debug.hotspotObj().school(name)`; `scripts/hotspot_motion.mjs` gained `close`, `closenight` and `school`
  (camera follows the school) shots and a `PREFIX` env.

## Iterations

| Run | Change | Result |
|---|---|---|
| `b1` | school + leapers + fish predators, dashes/glints removed | Reads as fish at last (`bait_b1_pair.png`), but nearly **every fish was silver** (flash fired on slot-steering, not just turns), fish too big, tails thin as wires. |
| `b2` | flash only on hard turns (>1.6 rad/s), fish 0.35-0.45 m, looser lens, fatter tail, darker submerged base | Dark school with silver waves on turns. The static close camera lost the school as it swam off. |
| `b3` / `after` | capture camera follows the school | `bait_after_school_strip.png`: school turns, flashes, a leaper arcs out; predators glide under. Shipped. |

## Evidence

- GIFs (phone): before `screenshots/bait_before_phone_{close,inrange,closenight}.gif`; after
  `screenshots/bait_after_phone_{close,school,inrange,closenight}.gif`; desktop `bait_{before,after}_desktop_inrange.gif`, `bait_after_desktop_school.gif`.
- Stills side by side (before | after): `screenshots/bait_ba_phone_{close,inrange,closenight}.png`, `bait_ba_desktop_inrange.png`.
- Strips: `bait_before_inrange_zoom.png` vs `bait_after_inrange_zoom.png`; `bait_after_school_strip.png`; fight `bait_after_fight_phone.png`.

## Perf / tests

- Hotspot draw calls 4 → **2** (marks + fins). `fishing_perf.mjs` 59-60 fps in every phase, phone and desktop.
- `hotspot_perf.mjs` (phone @3x, this desktop GPU): hotspot 0.15-0.21 ms (was 0.20-0.28). CPU: ≤34 fish per spot within 150 m, simple steering, no allocation.
- `smoke`, `fishing_capture` phone + desktop: exit 0, 0 console errors (`screenshots/tests/bait_*.log`).

## Weak spots

- At the normal chase distance the school is **subtle**: a faint cluster of slivers with silver waves; the gulls'
  dive splashes (untouched) and the boils are louder. If the school should sell the spot from afar, raise its alpha or size.
- Fish are flat sprites on the water: no depth (they do not go under boils or the slick rim), and leapers are flat
  fish raised in an arc, which reads from the 35-45° camera but would look like cards from a low one.
- The school can string out into a line during a sharp jink before it re-forms; the first frame after a spot comes
  into range flashes the whole school once.
- Fish occasionally swim over the float's clear zone (they fade there, as all marks do).
- Not checked on a real phone; no players have seen it.
