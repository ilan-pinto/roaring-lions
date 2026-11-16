# Split the match relay into its own Worker (GH-1397) — design for the lead

**Date:** 2026-11-15 · **Revised:** 2026-11-16, to the lead's rulings on GH-1397 and the design PR (D-R1 to D-R7 are now rulings, §11). The first draft
proposed a drain through two namespaces; the lead ruled a **hard cut at a quiet hour** instead, so the drain, its lookup and its removal slice are gone.
**Status:** approved by the lead's rulings, before the R slices start. Docs only: no code, no config, no deploy.
**Reads against:** `wrangler.jsonc`, `packages/worker/src/index.ts`, `match/routes.ts`, `match/match-room.ts`, `match/room-core.ts`,
`origin.ts`, `d1.ts`, `account/wrangler-pin.test.ts`, `tools/src/net/local-relay.ts`, `packages/app/src/net/connect.ts`,
`assets/_headers`, and the network design (`2026-10-10-network-game-design.md` §3.6, which already says "a separate Worker for the
relay is the later answer if restarts hurt, and needs only a `script_name` binding").

---

## 0. The ask, and the answers up front

Today `MatchRoom` (the Durable Object that is the lockstep relay) is exported from the same Worker as the game's static build, the
telemetry, the accounts and the stats pages, so every merge to `main` (Workers Builds deploys from `main`) restarts the script that
hosts every live room and drops its sockets. GH-1397 asks for the relay to be a **separate Worker bound by `script_name`**, so a game
deploy leaves an open room connected.

1. **Move only the class.** The relay Worker exports `MatchRoom` and nothing else. Every HTTP route (`/api/match*`, tickets, rate limits, the
   Origin rule, the member cookie) stays in the game Worker, which reaches the class through a Durable Object binding with
   `script_name`. **No match code moves in the repo**: the relay is a second *entry file* over the same modules, so `local-relay.ts`, the
   arena, the specs and the fake Durable Object keep working unchanged.
2. **The client does not change.** It keeps talking to the same origin and the same `/api/match/:code/ws`. The relay Worker has **no public
   URL** (`workers_dev: false`, no routes), so there is no CORS, no second Origin rule, no CSP change (`connect-src 'self'`) and no new
   attack surface. A subdomain relay is rejected (§3).
3. **A hard cut at a quiet hour, not a drain (D-R1, ruled).** The relay's namespace starts empty, and the one-time switch of `ROOMS` to it
   **ends every room open at that moment**. The lead accepts that while players are a handful: a match open at the cut may drop. There is no
   second namespace to look through, no probe on a join, and no wait of six hours; one config PR does the cut (§5). The only thing that survives
   it is a **rollback lever**: the old class stays exported and bound as `ROOMS_LEGACY`, used by nothing unless the lead sets `ROOMS_NEW=0` (§7).
   `transferred_classes` is described and not recommended (§5.3).
4. **The relay still restarts when *it* deploys**, and that is by design. The point is that it is deployed only when relay code changes
   (a second Workers Builds project with watch paths, §6), not on every merge. A relay deploy is survivable by the reconnect and snapshot
   rejoin paths that exist today.
5. **The "done means" is a measurement the lead takes, not an agent**: §8.4 is the written manual run (a match open across a game-Worker
   deploy). What can be tested headlessly is listed in §8 with the input that turns each check red (§9).
6. **Seven decisions, all ruled** (§11). The ones that carry the most weight: the hard cut (D-R1) and how the relay is deployed (D-R5), because a
   relay that redeploys on every merge defeats the whole change.

## 1. What exists today (facts)

| Fact | Where |
|---|---|
| One Worker, `name: roaring-lions`, `main: packages/worker/src/index.ts`. It exports `MatchRoom` and routes `/api/match*` to `handleMatch` | `wrangler.jsonc`, `index.ts:18,27` |
| One namespace, binding `ROOMS` to class `MatchRoom`; migration tag `net-v1` is `new_sqlite_classes: ["MatchRoom"]` | `wrangler.jsonc` |
| `handleMatch` does the **stateless** work: Origin rule, `ROOM_LIMIT`/`WS_LIMIT`/`SNAP_LIMIT`, body caps, field cleaning, the member cookie (`seatMemberOf`, reads `ACCOUNTS`), **signing** tickets with `TICKET_SECRET`; then `rooms.get(rooms.idFromName(code)).fetch(...)` | `match/routes.ts` |
| The room reads: `this.env.TICKET_SECRET` (it **verifies** the ticket in the hello), `this.env.ACCOUNTS` (the match record, `record.ts`, line 646), `this.env.DB` (desync and snapshot-mismatch rows, lines 710 and 731). It never reads the rate limiters, `ASSETS`, `ALLOWED_ORIGINS` or `ARENA_WATCH` | `match/match-room.ts` |
| The room does **no Origin check of its own**: the caller's (`routes.ts`) is the only one, on the upgrade too | `routes.ts:73`, `match-room.ts` (no `origin` read) |
| The page builds `${origin}/api/match...` and `ws(s)://${origin}/api/match/:code/ws` from its own origin | `connect.ts:162,185,370,426` |
| The CSP is `connect-src 'self' blob: data:` | `assets/_headers:13` |
| Room lifetime: lobby or running, `ROOM_TTL_MS` = 6 h; an ended room is wiped `PURGE_AFTER_MS` = 2 min later; a dropped seat forfeits after `FORFEIT_MS` = 60 s | `room-core.ts:100`, `match-room.ts:120`, `protocol.ts:33` |
| `/ws` on an absent room accepts the socket, says `ended` and closes it (GH-559 H-1); `GET /state` on an absent room answers 404 and creates nothing. After the cut a seat of a room that ended with the old namespace meets exactly this | `match-room.ts:883-904` |
| Cron, the desync and snapshot-mismatch **purges** run in the game Worker's `scheduled()` against `DB` | `index.ts:41` |
| The room refuses a hello whose `build` is not the build it was created on | `routes.ts` ("The room checks every hello's build against this one") |
| The network design already priced the restart ("acceptable for friends with the reconnect path; a separate relay Worker is the later answer") | `2026-10-10-network-game-design.md:984` |

## 2. The target

```
browser ── https://<one origin>/api/match/* ──▶ game Worker  roaring-lions        (assets, telemetry, accounts, stats, /api/match* HTTP)
                                                  │  DO binding ROOMS  { class_name: MatchRoom, script_name: roaring-lions-relay }
                                                  ▼
                                            relay Worker  roaring-lions-relay      (exports MatchRoom; no fetch handler worth the name; no public URL)
                                                  │  D1 DB, D1 ACCOUNTS, secret TICKET_SECRET
```

### 2.1 What moves

| Thing | Moves? | Detail |
|---|---|---|
| The `MatchRoom` class (as a *deployed* script) | **Yes** | The relay's entry `packages/worker/src/relay.ts` is `export { MatchRoom } from './match/match-room'` and a `fetch` that answers 404. The source stays where it is |
| The `net-v1` migration | **Yes** (a new one in the relay) | The relay gets `{ tag: 'relay-v1', new_sqlite_classes: ['MatchRoom'] }`. The game Worker **keeps `net-v1` and its `MatchRoom` export** as the rollback lever's namespace (`ROOMS_LEGACY`, §4, §7). Retiring that lever later is a one-file PR (§13) |
| Bindings the room reads | **Yes** (duplicated, not moved) | `DB` and `ACCOUNTS` (same database ids; **no `migrations_dir`**, the game config remains the one place D1 migrations are applied from) and the secret `TICKET_SECRET` |
| `observability` block | Copied | The relay needs its own, or its logs and traces are off |
| Rate limiters, `ASSETS`, `ALLOWED_ORIGINS`, KV, cron | **No** | Stay in the game Worker; the room reads none of them |
| `handleMatch` and every `/api/match*` route | **No** | Stateless; stays where the cookie, the limiters and the Origin rule are |
| Ticket **signing** | No | `TICKET_SECRET` is therefore in **both** Workers (the room verifies what the game Worker signs): §6.2 |
| Desync and snapshot-mismatch purges (`purgeDesyncs`, `purgeSnapMismatches`) | No | Cron stays in the game Worker; the rows are in `DB` |
| `local-relay.ts`, `fake-do.ts`, the arena | No | They import the room as a library, as now |

### 2.2 One thing to fix on the way

`match/desync-log.ts` and `match/snap-mismatch-log.ts` import `RETENTION_MS` from `feedback-triage.ts`, which drags the feedback module
into the relay bundle. Move that constant to a tiny module as part of slice R1 (a pure move, no behaviour). §9 holds a check on the relay's
import closure so the relay cannot quietly grow back into the game Worker.

## 3. How the client finds the relay

**Recommended: the same origin and the same paths. The relay has no public URL.**

| | Same-origin path through the game Worker (**recommended**) | A relay hostname (`relay.<domain>` or a second `workers.dev` name) |
|---|---|---|
| Client change | none | `connect.ts`, `snapshot-link.ts`, `watch-connect.ts` take a relay origin; two builds in the wild disagree |
| CSP | unchanged | `connect-src` must name the relay origin for fetch and `wss:` |
| Origin / CORS | the one existing rule (`originAllowed`), unchanged | the relay needs its own Origin rule and CORS answers for `POST` (preflight for `Authorization`), or the snapshot GET breaks (`sameOriginSnapshotGet` assumes same-origin) |
| Public surface | none new | a second internet-facing Worker with its own rate limits and abuse path |
| Cookie | the seat member cookie reaches `handleMatch` as today | a cross-site cookie problem (the member is resolved from the cookie in `handleMatch`) |
| WebSocket path | the game Worker passes the upgrade through (`stub.fetch(new Request('https://room/ws', req))`) and the connection is bridged to the object | direct |

The cost of the recommendation is one extra hop for the **upgrade request only** (the game Worker's invocation ends when it returns the
101); the frame traffic is socket to object either way. A relay on its own hostname would shave that hop and add everything in the right
column, for a hobby-scale player count. The relay is made unreachable from the internet by `workers_dev: false`, `preview_urls: false` and no
`routes`; pin tests hold all three (§9, F2).

**Origin checks do not move.** `originAllowed` stays in `handleMatch` and covers the upgrade. The room never had one. The relay needs no
`ALLOWED_ORIGINS`.

## 4. The configuration (sketch, for the build slice)

```jsonc
// wrangler.relay.jsonc  (new)
{
  "name": "roaring-lions-relay",
  "main": "packages/worker/src/relay.ts",
  "compatibility_date": "2026-09-01",
  "workers_dev": false,          // no *.workers.dev URL
  "preview_urls": false,
  // no "routes": nothing on the internet reaches this Worker; the game Worker calls the class through its binding
  "migrations": [{ "tag": "relay-v1", "new_sqlite_classes": ["MatchRoom"] }],
  "d1_databases": [
    { "binding": "DB",       "database_name": "roaring-lions-telemetry", "database_id": "d23ceb15-..." },
    { "binding": "ACCOUNTS", "database_name": "roaring-lions-accounts",  "database_id": "ea793ff8-..." }
  ],                              // deliberately no migrations_dir
  "observability": { /* the game Worker's block, verbatim */ }
}
```

```jsonc
// wrangler.jsonc  (the cut PR, §5)
"durable_objects": { "bindings": [
  { "name": "ROOMS",        "class_name": "MatchRoom", "script_name": "roaring-lions-relay" },   // every room, from the cut on
  { "name": "ROOMS_LEGACY", "class_name": "MatchRoom" }                                          // the old namespace: the rollback lever's target, otherwise idle
] },
"migrations": [ { "tag": "net-v1", "new_sqlite_classes": ["MatchRoom"] } ]                        // unchanged: the class stays exported
```

`Env` gains `ROOMS_LEGACY?: DurableObjectNamespaceLike` and `ROOMS_NEW?: string` (the switch of §7). **One function** in `match/routes.ts`,
`roomsOf(env)`, is the only reader of either binding: `ROOMS_NEW === '0'` with `ROOMS_LEGACY` bound returns the legacy namespace, anything else
returns `ROOMS`. Every route (create, join, the upgrade, snapshot, advisor, watch) takes its stub from it. It never asks two namespaces about one
code, so there is no probe, no `GET /state` call and no per-request cost. With `ROOMS_LEGACY` unbound (before the cut) it is today's code path exactly.

## 5. Migration: a hard cut at a quiet hour

### 5.1 What the cut does, and what it costs

A Durable Object namespace belongs to a script and a class name. Binding `ROOMS` to the relay Worker points at an **empty** namespace; the
rooms alive today are in the game Worker's namespace, and `idFromName(code)` in the new one is a different object. The cut therefore
**ends every room that is open at the moment the game Worker deploys with the new binding**: its seats reconnect to a code the new namespace
has never heard of, and get the answer an absent room already gives (the upgrade's `ended` frame, or `no such room`; GH-559 H-1). A match
in progress is lost, and its match record is not written. The lead's ruling accepts this while players are a handful: it is not "zero
downtime", it is one deliberate drop, at an hour chosen so that it is usually nobody's match.

There is no drain, no second lookup and no wait. A code is looked up in exactly one namespace, the one `roomsOf(env)` returns (§4).

### 5.2 The phases (the lead acts at P1, P2 and P3)

| # | Phase | Who | What happens to live rooms |
|---|---|---|---|
| P0 | Merge slice R1 (relay entry, `wrangler.relay.jsonc`, the `RETENTION_MS` move, the pin tests of F1 to F4) and slice R2 (`roomsOf`, `ROOMS_NEW`, `Env`, their tests) with **`wrangler.jsonc` unchanged** | agent PRs, lead merges | The merge deploys the game Worker as usual (one ordinary restart); `ROOMS_LEGACY` is unbound, `roomsOf` returns `ROOMS`, and the code behaves exactly as before |
| P1 | **Deploy the relay Worker first** (§6.1), set its secret, run the staging run of §8.4 against the throwaway pair | lead | None. The production relay is not reachable and nothing points at it |
| P2 | **The cut, at a quiet hour** (§5.3): merge the one-file config PR that adds `script_name` to `ROOMS` and the `ROOMS_LEGACY` binding; Workers Builds deploys | lead | **Every room open at that deploy ends.** New rooms are made in the relay |
| P3 | The smoke of §5.3, within minutes of the deploy | lead | None. If it fails, flip `ROOMS_NEW=0` (§7) |
| P4 | From here a merge to `main` redeploys the game Worker only | | Open rooms stay connected (§8.4 measures it) |

### 5.3 The cut procedure

1. **Choose the hour.** The lead reads `/stats` (or the player list) for the quietest recent hour; no new instrument is built. The lead says in the
   tester channel that a deploy at that hour may end a match in progress.
2. **Before merging:** the relay Worker is deployed and answering (P1), `TICKET_SECRET` has been put on both Workers, and the staging run passed.
3. **Merge and deploy.** The cut PR is the only change in that deploy.
4. **The smoke (parity of the secret, which no test can read).** Immediately after the deploy the lead creates a room through the game's own page,
   joins it with a second browser, and plays a few seconds. Creating signs a ticket in the game Worker; joining makes the **relay's** room verify
   it, so a mismatched `TICKET_SECRET` fails here, in the first minute, and not for a tester.
5. **If the smoke fails:** set `ROOMS_NEW=0` (no deploy, §7), repeat the smoke against the legacy namespace, and revert the cut PR at leisure.

The legacy namespace's objects are never reached again after a cut that holds. Their storage is ephemeral room state, and the match records
are in the accounts D1, so nothing of value is stranded.

### 5.4 The alternatives, and why they are not the default

Cloudflare migrations have a **transfer** form (`transferred_classes`, naming `from`, `from_script`, `to`) that moves an existing class,
with its objects, to another script. It would keep live rooms across the move. It is not recommended: the transfer is one irreversible step with
no headless test, I have not confirmed it for SQLite-backed classes with live objects (§12), rollback after it means moving the class back, and
the lead has ruled that dropping an open match at a quiet hour is acceptable.

A **drain** through two namespaces was the first draft's default and is retired. It bought zero downtime at the price of a lookup that probed two
objects on every join, reconnect and snapshot call, a create that had to avoid minting a code in both namespaces, a six-hour wait, and a follow-up
migration to delete the old class. Those are not worth it for a handful of players. If the player count grows enough that a dropped match is no
longer acceptable, the drain is the design to revisit, and this note's first version (PR 1462) holds it.

## 6. Deploy steps the lead runs (agents never run `wrangler`, and never write a secret value)

### 6.1 The relay Worker

1. Create it with the first deploy: `npx wrangler deploy -c wrangler.relay.jsonc` (from a checkout at the merged commit). It must exist
   and export `MatchRoom` **before** the game Worker's binding names it; a binding to a script that does not exist fails the game deploy.
2. Set its secret **to the same value** as the game Worker's: `npx wrangler secret put TICKET_SECRET -c wrangler.relay.jsonc`.
3. Create a **second Workers Builds project** on the same repository for `roaring-lions-relay`: deploy command
   `npx wrangler deploy -c wrangler.relay.jsonc`, and **build watch paths** limited to what the relay bundle contains (`packages/worker/src/match/**`,
   `packages/worker/src/relay.ts`, `packages/worker/src/d1.ts`, `packages/worker/src/do-types.ts`, `packages/net/**`, `wrangler.relay.jsonc`, the lockfile). §9 F8 derives that list from the bundle, so it cannot drift.
4. Narrow the existing game project's watch paths only if wanted: it must still build on every change, since it serves the page.

### 6.2 Secrets

`TICKET_SECRET` is held by two Workers. A rotation is two `secret put`s, and tickets signed before it fail in the window between them
(tickets live six hours and a seat re-fetches one by joining again), exactly as a rotation behaves today. The pin test cannot read a secret, so
**parity is proven three times**: by the Miniflare smoke of §8.3 (a room created through the game Worker, the ticket verified by the relay), by
the staging run of §8.4 (the same, on real Cloudflare), and by the lead's smoke in the first minutes after the cut (§5.3, step 4), which is the only one that
sees the production secrets. A rotation afterwards repeats that smoke.

### 6.3 Other

No D1 migration is involved. No new KV. No new rate limiter. `compatibility_date` is the game Worker's.

## 7. Rollback

| Where the problem shows | Rollback |
|---|---|
| P1, the relay is bad | Nothing points at it. Redeploy or delete it; no player is affected |
| After the cut (P2), the relay misbehaves or the smoke fails | Set `ROOMS_NEW=0` **without a deploy** (a Worker variable or secret, set by the lead like `FEEDBACK_CLOSED`). `roomsOf` then returns the `ROOMS_LEGACY` namespace for every route, so new rooms are made in the old class again. **Rooms open in the relay at that moment end**, the same acceptance as the cut, since a code is looked up in one namespace only. Then revert the cut PR at leisure |
| The switch is set and the legacy class is gone | It is not gone: this design keeps the export, the `net-v1` migration and the `ROOMS_LEGACY` binding for exactly this. Retiring them is a later, deliberate PR (§13) |
| The cut PR is reverted | `ROOMS` has no `script_name` again and the old class is the only namespace. Rooms made in the relay are unreachable and end on their seats' forfeits (`FORFEIT_MS`); say so in the revert PR |

The relay can also be rolled back by Workers versions (`wrangler rollback -c wrangler.relay.jsonc`), unless a migration shipped in that
version.

What the switch does **not** do is move a room between namespaces: there is no lookup that finds a room in the other one. A flip, like the cut, is a
deliberate drop of what is open.

## 8. Testing it headlessly, and the one thing that is not headless

The existing suites do not run workerd: they use `fake-do.ts` (a Durable Object stand-in) and `local-relay.ts`. The split is a deployment
property, so most of its checks are about **configuration and routing**, and the checks that touch real Cloudflare behaviour are manual.

### 8.1 T1, unit (no new dependency)

`roomsOf(env)` against two fake namespaces (the shape `local-relay.ts` already builds): unset `ROOMS_NEW` returns `ROOMS`; `'0'` with `ROOMS_LEGACY`
bound returns the legacy namespace; `'0'` with `ROOMS_LEGACY` **unbound** still returns `ROOMS` (the switch must never produce `undefined`);
any other value returns `ROOMS`. Every route (create, join, the upgrade, snapshot, advisor, watch) is driven once with each namespace and is shown to touch
that namespace only, and a scan of `routes.ts` shows `roomsOf` is the only reader of either binding. An absent room in the chosen namespace gives the
answers it gives today (`no such room`, or the upgrade's `ended` frame; GH-559 H-1), which is exactly what a seat of a pre-cut room meets.

### 8.2 T2, configuration pins

Pure functions over the two parsed config files, in the style of `account/wrangler-pin.test.ts` (a constructed config proves each can fail):
the game config's `ROOMS` has `script_name` equal to the relay config's `name`; the relay declares `MatchRoom` in a `new_sqlite_classes`
migration; the relay has `workers_dev: false`, `preview_urls: false` and no `routes`; every `this.env.X` the room reads is a binding of the
relay config or a documented secret (derived by scanning `match-room.ts`, so a new read cannot be forgotten); after the cut, `ROOMS` carries
`script_name` and `ROOMS_LEGACY` does **not** (so the lever points at the old class and cannot be mistaken for the relay), the game config still
declares `net-v1`, and `index.ts` still exports `MatchRoom` (deleting either would strand the rollback).

### 8.3 T3, a two-Worker integration under Miniflare (optional, D-R6)

Miniflare runs several Workers in one process with cross-script Durable Object bindings. A spec would start the game Worker and the relay,
create a room through the game Worker's routes with a real ticket, open the upgrade, play a few frames, **reload only the game Worker's
script** and assert the socket stays open and a frame still round-trips; then reload the relay and assert the socket closes and a
reconnect succeeds. It also proves **ticket parity** (the room verifies what the other Worker signed, §6.2), and **orders** itself the way the
cut does: the relay is up before the game Worker binds it, and a game Worker bound to a relay that is absent fails loudly rather than
creating rooms nowhere. It adds `miniflare` as a **pinned** dev dependency (D-R6, ruled yes) and is a model of Cloudflare, not Cloudflare: it
cannot replace §8.4. Its pin and the pin test come first in slice R3, so a floating version cannot land.

### 8.4 T4, the manual run (the issue's "written manual run"; the lead's, because it deploys)

On a **staging pair** (`roaring-lions-gh1397-game` and `roaring-lions-gh1397-relay`, their own throwaway D1 databases with the migrations applied,
D-R7), two browsers:

1. Open a match and play to about a minute in; note the tick.
2. Make a trivial change to the *game* Worker (a version string), `wrangler deploy` it. **Expected: both sockets stay open, play continues, no
   `dropped` banner.** Record what happened.
3. Reload one tab (F5). **Expected: refused with the "another build" answer (412).** This is not a bug: the room checks the build, and must (§10).
4. Make a trivial change to the *relay* Worker and deploy it. **Expected: both sockets drop and reconnect inside the 60 s forfeit; play resumes
   from the log or the snapshot.** Record the outage time (`reconnects.lastOutageMs`).
5. Run the same game-Worker deploy with a third tab idle in the lobby, and with one in the middle of a snapshot upload.
6. **Rehearse the cut itself** on the staging pair, with a match open: apply the binding change as the cut PR will, deploy, and record that the open
   match ends and that a new room created afterwards is made in the relay (the lead's smoke of §5.3, step 4, on staging). Then set `ROOMS_NEW=0`, create a
   room, and confirm it is made in the legacy class; set it back. Record the times.

Paste the observations into GH-1397. That is the evidence the issue's first "done means" asks for.

## 9. Falsifiable checks

Each check arrives with the input that makes it red, run and named in the commit that adds it.

| # | Check | The input that must turn it red |
|---|---|---|
| F1 | The game config's `ROOMS` carries `script_name` = the relay's `name` | delete `script_name`; or rename the relay |
| F2 | The relay has no public URL | set `workers_dev: true`; add a `routes` entry; set `preview_urls: true` |
| F3 | Every binding the room reads exists on the relay | remove `ACCOUNTS` from the relay config; add a `this.env.NEW_THING` read to the room |
| F4 | After the cut the rollback lever is intact: `ROOMS` has `script_name`, `ROOMS_LEGACY` has none, `net-v1` is declared, `index.ts` exports `MatchRoom` | give `ROOMS_LEGACY` the relay's `script_name`; delete `net-v1`; drop the export |
| F5 | `roomsOf` (§4): unset or any value but `'0'` returns `ROOMS`; `'0'` returns `ROOMS_LEGACY` only when bound | return `ROOMS_LEGACY` for an unset switch; return `undefined` for `'0'` with the legacy binding absent; compare with `== 0` |
| F6 | Every route takes its stub from `roomsOf` and asks one namespace only | add a direct `env.ROOMS.get` to a route; add a second-namespace probe to join |
| F7 | `roomsOf` is the only reader of either binding in `routes.ts` (a scan, so a new route cannot bypass the switch) | read `env.ROOMS` in a new handler |
| F8 | The relay's import closure is the room's (esbuild metafile over `relay.ts`): it contains none of `stats`, `account/routes`, `feedback-*`, `arena-results`, and its size stays under a recorded ceiling | import `stats.ts` from `match-room.ts`; the watch-path list of §6.1 is generated from the same closure and compared |
| F9 | Ticket parity across the two Workers (T3 and the smoke of §8.3) | give the relay a different `TICKET_SECRET` |
| F10 | The local relay and the arena still play (the existing `local-relay`, `arena-*` and `two-client` specs) | none new: they are the proof that no match code moved |

## 10. What this does not fix

- **A relay deploy still restarts every room.** The change makes it rare and deliberate; it does not remove it. Reconnect (60 s forfeit) and
  snapshot rejoin carry a match through one.
- **The build check stays.** A room refuses a hello from another build, because lockstep needs the same sim. After a game deploy an *open* tab keeps its
  loaded code, its socket and its build, and plays on; a tab that **reloads** gets the new build and is refused by the old room. That is correct
  and must not be loosened to make the demo look better. The save design's `SIM_EPOCH` (GH-1393) is the right shape for a future "a room accepts
  any build with the same sim epoch" and is a separate decision.
- **Lazy page chunks.** A game deploy replaces the hashed asset files; an open tab that has not yet imported a chunk (`importWithRetry` exists) can fail
  to load it. That is the client's, not the relay's.
- It does not change cost per match, the 128 MB x duration billing of an active object, or the Free-plan cap on matches a day.

## 11. Decisions: the lead's rulings of 16 Nov 2026 (GH-1397 and the design PR)

| # | Decision | Ruling |
|---|---|---|
| D-R1 | Migration style | **Hard cut at a quiet hour, not the drain.** Acceptable while players are a handful; an open match may drop. The drain lookup and its six-hour removal slice are not needed (§5) |
| D-R2 | Where the relay entry lives | **A second entry file in `packages/worker/src/`.** No match code moves; `local-relay.ts` keeps its imports |
| D-R3 | Reachability | **No public URL**, same-origin path (§3) |
| D-R4 | `ROOMS_NEW` no-deploy rollback switch | **Yes.** Under the hard cut it selects the one namespace every route uses (`roomsOf`, §4, §7), with the old class kept as `ROOMS_LEGACY` |
| D-R5 | How the relay deploys | **A second Workers Builds project with watch paths.** Never from the game project's command: a deploy of unchanged code may still be a new version and restart the objects |
| D-R6 | `miniflare` for T3 | **Yes, as a pinned dev dependency** |
| D-R7 | The staging pair for §8.4 | **Throwaway D1 databases** |

The first draft recommended the drain for D-R1; the ruling supersedes it, and §5.4 records why it was retired.

## 12. Platform facts to confirm before the lead acts

These are what I believe from the documentation and the repository; none is something an agent can test here.

1. A Durable Object binding with `script_name` reaches a class hosted by another Worker, and the hosting Worker must exist first.
2. An established WebSocket to an object is **not** dropped when the *calling* Worker is redeployed. This is the measurement of §8.4 step 2, and the whole
   premise of the change. If it is false, the split buys nothing and the lead should hear that at the first staging run, before P1.
3. Deploying a Worker whose bundle is unchanged can still create a new version and restart its objects (the reason for D-R5's watch paths).
4. `transferred_classes` semantics for SQLite-backed classes with live objects (§5.4); and that a Worker may bind its own class as `ROOMS_LEGACY` while `ROOMS` binds the same class name in another script (§4), which the staging rehearsal of §8.4 step 6 confirms.
5. Workers Builds supports per-project deploy commands and build watch paths on a monorepo.
6. The Free plan's limits (one invocation's 50 D1 queries, 100,000 requests a day, the Durable Object duration allowance) apply per Worker invocation
   or per account as before; the relay's own D1 writes now run in the object's invocation, not in a Worker invocation (a mild gain for the cron budget of GH-1432).

## 13. How it slices (the rulings are in; the R slices may start)

| # | Slice | Size | Notes |
|---|---|---|---|
| R1 | `relay.ts`, `wrangler.relay.jsonc`, move `RETENTION_MS`, the T2 pins (F1 to F4 as pure functions, F8's closure check) | S | No behaviour change; the relay is not deployed by the merge. **The pins land first**, before anything in R2 or R3 can depend on the config |
| R2 | `roomsOf`, `ROOMS_NEW`, `Env`, T1 (F5 to F7) | XS | With `ROOMS_LEGACY` unbound it is today's code path exactly. No probe, no lookup, no create-uniqueness rule |
| R3 | `miniflare` as a pinned dev dependency, T3 (F9), the smoke script for §8.3 | M | D-R6 ruled yes. The pin and its pin test are the first commit |
| R4 | The runbook: this note's §5.3 and §6 to §8 as `docs/agent-notes`, plus the lead's checklist and the cut PR as a ready, unmerged one-file diff | XS | The cut itself is the lead's (P2) |

Retiring the rollback lever (removing `ROOMS_LEGACY`, the `MatchRoom` export from `index.ts`, and adding `{ tag: 'net-v2', deleted_classes: ['MatchRoom'] }`) is a one-file PR the lead
may ask for **whenever** the switch is judged unneeded. It has no timer and no drain behind it, so it is not a slice of this plan.

About two agent-days, none of them touching `packages/sim`, the golden hash or the tuning.
