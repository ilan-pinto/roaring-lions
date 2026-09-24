# Shell and HUD upgrade — design

Date: 2026-09-16. Status: **Phase 0 landed on `main` 2026-09-17** (`03fad18`, visual baseline
re-blessed at `495c1a4`); **Phase 1 landed on `main` 2026-09-18** (`274e35b5`, fast-forward,
no bless needed; released as v0.70.0 at `c12c16c4`); Phase 2 has no plan yet. Approved on the
review's defaults by the project lead ("proceed with your defaults"). §10 carries the programme's status, what has landed
beside it from other sessions, and the file boundary that lets them run in parallel. Source: the four-lens review of the menu screen and HUD
(`.superpowers/ui-review-2026-09-16/`, synthesis and four reports; artifact
https://claude.ai/artifact/LBdY8bdd9qAawgW61b3Bf2).

## 1. What this is

A programme, not a feature: five phases that take the shell (menu, campaign board, brigade,
sandbox picker, briefing, debrief) and the mission HUD from a phone-width prototype to a
commercial front-end, without touching the simulation and without opening a second art
pipeline. This spec fixes the direction, the decisions, the constraints and the acceptance
criteria for every phase. Each phase gets its own implementation plan, written when its turn
comes against the code as it then stands; the plan for Phase 0 is written beside this spec.

Why a programme and not one plan: the review found the same 4/10 on every lens for the same
structural reasons, and the fixes span three layers (renderer post chain, app shell, HUD DOM)
with hard ordering between them — a router before co-op, UI scale before any layout is
composed, a plate under over-world text before anything is drawn on the map.

## 2. The review's findings this spec answers

Twenty-seven ranked findings, deduplicated across the four reports; the numbers below are the
synthesis's and are referenced by the plans. In one line each:

- Tier 0: (1) the banner is a generator image with a real Abrams and pseudo-Arabic; (2) the
  world ends in a hard black diagonal; (3) developer ids reach the player; (4) the shell is a
  460 px mobile column and the HUD is pixel-fixed with no UI scale; (5) unpanelled HUD text
  measures ~1.3:1 over the game's own sand.
- Tier 1: (6) no settings; (7) no pause, no Escape, no quit-with-confirm; (8) no Continue,
  profile or save slots; (9) no alert layer; (10) the objective list is unreachable; (11) the
  minimap is display-only, no control groups, no idle finder, no edge pan, no zoom-to-cursor;
  (12) hotkeys undiscoverable, thirteen tooltips in the whole UI; (13) no credits, licences or
  AI-art disclosure surface.
- Tier 2: (14) the feed draws over the order buttons, the unit card clips at 1400×900, and a
  commander line renders twice with two attributions and two dwell timers; (15) the briefing
  has no back edge and DEPLOY is 10 px mono with a system focus ring; (16) campaign-board
  labels collide, the exit is below the fold, `campaign: fresh start` reads as a button; (17)
  the brigade is a spreadsheet; (18) range rings in saturated cobalt across the frame; (19)
  `--bad` is 4.01:1 as text; (20) the minimap encodes team by hue alone; (21) iconography is
  Unicode dingbats; (22) five visual registers; (23) the board is alpine over a desert
  campaign; (24) the tutorial's first sentence points at a moved panel and teaches neither
  projected fire nor the economy; (25) small dead ends (unknown mission id, debrief without a
  menu link, the end card over a running battle, ellipsised chips, 10 px type).
- Tier 3: (26) no i18n layer and Latin-only fonts; (27) no controller code, Steam Deck
  legibility fails.

## 3. Direction — the world is the front-end

The team owns one commercial-grade visual asset, the lit world, and every future art hour
compounds into it. The shell is therefore sourced from that same pipeline: a slow, held,
in-engine diorama behind the menu column; the campaign board, the portraits and the key art
on the same sun (`lighting.ts`) and the same tone-mapping (sRGB output, ACES in `OutputPass`)
as the mission. Closing the banner, the register split, the void and the empty-composition
findings by construction, and making the menu improve whenever the world does.

Rejected: a paper-and-stamp "briefing document" shell. Cheaper in engine time, but a second
art track — which is where this repository's stale assets came from.

The direction does not decide, and every phase before it needs regardless: the application
shell (router, settings, pause, profile, save) and the HUD systems a commander needs (alerts,
objectives, minimap, groups). Those are engineering, not art, and they come first.

## 4. Decisions (taken on the review's defaults)

| # | Decision | Taken | Consequence in the phases |
|---|---|---|---|
| 1 | Direction | In-engine diorama shell | Phase 3 is the scene host; Phases 0–2 are direction-neutral |
| 2 | Campaign board biome | Re-author to the basin (arid highland; the fiction names Sur's "mountain wall" and no snow or conifers) | Phase 3 re-authors `sahar_basin.glb`'s biome; the diorama engineering is kept |
| 3 | Key art | Engine-rendered plate | Phase 0 replaces `menu_banner.jpg` with a plate captured from the running game |
| 4 | Deploy as a decision | In Phase 3 | The briefing becomes a two-column spread with the roster's force shown and chosen |
| 5 | Router | Phase 1 | A client-side router with a persistent shell lands before co-op, as its prerequisite |
| 6 | i18n catalogue | Phase 1 | Chrome strings extracted to a keyed catalogue before the shell doubles |
| 7 | Controller and Steam Deck | Out; Phase 4 on the product track | Listed, not scheduled |
| 8 | The brigade's register (added by the project lead, 2026-09-17) | A shop, or a garage — "themed like a shop or garage. This is a common practice in many games." | Phase 1 builds the garage's layout, type scale, engine-rendered unit plates and the benefit lines; Phase 3 replaces the plates with its art pass |

## 5. Constraints that bind every phase

- **The sim is untouched.** `packages/sim/**` changes in no phase except by a TYPE-ONLY
  addition that mirrors a schema field (`MissionJson.triggers[].label?` in Phase 0); no
  runtime statement changes and the determinism hash does not move. A HUD need that seems
  to require sim change is a missing sim EVENT, and the fix is an event the sim already has
  the information for, raised in its own change.
- **Colour comes from the palette.** `theme.css` remains the only file naming an `--rl-*`
  variable; new tokens are semantic (`--bad-text`, `--plate`); `pnpm validate:ui` stays at an
  empty allowlist. New colours needed by a phase (a plate scrim, a text-safe red) are
  `color-mix()` of existing tokens or new palette entries in `data/palette.json`, never
  literals.
- **Fonts are self-hosted.** A CJK subset in Phase 1 ships under `assets/fonts/` with its OFL
  text; never a CDN.
- **Three only under `packages/render/src/three/**`.** The vignette, skirt and scene host are
  renderer work behind the `Renderer` interface (`packages/render/src/api.ts`); `app` reaches
  them through that interface or through the existing dynamic-import doors named in eslint's
  bundle rule.
- **No `any`, no non-null assertions**, strict TypeScript, tests colocated as `*.test.ts`.
- **The visual gate is blessed, never widened.** HUD and post-chain changes move the golden
  captures (`quiet`, `open-ground`, `relief`, `vehicle`). Each phase budgets ONE bless via
  `visual-baseline-bless.yml`, dispatched from CI numbers, with the
  `visual-baseline-bless-captures` artifact downloaded and looked at. A `region`-scoped
  scenario that a vignette will darken at its corners is re-scoped in the same change, with
  the measurement in the commit.
- **Screens are pure functions.** Every screen stays `show*(stage, opts)`; the router mounts
  them. Nothing reads `window.location` from inside a screen after Phase 1.
- **Every player-facing string is human.** No mission id, map id, URL flag or gate expression
  reaches the DOM; the only text a mission can show stays `name`, `briefing`,
  `objectives[].text` — and, after Phase 0, an optional trigger `label`.
- **UI scale is one number.** After Phase 0 every UI dimension derives from `rem` and one
  `--ui-scale` on `:root`; a new `px` in UI CSS is a defect the review harness flags.

## 6. Architecture by phase

### Phase 0 — the floor

Direction-neutral fixes that remove the store-page blockers and the first-minute
embarrassments without changing any screen's structure. The detailed plan is
`docs/superpowers/plans/2026-09-16-shell-upgrade-phase-0.md`.

- **Key-art plate.** A Playwright capture (`tools/src/perf/plate-capture.ts`, built on the
  wreck/gait capture harness) photographs a staged scene — a `mbt_lavi` and an `inf_squad` on
  `beit_sahwan_outskirts` at a fixed camera and zoom, HUD hidden — at 2560 wide through the
  mission's own pipeline, and writes `assets/ui/menu_plate.jpg`. `menu.ts` shows the plate;
  `menu_banner.jpg` is deleted. The capture is repeatable, so the plate is re-taken whenever
  the world improves.
- **Map edge.** Three layers, cheapest first, each behind the `debug-layers` seam so the
  visual gate can toggle it: (a) a full-frame `VignettePass` in `post-chain.ts` after
  `OutputPass`, radial, sun-neutral, strength tuned so the map's playable centre is untouched;
  (b) a sun-keyed distance fade in the fog pass's shader for tiles beyond the map bounds;
  (c) an unlit, desaturated ground skirt mesh extending the ground's albedo two map-widths
  beyond the boundary. (a) and (c) land in Phase 0; (b) is optional and lands only if (a)+(c)
  photograph short.
- **Raw ids retired.** `triggers[].label` (optional string) in `mission.schema.json`; the
  runtime emits `label` when present and otherwise NOTHING (no `enemy reacts (id)`); a
  `validate:data` rule warns on triggers without a label in shipped missions. Campaign cards
  show the gating mission's `name`. The sandbox picker is relabelled "Free play" with the flag
  table's human descriptions and no URL text. Brigade gates render one human sentence from a
  single helper.
- **UI scale.** `theme.css`'s type scale and layout constants move to `rem`; `html { font-size:
  calc(16px * var(--ui-scale)) }`; `--ui-scale` defaults from the viewport (1 at ≤1600 wide,
  1.25 at 2560) and Phase 1's settings expose it. `--menu-col` becomes `min(28.75rem, 92vw)`
  — the same column at scale 1, larger with the scale.
- **Plates under over-world text.** A `.rl-plate` class (panel ground at ~85% via
  `color-mix`, 4 px inset, 2 px radius) applied to the hint line, the trigger note, the feed
  lines and the title card; `.rl-onmap`'s halo stays for glyph-only marks. `--bad-text`, a
  lighter red at ≥4.5:1 on the panel ground, for the five places red is text; `--t-xs`
  retired from anything read (DEPLOY, chip labels).
- **Bottom cluster.** One container with a stacking context and a reserved safe area; the feed
  anchors to the cluster's top edge; the unit card gets a `max-height` from the viewport and
  scrolls. A `say` line renders in the commander bar only, with the bar's attribution and dwell.
- **Confirms and edges.** A shared `confirmDialog(text, danger)` in `ui/`; `⌂` and `reset
  campaign ledger` use it and name what is lost; `⌂` moves out of the speed cluster. On the
  briefing, Escape means back and only the button deploys; DEPLOY in the display face at
  `--t-title` with a filled band; a global `:focus-visible` ring in `--accent`.
- **Campaign board.** Label collision resolved in the DOM by a greedy nudge pass (labels
  sorted by projected y, each pushed below the previous when their boxes overlap, with a leader
  line to the pin); the back link pinned to the viewport; the 1140 px cap removed above 1200 px.
- **Dead ends.** Tutorial step one's text; an error screen for an unknown `?mission=` id with
  a link home; the debrief's menu link.

Acceptance for Phase 0: the review's capture script re-run at all three resolutions shows no
raw id, no unpanelled text, a menu whose column is ≥ 28% of a 2560 frame, a plate with no
watermark, and a map edge with no hard diagonal; the `enemy reacts` string does not exist in
the bundle; every `--bad` text site measures ≥ 4.5:1 by the review's contrast method; full
gate green with one bless.

### Phase 1 — the shell as an application

- **Router.** `packages/app/src/shell/router.ts`: a hash-free, history-API router with a
  route table `{ '/': menu, '/campaign': campaign, '/brigade': brigade, '/free-play':
  sandboxes, '/briefing/:mission': briefing, '/mission/:mission': mission, '/debrief':
  debrief, '/settings': settings, '/credits': credits }`, a persistent `stage` element, a
  `navigate(route, opts)` that unmounts the current screen (each `show*` returns a disposer)
  and mounts the next, and a transition hook (a 200 ms crossfade on the stage, honouring
  `prefers-reduced-motion`). `?renderer=pixi` and the sandbox flags survive as query state the
  router preserves. The deploy gate (`loading.done()`) is honoured inside the mission route.
  Old URLs (`?campaign`, `?mission=`) redirect to routes for one release, then are removed.
- **Settings.** One route, one table (the sandbox picker's discipline), persisted in
  `lions.settings` beside the ledger, read through a `settings.ts` module with typed defaults:
  video (fullscreen, `--ui-scale`, quality preset mapped to GTAO/SMAA/shadow-map size), audio
  (master, music, SFX, voice — the audio engine's existing gains), controls (rebinding from
  the hotkey table, edge pan on/off, camera speed, zoom to cursor), accessibility (faction
  palette variants for deuteranopia/protanopia/tritanopia as alternative palette entries, text
  size as a second multiplier on `--ui-scale`, reduced motion), language (Phase 1 ships `en`
  only, the switch exists).
- **Pause.** Escape in a mission opens a modal over a visibly paused world (the frame loop
  keeps rendering, the sim stops stepping — the renderer already interpolates, so a held frame
  is free): resume, objectives (Phase 2 fills it), restart (confirm), settings, quit to
  campaign (confirm).
- **Continue, profile, save.** The menu's first item reads the ledger and names the next
  mission. A `profile.ts` layer wraps the ledger with named slots in the same `LedgerData`
  shape; a file-backed export/import through the browser's file APIs now and the packaged
  shell's filesystem API later. Steam Cloud and co-op both depend on this shape.
  **There are two stores, not one, since the brigade economy landed** (2026-09-16/17): the
  campaign ledger and the brigade account (`lions.brigade.account`, `brigade-account.ts`,
  the only reader and writer), and the account SURVIVES `?fresh` by that spec's §4.1 — a second
  campaign starts with the brigade you built. A profile slot therefore wraps both stores or it
  is not a save; export/import carries both; and "new campaign" becomes a named affordance
  that says what it keeps (the brigade) and what it resets (the ledger), instead of a URL flag.
- **Credits.** Contributors, library licences, the three OFL texts, the game's licence, the
  art-pipeline disclosure (`CONTRIBUTING.md`'s policy, stated for the player). A build id in
  pause and settings.
- **i18n seam.** `packages/app/src/i18n/`: a keyed catalogue (`en.json`), a `t(key, params)`
  with plural rules, every chrome string extracted; a locale key path for mission text that
  `validate:data` can gate; `?pseudo=1` pseudo-localisation through the capture harness; the
  CJK subset faces for body and mono.
- **The brigade as a garage** (Decision 8; the lead's words: *"redesign the brigade page to
  look more robust, themed like a shop or garage. This is a common practice in many games.
  Just look how it is done in other games. This also better explains the benefit of each
  upgrade for the units. Use better graphics and bigger font."*). What shipped garages share,
  and this one takes: **one unit at a time, large, in a lit bay** (World of Tanks' garage
  puts the selected vehicle centre-stage in a hangar and everything else around it; its 2.0
  rework kept exactly that and made the numbers "more digestible"); **a roster rail** of every
  unit the brigade can own, grouped by role, each with its status — owned, locked behind a
  gate, or a price; **an upgrade board beside the unit** where each track is a ladder of rungs,
  the bought ones filled, the next one priced, and **every rung says what it does in the
  unit's own numbers** — "front armour 120 → 134", "sight 9 → 10 tiles", "accuracy 62% → 66%"
  — because XCOM 2's armoury famously did not, and the first thing its players built was a
  mod to show the stats before buying; **the wallet in the corner** in the display face;
  **type at reading size** — the unit's name at `--t-title`, prices at `--t-h2`, benefit
  lines at `--t-body`, nothing a player reads below `--t-small`. The unit picture is an
  **engine plate**: `pnpm plates:units` photographs every KDF type from the running game on
  open ground, lit by the mission sun, HUD and overlays off, at a device scale that makes a
  tank six hundred pixels wide (`assets/ui/plates/units/<id>.jpg`); Phase 3's art pass replaces
  the files in that directory and nothing else. The economy's rules are untouched: `gateSentence`,
  per-unit Buy, per-track Buy, `ownedTiers`, `applyUpgrades`, the double-click reset. The
  benefit lines are a pure function over the unit's `upgrades.<track>.tiers[].patch` (cumulative
  deltas over base on the closed whitelist in `packages/data/src/upgrades.ts`), so they cannot
  disagree with what `applyUpgrades` will do. References: the World of Tanks 2.0 garage
  (https://worldoftanks.eu/en/news/general-news/update-2-0-garage-ux/), the XCOM 2 Armory and
  its "Better Armory Item Stats" mod (https://steamcommunity.com/sharedfiles/filedetails/?id=1489472552),
  and the Game UI Database's "Upgrading & Ranking Up" and "Upgrade: Inspect & Confirm" screens
  (https://www.gameuidatabase.com/index.php?scrn=73, https://www.gameuidatabase.com/index.php?scrn=97).

Acceptance: no full page reload between any two screens (measured by a `performance` mark
that survives the transition); settings persist across reload; Escape pauses and resumes with
the sim tick count unchanged while paused; a save slot round-trips the ledger byte-for-byte;
the pseudo-localised capture pass shows no clipped chrome string; the brigade at 1920 and 2560
shows one unit in its bay with every rung of every track carrying a before → after number, and
no text on the screen smaller than `--t-small`.

### Phase 2 — the HUD a commander needs

- **Alerts.** From existing sim events only (`unit_lost`, `under_fire`, objective state
  changes — audited in the plan; any missing event is a sim change raised separately): a feed
  line, an SFX, a minimap flash, and a jump-to-event key; a squad wipe coalesces to one line.
- **Objectives.** The full list on the briefing; an in-mission tracker toggled from the strip's
  `+N` and from the pause menu; secondaries with rewards named.
- **Minimap.** Click to jump, drag to pan, right-click to order, a ping, a frame, a
  shape-coded hostile mark, ground from the map's lit albedo (a one-off render of the ground
  mesh to a texture at map load).
- **Control groups, idle finder, edge pan, zoom to cursor.** App-side input only.
- **Discoverability.** The key on every order button; an F1 overlay listing every binding from
  the same table settings rebinds; the hint line no longer hidden by a selection; a shared
  tooltip component and the first ten tooltips, Conduct first.
- **Per-squad chips** — their art is `unitIcon(basePath)` from `ui/portrait.ts` (landed
  2026-09-17 with the unit-icon crop, `pnpm icons:units`, `assets/ui/icons/units/`), consumed
  unchanged, never a second crop; **range rings** redrawn as a desaturated low-alpha fill of
  the team hue with a designed arc (renderer overlay work, band 4 — the one Phase 2 item outside
  `packages/app`, see §10); **projected fire and the dock** made discoverable; the tutorial
  gains a hover step and a first economy step.

Acceptance: a scripted mission in which a unit dies produces an alert line, a sound and a
minimap flash within one frame of the event; all objectives of a five-objective mission are
readable in-mission; the capture pass at zoom 2.5 shows no saturated ring fill.

### Phase 3 — one register

- **Scene host.** `packages/render/src/three/front/` (a new door, named in the bundle rule):
  a held diorama — a lit map slice with a few idle units — rendered behind the menu column on
  the mission pipeline, slow parallax on mouse, the campaign screen's no-WebGL2 fallback
  pattern reused (a static plate when the host cannot draw). **Landed on `feat/scene-host`,
  PR pending** — the controller fills in the commit at landing.
- **Campaign board on the lit pipeline** (the spec's own one-file follow-up in `world-view.ts`
  / `world-material.ts`), its biome re-authored to the basin per Decision 2, a hover language
  for the pins.
- **Portraits** re-rendered through `lighting.ts`'s rig at full colour depth; **key art**
  recomposited from engine renders.
- **Symbol family.** Twelve drawn glyphs at one weight derived from the chevron's angles, as an
  SVG sprite: seven roles and five verbs, tested at 10 px over lit sand; used by dock, cursor
  badge, order row and minimap.
- **The garage's art pass** (the garage itself is Phase 1, Decision 8): turntable renders on
  `lighting.ts`'s sun replace the engine plates under `assets/ui/plates/units/` file for file,
  a bay backdrop drawn from the diorama pipeline replaces the flat panel ground, veterancy marks
  and service records join the bay, and the roster rail's icons are re-cropped from the new
  renders (`pnpm icons:units`). No control changes; `unitIcon`'s and the garage's callers see
  the new art with no code change.
- **Deploy as a decision** (Decision 4): the briefing as a two-column spread — portrait and
  orders left, the roster's force and a map preview right — with the force chosen, not merely
  shown.
- **Victory and defeat moments**: full-screen, held, before the debrief.
- **Composed layouts** at 1920 and 2560.

Acceptance: the capture pass shows one colour register across menu, board, briefing and
mission (measured: the plate's and the mission's mean luminance and saturation within 10% of
each other); the board draws the basin; no dingbat glyph remains in the UI source.

### Phase 4 — platform (not scheduled)

Steam Deck at 1280×800, a controller scheme, ultrawide safe areas, 4K defaults. Tracked on
the product track; nothing in Phases 0–3 may preclude it (no hover-only affordance without a
keyboard path).

## 7. Testing and evidence

- **Unit tests** for every pure function a phase adds: the label-nudge pass, `t()` and its
  plural rules, the router's route table and disposer contract, settings defaults and
  persistence, the alert coalescing, contrast of `--bad-text` against `--bg` (a test that
  reads `theme.css`, resolves the palette and computes the WCAG ratio — so the number the
  review measured by hand becomes a gate).
- **The capture harness** (`scratchpad/ui-review/shoot.ts` promoted to
  `tools/src/ui-review/shoot.ts`) is the review instrument for every phase: the same eleven
  states at three resolutions, plus `?pseudo=1` after Phase 1. It is evidence, not a gate; the
  visual gate remains the four blessed scenarios.
- **Reference-free checks** where a picture cannot be judged: the bundle must not contain the
  string `enemy reacts (`; UI CSS must not contain `px` outside the allowlist of hairlines
  (`1px`, `2px` borders); every `show*` returns a disposer.
- **Screens check** (`tools/src/golden-diff/screens-check.ts`) gains the menu route: the scene
  host must report `data-host=live` on a WebGL2 runner.
- **What the review could not see, and the instrument each phase adds for it.** The review
  was four lenses over STILLS, from one model, with no shipped-game benchmark and no player;
  its scores are one considered opinion plus one measured lens, not a panel. Three of its blind
  spots are closable by instruments and are owed by the next plans: (a) `pnpm ui:shots` gains a
  scripted run to `missionEnd` — victory, defeat, debrief — and the pause state, in Phase 1's
  plan, because none of those screens was reachable in the capture pass; (b) a motion capture
  (a frame series over the menu entrance and the first thirty seconds of a mission) before
  Phase 3's acceptance, because every judgement of "feel" so far is a guess from a still; (c)
  one observed, unassisted first-player session before Phase 3's art spend, because half the
  Tier 0 findings are predictions about a new player and none has been checked against one.
  The fourth blind spot — no side-by-side against shipped RTS shells — is a reading task, not
  an instrument, and belongs to whoever writes Phase 3's plan.

## 8. Out of scope

Co-op and networking (the router is their prerequisite, not their start); the economy's
loadout rules behind deploy-as-a-decision (Phase 3 shows and chooses the force the roster
already computes; new rules are the economy work's); controller input (Phase 4); any change to
mission content beyond the tutorial's text and optional trigger labels; anything under
`packages/sim/`.

## 9. Open questions

None blocking. The first of the two this section carried is settled: the vignette DID need the
off-map fade, for a reason the capture found rather than the one predicted (D-1). Still open,
inside its phase: which sim events the alert layer is missing (Phase 2's plan audits
`MissionEvent` and lists them before any HUD work starts). Newly open, outside any phase: the
`vehicle` scenario's repaint-control self-check reads 0.0004 against its 0.00036 per-scenario
budget since the vignette and skirt landed (CI run 35183889329) — the drift CLAUDE.md records
as "still unknown", now ~11% over its budget on Linux. The budget is not widened; the visual
job stays red on `main` for that one self-check until someone finds what drifts.

## 10. Status, and the boundary with the sessions beside this one

**Where the programme stands, 2026-09-18.** Two of the five phases are on `main`: Phase 0
(the floor: routes-free shell on rem, plates under over-world text, the vignette and ground
skirt, confirms, key art) and Phase 1 (the shell as an application: router and soft navigation,
settings, keymap, pause and clock, profile slots and saves, credits, i18n with a pseudo-locale,
colour-vision team variants, the garage, the quality preset). Landed the same day beside Phase
1: the routes-walk CI fix (`6f08cf57`, below), and the Meshy text-to-3D CLI (`e3b5ea40`,
`pnpm meshy`, `docs/ART_PIPELINE.md` "Meshy API") — which is what Phase 3's art pass now has
for a base model, with Blender for everything after it, per the lead's cost rule. Not yet
started: Phase 2 (the HUD a commander needs — alert layer, objectives, minimap control, control
groups, range rings, chips on `unitIcon`), Phase 3 (one register: scene host, deploy as a
decision, the garage's art pass, Blender portraits GH-153), Phase 4 (platform, unscheduled).
Phase 2's plan is the next thing to write, and it wants the lead's answers to D-10…D-27 first
(D-27's list of what needs a decision is the short version). CI on `main` today: `gates` and
all three `determinism` runners green on every push; the `visual` job went red twice on
`pnpm ui:routes` (fixed, below) and once on the `vehicle` scenario's repaint-control self-check
(0.0004 against its 0.00036 budget — the drift Phase 0 recorded; **found and fixed the same
day**, `c0044ff6`: `updateVehicleAmbientFx` fed its dust/exhaust accumulators the RAW frame
delta where every other clock clamps to 100 ms, so a long load frame banked seconds of
emission credit that later zero-time repaints spent one puff per call — all four gated
scenarios now read a literal 0 px / 0.0000 against the global hard zero, the per-scenario
override is deleted, and no bless was needed), so the `version` job cut v0.70.0 and v0.71.0
on the fully green runs and skipped the red ones.

**Phase 0 — landed.** `feat/shell-upgrade` merged to `main` at `03fad18` (2026-09-17), eleven
tasks each reviewed, final whole-branch review 2 Critical / 7 Important all fixed in one wave,
full gate green locally and on CI. All four gated visual scenarios moved, as §5 said they
would, and every layer check passed; one bless (`495c1a4`), dispatched from the CI numbers
with the captures artifact looked at. `menu_banner.jpg` is gone, `assets/ui/menu_plate.jpg`
comes from `pnpm plate:capture`, and the string `enemy reacts (` is out of the bundle. Two
acceptance items are NOT met and are recorded rather than restated: the menu column at 2560
(D-8) and, in the picture only, the plate's top-left corner (D-3's floor).

**Phase 1 — landed.** `feat/shell-phase-1` at `274e35b5`, off `dea7e483` (main's
v0.69.0 infantry-animation landing, merged in before Task 14), pushed to `main` as a
fast-forward on 2026-09-18; the spec's landing-commit fill `1744eec0` is what CI cut v0.70.0
from. **Seventeen tasks** (0–16, run
0–13 then 15, 16, 14 — Task 14 waited on the art session's `ThreeRenderer.ts`) and **eleven
fix rounds** (Tasks 0, 2, 4, 5, 6, 9, 10, 11, 12, 15, 16), each task reviewed and every fix
round re-reviewed. Final whole-branch review: 1 Critical, 10 Important, 20 Minor, closed in
one fix wave (C1, I1–I10 and thirteen minors; six deferred with reasons, below). *The final
review's own header says "16 tasks, 9 fix rounds"; the ledger counts 17 and 11, and the
ledger is what was run.*

Gate on the merged tree, before the fix wave (Task 14): **4771 tests**, determinism hash
unmoved, `encode --check` clean. After the fix wave: **4795 tests**, plus `validate:data`,
`validate:ui` (now `validate_ui_palette.mjs` + `validate_i18n.mjs`) and `test:determinism`.
**`git diff --stat dea7e483..HEAD -- packages/sim` is empty** — the determinism hash could not
have moved, and did not.

**The acceptance items, line by line** (§6 Phase 1):

- *No full page reload between screens; a mission boots and is left without one.* **Met**, and
  it is the one claim with a dedicated instrument: `pnpm ui:routes` plays two missions and a
  soft-booted third in one page and asks four reference-free questions plus a canvas count.
  **It is in CI as of this landing** (I9), in `ci.yml`'s `visual` job, at 60.5–73.5 s over six
  runs on one machine — two clusters, 73.1/73.2/73.5 then 60.5/61.2/61.9, cause not established.
  On CI it read 132 s green and 166 s RED on its first two runs (35317980642 / 35317801475, the
  same tree a docs-only diff apart): headless Chromium has no GPU, a live mission draws through
  SwiftShader at a measured 0.43–0.59 s mean / 0.73–0.92 s max per frame on an M-series Mac, and
  a Playwright click is five round-trips that each queue behind a frame, so one leave leg took
  29–40 s on CI against Playwright's 30 s default. Fixed the same day: the walk's actions run
  under a 120 s hang guard sized from that cadence, the cadence is printed per mission, and
  the reload oracle was replaced — `rl:boot` is a per-document `performance.mark`, so `boots`
  could never see a reload at all (it reads 1 after one exactly as before); the harness now
  counts `load` events against the four hard `page.goto`s, and an injected `page.reload()`
  fails it with "3 document(s) loaded, expected 2".
- *Settings persist and apply.* **Met** — `lions.settings`, applied on write, and the quality
  preset reaches the renderer at the next mission's boot (Task 14).
- *Escape pauses; the sim stops and the frame loop does not; the tick count is frozen.*
  **Met** (`shell/clock.ts`, and `ui:routes` reads a left mission's tick twice 1200 ms apart).
- *A save slot round-trips the ledger byte-for-byte.* **Met** (`profile.test.ts`) — and the
  write-failure hole the final review named (I2) is **closed by this wave**: a storage refusal
  partway through a load is named in the screen's `role="status"` line and the load is not
  reported as done, rather than becoming an unhandled rejection under a list that re-rendered
  as if it had worked.
- *The pseudo-localised capture pass shows no clipped chrome string.* **Met as of this wave.**
  It was NOT met at review time: the pseudo set predated the garage, so the phase's newest and
  most text-dense screen had never been photographed under it, and the set that existed showed
  the `/settings` quality select drawn over its own label (I6). Both are fixed and re-shot at
  three resolutions — `.superpowers/ui-shots/p1-final-pseudo/` and `p1-final/` — and
  `shoot.ts` now carries a reference-free overflow probe (a printed report, per §7, not a
  gate). The re-shoot found one further defect and closed it: the garage's three upgrade-track
  headings were the raw JSON key humanised, unbracketed under `?pseudo=1`.
- *The garage reads at 1920 and 2560, every rung carries numbers, nothing below `--t-small`.*
  **Met**, the type floor gated from disk (`brigade.test.ts` reads `theme.css`).

**Carried forward from the final review, deferred with reasons** (the way Phase 0's twelve
are): **minor 9** — eight of seventeen KDF units carry no `blurb`, so the garage's bay shows
name + role and nothing else for half the roster, `apc_eitan` (the default selection) among
them; content for the lead or a narrative pass, not code. **Minor 10** — the per-track Buy
control sits below the fold at 1920 because the rungs descend; ruled on already (a board fade
was added), and reordering them is a design call on the screen that exists to sell things.
**Minor 13** — `readAll` round-trips every slot through `JSON.stringify` → `importSlot`'s
`JSON.parse` on every read; a real cost only at a slot count nothing approaches. **Minor 15** —
a third private `clamp01` (`audio.ts`, two under `three/`). **Minor 17** — a scenery figure is
cropped at a plate's top-left by the bay zoom; the next `plates:units` run should spawn on
emptier ground. **Minor 20** — the Pixi soft-leave WebGL leak (D-25 below), the lead's call.
Also standing from Phase 0: the `vehicle` repaint-control self-check at 0.0004 against 0.00036,
still not widened — measured on CI as a coin flip (of the five `visual` runs on `main` on
2026-09-18 it read 0.0003 and passed on three and 0.0004 and failed on two, `35320650908` the
latest, on identical renderer code), then **closed at the source** the same day (`c0044ff6`,
above: the vehicle ambient FX spent a banked emission backlog one puff per `frame()` call;
the repaint-control drift and the scenario's documented 5–157 px "renderer noise" were one
defect). The `vehicle` thresholds were calibrated against that noise and are NOT re-derived
against the new zero floor — a separate decision, recorded in `baseline.ts`.

**No bless was taken, and none was needed** — see D-27.

**Twelve minors deferred by the task reviews**, carried here because the plan's SDD workspace
is deleted: `triggerLabelFailures(file, mission)` reverses its siblings' argument order;
`escapeHtml` exists twice (`mission-notice.ts`, `hud.ts`); two labels paraphrase their own
`say` line (`qarn_hadid_2_foothold` / `he_takes_the_tube_into_the_village`,
`umm_zeitoun_2_buildup` / `the_tube_moves_north`); no test pins the flag spelling on the
checkbox `title` (D-4); "which gate binds" is implemented three times (`gateSentence`,
`bindingGate`, `lockLabel`) with nothing holding them in lockstep; the px validator sweeps
`.css` only, so inline `px` in TS style strings is unguarded; one review report mislabels
`.rl-clock` as `.rl-strip`; the `nudgeLabels` falsification never isolated the `sharesX`
branch, and the flat board's rAF pass can fire after unmount (traced harmless); one non-null
assertion in `skirt.test.ts:47`; the plate's pale top-left corner (Phase 3 reframes);
billboard-path (`&nomesh`) silhouettes are outside the `overlays` debug layer;
`docs/superpowers/plans/2026-08-11-campaign-world-and-shell.md:1841` still names
`menu_banner.jpg`. None blocks Phase 1; the gate-order triplication is the one worth a task.

**What landed beside Phase 0, from the economy and art session, and what it changes here.**
Brigade economy step 2 "Buy" (`39ad72b`, merged mid-branch — D-7), step 3 "Upgrade"
(`ad4e65f`, v0.67.0: tier pips, per-track Buy, `applyUpgrades` in `@lions/data`, the sim never
sees a tier), and the unit-icon crop (`c88440d`, v0.68.0: `unitIcon` in `ui/portrait.ts`,
`data-icon="1"`, a CI `--check`). Consequences are written into §6 where they bind: Phase 1's
profile slots wrap two stores; Phase 2's chips consume `unitIcon`; Phase 3's armoury re-skins
the economy's screen; Decision 4 (deploy as a decision) now sits on the roster the economy
computes, which is exactly the boundary §8 draws. That session's next work is art Phase 1,
sub-project 1 "infantry animation" (`docs/superpowers/specs/2026-09-17-infantry-animation-
design.md`, on `worktree-art-phase1-infantry`).

**Running in parallel — the file boundary, agreed with that session on 2026-09-17.** The
shell programme owns `packages/app/**` (including `ui/theme.css` and `main.ts`),
`tools/src/ui-review/**`, `tools/validate_ui_palette.mjs`, `data/palette.json`'s UI entries,
and this spec's plans. The art session owns `packages/render/src/three/units/mesh-*.ts`,
`packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/sheet.ts`,
`tools/src/mesh_gait*`, `tools/units/rig.py`, the four Meshy importers, `art/meshes/**`,
`assets/meshes/**`, and CLAUDE.md's "Mesh units" section, until it lands. The rules that make
this safe: **Phase 1 stays entirely inside `packages/app`** — it needs nothing from the
renderer; **Phase 2's range rings (band 4) and Phase 3's scene host (`three/front/`) are the
two items that touch `ThreeRenderer.ts`**, and they wait for the art landing or arrive through
a merge from `main`, never both in flight on that file; every branch merges `origin/main`
before landing; the visual bless is serialised — one per landing, dispatched from CI numbers,
and a bless dispatched while `main` is moving retries its push three times and its bot commit
triggers no `ci.yml` run, so two landings close together must bless in turn, not at once;
CLAUDE.md is edited per section and never wholesale. Each session has its own worktree; this
programme's is `/Users/ilpinto/dev/roaring-lions-shell`.

**Added by the project lead on 2026-09-17, after the Phase 1 plan was written:** the brigade
redesigned as a shop or garage (Decision 8, §6 Phase 1's last bullet; Tasks 15–16 of the Phase 1
plan). The plan's Task 15 is the plate harness and Task 16 the screen; Phase 3's armoury bullet
became the garage's art pass.

**On the review's time estimates.** The synthesis priced Phase 0 at "about two weeks" and
Phases 1–3 at two to five weeks each, for a human team. Phase 0 ran in one session under
subagent-driven execution (haiku for mechanical fix rounds and scoped re-reviews, sonnet for
implementers and task reviews, opus for the renderer task and the final review). The
estimates are not carried into this spec; a phase's cost here is its plan's task count and
review rounds, and Phase 0's were eleven and ten.

## Deviations

(Recorded by the executing sessions as `D-n`, with the measurement that justified each.)

**D-1 — the fog pass carries the off-map fade, not just the vignette and the skirt (Task 9).**
§6's Phase 0 architecture lists a sun-keyed distance fade in the fog pass's shader as optional,
landing only if the vignette and the skirt photograph short. They did not photograph short, but
`terrain/skirt.ts`'s ground beyond the map exposed a defect neither of them touches: the shroud
texture is `ClampToEdgeWrapping`, so a single visible tile on the map's own border floods a
whole quadrant of the skirt with that tile's value — measured on `beit_sahwan_1_recon` at
1920×1080, zoom 0.5, a wedge reading (175, 171, 160) sRGB against the (55, 52, 45) of the
shrouded skirt beside it. `fog-pass.ts` gained `FOG_OFFMAP_FADE_TILES`, a one-tile fade from the
border's own shroud value to never-seen, accepted inside Task 9 as a shader change the task did
not originally plan. On-map pixels are unaffected by construction — the fade only multiplies a
term that is exactly 0 inside the map bounds.

**D-2 — the golden-diff `open-ground` scenario's crop stays where it is (Task 9).** The plan
told the implementer to move the crop if the vignette's own delta there cleared a 0.02 floor; it
cleared it 200× over. The crop was kept anyway, against that instruction, because the
CANDIDATE crop (following the vignette's own visible falloff) holds animating infantry: the
`units` debug-layer toggle measured 229 px of noise there against a literal 0 px in the crop
that shipped, plus a 1–4% signal cost to the other three layer checks framed against it. A
measurement overruling an instruction, recorded with the numbers rather than silently followed.

**D-3 — the key-art plate's off-map wedge: accepted as the floor, then closed by the final
review's C2.** Task 10 spent three follow-up rounds (~300k cumulative tokens) chasing the plate's
own dark diagonal — first read as a shadow, found to be the fog-of-war boundary, closed by
`setDebugLayerVisible('fog', false)`, which at the time meant disabling the whole `FogOfWarPass`.
That left a second defect: a pale, texture-poor wedge top-left where the off-map fade (D-1) used
to run, accepted as Phase 0's floor pending Phase 3's composed key art. The final whole-branch
review's C2 finding was that hiding the fog pass to remove ONE diagonal had reinstated the other,
and ruled it back into scope rather than deferred: `FogOfWarPass` gained a `uRevealAll` uniform
that forces every ON-map sample to read as fully seen while leaving the pass — and D-1's fade —
running, so `setDebugLayerVisible('fog', false)` no longer disables anything. Regenerated
`assets/ui/menu_plate.jpg` and sampled it: the same top-left region now reads ~(55, 52, 45), the
shrouded skirt tone from D-1, in place of the pale wedge, with a smooth gradient at the map edge.

**D-4 — a sandbox flag's URL spelling stays on the checkbox's `title` (Task 2).**
`sandbox-help.ts`'s table and `menu.ts`'s picker are §6 Phase 0's "no URL flag ... reaches the
DOM" for the Free play screen's visible text, but `menu.ts`'s checkbox for each flag also sets
`label.title` to the literal `&<flag>` string — the flag's own URL spelling, on a hover-only
tooltip, not in the rendered label. Kept deliberately: the sandbox picker is a tool for people
already reading and typing sandbox URLs, and the tooltip is the one place that spelling is
useful rather than decorative. This reads narrower than the constraint's absolute wording and is
recorded here for that reason; no test pins it yet (`progress.md`'s T2-a).

**D-5 — `.rl-sel` is a never-hidden bottom stack, not a conditionally-hidden one (Task 5).**
The brief's mechanism hid `.rl-sel` (feed, order row, cluster, hint) whenever nothing was
selected, which is most of a mission — the review that caught it found the feed vanished outside
combat entirely. Replaced in fix round 1: `.rl-sel` never hides; `renderCard` hides only the
order row and the cluster; the hint moved into the stack as its own last child, so it and the
feed both survive an empty selection.

**D-6 — the campaign screen's nav is a footer grid row, not a `position: sticky` overlay
(Task 7).** The brief's sticky nav pinned over the bottom edge of the region-card row from
scroll position zero — a real footer only when nothing else occupies that band, and here the
region cards did, permanently covering the middle card's portrait and flavour text on every
capture. Replaced: `.rl-menu:has(.rl-world)` is a two-row grid instead, `minmax(0, 1fr)` for the
scrolling board wrap and `auto` for the footer nav, so the nav can never sit under or over
anything — it is a document-flow row, not a positioned overlay. Overlap measured zero at all
three resolutions after the change (a later, narrower regression — the cards clipping against
that same footer row rather than being covered by it — is the final review's I3, fixed in the
merge-and-fix-wave that produced this section).

**D-7 — `gateSentence` carries the brigade-economy merge's price rank.** `origin/main`'s
brigade-economy work ("Buy", `666c852`→`47cb7c6`) landed mid-branch, adding `price`/`bought` and
`isBoughtOnly` to the unlock gate shape that `gateSentence` (§6 Phase 0's "one human sentence
from a single helper") already read. The merge to `216a451` gave `gateSentence` the same price
rank rather than letting the app-side sentence and the sim-side gate diverge. Per the peer
session's own spec (`docs/superpowers/specs/2026-09-15-brigade-economy-design.md` §4.4, worded
"requires N stars …, or buy for N credits"), the sentence `gateSentence` renders drops the
"or buy" clause: the app already puts the price on the Buy button itself, so the binding sentence
is the earned gate alone and the button carries the price — restated in text it would only
duplicate the button. §4.4's own wording was updated in the final fix wave to match what ships.

**D-8 — the UI scale steps are 1 / 1.15 / 1.4, and the menu column at 2560 reads 25%, not the
acceptance's 28% (Task 3); discharged by Task 7 at 29.75%.** §6 specified `--ui-scale` "1 at ≤1600 wide, 1.25 at 2560" and
`--menu-col: min(28.75rem, 92vw)`; the acceptance demanded a column "≥ 28% of a 2560 frame".
Those two numbers never agreed: 28.75 rem at scale 1.25 is 575 px, 22.5% of 2560. What shipped
is three steps — 1, 1.15 from 1900 px, 1.4 from 2400 px, the breakpoints in raw px because
they SET the rem — so 1920×1080, the common case, gets a step instead of staying at 1; at 1.4
the column is 644 px, 25.2% of 2560. The formula stands; the 28% figure is retired from Phase 0 rather than
met by widening the column blind, because how wide the column should be at 2560 is decided by
what sits behind it, and that is Phase 3's composed layout with the diorama host. Phase 3's
acceptance owns the number.
**Task 7 sets it (2026-09-24, measured directly off the shipped rule): 761.6 of 2560 px, 29.75%.**
A new token, `--menu-col-wide: min(34rem, 82vw)`, picked up by `.rl-menu:not(:has(.rl-world))` at
the same two breakpoints above — 34rem × 22.4 px/rem (the root's 16 px base times `--ui-scale:
1.4`) is 761.6 px of 2560. At 1920 (`--ui-scale: 1.15`, 18.4 px/rem) the same token reads 625.6 px,
32.58% of that frame. This replaces the unchanged-below-1900px formula's 644 px / 25.2% at 2560 for
every plain menu screen (`01-menu`, `04-sandboxes`, `12-settings`, `13-credits`, `14-saves`) — the
campaign board is excluded on purpose, since its header and footer are deliberately pinned to the
narrow `--menu-col` inside their own wide frame (comment on `.rl-menu:has(.rl-world)`, `theme.css`).
The number was not solved for the retired 28% target; it was chosen by capturing `01-menu` at 1920
and 2560 side by side against several trial widths and picking the one that reads as a deliberate
column rather than an accident of `28.75rem`'s arithmetic — that the result (29.75%) lands close to
28% is a consequence of the capture, not a target aimed at. The diorama host §6 Phase 3's "scene
host" bullet describes sitting behind this column is still unbuilt on this branch (a separate
render-lane plan, gated on WP-A1.3, per R-1 of the Phase 3 app-half plan). The rule, the
capture and the measurement are commit `9bc93e22`; the test that pins the value
(`--menu-col-wide: min(34rem, 82vw)`, red on `36rem`) is `600b3910`. The candidate discarded there —
restructuring `.rl-menu` into a grid beside its banner — was rejected because the scene host it
would compose against does not exist yet.

**D-9 — `confirmDialog` takes a host and an options object, not `(text, danger)` (Task 6).**
Shipped as `confirmDialog(host, { title, body, confirm, danger? })` in `ui/confirm.ts`: the
dialog restores focus to its opener on close and guards keys at the capture phase so a modal
cannot leak Escape to the screen beneath it — both needed a host element, and a title that
asks the question with a confirm label that answers it ("Leave the mission?" / "Leave";
"Start the campaign over?"), which the two-argument shape in §6 could not carry. The second
one's body deliberately does NOT say the brigade is erased, because it is not (§6 Phase 1).
Every later confirm in the programme (pause menu's restart and quit, profile delete) uses this
signature.

---

### Phase 1's deviations

The plan's eleven rulings (R-1 … R-11, `docs/superpowers/plans/2026-09-17-shell-upgrade-phase-1.md`),
written in here as D-10 … D-20 with what the executing session measured, followed by the seven
this branch earned.

**D-10 — `/briefing/:mission` redirects to `/mission/:id`, and `/debrief` is not a route
(R-1).** The briefing is a mode of `showLoading` fused with asset loading and the deploy gate
(`loading.ts`'s `briefingHoldsDeployment`); the end screen and the debrief are overlays
painted on the live mission. Splitting them is Phase 3's two-column deploy spread and its
victory/defeat moments. What this phase owed them instead is a lifetime: **both overlays are
torn down by the mission's own disposer** (`screenDisposers`, drained by `bootBattlefield`'s
`teardown`), because they mount on `document.body` and the router never touches that.
Measured: `pnpm ui:routes` reads the body back to the menu's own three children after three
missions.

**D-11 — `/saves` is in the route table (R-2).** The spec's screen table had no home for save
slots. The menu's aside links to it; `showSaves` is a plain screen with a disposer like any
other.

**D-12 — Controls means keybindings and camera speed, and nothing else (R-3).** Edge pan and
zoom-to-cursor do not exist until Phase 2, and a setting for a feature that does not exist is
a lie. They join this section with the features.

**D-13 — no CJK subset; the locale table carries `dir` (R-4).** `docs/GDD.md:314` names Hebrew
as the deferred second locale, which is RTL and not CJK — the spec's "CJK subset" was a guess
about a language nobody had picked. `LOCALES` carries `dir`, `document.documentElement.dir`
follows it, and the first non-Latin locale brings its own subset under `assets/fonts/` with
its OFL text. Fonts stay self-hosted; this phase added no font file.

**D-14 — settings from the pause menu is a panel inside the modal, not a navigation (R-5).**
Navigating to `/settings` would unmount the mission, which is the one thing a pause menu must
not do. One `settingsPanel()` serves both the route and the modal; the modal mounts it lazily,
on the first open of its Settings tab, and disposes it with itself.

**D-15 — the quality preset is stored from Task 4 and reaches the renderer in Task 14
(R-6).** The plumbing touches `ThreeRenderer.ts`, which the art session held until `dea7e483`.
Between the two, the screen said "applies when the next mission starts" — and it now does
exactly that. `QUALITY_PRESETS.high` is pinned to the constants that existed before the preset
and every new parameter defaults to it, which is why no baseline moved (D-27).

**D-16 — the licence flip, and the four files that had to agree (R-7).** `docs/ART_PIPELINE.md`
§8 recorded art and data as "all rights reserved" since 2026-08-30, ahead of a commercial
release, while `LICENSE`, `data/LICENSE.md` and `README.md` still said CC BY-SA 4.0 — and a
credits screen cannot quote both. Task 8 stated the later decision and aligned the three stale
files; the final review found a fourth, `CONTRIBUTING.md`, one line above "by contributing you
confirm you have the right to license the work under these terms", and the fix wave closed it
(I4). All five now carry the irrevocability note: a Creative Commons grant cannot be withdrawn
from copies already obtained, so the change stops adding to that set and cannot undo it.
**The project lead can reverse this in one line.** The Namer IFV's mandatory CC BY 3.0 credit
(Mutte, BlendSwap #75225) appears on the screen; `JEEP_HULL` does not — see D-26.

**D-17 — `?fresh` stays accepted for one release, and "New campaign" names what it keeps
(R-8).** It is in `KNOWN_PARAMS` and documented in CLAUDE.md, so dropping it would break the
documented spelling silently. The menu's button replaces the `?fresh=1` navigation, and its
confirm deliberately does NOT say the brigade account is erased, because it is not (spec
2026-09-15 §4.1). `?fresh` keeps its exact pre-router meaning and is dropped from the URL
except on a mission landing.

**D-18 — `bootBattlefield` stays in `main.ts` (R-9).** Moving 2,000 lines into a new file
would have made the review diff unreadable for a purely mechanical reason. The extraction is a
function boundary inside the file; a later phase can move the file. What the phase DID owe it
is the disposer contract, which is stated in that function's own header and proved by
`ui:routes`.

**D-19 — audio gains are master, music and SFX (R-10).** `packages/render/src/audio.ts` has
one master bus and an `<audio>` element for music, and nothing else — there is no voice
channel, so a voice slider would be a slider for silence. Voice joins when a voice line ships.

**D-20 — the garage ships in Phase 1 with engine plates, not Phase 3 with renders (R-11).**
The lead added it on 2026-09-17, after the plan was written. The layout, the type scale and
the benefit lines are shell work and do not wait for art, and the running game already
photographs a lit, real unit (`pnpm plates:units`). Phase 3 replaces the plate FILES and
nothing else. Task 16 kept every economy rule unchanged — `gateSentence`, per-unit Buy,
per-track Buy, `ownedTiers`, `applyUpgrades`, the double-click reset — and changed only what
the player sees.

**D-21 — a `ratio` benefit line prints a signed delta, not `before → after`.** The acceptance
sentence says "every rung … carrying a before → after number", and one rung SHAPE deliberately
does not. `sensors.optics` multiplies detection linearly, so `+0.1` on a base of 1.2 is +8%,
not +10%; printing "1.2 → 1.3" would invite the reader to do the wrong arithmetic.
`formatBenefit`'s `ratio` case renders "Optics +8%" instead (`ui/upgrade-benefit.ts`).

**D-22 — the CVD gate's retired ceiling, with the numbers, as a decision for the lead.** The
plan's sanity check assumed the default team colours collapse under simulated deficiency. They
do not. Measured in this repository's own instrument (`tools/src/cvd.ts`, Machado et al. 2009
at severity 1.0, CIE76 ΔE), the worst — closest — default pair per kind is **32.06**
(deuteranopia), **55.46** (protanopia) and **64.84** (tritanopia), every one of them above the
ΔE 25 floor the gate uses for "a different colour at a glance". Protanopia and tritanopia were
never near collapse at all. What ships is therefore one relational check, for deuteranopia
only: the variant's worst pair must beat the default's worst pair under the same deficiency.
**Its measured gain is 33.57 against 32.06 — 1.5 ΔE, below the 2.3 that is a just-noticeable
difference.** Stated plainly: by this branch's own instrument, the deuteranopia variant is not
perceptibly more separated than the default at the pair it exists to fix, and the other two
variants address a collapse that was never measured. Three variants, a validator, a palette
expansion and a runtime resolver were built on that assumption. That may still be the right
call — CIE76 is a blunt metric and no real deuteranope's judgement is in this repository — but
it should be a decision, not an inheritance. **For the lead, before Phase 2.**
One more thing the fix wave measured while repairing that gate (I7): the per-pair ΔE check
**stays green with an entire simulation matrix row zeroed**. It gates the palette, not the
instrument. The grey-identity test is the only thing that can see a broken `simulate`, and
until this wave it compared a simulated value with another simulated value.

**D-23 — the eight `disposed` guards in `bootBattlefield` are defensive and unfalsified.**
They exist because an async art load can complete after the battlefield is gone. Neutralising
all eight and leaving a mission mid-load produced **837 late art requests and zero console
errors either way**, so no test in this branch can distinguish them from their absence. They
stay, stated as what they are: a rule about ordering (`disposed` is set BEFORE the teardown
list is drained, because a disposer can itself settle a promise), not a measured fix.

**D-24 — `pnpm plates:units` runs one browser per unit, and why is unexplained.** A session's
SECOND screenshot loses its WebGL context, on both SwiftShader and Metal — Metal merely fails
faster (14.9 s against minutes). The harness therefore spawns one child per unit against a
shared dev server: 17/17 in **562.4 s**. SwiftShader stays the default and `--metal` is opt-in,
because a uniform set matters more than a fast one. The cause is not understood and is
recorded rather than papered over.

**D-25 — the Pixi backend leaks its WebGL context on a soft leave.** `Renderer.dispose` is
optional on the interface (`packages/render/src/api.ts`) and `renderer.ts` is frozen, so the
three.js backend releases its context on a router navigation and the Pixi one does not. Before
Phase 1 this could not happen — leaving a mission was a page load. Unfreezing `renderer.ts` is
the lead's call; until then, `?renderer=pixi` should be treated as a one-mission-per-tab
escape hatch.

**D-26 — `JEEP_HULL`'s licence is still unverified and still shipping.** `docs/ASSET_PROVENANCE.md`
carries a "LICENCE UNVERIFIED" line for the jeep sprite set; the credits screen credits it as
nothing, deliberately, because crediting an unknown source is worse than naming the gap. Lead
item, carried forward from Task 8.

**D-27 — no bless was needed or taken.** `QUALITY_PRESETS.high` reproduces the pre-branch frame
exactly (every new renderer parameter defaults to the constant that existed before it), and the
golden deltas were measured unmoved at High. Phase 1 touches no world material, no light, no
pass and no scenario. **The baseline this phase leaves behind is still Phase 0's** (`495c1a4`),
and the next phase should read a red `visual` job as a real regression rather than as drift.

### Phase 2's deviations

The plan's twelve rulings (R-1 … R-12,
`docs/superpowers/plans/2026-09-18-shell-upgrade-phase-2.md`), written in here as
D-28 … D-39 as that plan's own landing step requires, with what the executing sessions
measured folded in. Phase 2 landed in two parts: Tasks 1–14 as PR #197 (`8596bc37`) and
Tasks 15–16 as the second landing on `feat/shell-phase-2-render`.

**D-28 — the tutorial's ECONOMY step is deferred; only the hover step shipped (R-1).**
`data/missions/beit_sahwan_0_tutorial.json` declares no `resources` block at all, so
`MissionView.logistics`/`intel` are `undefined`, the strip prints neither field and the
production dock has nothing to spend — a step awaiting a `built` event on a mission that
can build nothing stalls the tutorial silently. Scheduled with the mission economy.

**D-29 — the control-group BAR is a surface over the groups that already existed, not a
new mechanism (R-2).** `main.ts` already assigned on Ctrl/Cmd+digit, recalled on the bare
digit, stamped `renderer.unitGroup[i]` and centred on a double-tap; the bar reads that
same `Map` and a chip click runs the identical recall path rather than a second copy of
it. The digits stay outside `ACTIONS` and remain unassignable as bindings.

**D-30 — "the key on every order button" was already shipped by Phase 1; Phase 2 owed the
TOOLTIP (R-3).** `hud.ts` renders the live binding on all five buttons through
`main.ts`'s `keyFor`, so a rebind is already honoured. Recorded so the next reader does
not implement it a second time; what Task 7 added is the shared tooltip, in place of a
`btn.title` that repeated the label.

**D-31 — "under attack" is derived app-side from `SimEvent`s; only "unit lost" is a sim
change (R-4).** `ui/alerts.ts` reads `fire`/`impact` whose `target` is a side-0 entity
out of the array `main.ts` already hands the renderer and the audio, with no sim change;
putting the per-entity cooldown in the sim would move a HUD cadence decision inside the
tick. `nearMiss` is excluded because it names no target. The one thing the app genuinely
cannot derive is a loss — `destroyed` carries `{entity, by}` and no side or type — so
Task 1 raised `unitLost` properly, and the golden hash did not move.

**D-32 — the range-ring fill is DERIVED from the resolved team hex at draw time, not a new
`data/palette.json` entry (R-5).** G0 decision #3 (issue #164) says a new colour "rides
through the existing team-colour resolver and makes no accessibility claim"; a palette
entry would need four rows (`reserved.team.colors` plus three `reserved.team.variants.*`
blocks) and choosing three variant values IS an accessibility claim. `desaturateHex` in
`overlay-geometry.ts` is applied to `this.opts.teamColors[side]`, which `main.ts` already
resolves per CVD variant, so the variant follows the setting for free.

**D-33 — the minimap's lit ground could not be done inside `packages/app`, so it landed as
Task 15 beside the rings (R-6).** `Minimap.paintTerrain` builds its own 1px-per-tile
canvas from `blocked`/`boulder`/`cover`; the lit albedo is the three.js ground mesh's
material, and `Renderer` had no seam that hands a rendered texture to the app. It took a
new optional `captureGroundAlbedo(sizePx): ImageData | null` on the interface and a render
target inside `ThreeRenderer` — which is why it waited for WP-A1.2, and why Task 10
shipped every other minimap item against the painted terrain. Three consequences worth
carrying: the photograph is a `WebGLRenderTarget` readback resolved through three's own
`OutputPass` (`preserveDrawingBuffer` stays off and is unaffected — CLAUDE.md now says so);
it stands the buildings up first, because `composeTerrain` stops drawing the palette box
for a structure whose art has loaded while `updateBuildingMeshes` runs after this capture
at boot; and the answer is IDENTITY-STABLE, which is what lets the minimap ask on each of
its 4 Hz redraws for the cost of a reference compare and so not lose the race against the
six fire-and-forget ground-texture loads. On `?renderer=pixi` the method is absent, the ask
answers null, and the painted terrain is what shipped.

**D-34 — the in-mission objective tracker is ONE component mounted three ways (R-7).**
`ui/objectives.ts` exports one `objectivesPanel(host, deps)` in `settingsPanel`'s exact
shape; the briefing mounts it, and the strip's `+N` and the pause menu's Objectives tab
open the same component. `ui/pause.ts`'s own `<ol>` was deleted rather than left beside
it, so the list exists once.

**D-35 — a secondary's reward is STATED from the rule that already pays it, never authored
(R-8).** Nothing in `mission.schema.json` carries a reward field and none was added.
`ui/objective-reward.ts` reads `CREDIT_WEIGHTS.carryingSecondary` and `grade.ts`'s third
star and says so in words, naming credits only when `mission.ledger.produces.length > 0` —
the same gate `main.ts` puts on `payMission`, because the tutorial produces nothing and is
paid nothing.

**D-36 — edge pan and zoom-to-cursor shipped WITH their settings rows, and `cameraSpeed` is
reused (R-9).** This discharges D-12's "a setting for a feature that does not exist is a
lie": `Settings.controls` gained `edgePan` and `zoomToCursor` alongside the two rows in
`settings-panel.ts` and the behaviour, in one commit. Edge pan reuses `cameraSpeed` rather
than adding a second speed number the player has never met.

**D-37 — the minimap's ping is LOCAL, silent to the sim, and not a command (R-10).** A
fading mark on the minimap plus a world marker through the existing
`renderer.addOrderMarker`: no `PlayerIntent` kind, no `Command`, no `MissionEvent`, no
network. There is no second player to signal (networking is §8, out of scope), so a ping
that queued anything would be a mechanism with no receiver. Drawn from a local array on a
wall-clock fade, which cannot touch determinism.

**D-38 — a squad wipe coalesces per TICK and per unit TYPE, app-side (R-11).**
`alertsForTick` takes the whole `MissionEvent[]` and returns the whole answer, so nothing
tick-scoped is threaded through `main.ts`: three riflemen lost in one tick read as one line
with a count of three, a rifleman and a tank as two. `ui/mission-notice.ts`'s statement
that `removed` and `evacuated` emit one line each is unchanged — the coalescing is on the
new `unitLost` kind only.

**D-39 — the range rings' "designed arc" is the fill's outer BOUNDARY, not a facing sector
(R-12), and three of the brief's own numbers were overturned by measurement.** A sector
centred on the unit's heading would draw a rule the model does not have: `selectTarget`
gates a shot on identification and range and never on bearing, and no weapon in
`data/units/` declares a traverse limit, so a player who believed it would manoeuvre
against a constraint that does not exist. The shape is a filled annulus from minimum to
effective range with its outer edge drawn as a brighter arc. The three measured
departures, each disclosed rather than quietly taken: **`RANGE_FILL_DESATURATE` is 0.85,
not the brief's 0.6** — at 0.6, 7 of the 12 team colours (default plus three CVD variants)
miss the brief's OWN `< 0.35` chroma budget, worst `#F0E442` at 0.5520, and 0.80 still
misses at 0.3535 against 0.2826 at 0.85, so the brief's budget outranks the brief's
number; **`RANGE_FILL_ALPHA` (0.14) is a TOTAL that `rangeFillAlphaFor(N)` inverts**, `a =
1 - (1 - 0.14)^(1/N)`, because six flat 0.14 annuli composite to 0.596 and the HUD
photographed washed grey — the inversion is the only way a fill holds the same overlap for
any N, and the constant's honest reading is "at most 0.14, equal only under full overlap";
and **`MAX_RANGE_HOOP_ALPHA` is 0.22, the brief's own figure**, a correction of a 0.28 that
shipped undisclosed in the first commit and read louder than intended once the fill's tint
sat under it. No baseline was expected to move: every gated scenario captures with
`selection.length === 0` and `rangeRingPreview === -1`, which is now written down as a
precondition in `tools/src/golden-diff/baseline.ts`.

### Phase 3's deviations (app half)

The app-half plan's twelve rulings (R-1 … R-12,
`docs/superpowers/plans/2026-09-19-shell-upgrade-phase-3-app.md`) as D-40 … D-51, R-n to
D-(n+39), as that plan's landing step requires: one entry each, from the ruling and what shipped
on `feat/shell-phase-3-app` (Tasks 1–10 and the final review's fix wave), saying where the shipped
behaviour departs from the ruling.

**D-40 — this landing is the app half only (R-1).** Five of §6 Phase 3's eight bullets; the scene
host (after WP-A1.3, GH-177), the lit board and basin, and the art pass (D-20) are other lanes'.
`packages/sim` and `packages/render` are untouched; D-44 names the one render-side debt created.

**D-41 — entry conditions, not dates (R-2).** Opened 2026-09-23, before Stage 2's date, because
Phase 2 Tasks 15–16 were on `main`; paused for `feat/gamification-e2e4` (PR #211) and resumed.
Tasks 11–12 wait on G1 (GH-165) and are not in this landing.

**D-42 — deploy permutes the pool, never filters it (R-3).** As ruled (`permutePool`,
`deployedLedger`). Departure: the first `permutePool` reordered interleaved pools under the default
selection (32,514 of 39,360 cases); it is position-preserving now, verified over 335,923 cases, and
`deploy_choice.test.ts` pins a benched slotted veteran through the victory write end to end.

**D-43 — one adapter, one copy of the draw (R-4).** As ruled (`DeployRosterView`, `drawFromPool`).
Departures: `cap` is `ROSTER_CAP`, not `null`, because WP-G-E2 landed first, and the screen does not
read it; `benchable` shipped as `undrawable`.

**D-44 — the runtime is built after deploy (R-5).** As ruled (`startMission`); the permuted pool is
in memory only, so a quit or defeat never reorders the save. Departure: the spawn now follows
`renderer.init()`, which drew the force at (0, 0) and left full shroud until tick 3; the app
re-seeds with three `snapshot()` calls, and `Renderer.reseed()` (with the recorded
`StructureInstancer` miss under `&nomesh`) is owed after WP-A1.3 lands.

**D-45 — the outcome moment is presentation, after the ledger write (R-6).** As ruled, with a
2600 ms hold, z-index 55 and no fade-out for the lead to judge. Departures from the fix wave: an
autorepeat no longer skips it, and the HUD's end banner is suppressed while it shows — so the
banner's second line, a victory's `aftermath` (four arc finales), moved: the moment previews it
under its verdict within the same hold, and the end screen after it carries the same value
(`outcomeMomentOptions`) where it can be read.

**D-46 — 1280 is a fit floor and D-8 has its number (R-7).** As ruled: two breakpoints,
`--menu-col-wide: min(34rem, 82vw)`, 29.75% of 2560 and 32.58% of 1920.

**D-47 — a pin's hover previews the click and never navigates (R-8).** As ruled, click and hover
answered by one `pickOutcome`. Departure: a locked or empty pin's ring also brightens on hover
(unasked, reversible). The hand drive is owed before the PR.

**D-48 — the Phase 2 leftovers went to Tasks 8 and 10 (R-9).** As ruled, and each grew: the focus
trap keeps a stack so nested traps stop fighting over Tab; there were three raw sinks and three
escapers, now one `escapeHtml`; the strip skips an unchanged rebuild. The fix wave added catalogue
unit names at five HUD sinks and the dock tip, and pseudo-locale entities.

**D-49 — the dingbat check is a named list (R-10); not landed.** Gated on G1. Landed: the `★`
exception and its current sites in the plan's Task 11 and G1 questions, including
`campaign.ts:473`, which the plan's inventory missed.

**D-50 — `ROLE_GLYPH` is deleted, not redrawn (R-11); not landed.** Still at `ui/role.ts:42`,
imported only by its own test, until gated Task 12.

**D-51 — victory is photographed, and the defeat capture skips the moment (R-12).** As ruled:
`24-outcome-victory` by waypoint on `beit_sahwan_1_recon`, with an `OutcomeMomentDismissedError`
guard after each outcome shot. Owed before merge: both PNGs from a quiet run.

### Phase 3's deviations (the scene host)

The scene-host plan's ten rulings (R-1 … R-10, `docs/superpowers/plans/2026-09-24-scene-host.md`,
from `docs/superpowers/specs/2026-09-24-scene-host-design.md` §9) as D-52 … D-61, R-n to
D-(n+51), plus three the executing sessions found beyond the ten: one entry each, from the
ruling and what shipped on `feat/scene-host` (Tasks 0, 2–8 and their fix rounds), saying where
the shipped behaviour departs from the ruling.

**D-52 — the host needs `ThreeRenderer.ts` for one additive read, not zero and not a menu
mode (R-1).** As ruled: `groundTexturesSettled(): Promise<void>` (Task 4), placed after
`loadGroundTexture`, one field and three edits inside it. It resolves once every ground-texture
fetch `init()` started has applied or failed, never rejects, and is already resolved before
`init()` runs (a slot the map never uses starts no fetch). A promise obtained before
`dispose()` does not settle at `dispose()` — it settles when the network finishes or fails,
which is the door's exact case (a caller must recheck its own abort signal after the `await`,
which it does). A fourth test beyond the brief's three: called after `dispose()`, it returns an
already-resolved promise even mid-download.

**D-53 — Pixi gets the plate, not nothing (R-2).** As ruled: `hostPath`
(`ui/scene-host-model.ts`) reads the persisted/`?renderer=pixi` choice and returns
`{path:'plate', reason:'pixi'}` before ever probing WebGL2. Driven live (Task 6): `?renderer=pixi`
shows the column on a dark background, one console warning, no request under
`render/src/three/` beyond an import-free fog helper already in the main chunk, and no three.js
requested at all.

**D-54 — reduced motion gets the plate, not a held live frame (R-3).** As ruled, with one
fix-round correction: the first landing (`e0aa2b8a`/`bf8dfcbd`) keyed parallax off the plate's
*reason* rather than off reduced motion itself, so Pixi *and* reduced motion together still ran
the parallax loop. `36f74025` gates parallax on the reduced-motion condition directly, regardless
of path, confirmed by re-running the drive on Pixi with and without reduced motion.

**D-55 — `data-host` gains a fourth, transient value, `pending` (R-4).** As ruled. Driven live
(Task 6): the timeline reads `pending` (274 ms) → `live` (1122 ms), recorded by a
`MutationObserver` because a first poll can race a warm reveal.

**D-56 — the host lives on `/` only (R-5).** As ruled: it is part of the menu screen's own
disposer, not a body-mounted singleton. Driven live: `/` → `/settings` → `/` leaves no host and
no canvas on settings, the old canvas's `isContextLost()` reads `true`, and back on `/` a new
host reaches `live` in 552 ms warm, with no reload.

**D-57 — parallax moves the picture, not the camera (R-6).** As ruled: a CSS `translate3d` on
the poster/canvas layer. Measured at the four corners and centre (1920×1080, Task 6's drive):
roughly ±11.9 px at each corner, settling to (−0.08, −0.08) at centre and to exactly `{0,0}`
once the pointer leaves the window — pinned separately by a zero-viewport unit test asserting
`toEqual({x:0,y:0})` (D-2's ruling).

**D-58 — no WebGL context exists while the slice is on the network (R-7).** As ruled: the
door's prefetch phase `fetch()`es every mesh URL plus the Draco decoder under the host's own
`AbortSignal` and reads each body before constructing `ThreeRenderer`, so a leave during
prefetch releases nothing because nothing yet holds a context. What `ui:routes` showed at
landing was narrower than first written here: its fast-leave leg ran twice (clicks 236 ms,
then 18 ms, after the menu's own load), and at 18 ms the idle callback had most likely not run,
so the leg exercised the cancelled schedule rather than the door's abort; it checked console
ERRORS only. (The "no canvas stashed" wording belonged to leg (a), which stashes the live
host's canvas.) The fix wave after the final review made the claim true: leg (b) now waits for
the host's first `.glb`/`draco_` request and clicks then, a new leg (c) clicks the moment
`init()` has appended the canvas while `data-host` is still `pending`, and all three
scene-host leaves fail on a console WARNING matching
`/WebGL|loseContext|scene host|DRACO|Worker/i` (SwiftShader's `GPU stall due to ReadPixels`
note exempt by its full text). Note that leg (b) cannot tell the prefetch from the mesh load
from the DOM -- `ThreeRenderer` is constructed before the loads and its canvas appended only
by `init()` -- and one falsification run proved a leg-(b) click had landed in the load, with a
context to release.

**D-59 — the camera target is (27, 22), not the measured (28, 22) (R-8).** As ruled: M19's
margin test failed at (28, 22) (corner ratio down to 0.189 against a ≥1 floor, at
1366×768/1920×1080/2560×1440) and passes at (27, 22) across all seven pinned viewports (Task 3).

**D-60 — `ui:routes`/`ui:shots` gain `--port`; `plate:host` takes its own free port (R-9).**
The instruments' own `--port` flag predates this plan (#214, landed on `main` before Task 1
ran, so Task 1 was skipped as superseded — CLAUDE.md's own line, ~:306). What this plan adds is
`plate:host`'s port: `claimPort('plate-host', 'PLATE_HOST_PORT', 5183)`, exercised at 5190 in
Task 7's capture and 5183 as the tool's own default/fallback.

**D-61 — the colour-register acceptance is a gate vote, camera-for-camera, not a one-off
reading (R-10).** As ruled: `checkMenuSceneHost`'s three votes (path, contribution, register) in
`tools/src/golden-diff/screens-check.ts`, wired into `three-baseline-gate.ts` right after
`checkCampaignBoard`. `MENU_HOST_CONTRIBUTION_FLOOR` is measured, not guessed: three identical
readings of 91.3279 (SwiftShader, clean tree) give a floor of 30.4426 (a third of the minimum).
The register reads host Y 0.2439 / S 0.3035 against mission Y 0.2451 / S 0.3020 — dY −0.5%, dS
+0.5%, inside the 10% band and close to spec M16's own −1.7%/+0.5% (measured against an earlier
probe build, not this door). All four planned falsifications (dropping the door's own
`dispose()` call; leaving fog on; forcing the plate path; leaving the poster in place after
reveal) failed the vote each names, in the direction predicted.

**D-62 — no explicit `loseContext()` in the door, and why (C3, not one of the ten R-s).**
Superseded before it could be written: `ThreeRenderer.dispose()` has released its own context
since PR #219 (`packages/render/src/three/context-release.ts`: `dispose()`, then
`forceContextLoss()`, skipped if `isContextLost()` already reads `true`). The door's `release()`
therefore calls `renderer.dispose()` and nothing else. A re-added `loseContext()` does one of
two things, measured on SwiftShader in the fix wave: asked for through a fresh
`getExtension('WEBGL_lose_context')` after `dispose()` it is silent dead code, because
`getExtension` returns `null` on a lost context; through a handle taken BEFORE `dispose()` it
logs `WebGL: INVALID_OPERATION: loseContext: context already lost` as a warning. `ui:routes`
now fails on that warning around each of its three scene-host leaves; the held-handle re-add
went red in all three (fix wave). Until the fix wave the "leave check allows no warning" this
entry cited collected console errors only, so it could not have failed. Spec M14/M15 and §3.3 (6)'s explicit-loss clause predate #219 and are superseded
(marked in place, along with §4 and §7, in
`docs/superpowers/specs/2026-09-24-scene-host-design.md`). `ui:routes` asserts the host's canvas
reports `isContextLost() === true` after leaving the menu; its falsification was dropping
`renderer.dispose()` from the door's `release()`, which failed exactly that assertion (Task 8,
mutation (a)). That is a PROXY for the scene-host spec's §10 memory budgets (≤ 900 MB GPU
footprint while live, ≤ 60 MB within 1 s of leaving), not a measurement of them: the landing
checked only that the context reads lost, never what the GPU process holds. Nor did any landing
run record `data-host-motion` reaching `held` on SwiftShader (§3.3 (5)); `ui:routes` leg (a)
prints it now, at `live` and at the leave click.

**D-63 — the main chunk grew +6,760 B against the plan's own ±1 kB (Task 6).** Accepted: the
model, the executor and `buildDioramaWorld` must ship in the main chunk for the plate to show
at once on the very first paint, and moving the diorama builder behind a dynamic import would
only save ~1.3 kB at the cost of making `world()` asynchronous. The door itself is its own
chunk, 2,923 B, sharing `ThreeRenderer` and three's core chunk with an ordinary mission — the
host downloads no JavaScript a mission would not and warms that cache for it.

**D-64 — the gate's new menu-host check costs 41.7 s inside a 165 s local `pnpm
golden-baseline` run (Task 8), one macOS run, headless Chromium, SwiftShader.** Almost all of
it is the register vote's own mission-side boot (mesh/GLB loads under SwiftShader), which the
review judged inherent to the camera-for-camera design (D-61) rather than waste. The
contribution floor is 30.4426, a third of three identical readings of 91.33; the register reads
host Y 0.2439 / S 0.3035 against mission Y 0.2451 / S 0.3020.
