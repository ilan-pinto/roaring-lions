# Player telemetry and Cloudflare hosting — design

**Status:** design approved in chat by Ilan, 2026-09-24; awaiting spec review.
**Work package:** WP-T1 (proposed by the execution-plan session; lane A plus a
new root-level Worker).
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
| 3 | Where results are read | A private `/stats` page on the Worker, behind Cloudflare Access |
| 4 | Storage | D1 (kept forever), not Analytics Engine (3-month retention) |
| 5 | Shape | One Worker serves the game, `/api/events` and `/stats` — not two Workers |

## Architecture

```
packages/app/src/telemetry/  --batched POST /api/events-->  worker/index.ts --> D1
        ^ reads runtime events and state only                   |
        |                                                        v
   main.ts / mission-start.ts / tutorial caller            /stats (Access)
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

No name, e-mail, IP or full URL is stored.

| Event | When | Payload |
|---|---|---|
| `session_start` | page load | screen (`menu`/`campaign`/`mission`/`tutorial`/`sandbox`), renderer, viewport, `returning` |
| `heartbeat` | every 60 s while the tab is visible **and** a mission is running | mission id, game time (ticks) |
| `tutorial_step` | a tutorial step opens | step index (0–12), ms spent on the previous step |
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

**Abandoned.** Leaving mid-mission sends `mission_end{result:'abandoned'}` from a
`pagehide` handler via `navigator.sendBeacon`. When even that is lost, the last
`heartbeat` marks where the player stopped.

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

**Service worker.** The app registers `src/service-worker.ts`. It must not cache
or intercept `POST /api/events`; confirm its fetch handler passes non-GET
requests through untouched.

**Player-facing text.** None is planned. If any appears (e.g. a privacy line in
the menu), it goes through `t()` and passes `pnpm validate:ui`.

## 3. Worker (`worker/index.ts` + `wrangler.jsonc`)

Routes:

- `POST /api/events` — body ≤ 64 KB, ≤ 50 events. Each event validated against
  the shared schema; invalid ones dropped silently. Rate-limited per `player`
  (Workers rate-limiting binding). `Origin` must be the site's own. Always
  answers `204`.
- `/stats` and `/stats/api/*` — the dashboard, protected by a Cloudflare Access
  application covering the `/stats*` path.
- everything else — static assets from `packages/app/dist`, exactly as today.

D1 tables:

- `events` — one row per event: `type, player, session, tester, build, mission,
  t, received_at, payload JSON`. The raw record, kept forever.
- `players` — one row per player: `first_seen, last_seen, seconds_played,
  furthest_mission, missions_won, tester`, upserted on ingest so headline numbers
  are one query.

Migrations live in `worker/migrations/`. Once `wrangler.jsonc` exists the
Cloudflare build settings simplify to deploy command `npx wrangler deploy` —
Ilan edits that in the dashboard in the same step as the merge.

Free-tier headroom: D1 allows 100k writes/day; at ~60 events per player-hour
that is ~1,500 player-hours a day.

## 4. `/stats`

One page, date range (7d / 30d / all) and a filter (everyone / testers / one
tester):

1. Headline — players, sessions, total hours, median minutes per player,
   day-2 return rate.
2. Players per day, new vs returning.
3. Funnel — tutorial → campaign missions in campaign order, share reaching each,
   biggest drop highlighted; plus a 13-step tutorial funnel.
4. Per-mission table — attempts, win %, **median real duration vs
   `target_minutes`**, top loss cause, mean ROE, most-failed objective.
5. Testers — furthest mission, hours, last seen; click through to a timeline.

The page lives in the Worker, not in `packages/app`, so the game bundle does not
grow and the UI colour rule does not have to stretch to it. It still takes its
colours from `data/palette.json` and its fonts from `assets/fonts/`.

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
- Worker tests (validation, size limit, rate limit, origin check) against a local
  D1 via `wrangler dev` / `vitest-pool-workers`.
- One browser run on a port ≥ 5210: the tutorial with `?telemetry&tester=ilan`,
  confirming rows reach `/stats`. Driven through the UI, not console shortcuts.
- The visual job and `pnpm ui:routes` stay green, proving the off switch.

## Open decision for Ilan

**Two backends.** Lane D (ST5 #204 / ST6 #205) plans Supabase/Postgres for auth
and a server-authoritative ledger. D1 for telemetry means two backends. The
recommendation is that this is **deliberate**: telemetry is write-heavy,
anonymous and disposable, and needs to live on the same origin as the game; the
ledger is account-bound and authoritative. They share nothing but the player id,
and a Supabase account can later be linked to the anonymous telemetry id. If
Ilan prefers one backend, the Worker can write to Supabase instead and D1 drops
out; nothing in sections 1–2 changes.

## Sequencing

- Base on `main` **after** PR #215 and the `fix/renderer-context-release` PR
  land; both edit `main.ts` near the ledger-merge hook.
- Worktree outside `.claude/worktrees` (`/Users/ilpinto/dev/roaring-lions-ep/`),
  branch `feat/telemetry` off `origin/main`.
- The PR queues behind #214–#217 and the context-release PR.
