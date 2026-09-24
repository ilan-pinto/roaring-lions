# Player telemetry and Cloudflare hosting — design

**Status:** approved by Ilan 2026-09-24; revised the same day with the
execution-plan session's eight review findings (soft-navigation abandons, 14
tutorial steps, service-worker scope, `packages/worker`, D1 headroom, IP rate
limit, consent, tester wording). Both decisions taken the same day: two backends deliberate; consent accepted for the private test, a menu notice before public launch.
**Work package:** WP-T1 (proposed by the execution-plan session; lane A plus a
new `packages/worker`; GitHub #218).
**Brainstormed in:** session "Roaring Lion GitHub Pages deployment".

## Why

The repository went private around 21–23 Sep 2026 and its GitHub Pages site went
with it. The playable build now deploys to **Cloudflare Workers** (static assets,
auto-deploy from `main`). Ilan wants to know, for real players:

1. how many people played,
2. for how long,
3. how far they got — and why they stopped there.

A named secondary goal: CLAUDE.md records that *no real-player duration has
ever been measured for any mission* and that every `target_minutes` is design
intent that survived a floor check. Mission start/end/duration events are the
first instrument that can measure one. The `/stats` per-mission table shows
median real duration against `target_minutes` for exactly that reason.

## Decisions taken while brainstorming

| # | Question | Decision |
|---|---|---|
| 1 | Who is measured | Anonymous by default; optional `?tester=<name>` label |
| 2 | Depth | Milestones **plus** in-mission detail (objectives, duration, ROE, loss cause). No per-command stream |
| 3 | Where results are read | A private `/stats` page on the Worker, behind a password login (§4) |
| 4 | Storage | D1 (kept forever), not Analytics Engine (3-month retention) |
| 5 | Shape | One Worker serves the game, `/api/events` and `/stats` — not two Workers |

## Architecture

```
packages/app/src/telemetry/  --batched POST /api/events-->  packages/worker --> D1
        ^ reads runtime events and state only                   |
        |                                                        v
   main.ts / mission-start.ts / tutorial caller            /stats (password)
```

Dependency direction is unchanged: `telemetry/` lives in `app`, imports nothing
from `render`, and `sim` does not know it exists. Invariant 4 holds: telemetry
subscribes to the runtime's existing `objective` / `missionEnd` events and reads
state; it never writes sim state and cannot affect an outcome.

## 1. Events

Every event carries an envelope:

| Field | Meaning |
|---|---|
| `type` | event name below |
| `player` | random UUID stored in `localStorage`, created on first visit |
| `session` | random UUID per page load |
| `tester` | from `?tester=`, persisted once seen; absent otherwise |
| `build` | the full `APP_BUILD` version (e.g. `0.78.0`) |
| `t` | client epoch ms |

No e-mail, IP or full URL is stored. The `tester` label is chosen by the tester
(or by Ilan when he hands out a link) and may be a name; nothing else identifies
a person.

| Event | When | Payload |
|---|---|---|
| `session_start` | page load | screen (`menu`/`campaign`/`mission`/`tutorial`/`sandbox`), renderer, viewport, `returning` |
| `heartbeat` | every 60 s while the tab is visible **and** a mission is running | mission id, game time (ticks) |
| `tutorial_step` | a tutorial step opens | step index, step count (read from `data/tutorial/beit_sahwan_0.json`, 14 today — never hard-coded), ms spent on the previous step |
| `mission_start` | deploy is clicked and the runtime starts | mission id, `replay` (already won), furthest mission unlocked |
| `objective` | an objective becomes `complete` or `failed` | mission id, objective id, type, primary, game minute |
| `mission_end` | victory, defeat, or leaving mid-mission | `result` (`victory`/`defeat`/`abandoned`), `cause`, duration (ticks), ROE score, units lost / fielded, objectives completed |
| `campaign_progress` | a victory merges into the ledger | furthest mission unlocked, missions won |

**Loss cause.** `mission.ts` already decides defeat from three conditions
(`wiped`, `roeFailed`, a failed primary — ~L1578) but does not expose which.
Add a **read-only** `defeatCause` getter to `MissionRuntime` returning
`'force_destroyed' | 'roe_collapse' | { objective: id }` or `undefined`. It reads
state only; `pnpm test:determinism` must stay green with the golden hash
unmoved. Reviewer: the `sim-guard` agent.

**Abandoned.** Most abandons are *soft*: the HUD's leave button and the pause
menu's Quit call `req.navigate`, and no `pagehide` fires. So
`mission_end{result:'abandoned'}` is sent from `bootBattlefield`'s **teardown**
whenever the runtime has no result yet — registered as a disposer where the
listener is created, idempotent, per the disposer contract. `pagehide` +
`navigator.sendBeacon` stays for a closed tab. Both paths share one
per-mission guard, so a victory followed by a leave sends exactly one
`mission_end`. When even the beacon is lost, the last `heartbeat` marks where
the player stopped. (The context-release branch reorders teardown registration
in this function; implement on top of it.)

**Sandbox.** `?sandbox` sessions send `session_start` only, flagged `dev: true`,
and `/stats` excludes them by default.

The event shape is defined once in `data/schemas/telemetry_event.schema.json`.
Both `events.ts` tests and the Worker validate against it. Check whether
`packages/data/src/index.test.ts` pins schema registries that need the new file
added; run `pnpm validate:data`.

## 2. Client (`packages/app/src/telemetry/`)

- **`events.ts`** — pure builders from runtime facts to event objects. Unit-tested,
  each output validated against the schema.
- **`identity.ts`** — player id, tester label, opt-out flag. Every storage access
  is guarded (a blocked `localStorage` throws on property access; in this vitest
  jsdom config it is a bare `{}` on local Node 25). If storage fails, the id lives
  for the session.
- **`sender.ts`** — in-memory queue, flushed every 30 s, on `mission_end`, and on
  `pagehide` via `sendBeacon`. A failed batch is dropped, never retried in a loop.
  No `await` in the frame loop; every entry point is wrapped so a failure is
  silent.
- **Hooks** — each one a single call into `telemetry/`:
  - page load (boot),
  - `mission-start.ts`'s `startMission` path (since #212 the runtime is built
    after deploy, so this is where `mission_start` and the runtime listeners
    attach — **not** `main.ts`'s deploy handler),
  - the ledger merge on victory (`main.ts` ~L1780 on the date of writing; this
    region is being edited by `fix/renderer-context-release`, so locate it
    afresh when implementing),
  - the tutorial step advance (caller of `tutorial/runtime.ts`'s `advance`).

**Off switches — must be airtight.** Telemetry is disabled unless the build is a
production build (`import.meta.env.PROD`) served from a non-localhost origin, or
`?telemetry` is on the URL. This matters for CI, not just data hygiene:
`pnpm ui:routes` fails on any console error and the golden gate boots the dev
server, so a beacon to a missing `/api/events` on Vite would turn the visual job
red. Also disabled when the browser sends Global Privacy Control
(`navigator.globalPrivacyControl`) or Do Not Track, and by `?notrack`
(persisted).

**Service worker.** The worker script is `assets/sw.js` (`src/service-worker.ts`
only registers it), and its policy is `strategyFor` in the app's `sw-policy`.
Non-GET already returns `'passthrough'`, so `POST /api/events` is safe. But
`/stats` and `/stats/api/*` are same-origin GETs it may cache — a stale
dashboard, or a cached login redirect. Both prefixes (and `/api/`)
must return `'passthrough'`, with a case in `packages/app/src/sw-policy.test.ts`
whose red is recorded before the fix.

**Player-facing text.** None is planned. If any appears (e.g. a privacy line in
the menu), it goes through `t()` and passes `pnpm validate:ui`.

## 3. Worker (`packages/worker` + root `wrangler.jsonc`)

**Home.** `packages/worker`, not a root `worker/` directory:
`pnpm-workspace.yaml` covers `packages/*` and `tools`, so only there do root
`pnpm lint`, `pnpm typecheck` and `pnpm test` reach it. It may import
`@lions/data` for the schema (data is a leaf); nothing imports it. Its tests run
in the repo's existing node vitest project against a `node:sqlite`
adapter shaped like D1 (D1 is SQLite, so the real migrations and queries run);
the Workers runtime itself is exercised by `wrangler dev` and the deployed check. The root
`wrangler.jsonc` points `main` at `packages/worker/src/index.ts` and `assets` at
`packages/app/dist`. CLAUDE.md's package layout gains one line for it.

Routes:

- `POST /api/events` — body ≤ 64 KB, ≤ 50 events. Each event validated against
  the shared schema; invalid ones dropped silently. Rate-limited on the
  connecting IP (Cloudflare's `CF-Connecting-IP`, held in memory by the
  rate-limiting binding and **never stored**), because the `player` id is
  client-supplied and spoofable. `Origin` must be the site's own. Always
  answers `204`.
- `/stats` and `/stats/api/*` — the dashboard, gated by a password login (see
  §4) rather than Cloudflare Access.
- everything else — static assets from `packages/app/dist`, exactly as today.

D1 tables:

- `events` — one row per event: `type, player, session, tester, build, mission,
  t, received_at, payload JSON`. The raw record, kept forever.
- `players` — one row per player: `first_seen, last_seen, seconds_played,
  furthest_mission, missions_won, tester`, upserted **once per request** (not per
  event) so headline numbers are one query.

Migrations live in `worker/migrations/`. Once `wrangler.jsonc` exists the
Cloudflare build settings simplify to deploy command `npx wrangler deploy` —
Ilan edits that in the dashboard in the same step as the merge.

Free-tier headroom: D1 allows 100k rows written/day. Each event is one
`events` insert, and each request (a batch, flushed at most every 30 s) adds one
`players` upsert — about 180 rows per player-hour, so **~550 player-hours a day**
on the free tier. Past that, the $5 Workers plan raises the limit to 50M rows a
month.

## 4. `/stats`

One page, date range (7d / 30d / all) and a filter (everyone / testers / one
tester):

1. Headline — players, sessions, total hours, median minutes per player,
   day-2 return rate.
2. Players per day, new vs returning.
3. Funnel — tutorial → campaign missions in campaign order, share reaching each,
   biggest drop highlighted; plus a tutorial funnel over every step (the count
   comes from the events, so it follows the tutorial data).
4. Per-mission table — attempts, win %, **median real duration vs
   `target_minutes`**, top loss cause, mean ROE, most-failed objective.
5. Testers — furthest mission, hours, last seen; click through to a timeline.

The page lives in the Worker, not in `packages/app`, so the game bundle does not
grow and the UI colour rule does not have to stretch to it. It still takes its
colours from `data/palette.json` and its fonts from `assets/fonts/`.

**Password login, 24 Sep 2026.** `/stats` is behind a password login rather
than Cloudflare Zero Trust (Access): Access asks for a payment method even on
its free tier, so Ilan declined it. The password is a Worker secret,
`STATS_PASSWORD` (`npx wrangler secret put STATS_PASSWORD`), never committed to
the repo or to `wrangler.jsonc`. It should be long and random, not a memorised
phrase -- e.g. `openssl rand -base64 24` -- because a captured session cookie
gives an attacker the signature key too (see below), and a short or guessable
password is then an offline HMAC-speed guess, not a rate-limited one. A
successful `POST /stats/login` sets a signed, stateless 7-day session cookie —
HMAC-SHA256 over the cookie's own expiry, keyed from `STATS_PASSWORD` itself,
so rotating the password revokes every outstanding session with no
server-side session store. `POST /stats/login` is rate-limited on the
connecting IP (`LOGIN_LIMIT`, 10/min) to slow password guessing, separately
from `INGEST_LIMIT`. Until the secret is set, `/stats` and `/stats/api/*`
answer 403 to everyone, same as before.

The terminal queries in `packages/worker/QUERIES.sql` remain available as an
alternative to the `/stats` page, not as a stand-in for a closed one:

    npx wrangler d1 execute roaring-lions-telemetry --remote --file packages/worker/QUERIES.sql

## 5. Retiring GitHub Pages

`.github/workflows/pages.yml` fails on every push since the repo went private.
It cannot be deleted alone: ci.yml's `version` job ends with
"Redeploy Pages at the new version" (`gh workflow run pages.yml --ref main`,
~L336), which would then fail after every merge.

That step exists so the deployed app shows the bumped version. The release
commit is `chore(release): vX [skip ci]`. **To verify before deleting:** whether
Cloudflare Workers Builds builds a `[skip ci]` commit. If it does, the redeploy
step is simply removed with `pages.yml`. If it does not, the step is replaced by
a Cloudflare deploy hook call (a secret URL stored as a repo secret).

## Testing

- `events.ts`, `identity.ts`, `sender.ts` unit tests; schema validation of every
  builder's output; storage-blocked and GPC cases.
- `defeatCause` tests in `packages/sim`, plus `pnpm test:determinism`.
- Worker tests (validation, size limit, rate limit, origin check, one upsert per
  request) against a local D1 via `vitest-pool-workers`, in their own vitest
  project.
- Soft-leave test: leaving through the HUD sends one `abandoned`; victory then
  leave sends one `victory` and nothing else.
- `sw-policy.test.ts`: `/stats`, `/stats/api/x` and `/api/events` pass through.
- One browser run on a port ≥ 5210: the tutorial with `?telemetry&tester=ilan`,
  confirming rows reach `/stats`. Driven through the UI, not console shortcuts.
- The visual job and `pnpm ui:routes` stay green, proving the off switch.

## Decisions for Ilan

**Two backends — DECIDED 2026-09-24: deliberate.** Lane D (ST5 #204 / ST6 #205)
plans Supabase/Postgres for auth and a server-authoritative ledger; telemetry
uses D1. Telemetry is write-heavy, anonymous and disposable, and lives on the
game's own origin; the ledger is account-bound and authoritative. They share
nothing but the player id, and a Supabase account can later be linked to the
anonymous telemetry id.

**Consent — DECIDED 2026-09-24: (c) now, (a) before public launch.** An anonymous UUID kept in `localStorage` for analytics is
still an identifier stored on the device; for EU players ePrivacy art. 5(3)
generally wants consent for that, and honouring GPC/DNT is not asking. Options:

- **(a)** a one-line consent/notice in the menu, through `t()` and
  `pnpm validate:ui`;
- **(b)** session-only ids, no persistent `player` — loses day-2 return and
  cross-session time played;
- **(c)** accept the risk for the private test phase and revisit before any
  public or Steam launch.

Ilan chose **(c) now, (a) as a gate on public launch** — the build is private
and shared with testers by link, and (a) is small enough to land with the
public switch.

## Sequencing

- Base on `main` **after** PR #215 and the `fix/renderer-context-release` PR
  land; both edit `main.ts` near the ledger-merge hook.
- Worktree outside `.claude/worktrees` (`/Users/ilpinto/dev/roaring-lions-ep/`),
  branch `feat/telemetry` off `origin/main`.
- The PR queues behind #214–#217 and the context-release PR.
