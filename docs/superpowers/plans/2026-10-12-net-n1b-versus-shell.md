# N1b · Versus Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A friend match a player can start and finish without the console: "Play with a friend" on the menu, a lobby that shows the room code and a copy-link button, both seats ready up, the match runs, either seat can pause (three 90 s pauses), chat, surrender, reload and rejoin, and the match ends on screen with a result; a desync is logged by the room and reported by reference.

**Architecture:** The room gains four client messages (`pause`, `resume`, `surrender`, `chat`) and the lobby message carries the map; pause rides on the existing stall machinery as a stall with a reason and a deadline. The lobby screen (`/versus`, `/versus/:code`) owns the `WsTransport` until the match starts and HANDS it to the battlefield in the same JS realm (no reconnect); a seat ticket kept in `sessionStorage` lets a reloaded page rejoin through the room's existing `log` path. The battlefield replaces local pause with room pause in a room, and checks a deterministic win rule from sim state. On a desync the room writes its compacted log to D1 itself, so the feedback endpoint is untouched.

**Tech Stack:** TypeScript strict, vitest (node and jsdom), Cloudflare Durable Objects + D1, the app's shell router and UI kit (`panel`, `screenFoot`, `t()`).

**Spec:** `docs/superpowers/specs/2026-10-10-network-game-design.md` — §2.3 (win rule), §3.2.5 (pause and surrender), §3.2.6 (reconnect), §3.4 (desync), §3.5 (security), §4 (invite and lobby), §5.2–5.4 (HUD, chat, banners), §10 decisions 6, 10, 12–17. Builds on N0 (PR #543, on `main`) and runs beside N1a (`feat/net-n1a`, plan `docs/superpowers/plans/2026-10-12-net-n1a-versus-core.md`).

## Global Constraints

- **No file under `packages/sim/` changes.** `pnpm test:determinism` stays green against the pins on the `main` this branch is based on.
- **Start from `main` AFTER N1a has merged.** Tasks 6–10 use `mode: 'versus'`, `viewerSideOf`, `playerId` and the mirror spawn from N1a. Tasks 1–5 touch only `packages/net`, `packages/worker` and `packages/app/src/net`, and can start earlier on a branch rebased once N1a lands.
- Dependency direction: `app → render → sim`, `app → net → sim`, `worker → net`. The Worker never imports `@lions/sim`.
- No battle state on the wire. Chat and pause are relay and clock messages; nothing a client sends becomes a `Command` except `cmd`.
- **Chat text is untrusted.** It reaches the DOM only through `textContent`, or through `hud.note` after `escapeHtml` (`hud.note` sets `innerHTML`). The room caps it at 280 characters and strips control characters.
- Single-player is unchanged: local pause, Restart, the feedback form and every screen outside `/versus` behave exactly as on `main`.
- Durable Object SQLite for the room, D1 for the desync log, nothing in R2. Workers Free row budget: report rows per second in Task 3.
- UI: strings through `t()` in `packages/app/src/i18n/en.json`; colour only through semantic tokens; `pnpm validate:ui` green.
- Git: `/usr/bin/git` by absolute path, one plain command per call, with a pathspec; never `git add -A`, never `git stash`.
- Never start or kill a dev server from a subagent; `pnpm ui:routes` runs on CI only; test browsers start with music off.
- Every check arrives with its falsification, watched red, in the task.

## Review Focus

1. **A seat pauses a fourth time, or tries to resume the other seat's pause.** Expected: refused (the room answers nothing and the clock stays as it is); only the pauser resumes early; every pause ends by itself at 90 s. Pinned in Task 2.
2. **Chat containing `<img src=x onerror=alert(1)>` or 5,000 characters.** Expected: shown as literal text, cut at 280, never parsed as HTML; a flood is rate-limited. Pinned in Tasks 2 and 9.
3. **The guest reloads mid-match.** Expected: the page boots, rejoins with its stored ticket, replays the log fast enough to rejoin within the 120 s window, and the hashes keep agreeing. Pinned in Task 5.
4. **The lobby is left before the match starts, or after it starts but before the battlefield mounts.** Expected: before start, `bye` ends the room; after start, the handed-off transport is closed by the battlefield's disposer and never twice. Pinned in Tasks 5 and 7.
5. **Both forces are destroyed on the same tick.** Expected: a draw on both screens, decided from sim state alone, identical on both machines. Pinned in Task 10.

---

## File Structure

**Create**
- `packages/worker/migrations/0004_match_desync.sql` — the desync log table.
- `packages/worker/src/match/desync-log.ts` — `compactLog`, `writeDesync`.
- `packages/app/src/net/ticket-store.ts` — per-code seat tickets in `sessionStorage`.
- `packages/app/src/net/handoff.ts` — the lobby-to-battlefield transport handoff.
- `packages/app/src/net/catch-up.ts` — the time-boxed replay budget.
- `packages/app/src/net/outcome.ts` — the deterministic win rule.
- `packages/app/src/ui/versus.ts` — the `/versus` entry and the `/versus/:code` lobby.
- `packages/app/src/ui/net-chat.ts` — the in-match chat line.
- `packages/app/src/ui/net-end.ts` — the match-over panel.
- `docs/net/N1-friend-match.md` — the run protocol, replacing the URL-only steps.

**Modify**
- `packages/net/src/{protocol,transport,ws-transport}.ts`
- `packages/worker/src/match/{room-core,match-room}.ts`, `packages/worker/QUERIES.sql`
- `packages/app/src/net/connect.ts`, `packages/app/src/main.ts`, `packages/app/src/shell/links.ts`, `packages/app/src/shell/escape-back.ts`, `packages/app/src/ui/menu.ts`, `packages/app/src/ui/pause.ts`, `packages/app/src/ui/net-status.ts`, `packages/app/src/i18n/en.json`
- `tools/src/ui-review/shoot.ts` (the lobby screens in the capture walk)

---

### Task 1: The protocol learns pause, surrender, chat and the lobby's map

**Files:**
- Modify: `packages/net/src/protocol.ts`, `packages/net/src/transport.ts`
- Test: `packages/net/src/protocol.test.ts`

**Interfaces:**
- Produces, added to the existing unions:
```ts
// ClientMsg
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'surrender' }
  | { t: 'chat'; text: string }
// ServerMsg
  | { t: 'paused'; seat: Seat; remainingMs: number; pausesLeft: [number, number] }
  | { t: 'chat'; seat: Seat; text: string }
// ServerMsg 'lobby' gains `map: string`; ServerMsg 'ended' becomes
  | { t: 'ended'; reason: 'left' | 'void' | 'expired' | 'surrender'; seat?: Seat }
// TransportStatus gains
  | { kind: 'paused'; seat: Seat; untilMs: number }
export const CHAT_MAX_CHARS = 280;
export const PAUSE_MS = 90_000;
export const PAUSES_PER_SEAT = 3;
```
The client `resume` and the server `resume` share the tag `'resume'` and live in different unions; that is deliberate and parse-safe because each parser accepts only its own union.

- [ ] **Step 1: Write the failing tests**

Add to `protocol.test.ts`:
```ts
describe('N1b messages', () => {
  it('parses the four new client messages', () => {
    for (const m of [{ t: 'pause' }, { t: 'resume' }, { t: 'surrender' }, { t: 'chat', text: 'gg' }]) {
      expect(parseClientMsg(JSON.stringify(m))).toEqual(m);
    }
  });
  it('refuses chat that is not a string or is over the cap', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'chat', text: 5 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'chat', text: 'x'.repeat(281) }))).toBeNull();
  });
  it('parses paused, chat, a lobby with its map, and a surrender', () => {
    const paused = { t: 'paused', seat: 1, remainingMs: 90000, pausesLeft: [3, 2] };
    expect(parseServerMsg(JSON.stringify(paused))).toEqual(paused);
    expect(parseServerMsg(JSON.stringify({ t: 'chat', seat: 0, text: 'hi' }))).toEqual({ t: 'chat', seat: 0, text: 'hi' });
    const lobby = { t: 'lobby', config: null, seats: [], you: 0, map: 'tel_marum' };
    expect(parseServerMsg(JSON.stringify(lobby))).toEqual(lobby);
    expect(parseServerMsg(JSON.stringify({ t: 'ended', reason: 'surrender', seat: 1 }))).toEqual({ t: 'ended', reason: 'surrender', seat: 1 });
    expect(parseServerMsg(JSON.stringify({ t: 'ended', reason: 'boredom' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run packages/net/src/protocol.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Add the members and constants above. In `parseClientMsg`: `case 'pause': return { t: 'pause' };`, the same for `resume` and `surrender`, and `case 'chat': return typeof m.text === 'string' && m.text.length <= CHAT_MAX_CHARS ? { t: 'chat', text: m.text } : null;`. In `parseServerMsg`: `paused` checks `isSeat(m.seat)`, `isInt(m.remainingMs)`, and a two-integer `pausesLeft`; `chat` checks `isSeat` and a string `text`; `lobby` requires a string `map`; `ended` accepts `'surrender'` and an optional seat. Add the `paused` member to `TransportStatus`. Update every `switch` that `tsc` now flags as non-exhaustive in `packages/net`, `packages/worker` and `packages/app/src/ui/net-status.ts` with the minimal handling, which later tasks complete (`net-status.ts` returns `null` for `paused` until Task 8).

- [ ] **Step 4: Run, typecheck, falsify, commit**

`pnpm vitest run packages/net && pnpm typecheck` → green. Falsify: drop the length check on `chat` → the over-cap test fails. Restore.
```bash
/usr/bin/git add packages/net/src/protocol.ts packages/net/src/protocol.test.ts packages/net/src/transport.ts packages/app/src/ui/net-status.ts packages/worker/src/match/room-core.ts
/usr/bin/git commit -m "net: pause, resume, surrender, chat and the lobby's map in the protocol (N1b task 1)"
```

---

### Task 2: The room's rules for pause, surrender and chat

**Files:**
- Modify: `packages/worker/src/match/room-core.ts`
- Test: `packages/worker/src/match/room-core.test.ts`

**Interfaces:**
- Produces: `RoomState` gains `pause: { seat: Seat; untilMs: number } | null`, `pausesLeft: [number, number]` (created as `[PAUSES_PER_SEAT, PAUSES_PER_SEAT]`), `lastChatMs: [number, number]` (created as `[-Infinity, -Infinity]`, serialised as `-1` — use `-1` as the "never" value to keep the state JSON-safe) and `surrendered: Seat | null`; `lobbyMsg(st, you, map: string)`; `persistKey` includes `pausesLeft`, `pause`'s seat and `surrendered`; `export const CHAT_MIN_GAP_MS = 500`.

Pause is a stall with a reason. `stallFor` returns nothing new; instead `recheckStall` and `clockTick` treat `st.pause !== null` as "do not run" ahead of every other rule, and the room sends `paused` instead of `stall`.

- [ ] **Step 1: Write the failing tests**

Add to `room-core.test.ts`, using its `running()` helper:
```ts
describe('pause', () => {
  it('stops frames, tells both seats who and for how long, and spends one pause', () => {
    const st = running();
    const fx = seatMessage(st, 1, { t: 'pause' }, 1000, mint);
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'paused', seat: 1, remainingMs: 90000, pausesLeft: [3, 2] }]);
    expect(frames(clockTick(st, 1050))).toHaveLength(0);
  });
  it('only the pauser resumes early; the other seat\'s resume is ignored', () => {
    const st = running();
    seatMessage(st, 1, { t: 'pause' }, 1000, mint);
    expect(sends(seatMessage(st, 0, { t: 'resume' }, 2000, mint))).toEqual([]);
    expect(sends(seatMessage(st, 1, { t: 'resume' }, 2000, mint)).map((s) => s.msg)).toEqual([{ t: 'resume' }]);
    expect(frames(clockTick(st, 2050))).toHaveLength(1);
  });
  it('ends by itself at 90 s', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    expect(frames(clockTick(st, 1000 + 89_999))).toHaveLength(0);
    const fx = clockTick(st, 1000 + 90_000);
    expect(sends(fx).some((s) => s.msg.t === 'resume')).toBe(true);
    expect(frames(fx)).toHaveLength(1);
  });
  it('refuses a fourth pause, and a pause while paused', () => {
    const st = running();
    for (let i = 0; i < 3; i++) {
      seatMessage(st, 0, { t: 'pause' }, 1000 * i, mint);
      seatMessage(st, 0, { t: 'resume' }, 1000 * i + 500, mint);
    }
    expect(sends(seatMessage(st, 0, { t: 'pause' }, 9000, mint))).toEqual([]);
    seatMessage(st, 1, { t: 'pause' }, 9100, mint);
    expect(sends(seatMessage(st, 1, { t: 'pause' }, 9200, mint))).toEqual([]);
  });
  it('a pause is not silence: resuming does not stall the room as gone', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    const fx = seatMessage(st, 0, { t: 'resume' }, 60_000, mint);
    expect(sends(fx).some((s) => s.msg.t === 'stall')).toBe(false);
    expect(frames(clockTick(st, 60_050))).toHaveLength(1);
  });
});

describe('surrender', () => {
  it('ends the match with the surrendering seat named', () => {
    const st = running();
    const fx = seatMessage(st, 1, { t: 'surrender' }, 1000, mint);
    expect(st.status).toBe('ended');
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'ended', reason: 'surrender', seat: 1 }]);
  });
});

describe('chat', () => {
  it('relays trimmed, control-free text to both seats', () => {
    const st = running();
    const fx = seatMessage(st, 0, { t: 'chat', text: '  hi\u0007 there \n ' }, 1000, mint);
    expect(sends(fx).map((s) => [s.to, s.msg])).toEqual([['all', { t: 'chat', seat: 0, text: 'hi there' }]]);
  });
  it('drops an empty message and one sent within 500 ms of the last', () => {
    const st = running();
    expect(sends(seatMessage(st, 0, { t: 'chat', text: '   ' }, 1000, mint))).toEqual([]);
    seatMessage(st, 0, { t: 'chat', text: 'a' }, 2000, mint);
    expect(sends(seatMessage(st, 0, { t: 'chat', text: 'b' }, 2400, mint))).toEqual([]);
    expect(sends(seatMessage(st, 0, { t: 'chat', text: 'c' }, 2600, mint))).toHaveLength(1);
  });
  it('works in the lobby too', () => {
    const st = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st, 0, 'p0', 'Host', 0);
    expect(sends(seatMessage(st, 0, { t: 'chat', text: 'hello' }, 10, mint))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**

In `seatMessage`:
```ts
    case 'pause': {
      if ((st.status !== 'running' && st.status !== 'stalled') || st.pause !== null || st.pausesLeft[seat] <= 0) return [];
      st.pausesLeft[seat]--;
      st.pause = { seat, untilMs: nowMs + PAUSE_MS };
      st.status = 'stalled';
      return [{ kind: 'send', to: 'all', msg: { t: 'paused', seat, remainingMs: PAUSE_MS, pausesLeft: [st.pausesLeft[0], st.pausesLeft[1]] } }];
    }
    case 'resume': {
      if (st.pause === null || st.pause.seat !== seat) return [];
      return endPause(st, nowMs);
    }
    case 'surrender': {
      if (st.status === 'ended' || st.status === 'lobby') return [];
      st.status = 'ended';
      st.endedReason = 'surrender';
      st.surrendered = seat;
      return [{ kind: 'send', to: 'all', msg: { t: 'ended', reason: 'surrender', seat } }];
    }
    case 'chat': {
      if (st.status === 'ended') return [];
      const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_CHARS);
      if (text === '' || (st.lastChatMs[seat] >= 0 && nowMs - st.lastChatMs[seat] < CHAT_MIN_GAP_MS)) return [];
      st.lastChatMs[seat] = nowMs;
      return [{ kind: 'send', to: 'all', msg: { t: 'chat', seat, text } }];
    }
```
with
```ts
function endPause(st: RoomState, nowMs: number): Effect[] {
  st.pause = null;
  // A pause is not silence: every seat's clock of silence restarts now.
  for (const s of st.seats) if (s) s.lastSeenMs = nowMs;
  st.status = 'running';
  st.stall = null;
  return [{ kind: 'send', to: 'all', msg: { t: 'resume' } }, ...recheckStall(st, nowMs)];
}
```
`recheckStall`: return `[]` at its top while `st.pause !== null`. `clockTick`: after the TTL check, `if (st.pause !== null) return nowMs >= st.pause.untilMs ? endPause(st, nowMs) : [];`, then continue. Widen `endedReason` to include `'surrender'`. `lobbyMsg` takes the map; the room passes `this.meta.map` (Task 3). `persistKey` adds `st.pausesLeft`, `st.pause?.seat ?? null` and `st.surrendered`. `revive` leaves `pause` as persisted, so a restart during a pause keeps it and its deadline.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/worker && pnpm typecheck` → green, and every N0 room test unchanged. Falsify: drop `st.pause.seat !== seat` from `resume` → the "only the pauser" test fails. Restore.
```bash
/usr/bin/git add packages/worker/src/match/room-core.ts packages/worker/src/match/room-core.test.ts
/usr/bin/git commit -m "worker: room rules for pause (3 x 90 s), surrender and chat (N1b task 2)"
```

---

### Task 3: The room logs a desync to D1 and tells the lobby its map

**Files:**
- Create: `packages/worker/migrations/0004_match_desync.sql`, `packages/worker/src/match/desync-log.ts`, `packages/worker/src/match/desync-log.test.ts`
- Modify: `packages/worker/src/match/match-room.ts` (`apply`: watch for a `desync` send; `lobbyMsg` calls), `packages/worker/QUERIES.sql`
- Test: `packages/worker/src/match/match-room.test.ts`

**Interfaces:**
- Produces:
```ts
export interface DesyncRecord { code: string; tick: number; hashA: number; hashB: number; config: string; frames: string; frameCount: number; createdAt: number }
/** Only the frames that carried commands, plus the last tick: an empty frame is implied by its absence. */
export function compactLog(frames: readonly Frame[]): { last: number; orders: Frame[] };
export async function writeDesync(db: D1Like, rec: DesyncRecord): Promise<void>;
```

Migration `0004_match_desync.sql`:
```sql
-- N1b (network design §3.4): a desync's evidence, written by the MatchRoom.
-- Apply before merge: npx wrangler d1 migrations apply roaring-lions-telemetry --remote
CREATE TABLE match_desync (
  code        TEXT    NOT NULL,
  tick        INTEGER NOT NULL,
  hash_a      INTEGER NOT NULL,
  hash_b      INTEGER NOT NULL,
  config      TEXT    NOT NULL,
  frames      TEXT    NOT NULL,
  frame_count INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (code, tick)
);
```

- [ ] **Step 1: Write the failing tests**

`desync-log.test.ts` (with `openTestD1()`, which applies every migration):
```ts
import { describe, it, expect } from 'vitest';
import { openTestD1 } from '../test-d1';
import { compactLog, writeDesync } from './desync-log';

describe('compactLog', () => {
  it('keeps only order-bearing frames and the last tick', () => {
    const frames = [{ tick: 0, cmds: [] }, { tick: 1, cmds: [{ seat: 0 as const, seq: 0, cmd: { kind: 'halt' as const, ids: [1] } }] }, { tick: 2, cmds: [] }];
    expect(compactLog(frames)).toEqual({ last: 2, orders: [frames[1]] });
  });
});

describe('writeDesync', () => {
  it('writes one row, and a second write for the same tick does not throw', async () => {
    const db = openTestD1();
    const rec = { code: 'ABCDEF', tick: 40, hashA: 1, hashB: 2, config: '{}', frames: '{"last":40,"orders":[]}', frameCount: 41, createdAt: 5 };
    await writeDesync(db, rec);
    await writeDesync(db, rec);
    const rows = db.raw.prepare('SELECT code, tick, hash_a, hash_b FROM match_desync').all();
    expect(rows).toEqual([{ code: 'ABCDEF', tick: 40, hash_a: 1, hash_b: 2 }]);
  });
});
```
In `match-room.test.ts`: two seats report different hashes for one tick → the room's `env.DB` (a test D1 passed into the fake) holds one `match_desync` row naming that tick; and a lobby message after `/create` with `map: 'tel_marum'` carries `map: 'tel_marum'`.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

`desync-log.ts`: `compactLog` filters `cmds.length > 0` and records the last tick; `writeDesync` runs `INSERT OR IGNORE INTO match_desync (...) VALUES (?,?,?,?,?,?,?,?)`. In `MatchRoom.apply`, when an effect is a send of `{ t: 'desync' }`, call `void this.logDesync(msg)` after the sends, where `logDesync` builds the record from `this.st.config`, `this.readLog()` and the message, and writes it only if `this.env.DB` exists, catching and `console.error`-ing any failure (a log write must never break the room). Pass `this.meta?.map ?? DEFAULT_MAP` to every `lobbyMsg` call. Append to `QUERIES.sql`:
```sql
-- N1b: desyncs, newest first (network design §3.4).
SELECT code, tick, hash_a, hash_b, frame_count, datetime(created_at / 1000, 'unixepoch') AS at
FROM match_desync ORDER BY created_at DESC LIMIT 50;
```

- [ ] **Step 4: Run, measure, falsify, commit**

`pnpm vitest run packages/worker && pnpm typecheck` → green. A desync writes one D1 row, once per match: record it in the report as the budget cost (zero rows in a healthy match). Falsify: skip the write → the D1 test fails. Restore.
```bash
/usr/bin/git add packages/worker/migrations/0004_match_desync.sql packages/worker/src/match/desync-log.ts packages/worker/src/match/desync-log.test.ts packages/worker/src/match/match-room.ts packages/worker/src/match/match-room.test.ts packages/worker/QUERIES.sql
/usr/bin/git commit -m "worker: the room logs a desync to D1; the lobby carries the map (N1b task 3)"
```
**Before merge, the lead applies the migration** (the merge deploys code that writes the table): `npx wrangler d1 migrations apply roaring-lions-telemetry --remote`. The PR description says so in its first line.

---

### Task 4: `WsTransport` learns the new messages and can be handed over

**Files:**
- Modify: `packages/net/src/ws-transport.ts`
- Test: `packages/net/src/ws-transport.test.ts`

**Interfaces:**
- Produces: `WsTransport` methods `pause(): void`, `resume(): void`, `surrender(): void`, `chat(text: string): void`, `detach(): void` (stops reconnecting and closes the socket WITHOUT `bye`); `WsTransportHooks` gains `onPaused?(seat: Seat, remainingMs: number, pausesLeft: [number, number]): void`, `onChat?(seat: Seat, text: string): void`, and `onEnded?(reason: string, seat?: Seat)`; `setHooks(hooks: Partial<WsTransportHooks>): void`, which replaces the named hooks (the lobby's hooks become the battlefield's on handover); `status()` returns `{ kind: 'paused', seat, untilMs }` while paused, with `untilMs = now() + remainingMs`.

- [ ] **Step 1: Write the failing tests**

With the file's fake socket:
- `pause()`, `resume()`, `surrender()` and `chat('gg')` each send their message.
- A received `paused` sets `status()` to `paused` with the right seat and `untilMs`, and calls `onPaused`; a following `resume` returns `status()` to `live`.
- A received `chat` calls `onChat(seat, text)`.
- A received `ended` with `surrender` calls `onEnded('surrender', 1)`.
- `detach()` sends nothing (no `bye`), closes the socket, and does NOT reconnect when the fake then fires `onclose`.
- `setHooks({ onChat })` replaces only `onChat`; `onStart` stays the original.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

Each sender is one line through the existing `send`. `paused` sets a `paused` field and the status; `resume` (server) clears it and returns to `live`. `detach()` sets `this.closed = true` (the flag that already stops the reconnect) and closes the socket without sending `bye`. `setHooks` assigns over a private mutable copy of the hooks, which every handler reads instead of the constructor's readonly field.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/net && pnpm typecheck` → green. Falsify: make `detach()` call `close()` → the "no bye" test fails. Restore.
```bash
/usr/bin/git add packages/net/src/ws-transport.ts packages/net/src/ws-transport.test.ts
/usr/bin/git commit -m "net: WsTransport pause, resume, surrender, chat, detach and setHooks (N1b task 4)"
```

---

### Task 5: Rejoin after a reload, and a replay fast enough to rejoin

**Files:**
- Create: `packages/app/src/net/ticket-store.ts`, `packages/app/src/net/ticket-store.test.ts`, `packages/app/src/net/handoff.ts`, `packages/app/src/net/handoff.test.ts`, `packages/app/src/net/catch-up.ts`, `packages/app/src/net/catch-up.test.ts`
- Modify: `packages/app/src/net/connect.ts` (drop the unconditional `RELOAD_REFUSED`), `packages/app/src/main.ts` (the frame loop's `stepFrames` call `:5465`)
- Test: `packages/app/src/net/connect.test.ts`

**Interfaces:**
- Produces:
```ts
// ticket-store.ts
export interface StoredSeat { ticket: string; seat: Seat }
export function saveSeat(store: StorageLike | null, code: string, s: StoredSeat): void;
export function loadSeat(store: StorageLike | null, code: string): StoredSeat | null;
export function forgetSeat(store: StorageLike | null, code: string): void;   // StorageLike from telemetry/identity.ts; forget writes '' (StorageLike has no removeItem)
// handoff.ts
export interface Handed { transport: WsTransport; seat: Seat; config: MatchConfig }
/** Held until taken, or until `expireMs` (default 10 s) passes, when it is
 *  dropped: a handoff nobody took must not leave a socket open. */
export function handOver(code: string, h: Handed, opts?: { expireMs?: number; schedule?: (fn: () => void, ms: number) => unknown }): void;
export function takeHanded(code: string): Handed | null;   // one take only; cancels the expiry
export function dropHanded(code: string): void;            // detach and forget
// catch-up.ts
/** How many ticks this animation frame may run: the normal cap when nearly
 *  caught up; while far behind, as many as fit in `budgetMs` at the measured
 *  cost per tick. */
export function catchUpTicks(behind: number, msPerTick: number, budgetMs?: number, normalCap?: number): number;
```
`ConnectDeps` gains `session: StorageLike | null` (`safeStorage(() => window.sessionStorage)`). `connectMatch` order: a `takeHanded(code)` hit returns it at once; else a `?seat` on the URL with a `loadSeat(code)` hit opens a socket with the stored ticket (the room answers `log`, which `WsTransport` already turns into `onStart`); else `?seat` without a stored ticket throws `RELOAD_REFUSED` as today; else create or join as today, then `saveSeat`.

- [ ] **Step 1: Write the failing tests**

- `ticket-store.test.ts`: save then load returns the seat; another code returns null; forget makes load return null; a null store never throws.
- `handoff.test.ts`: `takeHanded` returns the handed value once and null the second time; `dropHanded` calls the transport's `detach` once; with a fake `schedule`, an untaken handoff is dropped (its `detach` called) when the scheduled function runs, and a taken one is not.
- `catch-up.test.ts`: `catchUpTicks(3, 1)` is the normal cap of 4; `catchUpTicks(5000, 1, 12)` is 12; `catchUpTicks(5000, 0.25, 12)` is 48; never below 1 while behind, never above `behind`.
- `connect.test.ts`: (a) a handed transport is returned without any fetch; (b) `?net=ABCDEF&seat=1` with a stored ticket sends `hello` with THAT ticket, posts nothing, and resolves when the fake socket delivers a `log`; (c) `?net=ABCDEF&seat=1` with no stored ticket still throws `RELOAD_REFUSED`; (d) a fresh join stores its ticket.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

`catch-up.ts`:
```ts
export function catchUpTicks(behind: number, msPerTick: number, budgetMs = 12, normalCap = 4): number {
  if (behind <= 0) return 0;
  if (behind <= normalCap * 2) return Math.min(behind, normalCap);
  const fit = Math.floor(budgetMs / Math.max(msPerTick, 0.05));
  return Math.max(1, Math.min(behind, Math.max(normalCap, fit)));
}
```
In `main.ts`'s frame loop, in a room, replace `MAX_CATCHUP_TICKS` with `catchUpTicks(transport.status().kind === 'live' ? transport.status().behind : 0, tickCostMs)` (read `behind` from a narrowed status once), where `tickCostMs` is an exponential moving average of `runTick`'s measured wall time over the last ticks (measured with `performance.now()` around `stepFrames`; app code, never the sim). Single-player keeps `ticks`.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app/src/net && pnpm typecheck` → green. Falsify: make `takeHanded` not delete → the "once" test fails. Restore. Record in the report how long a 12,000-tick log takes to replay on the lead's machine class (estimate from the measured per-tick cost: `12000 × tickCostMs / budget-fraction`); if over 120 s the plan's follow-on (a sim snapshot) is due and must be said.
```bash
/usr/bin/git add packages/app/src/net/ticket-store.ts packages/app/src/net/ticket-store.test.ts packages/app/src/net/handoff.ts packages/app/src/net/handoff.test.ts packages/app/src/net/catch-up.ts packages/app/src/net/catch-up.test.ts packages/app/src/net/connect.ts packages/app/src/net/connect.test.ts packages/app/src/main.ts
/usr/bin/git commit -m "app: rejoin after a reload with a stored ticket; lobby handoff; time-boxed catch-up (N1b task 5)"
```

---

### Task 6: The `/versus` screens

**Files:**
- Create: `packages/app/src/ui/versus.ts`, `packages/app/src/ui/versus.test.ts`
- Modify: `packages/app/src/shell/links.ts` (`routes`), `packages/app/src/main.ts` (the route table `:1225`), `packages/app/src/shell/escape-back.ts` (`ESCAPE_BACK_ROUTES`), `packages/app/src/ui/menu.ts` (nav), `packages/app/src/i18n/en.json`

**Interfaces:**
- Consumes: `connectMatch`'s create and join halves (Task 5), `WsTransport` (Task 4), `handOver`, `saveSeat`, `playerId` (N1a), `routes.sandbox`, `panel`, `screenFoot`, `footBack`, `markConfirm`, `stagger`, `t`.
- Produces:
```ts
// links.ts
versus: (): string => href('/versus'),
versusRoom: (code: string): string => href(`/versus/${encodeURIComponent(code)}`),
// versus.ts
export interface VersusDeps {
  /** Creates or joins; resolves to the code, seat and an OPEN, not-yet-started transport. */
  open(req: { kind: 'create'; map: string; callsign: string } | { kind: 'join'; code: string; callsign: string }): Promise<{ code: string; seat: Seat; transport: WsTransport }>;
  maps: readonly { id: string; label: string }[];
  callsign: { get(): string; set(v: string): void };   // lions.versus.callsign
  navigate(href: string, opts?: { replace?: boolean }): void;
  copy(text: string): Promise<boolean>;                // navigator.clipboard, false on refusal
  linkFor(code: string): string;                       // absolute URL of routes.versusRoom(code)
}
export function showVersus(stage: HTMLElement, deps: VersusDeps): Disposer;                    // /versus
export function showVersusRoom(stage: HTMLElement, code: string, deps: VersusDeps): Disposer;  // /versus/:code
```
Routes: `{ name: 'versus', pattern: '/versus', mount: (host) => showVersus(host, versusDeps) }` and `{ name: 'versus-room', pattern: '/versus/:code', mount: (host, req) => showVersusRoom(host, req.params.code.toUpperCase(), versusDeps) }`. Add both names to `ESCAPE_BACK_ROUTES`. Menu: `add(t('menu.nav.versus'), routes.versus(), 'secondary')` after Brigade.

**The two screens**, built like `credits.ts` (`rl-menu rl-menu--versus`, `panel({ rank: 'inspect', title })`, a sticky `screenFoot` with `footBack` to the menu, `stagger`):
- **`/versus`.** A callsign field (prefilled, at most 24 characters, saved on change). A "Host a match" block with a map select over `deps.maps` and a primary "Open a room" button. A "Join a match" block with a six-character code field (upper-cased as typed, alphabet-filtered) and a "Join" button. Hosting or joining calls `deps.open`, then `navigate(routes.versusRoom(code))` with the transport kept in a module-level `pendingLobby` map keyed by code, so the room screen picks it up without a second socket.
- **`/versus/:code`.** The code large (`rl-versus__code`, monospace via an existing token), a "Copy link" button (`deps.copy(deps.linkFor(code))`, then a `role=status` line "Link copied" or "Copy the code instead"), two seat cards (callsign, a connection dot, "Ready" when ready), the map, a "Ready" toggle (sends `ready` once; the room starts at the second), a lobby chat line (the Task 9 component), and Leave (confirm, then `transport.close()`, which sends `bye`, and navigate to `/versus`). With no pending transport (a direct link), it asks for a callsign and joins first, which is the guest's whole path: open the link, type a name, Ready. On `onStart(config)`: `handOver(code, { transport, seat, config })`, `saveSeat(...)`, then `navigate(routes.sandbox(config.map) + '?net=' + code, { replace: true })`. The disposer: before start, `close()` (bye); after `handOver`, nothing (the battlefield owns it now). If the battlefield never takes it, Task 7's boot drops it.

i18n keys (all in one block in `en.json`): `menu.nav.versus` "Play with a friend", `versus.title` "Play with a friend", `versus.callsign` "Your callsign", `versus.host.title` "Host a match", `versus.host.map` "Map", `versus.host.open` "Open a room", `versus.join.title` "Join a match", `versus.join.code` "Room code", `versus.join.go` "Join", `versus.room.title` "Room {code}", `versus.room.share` "Send your friend this code or link", `versus.room.copy` "Copy link", `versus.room.copied` "Link copied", `versus.room.copyFailed` "Copy failed: send the code instead", `versus.room.waiting` "Waiting for your friend", `versus.room.ready` "Ready", `versus.room.notReady` "Not ready", `versus.room.leave` "Leave", `versus.room.leave.confirm.title` "Leave the room?", `versus.room.leave.confirm.body` "The room closes for both of you.", `versus.room.leave.confirm.action` "Leave", `versus.error.notFound` "No room with that code", `versus.error.full` "That room is full", `versus.error.build` "Your friend is on a different version: both reload the page". Map labels reuse the existing `freePlay.map.<id>` keys.

- [ ] **Step 1: Write the failing tests**

`versus.test.ts` (`// @vitest-environment jsdom`, a `deps()` factory like `credits.test.ts`'s, a fake transport object implementing the methods the screen calls):
- `/versus`: hosting calls `open({ kind: 'create', map, callsign })` with the selected map and the typed callsign, then navigates to `/versus/ABCDEF`; the code field drops `0`, `O`, `1`, `I` and lower-cases become upper.
- `/versus/:code` with a pending transport: the code is shown; "Copy link" calls `copy` with the absolute link and shows "Link copied", or the fallback line when `copy` resolves false; a `lobby` with two connected seats renders both callsigns; "Ready" sends `ready` once however often it is clicked; `onStart` hands over and navigates to the sandbox URL with `net=ABCDEF`, replacing history.
- **A callsign `<img src=x onerror=alert(1)>` is rendered as text**: `stage.querySelector('img')` is null and the card's `textContent` contains the literal string.
- The disposer before start sends `bye` (calls `close`); after `onStart` it does not.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement** the two screens, the routes, the menu entry, the escape-back names and the strings. Every user-supplied string (callsigns, the code) goes through `textContent`. `versusDeps` in `main.ts` wires `open` to Task 5's create and join halves of `connectMatch` (factor them out as `openRoom` in `connect.ts` if they are not already separable; the battlefield path keeps calling `connectMatch`), `copy` to `navigator.clipboard?.writeText(...)` in a try, `maps` to the shipped map ids with their `freePlay.map.*` labels, and `callsign` to a guarded `localStorage` key `lions.versus.callsign`.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app/src/ui/versus.test.ts && pnpm typecheck && pnpm lint && pnpm validate:ui` → green. Falsify: render a callsign with `innerHTML` → the `<img>` test fails. Restore.
```bash
/usr/bin/git add packages/app/src/ui/versus.ts packages/app/src/ui/versus.test.ts packages/app/src/shell/links.ts packages/app/src/shell/escape-back.ts packages/app/src/ui/menu.ts packages/app/src/main.ts packages/app/src/i18n/en.json packages/app/src/net/connect.ts
/usr/bin/git commit -m "app: Play with a friend: host, join, and a lobby with the code on screen (N1b task 6)"
```

---

### Task 7: The battlefield takes the lobby's transport

**Files:**
- Modify: `packages/app/src/main.ts` (the connect block `:1641-1672`; `onDispose`), `packages/app/src/net/connect.ts`
- Test: `packages/app/src/net/connect.test.ts`

**Interfaces:**
- Consumes: `takeHanded`, `dropHanded` (Task 5); `WsTransport.setHooks` (Task 4).

- [ ] **Step 1: Write the failing test**

`connect.test.ts`: when a handed transport exists for the URL's code, `connectMatch` returns `{ transport, seat, config }` from it, calls `setHooks` once with the battlefield's hooks, and makes no fetch and opens no socket. When the URL's map differs from the handed config's map, it still returns the handed match (the battlefield's own map check reports the mismatch, as in N0).

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**

`connectMatch` first: `const handed = net !== null && net !== 'new' ? takeHanded(net.toUpperCase()) : null; if (handed) { handed.transport.setHooks(battlefieldHooks); return handed; }`, where `battlefieldHooks` are the same `onDesync`/`onEnded` notes it registers today. Ownership is then simple. Before `onStart`, the lobby owns the transport and its disposer closes it (`bye`). After `handOver`, the handoff module owns it until the battlefield takes it, and `handOver`'s 10 s expiry (Task 5) drops it if nothing does (the room then sees a gone seat, which is honest). Once taken, the battlefield owns it, and the existing `onDispose(() => transport.close())` in `main.ts` closes it on leave. Nothing is ever closed twice: each owner closes only what it holds.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app/src/net && pnpm typecheck` → green. Falsify: skip `takeHanded` → the test sees a fetch. Restore.
```bash
/usr/bin/git add packages/app/src/net/connect.ts packages/app/src/net/connect.test.ts packages/app/src/net/handoff.ts packages/app/src/net/handoff.test.ts packages/app/src/main.ts
/usr/bin/git commit -m "app: the battlefield takes the lobby's live transport; an untaken handoff expires (N1b task 7)"
```

---

### Task 8: Pause, resume and surrender in a match

**Files:**
- Modify: `packages/app/src/main.ts` (`pause` `:3092`, `resume` `:3176`, `onQuit` `:3140`, the frame loop's `paused` read), `packages/app/src/ui/pause.ts` (`PauseDeps`), `packages/app/src/ui/net-status.ts` (`paused` text with a countdown), `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/pause.test.ts`, `packages/app/src/ui/net-status.test.ts`

**Interfaces:**
- Produces: `PauseDeps` gains `onSurrender?: () => void` (present only in a room; a `Surrender` button with `data-act="surrender"` appears only then, and Quit is hidden when it is present) and `pauseNote?: string` (a line under the title, e.g. "No pauses left: the match keeps running"); `netStatusText` handles `{ kind: 'paused' }` as `t('net.paused', { seat, time })`, where `time` is the remaining m:ss read from `untilMs - now`.

Behaviour in a room:
- **Escape** opens the pause menu as today and calls `transport.pause()`. The menu shows `pauseNote` when this seat has no pauses left (the room ignored the request); the sim keeps running in that case, because the room is the clock.
- **Resume** in the menu calls `transport.resume()` and closes the menu. A pause the OTHER seat made shows the status line "Paused by {seat}: m:ss" and no menu; Escape still opens the menu (settings) without spending a pause when the room is already paused.
- **Surrender** confirms (`versus.surrender.confirm.*`: "Surrender the match?" / "Your friend wins." / "Surrender", danger), then `transport.surrender()`. The match-over panel (Task 10) follows from the room's `ended`.
- The local `paused` flag is not used in a room: `advanceClock` in a room already yields nothing to run, the room is the only clock (R33), and `transport.status().kind === 'paused'` drives `audio.setPaused`.

Strings: `net.paused` "Paused by {seat}: {time}", `pause.surrender` "Surrender", `pause.noPausesLeft` "No pauses left: the match keeps running", `versus.surrender.confirm.title`, `.body`, `.action`.

- [ ] **Step 1: Write the failing tests**

`pause.test.ts`: with `onSurrender` set, a `surrender` button exists and Quit does not; clicking it calls `onSurrender`; without `onSurrender` the menu is exactly as on `main` (assert the button list). `pauseNote` renders as text.
`net-status.test.ts`: `{ kind: 'paused', seat: 1, untilMs: now + 61_000 }` reads "Paused by B: 1:01" with `nameOf(1) === 'B'`.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement** as described; in `main.ts` branch on `netSeat !== null` inside `pause`, `resume` and the Quit wiring, keeping the single-player branch byte-identical.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app && pnpm typecheck && pnpm validate:ui` → green. Falsify: show Quit beside Surrender → the button-list test fails. Restore.
```bash
/usr/bin/git add packages/app/src/main.ts packages/app/src/ui/pause.ts packages/app/src/ui/pause.test.ts packages/app/src/ui/net-status.ts packages/app/src/ui/net-status.test.ts packages/app/src/i18n/en.json
/usr/bin/git commit -m "app: room pause with a countdown, resume, and surrender in a match (N1b task 8)"
```

---

### Task 9: Chat

**Files:**
- Create: `packages/app/src/ui/net-chat.ts`, `packages/app/src/ui/net-chat.test.ts`
- Modify: `packages/app/src/main.ts` (Enter opens chat in a room; incoming chat into the feed), `packages/app/src/input/keymap.ts` (an `openChat` action on Enter, room only), `packages/app/src/i18n/en.json`

**Interfaces:**
- Produces:
```ts
export interface ChatDeps { send(text: string): void; nameOf(seat: Seat): string; }
export class NetChat {
  constructor(parent: HTMLElement, deps: ChatDeps);
  open(): void;                 // shows the input, focuses it; Enter sends, Escape closes
  receive(seat: Seat, text: string): void;   // appends a line to its own log (lobby use)
  dispose(): void;
}
/** One feed line for the battlefield's HUD: both values escaped, then t(). */
export function chatFeedLine(name: string, text: string): string;
```
In the battlefield, incoming chat goes to `hud.note(chatFeedLine(...), 'info')`; the lobby uses `NetChat.receive`. Strings: `net.chat.placeholder` "Say something (Enter to send)", `net.chat.line` "{name}: {text}".

- [ ] **Step 1: Write the failing tests**

`net-chat.test.ts` (jsdom): Enter in the input calls `send` with the trimmed text and clears it; an empty input sends nothing; Escape closes without sending; `receive(1, '<b>x</b>')` adds a line whose `textContent` is `B: <b>x</b>` and which contains no `<b>` element; `chatFeedLine('<i>', '<img src=x>')` returns a string with no `<` that is not `&lt;`.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**, with `escapeHtml` from `ui/escape-html.ts` in `chatFeedLine`. While the chat input has focus, game keys must not fire: the input stops propagation of `keydown`, and the keymap ignores events whose target is an input (check `keymap.ts` already does; if not, add that one guard there with a test).

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app && pnpm typecheck && pnpm validate:ui` → green. Falsify: drop `escapeHtml` from `chatFeedLine` → its test fails. Restore.
```bash
/usr/bin/git add packages/app/src/ui/net-chat.ts packages/app/src/ui/net-chat.test.ts packages/app/src/main.ts packages/app/src/input/keymap.ts packages/app/src/i18n/en.json
/usr/bin/git commit -m "app: text chat in the lobby and the match, escaped everywhere (N1b task 9)"
```

---

### Task 10: The match ends on screen

**Files:**
- Create: `packages/app/src/net/outcome.ts`, `packages/app/src/net/outcome.test.ts`, `packages/app/src/ui/net-end.ts`, `packages/app/src/ui/net-end.test.ts`
- Modify: `packages/app/src/main.ts` (check every 20 ticks in a room; show the panel on `ended`), `packages/app/src/i18n/en.json`

**Interfaces:**
- Produces:
```ts
export type MatchOutcome =
  | { kind: 'ongoing' }
  | { kind: 'won'; side: 0 | 1; by: 'annihilation' | 'surrender' | 'left' }
  | { kind: 'draw'; by: 'mutual' | 'time' };
export const MATCH_CAP_TICKS = 25 * 60 * 20;
/** Spec §2.3, version one, read from sim state alone so both machines agree:
 *  a side with no living armed unit has lost; both on the same tick is a
 *  draw; the cap with both standing is a draw (the mirror map has no held
 *  ground to settle it -- that tiebreak arrives with zones in N3). */
export function outcomeOf(sim: OutcomeSim, tick: number): MatchOutcome;
export interface OutcomeSim { readonly entityCount: number; readonly state: { readonly side: ArrayLike<number>; readonly alive: ArrayLike<number>; readonly typeIdx: ArrayLike<number> }; readonly unitTypes: readonly { readonly weapons: readonly unknown[] }[] }
export function showNetEnd(host: HTMLElement, o: Exclude<MatchOutcome, { kind: 'ongoing' }>, viewer: 0 | 1, deps: { again(): void; menu(): void }): Disposer;
```
The panel: "Victory" / "Defeat" / "Draw" with the reason ("Their force is destroyed", "They surrendered", "They left the match", "Both forces destroyed", "Time"), and two buttons, "Play again" (to `/versus`) and "Main menu". It writes nothing: no ledger, no account, no credits, no save. The sim stops being stepped once the outcome is decided (`transport.close()` after the panel opens, which sends `bye`, and the room ends; the other seat's own check reaches the same result on the same tick).

- [ ] **Step 1: Write the failing tests**

`outcome.test.ts` with a hand-built `OutcomeSim` (types `[{ weapons: [1] }, { weapons: [] }]`, armed and unarmed):
- both sides with an armed unit → `ongoing`;
- side 1's only armed unit dead, an unarmed unit alive → `won` by side 0, `annihilation`;
- both sides' armed units dead → `draw`, `mutual`;
- `tick === MATCH_CAP_TICKS` with both standing → `draw`, `time`.
`net-end.test.ts` (jsdom): viewer 0 with `won` side 0 shows "Victory"; viewer 1 shows "Defeat"; "Play again" calls `again`.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**. In `main.ts`, in a room, every tick where `isHashTick` is true, call `outcomeOf(sim, sim.tickCount)`; on a result, show `showNetEnd`. On the transport's `onEnded('surrender', seat)` or `onEnded('left')`, show the panel with `by: 'surrender'` or `'left'` and the other side as the winner. `ended: 'void'` keeps Task 8's desync banner and shows no result.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app && pnpm typecheck && pnpm validate:ui` → green. Falsify: count unarmed units as alive → the annihilation test fails. Restore.
```bash
/usr/bin/git add packages/app/src/net/outcome.ts packages/app/src/net/outcome.test.ts packages/app/src/ui/net-end.ts packages/app/src/ui/net-end.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json
/usr/bin/git commit -m "app: the match ends on screen: annihilation, surrender, leave, draw (N1b task 10)"
```

---

### Task 11: The desync report, the capture walk, and the run protocol

**Files:**
- Modify: `packages/app/src/ui/net-status.ts` (the desync line names the room code as the reference and offers "Report"), `packages/app/src/main.ts` (Report opens the existing pause-menu feedback tab prefilled), `tools/src/ui-review/shoot.ts` (capture `/versus` and a `/versus/:code` lobby with a stubbed transport), `packages/app/src/i18n/en.json`
- Create: `docs/net/N1-friend-match.md`

**Interfaces:**
- The report reuses the feedback form unchanged: `category: 'bug'`, `source: 'pause'`, the text prefilled with "Desync in room {code} at {time}", and `context` carrying `{ room: code, seat, tick, hashes }`. The room has already written the evidence to D1 (Task 3), so no replay is attached. No schema, worker validator or D1 CHECK changes.

- [ ] **Step 1: Write the failing test**

`net-status.test.ts`: a `desync` status renders the room code and a button with `data-act="report"`; clicking it calls the `onReport` dependency once.

- [ ] **Step 2: Run and watch it fail; implement; run.** `net.desync` becomes "Desync at {time} in room {code}. The match is void." and `net.desync.report` "Report".

- [ ] **Step 3: The capture walk.** In `shoot.ts`, add two shots after the menu: `/versus`, and `/versus/TESTAB` with the screen's transport stubbed by an init script that defines a fake room (two seats, one ready). Do NOT open a real socket from the capture tool. These captures are for the lead's picture gate, not a voting baseline.

- [ ] **Step 4: Write the protocol**

`docs/net/N1-friend-match.md`:
```markdown
# N1 · A match with a friend

1. Both on the deployed build. The host opens the menu → **Play with a friend**,
   picks a map, presses **Open a room**, and sends the friend the code or the
   copied link.
2. The friend opens the link (or types the code under **Join a match**), enters
   a callsign, and both press **Ready**. The match starts for both.
3. Play. **Escape** pauses (three pauses each, 90 s each; only the one who
   paused can resume early). **Enter** opens chat.
4. Try once per session: reload one window mid-match. It rejoins by itself and
   catches up; the other window shows "Waiting for …" until it does.
5. The match ends when a force has no armed unit left, on surrender, or at 25
   minutes (a draw). Nothing is written to the campaign or the brigade.

Report on the N1 issue: map, length, how each ending was reached, any
"Waiting for" lines and how long they lasted, and any desync (its room code —
the evidence is already in D1, `match_desync`).
```

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/ui/net-status.ts packages/app/src/ui/net-status.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json tools/src/ui-review/shoot.ts docs/net/N1-friend-match.md
/usr/bin/git commit -m "app+tools: desync report by room code; lobby in the capture walk; the friend-match protocol (N1b task 11)"
```

---

## Self-review

**Spec coverage (N1, the shell half):** the menu entry, the `/versus` host and join screen, and a lobby with the code and copy link (Task 6, which also replaces the black waiting page the lead hit on 12 Oct); the lobby-to-battlefield handoff (Task 7); pause with a 3 × 90 s budget, resume by the pauser only, auto-resume (Tasks 2, 8); surrender as quit (Tasks 2, 8); rejoin after a reload and a replay fast enough for the 120 s window (Task 5); the friendly stall banners that N0 already shows, plus the paused countdown (Task 8); chat, escaped (Tasks 2, 9); the version-one win rule from sim state (Task 10); the desync logged by the room to D1 and reported by reference (Tasks 3, 11). **Deliberately not here:** networked pings (decision 15 makes them sender-and-advisor only, so they arrive with the advisor in N4; the local ping is unchanged); host-set game speed (realtime 1× only until there is a reason); the 120 s "claim the win" offer after a disconnect (the stall banner stands, and either player can surrender; the claim button is a small follow-up once the reconnect timing is measured in Task 5); faction choice (N3).

**Placeholders:** none. Task 6 tells the implementer to factor `openRoom` out of `connect.ts` only if the create and join halves are not already separable, and names the function.

**Type consistency:** `StorageLike` and `safeStorage` come from `telemetry/identity.ts`; `Handed` is defined in Task 5 and used in Tasks 6–7; `setHooks` and `detach` are defined in Task 4; `MatchOutcome` and `OutcomeSim` in Task 10; the new message shapes in Task 1 and used unchanged after.

**Review Focus pins:** 1 → Task 2; 2 → Tasks 2 and 9 (and Task 6 for callsigns); 3 → Task 5; 4 → Tasks 5–7; 5 → Task 10.
