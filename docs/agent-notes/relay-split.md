# The relay split (GH-1397): as built, and the lead's run-book

Design: `docs/superpowers/specs/2026-11-15-relay-worker-split-design.md` (the lead's rulings D-R1 to D-R7 of
16 Nov 2026). This note is slice R4: what slices R1 to R3 built, the cut as an exact diff, the staging run on
throwaway D1 databases, the cut procedure and the rollback. **No agent runs any command in this note**: every
`wrangler` line below is the lead's, against the lead's account.

## 1. As built

| Piece | Where | What it does |
|---|---|---|
| The relay's entry | `packages/worker/src/relay.ts` | `export { MatchRoom }` and a `fetch` that answers 404. No match code moved (D-R2) |
| The relay's config | `wrangler.relay.jsonc` | script `roaring-lions-relay`, `workers_dev: false`, `preview_urls: false`, no routes (D-R3); migration `relay-v1` (`new_sqlite_classes: ["MatchRoom"]`); `DB` and `ACCOUNTS` on the game Worker's databases with **no** `migrations_dir`; the game Worker's `observability` verbatim |
| The switch | `packages/worker/src/match/routes.ts`, `roomsOf` | the one reader of `env.ROOMS` and `env.ROOMS_LEGACY`. `ROOMS_NEW === '0'` with `ROOMS_LEGACY` bound returns the legacy namespace; anything else returns `ROOMS` |
| `Env` | `packages/worker/src/d1.ts` | gains `ROOMS_LEGACY?` and `ROOMS_NEW?` |
| `RETENTION_MS` | `packages/worker/src/retention.ts` | moved out of `feedback-triage.ts` (re-exported there), so the relay bundle does not carry the feedback code |
| Config pins (T2) | `packages/worker/src/relay-config.test.ts` | F1 to F4 and F8 (the closure and the watch paths below) |
| Switch tests (T1) | `packages/worker/src/match/rooms-of.test.ts` | F5 to F7, and today's routes to the byte (a transcript digest recorded against `origin/main`) |
| Two Workers (T3) | `packages/worker/src/relay-split.test.ts` | the game Worker and the relay in two workerd processes under Miniflare (pinned `5.20261006.1-alpha`, D-R6) |
| Test infrastructure | `packages/worker/src/worker-bundle.ts`, `wrangler-cfg.ts` | bundles an entry with the repo's Vite and records its module graph; reads the two configs and applies the cut (`cutConfig`) |

**`wrangler.jsonc` is unchanged.** Until the cut PR, `ROOMS` binds the game Worker's own class, `ROOMS_LEGACY` is
unbound, and `roomsOf` returns `ROOMS` whatever `ROOMS_NEW` says: the routes are today's to the byte
(`rooms-of.test.ts`), so merging slices R1 to R3 is an ordinary game deploy. The existing Workers Builds project
deploys `wrangler.jsonc` only, so merging `wrangler.relay.jsonc` deploys nothing (confirm its deploy command is the
default `npx wrangler deploy` with no `-c`).

## 2. The cut PR (P2), exact

The whole cut is this change to `wrangler.jsonc`, and nothing else. `relay-config.test.ts` checks this exact
shape as `cutConfig` (F1, F4), and the text below was parsed and compared with it.

```diff
--- a/wrangler.jsonc
+++ b/wrangler.jsonc
@@ -59,6 +59,15 @@
 		"bindings": [
 			{
 				"name": "ROOMS",
+				"class_name": "MatchRoom",
+				// GH-1397: every room from the cut on is the relay's (wrangler.relay.jsonc).
+				"script_name": "roaring-lions-relay"
+			},
+			// GH-1397 (D-R4): the game Worker's own class, kept as the ROOMS_NEW=0
+			// rollback lever's target and otherwise idle. Keep net-v1 below and the
+			// MatchRoom export in index.ts while this binding exists.
+			{
+				"name": "ROOMS_LEGACY",
 				"class_name": "MatchRoom"
 			}
 		]
```

The `net-v1` migration and `export { MatchRoom }` in `index.ts` stay (F4 fails if either goes).

## 3. The relay's Workers Builds project (D-R5)

A second Workers Builds project on the same repository, for `roaring-lions-relay`:

- **Deploy command:** `npx wrangler deploy -c wrangler.relay.jsonc`
- **Build watch paths, include** (generated from the relay bundle's module graph and compared with it by
  `relay-config.test.ts`, F8, so it cannot drift; `RELAY_WATCH_INCLUDE` is the source):
  `packages/worker/src/relay.ts`, `packages/worker/src/match/*`, `packages/worker/src/account/config.ts`,
  `packages/worker/src/account/crypto.ts`, `packages/worker/src/account/http.ts`,
  `packages/worker/src/account/seat-member.ts`, `packages/worker/src/account/session.ts`,
  `packages/worker/src/auth.ts`, `packages/worker/src/origin.ts`, `packages/worker/src/rate-day.ts`,
  `packages/worker/src/read-capped.ts`, `packages/worker/src/retention.ts`, `packages/net/src/*`,
  `packages/sim/src/*`, `wrangler.relay.jsonc`, `pnpm-lock.yaml`
- **Build watch paths, exclude:** `*.test.ts`

Two differences from the design's list (§6.1), both found by deriving it from the bundle:
1. **`packages/sim/src/*` is in it.** The room imports `@lions/net`, which pulls 31 `@lions/sim` modules through
   its index (`sim.ts`, `tuning.ts`, `gen/tables.ts`, the snapshot schemas among them). So a sim or tuning PR
   redeploys the relay and restarts every open room, which is most of what this change hoped to avoid. That is a
   real cost, not a list error: narrowing it means narrowing what `match-room.ts` imports from `@lions/net`,
   which is its own issue. The design's list would have missed those modules and shipped a relay that does
   not redeploy when its code changes.
2. **`d1.ts` and `do-types.ts` are not in it.** They are type-only: a change to them cannot change the bundle,
   and a deploy of unchanged code still restarts the objects (§12 fact 3). The account and `auth.ts` modules are
   in it because `seat-member.ts` reaches them.

Workers Builds' wildcard semantics (`*` across `/`) and the exclude field are a platform fact to confirm (§12 fact 5).

## 4. The staging run on throwaway D1 databases (P1, §8.4, D-R7)

Everything here is created for the run and destroyed after it. Nothing is committed: the two staging configs
are local files the lead writes and deletes. Run from a checkout at the merged commit, with `pnpm install` and
`pnpm build` done (the game Worker serves `packages/app/dist`).

### 4.1 Create

1. Two throwaway D1 databases; note each `database_id` printed:
   ```
   npx wrangler d1 create rl-gh1397-telemetry
   npx wrangler d1 create rl-gh1397-accounts
   ```
2. Two local staging configs under `dist-gh1397/` (eslint ignores `dist-*`; git does NOT, so never `git add` them):
   - `dist-gh1397/game.jsonc`: a copy of `wrangler.jsonc` with **the cut of §2 NOT yet applied** (step 4.2.2
     applies it), and with: `"name": "roaring-lions-gh1397-game"`; `main`, `assets.directory` and both
     `migrations_dir` paths made relative to `dist-gh1397/` (prefix `../`); the two `database_name` and
     `database_id` values replaced by the throwaway ones; the `kv_namespaces` block deleted (accounts stay off,
     and the cron skips the account sweep without it); the `triggers` block deleted; **every
     `ratelimits[].namespace_id` changed** to unused ids (`"9001"` to `"9008"`), because, as I read the docs, a
     namespace id is account-wide and reusing `1001` to `1008` would share production's counters (confirm); `"preview_urls": true` is not
     needed: the staging game Worker answers on its own `roaring-lions-gh1397-game.<subdomain>.workers.dev`.
   - `dist-gh1397/relay.jsonc`: a copy of `wrangler.relay.jsonc` with `"name": "roaring-lions-gh1397-relay"`,
     `main` prefixed `../`, and the two throwaway database names and ids.
3. Apply the migrations to the throwaway databases only:
   ```
   npx wrangler d1 migrations apply rl-gh1397-telemetry --remote -c dist-gh1397/game.jsonc
   npx wrangler d1 migrations apply rl-gh1397-accounts --remote -c dist-gh1397/game.jsonc
   ```
4. Deploy the relay FIRST (a binding to a script that does not exist fails the game deploy), then the game
   Worker, and give both the same new random ticket secret (never production's):
   ```
   npx wrangler deploy -c dist-gh1397/relay.jsonc
   npx wrangler deploy -c dist-gh1397/game.jsonc
   openssl rand -base64 32          # paste the same value into both prompts below
   npx wrangler secret put TICKET_SECRET -c dist-gh1397/relay.jsonc
   npx wrangler secret put TICKET_SECRET -c dist-gh1397/game.jsonc
   ```
   In a second terminal, `npx wrangler tail roaring-lions-gh1397-relay` shows when the relay's room is invoked.

### 4.2 Test (two browsers, music off; record each observation for GH-1397)

1. **Pre-cut baseline.** Open the staging game Worker's URL in two browsers, create a versus room in one, join
   from the other, play to about a minute; note the tick. The relay's tail shows nothing (the room is the game
   Worker's own).
2. **Apply the cut** of §2 to `dist-gh1397/game.jsonc` (with `"script_name": "roaring-lions-gh1397-relay"`) and
   `npx wrangler deploy -c dist-gh1397/game.jsonc`. **Expected: the open match ends** (seats see the room gone).
   Create a new room; the relay's tail shows its invocations. This is the rehearsal of the cut (§8.4 step 6).
3. **The measurement the change rests on (§12 fact 2).** In the new room, play to a minute, then deploy only the
   game Worker with a trivial change: `npx wrangler deploy -c dist-gh1397/game.jsonc --var GH1397_RUN:2`.
   **Expected: both sockets stay open, play continues, no dropped banner.** If they drop, stop here: the split
   buys nothing, and the lead should know before any production step.
4. Reload one tab (F5). **Expected: refused as another build (412)**: the room checks the build (§10). Correct.
5. Deploy the relay with a trivial change: `npx wrangler deploy -c dist-gh1397/relay.jsonc --var GH1397_RUN:2`.
   **Expected: both sockets drop and reconnect inside the 60 s forfeit; play resumes.** Record
   `reconnects.lastOutageMs`.
6. Repeat step 3 with a third tab idle in a lobby, and with a seat in the middle of a snapshot upload.
7. **The switch.** Keep the versus room from step 3 open, then `npx wrangler secret put ROOMS_NEW -c
   dist-gh1397/game.jsonc`, value `0`. **Expected: the open relay room PLAYS ON.** That is not a failure: the put
   changes only where the game Worker sends NEW requests (§6, "What the flip does to a live relay room"), and
   step 3 showed that a new game Worker version leaves the relay's sockets open. Create a room in a third tab: the
   relay's tail stays quiet (it is in the legacy class). Then close one tab of the relay room. **Expected: about
   60 s later (`FORFEIT_MS`) the other tab is told the match ended `forfeit` against the closed seat.** Then
   `npx wrangler secret delete ROOMS_NEW -c dist-gh1397/game.jsonc`; a new room is the relay's again. Record the
   times.
8. **Parity smoke** (as design §5.3 step 4): with the cut in place, create a room in one browser and join from the
   other; play a few seconds. A ticket signed by the game Worker and verified by the relay's room proves the
   secret is the same on both.

### 4.3 Destroy

```
npx wrangler delete -c dist-gh1397/game.jsonc
npx wrangler delete -c dist-gh1397/relay.jsonc
npx wrangler d1 delete rl-gh1397-telemetry
npx wrangler d1 delete rl-gh1397-accounts
rm -r dist-gh1397
```
Then `npx wrangler d1 list` and the dashboard's Workers list must show none of the four. Deleting a script
should remove its Durable Object namespaces and their storage; check the dashboard's Durable Objects page shows
neither staging namespace.

## 5. Production, in order (the lead)

| # | Step | Command or action |
|---|---|---|
| P0 | Merge slices R1 to R4 | `wrangler.jsonc` unchanged: an ordinary game deploy; nothing points at the relay |
| P1a | The staging run, FIRST | §4, all of it, before any production step: it confirms §12 facts 1, 2 and 4, which P1b and P2 rely on. If step 4.2.3 fails, stop here |
| P1b | Deploy the relay | `npx wrangler deploy -c wrangler.relay.jsonc` |
| P1c | Its secret, **the same value** as the game Worker's | `npx wrangler secret put TICKET_SECRET -c wrangler.relay.jsonc`. A secret cannot be read back: if the value is not at hand, generate a new one and put it on BOTH Workers at the quiet hour (tickets in flight then fail, as any rotation does) |
| P1d | The relay's Workers Builds project, LAST, just before P2 | §3. Created any earlier, it only spends Workers Builds capacity on relay redeploys that nothing uses |
| P2 | The cut, at a quiet hour | First, `npx wrangler secret list` on the game Worker must show **no** `ROOMS_NEW` (a leftover `0` would send every room to `ROOMS_LEGACY` and make the cut a silent no-op). Then merge the one-file PR of §2; Workers Builds deploys the game Worker. **Every room open at that moment ends** (D-R1) |
| P3 | The smoke, within minutes (the lead runs it; agents never run `wrangler tail`) | In a second terminal, `npx wrangler tail roaring-lions-relay`. Then create a room in the game's own page, join from a second browser, play a few seconds. **The tail must show the room's invocations.** A smoke that plays while the tail stays quiet means the room is in the game Worker's own class: the cut did nothing (check `npx wrangler secret list` for `ROOMS_NEW`). A smoke that plays with the tail showing the room proves `TICKET_SECRET` parity on the real secrets |
| P4 | From here | a merge to `main` redeploys the game Worker only; the relay deploys only when a §3 watch path changes |

## 6. Rollback

| Where | What |
|---|---|
| P1, the relay is bad | Nothing points at it. `npx wrangler deploy -c wrangler.relay.jsonc` again, or `npx wrangler delete -c wrangler.relay.jsonc` |
| After the cut, the smoke fails or the relay misbehaves | `npx wrangler secret put ROOMS_NEW` (the game Worker, value `0`). No code deploy: every NEW route call (create, join, reconnect, snapshot, watch) uses `ROOMS_LEGACY`, the game Worker's own class. **It does not end a relay room whose seats are still connected**: that room plays on, and still writes its match record, until it ends by its own rules (below). A secret put does make a new version of the game Worker, which restarts the game Worker's own objects, not the relay's. Check the flip took: create a room and confirm `npx wrangler tail roaring-lions-relay` stays quiet (a dashboard entry of ` 0` or `O` is a silent no-op). Then revert the cut PR at leisure |
| Stop a live relay room now | There is no route or command in the code that ends a room on demand (the relay's own `fetch` answers 404 and it has no public URL). With the flip in place, redeploy the relay (`npx wrangler deploy -c wrangler.relay.jsonc`, or the `rollback` below): a relay deploy restarts its objects and drops their sockets (§12 fact 3, step 4.2.5), each seat's reconnect now reaches the legacy class, which has no such room and answers `ended` (`expired`), and the relay room, woken by its own alarm, finds every seat gone and ends `FORFEIT_MS` (60 s) later: `void` when both dropped at that instant, `forfeit` against a seat that had dropped earlier. A sandbox room has no forfeit and waits for its TTL (below) |
| Undo the switch | `npx wrangler secret delete ROOMS_NEW` (the delete makes a new game Worker version, which restarts the legacy class's rooms; their seats then reconnect to the relay, find no room and are told the match ended) |
| The cut PR reverted | `ROOMS` is the game Worker's own class again, and new route calls cannot reach a relay room. A relay room whose seats are still connected plays on, as after the flip; when a seat drops, its reconnect reaches the game Worker's own class and is told the match ended, and the relay room forfeits that seat 60 s after the drop. Say so in the revert PR. **Once the revert is deployed, `npx wrangler secret delete ROOMS_NEW`** (the game Worker): with `ROOMS_LEGACY` unbound it does nothing today, but the day the cut is re-merged a leftover `0` selects `ROOMS_LEGACY` again and the re-cut silently does nothing (P2 checks for it too). Not before the revert is deployed: while `ROOMS_LEGACY` is bound, the delete sends new rooms back to the relay |
| A bad relay version | `npx wrangler rollback -c wrangler.relay.jsonc`, unless a migration shipped in that version |

### What the flip does to a live relay room (from the code)

`roomsOf` (`packages/worker/src/match/routes.ts`) chooses a namespace per HTTP request and never probes the
other, so `ROOMS_NEW=0` changes where the game Worker sends the NEXT request, nothing more. A relay room's state,
its storage alarm and its accepted sockets (Hibernation API) live in the relay script, which the flip does not
touch, and step 4.2.3 measures that a new game Worker version (which the secret put is) leaves those sockets
open. So a relay room with connected seats keeps playing. What changes for it: a seat's join, reconnect upgrade,
snapshot upload or download and a spectator's watch now reach the legacy class, which has no such room. A `/ws`
there is told `ended` (`expired`) and closed, and the legacy object answers any other room call 404 `no such room`.

It ends by the room's own rules only (`room-core.ts`, constants in `@lions/net`'s `protocol.ts`):
- both seats report the result: the room closes `OVER_CLOSE_MS` (120 s) later;
- a seat sends `bye` (a leave, which is a surrender once started) or surrenders;
- a versus seat disconnected for `FORFEIT_MS` (60 s) loses (`forfeit`; both gone at the same instant is `void`).
  The room's one alarm is aimed at that deadline, so it fires with nobody connected. A sandbox room has no forfeit;
- a desync, or the command log's cap: `void`;
- `ROOM_TTL_MS`, **6 hours after the room was created**, whatever its status: `expired`.

So the most a relay room outlives the flip is the rest of its six hours, and its storage is wiped
`PURGE_AFTER_MS` (120 s) after it ends. There is no forced-end mechanism in the code; "Stop a live relay room now"
above is the only lever, and it is a deploy of the relay.

`ROOMS_NEW` is a **secret**, not a dashboard variable: a deploy keeps a secret and drops a dashboard variable
that `wrangler.jsonc` does not declare (the same reason `FEEDBACK_CLOSED` is a secret). Only exactly `0` flips it;
`false`, `off`, ` 0` and an empty value do nothing (`rooms-of.test.ts`, F5).

## 7. What the tests do and do not show

- **Miniflare's restart is harsher than a deploy.** In `relay-split.test.ts` the client's socket ends at the game
  process, so disposing that process drops it; the test proves the ROOM survives (the seats reconnect with their
  old tickets and find the same config, frame log, seats and clock). Whether a Cloudflare deploy of the calling
  Worker leaves an established socket open is §12 fact 2, which only step 4.2.3 measures.
- Miniflare's v4-style `durableObjectsPersist` is not carried by `convertV4MiniflareOptions` in Miniflare 5; the
  relay-restart test persists through the shared `resourcePersistencePath` instead.
- Rate limiters are not bound in the Miniflare run (`Env` treats them as optional); the routes' limiter use is
  covered by `routes.test.ts`.
- Retiring the lever later (removing `ROOMS_LEGACY`, the `index.ts` export, and adding
  `{ "tag": "net-v2", "deleted_classes": ["MatchRoom"] }`) is a one-file PR with no timer (design §13). F4 must be
  updated in the same PR.
