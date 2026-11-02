# Salish Sea: web vertical slice

A cozy fishing and boating slice in three.js, made for phone browsers. You paddle the cedar canoe, find ripples, play the fishing minigame, and sell your catch at the Cedar Landing Fish Market.

## Run

```bash
cd Ocean/game
npm install
npm run dev          # vite --host --port 5190
```

- **On a phone:** join the same Wi-Fi and open `http://192.168.4.86:5190`. Vite prints the LAN URL when it starts.
- **Debug mode:** add `?debug` to the URL to show the fps counter.
- **iPhone full screen:** iOS Safari has no Fullscreen API, so the button is hidden there. Use Share → Add to Home Screen to run it without browser chrome.

**Build / deploy:**

```bash
npm run build                          # dist/ with base "/cedar-landing/" (GitHub Pages)
BASE_PATH=/other/ npm run build        # any other base
npm run build:pages                    # relative "./" base (works from any sub-path)
```

`.github/workflows/pages.yml` builds on push to `main` (Node 22) and deploys `dist` with `actions/deploy-pages` to https://kellanm.github.io/cedar-landing/. Runtime URLs (`world/*`, `draco/`) all go through `import.meta.env.BASE_URL`.

**Smoke test:** with the dev server running:

```bash
node scripts/smoke.mjs                 # writes screenshots/ + screenshots/smoke_log.txt
```

The test runs at a phone viewport (390×844) and on desktop. It loads the game, paddles with the keyboard, does a full fishing catch with real Space input, does a second catch with auto-reel, sells at the market, checks localStorage, and cycles through the time-of-day presets.

## Controls

| | Touch | Keyboard |
|---|---|---|
| Paddle / steer | Left-thumb joystick (it appears wherever you touch on the left half) | WASD / arrow keys |
| Look around | Drag on the right half | Mouse drag |
| Cast / hook / reel | Big round button (hold it to reel) | Space (hold it to reel) |
| Interact (sell, tie up…) | Green button above it, with a prompt | E / Enter |
| Skip the establishing shot | Tap | Space / tap |
| Time of day (debug) | Settings → Time of day | T |
| FPS counter | Settings → Show FPS | F |

**Fishing:**
1. Stop within about 10 m of a ripple ring and press Cast.
2. A fish shadow swims up and nibbles. Ignore the nibbles.
3. When it bites (big splash and **TAP!**), press within about 0.75 s.
   - If you press too early or miss the bite, the fish swims off but comes back. Nothing is lost.
4. To reel, hold the button. The ring around the bobber is the line tension.
   - When the fish thrashes (the ring flashes orange), let go.
   - If the ring fills, the line **slips** and the fish gains a few metres. It never snaps.
   - If you never go past the 75% tick, you get a perfect reel and +1 star.

**Stars:** every catch gets 1 star. A fish in the top 30% of its size range gets +1, and a perfect reel gets +1.

**Cooler:** the canoe holds 2 fish. Sell them at the Fish Market for Shells. An auto-reel assist is in Settings.

## Data pipeline

Blender (`lighthouse_island.blend`) is the level editor, and its export script writes `public/world/`. See `../docs/web_export_contract.md`. Never edit those files by hand.

| File | Used for |
|---|---|
| `world/READY` | Export-complete marker. Its content is used as the version / cache-buster. |
| `world/manifest.json` | Lists the chunk glbs (with bounds), the backdrops, the clouds and the protos. |
| `world/chunks/*.glb` | Draco-compressed static scenery. Colour comes from `COLOR_0`, rendered with `MeshBasicMaterial({vertexColors:true})`. |
| `world/protos.glb` + `instances.json` | One InstancedMesh per proto per 120 m cell. Entries are `[x,y,z, qx,qy,qz,qw, s]`. `BOAT_T0` is the canoe. |
| `world/gameplay.json` | The spawn (`dir`), interacts, hotspots, the `landgrid` collision, cameras and `time_of_day`. |

**Runtime behaviour:**
- **Startup:** if `READY` is missing, the game builds a small **placeholder world**. This is a few islands plus a Cedar Landing pier and market, using the same data shapes, and a red badge says so.
- **Live updates:** the game polls `READY` every 5 s. When it appears or changes, the export is loaded and swapped in live.
- **Lighting:** everything is unlit. The time-of-day `tint` is applied as `material.color` (a multiply on the vertex colours).
- **Sun-plane shading:** `src/render/lighting.ts` derives a flat face normal per fragment (`dFdx`/`dFdy`, the glbs have no normals) and maps `dot(N, sun)` through a hard 3-step ramp (lit / side / shadow) with a warm-lit / cool-shadow tint per time of day. The sun comes from `time_of_day[*].clouds.sun` when set, otherwise from the `PRESETS` table. Backdrops get 15 %, clouds, sea and sky none. Settings → Sun shading toggles it.
- **Wind:** instanced trees and shrubs sway in the vertex shader (more with height, per-instance phase; broadleaf and shrubs a bit more). Meshes in `world/dynamic.glb` with extras `anim: "flutter"` (optional `anchor`: `-x`/`+x`/`-z`/`+z`/`top`) wave like cloth; give them 6+ segments along their length. `?flagtest` adds a test pennant. Settings → Wind toggles it.
- **Fog:** chunks use distance fog in the haze colour. Backdrops (and the `PTL*` far-forest protos) use a constant weak haze instead. Clouds have no fog.
- **Far forests:** `PTL*` protos (150–580 tris each, ~20k instances ≈ 6.5M tris) are swapped at load for 8–20 tri impostors (cone / blob) that keep each proto's height, width and average colours. That cuts the frame from ~4.4M to ~0.8M tris. A proper low-LOD `PTL*` export would remove the need for this.
- **Draco:** the decoder is shipped in `public/draco/`, copied from `three/examples/jsm/libs/draco/gltf`.

## Code map

```
src/main.ts               boot, game loop, interactions, settings, window.__debug hook
src/world/types.ts        data contract types
src/world/loader.ts       READY polling, manifest/glb/proto loading (GLTF + Draco)
src/world/placeholder.ts  built-in dev world + default time-of-day palettes
src/render/materials.ts   shared unlit materials, tint, backdrop haze
src/render/environment.ts sky dome (gradient), sea (near wave patch + far ring)
src/render/lighting.ts    sun-plane shading + wind (shader patch, TOD presets, toggles, window.__light)
src/render/instances.ts   per-cell InstancedMesh field with distance culling
src/game/boat.ts          arcade canoe physics (3 m/s tier 0), bob/roll
src/game/collision.ts     landgrid (plus optional circle/poly) collision with sliding
src/game/camera.ts        chase camera, drag orbit, scripted shot (Shot_VillageReveal)
src/game/fishing.ts       cast → wait/nibble → bite → reel (tension, slip, perfect)
src/game/fishdata.ts      species table, rarity weights, prices
src/game/hotspots.ts      ripple rings + circling fish shadows
src/game/save.ts          localStorage save
src/ui/hud.ts             DOM HUD: toasts, cooler, catch card, sell panel
scripts/smoke.mjs         Playwright smoke test
```

**Tuning knobs:**
- `BOAT_T0` in `boat.ts`
- `T` in `fishing.ts`
- `QUALITY` and the ranges at the top of `main.ts`
- `PRESETS` in `lighting.ts` (sun, steps, tints, thresholds, wind), `LIGHT_STRENGTH` and `WIND` in `materials.ts`

**Low quality setting:** drops foliage protos under 1 m, lowers the fog and draw distance to 600 m, and lowers the pixel ratio to 1.5.
