# Title / loading screen study

The brief was "a much more beautiful title / loading screen". The loading card and the title screen had to feel like the same piece of paper as the Logbook UI. The loading part paints before any JS runs, so it has to be pure HTML/CSS/SVG and light. The title screen sits over the live world.

## Baseline (v0.7.4)

- On a slow link, the HUD showed for several seconds over flat grey. The card only faded in once the 1.1 MB JS bundle had parsed, because a JS timer added `.shown` 300 ms after the module ran (`screenshots/title_before_phone_load2.png`).
- The card was a small line-sketch sailboat with "Cedar Landing" in Fraunces and a tip, on ruled paper. It was quiet but sparse, and it didn't match the game: the game's boat is a red-roofed troller, not a sailboat.
- In landscape the tip overlapped the title.
- The version stamp was white-on-paper, so it couldn't be read on the card.
- There was no title screen; the game dropped straight into play.

## References inspected

Images are in `docs/refs/title/` (gitignored). They were downloaded and looked at directly. Game title screens are YouTube title-screen thumbnails, so these are stills and I didn't see the motion.

| Ref | Observed | Mechanism taken |
|---|---|---|
| A Short Hike, title | The scene sits in a centred window about 51% of the screen wide, framed by dark margin. A small title sits above it and "press Z to start" below, in the margin. | The scene is a **plate inside a margin**, and the text lives in the margin, not on the art. |
| Union Steamship Co. of BC poster, 1926 | Illustration inset with rounded corners. Type sits in solid bands above and below. About 5 depth steps from figures out to pale snow peaks. A tall conifer frames the right edge. | A rounded plate, about 5 flat value steps lightening toward the horizon, and near conifers as side framing. |
| Canadian Pacific, Shoesmith (UBC/Flickr Commons) | About 6 flat colours, water drawn as scalloped paper-coloured flecks, an empty colour band left at the bottom. | Water as **drawn crests** in paper colour over flat teal, rather than a texture. |
| Yes Bay Canning Co. label, 1908 | A wide band with display caps that have tiny flourishes, a central emblem, a lighthouse on the horizon, and a leaping salmon. | A **fish emblem between rules** above the name, and a lighthouse on the horizon. |
| Wind Waker, title | Red logo with a gold sub-line over live 3D Outset Island. "PRESS START" is bracketed by swirl glyphs, with © below. | The **title over the live world**, with the prompt low and centred. |
| Animal Crossing (GC), Lil Gator Game | The logo is outlined, with a shadow, and sits over an unframed world. Lil Gator's "Start" sits on a solid tab. | Two-tone lettering (face plus offset shadow) holds up over a busy background, and the prompt sits on a tab. |
| Dredge title / key art | Lighthouse with 4–5 fog steps of island silhouettes, and one hot accent (the lamp). | Atmospheric value steps; one warm accent per layer at most. |
| Ooblets loading | Flat colour, one character, a small pill bar, no text. | Restraint: the loader is one moving subject. |
| Admiralty chart, Juan de Fuca (1847/c.1865); Seale cartouche (1745) | Plain stacked letterpress title block, coastal-profile strip, ink on buff paper. The cartouche is framed by a ruled neatline. | A **double neatline** around the plate (ink, paper gap, soft ink). |

**Limits.** Library of Congress blocked automated fetches, and I found no colour Pacific Northwest salmon label, no Canadian Pacific "Princess" poster and no Great Northern poster. I found no practitioner commentary on any of these title screens, so these findings are my reading of the images, not the designers' own reasoning.

## Design (what shipped)

**The page.** One period label with three parts:
1. **Plate.** A flat-colour scene in a rounded window with a double ink neatline. The paper margin is a 200vmax paper `box-shadow` around a hole, so the live world can later show through the same window.
2. **Lockup on the sky.** A crest rule with a salmon. "Cedar Landing" is arched on an SVG `textPath` in Fraunces 800, with an ink face over a cedar-orange offset shadow. Below it is an ochre-red swallowtail ribbon reading "a Salish Sea fishing tale" in tracked Nunito caps.
3. **Caption in the margin.** The status line in small tracked caps and the Grandmother tip in the hand font. On the title screen this becomes "Tap to set out".

**The scene, back to front.** Pale sun disc; far range with one snow cone; a mist band; mid islands with a fir fringe; a lighthouse islet; water in three gradient steps with three rows of paper crests; near fir stands framing both edges; the landing (a cedar shed on a dock) on the right; three gulls; and the troller (the game's own red-roof boat) in profile.

**Progress.** The boat sails from the left shore toward the landing, leaving a dashed wake. It never moves backwards. "Cedar Landing" is literally where it's going.

**Title screen.** When the world is ready, the printed scene dissolves (1.1 s) and the live harbour shows through the same window under the same lockup. The camera drifts slowly over the water off the boat's quarter, looking past it to open sea. It picks the longest open-water bearing from the boat, so the shot never stares into the shore. One tap (or any key) swings the camera around the boat into the chase view over 1.8 s, and the paper fades out. Then the existing area title card follows.

**Quick path.** A tap or key during loading means "go straight in" and skips the title. The title accepts the very first tap. `?debug` skips the title (for automated tests) unless `&title` is also passed.

**Motion.** All of it is transform-only, on HTML-level boxes so the compositor can run it while JS parses:
- crests drift at three parallax speeds (120 s, 80 s, 52 s);
- the boat bobs (3.2 s);
- gulls glide and flap;
- the "Tap to set out" button breathes.

`prefers-reduced-motion` and the in-game reduce-motion setting turn all of these animations off.

**Weight.** The markup is generated by `scripts/title_art.mjs` (seeded and deterministic) between `<!-- opening:begin/end -->` in `index.html`. It is about 14.7 KB raw and 4.4 KB gzip, and uses no images.

## Results

Phone 390×844, Chromium, medians of 3 runs, two interleaved rounds. "Throttled" means about 9 Mbps, 150 ms latency, 4× CPU.

| | before | after |
|---|---|---|
| First contentful paint, throttled | 552 / 576 ms | 584 / 604 ms (+~30 ms: 4 KB more HTML plus SVG parse) |
| Something branded on screen, throttled | ~1.16 s (card faded in after JS) | at first paint, ~0.6 s |
| World ready, throttled | 7.56 / 7.45 s | 7.65 / 7.54 s (within run-to-run noise) |
| World ready, unthrottled | 0.83 / 0.74 s | 1.24 / 0.83 s (noisy: another agent's browsers were running) |

Screens: `screenshots/title_after_*`, `screenshots/title_compare.png`.

## Weak spots / open questions

- **Progress.** The boat stays at the start until the JS bundle arrives and the loader reports, because the first progress event comes after the manifest. The boat bobs and the water moves, but on slow links the boat sits still for several seconds.
- **The scene's fir stands** are spiky generated triangles. They read well small, but on desktop they're thin compared with a hand-drawn poster tree.
- **Landscape phones.** The lockup overlaps the islands and mountains. It's readable because of the two-tone lettering, but busier than in portrait.
- **Back-to-back titles.** After "Tap to set out", the area card for the spawn place ("Keeper's Cove") appears about 2 s later.
- **Every cold launch** shows the title, which is one extra tap. A tap during loading skips it.
- **The title camera** is chosen procedurally by the open-water search. It has only been checked at the current spawn.

## Later: sepia drawing (branch `sepia`)

The live title view is now drawn as a sepia pen-and-wash sketch and colour blooms in from the boat on "Tap to set out" — see `docs/sepia_title_study.md`.
