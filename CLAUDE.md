# CLAUDE.md

Working instructions for this repository. Read `docs/GDD.md` for *what the game is*; this file is *how to work here*.

---

## Project

**Roaring Lions** — source-available dimetric RTS in TypeScript. Deterministic simulation, data-driven content, realistic combat resolution.

Two renderer backends live behind one interface. **three.js is the default as of
Phase D (2026-08-30)**; PixiJS still ships and is reachable through
`?renderer=pixi`, which persists so it survives the links `menu.ts` builds.
See "The three.js backend" below before touching anything under
`packages/render/src/three/` — it has its own rules, and several of them invert
what the Pixi side does.

---

## The four invariants

These are load-bearing. Violating any of them silently breaks replays, determinism, or future multiplayer, and the breakage will not surface for weeks.

1. **Sim runs at a fixed 20 Hz tick.** The renderer interpolates to 60 fps. Never drive simulation from frame time.
2. **`@lions/sim` uses Q16.16 fixed-point. No floating point.** `Math.*` and `Date.*` are banned inside the sim package and enforced by lint. Use `fx.mul`, `fx.div`, `fx.sin` (LUT-based) from `@lions/sim/fixed`.
3. **All randomness comes from a seeded per-entity PRNG.** `rng(entityId)` — never a global stream, never `Math.random()`. Per-entity streams keep determinism stable when entity counts change mid-mission.
4. **Data flows one direction: commands in → sim → state + events out.** The renderer and VFX subscribe to events. Nothing outside the sim may mutate sim state.

If a task appears to require breaking one of these, stop and raise it rather than working around it.

---

## Package layout

```
packages/
  sim/      deterministic core — imports NOTHING
  render/   renderer + VFX — imports sim types read-only. `app` holds the
            `Renderer` interface (api.ts), never `PixiRenderer` directly, so a
            second backend is a new implementation rather than a rewrite.
  data/     unit/building/mission/vfx JSON + schemas
  app/      shell, input, UI, campaign ledger
  worker/   Cloudflare Worker in front of the game: static assets, POST /api/events
            into D1, /stats behind a password login (WP-T1). Nothing imports it.
tools/      render rig, asset validator, balance sim
docs/       GDD, art pipeline
```

Dependency direction is strictly one-way: `app → render → sim`, and `data` is a leaf. A PR that adds an import from `sim` to anything else is wrong by construction.

---

## Commands

```bash
pnpm install
pnpm dev              # app with hot reload
pnpm test             # unit tests
pnpm test:determinism # replay 1000 ticks from seed, assert state hash
pnpm lint
pnpm validate:data    # JSON Schema check on all content
pnpm validate:assets  # palette + silhouette gate, and sheet COMPLETENESS
pnpm validate:meshes  # the same checks for art/meshes/**, rendered headlessly
pnpm validate:ui      # no colour literals AND no bare chrome strings in UI source
pnpm ui:routes        # drive the shell: one JS realm, two missions, no reload (60-74 s local, ~130 s on CI: no GPU there)
pnpm icons:units      # crop unit UI icons from the sprite sheets; --check in CI
pnpm balance          # headless battle sim, prints win rates
```

`pnpm test:determinism` must pass before any commit touching `@lions/sim`. It is the canary for invariants 2 and 3.

---

## Code conventions

- TypeScript strict mode. No `any`. No non-null assertions in sim code.
- **Struct-of-arrays over typed arrays in the sim hot loop.** No per-entity object allocation per tick — GC pauses are visible at 400 units.
- Systems are pure functions over component arrays: `(state, dt) => events`.
- Content is JSON validated against `data/schemas/`. Adding a unit means adding JSON, never engine code. If a new unit requires an engine change, that is a signal the data model is missing a concept — extend the schema.
- Tests colocate as `*.test.ts`. Combat maths requires tests; rendering does not.

### Every check gets an input that makes it fail — constructed, and run

Not "can I imagine one". Write the failing input, run it, watch the check go
red, then put it back. This is the single most expensive habit this repository
has learned, and it is not a hypothetical: one eight-task branch
(`feat/infantry-gait`, 2026-09-15/16) found **nine separate checks unable to
fail**, spread across Python build gates, vitest specs and a shipped
measurement instrument. The shapes repeat, which is why the instances are
listed rather than summarised:

- **It normalised by the very thing it measured.** `build_idle_src` yawed the
  pose by the circular mean of exactly the bearings `check_clip_semantics`
  then tested. The gate read zero for every possible input — arithmetically,
  not usually.
- **`x * 1.0 == x`.** Four of `_check_gait_identity_at_reference`'s five
  assertions. The fifth recomputed its own right-hand side.
- **It gated a residual that later code forces to 1.** The gait check was
  specified as "the post-rate-match residual sits near 1.0" — but the renderer
  computes `timeScale = entitySpeed / clipGroundSpeed`, so that residual is
  1.0 for any stride whatsoever, including none at all. It gates the
  MULTIPLIER now, which nothing normalises.
- **The "independent" oracle imported its arguments from the code under
  test.** Pointing the gait pass at the torso instead of the boot left BOTH
  declared-vs-measured tests green, because both sides shifted together. The
  oracle takes literals now.
- **It returned an empty array, and every caller looped over it.**
  `measureFacing`'s head-joint pattern matched nothing on any single-figure
  rig, so all four civilian meshes passed every assertion vacuously, in zero
  milliseconds. Not a wrong answer — an absent one, which is worse, because
  nothing looks wrong.
- **It measured one file.** `mesh_gait.test.ts` gated `mortar_team` alone, the
  file the bug was raised against, while fourteen sliding rigs shipped green
  beside it.
- **It measured one plane.** The facing gate read the ground-plane bearing
  only, so a rifle pointed 43° at the sky read as correct.
- **It measured a team and not its members.** A per-FILE gait check cannot see
  one figure of three going still while the other two walk.
- **It was a comment.** `export_meshy_sniper.py` stated that its declared
  standing height and its measured one "are asserted to agree at build time".
  No such assertion had ever been written — and behind it the exporter was
  anchoring on its own previous output, a fixed 1.02489 gain per export:
  1.670 m → 1.753 → 1.796, a sniper pair 7.5% taller than every other
  infantryman in the game, on a passing gate.

Two corollaries. **A green gate is evidence about the gate, not about the
thing it guards, until someone has watched it go red** — so a new gate arrives
with its falsification in the commit message or it does not arrive. And **the
cheapest falsification is a one-line mutation of the implementation, not a
synthetic fixture**: 31 mutations across three files, 30 red, is what "this
gate works" looked like in practice here, and the one survivor was disclosed
rather than papered over.

---

## Adding content

**A unit:** JSON in `data/units/`, validated against `unit.schema.json`, must pass `pnpm balance` within the cost-curve tolerance band, and needs a `.blend` in `art/src/` that survives `pnpm validate:assets` (including the silhouette IoU check).

**A mission:** JSON in `data/missions/`, validated against `mission.schema.json`. Must declare its ledger contract — `requires` and `produces`. Target 5–7 minutes of play, and **the schema enforces it now** — the 25 allowance for the old 12–20 Beit Sahwan missions is gone. `target_minutes` is 5–7, capped by an `if/then/else` at the schema root rather than by a plain `maximum`, because there is exactly one exemption and it is named in the schema: `beit_sahwan_0_tutorial` at 10. The tutorial is not a campaign mission (it produces no ledger keys), its length is 14 teaching steps in `data/tutorial/beit_sahwan_0.json` rather than a timer, and its `survive_until` 600s primary is a backstop that ejects a stalled player — so 10 declares the backstop. No headless instrument can measure a step machine driven by player input, so cutting it to 7 would be fitting a number to a ceiling with nothing behind it. Nothing in the runtime reads `target_minutes` at all: it is a claim, and the schema is the only thing that checks it.

**A VFX emitter:** JSON in `data/vfx/`, validated against `vfx_emitter.schema.json`. Palette keys only, never raw hex.

**UI:** colour comes from `data/palette.json` like everything else. A Vite
plugin publishes it as `--rl-*` custom properties; `packages/app/src/ui/theme.css`
is the only file allowed to name one, mapping them to semantic tokens (`--ink`,
`--bad`, `--band-mission`). Everything else uses the semantic names or the
`.rl-good`/`.rl-bad` classes. `pnpm validate:ui` rejects a hex or `rgba()`
literal anywhere in UI source, with no allowlist — use `color-mix()` for
translucency. Fonts are self-hosted in `assets/fonts/`; never a CDN.

**A map:** JSON in `data/maps/`, validated against `map.schema.json`. A character grid (`.` open, `1`–`3` cover, `#` building, `^` rock ridge, `b` boulder field) plus named markers and zones — authorable in a text editor. The loader is `parseMap` in `@lions/data`, and `applyTerrain(map, sim)` is the one way its mechanical layer reaches a `Sim` — use it rather than writing a fourth cover loop. `^` is the only blocked tile that is not a building: impassable, sight-blocking, and with no HP, garrison or ROE penalty. `b` is the only symbol whose passability depends on WHO is asking — open ground on foot, a wall to anything wheeled or tracked — and deliberately nothing else: no cover, no sight-blocking, no HP, not destructible. T1-C gave it a `boulder` decor family, and `tel_marum` is the first (and so far only) map to author any: the corridor at x=10-11, y=12-17 plus a scree apron at x=9-12, y=18. It is carried by a second blocked mask (`blocked | boulder`) rather than by `blocked`, since `FlowField.compute` already takes the mask as a parameter; `Sim.fieldFor` keys its cache by `(goal, domain)`, and on a map with no `b` the two masks are the SAME ARRAY, so no second field is ever allocated. What counts as a vehicle is `mobility.wheeled`, an authored boolean defaulting to `!FOOT_ROLES.has(role)` — **`FOOT_ROLES` alone is wrong here**, because it contains `artillery` and `rocket_battery` is a Grad on a 6x6 truck; that unit is the one place the default is overridden in JSON, and `tools/src/boulders.test.ts` pins it against `mortar_team`, which shares the role and is genuinely foot. An optional `elevation` grid gives each tile a height 0–9, one digit per tile, same dimensions as `rows`; absent means flat. It is orthogonal to the terrain symbol on purpose — a symbol table can express ridges but not valleys. E1 stores and draws it at 10 px per level; line of sight reads it — high ground sees over lower obstacles, and every blocking tile, rock or building, stands two levels above its own ground; a low-profile obstacle like a fence never blocks sight at all, but the ground it stands on still does. Since T1-A **pathing reads it too**: `FlowField.compute` takes the elevation grid and charges `UPHILL_PER_LEVEL` (tuning.ts, 10 — one level of climb costs one extra tile of ground) per level CLIMBED, while descending is free. That asymmetry is the design: high ground is expensive to attack and cheap to withdraw from. Sight RANGE still does not. Two things about slope are counter-intuitive and were measured rather than reasoned. First, **a climb telescopes**: every monotone route to a fixed height pays the same total wherever it crosses, so slope only reorders routes over ground that rises ABOVE its destination and comes back down — a rim, a spur, a hill. Second, **inverting the sign changes no route at all**; it shifts every cost by `UPHILL_PER_LEVEL * (h(tile) - h(goal))`, a term independent of the path, so the optimal-route set is untouched and only the cost NUMBER moves. The walk tests and the relief replay all pass with the sign flipped; the mirrored cost pair in `packages/sim/src/flowfield.test.ts` is the only guard on it, and that file's header carries the measurement. `costAt` is the sign's one behavioural reader, via `selectBreachTarget`'s detour test, where slope eats up to 50 of the 100-unit `BREACH_DETOUR_SLACK` on Tel Marum. Terrain needs two levels or more to obscure ground troops, since a one-level rise sits exactly at eye level, and nothing sees further for being higher — elevation affects what you can see over, never how far.

**A campaign or town arc:** design before JSON. Three design agents in
`.claude/agents/` run in order and hand to `mission-author` and `playtest`:
`campaign-designer` (premise → Mission Design Document: plot options, mission
ladder, asset manifest with every row PRESENT-with-path or MISSING-with-gate),
`narrative-designer` (the Shai/Idit two-voice briefing in beats, objective
labels, radio/EVA lines each carrying a `live | schema | engine` status, GDD
§11), and `level-scripter` (Event-Condition-Action rows in the schema's real
shapes, the AI director's cadence, in-level twists classified by what the
runtime can do, a gap report). The contract they write against is
`docs/campaign/README.md`; the story is `docs/campaign/storyline.md`; a dated
digest of what the runtime can express sits beside them. Two facts they exist to
stop anyone forgetting: the only text a mission can show is `name`, `briefing`,
`objectives[].text` and a trigger's `label` (≤ 48 characters, no full stop) --
what the player reads in the feed when it fires. An unlabelled trigger shows
nothing, `remove` triggers are silent, and `validate:data` refuses a shipped
non-`remove` trigger without one.

---

## What not to do

- Do not add a game engine, ECS library, or physics library. The sim is hand-written on purpose; determinism cannot be delegated.
- Do not add floating point to the sim, even "just for this one calculation."
- Do not let VFX, audio, or UI state influence simulation outcomes.
- Do not write mission logic as TypeScript. Missions are declarative data; if a mission needs a behaviour the schema cannot express, extend the schema.
- Do not use per-unit A* pathfinding. Flow fields only.
- Do not commit rendered sprites without their `.blend` source.
- Do not commit assets from paid packs (Synty included, even if you own a licence),
  or anything you cannot point to explicit redistribution rights for. This applies to
  audio exactly as it does to art.
- Do not ship AI-generated art without disclosing it in the PR description. Generative
  tools *are* permitted, including for assets that ship; the four `validate:assets`
  gates apply identically regardless of origin. See `CONTRIBUTING.md`.

---

## Current milestone

**M0 — done.** All four §5.7 targets pass in `pnpm balance`; the determinism hash is pinned.

**M1 — Beit Sahwan.** Three short missions, campaign ledger, ROE scoring, playable link in the README. Build order: map schema + loader → mission runtime (declarative objectives) → ledger → civilians + ROE → just-enough economy → three missions → shell UI. Design first, before code: the behaviour vocabulary (GDD §6) and the map format. No art-pipeline activation, audio, or VFX polish inside M1.

The combat model is the product. Everything else is scaffolding around it.

---

## Dev instruments
- **Hosting and telemetry (WP-T1).** The playable build deploys to Cloudflare Workers from
  `main` (`wrangler.jsonc`; GitHub Pages retired when the repo went private). The game sends
  anonymous events to `/api/events` ONLY from a production build on a real host, or with
  `?telemetry` -- never from `pnpm dev`, tests or CI, because `pnpm ui:routes` fails on any
  console error. `?tester=<name>` labels a tester, `?notrack` opts out (persisted). Results
  are read from the terminal with `packages/worker/QUERIES.sql` (`npx wrangler d1 execute roaring-lions-telemetry --remote --file ...`), still available as an alternative; `/stats` is behind a password set with `npx wrangler secret put STATS_PASSWORD` -- make it long and random (e.g. `openssl rand -base64 24`), not a memorised phrase, since a captured session cookie hands over the signing key too -- and answers 403 until that secret is set. Spec: `docs/superpowers/specs/2026-09-24-telemetry-design.md`.

- **The shell is on a router, and the screens are PATHS**
  (`packages/app/src/shell/router.ts`, Phase 1): `/` the menu, `/campaign` the
  map, `/brigade` the roster, `/free-play` the picker, `/free-play/<map id>` a
  sandbox, `/mission/<id>` a mission. **Every query URL in this file still
  works** — `?campaign`, `?brigade`, `?sandboxes`, `?sandbox=<map>`,
  `?mission=<id>` redirect onto those paths on boot and on click
  (`legacyRedirect`), keeping every bookmark, doc line and tool URL (the golden
  gate's `capture-protocol.ts` builds `?sandbox=`/`?mission=`) working — so the
  forms written throughout this file are read as written and land on the path.
  Flags ride along unchanged: `?sandbox=tel_marum&tunnel&sur` becomes
  `/free-play/tel_marum?tunnel&sur`. Two consequences worth knowing. **No screen
  spells a path**: `packages/app/src/shell/links.ts`'s `routes` is the only
  place one is written, and a same-origin anchor click is a soft navigation
  rather than a page load. And **a mission is left SOFTLY, like every other
  screen** — the HUD's leave button and the pause menu's Quit both call
  `req.navigate`, and `pnpm ui:routes` is what proves the realm survives it.
  (This file said the opposite until 2026-09-18: written during Task 1, when
  `bootBattlefield`'s disposer really was a no-op, and left standing after
  Task 2 landed the real teardown.)
- **The disposer contract, which the whole shell now rests on.** Every `show*`
  returns a `Disposer`, and the router calls it and then empties the stage —
  so **the stage's own children are the only thing the router removes**.
  Anything a screen mounts on `document.body` (the HUD, the minimap, the end
  screen, the debrief, the tutorial panel), any `window` listener, any
  interval, any renderer: the screen that made it takes it down, in its own
  disposer. `bootBattlefield` states the three rules it follows — register the
  teardown where the thing is CREATED, make it idempotent and identity-scoped,
  and consult `disposed` in anything that can still complete afterwards — and
  `onWindow`/`onAbort` exist so the add and the remove cannot drift apart.
  One thing is deliberately NOT a screen's own: a **confirm dialog** mounts as
  a sibling (on the stage, or on `document.body`) and the screen has no handle
  on it, so `confirmDialog` returns `{ answer, close }`, `ui/confirm.ts` keeps
  the one open dialog, and `Router.unmount()` and `bootBattlefield`'s teardown
  both call `closeOpenDialog()`. Skipping that left an orphaned capture-phase
  `keydown` guard on `window` that swallowed every game key for the rest of the
  session — reachable in two clicks from the main menu, and invisible.
- `pnpm ui:routes` (`tools/src/ui-review/routes-check.ts`) is the instrument
  for all of the above, and the only one: it boots its own dev server, plays
  two missions and a soft-booted third in ONE page, and asks four
  reference-free questions — does the boot counter stay at 1 (no reload), is
  `window.__lions` gone after leaving, is the body child count back to the
  menu's own, and does a LEFT mission's sim stay frozen while the next one
  ticks — plus a canvas count, which is what caught `Router.unmount`'s
  early return leaving an abandoned boot's canvas under the campaign board.
  **In CI since 2026-09-18**, in `ci.yml`'s `visual` job (which already has
  Playwright), at **60.5–73.5 s** wall clock — six runs, one machine,
  dev-server boot included, and in two clusters (73.1/73.2/73.5, then
  60.5/61.2/61.9) with nothing between them and no established cause.
- **Every chrome string goes through `t()`, and `en.json` is the catalogue**
  (`packages/app/src/i18n/`). `t('key', params)` formats ICU-style plurals and
  returns a MISSING key as itself, warning once per key per session;
  `__lionsI18n.missingKeys()` is what a test or a capture pass reads back rather
  than scraping the console. `?lang=<id>` picks a locale for the session only and
  is never written to settings; `?pseudo=1` swaps the catalogue for the
  bracketed, accented pseudo-locale, so **a plain unbracketed word in a pseudo
  capture is a string that never went through `t()`**. Two things follow that are
  easy to get wrong. **A table resolved at MODULE LOAD freezes in whatever locale
  was active before `main.ts`'s boot calls `setCatalogue`** — which is never the
  player's — so a label table uses getters or accessor functions
  (`ui/role.ts`'s `ROLE_LABEL`, `ui/grade-copy.ts`'s `tierName`/`tierLine`), and
  this has been shipped wrong twice. And **`pnpm validate:ui` runs
  `validate_i18n.mjs` as well as the palette gate, but its regex is anchored on a
  sink assignment with an adjacent quote** — a string that reaches a sink through
  a VARIABLE is invisible to it, which is how a thrown error message and the
  garage's three upgrade-track headings both shipped in English. Its own header
  names the three defect classes it cannot see; a clean run is not proof that
  nothing was missed. The pseudo capture pass is the instrument that finds them.
  **Mission TEXT is data, not chrome**: `name`, `briefing`, objective `text` and
  trigger `label` are overlaid per locale from
  `data/locales/<lang>/missions.json` (`applyMissionLocale`), gated by
  `pnpm validate:data`, and deliberately do NOT go through the pseudo transform.
  Unit names, roles and blurbs have no overlay yet and read English in every
  locale.
- **Two more `localStorage` keys, beside the ledger/account pair below.**
  `lions.settings` (`packages/app/src/settings.ts`, the only reader and writer)
  holds video/audio/controls/accessibility/language and is the only thing that
  writes `--ui-scale`, `--text-size`, `data-motion` and `data-cvd` onto the
  document. `lions.saves` (`packages/app/src/profile.ts`) holds named save slots,
  each a snapshot of all THREE campaign keys — ledger, brigade account, tutorial
  flag — because a slot carrying only the ledger would restore a campaign into
  the wrong brigade. Loading one writes the three back, in that order, with no
  transaction available to it: a storage refusal partway through is surfaced to
  the player rather than swallowed.
- **Escape opens the pause menu** (`ui/pause.ts`), and only opens it: the modal
  owns Escape from then on, and the game's own keydown handler defers
  (`isDialogOpen()`). **The sim stops and the frame loop does not** — the world
  keeps drawing under the modal while `shell/clock.ts` withholds ticks, which is
  why the pan keys are the one exemption from the modal's capture guard
  (`passesThroughModal`, `input/keymap.ts`: panning writes `renderer.camera` and
  nothing else). Objectives, a settings panel, restart and quit live in it.
- **The render quality preset** (`packages/render/src/three/quality.ts`) is
  `high` / `medium` / `low`, applied at the next mission's BOOT, not live.
  `high` is pinned to the constants that existed before the preset and every
  parameter defaults to it, so the golden baselines did not move; `low` drops
  GTAO and SMAA and halves the shadow map.
- **There are four team-colour sets, not one.** `reserved.team.variants` in
  `data/palette.json` carries a deuteranopia, protanopia and tritanopia variant
  beside the default, and the accessibility setting picks one.
  `variantAwareResolver(variant)` (`@lions/data`) is what the renderer resolves
  `team.*` keys through, and `paletteTeamColors(variant)` is the tuple — both
  read the same entry, so they cannot disagree. The HUD updates immediately; the
  map and minimap from the next mission. Before changing a team colour, read
  D-22 in `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md`: the
  default colours were measured NOT to collapse under any simulated deficiency,
  and the one variant with a relational gate buys 1.5 ΔE, below the 2.3
  just-noticeable difference.
- `pnpm ui:shots -- [--pseudo] [--res=…] [--out=…] [--port=…]` (`tools/src/ui-review/shoot.ts`) boots its own dev server and photographs every shell screen at three resolutions, and since Task 13 that walk covers settings, credits, saves, the pause menu (`Escape` in a running mission) and a scripted `debugKill`-forced defeat plus its debrief, with `--pseudo` swapping the catalogue for the bracketed pseudo-locale first.
  After each shot it also prints every element inside `.rl-menu`/`.rl-panel`/
  `.rl-garage` whose content is wider than its own box, by selector — a printed
  REPORT and deliberately not a gate, because a threshold on "how much overflow
  is acceptable" would be a fitted number and several of the hits are the design
  (an ellipsis is a decision). It prints its total even at zero, since a check
  that speaks only on a hit and a check that never ran read identically.
  **Both harnesses take their port the same way** (`tools/src/ui-review/port.ts`):
  `--port=<n>`, else `UI_SHOTS_PORT` / `UI_ROUTES_PORT`, else the default (5176 /
  5177), and a port something else already holds is REFUSED, exit 2, before any
  browser or server starts. They used to attach to whatever answered there, and
  `ui:routes`' default 5177 is also the lead's everyday dev server, so a local walk
  started while it was up walked that checkout and reported green.
  **`ui:shots` also chooses its GPU backend** (`tools/src/ui-review/gpu.ts`):
  `--gpu=metal|swiftshader`, defaulting to Metal on macOS and SwiftShader
  elsewhere, and it prints the renderer the browser actually gave it. The default
  moved on 2026-09-24 because under SwiftShader one screenshot of a live mission
  took 5.0–7.8 s, longer than the victory/defeat moment's 2.6 s hold, so
  `outcome-guard.ts` stopped every run at `25-outcome-defeat`; Metal takes
  115–164 ms. **Captures from before that date are SwiftShader and are not
  pixel-comparable with later ones** (`golden-diff/browser.ts` records 230 px /
  0.032 between the two on `quiet`), so compare a capture with one from the same
  backend.
- Browser sandbox: `window.__lions.step(n)` fast-forwards n deterministic ticks; `__lions.sim` and `__lions.renderer` are exposed. It is defined by the battlefield alone — the menu, the campaign board, the brigade and the picker define nothing, which is how a tool tells "the app booted a mission" from "the app booted".
- `pnpm meshy -- <command>` (`tools/src/meshy/`) is the Meshy text-to-3D/image-to-3D CLI — estimate before you spend, key lives outside the repo, see `docs/ART_PIPELINE.md`'s "Meshy API — generating a base model" for the full workflow and policy.
- `?sandbox=<map id>` walks **any** shipped map with a full task force placed from
  that map's own markers — no mission needed. Bare `?sandbox` still loads
  `beit_sahwan_outskirts` unchanged. Before this, checking anything visual on a new
  map meant authoring a throwaway mission and deleting it, which is how Tel Marum's
  terrain was walked. Also on `__lions`: `goto('hollow')` jumps the camera to a
  marker, `units()` lists living units with their ids and tiles, `sel([id])` sets the
  selection, and `cursorKey()` **reads back** `canvas.dataset.cursor`. That last one
  is a DOM read rather than a recomputation on purpose — the failure worth catching
  is a cursor whose logic is right and whose wiring is not, and recomputing would
  agree with the logic and tell you nothing. Since 2026-09-15 a group order lands
  in formation (`packages/sim/src/formation.ts`), so "units stack on one tile" is
  a bug again on the sandbox force, not the default outcome of a right-click.
- **The sandbox documents itself** — `__lions.help()`, and the same text prints to
  the console on every sandbox boot: the map that loaded, which flags are on, every
  flag available, every shipped map id, and the console API. An unrecognised URL
  parameter warns by name, which is the case that matters: `&tunel` otherwise does
  nothing at all, silently, and reads as a broken feature rather than a typo. The
  flag table (`packages/app/src/sandbox-help.ts`) is the single source for all
  FOUR callers — `readFlags` parses from it, `sandboxHelp` prints from it,
  `unknownParams` checks against it, and `/free-play` (`?sandboxes`), the picker
  screen in `ui/menu.ts`, builds its checkbox list from it and its launch URLs
  through `routes.sandbox` — so a flag parsed but undocumented, or documented
  but unparsed, is not expressible.
  Prefer this over grepping this file.
- The opt-in sandbox flags, each adding only what it names, so a check for one
  subsystem is not buried under four others (`&nomesh` is the one opt-OUT
  — see "Mesh units"). **This list goes stale; the table and `__lions.help()`
  do not** — it is here for the reasoning, not the enumeration. `&roe` supplies
  flagged ground (the map's own `clinic`/`hall`/`refuge` zone where it has
  one, otherwise a 4×4 synthesised midway between the two anchors); `&tunnel`
  appends a pre-dug route from the hostile side toward the friendly one and adds
  two `yahalom_squad`; `&sur` adds the four Sarim units no mission fields
  (`sarim_rifles` ×2, `recoilless_team`, `manpad_team`, `rocket_battery`);
  `&civ` puts eight civilians on the midpoint of the anchor axis and synthesises
  a refuge; `&ditch` cuts an anti-tank ditch across that axis. Combine them —
  `?sandbox=tel_marum&tunnel&sur&roe&civ` is the everything build, on the only map
  with relief. Every one is sandbox-only: a mission brings its own zones,
  tunnels, terrain and civilians, and a dev flag must never change how a real
  mission scores. The synthesised route is NOT identified by construction — a
  `mark_tunnel` carrier still has to see it, which is the mechanic the charge
  cursor depends on.
- **`&civ` walks the whole civilian loop, and the rule it walks is the mission's
  own.** `stepCivilians` and the arrival half of `evacuate_before` moved out of
  `MissionRuntime` into `packages/sim/src/civilians.ts` (`CivilianFlight`) so the
  sandbox drives the SAME object rather than a copy — the only two alternatives
  were a second implementation of a game rule in `packages/app`, or writing
  `alive = 0` from outside the sim, which invariant 4 forbids. `main.ts` calls
  `step` then `collect` at the same point in the tick the runtime does, and
  turns `collect`'s ids into the `evacuated` MissionEvent the renderer needs to
  tell a rescue from a killing. Four of the five maps declare a `civ_refuge`
  marker and that is preferred; Tel Marum declares none and falls back to the
  friendly anchor. The arrival ZONE is always a synthesised 4×4 built AROUND the
  refuge point, never a declared rectangle: `CivilianFlight.step` stops
  re-ordering a civilian standing on the refuge, so a point outside its own zone
  is a permanent hang rather than a miss. `civilians` is the one unit type with
  no `SPRITE_MAP` entry, so `&civ` under `&nomesh` or on Pixi spawns a crowd
  that draws nothing — it warns by name rather than refusing.
- **The brigade account is a second save, not a ledger key.** `lions.brigade.account`
  (`packages/app/src/brigade-account.ts`, the only reader and writer) holds credits and
  what they bought, and it SURVIVES `?fresh` on purpose (spec 2026-09-15 §4.1): a second
  campaign starts with the brigade you built. Reset it from the brigade screen, twice.
  A victory pays `creditsFor` (`packages/sim/src/credits.ts`, integer-only, never called
  by the sim) only for improvement over what that mission paid before; `pnpm playtest`
  pins the optimal ladder's total (`LADDER_CREDITS`) beside the star gates. The tutorial
  pays nothing: it produces no ledger keys, so `main.ts` gates the payout on
  `mission.ledger.produces` rather than a name list. Buying an unlock deducts and records
  `unlocks`; it writes no grant. A KDF unit's `upgrades` tracks (spec §4.3) are applied by
  `@lions/data`'s `applyUpgrades` before `addUnitType` — in the app, the playtest harness and
  the balance backtest alike — so the sim never learns a tier exists. `pnpm playtest` replays
  every plain victory at max tier and requires the outcome class to hold; `pnpm balance` and
  `validate_balance.py --max-tier` run the §5.7 targets and the cost curve at max tier too.
- Two ROE facts a visual check needs: **three maps carry `m` civic-hall tiles (`hall`, the O10 replacement; the type was `mosque` until 2026-09-06) — `beit_sahwan_outskirts` (9),
  `marj_perimeter` (4) and `wadi_halam_basin` (9), counted 2026-09-03 from the
  map rows; this line said "only `wadi_halam_basin`" until then** — so the
  protected-target X (keyed on the STRUCTURE's `roe_penalty`, `input/intents.ts`
  `isProtected`) is reachable on those three and nowhere else unless a mission
  declares `roe.flagged_zones` or `&roe` supplies one. Tel Marum's town buildings are `#`
  (`concrete`, penalty 3), so they read as the *costly* tier, not protected.
- **`qarn_hadid` is the terrain map** — the only one carrying all ten terrain
  symbols, and the only place `3` (cover 3) and `d` (the anti-tank ditch) are
  authored at all; both had ZERO tiles anywhere before it. Sandbox-only until 2026-09-07; it now carries the three Qarn Hadid missions
  (Act II's interlude between Tel Marum and Umm Zeitoun, `docs/campaign/qarn_hadid/`),
  with the arc's own sight and route facts pinned in
  `tools/src/qarn_hadid_doctrine.test.ts` beside the relief test. Its shape is one idea: a rock wall across the middle with TWO ways
  through — a HIGH shoulder gate (crest 6) near the axis and a LOW saddle notch
  (plain level) eight tiles further out — because a climb telescopes and slope
  can only reorder a route over ground that rises above its destination and
  comes back down. Measured through the real `FlowField`: on foot the relief map
  goes through the saddle (332) and the same rows flattened go through the
  shoulder (304 vs 320), and the two routes share only their endpoints. The
  relief route is two tiles LONGER, which is what makes it a reordering rather
  than a price. Tel Marum's ridge cannot show this — its relief is walls, and a
  wall is a mask, not a cost. Also carries the elevation range 0–7 (every other
  map tops out at 4), a bowl with a raised rim, and the two vehicle-only
  obstacles doing different jobs: the ditch seals the cheap gate to armour, the
  scree splits the eastern flank (foot 8 tiles, vehicle 20). All of it is pinned
  in `tools/src/qarn_hadid_relief.test.ts`, every claim against a control built
  from the same map with one thing removed. Two measured negatives recorded
  there and worth knowing before authoring relief: **a bowl 16 tiles across
  prices the ground and reorders nothing** (the detour costs more than the 50 it
  charges to climb out), and **cover 2 and cover 3 are not separable in a duel**
  — `COVER_HIT` goes 1 / .375 / .1375 / .09, so the big rung is 0→1, and over
  ten seeds a squad on cover 3 loses 40 hp where the same tile at cover 0 loses
  386 and dies in nine runs of ten.
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
  measured extent out past 1100px. **Two KDF types carry no GLB at all**
  (`attack_drone`, `recon_drone` — checked against `hasUnitMesh`, not
  assumed; `heli_peten` does have one) and the roster-driven sprite loader
  only queues a billboard sheet for a type the BOOT-TIME force already
  fields, so spawning either one cold drew nothing but a stray VFX blur on
  otherwise empty ground — fixed by calling `renderer.loadSprites` on their
  own `SPRITE_MAP` paths directly before the first spawn.
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
- `pnpm balance` runs the §5.7 backtest; `tools/src/backtest/urban-only.ts` is the fast urban-ratio calibration loop.
- The determinism golden hash lives in `packages/sim/src/determinism.test.ts`. It changes only when sim code or tuning changes deliberately — update it in the same commit and say why.
- Combat tuning lives in `packages/sim/src/tuning.ts`. §5.7 targets outrank §5 formula text.
- The renderer is behind an interface (`packages/render/src/api.ts`), and `main.ts`
  holds it by that type, so the compiler — not a grep — is what keeps `app` off
  backend-only members. Projection is asked for (`renderer.worldToScreen`) rather
  than recomputed: the arithmetic lives in `project.ts`, pure and tested, and is
  **not** exported from the package. `TILE_W`/`TILE_H` are, as layout constants.
- ~~`touch packages/app/src/main.ts` after adding an asset~~ — **not needed any
  more, and nobody should be told it again** (GH-147, fixed 2026-09-01). Every
  agent on this branch was passed that workaround by word of mouth; it never
  appeared here. What it worked around: `main.ts` names meshes by template
  (`new URL(\`../../../art/meshes/${id}.glb\`, import.meta.url)`), Vite rewrites
  that at TRANSFORM time into an `import.meta.glob` and bakes the directory
  LISTING into the module. Vite invalidates that listing on a file add — but only
  from a watcher event, and its watcher covers `[root, configFileDependencies,
  env files, publicDir]`, which for this app is `packages/app` and `assets/`.
  `art/` is in neither, so a new GLB was invisible: the missing key gave
  `undefined`, `new URL(undefined, …)` resolved to `/src/undefined`, the SPA
  fallback answered with `index.html` at HTTP 200, and the app died on
  `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON at
  GLTFLoader.parse` — a JSON error, in a mesh loader, naming a file nobody
  touched. `packages/app/vite-plugin-asset-watch.ts` now puts those directories
  under the watcher and Vite's own invalidation does the rest. It DERIVES them
  from the source rather than listing them, because a hand-kept list of asset
  locations is the `SPRITE_MAP` failure mode and would go stale the same silent
  way. Two consequences worth knowing: a running browser now reloads by itself
  when a GLB lands, and the six watched directories are printed at `pnpm dev`
  boot, so "is my new mesh's directory covered?" is answered by the banner.

---

## The three.js backend

**The default since Phase D.** Pixi is the escape hatch (`?renderer=pixi`), not
the baseline. The seam is `packages/render/src/api.ts`, and `main.ts` holds a
`Renderer`, never a concrete backend — so the compiler, not a grep, keeps `app`
off backend-only members. Both backends arrive by dynamic import from their own
entry points, so a player downloads only the one they run.

Two constraints that were true DURING the migration and are worth restating now
they can be misread. `renderer.ts` was frozen per phase so the cross-renderer
diff had a fixed reference; with the flip done, that freeze is no longer
load-bearing and unfreezing it is a decision someone should make deliberately
rather than assume. And **VFX no longer owe Pixi parity at all** — three-only
effects are the intended end state.

**Design and outcomes** are in `docs/superpowers/specs/`: the migration design
(`2026-08-26-three-renderer-design.md`), the palette GO/NO-GO
(`2026-08-26-phase-0-verdict.md`), phase outcomes B1-B4, the rigged-infantry
design (`2026-08-28-rigged-infantry-design.md`), its verdict
(`2026-08-28-phase-r0-verdict.md`), and the pinned mesh contract
(`2026-08-28-mesh-unit-contract.md`). Read the outcome doc for the phase before
yours; each one records what the next phase inherits.

**Rules specific to this backend, each of which has already cost a bug:**

- **`three` may only be imported under `packages/render/src/three/**`**, enforced
  by eslint. Note the rule's `paths` entry does NOT catch subpath imports like
  `three/addons/loaders/GLTFLoader.js` — keep those inside by discipline.
- **The colour pipeline is the standard one since Phase 0 (2026-09-14).**
  `renderer.outputColorSpace = SRGBColorSpace`, ACES tone mapping at exposure
  1.0 applied in the composer's `OutputPass`, and every world material a
  `MeshStandardMaterial` (`units/world-materials.ts`, and `terrain/mesh.ts`'s
  `GroundMaterial`/`GroveMaterial`). One sun plus one hemisphere bounce in
  `lighting.ts`, with a 4096² map-wide orthographic shadow box fitted once per
  map. **The sun is a SIDE light — `SUN_DIRECTION` `(-0.406, 0.819, 0.406)`,
  the render rig's stated azimuth 135° at altitude 55°, which is the CAMERA'S
  LEFT** (the camera sits at 225° in `dimetric.py`, so its right-hand vector
  points at 315°). The X and Z signs DIFFER and that is the point: a box's
  screen-left face is lit, its screen-right face falls to hemisphere light
  alone, and shadows land on the ground beside a caster instead of straight
  up-screen inside its own silhouette. Do **not** re-derive it from
  `build_lights`' lamp — `rotation_euler = (90−55, 0, 135)` yaws a beam
  already tilted toward `+Y` and puts the light source at 45°, behind the
  subject; that rig convention bug is why every sprite sheet has a bright top
  over two equally dark sides (`BLD_WALL` is `limestone.0` on top and
  `limestone.7` on BOTH flanks, identical to the byte). Settled by the project
  lead on 2026-09-15; `lighting.ts`'s header and the spec's Deviations entry 3
  carry both retired alternatives with their measurements.
  The frame goes through `post-chain.ts`: `RenderPass → FogOfWarPass →
  WorldGTAOPass (half resolution) → OutputPass → SMAAPass`. Fog of war is
  `shroud-texture.ts` + `fog-pass.ts` — a depth-reading post pass, not
  geometry. A muzzle flash is a pooled `PointLight` (`units/flash-light.ts`),
  not a ramp-index shift. `applyPalettePipeline`, `paletteColorNoConvert`, the
  toon ramp materials, the blob shadows and the black fog quads are all
  deleted. Ground decals (`decal-pool.ts`) are albedo RATIOS: each decal's
  colour is divided by the ground tone under THAT FRAGMENT and MULTIPLIED
  (`DstColor * SrcColor`) onto the lit ground, so a crater lip in a building's
  shadow stays in shadow. The divisor has two halves: the tile's own palette
  tone, stamped per decal (`terrain/decal-ground-tone.ts`, `decalBaseTone`),
  and the road and its shoulder, mixed in PER FRAGMENT from the ground's own
  control B through the ground material's shared uniform objects (fix wave
  I-3; `decalRoadMix` is the TypeScript mirror). Dividing by the map's one
  open tone was wrong on every green map (a salmon lip on a dust road, red
  tyre prints on grass); dividing by the road at a crater's CENTRE was wrong
  on every road crater, because the lip ring (0.34-0.60 tile out) lies on the
  road's edge and shoulder -- it drew blue-white, blue multiplied eightfold.
  A decal straddling two TILE tones still divides both by its centre tile's;
  that part is accepted. A pale mark is a ratio above 1, so decals need the composer's
  **HalfFloat** scene target; **the raw-renderer path without the composer is
  not supported** -- an 8-bit target clamps the source to 1 and every pale lip
  disappears.
  **Two rules survive and both still cost a bug if broken.** Vertex colours
  and shader-uniform colours must be LINEAR — `hexToLinear`, and `toGeometry`
  decodes on the way in — because nothing between them and the frame buffer
  will decode them for you. And **ground albedo textures stay `NoColorSpace`**
  while every base-colour map in the game is `SRGBColorSpace`: they are not
  colours, they are a ratio to their own measured mean
  (`terrain/surface.ts`'s `SURFACE_SHADING_EXEMPTION`), and decoding a ratio
  bends the mean it is taken against.
  **The per-pixel palette guarantee is retired, deliberately.** It was never
  protecting much: measured on `main`, a real frame was **24.5%** exact
  palette colours at the force close-up and **11.3%** in a town fight, across
  29,705 and 52,227 distinct colours against a 56-entry palette — so a rule
  that forbade antialiasing, blending, lights, shadows and tone mapping was
  costing the other 75–89% of the frame everything a lit renderer needs. The
  argument and the nine captures are in
  `docs/superpowers/specs/2026-09-14-lit-renderer-design.md`; the palette is
  still the source of every AUTHORED colour (`docs/ART_PIPELINE.md` §2), and
  `pnpm validate:ui` and `pnpm validate:assets` are unchanged.
- **`units/render-order.ts` is the single source of truth for every
  `renderOrder`.** Read it before setting one. Bands are: **-1 world (mesh
  buildings)**, 0 hull/structures, 1 turret, 1.5 badge numeral, 2 FX,
  2.5 FX additive, 3 FX-above, 3.5 FX-above additive, 4 overlays, 5 smoke,
  **6 occlusion silhouette**, 7-9 reserved. **Band 10 is retired** — fog of
  war was `FogMesh`, one black quad per unseen tile at the top band, and it is
  a post pass now, so nothing in the scene draws at 10 and "must sit below the
  fog band" no longer constrains anything. The overlay tier still sits where
  it does because Pixi's `unitsG` is added to `world` before `fogG`; an
  earlier version of that file said the opposite, citing Pixi
  identifiers that do not exist. Band -1 is the only one whose value changes
  anything for an OPAQUE mesh, where the depth buffer normally makes
  submission order irrelevant. It was added for the occlusion silhouette's
  stencil mask, back when that silhouette was a solid FILL and a unit body
  stamped the mask only where its fragment WON the depth test -- true only
  once the world had already drawn, and three.js sorts the opaque queue by
  `material.id` BEFORE `z`, so at band 0 the draw order between a unit and a
  building was decided by which GLB finished loading first (measured on
  `beit_sahwan_outskirts`: unit materials 164-167, building materials
  246-250, so units drew first and a tank behind an apartment silhouetted as
  a few slivers). **The outline retired that dependency**: the mask now means
  "a unit's footprint covers this pixel" and is stamped on `stencilZFail`
  too, so no draw order can falsify it. The band stays -- still correct,
  still free, still where a future opaque occluder belongs -- but it is no
  longer load-bearing.
  **The ground decals have two named aliases, not bands of their own.**
  `DECAL_PERSISTENT_RENDER_ORDER` = `WORLD_RENDER_ORDER` (-1) carries
  craters, scorch, oil and rubble; `DECAL_FADING_RENDER_ORDER` =
  `TRAIL_RENDER_ORDER` (= `HULL_RENDER_ORDER`, 0) carries tread and tyre
  prints, so a fresh print lies over an old crater and never over a unit.
  Set them by those names: a "fix" that moves either into an FX band paints
  the mark over the unit standing in it.
- **The occlusion silhouette is an OUTLINE, not a fill** (`units/silhouette.ts`).
  An inverted hull -- the merged silhouette geometry pushed out along a welded
  per-vertex normal by a constant 2.5 SCREEN pixels at any zoom -- with the
  interior punched out by the footprint stencil above. Three things about it
  are counter-intuitive and were each measured, not reasoned. `side` must be
  `BackSide` on the mesh path: `FrontSide` only widens the silhouette where a
  face's normal is perpendicular to the view, which is a razor-thin set of
  grazing triangles half of which are culled, and it photographs as broken
  squiggles rather than an outline. The width must be constant in PIXELS, not
  world units, because `main.ts` clamps zoom to 0.35-2.5. And it is applied in
  the GLB's own object space, so it needs multiplying by `MESH_UNITS_PER_TILE`
  to undo `MESH_SCALE` -- forget that and the outline is a third as thick as
  asked for, which looks plausible and is wrong. Billboards have no hull to
  invert, so that path dilates the atlas alpha instead. Costs no extra draw
  call over the fill: measured +24 on 310, both ways.
- **Every shot that is one round draws a travelling projectile; only a STREAM
  keeps the flat tracer.** `units/shells.ts` is the whole model and it now
  serves both halves — `mortar`/`rocket` arc (GH-145), and since GH-149
  `bolt` (`apfsds`, `autocannon`) and `missile` (`atgm`, `rpg`, `heat`) fly
  the same streak with no arc and a much shorter trail. `small_arms` and
  `hmg` deliberately keep `TracerBatch`'s full-span ribbon, which is right
  for a rifle burst and was wrong for everything else. Three things about
  this are worth knowing before touching it. **The flat tracer was never
  absent from direct fire** — the complaint "direct fire has no visible
  projectile" is literally false and substantially true: photographed at
  `ad7ac3d`, a Lavi's `gun_120` drew two dead-straight lines that spanned the
  whole gap on frame 0, did not move for seven more frames, and faded. It was
  a laser that dimmed. **The brief's "~4 frames" was argued down with a
  frame-for-frame A/B and the shipped bolt lives ~13** (30 tiles/s over the
  6.7-tile engagement range measured on `beit_sahwan_outskirts`): at 4 frames
  the streak is longer than its own travel, so it reads as one shape that
  flashes — the identical failure, shorter. **There are two `ShellBatch`
  instances**, and they differ in exactly three things, none per-shell:
  `depthTest` (off for the arc, which flies 88 lift px up and was measured
  drawing behind a one-storey house; ON for a bolt at 9, where a building in
  front SHOULD hide it and cannot be in the way anyway, since direct fire
  needs LOS), the band (3 vs 2), and the colour pair. Which one a round goes
  to is `SHELL_PROFILES[kind].indirect`, read once through `isIndirectShell`.
- **An arcing round is `vfx.fire`/`vfx.ember`, not `vfx.tracer`** — the new
  `RendererOptions.shellColors`, three-only, ignored by Pixi. A landing
  mortar bomb or Grad rocket also throws `data/vfx/shell_impact.json` through
  the same `spawnCollapseFx`/`mesh_burst` path a building collapse uses, at
  `impactPower` 0.3/0.45. That fires off the FRAME clock (`shellHasLanded`),
  deliberately not off the sim's own `impact` event, which resolves on a
  different clock and would put the fireball where the bomb visibly is not.
  Note `screen_shake` in `vfx_emitter.schema.json` is still read by nothing —
  `emitters.ts` types it and no backend consumes it.
- **Overlays scale with zoom, and that is faithful.** Pixi scales its whole
  `world` container by `camera.zoom` and the overlay layer is a child of it, so
  HP bars look enormous zoomed in on BOTH backends. Verified side by side. Not a
  bug; changing it is a decision affecting both.
- **The ground is SMOOTH since 2026-09-03, and the sim never noticed** (`terrain/ground.ts`,
  `terrain/surface.ts`). It was flat terraces by design -- corners never interpolated, vertices
  never shared -- for two reasons that are both retired: Pixi parity (report-only since
  2026-09-02) and the palette guarantee, which the project lead had already overridden three
  times. Open ground is now **Catmull-Rom bicubic over tile CENTRES**, not corners: corner-bilinear
  is a low-pass, and a lone level-3 tile would draw at a quarter of the height the sim charges a
  climb for. Centres make the surface pass through every authored level exactly, so what the
  player sees and what `FlowField` prices agree. **A tile is a terrace iff `blocked[tile] !== 0`**
  -- the sim's own mask, so `^` ridges and building pads stay cliffs while `b`/`d` ramp, because
  infantry walks them. **The sim reads only the integer grid** (`flowfield.ts:149`, `sim.ts:2165`)
  and is untouched: determinism hash, `playtest` (byte-for-byte) and `balance` all unmoved -- this
  is the spatial twin of interpolating units to 60 fps while the sim ticks at 20. Units, decor,
  fog, smoke and trails all sample the drawn surface through `ground-height.ts`; three of those
  were found sampling a tile CORNER and fixed. Cost: +0 draw calls, +1.87% triangles, fixed per map.
  Open ground carries the supplied **sand** PNG (4 tiles per repeat), `^` walls the supplied
  **rock** PNG (2 tiles), both `NoColorSpace` and plain `RepeatWrapping` -- **never mirror-tile
  them**, it kaleidoscopes -- with roads (`r`) drawn by the control map's distance field (next
  bullet), not masked out as they were. Terrain is the fourth named palette
  exemption, and **since 2026-09-14 only its ALBEDO half survives**: the ground is lit and
  shadowed by the scene sun like everything else, so the *shade* is not an exemption from
  anything any more (`terrain/surface.ts`'s `SURFACE_SHADING_EXEMPTION`, and the paragraph
  `pnpm validate:assets` prints). The albedo is still exempt, on all open ground and on `^`,
  because it is a ratio to each image's own mean rather than a colour -- which is also why these
  six textures alone stay `NoColorSpace`. Two things worth knowing. **For a texture, the image fed to Meshy
  is the asset, not the model it produces** -- `art/blend/desert tile/`'s `.blend` bakes a
  scrambled UV atlas that tiles as noise, while the PNG beside it measured seamless (edge/adjacent
  ratio 0.95x). And **`groundTextureCheck` was structurally inert and is now
  deleted** (2026-09-03): textured ground is never one flat colour, so the `open-ground` crop read
  0.2330 / 6,721 distinct colours against a `<0.95` budget and the gate's only reference-free check
  could no longer fire on the defect class it was built for, or on anything, while printing PASS.
  What replaced it is the visible-toggle A/B — see the visual-gate bullet below.
- **The ground reads a CONTROL MAP, not per-vertex masks** (WP-A2 plan 1, 2026-09-25;
  `terrain/control-map.ts`, spec `docs/superpowers/specs/2026-09-25-ground-design.md`, whose
  Deviations R-1 to R-21 are the record). Two RGBA8 textures at `CONTROL_TEXELS_PER_TILE` = 8
  texels a tile: A holds open, rock, scrub and grove weights; B holds knoll, road distance,
  junction distance and the road-edge bend noise (R-6), all baked in TypeScript, so the GLSL is
  arithmetic and every number in it is unit-tested. Soft edges are a 0.5-tile band (D1: 1.5
  smeared a lone cover tile past recognition), bent ±0.2 tile by noise. A 256² R8 macro field
  (±7% luminance, ±0.04 hue) lies over it. Four things a later change will get wrong:
  **`wallAlbedo` is the ONE per-vertex surface fact left** (R-5): -1 on every top (sample the
  control map), 0 on a building wall, 1 on a ridge wall. A vertical face sits exactly on a texel
  boundary, so the map cannot tell the two walls apart. **Terraces stay hard**: a pad and a `^`
  top are never blended. But a ridge throws a 0.5-tile rock APRON onto the open ground beside it,
  never the reverse. Pads keep a hard edge on purpose (R-4, the rest of G3 is plan 2's).
  **Road tone lives in the shader** (R-3): a road tile's VERTEX colour is the open wash, and the
  road tone is mixed in by the distance field. Put the road tone back in the vertex and the SDF
  road steps at every tile edge again. A street authored two tiles wide is ONE street (2x2 road
  blocks are solid, and ladder rungs are not junctions); three-wide is unhandled, and no map has
  one. **Road grain shares `uKnoll`** (R-7) at its own 2-tile repeat and 0.6 gain. There is no
  road image any more; `road_track_tile.jpg` is still on disk and in `GROUND_ALBEDOS`, waiting
  for its own deletion task. Cost, measured on ANGLE/Metal M3 Pro at `64afcf3b`: **+0 draw calls
  on every view of four maps**, texture count +2 (A, B and macro in; the road image out), and
  **1.58 MiB** a 48x48 map with mips (A and B 768 KiB each, macro 85 KiB). `buildControlMap`
  costs ~50-68 ms a call, and **it runs only when what it reads changed** (fix wave I-1,
  `controlInputsMatch`): the decor array by reference, the draw mask and `cover` by CONTENT.
  Both halves of that are load-bearing -- `drawBlockedMask` returns a new array every call, so a
  reference compare never matches, and `sim.cover` is written IN PLACE when a structure dies, so
  a reference compare always does. A boot fires 3-5 terrain rebuilds (templates, decor sets,
  `setElevation`) and now builds the map once; a structure collapse still pays a full build,
  and a dirty-rect rebuild is the follow-up. See `docs/PERFORMANCE.md`, "The ground, plan 1".
  **The road block in the ground shader is skipped where control B saturates**
  (`if (rlB.g < 1.0)`): there every road term is exactly 0, the golden A/B read 0 px, and its
  grain tap is a `textureGrad` whose derivatives are taken OUTSIDE the branch. Keep them there.
- **Ground decals are ONE pool class, two instances, on the SIM clock** (`decal-pool.ts`, the
  pure maths in `decal-maths.ts`). Persistent: 1024 stamps on a 4x4 grid (crater, scorch, oil,
  rubble). Fading: 4096 on 2x2 (tread, tyre). Both share one material and one program, and the
  oldest stamp is evicted (R-10). At full pools that is exactly **26,624 triangles and 2 draw
  calls**, measured. `ScorchDecalMesh` and `VehicleTrackMesh` are gone and their calls with them,
  so the net is +0 (R-11). Four rules. **`stampGroundDecal` is the one entry**: a shell landing
  (`shellHasLanded`), a vehicle kill (scorch plus oil) and a structure collapse (rubble, R-12)
  all go through it. It refuses a terrace centre (R-19) and routes by kind. **Age is sim time**
  (R-14): a stamp is dated `tickCount x 50` ms, and a frame presents `(tickCount - 1 + alpha) x
  50`. So a frozen gate frame never fades, and wall-clock fades would make `quiet` noisy.
  **`&decals` is the showcase** (R-16): `RendererOptions.decalShowcase` stamps every kind at
  three sizes on a flat, a road and a relief site, dated 0 ms, through the same entry. It is
  sandbox-only, and a mission never sees it. The option names the sandbox FORCE's anchor, and
  the showcase sits CLEAR of it (`showcaseAnchor`, fix wave I-2): every site at least
  `SHOWCASE_CLEAR_TILES` (10) from the force, as near as that allows, with the most kinds the
  map offers -- on `qarn_hadid` road (30,28), relief (34,31), flat (38,36). It used to sit on
  the force, under fourteen idle mesh units and the fight the drone started, and that frame
  moved 519-656 px between two captures of the same commit. The search costs ~50-60 ms, once.
  **`decal-maths.ts` is three-free** (F-27), and that is TIDINESS, not a requirement: `three`
  loads under node (`decal-pool.test.ts` builds meshes there, and tools resolves it through
  `packages/render/node_modules`), so nothing breaks if it slips. `decal-maths.test.ts` pins its
  direct imports.
  **Rubble is chips, not cells** (fix wave I-5): at most one soft, jittered disc per
  `RUBBLE_CELL_TILES` (0.1 tile) cell, the lattice turned by `2 pi seed`, thinned by the chip
  centre's radius from 0.55 r to the rim. The first cut filled whole 0.34-0.5-tile squares in a
  hard step, and on grass, where the ratio divides by the grass tone, it drew a checkerboard.
  The GLSL hash (`rlHash`) takes its multipliers AND its two shifts from `tile-hash.ts`'s own
  exports, which `tileHash` itself reads. **Tread is `dust.5` on every theme** (spec §5): the
  ground's road ruts are `limestone.6`, and the theme's `rut` tone is `dust.6` on green -- the
  old comment that called tread "the SAME rut tone" was wrong twice. **A stamp uploads its own
  slot** (`addUpdateRange`, M-1) rather than the pool's 0.64 MiB of dynamic attributes, and both
  pools index in 16 bits: 1.81 -> 1.65 MiB of buffers for the two.
  The AO pre-pass and the shadow pass never see a decal. This is by omission: the pool geometry
  has no `normal` attribute, so `isAoOccluder` drops it, and `castShadow` is false. **Proved on
  the real renderer**, by counting `renderBufferDirect` per object over one frame with the shadow
  map forced: each pool draws **1** time, the ground 2 (main + AO), and a shadow caster 3.
  **The sag lift is capped at 0.08 wu (`DECAL_LIFT_CAP`, F-23), and clipping remains.** Between
  vertices the grid is flat triangles, and over a bicubic crest the chord passes under the
  ground. Each vertex is lifted by the largest sag of its cells, up to the cap. Uncapped, it
  floated over units standing in the mark, and darkened a squad by p90 16 grey levels (8 capped).
  Measured on 2026-09-25 by `writeDecalGrid` over every non-terrace centre on a quarter-tile
  lattice, against the drawn surface, on `qarn_hadid` (level 0-7). Where every grid vertex is on
  open ground: craters 0; mortar scorch (r 0.876) 0.025 wu worst, 9 centres over 0.01; Grad
  scorch (r 1.07) 0.067; full-power scorch (r 1.6) **0.203 wu**, 3,749 of 22,464 centres over
  0.01, photographed as a straight cut edge at zoom 2.5 (`tel_marum`: 0.170). With no wreck
  over it, that cut reads as a pale, hull-shaped patch inside the scorch on tel_marum's steepest
  shoulder (review capture 16) -- the one clipping the approved cap leaves. **A grid vertex
  over a terrace or off the map samples the SMOOTH field** (`decalGroundY`, fix wave I-4): the
  drawn ground on open tiles, the field `buildTerrainSurface` fills in under a terrace, and the
  edge-clamped field past the rim; the decal shader discards what hangs past the edge. Holding
  the terrace vertex at the centre's height cut under a ridge-foot apron by 0.62 wu, and the old
  off-map 0 dived 0.38 wu on qarn's rim. Re-scanned on `qarn_hadid` at the fix: terrace class
  full-power 0.624 -> 0.202 wu (now the open-ground cap's own limit), Grad 0.520 -> 0.067,
  mortar scorch 0.433 -> 0.025, craters 0.21 -> 0; edge class 0.353 -> 0.043, craters 0.376 -> 0.
- **`preserveDrawingBuffer` must stay off** in shipping code. Canvas readback
  therefore returns black — that is correct, not a broken renderer. The
  sanctioned way to photograph the scene from inside the renderer is a RENDER
  TARGET readback (`ThreeRenderer.photographGround`, shell Phase 2 Task 15:
  render into a `WebGLRenderTarget`, resolve it through three's own
  `OutputPass`, and `readRenderTargetPixels` it) — a different buffer, always
  readable, and it needs no `preserveDrawingBuffer` at all.
- **The visual gate is three-vs-three against a committed baseline**:
  `pnpm golden-baseline` (`tools/src/ci/three-baseline-gate.ts`). Playwright
  captures three.js at a fixed scenario/tick/camera and diffs it against a PNG
  in `tools/golden-baselines/<envKey>/`. It runs in **ci.yml's `visual` job on
  every PR and every push to main** — **39.2–40.0 s** wall clock for what were
  then **five** scenarios including booting its own dev server and running the ten
  reference-free toggle checks (34.1–35.4 s without them; 3 runs each, same
  machine, 2026-09-03 — the 32.0–32.9 s this line used to carry predates them;
  NOT re-timed since the sixth scenario, `aftermath`, and twelve more checks landed)
  — plus a nightly that files a GitHub issue on failure. **Six scenarios since
  WP-A2 plan 1 (2026-09-25)**: `quiet`, `open-ground`, `vehicle`, `relief` and
  `aftermath` vote; `combat` is report-only. Read
  `tools/src/golden-diff/baseline.ts` before touching a threshold; the things
  below are counter-intuitive and every one was measured.
  **`meanAbsChannelDelta` is the PRIMARY metric and pixelmatch's pixel count is
  the secondary one**, which is the reverse of how a golden-image gate is
  usually written. Colour here is quantised onto a palette, so a real
  regression moves a wide area by ONE palette step — 19/255 for the stone-grain
  scatter defect — which is under pixelmatch's 0.1 perceptual threshold.
  Re-injecting that defect into HEAD and capturing gives **`diffPixels` 0 and
  `meanAbsChannelDelta` 0.3519** on the open-ground crop. A gate written the
  usual way sees nothing.
  **Baselines are keyed to the capture environment and that is not tidiness.**
  Same machine, same commit, SwiftShader vs ANGLE/Metal: 230 px / 0.0320 on
  `quiet` alone, ~100x that scenario's run-to-run noise and enough to swallow
  the defect's own 0.0493 signal. A missing baseline for the current
  environment is **exit 3**, a distinct code, never a silent pass. A baseline
  still has to be blessed per environment, and CI's must be created by the
  `visual-baseline-bless` workflow, which **commits to `main` directly** — it
  opened a review PR until 2026-09-02, so nothing now looks at the picture
  before it becomes the reference — but the reason is no longer "we do not
  know whether a capture even works there". **Cross-OS CAPTURE is measured now
  and it works**, which retires the "unmeasured" this line used to carry: on
  `ubuntu-latest` (run 33591712714, 2026-09-02) all four gated scenarios
  captured cleanly on `linux-x64-swiftshader` in ~35 s wall clock, and
  `open-ground`'s then-reference-free `groundTextureCheck` read `fraction 0.9363
  (budget <0.95), distinctColors 9 → PASS` there against macOS's own 0.9363
  (that check is retired now — see the toggle bullet below).
  **Cross-OS EQUIVALENCE of the pixels is measured too, as of the lit
  renderer's Linux bless** (2026-09-15, run 34920932471, the first time a Linux
  capture was diffed against the macOS baseline at the same commit): quiet
  0.3146 / 42,781 px, open-ground 0.2899 / 41,569, vehicle 0.3056 / 16,602,
  relief 0.2965 / 58,301 — mean |channel delta| over 255 and non-identical
  pixels of a 1400x900 frame. The same picture, visibly and by number, and
  still an order of magnitude and more above every scenario's magnitude
  threshold (0.0039–0.02), which is exactly why the per-environment key stays.
  That workflow **could not create the first one**, which made the whole gate a
  green-ticking no-op on CI: its `git diff --quiet -- tools/golden-baselines`
  guard reports only TRACKED changes, and a first bless on a new runner writes
  an entirely UNTRACKED directory, so the step printed "Baseline unchanged" and
  opened no PR. Fixed with `git status --porcelain -uall`; if you touch that
  guard, remember `git diff` cannot see a new file.
  **What votes with no baseline is the VISIBLE-TOGGLE A/B, and it replaced a
  check that had gone structurally inert.** Hide a named draw layer, repaint
  with zero elapsed presentation time, capture, and require the frame to change
  by a calibrated floor — `BaselineSpec.layerChecks`, with the renderer seam in
  `packages/render/src/three/debug-layers.ts`. Since WP-A2 plan 1 there are
  **22 checks**: `quiet` 8 (`scatter`, `decor`, `ground-albedo`, `roads`, `macro`,
  `buildings`, `vignette`, `skirt`), `open-ground` 4, `vehicle` 1 (`units`),
  `relief` 5, and `aftermath` 4 (`decals`, `roads`, `macro`, `scatter`). **`macro`,
  `roads` and `decals` are new, and `scorch` is gone** (removed, not aliased, R-17:
  `decals` hides both pools). Hiding `ground-albedo` zeroes only the slot
  strengths. The scatter TONE backdrop hides `ground-albedo` AND `macro`, because
  the macro field alone blinded the tone check to the scatter defect (0.93/0.97
  with the defect; 0.58/0.65 with the macro at 0). `macro` votes only where the
  pure field predicts a real signal over the crop (F-18): `quiet`, `open-ground`
  and `aftermath`, and not `relief` (0.181). Re-run F-18 if the field's period or
  seed changes. Every new floor is a third of the smallest of three runs. It is texture-proof by construction: it never asks what the frame
  looks like, only whether removing a layer changes it. That is exactly what
  `groundTextureCheck` could not survive — it asked how much of a ground crop
  was one flat colour, the sand tile landed, and the answer became a permanent
  0.2330 against a `<0.95` budget. **A reference-free check that asks about
  appearance can be blinded by content added later; one that asks whether a
  layer contributes cannot.**
  **`aftermath` is the gated scenario that sees the ground remember a battle**
  (`AFTERMATH_SCENARIO`, `capture-protocol.ts`): `qarn_hadid&decals` at the
  showcase centroid (34.5,32), zoom 2.2, tick 300, with NO drone order -- the
  force's own sight lifts the fog there. Every stamp is dated 0 ms, so the
  pinned tick fixes the fades. **Its frame has no unit and no live effect in
  it, and that is the whole point** (fix wave I-2): at Task 17's framing, on the
  sandbox force at zoom 1, two captures of one commit differed by 519-656 px /
  0.040-0.047 against a 40 px / 0.004 budget, because idle mesh units and the
  fight the drone started animate on the FRAME clock, which `step()` advances
  by a latched real frame time that differs per process. The showcase now sits
  clear of the force and 22 of 22 fresh-process captures read 0 px / 0.0000
  against a provisional baseline; every layer reading is bit-identical over 23
  runs. Zoom 2.0 still took in the force's west edge (390-500 px). Do not
  frame units back into it, and do not raise its thresholds. A missing
  `aftermath` entry in an EXISTING manifest is exit **1**, not 3, so CI's
  `visual` job stays red until the post-merge bless. That is intended.
  **`DEBUG_LAYERS` still carries one name no gated scenario can judge, because
  none contains a blast.** `blast-light` (WP-A1.2) names the pooled
  `FlashLightManager` that a vehicle kill and a shell impact throw. `vehicle`
  parks the sandbox force at tick 140 with nothing dying and no round in the
  air, and `combat` is `gated: false`, so a `layerChecks` entry would read 0 px
  on a perfectly healthy tree. (`decals` had the same problem as `scorch` until
  `aftermath` gave it a showcase.) What witnesses them instead is `pnpm blast:capture`
  (`tools/src/perf/blast-captures.ts`), which runs the SAME toggle A/B on a
  frame 200 ms after a detonation and holds it to floors derived the same way
  (a third of a measured signal, with the sample size beside it). It has
  already earned itself: `blast-light` read **0 px / 0.0000** on every kill
  subject and the cause was an emitter nobody had registered — see "Mesh
  units". The rung is PER LAYER there and that is measured too: a light lives
  500 ms and must be caught at 200, while a scorch mark spends its first second
  under the fireball and reads 0 px / 0.3423 at 200 against 7251 px / 1.4411 at
  2000. A gated `blast` scenario here is the thing that would let this gate see
  the package at all, and it does not exist yet.
  **The blast harness waits for a STEADY loop, not a fixed time** (2026-09-25).
  It waits for 5 consecutive frames of 150 ms or less, with a 30 s ceiling
  (`SETTLE_STEADY_FRAMES`, `SETTLE_STEADY_MAX_FRAME_MS`, `SETTLE_TIMEOUT_MS`;
  `--settle-ms` overrides the ceiling). The old fixed 2500 ms settle froze the
  loop inside the boot tail on BOTH main and the branch: a 511–942 ms `step(1)`
  latch, which the harness's own guard then skipped, so the subjects that set
  the floors went unmeasured. `qarn_hadid` steadies at 190–233 ms and runs to
  the ceiling, so `scorch_qarn_shoulder` is `handTick: true`, and its stale
  `blast-light` exemption is deleted. **A settle that hits its ceiling
  refuses the group** (`unsteadySettleRefusal`) unless every subject in it is
  `handTick`, and the run fails at the end, exactly as an overshooting
  `step(1)` does -- it used to be only logged, so a scene whose frames were all
  180 ms timed out and still passed.
  Both documented defects now exit **1** with an
  empty baseline directory: erasing every decor object (`decor-place.ts`'s
  `familyFor` → `return null`) drives the `decor` toggle to 0 px / 0.0000 on all
  three scenarios (floors 4700/0.4, 300/0.15, 12800/0.92), and the scatter
  no-op fails the `scatter` **tone** check.
  **The scatter no-op is a colour regression, not an erasure, and the plain
  toggle cannot see it** — measured, not assumed: hiding `scatter` on
  `open-ground` moves 4610 px / 1.6858 clean against 4067 / 1.5393 defective, a
  9% dip no honest floor separates. What separates them is a ratio of two
  footprints of the same layer: over textured ground every mark shows, including
  one whose colour has collapsed into the ground's own tone (a flat mark still
  flattens the texture); over the FLAT palette tone (`ground-albedo` hidden,
  which is the material's own 404 path) only a real tone difference shows.
  Clean 0.9306 / 0.9544 / 0.9377, defective 0.5927 / 0.6938 / 0.6359, floor 0.8
  in the gap.
  **Floors are one third of a measured signal, not a guess, and they are not
  per-environment.** All ten layer deltas are bit-identical across five
  consecutive full-gate runs (the scene is frozen; the two photographs differ
  only by the toggle), and ANGLE/Metal — a rasteriser difference worth 230 px
  against a stored baseline — moves them by under 2% bar one (`relief`
  `ground-albedo` pixel count 1015 → 906, still 2.7× its floor). The toggles
  cost **~4.9 s** on the gate's ~34.8 s (3 runs each, same machine).
  **The gate also checks one whole SCREEN the scenario harness cannot frame**
  (`tools/src/golden-diff/screens-check.ts`, added 2026-09-09). `?campaign` is
  loaded before the scenarios and must draw the 3D diorama: the check reads
  the screen's own `wrap.dataset.board` back off the DOM and fails when it
  says `flat`. It exists because Draco compression broke that board and CI
  stayed green -- every scenario here is a `sandbox=` or `mission=` URL, so
  nothing loaded the campaign screen at all. It is reference-free by
  construction and asks which PATH the screen took rather than what it looks
  like, because **the fallback is a legitimate picture**: dropping to the flat
  PNG board is correct for a browser with no WebGL2, so a pixel baseline
  cannot tell that outcome from the bug. Falsified by re-injecting the
  decoder defect: `data-board=flat, canvas=false -> FAIL`, with
  `No DRACOLoader instance provided` printed beneath it. One trap found while
  wiring it and worth knowing before adding a second screen check: the
  success path assigns `EXIT_OK` unconditionally once every gated scenario
  matches, so a failure recorded only in `process.exitCode` is silently
  clobbered -- carry it in a variable and consult it at the end.

  **Exit 3 still means "nothing was COMPARED", and ONE scenario is now
  captured and not judged**: `combat`, whose scene does not hold still between
  two photographs at all (two screenshots with NO repaint between them differ
  by 10989 px, then 22215).
  **`vehicle` joined the judged set on 2026-09-10 and how it did is the
  useful part.** It had no reference-free check because the obvious one does
  not work: `updateMeshUnits`/`updateVehicleMeshes` re-assert `root.visible`
  from fog EVERY frame, so the repaint meant to photograph the units missing
  is the call that puts them back — hiding "units" that way moved 76 px /
  0.0100, against 6922 / 0.5014 for scatter in the same frame. It was
  measuring the few billboard instancers and silhouettes that happen not to be
  re-asserted. `ThreeRenderer.unitsDebugHidden`, a flag those two writes
  consult, takes the same toggle to **23147–23152 px / 2.0232–2.0247** — 305×
  — with a floor at a third (7700 / 0.67). **A toggle that only holds until
  the next frame is not a measurement**, and any future layer whose objects
  are re-asserted per frame needs the same treatment rather than a bare
  `setObjectsVisible`.
  Two things that fell out of it. The `units` layer hides mesh units, mesh
  vehicles AND the billboard instancers, so it is the unit BODIES rather than
  overlays or silhouettes. And giving `vehicle` any check at all made it run
  the zero-time **repaint control for the first time** — `runSelfChecks`
  returns early on an empty `layerChecks` — where it failed the global hard
  zero at 0 px / 0.0002–0.0004, and was given `BaselineSpec.repaintControl`, a
  PER-SCENARIO budget that loosens one scenario and nothing else. The
  constants stay 0 and must: their own comment is right that widening them
  would silently loosen every layer floor at once.
  **What drifted is known now, and the override is deleted (2026-09-18).**
  It was `ThreeRenderer.updateVehicleAmbientFx` adding the RAW frame delta to
  its per-entity dust/exhaust accumulators, where every other elapsed-time
  reader in `frame()` clamps to 100 ms (`frameDtMs`/`frameDtSeconds`). A long
  frame therefore BANKED emission credit that later frames spent at one puff
  per CALL, elapsed time or not: boot plus the settle left the accumulator at
  5607.9 ms on all seven stationary vehicles in shot, `step(140)`'s single
  `frame(1, lastFrameMs)` took it to 11198.3, and the next **22** zero-time
  repaints each spawned 7 exhaust puffs. Each fresh puff landed on the last
  one's pixels, which is why the series decayed without reaching zero — and
  because the backlog's size is a LOAD TIME, it also explains this scenario's
  5–157 px baseline noise, all of it but a Linux residual of up to 9 px (see
  the noise line below). One call (`frameDtMs(dtMs)`) takes the control to a
  literal **0 px / 0.0000**, and two macOS full-gate runs bit-identical to each
  other on this frame. Two lessons worth more than the fix: **a control that cannot
  reach zero is a defect with a stopgap on top of it**, and the drift and the
  "renderer noise" were the same thing all along. A regression in anything no
  layer check names still passes on an unblessed runner at any size.
  **Run-to-run noise is not spread over the frame**; it sits in tight clusters
  around animating mesh units and real-time VFX, and every other pixel is
  bit-identical between captures. That is why a scenario can declare a
  `region`: scoping `open-ground` to its unit-free ground crop took its noise
  from 1762 px / 0.1544 to **0 / 0.0000**. Every scenario also has an ABSOLUTE
  `targetTick`, because a relative `step(n)` lands 18–22 ticks late and drifts
  run to run.
  **Pinning the tick the script STEPS TO is not the same as pinning the tick
  the SCREENSHOT sees, and the gap was worth a 28% false-red rate.** The app's
  rAF loop keeps ticking and repainting between `page.evaluate(captureScript)`
  and `page.screenshot()` — measured on `vehicle`, the script returned tick 140
  on all 20 runs while the sim read **167–171** right after the screenshot, so
  the picture was whichever frame in that window the compositor happened to
  hold. That read as bimodal renderer noise (45–204 px in one mode, 1164–1549
  in the other) and it was the harness. `capture()` now **kills the frame
  loop** before its settle (`FREEZE_FRAME_LOOP_STATEMENTS`,
  `capture-protocol.ts`), so `step()`'s own paint is the last paint. The
  thresholds were calibrated against 24 consecutive full-gate runs taken that
  way and the noise has since been **pooled across three independent samples on
  the same machine (24 + 21 + 49 runs)**: `quiet` 0–1 px / 0.0000–0.0001,
  `open-ground` 0 / 0.0000, `relief` 0 / 0.0000, and `vehicle` 5–157 px /
  0.0029–0.0069 — **a `vehicle` figure that is retired, because it was never
  renderer noise**: all 94 of those runs predate `c0044ff6` (2026-09-18), and
  what varied was the ambient-FX emission backlog described above, whose size
  is a LOAD TIME. **A range with no sample size beside it is an anecdote**, and
  **a bimodal noise reading is a bug to find, not a band to widen.** What
  `vehicle` reads NOW, re-measured 2026-09-23 from every `ci.yml` `visual` run
  since the fix, all on `linux-x64-swiftshader`: against a baseline captured
  AFTER it (the `a387a6a` bless) **1–9 px / 0.0004–0.0012 over 5 runs**, in two
  clusters (1 px ×2, 9 px ×3) with no established cause, while `quiet`,
  `open-ground` and `relief` read a literal 0 / 0.0000 on the same five and
  `vehicle`'s own repaint control reads 0 px on all 33 runs since the fix;
  against the pre-fix `03fad18` baseline it read 33–47 px / 0.0031–0.0054 over
  26 runs, the offset being that baseline's own banked puffs. So the fix's
  "bit-identical" (two macOS runs) does NOT hold on Linux, where up to 9 px of
  this frame still moves run to run. The thresholds are still 300 / 0.02 —
  33× and 17× that post-fix maximum — and re-deriving them is a decision
  nobody has taken.
  **WP-A1.3 (vehicle weight) is expected to need no bless, and that
  expectation is a measurement at the capture tick, not a gate result**: read
  back through `debugVehicleTransform` at each gated scenario's own capture
  tick (the gate's own URL, freeze, settle and capture script; two runs,
  identical), every mesh vehicle inside a gated frame reads exactly 0 offset,
  0 pitch and 0 roll — the eleven in each of `quiet`, `open-ground` and
  `vehicle`, whose maps have no `elevation` grid and whose sandbox force is
  parked, so both halves of the model are arithmetically zero there; the only
  two hulls in `relief` that read otherwise (Lavis still recoiling from
  firing, 0.38° / 0.018 tile) stand ~700 px below its frame. The golden gate
  was not run for it: **the confirmation is the PR's `ci.yml` `visual` job.**
  The wreck hand-off (see "Mesh units") writes a new pose only on the frame a
  mesh vehicle dies, and a hull that dies parked and not recoiling gets the
  pose it already held; whether any vehicle dies inside a gated frame before
  its capture tick was not measured, which is one more reason that job, not
  this paragraph, is the confirmation. `combat` (report-only) is expected to
  move, because its armour drives, turns and fires.
  **`tel_marum` is in the gate now, and it is the only map that can catch
  terrain.** The `relief` scenario frames the T1-C boulder corridor and the
  extruded rock-ridge walls either side of it. Before it, the gate sampled two
  of the five shipped maps — both FLAT and boulder-free — and deleting every
  boulder decor object (`decor-place.ts`) left every gated scenario green.
  It now reads **36001 px / 2.6292** there against a 0/0.0000 noise floor,
  while `quiet`, `open-ground` and `vehicle` stay inside their own noise. It
  costs **1136.4 KiB** per environment (the darwin set is 4161.2 KiB, measured
  2026-09-15 off the blessed files; the 74.4 KiB / 464.3 KiB this line used to
  carry was the PRE-LIT set, and the lit renderer's frames are ~9x less
  compressible because a palette-quantised image is mostly flat runs and a
  shaded one is not) and it needs an
  `orders` entry, because fog is computed from living side-0 units only and the
  sandbox force spawns thirty tiles away: the scenario sends the `recon_drone`
  to the corridor mouth, without which the frame is a black rectangle.
  **`combat` is captured, reported and does NOT vote.** Two captures of the
  same commit differ by 969–3847 px / 0.19–0.36 there; the defect reads 3231 px
  / 0.6006 — inside the noise on count and 1.7x it on magnitude. No honest
  threshold exists between them. Its frame still uploads as a CI artifact —
  **which it never actually did until 2026-09-02**: both workflows pass
  `--out-dir=visual-baseline-output` and upload that path from the workspace
  root, while the npm script runs under `pnpm --filter @lions/tools`, so every
  capture landed in `tools/visual-baseline-output` and every upload logged "No
  files were found with the provided path". `--out-dir` resolves against the
  repo root now.
  **A report-only scenario cannot abort the run, and that took a CI run to
  learn.** On the first Linux bless `combat` failed to CAPTURE — three
  `waitForFunction` timeouts — and threw, discarding four gated baselines
  already written to disk, the manifest that makes them usable, and the PR
  step. `guardCapture` (`tools/src/golden-diff/capture-guard.ts`) now decides
  that from `isGated`, so a gated capture failure is still fatal (proved: exit
  2, stopped at the first scenario) and a report-only one warns and continues.
  Why `combat` timed out is the deploy gate, which only a `mission=` scenario
  has: `main.ts` holds `await loading.done()` — and the `window.__lions`
  assignment behind it — until the deploy button is clicked, but the button's
  click LISTENER is attached inside `done()` itself, so a click before that is
  silently lost with no second chance. The old harness guessed the moment from
  the progress text going quiet, which is also true at "0 / 45 sheets" before
  anything has loaded. It now clicks every 250 ms until the loading screen is
  gone and REPORTS the count: on a warm macOS cache that reads `deploy gate
  cleared after 2544 ms and 8 click(s) -- 7 landed before the handler was
  attached and were lost`, so the single-click version was surviving on luck
  everywhere and ran out of it on a cold Linux runner.
  **And the script must EXIT.** That failure sat in its step for 40 minutes
  after printing its error, because `child.kill('SIGTERM')` signals only the
  `pnpm` wrapper while vite, esbuild and three intermediate shells keep the
  inherited stdio pipes open — an event loop with a live handle never drains.
  `stopDevServer` kills the process GROUP (`detached: true`) and destroys the
  pipes; `exitWith` flushes stdout and calls `process.exit` on both paths.
  macOS never showed it: there `pnpm` forwards the signal and the same code
  exits in 10.9 s.
  **Accepting an intended change** is `pnpm golden-baseline:bless -- --reason="..."`,
  which refuses to run without the reason and writes it into `manifest.json`;
  on CI it is the `visual-baseline-bless` `workflow_dispatch`, which since
  2026-09-02 **commits the new PNGs straight to `main`** (the lead's call:
  "instead of PR merge to main and push"). Nobody sees the picture unless
  whoever dispatched it downloads the `visual-baseline-bless-captures`
  artifact and looks — so do that, every time. Do not widen a threshold to
  clear a red run.
  **The PR route this paragraph used to describe is retired.** The workflow no
  longer calls `gh pr create`, so the repo setting that used to block it
  (`can_approve_pull_request_reviews: false`, Settings → Actions → General →
  Workflow permissions) no longer matters to it; the first Linux baseline
  (`linux-x64-swiftshader`, run 33596042795) landed under the old route as
  PR #150. Two consequences of the bot commit, both met on 2026-09-15: **its
  push triggers NO `ci.yml` run** (GitHub never runs workflows for a
  `GITHUB_TOKEN` push), so after a bless `main`'s `visual` status stays
  whatever the last real push left it and the `version` job waits for the next
  real push; and a bless dispatched while `main` is moving retries its push
  three times before giving up.
- **The cross-backend Pixi-vs-three diff is now REPORT-ONLY**
  (`pnpm golden-diff:compare`, `tools/src/ci/golden-diff-gate.ts`). It exits 0
  unless a capture fails, and its `SCENARIO_BUDGETS` are kept as historical
  reference numbers, not thresholds. The project lead retired the pass/fail:
  *"retire cross-backend and rebuild it as three-vs-three."*
  Why, measured: since the mesh flip (`362bde7`) all four scenarios sat 1.8x–2.3x
  over budget with **no regression behind it** — re-capturing three with
  `&nomesh` put every one back inside budget (2.556→0.255, 7.094→2.132,
  5.426→1.312, 11.971→5.996), so 100% of the overage is the mesh path Pixi has
  no counterpart for. The budgets were last calibrated at `45a2cc1`, **124
  commits** before the flip. Recalibrating would have blessed a ~12% baseline on
  `combat`, inside which a broken mesh material or a missing unit type is
  invisible. And the harness's own `OPEN_GROUND_SCENARIO` comment already
  recorded that cross-backend **could not discriminate the scatter defect from
  its fix at all** (1.945% buggy vs 1.937% fixed, not even ordered right) while
  same-renderer separated them 34x. `EXPECTED_DIFFERENCES` never fed a pass/fail
  — it is `.length` in a message and a printed table — so adding entries could
  never have cleared the red, and correcting them is safe. Full account:
  `.superpowers/queue/golden-diff-red-report.md` and
  `.superpowers/queue/golden-three-report.md`.
  **VFX are exempt from this diff as of 2026-08-30.** The project lead's call:
  "all VFX should move to three." Pixi's VFX are legacy and are no longer owed a
  matching effect — an effect that exists only in three is the intended end
  state, not a divergence to be reconciled. This does NOT relax the freeze on
  `packages/render/src/renderer.ts`, which must still stay byte-identical to
  `main`; it removes the obligation to hold three's VFX back to what Pixi can
  match. Two consequences: `additive` and `heat_shimmer` (schema fields read by
  nothing) were deferred purely because implementing them meant touching both
  backends, and are now unblocked in three alone; and new VFX work should be
  judged on how it looks in three, not on cross-backend agreement. Capture conditions must be stated with any number from it — a
  first run read 6.5× higher purely from screenshot downscaling and a font-load
  race, and the OS mouse cursor is shared across tabs and can leak into a capture.

### Mesh units

Most unit types draw as rigged 3D meshes instead of billboards, and **this is
the default on `three` as of the mesh flip** — every type with a shipped GLB,
in every mission, with no flag. It was an opt-in `&mesh` until then, which
meant no player reached through `ui/menu.ts` ever saw a mesh: that file builds
`?mission=<id>` and never appended the flag. `&mesh` is still ACCEPTED and does
nothing, so old bookmarks and doc lines do not trip the unknown-parameter
warning. The escape hatch inverted: **`&nomesh`** walks the billboard path on
`three` (and skips the GLB downloads entirely), and `?renderer=pixi` has no
mesh path at all — not a gap to close, a permanent property of that backend.

~~The whole set costs **34 GLB fetches, 25.3 MiB**, loaded unconditionally at
boot rather than per mission roster~~ — **stale on both counts since
2026-09-07.** Meshes have been roster-driven for a while (`mesh-catalogue.ts`,
`missionUnitTypes`: the types a mission can field, the buildings its map
stands, the decor families its tiles use; KDF buildables deferred past deploy
on a `resources` mission), and as of 2026-09-07 so are the sprite sheets
(`spriteSheetPlan`: on the mesh path a sheet loads before deploy only for a
fielded type with no GLB; a mesh vehicle's wreck sprite and a deferred
buildable's fallback load after the first frame). **Measure, don't recite:**
`pnpm perf:load -- --mission=<id> --serve=preview` prints what one level
fetches and when. The first reading (beit_sahwan_1_recon, production build,
cold, localhost) was 3,736 requests / 114.8 MiB, of which 3,665 requests /
61 MiB were sprite sheets for types the mesh path draws as models; after
steps 1-2 of `docs/superpowers/specs/2026-09-07-level-load-time-design.md`
it is ~170 requests and the GLBs are what remain. That document ranks what
is left (wreck meshes after the first frame, Draco, a service worker for
Pages' `max-age=600`, the first-frame gap). Pipeline: `tools/units/kit.py` (geometry)
→ `tools/units/rig.py` (armature + clips, authored as Python tables) →
`tools/export_mesh_team.py` → `art/meshes/<team_id>.glb` → **`pnpm gait:meshes`**
→ **`pnpm encode:meshes`** → `assets/meshes/` → `three/units/mesh-*.ts`.
**Both post-export passes are mandatory and their order is load-bearing** — the
gait pass writes into `art/meshes/`, the encoder mirrors it into `assets/meshes/`,
and running them the other way round ships a stale stride. Same shape, and the
same rule, as `pnpm wreck:meshes` for vehicles.

- **`kit.py`'s "No armature." rule is now partly overturned.** Of its three
  reasons, only "blocky is enough at 25 px" fell — beaten by the project lead
  judging rigged motion better on screen. The other two stand, and reason 1 is
  why bones and clips are **authored in code and never hand-posed**, and why
  binding is rigid one-part-to-one-bone with **no weight painting**.
- Adding a part to `kit.py` makes `rig.py`'s `PART_BONE` stale. It **raises
  loudly** rather than leaving gear in bind pose. Extend it; never silence it.
- **A rigged GLB declares the stride its own legs describe, and the renderer
  matches playback to the ground** (2026-09-16, design
  `docs/superpowers/specs/2026-09-15-infantry-gait-design.md`, contract v3 in
  `2026-08-28-mesh-unit-contract.md`). `pnpm gait:meshes`
  (`tools/src/meshes/gait-pass.ts`) measures each locomotion clip and writes
  `rl_gait: { move: { strideM, cycleS }, moveFire?: … }` onto the SCENE's
  `extras`; `gaitTimeScale` (`three/units/mesh-anim.ts`) divides the unit's
  MEASURED ground speed by what the clip's legs cover and hands the result to
  the mixer as a `timeScale`. **A mesh with no `rl_gait` gets exactly 1**,
  which is precisely the old behaviour, so the motorcycle (the three crews
  walk since 2026-09-17, on a third root per figure) and any un-passed
  re-export are never made worse.
  Six things about it are worth knowing and every one was measured.
  **The old behaviour was a third to two-thirds of a stride.** Before this,
  fourteen rigs played a 0.67 s march whatever they were doing: boot travel
  against ground covered read **0.315** for `inf_squad`, **0.321** for
  `charge_squad` (which sprints at 1.9 tiles/s) and 0.295 for a civilian
  child. That is the whole of "they walk nonchalantly" — the legs describe a
  fraction of the ground the body crosses, so the figure glides.
  **Nothing needed to move faster.** One tile is 3 m, so 0.9 tiles/s is
  2.7 m/s: every rifleman in this game was already running and the animation
  simply would not admit it. That is also the answer to GH-152, which was
  blocked on a "fleeing signal" the sim does not have — `move` IS the run, and
  six rigs were shipping an unbound `Running` clip beside the walk they
  played. Closed 2026-09-16 with no sim change at all.
  **`cadenceScale` was NOT unread by three.js, and the claim that it was is
  false.** `three/units/frame-state.ts` has always composed
  `walkFps(anim.speed, n) * cadenceScale(anim)` for every BILLBOARD unit, and
  `walkFps` is itself a rate match — so a billboard's legs have followed its
  ground speed since long before this. What had never been rate-matched is the
  MESH path. This is why the mesh side MULTIPLIES by cadence rather than
  replacing it: a routed mesh rifleman and a routed billboard standing beside
  him would otherwise disagree about how fast a broken man's legs move, in the
  same frame, invisibly to every test.
  **The clamp is a backstop and a clamp doing real work is a defect to
  report.** Reachable range on shipped art is **0.914x–2.645x**
  (`sniper_team` lowest, `yahalom_squad` highest), bounded from the sim rather
  than from observation: `stepMovement` never moves a unit past
  `type.stepPerTick` and the direction vectors are unit vectors, so a diagonal
  is not faster. `GAIT_TIME_SCALE_MAX` is 4. **The design's own example of 2.5
  was wrong** and would have clipped the unit with the largest correction to
  make, putting its slide back with every test green.
  **A passenger's `entitySpeed` is its CARRIER's**, because `stepTransport`
  overwrites a carried unit's position every tick — measured live, a
  `sniper_team` in a `jeep_shoded` computes **13.53x** and clamps. Carried
  units are excluded outright rather than clamped, which restores exactly
  their pre-change behaviour and is what makes "a clamp means that mesh's gait
  is wrong" true.
  **The stride is the FORWARD component, not the 3-D travel.** Declaring the
  hypotenuse folds foot lift and lateral swing into a number the renderer
  divides by time and treats as a ground speed; the forward fraction ranges
  0.823–0.985 across the seventeen declarations and is rig-dependent, so no
  constant downstream could have corrected it. Fixing it moved every
  declaration down by 1.47%–17.70%.
- **`tools/src/mesh_gait.test.ts` is the gait and facing gate, and it is
  tree-wide.** It measured `mortar_team` ALONE until 2026-09-16 — the one file
  GH-145 was raised against — which is how fourteen sliding rigs shipped
  green beside it. It now sweeps `RIGGED_UNIT_MESHES` and gates, per file and
  per FIGURE: the playback multiplier (not the residual — see "Every check
  gets an input that makes it fail"), step cadence, per-figure ground
  coverage, head-to-face bearing, a marker instrument for rigs with no `face`
  role, a weapon-axis PCA with its own elevation and two-instrument agreement
  checks, and the declared `rl_gait` against a FRESH measurement of the same
  bytes, so a re-export that skipped `pnpm gait:meshes` fails loudly instead
  of rate-matching to a stale stride. Named outliers carry their own numbers
  and a DEMOTION assertion: an exemption that is no longer needed fails and
  tells you to delete it, which it has already done once by itself.
- **A GLB carries zero materials — except three buildings, by the lead's
  explicit override.** Colour is applied at runtime from the role ramp. Since
  Phase 0 (2026-09-14) that is ONE flat albedo per part — `liftTone(ramp)`,
  the ramp's lit face, on a `MeshStandardMaterial` — and the sun, the shadow
  map and AO make the shading, where it used to be a ramp SLICE indexed by
  normal. Do not port `render_team.py`'s `ROLE_PALETTE` or `LIT_GAIN` into
  a mesh export — that table compensates for a multiply-style light, and a
  real light does the job now.
  The exception is `house`, `apartment` and `warehouse` (and their wrecks),
  which ship their supplied Meshy `base_color` bake: *"i have provided a very
  detailed blender files and i want them to be used as is unless ill provide
  other instruction."* The opt-out is a NAMED LIST on both sides —
  `TEXTURED_BUILDING_TYPES` (`three/units/textured-building.ts`) and
  `TEXTURED_MESH_EXEMPT` (`tools/validate_mesh_assets.py`) — pinned against
  each other by `textured-building.test.ts`, which parses the Python set. A
  GLB outside the list that ships a texture **throws** rather than being
  silently upgraded. Three things a reader will otherwise get wrong:
  **the decision is per MESH, not per file** — the warehouse's roof cap is
  synthesised by `export_meshy_warehouse.py` (its source is an open-topped
  scan), has no UVs, and stays on the palette inside a textured GLB;
  **`pnpm validate:meshes` does NOT palette-check these six**, and never
  could have — `render_mesh_gate.py` repaints every building from the palette
  before rendering, so the check was measuring a stand-in, and the gate now
  prints a `NOT palette-checked` line naming them (silhouette IoU still runs);
  and ~~**the map's `colorSpace` must be `NoColorSpace`**~~ — **the opposite
  since Phase 0 (2026-09-14): leave the `SRGBColorSpace` `GLTFLoader` stamps
  on a baseColorTexture alone.** `prepareTexturedMap`, which used to undo it,
  is deleted. The old rule was right for a pass-through output and wrong the
  moment the renderer started decoding to linear and encoding in `OutputPass`.
  The one texture class that still takes `NoColorSpace` is ground albedo,
  because a ratio field is not a colour — see the colour-pipeline bullet
  above. `metallic_roughness`/`normal` are no longer dropped at export either
  (the exporters keep them since 2026-09-14) and the renderer binds whatever
  maps a GLB carries: there is a sun in this scene to consume them now.
  **Zero materials is not zero ANIMATIONS any more, for vehicles.** Every
  `art/meshes/vehicles/*.glb` declared no clips at all until 2026-09-15; all
  eleven now carry exactly `idle` and `wreck`, written by `pnpm wreck:meshes`
  and keying only node SCALE, so every living mesh vehicle runs a mixer update
  each frame where it used to skip one on a null check. Nothing in the export
  scripts authors them and nothing else may use those two names — `stripWreck`
  matches by name and would silently eat an authored `idle`.
- **A mesh VEHICLE leans, lags and settles since WP-A1.3 (GH-177,
  2026-09-23), and its wheels still do not turn.** Design
  `docs/superpowers/specs/2026-09-20-art-vehicle-weight-design.md`. What ships,
  all of it presentation on the frame clock with nothing read back by the sim:
  a **four-sample terrain conform** (`units/vehicle-conform.ts` — the hull's
  measured footprint corners on the drawn ground, a corner over a blocked tile
  or off the map standing at the hull centre's height; that fallback is what
  keeps a plain four-corner sample, found in review and never shipped, from
  drawing a >10° false tilt on 130 of `tel_marum`'s 1,534 passable tiles and
  86 of `deir_amun`'s 1,916, and `tools/src/vehicle_conform_census.test.ts`
  holds every shipped map at 0); an **acceleration pitch**
  (`units/vehicle-weight.ts` — a constant-rate speed ramp, because the sim
  has no acceleration, feeding a damped settle spring scaled so a standing
  start draws exactly the authored maximum); a
  **turn roll to the OUTSIDE** of the turn, from the sim's own rate-limited
  yaw rate times the speed share, so a hull pivoting in place does not lean;
  the **settle** on a stop; a **lag** that trails the sim by `lag_tiles` and is
  exactly zero on a stationary unit (R-C: lag plus recoil clamped once at
  0.25 tile); and **dust whose cadence follows speed** (`vehicleDustIntervalMs`
  — 4.40/s for a cruising Lavi, 6.67/s for the Eitan and the technical, which
  both sit on its 150 ms floor, against a fixed 4.00/s before). Per-vehicle
  numbers are an optional `mobility.weight` block in the unit JSON with role
  defaults (`units/vehicle-weight-params.ts`, imported by relative path and
  pinned to `art/meshes/vehicles/*.glb` both ways); air units are excluded and
  the state freezes at death, while the WRECK is handed over at the sim
  position with the terrain conform alone (`poseVehicleWreck`) — no dive,
  lean, lag or recoil frozen into it, so it sits on its own scorch mark and
  shroud. On the running game (`pnpm weight:capture`, whose ladder now VOTES
  through `motionVerdict`): a Lavi's launch reads 1.79°
  at the 200 ms rung of its authored 2°, its turn 1.49° of 1.5°, its lag
  0.06 tile, and climbing onto `tel_marum`'s bench it stands on 16.8° of ground
  where it used to sit level with its nose in the hill. That harness's
  `mbt_lavi_tel_marum` subject is killed by the sandbox's Sarim force at tick
  ~281 in every run, so its `stop` lane is ten seconds of a wreck, before and
  after alike: the one named `KNOWN_DEAD_LANES` entry, reported and labelled
  in `sheet.md`, excluded from the exit code, and red again the moment it
  gains a living rung.
  Two things a later reader will otherwise get wrong. **`rotation.x` under a
  yaw on `rotation.y` is a WORLD-axis tilt**, not a pitch: three composes
  `Rx·Ry·Rz`, so the shipped recoil's 0.06 rad measured a nose lift of
  0.000 / −0.060 (nose DOWN) / 0.000 / +0.060 at facings 0 / 0.25 / 0.5 /
  0.75, with a constant 0.060 sideways bank at every one of them, while its own
  comment claimed a local pitch. The hull now takes ONE write,
  `rotation.set(-roll, yaw, pitch, 'YZX')` — yaw, then pitch about the hull's
  lateral axis, then roll about its length — and reads 0.05996 of nose lift at
  every facing; the recoil pitch is one term of that sum. (The minus is real:
  the corner `hullCornerOffsets` names `right` is the hull's PHYSICAL LEFT.)
  And **the other half of GH-177 — wheel spin and track scroll — is OPEN, and
  it needs geometry, not a pivot name** (R-J, the spec's open question 1): no
  shipped vehicle GLB has a `wheel_*` or `track_*` node, every one merges its
  wheels and tracks into a single `hull_rubber` mesh, four of them
  (`apc_eitan`, `apc_kipod`, `dozer_d9`, `scout_shachaf`) carry no UVs on it
  at all, and the seven that do share the hull's own material, so scrolling it
  would scroll the whole vehicle. Nothing in WP-A1.3 delivered that half.
- **A building's FACING is gated now** (GH-142, `tools/building_facing.py`,
  inside `pnpm validate:meshes`). A building never turns — `mesh-building.ts`
  leaves rotation at identity — so whichever elevation an export bakes toward
  `+X`/`+Z` is the one the player gets forever, and until this that was a
  coincidence held up by two comments in two export scripts. It stopped being
  harmless at `d63cd36`: a palette-painted box has no front, a photographed
  facade does. The gate rasterises each GLB orthographically from all four
  cardinal directions and counts pixels whose nearest FRONT face is
  `glass`-role geometry — the one role that marks an OPENING rather than a
  surface material — then requires the camera-facing half (`+X`+`+Z`, derived
  from `camera.ts`'s `VIEW_DIRECTION`, pinned by `building-facing.test.ts`) to
  beat the hidden half by `FRONT_MARGIN`. Three things about it are worth
  knowing. **Texture statistics do not work and several were measured failing**
  — mean, contrast, dark-fraction and edge energy all pick house's fire-stair
  side over its entrance side, because they score clutter rather than frontage.
  **A third verdict, `symmetric`, is load-bearing**: `warehouse` has a roller
  door on BOTH gable ends and `concrete` reads 1080 px on each half, so
  demanding a front from them would be a false-positive factory; nothing
  shipped falls between 1.32 and 4.67, so 2.0 sits in a gap rather than on a
  fitted line. And **`apartment` is the one shipped textured building the gate
  cannot judge** — its windows are painted into the bake with no pane modelled,
  so it has no `glass` role and no readable front. That is named on the PASSING
  path, like `NOT palette-checked` is.
- **`apartment` deliberately does NOT get a `glass` role**, and the reason is
  not "nobody got round to it". On a textured building the role is inert for
  colour: `buildBuildingMeshTemplate` takes the texture branch BEFORE
  `isBuildingMeshRole`, so `house`'s own `glass` mesh is drawn through the
  photograph and contributes no palette entry — verified from house.glb's bytes
  (its `glass` primitive carries `TEXCOORD_0` and references the one textured
  material). Adding one to `apartment` would therefore buy zero colour and
  would mean re-exporting a supplied Meshy asset purely so a gate can read it,
  against the lead's "used as is". The gap is recorded instead.
- **Mesh units are outside `validate:assets`** — no PNG, so no palette or IoU
  gate runs on them at all. Phase G is meant to fix that and has not.
- **`kit.py` changed without the sprite sheets being re-rendered**, so
  billboards and meshes can disagree until that debt is paid.
- **Mesh units ARE gated now** -- `pnpm validate:meshes` (`tools/render_mesh_gate
  .py` + `validate_mesh_assets.py`) renders every `art/meshes/**/*.glb`
  headlessly through `render_rig.py`'s own rig and runs
  `validate_assets.py`'s IMPORTED palette/silhouette/fill checks. Silhouette IoU
  compares each mesh against every other mesh and every other unit's sprite,
  EXCLUDING its own retired sprite -- a mesh is supposed to look like the unit it
  replaces. **It is in CI** (`8304f6b`, ci.yml's `gates` job), and CI really can
  run headless Blender: the workflow downloads Blender 5.2.0 linux-x64 from
  download.blender.org and that URL is live (HTTP 200, verified 2026-09-01) --
  this is a real gate, not a green-looking no-op. Current state measured
  2026-09-15, after the wreck pass added eleven extra Cycles wreck renders:
  **passes in roughly 45-70s on this machine, not 31.69s** (Task 3's own
  report read 70.0s, its reviewer 45.7s, the final branch reviewer ~70s —
  Cycles render time varies run to run; the gate logic did not slow down),
  "46 mesh unit(s) rendered and checked against
  36 sprite unit(s); 21 decor mesh(es) checked against the mesh contract
  directly" -- the "29/29" this line used to carry is long stale. Locally it
  needs Blender on PATH or `--blender`/`BLENDER_BIN` (a macOS `Blender.app` is
  found by the default candidate list); with none it fails loudly rather than
  skipping. Two traps when running it in a **shared worktree**: it walks
  `art/meshes/` with no filter and no ignore of untracked files, so another
  session's scratch `.glb` will fail YOUR run (observed -- a stray
  `zz_throwaway.glb`, a copy of `digger_crew`, produced
  `silhouette collision: digger_crew (mesh) vs zz_throwaway (mesh) IoU=1.000
  (limit 0.88)`); and there is no `--meshes` flag to point it elsewhere, so
  `git status art/meshes/` is the first thing to check when it goes red.
- **Art existing is not art drawing.** `packages/app/src/main.ts`'s
  `SPRITE_MAP` is what queues a sheet for loading, and a unit type absent from
  it never loads anything. Three complete, gate-passing sheets shipped and drew
  NOTHING because of this. No gate catches it. Check `SPRITE_MAP` when adding a
  unit. A unit's UI picture -- the HUD chip and card, the reinforcements dock
  tile, the brigade row -- is a separate asset again: `assets/ui/icons/units/
  <SHEET>.png`, cropped from the sheet's own portrait frame (turret composited
  in) by `pnpm icons:units`. A re-rendered sheet needs a re-crop, and
  `tools/src/unit_icons.test.ts` plus CI's `crop_unit_icons.py --check` fail
  loudly if it was forgotten.
- **`render_team.py --probe` used to overwrite shipped sprites** with
  unquantized renders (~10% of pixels, file sizes doubling) -- the PNG half of
  the same defect `229aad5` fixed for manifests. Fixed: probe output goes to
  `.superpowers/probe/`. If you touch that path, re-prove `git status` stays
  clean after a probe run.
- **The elevation debts above were finally walked on `tel_marum` (2026-08-29)
  and four of the five are not what the bullet implies.** Extruded terrain
  fails to occlude units IDENTICALLY in both backends (neither does volumetric
  occlusion); mid-slope picking works in both; the wreck/fx sorting gap
  produced no visible artifact even staged at the map's steepest 4-level drop;
  and `raySmoke` is shared sim code that cannot diverge by backend. The one
  real divergence runs the OTHER way: Pixi's tracers and puffs ignore
  elevation (`renderer.ts:2599`, a flat `isoY(...)-4`) while three's
  `TracerBatch` lifts by the higher endpoint's ground height. Three is
  correct there and Pixi is not.
- **A unit spawned mid-mission draws correctly on three and not on Pixi.**
  Every mid-mission spawn (a build, a reinforcement, a trigger, a wave) happens
  inside `runtime.step`, after that tick's `renderer.snapshot()`, so until the
  next snapshot its id is inside `sim.entityCount` with both position copies at
  zero. Three seeds a newcomer in `snapshot()` (`prev = cur`, speed 0) and
  bounds every per-frame loop by the count it last snapshotted, so the unit
  appears where the next snapshot finds it, up to one tick late, and never
  slides (`4d6d2ede`). Pixi still runs the old code (`renderer.ts`'s
  `snapshot()` seeds no newcomer and its frame loops walk the live
  `sim.entityCount`), so it still draws the unit at world (0,0) for that tick
  and lerps it in from there. Measured on three before `4d6d2ede`, the same
  code Pixi still runs: on `wadi_halam_2_laager` a bought jeep drew at (0,0),
  then halfway across the map at 483.7 tiles/s. `renderer.ts` was left alone
  because its one-method unfreeze (`reseed`, `8c638f1d`) is reserved for edits
  the compiler forces.
- **A renderer choice persists per ORIGIN, not per tab** (`renderer-choice.ts`,
  `localStorage['lions.renderer']`). Two tabs open on the same origin fight
  over it -- observed live. Harmless between agents; a real hazard for a player
  with two tabs.

### The campaign board

`?campaign` draws `art/meshes/campaign/sahar_basin.glb` as a rotating 3D diorama
on `three` (`packages/render/src/three/campaign/`, reached from `app` by a
DYNAMIC import of `@lions/render/three-campaign` -- named in eslint's bundle
rule like the other four doors). **The flat PNG board is not a fallback that
happens to still exist: it IS the Pixi path**, and `worldmap.ts` /
`worldmap.test.ts` / `data/campaign/world.json` are unchanged. Forcing three
for this one screen was rejected because the renderer choice persists per
ORIGIN and survives every link `menu.ts` builds, so it would load a second
backend behind a deliberate `?renderer=pixi` -- the hatch someone reaches for
when three has failed them -- and hand them back to Pixi for the mission.
Three more paths land on the flat board, each warning by name: no WebGL2
(probed with a throwaway canvas BEFORE the dynamic import, so a browser that
cannot draw it never downloads 609 kB of three), a GLB that will not load, and
a scene graph that fails the campaign contract.

Six things about it are counter-intuitive and each was measured.
**The camera does not move; the BOARD turns**, under `camera.ts`'s own
`VIEW_DIRECTION` -- so this screen and the mission share a camera, and
`uLightDir` stays fixed in WORLD space (`mat3(modelMatrix) * normal`, not the
view-space `normalMatrix` every other material here uses). An orbiting camera
with a view-space light nails the shading to the screen and the board reads as
a texture sliding over a shape that is not moving.
**The frustum is fitted ONCE for the worst yaw**, so the board never changes
size as it turns; a per-frame fit wastes no screen and makes a hex slab swell
and shrink as it rotates.
**Fit the FOOTPRINT, not the bounding box.** A hexagon's box has four corners
with no board under them: fitting the 28-point plan hull instead of the 8 box
corners takes the half-height from 0.45070 to 0.36066 -- the board draws
**1.25x larger** in the same frame, at both 1140/641 and 16/9.
**`outland_scenery` still must never take a REGION tint** (it carries the
diorama's base and rim), but leaving it at the untouched bake was measured
wrong the other way -- photographed at 1440x900 the eastern desert was the
brightest, most saturated ground on screen, louder than the one region a fresh
campaign can play. Scenery is drained to sit below `empty` and above `locked`.
**The shade term is SMOOTH here and banded in `texturedBuildingMaterial`**, on
purpose: a building's facets break on real edges, and three hard bands across a
hillside draw contour terraces that are not in the source.
**Antialiasing is ON**, and since Phase 0 that is no longer unique — the
mission renderer antialiases too (SMAA in the composer, plus the raw
renderer's own MSAA for the composer-less path). Its silhouette is a rotating
hex rim, the worst place aliasing could land.
**This screen did NOT move onto the lit pipeline, and that is the spec's own
scope call** (§9): `world-view.ts` still sets `outputColorSpace =
LinearSRGBColorSpace` by hand and `world-material.ts` still tags its bake
`NoColorSpace`, so the diorama is pass-through where the mission is sRGB +
ACES. Nothing shares a light between them yet. Moving it onto `lighting.ts`'s
sun is the named one-file follow-up; until someone does it, expect the board
to read slightly differently from the same assets in a mission, and do not
"fix" one of the two colour spaces in isolation.

A click on locked ground **says why**, into an `aria-live` line. That is not
polish: the ground is one canvas, so a click that resolved to nothing and
printed nothing is indistinguishable from a broken screen. Hover is gated on
"is this really a control", measured -- hovering the live region moves 43,848
canvas pixels (7.52%), hovering a locked one moves **0**. Town pins are DOM
anchors positioned from the view's own projection, never sprites: a canvas
cannot be tabbed into. Full account, with all 27 test falsifications:
`.superpowers/queue/kedem-map-screen-report.md`.

Two traps found while building it, neither specific to this screen.
**eslint walks your build output.** A browser check here means `vite build
--outDir <somewhere>`, and this tree had two sessions doing it at once:
`dist-campaign` and `dist-cursorverify` together made `pnpm lint` red with
**8,631 errors**, every one `no-undef` on a minified bundle. `**/dist-*/**` and
`.superpowers/**` are ignored now, alongside `**/dist/**`.
**`window.localStorage` in this vitest jsdom config is a bare `{}`** -- no
`getItem`, no `setItem`, no `length`. Any UI code reaching it must guard
(`readStoredRenderer` in `renderer-choice.ts` does, which is also right for a
real browser with site data blocked, where the property access itself
throws). And it makes `worldmap.test.ts`'s "does not write to localStorage"
test **unable to fail**: it compares `window.localStorage.length` before and
after, and both are `undefined`.

### The scene host

`packages/render/src/three/front/scene-host.ts` is a new door,
`@lions/render/three-front`, named in eslint's bundle rule beside the other
five -- **a stock `ThreeRenderer` pointed at a real map, never a "menu mode"**
threaded through that file. It drives a never-ticked `Sim`
(`data/front/menu_diorama.json`, four KDF units on `beit_sahwan_outskirts`)
through the mission's own `RendererOptions`, capped at 30 fps, behind the
menu column -- and **lives on `/` only**: it is part of the menu screen's own
disposer, so `/` -> `/settings` -> `/` leaves no host on settings and a fresh
one remounts on return, with no reload.

**The door never calls `loseContext()` itself.** Since #219,
`ThreeRenderer.dispose()` already releases its own context
(`three/context-release.ts`: `dispose()`, then `forceContextLoss()`, skipped
if already lost), so `release()` calls `renderer.dispose()` and nothing
else. Do not reintroduce an explicit `loseContext()` call; that was the
pre-#219 design. What a re-added one does depends on its shape, measured on
SwiftShader: `getExtension('WEBGL_lose_context')` asked AFTER `dispose()`
returns `null` on the lost context, so that line is silent dead code; a
handle taken BEFORE `dispose()` and called after it logs `WebGL:
INVALID_OPERATION: loseContext: context already lost` as a WARNING. `ui:routes`
collects warnings around all three of its scene-host leaves (live, mid-load,
mid-construct) and fails on any matching
`/WebGL|loseContext|scene host|DRACO|Worker/i`, bar SwiftShader's own `GPU
stall due to ReadPixels` note, exempt by its full text; the held-handle
re-add was seen red in all three.

**`.rl-scene-host` carries `data-host`** (`pending` -> `live` | `plate`, or
`off`) **and five siblings**: `-reason`, `-motion` (`animate` | `held`),
`-camera`/`-zoom` (reported by the door through `onCamera`, never
recomputed), and `-ms` (mount to terminal state). `window.__lions` is never
defined on the menu route -- `ui:routes` asserts exactly that -- which is why
the visual gate freezes the frame loop inside its own `async` IIFE
(`FREEZE_FRAME_LOOP_STATEMENTS`, not the `_SCRIPT` variant, which reads
`__lions.sim.tickCount`) rather than its usual one-liner.

**Pixi and reduced motion both get the plate**, never a held live frame:
Pixi because it is the hatch a player already reached for when three failed
them, reduced motion because the plate already IS a held frame of the same
diorama. **Reduced motion gates parallax off on its own, whatever the path**
(`ui/scene-host.ts`: `decided.path !== 'off' && !reduced`). Keying it on the
plate's `reason` let Pixi + reduced motion slide, because that visit reads
reason `pixi`, not `reduced-motion` -- the defect `36f74025` closed (D-54).
**Pixi at default motion slides the plate by design** (spec §3.5); do not
"fix" it static.

**`pnpm plate:host`** (`tools/src/perf/host-plate-capture.ts`)
re-photographs `assets/ui/menu_host_plate.jpg` after any edit to
`menu_diorama.json` -- a re-staged diorama and a stale plate cannot be caught
by eye at review time. `pnpm validate:data` fails by name if the file the
JSON's `plate` field names is missing on disk.

**The gate votes three ways on this screen**, in `checkMenuSceneHost`
(`tools/src/golden-diff/screens-check.ts`, run right after
`checkCampaignBoard`): *path* (`data-host` reaches `live`), *contribution*
(hiding the host's canvas must move the flanks past a measured floor --
30.4426, a third of three identical 91.3279 readings), and *register* (the
host's LIVE frame against the mission's own frame of the same map at the
host's own camera and zoom, mean Y and S within 10% -- not the plate). The
two photographing votes, and `ui:shots`' `01-menu`, first wait (bounded, never
throwing) for `.rl-scene-host__plate` to come off: `live` is stamped at the
START of the 400 ms crossfade and a CSS transition ignores the frame freeze.
Cost: 41.7 s inside a 165 s local `pnpm golden-baseline` run, almost all of it
the register vote's own mission boot -- inherent to the camera-for-camera
design, not waste.

**A SwiftShader tool that clicks off a LIVE menu needs ~20 s of headroom** for
that click: Task 6 measured a 17.1 s menu -> campaign click locally, and
CI's SwiftShader is slower. No landing run recorded `data-host-motion` reaching `held` (`ui:routes` leg
(a) now prints it at `live` and again at the leave click, with the click's
duration). And spec §10's memory budgets -- <= 900 MB while live,
<= 60 MB within 1 s of leaving -- were never measured as memory: the landing
checked only the `isContextLost()` proxy (`ui:routes` leg (a) and (c)), which
says the context was released, not what the GPU process holds.

`ui:routes`/`ui:shots` already take `--port` (landed on `main` via #214; see
the paragraph above, ~:306) -- nothing new here.

---

## Known scaling debts

- **`roster.surviving_units` is CUMULATIVE since the motivation-layer branch, and it
  grows every mission.** `checkEnd` used to rebuild the roster from `playerIds` alone, so
  a pool entry no placement fielded was silently deleted; it now writes the fielded
  survivors and then appends every unfielded pool entry unchanged (spec §4.7). The
  consequence nobody asked for is arithmetic: a mission's survivors include units that
  were never in the pool -- every `starting_force` placement without `from_ledger` spawns
  fresh, and whatever lives writes a NEW entry -- so the pool APPENDS rather than
  replaces, and replaying a mission appends again. Measured in `pnpm playtest`: the Beit
  Sahwan chain's final roster went **10 -> 23** and Umm Zeitoun's **12 -> 26** (re-measured
  2026-09-11: 23 and 26 stand, with `beit_sahwan_1_recon` already at 17). Nothing in the
  sim scans the roster per tick, so this is not a tick cost -- it is a SAVE that grows
  without bound and a deploy panel that would have named a force three times the size of
  the one on the map. The panel is fixed (`broughtFor` scopes to this mission's own
  `from_ledger` draws and prints the rest as one `N in reserve` line); the roster itself
  is not capped, deliberately. **Whether the roster or the reserve gets a cap, and what
  falls off it, is a step-3 decision** -- a cap is a game rule (which veteran do you
  lose?) and picking one here would have been a balance change smuggled in as a bugfix.
- Detection is O(N²) pairs per tick. **The "~150 units" figure this line used to
  carry was a guess and it was wrong by an order of magnitude** — measured
  2026-08-30 (`docs/PERFORMANCE.md`, "Sim tick cost"), the 300-unit GDD target
  runs at **2.08 ms, 4.2% of the 50 ms budget**, and the budget is not crossed
  until ~1,700–2,100 living units. Nothing needs staggering today.
  Two corrections worth carrying when it eventually does. **`selectTarget`
  (`sim.ts:2603`) is a SECOND O(N²) scan** — every living shooter scans every
  entity for every weapon slot, every tick — and together with `stepDetection`
  it owns 85–95% of tick cost at every checkpoint. Those two are the targets,
  not the trail scan below. And **every per-tick scan bounds on `this.count`,
  the LIFETIME spawn count, never decremented** — so a freshly-spawned
  2,100-unit world costs 58 ms where the same `this.count` battle-worn costs
  39 ms. Attrition makes the sim faster, and a long mission with heavy churn
  keeps paying for units that died an hour ago.
- Rigged mesh units cap out around **420-460** of the same infantry type, measured
  against a real export on a real `WebGLRenderer` with hardware acceleration
  confirmed, across repeated runs. That clears the GDD's 300-unit target with
  margin, so it is not blocking. The bottleneck is **draw-call submission**
  (74-84% of `renderer.render()`), NOT `AnimationMixer` update and NOT
  bone-matrix computation — which matters, because it means vertex count is
  comparatively cheap (the rifle went 144 → 612 verts for zero new draw calls)
  and the remedy is fewer submissions rather than simpler geometry. `SkinnedMesh`
  does **not** instance in three.js: `InstancedMesh` and skinning do not compose,
  so N units is N × (meshes per team) draw calls. The known remedy for pushing
  past the ceiling is a vertex animation texture — bake clips into a texture,
  drop runtime skinning, use `InstancedMesh` with a per-instance time offset;
  VRAM cost is small (~22-130 MB against the existing 584 MB sprite budget).
  **Unresolved before VAT could ship:** R0's "no band crawl" result was measured
  against continuous real-time skinning, not against VAT's baked-and-lerped
  normals, and the toon ramp is indexed BY NORMAL — so that finding needs
  re-verifying, not assuming. Harness: `tools/src/perf/three-units.ts`.
  **Re-measured 2026-08-30 against this branch's HEAD** (three.js now the
  default renderer; vehicle/building meshes, rigged infantry, and continuous
  vehicle dust/exhaust FX all draw) — see `docs/PERFORMANCE.md`, which is now
  the durable home for this evidence (the prior report lived only in a
  gitignored `.superpowers/` file, unreachable outside the session that
  produced it — `docs/superpowers/specs/2026-08-29-phase-d-todo.md` item #11).
  Same stand-in harness, real hardware GPU confirmed via
  `WEBGL_debug_renderer_info` (headless Chromium defaults to software
  SwiftShader rendering and must be launched with explicit ANGLE/Metal args to
  avoid it — a confound that cost one full mismeasurement while producing this
  note, recorded in the doc as a worked example of "state capture conditions
  with every number"), reproduced across two runs: the render budget is
  crossed around **~1,150 figures**, not lower than 420-460 — the original
  figure holds, with more margin than previously recorded, not less. The
  billboard-vs-real-shipped-mesh comparison (a quarter of a mixed 400-unit
  roster swapped from billboard to real `art/meshes/` GLBs) adds at most
  ~1ms of p95 frame time at 320 living units, nowhere near either budget.
- **The flow-field pool is bounded, since 2026-09-15** (group formations,
  `MAX_FLOW_FIELDS = 128`, `sim.ts`): `fieldFor` reuses the least-recently-issued
  field no living unit still follows once the pool is full, with a same-tick
  guard (`evictableField`) so a field created earlier in the current tick can
  never be evicted out from under the order that just created it — without it,
  a mixed-domain order (air before ground in one command) could recompute the
  ground unit's own just-issued field for the air goal before it was stamped
  into anyone's `fieldRef`. `fields` never shrinks, so a same-tick spike that
  pushes the pool past the cap is a permanent watermark, not a transient one.
  The compute heap is shared module-wide rather than per-field: on a 48×48 map
  (2304 cells) a `FlowField` instance fell from 158,976 B (dirs + cost + its
  own 8×4 B/cell heap arrays) to 11,520 B (dirs + cost only), with the 147,456 B
  scratch heap allocated once and reused by every field's `compute` call — so
  the pool at its cap costs ~1.41 MiB (128 × 11,520 B) plus that one-time
  ~144 KiB — arithmetically, 128 × the OLD 158,976 B per-field size (each
  carrying its own heap) would have been ~19.4 MiB for the same 128 distinct
  goals, unbounded and still growing.
  A group order costs at most one field per unit ordered — measured on
  `tel_marum_2_foothold`'s 9-unit force ordered into the open basin,
  `sim.flowFieldCount` went 0 → 9 (`tools/src/formation_walk.test.ts`). The 128
  cap is a FLOOR, not a hard ceiling: `packages/sim/src/sim.test.ts`'s
  `flow-field cache` tests pin that the pool may still exceed it when every
  field is live, or when the only unreferenced fields were issued this tick.
  No shipped mission has been measured to reach it.
- ~~Mesh units have no `down`/`wreck`/`work` clips~~ — **stale for INFANTRY since
  `233f683`, and the debt has moved to vehicles.** The prediction in the old text
  was right and was acted on: FK-folding the standing rig into prone did produce a
  self-intersecting heap, so `rig.py`'s `_figure_death_parts` calls
  `kit.figure(posture="prone")` for SEPARATE geometry, binds it rigidly to a
  per-figure `{prefix}_death_root`, and every clip keys both roots' scale (1/0
  living, 0/1 dead). All sixteen infantry team GLBs now carry `down` and `wreck`
  (`moto_rpg` carries `wreck` only — a motorcycle cannot go prone;
  `yahalom_engineer` also carries `work`), civilians carry `down`, and
  `units/mesh-death.ts` plays them: 0.4 s fade, then a persistent `MeshWreck`.
  **Since 2026-09-17 that is the exception, not the rule** (design
  `2026-09-17-infantry-animation-design.md`): the three Meshy bipeds carry
  `fall`/`fallAlt` (contract v4) and play them once, every other rig topples
  per figure about its own feet away from its killer over 0.5 s, and neither
  path fades — the fade survives only for evacuation and for a body with no
  wreck (civilians). Clip changes crossfade over 150 ms unless the two clips
  key different bone scales, which is decided from the bytes at load
  (`mesh-clip.ts`'s `scaleSignature`).
  Verified 2026-09-01 both from the shipped bytes and on screen — a killed
  `inf_squad` on `?sandbox=beit_sahwan_outskirts` leaves three prone figures beside
  a standing squad.
  **A mesh VEHICLE has one too, since 2026-09-15** — this entry used to say it had
  none, and that a dying mesh vehicle showed three art styles in half a second
  (3D mesh → a fading 2D sprite of the INTACT vehicle → the 2D `wreck` sprite, or
  for `mbt_lavi` nothing at all, since `TNK_HULL`'s manifest declares no `clips`
  key). What closes it is a PROCEDURAL wreck rather than authored geometry
  (`docs/superpowers/specs/2026-09-14-vehicle-wreck-design.md`): `pnpm
  wreck:meshes` (`tools/src/meshes/wreck-pass.ts`) post-processes each GLB with
  `@gltf-transform`, adding one `death_root` node whose `WRECK_<name>` children
  reference **the same `Mesh` objects** their live twins do, displaced by a recipe
  (`wreck-recipes.ts`), plus the two constant-scale clips `idle` and `wreck`
  (1/0 and 0/1) the infantry rigs already ship. Sharing the meshes is why all
  eleven files grew by **+1892…+3220 bytes** rather than by a copy of a 1.6–3.4
  MiB buffer. The pass is idempotent and re-runnable after a re-export; the Draco
  mirror is re-encoded in the same commit.
  **And since WP-A1.2 the swap is not the whole event any more.** A vehicle kill
  now dispatches a BLAST beside the wreck (`docs/superpowers/specs/2026-09-19-art-blast-design.md`):
  a pooled point light, a screen shake applied to a COPY of the camera in
  `threeCamera()`, a hit-stop inside `frame()`, a `CollapseShroudManager` cloud
  sized from the vehicle's own measured mesh bounds that covers the living-body →
  wreck swap, and a scorch mark that is permanent for the mission (a scorch and
  an oil stamp in the persistent decal pool since WP-A2 plan 1; it was
  `ScorchDecalMesh`). A mortar or Grad landing gets the same four minus the
  shroud (and a crater under its scorch), at
  `SHELL_PROFILES[kind].impactPower`. The vehicle-kill branch's outer
  mesh-readiness guard was removed to do it, so the blast fires on `&nomesh` too
  — with no shroud there, because there are no bounds to size one from.
  **Three of those five shipped INERT on this branch, and the way that happened
  is the `SPRITE_MAP` failure in a second place.**
  `blastLightSpec`/`blastShake`/`blastHitStopMs` all resolve through
  `emitterLibrary.byName('catastrophic_kill')`, and
  `data/vfx/catastrophic_kill.json` was **never imported into
  `packages/data/src/index.ts`'s `vfxEmitters`** — so `byName` answered `null`,
  each of the three took its own documented "nothing to scale" path, and only the
  scorch and the shroud (the two unconditional calls) ever ran. The file shipped,
  validated against the schema, and was read by name from `ThreeRenderer`.
  Nothing could catch it: `validate:data` walks the FILES,
  `ThreeRenderer.blast.test.ts` calls `useEmitters` with the JSON directly (which
  is better than mocking, and is exactly why that suite could not see this), and
  `vfxEmitters` was a hand-kept list. Measured rather than reasoned, by
  `pnpm blast:capture`: a hand-ticked kill read `hitStop.remainingMs` 0.0 and a
  shake offset of 0.000 px at every frame from 0 to 600 ms, and the `blast-light`
  toggle moved **0 px / 0.0000** — against the mortar's 14224 px / 5.4091 through
  the same code on the same frame, because `shell_impact` WAS in the list.
  **Fixed, and the array is pinned to the directory now**: `index.test.ts` reads
  `data/vfx/*.json` at test time and requires the registered ids to equal them
  exactly, so a file that ships without being registered is a red spec rather
  than an effect nobody can see. Registered, the same kill reads **42119 px /
  11.1762**, holds four frames of hit-stop with the FX clock at 0.0, and peaks at
  **7.971 px of shake** against an authored 9 (the 16 ms sampling grid never
  lands on the continuous 8.79 px peak). Read at test time rather than made an
  import glob on purpose: a glob would derive the array from the directory and
  make the check vacuous.
  Four things about the wreck itself are worth knowing before touching any of it.
  **The recipe is fractions of each vehicle's OWN measured bounds**, tuned
  2026-09-15 against an eleven-pair screenshot sheet
  (`tools/src/perf/wreck-captures.ts`) and recorded beside each constant. Two of
  them are counter-intuitive and were measured: the settle is a fraction of the
  vehicle's **clearance**, not its height, because the measured gap under these
  bodies is 0.000–0.363 world units and a fraction of the height buried every one
  of the eleven; and the turret is thrown **across** the hull, not along it,
  because thrown along it the turret stays inside the vehicle's own silhouette and
  the Lavi photographed as an intact tank with the gun sticking out. Every group
  is then seated on the ground plane off real vertices, so nothing sinks and
  nothing floats.
  **`addWreck` steps aside only for a type whose template carries the `wreck`
  clip** (`ThreeRenderer`). Do NOT add `vehicleMeshTemplates` to that guard
  unconditionally — that deletes the sprite wreck and leaves `&nomesh` and any
  un-passed re-export with nothing, which is strictly worse than the old bug.
  **The runtime half is `units/mesh-vehicle-death.ts`**, a rigid sibling of
  `mesh-death.ts` rather than a generalisation of it, importing that module's fade
  curve, window, `MeshWreck` cap and fog rule unchanged. A vehicle wreck therefore
  shares `MAX_MESH_WRECKS` (256) with infantry corpses. Charring is a runtime
  material treatment of anything marked `rl_wreck` — one shared charred ramp
  slice for a palette vehicle, one memoised tinted clone per distinct loaded
  material for a textured one — so **`pnpm validate:meshes` cannot see it**: that
  gate repaints every vehicle from the palette tables before rendering and says so
  on its passing path. It judges the SHAPE, two ways, against a measured floor.
  **What is still missing is real damaged GEOMETRY.** D1 in the spec: a wreck is
  the same parts slumped and recoloured, and a torn hull or a missing wheel is a
  later per-vehicle art pass that replaces a vehicle's `WRECK_` children and
  changes nothing else in the contract. The one model that ever had any is the D9
  — `d9.blend`'s seven `WRECK_` parts, deleted at export by
  `export_mesh_vehicle.py`, and `31c9799` replaced `dozer_d9.glb` with a Meshy
  export anyway. Also still open: a rigid rotor cannot droop, so `heli_peten`'s
  wreck is distinguished mostly by its charring and by losing its air lift.
- Tunnels are implemented (`feat/tunnel-subsystem`): routes are map data, a digger
  advances one and leaves surface spoil, stocked fighters surface at the vent to fire a
  volley and submerge, and a `yahalom_squad` charge collapses a route. Both content keys
  are wired: a placement's `digs` assigns its body as a route's digger, and a
  `mark_tunnel` unit with a sight line to a route identifies it — spoil or no spoil —
  so an authored mission can dig, find, and collapse a route end to end (the mission
  runtime tests prove the chain from JSON alone). The Beit Sahwan subterranean
  mission (#91) now exists — `data/missions/beit_sahwan_4_subterranean.json`, the
  first content to use the `subterranean` phase. `tunnel_travel` remains unit data
  only.
- The trail-detection scan is O(routes × living units × sight²) per tick
  (`trailStrengthFor`), on top of detection's existing O(N²) — and `markerSeeingRoute`
  is the same shape again for `mark_tunnel` carriers, though it stops scanning a
  route once identified. At the largest authored
  mission (65 units) that is ~10⁵ extra array probes a tick — immaterial now, real at the
  GDD's 300-unit target, and it wants staggering at the same time detection does.
  `drawTrail` is O(width × height × routes) at 5 Hz and belongs in the same sweep.
- ~~A civilian who boards a transport and whose transport then dies before reaching the refuge is stranded forever~~ — **fixed.** `stepCivilians` latched `civFled` before boarding was attempted and then skipped that civilian on every later tick, so one dropped by a dead carrier had no order and no way back into the loop, and could never satisfy `evacuate_before`. It is now re-ordered to the refuge when it has actually stopped — riding and walking are both left alone as progress, and an evacuated civilian is already `alive = 0`. A civilian standing on the refuge marker and still uncounted means that mission's marker sits outside its own evacuation zone, which is an authoring fault and is deliberately NOT re-ordered (it would queue one dead command per tick). Guard: `mission.test.ts`, "re-orders a civilian whose transport died".
- `starting_force` never consults a unit's `unlock` gate — `spawnPlacement` has no equivalent of the `buildBlockedReason` check `requestBuild` makes. Missions rely on this: Wadi Halam V hands out a `dozer_d9` (ROE 60) and a `demo_squad` (ROE 50) unconditionally, and Wadi Halam I–V all field a `recon_drone` (35) or an `ifv_namer` (40) a fresh campaign has not earned. Whether that is a feature or a hole is undecided; what matters is that resolving it in the obvious direction would silently strip Wadi Halam V of both demolishers, so the `seconds` deadline on its `raze` primary is what keeps that a lost mission rather than a stuck one. The motivation layer's `upgrades_to` is the sanctioned path around this, not a fix for it: `resolveUpgrades` (`packages/sim/src/unlock.ts`) checks a placement's gate once, before the runtime is built, and upgrades it rather than blocking it, so the spawner itself stays exactly as gate-blind as above and the Wadi Halam V D9 hole stands. A placement can also set `gate_only: true` beside `upgrades_to`, asking `resolveUpgrades` to DROP it while the gate is closed instead of fielding the base unit — `qarn_hadid_3_clearance`'s `jeep_shoded` only, since a 2026-09-14 ladder measured that closed-gate body as a net negative for a realistic player (naive win rate 66.7% with it vs 90.0% without over 30 seeds; sensible 46.7% vs 66.7%), unlike the other five `upgrades_to` sites. A bought unit (`unlock.price`, brigade account) counts as an open gate for `resolveUpgrades` too — `bought` is resolved by `kdfUnlockGate` from the account and is never authored.
- `mission.schema.json`'s wave `from` promises "Spawn point or tunnel id. Tunnels
  keep producing until located and collapsed", but `mission.ts:1307` resolves `from`
  through `markerPos` only — a tunnel id there is an unknown marker. Tunnel-sourced
  reinforcement waves do not exist. Beit Sahwan IV works around it with `in_tunnel`
  garrisons that vent, which is the loop the subsystem was built around; the schema
  text should either be corrected or the feature built.
- `intel.marked_positions` cannot pre-reveal a tunnel route, and after the
  subsystem's playtest it should not: it reveals units by tag (`mission.ts:942`),
  exempts buried placements deliberately, and tunnel visibility is live — a route is
  identified only while a `mark_tunnel` carrier holds a sight line, so anything
  revealed at t=0 decays to unknown unwatched. GDD §4's "thorough recon → tunnel
  mouths pre-marked" is therefore not literal, and Beit Sahwan IV honours the
  contract through the surface ambushers instead.
- `tools/src/backtest/playtest.ts` was crashing on `main` from `d46b926` until
  `b604032` and nobody noticed. Its `run()` never registered the map's tunnels with
  the `Sim`, so the moment Beit Sahwan II gained a `digs`/`in_tunnel` placement the
  whole chain died at that mission with `unknown tunnel "bs_tn_west"`, taking every
  mission below it with it. The gate was then a manual `npx tsx` script wired into
  neither `pnpm test` nor CI, which is why "all gates green" could be said truthfully
  about the tunnel subsystem while this one was red. **It is wired now** (`c05de3c`,
  `pnpm playtest` in ci.yml's `gates` job), so that particular silence cannot recur. Two consequences outlived the fix and have
  SINCE BEEN RESOLVED (see below): `beit_sahwan_breach (passive control)` returned
  VICTORY where its own comment demands DEFEAT, and `beit_sahwan_3_clearance` returned
  DEFEAT. Neither was a tunnel-era regression — checking out `066445f` (main before any tunnel code) and
  running the harness there reproduces both failures byte-identically, so the crash
  merely hid `beit_sahwan_3_clearance` for about two days, no more.
  Both are now fixed. The clearance mission lost 55 of
  its 61 points to eleven deductions for firing into the clinic -- 107 rounds of the
  Namers' `cannon_30`, which arms the zone penalty at `collateral_risk >= 0.3` where
  rifles, `coax_mg` and the Eitan's `rws_50` do not; the plan was careless, not the
  floor, and keeping the armour off the zone takes it to ROE 94. First Light's control
  did NOT fail because the mission had gone soft: scaling the waves from 36 attackers
  to 131 walked the passive run's survivors from 9 to 2 and no further while killing
  the scripted plan outright, because `survive_until` completes if anything is alive
  and sitting still is the correct answer to a siege. `3122340` had dropped
  `evac_settlements` -- the only objective requiring anyone to leave the compound --
  while leaving all eleven civilians on the map; restoring it as a primary
  (`checkEnd` reads only primaries, and `evacuate_before` is the one type that can
  reach 'failed') makes passivity lose again. **`playtest.ts` now exits 0, and it is
  wired into CI** — `pnpm playtest` in ci.yml's `gates` job since `c05de3c`. It runs
  in **4.07s** measured (no browser, no GPU, no Blender), which is why it sits on
  every push next to `pnpm balance` rather than behind a schedule the way
  golden-diff does. Not in `pnpm test`: it is a CLI harness that prints a table, not
  a vitest spec, and `pnpm test` (18.65s, 2012 specs) stays the fast inner loop.
  **What it can and cannot fail on, measured 2026-09-01.** Falsified by hand:
  setting `beit_sahwan_3_clearance`'s `take_town` hold from 20s to 1500s pushes the
  run past the harness's own 20-minute ceiling and it goes red —
  `beit_sahwan_3_clearance: FAILED — expected VICTORY, got ONGOING`, exit 1.
  But the same break at 900s took that mission from **2.5 min to 17.2 min — a 7x
  blowout, 3.4x its own `target_minutes` — and the gate stayed GREEN, exit 0.**
  The assertion is `result === expect` and nothing else, so the only duration
  failure it can express is "did not finish inside 20 minutes". A mission can
  degrade several-fold and CI will not notice. Closing that means giving the
  harness a per-mission duration ceiling, which is a design call, not a tidy-up —
  see the next bullet for why tying it to `target_minutes` is the wrong shape.
- A scripted plan in `playtest.ts` proves a mission WINNABLE; it does not measure how
  long the mission takes. The plans are optimal-play proofs, and tuning enemy volume
  until the scripted clock reaches `target_minutes` would produce missions no real
  player could finish. **Re-measured across all thirteen plans (GH-84, 2026-09-01);
  the "eight of nine, band 0.51–1.00" reading this bullet used to carry is retired.**
  It predated Tel Marum and had silently omitted `beit_sahwan_3_clearance`, and worse,
  it pooled two populations that do not belong in one band. What separates them is
  whether a primary makes the player ENDURE a clock. A `hold_for` or `survive_until`
  `seconds` is a floor on mission length; a `raze`, `collapse` or `evacuate_before`
  `seconds` is the opposite — a deadline, a ceiling on the allowance — so it does not
  set length and does not belong in this split.
  The seven missions with an endure-clock all land **0.70–1.00 of target, and 0.0–2.1
  minutes above their own floor**: `beit_sahwan_breach` 1.00 (floor 5.0, plan +0.0),
  `wadi_halam_3_counterraid` 0.93 (+0.6), `beit_sahwan_2_foothold` 0.87 (+1.1),
  `wadi_halam_5_depot` 0.87 (+2.1, the extra being the raze that precedes the hold),
  `wadi_halam_1_fords` 0.80 (+0.8), `wadi_halam_2_laager` 0.80 (+0.6),
  `tel_marum_2_foothold` 0.70 (+0.2). The plan does not beat these missions quickly —
  it runs the timer out and leaves. That is why the ratio is informative there, and why
  it tracks a real player: it is the same clock for both.
  The other six have no endure-clock and scatter 0.10–0.87 — `wadi_halam_4_village`
  0.87, `tel_marum_3_clearance` 0.50, `beit_sahwan_3_clearance` 0.36,
  `beit_sahwan_4_subterranean` 0.22, `tel_marum_1_recon` 0.13, `beit_sahwan_1_recon`
  0.10 — because each plan *hardcodes the answer the mission is about*. The recon plans
  fly the drone to the six positions by waypoint; IV drives a `mark_tunnel` carrier
  straight at a route it is not supposed to know; the clearance plans go straight to the
  HVT. The plan holds perfect information and the player does not, so its clock is a
  floor with the puzzle removed. **A low ratio on one of these six is not evidence of
  anything and must not be tuned against.** `wadi_halam_4_village` at 0.87 is why the
  scatter is scatter and not a second band: a search mission is not *required* to read
  low, so a high one is not reassurance either.
  What has NOT changed: stepping the real runtime and reading
  `runtime.result` and `objectiveList` is still the only instrument that measures
  duration at all, there is still nothing headless between the optimal-play proof and
  a fully-passive walk, and therefore **no real-player duration has ever been measured
  for any mission** — every `target_minutes` in the tree is design intent that survived
  a floor check, including Beit Sahwan IV's 6.
  One consequence of the 5–7 ceiling worth knowing before authoring: `target_minutes`
  cannot express a sequential-timer worst case. `wadi_halam_5_depot` gates `raze` at
  300s and then holds for 240s *after* it comes down — a 9-minute mechanical ceiling
  behind a declaration of 7, which the optimal plan reaches in 6.1 only because it
  razes fast.
- The elevation milestone (E1–E3) closed with three things left inert, dormant only
  because every shipped map was flat and each first reachable the moment a map
  authored relief. **`raySmoke` is no longer one of them.** A screen is now a column
  `SMOKE_RISE` levels tall standing on its OWN tile's ground, tested with `losRay`'s
  own cross-multiplied comparison, so a line passing above the plume is not obscured
  by it: on Tel Marum an observer on the western shoulder (20,16) now sees the bench
  at (24,26) across five tiles of screen his sight line clears by more than a level,
  while the same screen still stops a line drawn along the basin floor dead. Two
  things about it are load-bearing and neither is obvious. **`SMOKE_RISE` (2) MUST
  stay strictly above `EYE_HEIGHT`**, the mirror of the `EYE_HEIGHT < BLOCK_RISE`
  coupling: on flat ground the sight line sits at exactly `EYE_HEIGHT` above every
  tile, so a shorter plume never reaches it and smoke goes inert on every shipped map
  at once (falsified by hand — at 1, four pre-existing flat-ground smoke tests go
  red). And it equals `BLOCK_RISE` deliberately, so the authoring rule is the terrain
  sentence again: **smoke obscures what a building obscures, from the same places**,
  and high ground that sees over the rooftops sees over the smoke. Taller would make
  smoke a better wall than a wall. The fix is bit-identical on flat ground by
  construction, which is why **no golden hash moved and neither did `pnpm balance` or
  `playtest.ts`** — and that silence is not a blind test: the golden replay lays no
  smoke, and **no shipped mission or playtest plan lays any either**, since `smoke` is
  reachable only from the player's UI. The replay guard for smoke over non-uniform
  relief therefore lives in `smoke.test.ts`, not in `determinism.test.ts`. One clause
  of the old bullet was never reproducible and is retired rather than fixed: “smoke
  sitting on a peak will not blanket the valley below” described nothing the code did
  — the height-blind version was uniformly OVER-permissive, so every behavioural
  change from this fix is smoke ceasing to block, never starting to. `raySmoke` still
  runs before `losRay`'s loop, and that is harmless: a ray terrain blocks returns -1
  either way. Pinned by `packages/sim/src/smoke.test.ts` (`smoke and elevation`) and
  `tools/src/tel_marum_smoke.test.ts`, which also pins the map elevations it argues
  from — (24,26) reads as plain basin by eye and is two levels up.
  **The other two were walked on 2026-09-01 and neither survives as written.** Both
  were Pixi-era statements that stopped being true when three became the default,
  and both now read as live bugs to anyone who trusts this file.
  **"VFX are not lifted to terrain height", and the wreck/tracer sorting gap it
  opened, are Pixi-only.** In `three` all four layers — trails, fx, fx-above and
  wrecks — are already lifted to their own tile's ground height. The artifact was
  staged deliberately at Tel Marum's steepest drop and behind its only building,
  photographed reproducing blatantly in Pixi, and photographed drawing correctly in
  three at the identical staging. Nothing was changed because there was nothing to
  change. The Pixi half stays broken on purpose: `renderer.ts` is frozen, VFX owe it
  no parity since 2026-08-30, and `renderer.ts:2599`'s flat `isoY(...)-4` is the
  legacy path. The warning that a partial fix would be worse than none — `wreckLayer`
  sprites (`addWreck`) carry no `zIndex` at all and would sort behind every band on
  the map, not merely their own tile's — still applies to anyone who reaches for
  Pixi, and is the reason not to.
  **"Extruded terrain cannot occlude units" is backwards for `three`.** It occludes
  them through the real depth buffer, decisively — up to 85% of an infantryman.
  More usefully: the occluded-unit silhouette (band 6) **already covers terrain,
  unmodified**. It fires on every terrain-occluded tile above its ~10% threshold and
  on none of the 126 unoccluded tiles sampled. There is nothing to extend, and a
  design that set out to extend it would be rebuilding something that works.
  Picking mid-slope was separately measured working in both backends. E3's cut scope
  is the only part of that original list still standing, and slope cost has since
  shipped (T1-A).
  **One real defect came out of that walk. It is fixed, and the fix is worth
  knowing about because it could not be one number.** A unit standing in Tel Marum's
  boulder field was 48–79% hidden by the boulder decor and got no silhouette at all
  — infantry taking cover in boulders became genuinely invisible, which is worse
  than the building case the feature was built for. The cause was the depth bias,
  as reported (draw order was tested and falsified). The bias, a constant 0.75
  world units, had been sized for the FILL era's billboard artefact and never
  resized: it is larger than the **0.612** of depth a single-axis neighbouring tile
  is worth, so it swallowed every occluder nearer than about a tile and a quarter —
  a boulder sharing a unit's own tile included. Across `tel_marum`'s 1550 open
  tiles, **ten** hid 25–73% of a rifleman and outlined none of it; all ten were in
  the boulder field.
  **The two silhouette paths now carry different biases, deliberately.** The MESH
  path's artefact is the outline ring, whose size is the outline's own width — a
  fixed number of SCREEN pixels, so 7x wider in world units at zoom 0.35 than at
  2.5. Its bias is therefore `2.5 x silhouetteOutlineWorldWidth(zoom)`, retuned per
  frame; the multiple is 2 by derivation (this camera's 30-degree pitch means a ring
  fragment `d` below the feet sits over ground `2d` nearer) plus a measured margin.
  The BILLBOARD path's artefact is the ground-clipped QUAD, fixed in world units
  because a sprite's world size does not change with zoom, so it keeps the 0.75
  constant — applying the mesh number there was measured to grow 5–126 false pixels
  at a rifleman's feet. Only the GLSL is shared. Nothing is lost by the split:
  **`&nomesh` draws no decor at all**, so the boulder case cannot arise on it.
  One pre-existing defect was found while proving that and is NOT fixed: on
  `&nomesh` at the shipped 0.75, a billboard `mbt_lavi` on open flat ground already
  draws 75–432 false silhouette pixels along its hull base, at every zoom.
  Photographed. Clearing it needs ~1.1 world units, which would swallow real
  occluders a tile and a half out — a worse trade, so it is recorded rather than
  traded blind. See `.superpowers/queue/boulder-silhouette-report.md`.
- Tel Marum's narrow saddle is **closed to armour and still the cheaper road on foot**, and
  what priced the armour half was terrain rather than fire. The corridor at x=10-11, y=12-17 is a boulder field (`b`) now, with a
  small scree apron on the valley floor at its mouth (x=9-12, y=18): open ground on foot, a
  wall to anything wheeled or tracked. Measured through the real `FlowField` on the shipped
  map, crossing the wall there costs a rifleman **8 tiles** before and after, and a vehicle
  **8 -> 28**, because the only remaining gap in the wall is the guarded wide saddle. The
  whole flank route start line -> corridor -> battery is **48 tiles on foot** against 38
  through the pass, and **no route at all** for armour. The shortest route to the battery is
  **38 for both domains, unchanged** -- the mission's own axis was deliberately not touched,
  and if that number ever moves the field has leaked onto it. Committing the whole force to
  one route is therefore structurally impossible: the split the design always wanted is
  enforced by the ground instead of hoped for.
  Two figures this bullet used to carry were wrong and are corrected. The flank is **+10
  tiles (38 vs 48)**, not +9 (38 vs 47) -- measured five ways, every waypoint through the
  corridor gives 48; `tel_marum_3_clearance`'s briefing said nine and now says ten. And
  **no sight fact moved**, because `b` is deliberately not sight-blocking: every `sees()`
  assertion in `tools/src/tel_marum_doctrine.test.ts` passed unchanged when the field
  landed. `pnpm balance`, the golden determinism hash and all nineteen `playtest.ts` lines
  are identical before and after -- no shipped plan ever drove a vehicle up the corridor
  (mission I's drone is `domain: air` and flies over boulders), so the field costs the
  optimal-play proofs nothing and closes an exploit they never used.
  The fire-based half is now settled, and not in the direction this bullet used to point.
  Measured over ten seeds with the armour's orders held byte-identical in both arms and only
  the foot's route changed (`tools/src/backtest/saddle-price.ts`): through the pass costs
  **1.20 losses a run**, up the corridor **0.30**, on the same 3.54-minute clock —
  **all three numbers measured before group formations (2026-09-15); `saddle-price.ts`
  issues group orders, which now land in formation instead of converging on one point, so
  they may not reproduce.** The pass
  kills the men -- seven of those twelve deaths are the `mortar_team` -- and the corridor
  kills nobody on foot at all; its three deaths over ten seeds are every one of them armour,
  lost in the pass fight the foot walked away from.
  The authored answer -- let the Grad at `battery_position` charge for it, since it reaches
  the corridor at 17 tiles and `rocket` is in `INDIRECT_MASK` (`sim.ts:244`) so it needs no
  sight of its own, while `selectTarget` (`sim.ts:2887`) gates each shot on **per-side**
  identification -- still does not work, and **`selectTarget` is not why.** That was the
  recorded leading explanation and it is now disproved: hand the Sarim side contact and the
  battery shells the man in the corridor on its very next reload, three rounds in two
  minutes, every time. Its rule is `hurts` first and then nearest, so a flanker is not
  immune, only LAST IN THE QUEUE -- with a decoy at [24,13] the battery spends three rockets
  killing that and turns west on the fourth. Both halves are pinned as behaviour, not prose,
  in `tel_marum_doctrine.test.ts`.
  What actually fails is the observer, and it is geometry rather than tuning. **Every post
  that can see the corridor stands inside the corridor's own weapons.** The only sightlines
  into a straight slot in a rock wall run along its axis, so distance along that axis IS the
  standoff: at `sarim_rifles`' sight 9 the best standoff for seeing even ONE of the twelve
  corridor tiles is 9.0 and for ten of them 4.0, against an 8-tile rifle and `at_team`'s
  9-tile Spike. `tm_spotter_narrow` at [12,4] sees **2 of 12** -- the north exit row and
  nothing below it, exactly as its briefing says -- and moving it to the best sight-9 post
  ([11,8], 10 of 12) changes the mission by **nothing at all**: 0.30 either way, because the
  flank shoots it off its hill at 48 s instead of 59 s. Nor does a longer lens help:
  `manpad_team` is the roster's best standing eye at sight 12 and still buys only 9.2 tiles
  of standoff for half the corridor, and every observer variant measured -- moved rifleman,
  manpad at 6/12, manpad seeing all twelve -- returns **0.30, unchanged**. The ceiling shows
  the idea is sound and merely unreachable: unkillable permanent contact on the corridor
  takes it to **1.20, exactly level with the pass**, and turns the corridor's dead into
  infantry. The binding constraint is `grad_122`'s `rof_per_min: 2` -- one round per 30 s --
  against a battery dead by ~155 s in every plan that presses the pass. Nothing that can
  watch a two-tile defile lives the ninety seconds three rounds would take. **So do not add
  a spotter**, and do not read the shipped one as broken content: it buys the Grad exactly
  the one round at the corridor exit that the briefing promises. Closing the rest needs
  something that SHOOTS the corridor rather than something that watches it, which is a
  design call and not a bug. A trigger cannot do it either -- the schema's `do` vocabulary
  is commit/withdraw_to/spawn/reinforce/dismount, with no reveal, so it would take
  `mission.ts`.
  Two sight facts stand unchanged: **nothing north of the wall can see the hollow** -- 841
  open tiles see [24,29] and not one is at y <= 17, so the hollow is dead ground twice over
  -- and the corridor is **not** watchable from its own mouth at [8,9]. Both were drawn
  wrong by eye first. `tools/src/tel_marum_doctrine.test.ts` pins all of it, the per-domain
  routes included, each one paired against the same map with the boulders turned back into
  '.' so that "the vehicle went round" cannot pass for the wrong reason.
  Three traps for anyone re-running this. Isolating a unit by removing its garrison entry
  corrupts every later unit's RNG stream -- kill it at t=0 with `debugKill` (`applyDamage`
  is private), or mutate the entry in place at the same array index, which leaves entity ids
  and streams untouched. Rerouting only `mbt_lavi` or only `ifv_namer` reproduces the wide
  result exactly, because either wins the pass fight alone. And the earlier "wide 3.5 /
  narrow 5.2 / narrow-with-the-spotter-dead 5.1" reading is retired: those runs held the
  flank at a waypoint until t=130 s, some 90 s later than a direct order puts it in the
  corridor, so they measured the halt and not the route.
