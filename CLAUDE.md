# CLAUDE.md

Working instructions for this repository. Read `docs/GDD.md` for *what the game is*; this file is *how to work here*.

---

## Project

**Roaring Lions** — source-available dimetric RTS in TypeScript. Deterministic simulation, data-driven content, realistic combat resolution.

**One renderer: three.js.** It became the default at Phase D (2026-08-30), and
the PixiJS backend, `?renderer=pixi`, the `&nomesh` billboard path and the
sprite sheets were retired at WP-A3.3 (2026-10-04, GH-189). The `Renderer`
interface in `packages/render/src/api.ts` stays: it is still what keeps `app`
off backend-only members, checked by the compiler rather than a grep.
`?renderer=` and `&nomesh` are accepted and ignored, so old links do not warn.
See "The three.js backend" below before touching anything under
`packages/render/src/three/` — it has its own rules.

The combat model is the product. Everything else is scaffolding around it.

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
  render/   renderer + VFX + audio — imports sim types read-only. `app` holds
            the `Renderer` interface (api.ts), never `ThreeRenderer` directly;
            the concrete class is reached only by dynamic import in main.ts.
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
pnpm validate:meshes  # the art gate: palette + silhouette IoU on art/meshes/**, rendered headlessly
pnpm kit:meshes       # graft art/parts/kit/<id>.glb into the vehicle GLBs (vehicle order: rescale -> running-gear -> kit -> wreck -> damage -> encode)
pnpm damage:meshes    # cut real damage into the WRECK_ twins (after wreck:meshes, before encode:meshes)
pnpm kit:capture      # in-game kitted-vehicle sheets, the `kit` toggle reading, the garage turntables
pnpm validate:ui      # no colour literals AND no bare chrome strings in UI source
pnpm ui:routes        # drive the shell: one JS realm, two missions, no reload (CI only, ~130 s there: never run it locally)
pnpm balance          # headless battle sim, prints win rates
pnpm versus:probe     # report-only: who wins a versus map when both seats attack-move (west/east, KDF/Sarim); the bar for opening a map (#561)
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
has learned: one eight-task branch found **nine separate checks unable to
fail**. The shapes repeat, so check yours against them (each instance,
with its file and numbers: `docs/agent-notes/falsification-casebook.md`):

- it normalised by the very thing it measured, so it read zero for every input;
- an identity (`x * 1.0 == x`), or a right-hand side the check recomputed itself;
- it gated a residual that later code forces to 1 (gate the multiplier, which nothing normalises);
- the "independent" oracle imported its arguments from the code under test (oracles take literals);
- it returned an empty array and every caller looped over it, so everything passed vacuously;
- it measured one file, one plane, or a team and not its members;
- it was a comment claiming an assertion nobody ever wrote.

Two corollaries. **A green gate is evidence about the gate, not about the
thing it guards, until someone has watched it go red** — so a new gate arrives
with its falsification in the commit message or it does not arrive. And **the
cheapest falsification is a one-line mutation of the implementation, not a
synthetic fixture**: 31 mutations across three files, 30 red, is what "this
gate works" looked like in practice here, and the one survivor was disclosed
rather than papered over.

---

## Adding content

The full text of this section, with its history and measurements, is in
`docs/agent-notes/adding-content.md`.

**A unit:** JSON in `data/units/`, validated against `unit.schema.json`. It must pass `pnpm balance` within the cost-curve tolerance band. It needs a GLB under `art/meshes/` (with its `.blend` source) that survives `pnpm validate:meshes` (the silhouette IoU check included), an entry in `packages/app/src/mesh-catalogue.ts`, and a Blender portrait from `tools/render_unit_portraits.py`. `tools/src/mesh_roster.test.ts` fails if any unit id has no GLB on disk, a vehicle lacks `idle`/`wreck`, or a team lacks `down`/`wreck`. A priced unit with no art yet is staged in `docs/campaign/special_units/<wp>/`, fitted on CI via `validate_balance.py --also` and guarded by `tools/src/e5_staged.test.ts`. It moves to `data/units/` in the same commit as its art.

**A mission:** JSON in `data/missions/`, validated against `mission.schema.json`. It must declare its ledger contract, `requires` and `produces`. `target_minutes` is 5–7 and the schema enforces it. The one named exemption is `beit_sahwan_0_tutorial` at 12, which declares a backstop, not a length. Nothing in the runtime reads `target_minutes`. A mission must also declare `time_limit_s`, at least twice `target_minutes`. Running out with a primary open is a defeat whose `defeatCause` is `withdrawn`. That is an internal id: no player-facing string says "withdrawn" (guard: `player-wording.test.ts`). `validate:data` (`tools/validate_time_limit.mjs`) holds the floor and a 60 s clearance over every primary deadline. `pnpm playtest` holds a 120 s and 20% margin over the slowest 30-seed win.

**A VFX emitter:** JSON in `data/vfx/`, validated against `vfx_emitter.schema.json`. Palette keys only, never raw hex. Register every file in `packages/data/src/index.ts`'s `vfxEmitters`: an unregistered emitter is silently inert (`index.test.ts` pins the array to the directory).

**UI:** colour comes from `data/palette.json` like everything else. A Vite
plugin publishes it as `--rl-*` custom properties; `packages/app/src/ui/theme.css`
is the only file allowed to name one, mapping them to semantic tokens (`--ink`,
`--bad`, `--band-mission`). Everything else uses the semantic names or the
`.rl-good`/`.rl-bad` classes. `pnpm validate:ui` rejects a hex or `rgba()`
literal anywhere in UI source, with no allowlist — use `color-mix()` for
translucency. Fonts are self-hosted in `assets/fonts/`; never a CDN.

**A map's versus rules:** `data/versus/<map>.json` (`versus_rules.schema.json`), each end's camp and the income zones for a KDF v Sarim room; one file per matchup map.

**A map:** JSON in `data/maps/`, validated against `map.schema.json`. It is a character grid (`.` open, `1`–`3` cover, `#` building, `^` rock ridge, `b` boulder field) plus named markers and zones. The loader is `parseMap` in `@lions/data`. `applyTerrain(map, sim)` is the one way its mechanical layer reaches a `Sim`; never write another cover loop. Rules a change will get wrong:
- `^` is the only blocked tile that is not a building: impassable, sight-blocking, and with no HP, garrison or ROE penalty.
- `b` is open ground on foot and a wall to anything wheeled or tracked, and nothing else: no cover, no sight-blocking, no HP. It is carried by a second blocked mask (`blocked | boulder`). On a map with no `b` the two masks are the SAME array.
- "Vehicle" means `mobility.wheeled`, an authored boolean that defaults to `!FOOT_ROLES.has(role)`. **`FOOT_ROLES` alone is wrong, both ways**: `rocket_battery` and `dozer_d9` set `wheeled: true`, and `manpad_team` sets `wheeled: false`. `tools/src/boulders.test.ts` pins all three.
- The optional `elevation` grid has one digit 0–9 per tile, with the same dimensions as `rows`. Line of sight reads it. Every blocking tile stands two levels above its own ground. A low-profile obstacle never blocks sight, though the ground it stands on can. Two levels are needed to obscure ground troops. Elevation changes what you can see over, never how far.
- Pathing charges `UPHILL_PER_LEVEL` (tuning.ts) per level CLIMBED; descending is free. A climb telescopes, so slope only reorders routes over ground that rises above its destination and comes back down. Flipping the sign changes no route. The mirrored cost pair in `packages/sim/src/flowfield.test.ts` is the only guard on that sign.
- `qarn_hadid` is the only map with all ten terrain symbols (the only `3` and `d` tiles). `tel_marum` is the only map with `b`. Before authoring relief, read `docs/agent-notes/maps-and-terrain-design.md`: a 16-tile bowl reorders nothing, and cover 2 and cover 3 are not separable in a duel.

**A campaign or town arc:** design before JSON. Three design agents in `.claude/agents/` run in order: `campaign-designer`, then `narrative-designer`, then `level-scripter`. They hand to `mission-author` and `playtest`. They write against the contract in `docs/campaign/README.md`; the story is `docs/campaign/storyline.md`. The only text a mission can show is `name`, `briefing`, `objectives[].text` and a trigger's `label` (≤ 48 characters, no full stop). An unlabelled trigger shows nothing, `remove` triggers are silent, and `validate:data` refuses a shipped non-`remove` trigger without a label.

---

## What not to do

- Do not add a game engine, ECS library, or physics library. The sim is hand-written on purpose; determinism cannot be delegated.
- Do not add floating point to the sim, even "just for this one calculation."
- Do not let VFX, audio, or UI state influence simulation outcomes.
- Do not write mission logic as TypeScript. Missions are declarative data; if a mission needs a behaviour the schema cannot express, extend the schema.
- Do not use per-unit A* pathfinding. Flow fields only.
- Do not commit a mesh (GLB) without its `.blend` source, and never re-create
  `assets/sprites/` -- the sprite renderers refuse to (`tools/sprites_retired.py`).
- Do not commit assets from paid packs (Synty included, even if you own a licence),
  or anything you cannot point to explicit redistribution rights for. This applies to
  audio exactly as it does to art.
- Do not ship AI-generated art without disclosing it in the PR description. Generative
  tools *are* permitted, including for assets that ship; the `validate:meshes`
  checks apply identically regardless of origin. See `CONTRIBUTING.md`.

---

## House rules

The lead's standing rules. They bind every agent and every subagent.

- Never pkill or killall, and never kill a dev server.
- Port 5177 is off-limits: it is the lead's dev server. Use your own port (`--port=`).
- No local `ui:routes`, `golden-baseline` or `ui:shots`, and no other heavy browser walk: CI runs them. At most one Metal browser check, on your own port, with music off.
- One browser at a time.
- Never `git add -A` (use `git commit -- <paths>`): concurrent sessions share the working tree, and their in-flight files end up in your commit.
- Never `git checkout <file>` to revert an edit: it destroys uncommitted work. Undo the edit, not the file.
- Test browsers start with music off, through `tools/src/ui-review/music-off.ts` (`musicOffInitScript()`, or `SILENT_AUDIO` for all channels). Never write `lions.settings` by hand: `parseSettings` throws away any object whose `version` is not 1.
- Write issue refs as GH-NNN, never #NNN: the UI palette gate reads #561 as a hex colour.
- No deploys, secrets or production.
- Meshy only within a budget the lead approved: the lead approves art numbers before ANY render or Meshy call. Announce each call's credits in the ledger first.

---

## Current milestone

The live programme ledger is `docs/HANDOVER.md`: read it for the current stage, milestones and gates.

---

## Where the detail lives

This file holds the rules. Measurements, histories and reasoning live verbatim
in `docs/agent-notes/`; read the one for an area before changing it:

`falsification-casebook.md`, `adding-content.md`, `shell-and-ui.md`
(telemetry, router, disposers, i18n, storage, harnesses), `sim-and-orders.md`
(garrisons, orders, credits, ROE, production, wounds), `sandbox.md`,
`maps-and-terrain-design.md`, `pose-and-plate-tools.md`, `renderer.md`,
`terrain-rendering.md`, `visual-gate.md`, `mesh-units.md`,
`campaign-board-and-scene-host.md`, `scaling-debts.md`, `mission-findings.md`
(tunnels, loans, playtest limits, smoke, Tel Marum).

---

## Tool, browser and worktree rules

Each has cost a session or a false green.

- **Ports.** `ui:shots` and `ui:routes` take `--port=<n>`, else `UI_SHOTS_PORT` / `UI_ROUTES_PORT`, else 5176 / 5177. A port that something else already holds is REFUSED (exit 2). 5177 is also the lead's everyday dev server.
- **State capture conditions with every visual number** (GPU backend, resolution, tick). `ui:shots` picks Metal on macOS and SwiftShader elsewhere (`--gpu=`) and prints what it got. Compare a capture only with one from the same backend.
- **SwiftShader is slow.** A tool that clicks off a LIVE menu needs about 20 s of headroom for that click. Headless Chromium defaults to it: a performance number needs explicit ANGLE/Metal launch args, confirmed through `WEBGL_debug_renderer_info`.
- In Blender tools, never use `mathutils.noise`: Blender 5.2 randomises it per process. Hand-roll the noise.
- **`pnpm validate:meshes` walks `art/meshes/` with no filter**, untracked files included, so a stray scratch GLB in a shared worktree fails your run. Check `git status art/meshes/` first when it goes red. It needs Blender on PATH, or `--blender` / `BLENDER_BIN`, and fails loudly without it.
- **eslint walks build output.** Put browser-check builds in `dist-*/` (ignored, like `**/dist/**` and `.superpowers/**`).
- **jsdom `localStorage`** has differed by Node version. A spec that needs a counting store installs its own. UI code that reaches storage must guard it, because with site data blocked the property access itself throws.
- **Harness scripts must EXIT.** Kill the dev server's process GROUP (`detached: true`) and destroy the pipes (`stopDevServer`, `exitWith`), or a CI step hangs for 40 minutes.
- **`git diff` cannot see a new file.** A "did anything change" guard uses `git status --porcelain -uall`.
- No `touch main.ts` after adding an asset: `packages/app/vite-plugin-asset-watch.ts` derives the watched directories from source (printed at `pnpm dev` boot). Never replace it with a hand-kept list.

---

## Dev instruments

**Hosting, telemetry, feedback**
- The playable build deploys to Cloudflare Workers from `main` (`wrangler.jsonc`). The game sends events to `/api/events` ONLY from a production build on a real host, or with `?telemetry`. Never from `pnpm dev`, tests or CI, because `pnpm ui:routes` fails on any console error. `?tester=<name>` labels a tester and `?notrack` opts out. `/stats` needs `STATS_PASSWORD`: make it long and random, not a memorised phrase. It answers 403 until that secret is set. Spec: `docs/superpowers/specs/2026-09-24-telemetry-design.md`.
- `POST /api/feedback` (GH-464) is a PUBLIC write endpoint: capped, origin-checked and rate-limited. Its meta schema `data/schemas/feedback.schema.json` has a Worker twin, `packages/worker/src/feedback-meta.ts`. The kill switch needs no app deploy: the "Close feedback" button on `/stats/feedback`, or `FEEDBACK_CLOSED`. The prefilled GitHub issue URL never carries a token, or the tester's name or contact. Spec: `docs/superpowers/specs/2026-10-08-in-game-feedback-design.md`.

**The shell**
- Screens are PATHS on a router (`packages/app/src/shell/router.ts`): `/`, `/campaign`, `/brigade`, `/free-play`, `/free-play/<map id>`, `/mission/<id>`. The old query URLs (`?campaign`, `?brigade`, `?sandboxes`, `?sandbox=<map>`, `?mission=<id>`) redirect onto them with their flags, so query forms in docs and tools still work. **No screen spells a path**: `shell/links.ts`'s `routes` is the only place one is written. A mission is left SOFTLY (`req.navigate`), like every other screen.
- **The disposer contract.** Every `show*` returns a `Disposer`. The router calls it and then empties the stage, so **the stage's own children are the only thing the router removes**. Anything a screen mounts on `document.body`, and any `window` listener, interval or renderer, is taken down by the screen that made it, in its own disposer. Register the teardown where the thing is CREATED, make it idempotent and identity-scoped, and consult `disposed` in anything that can still complete afterwards (`onWindow`/`onAbort`). Confirm dialogs: `confirmDialog` returns `{ answer, close }`, and `Router.unmount()` and `bootBattlefield`'s teardown both call `closeOpenDialog()`. Skipping that once left a capture-phase `keydown` guard swallowing every game key.
- `pnpm ui:routes` (`tools/src/ui-review/routes-check.ts`) is the only instrument for the above. It runs in CI (the `visual` job).
- **Every chrome string goes through `t()`**, and `en.json` is the catalogue. `__lionsI18n.missingKeys()` reads back missing keys. `?lang=<id>` is session-only. `?pseudo=1` brackets every string, so **an unbracketed word in a pseudo capture never went through `t()`**. **Never resolve a label table at module load**: use getters or accessor functions (`ui/role.ts`'s `ROLE_LABEL`, `ui/grade-copy.ts`). This has shipped wrong twice. `validate:ui`'s i18n regex cannot see a string that reaches a sink through a VARIABLE, so a clean run is not proof. Mission text is data, overlaid from `data/locales/<lang>/missions.json`, and deliberately not pseudo-transformed.
- `localStorage` keys. `lions.settings` (`settings.ts`) has one reader and writer, and only it writes `--ui-scale`, `--text-size`, `data-motion` and `data-cvd`. `lions.saves` (`profile.ts`) slots snapshot all THREE campaign keys (ledger, brigade account, tutorial flag), and a storage refusal partway through a load is surfaced, not swallowed. `lions.brigade.account` (`brigade-account.ts`, the only reader and writer) survives `?fresh` on purpose.
- Escape opens the pause menu (`ui/pause.ts`) and only opens it. The modal then owns Escape (`isDialogOpen()`). The sim stops, the frame loop does not, and only the pan keys pass through (`passesThroughModal`).
- There are four team-colour sets (`reserved.team.variants` in `data/palette.json`). Resolve `team.*` through `variantAwareResolver(variant)` / `paletteTeamColors(variant)`. Before changing a team colour, read D-22 in `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md`.
- `pnpm ui:shots -- [--pseudo] [--res=…] [--out=…] [--port=…]` photographs every shell screen at three resolutions. Its overflow output is a REPORT, deliberately not a gate.

**Sim rules worth knowing from outside the sim**
- **Garrisons.** A garrisoned unit fights with `garrison_cover` (structure JSON, default 3), not the tile's cover. Range, sight and the line of fire start at the window (`eyePoint`), lifted `floors - 1` levels. Its position stays the centroid. Tunnel and route spotting, breach reach and the ambush spring still measure from the centroid. `fires_from_building` defaults true. `validate_data` requires `false` on a mortar or rocket weapon of a unit that can garrison, and refuses a garrison stance on a unit without the `garrison` ability (`tools/validate_garrison.mjs`). `GARRISON_RANGE_BONUS` adds 1 tile to max and effective range only. **`pnpm balance` is blind to garrisons**; `tools/src/backtest/garrison-probes.ts` is the report-only instrument.
- **A right-click on an identified enemy is an `attack` order** (GH-420), not an attack-move. The sim's public `canFocus` and `focusHurts` are the app's only filter: **do not re-derive "can it hurt that" in `intents.ts`**. The pick uses `ORDER_PICK_RADIUS_TILES` (0.5), not the left-click's 1.2. Shift keeps the appended attack-move. A garrisoned unit keeps its post.
- **Production** is a serial line per camp, keyed by side (`packages/sim/src/production.ts`). The price is paid at queue time and refunded in full on a cancel. The clock pauses while a ground enemy contests the exit. `requestBuild`/`canBuild`/`cancelBuild`/`setRally`/`clearRally` take `(…, line?, side = 0)` and travel as `Command`s. Fire support and field works stay dropped in every versus room. **No shipped mission gives side 1 a camp (D7), and `validate:data` refuses `enemy.production` on one while D7 stands.** Numbers: `docs/campaign/economy/production-numbers.md`.
- **Wounds and rescue (GH-707) are ENGINE-ONLY until P3.** No shipped content uses a wound field. Wound columns fold into `hash()` only once a wound-related type is registered (`woundLive`), so no pin moved; `WOUNDED_WORLD_PIN` is the replay that sees them. Spec: `docs/superpowers/specs/2026-10-22-wounded-rescue-design.md` (its §0 rulings win).
- **Brigade credits** pay only for improvement within THIS campaign, and only for an OPEN mission. The tutorial pays nothing: gate on `mission.ledger.produces`, not on a name list. `creditsFor` (`packages/sim/src/credits.ts`) is never called by the sim. Upgrade tiers go through `@lions/data`'s `applyUpgrades` before `addUnitType` in the app, the playtest harness and the backtest alike, so the sim never learns a tier exists. `pnpm playtest` pins `LADDER_CREDITS`.
- **ROE.** `m` civic-hall tiles exist only on `beit_sahwan_outskirts`, `marj_perimeter` and `wadi_halam_basin`. The protected-target X keys on the structure's `roe_penalty`. Tel Marum's `#` buildings are the costly tier, not protected.
- `pnpm balance` runs the §5.7 backtest; `tools/src/backtest/urban-only.ts` is the fast urban-ratio loop. Combat tuning lives in `packages/sim/src/tuning.ts`, and §5.7 targets outrank §5 formula text. The determinism golden hash in `packages/sim/src/determinism.test.ts` changes only when sim code or tuning changes deliberately. Update it in the same commit and say why.

**Sandbox and console**
- `window.__lions` is defined by the battlefield alone (that is how a tool tells a mission booted). It offers `step(n)`, `sim`, `renderer`, `goto(marker)`, `units()`, `sel([id])`, `cursorKey()` (a DOM read on purpose) and `help()`.
- `?sandbox=<map id>` walks any shipped map with a full task force. Its flags (`&roe`, `&tunnel`, `&sur`, `&civ`, `&ditch`, `&kit`, `&decals`, `&tod=`) each add only what they name. They are sandbox-only, and a dev flag must never change how a real mission scores. The flag table `packages/app/src/sandbox-help.ts` is the single source for parsing, help text, unknown-parameter warnings and the `/free-play` picker. Prefer `__lions.help()` to this file.
- `&civ` drives the mission's own `CivilianFlight` (`packages/sim/src/civilians.ts`). Never write a second implementation in `packages/app`, and never write `alive = 0` from outside the sim (invariant 4). The arrival zone is always a synthesised 4×4 around the refuge point.
- `pnpm meshy -- <command>`: estimate before you spend, and keep the key outside the repo (`docs/ART_PIPELINE.md`).
- Poses: `tools/render_clip_pose.py` for the authored pose, `tools/src/perf/gait-captures.ts` for runtime behaviour (it refuses to finish if no intercepted GLB differed). `pnpm plates:units` runs one browser per unit, and `--metal` is opt-in.
- **The drone swarm and the Remetz laser (E6, GH-274).**
  - A `drone_swarm` entity draws as one instanced batch (`units/swarm-batch.ts`), never a clone.
    The lost member is always the highest slot, and the beam ends on slot `live-1`.
  - The beam (`units/beam-batch.ts`) reads `sim.beamState` plus the `beam` event. Its shimmer lives
    in `fog-pass.ts`, and heat shows on the card only.
  - Draw calls: +7 at most, fixed. Debug layers: `swarm`, `swarm-wrecks`, `beam`, `beam-shimmer`.
  - The witness is `pnpm e6:capture` (port 5179, Metal), with readbacks `__lions.swarmDrawn` and
    `__lions.beamDrawn`. Spec: `docs/superpowers/specs/2026-10-24-e6-swarm-beam-art.md`.
- `main.ts` holds a `Renderer` (`packages/render/src/api.ts`), never the concrete class. Ask for projection (`renderer.worldToScreen`) rather than recomputing it: `project.ts` is not exported.

---

## The three.js backend

three.js is the only renderer, loaded by dynamic import. A unit whose GLB fails to load, or a vehicle GLB with no `wreck` clip, draws a team-coloured proxy box beside a `console.error` naming the file. It never draws as nothing. Read the previous phase's outcome doc in `docs/superpowers/specs/` first. Full record: `renderer.md`, `terrain-rendering.md`, `visual-gate.md`.

**Rules specific to this backend, each of which has already cost a bug:**

- **There is no kit mark in the world, on purpose.** The lead rejected one on sight. Kit reads on the unit ICONS (`kitIconSignHtml`, DOM). Do not reintroduce a world overlay for kit without the lead.
- **`three` may only be imported under `packages/render/src/three/**`**. eslint enforces it, subpaths included. `tools/` is exempt.
- **Colour pipeline.** Output is `SRGBColorSpace`, with ACES at exposure 1.0 in `OutputPass`, and every world material is a `MeshStandardMaterial`. Vertex and shader-uniform colours must be LINEAR (`hexToLinear`). Ground albedo textures stay `NoColorSpace`, because they are ratios. Every base-colour map is `SRGBColorSpace`: leave the loader's stamp alone. Decals need the composer's HalfFloat target, so the raw-renderer path without the composer is not supported. The per-pixel palette guarantee is retired; the palette is still the source of every AUTHORED colour.
- **The sun is a SIDE light**, `SUN_DIRECTION` `(-0.406, 0.819, 0.406)`. Do **not** re-derive it from `build_lights`' lamp, whose rig convention puts the light behind the subject. The shadow box follows the camera (`shadow-fit.ts`), but its depth stays map-wide, and `photographGround` takes the map-wide box.
- **`units/render-order.ts` is the single source of truth for every `renderOrder`.** Read it before setting one. Set ground decals by `DECAL_PERSISTENT_RENDER_ORDER` / `DECAL_FADING_RENDER_ORDER`. Moving either into an FX band paints the mark over the unit standing in it.
- **The occlusion silhouette is an outline.** Use `BackSide` on the mesh path, not `FrontSide`. Keep its width constant in SCREEN pixels, multiplied by `MESH_UNITS_PER_TILE` in object space. Its depth bias, `2.5 x silhouetteOutlineWorldWidth(zoom)`, is retuned per frame.
- **Own units in smoke keep their outline** and enemies never do, because smoke is cover. Unit surfaces take per-role roughness/metalness (`units/unit-surface.ts`), with metal capped at 0.45 because there is no environment map.
- **Projectiles.** Every shot draws a travelling round (`units/shells.ts`), through two `ShellBatch` instances chosen by `SHELL_PROFILES[kind].indirect`. `PROJ_SPEED` is COPIED into `units/missiles.ts`, never exported; a test pins the copy against `tuning.ts`. Impacts fire on the FRAME clock (`shellHasLanded`), not off the sim's `impact` event. `screen_shake` in the emitter schema is read by nothing.
- **Bloom** affects only effects told to exceed 1.0. HDR gains live in ONE table, `units/hdr-gains.ts`, applied to palette keys, never a raw hex. Flipbook atlases are DATA (`NoColorSpace`, no premultiply), baked with hand-rolled noise.
- **Overlays scale with zoom, and that is faithful.** Changing it is a design decision.
- **`preserveDrawingBuffer` must stay off** in shipping code, so canvas readback is black by design. To photograph from inside, use a render target (`ThreeRenderer.photographGround`).
- **Selection rings.** `ELLIPSE_BY_TYPE` and `RADIUS_BY_TYPE` are GENERATED by `tools/src/perf/unit-footprints.ts`: never hand-edit them, and do not widen the 0.02 burial bound. Captures assert no selection and no hover.
- **A debug toggle that only holds until the next frame is not a measurement.** If a layer's visibility is re-asserted every frame, it needs a flag those writes consult, as `unitsDebugHidden` does.
- The quality preset (`high`/`medium`/`low`, `packages/render/src/quality.ts`) applies at the next mission's BOOT. `high` is pinned to the pre-preset constants, so the baselines did not move.

### Ground and terrain

Full record: `terrain-rendering.md`.

- The ground is smooth: Catmull-Rom over tile CENTRES. A tile is a terrace iff `blocked[tile] !== 0`. The sim reads only the integer grid. Anything standing on the ground samples the drawn surface through `ground-height.ts`, never a tile corner.
- Ground textures are `NoColorSpace` with plain `RepeatWrapping`. **Never mirror-tile them.** For a texture, the image fed to Meshy is the asset.
- The control map (`terrain/control-map.ts`). `wallAlbedo` is the one per-vertex surface fact left. Terraces stay hard. Road tone lives in the shader: put it back in the vertex and roads step at every tile edge. `buildControlMap` reruns only when its inputs change. It compares the decor array by reference and the draw mask and `cover` by CONTENT, and both halves are load-bearing. A structure collapse SPLICES (`terrain/incremental.ts`), byte-identical to a full build. In the ground shader's road block, keep the `textureGrad` derivatives OUTSIDE the branch.
- Ground decals: one pool class, two instances, aged on the SIM clock. `stampGroundDecal` is the one entry. `&decals` is sandbox-only. The sag lift is capped at `DECAL_LIFT_CAP`.
- `SCATTER_DENSITY` (0.75, settled and lead-accepted) scales grass and sand only. Props ship zero materials and are coloured at LOAD from `prop-role.ts`.
- Foliage sway uses the SIM clock (`presentationSimMs`), never accumulated wall-clock `dtMs`.
- Haze lives in the fog pass, before the shroud mix. Relief read and tell crowns are presentation-only, and `CROWN_LIFT_LEVELS === BLOCK_RISE` is pinned. The APP reads `time_of_day` (`timeOfDayOf`); never add it to the sim's mission type. `&tod=` is sandbox-only, and a mission's own value wins.

### The visual gate

Full record: `visual-gate.md`.

- `pnpm golden-baseline` (`tools/src/ci/three-baseline-gate.ts`) diffs three.js captures against a committed baseline in `tools/golden-baselines/<envKey>/`. It runs in `ci.yml`'s `visual` job on every PR and every push to main, plus a nightly. Read `tools/src/golden-diff/baseline.ts` before touching a threshold.
- `meanAbsChannelDelta` is the PRIMARY metric; pixelmatch's pixel count is secondary.
- Baselines are keyed to the capture environment. A missing baseline for the current environment is **exit 3** ("nothing was compared"), never a silent pass. A missing scenario in an existing manifest is **exit 1**, so CI stays red until the post-merge bless. That is intended.
- The reference-free checks are visible-toggle A/Bs (`BaselineSpec.layerChecks`, `three/debug-layers.ts`): hide a layer, repaint at zero elapsed time, and require the frame to change by a calibrated floor. Each floor is one third of the smallest of three measured runs. A check should ask whether a layer contributes, never what the frame looks like, because content added later blinds appearance checks.
- The global repaint-control constants stay 0. Loosen one scenario with `BaselineSpec.repaintControl`, never the constants, which would loosen every layer floor at once.
- `combat` and `dusk` are captured and report-only. A report-only capture failure must not abort the run (`guardCapture`); a gated one is fatal.
- Captures kill the frame loop before the settle, and the freeze must land at tick 0 (`lateFreezeRefusal`). Every scenario has an ABSOLUTE `targetTick`. **A bimodal noise reading is a bug to find, not a band to widen**, and a control that cannot reach zero is a defect. Do not frame units into `aftermath`, and do not raise its thresholds.
- Screen checks (`screens-check.ts`) ask which PATH a screen took. Carry a failure in a variable as well as `process.exitCode`, because the success path overwrites it.
- **Blessing.** Run `pnpm golden-baseline:bless -- --reason="..."`, which refuses to run without a reason. On CI it is the `visual-baseline-bless` workflow, which opens a review PR: look at the picture, every time. Bless from CI numbers, never from the branch. **Do not widen a threshold to clear a red run.** A bot PR from `GITHUB_TOKEN` triggers no `ci.yml` run, so push an empty commit or close and reopen it.
- `blast-light` has no gated witness; `pnpm blast:capture` is its instrument. It waits for a steady loop, and an unsteady settle refuses the group.

### Mesh units

Full record: `mesh-units.md`.

- Measure what a level loads with `pnpm perf:load`; don't recite it.
- **Infantry pipeline, and its order is load-bearing:** `tools/units/kit.py` → `tools/units/rig.py` → `tools/export_mesh_team.py` → `art/meshes/<id>.glb` → `pnpm motion:meshes` → `pnpm gait:meshes` → `pnpm encode:meshes` → `assets/meshes/`. All three passes are mandatory, and any other order ships a stale stride. The motion pass refuses a file it has already been through (`extras.rl_motion`); re-run it from `--from=<rev>`.
- Bones and clips are authored in code, never hand-posed. Binding is rigid, one part to one bone, with no weight painting. Adding a part to `kit.py` makes `rig.py`'s `PART_BONE` stale, and it raises. Extend it; never silence it.
- Nothing a living team draws may be under the ground. `tools/src/mesh_gait.test.ts` is tree-wide. It takes the below-ground census, gates gait and facing per file and per FIGURE, and checks the declared `rl_gait` against a fresh measurement of the same bytes. A named exemption carries a demotion assertion: when it fails, delete the exemption. Every armed walker ships a `moveFire` clip.
- A mesh with no `rl_gait` plays at exactly 1. The gait clamp (`GAIT_TIME_SCALE_MAX` 4) is a backstop, and a clamp doing real work is a defect to report.
- **A GLB carries zero materials.** Colour is applied at runtime from the role ramp. Do not port `render_team.py`'s `ROLE_PALETTE` or `LIT_GAIN` into a mesh export. The exceptions are `house`, `apartment` and `warehouse` and their wrecks, which ship their bake. They are named in `TEXTURED_BUILDING_TYPES` and `TEXTURED_MESH_EXEMPT`, which are pinned against each other. A GLB outside that list that ships a texture throws. `validate:meshes` does not palette-check those six. `apartment` deliberately has no `glass` role.
- Vehicle GLBs carry exactly `idle` and `wreck`, written by `pnpm wreck:meshes`. Nothing else may use those two names.
- **Vehicle pipeline, and its order is load-bearing:** export → `pnpm rescale:meshes` (Lavi and `officer_armour` only) → `pnpm running-gear:meshes` → `pnpm kit:meshes` → `pnpm wreck:meshes` → `pnpm damage:meshes` → `pnpm encode:meshes`. A re-wreck must be followed by a re-damage. The rescale pass refuses a marked file, and every Lavi literal stays in its 6.32 m frame.
- Vehicle weight, conform and running gear are presentation only (frame clock, nothing read back by the sim). Write the hull's rotation once, as `rotation.set(-roll, yaw, pitch, 'YZX')`; `rotation.x` under a yaw is a world-axis tilt. Running gear moves a vehicle onto its own material clone only on its first moving frame, which keeps parked frames, and the gate, unchanged.
- Kit: the graft keeps every live accessor byte-identical, and `applyVehicleKit` merges the host FIRST (the `kit` debug layer depends on it). The `WRECK_` twin keeps the unkitted geometry. Reset `renderer.info` by hand before reading it, because composer passes reset it. The exporter refuses over-budget, off-mock and clashing parts. **Do not bless the `kitted` scenario from the branch.**
- A building's facing is gated (`tools/building_facing.py`), because buildings never rotate at runtime.
- `pnpm validate:meshes` is the only art gate, and it runs in CI. The sprite renderers stay as libraries but refuse to write `assets/sprites/` (`tools/sprites_retired.py`).
- Wrecks. A vehicle wreck is a procedural twin that shares the live meshes. The damage pass cuts outline damage only: no holes, and no missing wheels on skirted tanks. Damaged copies are capped at 64 KiB Draco / 512 KiB raw per file. Charring a textured wreck needs `extras.rl_bake_luma`, and the runtime refuses to char without it.
- A unit spawned mid-mission is seeded in `snapshot()`. Per-frame loops are bounded by the count last snapshotted.

### Campaign board and menu scene host

Full record: `campaign-board-and-scene-host.md`.

- `?campaign` draws a 3D diorama through a DYNAMIC import of `@lions/render/three-campaign`. The flat PNG board is the fallback, for named causes only: no WebGL2 (probed before the import), a GLB that will not load, or a scene graph that fails the contract. The camera does not move; the board turns. `outland_scenery` must never take a region tint. A click on locked ground says why, in an `aria-live` line. Town pins are DOM anchors, never sprites, because a canvas cannot be tabbed into.
- The menu scene host (`@lions/render/three-front`) is a stock `ThreeRenderer`, never a "menu mode". It drives a never-ticked `Sim`, on `/` only, inside the menu's disposer. **Never call `loseContext()` yourself**, because `ThreeRenderer.dispose()` already releases the context. Reduced motion, save-data, no WebGL2 and every failure get the plate, and reduced motion turns parallax off whatever the path. After editing `data/front/menu_diorama.json`, re-photograph the plate with `pnpm plate:host`. `window.__lions` is never defined on the menu route.

---

## Known scaling debts

Full record: `scaling-debts.md`, `mission-findings.md`.

- `roster.surviving_units` is cumulative; `roster-carryover.ts` caps it at `ROSTER_CAP` 150, and a replay replaces bodies that mission enlisted (R-2).
- Detection and `selectTarget` are each O(N²) per tick. The 50 ms budget is not crossed until about 1,700–2,100 living units. Every per-tick scan bounds on `this.count`, the LIFETIME spawn count. The trail and route scans want staggering at the 300-unit target.
- Rigged mesh units are draw-call bound (`SkinnedMesh` does not instance); the render budget is crossed at about 1,150 figures.
- The flow-field pool cap, `MAX_FLOW_FIELDS` 128, is a floor, not a ceiling. A field issued this tick is never evicted.
- `starting_force` ignores `unlock` gates on purpose: the issued force is on loan (`loanedPlacements`), and a loaned survivor goes back to the lender (L-1). Open for the lead: a gated unit that arrives by `reinforce` is kept.
- A wave's `from` cannot name a tunnel, though the schema text promises it. `intel.marked_positions` cannot pre-reveal a tunnel route.
- `pnpm playtest` (in CI) proves a mission winnable, not how long it takes. A scripted plan has perfect information, so a low time ratio on a mission without an endure-clock must not be tuned against. No real-player duration has been measured for any mission.
- `SMOKE_RISE` must stay strictly above `EYE_HEIGHT`, and it equals `BLOCK_RISE` deliberately.
- To isolate a unit in a probe, kill it at t=0 with `debugKill`, or mutate its entry in place. Never remove the entry: that corrupts every later unit's RNG stream. Tel Marum's saddle facts are pinned in `tools/src/tel_marum_doctrine.test.ts`.
