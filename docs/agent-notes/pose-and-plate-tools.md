# Pose captures and unit plates

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 532-597, section "Dev instruments" -->

- **Two ways to look at a POSE, because the browser draws a soldier at about
  25 px and canvas readback is black by design.** `tools/render_clip_pose.py`
  renders one named clip of one GLB at one frame at 1400 px through
  `render_rig.py`'s own dimetric camera — the instrument for "is 33° of barrel
  offset actually visible", which it settled twice.
  `tools/src/perf/gait-captures.ts` is the other half: the LIVE renderer,
  driven against the running dev server, every affected type walking and
  firing, at the camera's own default zoom and at the top of the 0.35–2.5
  clamp. It photographs BEFORE art by intercepting the `/meshes/*.glb` fetches
  and answering them from `git show <rev>:assets/meshes/…`, so no file in the
  tree is touched and the server never restarts — and it refuses to finish if
  not one intercepted file differed from what is on disk, because a route
  glob that stops matching produces a "before" sheet that is a second copy of
  "after" and looks exactly right. Use the live one whenever the question is
  about runtime behaviour (playback rate, ramps, the sun, the occlusion
  outline) and the Blender one when it is about the authored pose alone.
- **`pnpm plates:units [--only=<id>[,<id>...]] [--out=…] [--port=…] [--metal]`**
  (`tools/src/perf/unit-plates.ts`) photographs every KDF type through the
  running game for the garage screen — one JPEG per id under
  `assets/ui/plates/units/`, plus a manifest read by `unitPlate`
  (`packages/app/src/ui/portrait.ts`, beside the cropped-icon `unitIcon`).
  Every type is spawned, captured and struck at the SAME tile (found live
  from `sim.blocked`, open ground clear of any building for 6 tiles), camera
  zoom 3.2 at DPR 2 — the brief's own starting zoom of 3 read a tank at 596px
  wide, under the 600px floor, so it went up. The plate carries no alpha, so
  `extent` (the unit's own pixel footprint) is measured by diffing against an
  empty-ground reference frame with `pixelmatch` (`diffMask: true`, the
  bounding box of what differs) rather than read off a channel — a self-diff
  is pixel-identical and reads `[0, 0]`, which the harness refuses to ship a
  manifest entry for, loudly. It strips every unit `showSandbox` fields by
  default (both sides) before spawning anything: an early run put the parade
  tile 7 tiles from a default `militia_cell`, and an `apc_eitan` found it and
  opened fire mid-capture, its own muzzle flash and tracer blowing the
  measured extent out past 1100px. (The two drones once carried no GLB and
  were loaded here as billboard sheets; both have GLBs since B0a, and a type
  the boot roster did not field is picked up by `main.ts`'s 1 Hz mesh sweep.)
  **The dev instrument that actually failed here was SwiftShader itself**, not
  content: a `page.screenshot` measured 180s+ stalls (`GL Driver Message ...
  GPU stall due to ReadPixels`) after only two or three captures shared one
  browser tab, and once escalated to a WebGL context loss that took
  `window.__lions` down with it (a full-frame diff — extent reading the
  capture's own dimensions — is the tell something upstream broke, not a
  giant unit). **Hardware GPU was tried and measured NOT to fix it**: Metal
  args (`docs/PERFORMANCE.md`, `backend-curve-gate.ts`) made the monolithic
  all-seventeen loop 24x faster to its own crash (14.88s vs multi-minute
  SwiftShader stalls) but hit the SAME context loss on the very next capture
  after the first succeeded — so the failure is not GPU-backend speed, and
  the shipped default stays SwiftShader; `--metal` is an explicit opt-in,
  confirmed and logged via `readUnmaskedRenderer` (`golden-diff/browser.ts`,
  the same `WEBGL_debug_renderer_info` read `backend-curve-gate.ts` uses)
  into the manifest's own `camera.gpu`.
  **The reliable fix is one browser per unit.** With no `--only`, the entry
  point is an ORCHESTRATOR: it starts the dev server once, then spawns one
  `tsx` CHILD process per id (`--only=<id> --child --port=<port>`, run
  SEQUENTIALLY — parallel Chromiums would reproduce the same resource
  pressure), each getting its own fresh `chromium.launch` and therefore never
  asking a page for a second screenshot. A child writes its own result as a
  fragment under `<outDir>/.fragments/<id>.json` instead of touching the
  shared `manifest.json` directly; only the orchestrator merges, once, at the
  end, which is what makes a single failed id reported and skipped without
  losing every other id's already-written entry or racing the file. `pnpm
  plates:units` with no args is now the one command that reliably produces
  the full set — verified end to end, 17/17, 562.4s. `--only=<id>[,<id>]`
  with no `--child` is UNCHANGED from before this split: a direct,
  single-session capture that merges straight into `manifest.json`, still the
  fast path for the falsification workflow above.
