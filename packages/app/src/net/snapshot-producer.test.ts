import { describe, expect, it, vi } from 'vitest';
import { gunzipCapped, readSnapshotHeader, readSnapshotMeta, sha256Hex, sidesOfFactions, validateConfig, SNAPSHOT_MAX_RAW_BYTES, type Frame, type MatchConfig, type MatchTransport, type TransportStatus } from '@lions/net';
import { Sim, restoreSim } from '@lions/sim';
import { buildMatchWorld } from './match-world';
import { runFrames, seatWorldFor } from './frame-step';
import { SnapshotProducer, type SnapshotProducerOptions, type UploadOutcome } from './snapshot-producer';
import { shippedContentDigest } from './content-digest';
import { prepareRejoin, snapshotLink } from './snapshot-link';

/** A versus room config with a 1,200-tick cadence (snapshot S4). */
function config(over: { every?: number; mode?: 'versus' | 'sandbox'; factions?: ['kdf' | 'sarim', 'kdf' | 'sarim'] } = {}): MatchConfig {
  const factions = over.factions ?? ['kdf', 'kdf'];
  const sides = sidesOfFactions(factions);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({
    matchId: 'ABCDEF', code: 'ABCDEF', seed: 7, map: 'tel_marum', mode: over.mode ?? 'versus', seats: [seat(0), seat(1)],
    pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b-1', dataDigest: 0,
    ...(over.every === undefined ? { snapshotEveryTicks: 1200 } : over.every === 0 ? {} : { snapshotEveryTicks: over.every }),
  });
  if (c === null) throw new Error('bad fixture');
  return c;
}

const tinySim = () => new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });

/** An upload spy: records (tick, bytes) and answers `outcome`. */
function uploads(outcome: UploadOutcome | 'hang' = 'stored') {
  const calls: { tick: number; gz: Uint8Array }[] = [];
  const upload = (tick: number, gz: Uint8Array): Promise<UploadOutcome> => {
    calls.push({ tick, gz });
    return outcome === 'hang' ? new Promise<UploadOutcome>(() => undefined) : Promise.resolve(outcome);
  };
  return { calls, upload };
}

function producer(over: Partial<SnapshotProducerOptions> = {}) {
  const u = uploads();
  const logs: string[] = [];
  const p = new SnapshotProducer({
    config: config(), build: 'b-1', sim: tinySim(), runtime: null, behind: () => 0, upload: u.upload,
    log: (l) => logs.push(l), contentDigest: 0xcafebabe, ...over,
  });
  return { p, logs, u };
}

const inflate = async (gz: Uint8Array): Promise<Uint8Array> => {
  const r = await gunzipCapped(gz, SNAPSHOT_MAX_RAW_BYTES);
  if (!r.ok) throw new Error(`inflate: ${r.reason}`);
  return r.bytes;
};

describe('SnapshotProducer', () => {
  it('uploads only on snapshot ticks: 1,198 and 1,200 nothing; 1,199 and 2,399 once each', async () => {
    const { p, u } = producer();
    for (const t of [1198, 1200, 0, 19]) p.onFrame(t, 5);
    await p.idle();
    expect(u.calls).toEqual([]);
    p.onFrame(1199, 5);
    await p.idle();
    p.onFrame(2399, 6);
    await p.idle();
    expect(u.calls.map((c) => c.tick)).toEqual([1199, 2399]);
    expect(p.stats()).toMatchObject({ encodes: 2, stored: 2, held: 0, recorded: 0, refused: 0, failed: 0, skipped: {} });
  });
  it('the bytes are a real snapshot of the sim with its meta, and the digest is written unsigned (digest >>> 0)', async () => {
    const { p, u } = producer();
    p.onFrame(1199, -559038737);
    await p.idle();
    expect(u.calls).toHaveLength(1);
    const raw = await inflate(u.calls[0]?.gz ?? new Uint8Array());
    expect(readSnapshotHeader(raw)).toMatchObject({ frameTick: 1199, matchDigest: 3735928559 });
  });
  it('a sandbox room, and a room with no cadence, produce nothing and say nothing', async () => {
    for (const cfg of [config({ mode: 'sandbox' }), config({ every: 0 })]) {
      const { p, u, logs } = producer({ config: cfg });
      p.onFrame(1199, 5);
      p.onFrame(1199, 5);
      await p.idle();
      expect(u.calls).toEqual([]);
      expect(logs).toEqual([]);
      expect(p.stats().skipped).toEqual({});
    }
  });
  it('a snapshot tick with no digest is skipped and counted (cannot happen on a hash tick)', () => {
    const { p, u, logs } = producer();
    p.onFrame(1199, null);
    expect(u.calls).toEqual([]);
    expect(p.stats().skipped).toEqual({ noDigest: 1 });
    expect(logs).toHaveLength(1);
  });
  it('encode throws: logged once, counted, never thrown out of onFrame or runFrames; the next cadence still uploads', async () => {
    let n = 0;
    const encode = vi.fn(() => { if (n++ === 0) throw new Error('queue over MAX_QUEUED_COMMANDS'); return new Uint8Array([1, 2, 3]); });
    const { p, u, logs } = producer({ encode: encode as never, gzip: () => Promise.resolve(new Uint8Array([9])) });
    expect(() => p.onFrame(1199, 5)).not.toThrow();
    expect(logs).toEqual(['snapshot: skipped tick 1199 (encode): queue over MAX_QUEUED_COMMANDS']);
    expect(p.stats()).toMatchObject({ encodes: 0, skipped: { encode: 1 } });
    p.onFrame(2399, 6);
    await p.idle();
    expect(u.calls.map((c) => c.tick)).toEqual([2399]);

    // And through the loop that calls it: runFrames survives a throwing encode.
    const sim = tinySim();
    const cfg = config();
    const bad = new SnapshotProducer({ config: cfg, build: 'b-1', sim, runtime: null, behind: () => 0, upload: uploads().upload, log: () => undefined, contentDigest: 1, encode: () => { throw new Error('boom'); } });
    class One implements MatchTransport {
      readonly local = false;
      private frames: Frame[] = [{ tick: 1199, cmds: [] }];
      queueCommand(): void {}
      take(max: number): Frame[] { return this.frames.splice(0, max); }
      reportTick(): void {}
      status(): TransportStatus { return { kind: 'live', behind: 0 }; }
      close(): void {}
    }
    const step = { transport: new One(), sim, seatWorld: seatWorldFor(cfg, sim), runTick: () => void sim.tick(), config: cfg, dataDigest: 1, afterFrame: (t: number, d: number | null) => bad.onFrame(t, d) };
    expect(runFrames(step, 4).ran).toBe(1);
    expect(bad.stats().skipped).toEqual({ encode: 1 });
  });
  it('one attempt per tick: a failed or refused upload is not repeated, even when the tick is offered again', async () => {
    for (const outcome of ['failed', 'refused'] as const) {
      const u = uploads(outcome);
      const { p } = producer({ upload: u.upload });
      p.onFrame(1199, 5);
      await p.idle();
      p.onFrame(1199, 5);
      await p.idle();
      expect(u.calls.map((c) => c.tick)).toEqual([1199]);
      expect(p.stats()).toMatchObject({ failed: outcome === 'failed' ? 1 : 0, refused: outcome === 'refused' ? 1 : 0, skipped: { repeat: 1 } });
    }
  });
  it('an upload that throws counts as failed, and the encode that threw is not repeated either', async () => {
    const { p } = producer({ upload: () => Promise.reject(new Error('net')) });
    p.onFrame(1199, 5);
    await p.idle();
    expect(p.stats().failed).toBe(1);
    const e = vi.fn(() => { throw new Error('x'); });
    const q = producer({ encode: e as never }).p;
    q.onFrame(1199, 5);
    q.onFrame(1199, 5);
    expect(e).toHaveBeenCalledTimes(1);
  });
  it('409 duplicate is "recorded", 409 mismatch is its own counter, 201 is stored and 202 is held', async () => {
    for (const [outcome, key] of [['duplicate', 'recorded'], ['mismatch', 'mismatch'], ['stored', 'stored'], ['held', 'held']] as const) {
      const { p } = producer({ upload: uploads(outcome).upload });
      p.onFrame(1199, 5);
      await p.idle();
      expect(p.stats()).toMatchObject({ stored: 0, held: 0, recorded: 0, mismatch: 0, refused: 0, failed: 0, [key]: 1 });
    }
  });
  it('in flight: an upload that never settles makes the next cadence skip, with no second upload', () => {
    const u = uploads('hang');
    const { p, logs } = producer({ upload: u.upload, gzip: () => Promise.resolve(new Uint8Array([1])) });
    p.onFrame(1199, 5);
    p.onFrame(2399, 6);
    p.onFrame(3599, 7);
    expect(p.stats().skipped).toEqual({ inFlight: 2 });
    expect(logs).toHaveLength(1);   // the reason is logged once, not per cadence
  });
  it('in flight clears when the upload settles: the next cadence goes through', async () => {
    const { p, u } = producer();
    p.onFrame(1199, 5);
    await p.idle();
    p.onFrame(2399, 6);
    await p.idle();
    expect(u.calls).toHaveLength(2);
  });
  it('behind: while the seat is more than a cadence behind, nothing is encoded; at exactly a cadence it is', async () => {
    const encode = vi.fn(() => new Uint8Array([1]));
    let behind = 1201;
    const { p, u } = producer({ behind: () => behind, encode: encode as never, gzip: () => Promise.resolve(new Uint8Array([1])) });
    p.onFrame(1199, 5);
    expect(encode).not.toHaveBeenCalled();
    expect(p.stats().skipped).toEqual({ behind: 1 });
    behind = 1200;
    p.onFrame(2399, 6);
    await p.idle();
    expect(u.calls.map((c) => c.tick)).toEqual([2399]);
  });
  it('oversize: a gzip of 65,537 bytes is skipped as tooLarge with no upload; 65,536 goes', async () => {
    const big = producer({ gzip: () => Promise.resolve(new Uint8Array(65537)) });
    big.p.onFrame(1199, 5);
    await big.p.idle();
    expect(big.u.calls).toEqual([]);
    expect(big.p.stats().skipped).toEqual({ tooLarge: 1 });
    const edge = producer({ gzip: () => Promise.resolve(new Uint8Array(65536)) });
    edge.p.onFrame(1199, 5);
    await edge.p.idle();
    expect(edge.u.calls).toHaveLength(1);
  });
  it('a gzip that rejects is skipped as gzip and frees the slot', async () => {
    let n = 0;
    const { p, u } = producer({ gzip: () => (n++ === 0 ? Promise.reject(new Error('cs')) : Promise.resolve(new Uint8Array([1]))) });
    p.onFrame(1199, 5);
    await p.idle();
    expect(p.stats().skipped).toEqual({ gzip: 1 });
    p.onFrame(2399, 6);
    await p.idle();
    expect(u.calls.map((c) => c.tick)).toEqual([2399]);
  });
  it('the encode sees the state at the call: bytes cut at tick 1199 do not move when the sim ticks on', async () => {
    const sim = tinySim();
    const { p, u } = producer({ sim });
    p.onFrame(1199, 5);
    sim.tick();
    sim.tick();
    await p.idle();
    const raw = await inflate(u.calls[0]?.gz ?? new Uint8Array());
    const fresh = tinySim();
    restoreSim(fresh, raw);
    expect(fresh.tickCount).toBe(0);
  });
  it('mirror and economy rooms: the runtime rides when the world has one, and the bytes restore onto a fresh world of the same room', async () => {
    for (const factions of [['kdf', 'kdf'], ['kdf', 'sarim']] as const) {
      const cfg = config({ factions: [...factions] });
      const w = buildMatchWorld(cfg);
      expect(w.runtime !== null).toBe(factions[1] === 'sarim');
      const { p, u } = producer({ config: cfg, sim: w.sim, runtime: w.runtime });
      p.onFrame(1199, 5);
      await p.idle();
      expect(u.calls).toHaveLength(1);
      const raw = await inflate(u.calls[0]?.gz ?? new Uint8Array());
      const fresh = buildMatchWorld(cfg);
      const meta = fresh.runtime === null ? restoreSim(fresh.sim, raw) : restoreSim(fresh.sim, raw, fresh.runtime);
      expect(meta).toMatchObject({ build: 'b-1', matchId: 'ABCDEF', frameTick: 1199, matchDigest: 5 });
      expect(fresh.sim.hash()).toBe(w.sim.hash());
    }
  }, 60_000);

  describe('the content digest is a u32 on the wire (S4 review F1)', () => {
    it('premise: the shipped digest is a signed int32 today (fnv1a32 returns h | 0); the cases below hold for either sign', () => {
      expect(Number.isInteger(shippedContentDigest())).toBe(true);
      expect(shippedContentDigest()).toBeGreaterThanOrEqual(-0x8000_0000);
      expect(shippedContentDigest()).toBeLessThan(0x8000_0000);
    });
    it('an injected NEGATIVE digest still encodes, and the meta carries its unsigned word', async () => {
      const { p, u } = producer({ contentDigest: -244563676 });
      p.onFrame(1199, 5);
      await p.idle();
      expect(p.stats().skipped).toEqual({});
      expect(u.calls).toHaveLength(1);
      expect(readSnapshotMeta(await inflate(u.calls[0]?.gz ?? new Uint8Array()))?.contentDigest).toBe(4050403620);
    });
    it('the REAL default (no contentDigest passed) encodes and uploads, and verifyFetched accepts its own output with the real shippedContentDigest()', async () => {
      const u = uploads();
      const logs: string[] = [];
      const p = new SnapshotProducer({ config: config(), build: 'b-1', sim: tinySim(), runtime: null, behind: () => 0, upload: u.upload, log: (l) => logs.push(l) });
      p.onFrame(1199, 5);
      await p.idle();
      expect({ skipped: p.stats().skipped, logs }).toEqual({ skipped: {}, logs: [] });
      expect(p.stats().stored).toBe(1);
      const gz = u.calls[0]?.gz ?? new Uint8Array();
      const raw = await inflate(gz);
      expect(readSnapshotMeta(raw)?.contentDigest).toBe(shippedContentDigest() >>> 0);
      // The reload side: serve exactly those bytes, with the headers the room would add.
      const sha = await sha256Hex(raw);
      const f = (() => Promise.resolve(new Response(gz as BodyInit, { status: 200, headers: { 'x-snapshot-tick': '1199', 'x-snapshot-digest': '5', 'x-snapshot-sha': sha } }))) as unknown as typeof fetch;
      const link = snapshotLink({ fetch: f, origin: 'https://game.example', code: 'ABCDEF', ticket: 't', yieldTurn: () => Promise.resolve() });
      const got = await prepareRejoin(link, { code: 'ABCDEF', build: 'b-1', contentDigest: shippedContentDigest() });
      expect(got).toMatchObject({ path: 'snapshot', verified: { frameTick: 1199, matchDigest: 5 } });
    });
  });
});
