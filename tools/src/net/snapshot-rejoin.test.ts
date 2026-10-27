// Snapshot S4, Task 13: real sims, end to end. Two `AgentClient`s with
// `snapshots: { produce: true }` play a room against the REAL `MatchRoom` (over
// the fake Durable Object runtime) for 3,000 ticks, in both kinds of versus
// room the game has:
//
//   - economy: a KDF v Sarim `wadi_tarfan` room, with a mission runtime (camps,
//     purses, production queues), so the snapshot carries the runtime's half;
//   - mirror: a KDF v KDF `tel_marum` room, with none.
//
// Then seat 1 reloads: its old client leaves with no `bye`, and a new one
// connects with `snapshots: { rejoin: true }` -- `AgentClient.connect` awaits
// the GET before the transport opens, so its hello can carry `from`. The
// assertions are the strongest ones the system has:
//
//   - the path ran (`rejoin().path === 'snapshot'` from 2,400): a green test
//     that fell back silently would prove nothing;
//   - after 600 more ticks both seats' hash checks grew with no desync;
//   - at the common frame tick 3,599 the BYTES `encodeSim` writes for seat 0's
//     world (which never left) and for the rejoiner's are equal. Hash equality
//     can hide a column the hash does not fold; byte equality cannot.
//
// A second case per room makes the restore refuse: the rejoiner restarts from
// zero, replays 0..N, and reaches the same byte equality, so the fallback is
// correct and not just taken.
//
// Never run beside `pnpm snapshot:witness` (the load changes nothing here but
// the timings). Each case plays its own 3,000 ticks, so a failure is its own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setImmediate as realImmediate } from 'node:timers/promises';
import { SnapshotRefused, encodeSim, type Command } from '@lions/sim';
import { shippedContentDigest } from '../../../packages/app/src/net/content-digest';
import type { MatchWorld } from '../../../packages/app/src/net/match-world';
import { AgentClient, type AgentSnapshotOptions } from './agent-client';
import { Loop, ROOM_BUILD, ROOM_CODE, ROOM_NOW, newRoom } from './test-room';

const SERVER = 'https://room.test';
const TILE = 65536;

beforeEach(() => { vi.useFakeTimers({ now: ROOM_NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

interface Spec {
  name: string;
  map: string;
  /** The host's faction; absent is the KDF mirror. */
  matchup?: 'kdf';
  economy: boolean;
  /** The room's sim seed. A room mints a random one unless it is told, and a test that is not told plays another world each run (some end
   *  before tick 3,600: seed 7 ends the mirror at 3,080, which `runTo` reports). These two keep the match going past 3,600. */
  seed: number;
}

const SPECS: Spec[] = [
  { name: 'economy: KDF v Sarim wadi_tarfan', map: 'wadi_tarfan', matchup: 'kdf', economy: true, seed: 8919 },
  { name: 'mirror: KDF v KDF tel_marum', map: 'tel_marum', economy: false, seed: 1000 },
];

/** A `fetch` that reaches the real room's snapshot route, recording what each call carried. */
interface Call { method: string; url: string }
const routed = (loop: Loop, calls: Call[]): typeof fetch => (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const h = new Headers(init?.headers);
  // The room object is reached directly, past the Worker's origin check (that rule is the Worker's own tests').
  calls.push({ method: init?.method ?? 'GET', url: String(input) });
  return loop.room.fetch(new Request('https://room/snapshot', { ...init, headers: h, duplex: 'half' } as RequestInit));
}) as typeof fetch;

const sideIds = (w: MatchWorld, side: 0 | 1): number[] => {
  const st = w.sim.state;
  const out: number[] = [];
  for (let i = 0; i < w.sim.entityCount; i++) if (st.alive[i] === 1 && st.side[i] === side) out.push(i);
  return out;
};

/** A squad of six marches on the enemy camp (a whole force ends the match inside ~1,160 ticks, so the world would be over before a snapshot). */
function march(a: AgentClient): void {
  const w = a.world() as MatchWorld;
  const v = a.view();
  const cmd: Command = { kind: 'attackMove', ids: sideIds(w, v.side).slice(0, 6), x: v.enemyCamp[0] * TILE, y: v.enemyCamp[1] * TILE };
  expect(a.desk.submit(cmd, a.tick())).not.toHaveProperty('error');
}

/** Production orders in an economy room: three units of the side's own doctrine, through the desk like any order. */
function produce(a: AgentClient, units: readonly string[]): void {
  const side = a.view().side;
  for (const unit of units) expect(a.desk.submit({ kind: 'build', side, unit, line: 0 }, a.tick())).not.toHaveProperty('error');
}
const KDF_WAVES = [['inf_squad', 'at_team', 'mortar_team'], ['at_team', 'inf_squad'], ['mortar_team', 'at_team']] as const;
const SARIM_WAVES = [['recoilless_team', 'atgm_cell', 'sarim_rifles'], ['atgm_cell', 'recoilless_team'], ['sarim_rifles', 'atgm_cell']] as const;
const waveFor = (a: AgentClient, n: 0 | 1 | 2): readonly string[] => (a.view().side === 0 ? KDF_WAVES[n] : SARIM_WAVES[n]);

/** Room ticks until every client has run exactly `end` frames, never one more (a client given none is not pumped). */
async function runTo(loop: Loop, cs: AgentClient[], end: number): Promise<void> {
  for (let i = 0; i < end * 3 && cs.some((c) => c.tick() < end); i++) {
    await loop.tick();
    for (const c of cs) {
      const n = Math.min(10, end - c.tick());
      if (n > 0) c.pump(n);
    }
    await loop.flush();
  }
  for (const c of cs) {
    expect(c.tick(), 'every client reached the tick').toBe(end);
    await c.snapshotIdle();
  }
}

interface Played {
  loop: Loop;
  a: AgentClient;
  b: AgentClient;
  t1: string;
  calls: Call[];
}

/** Two producing seats, played to 3,000 ticks. Three waves of production (economy) keep the runtime moving past the snapshot at 2,399. */
async function played(spec: Spec): Promise<Played> {
  const calls: Call[] = [];
  const room = await newRoom({ map: spec.map, room: { seed: () => spec.seed }, ...(spec.matchup === undefined ? {} : { matchup: spec.matchup }) });
  const { loop } = room;
  const t0 = await room.ticket(0);
  const t1 = await room.ticket(1);
  const seat = (ticket: string, s: 0 | 1): AgentClient => new AgentClient({
    server: SERVER, code: ROOM_CODE, ticket, build: ROOM_BUILD, role: 'seat', seat: s, open: loop.open, log: () => {},
    snapshots: { produce: true, fetch: routed(loop, calls), yieldTurn: (): Promise<void> => realImmediate() },
  });
  const a = seat(t0, 0);
  const b = seat(t1, 1);
  await loop.flush();
  await a.ready;
  await b.ready;
  // Premise: the world is the kind of room the case claims (a runtime in the economy room, none in the mirror).
  expect((a.world() as MatchWorld).runtime !== null).toBe(spec.economy);
  expect(a.config()?.snapshotEveryTicks).toBe(1200);
  march(a);
  march(b);
  if (spec.economy) { produce(a, waveFor(a, 0)); produce(b, waveFor(b, 0)); }
  await runTo(loop, [a, b], 1500);
  if (spec.economy) { produce(a, waveFor(a, 1)); produce(b, waveFor(b, 1)); }
  await runTo(loop, [a, b], 2650);
  if (spec.economy) { produce(a, waveFor(a, 2)); produce(b, waveFor(b, 2)); }
  await runTo(loop, [a, b], 3000);
  return { loop, a, b, t1, calls };
}

const accepted = (c: AgentClient): number => { const s = c.snapshotStats(); return s === null ? -1 : s.stored + s.held + s.recorded; };

/** Seat 1 is a reload: the old client leaves without a bye, and a new one connects with `snapshots`. */
async function reloaded(p: Played, snapshots: AgentSnapshotOptions): Promise<AgentClient> {
  p.b.transport.detach();
  await p.loop.flush();
  const b2 = await AgentClient.connect({
    server: SERVER, code: ROOM_CODE, ticket: p.t1, build: ROOM_BUILD, role: 'seat', seat: 1, open: p.loop.open, log: () => {},
    snapshots: { fetch: routed(p.loop, p.calls), yieldTurn: (): Promise<void> => realImmediate(), ...snapshots },
  });
  await p.loop.flush();
  await b2.ready;
  return b2;
}

/** The bytes the snapshot encoder writes for a client's world, with one fixed meta, so only the world differs. */
function bytesOf(c: AgentClient): Uint8Array {
  const w = c.world() as MatchWorld;
  return encodeSim(w.sim, { build: ROOM_BUILD, matchId: ROOM_CODE, contentDigest: shippedContentDigest() >>> 0, frameTick: 3599, matchDigest: 0 }, w.runtime ?? undefined);
}
/** Index of the first differing byte (or the shorter length), -1 when equal. */
function firstDiff(x: Uint8Array, y: Uint8Array): number {
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return i;
  return x.length === y.length ? -1 : n;
}

/** Both clients stand at the common frame tick 3,599 (3,600 frames run), the match is still on, and their worlds encode to the same bytes. */
function expectByteEqual(a: AgentClient, b2: AgentClient, spec: Spec): void {
  const wa = a.world() as MatchWorld;
  const wb = b2.world() as MatchWorld;
  expect(wa.sim.tickCount).toBe(3600);
  expect(wb.sim.tickCount).toBe(3600);
  // Premise: the match is still being played, so these are two live worlds and not two frozen ones.
  expect(a.result()).toBeNull();
  expect(b2.result()).toBeNull();
  expect(wa.sim.hash()).toBe(wb.sim.hash());
  const ra = bytesOf(a);
  const rb = bytesOf(b2);
  // The snapshot is the evidence's size: it holds the world, not just a header.
  expect(ra.length).toBeGreaterThan(10_000);
  if (spec.economy) expect(wa.runtime?.digest() ?? 0, 'the economy runtime has state in the bytes').not.toBe(0);
  expect(wb.runtime?.digest() ?? 0).toBe(wa.runtime?.digest() ?? 0);
  expect(firstDiff(ra, rb), `first differing byte of ${ra.length} v ${rb.length}`).toBe(-1);
}

describe.each(SPECS)('a real-sim snapshot rejoin ($name)', (spec) => {
  it('SNAPSHOT: seat 1 reloads after 3,000 ticks and boots on 2,399; 600 more ticks agree, and the bytes at 3,599 equal the seat that never left', async () => {
    const p = await played(spec);
    // Both cadences (1,199 and 2,399) were accepted from each seat, with no mismatch, refusal or failure.
    for (const c of [p.a, p.b]) {
      const s = c.snapshotStats();
      expect(accepted(c)).toBe(2);
      expect(s?.mismatch).toBe(0);
      expect(s?.refused).toBe(0);
      expect(s?.failed).toBe(0);
      expect(s?.encodes).toBe(2);
    }
    const b2 = await reloaded(p, { rejoin: true, produce: true });
    // The path ran, from the tick after the snapshot the room held.
    expect(b2.rejoin()).toMatchObject({ path: 'snapshot', from: 2400 });
    expect(p.calls.filter((c) => c.method === 'GET')).toHaveLength(1);
    // At most one cadence of frames to run to live (Ruling 9: 1,200 + 42).
    expect(b2.transport.behind()).toBeLessThanOrEqual(1242);
    expect(b2.transport.behind()).toBeGreaterThan(0);
    const okA = p.a.transport.stats().hashOk.count;
    const okB = b2.transport.stats().hashOk.count;
    await runTo(p.loop, [p.a, b2], 3600);
    // Hash checks grew on both seats, with no desync anywhere.
    expect(p.a.transport.stats().hashOk.count).toBeGreaterThan(okA + 10);
    expect(b2.transport.stats().hashOk.count).toBeGreaterThan(okB + 10);
    expect(p.a.transport.stats().desyncTick).toBeNull();
    expect(b2.transport.stats().desyncTick).toBeNull();
    for (const msgs of p.loop.received.values()) expect(msgs.some((m) => m.t === 'desync')).toBe(false);
    expectByteEqual(p.a, b2, spec);
  }, 30_000);

  it('FALLBACK: a restore that refuses restarts from zero, replays 0..N, and the bytes at 3,599 still equal the seat that never left', async () => {
    const p = await played(spec);
    const refuse = { restore: (): never => { throw new SnapshotRefused('test'); } };
    const b2 = await reloaded(p, { rejoin: true, restore: refuse });
    // The fallback ran (positive evidence), and it is a whole log: nothing below tick 0 is skipped.
    expect(b2.rejoin()).toEqual({ path: 'full', reason: 'refused' });
    expect(b2.transport.behind()).toBeGreaterThanOrEqual(2990);
    expect(b2.tick()).toBe(0);
    const okB = b2.transport.stats().hashOk.count;
    await runTo(p.loop, [p.a, b2], 3600);
    expect(b2.transport.stats().hashOk.count).toBeGreaterThan(okB + 10);
    expect(p.a.transport.stats().desyncTick).toBeNull();
    expect(b2.transport.stats().desyncTick).toBeNull();
    for (const msgs of p.loop.received.values()) expect(msgs.some((m) => m.t === 'desync')).toBe(false);
    expectByteEqual(p.a, b2, spec);
  }, 30_000);
});
