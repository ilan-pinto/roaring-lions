# Player Telemetry and Cloudflare Hosting Implementation Plan (WP-T1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record anonymous player sessions, time played and mission progress from the deployed game into Cloudflare D1, and show them on a private `/stats` page.

**Architecture:** The event contract lives in `@lions/data` as a JSON schema plus a hand-written runtime guard, and a test pins the two against each other. `packages/app/src/telemetry/` builds events from facts the mission runtime already emits and ships them in batches. A new `packages/worker` serves the game's static assets as it does today, plus `POST /api/events` (into D1) and `/stats` (behind Cloudflare Access). The sim gains exactly one read-only getter.

**Tech Stack:** TypeScript strict, Vitest 3 (node + jsdom), Ajv 2020 (tests only), Cloudflare Workers + Static Assets + D1 + the rate-limiting binding, `node:sqlite` as the D1 stand-in in tests, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-24-telemetry-design.md` (GitHub #218). Read it before Task 1. Every task below argues from it.

## Global Constraints

- **Base.** `feat/telemetry` is branched from `origin/main` **after PR #219 (`fix/renderer-context-release`) merges**. #219 rewrites `bootBattlefield`'s boot and teardown, and this plan hooks into both. The worktree goes in `/Users/ilpinto/dev/roaring-lions-ep/telemetry` (never `.claude/worktrees`, and never the shared tree `/Users/ilpinto/dev/roaring-lions`).
- **Git.** Use `/usr/bin/git`. Commit with explicit paths (`/usr/bin/git commit -s -m "..." -- <paths>`); never `git add -A`, never amend. Every commit carries a DCO sign-off (`-s`) and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Ports.** A dev server or `wrangler dev` uses port 5210 or higher. Never kill a process you did not start. No `pkill`.
- **Invariant 4.** Telemetry reads runtime events and state and never writes sim state. The only sim change is a read-only getter; `pnpm test:determinism` must pass and the golden hash must not move.
- **Off switch.** Telemetry is on only when either (a) `import.meta.env.PROD` holds and the hostname is not `localhost`/`127.0.0.1`/`[::1]`/`*.local`, or (b) `?telemetry` is on the URL. It is always off under `?notrack` (persisted), Global Privacy Control and Do Not Track. CI's `pnpm ui:routes` fails on any console error, so the dev server must never send a request.
- **Privacy.** Store no e-mail, IP or full URL. The IP is used only by the rate-limiting binding, in memory. The `tester` label matches `^[A-Za-z0-9_.-]{1,32}$`.
- **Consent (decided).** Accept the risk for the private test phase. A menu notice through `t()` is a gate on public launch and is **not** part of this plan.
- **No `any`**, no non-null assertions in sim code, and tests sit beside the code as `*.test.ts`.
- **Every task ends green** on `pnpm typecheck`, `pnpm lint` and `pnpm test` (plus `pnpm test:determinism` for Task 2).

### One recorded deviation from the spec

Spec §3 says the Worker's tests run under `vitest-pool-workers` in their own vitest project. This plan runs them in the **existing** node project instead, against a `node:sqlite` adapter shaped like D1. Reasons: D1 *is* SQLite, so the real migration SQL and the real queries execute; the handler uses only `Request`/`Response`, which Node has; and it adds no toolchain and no second vitest project. The Workers runtime itself is covered by `wrangler dev` in Task 10 and the deployed check in Task 12. Task 1 edits the spec line to say so.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `data/schemas/telemetry_event.schema.json` | The event contract | 1 |
| `packages/data/src/telemetry.ts` | Event types, `isTelemetryEvent` guard, id patterns | 1 |
| `packages/data/src/telemetry.test.ts` | The guard and the schema agree on every fixture | 1 |
| `packages/data/package.json` | `./telemetry` subpath export | 1 |
| `packages/sim/src/mission.ts` | `defeatCause` getter | 2 |
| `packages/sim/src/mission.test.ts` | `defeatCause` tests | 2 |
| `assets/sw.js` | Pass `/api/` and `/stats` through | 3 |
| `packages/app/src/sw-policy.test.ts` | Pins that | 3 |
| `packages/app/src/telemetry/identity.ts` (+test) | Player id, tester, opt-out, guarded storage | 4 |
| `packages/app/src/telemetry/enabled.ts` (+test) | The off switch | 4 |
| `packages/app/src/telemetry/events.ts` (+test) | Pure builders: facts → events | 5 |
| `packages/app/src/telemetry/sender.ts` (+test) | Batching queue, beacon on pagehide | 6 |
| `packages/app/src/telemetry/index.ts` (+test) | `initTelemetry`, `telemetry()`, `MissionTelemetry` | 7 |
| `packages/app/src/main.ts` | Five one-line hooks | 8 |
| `packages/worker/**` | Ingest, D1 schema, stats queries, stats page | 9, 10 |
| `wrangler.jsonc` | Worker config (assets, SPA fallback, D1, rate limit) | 9 |
| `.github/workflows/pages.yml`, `.github/workflows/ci.yml` | Retire Pages | 11 |
| `CLAUDE.md` | Package layout + hosting lines | 11 |

---

### Task 1: The event contract

**Files:**
- Create: `data/schemas/telemetry_event.schema.json`
- Create: `packages/data/src/telemetry.ts`
- Create: `packages/data/src/telemetry.test.ts`
- Modify: `packages/data/package.json` (exports)
- Modify: `docs/superpowers/specs/2026-09-24-telemetry-design.md` (§3 test-runner line)

**Interfaces:**
- Produces:
  - `TELEMETRY_VERSION = 1`
  - `TELEMETRY_EVENT_TYPES` (readonly tuple)
  - `type TelemetryScreen = 'menu' | 'campaign' | 'brigade' | 'mission' | 'tutorial' | 'sandbox' | 'other'`
  - `interface TelemetryEnvelope { v: 1; player: string; session: string; tester?: string; build: string; t: number; dev?: true }`
  - `type TelemetryEvent` (discriminated on `type`, fields below)
  - `isTelemetryEvent(x: unknown): x is TelemetryEvent`
  - `ID_PATTERN`, `TESTER_PATTERN`, `MISSION_PATTERN`, `BUILD_PATTERN` (RegExp)
  - Import path: `@lions/data/telemetry`

- [ ] **Step 1: Write the schema**

`data/schemas/telemetry_event.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "telemetry_event.schema.json",
  "title": "Telemetry event",
  "description": "One anonymous gameplay event sent by the client to POST /api/events. Mirrored by isTelemetryEvent in packages/data/src/telemetry.ts; telemetry.test.ts pins the two against each other.",
  "type": "object",
  "required": ["v", "type", "player", "session", "build", "t"],
  "properties": {
    "v": { "const": 1 },
    "type": { "enum": ["session_start", "heartbeat", "tutorial_step", "mission_start", "objective", "mission_end", "campaign_progress"] },
    "player": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
    "session": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
    "tester": { "type": "string", "pattern": "^[A-Za-z0-9_.-]{1,32}$" },
    "build": { "type": "string", "pattern": "^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,6}$" },
    "t": { "type": "integer", "minimum": 0 },
    "dev": { "const": true }
  },
  "oneOf": [
    {
      "properties": {
        "type": { "const": "session_start" },
        "screen": { "enum": ["menu", "campaign", "brigade", "mission", "tutorial", "sandbox", "other"] },
        "renderer": { "enum": ["three", "pixi"] },
        "viewport": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 20000 }, "minItems": 2, "maxItems": 2 },
        "returning": { "type": "boolean" }
      },
      "required": ["screen", "renderer", "viewport", "returning"]
    },
    {
      "properties": {
        "type": { "const": "heartbeat" },
        "mission": { "$ref": "#/$defs/mission" },
        "tick": { "$ref": "#/$defs/tick" }
      },
      "required": ["mission", "tick"]
    },
    {
      "properties": {
        "type": { "const": "tutorial_step" },
        "step": { "type": "integer", "minimum": 0, "maximum": 200 },
        "steps": { "type": "integer", "minimum": 1, "maximum": 200 },
        "prevMs": { "type": "integer", "minimum": 0 }
      },
      "required": ["step", "steps", "prevMs"]
    },
    {
      "properties": {
        "type": { "const": "mission_start" },
        "mission": { "$ref": "#/$defs/mission" },
        "replay": { "type": "boolean" }
      },
      "required": ["mission", "replay"]
    },
    {
      "properties": {
        "type": { "const": "objective" },
        "mission": { "$ref": "#/$defs/mission" },
        "objective": { "type": "string", "pattern": "^[A-Za-z0-9_.-]{1,64}$" },
        "objectiveType": { "type": "string", "pattern": "^[a-z_]{1,32}$" },
        "primary": { "type": "boolean" },
        "status": { "enum": ["complete", "failed"] },
        "tick": { "$ref": "#/$defs/tick" }
      },
      "required": ["mission", "objective", "objectiveType", "primary", "status", "tick"]
    },
    {
      "properties": {
        "type": { "const": "mission_end" },
        "mission": { "$ref": "#/$defs/mission" },
        "result": { "enum": ["victory", "defeat", "abandoned"] },
        "cause": { "type": "string", "pattern": "^(force_destroyed|roe_collapse|objective:[A-Za-z0-9_.-]{1,64})$" },
        "tick": { "$ref": "#/$defs/tick" },
        "roe": { "type": "integer", "minimum": 0, "maximum": 100 },
        "fielded": { "$ref": "#/$defs/count" },
        "lost": { "$ref": "#/$defs/count" },
        "objectivesDone": { "$ref": "#/$defs/count" },
        "objectivesTotal": { "$ref": "#/$defs/count" }
      },
      "required": ["mission", "result", "tick", "roe", "fielded", "lost", "objectivesDone", "objectivesTotal"]
    },
    {
      "properties": {
        "type": { "const": "campaign_progress" },
        "mission": { "$ref": "#/$defs/mission" },
        "missionsWon": { "$ref": "#/$defs/count" }
      },
      "required": ["mission", "missionsWon"]
    }
  ],
  "unevaluatedProperties": false,
  "$defs": {
    "mission": { "type": "string", "pattern": "^[a-z0-9_]{1,64}$" },
    "tick": { "type": "integer", "minimum": 0, "maximum": 1000000000 },
    "count": { "type": "integer", "minimum": 0, "maximum": 100000 }
  }
}
```

- [ ] **Step 2: Write the failing agreement test**

`packages/data/src/telemetry.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, it, expect } from 'vitest';
import { isTelemetryEvent, TELEMETRY_EVENT_TYPES } from './telemetry';

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../data/schemas/telemetry_event.schema.json', import.meta.url)), 'utf8')
) as object;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const ENV = {
  v: 1,
  player: '0f8fad5b-d9cb-469f-a165-70867728950e',
  session: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  build: '0.78.0',
  t: 1790232694000,
};

const VALID: Record<string, unknown>[] = [
  { ...ENV, type: 'session_start', screen: 'menu', renderer: 'three', viewport: [1440, 900], returning: false },
  { ...ENV, type: 'session_start', screen: 'sandbox', renderer: 'pixi', viewport: [375, 812], returning: true, dev: true },
  { ...ENV, tester: 'dani', type: 'heartbeat', mission: 'tel_marum_3_clearance', tick: 1200 },
  { ...ENV, type: 'tutorial_step', step: 3, steps: 14, prevMs: 8123 },
  { ...ENV, type: 'mission_start', mission: 'beit_sahwan_breach', replay: false },
  { ...ENV, type: 'objective', mission: 'beit_sahwan_breach', objective: 'hold_gate', objectiveType: 'hold_for', primary: true, status: 'complete', tick: 4000 },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'victory', tick: 6000, roe: 94, fielded: 12, lost: 2, objectivesDone: 3, objectivesTotal: 4 },
  { ...ENV, type: 'mission_end', mission: 'wadi_halam_5_depot', result: 'defeat', cause: 'objective:raze_depot', tick: 6000, roe: 61, fielded: 9, lost: 9, objectivesDone: 0, objectivesTotal: 2 },
  { ...ENV, type: 'mission_end', mission: 'wadi_halam_5_depot', result: 'abandoned', tick: 900, roe: 100, fielded: 9, lost: 0, objectivesDone: 0, objectivesTotal: 2 },
  { ...ENV, type: 'campaign_progress', mission: 'beit_sahwan_breach', missionsWon: 1 },
];

const INVALID: [string, Record<string, unknown>][] = [
  ['unknown type', { ...ENV, type: 'purchase', mission: 'x' }],
  ['wrong version', { ...ENV, v: 2, type: 'mission_start', mission: 'a', replay: false }],
  ['bad player id', { ...ENV, player: 'not-a-uuid', type: 'mission_start', mission: 'a', replay: false }],
  ['tester with a space', { ...ENV, tester: 'dani cohen', type: 'mission_start', mission: 'a', replay: false }],
  ['extra field', { ...ENV, type: 'mission_start', mission: 'a', replay: false, email: 'x@y.z' }],
  ['field from another type', { ...ENV, type: 'heartbeat', mission: 'a', tick: 1, replay: false }],
  ['missing required', { ...ENV, type: 'heartbeat', mission: 'a' }],
  ['bad cause', { ...ENV, type: 'mission_end', mission: 'a', result: 'defeat', cause: 'bored', tick: 1, roe: 1, fielded: 1, lost: 1, objectivesDone: 0, objectivesTotal: 1 }],
  ['roe out of range', { ...ENV, type: 'mission_end', mission: 'a', result: 'victory', tick: 1, roe: 101, fielded: 1, lost: 0, objectivesDone: 1, objectivesTotal: 1 }],
  ['float tick', { ...ENV, type: 'heartbeat', mission: 'a', tick: 1.5 }],
  ['dev false', { ...ENV, dev: false, type: 'mission_start', mission: 'a', replay: false }],
  ['not an object', 'mission_start' as unknown as Record<string, unknown>],
];

describe('telemetry event contract', () => {
  it.each(VALID.map((e) => [e.type as string, e]))('accepts a valid %s', (_type, e) => {
    expect(validate(e), JSON.stringify(validate.errors)).toBe(true);
    expect(isTelemetryEvent(e)).toBe(true);
  });

  it.each(INVALID)('rejects %s in both the schema and the guard', (_why, e) => {
    expect(validate(e)).toBe(false);
    expect(isTelemetryEvent(e)).toBe(false);
  });

  it('covers every event type with at least one valid fixture', () => {
    expect(new Set(VALID.map((e) => e.type))).toEqual(new Set(TELEMETRY_EVENT_TYPES));
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm vitest run packages/data/src/telemetry.test.ts`
Expected: FAIL. `./telemetry` cannot be resolved.

- [ ] **Step 4: Write the types and the guard**

`packages/data/src/telemetry.ts`:

```ts
/**
 * The telemetry event contract (WP-T1, spec docs/superpowers/specs/2026-09-24-telemetry-design.md).
 *
 * `data/schemas/telemetry_event.schema.json` is the authority. This file is its
 * hand-written twin for the two places that cannot carry Ajv: the browser bundle
 * (size) and the Worker (no `new Function` in the Workers runtime).
 * `telemetry.test.ts` runs every fixture through both and fails on any
 * disagreement, so a change to one without the other cannot pass.
 */

export const TELEMETRY_VERSION = 1;

export const TELEMETRY_EVENT_TYPES = [
  'session_start',
  'heartbeat',
  'tutorial_step',
  'mission_start',
  'objective',
  'mission_end',
  'campaign_progress',
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export const TELEMETRY_SCREENS = ['menu', 'campaign', 'brigade', 'mission', 'tutorial', 'sandbox', 'other'] as const;
export type TelemetryScreen = (typeof TELEMETRY_SCREENS)[number];

export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TESTER_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;
export const MISSION_PATTERN = /^[a-z0-9_]{1,64}$/;
export const BUILD_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/;
const OBJECTIVE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const OBJECTIVE_TYPE_PATTERN = /^[a-z_]{1,32}$/;
const CAUSE_PATTERN = /^(force_destroyed|roe_collapse|objective:[A-Za-z0-9_.-]{1,64})$/;

export interface TelemetryEnvelope {
  v: 1;
  player: string;
  session: string;
  tester?: string;
  build: string;
  /** Client epoch milliseconds. */
  t: number;
  /** Present only on sandbox traffic, which `/stats` excludes by default. */
  dev?: true;
}

export type TelemetryEvent = TelemetryEnvelope &
  (
    | { type: 'session_start'; screen: TelemetryScreen; renderer: 'three' | 'pixi'; viewport: [number, number]; returning: boolean }
    | { type: 'heartbeat'; mission: string; tick: number }
    | { type: 'tutorial_step'; step: number; steps: number; prevMs: number }
    | { type: 'mission_start'; mission: string; replay: boolean }
    | {
        type: 'objective';
        mission: string;
        objective: string;
        objectiveType: string;
        primary: boolean;
        status: 'complete' | 'failed';
        tick: number;
      }
    | {
        type: 'mission_end';
        mission: string;
        result: 'victory' | 'defeat' | 'abandoned';
        /** `force_destroyed`, `roe_collapse` or `objective:<id>`; defeats only. */
        cause?: string;
        tick: number;
        roe: number;
        fielded: number;
        lost: number;
        objectivesDone: number;
        objectivesTotal: number;
      }
    | { type: 'campaign_progress'; mission: string; missionsWon: number }
  );

type Rec = Record<string, unknown>;
const ENVELOPE_KEYS = ['v', 'type', 'player', 'session', 'tester', 'build', 't', 'dev'];
const BODY_KEYS: Record<TelemetryEventType, readonly string[]> = {
  session_start: ['screen', 'renderer', 'viewport', 'returning'],
  heartbeat: ['mission', 'tick'],
  tutorial_step: ['step', 'steps', 'prevMs'],
  mission_start: ['mission', 'replay'],
  objective: ['mission', 'objective', 'objectiveType', 'primary', 'status', 'tick'],
  mission_end: ['mission', 'result', 'cause', 'tick', 'roe', 'fielded', 'lost', 'objectivesDone', 'objectivesTotal'],
  campaign_progress: ['mission', 'missionsWon'],
};

const isInt = (x: unknown, min: number, max: number): boolean =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const matches = (x: unknown, re: RegExp): boolean => typeof x === 'string' && re.test(x);
const isBool = (x: unknown): boolean => typeof x === 'boolean';
const TICK_MAX = 1_000_000_000;
const COUNT_MAX = 100_000;

function bodyValid(e: Rec, type: TelemetryEventType): boolean {
  switch (type) {
    case 'session_start':
      return (
        (TELEMETRY_SCREENS as readonly unknown[]).includes(e.screen) &&
        (e.renderer === 'three' || e.renderer === 'pixi') &&
        Array.isArray(e.viewport) &&
        e.viewport.length === 2 &&
        e.viewport.every((n) => isInt(n, 0, 20000)) &&
        isBool(e.returning)
      );
    case 'heartbeat':
      return matches(e.mission, MISSION_PATTERN) && isInt(e.tick, 0, TICK_MAX);
    case 'tutorial_step':
      return isInt(e.step, 0, 200) && isInt(e.steps, 1, 200) && isInt(e.prevMs, 0, Number.MAX_SAFE_INTEGER);
    case 'mission_start':
      return matches(e.mission, MISSION_PATTERN) && isBool(e.replay);
    case 'objective':
      return (
        matches(e.mission, MISSION_PATTERN) &&
        matches(e.objective, OBJECTIVE_PATTERN) &&
        matches(e.objectiveType, OBJECTIVE_TYPE_PATTERN) &&
        isBool(e.primary) &&
        (e.status === 'complete' || e.status === 'failed') &&
        isInt(e.tick, 0, TICK_MAX)
      );
    case 'mission_end':
      return (
        matches(e.mission, MISSION_PATTERN) &&
        (e.result === 'victory' || e.result === 'defeat' || e.result === 'abandoned') &&
        (e.cause === undefined || matches(e.cause, CAUSE_PATTERN)) &&
        isInt(e.tick, 0, TICK_MAX) &&
        isInt(e.roe, 0, 100) &&
        isInt(e.fielded, 0, COUNT_MAX) &&
        isInt(e.lost, 0, COUNT_MAX) &&
        isInt(e.objectivesDone, 0, COUNT_MAX) &&
        isInt(e.objectivesTotal, 0, COUNT_MAX)
      );
    case 'campaign_progress':
      return matches(e.mission, MISSION_PATTERN) && isInt(e.missionsWon, 0, COUNT_MAX);
  }
}

export function isTelemetryEvent(x: unknown): x is TelemetryEvent {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const e = x as Rec;
  if (!(TELEMETRY_EVENT_TYPES as readonly unknown[]).includes(e.type)) return false;
  const type = e.type as TelemetryEventType;
  const allowed = new Set([...ENVELOPE_KEYS, ...BODY_KEYS[type]]);
  for (const k of Object.keys(e)) if (!allowed.has(k)) return false;
  const required = BODY_KEYS[type].filter((k) => k !== 'cause');
  for (const k of required) if (!(k in e)) return false;
  if (e.v !== TELEMETRY_VERSION) return false;
  if (!matches(e.player, ID_PATTERN) || !matches(e.session, ID_PATTERN)) return false;
  if (e.tester !== undefined && !matches(e.tester, TESTER_PATTERN)) return false;
  if (!matches(e.build, BUILD_PATTERN)) return false;
  if (!isInt(e.t, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (e.dev !== undefined && e.dev !== true) return false;
  return bodyValid(e, type);
}
```

Add the subpath export to `packages/data/package.json`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./telemetry": "./src/telemetry.ts"
  }
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm vitest run packages/data/src/telemetry.test.ts`
Expected: PASS, 23 tests.

Then check that the data package's own registry test does not pin the schema directory:
Run: `pnpm vitest run packages/data/src/index.test.ts && pnpm validate:data`
Expected: both PASS. If `index.test.ts` fails because it enumerates `data/schemas/`, add `telemetry_event.schema.json` to the list it names; do not loosen the test.

- [ ] **Step 6: Record the test-runner deviation in the spec**

In `docs/superpowers/specs/2026-09-24-telemetry-design.md` §3, replace the sentence that begins "Its tests run under `@cloudflare/vitest-pool-workers`" with:

```markdown
Its tests run in the repo's existing node vitest project against a `node:sqlite`
adapter shaped like D1 (D1 is SQLite, so the real migrations and queries run);
the Workers runtime itself is exercised by `wrangler dev` and the deployed check.
```

- [ ] **Step 7: Commit**

```bash
/usr/bin/git commit -s -m "feat(data): telemetry event contract and guard (WP-T1)" -- data/schemas/telemetry_event.schema.json packages/data/src/telemetry.ts packages/data/src/telemetry.test.ts packages/data/package.json docs/superpowers/specs/2026-09-24-telemetry-design.md
```

---

### Task 2: `defeatCause` on `MissionRuntime`

**Files:**
- Modify: `packages/sim/src/mission.ts` (beside `get stars()` near L709; `checkEnd` near L1849 is read, not changed)
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Produces: `export type DefeatCause = 'force_destroyed' | 'roe_collapse' | { objective: string };` and `get defeatCause(): DefeatCause | undefined` on `MissionRuntime`.

This is a **pure read**: it recomputes from state that `checkEnd` has already frozen (`this.ended` stops further change), and writes nothing. Precedence matches the order `checkEnd` tests: wipe, then ROE, then the first failed primary in authored order.

- [ ] **Step 1: Write the failing tests**

Add to `packages/sim/src/mission.test.ts`. Build each runtime with the helpers that file already uses for its existing `checkEnd` tests: search it for `'evacuate_before'` and `roe.fail_below` to find a failed-primary fixture and an ROE-collapse fixture, and copy their setup. The assertions are:

```ts
describe('defeatCause', () => {
  it('is undefined while the mission is ongoing', () => {
    const rt = ongoingRuntime(); // any fixture before its first missionEnd
    expect(rt.result).toBe('ongoing');
    expect(rt.defeatCause).toBeUndefined();
  });

  it('is undefined after a victory', () => {
    const rt = wonRuntime(); // the file's existing all-primaries-complete fixture
    expect(rt.result).toBe('victory');
    expect(rt.defeatCause).toBeUndefined();
  });

  it('names the failed primary objective', () => {
    const rt = failedEvacuationRuntime(); // existing evacuate_before deadline fixture
    expect(rt.result).toBe('defeat');
    expect(rt.defeatCause).toEqual({ objective: '<the fixture objective id>' });
  });

  it('reports an ROE collapse', () => {
    const rt = roeCollapsedRuntime(); // existing fail_below fixture
    expect(rt.result).toBe('defeat');
    expect(rt.defeatCause).toBe('roe_collapse');
  });

  it('reports a wiped force ahead of anything else', () => {
    const rt = wipedRuntime(); // kill every player unit with sim.debugKill, then step
    expect(rt.result).toBe('defeat');
    expect(rt.defeatCause).toBe('force_destroyed');
  });
});
```

The four helper names are local functions you write at the top of this `describe`, each returning the runtime after stepping it to the stated state, copying the setup from the existing test named in its comment. Replace `<the fixture objective id>` with that fixture's actual objective id literal.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run packages/sim/src/mission.test.ts -t defeatCause`
Expected: FAIL. `defeatCause` does not exist on the type.

- [ ] **Step 3: Implement the getter**

In `packages/sim/src/mission.ts`, beside `MissionEvent`'s exports:

```ts
/** Why a mission was lost, for the app's telemetry. Read-only: computed from
 *  the state `checkEnd` froze, in the order `checkEnd` tests it. */
export type DefeatCause = 'force_destroyed' | 'roe_collapse' | { objective: string };
```

In `MissionRuntime`, after `get stars()`:

```ts
  /** Why this mission was lost; undefined unless `result` is 'defeat'.
   *  A pure read -- writes nothing, so it cannot move the golden hash. */
  get defeatCause(): DefeatCause | undefined {
    if (this.resultValue !== 'defeat') return undefined;
    const wiped =
      this.playerIds.length > 0 && this.playerIds.every((id) => this.sim.state.alive[id] === 0);
    if (wiped) return 'force_destroyed';
    if (this.roeFailed) return 'roe_collapse';
    const failed = this.objectives.find((o) => o.def.primary && o.status === 'failed');
    return failed ? { objective: failed.def.id } : undefined;
  }
```

If the private field holding the result is not named `resultValue` on your base, use whatever `get result()` returns. If objective definitions keep their id somewhere other than `o.def.id`, use the field `objectiveList` maps to `id`.

- [ ] **Step 4: Run the tests, the determinism canary and the lint**

Run: `pnpm vitest run packages/sim/src/mission.test.ts && pnpm test:determinism && pnpm lint`
Expected: all PASS, and `determinism.test.ts`'s golden hash unchanged (do not edit it).

- [ ] **Step 5: Get a sim-guard review**

Dispatch the `sim-guard` agent on the diff with: "Read-only getter added to MissionRuntime for app telemetry; confirm it writes no state, uses no float or Math/Date, and cannot move the golden hash." Apply anything it finds before committing.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git commit -s -m "feat(sim): read-only MissionRuntime.defeatCause for telemetry (WP-T1)" -- packages/sim/src/mission.ts packages/sim/src/mission.test.ts
```

---

### Task 3: Keep the service worker off `/api/` and `/stats`

**Files:**
- Modify: `assets/sw.js` (`strategyFor`, ~L77)
- Test: `packages/app/src/sw-policy.test.ts`

A navigation to `/stats` currently hits `request.mode === 'navigate'` → `'network-first'`, which stores the dashboard (or a Cloudflare Access redirect) in the cache.

- [ ] **Step 1: Write the failing test**

Add inside the existing per-deployment `describe` in `sw-policy.test.ts`, using its `at(...)`, `GET` and `NAVIGATE` helpers:

```ts
    it('never touches the telemetry endpoint or the stats dashboard', () => {
      for (const path of ['stats', 'stats/', 'stats/api/summary', 'api/events']) {
        expect(strategyFor(at(path), GET), path).toBe('passthrough');
        expect(strategyFor(at(path), NAVIGATE), path).toBe('passthrough');
      }
      expect(strategyFor(at('api/events'), { ...GET, method: 'POST' })).toBe('passthrough');
      // A lookalike path is still an ordinary document.
      expect(strategyFor(at('statsheet'), NAVIGATE)).toBe('network-first');
    });
```

- [ ] **Step 2: Run it and confirm it fails, then record the red**

Run: `pnpm vitest run packages/app/src/sw-policy.test.ts`
Expected: FAIL on `stats` with NAVIGATE (`network-first` received). Paste the failing line into the commit message body as the recorded red.

- [ ] **Step 3: Implement**

In `assets/sw.js`, in `strategyFor`, immediately after `const rest = url.pathname.slice(BASE.length);`:

```js
  // The Worker's own routes (WP-T1): the telemetry endpoint and the private
  // dashboard behind Cloudflare Access. A cached /stats is a stale dashboard,
  // or worse a cached Access login redirect.
  if (rest === 'stats' || rest.startsWith('stats/') || rest.startsWith('api/')) return 'passthrough';
```

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run packages/app/src/sw-policy.test.ts && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git commit -s -m "fix(sw): pass /api and /stats through (WP-T1)" -m "Red before the fix: <paste the failing assertion line>" -- assets/sw.js packages/app/src/sw-policy.test.ts
```

---

### Task 4: Identity and the off switch

**Files:**
- Create: `packages/app/src/telemetry/identity.ts`, `identity.test.ts`
- Create: `packages/app/src/telemetry/enabled.ts`, `enabled.test.ts`

**Interfaces:**
- Produces:
  - `interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }`
  - `safeStorage(get: () => unknown): StorageLike | null`
  - `interface Identity { player: string; tester?: string; returning: boolean; optedOut: boolean }`
  - `resolveIdentity(storage: StorageLike | null, query: URLSearchParams, newId: () => string): Identity`
  - `interface SwitchEnv { prod: boolean; hostname: string; query: URLSearchParams; gpc: boolean; dnt: boolean; optedOut: boolean }`
  - `telemetryEnabled(env: SwitchEnv): boolean`

- [ ] **Step 1: Write the failing tests**

`packages/app/src/telemetry/identity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveIdentity, safeStorage, type StorageLike } from './identity';

function memory(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const q = (s = '') => new URLSearchParams(s);

describe('resolveIdentity', () => {
  it('creates and stores a player id on a first visit', () => {
    const s = memory();
    const id = resolveIdentity(s, q(), () => ID);
    expect(id).toEqual({ player: ID, returning: false, optedOut: false });
    expect(s.data['lions.telemetry.player']).toBe(ID);
  });

  it('reuses a stored id and reports a returning player', () => {
    const s = memory({ 'lions.telemetry.player': ID });
    expect(resolveIdentity(s, q(), () => 'other').player).toBe(ID);
    expect(resolveIdentity(s, q(), () => 'other').returning).toBe(true);
  });

  it('replaces a malformed stored id', () => {
    const s = memory({ 'lions.telemetry.player': 'garbage' });
    expect(resolveIdentity(s, q(), () => ID)).toMatchObject({ player: ID, returning: false });
  });

  it('persists a valid ?tester and ignores an invalid one', () => {
    const s = memory();
    expect(resolveIdentity(s, q('tester=dani'), () => ID).tester).toBe('dani');
    expect(resolveIdentity(s, q(), () => ID).tester).toBe('dani');
    const t = memory();
    expect(resolveIdentity(t, q('tester=dani%20cohen'), () => ID).tester).toBeUndefined();
  });

  it('persists ?notrack', () => {
    const s = memory();
    expect(resolveIdentity(s, q('notrack'), () => ID).optedOut).toBe(true);
    expect(resolveIdentity(s, q(), () => ID).optedOut).toBe(true);
  });

  it('works for one session when storage is unavailable', () => {
    expect(resolveIdentity(null, q('tester=dani'), () => ID)).toEqual({
      player: ID, tester: 'dani', returning: false, optedOut: false,
    });
  });
});

describe('safeStorage', () => {
  it('returns null when the accessor throws', () => {
    expect(safeStorage(() => { throw new Error('SecurityError'); })).toBeNull();
  });
  it('returns null for a bare object with no getItem (jsdom on Node 25)', () => {
    expect(safeStorage(() => ({}))).toBeNull();
  });
  it('wraps a real storage so a throwing setItem is swallowed', () => {
    const s = safeStorage(() => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
    expect(s).not.toBeNull();
    expect(() => s?.setItem('a', 'b')).not.toThrow();
  });
});
```

`packages/app/src/telemetry/enabled.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { telemetryEnabled, type SwitchEnv } from './enabled';

const base: SwitchEnv = { prod: true, hostname: 'roaring-lions.example.workers.dev', query: new URLSearchParams(), gpc: false, dnt: false, optedOut: false };

describe('telemetryEnabled', () => {
  it('is on for a production build on a real host', () => expect(telemetryEnabled(base)).toBe(true));
  it('is off in dev', () => expect(telemetryEnabled({ ...base, prod: false })).toBe(false));
  it.each(['localhost', '127.0.0.1', '[::1]', 'mac.local'])('is off on %s even in a prod build', (hostname) =>
    expect(telemetryEnabled({ ...base, hostname })).toBe(false));
  it('?telemetry forces it on in dev', () =>
    expect(telemetryEnabled({ ...base, prod: false, hostname: 'localhost', query: new URLSearchParams('telemetry') })).toBe(true));
  it.each(['gpc', 'dnt', 'optedOut'] as const)('%s wins over everything, including ?telemetry', (k) =>
    expect(telemetryEnabled({ ...base, query: new URLSearchParams('telemetry'), [k]: true })).toBe(false));
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run packages/app/src/telemetry/`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`packages/app/src/telemetry/identity.ts`:

```ts
import { ID_PATTERN, TESTER_PATTERN } from '@lions/data/telemetry';

export const PLAYER_KEY = 'lions.telemetry.player';
export const TESTER_KEY = 'lions.telemetry.tester';
export const OPTOUT_KEY = 'lions.telemetry.optout';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** A storage that cannot throw. `get` is the ACCESS itself (`() => window.localStorage`),
 *  because with site data blocked the property read is what throws, and in this repo's
 *  vitest jsdom on Node 25 it yields a bare `{}`. Null means "no storage": the caller
 *  keeps its ids for the session. */
export function safeStorage(get: () => unknown): StorageLike | null {
  let s: unknown;
  try {
    s = get();
  } catch {
    return null;
  }
  const real = s as Partial<StorageLike> | null;
  if (!real || typeof real.getItem !== 'function' || typeof real.setItem !== 'function') return null;
  return {
    getItem: (k) => {
      try {
        return real.getItem?.(k) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        real.setItem?.(k, v);
      } catch {
        /* quota or blocked: the id lives for this session */
      }
    },
  };
}

export interface Identity {
  player: string;
  tester?: string;
  returning: boolean;
  optedOut: boolean;
}

export function resolveIdentity(storage: StorageLike | null, query: URLSearchParams, newId: () => string): Identity {
  if (query.has('notrack')) storage?.setItem(OPTOUT_KEY, '1');
  const optedOut = query.has('notrack') || storage?.getItem(OPTOUT_KEY) === '1';

  const asked = query.get('tester');
  if (asked !== null && TESTER_PATTERN.test(asked)) storage?.setItem(TESTER_KEY, asked);
  const storedTester = storage?.getItem(TESTER_KEY) ?? null;
  const tester =
    asked !== null && TESTER_PATTERN.test(asked)
      ? asked
      : storedTester !== null && TESTER_PATTERN.test(storedTester)
        ? storedTester
        : undefined;

  const stored = storage?.getItem(PLAYER_KEY) ?? null;
  const returning = stored !== null && ID_PATTERN.test(stored);
  const player = returning ? stored : newId();
  if (!returning) storage?.setItem(PLAYER_KEY, player);

  return tester === undefined ? { player, returning, optedOut } : { player, tester, returning, optedOut };
}
```

`packages/app/src/telemetry/enabled.ts`:

```ts
export interface SwitchEnv {
  prod: boolean;
  hostname: string;
  query: URLSearchParams;
  /** `navigator.globalPrivacyControl === true` */
  gpc: boolean;
  /** `navigator.doNotTrack === '1'` */
  dnt: boolean;
  optedOut: boolean;
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local)$/;

/** The off switch (spec §2). Airtight on purpose: `pnpm ui:routes` fails on any
 *  console error, and a request to a missing /api/events on the Vite dev server
 *  is one. A privacy signal beats even `?telemetry`. */
export function telemetryEnabled(env: SwitchEnv): boolean {
  if (env.optedOut || env.gpc || env.dnt) return false;
  if (env.query.has('telemetry')) return true;
  return env.prod && !LOCAL.test(env.hostname);
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `pnpm vitest run packages/app/src/telemetry/ && pnpm typecheck && pnpm lint`
Expected: PASS. If lint rejects the `@lions/data/telemetry` subpath in `packages/app`, check the app's `no-restricted-imports` block in `eslint.config.mjs`: `@lions/data` is an allowed dependency of `app`, so extend that entry to cover the subpath rather than adding a disable comment.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git commit -s -m "feat(app): telemetry identity and off switch (WP-T1)" -- packages/app/src/telemetry/identity.ts packages/app/src/telemetry/identity.test.ts packages/app/src/telemetry/enabled.ts packages/app/src/telemetry/enabled.test.ts
```

---

### Task 5: Event builders

**Files:**
- Create: `packages/app/src/telemetry/events.ts`, `events.test.ts`

**Interfaces:**
- Consumes: `TelemetryEnvelope`, `TelemetryEvent`, `TelemetryScreen`, `isTelemetryEvent` (Task 1); `DefeatCause` (Task 2).
- Produces:
  - `interface RuntimeView { tick: number; result: 'ongoing' | 'victory' | 'defeat'; defeatCause: DefeatCause | undefined; roe: number; fielded: number; lost: number; objectives: readonly { id: string; type: string; primary: boolean; status: 'active' | 'complete' | 'failed' }[] }`
  - `causeString(c: DefeatCause | undefined): string | undefined`
  - `screenFor(pathname: string, base: string, tutorialId: string): TelemetryScreen`
  - `sessionStart(env, screen, renderer, viewport, returning): TelemetryEvent`
  - `heartbeat(env, mission, tick)`, `tutorialStep(env, step, steps, prevMs)`, `missionStart(env, mission, replay)`
  - `objectiveEvent(env, mission, view, objectiveId, status, tick): TelemetryEvent | null`
  - `missionEnd(env, mission, view, abandoned: boolean): TelemetryEvent`
  - `campaignProgress(env, mission, missionsWon)`

- [ ] **Step 1: Write the failing tests**

`packages/app/src/telemetry/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isTelemetryEvent, type TelemetryEnvelope } from '@lions/data/telemetry';
import * as ev from './events';

const env: TelemetryEnvelope = {
  v: 1, player: '0f8fad5b-d9cb-469f-a165-70867728950e', session: '7c9e6679-7425-40de-944b-e07fc1f90ae7', build: '0.78.0', t: 1,
};
const view = (over: Partial<ev.RuntimeView> = {}): ev.RuntimeView => ({
  tick: 6000, result: 'ongoing', defeatCause: undefined, roe: 93.6, fielded: 12, lost: 2,
  objectives: [
    { id: 'hold_gate', type: 'hold_for', primary: true, status: 'complete' },
    { id: 'evac', type: 'evacuate_before', primary: false, status: 'active' },
  ],
  ...over,
});

describe('event builders', () => {
  it('every builder produces an event the contract accepts', () => {
    const all = [
      ev.sessionStart(env, 'menu', 'three', [1440.6, 900.2], false),
      ev.heartbeat(env, 'beit_sahwan_breach', 1200),
      ev.tutorialStep(env, 3, 14, 8123.7),
      ev.missionStart(env, 'beit_sahwan_breach', true),
      ev.objectiveEvent(env, 'beit_sahwan_breach', view(), 'hold_gate', 'complete', 4000),
      ev.missionEnd(env, 'beit_sahwan_breach', view({ result: 'victory' }), false),
      ev.missionEnd(env, 'beit_sahwan_breach', view({ result: 'defeat', defeatCause: { objective: 'evac' } }), false),
      ev.missionEnd(env, 'beit_sahwan_breach', view(), true),
      ev.campaignProgress(env, 'beit_sahwan_breach', 1),
    ];
    for (const e of all) expect(isTelemetryEvent(e), JSON.stringify(e)).toBe(true);
  });

  it('rounds non-integers the contract requires as integers', () => {
    const e = ev.missionEnd(env, 'm', view({ result: 'victory' }), false);
    expect(e).toMatchObject({ roe: 94, objectivesDone: 1, objectivesTotal: 2 });
  });

  it('marks a mission still running at teardown as abandoned, with no cause', () => {
    const e = ev.missionEnd(env, 'm', view(), true);
    expect(e).toMatchObject({ result: 'abandoned' });
    expect('cause' in e).toBe(false);
  });

  it('flattens a defeat cause', () => {
    expect(ev.causeString('force_destroyed')).toBe('force_destroyed');
    expect(ev.causeString({ objective: 'evac' })).toBe('objective:evac');
    expect(ev.causeString(undefined)).toBeUndefined();
  });

  it('returns null for an objective the runtime does not list', () => {
    expect(ev.objectiveEvent(env, 'm', view(), 'nope', 'failed', 1)).toBeNull();
  });

  it('classifies screens from the router path', () => {
    const s = (p: string) => ev.screenFor(p, '/', 'beit_sahwan_0_tutorial');
    expect(s('/')).toBe('menu');
    expect(s('/campaign')).toBe('campaign');
    expect(s('/brigade')).toBe('brigade');
    expect(s('/mission/beit_sahwan_breach')).toBe('mission');
    expect(s('/mission/beit_sahwan_0_tutorial')).toBe('tutorial');
    expect(s('/free-play')).toBe('sandbox');
    expect(s('/free-play/tel_marum')).toBe('sandbox');
    expect(s('/settings')).toBe('other');
    expect(ev.screenFor('/roaring-lions/campaign', '/roaring-lions/', 'x')).toBe('campaign');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run packages/app/src/telemetry/events.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/app/src/telemetry/events.ts`:

```ts
import type { TelemetryEnvelope, TelemetryEvent, TelemetryScreen } from '@lions/data/telemetry';
import type { DefeatCause } from '@lions/sim';

/** What the builders read from a live mission. Built by the caller from
 *  `MissionRuntime` and `sim.tickCount` -- a read, never a write (invariant 4). */
export interface RuntimeView {
  tick: number;
  result: 'ongoing' | 'victory' | 'defeat';
  defeatCause: DefeatCause | undefined;
  roe: number;
  fielded: number;
  lost: number;
  objectives: readonly { id: string; type: string; primary: boolean; status: 'active' | 'complete' | 'failed' }[];
}

const int = (n: number): number => Math.max(0, Math.round(n));

export function causeString(c: DefeatCause | undefined): string | undefined {
  if (c === undefined) return undefined;
  return typeof c === 'string' ? c : `objective:${c.objective}`;
}

export function screenFor(pathname: string, base: string, tutorialId: string): TelemetryScreen {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  const [head, id] = rest.split('/');
  switch (head) {
    case '':
      return 'menu';
    case 'campaign':
      return 'campaign';
    case 'brigade':
      return 'brigade';
    case 'free-play':
      return 'sandbox';
    case 'mission':
      return id === tutorialId ? 'tutorial' : 'mission';
    default:
      return 'other';
  }
}

export const sessionStart = (
  env: TelemetryEnvelope,
  screen: TelemetryScreen,
  renderer: 'three' | 'pixi',
  viewport: [number, number],
  returning: boolean
): TelemetryEvent => ({ ...env, type: 'session_start', screen, renderer, viewport: [int(viewport[0]), int(viewport[1])], returning });

export const heartbeat = (env: TelemetryEnvelope, mission: string, tick: number): TelemetryEvent => ({
  ...env, type: 'heartbeat', mission, tick: int(tick),
});

export const tutorialStep = (env: TelemetryEnvelope, step: number, steps: number, prevMs: number): TelemetryEvent => ({
  ...env, type: 'tutorial_step', step: int(step), steps: int(steps), prevMs: int(prevMs),
});

export const missionStart = (env: TelemetryEnvelope, mission: string, replay: boolean): TelemetryEvent => ({
  ...env, type: 'mission_start', mission, replay,
});

export function objectiveEvent(
  env: TelemetryEnvelope,
  mission: string,
  view: RuntimeView,
  objectiveId: string,
  status: 'complete' | 'failed',
  tick: number
): TelemetryEvent | null {
  const o = view.objectives.find((x) => x.id === objectiveId);
  if (!o) return null;
  return { ...env, type: 'objective', mission, objective: o.id, objectiveType: o.type, primary: o.primary, status, tick: int(tick) };
}

export function missionEnd(env: TelemetryEnvelope, mission: string, view: RuntimeView, abandoned: boolean): TelemetryEvent {
  const result = abandoned || view.result === 'ongoing' ? 'abandoned' : view.result;
  const cause = result === 'defeat' ? causeString(view.defeatCause) : undefined;
  return {
    ...env,
    type: 'mission_end',
    mission,
    result,
    ...(cause === undefined ? {} : { cause }),
    tick: int(view.tick),
    roe: Math.min(100, int(view.roe)),
    fielded: int(view.fielded),
    lost: int(view.lost),
    objectivesDone: view.objectives.filter((o) => o.status === 'complete').length,
    objectivesTotal: view.objectives.length,
  };
}

export const campaignProgress = (env: TelemetryEnvelope, mission: string, missionsWon: number): TelemetryEvent => ({
  ...env, type: 'campaign_progress', mission, missionsWon: int(missionsWon),
});
```

`DefeatCause` must be exported from `@lions/sim`'s entry point. If `packages/sim/src/index.ts` re-exports `mission.ts` selectively, add `DefeatCause` to that export list.

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run packages/app/src/telemetry/ && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git commit -s -m "feat(app): telemetry event builders (WP-T1)" -- packages/app/src/telemetry/events.ts packages/app/src/telemetry/events.test.ts packages/sim/src/index.ts
```

(Leave `packages/sim/src/index.ts` out of the path list if it did not change.)

---

### Task 6: The sender

**Files:**
- Create: `packages/app/src/telemetry/sender.ts`, `sender.test.ts`

**Interfaces:**
- Consumes: `TelemetryEvent` (Task 1).
- Produces:
  - `interface Transport { post(body: string): void; beacon(body: string): boolean }`
  - `class Sender { constructor(t: Transport, maxBatch = 50, maxQueue = 500); push(e: TelemetryEvent): void; flush(useBeacon?: boolean): void; readonly pending: number }`
  - `browserTransport(url: string): Transport`

- [ ] **Step 1: Write the failing test**

`packages/app/src/telemetry/sender.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TelemetryEvent } from '@lions/data/telemetry';
import { Sender, type Transport } from './sender';

const e = (tick: number): TelemetryEvent => ({
  v: 1, player: '0f8fad5b-d9cb-469f-a165-70867728950e', session: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  build: '0.78.0', t: 1, type: 'heartbeat', mission: 'm', tick,
});
function fake(beaconOk = true) {
  const posts: string[] = [];
  const beacons: string[] = [];
  const t: Transport = { post: (b) => void posts.push(b), beacon: (b) => { beacons.push(b); return beaconOk; } };
  return { t, posts, beacons };
}

describe('Sender', () => {
  it('sends nothing until flushed', () => {
    const f = fake();
    const s = new Sender(f.t);
    s.push(e(1));
    expect(f.posts).toEqual([]);
    expect(s.pending).toBe(1);
  });

  it('flushes in batches of at most maxBatch as {events: [...]}', () => {
    const f = fake();
    const s = new Sender(f.t, 2);
    [1, 2, 3].forEach((n) => s.push(e(n)));
    s.flush();
    expect(f.posts.map((b) => (JSON.parse(b) as { events: unknown[] }).events.length)).toEqual([2, 1]);
    expect(s.pending).toBe(0);
  });

  it('uses the beacon when asked, and falls back to post if the beacon refuses', () => {
    const ok = fake(true);
    const a = new Sender(ok.t);
    a.push(e(1));
    a.flush(true);
    expect(ok.beacons).toHaveLength(1);
    expect(ok.posts).toHaveLength(0);

    const no = fake(false);
    const b = new Sender(no.t);
    b.push(e(1));
    b.flush(true);
    expect(no.posts).toHaveLength(1);
  });

  it('drops the oldest events past maxQueue rather than growing without bound', () => {
    const f = fake();
    const s = new Sender(f.t, 50, 3);
    [1, 2, 3, 4].forEach((n) => s.push(e(n)));
    expect(s.pending).toBe(3);
    s.flush();
    expect((JSON.parse(f.posts[0]) as { events: { tick: number }[] }).events.map((x) => x.tick)).toEqual([2, 3, 4]);
  });

  it('never throws out of flush, even if the transport does', () => {
    const s = new Sender({ post: () => { throw new Error('offline'); }, beacon: () => { throw new Error('x'); } });
    s.push(e(1));
    expect(() => s.flush()).not.toThrow();
    expect(() => s.flush(true)).not.toThrow();
    expect(s.pending).toBe(0); // dropped, never retried in a loop
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run packages/app/src/telemetry/sender.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/app/src/telemetry/sender.ts`:

```ts
import type { TelemetryEvent } from '@lions/data/telemetry';

export interface Transport {
  /** Fire-and-forget POST. Must not throw and must not be awaited by the caller. */
  post(body: string): void;
  /** `navigator.sendBeacon`; false when the browser refused to queue it. */
  beacon(body: string): boolean;
}

/** An in-memory queue flushed in batches. A failed batch is dropped, never
 *  retried in a loop: telemetry must never cost the game anything (spec §2). */
export class Sender {
  private queue: TelemetryEvent[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly maxBatch = 50,
    private readonly maxQueue = 500
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  push(e: TelemetryEvent): void {
    this.queue.push(e);
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
  }

  flush(useBeacon = false): void {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.maxBatch);
      const body = JSON.stringify({ events: batch });
      try {
        if (useBeacon && this.transport.beacon(body)) continue;
        this.transport.post(body);
      } catch {
        /* dropped: see the class comment */
      }
    }
  }
}

export function browserTransport(url: string): Transport {
  return {
    post: (body) => {
      void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(
        () => undefined
      );
    },
    beacon: (body) => navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })),
  };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run packages/app/src/telemetry/ && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git commit -s -m "feat(app): telemetry batching sender (WP-T1)" -- packages/app/src/telemetry/sender.ts packages/app/src/telemetry/sender.test.ts
```

---

### Task 7: The facade and the per-mission tracker

**Files:**
- Create: `packages/app/src/telemetry/index.ts`, `index.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces (what `main.ts` calls in Task 8):
  - `interface Telemetry { sessionStart(screen: TelemetryScreen, renderer: 'three' | 'pixi'): void; tutorialStep(step: number, steps: number): void; missionStarted(mission: string, replay: boolean, view: () => RuntimeView): MissionTelemetry; campaignProgress(mission: string, missionsWon: number): void }`
  - `interface MissionTelemetry { onEvent(me: MissionEvent): void; end(): void }`
  - `createTelemetry(deps: TelemetryDeps): Telemetry` (testable core)
  - `initTelemetry(): Telemetry` (browser wiring, once per document)
  - `telemetry(): Telemetry` (the accessor; a no-op until `initTelemetry` runs)
  - `NOOP_TELEMETRY: Telemetry`

`MissionTelemetry.end()` is the single exit for a mission: teardown calls it, and so does `pagehide`. It sends `mission_end{abandoned}` only if no `mission_end` has gone out yet, clears the heartbeat and detaches. `onEvent` on a `missionEnd` sends the real result and flushes. One guard covers every path, so "victory then leave" sends exactly one `mission_end`.

- [ ] **Step 1: Write the failing test**

`packages/app/src/telemetry/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TelemetryEvent } from '@lions/data/telemetry';
import type { MissionEvent } from '@lions/sim';
import { createTelemetry, NOOP_TELEMETRY, type TelemetryDeps } from './index';
import type { RuntimeView } from './events';

function harness(over: Partial<TelemetryDeps> = {}) {
  const sent: TelemetryEvent[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  let pagehide: (() => void) | undefined;
  let visible = true;
  let now = 1000;
  const deps: TelemetryDeps = {
    identity: { player: '0f8fad5b-d9cb-469f-a165-70867728950e', returning: false, optedOut: false },
    newSession: () => '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    build: '0.78.0',
    dev: false,
    now: () => now,
    viewport: () => [1440, 900],
    visible: () => visible,
    setInterval: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearInterval: (h) => { (h as { cleared: boolean }).cleared = true; },
    onPagehide: (fn) => { pagehide = fn; },
    sink: { push: (e) => void sent.push(e), flush: () => undefined },
    ...over,
  };
  const tel = createTelemetry(deps);
  return {
    tel, sent, timers,
    hide: () => pagehide?.(),
    setVisible: (v: boolean) => { visible = v; },
    advance: (ms: number) => { now += ms; },
  };
}

let state: RuntimeView;
const view = () => state;
const reset = () => {
  state = { tick: 0, result: 'ongoing', defeatCause: undefined, roe: 100, fielded: 5, lost: 0,
    objectives: [{ id: 'hold', type: 'hold_for', primary: true, status: 'active' }] };
};
const endEvent = (result: 'victory' | 'defeat'): MissionEvent =>
  ({ kind: 'missionEnd', tick: 100, result, roeRating: 90, survivors: [], ledger: {} }) as MissionEvent;

describe('Telemetry', () => {
  it('sends session_start with the envelope', () => {
    const h = harness();
    h.tel.sessionStart('menu', 'three');
    expect(h.sent[0]).toMatchObject({ type: 'session_start', screen: 'menu', renderer: 'three', v: 1, build: '0.78.0', t: 1000 });
  });

  it('victory then teardown sends exactly one mission_end, the victory', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    state = { ...state, result: 'victory', tick: 100 };
    m.onEvent(endEvent('victory'));
    m.end();
    h.hide();
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ result: 'victory' });
  });

  it('a soft leave mid-mission sends one abandoned', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    state = { ...state, tick: 500 };
    m.end();
    m.end();
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends).toEqual([expect.objectContaining({ result: 'abandoned', tick: 500 })]);
  });

  it('a closed tab mid-mission sends abandoned through pagehide', () => {
    reset();
    const h = harness();
    h.tel.missionStarted('m1', false, view);
    h.hide();
    expect(h.sent.filter((e) => e.type === 'mission_end')).toEqual([expect.objectContaining({ result: 'abandoned' })]);
  });

  it('heartbeats every 60 s only while visible, and stops at end()', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    const hb = h.timers.find((t) => t.ms === 60_000);
    expect(hb).toBeDefined();
    hb?.fn();
    h.setVisible(false);
    hb?.fn();
    expect(h.sent.filter((e) => e.type === 'heartbeat')).toHaveLength(1);
    m.end();
    expect(hb?.cleared).toBe(true);
  });

  it('turns objective events into objective telemetry', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    m.onEvent({ kind: 'objective', tick: 40, id: 'hold', status: 'complete' } as MissionEvent);
    m.onEvent({ kind: 'objective', tick: 41, id: 'hold', status: 'active' } as MissionEvent);
    expect(h.sent.filter((e) => e.type === 'objective')).toEqual([
      expect.objectContaining({ objective: 'hold', objectiveType: 'hold_for', status: 'complete', tick: 40 }),
    ]);
  });

  it('times tutorial steps from the previous one', () => {
    const h = harness();
    h.tel.tutorialStep(0, 14);
    h.advance(5000);
    h.tel.tutorialStep(1, 14);
    expect(h.sent.map((e) => (e.type === 'tutorial_step' ? e.prevMs : -1))).toEqual([0, 5000]);
  });

  it('marks dev traffic', () => {
    const h = harness({ dev: true });
    h.tel.sessionStart('sandbox', 'three');
    expect(h.sent[0]).toMatchObject({ dev: true });
  });

  it('the no-op never throws', () => {
    expect(() => {
      NOOP_TELEMETRY.sessionStart('menu', 'three');
      const m = NOOP_TELEMETRY.missionStarted('m', false, () => { throw new Error('never read'); });
      m.onEvent(endEvent('victory'));
      m.end();
      NOOP_TELEMETRY.tutorialStep(0, 1);
      NOOP_TELEMETRY.campaignProgress('m', 1);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run packages/app/src/telemetry/index.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/app/src/telemetry/index.ts`:

```ts
/**
 * Player telemetry (WP-T1). Spec: docs/superpowers/specs/2026-09-24-telemetry-design.md.
 *
 * Listens; never acts. Every entry point is wrapped so a failure is silent, and
 * nothing here is awaited by the game. When the off switch says no, callers get
 * NOOP_TELEMETRY and nothing is built, stored or sent.
 */
import type { TelemetryEnvelope, TelemetryEvent, TelemetryScreen } from '@lions/data/telemetry';
import type { MissionEvent } from '@lions/sim';
import * as ev from './events';
import type { RuntimeView } from './events';
import { resolveIdentity, safeStorage, type Identity } from './identity';
import { telemetryEnabled } from './enabled';
import { Sender, browserTransport } from './sender';

export type { RuntimeView } from './events';

export interface MissionTelemetry {
  onEvent(me: MissionEvent): void;
  /** The one exit: teardown and pagehide both call it; idempotent. */
  end(): void;
}

export interface Telemetry {
  sessionStart(screen: TelemetryScreen, renderer: 'three' | 'pixi'): void;
  tutorialStep(step: number, steps: number): void;
  missionStarted(mission: string, replay: boolean, view: () => RuntimeView): MissionTelemetry;
  campaignProgress(mission: string, missionsWon: number): void;
}

const NOOP_MISSION: MissionTelemetry = { onEvent: () => undefined, end: () => undefined };
export const NOOP_TELEMETRY: Telemetry = {
  sessionStart: () => undefined,
  tutorialStep: () => undefined,
  missionStarted: () => NOOP_MISSION,
  campaignProgress: () => undefined,
};

export interface TelemetryDeps {
  identity: Identity;
  newSession: () => string;
  build: string;
  dev: boolean;
  now: () => number;
  viewport: () => [number, number];
  visible: () => boolean;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  onPagehide: (fn: () => void) => void;
  sink: { push(e: TelemetryEvent): void; flush(useBeacon?: boolean): void };
}

const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 30_000;

const safe =
  <A extends unknown[]>(f: (...a: A) => void) =>
  (...a: A): void => {
    try {
      f(...a);
    } catch {
      /* telemetry never breaks the game */
    }
  };

export function createTelemetry(d: TelemetryDeps): Telemetry {
  const session = d.newSession();
  const envelope = (): TelemetryEnvelope => ({
    v: 1,
    player: d.identity.player,
    session,
    ...(d.identity.tester === undefined ? {} : { tester: d.identity.tester }),
    build: d.build,
    t: d.now(),
    ...(d.dev ? { dev: true as const } : {}),
  });
  let current: MissionTelemetry | null = null;
  let lastStepAt: number | null = null;

  d.onPagehide(
    safe(() => {
      current?.end();
      d.sink.flush(true);
    })
  );

  return {
    sessionStart: safe((screen, renderer) => {
      d.sink.push(ev.sessionStart(envelope(), screen, renderer, d.viewport(), d.identity.returning));
    }),
    tutorialStep: safe((step, steps) => {
      const now = d.now();
      d.sink.push(ev.tutorialStep(envelope(), step, steps, lastStepAt === null ? 0 : now - lastStepAt));
      lastStepAt = now;
    }),
    campaignProgress: safe((mission, missionsWon) => {
      d.sink.push(ev.campaignProgress(envelope(), mission, missionsWon));
    }),
    missionStarted: (mission, replay, view) => {
      try {
        current?.end();
        let ended = false;
        d.sink.push(ev.missionStart(envelope(), mission, replay));
        const hb = d.setInterval(
          safe(() => {
            if (!ended && d.visible()) d.sink.push(ev.heartbeat(envelope(), mission, view().tick));
          }),
          HEARTBEAT_MS
        );
        const finish = (abandoned: boolean): void => {
          if (ended) return;
          ended = true;
          d.clearInterval(hb);
          d.sink.push(ev.missionEnd(envelope(), mission, view(), abandoned));
          d.sink.flush();
        };
        const m: MissionTelemetry = {
          onEvent: safe((me: MissionEvent) => {
            if (me.kind === 'missionEnd') finish(false);
            else if (me.kind === 'objective' && (me.status === 'complete' || me.status === 'failed')) {
              const e = ev.objectiveEvent(envelope(), mission, view(), me.id, me.status, me.tick);
              if (e) d.sink.push(e);
            }
          }),
          end: safe(() => {
            finish(true);
            if (current === m) current = null;
          }),
        };
        current = m;
        return m;
      } catch {
        return NOOP_MISSION;
      }
    },
  };
}

let instance: Telemetry = NOOP_TELEMETRY;

/** The accessor every hook uses. NOOP until `initTelemetry()` runs. */
export function telemetry(): Telemetry {
  return instance;
}

/** Browser wiring, once per document, from `main()`. */
export function initTelemetry(opts: { dev: boolean }): Telemetry {
  try {
    const query = new URLSearchParams(location.search);
    const storage = safeStorage(() => window.localStorage);
    const identity = resolveIdentity(storage, query, () => crypto.randomUUID());
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    const on = telemetryEnabled({
      prod: import.meta.env.PROD,
      hostname: location.hostname,
      query,
      gpc: nav.globalPrivacyControl === true,
      dnt: nav.doNotTrack === '1',
      optedOut: identity.optedOut,
    });
    if (!on) return (instance = NOOP_TELEMETRY);
    const sender = new Sender(browserTransport(new URL('api/events', location.origin + import.meta.env.BASE_URL).href));
    window.setInterval(() => sender.flush(), FLUSH_MS);
    instance = createTelemetry({
      identity,
      newSession: () => crypto.randomUUID(),
      build: __APP_BUILD__,
      dev: opts.dev,
      now: () => Date.now(),
      viewport: () => [window.innerWidth, window.innerHeight],
      visible: () => document.visibilityState === 'visible',
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (h) => window.clearInterval(h as number),
      onPagehide: (fn) => window.addEventListener('pagehide', fn),
      sink: sender,
    });
    return instance;
  } catch {
    return (instance = NOOP_TELEMETRY);
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run packages/app/src/telemetry/ && pnpm typecheck && pnpm lint`
Expected: PASS. If `validate:ui` or lint objects to `Date.now()` in `packages/app`, it should not: the `Date` ban is sim-only.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git commit -s -m "feat(app): telemetry facade and per-mission tracker (WP-T1)" -- packages/app/src/telemetry/index.ts packages/app/src/telemetry/index.test.ts
```

---

### Task 8: Hook the game

**Files:**
- Modify: `packages/app/src/main.ts` (five sites; line numbers are from `origin/main` at `2d92cbad` and **will have moved after #219**, so find each site by the anchor text quoted)

**Interfaces:**
- Consumes: `initTelemetry`, `telemetry`, `RuntimeView` (Task 7); `screenFor` (Task 5).

Each hook is one statement, or two where a variable is needed. Nothing is awaited.

- [ ] **Step 1: Import**

With the other local imports near `import { startMission } from './mission-start';`:

```ts
import { initTelemetry, telemetry, type MissionTelemetry, type RuntimeView } from './telemetry';
import { screenFor } from './telemetry/events';
```

- [ ] **Step 2: Session start, once per document**

In `main()`, immediately before `await router.start(`:

```ts
  const telemetryScreen = screenFor(location.pathname, BASE, 'beit_sahwan_0_tutorial');
  initTelemetry({ dev: telemetryScreen === 'sandbox' }).sessionStart(
    telemetryScreen,
    resolveRendererChoice(new URLSearchParams(location.search).get('renderer'), safeStorage(() => window.localStorage)?.getItem(RENDERER_STORAGE_KEY) ?? null).choice
  );
```

Import `resolveRendererChoice` and `RENDERER_STORAGE_KEY` from `./renderer-choice` and `safeStorage` from `./telemetry/identity` if they are not already imported. Use the same tutorial-id literal `main.ts` already uses at `id: 'beit_sahwan_0_tutorial'`; if the file has a named constant for it, use that.

- [ ] **Step 3: Mission start + the teardown exit**

Inside `bootBattlefield`, directly after the statement `runtime = startMission(sim, resolvedMission, { ... });` (inside its `try`):

```ts
      const missionTel: MissionTelemetry = telemetry().missionStarted(
        resolvedMission.id,
        (ledger['campaign.mission_results'] ?? {})[resolvedMission.id] !== undefined,
        (): RuntimeView => ({
          tick: sim.tickCount,
          result: runtime?.result ?? 'ongoing',
          defeatCause: runtime?.defeatCause,
          roe: runtime?.roeScore ?? 0,
          fielded: runtime?.fieldedCount ?? 0,
          lost: Object.values(runtime?.lostByType() ?? {}).reduce((a, b) => a + b, 0),
          objectives: runtime?.objectiveList ?? [],
        })
      );
      onDispose(() => missionTel.end());
      missionTelemetry = missionTel;
```

Declare, next to `let runtime` in the same function:

```ts
  let missionTelemetry: MissionTelemetry | null = null;
```

`onDispose` is the disposer contract (#219): registered where the thing is created, idempotent (`end()` is guarded), and run by the teardown for every soft exit: the HUD leave button, the pause-menu Quit, Restart, and a route change.

- [ ] **Step 4: Mission events**

In `runTick`'s `for (const me of missionEvents) {` loop, as its first statement:

```ts
        missionTelemetry?.onEvent(me);
```

- [ ] **Step 5: Campaign progress**

In the same loop's `if (me.kind === 'missionEnd') {` branch, directly after `const updatedLedger: CampaignLedger = ...;`:

```ts
          if (me.result === 'victory')
            telemetry().campaignProgress(mission.id, Object.keys(updatedLedger['campaign.mission_results'] ?? {}).length);
```

- [ ] **Step 6: Tutorial steps**

Declare beside `let tut`: `let telemetryTutIndex = -1;`. At the end of `runTick` (after the mission-event loop), add:

```ts
    if (tut && tut.index !== telemetryTutIndex) {
      telemetryTutIndex = tut.index;
      if (tut.index < tut.steps.length) telemetry().tutorialStep(tut.index, tut.steps.length);
    }
```

This one site catches every one of `advance`'s four callers (intent, mission event, tick, hover), because each changes `tut.index` and the next tick reads it. The step count comes from the tutorial data, never a literal.

- [ ] **Step 7: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm validate:ui`
Expected: all PASS.

- [ ] **Step 8: Verify the off switch in the real app**

Start the dev server on a free port ≥ 5210 (`pnpm --filter @lions/app dev -- --port 5210 --strictPort`) with `preview_start` or a `.claude/launch.json` entry. Open `/mission/beit_sahwan_breach`, click deploy, play 10 s, and leave through the HUD. Then check:
- `read_network_requests` with `urlPattern: "api/events"` returns **nothing**;
- `read_console_messages` with `onlyErrors: true` is empty.

- [ ] **Step 9: Verify it sends with `?telemetry`**

Load `/mission/beit_sahwan_breach?telemetry&tester=ilan`, deploy, then leave through the HUD. `read_network_requests` with `urlPattern: "api/events"` shows POSTs (404 on Vite is expected here). Open a request body and confirm it holds a `session_start`, a `mission_start` and **exactly one** `mission_end` with `"result":"abandoned"`. Drive this through the UI (the deploy button and the leave button), not console shortcuts.

- [ ] **Step 10: Run the CI gates this touches**

Run: `pnpm ui:routes`
Expected: PASS with zero console errors. (It boots the dev server without `?telemetry`, which is exactly the case the off switch exists for.)

- [ ] **Step 11: Commit**

```bash
/usr/bin/git commit -s -m "feat(app): hook telemetry into boot, missions and the tutorial (WP-T1)" -- packages/app/src/main.ts
```

---

### Task 9: The Worker: ingest, D1 schema, config

**Files:**
- Create: `packages/worker/package.json`, `packages/worker/tsconfig.json`
- Create: `packages/worker/migrations/0001_init.sql`
- Create: `packages/worker/src/d1.ts`, `src/ingest.ts`, `src/index.ts`
- Create: `packages/worker/src/test-d1.ts` (test-only `node:sqlite` adapter)
- Create: `packages/worker/src/ingest.test.ts`
- Create: `wrangler.jsonc` (repo root)
- Modify: `eslint.config.mjs` (a block for `packages/worker/**`)

**Interfaces:**
- Consumes: `isTelemetryEvent`, `TelemetryEvent` (`@lions/data/telemetry`).
- Produces:
  - `interface D1Stmt { bind(...v: unknown[]): D1Stmt; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> }`
  - `interface D1Like { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown[]> }`
  - `interface RateLimiter { limit(o: { key: string }): Promise<{ success: boolean }> }`
  - `interface Env { DB: D1Like; ASSETS: { fetch(r: Request): Promise<Response> }; INGEST_LIMIT?: RateLimiter; ALLOWED_ORIGINS?: string }`
  - `handleIngest(req: Request, env: Env, now: number): Promise<Response>`
  - `openTestD1(): D1Like` (tests only; applies every migration)

- [ ] **Step 1: Scaffold the package**

`packages/worker/package.json`:

```json
{
  "name": "@lions/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "The Cloudflare Worker in front of the game: static assets, POST /api/events into D1, and the /stats dashboard behind Cloudflare Access (WP-T1). Nothing imports it.",
  "dependencies": {
    "@lions/data": "workspace:*"
  }
}
```

`packages/worker/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts"] }
```

Add wrangler to the root dev dependencies, then install:

Run: `pnpm add -Dw wrangler@^4 && pnpm install`

Root `tsconfig.json` already includes `packages/*/src/**/*.ts`, and root `vitest.config.ts` already includes `packages/*/src/**/*.test.ts`, so `pnpm typecheck` and `pnpm test` reach the worker with no further change. This package defines its own `D1Like` rather than importing `@cloudflare/workers-types`, because those types redeclare `Request`/`Response` and collide with the DOM lib the root typecheck uses.

In `eslint.config.mjs`, beside the `packages/data/src/**/*.ts` block, add:

```js
  {
    files: ['packages/worker/src/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
```

- [ ] **Step 2: Write the migration**

`packages/worker/migrations/0001_init.sql`:

```sql
-- WP-T1 telemetry store. Raw events are kept forever; `players` is an upserted
-- summary so the dashboard's headline numbers are one query.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  player TEXT NOT NULL,
  session TEXT NOT NULL,
  tester TEXT,
  build TEXT NOT NULL,
  mission TEXT,
  t INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  dev INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
CREATE INDEX events_type_t ON events (type, t);
CREATE INDEX events_player ON events (player, t);
CREATE INDEX events_mission ON events (mission, type);
CREATE INDEX events_tester ON events (tester, t);

CREATE TABLE players (
  player TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  seconds_played INTEGER NOT NULL DEFAULT 0,
  missions_won INTEGER NOT NULL DEFAULT 0,
  last_won TEXT,
  tester TEXT,
  dev INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 3: Write the D1 types and the test adapter**

`packages/worker/src/d1.ts`:

```ts
/** The slice of Cloudflare's D1 API this Worker uses. Declared here rather than
 *  imported from @cloudflare/workers-types: those redeclare Request/Response and
 *  collide with the DOM lib the repo's root typecheck runs under. */
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}
export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<unknown[]>;
}
export interface RateLimiter {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}
export interface Env {
  DB: D1Like;
  ASSETS: { fetch(request: Request): Promise<Response> };
  INGEST_LIMIT?: RateLimiter;
  /** Comma-separated extra origins allowed to POST (e.g. a custom domain). */
  ALLOWED_ORIGINS?: string;
}
```

`packages/worker/src/test-d1.ts`:

```ts
/** A D1Like over node:sqlite, for tests only. D1 is SQLite, so the real
 *  migrations and the real queries run here unchanged. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Like, D1Stmt } from './d1';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

export function openTestD1(): D1Like & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(MIGRATIONS + f, 'utf8'));
  }
  const stmt = (sql: string, args: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    run: async () => db.prepare(sql).run(...(args as SQLInputValue[])),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as SQLInputValue[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(args as SQLInputValue[])) as T | undefined) ?? null,
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (ss) => {
      db.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const s of ss) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
```

If `node:sqlite` is missing on the CI runner's Node 22 (it ships unflagged from 22.13), pin `node-version: 22.13` or later in ci.yml in this same task.

- [ ] **Step 4: Write the failing ingest tests**

`packages/worker/src/ingest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleIngest } from './ingest';
import { openTestD1 } from './test-d1';
import type { Env, RateLimiter } from './d1';

const P = '0f8fad5b-d9cb-469f-a165-70867728950e';
const S = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const env0 = { v: 1, player: P, session: S, build: '0.78.0', t: 1_790_000_000_000 };
const hb = (tick: number) => ({ ...env0, type: 'heartbeat', mission: 'm1', tick });
const win = { ...env0, type: 'mission_end', mission: 'm1', result: 'victory', tick: 6000, roe: 90, fielded: 5, lost: 1, objectivesDone: 1, objectivesTotal: 1 };
const progress = { ...env0, type: 'campaign_progress', mission: 'm1', missionsWon: 3 };

function setup(limiter?: RateLimiter) {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('asset') }, INGEST_LIMIT: limiter };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handleIngest(
      new Request('https://game.example.workers.dev/api/events', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { origin: 'https://game.example.workers.dev', 'cf-connecting-ip': '203.0.113.9', ...headers },
      }),
      env,
      1_790_000_001_000
    );
  const count = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n;
  return { db, post, count };
}

describe('POST /api/events', () => {
  it('stores valid events, drops invalid ones, and always answers 204', async () => {
    const h = setup();
    const res = await h.post({ events: [hb(1), { ...hb(2), email: 'x@y.z' }, hb(3)] });
    expect(res.status).toBe(204);
    expect(h.count('SELECT COUNT(*) AS n FROM events')).toBe(2);
  });

  it('upserts the player summary once per request', async () => {
    const h = setup();
    await h.post({ events: [hb(1), hb(2), win, progress] });
    await h.post({ events: [hb(3)] });
    const row = h.db.raw.prepare('SELECT * FROM players').get() as Record<string, unknown>;
    expect(row).toMatchObject({ player: P, seconds_played: 180, missions_won: 3, last_won: 'm1', dev: 0 });
  });

  it('never stores the IP', async () => {
    const h = setup();
    await h.post({ events: [hb(1)] });
    const dump = JSON.stringify(h.db.raw.prepare('SELECT * FROM events').all());
    expect(dump).not.toContain('203.0.113.9');
  });

  it('rejects a foreign origin, an oversized body and a bad shape without storing', async () => {
    const h = setup();
    expect((await h.post({ events: [hb(1)] }, { origin: 'https://evil.example' })).status).toBe(204);
    expect((await h.post('x'.repeat(70_000))).status).toBe(204);
    expect((await h.post({ events: 'nope' })).status).toBe(204);
    expect((await h.post({ events: Array.from({ length: 51 }, (_, i) => hb(i)) })).status).toBe(204);
    expect(h.count('SELECT COUNT(*) AS n FROM events')).toBe(0);
  });

  it('keys the rate limit on the connecting IP and stores nothing when limited', async () => {
    const keys: string[] = [];
    const h = setup({ limit: async ({ key }) => { keys.push(key); return { success: false }; } });
    await h.post({ events: [hb(1)] });
    expect(keys).toEqual(['203.0.113.9']);
    expect(h.count('SELECT COUNT(*) AS n FROM events')).toBe(0);
  });
});
```

- [ ] **Step 5: Run and confirm it fails**

Run: `pnpm vitest run packages/worker/`
Expected: FAIL (`./ingest` missing).

- [ ] **Step 6: Implement ingest**

`packages/worker/src/ingest.ts`:

```ts
import { isTelemetryEvent, type TelemetryEvent } from '@lions/data/telemetry';
import type { D1Stmt, Env } from './d1';

const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 50;
const HEARTBEAT_SECONDS = 60;
const NO_CONTENT = (): Response => new Response(null, { status: 204 });

function originAllowed(req: Request, env: Env): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return true; // sendBeacon may omit it; the rate limit still applies
  const own = new URL(req.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin === own || extra.includes(origin);
}

/** POST /api/events. Always 204: the game never waits on this and never retries. */
export async function handleIngest(req: Request, env: Env, now: number): Promise<Response> {
  try {
    if (req.method !== 'POST' || !originAllowed(req, env)) return NO_CONTENT();
    const ip = req.headers.get('cf-connecting-ip');
    if (env.INGEST_LIMIT && ip) {
      const { success } = await env.INGEST_LIMIT.limit({ key: ip }); // held in memory by the binding, never stored
      if (!success) return NO_CONTENT();
    }
    const text = await req.text();
    if (text.length > MAX_BODY) return NO_CONTENT();
    const body = JSON.parse(text) as { events?: unknown };
    if (!Array.isArray(body.events) || body.events.length > MAX_EVENTS) return NO_CONTENT();
    const events = body.events.filter(isTelemetryEvent);
    if (events.length === 0) return NO_CONTENT();

    const stmts: D1Stmt[] = events.map((e) =>
      env.DB.prepare(
        'INSERT INTO events (type, player, session, tester, build, mission, t, received_at, dev, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(e.type, e.player, e.session, e.tester ?? null, e.build, 'mission' in e ? e.mission : null, e.t, now, e.dev ? 1 : 0, JSON.stringify(e))
    );
    for (const [player, mine] of groupByPlayer(events)) stmts.push(upsertPlayer(env, player, mine));
    await env.DB.batch(stmts);
  } catch {
    /* malformed JSON or a D1 hiccup: dropped, as the client expects */
  }
  return NO_CONTENT();
}

function groupByPlayer(events: TelemetryEvent[]): Map<string, TelemetryEvent[]> {
  const m = new Map<string, TelemetryEvent[]>();
  for (const e of events) m.set(e.player, [...(m.get(e.player) ?? []), e]);
  return m;
}

function upsertPlayer(env: Env, player: string, events: TelemetryEvent[]): D1Stmt {
  const first = Math.min(...events.map((e) => e.t));
  const last = Math.max(...events.map((e) => e.t));
  const seconds = HEARTBEAT_SECONDS * events.filter((e) => e.type === 'heartbeat').length;
  const progress = events.filter((e) => e.type === 'campaign_progress').at(-1);
  const won = progress?.type === 'campaign_progress' ? progress.missionsWon : null;
  const lastWon = progress?.type === 'campaign_progress' ? progress.mission : null;
  const tester = events.find((e) => e.tester !== undefined)?.tester ?? null;
  const dev = events.some((e) => e.dev) ? 1 : 0;
  return env.DB.prepare(
    `INSERT INTO players (player, first_seen, last_seen, seconds_played, missions_won, last_won, tester, dev)
     VALUES (?1, ?2, ?3, ?4, COALESCE(?5, 0), ?6, ?7, ?8)
     ON CONFLICT (player) DO UPDATE SET
       first_seen = MIN(first_seen, excluded.first_seen),
       last_seen = MAX(last_seen, excluded.last_seen),
       seconds_played = seconds_played + excluded.seconds_played,
       missions_won = MAX(missions_won, COALESCE(?5, missions_won)),
       last_won = COALESCE(?6, last_won),
       tester = COALESCE(excluded.tester, tester),
       dev = MAX(dev, excluded.dev)`
  ).bind(player, first, last, seconds, won, lastWon, tester, dev);
}
```

`packages/worker/src/index.ts`:

```ts
import type { Env } from './d1';
import { handleIngest } from './ingest';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/events') return handleIngest(req, env, Date.now());
    return env.ASSETS.fetch(req);
  },
};
```

- [ ] **Step 7: Run and confirm it passes**

Run: `pnpm vitest run packages/worker/ && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Write `wrangler.jsonc`**

First create the database (this needs the Cloudflare login; if the session cannot, hand these two commands to Ilan and wait):

Run: `npx wrangler d1 create roaring-lions-telemetry`
Copy the `database_id` it prints into the file below.

`wrangler.jsonc` (repo root):

```jsonc
{
  // WP-T1: the game's static build, plus /api/events and /stats.
  // Spec: docs/superpowers/specs/2026-09-24-telemetry-design.md
  "name": "roaring-lions",
  "main": "packages/worker/src/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "packages/app/dist",
    "binding": "ASSETS",
    // The app routes by PATH (/mission/:id, /campaign); a reload on a deep
    // link must get index.html, as Pages' 404.html copy used to provide.
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/stats", "/stats/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "roaring-lions-telemetry",
      "database_id": "PASTE-THE-ID-FROM-wrangler-d1-create",
      "migrations_dir": "packages/worker/migrations"
    }
  ],
  "ratelimits": [
    { "name": "INGEST_LIMIT", "namespace_id": "1001", "simple": { "limit": 120, "period": 60 } }
  ],
  "observability": { "enabled": true }
}
```

The `database_id` line is the one value this plan cannot know; it comes from the command above. Do not commit the file until it holds the real id.

Run: `pnpm build && npx wrangler deploy --dry-run --outdir .superpowers/wrangler-dry`
Expected: it bundles with no error and lists the `DB`, `ASSETS` and `INGEST_LIMIT` bindings. If `ratelimits` is rejected, check the current Wrangler docs for the rate-limiting binding key and use that. The binding is optional in `Env`, so the Worker still runs without it.

- [ ] **Step 9: Run it locally end to end**

Run: `npx wrangler d1 migrations apply roaring-lions-telemetry --local && npx wrangler dev --port 5211`
Then open `http://localhost:5211/mission/beit_sahwan_breach?telemetry&tester=local` in the browser pane, deploy, play briefly and leave through the HUD. Confirm:
- `read_network_requests` shows `POST /api/events` → **204**;
- `npx wrangler d1 execute roaring-lions-telemetry --local --command "SELECT type, mission, json_extract(payload,'$.result') FROM events"` lists `session_start`, `mission_start` and one `mission_end` with `abandoned`;
- a reload on `/campaign` serves the app, not a 404 (SPA fallback).

Stop `wrangler dev` afterwards (it is your own process).

- [ ] **Step 10: Commit**

```bash
/usr/bin/git commit -s -m "feat(worker): telemetry ingest into D1 behind the static game (WP-T1)" -- packages/worker wrangler.jsonc eslint.config.mjs package.json pnpm-lock.yaml
```

---

### Task 10: `/stats`

**Files:**
- Create: `packages/worker/src/campaign-order.ts`, `campaign-order.test.ts`
- Create: `packages/worker/src/stats.ts`, `stats.test.ts`
- Create: `packages/worker/src/stats-page.ts`
- Modify: `packages/worker/src/index.ts`

**Interfaces:**
- Consumes: `D1Like`, `Env` (Task 9); `openTestD1`, `handleIngest` (Task 9, in tests).
- Produces:
  - `CAMPAIGN_ORDER: readonly string[]` (tutorial first, then every town's missions in `world.json` order)
  - `MISSION_TARGET_MINUTES: Readonly<Record<string, number>>`
  - `interface StatsFilter { since: number; tester?: string; testersOnly: boolean; includeDev: boolean }`
  - `parseFilter(url: URL, now: number): StatsFilter`
  - `summary(db, f)`, `perDay(db, f)`, `funnel(db, f)`, `tutorialFunnel(db, f)`, `missions(db, f)`, `testers(db, f)`, `timeline(db, tester)`, all `Promise<...>` of the row shapes in the code below
  - `handleStats(req: Request, env: Env, now: number): Promise<Response>`
  - `STATS_HTML: string`

Access is enforced at Cloudflare's edge. As a guard against the Access application being missing or misconfigured, the Worker also refuses `/stats*` with a 403 unless the request carries the `cf-access-jwt-assertion` header that Access adds. That header check is a tripwire for a missing application, not authentication. A request can forge it only when Access is absent, and the Task 12 deployed check proves that Access is present.

- [ ] **Step 1: Campaign order and targets, pinned to the data**

`packages/worker/src/campaign-order.ts`:

```ts
import world from '../../../data/campaign/world.json';

const TUTORIAL = 'beit_sahwan_0_tutorial';

/** The funnel's order: the tutorial, then every town's missions as world.json lists them. */
export const CAMPAIGN_ORDER: readonly string[] = [
  TUTORIAL,
  ...(world as { regions: { towns: { missions: string[] }[] }[] }).regions.flatMap((r) => r.towns.flatMap((t) => t.missions)),
];

/** Each mission's authored `target_minutes`. Hand-kept so the Worker bundle does
 *  not carry every mission file; campaign-order.test.ts pins it to data/missions/. */
export const MISSION_TARGET_MINUTES: Readonly<Record<string, number>> = {
  // Filled in Step 3 from the test's failure message.
};
```

`packages/worker/src/campaign-order.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CAMPAIGN_ORDER, MISSION_TARGET_MINUTES } from './campaign-order';

const DIR = fileURLToPath(new URL('../../../data/missions/', import.meta.url));
const fromData: Record<string, number> = {};
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
  const m = JSON.parse(readFileSync(DIR + f, 'utf8')) as { id: string; target_minutes?: number };
  if (m.target_minutes !== undefined) fromData[m.id] = m.target_minutes;
}

describe('campaign order and targets', () => {
  it('MISSION_TARGET_MINUTES matches data/missions exactly', () => {
    expect(MISSION_TARGET_MINUTES, `paste this into campaign-order.ts:\n${JSON.stringify(fromData, null, 2)}`).toEqual(fromData);
  });
  it('the order starts at the tutorial and names only real missions, once each', () => {
    expect(CAMPAIGN_ORDER[0]).toBe('beit_sahwan_0_tutorial');
    expect(new Set(CAMPAIGN_ORDER).size).toBe(CAMPAIGN_ORDER.length);
    for (const id of CAMPAIGN_ORDER) expect(fromData, id).toHaveProperty(id);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm vitest run packages/worker/src/campaign-order.test.ts`
Expected: FAIL on the first test, printing the full object to paste.

- [ ] **Step 3: Paste the printed object** into `MISSION_TARGET_MINUTES`, then re-run the same command. Expected: PASS. If the second test fails because a world.json mission has no `target_minutes`, fix the data rather than the test; the schema already requires the field for campaign missions.

- [ ] **Step 4: Write the failing stats tests**

`packages/worker/src/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openTestD1 } from './test-d1';
import { handleIngest } from './ingest';
import * as stats from './stats';
import type { Env } from './d1';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 20);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = (p: number, t: number, extra: Record<string, unknown> = {}) => ({ v: 1, player: id(p), session: id(100 + p), build: '0.78.0', t, ...extra });

async function seeded() {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
  const send = (events: unknown[]) =>
    handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events }) }), env, T0);
  const end = (p: number, t: number, mission: string, result: string, tick: number, cause?: string) =>
    base(p, t, { type: 'mission_end', mission, result, tick, roe: 80, fielded: 5, lost: 1, objectivesDone: 1, objectivesTotal: 2, ...(cause ? { cause } : {}) });
  // Player 1 (tester dani): tutorial, wins breach on day 1, returns on day 2.
  await send([
    base(1, T0, { tester: 'dani', type: 'mission_start', mission: 'beit_sahwan_0_tutorial', replay: false }),
    base(1, T0 + 1, { tester: 'dani', type: 'tutorial_step', step: 0, steps: 14, prevMs: 0 }),
    base(1, T0 + 2, { tester: 'dani', type: 'tutorial_step', step: 1, steps: 14, prevMs: 4000 }),
    base(1, T0 + 3, { tester: 'dani', type: 'mission_start', mission: 'beit_sahwan_breach', replay: false }),
    base(1, T0 + 4, { tester: 'dani', type: 'heartbeat', mission: 'beit_sahwan_breach', tick: 1200 }),
    end(1, T0 + 5, 'beit_sahwan_breach', 'victory', 6000),
    base(1, T0 + 6, { tester: 'dani', type: 'campaign_progress', mission: 'beit_sahwan_breach', missionsWon: 1 }),
    base(1, T0 + DAY, { tester: 'dani', type: 'heartbeat', mission: 'beit_sahwan_1_recon', tick: 1200 }),
  ]);
  // Player 2: tutorial step 0 only, then loses breach to a failed objective.
  await send([
    base(2, T0, { type: 'tutorial_step', step: 0, steps: 14, prevMs: 0 }),
    base(2, T0 + 1, { type: 'mission_start', mission: 'beit_sahwan_breach', replay: false }),
    end(2, T0 + 2, 'beit_sahwan_breach', 'defeat', 3000, 'objective:evac_settlements'),
  ]);
  // Player 3: sandbox only (dev traffic).
  await send([base(3, T0, { type: 'session_start', screen: 'sandbox', renderer: 'three', viewport: [800, 600], returning: false, dev: true })]);
  return db;
}

const all: stats.StatsFilter = { since: 0, testersOnly: false, includeDev: false };

describe('stats queries', () => {
  it('summary counts real players, excludes dev, measures time and day-2 return', async () => {
    const s = await stats.summary(await seeded(), all);
    expect(s).toMatchObject({ players: 2, sessions: 2, hoursPlayed: 2 / 60, returnedDay2: 1 });
  });

  it('funnel follows campaign order with started and won per mission', async () => {
    const f = await stats.funnel(await seeded(), all);
    expect(f[0]).toMatchObject({ mission: 'beit_sahwan_0_tutorial', started: 1 });
    expect(f.find((r) => r.mission === 'beit_sahwan_breach')).toMatchObject({ started: 2, won: 1 });
  });

  it('tutorial funnel counts players reaching each step', async () => {
    const t = await stats.tutorialFunnel(await seeded(), all);
    expect(t.slice(0, 2)).toEqual([{ step: 0, players: 2 }, { step: 1, players: 1 }]);
  });

  it('per-mission table reports win rate, median real minutes against target, and top loss cause', async () => {
    const m = await stats.missions(await seeded(), all);
    const breach = m.find((r) => r.mission === 'beit_sahwan_breach');
    expect(breach).toMatchObject({ attempts: 2, wins: 1, medianWinMinutes: 5, topCause: 'objective:evac_settlements' });
    expect(breach?.targetMinutes).toBeGreaterThan(0);
  });

  it('filters to one tester', async () => {
    const s = await stats.summary(await seeded(), { ...all, tester: 'dani' });
    expect(s.players).toBe(1);
  });

  it('lists testers with their furthest progress', async () => {
    expect(await stats.testers(await seeded(), all)).toEqual([expect.objectContaining({ tester: 'dani', lastWon: 'beit_sahwan_breach' })]);
  });
});

describe('handleStats', () => {
  it('refuses without the Access assertion header', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: { fetch: async () => new Response('') } };
    const res = await stats.handleStats(new Request('https://g.dev/stats'), env, T0);
    expect(res.status).toBe(403);
  });
  it('serves the page and JSON with the header', async () => {
    const env: Env = { DB: await seeded(), ASSETS: { fetch: async () => new Response('') } };
    const h = { 'cf-access-jwt-assertion': 'x' };
    expect((await stats.handleStats(new Request('https://g.dev/stats', { headers: h }), env, T0)).headers.get('content-type')).toContain('text/html');
    const res = await stats.handleStats(new Request('https://g.dev/stats/api/summary?range=all', { headers: h }), env, T0);
    expect(await res.json()).toMatchObject({ players: 2 });
  });
});
```

- [ ] **Step 5: Run and confirm it fails**

Run: `pnpm vitest run packages/worker/src/stats.test.ts`
Expected: FAIL (`./stats` missing).

- [ ] **Step 6: Implement the queries and the handler**

`packages/worker/src/stats.ts`:

```ts
import type { D1Like, Env } from './d1';
import { CAMPAIGN_ORDER, MISSION_TARGET_MINUTES } from './campaign-order';
import { STATS_HTML } from './stats-page';

export interface StatsFilter {
  since: number;
  tester?: string;
  testersOnly: boolean;
  includeDev: boolean;
}

const TICKS_PER_MINUTE = 20 * 60;
const DAY_MS = 86_400_000;

export function parseFilter(url: URL, now: number): StatsFilter {
  const range = url.searchParams.get('range');
  const since = range === '7d' ? now - 7 * DAY_MS : range === '30d' ? now - 30 * DAY_MS : 0;
  const tester = url.searchParams.get('tester') ?? undefined;
  return { since, tester, testersOnly: url.searchParams.get('who') === 'testers', includeDev: url.searchParams.has('dev') };
}

/** The shared WHERE clause, with its bound values in order. */
function where(f: StatsFilter): { sql: string; args: unknown[] } {
  const parts = ['t >= ?'];
  const args: unknown[] = [f.since];
  if (!f.includeDev) parts.push('dev = 0');
  if (f.tester !== undefined) {
    parts.push('tester = ?');
    args.push(f.tester);
  } else if (f.testersOnly) parts.push('tester IS NOT NULL');
  return { sql: parts.join(' AND '), args };
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function summary(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT player) AS players, COUNT(DISTINCT session) AS sessions,
              SUM(CASE WHEN type = 'heartbeat' THEN 1 ELSE 0 END) AS beats
       FROM events WHERE ${w.sql}`
    )
    .bind(...w.args)
    .first<{ players: number; sessions: number; beats: number | null }>();
  const perPlayer = await db
    .prepare(
      `SELECT player, SUM(CASE WHEN type = 'heartbeat' THEN 1 ELSE 0 END) AS beats,
              COUNT(DISTINCT date(t / 1000, 'unixepoch')) AS days
       FROM events WHERE ${w.sql} GROUP BY player`
    )
    .bind(...w.args)
    .all<{ player: string; beats: number; days: number }>();
  return {
    players: row?.players ?? 0,
    sessions: row?.sessions ?? 0,
    hoursPlayed: ((row?.beats ?? 0) * 60) / 3600,
    medianMinutesPerPlayer: median(perPlayer.results.map((r) => r.beats)) ?? 0,
    returnedDay2: perPlayer.results.filter((r) => r.days >= 2).length,
  };
}

export async function perDay(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const rows = await db
    .prepare(
      `SELECT date(e.t / 1000, 'unixepoch') AS day, COUNT(DISTINCT e.player) AS players,
              COUNT(DISTINCT CASE WHEN date(p.first_seen / 1000, 'unixepoch') = date(e.t / 1000, 'unixepoch') THEN e.player END) AS new
       FROM events e JOIN players p ON p.player = e.player
       WHERE ${w.sql.replaceAll('t >=', 'e.t >=').replaceAll('dev =', 'e.dev =').replaceAll('tester', 'e.tester')}
       GROUP BY day ORDER BY day`
    )
    .bind(...w.args)
    .all<{ day: string; players: number; new: number }>();
  return rows.results.map((r) => ({ day: r.day, new: r.new, returning: r.players - r.new }));
}

export async function funnel(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const rows = await db
    .prepare(
      `SELECT mission,
              COUNT(DISTINCT CASE WHEN type = 'mission_start' THEN player END) AS started,
              COUNT(DISTINCT CASE WHEN type = 'mission_end' AND json_extract(payload, '$.result') = 'victory' THEN player END) AS won
       FROM events WHERE ${w.sql} AND mission IS NOT NULL GROUP BY mission`
    )
    .bind(...w.args)
    .all<{ mission: string; started: number; won: number }>();
  const by = new Map(rows.results.map((r) => [r.mission, r]));
  return CAMPAIGN_ORDER.map((mission) => ({ mission, started: by.get(mission)?.started ?? 0, won: by.get(mission)?.won ?? 0 }));
}

export async function tutorialFunnel(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const rows = await db
    .prepare(
      `SELECT json_extract(payload, '$.step') AS step, COUNT(DISTINCT player) AS players
       FROM events WHERE ${w.sql} AND type = 'tutorial_step' GROUP BY step ORDER BY step`
    )
    .bind(...w.args)
    .all<{ step: number; players: number }>();
  return rows.results;
}

export async function missions(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const ends = await db
    .prepare(
      `SELECT mission, json_extract(payload, '$.result') AS result, json_extract(payload, '$.cause') AS cause,
              json_extract(payload, '$.tick') AS tick, json_extract(payload, '$.roe') AS roe
       FROM events WHERE ${w.sql} AND type = 'mission_end'`
    )
    .bind(...w.args)
    .all<{ mission: string; result: string; cause: string | null; tick: number; roe: number }>();
  const starts = await db
    .prepare(`SELECT mission, COUNT(*) AS n FROM events WHERE ${w.sql} AND type = 'mission_start' GROUP BY mission`)
    .bind(...w.args)
    .all<{ mission: string; n: number }>();
  const failedObj = await db
    .prepare(
      `SELECT mission, json_extract(payload, '$.objective') AS objective, COUNT(*) AS n
       FROM events WHERE ${w.sql} AND type = 'objective' AND json_extract(payload, '$.status') = 'failed'
       GROUP BY mission, objective ORDER BY n DESC`
    )
    .bind(...w.args)
    .all<{ mission: string; objective: string; n: number }>();
  const attempts = new Map(starts.results.map((r) => [r.mission, r.n]));
  return CAMPAIGN_ORDER.filter((m) => attempts.has(m)).map((mission) => {
    const mine = ends.results.filter((e) => e.mission === mission);
    const wins = mine.filter((e) => e.result === 'victory');
    const causes = new Map<string, number>();
    for (const e of mine) if (e.cause) causes.set(e.cause, (causes.get(e.cause) ?? 0) + 1);
    const topCause = [...causes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      mission,
      attempts: attempts.get(mission) ?? 0,
      wins: wins.length,
      winRate: mine.length ? wins.length / mine.length : null,
      medianWinMinutes: median(wins.map((e) => e.tick / TICKS_PER_MINUTE)),
      targetMinutes: MISSION_TARGET_MINUTES[mission] ?? null,
      topCause,
      meanRoe: mine.length ? mine.reduce((a, e) => a + e.roe, 0) / mine.length : null,
      mostFailedObjective: failedObj.results.find((r) => r.mission === mission)?.objective ?? null,
    };
  });
}

export async function testers(db: D1Like, f: StatsFilter) {
  const rows = await db
    .prepare(
      `SELECT tester, MAX(missions_won) AS missionsWon, MAX(last_won) AS lastWon,
              SUM(seconds_played) / 3600.0 AS hours, MAX(last_seen) AS lastSeen
       FROM players WHERE tester IS NOT NULL AND last_seen >= ? ${f.includeDev ? '' : 'AND dev = 0'}
       GROUP BY tester ORDER BY lastSeen DESC`
    )
    .bind(f.since)
    .all<{ tester: string; missionsWon: number; lastWon: string | null; hours: number; lastSeen: number }>();
  return rows.results;
}

export async function timeline(db: D1Like, tester: string) {
  const rows = await db
    .prepare(
      `SELECT t, type, mission, json_extract(payload, '$.result') AS result, json_extract(payload, '$.tick') AS tick
       FROM events WHERE tester = ? AND type IN ('mission_start', 'mission_end', 'campaign_progress')
       ORDER BY t DESC LIMIT 200`
    )
    .bind(tester)
    .all<{ t: number; type: string; mission: string | null; result: string | null; tick: number | null }>();
  return rows.results;
}

const json = (x: unknown): Response =>
  new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** /stats and /stats/api/*. Access guards this at the edge; the header check is a
 *  tripwire for a missing or misconfigured Access application, not authentication. */
export async function handleStats(req: Request, env: Env, now: number): Promise<Response> {
  if (!req.headers.get('cf-access-jwt-assertion')) return new Response('Cloudflare Access is not protecting /stats.', { status: 403 });
  const url = new URL(req.url);
  const f = parseFilter(url, now);
  switch (url.pathname) {
    case '/stats':
    case '/stats/':
      return new Response(STATS_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    case '/stats/api/summary':
      return json(await summary(env.DB, f));
    case '/stats/api/per-day':
      return json(await perDay(env.DB, f));
    case '/stats/api/funnel':
      return json({ campaign: await funnel(env.DB, f), tutorial: await tutorialFunnel(env.DB, f) });
    case '/stats/api/missions':
      return json(await missions(env.DB, f));
    case '/stats/api/testers':
      return json(await testers(env.DB, f));
    case '/stats/api/timeline':
      return json(await timeline(env.DB, url.searchParams.get('tester') ?? ''));
    default:
      return new Response('Not found', { status: 404 });
  }
}
```

The `summary` test expects `hoursPlayed: 2/60` (two heartbeats) and `medianMinutesPerPlayer` in minutes, because each heartbeat is one minute. The `perDay` WHERE clause qualifies the shared filter's columns for the join. If the string rewriting reads as too clever in review, give `where()` a column-prefix parameter instead; the behaviour is the same.

- [ ] **Step 7: Write the page**

`packages/worker/src/stats-page.ts` exports `STATS_HTML`: one self-contained document. It has no external requests except the game's own fonts, which the Worker serves from `/fonts/`. Its colours are palette hexes, the same tokens the plan pages use.

```ts
import palette from '../../../data/palette.json';

const ramp = (name: string, i: number): string =>
  (palette as { ramps: Record<string, { colors: string[] }> }).ramps[name].colors[i];

export const STATS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roaring Lions Stats</title>
<style>
@font-face{font-family:Barlow;src:url(/fonts/barlow-latin-400.woff2) format('woff2');font-weight:400}
@font-face{font-family:Barlow;src:url(/fonts/barlow-latin-600.woff2) format('woff2');font-weight:600}
@font-face{font-family:'Big Shoulders Display';src:url(/fonts/big-shoulders-display-latin.woff2) format('woff2');font-weight:100 900}
@font-face{font-family:'IBM Plex Mono';src:url(/fonts/ibm-plex-mono-latin-400.woff2) format('woff2')}
:root{--ground:${ramp('limestone', 0)};--surface:${ramp('limestone', 1)};--ink:${ramp('shadow', 0)};--muted:${ramp('gunmetal', 2)};
--rule:${ramp('gunmetal', 0)};--accent:${ramp('olive', 1)};--bad:${ramp('terracotta', 1)};--good:${ramp('scrub', 1)}}
*{box-sizing:border-box}body{margin:0;padding:0 16px 64px;background:var(--ground);color:var(--ink);font:16px/1.5 Barlow,Arial,sans-serif}
main{max-width:1080px;margin:0 auto}h1{font:800 48px/1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;margin:32px 0 8px}
h2{font:700 26px/1.1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;border-top:1px solid var(--rule);padding-top:14px;margin:40px 0 12px}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}select,button{font:inherit;padding:4px 8px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.stat{background:var(--surface);border-top:3px solid var(--ink);padding:12px}.stat b{display:block;font:800 34px/1 'Big Shoulders Display',sans-serif}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:15px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule)}
th{font:600 12px 'IBM Plex Mono',monospace;text-transform:uppercase;color:var(--muted)}td.n{text-align:right;font-family:'IBM Plex Mono',monospace}
.bar{height:14px;background:var(--accent)}.drop{background:var(--bad)}.over{color:var(--bad)}.muted{color:var(--muted)}
</style></head><body><main>
<h1>Roaring Lions Stats</h1>
<p class="muted">Anonymous telemetry from the deployed game. Sandbox traffic is excluded.</p>
<div class="controls">
<select id="range"><option value="7d">Last 7 days</option><option value="30d" selected>Last 30 days</option><option value="all">All time</option></select>
<select id="who"><option value="all">Everyone</option><option value="testers">Testers only</option></select>
<select id="tester"><option value="">Any tester</option></select>
</div>
<div class="stats" id="summary"></div>
<h2>Players per day</h2><div class="wrap"><table id="perday"></table></div>
<h2>Campaign funnel</h2><div class="wrap"><table id="funnel"></table></div>
<h2>Tutorial funnel</h2><div class="wrap"><table id="tutorial"></table></div>
<h2>Missions</h2><div class="wrap"><table id="missions"></table></div>
<h2>Testers</h2><div class="wrap"><table id="testers"></table></div>
<h2 id="tl-title" hidden>Timeline</h2><div class="wrap"><table id="timeline"></table></div>
</main><script>
const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(n,d=1)=>n==null?'—':Number(n).toFixed(d);
const qs=()=>{const p=new URLSearchParams({range:$('range').value,who:$('who').value});if($('tester').value)p.set('tester',$('tester').value);return p};
const get=(path,p=qs())=>fetch('/stats/api/'+path+'?'+p).then((r)=>r.json());
const table=(el,head,rows)=>{el.innerHTML='<tr>'+head.map((h)=>'<th>'+h+'</th>').join('')+'</tr>'+rows.join('')};
async function load(){
  const [s,days,fun,mis,tes]=await Promise.all([get('summary'),get('per-day'),get('funnel'),get('missions'),get('testers')]);
  $('summary').innerHTML=[['Players',s.players,0],['Sessions',s.sessions,0],['Hours played',s.hoursPlayed,1],['Median min / player',s.medianMinutesPerPlayer,0],['Came back on day 2',s.returnedDay2,0]]
    .map(([l,v,d])=>'<div class="stat"><b>'+fmt(v,d)+'</b>'+l+'</div>').join('');
  const maxDay=Math.max(1,...days.map((d)=>d.new+d.returning));
  table($('perday'),['Day','New','Returning',''],days.map((d)=>'<tr><td>'+d.day+'</td><td class="n">'+d.new+'</td><td class="n">'+d.returning+'</td><td style="width:40%"><div class="bar" style="width:'+(100*(d.new+d.returning)/maxDay)+'%"></div></td></tr>'));
  const top=Math.max(1,fun.campaign[0]?.started||0);let worst=-1,worstAt=-1;
  fun.campaign.forEach((r,i)=>{if(i>0){const drop=fun.campaign[i-1].started-r.started;if(drop>worst){worst=drop;worstAt=i}}});
  table($('funnel'),['Mission','Started','Won','Reached'],fun.campaign.map((r,i)=>'<tr><td>'+esc(r.mission)+'</td><td class="n">'+r.started+'</td><td class="n">'+r.won+'</td><td style="width:35%"><div class="bar'+(i===worstAt?' drop':'')+'" style="width:'+(100*r.started/top)+'%"></div></td></tr>'));
  const tTop=Math.max(1,fun.tutorial[0]?.players||0);
  table($('tutorial'),['Step','Players',''],fun.tutorial.map((r)=>'<tr><td>'+(r.step+1)+'</td><td class="n">'+r.players+'</td><td style="width:50%"><div class="bar" style="width:'+(100*r.players/tTop)+'%"></div></td></tr>'));
  table($('missions'),['Mission','Attempts','Win %','Median min','Target','Top loss cause','Mean ROE','Most-failed objective'],mis.map((m)=>'<tr><td>'+esc(m.mission)+'</td><td class="n">'+m.attempts+'</td><td class="n">'+(m.winRate==null?'—':Math.round(100*m.winRate))+'</td><td class="n'+(m.medianWinMinutes!=null&&m.targetMinutes!=null&&m.medianWinMinutes>m.targetMinutes?' over':'')+'">'+fmt(m.medianWinMinutes)+'</td><td class="n">'+fmt(m.targetMinutes,0)+'</td><td>'+esc(m.topCause??'—')+'</td><td class="n">'+fmt(m.meanRoe,0)+'</td><td>'+esc(m.mostFailedObjective??'—')+'</td></tr>'));
  table($('testers'),['Tester','Missions won','Last won','Hours','Last seen'],tes.map((t)=>'<tr><td><button data-t="'+esc(t.tester)+'">'+esc(t.tester)+'</button></td><td class="n">'+t.missionsWon+'</td><td>'+esc(t.lastWon??'—')+'</td><td class="n">'+fmt(t.hours)+'</td><td>'+new Date(t.lastSeen).toISOString().slice(0,16).replace('T',' ')+'</td></tr>'));
  const sel=$('tester'),cur=sel.value;sel.innerHTML='<option value="">Any tester</option>'+tes.map((t)=>'<option'+(t.tester===cur?' selected':'')+'>'+esc(t.tester)+'</option>').join('');
}
async function showTimeline(name){
  const rows=await get('timeline',new URLSearchParams({tester:name}));
  $('tl-title').hidden=false;$('tl-title').textContent='Timeline: '+name;
  table($('timeline'),['When','Event','Mission','Result','Minutes'],rows.map((r)=>'<tr><td>'+new Date(r.t).toISOString().slice(0,16).replace('T',' ')+'</td><td>'+esc(r.type)+'</td><td>'+esc(r.mission??'')+'</td><td>'+esc(r.result??'')+'</td><td class="n">'+(r.tick==null?'':fmt(r.tick/1200))+'</td></tr>'));
}
$('testers').addEventListener('click',(e)=>{const b=e.target.closest('button');if(b)showTimeline(b.dataset.t)});
for(const id of ['range','who','tester'])$(id).addEventListener('change',load);
load();
</script></body></html>`;
```

- [ ] **Step 8: Route it**

In `packages/worker/src/index.ts`, add the import and the route above the assets fallthrough:

```ts
import { handleStats } from './stats';
// ...
    if (pathname === '/stats' || pathname.startsWith('/stats/')) return handleStats(req, env, Date.now());
```

- [ ] **Step 9: Run and confirm it passes**

Run: `pnpm vitest run packages/worker/ && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 10: See the page**

Run `npx wrangler dev --port 5211` against the local D1 from Task 9, which holds real events. Open `http://localhost:5211/stats` in the browser pane: it answers **403**, because local dev has no Access. That is the tripwire working. To look at the page itself, send the header from a console fetch (inspection only), or temporarily allow it under `wrangler dev` with `--var STATS_DEV_BYPASS:1`. If you add the bypass, gate it on `env.STATS_DEV_BYPASS === '1'` in `handleStats`, add `STATS_DEV_BYPASS?: string` to `Env`, and add a test that it is off by default. Take a screenshot at desktop width and at 375 px wide, confirm there is no horizontal page scroll, then stop `wrangler dev`.

- [ ] **Step 11: Commit**

```bash
/usr/bin/git commit -s -m "feat(worker): /stats dashboard and queries (WP-T1)" -- packages/worker
```

---

### Task 11: Retire GitHub Pages; document

**Files:**
- Delete: `.github/workflows/pages.yml`
- Modify: `.github/workflows/ci.yml` (the version job's "Redeploy Pages at the new version" step, ~L336)
- Modify: `CLAUDE.md` (package layout + one hosting paragraph)

- [ ] **Step 1: Find out whether Cloudflare builds a release commit**

In the Cloudflare dashboard → Workers & Pages → `roaring-lions` → Deployments, find the build for the most recent `chore(release): vX [skip ci]` commit on `main`. You need Ilan's dashboard access for this; ask him if the session has none.
- **It built:** the version shown in the deployed app follows the tag by itself. Go to Step 2a.
- **It was skipped:** go to Step 2b.

- [ ] **Step 2a: Remove the step** (if it built)

Delete the whole step from ci.yml, from `# The push above is invisible to Actions, so the Pages deploy running` through `run: gh workflow run pages.yml --ref main`.

- [ ] **Step 2b: Replace the step** (if it was skipped)

Replace the same block with:

```yaml
      # Cloudflare's Workers Builds skips a `[skip ci]` release commit, so the
      # deploy that ran for the merge published the PRE-bump version. Deploying
      # again from here keeps the number the app shows in step with the tag.
      - name: Redeploy the Worker at the new version
        if: steps.decide.outputs.next != ''
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: pnpm install --frozen-lockfile && pnpm build && npx wrangler deploy
```

Ilan adds the two repository secrets (Settings → Secrets and variables → Actions). The token needs "Workers Scripts: Edit" and "D1: Edit".

- [ ] **Step 3: Delete `pages.yml`**

Run: `/usr/bin/git rm .github/workflows/pages.yml`

- [ ] **Step 4: Document**

In `CLAUDE.md`'s package-layout block, after the `app/` line:

```
  worker/   Cloudflare Worker in front of the game: static assets, POST /api/events
            into D1, /stats behind Cloudflare Access (WP-T1). Nothing imports it.
```

And under "Dev instruments", add one bullet:

```markdown
- **Hosting and telemetry (WP-T1).** The playable build deploys to Cloudflare Workers from
  `main` (`wrangler.jsonc`; GitHub Pages retired when the repo went private). The game sends
  anonymous events to `/api/events` ONLY from a production build on a real host, or with
  `?telemetry` -- never from `pnpm dev`, tests or CI, because `pnpm ui:routes` fails on any
  console error. `?tester=<name>` labels a tester, `?notrack` opts out (persisted). Results
  are at `/stats`, behind Cloudflare Access. Spec: `docs/superpowers/specs/2026-09-24-telemetry-design.md`.
```

- [ ] **Step 5: Check the workflows parse**

Run: `pnpm lint && gh workflow list -R ilan-pinto/roaring-lions`
Expected: lint passes. After the PR merges, `pages` no longer appears in the workflow list.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git commit -s -m "ci: retire GitHub Pages for the Cloudflare Worker (WP-T1)" -- .github/workflows/pages.yml .github/workflows/ci.yml CLAUDE.md
```

---

### Task 12: Deploy and verify on the real site

This task changes Cloudflare settings and must be done with Ilan. List each action and get his yes before doing it.

- [ ] **Step 1: Cloudflare settings (Ilan, in the dashboard)**
  1. Workers & Pages → `roaring-lions` → Settings → Build:
     - **Deploy command:** `npx wrangler d1 migrations apply roaring-lions-telemetry --remote && npx wrangler deploy`
     - **Non-production branch deploy command:** `npx wrangler versions upload`
     - **Path:** empty.
     - **API token:** needs D1 Edit; recreate it if the migration step fails with an auth error.
  2. Zero Trust → Access → Applications → Add → Self-hosted:
     - hostname: the Worker's `*.workers.dev` host;
     - paths: `stats` and `stats/*`;
     - policy: Allow, with Ilan's e-mail.

- [ ] **Step 2: Merge and watch the deploy**

After the PR merges (Ilan merges; one PR at a time), read the Cloudflare build log: the migration applies, then the deploy succeeds.

- [ ] **Step 3: Verify, driving the real UI**

On the deployed URL with `?tester=ilan`:
1. Play the tutorial's first three steps.
2. Deploy into `beit_sahwan_breach` and leave through the HUD.
3. Reload `/campaign` (it must not 404: SPA fallback).
4. Open `/stats` and confirm the Access login appears.
5. After logging in, confirm that: `ilan` appears under Testers; the tutorial funnel shows steps 1–3; `beit_sahwan_breach` shows 1 attempt; and the timeline shows one `mission_end` / `abandoned`.
6. Open `/stats` in a private window with no login and confirm it never shows the page.

- [ ] **Step 4: Close out**

Tick the finished tasks on GH #218, flip the WP-T1 rows on the Gamification Plan page (`https://claude.ai/artifact/QkdQFY7MfZkRSjUgTrcSVF`), and tell the execution-plan session so `docs/HANDOVER.md` and the Execution Plan page move with it.

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| Envelope, anonymous id, session, tester, build, t; no e-mail/IP/URL | 1, 4, 7 |
| Seven events and their payloads | 1, 5, 7 |
| `defeatCause` read-only; hash unmoved; sim-guard | 2 |
| Soft-navigation abandons from teardown + pagehide beacon, one guard | 7, 8 |
| Tutorial count from data (14) | 8 Step 6 (`tut.steps.length`), 10 (funnel from events) |
| Sandbox → `dev`, excluded from `/stats` | 7, 8 Step 2, 10 |
| One schema, validated by client tests and the Worker | 1 (agreement test), 5, 9 |
| Batched sender, 30 s, beacon on pagehide, dropped not retried | 6, 7 |
| Off switch airtight; GPC/DNT/`?notrack`; `ui:routes` green | 4, 8 Steps 8–10 |
| SW passes `/stats` and `/api` through, recorded red | 3 |
| `packages/worker`, lint/typecheck/test reach it | 9 |
| `/api/events`: 64 KB, 50 events, origin, IP rate limit never stored, 204 | 9 |
| D1 `events` + `players`, upsert once per request, forever | 9 |
| `/stats` behind Access; funnel, tutorial funnel, per-mission vs `target_minutes`, testers + timeline | 10, 12 |
| Palette colours, self-hosted fonts | 10 Step 7 |
| Retire `pages.yml` with ci.yml's step, verified first | 11 |
| Consent: private test accepted; notice gated on public launch | Out of scope, recorded in Global Constraints |
| Base after #219; worktree outside `.claude/worktrees` | Global Constraints |
