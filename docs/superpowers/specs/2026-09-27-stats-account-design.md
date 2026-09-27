# /stats: the brigade account and each mission's loadout — design

**Status:** draft for the lead, 2026-09-27.
**Issue:** GH-254 (follow-up to WP-T1, #218). Lane A: app telemetry hooks and
`packages/worker`. No sim change.
**Builds on:** `2026-09-24-telemetry-design.md` (landed). Everything that spec
says about the envelope, the off switches, the sender and `/stats` login still
holds; this document only adds to it.

## The ask

Per player: the credit balance and the upgrades bought (unit, track, tier).
Per mission: units bought from the dock, deployed from the roster, and orders
by verb. No event carries any of it today.

## 1. Events

The envelope is unchanged and `v` stays `1`. Every new field is **optional**
in the contract. The client always sends them, but a tab still running the
previous build (the service worker keeps one alive for a while) sends valid
events that simply lack them. The Worker and the app ship in one deploy, so
only an old client can meet a new Worker, never the reverse.

### 1.1 A new event: `account`

A full snapshot of the brigade account, sent whenever the account is read at a
moment that matters or has just changed:

| `reason` | When | Extra fields |
|---|---|---|
| `mission_start` | the runtime starts (same hook as `mission_start`) | `mission` |
| `payout` | a victory's `payMission` result has been written | `mission`, `paid` |
| `purchase` | a garage Buy or Upgrade **landed** (`landed: true`) | `item`, `price` |
| `reset` | the brigade reset was confirmed | none |

Payload:

| Field | Type | Meaning |
|---|---|---|
| `credits` | int ≥ 0 | `balance` |
| `earned` | int ≥ 0 | `earned_total` |
| `unlocks` | unit ids, ≤ 64, sorted | `account.unlocks` |
| `tiers` | `"<unit>.<track>.<tier>"`, ≤ 256, sorted, tier ≥ 1 | `account.upgrades` flattened; tier 0 never sent |
| `item` | `"<unit>"` (an unlock) or `"<unit>.<track>.<tier>"` | the one thing just bought |
| `price`, `paid` | int ≥ 0 | credits spent, credits earned by this run |

A defeat or an abandon does not change the account, so the `mission_start`
snapshot already describes it; only a victory sends a second one. A snapshot is
sent only when `ledgerStore.available`. With no durable storage there is no
account to describe. The account's `grants` log, `paid` map and any `granted`
entries are not sent.

### 1.2 `mission_start` gains the deployed force

| Field | Meaning |
|---|---|
| `deployed` | `{ unitType: count }`, side-0 units alive right after `startMission` spawns the starting force: everything the player took onto the field |
| `fromRoster` | `{ unitType: count }`, the subset drawn from `roster.surviving_units`, computed by the deploy screen's own `drawFromPool` over the ledger `deployedLedger` produced |

`deployed − fromRoster` is what the mission issued itself. Types only. A
roster entry's `name` is free text from the names table, and it is never
read.

### 1.3 `mission_end` gains what was ordered

| Field | Meaning |
|---|---|
| `bought` | `{ unitType: count }`, dock buys that the runtime accepted (`requestBuild` returned true) |
| `orders` | `{ verb: count }`, one per dispatched `PlayerIntent` that commands something |

The verbs are a closed set of eleven: `move`, `attackMove`, `garrison`,
`demolish`, `chargeTunnel`, `mount`, `dismount`, `smoke`, `halt`, `strike` and
`sweep`. The last two count only an `accepted` support call. `select`, `group`
and `overlay` are presentation, and they are not counted. One right-click over
a mixed selection can dispatch two intents, so it counts under two verbs. The
table therefore reads as commands issued, not clicks made. A zero count is
omitted.

Counting happens in the telemetry closure that already owns the mission. It is
a plain integer increment inside `safe()`, and nothing is built per event.

## 2. Client

Pure additions in `telemetry/events.ts` (`accountSnapshot`, `orderVerbOf`,
`tally`, the widened builders) and a new pure `telemetry/loadout.ts`
(`startLoadout`, over a structural read of sim arrays, never `Sim` itself).
`Telemetry` gains `account(...)`; `missionStarted` takes an optional loadout;
`MissionTelemetry` gains `onIntent` and `onBought`. `NOOP_TELEMETRY` covers
every one, so the off switch is still one object. The dock gets an optional
`onBought(unitId)` after an accepted `requestBuild`. `main.ts` makes one call
at each hook: mission start, the intent listeners (beside `voice.observe`),
the dock option, the payout write, and the garage's `onBuy`, `onBuyUpgrade`
and `onReset`.

## 3. Worker and D1

**Migration `0002_accounts.sql`** adds one table, the latest snapshot per
player, so the accounts table on `/stats` is one indexed read:

```sql
CREATE TABLE accounts (
  player TEXT PRIMARY KEY, t INTEGER NOT NULL, credits INTEGER NOT NULL,
  earned INTEGER NOT NULL, unlocks TEXT NOT NULL, tiers TEXT NOT NULL,
  tester TEXT, dev INTEGER NOT NULL DEFAULT 0
);
```

Ingest upserts it **once per player per request**, from that request's latest
`account` event, and only if `excluded.t >= accounts.t`, so a late beacon
cannot roll a balance back. The upsert runs in a **second `batch` with its own
`try`**, after the events batch has committed. If the table is missing
(migration not yet applied), only the summary is lost. The raw events are
kept, and `accounts` can be rebuilt from them with the query in
`QUERIES.sql`.

The per-mission counts need no table. They live in `events.payload`, and
`/stats` folds them in the Worker exactly as `missions()` already folds
`mission_end`.

**Deploy order.** Cloudflare Workers Builds deploys the Worker on merge to
`main`. `wrangler deploy` does **not** apply D1 migrations. The lead applies
this one **before merging**:

    npx wrangler d1 migrations apply roaring-lions-telemetry --remote

The migration only adds a table, so the Worker already live is unaffected.
No session on this work package runs that command against production.
Development uses `--local`.

## 4. `/stats`

Two new API routes, both behind the existing login and both honouring the
existing range, everyone/testers and tester filters:

- `GET /stats/api/accounts`: one row per player, newest first. Columns: the
  player's first 8 hex characters (enough to tell rows apart, and the UUID was
  random to begin with), tester, credits, earned, units unlocked, tiers owned,
  and last seen.
- `GET /stats/api/loadouts`: per mission, in campaign order:
  - `runs`, the `mission_start` count;
  - per unit type, the mean deployed, mean from the roster and mean bought per
    run;
  - per verb, the mean orders per ended run.
  Only runs that carry the new fields count. A run from an old client is not a
  zero.

Two page sections below Missions: **Brigade accounts** (tiers as
`inf_squad armour 2`), and **Loadouts** (a mission × unit table and a
mission × verb table, which scrolls sideways in the existing `.wrap`).
Colours and fonts come from `STATS_STYLE_HEAD`, unchanged.

## 5. Size and cost

| Event | Typical | Worst case today |
|---|---|---|
| `account` | 0.4 KB | 1.6 KB (17 unlocks, 49 tiers) |
| `mission_start` (+loadout) | 0.4 KB | 0.7 KB |
| `mission_end` (+counts) | 0.6 KB | 1.0 KB (17 types, 11 verbs) |

Fifty worst-case `account` events are 80 KB, over the Worker's 64 KB
`MAX_BODY`, which would drop the whole batch silently; so the sender also
closes a batch at **48 KB** (which `sendBeacon`'s ~64 KB limit needs too).
D1: about three extra rows per mission; the free-tier headroom moves under 2%.

## 6. Privacy

It is unchanged in posture. Collection is anonymous, uses the same UUIDs, and
is off in dev, in CI, under GPC or DNT, and with `?notrack`. Everything new
goes through `telemetry()`, which is `NOOP_TELEMETRY` whenever the switch says
no, so nothing is built, stored or sent. Every new field is an integer, an
authored id checked against a pattern (`^[a-z0-9_]{1,32}$` for units and
tracks, a closed enum for verbs), or a list of them. Nothing a player types
can reach a payload. A roster `name` is the one free-text field near this
code, and it is never read. `/stats` shows a truncated player id, never the
full UUID.

**Proof that it is off in CI.** `ui:routes` gains a whole-run check that the
page made **zero** requests to `/api/events`. The run covers missions, the
dock and garage purchases. The `visual` job has no frame this change touches,
so it stays green.

## 7. Testing

Contract fixtures through both the schema and the guard; pure tests for the
builders, `startLoadout` and the byte split; `createTelemetry` counts per
mission; the dock's `onBought` only on an accepted buy; the Worker's upsert,
its survival of a missing table, and both folds; the `ui:routes` zero-request
leg; `git diff origin/main -- packages/sim` empty.

## Open decisions for the lead

| # | Question | Recommended default |
|---|---|---|
| D1 | Snapshot on `purchase` too, not only at mission start and end? | **Yes.** Upgrades are bought in the garage, between missions. Without it `/stats` lags a purchase until the next deploy, and a player who buys then quits never shows it. |
| D2 | Count `orders` per intent or per gesture? | **Per intent.** It is exact and cheap. Coalescing gestures is the voice director's job, and a second coalescer would drift from it. |
| D3 | Keep per-mission counts in `payload` (JSON) or normalise them into tables? | **Payload.** No second migration, and the fold is small at tester scale. Revisit past about 10k `mission_end` rows. |
| D4 | Show player ids on `/stats`? | **The first 8 hex characters only**, and the tester label where there is one. |
| D5 | Count units built (arrived) as well as bought? | **No, for now.** `bought` answers the ask, and `built` would need a third map. It stays a one-line addition, since the `built` MissionEvent already reaches `onEvent`. |
| D6 | Apply the migration before the merge or after it? | **Before.** It is additive and harmless to the live Worker. Applied after, the upserts fail (the events still land) until it runs. |
