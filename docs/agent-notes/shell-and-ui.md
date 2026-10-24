# Shell, UI, i18n, telemetry and browser harnesses

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 208-300, section "Dev instruments" -->

- **Hosting and telemetry (WP-T1).** The playable build deploys to Cloudflare Workers from
  `main` (`wrangler.jsonc`; GitHub Pages retired when the repo went private). The game sends
  anonymous events to `/api/events` ONLY from a production build on a real host, or with
  `?telemetry` -- never from `pnpm dev`, tests or CI, because `pnpm ui:routes` fails on any
  console error. `?tester=<name>` labels a tester, `?notrack` opts out (persisted). Results
  are read from the terminal with `packages/worker/QUERIES.sql` (`npx wrangler d1 execute roaring-lions-telemetry --remote --file ...`), still available as an alternative; `/stats` is behind a password set with `npx wrangler secret put STATS_PASSWORD` -- make it long and random (e.g. `openssl rand -base64 24`), not a memorised phrase, since a captured session cookie hands over the signing key too -- and answers 403 until that secret is set. Spec: `docs/superpowers/specs/2026-09-24-telemetry-design.md`.
- **In-game feedback (GH-464) is a PUBLIC write endpoint**, open to every player in v1 by the
  lead's ruling. `POST /api/feedback` (multipart: `meta` JSON against
  `data/schemas/feedback.schema.json`, whose Worker twin is `packages/worker/src/feedback-meta.ts`;
  optional `shot`, WebP only, 64 KB, kept in D1's `feedback_picture`; optional `replay` JSON, bugs only, in `feedback_replay`) answers
  201 with a `FB-0042` reference (plus `dropped` when a picture was over 64 KB or the D1
  attachment budget is spent: the note lands, the attachment does not), and is capped, origin-checked and rate-limited per IP, session,
  player and globally. **The kill switch needs no app deploy**: the "Close feedback" button on
  `/stats/feedback` (a D1 `flags` row), or `npx wrangler secret put FEEDBACK_CLOSED`; either
  makes POST answer 410 and `GET /api/feedback` answer `{"open":false}`. Triage, the session
  timeline and the prefilled GitHub issue URL (never a token, never the tester's name or
  contact) live at `/stats/feedback`. A daily cron purges pictures, replays and contacts after
  180 days. Spec: `docs/superpowers/specs/2026-10-08-in-game-feedback-design.md`, section
  "Server contract as built".

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

<!-- CLAUDE.md lines 322-338, section "Dev instruments" -->

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

<!-- CLAUDE.md lines 375-415, section "Dev instruments" -->

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
- **Test browsers start with music off, and the seed comes from ONE helper**
  (`tools/src/ui-review/music-off.ts`: `musicOffInitScript()` for
  `addInitScript`, `SILENT_AUDIO` for captures that want every channel quiet).
  Never write `lions.settings` by hand: `parseSettings` throws away any object
  whose `version` is not 1 and uses the defaults, so `{ audio: { music: 0 } }`
  left the music ON in three capture tools. `music-off.test.ts` runs the seed
  through the real parser and fails on any tool that writes the key itself.

<!-- CLAUDE.md lines 601-626, section "Dev instruments" -->

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
  locations is the retired `SPRITE_MAP`'s failure mode and would go stale the
  same silent way. Two consequences worth knowing: a running browser now reloads by itself
  when a GLB lands, and the six watched directories are printed at `pnpm dev`
  boot, so "is my new mesh's directory covered?" is answered by the banner.
