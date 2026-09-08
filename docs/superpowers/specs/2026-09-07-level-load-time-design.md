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
3. **Wreck meshes load after the first frame** (`-8 to -12 MiB` depending on the map).
   `hall_wreck` is 3.8 MB, `house_wreck` 2.6, `apartment_wreck` 1.6; a building takes
   minutes to fall and `loadBuildingMesh` already takes the wreck as a separate URL. Same
   shape as step 1's background list. Not started.
4. **Geometry compression.** The rigged infantry GLBs are the heaviest files that are not
   texture-bound (`meshy_mortar_team` 5.5 MB, `sarim_rifles` 3.6, `meshy_soldier` 3.0).
   Blender's exporter has Draco; three.js has `DRACOLoader` (a ~150 KB decoder, fetched
   once). Expected 3-5x on geometry-heavy files, nothing on the textured vehicles whose
   bytes are JPEG. Needs the whole export pipeline plus `validate:meshes` to read the
   compressed files. Not started.
5. **A service worker for Pages.** Cache-first for Vite's hashed `/assets/*`, stale-while-
   revalidate for everything under `publicDir` (sprites, audio, textures, video), so the
   second level in a session loads from disk whatever the host's `max-age` says. Not
   started; it is the only item that helps a returning player more than a new one.
6. **First frame.** 2.9 s between the deploy click and `window.__lions` on SwiftShader
   (terrain compose, scatter, decor placement, fog, first GPU upload). Unmeasured on a real
   GPU; profile before touching. Not started.

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
