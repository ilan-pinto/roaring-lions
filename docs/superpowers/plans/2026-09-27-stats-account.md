# /stats: Credits, Upgrades and Each Mission's Loadout (GH-254, Lane A): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/stats` shows two new things. For each player it shows the brigade credit balance and every upgrade bought (unit type, track and tier). For each mission it shows what the player fielded: units bought from the dock, units deployed from the roster, and orders by verb. Collection stays anonymous. It is off in dev and CI and under GPC/DNT/`?notrack`, and it carries counts and authored ids, never free text.

**Architecture:** The WP-T1 pipeline, widened. Nothing new is added beside it.
- The contract comes first: `data/schemas/telemetry_event.schema.json` and its hand-written twin, `packages/data/src/telemetry.ts`. One new event type, `account`, is added. `mission_start` and `mission_end` gain optional fields.
- App side (`packages/app/src/telemetry/`) follows the pattern already there: **pure builders with tests, under a thin wiring layer**.
  - `events.ts` gains `accountSnapshot`, `accountEvent`, `orderVerbOf` and `tally`.
  - The new `loadout.ts` holds `startLoadout`.
  - `index.ts` gains `account()`, a loadout argument for `missionStarted`, and `onIntent`/`onBought` on the mission handle.
  - `sender.ts` splits batches by bytes.
  - The dock gets one optional callback, and `main.ts` makes one call at each hook.
- Worker side (`packages/worker`):
  - migration `0002_accounts.sql`;
  - an `accounts` upsert in its **own** batch after the events batch;
  - two queries, `accounts()` and `loadouts()`, with two routes;
  - two page sections.

**Tech Stack:** TypeScript strict, vitest (node for pure modules and the Worker, which uses the `node:sqlite` D1 stand-in; jsdom for the dock), Playwright (tools only). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-27-stats-account-design.md` (GH-254). It is binding, and this plan takes the **recommended default of every open decision, D1 to D6**. If the lead rules otherwise on the spec's PR, the task named against that decision changes before it runs:
- D1 → Task 5;
- D2 → Task 2;
- D3 → Task 7;
- D4 → Task 7;
- D5 → none;
- D6 → Task 9's runbook.

**Status and entry.** This plan runs on `feat/stats-account`, cut from `origin/main` at `b6497c12`, in `/Users/ilpinto/dev/roaring-lions-ep/stats2`. Task 0 re-checks `main` before Task 1.

## Global Constraints

These are binding on every task.

- **Lane A.** Write only under these paths:
  - `packages/app/src/telemetry/**`
  - `packages/app/src/ui/production.ts` and its test
  - `packages/app/src/main.ts`
  - `packages/worker/**`
  - `packages/data/src/telemetry.ts` and its test
  - `data/schemas/telemetry_event.schema.json`
  - `tools/src/ui-review/routes-check.ts` and a new `tools/src/ui-review/telemetry-guard.ts` with its test
  - `docs/**`

  **No `packages/sim/**`, no `packages/render/**`, no `wrangler.jsonc`.** `/usr/bin/git diff --stat b6497c12..HEAD -- packages/sim packages/render wrangler.jsonc` is EMPTY at every commit.
- **The sim is untouched (invariant 4).**
  - Telemetry reads sim arrays through a structural view (`startLoadout`), never `Sim` itself.
  - It counts `PlayerIntent`s *after* `applyIntent` has run (it is one more `intentListeners` entry).
  - It never queues a command.

  `pnpm test:determinism` runs in Task 9 as the canary, and the golden hash cannot move.
- **The off switch stays one object.** Every new method exists on `NOOP_TELEMETRY` and `NOOP_MISSION`. No hook reaches `Sender`, `fetch` or `sendBeacon` except through `telemetry()`. No new code reads `import.meta.env`, `location` or `navigator` for a telemetry decision; `telemetryEnabled` stays the only gate, and it is not edited.
- **Privacy: counts and authored ids only.**
  - Every new string on the wire is either a unit or track id matching `^[a-z0-9_]{1,32}$`, a tier string `^[a-z0-9_]{1,32}\.[a-z0-9_]{1,32}\.[1-9]$`, or one of eleven verbs.
  - Every new number is a non-negative integer.
  - A roster entry's `name` is **never read**; the loadout reads `.type` only.
  - A builder drops anything that fails its pattern rather than sending it. The Worker's guard drops the event if something slips through anyway.
- **Backward compatible on the wire.** `v` stays `1`. Every new field is optional in the schema and in `isTelemetryEvent`, so a cached old client still validates. Every `/stats` mean counts only the runs that carry the field.
- **The account is read only through `ledgerStore`.** No task names `lions.brigade.account` or touches storage. Only `ledgerStore.readAccount()` and the accounts already in hand inside `onBuy`, `onBuyUpgrade`, `onReset` and the payout reach `telemetry().account`.
- **Deploy is not ours.** Cloudflare Workers Builds deploys the Worker and the app together on merge to `main`. `wrangler deploy` does **not** apply D1 migrations. The lead applies `0002_accounts.sql` to production **before merging** with exactly:

  ```
  npx wrangler d1 migrations apply roaring-lions-telemetry --remote
  ```

  **No session on this plan runs any `--remote` wrangler command.** A local check uses `--local` only.
- **Every check has an input that makes it fail, and that input has been run.** Each task's last step names its mutations. Each one is applied, seen red, and undone **by reverting the edit**, never with `git checkout -- <file>`. The commit body says what was seen red.
- **Browser tools run on an explicit free port in 5210–5219** (`--port=`). **Never kill a process you did not start. Never `pkill`.** A dev server you started is stopped by its own tool.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, plus whatever the task names. Then check `/usr/bin/git diff --stat b6497c12..HEAD -- packages/sim packages/render wrangler.jsonc`: it must be empty.
- **Git hygiene.**
  - Call `/usr/bin/git` by absolute path, one command per call.
  - Stage with `/usr/bin/git add <paths>`, then commit with `/usr/bin/git commit -s -F <msgfile> -- <paths>`.
  - Never use `-A`, never `git checkout -- <file>`, never amend, and never push from a task.
  - End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Size.** Each task touches at most five authored files and about 400 changed lines, tests included.
- **Model tiers.** Sonnet by default and haiku for the one mechanical task (Task 4). Opus goes to `main.ts` (Task 5), to the harness and the release gate (Task 9), and to the final whole-branch review. Nothing inherits opus by default.

## Rulings taken while planning

- **R-1: the loadout rides on `mission_start` and the counts ride on `mission_end`.** The deployed force is a fact at the start. If it waited for the end, it would be lost with a beacon. The counts accumulate, so they can only be known at the end.
- **R-2: `account` is its own event type, not a field on `mission_start`.** Three of its four moments (`payout`, `purchase` and `reset`) happen outside a mission's start. The payout is written to the account **after** `missionTelemetry.onEvent(me)` has already sent `mission_end` (`main.ts`, the `missionEnd` branch). A snapshot on `mission_end` would therefore read the balance before the payout.
- **R-3: `fromRoster` reuses `drawFromPool`** (`ui/deploy-roster.ts`) over the ledger that `deployedLedger` produced. That is the same pool and the same rule `MissionRuntime` draws with. No second draw rule is written.
- **R-4: `deployed` counts side-0 units alive right after `startMission`.** That is the starting force, plus anything the mission's `start()` spawned for the player. Passengers count, and civilians (side 2) do not.
- **R-5: a snapshot is sent only when `ledgerStore.available`.** Without durable storage the account is `emptyAccount()` by construction, and a stream of zeros would read as a real player with no credits.
- **R-6: the `accounts` upsert gets its own `batch` and its own `try`.** It runs after the events batch has committed. If the migration was not applied, the raw events survive and only the summary is lost; `QUERIES.sql` rebuilds the summary from those events.
- **R-7: the byte cap is 48 KB, measured as string length.** Every field the client sends is ASCII: ids, digits, and the envelope's UUIDs and build. `String.length` therefore equals the byte count, and the Worker's `text.length > MAX_BODY` check measures the same way.

## File structure

| File | Responsibility | Task | Est. lines |
|---|---|---|---|
| `data/schemas/telemetry_event.schema.json`, `packages/data/src/telemetry.ts` (+test) | `account` type; optional loadout and count fields; `TELEMETRY_ORDER_VERBS` | 1 | 260 |
| `packages/app/src/telemetry/events.ts` (+test), `sender.ts` (+test) | `accountSnapshot`, `accountEvent`, `orderVerbOf`, `tally`, widened builders; byte-capped batches | 2 | 330 |
| `packages/app/src/telemetry/index.ts` (+test) | `account()`, `missionStarted(…, loadout)`, `onIntent`, `onBought`, the NOOPs | 3 | 220 |
| `packages/app/src/ui/production.ts` (+test) | optional `onBought` after an accepted buy | 4 | 60 |
| `packages/app/src/telemetry/loadout.ts` (+test), `packages/app/src/main.ts` | `startLoadout`; the seven hooks | 5 | 260 |
| `packages/worker/migrations/0002_accounts.sql`, `src/ingest.ts`, `src/ingest-account.test.ts`, `QUERIES.sql` | the table, the guarded upsert, the rebuild query | 6 | 220 |
| `packages/worker/src/stats.ts`, `src/stats-account.test.ts` | `accounts()`, `loadouts()`, two routes | 7 | 330 |
| `packages/worker/src/stats-page.ts`, `stats-page.test.ts` | two sections | 8 | 120 |
| `tools/src/ui-review/telemetry-guard.ts` (+test), `routes-check.ts` | the zero-request leg; the release runbook | 9 | 150 |

---

### Task 0: Entry, main as it stands, and a baseline

This is not a code task. The coordinator runs it, and it needs no model.

- [ ] **Step 1:** Run `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/stats2 fetch origin`. Then run `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/stats2 log --oneline b6497c12..origin/main --` on these paths:
  - `packages/app/src/telemetry`
  - `packages/app/src/main.ts`
  - `packages/app/src/ui/production.ts`
  - `packages/app/src/ui/deploy-roster.ts`
  - `packages/app/src/input/intents.ts`
  - `packages/worker`
  - `packages/data/src/telemetry.ts`
  - `data/schemas/telemetry_event.schema.json`
  - `tools/src/ui-review/routes-check.ts`

  If anything is listed, merge `origin/main`, re-read what moved, and re-check every citation below before Task 1. Every citation here was taken at `b6497c12`.
- [ ] **Step 2:** Run `/usr/bin/git worktree list` and `/usr/bin/git status --short`. The tree must be clean apart from the spec and this plan.
- [ ] **Step 3: Baseline gates.** Record the results in the ledger (`.superpowers/stats-account/ledger.md`, git-ignored, mirrored to the session scratchpad):
  - `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm test:determinism`
  - `pnpm ui:routes -- --port=5211`. It must pass as it stands.
- [ ] **Step 4:** Check whether GitHub Actions can start a job: `gh run list --limit 3`. Record the answer. If runs are red with no logs, that is the billing block (since 2026-09-24), and Task 9's CI evidence becomes "local gates plus `ui:routes`", said so in the PR body. Do not attempt to work around it.

---

### Task 1: The contract: `account`, the loadout and the counts

**Model:** sonnet. A schema and its hand-written twin, pinned against each other by the existing test.

**Files:**
- Modify: `data/schemas/telemetry_event.schema.json`, `packages/data/src/telemetry.ts`, `packages/data/src/telemetry.test.ts`

**Interfaces (Tasks 2, 3, 6, 7 and 8 consume these):**
- `TELEMETRY_EVENT_TYPES` gains `'account'`.
- `export const TELEMETRY_ORDER_VERBS = ['move','attackMove','garrison','demolish','chargeTunnel','mount','dismount','smoke','halt','strike','sweep'] as const;` with `export type TelemetryOrderVerb`.
- `export const ACCOUNT_REASONS = ['mission_start','payout','purchase','reset'] as const;` with `export type AccountReason`.
- `export const UNIT_ID_PATTERN = /^[a-z0-9_]{1,32}$/; export const TIER_PATTERN = /^[a-z0-9_]{1,32}\.[a-z0-9_]{1,32}\.[1-9]$/;`
- `export type CountMap = Record<string, number>;`
- New union members, and widened ones:

```ts
| { type: 'mission_start'; mission: string; replay: boolean; deployed?: CountMap; fromRoster?: CountMap }
| { type: 'mission_end'; /* existing fields */ bought?: CountMap; orders?: Partial<Record<TelemetryOrderVerb, number>> }
| {
    type: 'account';
    reason: AccountReason;
    mission?: string;
    credits: number;
    earned: number;
    unlocks: string[];
    tiers: string[];
    item?: string;
    price?: number;
    paid?: number;
  }
```

- [ ] **Step 1: Write the failing tests.** Append the following to `VALID` in `packages/data/src/telemetry.test.ts`:

```ts
  { ...ENV, type: 'mission_start', mission: 'beit_sahwan_breach', replay: false, deployed: { inf_squad: 3, mbt_lavi: 1 }, fromRoster: { inf_squad: 2 } },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'victory', tick: 6000, roe: 94, fielded: 12, lost: 2, objectivesDone: 3, objectivesTotal: 4, bought: { inf_squad: 1 }, orders: { move: 40, attackMove: 12, strike: 1 } },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'abandoned', tick: 90, roe: 100, fielded: 4, lost: 0, objectivesDone: 0, objectivesTotal: 2, bought: {}, orders: {} },
  { ...ENV, type: 'account', reason: 'mission_start', mission: 'beit_sahwan_breach', credits: 340, earned: 900, unlocks: ['mbt_lavi'], tiers: ['inf_squad.armour.2', 'inf_squad.sensors.1'] },
  { ...ENV, type: 'account', reason: 'payout', mission: 'beit_sahwan_breach', credits: 120, earned: 120, unlocks: [], tiers: [], paid: 120 },
  { ...ENV, type: 'account', reason: 'purchase', credits: 225, earned: 900, unlocks: [], tiers: ['inf_squad.armour.1'], item: 'inf_squad.armour.1', price: 115 },
  { ...ENV, type: 'account', reason: 'purchase', credits: 0, earned: 900, unlocks: ['mbt_lavi'], tiers: [], item: 'mbt_lavi', price: 900 },
  { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: [] },
```

Then append the following to `INVALID`:

```ts
  ['unlock that is free text', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: ['Lavi MBT'], tiers: [] }],
  ['tier 0 on the wire', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: ['inf_squad.armour.0'] }],
  ['tier without a track', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: ['inf_squad.2'] }],
  ['unknown account reason', { ...ENV, type: 'account', reason: 'gift', credits: 0, earned: 0, unlocks: [], tiers: [] }],
  ['negative credits', { ...ENV, type: 'account', reason: 'reset', credits: -1, earned: 0, unlocks: [], tiers: [] }],
  ['account missing tiers', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [] }],
  ['65 unlocks', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: Array.from({ length: 65 }, (_, i) => `u${i}`), tiers: [] }],
  ['item with a space', { ...ENV, type: 'account', reason: 'purchase', credits: 0, earned: 0, unlocks: [], tiers: [], item: 'mbt lavi', price: 1 }],
  ['order verb that is presentation', { ...ENV, type: 'mission_end', mission: 'a', result: 'victory', tick: 1, roe: 1, fielded: 1, lost: 0, objectivesDone: 1, objectivesTotal: 1, orders: { select: 3 } }],
  ['float count in deployed', { ...ENV, type: 'mission_start', mission: 'a', replay: false, deployed: { inf_squad: 1.5 } }],
  ['uppercase unit key in bought', { ...ENV, type: 'mission_end', mission: 'a', result: 'victory', tick: 1, roe: 1, fielded: 1, lost: 0, objectivesDone: 1, objectivesTotal: 1, bought: { INF: 1 } }],
  ['orders on mission_start', { ...ENV, type: 'mission_start', mission: 'a', replay: false, orders: { move: 1 } }],
  ['item on mission_start', { ...ENV, type: 'mission_start', mission: 'a', replay: false, item: 'mbt_lavi' }],
```

Add one test beside the existing ones:

```ts
  it('the schema and the guard agree on the order verbs, in order', () => {
    const verbs = (schema as { $defs: { orderVerb: { enum: string[] } } }).$defs.orderVerb.enum;
    expect(verbs).toEqual([...TELEMETRY_ORDER_VERBS]);
  });
```

Also import `TELEMETRY_ORDER_VERBS` from `./telemetry`.

- [ ] **Step 2: Run the tests to see them fail:** `pnpm vitest run packages/data/src/telemetry.test.ts`. The eight new valid fixtures fail both validators. `covers every event type` fails on `account`. The verbs test fails at the import.
- [ ] **Step 3: Implement the schema.** In `telemetry_event.schema.json`:
  - Add `"account"` to the root `type.enum`.
  - Add to `$defs`:

```json
    "unitId": { "type": "string", "pattern": "^[a-z0-9_]{1,32}$" },
    "tier": { "type": "string", "pattern": "^[a-z0-9_]{1,32}\\.[a-z0-9_]{1,32}\\.[1-9]$" },
    "orderVerb": { "enum": ["move", "attackMove", "garrison", "demolish", "chargeTunnel", "mount", "dismount", "smoke", "halt", "strike", "sweep"] },
    "unitCounts": {
      "type": "object",
      "maxProperties": 64,
      "propertyNames": { "$ref": "#/$defs/unitId" },
      "additionalProperties": { "$ref": "#/$defs/count" }
    },
    "orderCounts": {
      "type": "object",
      "propertyNames": { "$ref": "#/$defs/orderVerb" },
      "additionalProperties": { "$ref": "#/$defs/count" }
    }
```

  - In the `mission_start` branch, add `"deployed": { "$ref": "#/$defs/unitCounts" }` and `"fromRoster": { "$ref": "#/$defs/unitCounts" }` to its properties. `required` is unchanged.
  - In the `mission_end` branch, add `"bought": { "$ref": "#/$defs/unitCounts" }` and `"orders": { "$ref": "#/$defs/orderCounts" }`. `required` is unchanged.
  - Add a new `oneOf` branch:

```json
    {
      "properties": {
        "type": { "const": "account" },
        "reason": { "enum": ["mission_start", "payout", "purchase", "reset"] },
        "mission": { "$ref": "#/$defs/mission" },
        "credits": { "$ref": "#/$defs/count" },
        "earned": { "$ref": "#/$defs/count" },
        "unlocks": { "type": "array", "maxItems": 64, "items": { "$ref": "#/$defs/unitId" } },
        "tiers": { "type": "array", "maxItems": 256, "items": { "$ref": "#/$defs/tier" } },
        "item": { "type": "string", "pattern": "^[a-z0-9_]{1,32}(\\.[a-z0-9_]{1,32}\\.[1-9])?$" },
        "price": { "$ref": "#/$defs/count" },
        "paid": { "$ref": "#/$defs/count" }
      },
      "required": ["reason", "credits", "earned", "unlocks", "tiers"]
    }
```

  `count`'s maximum of 100,000 holds for credits: the whole ladder pays under 10,000. Record the measured sum in the commit body. **Measure it** by summing `creditsFor`'s maximum over `world.json`'s missions; do not assume it.
- [ ] **Step 4: Implement the guard** in `packages/data/src/telemetry.ts`:
  - the constants and types above, with `'account'` appended to `TELEMETRY_EVENT_TYPES`;
  - the widened union;
  - `BODY_KEYS`: `mission_start: ['mission','replay','deployed','fromRoster']`, `mission_end: [...existing, 'bought','orders']`, and `account: ['reason','mission','credits','earned','unlocks','tiers','item','price','paid']`.
  - Replace the single `k !== 'cause'` filter with a per-type optional table:

```ts
const OPTIONAL_KEYS: Record<TelemetryEventType, readonly string[]> = {
  session_start: [], heartbeat: [], tutorial_step: [], objective: [], campaign_progress: [],
  mission_start: ['deployed', 'fromRoster'],
  mission_end: ['cause', 'bought', 'orders'],
  account: ['mission', 'item', 'price', 'paid'],
};
const ITEM_PATTERN = /^[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}\.[1-9])?$/;
const isCountMap = (x: unknown, keyOk: (k: string) => boolean, maxKeys: number): boolean => {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const entries = Object.entries(x as Rec);
  return entries.length <= maxKeys && entries.every(([k, v]) => keyOk(k) && isInt(v, 0, COUNT_MAX));
};
const isIdList = (x: unknown, re: RegExp, max: number): boolean =>
  Array.isArray(x) && x.length <= max && x.every((s) => matches(s, re));
const unitKey = (k: string): boolean => UNIT_ID_PATTERN.test(k);
const verbKey = (k: string): boolean => (TELEMETRY_ORDER_VERBS as readonly string[]).includes(k);
const optional = (e: Rec, k: string, ok: (v: unknown) => boolean): boolean => e[k] === undefined || ok(e[k]);
```

  - In `isTelemetryEvent`: `const required = BODY_KEYS[type].filter((k) => !OPTIONAL_KEYS[type].includes(k));`
  - `bodyValid`: `mission_start` adds `optional(e,'deployed',(v)=>isCountMap(v,unitKey,64)) && optional(e,'fromRoster',(v)=>isCountMap(v,unitKey,64))`. `mission_end` adds `optional(e,'bought',(v)=>isCountMap(v,unitKey,64)) && optional(e,'orders',(v)=>isCountMap(v,verbKey,TELEMETRY_ORDER_VERBS.length))`. The new case is:

```ts
    case 'account':
      return (
        (ACCOUNT_REASONS as readonly unknown[]).includes(e.reason) &&
        optional(e, 'mission', (v) => matches(v, MISSION_PATTERN)) &&
        isInt(e.credits, 0, COUNT_MAX) &&
        isInt(e.earned, 0, COUNT_MAX) &&
        isIdList(e.unlocks, UNIT_ID_PATTERN, 64) &&
        isIdList(e.tiers, TIER_PATTERN, 256) &&
        optional(e, 'item', (v) => matches(v, ITEM_PATTERN)) &&
        optional(e, 'price', (v) => isInt(v, 0, COUNT_MAX)) &&
        optional(e, 'paid', (v) => isInt(v, 0, COUNT_MAX))
      );
```

  Update the file header's event list, and add one line citing GH-254.
- [ ] **Step 5: Check the registries.** Run `grep -rn "telemetry_event" packages/data/src tools/src/*.mjs tools/*.mjs 2>/dev/null`. If a schema registry pins the file, it needs no edit (the file name is unchanged). Record the answer.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line. `pnpm typecheck` matters here, because `packages/worker/src/ingest.ts` narrows on `'mission' in e`, and `account.mission` is optional. Each of these must be seen red, then undone:
  - (a) Delete `"account"` from the schema's root `type.enum`. Every account fixture goes red in the schema half.
  - (b) Change `TIER_PATTERN`'s `[1-9]` to `[0-9]`. `tier 0 on the wire` goes red in the guard half only, and the disagreement test names it.
  - (c) Drop `'bought'` from `OPTIONAL_KEYS.mission_end`. Every pre-existing `mission_end` fixture goes red, which proves old clients stay valid only because the field is optional.
  - (d) Swap `strike` and `sweep` in the schema's `orderVerb`. The order test goes red.

  Commit the three paths with the message `feat(data): telemetry carries the brigade account and each mission's loadout (GH-254 T1)`. The body lists what was seen red, and the credit-ladder sum from Step 3.

---

### Task 2: Pure builders, verbs, and a sender that splits by bytes

**Model:** sonnet. Pure functions (spec §1, §5; D2, R-1 and R-7).

**Files:**
- Modify: `packages/app/src/telemetry/events.ts`, `events.test.ts`, `sender.ts`, `sender.test.ts`

**Interfaces (Tasks 3 and 5 consume these):**

```ts
export interface AccountLike {
  readonly balance: number;
  readonly earned_total: number;
  readonly unlocks: readonly string[];
  readonly upgrades: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
export interface AccountSnapshot { credits: number; earned: number; unlocks: string[]; tiers: string[] }
export interface AccountExtra { mission?: string; item?: string; price?: number; paid?: number }
export interface Loadout { deployed: CountMap; fromRoster: CountMap }
export interface MissionCounts { bought: CountMap; orders: Partial<Record<TelemetryOrderVerb, number>> }
export function accountSnapshot(a: AccountLike): AccountSnapshot;
export function accountEvent(env: TelemetryEnvelope, reason: AccountReason, s: AccountSnapshot, extra?: AccountExtra): TelemetryEvent;
export function orderVerbOf(i: PlayerIntent): TelemetryOrderVerb | null;
export function tally(m: CountMap, key: string): void;
export const missionStart: (env, mission, replay, loadout?: Loadout) => TelemetryEvent;
export function missionEnd(env, mission, view, abandoned, counts?: MissionCounts): TelemetryEvent;
export const SENDER_MAX_BYTES = 48 * 1024; // sender.ts
```

- [ ] **Step 1: Write the failing tests.** Append the following to `events.test.ts`, and add `INTENT_KINDS` and `PlayerIntent` to its imports from `'../input/intents'`:

```ts
const acct = {
  balance: 340, earned_total: 900,
  unlocks: ['mbt_lavi', 'apc_eitan', 'mbt_lavi'],
  upgrades: { inf_squad: { sensors: 1, armour: 2, firepower: 0 }, 'Bad Unit': { armour: 1 }, at_team: { 'fire power': 1 } },
};

describe('account snapshot (GH-254)', () => {
  it('flattens tiers, sorts, drops tier 0 and anything that is not an id, and dedupes unlocks', () => {
    expect(ev.accountSnapshot(acct)).toEqual({
      credits: 340, earned: 900, unlocks: ['apc_eitan', 'mbt_lavi'], tiers: ['inf_squad.armour.2', 'inf_squad.sensors.1'],
    });
  });

  it('every account builder output passes the contract', () => {
    const s = ev.accountSnapshot(acct);
    const all = [
      ev.accountEvent(env, 'mission_start', s, { mission: 'beit_sahwan_breach' }),
      ev.accountEvent(env, 'payout', s, { mission: 'beit_sahwan_breach', paid: 120.4 }),
      ev.accountEvent(env, 'purchase', s, { item: 'inf_squad.armour.2', price: 175 }),
      ev.accountEvent(env, 'purchase', s, { item: 'mbt_lavi', price: 900 }),
      ev.accountEvent(env, 'reset', ev.accountSnapshot({ balance: 0, earned_total: 0, unlocks: [], upgrades: {} })),
    ];
    for (const e of all) expect(isTelemetryEvent(e), JSON.stringify(e)).toBe(true);
  });

  it('drops an item that is not an id rather than sending text', () => {
    const e = ev.accountEvent(env, 'purchase', ev.accountSnapshot(acct), { item: 'Lavi MBT', price: 900 });
    expect('item' in e).toBe(false);
    expect(isTelemetryEvent(e)).toBe(true);
  });

  it('caps a hand-edited account at the contract limits instead of losing the event', () => {
    const many = Array.from({ length: 80 }, (_, i) => `unit_${i}`);
    const s = ev.accountSnapshot({ balance: 1, earned_total: 1, unlocks: many, upgrades: {} });
    expect(s.unlocks).toHaveLength(64);
    expect(isTelemetryEvent(ev.accountEvent(env, 'reset', s))).toBe(true);
  });
});

/** One intent of each kind, so the verb table is pinned against INTENT_KINDS itself. */
function sample(kind: PlayerIntent['kind']): PlayerIntent {
  switch (kind) {
    case 'select': return { kind, ids: [1], via: 'click' };
    case 'order': return { kind, verb: 'attackMove', ids: [1], x: 1, y: 1, append: false };
    case 'garrison': return { kind, ids: [1], structure: 2 };
    case 'demolish': return { kind, ids: [1], structure: 2 };
    case 'chargeTunnel': return { kind, ids: [1], tunnel: 0 };
    case 'mount': return { kind, riders: [1], carrier: 2 };
    case 'dismount': return { kind, carriers: [2] };
    case 'smoke': return { kind, ids: [1], x: 1, y: 1 };
    case 'halt': return { kind, ids: [1] };
    case 'group': return { kind, slot: 1, action: 'assign' };
    case 'overlay': return { kind, on: true };
    case 'support': return { kind, call: 'strike', x: 1, y: 1, accepted: true };
  }
}

describe('order verbs (GH-254, D2: per intent)', () => {
  it('maps every intent kind: commands to their verb, presentation to null', () => {
    expect(Object.fromEntries(INTENT_KINDS.map((k) => [k, ev.orderVerbOf(sample(k))]))).toEqual({
      select: null, order: 'attackMove', garrison: 'garrison', demolish: 'demolish', chargeTunnel: 'chargeTunnel',
      mount: 'mount', dismount: 'dismount', smoke: 'smoke', halt: 'halt', group: null, overlay: null, support: 'strike',
    });
  });

  it('a plain move is move, a sweep is sweep, and a refused support call is not an order', () => {
    expect(ev.orderVerbOf({ kind: 'order', verb: 'move', ids: [1], x: 0, y: 0, append: true })).toBe('move');
    expect(ev.orderVerbOf({ kind: 'support', call: 'sweep', x: 0, y: 0, accepted: true })).toBe('sweep');
    expect(ev.orderVerbOf({ kind: 'support', call: 'strike', x: 0, y: 0, accepted: false })).toBeNull();
  });

  it('tally counts, and refuses a key that is not an id', () => {
    const m: Record<string, number> = {};
    ev.tally(m, 'move');
    ev.tally(m, 'move');
    ev.tally(m, 'Lavi MBT');
    expect(m).toEqual({ move: 2 });
  });
});

describe('the loadout and the counts ride on start and end (R-1)', () => {
  it('mission_start carries deployed and fromRoster, and passes the contract', () => {
    const e = ev.missionStart(env, 'beit_sahwan_breach', false, { deployed: { inf_squad: 3 }, fromRoster: { inf_squad: 2 } });
    expect(e).toMatchObject({ deployed: { inf_squad: 3 }, fromRoster: { inf_squad: 2 } });
    expect(isTelemetryEvent(e)).toBe(true);
  });

  it('mission_start without a loadout is the old shape exactly', () => {
    const e = ev.missionStart(env, 'm', false);
    expect('deployed' in e || 'fromRoster' in e).toBe(false);
  });

  it('mission_end carries the counts with zero entries dropped, even when both maps end up empty', () => {
    const e = ev.missionEnd(env, 'm', view({ result: 'victory' }), false, { bought: { inf_squad: 0, mbt_lavi: 1 }, orders: { move: 3, halt: 0 } });
    expect(e).toMatchObject({ bought: { mbt_lavi: 1 }, orders: { move: 3 } });
    const empty = ev.missionEnd(env, 'm', view(), true, { bought: {}, orders: {} });
    expect(empty).toMatchObject({ bought: {}, orders: {} });
    expect(isTelemetryEvent(e) && isTelemetryEvent(empty)).toBe(true);
  });
});
```

Append the following to `sender.test.ts`:

```ts
describe('Sender: byte cap (GH-254 R-7)', () => {
  const fat = (n: number): TelemetryEvent => ({
    v: 1, player: '0f8fad5b-d9cb-469f-a165-70867728950e', session: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    build: '0.78.0', t: n, type: 'account', reason: 'reset', credits: 0, earned: 0,
    unlocks: Array.from({ length: 17 }, (_, i) => `unit_number_${i}`),
    tiers: Array.from({ length: 49 }, (_, i) => `unit_number_${i % 17}.firepower.${(i % 3) + 1}`),
  });

  it('closes a batch before the body passes SENDER_MAX_BYTES, and loses nothing', () => {
    const f = fake();
    const s = new Sender(f.t);
    for (let n = 0; n < 50; n++) s.push(fat(n));
    s.flush();
    expect(f.posts.length).toBeGreaterThan(1);
    for (const b of f.posts) expect(b.length).toBeLessThanOrEqual(SENDER_MAX_BYTES);
    const ts = f.posts.flatMap((b) => (JSON.parse(b) as { events: { t: number }[] }).events.map((e) => e.t));
    expect(ts).toEqual(Array.from({ length: 50 }, (_, n) => n));
  });

  it('still sends a single event larger than the cap on its own, rather than looping', () => {
    const f = fake();
    const s = new Sender(f.t, 50, 500, 100);
    s.push(fat(1));
    s.push(fat(2));
    s.flush();
    expect(f.posts).toHaveLength(2);
    expect(s.pending).toBe(0);
  });
});
```

Also import `SENDER_MAX_BYTES` from `./sender`.

- [ ] **Step 2: Run the tests to see them fail:** `pnpm vitest run packages/app/src/telemetry`. The new builders do not exist yet, and the byte test posts one 80 KB body.
- [ ] **Step 3: Implement `events.ts`.** `import type { PlayerIntent } from '../input/intents';` is an app-internal type import, and `telemetry/` still imports nothing from `render`.

```ts
import {
  UNIT_ID_PATTERN, TIER_PATTERN,
  type AccountReason, type CountMap, type TelemetryOrderVerb,
} from '@lions/data/telemetry';

const ITEM_RE = /^[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}\.[1-9])?$/;
const MAX_UNLOCKS = 64;
const MAX_TIERS = 256;
const COUNT_MAX = 100_000;

export function accountSnapshot(a: AccountLike): AccountSnapshot {
  const unlocks = [...new Set(a.unlocks)].filter((u) => UNIT_ID_PATTERN.test(u)).sort().slice(0, MAX_UNLOCKS);
  const tiers: string[] = [];
  for (const [unit, tracks] of Object.entries(a.upgrades)) {
    for (const [track, tier] of Object.entries(tracks)) {
      const s = `${unit}.${track}.${tier}`;
      if (TIER_PATTERN.test(s)) tiers.push(s); // tier 0, junk ids and tier >= 10 all fail the pattern
    }
  }
  tiers.sort();
  return { credits: int(a.balance), earned: int(a.earned_total), unlocks, tiers: tiers.slice(0, MAX_TIERS) };
}

export function accountEvent(env: TelemetryEnvelope, reason: AccountReason, s: AccountSnapshot, extra: AccountExtra = {}): TelemetryEvent {
  return {
    ...env, type: 'account', reason, credits: Math.min(COUNT_MAX, s.credits), earned: Math.min(COUNT_MAX, s.earned),
    unlocks: s.unlocks, tiers: s.tiers,
    ...(extra.mission !== undefined && MISSION_RE.test(extra.mission) ? { mission: extra.mission } : {}),
    ...(extra.item !== undefined && ITEM_RE.test(extra.item) ? { item: extra.item } : {}),
    ...(extra.price !== undefined ? { price: Math.min(COUNT_MAX, int(extra.price)) } : {}),
    ...(extra.paid !== undefined ? { paid: Math.min(COUNT_MAX, int(extra.paid)) } : {}),
  };
}

export function orderVerbOf(i: PlayerIntent): TelemetryOrderVerb | null {
  switch (i.kind) {
    case 'order':
      return i.verb;
    case 'garrison': case 'demolish': case 'chargeTunnel': case 'mount': case 'dismount': case 'smoke': case 'halt':
      return i.kind;
    case 'support':
      return i.accepted ? i.call : null;
    case 'select': case 'group': case 'overlay':
      return null;
  }
}

export function tally(m: CountMap, key: string): void {
  if (!UNIT_ID_PATTERN.test(key) && !/^[a-zA-Z]{1,16}$/.test(key)) return;
  m[key] = Math.min(COUNT_MAX, (m[key] ?? 0) + 1);
}

const nonZero = <K extends string>(m: Partial<Record<K, number>>): Partial<Record<K, number>> =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'number' && v > 0)) as Partial<Record<K, number>>;
```

`MISSION_RE` is `MISSION_PATTERN`, imported from `@lions/data/telemetry`. Widen `missionStart`: `...(loadout ? { deployed: nonZero(loadout.deployed), fromRoster: nonZero(loadout.fromRoster) } : {})`. Widen `missionEnd` with `...(counts ? { bought: nonZero(counts.bought), orders: nonZero(counts.orders) } : {})`. The `switch` in `orderVerbOf` has no `default`, so a new `PlayerIntent` kind fails `tsc` here until someone decides whether it is an order. That is deliberate.

- [ ] **Step 4: Implement the sender cap.** In `sender.ts`, add `export const SENDER_MAX_BYTES = 48 * 1024;` with a comment citing R-7 and the Worker's `MAX_BODY`. Add a fourth constructor parameter, `private readonly maxBytes = SENDER_MAX_BYTES`. Then replace the `splice` in `flush` with a greedy build:

```ts
    while (this.queue.length > 0) {
      const batch: TelemetryEvent[] = [];
      let bytes = '{"events":[]}'.length;
      for (const next of this.queue) {
        const size = JSON.stringify(next).length + (batch.length > 0 ? 1 : 0);
        if (batch.length === this.maxBatch) break;
        // Never close an EMPTY batch: an event bigger than the cap goes alone.
        if (batch.length > 0 && bytes + size > this.maxBytes) break;
        batch.push(next);
        bytes += size;
      }
      // Defensive: a batch that took nothing would spin this loop forever,
      // synchronously, where no test timeout can reach it. Drop the rest
      // instead -- the class comment already allows losing telemetry.
      if (batch.length === 0) {
        this.queue.length = 0;
        break;
      }
      this.queue.splice(0, batch.length);
      const body = JSON.stringify({ events: batch });
      // ...unchanged transport block
    }
```

  There is no cast and no non-null assertion.
- [ ] **Step 5: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Return `'move'` for `'select'`. The table test goes red.
  - (b) Drop `.slice(0, MAX_UNLOCKS)`. The cap test goes red with 80 unlocks, and the contract would refuse the whole event.
  - (c) Remove the `batch.length > 0 &&` guard in the sender. The oversized-single test goes red: nothing is posted, and the defensive break empties the queue. Without that break, this mutation would spin forever synchronously, which is why the break exists. Do **not** run the mutation with the break removed as well.
  - (c2) Delete the whole byte-cap `if … break` line. The byte-cap test goes red with one post of about 90 KB.
  - (d) Remove `nonZero` from `missionEnd`. The zero-dropping test goes red.

  Commit the four paths with the message `feat(app): telemetry builders for the account, the loadout and order verbs; the sender splits by bytes (GH-254 T2)`.

---

### Task 3: The telemetry API: `account()`, the loadout, `onIntent`, `onBought`

**Model:** sonnet. It is the closure `createTelemetry` already owns (spec §2).

**Files:**
- Modify: `packages/app/src/telemetry/index.ts`, `packages/app/src/telemetry/index.test.ts`

**Interfaces (Task 5 consumes these):**

```ts
export interface MissionTelemetry {
  onEvent(me: MissionEvent): void;
  end(viaPagehide?: boolean): void;
  /** Called from `intentListeners` after `applyIntent`: counts, never acts. */
  onIntent(i: PlayerIntent): void;
  /** Called by the dock after an ACCEPTED `requestBuild`. */
  onBought(unitId: string): void;
}
export interface Telemetry {
  // ...existing four
  missionStarted(mission: string, replay: boolean, view: () => RuntimeView, loadout?: Loadout): MissionTelemetry;
  account(reason: AccountReason, a: AccountLike, extra?: AccountExtra): void;
}
export type { Loadout, AccountLike, AccountExtra } from './events';
```

- [ ] **Step 1: Write the failing tests.** Append the following inside `describe('Telemetry', …)` in `index.test.ts`:

```ts
  it('mission_start carries the loadout it was given', () => {
    reset();
    const h = harness();
    h.tel.missionStarted('m1', false, view, { deployed: { inf_squad: 3 }, fromRoster: { inf_squad: 2 } });
    expect(h.sent.find((e) => e.type === 'mission_start')).toMatchObject({ deployed: { inf_squad: 3 }, fromRoster: { inf_squad: 2 } });
  });

  it('counts orders by verb and dock buys by type, and delivers them on the one mission_end', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    m.onIntent({ kind: 'order', verb: 'move', ids: [1], x: 0, y: 0, append: false });
    m.onIntent({ kind: 'order', verb: 'move', ids: [1], x: 1, y: 1, append: false });
    m.onIntent({ kind: 'select', ids: [1], via: 'click' });
    m.onIntent({ kind: 'support', call: 'strike', x: 0, y: 0, accepted: false });
    m.onBought('inf_squad');
    m.onBought('inf_squad');
    m.onBought('mbt_lavi');
    state = { ...state, result: 'victory' };
    m.onEvent(endEvent('victory'));
    m.onIntent({ kind: 'halt', ids: [1] }); // after the end: not counted, not sent
    m.end();
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ orders: { move: 2 }, bought: { inf_squad: 2, mbt_lavi: 1 } });
    expect(ends[0]).not.toHaveProperty('orders.halt');
  });

  it('counts start from zero for each mission', () => {
    reset();
    const h = harness();
    const a = h.tel.missionStarted('m1', false, view);
    a.onIntent({ kind: 'halt', ids: [1] });
    const b = h.tel.missionStarted('m2', false, view); // auto-ends m1 as abandoned
    b.end();
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends.map((e) => (e.type === 'mission_end' ? e.orders : null))).toEqual([{ halt: 1 }, {}]);
  });

  it('account() sends a contract-valid snapshot with its extras', () => {
    const h = harness();
    h.tel.account('purchase', { balance: 60, earned_total: 900, unlocks: ['mbt_lavi'], upgrades: { inf_squad: { armour: 1 } } }, { item: 'inf_squad.armour.1', price: 115 });
    expect(h.sent).toEqual([expect.objectContaining({ type: 'account', reason: 'purchase', credits: 60, tiers: ['inf_squad.armour.1'], item: 'inf_squad.armour.1', price: 115 })]);
    expect(isTelemetryEvent(h.sent[0])).toBe(true);
  });

  it('a throwing account read is swallowed, never thrown into the game', () => {
    const h = harness();
    const bad = { get balance(): number { throw new Error('storage blew up'); }, earned_total: 0, unlocks: [], upgrades: {} };
    expect(() => h.tel.account('reset', bad)).not.toThrow();
    expect(h.sent).toEqual([]);
  });

  it('the no-op has every new method, and none of them reads its arguments', () => {
    const trap = new Proxy({}, { get: () => { throw new Error('read'); } });
    expect(() => {
      NOOP_TELEMETRY.account('reset', trap as never);
      const m = NOOP_TELEMETRY.missionStarted('m', false, () => { throw new Error('never read'); }, trap as never);
      m.onIntent(trap as never);
      m.onBought('inf_squad');
      m.end();
    }).not.toThrow();
  });
```

Also import `isTelemetryEvent` from `@lions/data/telemetry`.

- [ ] **Step 2: Run the tests to see them fail:** `pnpm vitest run packages/app/src/telemetry/index.test.ts`.
- [ ] **Step 3: Implement.** In `createTelemetry`:
  - `account: safe((reason, a, extra) => d.sink.push(ev.accountEvent(envelope(), reason, ev.accountSnapshot(a), extra)))`.
  - `missionStarted(mission, replay, view, loadout)` pushes `ev.missionStart(envelope(), mission, replay, loadout)`. It declares `const bought: CountMap = {}; const orders: Partial<Record<TelemetryOrderVerb, number>> = {};` inside the `try`.
  - `finish` pushes `ev.missionEnd(envelope(), mission, view(), abandoned, { bought, orders })`.
  - `onIntent: safe((i) => { if (ended) return; const v = ev.orderVerbOf(i); if (v) ev.tally(orders, v); })`
  - `onBought: safe((u) => { if (!ended) ev.tally(bought, u); })`
  - `NOOP_MISSION` gains `onIntent: () => undefined, onBought: () => undefined`, and `NOOP_TELEMETRY` gains `account: () => undefined`.

  Do not touch `initTelemetry` or `telemetryEnabled`.
- [ ] **Step 4: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Drop the `if (ended) return` in `onIntent`. The after-the-end assertion goes red.
  - (b) Hoist `bought`/`orders` out of `missionStarted` to the closure. The per-mission test goes red with `[{ halt: 1 }, { halt: 1 }]`.
  - (c) Make `NOOP_TELEMETRY.account` call `ev.accountSnapshot(a)`. The proxy test goes red. This is the off switch building something it must not.

  Commit the two paths with the message `feat(app): telemetry counts a mission's orders and buys and snapshots the account (GH-254 T3)`.

---

### Task 4: The dock says when a buy was accepted

**Model:** haiku. One optional callback and three tests (spec §2).

**Files:**
- Modify: `packages/app/src/ui/production.ts`, `packages/app/src/ui/production.test.ts`

**Interfaces (Task 5 consumes this):** `ProductionOptions.onBought?: (unitId: string) => void`. It is called exactly once per `requestBuild` that returned `true`, and never otherwise.

- [ ] **Step 1: Write the failing tests.** Append the following to `production.test.ts`. The file's `rig` builds its own options, so these tests build the dock directly:

```ts
describe('onBought (GH-254)', () => {
  function withSpy(rt = fakeRuntime(), unitList: DockUnit[] = [dockUnit()]) {
    document.body.replaceChildren();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bought: string[] = [];
    new ReinforcementDock(host, {
      units: unitList, runtime: rt, note: () => undefined, onArm: () => undefined,
      onBought: (id) => bought.push(id),
    });
    const tile = host.querySelector<HTMLButtonElement>('[data-unit="inf_squad"]');
    if (tile === null) throw new Error('no inf_squad tile');
    return { bought, tile, rt };
  }

  it('fires once per accepted buy, with the unit id', () => {
    const { bought, tile } = withSpy();
    tile.click();
    tile.click();
    expect(bought).toEqual(['inf_squad', 'inf_squad']);
  });

  it('does not fire when the runtime refuses the buy', () => {
    const { bought, tile, rt } = withSpy(fakeRuntime({ buildOk: false }));
    tile.click();
    expect(rt.builds).toEqual(['inf_squad']);
    expect(bought).toEqual([]);
  });

  it('does not fire, and never asks the runtime, for a locked tile', () => {
    const { bought, tile, rt } = withSpy(fakeRuntime({ blocked: { inf_squad: 'Locked' } }));
    tile.click();
    expect(rt.builds).toEqual([]);
    expect(bought).toEqual([]);
  });
});
```

  Before relying on the third test, check that `fakeRuntime({ blocked })` drives `tileState(...).lock` non-null. If `dock-model.ts` computes the lock from somewhere else, use whatever the file's existing "locked tile" test uses, and say so in the commit body.
- [ ] **Step 2: Run the tests to see them fail:** `pnpm vitest run packages/app/src/ui/production.test.ts`. The first test reads `[]`.
- [ ] **Step 3: Implement.** Add the option with a doc comment ("telemetry's count of bought units; never reaches the sim"). In the click handler, `if (this.opts.runtime.requestBuild(unit.id)) { this.opts.onBought?.(unit.id); this.opts.note(...) }`.
- [ ] **Step 4: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Call `onBought` before the `if`. The refusal test goes red.
  - (b) Call it twice. The first test goes red.

  Commit the two paths with the message `feat(app): the dock reports an accepted buy (GH-254 T4)`.

---

### Task 5: The loadout, and the seven hooks in `main.ts`

**Model:** opus. `main.ts` and the mission lifecycle (spec §1 and §2; D1, R-1, R-3, R-4 and R-5).

**Files:**
- Create: `packages/app/src/telemetry/loadout.ts`, `packages/app/src/telemetry/loadout.test.ts`
- Modify: `packages/app/src/main.ts`

**Interfaces:**

```ts
export interface SideView {
  readonly count: number;                       // sim.entityCount
  readonly side: ArrayLike<number>;             // sim.state.side
  readonly alive: ArrayLike<number>;            // sim.state.alive
  readonly typeIdx: ArrayLike<number>;          // sim.state.typeIdx
  typeId(idx: number): string | undefined;      // (k) => sim.unitTypes[k]?.id
}
export function startLoadout(
  v: SideView,
  pool: readonly { readonly type: string }[] | undefined,
  startingForce: MissionJson['starting_force']
): Loadout;
```

- [ ] **Step 1: Write the failing tests** in `loadout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { startLoadout, type SideView } from './loadout';

function world(rows: [side: number, alive: number, type: string][]): SideView {
  const types = [...new Set(rows.map((r) => r[2]))];
  return {
    count: rows.length,
    side: rows.map((r) => r[0]),
    alive: rows.map((r) => r[1]),
    typeIdx: rows.map((r) => types.indexOf(r[2])),
    typeId: (k) => types[k],
  };
}

describe('startLoadout (GH-254 R-3, R-4)', () => {
  const w = world([
    [0, 1, 'inf_squad'], [0, 1, 'inf_squad'], [0, 1, 'inf_squad'], [0, 1, 'mbt_lavi'],
    [0, 0, 'at_team'],      // dead at tick 0: not deployed
    [1, 1, 'sarim_rifles'], // enemy
    [2, 1, 'civilians'],    // civilians are side 2
  ]);

  it('counts living side-0 units by type as deployed', () => {
    expect(startLoadout(w, undefined, []).deployed).toEqual({ inf_squad: 3, mbt_lavi: 1 });
  });

  it('counts the roster draw with the deploy screen’s own rule, by type only', () => {
    const pool = [
      { type: 'inf_squad', veterancy: 2, name: 'Sgt. Free Text' },
      { type: 'mbt_lavi', veterancy: 0 },
      { type: 'inf_squad', veterancy: 1 },
      { type: 'inf_squad', veterancy: 0 },
    ];
    const force = [
      { unit: 'inf_squad', count: 2, from_ledger: true as const },
      { unit: 'mbt_lavi', count: 1 }, // issued by the mission, not drawn
    ];
    const l = startLoadout(w, pool, force);
    expect(l.fromRoster).toEqual({ inf_squad: 2 });
    expect(JSON.stringify(l)).not.toContain('Free Text');
  });

  it('a mission with no roster pool draws nothing from it', () => {
    expect(startLoadout(w, undefined, [{ unit: 'inf_squad', count: 2, from_ledger: true as const }]).fromRoster).toEqual({});
  });

  it('an unknown type index is skipped, never sent as "undefined"', () => {
    const odd: SideView = { ...w, typeId: () => undefined };
    expect(startLoadout(odd, undefined, []).deployed).toEqual({});
  });
});
```

  If `MissionJson['starting_force']`'s element type requires fields the literals above lack, widen the fixture with the minimum the type demands, and cite the type in a comment. Do not cast.
- [ ] **Step 2: Run the tests to see them fail:** `pnpm vitest run packages/app/src/telemetry/loadout.test.ts`.
- [ ] **Step 3: Implement `loadout.ts`.** Import `drawFromPool` from `'../ui/deploy-roster'` and use `ev.tally` for the counts. `drawFromPool` takes `LedgerRosterEntry[]`. Map the pool to `{ type, veterancy: 0 }` stand-ins **before** the call, exactly as `defaultSelection` does in `deploy-select.ts`, so that no `name` enters this module's data flow at all. Then count `pool[i].type` for each drawn index.
- [ ] **Step 4: Wire `main.ts`.** There are seven hooks, one line or one small block each. Locate each afresh; the line numbers below were taken at `b6497c12`.
  1. **Mission start** (~L2310, the `telemetry().missionStarted(` call). Compute the loadout **after** `startMission` returns and before the call. Pass it as the fourth argument.

     ```ts
     const loadout = startLoadout(
       { count: sim.entityCount, side: sim.state.side, alive: sim.state.alive, typeIdx: sim.state.typeIdx, typeId: (k) => sim.unitTypes[k]?.id },
       deployedLedger(ledger, deploySelection)['roster.surviving_units'],
       resolvedMission.starting_force
     );
     ```

     `deployedLedger` is the call `startMission`'s context already makes. Hoist it into one `const sentLedger` used by both, so the two can never read different pools.
  2. **Account at mission start**, right after `missionTel` is created: `if (ledgerStore.available) telemetry().account('mission_start', ledgerStore.readAccount(), { mission: resolvedMission.id });` (R-5).
  3. **Intents** (~L3129, beside `voice.observe`): `intentListeners.push((intent) => missionTelemetry?.onIntent(intent));`. It is registered after `dispatch` has applied the intent, so it only observes.
  4. **Dock** (~L2976, `new ReinforcementDock(document.body, {`): `onBought: (id) => missionTelemetry?.onBought(id),`.
  5. **Payout** (~L3865): directly after `if (payout) ledgerStore.writeAccount(payout.account);` add `if (payout) telemetry().account('payout', payout.account, { mission: mission.id, paid: payout.paid });`.
  6. **Garage buys** (~L1067 and ~L1085). Inside `onBuy` and `onBuyUpgrade`, after `ledgerStore.writeAccount(account)` and only on the landed path:
     - `telemetry().account('purchase', account, { item: unitId, price });`
     - `telemetry().account('purchase', account, { item: \`${unitId}.${track}.${tier}\`, price });`
  7. **Reset**: inside `onReset`, after `ledgerStore.resetAccount()` returns, `telemetry().account('reset', <that returned account>);`.

  Import `startLoadout` from `'./telemetry/loadout'`. Nothing else in `main.ts` changes. Specifically:
  - `initTelemetry` is untouched;
  - no hook runs before `initTelemetry`, which is the first thing `main()` calls, at ~L1194;
  - the sandbox branch is untouched, because it never calls `missionStarted`.
- [ ] **Step 5: Drive it once in the browser**, telemetry on by URL, on a port in 5210–5219. Drive it through the UI and **not** through console shortcuts (the memory rule "Verify UI features by driving the UI").
  1. Start `pnpm dev -- --port=5212`, and keep its handle so that you stop only what you started.
  2. Open `/mission/beit_sahwan_breach?telemetry&tester=gh254`. Deploy, right-click-move twice, press H, and buy one squad from the dock if the mission fields one. Then leave through the pause menu.
  3. In the Network panel (or `mcp__Claude_Browser__read_network_requests` filtered to `api/events`), the POST bodies show:
     - an `account` event with `reason: 'mission_start'`;
     - a `mission_start` with `deployed`;
     - an `abandoned` `mission_end` with `orders: { move: 2, halt: 1 }` and the `bought` count.

     Each POST 404s on Vite; that is expected here, and it is why `?telemetry` is dev-only evidence.
  4. Open `/brigade`, buy one tier, and see one `account` with `reason: 'purchase'` and an `item`.

  Paste the bodies into the ledger, then stop the dev server you started.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line and `pnpm test:determinism`. Each of these must be seen red, then undone:
  - (a) In `startLoadout`, drop the `alive` check. The first test goes red with `at_team: 1`.
  - (b) Pass the raw `ledger` instead of the deployed one. Nothing in vitest can see it, so this falsification is the browser leg's: on a mission with a roster and a changed deploy pick, `fromRoster` stays at the default pick. Record which mission you used. If no shipped mission's roster pool allows a pick that changes the type counts (the draw is by type, so a veterancy-only change cannot show), say so. The hoisted `sentLedger` is then the guard by construction.
  - (c) Move hook 3's push above the `voice.observe` push. It must stay green, because order among listeners does not matter to a counter. Record it green, which documents that the hook has no ordering dependency.

  Commit the three paths with the message `feat(app): telemetry hooks for the loadout, orders, dock buys and the brigade account (GH-254 T5)`. The body carries the browser evidence summary.

---

### Task 6: D1 migration, and an `accounts` upsert that cannot cost the events

**Model:** sonnet. Worker only (spec §3; R-6 and D6).

**Files:**
- Create: `packages/worker/migrations/0002_accounts.sql`, `packages/worker/src/ingest-account.test.ts`
- Modify: `packages/worker/src/ingest.ts`, `packages/worker/QUERIES.sql`

**Interfaces (Task 7 consumes the table):** `accounts(player PK, t, credits, earned, unlocks TEXT JSON array, tiers TEXT JSON array, tester, dev)`.

- [ ] **Step 1: Write the failing tests** in `ingest-account.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleIngest } from './ingest';
import { openTestD1 } from './test-d1';
import type { Env } from './d1';

const P = '0f8fad5b-d9cb-469f-a165-70867728950e';
const S = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const env0 = { v: 1, player: P, session: S, build: '0.78.0' };
const acct = (t: number, credits: number, tiers: string[] = [], extra: Record<string, unknown> = {}) =>
  ({ ...env0, t, type: 'account', reason: 'purchase', credits, earned: 900, unlocks: ['mbt_lavi'], tiers, ...extra });
const hb = (t: number) => ({ ...env0, t, type: 'heartbeat', mission: 'm1', tick: 1 });

function setup() {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
  const post = (events: unknown[]) =>
    handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events }) }), env, 1_790_000_001_000);
  const rows = <T>(sql: string) => db.raw.prepare(sql).all() as T[];
  return { db, post, rows };
}

describe('accounts summary (GH-254)', () => {
  it('keeps the newest snapshot per player, with its lists as JSON', async () => {
    const h = setup();
    await h.post([acct(10, 500), acct(30, 60, ['inf_squad.armour.1'], { tester: 'dani' }), acct(20, 300)]);
    expect(h.rows('SELECT player, t, credits, earned, unlocks, tiers, tester FROM accounts')).toEqual([
      { player: P, t: 30, credits: 60, earned: 900, unlocks: '["mbt_lavi"]', tiers: '["inf_squad.armour.1"]', tester: 'dani' },
    ]);
  });

  it('a late, older snapshot in a later request cannot roll the balance back', async () => {
    const h = setup();
    await h.post([acct(30, 60)]);
    await h.post([acct(10, 500)]);
    expect(h.rows<{ credits: number }>('SELECT credits FROM accounts')[0]?.credits).toBe(60);
  });

  it('writes one accounts statement per player per request, not one per event', async () => {
    const h = setup();
    const statements: string[] = [];
    const spy = { ...h.db, batch: async (ss: Parameters<typeof h.db.batch>[0]) => { statements.push(`batch:${ss.length}`); return h.db.batch(ss); } };
    await handleIngest(
      new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events: [acct(1, 1), acct(2, 2), acct(3, 3)] }) }),
      { DB: spy, ASSETS: { fetch: async () => new Response('') } }, 1
    );
    // events batch: 3 inserts + 1 players upsert; accounts batch: 1 upsert
    expect(statements).toEqual(['batch:4', 'batch:1']);
  });

  it('R-6: with the accounts table missing, the events still land', async () => {
    const h = setup();
    h.db.raw.exec('DROP TABLE accounts');
    const res = await h.post([acct(1, 1), hb(2)]);
    expect(res.status).toBe(204);
    expect(h.rows<{ n: number }>('SELECT COUNT(*) AS n FROM events')[0]?.n).toBe(2);
  });

  it('a request with no account event writes no accounts row', async () => {
    const h = setup();
    await h.post([hb(1)]);
    expect(h.rows('SELECT * FROM accounts')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail:** `pnpm vitest run packages/worker/src/ingest-account.test.ts`. All five fail, because the table does not exist yet. The batch-count test reads `['batch:4']`, with no second batch.
- [ ] **Step 3: Write the migration** `0002_accounts.sql`:

```sql
-- GH-254: the latest brigade-account snapshot per player, so /stats reads one
-- row per player. Rebuildable from events (QUERIES.sql). Applied to production
-- by the lead BEFORE merge, with:
--   npx wrangler d1 migrations apply roaring-lions-telemetry --remote
CREATE TABLE accounts (
  player TEXT PRIMARY KEY,
  t INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  earned INTEGER NOT NULL,
  unlocks TEXT NOT NULL,
  tiers TEXT NOT NULL,
  tester TEXT,
  dev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX accounts_t ON accounts (t);
```

- [ ] **Step 4: Implement ingest.** After `await env.DB.batch(stmts);`, add a separate step:

```ts
    // R-6: its own batch and its own try. A missing `accounts` table (the
    // migration not yet applied) loses this summary and nothing else -- the
    // events above have already committed, and QUERIES.sql rebuilds it.
    try {
      const latest = latestAccountByPlayer(events);
      if (latest.length > 0) await env.DB.batch(latest.map((e) => upsertAccount(env, e)));
    } catch {
      /* summary only */
    }
```

  `latestAccountByPlayer` keeps, per player, the `account` event with the greatest `t` in this request. `upsertAccount` binds `JSON.stringify(e.unlocks)` and `JSON.stringify(e.tiers)`:

```sql
INSERT INTO accounts (player, t, credits, earned, unlocks, tiers, tester, dev)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
ON CONFLICT (player) DO UPDATE SET
  t = excluded.t, credits = excluded.credits, earned = excluded.earned,
  unlocks = excluded.unlocks, tiers = excluded.tiers,
  tester = COALESCE(excluded.tester, accounts.tester),
  dev = MAX(accounts.dev, excluded.dev)
WHERE excluded.t >= accounts.t
```

- [ ] **Step 5: Add a rebuild query to `QUERIES.sql`.** It is labelled as a terminal query that repopulates `accounts` from `events`, and it takes the latest `account` row per player by `t`. It is for the lead to run with `--remote` only if the migration was applied after the merge.

```sql
-- GH-254: rebuild the accounts summary from raw events (only needed if
-- 0002_accounts.sql was applied after the Worker started receiving account events).
INSERT OR REPLACE INTO accounts (player, t, credits, earned, unlocks, tiers, tester, dev)
SELECT e.player, e.t, json_extract(e.payload, '$.credits'), json_extract(e.payload, '$.earned'),
       json_extract(e.payload, '$.unlocks'), json_extract(e.payload, '$.tiers'), e.tester, e.dev
FROM events e
WHERE e.type = 'account'
  AND e.t = (SELECT MAX(t) FROM events x WHERE x.type = 'account' AND x.player = e.player);
```

  Add a test beside the others that runs exactly this statement (read from `QUERIES.sql` by its GH-254 comment marker) against a DB seeded through `handleIngest` whose `accounts` rows were deleted, and asserts that the rows come back equal. Without it, the query is a promise nothing checks.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Drop the `WHERE excluded.t >= accounts.t`. The roll-back test goes red.
  - (b) Move the accounts upsert into the events `stmts` array. R-6 goes red with 0 events, which is the exact failure R-6 exists for.
  - (c) Rebuild query: change `MAX(t)` to `MIN(t)`. The rebuild test goes red.

  Commit the four paths with the message `feat(worker): an accounts summary table, upserted apart from the events it summarises (GH-254 T6)`. The body **repeats the production command** and says it was not run from this session.

---

### Task 7: `/stats/api/accounts` and `/stats/api/loadouts`

**Model:** sonnet. Queries and a fold, in the shape `missions()` already has (spec §4; D3 and D4).

**Files:**
- Modify: `packages/worker/src/stats.ts`
- Create: `packages/worker/src/stats-account.test.ts`

**Interfaces (Task 8 consumes these):**

```ts
export async function accounts(db: D1Like, f: StatsFilter): Promise<{
  player: string; // first 8 hex chars (D4)
  tester: string | null; lastSeen: number; credits: number; earned: number; unlocks: string[]; tiers: string[];
}[]>;
export async function loadouts(db: D1Like, f: StatsFilter): Promise<{
  mission: string; runs: number; loadoutRuns: number; endedRuns: number;
  units: { unit: string; deployed: number | null; fromRoster: number | null; bought: number | null }[];
  orders: Partial<Record<TelemetryOrderVerb, number>>; // mean per ended run with counts
}[]>;
```

- [ ] **Step 1: Write the failing tests** in `stats-account.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openTestD1 } from './test-d1';
import { handleIngest } from './ingest';
import * as stats from './stats';
import type { Env } from './d1';
import { sessionCookieHeader } from './auth';

const T0 = Date.UTC(2026, 8, 27);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = (p: number, t: number, extra: Record<string, unknown>) => ({ v: 1, player: id(p), session: id(100 + p), build: '0.80.0', t, ...extra });
const end = (p: number, t: number, extra: Record<string, unknown> = {}) =>
  base(p, t, { type: 'mission_end', mission: 'beit_sahwan_breach', result: 'victory', tick: 6000, roe: 90, fielded: 5, lost: 0, objectivesDone: 1, objectivesTotal: 1, ...extra });
const all: stats.StatsFilter = { since: 0, testersOnly: false, includeDev: false };

async function seeded() {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
  const send = (events: unknown[]) => handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events }) }), env, T0);
  // Player 1 (dani): two breach runs with the new fields.
  await send([
    base(1, T0, { tester: 'dani', type: 'account', reason: 'mission_start', mission: 'beit_sahwan_breach', credits: 300, earned: 300, unlocks: [], tiers: [] }),
    base(1, T0 + 1, { tester: 'dani', type: 'mission_start', mission: 'beit_sahwan_breach', replay: false, deployed: { inf_squad: 3, mbt_lavi: 1 }, fromRoster: {} }),
    end(1, T0 + 2, { tester: 'dani', bought: { inf_squad: 2 }, orders: { move: 10, halt: 2 } }),
    base(1, T0 + 3, { tester: 'dani', type: 'mission_start', mission: 'beit_sahwan_breach', replay: true, deployed: { inf_squad: 3 }, fromRoster: { inf_squad: 2 } }),
    end(1, T0 + 4, { tester: 'dani', bought: {}, orders: { move: 20 } }),
    base(1, T0 + 5, { tester: 'dani', type: 'account', reason: 'purchase', credits: 185, earned: 300, unlocks: [], tiers: ['inf_squad.armour.1'], item: 'inf_squad.armour.1', price: 115 }),
  ]);
  // Player 2: an OLD client -- no loadout, no counts. It counts as a run, never as a zero.
  await send([
    base(2, T0, { type: 'mission_start', mission: 'beit_sahwan_breach', replay: false }),
    end(2, T0 + 1),
  ]);
  // Player 3: sandbox/dev traffic with an account -- excluded by default.
  await send([base(3, T0, { dev: true, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: [] })]);
  return { db, env };
}

describe('accounts (GH-254)', () => {
  it('lists the latest snapshot per real player, with a truncated id', async () => {
    const { db } = await seeded();
    expect(await stats.accounts(db, all)).toEqual([
      { player: '00000000', tester: 'dani', lastSeen: T0 + 5, credits: 185, earned: 300, unlocks: [], tiers: ['inf_squad.armour.1'] },
    ]);
  });

  it('honours the tester filter and the dev switch', async () => {
    const { db } = await seeded();
    expect(await stats.accounts(db, { ...all, tester: 'nobody' })).toEqual([]);
    expect(await stats.accounts(db, { ...all, includeDev: true })).toHaveLength(2);
  });
});

describe('loadouts (GH-254)', () => {
  it('means per run over the runs that carry the fields; old-client runs are counted but never as zeros', async () => {
    const { db } = await seeded();
    const [breach] = await stats.loadouts(db, all);
    expect(breach).toMatchObject({ mission: 'beit_sahwan_breach', runs: 3, loadoutRuns: 2, endedRuns: 2 });
    expect(breach.units).toEqual([
      { unit: 'inf_squad', deployed: 3, fromRoster: 1, bought: 1 },
      { unit: 'mbt_lavi', deployed: 0.5, fromRoster: 0, bought: 0 },
    ]);
    expect(breach.orders).toEqual({ move: 15, halt: 1 });
  });

  it('lists missions in campaign order and skips missions nobody started', async () => {
    const { db } = await seeded();
    expect((await stats.loadouts(db, all)).map((r) => r.mission)).toEqual(['beit_sahwan_breach']);
  });
});

describe('routes', () => {
  it('both new routes are behind the login and answer JSON when signed in', async () => {
    const { env } = await seeded();
    const withPw: Env = { ...env, STATS_PASSWORD: 'correct horse battery staple' };
    for (const path of ['/stats/api/accounts', '/stats/api/loadouts']) {
      const anon = await stats.handleStats(new Request(`https://g.dev${path}`), withPw, T0);
      expect(anon.status).toBe(401);
      const cookie = (await sessionCookieHeader('correct horse battery staple', T0)).split(';')[0];
      const res = await stats.handleStats(new Request(`https://g.dev${path}`, { headers: { cookie } }), withPw, T0);
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail:** `pnpm vitest run packages/worker/src/stats-account.test.ts`.
- [ ] **Step 3: Implement.**
  - `accounts` uses `where(f)` on the `accounts` table, whose columns match (`t`, `dev`, `tester`). It orders `t DESC`, `LIMIT 500`, and `JSON.parse`s both lists. It returns `player.slice(0, 8)`.
  - `loadouts` selects `mission, type, payload` from `events` where `${w.sql} AND type IN ('mission_start','mission_end') AND mission IS NOT NULL`. It folds in TypeScript, following `missions()`.
    - `runs` counts `mission_start`s. `loadoutRuns` counts starts that carry `deployed`. `endedRuns` counts ends that carry `orders`.
    - Per unit, `deployed` and `fromRoster` are the sum divided by `loadoutRuns`, and `bought` is the sum divided by `endedRuns`. Each is `null` when its denominator is 0, and a unit missing from a carrying run adds 0.
    - The units are sorted by id, and the orders are sum divided by `endedRuns`.
    - Missions are ordered by `CAMPAIGN_ORDER`, filtered to missions with runs.

    A payload that fails `JSON.parse` is skipped. It cannot happen for a row ingest wrote, but the fold must not 500 the page over one row.
  - `handleStats` gains two `case`s: `'/stats/api/accounts'` and `'/stats/api/loadouts'`.
- [ ] **Step 4: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Divide by `runs` instead of `loadoutRuns`. The means test goes red, reading the old client as zeros.
  - (b) Return the full `player`. The first accounts test goes red.
  - (c) Drop `${w.sql}` from `accounts`. The dev-switch test goes red.

  Commit the two paths with the message `feat(worker): /stats queries for brigade accounts and per-mission loadouts (GH-254 T7)`.

---

### Task 8: Two sections on the `/stats` page

**Model:** sonnet. The inline page, in the shape it already has (spec §4).

**Files:**
- Modify: `packages/worker/src/stats-page.ts`, `packages/worker/src/stats-page.test.ts`

- [ ] **Step 1: Write the failing tests.** Append the following to `stats-page.test.ts`:

```ts
import { TELEMETRY_ORDER_VERBS } from '@lions/data/telemetry';

describe('STATS_HTML: accounts and loadouts (GH-254)', () => {
  it('has the three tables under their headings, after Missions and before Testers', () => {
    const at = (s: string) => STATS_HTML.indexOf(s);
    for (const id of ['id="accounts"', 'id="loadout-units"', 'id="loadout-orders"']) expect(STATS_HTML).toContain(id);
    expect(at('<h2>Missions</h2>')).toBeLessThan(at('<h2>Brigade accounts</h2>'));
    expect(at('<h2>Brigade accounts</h2>')).toBeLessThan(at('<h2>Loadouts</h2>'));
    expect(at('<h2>Loadouts</h2>')).toBeLessThan(at('<h2>Testers</h2>'));
  });

  it('loads both new endpoints with the same filter as the rest of the page', () => {
    expect(STATS_HTML).toContain("get('accounts')");
    expect(STATS_HTML).toContain("get('loadouts')");
  });

  it('drift guard: the verb columns are generated from TELEMETRY_ORDER_VERBS, not a hand-copied list', () => {
    expect(STATS_HTML).toContain(`const VERBS=${JSON.stringify(TELEMETRY_ORDER_VERBS)};`);
  });

  it('every value the new tables print goes through esc() or fmt()', () => {
    const block = STATS_HTML.slice(STATS_HTML.indexOf('/*gh254*/'), STATS_HTML.indexOf('/*/gh254*/'));
    expect(block.length).toBeGreaterThan(0);
    // Every `r.` / `u.` / `a.` read inside a cell is wrapped.
    expect(block).not.toMatch(/'<td>'\+(?!esc\(|fmt\()/);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail:** `pnpm vitest run packages/worker/src/stats-page.test.ts`.
- [ ] **Step 3: Implement.**
  - After the Missions `<h2>`, add `<h2>Brigade accounts</h2><div class="wrap"><table id="accounts"></table></div>` and `<h2>Loadouts</h2><div class="wrap"><table id="loadout-units"></table></div><div class="wrap"><table id="loadout-orders"></table></div>`.
  - In the script, inject `const VERBS=${JSON.stringify(TELEMETRY_ORDER_VERBS)};` and extend `load()`'s `Promise.all` with `get('accounts'), get('loadouts')`.
  - Render between `/*gh254*/` and `/*/gh254*/` markers:
    - **accounts**: columns Player, Tester, Credits, Earned, Units unlocked, Upgrades, Last seen. The unlocks cell shows the count, with the ids in a `title` through `esc`. The tiers are shown as `esc(t.replace(/\./g,' '))` joined with `, `.
    - **loadout-units**: one row per mission × unit. Columns: Mission, Unit, Deployed / run, From roster / run, Bought / run, and a Runs column showing `runs (loadoutRuns with data)`.
    - **loadout-orders**: one row per mission, with a column per `VERBS` entry holding the mean per run (`fmt(x,1)`, `—` when absent).
  - Add no new CSS, apart from reusing `.n` and `.muted`.
- [ ] **Step 4: Check it by eye, locally only.** Run `pnpm vitest run packages/worker` green first. Then render the page once with seeded data. `wrangler dev --local` needs `STATS_PASSWORD` in `.dev.vars`, which is git-ignored; never commit it. Alternatively, write the string `STATS_HTML` to a scratchpad file with stubbed `fetch` responses. Check:
  - at 1440 wide and at 375 wide, both new tables scroll inside `.wrap` and the page never scrolls sideways;
  - no text overlaps.

  Put the two screenshots in the ledger.
- [ ] **Step 5: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Hand-write the verb list in the page. The drift guard goes red.
  - (b) Print `a.tester` unescaped. The escape test goes red.

  Commit the two paths with the message `feat(worker): /stats shows brigade accounts and each mission's loadout (GH-254 T8)`.

---

### Task 9: Prove the off switch in CI, then the release gate and runbook

**Model:** opus. The shared harness, plus the whole-branch gate (spec §6; Global Constraints; D6).

**Files:**
- Create: `tools/src/ui-review/telemetry-guard.ts`, `tools/src/ui-review/telemetry-guard.test.ts`
- Modify: `tools/src/ui-review/routes-check.ts`

**Interfaces:**
- `export function isTelemetryRequest(url: string): boolean` returns true for a pathname ending `/api/events`, on any host, with or without a query.
- `export function watchTelemetry(target: { on(ev: 'request', fn: (r: { url(): string }) => void): unknown }, sink: string[]): void`

- [ ] **Step 1: Write the failing tests** in `telemetry-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isTelemetryRequest, watchTelemetry } from './telemetry-guard';

describe('isTelemetryRequest (GH-254: the off switch, proved by the run)', () => {
  it('matches the ingest path on any origin and base', () => {
    expect(isTelemetryRequest('http://localhost:5211/api/events')).toBe(true);
    expect(isTelemetryRequest('http://localhost:5211/roaring-lions/api/events?x=1')).toBe(true);
  });
  it('does not match lookalikes', () => {
    expect(isTelemetryRequest('http://localhost:5211/api/events.json')).toBe(false);
    expect(isTelemetryRequest('http://localhost:5211/src/telemetry/events.ts')).toBe(false);
    expect(isTelemetryRequest('not a url')).toBe(false);
  });
});

describe('watchTelemetry', () => {
  it('records only telemetry requests from whatever it is attached to', () => {
    const handlers: ((r: { url(): string }) => void)[] = [];
    const sink: string[] = [];
    watchTelemetry({ on: (_ev, fn) => handlers.push(fn) }, sink);
    for (const u of ['http://h/api/events', 'http://h/assets/a.png']) for (const h of handlers) h({ url: () => u });
    expect(sink).toEqual(['http://h/api/events']);
  });
});
```

  The second lookalike matters: `telemetry/events.ts` is a module Vite itself serves in dev.
- [ ] **Step 2: Run the tests to see them fail**, then implement. `isTelemetryRequest` is `try { return /\/api\/events$/.test(new URL(url).pathname); } catch { return false; }`.
- [ ] **Step 3: Wire `routes-check.ts`, which runs many contexts, at one point.**
  1. Directly after `browser = await chromium.launch();`, add:
     - `const telemetryHits: string[] = [];`
     - a wrapper, so every later `browser.newContext(...)` is watched without editing its ten call sites:

       ```ts
       const origNewContext = browser.newContext.bind(browser);
       browser.newContext = async (...a) => { const c = await origNewContext(...a); watchTelemetry(c, telemetryHits); return c; };
       ```
  2. After `const page = await browser.newPage(...)`, add `watchTelemetry(page.context(), telemetryHits);`. `browser.newPage` makes its own context and does not go through `newContext`.
  3. Before the final `expect(errors.length === 0, …)`, add:

     ```ts
     expect(telemetryHits.length === 0, `telemetry is on in a dev/CI run (${telemetryHits.length} request(s)): ${telemetryHits.slice(0, 3).join(', ')}`);
     ```

     Also add a header comment line under "Plus:" that names this leg and GH-254.

  If the typed `browser.newContext` assignment fights `tsc`, keep the wrapper and type it through a local `const newContext: typeof browser.newContext = …` rather than reaching for `any`.
- [ ] **Step 4: Run it, and see it red once.**
  1. Run `pnpm ui:routes -- --port=5211`. It must pass, and it prints nothing about telemetry.
  2. **Falsify:** in `packages/app/src/telemetry/enabled.ts`, temporarily return `true` at the top of `telemetryEnabled`. Re-run: it exits 1 naming the requests. The 404s may also surface as console errors. The telemetry message must appear either way, and the run must not pass on the console rule alone. If it does, the leg is not the thing catching it; fix the leg before going on.
  3. Revert the edit (undo it; no `git checkout`).
  4. Re-run green.

  Record both outputs' last lines in the ledger.
- [ ] **Step 5: The whole-branch gate.** Run:
  - `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm test:determinism && pnpm balance`. The determinism hash and `balance` must be unmoved.
  - `pnpm playtest`.
  - `/usr/bin/git diff --stat b6497c12..HEAD -- packages/sim packages/render wrangler.jsonc`, which must be empty.
  - `pnpm golden-baseline -- --port=5213` is informational only. The local darwin baseline has been stale since 2026-09-03 (memory), and the evidence is CI's `visual` job. This branch changes no gated frame: `/stats` is not in the app, and the dock's DOM is unchanged.
- [ ] **Step 6: Commit** the three paths with the message `test(tools): ui:routes fails if a dev/CI run sends any telemetry (GH-254 T9)`.
- [ ] **Step 7: Final review**, opus, of the whole branch against the spec's §6 and this plan's Global Constraints. Then write the PR body (`.superpowers/stats-account/pr-body.md`), including this **release runbook**, verbatim:

  > **Before merging (the lead):**
  > 1. `npx wrangler d1 migrations list roaring-lions-telemetry --remote`. `0002_accounts.sql` is listed as unapplied.
  > 2. `npx wrangler d1 migrations apply roaring-lions-telemetry --remote`. It only adds a table and an index, so the live Worker is unaffected.
  > 3. Merge. Cloudflare Workers Builds deploys the Worker and the app together from `main`. It does **not** apply migrations, which is why step 2 comes first.
  >
  > **If the merge went first:** events still land (R-6). Run step 2, then the GH-254 rebuild query: `npx wrangler d1 execute roaring-lions-telemetry --remote --command "<the INSERT OR REPLACE from QUERIES.sql>"`.
  >
  > **Check:** open `/stats`, sign in, and see Brigade accounts and Loadouts render (empty until someone plays the new build).
  >
  > No session on this branch ran a `--remote` command.

  Include the CI state from Task 0 Step 4. If Actions is still billing-blocked, say that `visual` and `ui:routes` were run locally only, and show their results. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. **Do not push**; the lead opens the PR.

## Execution order

Tasks run one at a time, in this order: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9**.
- 2 needs 1's types, 3 needs 2's builders, and 5 needs 3 and 4.
- 6, 7 and 8 need only 1. They may run before 2–5 if the app half is blocked, but never in parallel with a task that shares a file: 7 and 8 share nothing, but both read `stats.ts`'s exports, so run them in order.
- 9 is last, because it asserts the whole run.
- Each task is reviewed (spec compliance, then code quality) before the next starts.

| Task | Model | Touches |
|---|---|---|
| 0 | coordinator | nothing |
| 1 | sonnet | data contract |
| 2 | sonnet | telemetry builders, sender |
| 3 | sonnet | telemetry API |
| 4 | haiku | dock |
| 5 | opus | `main.ts`, loadout |
| 6 | sonnet | migration, ingest |
| 7 | sonnet | stats queries |
| 8 | sonnet | stats page |
| 9 | opus | `routes-check`, release gate, PR body; final review opus |

## Out of scope

- Units **built** (arrived), as opposed to bought (D5). The `built` MissionEvent already reaches `onEvent`, so it is a one-map follow-up.
- A per-player drill-down of loadouts. The existing tester filter already narrows every table to one tester.
- Normalising loadout counts into their own D1 tables (D3), which is to be revisited past about 10k `mission_end` rows.
- The consent line in the menu. The 2026-09-24 decision stands: it is a gate on public launch, and this change does not move it.
