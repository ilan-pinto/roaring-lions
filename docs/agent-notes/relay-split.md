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
   - `dist-gh1397/game.jsonc`: a copy of `wrangler.jsonc` with **the cut of §2 NOT yet applied** (step 4.2.6
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
7. **The switch.** `npx wrangler secret put ROOMS_NEW -c dist-gh1397/game.jsonc`, value `0`. **Expected: the
   open relay room ends** (one namespace only). Create a room: the relay's tail stays quiet (it is in the legacy
   class). Then `npx wrangler secret delete ROOMS_NEW -c dist-gh1397/game.jsonc`; a new room is the relay's again.
   Record the times.
8. **Parity smoke** (as §5.3 step 4): with the cut in place, create a room in one browser and join from the
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
| P1a | Deploy the relay | `npx wrangler deploy -c wrangler.relay.jsonc` |
| P1b | Its secret, **the same value** as the game Worker's | `npx wrangler secret put TICKET_SECRET -c wrangler.relay.jsonc`. A secret cannot be read back: if the value is not at hand, generate a new one and put it on BOTH Workers at the quiet hour (tickets in flight then fail, as any rotation does) |
| P1c | The relay's Workers Builds project | §3 |
| P1d | The staging run | §4, all of it, before P2 |
| P2 | The cut, at a quiet hour | merge the one-file PR of §2; Workers Builds deploys the game Worker. **Every room open at that moment ends** (D-R1) |
| P3 | The smoke, within minutes | create a room in the game's own page, join from a second browser, play a few seconds (proves `TICKET_SECRET` parity on the real secrets) |
| P4 | From here | a merge to `main` redeploys the game Worker only; the relay deploys only when a §3 watch path changes |

## 6. Rollback

| Where | What |
|---|---|
| P1, the relay is bad | Nothing points at it. `npx wrangler deploy -c wrangler.relay.jsonc` again, or `npx wrangler delete -c wrangler.relay.jsonc` |
| After the cut, the smoke fails or the relay misbehaves | `npx wrangler secret put ROOMS_NEW` (the game Worker, value `0`). No code deploy: every route uses `ROOMS_LEGACY`, the game Worker's own class. Rooms open in the relay end (one namespace only). A secret put does make a new version of the game Worker, which restarts the game Worker's own objects, not the relay's. Then revert the cut PR at leisure |
| Undo the switch | `npx wrangler secret delete ROOMS_NEW` (rooms open in the legacy class then end) |
| The cut PR reverted | `ROOMS` is the game Worker's own class again; rooms made in the relay are unreachable and end on their seats' forfeits (60 s). Say so in the revert PR |
| A bad relay version | `npx wrangler rollback -c wrangler.relay.jsonc`, unless a migration shipped in that version |

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
