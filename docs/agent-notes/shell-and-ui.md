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
- **The Settings footer names the build's short commit** (`Build <version> · <sha>`, `settings.buildCommit`;
  `shortCommit` in `build-commit.ts`). The commit is `__APP_COMMIT__`, fixed at BUILD time by
  `packages/app/vite.config.ts`'s `appCommit()`: `WORKERS_CI_COMMIT_SHA` (set by Cloudflare Workers Builds, so the
  deployed build has it with no git), then `GITHUB_SHA` (GitHub Actions), then `git rev-parse HEAD`. With none of
  them (no git, a tarball) the footer reads `dev`. It is the first 7 digits of the same full commit that the room's
  build id carries (`${version}+${commit}`), so `pnpm bot` against a deployed room can be matched to a checkout.
  Display only; never in a URL.
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

## Coin rules live in @lions/economy (GH-1075 A0)

The pure coin and brigade rules (wallet, brigade account, sha256, the campaign
world and gate, campaign close, the earn table, the Stores model) moved from
`packages/app` into `packages/economy` (`@lions/economy`), which imports `sim`
and `data` only so the Worker can share them. The old app paths stay as thin
re-export modules, so no call site moved: `roar-wallet`, `brigade-account`,
`sha256`, `campaign`, `gate-sentence`, `campaign-close`, `roar-earn` and
`ui/stores-model`. The G-V2 fence (`ROAR_FENCE`, GH-317) now also covers
`@lions/economy` and `packages/worker/src/match/**`, so neither the sim, the
renderer, the net package nor the match code can import the wallet. The tests
stay in the app (the app is where the behaviour is driven); `parseWorld` lives
in `packages/economy/src/world.ts`.

## Stores: What it adds, and credit runs (GH-1076, GH-1077)

Plan: `docs/superpowers/plans/2026-11-07-store-garage.md` (its Conflicts and R0.x rulings win). Landed as
PR 1114 (`creditAsk`/`buyUpgradeRun`), 1115 (`unitAdds`), 1117 (threat table), 1118 (balance fit), 1119 (Garage
credit Buy), 1120 (the panel), 1122 (Stores tier-row credit Buy). PR 1123 (the nine tracks plus the 11 close-ups) was still open when this was written.

- **`unitAdds`** (`packages/app/src/ui/stores-adds.ts`, drawn by `stores-adds-view.ts`) is one pure model behind the
  Stores' "What it adds" panel. The versus line follows PR 1110: a bought-only unit with `specialRefusal(id) === null`
  shows `brigadeRoom`; `campaignOnly` shows whenever neither `brigadeRoom` nor a versus line applies (`!brigadeRoom && !versus` in `stores-adds.ts`), so a unit that gets `brigadeRoom` (bought-only and not refused, such as `spg_long_range`) never shows it, even if the versus room holds it out. What shows it is the refused three, and every other unit that is held out of versus without being bought-only (`heli_yanshuf` has an earned `roe_rating_min` gate). The refusal is injected
  (`AddsInput.refusal`), the app keeps no copy of the list.
- **The Hurt-by table is generated.** `pnpm store:threats` (`tools/src/store/threat-table.ts`) asks a headless
  `Sim`'s own `focusHurts` and writes `threat-table.json`. `tools/src/store_threat_table.test.ts` goes red on any
  roster or tuning change until it is regenerated: regenerate the JSON, never hand-edit it. The test's own literal
  assertions (R0.10, for example which enemy appears in which unit's list) are different: they are the maintainers' to
  update by hand when a roster change legitimately changes them. The generator throws if a type's `isAirborne` does not
  match its domain (R0.9); the side plate (facing 16384 reads `presentedArc` 1, facing 0 reads 0) is asserted by the
  test, not the generator, so run `store_threat_table.test.ts` after every regeneration. `wounded_sarim` is excluded by
  `role`, never by id.
- **R3 with R0.1.** `creditAsk(prices, earned, owned)` (`upgrade-pay.ts`) prices a credit run: credits fill the earned
  path below the tier they buy. It returns `null` when the single-player tier is already the top, whoever paid for it.
  There is no "Count online" run (R0.1, ruled by the lead). `owned` is `max(earned, coins)`; no caller reads the wallet
  to price a credit Buy. `buyUpgradeRun` writes only `balance` and `upgrades`, so `ACCOUNT_VERSION` stays 2.
  **`buyUpgradeRun` prices itself** (GH-1146): it takes the track's tier price table, never a total, and charges
  the sum for `from..to`. `credit-buy.ts` still recomputes `creditAsk` to refuse a STALE `to`/`price` from the button.
- **A2 requirement (stale cache).** `creditAsk` reads the coin tier through the cache. A coin spend still in the
  outbox can leave the cache one tier low, and a credit run would re-buy a tier coins already own (R4). When A2
  makes coin spends server-authoritative, DISABLE the credit Buy on a track with a pending coin spend for that
  track. GH-1142 is done (A2): `pendingSpends` on the account store disables it. `buyUpgradeRun` itself is GH-1146.
- **Known gaps left open** (each has an issue): `pnpm playtest` only exercises the medic's track, not the other eight (GH-1144); possible
  existing overflows at 1280 on the Garage cards and at 1920 on pseudo card text (GH-1145).

## Accounts A2: claim and sync (GH-1075)

Behind `?accounts`. Sources: `packages/app/src/account/` (`account-store.ts`, `outbox.ts`, `sync.ts`, `claim.ts`,
`local-held.ts`); rulings in `docs/superpowers/plans/2026-11-09-accounts-a2.md` section 0. A2 adds no migration and no
binding.

- **Coins move only through the server routes.** The signed-in `accountLedgerStore` reads the wallet and never writes it:
  `writeRoar`, `restoreRoar` and `resetAccount` throw `ServerCoinsError`. A coin Buy, a coupon and the brigade reset are
  BARRIER ops (`sync.barrier`, section 0.18): never queued, sent only with an empty outbox, refused offline or while the
  outbox drains. The server's journal balances (A2-24, the double spend).
- **The outbox is per tab** (`lions.account.outbox.<tabId>`, section 0.38). A tab's writes append to its own key, so one
  tab can never overwrite another's. The flusher runs under `navigator.locks` (`lions.account.flush`); with no Web Locks
  a tab flushes alone and a 409 keeps the other tab's campaign as a conflict slot, losing nothing.
- **The send base** (R12, R17) is the campaign revision the queued campaign ops are sent on. It is pinned at QUEUE time
  (the revision the snapshot was built on), lives in this tab's own outbox value, and is advanced only by THIS tab's
  acks, never by another tab's write to the shared cache.
- **The conflict rule.** A 409 on a campaign op drops the campaign ops queued behind it; they are never re-based. The
  newest queued snapshot becomes the body of the conflict slot the 409 named, or, with every system slot full, goes to
  the held list. A queued victory behind it is sent coins-only (`campaign: null`). A victory's coin half is a fact and is
  paid; its campaign half follows this rule and the answer is 200 with `conflict` set.
- **The held list** is `lions.account.local` (`local-held.ts`): work this device holds that the server did not take,
  kept verbatim. Reasons: `cap` and `size` (a claim slot the server rejected), `invalid` (a damaged `lions.saves` entry,
  never sent), `held` (a campaign body displaced by a 409), `refused` (a wedged or refused op, kept whole). A held item is
  written BEFORE the cache changes or `lions.saves` goes, and leaves only on its own digest. A refused held write keeps
  every guest key (A2-19).
- **The claim.** `runClaim` mints or reuses the binding's `deviceId`, writes the `lions.account.claiming` marker
  (`{deviceId, digests, at}`) and the guest store refuses writes until it resolves. `finishClaim` writes in this order:
  the held items, the cache, the binding's `claimedAt`, then `removeGuestProgress`; a digest mismatch removes nothing and
  retries. The guest store refuses writes only under `?accounts` (without `?fresh`): with accounts off the marker is
  inert. At boot `finishInterruptedClaim` removes leftover guest keys only when the marker is present with the binding's
  `deviceId` (`finishClaim` takes the marker last): guest keys beside a claimed binding and no marker are the player's own
  play and stay. A device with no guest progress sets `claimedAt` and makes no claim request.
- **Sign-out and deletion** (section 0.46) run in `account/sync.ts` over the account store, never as a bare
  `client.logout()`: `signOut` flushes (5 s), files what is left as `refused`, sends the logout (`logoutAll` for "Sign out
  everywhere", passed in), then clears the cache, every outbox and heartbeat key of that member, `claimedAt` and
  `deviceId` (A2-30). Deletion stops the loop and runs `wipeMember` (the same filing and clearing), then `clearBinding`.
  Both then HARD-reload through `shell/links.ts`'s `reloadMenuHref`, which keeps the sticky query keys (`?accounts`, `lang`,
  `pseudo`): a reload without `?accounts` lands the device on the guest store. `main.ts` hands the profile these
  dependencies only when the sync handle and the account store exist; on an unclaimed binding the profile logs out and
  clears the device id itself.
- **The sync loop starts unverified** (I1): one `GET me` must name the cache's member before the first refresh or send.
  Another member signed in (a Steam redirect) means no state applied, no op sent, `onForeignMember` called. A store adopts
  its tab's outbox key only when it is that member's (or the old unowned shape).
- **Privacy and telemetry.** The page at `/privacy` lists the A2 data (A2-32). Telemetry and the feedback context carry
  neither the public id nor the device id (`account/unlinked.test.ts`, A1-10 extended).

## Accounts A1: bindings, the switch and the runbook (GH-1075)

Sources: `packages/worker/src/account/`, `packages/worker/migrations-accounts/`, `wrangler.jsonc`. Plan:
`docs/superpowers/plans/2026-11-08-accounts-a0-a1.md`, Task 1.11. The agent never runs `wrangler`; the lead does.

- **What is bound.** `ACCOUNTS` (D1 `roaring-lions-accounts`, a second database, never joined to `DB`), `ACCOUNT_TOMBSTONES`
  (KV), and the limiters `ACCOUNT_LIMIT` (1007, 10 a minute) and `ACCOUNT_OP_LIMIT` (1008, 60 a minute). `/privacy` is in
  `assets.run_worker_first`; `account/wrangler-pin.test.ts` fails if `ACCOUNTS` is bound without it or without both limiters.
  Without the `ACCOUNTS` binding every `/api/account/*` path answers 503. No account secret exists: the per-IP budgets use
  `TICKET_SECRET` (or `STATS_PASSWORD`) through `ipSecret`, and the per-IP counts are skipped when neither is set.
- **The switch** is the `flags` row `accounts` in the ACCOUNTS database. Anything but `'open'`, including no row, is CLOSED.
  Closed, a Steam ID that belongs to no member makes no account; existing members still sign in, and `delete`, `export`,
  `gone`, `logout` and `logout-all` work. `GET open` reports the switch to the app.
  - **Open** (lead only, after the PR is merged and deployed and `GET https://roaring-lions.pint12.workers.dev/privacy` answers 200):
    `npx wrangler d1 execute roaring-lions-accounts --remote --command "INSERT INTO flags (name, value, updated_at) VALUES ('accounts', 'open', unixepoch() * 1000) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"`
  - **Close:** the same command with `'closed'` in place of `'open'`. No deploy is needed either way.
  - Players sign up from `/?accounts`.
- **Before the first merge:** `npx wrangler d1 migrations apply roaring-lions-accounts --remote`. Merging deploys to
  production from `main`, and a Worker bound to an unmigrated database fails.
- **Tombstones** are KV keys `tomb:<sha256(public_id)>` in `ACCOUNT_TOMBSTONES`, value `{deletedAt, lastSeenDay}`, TTL 90 days
  (`TOMB_TTL_S`). They hold a hash only. A delete writes the tombstone FIRST, then one D1 batch; the daily cron
  (`sweepAccounts`, then `reconcileTombstones`) finishes any delete whose tombstone exists while its member still does.
- **After a D1 Time Travel restore** of the ACCOUNTS database, CLOSE the switch first. A restore can bring back members
  deleted since the restore point, and their tombstones in KV then say they are gone. Re-apply the deletions (the
  tombstone re-apply script, built in A4) and only then reopen. Until A4 builds it, do not restore without closing.

## Accounts A3: versus records (GH-1075)

A versus match a member plays is recorded on the member's account, but only a result the server can stand behind.
Sources: `packages/worker/src/match/` (`room-core.ts` `recordOf`, `record.ts`, `routes.ts`), `account/seat-member.ts`,
`account/matches.ts`, `packages/net/src/bot-model.ts`, `packages/app/src/net/seat-label.ts`; rulings in
`docs/superpowers/plans/2026-11-11-accounts-a3.md` section 0 and its "Lead rulings" (GH-1075, 11 Nov). **A3 adds no
migration and no binding**: `match_record` and `match_seat` are in `0001_members.sql` already, and A1 built their
export, delete and orphan sweep.

- **The member comes from the cookie, never the body** (section 0.13). Only `seatMemberOf` reads the session for a seat;
  `routes.ts` puts the result into the Worker-to-room request field by field, and the room keeps it in
  `RoomMeta.members`. The seat ticket is unchanged. With `ACCOUNTS` unbound, or a failing accounts database, the seat is
  a guest's and nothing errors.
- **Agreed results only** (`recordOf`, pure, in `room-core.ts`). `over` carries `result {winner: seat, by}` (a SEAT, not
  a side). Two reports that differ in tick or result void the record for good, whatever ending follows (section 0.23). A
  settled `over` beats a later `bye` (a winner who closes the tab still wins, section 0.7). A room-decided end
  (`surrender`, `forfeit`, a started `left`) with no settled report names the other seat the winner, agreed. A lone
  report is written `agreed = 0` and never counts. `void`, `expired`, a lobby `left` and a sandbox room write nothing.
- **The hash rule** (section 0.24). Agreement also needs a COMPARED hash pair within one cadence of the result tick:
  `lastHashTick >= 0 && lastHashTick >= overTick - hashEveryTicks`. **Changed since the plan (PR 1280):** the first
  version let an early over through, because `lastHashTick` starts at -1 and `-1 >= t - 20` held at tick 19 or earlier.
  So (a) matching reports with no compared hash record nothing (no record, not even unconfirmed), and (b) the room
  ignores an `over` whose tick is not a hash-window tick (`(tick + 1) % hashEveryTicks !== 0`): an honest sim decides
  only there. That closes a forged tick-0 `over` followed by a leave, which would have turned the room's agreed loss
  into an unconfirmed claim.
- **Labels are never in `MatchConfig`** (section 0.14). A member's public id and display name travel in the `lobby`
  message only (`SeatState.member`, built field by field in `lobbyFor`); the app keeps them and hands them to the match
  HUD (`seatLabel`, `nameFrom`). `config` goes to the desync log, replay files and feedback reports, so nothing a
  member is called may be in it. The internal member id, the token and the SteamID never leave the server. A1-10,
  extended, is the proof (`match-room.test.ts` `A1-10 (extended)` and `account/unlinked.test.ts`).
- **The declared bot model** (section 0.16, ruling 2). A bot client declares the model that drives it: a listed id from
  `BOT_MODELS` (`scripted`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`; append-only,
  because rows name ids) or `other` plus a typed name, cleaned by `cleanCallsign` (24 code points) on the client and
  again on the Worker. It is a LABEL: it makes no seat a bot, moves no W-L, and is dropped for a member seat or a human
  seat. It is stored in `match_seat.bot_label` as `id:<id>` or `other:<name>`, on a bot row only. History and the lobby
  show a listed id through `t('bot.model.<id>')` and a typed name as a text node, never as HTML. The lead can blank a
  typed name from `/stats` (`POST /stats/api/bots/blank`), and a display name (`/stats/api/members/blank`, which resets
  it to the public id; no lock). **The column's SQL comment in `0001_members.sql` ("a bot preset's label, never text a
  person typed") is stale and is not edited** (no migration): the column now holds an operator-declared model.
- **W-L counts every agreed result** (ruling 1): guests and bots included. The two-tab risk (beating your own signed-out
  tab, or a client that claims to be a bot) is accepted; versus pays 0 coins and writes no wallet or journal row.
  `memberRecord` never reads the other seat's row, so no opponent filter can creep in. A member deleted mid-match
  leaves the other seat's history intact (the seat becomes `deleted`).
- **The profile** reads `GET /api/account/matches?before=<cursor>&limit=<n>`. **Changed since the plan (PR 1263
  review):** `next` and `before` are a STRING cursor `<started_at>.<code>`, the pair the query orders by, so two matches
  with one start time can straddle a page boundary without a skip. A malformed cursor is 400 `query`. The "Show my
  record" toggle rides `PATCH profile` `showRecord`.
- **The breaker** (section 0.21). Each record reads `acct-all` first and skips the write, logged, when the day is spent;
  a record bumps `acct-all` by `RECORD_ROWS` (4) and no member's `acct-ops`. The lead stops every record with no deploy:
  `npx wrangler d1 execute roaring-lions-accounts --remote --command "INSERT INTO flags (name, value, updated_at) VALUES ('records', 'closed', unixepoch() * 1000) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"`.
  To reopen, set the value to `open` the same way, or `DELETE FROM flags WHERE name = 'records'` (a missing row means
  records are written). The agent never runs either.
- **Privacy.** `/privacy` has the versus item (A3-9, `names_the_a3_data`): the map, sides, result and time, the
  opponent's kind, the declared bot model, and that a guest opponent's name is never stored.
- **Gate still to come.** A3 deploys inert while `ACCOUNTS` is unbound (A1 Task 1.11). The lead's friend match, two
  members through Steam, is played after 1.11; A3 counts as done only then.
