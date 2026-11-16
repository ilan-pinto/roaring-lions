# Split the match relay into its own Worker (GH-1397) — design for the lead

**Date:** 2026-11-15 · **Status:** a proposal for the lead to approve before any build. Docs only: no code, no config, no deploy.
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
3. **Zero-downtime migration by draining, not transferring.** The new namespace is empty; the old class stays in the game Worker as
   `ROOMS_LEGACY` until its last room is gone (a room lives at most six hours, `ROOM_TTL_MS`). New rooms are created in the relay; a join or
   a reconnect for a code finds its room by asking the relay first and the legacy namespace second. Once drained, a follow-up deletes the legacy
   class. The alternative, `transferred_classes`, is described and not recommended (§5.4).
4. **The relay still restarts when *it* deploys**, and that is by design. The point is that it is deployed only when relay code changes
   (a second Workers Builds project with watch paths, §6), not on every merge. A relay deploy is survivable by the reconnect and snapshot
   rejoin paths that exist today.
5. **The "done means" is a measurement the lead takes, not an agent**: §8.4 is the written manual run (a match open across a game-Worker
   deploy). What can be tested headlessly is listed in §8 with the input that turns each check red (§9).
6. **Five decisions for the lead** (§11), each with a default. The ones that matter: the migration style (D-R1), and how the relay is
   deployed (D-R5), because a relay that redeploys on every merge defeats the whole change.

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
| `GET /state` on an absent room answers 404 and creates nothing; `/ws` on an absent room accepts the socket, says `ended` and closes it (#559 H-1) | `match-room.ts:883-904` |
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
| The `net-v1` migration | **Yes** (a new one in the relay) | The relay gets `{ tag: 'relay-v1', new_sqlite_classes: ['MatchRoom'] }`. The game Worker keeps `net-v1` until the drain ends (§5), then adds `net-v2` `deleted_classes` |
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
// wrangler.jsonc  (phase 2: both namespaces)
"durable_objects": { "bindings": [
  { "name": "ROOMS",        "class_name": "MatchRoom", "script_name": "roaring-lions-relay" },   // new rooms
  { "name": "ROOMS_LEGACY", "class_name": "MatchRoom" }                                          // the old namespace, until drained
] },
"migrations": [ { "tag": "net-v1", "new_sqlite_classes": ["MatchRoom"] } ]                        // unchanged
```

`Env` gains `ROOMS_LEGACY?: DurableObjectNamespaceLike` and `ROOMS_NEW?: string` (the flag of §7). Unbound `ROOMS_LEGACY` means one
namespace and today's code path exactly.

## 5. Migration with zero downtime

### 5.1 Why a drain

A Durable Object namespace belongs to a script and a class name. Binding `ROOMS` to the relay Worker points at an **empty** namespace; the
rooms alive today are in the game Worker's namespace, and `idFromName(code)` in the new one is a different object. So for up to six hours
two namespaces coexist, and every request that names a code must find the right one.

### 5.2 The lookup

`roomFor(env, code)` in `match/routes.ts`, used by join, the upgrade, snapshot, advisor and watch:

1. no `ROOMS_LEGACY`: return the `ROOMS` stub (today's behaviour, no extra call);
2. else ask the relay stub `GET /state`; anything but 404 means the room is there: use it;
3. else ask the legacy stub `GET /state`; anything but 404: use it;
4. else (a code that exists nowhere: never made, or wiped after it ended) use the **relay** stub, so an absent room gets the answers the
   room already gives (`no such room`, or the upgrade's `ended` frame, #559 H-1).

`GET /state` creates nothing (`match-room.ts:896`), so probing cannot create a room in the wrong namespace. A **create** picks its namespace
by the flag (§7) and first probes the *other* one for the minted code, so a code never lives in both. The probe cost is one or two extra object
requests on a join, a reconnect or a snapshot call during the window, and none after it.

### 5.3 The phases (the lead acts at P1, P2 and P4)

| # | Phase | Who | What happens to live rooms |
|---|---|---|---|
| P0 | Merge slice R1 (relay entry, `wrangler.relay.jsonc`, the `RETENTION_MS` move, pin tests) and slice R2 (the lookup, the flag, `Env`) with **`wrangler.jsonc` unchanged** | agent PRs, lead merges | The merge deploys the game Worker as usual (one ordinary restart); the new code finds no `ROOMS_LEGACY` and behaves exactly as before |
| P1 | **Deploy the relay Worker first** (§6.1), set its secret, check it is up | lead | None. It is not reachable and nothing points at it |
| P2 | Merge the one-file config PR that adds `script_name` on `ROOMS` and the `ROOMS_LEGACY` binding; Workers Builds deploys | lead | The deploy is the last restart the legacy rooms get from a *game* deploy; their seats reconnect as for any deploy, the lookup finds them in the legacy namespace. New rooms are made in the relay |
| P3 | Wait: six hours after P2 plus the ended-room wipe (no room can be older than `ROOM_TTL_MS`) | lead | Legacy rooms end by themselves |
| P4 | Merge slice R5: remove `ROOMS_LEGACY`, remove `MatchRoom` from the game Worker's exports, add migration `{ tag: 'net-v2', deleted_classes: ['MatchRoom'] }` | agent PR, lead merges and deploys | None live. The deletion discards the legacy namespace's storage, which holds only ephemeral room state; match records are in the accounts D1 |
| P5 | From here a merge to `main` redeploys the game Worker only | | Open rooms stay connected (§8.4 measures it) |

### 5.4 The alternative, and why it is not the default

Cloudflare migrations have a **transfer** form (`transferred_classes`, naming `from`, `from_script`, `to`) that moves an existing class,
with its objects, to another script. It would keep one namespace and remove the lookup and the flag. It is not recommended because: the
transfer is one irreversible step with no headless test; I have not confirmed it for SQLite-backed classes with live objects (§12);
rollback after it means moving the class back; and the drain costs a small, removable piece of code (§5.2) and six hours. If the lead
prefers it, D-R1 says so, slice R2 shrinks to config, and the manual run of §8.4 must cover the transfer.

A third option is a **hard cut** at a quiet hour: switch `ROOMS` and accept that rooms open at that moment end. It needs no lookup code and no
legacy binding. It is a fair choice while the player count is a handful of testers, and it is not "zero downtime".

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
**parity is proven by the smoke run of §8.3**, which creates a room through the game Worker and has the relay verify the ticket.

### 6.3 Other

No D1 migration is involved. No new KV. No new rate limiter. `compatibility_date` is the game Worker's.

## 7. Rollback

| Where the problem shows | Rollback |
|---|---|
| P1, the relay is bad | Nothing points at it. Redeploy or delete it; no player is affected |
| After P2, new rooms misbehave | Flip the flag **without a deploy**: `ROOMS_NEW=0` (a Worker secret or variable, set by the lead like `FEEDBACK_CLOSED`) makes create use the legacy namespace; rooms already in the relay keep working through the lookup. Then revert the P2 PR at leisure |
| After P2, the lookup is wrong | Revert the P2 PR: `ROOMS_LEGACY` is gone, so the old single-namespace path runs. Rooms made in the relay while P2 was live are unreachable and end on their seats' forfeits (`FORFEIT_MS`); say so in the PR |
| After P4 | The legacy namespace is deleted; rollback means re-adding the class under a new migration tag, which restores the code and not the (ephemeral) rooms. This is why P3 waits the full six hours |

The relay can also be rolled back by Workers versions (`wrangler rollback -c wrangler.relay.jsonc`), unless a migration shipped in that
version.

## 8. Testing it headlessly, and the one thing that is not headless

The existing suites do not run workerd: they use `fake-do.ts` (a Durable Object stand-in) and `local-relay.ts`. The split is a deployment
property, so most of its checks are about **configuration and routing**, and the checks that touch real Cloudflare behaviour are manual.

### 8.1 T1, unit (no new dependency)

`roomFor` and the create path against two fake namespaces (the shape `local-relay.ts` already builds): code only in the relay, only in
legacy, in neither, in both (relay wins, and create refuses a duplicate); the flag; no `ROOMS_LEGACY` means one call to the stub and no probe.
`GET /state` on an absent room creates no storage (`fake-do`'s `hasTable`), the #559 H-1 property, held for the new caller.

### 8.2 T2, configuration pins

Pure functions over the two parsed config files, in the style of `account/wrangler-pin.test.ts` (a constructed config proves each can fail):
the game config's `ROOMS` has `script_name` equal to the relay config's `name`; the relay declares `MatchRoom` in a `new_sqlite_classes`
migration; the relay has `workers_dev: false`, `preview_urls: false` and no `routes`; every `this.env.X` the room reads is a binding of the
relay config or a documented secret (derived by scanning `match-room.ts`, so a new read cannot be forgotten); once P4 lands, the game
config binds no local `MatchRoom` and `index.ts` does not export it.

### 8.3 T3, a two-Worker integration under Miniflare (optional, D-R6)

Miniflare runs several Workers in one process with cross-script Durable Object bindings. A spec would start the game Worker and the relay,
create a room through the game Worker's routes with a real ticket, open the upgrade, play a few frames, **reload only the game Worker's
script** and assert the socket stays open and a frame still round-trips; then reload the relay and assert the socket closes and a
reconnect succeeds. It also proves **ticket parity** (the room verifies what the other Worker signed, §6.2). It adds `miniflare` as a
dev dependency (a lead decision) and is a model of Cloudflare, not Cloudflare: it cannot replace §8.4.

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

Paste the observations into GH-1397. That is the evidence the issue's first "done means" asks for.

## 9. Falsifiable checks

Each check arrives with the input that makes it red, run and named in the commit that adds it.

| # | Check | The input that must turn it red |
|---|---|---|
| F1 | The game config's `ROOMS` carries `script_name` = the relay's `name` | delete `script_name`; or rename the relay |
| F2 | The relay has no public URL | set `workers_dev: true`; add a `routes` entry; set `preview_urls: true` |
| F3 | Every binding the room reads exists on the relay | remove `ACCOUNTS` from the relay config; add a `this.env.NEW_THING` read to the room |
| F4 | After P4, the game Worker neither exports nor binds `MatchRoom` | keep the export |
| F5 | `roomFor` order and fallbacks (§5.2) | swap the probe order; make the absent-everywhere case return the legacy stub; skip the probe for a code in both |
| F6 | Create honours the flag and probes the other namespace | ignore `ROOMS_NEW`; skip the duplicate probe |
| F7 | A probe creates nothing | make `/state` write to storage on a missing room |
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

## 11. Decisions for the lead

| # | Decision | Recommendation |
|---|---|---|
| D-R1 | Migration style: drain with two namespaces (§5), `transferred_classes` (§5.4), or a hard cut at a quiet hour | **Drain.** Reversible at every step, headless-testable, and the lookup is deleted after six hours. Hard cut is acceptable while players are a handful |
| D-R2 | Where the relay entry lives: a second entry file in `packages/worker/src/` (no code moves), or a new `packages/relay` package | **A second entry file.** A package would force moving `match/*` and breaks `local-relay.ts`'s imports for no gain |
| D-R3 | Reachability: no public URL (§3) or a relay hostname | **No public URL**, same-origin path |
| D-R4 | The create flag `ROOMS_NEW` as a no-deploy rollback lever | **Yes**, default on after P2, read as a plain variable or secret |
| D-R5 | How the relay deploys: a second Workers Builds project with watch paths, or by hand when it changes | **A second project with watch paths** (it still deploys on its own merge, which is the point). By hand is safe and easy to forget. Never deploy it from the game project's command: a deploy of unchanged code may still be a new version and restart the objects |
| D-R6 | `miniflare` as a dev dependency for T3 | **Yes, pinned**, if the lead accepts a new dev dependency; otherwise T1, T2 and the manual run are the whole evidence |
| D-R7 | The staging pair for §8.4: throwaway D1 databases, or the production ones | **Throwaway.** A staging relay writes match records and desync rows |

## 12. Platform facts to confirm before the lead acts

These are what I believe from the documentation and the repository; none is something an agent can test here.

1. A Durable Object binding with `script_name` reaches a class hosted by another Worker, and the hosting Worker must exist first.
2. An established WebSocket to an object is **not** dropped when the *calling* Worker is redeployed. This is the measurement of §8.4 step 2, and the whole
   premise of the change. If it is false, the split buys nothing and the lead should hear that at the first staging run, before P1.
3. Deploying a Worker whose bundle is unchanged can still create a new version and restart its objects (the reason for D-R5's watch paths).
4. `transferred_classes` semantics for SQLite-backed classes with live objects (§5.4).
5. Workers Builds supports per-project deploy commands and build watch paths on a monorepo.
6. The Free plan's limits (one invocation's 50 D1 queries, 100,000 requests a day, the Durable Object duration allowance) apply per Worker invocation
   or per account as before; the relay's own D1 writes now run in the object's invocation, not in a Worker invocation (a mild gain for the cron budget of GH-1432).

## 13. How it slices (after approval)

| # | Slice | Size | Notes |
|---|---|---|---|
| R1 | `relay.ts`, `wrangler.relay.jsonc`, move `RETENTION_MS`, T2 pins (F1 to F4 built as pure functions, F8's closure check) | S | No behaviour change; the relay is not deployed by the merge |
| R2 | `roomFor`, the create probe and flag, `Env`, T1 (F5 to F7) | S | One namespace behaves as today |
| R3 | T3 under Miniflare (F9), the smoke script for §8.3 | M | Only if D-R6 is yes |
| R4 | The runbook: this note's §6 to §8 as `docs/agent-notes`, plus the lead's checklist | XS | |
| R5 | After P3: remove `ROOMS_LEGACY`, the export and the lookup; `net-v2` `deleted_classes` | XS | Lead merges and deploys after the six hours |

About three agent-days, none of them touching `packages/sim`, the golden hash or the tuning.
