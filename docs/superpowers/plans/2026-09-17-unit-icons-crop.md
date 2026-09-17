# Unit Icons — Crop-and-Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every unit icon the shell draws — the HUD's selection chips and card, the reinforcements dock's tiles, the brigade screen's rows — shows the unit filling its frame instead of a whole 256 px sprite frame scaled to 40 px, in which the unit is a 20 px smudge. Same art, cropped to the unit's own pixel extent at build time, turret composited, with a freshness gate so a re-rendered sheet cannot ship a stale icon.

**Architecture:** A Python build step (`tools/crop_unit_icons.py`, run as `pnpm icons:units`) walks every hull sheet under `assets/sprites/`, picks the same portrait frame `packages/app/src/ui/portrait.ts` picks today, composites the paired turret sheet's frame at the same facing (offset zero at rest — `turretAxisOffset` in `packages/render/src/sheet.ts` is `[0,0]` when hull and turret face the same way), crops to the alpha bounding box padded to a square, downsamples with premultiplied alpha to 128×128, and writes `assets/ui/icons/units/<SHEET>.png` plus `manifest.json` (source frame paths and SHA-256, the crop box, the unit's pixel extent inside the icon). The app resolves an icon through one function, `unitIcon(basePath)` in `portrait.ts`, over an eager `import.meta.glob` of that directory (the `portrait-catalogue.ts` pattern), and falls back to today's sheet frame when no icon exists. A vitest pins every manifest hash against the frame on disk and `--check` runs in CI. The per-unit Blender portrait pass is a LATER step and replaces the PNGs behind the same function.

**Tech Stack:** Python 3 + Pillow (`tools/render_*.py` already use it), TypeScript strict, vitest (jsdom for UI), pnpm.

**Measured premise (2026-09-17, `PIL.Image.getbbox` on the shipped portrait frames):** `INF_SQUAD` idle f03 occupies (64,23)-(196,147) of 256 → 132×124 px; `INF_AT` 69×119; `TNK_HULL` f03 135×103 with `TNK_TURR` 60×89 inside it; `EITAN_HULL` 156×168; `DRONE_RECON` 170×140. Scaled to the 2.5rem (40 px) chip frame the unit is 11–26 px tall.

## Global Constraints

- Icons live under `assets/ui/icons/units/` — NOT under `assets/sprites/`, so `pnpm validate:assets` (which walks sprites) never sees them, and the palette/silhouette gates are unchanged. Icons are derived art: a re-render of a sheet must be followed by `pnpm icons:units`, and the gate below makes forgetting loud.
- The frame chosen is exactly `portraitFile(manifest)`'s choice (`portraitFacing ?? 3`, `idle` frame 0, the same two fallbacks). The Python reimplements that rule and a test pins the two implementations against each other by comparing the manifest's recorded `facing`/`file` with `portraitFile` run over the same sheet manifest.
- Turret pairs are by name: `<X>_HULL` + `<X>_TURR` (TNK, EITAN, NAMER, TECH, GUNTRUCK). The turret frame at the same facing is composited over the hull frame with NO offset (rest pose; see `turretAxisOffset`). `BLD_*` sheets and `*_TURR` sheets get no icon of their own.
- Output: 128×128 RGBA PNG, transparent background, the unit's larger extent filling 84% of the icon (an 8% margin each side), never upscaled past 1:1 (a unit smaller than 108 px in its larger dimension is centred at native size). Downsampling premultiplies alpha before `LANCZOS` and un-premultiplies after, so edges do not fringe dark. Deterministic: no noise, no timestamps in the PNG (Pillow writes none by default; do not add text chunks).
- `manifest.json` schema: `{ "version": 1, "icons": { "<SHEET>": { "file": "<SHEET>.png", "sources": [{ "path": "assets/sprites/<SHEET>/<frame>", "sha256": "<hex>" }, ...], "facing": <n>, "box": [x, y, w, h], "extent": [w, h] } } }` where `box` is the square crop in source-frame pixels and `extent` is the unit's alpha bounding box inside the 128 px icon. Sorted keys, 2-space indent, trailing newline.
- `unitIcon(basePath)` returns `{ url, size: 128, extent: [w, h] } | null`; `basePath` is a `SPRITE_MAP` `path` (ends in `/`); the sheet name is its last segment. The peer session's Phase 2/3 will consume this signature — keep it.
- Icon `<img>` elements carry `data-icon="1"`; `theme.css` gives them `image-rendering: auto` (a 128→40 downscale of a smooth Lanczos crop must not be nearest-neighboured); the sheet-frame fallback keeps `pixelated`. Colours only via tokens; rem only (`pnpm validate:ui`'s px rule).
- No sim change; no renderer change; `SPRITE_MAP` stays where it is.
- Git in a worktree: `/usr/bin/git` by absolute path, one plain command per call; explicit paths; never `-A`; never stash; no heredocs. Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: `tools/crop_unit_icons.py` and the first icon set

**Files:**
- Create: `tools/crop_unit_icons.py`
- Modify: `package.json` (script `"icons:units": "python3 tools/crop_unit_icons.py"`)
- Create: `assets/ui/icons/units/*.png` (one per hull sheet), `assets/ui/icons/units/manifest.json`

- [ ] **Step 1: The script.** Arguments: `--sprites assets/sprites`, `--out assets/ui/icons/units`, `--size 128`, `--margin 0.08`, `--check` (recompute everything in memory, compare against the manifest and the PNG bytes on disk, exit 1 listing every stale/missing/extra icon, write nothing). Discovery: every directory under `--sprites` whose `manifest.json` exists, excluding names starting `BLD_` and ending `_TURR`. Frame choice per the Global Constraint. Composite: if `<X>_TURR` exists beside `<X>_HULL`, load its frame at the same facing (same choice rule) and `alpha_composite` it over the hull frame. Crop box: alpha bbox with threshold `alpha > 8`, padded by `margin` of the larger side, made square about the box centre, clamped to the frame (shift, do not shrink, when clamping). Resize with premultiplied alpha. Write PNG + manifest. Print one line per icon: `<SHEET> facing <n> box <x,y,w,h> extent <w,h>`.
- [ ] **Step 2: Run it**, commit the output. Inspect three icons by eye (`Read` the PNGs): `INF_SQUAD`, `TNK_HULL` (turret present, centred), `INF_BREACH` (facing 5). Paste the printed lines for all sheets in the report.
- [ ] **Step 3: Falsify `--check`** once: edit one byte of `INF_AT.png` (e.g. re-save it with a different margin into place), run `--check`, paste the red line, restore by re-running the script; confirm `git status` clean apart from the intended files.
- [ ] **Step 4: Commit** `tools/crop_unit_icons.py package.json assets/ui/icons/units` — `feat(art): unit icons cropped from the sprite sheets, with a --check mode`.

### Task 2: `unitIcon` in the app, and every surface uses it

**Files:**
- Modify: `packages/app/src/ui/portrait.ts` (+ `portrait.test.ts` if present, else create beside it)
- Modify: `packages/app/src/main.ts` (`portraits[typeId]` builder and `loadBrigadePortrait`), `packages/app/src/ui/hud.ts` (`artHtml`), `packages/app/src/ui/production.ts` (tile art), `packages/app/src/ui/brigade.ts` (row art), `packages/app/src/ui/theme.css`

- [ ] **Step 1: `portrait.ts`** — add `export interface UnitIcon { url: string; size: number; extent: readonly [number, number] }` and `export function unitIcon(basePath: string, catalogue = ICONS): UnitIcon | null`, where `ICONS` is built once from `import.meta.glob('../../../../assets/ui/icons/units/*.png', { eager: true, query: '?url', import: 'default' })` plus a static import of the manifest JSON (`import manifest from '../../../../assets/ui/icons/units/manifest.json'`); `basePath`'s last segment is the sheet. A `catalogue` parameter (record of sheet → `UnitIcon`) exists so tests need no glob. Tests: resolves a known sheet; returns null for an unknown one and for a `BLD_` path; strips a trailing `/`; and the pin test from the Global Constraints (`portraitFile(manifest)` over each sheet's real `manifest.json` on disk agrees with the icon manifest's `facing`/`file` for every icon — read both JSON files with `fs` from the test).
- [ ] **Step 2: Callers.** `main.ts`: where `portraits[typeId]` is filled from `portraitUrl(spec.path, manifest)`, prefer `unitIcon(spec.path)?.url` and only fetch the sheet manifest when there is no icon; same in `loadBrigadePortrait`. Also expose the extent to whoever wants it later: `portraitInfo?: (typeId) => UnitIcon | null` is NOT required now — keep the deps as they are (URL strings) and add `data-icon="1"` where the URL came from an icon. To know that at the `<img>` site without changing every deps signature, have `main.ts` hand the HUD/dock/brigade a URL and let each `artHtml`/tile/row set `data-icon` when `url.includes('/icons/units/')` — one tiny helper `isUnitIconUrl(url)` exported from `portrait.ts`, tested.
- [ ] **Step 3: CSS.** `.rl-chip__art[data-icon='1'], .rl-card__art[data-icon='1'], .rl-tile__art[data-icon='1'], .rl-brigade__art[data-icon='1'] { image-rendering: auto; }` beside the pixelated rule, with a comment saying why (the crop is already resampled; nearest-neighbour would re-alias it). No size changes.
- [ ] **Step 4: Gates** — `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm validate:ui`.
- [ ] **Step 5: Commit** — `feat(ui): every unit picture resolves through unitIcon, falling back to the sheet frame`.

### Task 3: The freshness gate

**Files:**
- Create: `tools/src/unit_icons.test.ts`
- Modify: `.github/workflows/ci.yml` (a `python3 tools/crop_unit_icons.py --check` step in the `gates` job, beside `validate:assets`)

- [ ] **Step 1: Tests** (node, `fs` + `crypto`, `pngjs` for the icon's alpha): (a) every `sources[].sha256` in the manifest equals the SHA-256 of the file on disk; (b) every hull sheet under `assets/sprites/` (not `BLD_*`, not `*_TURR`) has a manifest entry and a PNG; (c) every icon PNG is 128×128 and its own alpha bbox's larger side is ≥ 100 px OR equals the manifest `extent` exactly (a unit that is genuinely small stays native-size; a stale or empty crop fails); (d) the manifest has no entry without a PNG. Falsify (a) by editing a recorded sha in a scratch copy of the manifest the test reads via an env var path override — or simpler: temporarily edit the real manifest, run, paste the red line, revert with the Edit tool.
- [ ] **Step 2: CI** — add the `--check` step; say in a comment that it is the same claim as the vitest, run from Python so a re-render without a re-crop fails even where node is not the thing that changed.
- [ ] **Step 3: Gates** — `pnpm test`, `pnpm lint`, `pnpm typecheck`.
- [ ] **Step 4: Commit** — `test: unit icons are pinned to the frames they were cut from`.

### Task 4: Browser proof and docs

**Files:**
- Modify: `CLAUDE.md` (the "Art existing is not art drawing" bullet under Mesh units, or the Dev instruments list — one bullet on icons), `packages/app/src/ui/portrait.ts` header comment (it still calls itself the stand-in for GH-153's dedicated icons — say what the crop is and what the later Blender pass will replace)

- [ ] **Step 1: Walk** (scratchpad Playwright script on the golden-diff helpers, port 5179, this worktree): `?brigade` with a seeded account — screenshot the rows; `?mission=beit_sahwan_3_clearance` past the deploy gate — select a rifle squad (`__lions.sel([id])` from `__lions.units()`), screenshot the card; select a squad and a Namer together, screenshot the chips; screenshot the reinforcements dock. Read each `<img>`'s `data-icon` and `naturalWidth` (128) through the DOM. Compare against the same shots on `main` if cheap (the before pictures from the step-3 walk exist in the scratchpad: `brigade-tracks-after.png`).
- [ ] **Step 2: Docs** as above.
- [ ] **Step 3: Full gate line** — `pnpm test`, `pnpm test:determinism`, `pnpm lint`, `pnpm typecheck`, `pnpm validate:data`, `pnpm validate:ui`, `pnpm validate:assets` (must be unchanged: icons are outside its walk), `pnpm icons:units -- --check`, `pnpm playtest`.
- [ ] **Step 4: Commit** — `docs: unit icons recorded; portrait.ts says what it is now`.

## Self-review

- Coverage: crop + composite + manifest (T1); resolver + every surface + CSS (T2); gate in vitest and CI (T3); proof and docs (T4).
- Type consistency: `UnitIcon { url, size, extent }` (T2) is what the peer session asked to consume; `isUnitIconUrl` (T2) is what the three `<img>` sites use; the manifest schema (T1) is what T2's pin test and T3's hash test read.
- Placeholders: none — sizes and margins are fixed above; the sheets and pairs are enumerated from disk.
