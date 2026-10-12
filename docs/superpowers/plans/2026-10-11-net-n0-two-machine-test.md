# N0 · Two-Machine Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two browsers on two machines run the same sandbox battle in lockstep through a Durable Object room in the existing Worker, comparing state hashes every 20 ticks, with no game rule changed.

**Architecture:** A new `packages/net` holds the lockstep core (protocol, config, frames, clock, ownership, digest, a `MatchTransport` seam with a `LocalTransport` that single-player uses unchanged, and a `WsTransport`). The Worker gains a pure room state machine (`room-core.ts`, tested under node) wrapped by a `MatchRoom` Durable Object that is the 20 Hz metronome. `bootBattlefield` reads `?net=` on the sandbox, resolves a transport before the sim exists, and its tick loop advances only over frames the transport yields.

**Tech Stack:** TypeScript strict, vitest (node), Cloudflare Durable Objects with the WebSocket Hibernation API (`wrangler` 4.x, already a root devDependency), Playwright (already in `tools`) for the three-engine check.

**Spec:** `docs/superpowers/specs/2026-10-10-network-game-design.md` — §2.1 (`MatchConfig`), §3.1 (`packages/net`), §3.2 (the room), §3.3 (the client), §3.4 (desync), §3.5 (security), §7.4 items 2, 4, 5, 6 and 7, §9 row N0, §12 tests.

## Global Constraints

- The four invariants (CLAUDE.md): no sim file is touched by this plan. `pnpm test:determinism` must stay green and its pinned hashes `922714084` and `3200430224` must not move.
- Dependency direction: `app → net → sim` (types only), `worker → net` (protocol and config only). `packages/net` imports nothing but `@lions/sim`; `packages/render` never imports `@lions/net`; the Worker never imports `@lions/sim`.
- No battle state on the wire: the room never receives or stores a position, HP value or fog tile. The only thing a client sends about the battle is a `Command` and a hash.
- Message cap 4 KB (`MAX_MESSAGE_BYTES = 4096`); at most 32 commands per seat per frame (`MAX_CMDS_PER_SEAT_PER_FRAME = 32`); hash every 20 ticks (`hashEveryTicks: 20`); clients run 2 frames behind (`bufferTicks: 2`); ack every 10 ticks; stall when a seat is 40 ticks behind or silent 2 s; rooms expire 6 h after creation.
- The ticket rides in the first WebSocket message, never the URL. `TICKET_SECRET` is its own secret, never `STATS_PASSWORD`. Every socket requires an `Origin` equal to the Worker's own or one listed in `ALLOWED_ORIGINS`.
- Nothing is stored in R2. Room state lives in the Durable Object's SQLite storage.
- In a net match: no sandbox flag reaches the sim, `__lions.step` is absent, `localStorage` reaches nothing (the sandbox already reads no ledger).
- Git in this worktree: call `/usr/bin/git` by absolute path, one plain command per call, always with a pathspec; never `git add -A`, never `git stash`.
- Never start or kill a dev server from a subagent (`pkill -f vite` is forbidden); `pnpm ui:routes` runs on CI only.
- Every check arrives with its falsification: the step that watches it go red is in the task, not implied.

## Review Focus

1. **A frame arrives twice or out of order (a reconnect replays the log, a proxy reorders).** Expected: the clock refuses the gap, a duplicate is ignored, and no tick ever runs on a frame that is not `nextTick`. Pinned in Task 3 (`LockstepClock.push` returns `'gap'` / `'duplicate'`).
2. **A command names a unit the seat does not own, or an id that does not exist.** Expected: dropped identically on every client, counted, never queued. Pinned in Task 4 (`validateCommand` with a foreign id and with `ids: [999999]`).
3. **A message over 4 KB, malformed JSON, or an unknown `t`.** Expected: `parseClientMsg` returns `null`, the room answers `error{code:'bad_message'}` once and does not crash. Pinned in Task 1 (parse) and Task 7 (room).
4. **A seat reconnects after the room has advanced, or a ticket is replayed from a second tab.** Expected: the second socket replaces the first; the room sends `log` with every frame; a frame already applied is a `'duplicate'`. Pinned in Task 7 (`onHello` replacing a seat) and Task 9 (`WsTransport` ignoring frames below `nextTick`).
5. **The room's `setInterval` dies with an eviction while a match is running.** Expected: the next message or socket event restarts the clock; no frame is skipped because the tick counter is persisted. Pinned in Task 8 (`ensureClock()` called from every handler, with the persisted `tick` asserted after a simulated restart in the pure core test of Task 7).

---

## File Structure

**Create**
- `packages/net/package.json`, `packages/net/tsconfig.json` — the package.
- `packages/net/src/index.ts` — barrel.
- `packages/net/src/protocol.ts` — message types, `parseClientMsg`, `parseServerMsg`, size caps.
- `packages/net/src/config.ts` — `MatchConfig`, `Seat`, `validateConfig`, `fnv1a32`.
- `packages/net/src/digest.ts` — `fold`, `matchDigest`.
- `packages/net/src/frames.ts` — `Frame`, `Stamped`, `canonicalOrder`.
- `packages/net/src/lockstep.ts` — `LockstepClock`.
- `packages/net/src/ownership.ts` — `validateCommand`, `applyFrame`.
- `packages/net/src/transport.ts` — `MatchTransport`, `TransportStatus`, `LocalTransport`.
- `packages/net/src/ws-transport.ts` — `WsTransport`, `SocketLike`.
- `packages/worker/src/match/ticket.ts` — `signTicket`, `verifyTicket`.
- `packages/worker/src/match/code.ts` — `mintCode`, `CODE_ALPHABET`.
- `packages/worker/src/match/room-core.ts` — the pure room state machine.
- `packages/worker/src/match/match-room.ts` — the Durable Object class.
- `packages/worker/src/match/routes.ts` — `/api/match*` handlers.
- `packages/worker/src/do-types.ts` — the hand-declared slice of the Durable Object API.
- `packages/app/src/net/connect.ts` — `connectMatch(req)`: resolves a transport before the sim exists.
- `tools/src/net/two-client.test.ts` — two sims, one frame stream.
- `tools/src/net/two-engine.ts` — Chromium, Firefox, WebKit, one order script, one hash.
- `docs/net/N0-two-machine-test.md` — the run protocol and report template.

**Modify**
- `wrangler.jsonc` — `durable_objects`, `migrations`, `ROOM_LIMIT`.
- `packages/worker/src/d1.ts` — `Env` gains `ROOMS`, `ROOM_LIMIT`, `TICKET_SECRET`.
- `packages/worker/src/index.ts` — route `/api/match`, export `MatchRoom`.
- `packages/worker/package.json`, `packages/app/package.json`, `tools/package.json` — `@lions/net` dependency.
- `eslint.config.mjs` — the net package's import rule.
- `packages/app/src/main.ts` — `sandboxSpawns` facing (line ~421), `connectMatch` at the top of `bootBattlefield`, the seed, the tick loop (~5198), `dispatch` (~3450), `__lions.step` (~4896), the flag refusal (~1553).
- `packages/app/src/sandbox-anchors.ts` — `dist` without `Math.hypot`.
- `packages/app/src/sandbox-help.ts` — `net` and `seat` in `KNOWN_PARAMS`.
- `packages/app/vite.config.ts` — `server.proxy` for `/api` to `wrangler dev`.
- `.github/workflows/ci.yml` — the `visual` job installs three engines and runs `two-engine.ts`.

---

### Task 1: `packages/net` package and the protocol

**Files:**
- Create: `packages/net/package.json`, `packages/net/tsconfig.json`, `packages/net/src/index.ts`, `packages/net/src/protocol.ts`
- Modify: `eslint.config.mjs` (after the `packages/data` block, ~line 158), `packages/app/package.json`, `packages/worker/package.json`, `tools/package.json`
- Test: `packages/net/src/protocol.test.ts`

**Interfaces:**
- Produces: `Seat = 0 | 1`; `Stamped { seat: Seat; seq: number; cmd: Command }`; `ClientMsg`, `ServerMsg`; `parseClientMsg(raw: string): ClientMsg | null`; `parseServerMsg(raw: string): ServerMsg | null`; `MAX_MESSAGE_BYTES`, `MAX_CMDS_PER_SEAT_PER_FRAME`. `MatchConfig` and `Frame` are declared in Tasks 2 and 3 and re-exported from the barrel; `protocol.ts` imports their types from `./config` and `./frames`, which Task 1 creates as type-only stubs that Tasks 2 and 3 fill in.

- [ ] **Step 1: Create the package**

`packages/net/package.json`:
```json
{
  "name": "@lions/net",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "Deterministic lockstep core: protocol, match config, frames, the clock, ownership and the transport seam. Runs in the browser, in Node and in the Worker. Imports @lions/sim types only.",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@lions/sim": "workspace:*" }
}
```
`packages/net/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```
Add `"@lions/net": "workspace:*"` to `dependencies` in `packages/app/package.json`, `packages/worker/package.json` and `tools/package.json`. Run `pnpm install` from the worktree root (it rewrites `pnpm-lock.yaml`; commit it).

- [ ] **Step 2: Add the eslint rule**

In `eslint.config.mjs`, after the `packages/data/src/**/*.ts` block:
```js
  {
    files: ['packages/net/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^@lions\\u002F(app|data|render|worker)/]',
          message: '@lions/net may import @lions/sim only (network design §3.1: app → net → sim).',
        },
      ],
    },
  },
```

- [ ] **Step 3: Write the stubs the protocol imports**

`packages/net/src/config.ts` (Task 2 replaces it whole):
```ts
export type Seat = 0 | 1;
export interface MatchConfig { matchId: string; seed: number; map: string; hashEveryTicks: number; bufferTicks: number; build: string }
```
`packages/net/src/frames.ts` (Task 3 replaces it whole):
```ts
import type { Command } from '@lions/sim';
import type { Seat } from './config';
export interface Stamped { seat: Seat; seq: number; cmd: Command }
export interface Frame { tick: number; cmds: Stamped[] }
```

- [ ] **Step 4: Write the failing protocol test**

`packages/net/src/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseClientMsg, parseServerMsg, MAX_MESSAGE_BYTES } from './protocol';

describe('parseClientMsg', () => {
  it('accepts every client kind', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'hello', ticket: 'abc', build: '0.1' }))).toEqual({ t: 'hello', ticket: 'abc', build: '0.1' });
    expect(parseClientMsg(JSON.stringify({ t: 'ready' }))).toEqual({ t: 'ready' });
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 3, cmd: { kind: 'halt', ids: [1] } }))).toEqual({ t: 'cmd', seq: 3, cmd: { kind: 'halt', ids: [1] } });
    expect(parseClientMsg(JSON.stringify({ t: 'ack', tick: 40 }))).toEqual({ t: 'ack', tick: 40 });
    expect(parseClientMsg(JSON.stringify({ t: 'hash', tick: 20, h: -5 }))).toEqual({ t: 'hash', tick: 20, h: -5 });
    expect(parseClientMsg(JSON.stringify({ t: 'bye' }))).toEqual({ t: 'bye' });
  });
  it('returns null on malformed JSON, an unknown kind, a wrong field type, and a message over the cap', () => {
    expect(parseClientMsg('{not json')).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'teleport' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'ack', tick: 'soon' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { kind: 'halt' } }))).toBeNull();
    const big = JSON.stringify({ t: 'cmd', seq: 1, cmd: { kind: 'halt', ids: Array.from({ length: 2000 }, (_, i) => i) } });
    expect(big.length).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(parseClientMsg(big)).toBeNull();
  });
  it('refuses a command whose kind the sim does not have', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { kind: 'nuke', ids: [1] } }))).toBeNull();
  });
});

describe('parseServerMsg', () => {
  it('round-trips a frame and refuses a frame whose cmds are not stamped', () => {
    const frame = { t: 'frame', tick: 7, cmds: [{ seat: 1, seq: 0, cmd: { kind: 'halt', ids: [4] } }] };
    expect(parseServerMsg(JSON.stringify(frame))).toEqual(frame);
    expect(parseServerMsg(JSON.stringify({ t: 'frame', tick: 7, cmds: [{ cmd: { kind: 'halt', ids: [4] } }] }))).toBeNull();
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm vitest run packages/net/src/protocol.test.ts`
Expected: FAIL, "Cannot find module './protocol'".

- [ ] **Step 6: Write the protocol**

`packages/net/src/protocol.ts`:
```ts
/**
 * Every message between a client and a `MatchRoom`, and the parser that is
 * the ONLY way bytes become one. Spec §3.2.3. The room never learns a
 * position: the only battle facts here are `Command`s and hashes.
 */
import type { Command } from '@lions/sim';
import type { MatchConfig, Seat } from './config';
import type { Frame, Stamped } from './frames';

export const MAX_MESSAGE_BYTES = 4096;
export const MAX_CMDS_PER_SEAT_PER_FRAME = 32;

/** `Command['kind']` as a value, so a wire command can be checked at runtime. */
export const COMMAND_KINDS = [
  'move', 'attackMove', 'halt', 'garrison', 'load', 'unload', 'reveal', 'callStrike', 'smoke', 'demolish', 'chargeTunnel',
] as const satisfies readonly Command['kind'][];

export interface SeatState { seat: Seat; callsign: string; connected: boolean; ready: boolean }

export type ClientMsg =
  | { t: 'hello'; ticket: string; build: string }
  | { t: 'ready' }
  | { t: 'cmd'; seq: number; cmd: Command }
  | { t: 'ack'; tick: number }
  | { t: 'hash'; tick: number; h: number }
  | { t: 'bye' };

export type StallReason = 'behind' | 'gone';

export type ServerMsg =
  | { t: 'lobby'; config: MatchConfig | null; seats: SeatState[]; you: Seat }
  | { t: 'start'; config: MatchConfig }
  | { t: 'frame'; tick: number; cmds: Stamped[] }
  | { t: 'stall'; reason: StallReason; seat: Seat }
  | { t: 'resume' }
  | { t: 'hashOk'; tick: number }
  | { t: 'desync'; tick: number; hashes: [number, number] }
  | { t: 'log'; config: MatchConfig; frames: Frame[] }
  | { t: 'ended'; reason: 'left' | 'void' | 'expired' }
  | { t: 'error'; code: 'bad_message' | 'bad_ticket' | 'build_mismatch' | 'full' | 'not_running' | 'origin' };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isSeat = (v: unknown): v is Seat => v === 0 || v === 1;
const isIntArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isInt);

/** Shape check only: every field the union declares, with the type it
 *  declares. Ownership and existence are the client's job (`ownership.ts`). */
export function isCommand(v: unknown): v is Command {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  if (!isStr(c.kind) || !(COMMAND_KINDS as readonly string[]).includes(c.kind)) return false;
  switch (c.kind as Command['kind']) {
    case 'move':
    case 'attackMove':
      return isIntArray(c.ids) && isInt(c.x) && isInt(c.y) &&
        (c.append === undefined || typeof c.append === 'boolean') && (c.exact === undefined || typeof c.exact === 'boolean');
    case 'halt':
    case 'unload':
      return isIntArray(c.ids);
    case 'garrison':
    case 'demolish':
      return isIntArray(c.ids) && isInt(c.structure);
    case 'load':
      return isIntArray(c.ids) && isInt(c.carrier);
    case 'chargeTunnel':
      return isIntArray(c.ids) && isInt(c.tunnel);
    case 'reveal':
      return isInt(c.side) && isInt(c.x) && isInt(c.y);
    case 'callStrike':
      return isInt(c.caller) && isInt(c.x) && isInt(c.y);
    case 'smoke':
      return isIntArray(c.ids) && isInt(c.x) && isInt(c.y);
  }
}

export function isStamped(v: unknown): v is Stamped {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return isSeat(s.seat) && isInt(s.seq) && isCommand(s.cmd);
}

function parseJson(raw: string): Record<string, unknown> | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseClientMsg(raw: string): ClientMsg | null {
  const m = parseJson(raw);
  if (m === null) return null;
  switch (m.t) {
    case 'hello': return isStr(m.ticket) && isStr(m.build) ? { t: 'hello', ticket: m.ticket, build: m.build } : null;
    case 'ready': return { t: 'ready' };
    case 'cmd': return isInt(m.seq) && isCommand(m.cmd) ? { t: 'cmd', seq: m.seq, cmd: m.cmd } : null;
    case 'ack': return isInt(m.tick) ? { t: 'ack', tick: m.tick } : null;
    case 'hash': return isInt(m.tick) && isInt(m.h) ? { t: 'hash', tick: m.tick, h: m.h } : null;
    case 'bye': return { t: 'bye' };
    default: return null;
  }
}

function isFrame(v: unknown): v is Frame {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return isInt(f.tick) && Array.isArray(f.cmds) && f.cmds.every(isStamped);
}

function isSeatState(v: unknown): v is SeatState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return isSeat(s.seat) && isStr(s.callsign) && typeof s.connected === 'boolean' && typeof s.ready === 'boolean';
}

/** `log` and `lobby` are the two messages that can exceed the client cap
 *  (a 20-minute log is ~24,000 frames), so the size cap applies to CLIENT
 *  messages only; a server message is trusted to come from the room. */
export function parseServerMsg(raw: string): ServerMsg | null {
  let m: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    m = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const config = (v: unknown): MatchConfig | null => (typeof v === 'object' && v !== null ? (v as MatchConfig) : null);
  switch (m.t) {
    case 'lobby': return Array.isArray(m.seats) && m.seats.every(isSeatState) && isSeat(m.you)
      ? { t: 'lobby', config: config(m.config), seats: m.seats, you: m.you } : null;
    case 'start': { const c = config(m.config); return c ? { t: 'start', config: c } : null; }
    case 'frame': return isInt(m.tick) && Array.isArray(m.cmds) && m.cmds.every(isStamped) ? { t: 'frame', tick: m.tick, cmds: m.cmds } : null;
    case 'stall': return (m.reason === 'behind' || m.reason === 'gone') && isSeat(m.seat) ? { t: 'stall', reason: m.reason, seat: m.seat } : null;
    case 'resume': return { t: 'resume' };
    case 'hashOk': return isInt(m.tick) ? { t: 'hashOk', tick: m.tick } : null;
    case 'desync': return isInt(m.tick) && Array.isArray(m.hashes) && m.hashes.length === 2 && m.hashes.every(isInt)
      ? { t: 'desync', tick: m.tick, hashes: [m.hashes[0], m.hashes[1]] } : null;
    case 'log': { const c = config(m.config); return c && Array.isArray(m.frames) && m.frames.every(isFrame) ? { t: 'log', config: c, frames: m.frames } : null; }
    case 'ended': return m.reason === 'left' || m.reason === 'void' || m.reason === 'expired' ? { t: 'ended', reason: m.reason } : null;
    case 'error': return isStr(m.code) ? { t: 'error', code: m.code as Extract<ServerMsg, { t: 'error' }>['code'] } : null;
    default: return null;
  }
}
```

`packages/net/src/index.ts`:
```ts
export * from './protocol';
export * from './config';
export * from './frames';
```
(Tasks 2–5 and 9 append their exports here.)

- [ ] **Step 7: Run the test, lint and typecheck**

Run: `pnpm vitest run packages/net/src/protocol.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS; lint and typecheck clean. If `COMMAND_KINDS` fails `satisfies`, the sim's union gained a member: add it to the list and to `isCommand`.

- [ ] **Step 8: Falsify the cap**

Temporarily change `MAX_MESSAGE_BYTES` to `1 << 20`, run the test: the "over the cap" assertion must FAIL. Restore. Commit:
```bash
/usr/bin/git add packages/net eslint.config.mjs packages/app/package.json packages/worker/package.json tools/package.json pnpm-lock.yaml
/usr/bin/git commit -m "net: packages/net with the room protocol and its parser (N0 task 1)"
```

---

### Task 2: `MatchConfig`, `validateConfig`, and the digest

**Files:**
- Modify (replace whole): `packages/net/src/config.ts`
- Create: `packages/net/src/digest.ts`
- Test: `packages/net/src/config.test.ts`, `packages/net/src/digest.test.ts`

**Interfaces:**
- Produces: `MatchConfig`, `SeatConfig`, `Seat`, `validateConfig(v: unknown): MatchConfig | null`, `fnv1a32(s: string): number`, `fold(h: number, w: number): number`, `matchDigest(simHash: number, runtimeDigest: number, dataDigest: number): number`, `DIGEST_SEED`.

- [ ] **Step 1: Write the failing tests**

`packages/net/src/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateConfig, fnv1a32, type MatchConfig } from './config';

export const CONFIG: MatchConfig = {
  matchId: 'm1', code: 'ABCDEF', seed: 20260727, map: 'beit_sahwan_outskirts', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p0', callsign: 'Host', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p1', callsign: 'Guest', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: '0.123.1', dataDigest: 0,
};

describe('validateConfig', () => {
  it('accepts the sandbox config and returns it typed', () => {
    expect(validateConfig(JSON.parse(JSON.stringify(CONFIG)))).toEqual(CONFIG);
  });
  it('refuses a missing seat, a non-integer seed, a bad mode and an unknown faction', () => {
    expect(validateConfig({ ...CONFIG, seats: [CONFIG.seats[0]] })).toBeNull();
    expect(validateConfig({ ...CONFIG, seed: 1.5 })).toBeNull();
    expect(validateConfig({ ...CONFIG, mode: 'coop' })).toBeNull();
    expect(validateConfig({ ...CONFIG, seats: [CONFIG.seats[0], { ...CONFIG.seats[1], faction: 'ashwar' }] })).toBeNull();
  });
});

describe('fnv1a32', () => {
  it('is the standard FNV-1a of the UTF-8 bytes', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5 | 0);
    expect(fnv1a32('a')).toBe(0xe40c292c | 0);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968 | 0);
  });
});
```
`packages/net/src/digest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fold, matchDigest, DIGEST_SEED } from './digest';

describe('matchDigest', () => {
  it('folds the three words in order and is sensitive to each', () => {
    const a = matchDigest(1, 2, 3);
    expect(a).toBe(fold(fold(fold(DIGEST_SEED, 1), 2), 3));
    expect(matchDigest(2, 2, 3)).not.toBe(a);
    expect(matchDigest(1, 3, 3)).not.toBe(a);
    expect(matchDigest(1, 2, 4)).not.toBe(a);
    expect(matchDigest(2, 1, 3)).not.toBe(a);
  });
  it('fold matches the sim hash primitive bit for bit', () => {
    // sim/src/hash.ts: imul32(h ^ w, 16777619) with imul32 = Math.imul.
    expect(fold(0x811c9dc5 | 0, 7)).toBe(Math.imul((0x811c9dc5 | 0) ^ 7, 16777619));
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm vitest run packages/net/src/config.test.ts packages/net/src/digest.test.ts`
Expected: FAIL (`validateConfig` not exported; `./digest` missing).

- [ ] **Step 3: Write config.ts and digest.ts**

`packages/net/src/config.ts`:
```ts
/** The whole input to both simulations (spec §2.1). `mode: 'sandbox'` is
 *  N0's two-humans-on-side-0 room; `'versus'` arrives with N1. */
export type Seat = 0 | 1;
export type Faction = 'kdf' | 'sarim';

export interface SeatConfig {
  seat: Seat;
  side: 0 | 1;
  faction: Faction;
  kit: 'matched' | 'brigade';
  tiers: Record<string, number>;
  unlocks: string[];
  player: string;
  callsign: string;
  kind: 'human' | 'bot';
}

export type Pace = { kind: 'realtime' } | { kind: 'paced'; roundTicks: number; roundWallMs: number };

export interface MatchConfig {
  matchId: string;
  code: string;
  seed: number;
  map: string;
  mode: 'sandbox' | 'versus';
  seats: [SeatConfig, SeatConfig];
  pace: Pace;
  hashEveryTicks: number;
  bufferTicks: number;
  build: string;
  dataDigest: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function isSeatConfig(v: unknown, seat: Seat): v is SeatConfig {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return s.seat === seat && (s.side === 0 || s.side === 1) && (s.faction === 'kdf' || s.faction === 'sarim') &&
    (s.kit === 'matched' || s.kit === 'brigade') && typeof s.tiers === 'object' && s.tiers !== null &&
    Object.values(s.tiers as Record<string, unknown>).every(isInt) && Array.isArray(s.unlocks) && s.unlocks.every(isStr) &&
    isStr(s.player) && isStr(s.callsign) && (s.kind === 'human' || s.kind === 'bot');
}

function isPace(v: unknown): v is Pace {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.kind === 'realtime') return true;
  return p.kind === 'paced' && isInt(p.roundTicks) && p.roundTicks > 0 && isInt(p.roundWallMs) && p.roundWallMs > 0;
}

export function validateConfig(v: unknown): MatchConfig | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (!isStr(c.matchId) || !isStr(c.code) || !isInt(c.seed) || !isStr(c.map)) return null;
  if (c.mode !== 'sandbox' && c.mode !== 'versus') return null;
  if (!Array.isArray(c.seats) || c.seats.length !== 2 || !isSeatConfig(c.seats[0], 0) || !isSeatConfig(c.seats[1], 1)) return null;
  if (!isPace(c.pace) || !isInt(c.hashEveryTicks) || c.hashEveryTicks < 1 || !isInt(c.bufferTicks) || c.bufferTicks < 0) return null;
  if (!isStr(c.build) || !isInt(c.dataDigest)) return null;
  return c as unknown as MatchConfig;
}

/** Standard 32-bit FNV-1a over UTF-8 bytes: the data digest of the JSON a
 *  build ships (spec §2.1), computed the same way in a browser and in Node. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5 | 0;
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return h | 0;
}
```
`packages/net/src/digest.ts`:
```ts
/** The network hash (spec §3.4): `sim.hash()` folded with the mission
 *  runtime's digest (0 until N2 adds one) and the build's data digest, using
 *  the same word fold as `packages/sim/src/hash.ts`. Reimplemented rather than
 *  imported: the sim barrel does not export its hash primitives, and net must
 *  not reach into sim internals. */
export const DIGEST_SEED = 0x811c9dc5 | 0;
export function fold(h: number, w: number): number {
  return Math.imul(h ^ w, 16777619);
}
export function matchDigest(simHash: number, runtimeDigest: number, dataDigest: number): number {
  return fold(fold(fold(DIGEST_SEED, simHash | 0), runtimeDigest | 0), dataDigest | 0);
}
```
Append `export * from './digest';` to `packages/net/src/index.ts`.

- [ ] **Step 4: Run, then falsify**

Run: `pnpm vitest run packages/net/src/config.test.ts packages/net/src/digest.test.ts` → PASS.
Falsify: change `fold` to `h ^ w` → the "matches the sim hash primitive" test fails; restore. Commit:
```bash
/usr/bin/git add packages/net/src/config.ts packages/net/src/config.test.ts packages/net/src/digest.ts packages/net/src/digest.test.ts packages/net/src/index.ts
/usr/bin/git commit -m "net: MatchConfig, its validator, and the match digest (N0 task 2)"
```

---

### Task 3: Frames and the lockstep clock

**Files:**
- Modify (replace whole): `packages/net/src/frames.ts`
- Create: `packages/net/src/lockstep.ts`
- Test: `packages/net/src/lockstep.test.ts`

**Interfaces:**
- Produces: `Frame`, `Stamped`, `canonicalOrder(cmds: Stamped[]): Stamped[]`; `class LockstepClock { constructor(bufferTicks: number); push(frame): 'ok' | 'duplicate' | 'gap'; take(maxTicks: number): Frame[]; nextTick: number; newest: number; behind(): number }`.

- [ ] **Step 1: Write the failing test**

`packages/net/src/lockstep.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { LockstepClock } from './lockstep';
import { canonicalOrder, type Frame, type Stamped } from './frames';

const halt = (seat: 0 | 1, seq: number): Stamped => ({ seat, seq, cmd: { kind: 'halt', ids: [1] } });
const frame = (tick: number, cmds: Stamped[] = []): Frame => ({ tick, cmds });

describe('LockstepClock', () => {
  it('yields a frame only once it is bufferTicks behind the newest', () => {
    const c = new LockstepClock(2);
    expect(c.push(frame(0))).toBe('ok');
    expect(c.take(10)).toEqual([]);
    c.push(frame(1));
    expect(c.take(10)).toEqual([]);
    c.push(frame(2));
    expect(c.take(10)).toEqual([frame(0)]);
    expect(c.nextTick).toBe(1);
  });
  it('refuses a gap and ignores a duplicate, and never yields across either', () => {
    const c = new LockstepClock(0);
    expect(c.push(frame(0))).toBe('ok');
    expect(c.push(frame(2))).toBe('gap');
    expect(c.push(frame(0))).toBe('duplicate');
    expect(c.take(10)).toEqual([frame(0)]);
    expect(c.push(frame(1))).toBe('ok');
    expect(c.push(frame(2))).toBe('ok');
    expect(c.take(10).map((f) => f.tick)).toEqual([1, 2]);
  });
  it('caps a catch-up at maxTicks and reports how far behind it is', () => {
    const c = new LockstepClock(0);
    for (let t = 0; t < 10; t++) c.push(frame(t));
    expect(c.behind()).toBe(10);
    expect(c.take(4).map((f) => f.tick)).toEqual([0, 1, 2, 3]);
    expect(c.behind()).toBe(6);
  });
});

describe('canonicalOrder', () => {
  it('orders by seat then seq whatever the arrival order', () => {
    const got = canonicalOrder([halt(1, 0), halt(0, 2), halt(1, 1), halt(0, 1)]);
    expect(got.map((s) => [s.seat, s.seq])).toEqual([[0, 1], [0, 2], [1, 0], [1, 1]]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/net/src/lockstep.test.ts` → FAIL (`./lockstep` missing; `canonicalOrder` not exported).

- [ ] **Step 3: Write frames.ts and lockstep.ts**

`packages/net/src/frames.ts`:
```ts
import type { Command } from '@lions/sim';
import type { Seat } from './config';

/** One command, stamped by the room with the seat that sent it and the
 *  seat's own sequence number. */
export interface Stamped { seat: Seat; seq: number; cmd: Command }

/** One tick's worth of input, for every seat. An empty frame is still a
 *  frame: it is how a client learns tick N happened with no orders. */
export interface Frame { tick: number; cmds: Stamped[] }

/** The total order every client applies: (seat, seq). Arrival order is not
 *  an order (spec §3.2.2). Stable, and a copy: the input belongs to the caller. */
export function canonicalOrder(cmds: readonly Stamped[]): Stamped[] {
  return [...cmds].sort((a, b) => a.seat - b.seat || a.seq - b.seq);
}
```
`packages/net/src/lockstep.ts`:
```ts
import type { Frame } from './frames';

/**
 * Buffers the room's frames and yields the ones a client may run now: every
 * frame up to `newest - bufferTicks`, in tick order, never skipping one.
 * A gap is REFUSED rather than bridged -- the transport asks the room for the
 * log (spec §3.2.6); a duplicate is ignored, which is what makes a replayed log
 * harmless to a client that already applied its head.
 */
export class LockstepClock {
  /** The tick the next `take` will yield first. */
  nextTick = 0;
  /** The newest tick received, -1 before the first frame. */
  newest = -1;
  private readonly frames = new Map<number, Frame>();

  constructor(readonly bufferTicks: number) {}

  push(frame: Frame): 'ok' | 'duplicate' | 'gap' {
    if (frame.tick < this.nextTick || this.frames.has(frame.tick)) return 'duplicate';
    if (frame.tick !== this.newest + 1) return 'gap';
    this.frames.set(frame.tick, frame);
    this.newest = frame.tick;
    return 'ok';
  }

  /** Frames runnable now, oldest first, at most `maxTicks` of them. */
  take(maxTicks: number): Frame[] {
    const out: Frame[] = [];
    while (out.length < maxTicks && this.nextTick <= this.newest - this.bufferTicks) {
      const f = this.frames.get(this.nextTick);
      if (f === undefined) break;
      this.frames.delete(this.nextTick);
      out.push(f);
      this.nextTick++;
    }
    return out;
  }

  /** Frames received and not yet run. */
  behind(): number {
    return this.newest - this.nextTick + 1;
  }
}
```
Append `export * from './lockstep';` to the barrel.

- [ ] **Step 4: Run, falsify, commit**

Run: `pnpm vitest run packages/net/src/lockstep.test.ts` → PASS.
Falsify: in `push`, replace `frame.tick !== this.newest + 1` with `false` → the gap test fails. Restore.
```bash
/usr/bin/git add packages/net/src/frames.ts packages/net/src/lockstep.ts packages/net/src/lockstep.test.ts packages/net/src/index.ts
/usr/bin/git commit -m "net: frames, the canonical order and the lockstep clock (N0 task 3)"
```

---

### Task 4: Ownership and `applyFrame`

**Files:**
- Create: `packages/net/src/ownership.ts`
- Test: `packages/net/src/ownership.test.ts`

**Interfaces:**
- Consumes: `Frame`, `Stamped`, `canonicalOrder`, `Seat`.
- Produces: `interface SeatWorld { sideOfSeat(seat: Seat): number; sideOfEntity(id: number): number | undefined }`; `validateCommand(cmd: Command, seat: Seat, world: SeatWorld): boolean`; `applyFrame(frame: Frame, sink: { queueCommand(cmd: Command): void }, world: SeatWorld): { queued: number; dropped: number }`.

- [ ] **Step 1: Write the failing test**

`packages/net/src/ownership.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { Command } from '@lions/sim';
import { validateCommand, applyFrame, type SeatWorld } from './ownership';

const world: SeatWorld = {
  sideOfSeat: (seat) => seat,                          // seat 0 → side 0, seat 1 → side 1
  sideOfEntity: (id) => (id < 10 ? 0 : id < 20 ? 1 : undefined),
};

describe('validateCommand', () => {
  it('accepts an order naming only the seat\'s own units', () => {
    expect(validateCommand({ kind: 'halt', ids: [1, 2] }, 0, world)).toBe(true);
  });
  it('drops an order naming a foreign unit, or one that does not exist', () => {
    expect(validateCommand({ kind: 'halt', ids: [1, 12] }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'halt', ids: [999999] }, 0, world)).toBe(false);
  });
  it('checks the carrier, the caller and the reveal side too', () => {
    expect(validateCommand({ kind: 'load', ids: [1], carrier: 12 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'callStrike', caller: 12, x: 0, y: 0 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'reveal', side: 1, x: 0, y: 0 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'reveal', side: 0, x: 0, y: 0 }, 0, world)).toBe(true);
  });
});

describe('applyFrame', () => {
  it('queues in canonical order and counts what it dropped', () => {
    const queued: Command[] = [];
    const r = applyFrame(
      { tick: 3, cmds: [
        { seat: 1, seq: 0, cmd: { kind: 'halt', ids: [11] } },
        { seat: 0, seq: 1, cmd: { kind: 'halt', ids: [1] } },
        { seat: 0, seq: 0, cmd: { kind: 'halt', ids: [12] } },
      ] },
      { queueCommand: (c) => queued.push(c) },
      world
    );
    expect(r).toEqual({ queued: 2, dropped: 1 });
    expect(queued).toEqual([{ kind: 'halt', ids: [1] }, { kind: 'halt', ids: [11] }]);
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run packages/net/src/ownership.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write ownership.ts**

```ts
import type { Command } from '@lions/sim';
import type { Seat } from './config';
import { canonicalOrder, type Frame } from './frames';

/** What ownership needs to know, answered from the live sim by the app
 *  (`st.side[id]`, with `id >= sim.count` undefined) and by a table in tests. */
export interface SeatWorld {
  sideOfSeat(seat: Seat): number;
  sideOfEntity(id: number): number | undefined;
}

/**
 * The ownership check every client runs identically before `queueCommand`
 * (spec §3.3): a command naming any entity not on the issuing seat's side is
 * dropped. The sim itself checks nothing (`sim.ts:1784`), and a tampered
 * client's order must vanish the same way on both machines, which is why this
 * is deterministic and here rather than in the room.
 */
export function validateCommand(cmd: Command, seat: Seat, world: SeatWorld): boolean {
  const side = world.sideOfSeat(seat);
  const own = (id: number): boolean => world.sideOfEntity(id) === side;
  switch (cmd.kind) {
    case 'move': case 'attackMove': case 'halt': case 'unload': case 'garrison': case 'demolish': case 'chargeTunnel': case 'smoke':
      return cmd.ids.length > 0 && cmd.ids.every(own);
    case 'load':
      return cmd.ids.length > 0 && cmd.ids.every(own) && own(cmd.carrier);
    case 'callStrike':
      return own(cmd.caller);
    case 'reveal':
      return cmd.side === side;
  }
}

export function applyFrame(
  frame: Frame,
  sink: { queueCommand(cmd: Command): void },
  world: SeatWorld
): { queued: number; dropped: number } {
  let queued = 0;
  let dropped = 0;
  for (const s of canonicalOrder(frame.cmds)) {
    if (validateCommand(s.cmd, s.seat, world)) {
      sink.queueCommand(s.cmd);
      queued++;
    } else {
      dropped++;
    }
  }
  return { queued, dropped };
}
```
Append `export * from './ownership';` to the barrel.

- [ ] **Step 4: Run, falsify, commit**

PASS; then falsify by making `validateCommand` return `true` unconditionally → three tests fail. Restore.
```bash
/usr/bin/git add packages/net/src/ownership.ts packages/net/src/ownership.test.ts packages/net/src/index.ts
/usr/bin/git commit -m "net: seat ownership check and applyFrame in canonical order (N0 task 4)"
```

---

### Task 5: The transport seam, `LocalTransport`, and the two-client test

**Files:**
- Create: `packages/net/src/transport.ts`, `tools/src/net/two-client.test.ts`
- Test: `packages/net/src/transport.test.ts`

**Interfaces:**
- Produces:
```ts
export type TransportStatus =
  | { kind: 'local' } | { kind: 'waiting' } | { kind: 'live'; behind: number }
  | { kind: 'stalled'; reason: StallReason | 'connecting'; seat: Seat | null }
  | { kind: 'desync'; tick: number } | { kind: 'closed'; reason: string };
export interface MatchTransport {
  readonly local: boolean;
  queueCommand(cmd: Command): void;
  take(maxTicks: number): Frame[];
  reportTick(tick: number, digest: number | null): void;
  status(): TransportStatus;
  close(): void;
}
export class LocalTransport implements MatchTransport
```

- [ ] **Step 1: Write the failing transport test**

`packages/net/src/transport.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { LocalTransport } from './transport';

describe('LocalTransport', () => {
  it('yields exactly the ticks asked for, with pending commands in the first frame, stamped as seat 0', () => {
    const t = new LocalTransport();
    t.queueCommand({ kind: 'halt', ids: [1] });
    t.queueCommand({ kind: 'halt', ids: [2] });
    const frames = t.take(3);
    expect(frames.map((f) => f.tick)).toEqual([0, 1, 2]);
    expect(frames[0].cmds).toEqual([
      { seat: 0, seq: 0, cmd: { kind: 'halt', ids: [1] } },
      { seat: 0, seq: 1, cmd: { kind: 'halt', ids: [2] } },
    ]);
    expect(frames[1].cmds).toEqual([]);
    expect(t.take(1)[0].tick).toBe(3);
    expect(t.status()).toEqual({ kind: 'local' });
    expect(t.local).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run packages/net/src/transport.test.ts` → FAIL.

- [ ] **Step 3: Write transport.ts**

```ts
import type { Command } from '@lions/sim';
import type { Seat } from './config';
import type { Frame, Stamped } from './frames';
import type { StallReason } from './protocol';

export type TransportStatus =
  | { kind: 'local' }
  | { kind: 'waiting' }
  | { kind: 'live'; behind: number }
  | { kind: 'stalled'; reason: StallReason | 'connecting'; seat: Seat | null }
  | { kind: 'desync'; tick: number }
  | { kind: 'closed'; reason: string };

/**
 * The one seam between the battlefield and wherever its frames come from
 * (spec §3.3). The battlefield asks for runnable ticks and hands over the
 * player's commands; it never knows whether a room exists.
 */
export interface MatchTransport {
  readonly local: boolean;
  /** `CommandSink`: what `applyIntent` writes to. */
  queueCommand(cmd: Command): void;
  /** Frames the battlefield may run now, oldest first. One sim tick per frame. */
  take(maxTicks: number): Frame[];
  /** After each tick: the tick number, and the match digest on hash ticks (else null). */
  reportTick(tick: number, digest: number | null): void;
  status(): TransportStatus;
  close(): void;
}

/** Single-player: a frame per requested tick, with zero delay, so today's
 *  behaviour ("a command queued between ticks runs on the next tick") is
 *  preserved exactly and the battlefield has one code path. */
export class LocalTransport implements MatchTransport {
  readonly local = true;
  private nextTick = 0;
  private seq = 0;
  private pending: Stamped[] = [];

  queueCommand(cmd: Command): void {
    this.pending.push({ seat: 0, seq: this.seq++, cmd });
  }
  take(maxTicks: number): Frame[] {
    const out: Frame[] = [];
    for (let i = 0; i < maxTicks; i++) {
      out.push({ tick: this.nextTick++, cmds: i === 0 ? this.pending : [] });
      if (i === 0) this.pending = [];
    }
    return out;
  }
  reportTick(): void {}
  status(): TransportStatus { return { kind: 'local' }; }
  close(): void {}
}
```
Append `export * from './transport';` to the barrel.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Write the two-client determinism test**

`tools/src/net/two-client.test.ts`:
```ts
// Two real sims on a real mission, fed ONE frame stream through the lockstep
// core, hashed every tick. The multiplayer sibling of `test:determinism`
// (spec §12). Runs under `pnpm test` (the `gates` job).
import { describe, it, expect } from 'vitest';
import { fx } from '@lions/sim';
import type { Command } from '@lions/sim';
import { LockstepClock, applyFrame, canonicalOrder, type Frame, type SeatWorld, type Stamped } from '@lions/net';
import { missionWorld } from '../mission-harness';

const MISSION = 'beit_sahwan_1_recon';
const TICKS = 1000;

/** Both seats on side 0, as N0's sandbox room is. */
function worldFor(sim: { count: number; state: { side: Uint8Array } }): SeatWorld {
  return { sideOfSeat: () => 0, sideOfEntity: (id) => (id >= 0 && id < sim.count ? sim.state.side[id] : undefined) };
}

/** A canned order script: every player unit marches to a few points. */
function script(playerIds: readonly number[]): Map<number, Stamped[]> {
  const at = (tick: number, seat: 0 | 1, seq: number, cmd: Command): [number, Stamped] => [tick, { seat, seq, cmd }];
  const half = Math.ceil(playerIds.length / 2);
  const a = playerIds.slice(0, half);
  const b = playerIds.slice(half);
  const entries: [number, Stamped][] = [
    at(10, 0, 0, { kind: 'move', ids: a, x: fx.from(20.5), y: fx.from(20.5) }),
    at(10, 1, 0, { kind: 'move', ids: b, x: fx.from(26.5), y: fx.from(18.5) }),
    at(300, 1, 1, { kind: 'attackMove', ids: b, x: fx.from(30.5), y: fx.from(24.5) }),
    at(300, 0, 1, { kind: 'halt', ids: a }),
    at(600, 0, 2, { kind: 'attackMove', ids: a, x: fx.from(32.5), y: fx.from(22.5) }),
  ];
  const byTick = new Map<number, Stamped[]>();
  for (const [tick, s] of entries) byTick.set(tick, [...(byTick.get(tick) ?? []), s]);
  return byTick;
}

function stream(byTick: Map<number, Stamped[]>, ticks: number): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < ticks; t++) frames.push({ tick: t, cmds: canonicalOrder(byTick.get(t) ?? []) });
  return frames;
}

function playerIdsOf(sim: { count: number; state: { side: Uint8Array; alive: Uint8Array } }): number[] {
  const ids: number[] = [];
  for (let i = 0; i < sim.count; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) ids.push(i);
  return ids;
}

function run(frames: Frame[], onTick: (tick: number, hash: number) => void): void {
  const w = missionWorld(MISSION, {});
  const clock = new LockstepClock(0);
  const world = worldFor(w.sim);
  for (const f of frames) {
    expect(clock.push(f)).toBe('ok');
    for (const ready of clock.take(1)) {
      applyFrame(ready, w.sim, world);
      w.runtime.step(w.sim.tick());
      onTick(ready.tick, w.sim.hash());
    }
  }
}

describe('two clients, one frame stream', () => {
  it('agree on every tick for 1000 ticks', () => {
    const probe = missionWorld(MISSION, {});
    const frames = stream(script(playerIdsOf(probe.sim)), TICKS);
    const a: number[] = [];
    const b: number[] = [];
    run(frames, (_, h) => a.push(h));
    run(frames, (_, h) => b.push(h));
    expect(a.length).toBe(TICKS);
    expect(a).toEqual(b);
    // The script did something: the state is not the idle state.
    const idle: number[] = [];
    run(stream(new Map(), TICKS), (_, h) => idle.push(h));
    expect(a[TICKS - 1]).not.toBe(idle[TICKS - 1]);
  });

  it('a dropped command on one side is visible to the instrument by the next hash', () => {
    const probe = missionWorld(MISSION, {});
    const frames = stream(script(playerIdsOf(probe.sim)), 40);
    const cut = frames.map((f) => (f.tick === 10 ? { tick: 10, cmds: f.cmds.slice(1) } : f));
    const a = new Map<number, number>();
    const b = new Map<number, number>();
    run(frames, (t, h) => a.set(t, h));
    run(cut, (t, h) => b.set(t, h));
    expect(a.get(9)).toBe(b.get(9));
    expect(a.get(20)).not.toBe(b.get(20));
  });

  it('an out-of-order frame is refused and runs nothing', () => {
    const clock = new LockstepClock(0);
    expect(clock.push({ tick: 0, cmds: [] })).toBe('ok');
    expect(clock.push({ tick: 2, cmds: [] })).toBe('gap');
    expect(clock.take(10).map((f) => f.tick)).toEqual([0]);
  });
});
```

- [ ] **Step 6: Run it**

Run: `pnpm vitest run tools/src/net/two-client.test.ts`
Expected: PASS in well under a minute (a 1000-tick mission replay is ~2 s). If the first test's "not idle" assertion fails, the chosen points are blocked on this map: pick open tiles from `maps.beit_sahwan_outskirts.rows` (a `.`) and re-run; do not weaken the assertion.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add packages/net/src/transport.ts packages/net/src/transport.test.ts packages/net/src/index.ts tools/src/net/two-client.test.ts
/usr/bin/git commit -m "net: MatchTransport seam, LocalTransport, and the two-client determinism test (N0 task 5)"
```

---

### Task 6: Tickets, room codes, and the Worker `Env`

**Files:**
- Create: `packages/worker/src/match/ticket.ts`, `packages/worker/src/match/code.ts`
- Modify: `packages/worker/src/d1.ts` (the `Env` interface)
- Test: `packages/worker/src/match/ticket.test.ts`, `packages/worker/src/match/code.test.ts`

**Interfaces:**
- Produces: `interface Ticket { matchId: string; seat: Seat; player: string; exp: number }`; `signTicket(secret: string, t: Ticket): Promise<string>`; `verifyTicket(secret: string, raw: string, now: number): Promise<Ticket | null>`; `CODE_ALPHABET`, `CODE_LENGTH = 6`, `mintCode(random: () => number): string`, `isCode(s: string): boolean`; `Env.ROOMS?: DurableObjectNamespaceLike`, `Env.ROOM_LIMIT?: RateLimiter`, `Env.TICKET_SECRET?: string`.

- [ ] **Step 1: Write the failing tests**

`packages/worker/src/match/ticket.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { signTicket, verifyTicket } from './ticket';

const NOW = 1_790_000_000_000;
const SECRET = 'a long random ticket secret';
const T = { matchId: 'm-1', seat: 1 as const, player: 'p-1', exp: NOW + 60_000 };

describe('tickets', () => {
  it('round-trips a fresh ticket', async () => {
    expect(await verifyTicket(SECRET, await signTicket(SECRET, T), NOW)).toEqual(T);
  });
  it('fails closed on expiry, a tampered seat, another secret, and garbage', async () => {
    expect(await verifyTicket(SECRET, await signTicket(SECRET, { ...T, exp: NOW - 1 }), NOW)).toBeNull();
    const raw = await signTicket(SECRET, T);
    const [payload, sig] = raw.split('.');
    const forged = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    forged.seat = 0;
    const forgedPayload = btoa(JSON.stringify(forged)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyTicket(SECRET, `${forgedPayload}.${sig}`, NOW)).toBeNull();
    expect(await verifyTicket('the stats password', raw, NOW)).toBeNull();
    expect(await verifyTicket(SECRET, 'nope', NOW)).toBeNull();
    expect(await verifyTicket(SECRET, '', NOW)).toBeNull();
  });
});
```
`packages/worker/src/match/code.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, mintCode, isCode } from './code';

describe('room codes', () => {
  it('uses the unambiguous alphabet only and is six long', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    let i = 0;
    const code = mintCode(() => ((i++ * 7) % 32) / 32);
    expect(code).toHaveLength(CODE_LENGTH);
    expect([...code].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    expect(isCode(code)).toBe(true);
  });
  it('rejects codes with 0, O, 1, I, lowercase, or the wrong length', () => {
    for (const bad of ['ABCDE0', 'ABCDEO', 'ABCDE1', 'ABCDEI', 'abcdef', 'ABCDE', 'ABCDEFG']) expect(isCode(bad)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch them fail** — `pnpm vitest run packages/worker/src/match` → FAIL (modules missing).

- [ ] **Step 3: Write ticket.ts, code.ts, and extend Env**

`packages/worker/src/match/ticket.ts`:
```ts
/** A seat ticket (spec §3.5): `b64url(json payload).b64url(HMAC-SHA256)` under
 *  TICKET_SECRET -- the same Web Crypto pattern as `../auth.ts`'s stats cookie,
 *  NEVER the same secret (rotating STATS_PASSWORD is how dashboard sessions
 *  are revoked). Sent in the first WebSocket message, never the URL. */
import type { Seat } from '@lions/net';

export interface Ticket { matchId: string; seat: Seat; player: string; exp: number }

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(`ticket:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signTicket(secret: string, t: Ticket): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(t)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyTicket(secret: string, raw: string, now: number): Promise<Ticket | null> {
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  let sig: Uint8Array;
  let t: unknown;
  try {
    sig = fromB64url(raw.slice(dot + 1));
    t = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', await key(secret), sig, new TextEncoder().encode(payload));
  if (!ok || typeof t !== 'object' || t === null) return null;
  const v = t as Record<string, unknown>;
  if (typeof v.matchId !== 'string' || (v.seat !== 0 && v.seat !== 1) || typeof v.player !== 'string' || typeof v.exp !== 'number') return null;
  if (v.exp <= now) return null;
  return { matchId: v.matchId, seat: v.seat, player: v.player, exp: v.exp };
}
```
`packages/worker/src/match/code.ts`:
```ts
/** Six characters from an alphabet with no 0/O/1/I (spec §4). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export function mintCode(random: () => number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length))];
  return s;
}
export function isCode(s: string): boolean {
  return s.length === CODE_LENGTH && [...s].every((ch) => CODE_ALPHABET.includes(ch));
}
```
In `packages/worker/src/d1.ts`, add to `Env`:
```ts
  /** N0: the MatchRoom Durable Object namespace (wrangler.jsonc `durable_objects`). */
  ROOMS?: DurableObjectNamespaceLike;
  /** N0: room creation and joins, keyed on the connecting IP (6 a minute). */
  ROOM_LIMIT?: RateLimiter;
  /** N0: signs seat tickets. Its own secret, never STATS_PASSWORD. Unset fails
   *  closed: every /api/match path answers 503. */
  TICKET_SECRET?: string;
```
and above `Env`:
```ts
export interface DurableObjectStubLike { fetch(request: Request): Promise<Response> }
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}
```

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/worker/src/match` → PASS. Falsify: in `verifyTicket` drop the `v.exp <= now` line → the expiry assertion fails; restore. Note that the test's second assertion already proves the signature covers the seat.
```bash
/usr/bin/git add packages/worker/src/match/ticket.ts packages/worker/src/match/ticket.test.ts packages/worker/src/match/code.ts packages/worker/src/match/code.test.ts packages/worker/src/d1.ts
/usr/bin/git commit -m "worker: seat tickets, room codes, and the Env bindings for MatchRoom (N0 task 6)"
```

---

### Task 7: The pure room state machine

**Files:**
- Create: `packages/worker/src/match/room-core.ts`
- Test: `packages/worker/src/match/room-core.test.ts`

**Interfaces:**
- Consumes: `ClientMsg`, `ServerMsg`, `Stamped`, `Frame`, `MatchConfig`, `Seat`, `MAX_CMDS_PER_SEAT_PER_FRAME` from `@lions/net`.
- Produces:
```ts
export type RoomStatus = 'lobby' | 'running' | 'stalled' | 'ended';
export interface RoomSeat { seat: Seat; player: string; callsign: string; connected: boolean; ready: boolean; lastAck: number; lastSeenMs: number; nextSeq: number }
export interface RoomState { code: string; matchId: string; createdMs: number; status: RoomStatus; config: MatchConfig | null; seats: [RoomSeat | null, RoomSeat | null]; tick: number; pending: Stamped[]; hashes: Record<number, [number | null, number | null]>; stall: { reason: 'behind' | 'gone'; seat: Seat } | null; endedReason: 'left' | 'void' | 'expired' | null }
export type Effect = { kind: 'send'; to: Seat | 'all'; msg: ServerMsg } | { kind: 'frame'; frame: Frame } | { kind: 'close'; seat: Seat };
export const ACK_EVERY = 10; export const STALL_BEHIND_TICKS = 40; export const STALL_SILENT_MS = 2000; export const ROOM_TTL_MS = 6 * 3600 * 1000;
export function createRoom(code: string, matchId: string, nowMs: number): RoomState;
export function seatJoin(st: RoomState, seat: Seat, player: string, callsign: string, nowMs: number): Effect[];   // from a verified hello
export function seatMessage(st: RoomState, seat: Seat, msg: ClientMsg, nowMs: number, mintConfig: () => MatchConfig): Effect[];
export function seatGone(st: RoomState, seat: Seat, nowMs: number): Effect[];
export function clockTick(st: RoomState, nowMs: number): Effect[];   // called every 50 ms while running or stalled
export function lobbyMsg(st: RoomState, you: Seat): ServerMsg;
```

- [ ] **Step 1: Write the failing test**

`packages/worker/src/match/room-core.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { MatchConfig } from '@lions/net';
import { createRoom, seatJoin, seatMessage, seatGone, clockTick, STALL_BEHIND_TICKS, STALL_SILENT_MS, type RoomState, type Effect } from './room-core';

const CONFIG: MatchConfig = {
  matchId: 'm1', code: 'ABCDEF', seed: 7, map: 'beit_sahwan_outskirts', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p0', callsign: 'Host', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p1', callsign: 'Guest', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
};
const mint = (): MatchConfig => CONFIG;
const sends = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { kind: 'send' }> => e.kind === 'send');
const frames = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { kind: 'frame' }> => e.kind === 'frame').map((e) => e.frame);

function running(): RoomState {
  const st = createRoom('ABCDEF', 'm1', 0);
  seatJoin(st, 0, 'p0', 'Host', 0);
  seatJoin(st, 1, 'p1', 'Guest', 0);
  seatMessage(st, 0, { t: 'ready' }, 0, mint);
  seatMessage(st, 1, { t: 'ready' }, 0, mint);
  return st;
}

describe('room-core', () => {
  it('starts when both seats are ready, and sends start with the config to both', () => {
    const st = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st, 0, 'p0', 'Host', 0);
    seatJoin(st, 1, 'p1', 'Guest', 0);
    seatMessage(st, 0, { t: 'ready' }, 0, mint);
    expect(st.status).toBe('lobby');
    const fx = seatMessage(st, 1, { t: 'ready' }, 0, mint);
    expect(st.status).toBe('running');
    expect(sends(fx).filter((s) => s.msg.t === 'start')).toHaveLength(1);
    expect(sends(fx).find((s) => s.msg.t === 'start')?.to).toBe('all');
  });

  it('emits one frame per clock tick with the pending commands stamped and ordered by seat then seq', () => {
    const st = running();
    seatMessage(st, 1, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [2] } }, 10, mint);
    seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } }, 11, mint);
    const [f0] = frames(clockTick(st, 50));
    expect(f0.tick).toBe(0);
    expect(f0.cmds.map((c) => [c.seat, c.seq])).toEqual([[0, 0], [1, 0]]);
    const [f1] = frames(clockTick(st, 100));
    expect(f1).toEqual({ tick: 1, cmds: [] });
    expect(st.tick).toBe(2);
  });

  it('re-stamps a seat\'s seq from its own counter, so a client cannot forge order', () => {
    const st = running();
    seatMessage(st, 0, { t: 'cmd', seq: 99, cmd: { kind: 'halt', ids: [1] } }, 10, mint);
    seatMessage(st, 0, { t: 'cmd', seq: 5, cmd: { kind: 'halt', ids: [1] } }, 11, mint);
    const [f] = frames(clockTick(st, 50));
    expect(f.cmds.map((c) => c.seq)).toEqual([0, 1]);
  });

  it('caps a seat at 32 commands per frame', () => {
    const st = running();
    for (let i = 0; i < 40; i++) seatMessage(st, 0, { t: 'cmd', seq: i, cmd: { kind: 'halt', ids: [1] } }, 10, mint);
    const [f] = frames(clockTick(st, 50));
    expect(f.cmds).toHaveLength(32);
  });

  it('stalls when a seat falls 40 ticks behind its acks, and resumes on the ack', () => {
    const st = running();
    for (let t = 0; t < STALL_BEHIND_TICKS; t++) {
      clockTick(st, 50 * (t + 1));
      seatMessage(st, 0, { t: 'ack', tick: t }, 50 * (t + 1), mint);
    }
    const fx = clockTick(st, 50 * (STALL_BEHIND_TICKS + 1));
    expect(st.status).toBe('stalled');
    expect(frames(fx)).toHaveLength(0);
    expect(sends(fx).find((s) => s.msg.t === 'stall')?.msg).toEqual({ t: 'stall', reason: 'behind', seat: 1 });
    const back = seatMessage(st, 1, { t: 'ack', tick: STALL_BEHIND_TICKS - 1 }, 50 * (STALL_BEHIND_TICKS + 2), mint);
    expect(st.status).toBe('running');
    expect(sends(back).some((s) => s.msg.t === 'resume')).toBe(true);
  });

  it('stalls when a seat is silent for 2 s and when its socket is gone', () => {
    const st = running();
    clockTick(st, 50);
    seatMessage(st, 0, { t: 'ack', tick: 0 }, 50, mint);
    seatMessage(st, 1, { t: 'ack', tick: 0 }, 50, mint);
    const fx = clockTick(st, 50 + STALL_SILENT_MS + 1);
    expect(st.status).toBe('stalled');
    expect(sends(fx).find((s) => s.msg.t === 'stall')?.msg).toMatchObject({ reason: 'gone' });
    const st2 = running();
    seatGone(st2, 1, 100);
    const fx2 = clockTick(st2, 150);
    expect(st2.status).toBe('stalled');
    expect(frames(fx2)).toHaveLength(0);
  });

  it('compares hashes per tick and voids the match on a mismatch', () => {
    const st = running();
    let fx = seatMessage(st, 0, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    expect(sends(fx)).toHaveLength(0);
    fx = seatMessage(st, 1, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'hashOk', tick: 20 }]);
    seatMessage(st, 0, { t: 'hash', tick: 40, h: 1 }, 0, mint);
    fx = seatMessage(st, 1, { t: 'hash', tick: 40, h: 2 }, 0, mint);
    expect(st.status).toBe('ended');
    expect(st.endedReason).toBe('void');
    expect(sends(fx).find((s) => s.msg.t === 'desync')?.msg).toEqual({ t: 'desync', tick: 40, hashes: [1, 2] });
  });

  it('a second hello for a seat replaces it and answers with the log; a full room refuses a third player', () => {
    const st = running();
    clockTick(st, 50);
    clockTick(st, 100);
    const fx = seatJoin(st, 1, 'p1', 'Guest', 200);
    const log = sends(fx).find((s) => s.msg.t === 'log')?.msg;
    expect(log && log.t === 'log' ? log.frames.map((f) => f.tick) : null).toEqual([0, 1]);
    const st2 = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st2, 0, 'p0', 'Host', 0);
    seatJoin(st2, 1, 'p1', 'Guest', 0);
    expect(st2.seats.every((s) => s !== null)).toBe(true);
  });

  it('expires six hours after creation', () => {
    const st = running();
    const fx = clockTick(st, 6 * 3600 * 1000 + 1);
    expect(st.status).toBe('ended');
    expect(sends(fx).find((s) => s.msg.t === 'ended')?.msg).toEqual({ t: 'ended', reason: 'expired' });
  });

  it('the persisted tick survives a simulated eviction: a new clock continues from it', () => {
    const st = running();
    clockTick(st, 50);
    clockTick(st, 100);
    const revived: RoomState = JSON.parse(JSON.stringify(st));
    const [f] = frames(clockTick(revived, 150));
    expect(f.tick).toBe(2);
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run packages/worker/src/match/room-core.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write room-core.ts**

```ts
/**
 * The MatchRoom's rules with no I/O: every input is a function call, every
 * output an `Effect`. The Durable Object (`match-room.ts`) is a thin shell
 * over this so the rules test under node (spec §12). The frame LOG is not
 * held here: the DO appends each `frame` effect to its SQLite table and
 * answers `log` from it; `seatJoin` asks for it through `readLog`.
 */
import {
  canonicalOrder, MAX_CMDS_PER_SEAT_PER_FRAME,
  type ClientMsg, type Frame, type MatchConfig, type Seat, type ServerMsg, type Stamped, type SeatState,
} from '@lions/net';

export type RoomStatus = 'lobby' | 'running' | 'stalled' | 'ended';
export interface RoomSeat {
  seat: Seat; player: string; callsign: string; connected: boolean; ready: boolean;
  /** The newest tick the seat has acknowledged; -1 before any. */
  lastAck: number;
  lastSeenMs: number;
  nextSeq: number;
}
export interface RoomState {
  code: string; matchId: string; createdMs: number;
  status: RoomStatus;
  config: MatchConfig | null;
  seats: [RoomSeat | null, RoomSeat | null];
  /** The tick the NEXT frame will carry. */
  tick: number;
  pending: Stamped[];
  hashes: Record<number, [number | null, number | null]>;
  stall: { reason: 'behind' | 'gone'; seat: Seat } | null;
  endedReason: 'left' | 'void' | 'expired' | null;
}
export type Effect =
  | { kind: 'send'; to: Seat | 'all'; msg: ServerMsg }
  | { kind: 'frame'; frame: Frame }
  | { kind: 'close'; seat: Seat };

export const ACK_EVERY = 10;
export const STALL_BEHIND_TICKS = 40;
export const STALL_SILENT_MS = 2000;
export const ROOM_TTL_MS = 6 * 3600 * 1000;

export function createRoom(code: string, matchId: string, nowMs: number): RoomState {
  return { code, matchId, createdMs: nowMs, status: 'lobby', config: null, seats: [null, null], tick: 0, pending: [], hashes: {}, stall: null, endedReason: null };
}

const seatStates = (st: RoomState): SeatState[] =>
  st.seats.flatMap((s) => (s ? [{ seat: s.seat, callsign: s.callsign, connected: s.connected, ready: s.ready }] : []));

export function lobbyMsg(st: RoomState, you: Seat): ServerMsg {
  return { t: 'lobby', config: st.config, seats: seatStates(st), you };
}

/** A verified hello. A second hello for an occupied seat REPLACES it (the
 *  reconnect path, spec §3.5); `readLog` supplies the frames for it. */
export function seatJoin(st: RoomState, seat: Seat, player: string, callsign: string, nowMs: number, readLog: () => Frame[] = () => []): Effect[] {
  const prior = st.seats[seat];
  st.seats[seat] = { seat, player, callsign, connected: true, ready: prior?.ready ?? false, lastAck: prior?.lastAck ?? -1, lastSeenMs: nowMs, nextSeq: prior?.nextSeq ?? 0 };
  const out: Effect[] = [];
  if (prior && prior.connected) out.push({ kind: 'close', seat });
  if (st.status === 'lobby') {
    out.push({ kind: 'send', to: 'all', msg: lobbyMsg(st, 0) });   // the DO rewrites `you` per socket
  } else if (st.config) {
    out.push({ kind: 'send', to: seat, msg: { t: 'log', config: st.config, frames: readLog() } });
    out.push(...recheckStall(st, nowMs));
  }
  return out;
}

export function seatGone(st: RoomState, seat: Seat, nowMs: number): Effect[] {
  const s = st.seats[seat];
  if (!s) return [];
  s.connected = false;
  s.lastSeenMs = nowMs;
  if (st.status === 'lobby') return [{ kind: 'send', to: 'all', msg: lobbyMsg(st, 0) }];
  return recheckStall(st, nowMs);
}

export function seatMessage(st: RoomState, seat: Seat, msg: ClientMsg, nowMs: number, mintConfig: () => MatchConfig): Effect[] {
  const s = st.seats[seat];
  if (!s) return [];
  s.lastSeenMs = nowMs;
  switch (msg.t) {
    case 'hello': return [];   // handled by the DO before seatJoin
    case 'ready': {
      if (st.status !== 'lobby') return [];
      s.ready = true;
      const both = st.seats[0]?.ready && st.seats[1]?.ready && st.seats[0]?.connected && st.seats[1]?.connected;
      if (!both) return [{ kind: 'send', to: 'all', msg: lobbyMsg(st, 0) }];
      st.config = mintConfig();
      st.status = 'running';
      return [{ kind: 'send', to: 'all', msg: { t: 'start', config: st.config } }];
    }
    case 'cmd': {
      if (st.status !== 'running' && st.status !== 'stalled') return [{ kind: 'send', to: seat, msg: { t: 'error', code: 'not_running' } }];
      if (st.pending.filter((p) => p.seat === seat).length >= MAX_CMDS_PER_SEAT_PER_FRAME) return [];
      st.pending.push({ seat, seq: s.nextSeq++, cmd: msg.cmd });
      return [];
    }
    case 'ack': {
      if (msg.tick > s.lastAck) s.lastAck = msg.tick;
      return recheckStall(st, nowMs);
    }
    case 'hash': {
      if (st.status === 'ended') return [];
      const pair = st.hashes[msg.tick] ?? [null, null];
      pair[seat] = msg.h;
      st.hashes[msg.tick] = pair;
      const [a, b] = pair;
      if (a === null || b === null) return [];
      delete st.hashes[msg.tick];
      if (a === b) return [{ kind: 'send', to: 'all', msg: { t: 'hashOk', tick: msg.tick } }];
      st.status = 'ended';
      st.endedReason = 'void';
      return [{ kind: 'send', to: 'all', msg: { t: 'desync', tick: msg.tick, hashes: [a, b] } }];
    }
    case 'bye': {
      if (st.status === 'ended') return [];
      st.status = 'ended';
      st.endedReason = 'left';
      return [{ kind: 'send', to: 'all', msg: { t: 'ended', reason: 'left' } }];
    }
  }
}

/** Why the clock must stop, if it must: the first seat that is gone, silent,
 *  or too far behind. Null means run. */
function stallFor(st: RoomState, nowMs: number): { reason: 'behind' | 'gone'; seat: Seat } | null {
  for (const s of st.seats) {
    if (!s) continue;
    if (!s.connected || nowMs - s.lastSeenMs > STALL_SILENT_MS) return { reason: 'gone', seat: s.seat };
    if (st.tick - 1 - s.lastAck > STALL_BEHIND_TICKS) return { reason: 'behind', seat: s.seat };
  }
  return null;
}

function recheckStall(st: RoomState, nowMs: number): Effect[] {
  if (st.status !== 'running' && st.status !== 'stalled') return [];
  const want = stallFor(st, nowMs);
  if (want && st.status === 'running') {
    st.status = 'stalled';
    st.stall = want;
    return [{ kind: 'send', to: 'all', msg: { t: 'stall', reason: want.reason, seat: want.seat } }];
  }
  if (!want && st.status === 'stalled') {
    st.status = 'running';
    st.stall = null;
    return [{ kind: 'send', to: 'all', msg: { t: 'resume' } }];
  }
  return [];
}

/** Every 50 ms while the match lives. One frame per call when running. */
export function clockTick(st: RoomState, nowMs: number): Effect[] {
  if (st.status === 'ended') return [];
  if (nowMs - st.createdMs > ROOM_TTL_MS) {
    st.status = 'ended';
    st.endedReason = 'expired';
    return [{ kind: 'send', to: 'all', msg: { t: 'ended', reason: 'expired' } }];
  }
  if (st.status === 'lobby') return [];
  const out: Effect[] = recheckStall(st, nowMs);
  if (st.status !== 'running') return out;
  const frame: Frame = { tick: st.tick, cmds: canonicalOrder(st.pending) };
  st.pending = [];
  st.tick++;
  out.push({ kind: 'frame', frame });
  out.push({ kind: 'send', to: 'all', msg: { t: 'frame', tick: frame.tick, cmds: frame.cmds } });
  return out;
}
```

- [ ] **Step 4: Run** — PASS. If the "stalls when a seat falls 40 ticks behind" test disagrees by one tick, the off-by-one is in `stallFor`'s `st.tick - 1 - s.lastAck`: `st.tick - 1` is the newest frame sent; a seat that acked it is 0 behind. Keep the test, fix the arithmetic.

- [ ] **Step 5: Falsify and commit**

Falsify: make `clockTick` skip `recheckStall` → both stall tests fail; restore. Make the hash branch compare `a === a` → the desync test fails; restore.
```bash
/usr/bin/git add packages/worker/src/match/room-core.ts packages/worker/src/match/room-core.test.ts
/usr/bin/git commit -m "worker: the pure MatchRoom state machine: lobby, metronome, stalls, hash compare (N0 task 7)"
```

---

### Task 8: The Durable Object, the routes, and the bindings

**Files:**
- Create: `packages/worker/src/do-types.ts`, `packages/worker/src/match/match-room.ts`, `packages/worker/src/match/routes.ts`
- Modify: `packages/worker/src/index.ts`, `wrangler.jsonc`
- Test: `packages/worker/src/match/routes.test.ts` (the HTTP half with a fake namespace); the DO itself is smoke-tested under `wrangler dev` (Step 7).

**Interfaces:**
- Consumes: `createRoom`, `seatJoin`, `seatMessage`, `seatGone`, `clockTick`, `lobbyMsg`, `Effect`; `signTicket`, `verifyTicket`; `mintCode`, `isCode`; `parseClientMsg`, `validateConfig`.
- Produces: `class MatchRoom` (exported from `index.ts`); `handleMatch(req: Request, env: Env, now: number): Promise<Response>` for `POST /api/match`, `POST /api/match/:code/join`, `GET /api/match/:code/ws`. Internal DO HTTP: `POST /create {matchId, code}`, `POST /join {callsign}` → `{seat}` or 409, `GET /ws` (upgrade), `GET /state` → `{status, seats}`.

- [ ] **Step 1: Write the failing routes test**

`packages/worker/src/match/routes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { handleMatch } from './routes';
import { verifyTicket } from './ticket';
import type { Env } from '../d1';

const NOW = 1_790_000_000_000;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';

/** A namespace whose every stub answers from one in-memory table of rooms. */
function fakeRooms(): { env: Env; created: string[] } {
  const rooms = new Map<string, { seats: number }>();
  const created: string[] = [];
  const stub = (name: string) => ({
    fetch: async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      if (path === '/create') { rooms.set(name, { seats: 1 }); created.push(name); return Response.json({ ok: true }); }
      if (path === '/state') return rooms.has(name) ? Response.json({ status: 'lobby', seats: rooms.get(name)!.seats }) : new Response('', { status: 404 });
      if (path === '/join') { const r = rooms.get(name); if (!r) return new Response('', { status: 404 }); if (r.seats >= 2) return new Response('', { status: 409 }); r.seats++; return Response.json({ seat: 1 }); }
      return new Response('', { status: 404 });
    },
  });
  const env = {
    DB: {} as Env['DB'], ASSETS: { fetch: async () => new Response('') },
    TICKET_SECRET: 'secret', ROOMS: { idFromName: (n: string) => n, get: (id: unknown) => stub(id as string) },
  } as unknown as Env;
  return { env, created };
}

const post = (url: string, body: unknown, origin = ORIGIN) =>
  new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('/api/match', () => {
  it('creates a room: a six-char code and a seat-0 ticket for the host', async () => {
    const { env, created } = fakeRooms();
    const res = await handleMatch(post(`${ORIGIN}/api/match`, { callsign: 'Host' }), env, NOW);
    expect(res.status).toBe(201);
    const body = await res.json() as { code: string; ticket: string; seat: number };
    expect(body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(body.seat).toBe(0);
    expect(created).toEqual([body.code]);
    const t = await verifyTicket('secret', body.ticket, NOW);
    expect(t?.seat).toBe(0);
    expect(t?.matchId).toBe(body.code);
  });
  it('joins a room as seat 1, then refuses a third', async () => {
    const { env } = fakeRooms();
    const { code } = await (await handleMatch(post(`${ORIGIN}/api/match`, { callsign: 'Host' }), env, NOW)).json() as { code: string };
    const join = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { callsign: 'Guest' }), env, NOW);
    expect(join.status).toBe(200);
    expect(((await join.json()) as { seat: number }).seat).toBe(1);
    expect((await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { callsign: 'Third' }), env, NOW)).status).toBe(409);
    expect((await handleMatch(post(`${ORIGIN}/api/match/ZZZZZZ/join`, { callsign: 'Lost' }), env, NOW)).status).toBe(404);
  });
  it('refuses a foreign or missing Origin, and fails closed with no TICKET_SECRET', async () => {
    const { env } = fakeRooms();
    expect((await handleMatch(post(`${ORIGIN}/api/match`, {}, 'https://evil.example'), env, NOW)).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/api/match`, { method: 'POST', body: '{}' });
    expect((await handleMatch(noOrigin, env, NOW)).status).toBe(403);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, {}), { ...env, TICKET_SECRET: undefined }, NOW)).status).toBe(503);
  });
  it('rejects a malformed code before touching a room', async () => {
    const { env } = fakeRooms();
    expect((await handleMatch(post(`${ORIGIN}/api/match/abc/join`, { callsign: 'x' }), env, NOW)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run packages/worker/src/match/routes.test.ts` → FAIL.

- [ ] **Step 3: Write do-types.ts**

`packages/worker/src/do-types.ts`:
```ts
/** The slice of the Durable Object API this Worker uses, hand-declared for
 *  the same reason `d1.ts` declares D1: `@cloudflare/workers-types` collides
 *  with the DOM lib the root typecheck runs under. */
export interface SqlRows { toArray(): Record<string, unknown>[] }
export interface DurableStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  sql: { exec(query: string, ...bindings: unknown[]): SqlRows };
}
export interface DurableStateLike {
  storage: DurableStorageLike;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}
export interface HibernatingSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
export type SocketPair = { 0: WebSocket; 1: WebSocket };
declare global {
  // eslint-disable-next-line no-var
  var WebSocketPair: { new (): SocketPair };
}
export type UpgradeInit = ResponseInit & { webSocket?: WebSocket };
```

- [ ] **Step 4: Write match-room.ts**

```ts
/**
 * One match (spec §3.2). A thin shell over `room-core.ts`: sockets in, effects
 * out, state in this object's storage. The WebSocket Hibernation API holds
 * the sockets; a 50 ms `setInterval` is the metronome while the match lives,
 * restarted by `ensureClock()` from every handler so an eviction never
 * strands a running match (Review Focus 5).
 */
import { parseClientMsg, validateConfig, type Frame, type MatchConfig, type Seat } from '@lions/net';
import type { Env } from '../d1';
import type { DurableStateLike, HibernatingSocket, UpgradeInit } from '../do-types';
import { createRoom, seatJoin, seatMessage, seatGone, clockTick, lobbyMsg, type Effect, type RoomState } from './room-core';
import { verifyTicket } from './ticket';

const TICK_MS = 50;
const SIM_SEED_N0 = 20260727;   // the app's SIM_SEED; N1 mints one per match
const CREATE_SQL = 'CREATE TABLE IF NOT EXISTS frame (tick INTEGER PRIMARY KEY, cmds TEXT NOT NULL)';

export class MatchRoom {
  private st: RoomState | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ctx: DurableStateLike, private readonly env: Env) {
    this.ctx.storage.sql.exec(CREATE_SQL);
  }

  private async load(): Promise<RoomState | null> {
    if (this.st) return this.st;
    this.st = (await this.ctx.storage.get<RoomState>('state')) ?? null;
    return this.st;
  }
  private async save(): Promise<void> {
    if (this.st) await this.ctx.storage.put('state', this.st);
  }
  private readLog(): Frame[] {
    return this.ctx.storage.sql.exec('SELECT tick, cmds FROM frame ORDER BY tick').toArray()
      .map((r) => ({ tick: r.tick as number, cmds: JSON.parse(r.cmds as string) as Frame['cmds'] }));
  }
  private mintConfig(st: RoomState): MatchConfig {
    const s = (seat: Seat) => st.seats[seat]!;
    return validateConfig({
      matchId: st.matchId, code: st.code, seed: SIM_SEED_N0, map: (this.mapId ?? 'beit_sahwan_outskirts'), mode: 'sandbox',
      seats: [0, 1].map((seat) => ({ seat, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: s(seat as Seat).player, callsign: s(seat as Seat).callsign, kind: 'human' })),
      pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: this.build ?? '', dataDigest: 0,
    })!;
  }
  private mapId: string | null = null;
  private build: string | null = null;

  private socketsFor(seat: Seat): HibernatingSocket[] {
    return this.ctx.getWebSockets(`seat:${seat}`) as HibernatingSocket[];
  }
  private send(to: Seat | 'all', msg: unknown): void {
    const seats: Seat[] = to === 'all' ? [0, 1] : [to];
    for (const seat of seats) {
      const text = JSON.stringify(msg && (msg as { t: string }).t === 'lobby' ? { ...(msg as object), you: seat } : msg);
      for (const ws of this.socketsFor(seat)) { try { ws.send(text); } catch { /* closing */ } }
    }
  }
  private async apply(effects: Effect[]): Promise<void> {
    for (const e of effects) {
      if (e.kind === 'send') this.send(e.to, e.msg);
      else if (e.kind === 'frame') this.ctx.storage.sql.exec('INSERT OR REPLACE INTO frame (tick, cmds) VALUES (?, ?)', e.frame.tick, JSON.stringify(e.frame.cmds));
      else if (e.kind === 'close') {
        const [, ...older] = this.socketsFor(e.seat).reverse();   // keep the newest socket
        for (const ws of older) { try { ws.close(4000, 'replaced'); } catch { /* already gone */ } }
      }
    }
    await this.save();
    this.ensureClock();
  }
  private ensureClock(): void {
    const st = this.st;
    const live = st !== null && (st.status === 'running' || st.status === 'stalled');
    if (live && this.clock === null) {
      this.clock = setInterval(() => { void this.onClock(); }, TICK_MS);
    } else if (!live && this.clock !== null) {
      clearInterval(this.clock);
      this.clock = null;
    }
  }
  private async onClock(): Promise<void> {
    const st = await this.load();
    if (!st) return;
    await this.apply(clockTick(st, Date.now()));
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const st = await this.load();
    if (pathname === '/create' && req.method === 'POST') {
      if (st) return new Response('exists', { status: 409 });
      const body = (await req.json()) as { code: string; matchId: string; map: string; build: string };
      this.st = createRoom(body.code, body.matchId, Date.now());
      this.mapId = body.map;
      this.build = body.build;
      await this.ctx.storage.put('meta', { map: body.map, build: body.build });
      await this.save();
      return Response.json({ ok: true });
    }
    if (!st) return new Response('no such room', { status: 404 });
    if (pathname === '/state') return Response.json({ status: st.status, seats: st.seats.filter((s) => s !== null).length });
    if (pathname === '/join' && req.method === 'POST') {
      if (st.seats[1] !== null) return new Response('full', { status: 409 });
      return Response.json({ seat: 1 });
    }
    if (pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1] as HibernatingSocket;
      this.ctx.acceptWebSocket(server);   // tagged after hello, see webSocketMessage
      server.serializeAttachment({ seat: null });
      return new Response(null, { status: 101, webSocket: client } as UpgradeInit);
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const st = await this.load();
    if (!st) { ws.close(4004, 'no room'); return; }
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const msg = parseClientMsg(raw);
    const hws = ws as HibernatingSocket;
    const att = hws.deserializeAttachment() as { seat: Seat | null };
    if (msg === null) { ws.send(JSON.stringify({ t: 'error', code: 'bad_message' })); return; }
    if (att.seat === null) {
      if (msg.t !== 'hello') { ws.send(JSON.stringify({ t: 'error', code: 'bad_ticket' })); ws.close(4001, 'hello first'); return; }
      const secret = this.env.TICKET_SECRET;
      const ticket = secret ? await verifyTicket(secret, msg.ticket, Date.now()) : null;
      if (!ticket || ticket.matchId !== st.matchId) { ws.send(JSON.stringify({ t: 'error', code: 'bad_ticket' })); ws.close(4001, 'bad ticket'); return; }
      const meta = await this.ctx.storage.get<{ map: string; build: string }>('meta');
      this.mapId = meta?.map ?? this.mapId;
      this.build = meta?.build ?? this.build;
      if (this.build && msg.build !== this.build) { ws.send(JSON.stringify({ t: 'error', code: 'build_mismatch' })); ws.close(4002, 'build'); return; }
      hws.serializeAttachment({ seat: ticket.seat });
      // Re-tag: the hibernation API tags at accept time, so re-accept is not
      // available; `socketsFor` therefore ALSO scans untagged sockets by
      // attachment. See `socketsFor`.
      const callsign = (st.seats[ticket.seat]?.callsign) ?? `Seat ${ticket.seat}`;
      await this.apply(seatJoin(st, ticket.seat, ticket.player, callsign, Date.now(), () => this.readLog()));
      return;
    }
    await this.apply(seatMessage(st, att.seat, msg, Date.now(), () => this.mintConfig(st)));
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const st = await this.load();
    const att = (ws as HibernatingSocket).deserializeAttachment() as { seat: Seat | null };
    if (!st || att.seat === null) return;
    if (this.socketsFor(att.seat).some((s) => s !== ws)) return;   // a replacement is live
    await this.apply(seatGone(st, att.seat, Date.now()));
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }
}
```
Then make `socketsFor` honour the attachment rather than a tag (the hibernation API tags only at `acceptWebSocket`, before the seat is known):
```ts
  private socketsFor(seat: Seat): HibernatingSocket[] {
    return (this.ctx.getWebSockets() as HibernatingSocket[]).filter((ws) => {
      const a = ws.deserializeAttachment() as { seat: Seat | null } | null;
      return a !== null && a.seat === seat;
    });
  }
```
(Delete the tag-based version above; keep one.)

- [ ] **Step 5: Write routes.ts and wire index.ts**

`packages/worker/src/match/routes.ts`:
```ts
/** `/api/match*` (spec §3.2.1): create, join, and the socket upgrade. Origin
 *  is REQUIRED (the `/api/feedback` rule, not `/api/events`'s). */
import type { Env } from '../d1';
import { signTicket } from './ticket';
import { mintCode, isCode } from './code';

const TICKET_MS = 6 * 3600 * 1000;

function originOk(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const own = new URL(req.url).origin;
  return origin === own;
}

export async function handleMatch(req: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(req.url);
  if (!originOk(req)) return new Response('origin', { status: 403 });
  if (!env.TICKET_SECRET || !env.ROOMS) return new Response('matches are not configured', { status: 503 });
  if (env.ROOM_LIMIT) {
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.ROOM_LIMIT.limit({ key: ip });
    if (!success) return new Response('slow down', { status: 429 });
  }
  const m = url.pathname.match(/^\/api\/match(?:\/([^/]+)\/(join|ws))?$/);
  if (!m) return new Response('not found', { status: 404 });
  const [, code, action] = m;
  const readBody = async (): Promise<{ callsign?: string; map?: string; build?: string }> => {
    try { return (await req.json()) as { callsign?: string; map?: string; build?: string }; } catch { return {}; }
  };
  const callsignOf = (b: { callsign?: string }): string => (typeof b.callsign === 'string' ? b.callsign.slice(0, 24) : 'Lion');

  if (!code) {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    const body = await readBody();
    for (let attempt = 0; attempt < 5; attempt++) {
      const c = mintCode(Math.random);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(c));
      const res = await stub.fetch(new Request(`https://room/create`, {
        method: 'POST', body: JSON.stringify({ code: c, matchId: c, map: body.map ?? 'beit_sahwan_outskirts', build: body.build ?? '' }),
      }));
      if (res.status === 409) continue;
      const ticket = await signTicket(env.TICKET_SECRET, { matchId: c, seat: 0, player: callsignOf(body), exp: now + TICKET_MS });
      return Response.json({ code: c, seat: 0, ticket }, { status: 201 });
    }
    return new Response('no free code', { status: 503 });
  }
  if (!isCode(code)) return new Response('bad code', { status: 400 });
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  if (action === 'join') {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    const body = await readBody();
    const res = await stub.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ callsign: callsignOf(body) }) }));
    if (res.status !== 200) return new Response('', { status: res.status });
    const { seat } = (await res.json()) as { seat: 0 | 1 };
    const ticket = await signTicket(env.TICKET_SECRET, { matchId: code, seat, player: callsignOf(body), exp: now + TICKET_MS });
    return Response.json({ code, seat, ticket });
  }
  // action === 'ws'
  return stub.fetch(new Request('https://room/ws', req));
}
```
(N0's `player` field carries the callsign the client sent; N1 replaces it with the anonymous player id and the callsign goes in the lobby message. The DO's `seatJoin` receives it either way.)

`packages/worker/src/index.ts`: add
```ts
import { handleMatch } from './match/routes';
export { MatchRoom } from './match/match-room';
```
and in `fetch`, before the `/stats` line:
```ts
    if (pathname === '/api/match' || pathname.startsWith('/api/match/')) return handleMatch(req, env, Date.now());
```

- [ ] **Step 6: Bindings in `wrangler.jsonc`**

Add after `d1_databases`:
```jsonc
	// N0 (network design §3.2): one Durable Object per match, SQLite-backed.
	// The class is exported from packages/worker/src/index.ts. The migration
	// tag must land in the same deploy as the export.
	"durable_objects": {
		"bindings": [{ "name": "ROOMS", "class_name": "MatchRoom" }]
	},
	"migrations": [{ "tag": "net-v1", "new_sqlite_classes": ["MatchRoom"] }],
```
and to `ratelimits`:
```jsonc
		// N0: POST /api/match and /join, per connecting IP.
		{ "name": "ROOM_LIMIT", "namespace_id": "1004", "simple": { "limit": 6, "period": 60 } }
```

- [ ] **Step 7: Run the tests, then the smoke under `wrangler dev`**

Run: `pnpm vitest run packages/worker/src/match && pnpm lint && pnpm typecheck` → PASS. If `tsc` rejects `new Response(null, { status: 101, webSocket })`, the cast to `UpgradeInit` is missing.

Smoke (local only, needs a built app for the assets binding; do not deploy):
```bash
pnpm build
npx wrangler secret put TICKET_SECRET --local   # or: echo 'TICKET_SECRET=dev-secret' > .dev.vars
npx wrangler dev --port 8787
```
In a second terminal:
```bash
curl -s -X POST -H 'origin: http://localhost:8787' -H 'content-type: application/json' -d '{"callsign":"Host","map":"beit_sahwan_outskirts","build":"dev"}' http://localhost:8787/api/match
```
Expected: 201 with `{code, seat: 0, ticket}`. Then with a tiny Node script using the global `WebSocket` (Node 22+): open `ws://localhost:8787/api/match/<code>/ws` with header `origin: http://localhost:8787`, send `{"t":"hello","ticket":"<ticket>","build":"dev"}`, expect a `lobby` message with `you: 0`. Record the transcript in the task report. Add `.dev.vars` to `.gitignore` if it is not already there.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add packages/worker/src/do-types.ts packages/worker/src/match/match-room.ts packages/worker/src/match/routes.ts packages/worker/src/match/routes.test.ts packages/worker/src/index.ts wrangler.jsonc .gitignore
/usr/bin/git commit -m "worker: MatchRoom Durable Object, /api/match routes, bindings and migration (N0 task 8)"
```

---

### Task 9: `WsTransport`

**Files:**
- Create: `packages/net/src/ws-transport.ts`
- Test: `packages/net/src/ws-transport.test.ts`

**Interfaces:**
- Consumes: `LockstepClock`, `parseServerMsg`, `ClientMsg`, `MatchTransport`, `TransportStatus`, `MatchConfig`.
- Produces:
```ts
export interface SocketLike { send(data: string): void; close(): void; onopen: ((ev: unknown) => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: ((ev: unknown) => void) | null }
export interface WsTransportHooks { onLobby?(seats: SeatState[], you: Seat): void; onStart(config: MatchConfig): void; onDesync?(tick: number, hashes: [number, number]): void; onEnded?(reason: string): void; onError?(code: string): void }
export class WsTransport implements MatchTransport {
  constructor(open: () => SocketLike, ticket: string, build: string, hooks: WsTransportHooks);
  ready(): void;   // sends `ready`
  readonly config: MatchConfig | null;
}
```

- [ ] **Step 1: Write the failing test** (a fake socket, no network)

`packages/net/src/ws-transport.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { WsTransport, type SocketLike } from './ws-transport';
import type { MatchConfig } from './config';

const CONFIG: MatchConfig = {
  matchId: 'm', code: 'ABCDEF', seed: 1, map: 'x', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'A', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'B', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
};

function fakeSocket(): SocketLike & { sent: string[]; open(): void; recv(msg: unknown): void; closeFromServer(): void; opened: number } {
  const s: SocketLike & { sent: string[]; open(): void; recv(msg: unknown): void; closeFromServer(): void; opened: number } = {
    sent: [], opened: 0, onopen: null, onmessage: null, onclose: null,
    send: (d) => { s.sent.push(d); },
    close: () => { s.onclose?.({}); },
    open: () => { s.opened++; s.onopen?.({}); },
    recv: (msg) => { s.onmessage?.({ data: JSON.stringify(msg) }); },
    closeFromServer: () => { s.onclose?.({}); },
  };
  return s;
}

describe('WsTransport', () => {
  it('sends hello on open, start arrives, frames feed take() two behind, commands and acks go out', () => {
    const sock = fakeSocket();
    let started: MatchConfig | null = null;
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: (c) => { started = c; } });
    sock.open();
    expect(JSON.parse(sock.sent[0])).toEqual({ t: 'hello', ticket: 'tkt', build: 'b' });
    expect(t.status()).toEqual({ kind: 'waiting' });
    sock.recv({ t: 'start', config: CONFIG });
    expect(started).toEqual(CONFIG);
    t.queueCommand({ kind: 'halt', ids: [1] });
    expect(JSON.parse(sock.sent[1])).toEqual({ t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } });
    for (let tick = 0; tick < 3; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    expect(t.take(10).map((f) => f.tick)).toEqual([0]);
    t.reportTick(0, null);
    for (let tick = 1; tick <= 9; tick++) t.reportTick(tick, null);
    expect(JSON.parse(sock.sent[2])).toEqual({ t: 'ack', tick: 9 });
    t.reportTick(20, 12345);
    expect(JSON.parse(sock.sent[3])).toEqual({ t: 'hash', tick: 20, h: 12345 });
    expect(t.status()).toEqual({ kind: 'live', behind: 2 });
  });
  it('a stall is reported and cleared; a desync ends the transport', () => {
    const sock = fakeSocket();
    let desync: [number, number] | null = null;
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onDesync: (_, h) => { desync = h; } });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'stall', reason: 'behind', seat: 1 });
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'behind', seat: 1 });
    sock.recv({ t: 'resume' });
    expect(t.status()).toEqual({ kind: 'live', behind: 0 });
    sock.recv({ t: 'desync', tick: 40, hashes: [1, 2] });
    expect(desync).toEqual([1, 2]);
    expect(t.status()).toEqual({ kind: 'desync', tick: 40 });
  });
  it('reconnects on close with the same ticket and ignores the log frames it already ran', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    for (let tick = 0; tick < 5; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    expect(t.take(10).map((f) => f.tick)).toEqual([0, 1, 2]);
    sock.closeFromServer();
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'connecting', seat: null });
    sock.open();
    expect(sock.opened).toBe(2);
    sock.recv({ t: 'log', config: CONFIG, frames: Array.from({ length: 8 }, (_, tick) => ({ tick, cmds: [] })) });
    expect(t.take(10).map((f) => f.tick)).toEqual([3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run packages/net/src/ws-transport.test.ts` → FAIL.

- [ ] **Step 3: Write ws-transport.ts**

```ts
/**
 * The room's client (spec §3.3): one socket, the lockstep clock behind it,
 * acks every ACK_EVERY ticks, hashes on hash ticks, and a reconnect that
 * reopens with the same ticket and lets `LockstepClock` discard the head of
 * the log it already ran. Takes a socket FACTORY so tests pass a fake and
 * the browser passes `() => new WebSocket(url)`.
 */
import type { Command } from '@lions/sim';
import type { MatchConfig, Seat } from './config';
import type { Frame } from './frames';
import { LockstepClock } from './lockstep';
import { parseServerMsg, type ClientMsg, type SeatState, type ServerMsg } from './protocol';
import type { MatchTransport, TransportStatus } from './transport';

export const ACK_EVERY = 10;
export const RECONNECT_DELAY_MS = 1000;

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export interface WsTransportHooks {
  onLobby?(seats: SeatState[], you: Seat): void;
  onStart(config: MatchConfig): void;
  onDesync?(tick: number, hashes: [number, number]): void;
  onEnded?(reason: string): void;
  onError?(code: string): void;
}

export class WsTransport implements MatchTransport {
  readonly local = false;
  config: MatchConfig | null = null;
  private clock = new LockstepClock(2);
  private sock: SocketLike | null = null;
  private seq = 0;
  private closed = false;
  private st: TransportStatus = { kind: 'waiting' };
  private stalled: Extract<TransportStatus, { kind: 'stalled' }> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly open: () => SocketLike,
    private readonly ticket: string,
    private readonly build: string,
    private readonly hooks: WsTransportHooks,
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout
  ) {
    this.connect();
  }

  private connect(): void {
    const s = this.open();
    this.sock = s;
    s.onopen = () => this.send({ t: 'hello', ticket: this.ticket, build: this.build });
    s.onmessage = (ev) => this.onMessage(typeof ev.data === 'string' ? ev.data : '');
    s.onclose = () => {
      if (this.closed || this.st.kind === 'desync' || this.st.kind === 'closed') return;
      this.stalled = { kind: 'stalled', reason: 'connecting', seat: null };
      this.st = this.stalled;
      this.reconnectTimer = this.schedule(() => this.connect(), RECONNECT_DELAY_MS);
    };
  }
  private send(msg: ClientMsg): void {
    try { this.sock?.send(JSON.stringify(msg)); } catch { /* closing; the reconnect carries on */ }
  }
  private onMessage(raw: string): void {
    const msg = parseServerMsg(raw);
    if (msg === null) return;
    this.handle(msg);
  }
  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'lobby': this.hooks.onLobby?.(msg.seats, msg.you); return;
      case 'start':
        this.config = msg.config;
        this.clock = new LockstepClock(msg.config.bufferTicks);
        this.st = { kind: 'live', behind: 0 };
        this.hooks.onStart(msg.config);
        return;
      case 'log':
        if (this.config === null) { this.config = msg.config; this.clock = new LockstepClock(msg.config.bufferTicks); this.hooks.onStart(msg.config); }
        for (const f of msg.frames) this.clock.push(f);
        this.stalled = null;
        this.st = { kind: 'live', behind: this.clock.behind() };
        return;
      case 'frame': {
        const r = this.clock.push({ tick: msg.tick, cmds: msg.cmds });
        if (r === 'gap') { this.sock?.close(); return; }   // the reconnect fetches the log
        if (this.stalled === null) this.st = { kind: 'live', behind: this.clock.behind() };
        return;
      }
      case 'stall': this.stalled = { kind: 'stalled', reason: msg.reason, seat: msg.seat }; this.st = this.stalled; return;
      case 'resume': this.stalled = null; this.st = { kind: 'live', behind: this.clock.behind() }; return;
      case 'hashOk': return;
      case 'desync': this.st = { kind: 'desync', tick: msg.tick }; this.hooks.onDesync?.(msg.tick, msg.hashes); return;
      case 'ended': this.st = { kind: 'closed', reason: msg.reason }; this.hooks.onEnded?.(msg.reason); return;
      case 'error': this.hooks.onError?.(msg.code); if (msg.code === 'bad_ticket' || msg.code === 'build_mismatch') this.st = { kind: 'closed', reason: msg.code }; return;
    }
  }

  ready(): void { this.send({ t: 'ready' }); }
  queueCommand(cmd: Command): void { this.send({ t: 'cmd', seq: this.seq++, cmd }); }
  take(maxTicks: number): Frame[] {
    if (this.st.kind !== 'live') return [];
    const out = this.clock.take(maxTicks);
    this.st = { kind: 'live', behind: this.clock.behind() };
    return out;
  }
  reportTick(tick: number, digest: number | null): void {
    if (tick % ACK_EVERY === ACK_EVERY - 1) this.send({ t: 'ack', tick });
    if (digest !== null) this.send({ t: 'hash', tick, h: digest });
  }
  status(): TransportStatus { return this.st; }
  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.send({ t: 'bye' });
    this.sock?.close();
    this.st = { kind: 'closed', reason: 'left' };
  }
}
```
Append `export * from './ws-transport';` to the barrel. In the test's reconnect case the fake's `schedule` default (`setTimeout`) would delay the reconnect: pass `(fn) => { fn(); return 0 as never; }` as the fifth constructor argument in that test, or use `vi.useFakeTimers()` and `vi.runAllTimers()` after `closeFromServer()`. Use the fake-timers form.

- [ ] **Step 4: Run, falsify, commit**

PASS. Falsify: in `take`, drop the `this.st.kind !== 'live'` guard → the reconnect test yields frames while `connecting`... (it does not, since the clock holds them; instead falsify `reportTick` by sending the ack on every tick → the ack assertion fails). Restore.
```bash
/usr/bin/git add packages/net/src/ws-transport.ts packages/net/src/ws-transport.test.ts packages/net/src/index.ts
/usr/bin/git commit -m "net: WsTransport with acks, hashes, stalls and reconnect (N0 task 9)"
```

---

### Task 10: Sandbox boot determinism (`Math.atan2`, `Math.hypot`)

**Files:**
- Modify: `packages/app/src/main.ts` (~line 421, the `turns`/`facing` pair in `sandboxSpawns`), `packages/app/src/sandbox-anchors.ts` (the `dist` helper, ~line 56)
- Test: `packages/app/src/sandbox-anchors.test.ts` (extend; create if absent), `packages/app/src/sandbox-facing.test.ts`

**Interfaces:**
- Produces: `export function hostileFacing(fxA: number, fyA: number, hxA: number, hyA: number): Fx` in a new `packages/app/src/sandbox-facing.ts`, called from `sandboxSpawns`.

- [ ] **Step 1: Write the failing tests**

`packages/app/src/sandbox-facing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ONE } from '@lions/sim';
import { hostileFacing } from './sandbox-facing';

describe('hostileFacing', () => {
  it('matches the old Math.atan2 conversion within 2 Q16.16 units on a sweep of offsets', () => {
    for (let dx = -40; dx <= 40; dx += 7) {
      for (let dy = -40; dy <= 40; dy += 5) {
        if (dx === 0 && dy === 0) continue;
        const turns = Math.atan2(dy, dx) / (Math.PI * 2);
        const old = Math.round((turns - Math.floor(turns)) * ONE) % ONE;
        const now = hostileFacing(0, 0, -dx, -dy);   // friendly - hostile = (dx, dy)
        const diff = Math.min(Math.abs(now - old), ONE - Math.abs(now - old));
        expect(diff).toBeLessThanOrEqual(2);
      }
    }
  });
  it('uses no transcendental Math', () => {
    // Read the source: the point is the engine-independence of the BOOT.
    const src = require('node:fs').readFileSync(new URL('./sandbox-facing.ts', import.meta.url), 'utf8') as string;
    expect(src).not.toMatch(/Math\.(atan2|sin|cos|hypot|PI)/);
  });
});
```
Extend `packages/app/src/sandbox-anchors.test.ts` (create the file if it does not exist) with:
```ts
import { describe, it, expect } from 'vitest';
import { maps } from '@lions/data';
import { sandboxAnchors } from './sandbox-anchors';

describe('sandboxAnchors is engine-independent', () => {
  it('picks the same anchors on every shipped map as the Math.hypot rule did', () => {
    // Pinned from the Math.hypot implementation on 2026-10-11; regenerate ONLY
    // by running the old code, never by copying the new output.
    const pinned: Record<string, { friendly: number[]; hostile: number[] }> = JSON.parse(
      require('node:fs').readFileSync(new URL('./sandbox-anchors.pinned.json', import.meta.url), 'utf8')
    );
    for (const [id, map] of Object.entries(maps)) {
      expect(sandboxAnchors(map as Parameters<typeof sandboxAnchors>[0]), id).toEqual(pinned[id]);
    }
  });
  it('uses no Math.hypot', () => {
    const src = require('node:fs').readFileSync(new URL('./sandbox-anchors.ts', import.meta.url), 'utf8') as string;
    expect(src).not.toMatch(/Math\.hypot/);
  });
});
```
Before changing `sandbox-anchors.ts`, generate the pin with the OLD code: a one-off `tsx` script that imports `sandboxAnchors` and `maps` and writes `packages/app/src/sandbox-anchors.pinned.json` (`{ "<map id>": { friendly, hostile } }` for every map). Commit the JSON with the test.

- [ ] **Step 2: Run and watch them fail** — the facing test fails on the missing module; the anchors "no Math.hypot" test fails on the source match.

- [ ] **Step 3: Implement**

`packages/app/src/sandbox-facing.ts`:
```ts
import { fx, type Fx } from '@lions/sim';

/** The facing of a hostile placed at (hx, hy) looking at the friendly anchor
 *  (fx, fy): Q16.16 turns in [0, ONE), through the sim's own LUT atan2 so a
 *  Firefox and a Chrome boot agree to the bit (network design §7.4 item 5).
 *  The old `Math.atan2(...) / (Math.PI * 2)` is not IEEE-reproducible across
 *  engines; `fx.atan2` takes raw integers and the scale cancels. */
export function hostileFacing(fxA: number, fyA: number, hxA: number, hyA: number): Fx {
  return fx.atan2(fyA - hyA, fxA - hxA);
}
```
In `main.ts`'s `sandboxSpawns`, replace the two lines
```ts
  const turns = Math.atan2(fyA - hyA, fxA - hxA) / (Math.PI * 2);
  const facing = fx.from(turns - Math.floor(turns));
```
with
```ts
  const facing = hostileFacing(fxA, fyA, hxA, hyA);
```
and import `hostileFacing` from `./sandbox-facing`. In `sandbox-anchors.ts` replace
```ts
const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
```
with
```ts
// `Math.sqrt` is IEEE-exact on every engine; `Math.hypot` is not, and this
// pick moves every sandbox spawn, the tunnel, the ditch and the refuge.
const dist = (a: Point, b: Point): number => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
```

- [ ] **Step 4: Run the tests and the determinism gate**

Run: `pnpm vitest run packages/app/src/sandbox-facing.test.ts packages/app/src/sandbox-anchors.test.ts && pnpm test:determinism` → PASS (the golden hashes are mission replays; the sandbox is not in them).

- [ ] **Step 5: Falsify and commit**

Falsify the pin: edit one value in the JSON → the anchors test names the map; restore.
```bash
/usr/bin/git add packages/app/src/sandbox-facing.ts packages/app/src/sandbox-facing.test.ts packages/app/src/sandbox-anchors.ts packages/app/src/sandbox-anchors.test.ts packages/app/src/sandbox-anchors.pinned.json packages/app/src/main.ts
/usr/bin/git commit -m "app: sandbox boot uses fx.atan2 and sqrt, pinned against the old picks on every map (N0 task 10)"
```

---

### Task 11: The battlefield on a transport

**Files:**
- Create: `packages/app/src/net/connect.ts`
- Modify: `packages/app/src/main.ts` (top of `bootBattlefield` ~1333; the `new Sim` at ~1613; the flag read at ~1553; `dispatch` at ~3450; the frame loop at ~5198; `__lions` at ~4884), `packages/app/src/sandbox-help.ts` (`KNOWN_PARAMS`), `packages/app/vite.config.ts` (`server.proxy`), `packages/app/src/i18n/en.json` (four strings)
- Test: `packages/app/src/net/connect.test.ts`

**Interfaces:**
- Consumes: `MatchTransport`, `LocalTransport`, `WsTransport`, `applyFrame`, `matchDigest`, `MatchConfig`, `Seat`.
- Produces: `connectMatch(query: URLSearchParams, mapId: string, build: string, opts: { fetch: typeof fetch; origin: string; openSocket: (url: string) => SocketLike; replaceUrl: (code: string, seat: Seat) => void; note: (text: string) => void }): Promise<{ transport: MatchTransport; seat: Seat | null; config: MatchConfig | null }>`.

- [ ] **Step 1: Write the failing connect test**

`packages/app/src/net/connect.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { connectMatch } from './connect';

const noSocket = () => { throw new Error('no socket expected'); };

describe('connectMatch', () => {
  it('returns a LocalTransport with no ?net', async () => {
    const r = await connectMatch(new URLSearchParams(''), 'm', 'b', { fetch: noSocket as never, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {} });
    expect(r.transport.local).toBe(true);
    expect(r.seat).toBeNull();
  });
  it('?net=new creates a room, rewrites the URL to the code and seat 0, and waits for start', async () => {
    const calls: string[] = [];
    let replaced: [string, number] | null = null;
    const fetchFake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 });
    }) as unknown as typeof fetch;
    const sock = { sent: [] as string[], send(d: string) { this.sent.push(d); }, close() {}, onopen: null as null | ((e: unknown) => void), onmessage: null as null | ((e: { data: unknown }) => void), onclose: null };
    const p = connectMatch(new URLSearchParams('net=new'), 'tel_marum', 'b', {
      fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: (c, s) => { replaced = [c, s]; }, note: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['POST http://x/api/match']);
    expect(replaced).toEqual(['ABCDEF', 0]);
    sock.onopen?.({});
    expect(JSON.parse(sock.sent[0])).toEqual({ t: 'hello', ticket: 'tk', build: 'b' });
    sock.onmessage?.({ data: JSON.stringify({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'a', connected: true, ready: false }, { seat: 1, callsign: 'b', connected: true, ready: false }], you: 0 }) });
    expect(JSON.parse(sock.sent[1])).toEqual({ t: 'ready' });
    const config = { matchId: 'ABCDEF', code: 'ABCDEF', seed: 5, map: 'tel_marum', mode: 'sandbox', seats: [
      { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'a', kind: 'human' },
      { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'b', kind: 'human' } ],
      pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 };
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config }) });
    const r = await p;
    expect(r.seat).toBe(0);
    expect(r.config?.seed).toBe(5);
    expect(r.transport.local).toBe(false);
  });
  it('?net=<code> joins as the seat the Worker gives', async () => {
    const fetchFake = (async () => Response.json({ code: 'ABCDEF', seat: 1, ticket: 'tk' })) as unknown as typeof fetch;
    const sock = { sent: [] as string[], send(d: string) { this.sent.push(d); }, close() {}, onopen: null as null | ((e: unknown) => void), onmessage: null as null | ((e: { data: unknown }) => void), onclose: null };
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {} });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: { matchId: 'ABCDEF', code: 'ABCDEF', seed: 1, map: 'tel_marum', mode: 'sandbox', seats: [
      { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'a', kind: 'human' },
      { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'b', kind: 'human' } ],
      pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 } }) });
    expect((await p).seat).toBe(1);
  });
});
```

- [ ] **Step 2: Run and watch it fail** — FAIL (module missing).

- [ ] **Step 3: Write connect.ts**

```ts
/**
 * Resolves the battlefield's transport BEFORE the sim exists (spec §3.3): a
 * `LocalTransport` with no `?net`, else a room. `?net=new` creates one and
 * rewrites the URL to `?net=<code>&seat=0`; `?net=<code>` joins. The returned
 * promise resolves at the room's `start`, which carries the seed and the map.
 */
import { LocalTransport, WsTransport, type MatchConfig, type MatchTransport, type Seat, type SocketLike } from '@lions/net';

export interface ConnectDeps {
  fetch: typeof fetch;
  origin: string;
  openSocket: (url: string) => SocketLike;
  replaceUrl: (code: string, seat: Seat) => void;
  note: (text: string) => void;
}

export interface Connected { transport: MatchTransport; seat: Seat | null; config: MatchConfig | null }

export async function connectMatch(query: URLSearchParams, mapId: string, build: string, deps: ConnectDeps): Promise<Connected> {
  const net = query.get('net');
  if (net === null) return { transport: new LocalTransport(), seat: null, config: null };
  const callsign = query.get('callsign') ?? 'Lion';
  const url = net === 'new' ? `${deps.origin}/api/match` : `${deps.origin}/api/match/${encodeURIComponent(net)}/join`;
  const res = await deps.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callsign, map: mapId, build }) });
  if (res.status !== 201 && res.status !== 200) throw new Error(`match ${net === 'new' ? 'create' : 'join'} failed: HTTP ${res.status}`);
  const { code, seat, ticket } = (await res.json()) as { code: string; seat: Seat; ticket: string };
  if (net === 'new') deps.replaceUrl(code, seat);
  deps.note(`Room ${code} · seat ${seat} · waiting for the other seat`);
  const wsUrl = `${deps.origin.replace(/^http/, 'ws')}/api/match/${code}/ws`;
  return new Promise<Connected>((resolve, reject) => {
    const transport: WsTransport = new WsTransport(() => deps.openSocket(wsUrl), ticket, build, {
      onLobby: (seats) => { if (seats.length === 2 && seats.every((s) => s.connected)) transport.ready(); },
      onStart: (config) => resolve({ transport, seat, config }),
      onError: (c) => { if (c === 'bad_ticket' || c === 'build_mismatch') reject(new Error(`room refused: ${c}`)); },
      onDesync: (tick) => deps.note(`DESYNC at tick ${tick}`),
      onEnded: (reason) => deps.note(`match ended: ${reason}`),
    });
  });
}
```

- [ ] **Step 4: Wire `bootBattlefield`**

At the top of `bootBattlefield` (after `req` is in scope and before the map is parsed), add:
```ts
  const match = await connectMatch(req.query, req.sandboxMap ?? '', __APP_BUILD__, {
    fetch: (u, i) => fetch(u, i),
    origin: location.origin,
    openSocket: (url) => new WebSocket(url),
    replaceUrl: (code, seat) => {
      const u = new URL(location.href);
      u.searchParams.set('net', code);
      u.searchParams.set('seat', String(seat));
      history.replaceState(null, '', u);
    },
    note: (text) => console.info(`[net] ${text}`),
  });
  const transport = match.transport;
  onDispose(() => transport.close());
  const netSeat: Seat | null = match.seat;
```
(`__APP_BUILD__` is the Vite define already in `vite.config.ts`; declare it where the other defines are declared if `tsc` complains.) A mission with `?net` is refused: `if (match.seat !== null && mission) throw new Error('N0: a room runs the sandbox only');`.

Seed: `new Sim({ seed: match.config?.seed ?? SIM_SEED, ... })`. Sandbox flags: right after `const flags = readFlags(params);`, add
```ts
  if (netSeat !== null) {
    for (const k of Object.keys(flags) as (keyof typeof flags)[]) {
      if (flags[k]) console.warn(`[net] sandbox flag &${k} is ignored in a room`);
      flags[k] = false;
    }
  }
```
Dispatch: replace `applyIntent(sim, intent);` with `applyIntent(transport, intent);`.

The frame loop: replace
```ts
    for (let i = 0; i < ticks; i++) runTick();
```
with
```ts
    const want = transport.local ? ticks : MAX_CATCHUP_TICKS;
    for (const f of transport.take(want)) {
      const { dropped } = applyFrame(f, sim, seatWorld);
      if (dropped > 0) console.warn(`[net] dropped ${dropped} foreign command(s) at tick ${f.tick}`);
      runTick();
      const hashTick = match.config !== null && sim.tickCount % match.config.hashEveryTicks === 0;
      transport.reportTick(sim.tickCount - 1, hashTick ? matchDigest(sim.hash(), 0, match.config?.dataDigest ?? 0) : null);
    }
    netStatus.paint(transport.status());
```
with, near `MS_PER_TICK`: `const MAX_CATCHUP_TICKS = 4;` and, after the sim exists:
```ts
  const seatWorld: SeatWorld = {
    sideOfSeat: (seat) => match.config?.seats[seat].side ?? 0,
    sideOfEntity: (id) => (id >= 0 && id < sim.count ? sim.state.side[id] : undefined),
  };
```
`netStatus` is a small HUD line (`ui/net-status.ts`, created here): a `div.rl-net-status` on `document.body` (removed in `onDispose`), text through `t()`:
- `net.waiting` "Waiting for the other seat"
- `net.stall.behind` "Waiting for {seat}: behind"
- `net.stall.gone` "Waiting for {seat}: connection lost"
- `net.desync` "Desync at tick {tick}. Both logs saved; report it."
Hidden when `status().kind` is `local` or `live`. Add the four keys to `en.json`. Use the semantic colour tokens only.

`__lions`: in the net case do not define `step`: `...(netSeat === null ? { step: (n: number) => {...} } : {})`. Minimap ping stays local.

`KNOWN_PARAMS` in `sandbox-help.ts`: add
```ts
  { name: 'net', blurb: 'new | <room code> — N0: run this sandbox in a two-seat lockstep room (both seats order the KDF force)' },
  { name: 'seat', blurb: '0 | 1 — written by the app after ?net=new; informational' },
  { name: 'callsign', blurb: '<name> — the lobby name a room shows for this seat' },
```

`vite.config.ts` `server`: 
```ts
  server: {
    port: Number(process.env.PORT) || 5173, strictPort: false,
    // N0: `/api/*` goes to a local `wrangler dev --port 8787` so a room can be
    // tested without a deploy. Only reached when something calls /api.
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
```

- [ ] **Step 5: Run everything**

`pnpm vitest run packages/app/src/net && pnpm lint && pnpm typecheck && pnpm validate:ui && pnpm test` → all green. `pnpm test:determinism` green.

- [ ] **Step 6: Drive it (local, two tabs)**

With `pnpm build && npx wrangler dev --port 8787` in one terminal (its `.dev.vars` carrying `TICKET_SECRET`) and `pnpm dev` in another, open `http://localhost:5173/free-play/beit_sahwan_outskirts?net=new` in tab A (the URL rewrites to `?net=<code>&seat=0`, the console prints the code) and `http://localhost:5173/free-play/beit_sahwan_outskirts?net=<code>` in tab B. Both boot; order units in A, watch them move in B; in the console of each, `__lions.sim.hash()` at the same `tickCount` agrees. Falsify: in B, `__lions.sim.queueCommand({kind:'halt', ids:[__lions.units()[0].id]})` directly (bypassing the transport) → the next `hash` round ends the match with the desync banner in both tabs. Record both observations in the task report. (Never run `pnpm ui:routes` locally.)

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add packages/app/src/net packages/app/src/ui/net-status.ts packages/app/src/main.ts packages/app/src/sandbox-help.ts packages/app/vite.config.ts packages/app/src/i18n/en.json
/usr/bin/git commit -m "app: the battlefield runs on a MatchTransport; ?net=new|<code> joins a sandbox room (N0 task 11)"
```

---

### Task 12: Three engines, one hash; CI; the run protocol

**Files:**
- Create: `tools/src/net/two-engine.ts`, `docs/net/N0-two-machine-test.md`
- Modify: `tools/package.json` (script `net:engines`), root `package.json` (script `net:engines`), `.github/workflows/ci.yml` (the `visual` job)
- Test: the script is the test; its falsification is Step 4.

- [ ] **Step 1: Write the tool**

`tools/src/net/two-engine.ts`:
```ts
// Chromium, Firefox and WebKit boot the same sandbox, receive the same order
// script at the same ticks through `__lions.sim.queueCommand`, step to the
// same tick with the frame loop frozen, and must report the same
// `__lions.sim.hash()` (network design §12, "two-engine determinism"). Every
// determinism run before this was V8; this is the first cross-engine reading.
import { chromium, firefox, webkit, type Browser } from 'playwright';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { resolvePort } from '../ui-review/port';
import { musicOffInitScript } from '../ui-review/music-off';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MAP = 'beit_sahwan_outskirts';
const TARGET_TICK = 600;
const TAG = 'two-engine';

/** Orders by tick, over the first N living side-0 units (ids read live). */
const SCRIPT = `
  const ids = __lions.units().map((u) => u.id);
  const a = ids.slice(0, Math.ceil(ids.length / 2)), b = ids.slice(Math.ceil(ids.length / 2));
  const fx = (v) => Math.round(v * 65536);
  const plan = { 10: [{ kind: 'move', ids: a, x: fx(20.5), y: fx(20.5) }, { kind: 'move', ids: b, x: fx(26.5), y: fx(18.5) }],
                 300: [{ kind: 'attackMove', ids: b, x: fx(30.5), y: fx(24.5) }, { kind: 'halt', ids: a }],
                 450: [{ kind: 'attackMove', ids: a, x: fx(32.5), y: fx(22.5) }] };
  while (__lions.sim.tickCount < ${TARGET_TICK}) {
    for (const c of plan[__lions.sim.tickCount] ?? []) __lions.sim.queueCommand(c);
    __lions.step(1);
  }
  ({ tick: __lions.sim.tickCount, hash: __lions.sim.hash() });
`;

async function reading(launch: () => Promise<Browser>, name: string, port: number): Promise<{ tick: number; hash: number }> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(musicOffInitScript());
    await page.goto(`http://localhost:${port}/free-play/${MAP}`);
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', null, { timeout: 120_000 });
    // Freeze the app's own loop so `step` is the only thing that ticks.
    await page.evaluate(() => { (window as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0; });
    await page.waitForTimeout(500);
    const r = (await page.evaluate(SCRIPT)) as { tick: number; hash: number };
    console.log(`[${TAG}] ${name}: tick ${r.tick} hash ${r.hash}`);
    return r;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  const { port } = resolvePort(process.argv.slice(2), process.env, 'NET_ENGINES_PORT', 5183);
  const server = await ensureDevServer(port, REPO, TAG);
  try {
    const engines: [string, () => Promise<Browser>][] = [
      ['chromium', () => chromium.launch()],
      ['firefox', () => firefox.launch()],
      ['webkit', () => webkit.launch()],
    ];
    const results: Record<string, { tick: number; hash: number }> = {};
    for (const [name, launch] of engines) results[name] = await reading(launch, name, port);
    const hashes = new Set(Object.values(results).map((r) => r.hash));
    const ticks = new Set(Object.values(results).map((r) => r.tick));
    if (ticks.size !== 1 || [...ticks][0] !== TARGET_TICK) { console.error(`[${TAG}] FAIL: ticks differ or missed target: ${JSON.stringify(results)}`); return 1; }
    if (hashes.size !== 1) { console.error(`[${TAG}] FAIL: engines disagree: ${JSON.stringify(results)}`); return 1; }
    console.log(`[${TAG}] PASS: three engines, tick ${TARGET_TICK}, hash ${[...hashes][0]}`);
    return 0;
  } finally {
    stopDevServer(server, TAG);
  }
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 2; });
```
(`__lions.units()`, `__lions.step` and `__lions.sim` exist on the sandbox route today, CLAUDE.md "Dev instruments". The `requestAnimationFrame` stub mirrors `FREEZE_FRAME_LOOP_STATEMENTS` in `capture-protocol.ts`; if that helper is exported, use it instead of the inline stub.)

`tools/package.json` scripts: `"net:engines": "tsx src/net/two-engine.ts"`; root `package.json`: `"net:engines": "pnpm --filter @lions/tools net:engines"`.

- [ ] **Step 2: Run it locally once** (Playwright needs the three engines: `pnpm --filter @lions/tools exec playwright install chromium firefox webkit`)

Run: `pnpm net:engines -- --port=5183`
Expected: three lines, one hash, `PASS`. Record the hash in the task report.

- [ ] **Step 3: CI**

In `.github/workflows/ci.yml`'s `visual` job: change the cache key to `playwright-three-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}` and the install line to `pnpm --filter @lions/tools exec playwright install --with-deps chromium firefox webkit`; add, after the golden-baseline step:
```yaml
      - name: three engines, one hash (network design §12)
        run: pnpm net:engines -- --port=5183
```

- [ ] **Step 4: Falsify**

In a scratch run (not committed), make the SCRIPT issue the tick-300 orders at tick 301 in Firefox only (branch on `navigator.userAgent.includes('Firefox')`) → `FAIL: engines disagree`. Restore. Separately, run the tool against a build with Task 10 reverted on one engine's path is not possible; instead note in the report whether the pre-Task-10 `Math.atan2` boot ever disagreed, by running the tool once from the commit before Task 10 (`/usr/bin/git stash` is forbidden; use a second worktree or just record "not measured").

- [ ] **Step 5: Write the run protocol**

`docs/net/N0-two-machine-test.md`:
```markdown
# N0 · The two-machine test

**What it proves:** two machines run one sandbox battle in lockstep through the
deployed `MatchRoom`, with equal hashes every 20 ticks for ten minutes, ten
times. The gate on issue #190.

## Setup
1. Both machines on the deployed build (`https://roaring-lions.pint12.workers.dev`), same version (the lobby refuses a mismatch with `build_mismatch`).
2. `TICKET_SECRET` set on the Worker: `npx wrangler secret put TICKET_SECRET` (e.g. `openssl rand -base64 24`).
3. Machine A opens `/free-play/beit_sahwan_outskirts?net=new&callsign=A`. The URL rewrites to `?net=<CODE>&seat=0`; read the code off the URL or the console.
4. Machine B opens `/free-play/beit_sahwan_outskirts?net=<CODE>&callsign=B`.
5. Both boot into the same sandbox. Both may order the KDF force.

## The run (×10)
- Play for ten minutes (12,000 ticks): both order units, fight the Sarim set, pause nothing.
- Every 20 ticks the room compares hashes; the console prints nothing on agreement and the banner says `Desync at tick N` on disagreement.
- At the end, read in each console: `__lions.sim.tickCount`, `__lions.sim.hash()`, and `performance.now()` deltas the transport logs.
- One run of the ten: unplug B's network for 10 s mid-fight. Expected: A sees "Waiting for B: connection lost", B reconnects, both continue, hashes still agree.

## Report (append to #190)
| Run | Machines / networks | Ticks | Desync? | Stalls (count, longest) | Round trip (ms, median) | Reconnect replay (s) |
|---|---|---|---|---|---|---|

Plus: the Worker's Durable Object duration for the session (Cloudflare dashboard, Durable Objects → roaring-lions), and anything that surprised you.
```

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add tools/src/net/two-engine.ts tools/package.json package.json .github/workflows/ci.yml docs/net/N0-two-machine-test.md
/usr/bin/git commit -m "tools+ci: three-engine hash check in the visual job; N0 run protocol (N0 task 12)"
```

---

## Self-review

**Spec coverage (N0 scope, §9 row N0):** `packages/net` core (Tasks 1–5), `MatchRoom` DO with metronome, stalls, hash compare, log, tickets, Origin, limits (Tasks 6–8), `MatchTransport` with `LocalTransport` (Task 5) and `WsTransport` (Task 9), the tick loop advancing to buffered frames and dispatch to the transport (Task 11), hash every 20 ticks (Tasks 9, 11), the two-client CI test (Task 5), the three-engine check (Task 12), the sandbox boot's `Math.atan2`/`Math.hypot` (Task 10), `__lions.step` absent and flags refused in a room (Task 11), the run protocol and report (Task 12). **Not in N0, by the spec:** the lobby screen, callsign storage, `viewerSide`, the desync report to D1, the pause command, the rebuild-from-zero reconnect in a fresh page, a per-match seed — all N1. The N0 room mints `SIM_SEED` and the DO's `desync` only voids the match.

**Placeholder scan:** none; every code step is complete. Task 8's `socketsFor` appears twice by design: the second definition replaces the first and the step says so.

**Type consistency:** `Seat`, `Stamped`, `Frame`, `MatchConfig`, `TransportStatus`, `SocketLike`, `Effect`, `RoomState` are each defined once and used by name elsewhere; `ACK_EVERY` is defined in both `room-core.ts` and `ws-transport.ts` with the same value (10) — acceptable, each side owns its cadence. `hostileFacing` takes `(fxA, fyA, hxA, hyA)` in both its definition and its call.

**Review Focus pins:** 1 → Task 3 and Task 5's out-of-order test; 2 → Task 4; 3 → Task 1 and Task 8's `bad_message` path (asserted by the `wrangler dev` smoke, and `parseClientMsg` returns null in Task 1's test); 4 → Task 7's replace-and-log test and Task 9's reconnect test; 5 → Task 7's eviction test and Task 8's `ensureClock()` in every handler.
