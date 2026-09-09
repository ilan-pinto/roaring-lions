# Level load time

**Date:** 2026-09-07
**Asked by:** the project lead -- *"let's start handling the load time of each level. How
can we make it fast?"*
**Instrument:** `pnpm perf:load` (`tools/src/perf/load-profile.ts`), landed at `e7a8c8b`.
**Status:** measured; steps 1-2 landed the same day; 3-6 queued in ranked order.

## After steps 1-2 (same command, same machine, same day)

| what              | requests | MiB    | last byte |
|-------------------|---------:|-------:|----------:|
| meshes (GLB)      |       43 |  44.00 |    453 ms |
| ground textures   |        4 |   2.33 |    557 ms |
| sprite sheets     |       95 |   1.22 |    928 ms |
| code              |        7 |   0.33 |    100 ms |
| fonts, data, misc |       17 |   0.06 |    508 ms |
| **total**         |  **166** |**47.9**|          |

Milestones: loading screen 539 ms, sheets 962 ms (was 3431), first frame 4166 ms (was
6334). The 95 sprite requests are the one sheet a recon mission still draws as a
billboard (`recon_drone`) plus 29 two-kilobyte portrait manifests; the five vehicle
sheets that back sprite wrecks were confirmed arriving after the first frame. The
GLBs are now 92% of the bytes, which is what steps 3 and 4 are for.

## What a level costs today

One mission, production build (`vite build`, served by `vite preview` on localhost),
HTTP cache OFF -- a first visit, or any visit after GitHub Pages' `max-age=600` has
lapsed. beit_sahwan_1_recon, 2026-09-07, this machine, SwiftShader:

| what              | requests | MiB    | last byte |
|-------------------|---------:|-------:|----------:|
| sprite sheets     |    3,665 |  61.01 |   3415 ms |
| meshes (GLB)      |       43 |  44.00 |    417 ms |
| ground textures   |        4 |   9.36 |    539 ms |
| code              |        7 |   0.33 |    100 ms |
| fonts, data, misc |       17 |   0.06 |    474 ms |
| **total**         |**3,736** |**114.8**|          |

Milestones: loading screen at 505 ms (the mesh phase is over), sheets N / N at 3431 ms,
first frame at 6334 ms. The mesh phase is *already roster-driven* (`mesh-catalogue.ts`,
`missionUnitTypes`) and finishes before the deploy screen is even on the screen. What
holds the screen for three seconds -- and on a real network for far longer, because it is
3,665 separate files -- is every sprite sheet in `SPRITE_MAP`, loaded for every unit type in
the game, on a renderer that draws all but six of those types as 3D meshes and never reads
their sheets.

The dev server (`pnpm dev`) reads the same shape with 237 code requests instead of 7;
nothing below is about the dev server.

Three facts that decide the order below:

- **Bytes and requests both matter, and requests matter more on a real host.** 3,665
  files over HTTP/2 is still 3,665 round trips of queueing; GitHub Pages compresses
  none of them (PNG, GLB), so there is no free win from the host.
- **Warm is not warm after ten minutes.** Pages serves `Cache-Control: max-age=600` and
  headers cannot be changed. Every `?mission=` is a full page load, so a level started
  ten minutes after the last one re-validates ~3,700 URLs before the deploy screen. Only
  a service worker fixes that on Pages.
- **The renderer skips a unit whose sheet is absent** (`updateUnits`: `if (!instancer)
  continue`; the wreck and death draws likewise), and mesh-drawn types are skipped before
  the sheet is even looked up. Withholding a sheet is therefore safe by construction; the
  only thing a missing sheet costs is the SPRITE WRECK a mesh vehicle still falls back to
  (`addWreck` excludes rigged types only -- see CLAUDE.md, "What has NO death state is a
  mesh VEHICLE").

## The plan, ranked by bytes x requests removed per unit of risk

1. **Sprite sheets follow the roster and the mesh plan** (`-61 MiB, -3,600 requests`,
   done 2026-09-07). On the mesh path a unit sheet loads before deploy only for a roster
   type with NO GLB (`gun_truck`, the three drones, `manpad_team`, `recoilless_team`
   today); a structure sprite only for a map structure type with no building mesh (none
   today). Sheets the game may still need later -- a mesh VEHICLE's wreck sprite, a
   deferred KDF buildable's billboard fallback -- load AFTER the first frame, in the
   background, never gating deploy. Portraits keep reading every sheet's `manifest.json`
   (2 KB each), because the HUD shows a face for a type whose sheet is not loaded. Pixi and
   `&nomesh` keep loading everything, unchanged: they draw from the sheets.
   The decision is a pure function, `spriteSheetPlan` in `mesh-catalogue.ts`, tested.
2. **Ground textures ship as JPEG, sources stay PNG** (`-8 MiB`, done 2026-09-07). The
   1024^2 tiles are opaque photographic noise stored losslessly at 2.2-2.5 MB each;
   JPEG q90 with no chroma subsampling reads 490-680 KB each (measured on all of them; q85
   saves another 20% and was not taken, q95 costs 40% more for nothing this camera can
   show), so the four a map fetches drop from 9.4 MiB to about 2.4. The PNGs move to `art/textures/` as the source of record
   (`art/blend/` is untracked); `assets/textures/*.jpg` ships. Colour space and wrap are
   unchanged (`NoColorSpace`, `RepeatWrapping`).

   **A seventh tile landed 2026-09-08** -- `knoll_scree_tile.jpg`, 584 KiB, the `n`
   rocky knoll's own albedo. It is a real addition to the wire, not a saving: 19 of the
   25 shipped maps carry knolls, so nearly every playable level now fetches one more tile. That
   is affordable at this step's own prices (a level's ground textures go from about 2.4
   MiB to 3.0, against the 47.9 MiB the whole level costs after step 1) and it is why
   the per-map skip in `loadGroundTexture` had to exist first: the one map with no `n`
   pays nothing, and neither does any map for a slot it cannot sample.
3. **Wreck meshes load after the first frame** (`-9.62 MiB` on the profile mission, done
   2026-09-08). `loadBuildingMesh` takes `wreckUrl: null` from `main.ts` now and the new
   `ThreeRenderer.loadBuildingWreckMesh` runs in the same two-rAF bucket as
   `spritePlan.after`. Measured per map, since it is the set of types the map stands:
   `khan_rafid` 11.32 MiB, `beit_sahwan_*` 9.62-9.66, `marj_perimeter` and the whole
   Wadi Halam arc 8.14, `qarn_hadid` 5.99, the Umm Zeitoun set 4.32, `deir_amun` 4.36,
   `tutorial_ground` 2.66, and the Tel Marum set only 0.13-0.19 (they stand `concrete`
   and little else). On `beit_sahwan_1_recon`: **47.00 -> 37.38 MiB, 168 -> 159 requests**,
   both exactly reproducible over 3 runs. Unthrottled on localhost the milestones do not
   separate -- the before and after ranges overlap, because 9.62 MiB off local disk is
   nearly free -- so the win was measured on a link instead. At `--mbps=20`, 3 runs each,
   ranges that do not touch: **deploy-ready 21321-21493 ms -> 17297-17322**, loading
   screen 19716-19761 -> 15697-15715, first frame 23317-24106 -> 19407-19836. The
   saving is 4.03 s and 9.62 MiB at 20 Mbit/s is 4.03 s, which is the whole of it.
4. **Geometry compression** (`-20.79 MiB` on the profile mission, done 2026-09-08).
   Draco over all 79 shipped meshes: **75.47 MiB -> 25.98, 34%**, and not one file grows.
   Two guesses in the old text were wrong and are worth correcting rather than deleting.
   The estimate was "3-5x on geometry-heavy files": the rigged infantry beat it
   (`meshy_mortar_team` 5.51 -> 0.81 MiB, 6.8x). And "nothing on the textured vehicles
   whose bytes are JPEG" is false -- `technical` goes 2.90 -> 1.34 and `paramotor` 3.37
   -> 1.46, because their geometry was a bigger share of the file than assumed. What is
   left in those two IS the bake, so the SHAPE of the guess held and the size did not.

   **It is a ship step, not an export step** -- the project lead's call, and it is the
   ground tiles' split (step 2) applied to meshes: `art/meshes/` stays the uncompressed
   source of record and `assets/meshes/` is the compressed copy that ships, written by
   `pnpm encode:meshes` (`tools/src/meshes/encode-meshes.ts`, deterministic -- two full
   encodes are byte-identical across all 79). That matters more here than for a texture,
   because Draco quantisation is LOSSY and `validate:meshes`, `building_facing.py` and
   the mesh contract all read geometry as though it were exact. They still read the
   source. `pnpm encode:meshes -- --check` runs in CI's `gates` job and fails, naming
   files, when the two trees disagree in either direction.

   Three consequences of the move, none incidental. `meshUrl` now returns a `publicDir`
   path rather than a Vite glob, which **retires the GH-147 stale-listing failure for
   meshes by construction** and makes them consistent with every other large binary this
   game ships. The decoder is self-hosted in `assets/draco/` (the wasm pair, 245 KB,
   fetched once) -- never a CDN, the fonts' rule. And one shared `GLTFLoader`
   (`three/units/gltf-loader.ts`) replaces nine `new GLTFLoader()` sites, because a tenth
   added without the decoder would throw on every compressed file it touched.

   **Draco buys bytes with CPU, and on localhost that is a bad trade.** Unthrottled, the
   first frame goes 2252-2622 ms uncompressed to 2716-3624 compressed -- about half a
   second of decode, after raising `DRACOLoader`'s worker limit from three's default 4
   (3318-4993 ms) to 8; 12 was no better (2787-4170), so the cap sits where the curve
   flattens. On a link it is not close. At `--mbps=20`, 3 runs each:

   | milestone      | after step 3 (ms) | after step 4 (ms) |
   |----------------|-------------------|-------------------|
   | loading screen | 15697-15715       | 6670-6690         |
   | deploy-ready   | 17297-17322       | 8212-8252         |
   | first frame    | 19407-19836       | 10725-11501       |

   **47.00 -> 16.59 MiB and deploy-ready 21.4 s -> 8.2 s across steps 3 and 4 together**,
   on the same machine and the same command.
5. **A service worker for Pages** (done 2026-09-08). `assets/sw.js`, registered by
   `packages/app/src/service-worker.ts` in production builds only. Network-first for a
   navigation, cache-first for Vite's hashed `assets/`, stale-while-revalidate for the
   unhashed `publicDir` binaries; `video/` and any ranged request are never touched.

   Measured with a purpose-built probe (three loads in ONE browser context, against
   `vite preview`, which sends `Cache-Control: no-cache` and is therefore a fair stand-in
   for Pages ten minutes on). Repeat loads, throttled to 20 Mbit/s and 20 ms RTT:

   | | requests over the wire | ready |
   |---|---|---|
   | without the worker (`?nosw`) | 343-352, all revalidations | 8160-8206 ms |
   | with the worker | **0** | **6829-6999 ms** |

   The bytes were already small (304s); **the win is 350 round trips**, which is what
   this document's own "requests matter more on a real host" note predicted. ~1.3 s per
   repeat load at 20 ms RTT, and it grows roughly with RTT -- a mobile connection at 100
   ms is several seconds.

   **The dangerous half is the recovery path, not the caching.** A navigation is
   network-first so no deploy can be pinned out; the cache name carries the full version
   and `activate` deletes every other `lions-` cache; and `?nosw` purges the caches and
   unregisters the worker, listed in `KNOWN_PARAMS` because a stuck player has no other
   way to find it. `sw-policy.test.ts` evaluates the SHIPPED file in a `node:vm` sandbox
   and drives its `strategyFor` directly, on both the origin root and a Pages sub-path.

   **It also broke `pnpm perf:load` silently, which is worth knowing before trusting any
   number from that tool again.** A worker controlling the page serves out of the Cache
   API, Chrome reports `encodedDataLength: 0` for those responses, and the cold profile
   went on printing "cache=OFF (cold)" while reporting **0.39 MiB against a real 16.59**.
   Fixed with `Network.setBypassServiceWorker` on cold runs; `--warm` deliberately leaves
   the worker on, because with it in the build "warm" now means a returning player, which
   is the thing this step exists to improve.
6. **First frame.** ~~2.9 s between the deploy click and `window.__lions`~~ -- **that
   number was a software rasteriser's, and on real hardware the gap is mostly not there.**
   Profiled 2026-09-09 after fixing the harness (below): on `ANGLE Metal Renderer: Apple
   M3 Pro`, first frame reads **887, 892 and 1797 ms** against SwiftShader's 2439-3239 for
   the same build. `ready` is ~340 ms either way, so the deploy-to-world gap is about
   **550 ms warm**, not 2.5 s. The 1797 ms outlier is the FIRST run of a fresh browser --
   shader compilation -- and it is the only part of this step with a real target left in
   it. Terrain compose, scatter, decor placement and fog are not the problem they looked
   like. **Do not tune against a SwiftShader profile.**

   **The harness was measuring through the wrong renderer, for four steps.** Playwright's
   default headless launch renders WebGL through SwiftShader, which `docs/PERFORMANCE.md`
   already names as "the single largest confound found while producing this doc" and which
   `perf/backend-curve-gate.ts` already worked around -- and `load-profile.ts` shipped
   without the same arguments. Every `first-frame` figure this document quoted between
   2026-09-07 and 09-08 is therefore a CPU rasteriser's. **Bytes and request counts were
   never affected**, so steps 1-5's headline results stand exactly as recorded; only the
   first-frame column was wrong. Fixed by taking `backend-curve-gate.ts`'s arguments and
   by PRINTING the unmasked renderer on every run, so a number from this tool can no
   longer be quoted without knowing what drew it.

   One measurement subtlety this exposed and that any future reader needs: the profiler's
   window ends the instant `window.__lions` exists, and the deferred art from step 3
   (wreck meshes, after-frame sheets) is issued from a `requestAnimationFrame` callback.
   On a fast renderer that work is issued and largely completes inside the window --
   **175-180 requests / 20.07 MiB** -- while on SwiftShader the window closed first and
   the same build read 162 / 16.64. Both are true and they answer different questions:
   **16.6 MiB is what gates the deploy screen; ~20.1 MiB is everything a first visit
   eventually pulls.**

Not on the list, by the lead's decision (2026-09-07: *"dont drop resolution"*): reducing
vehicle bake resolution below 2048^2. It would save ~1 MB per vehicle; the art reads at
2048 and stays there. `tools/vehicles/textured.py`'s `TEXTURE_PX` is that decision in code.

## Measuring

Before and after every step, the same command, and the numbers go in the commit:

```bash
pnpm build && pnpm perf:load -- --mission=beit_sahwan_1_recon --serve=preview
```

`--mbps=20` puts a downlink under it; `--warm` runs with the cache on; `--sandbox=<map>`
profiles a sandbox. The milestones are read from the page's own DOM and are portable; the
milliseconds are this machine's and SwiftShader's, and every number quoted from the tool
should say so.
