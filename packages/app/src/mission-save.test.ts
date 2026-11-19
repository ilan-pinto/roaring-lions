/**
 * GH-1393 slice 1: the save/resume library. The round trip runs the REAL economy room (`economyStreamConfig`: production lines, rally points,
 * a tunnel, a forged command), cuts it at a frame boundary, pushes the record through JSON and the gzip/base64 round trip as a store would,
 * restores it onto a freshly built world and requires the same sim hash and runtime digest every 20 ticks, and byte-equal canonical encodings
 * at the end (hash equality alone was shown to miss real divergence: the encoding is the strong half).
 */
import { describe, expect, it } from 'vitest';
import { type Frame, type MatchConfig, type MatchTransport, type TransportStatus } from '@lions/net';
import { encodeSim, SIM_EPOCH, SNAPSHOT_FORMAT } from '@lions/sim';
import { gunzipCapped, gzipBytes } from '@lions/net';
import { economyStreamConfig, economyStreamFrames } from './net/economy-stream.test-helper';
import { runFrames, seatWorldFor } from './net/frame-step';
import { buildMatchWorld, matchTick, type MatchWorld } from './net/match-world';
import { missions } from '@lions/data/content';
import { shippedContentDigest } from './net/content-digest';
import { restoreSim } from '@lions/sim';
import {
  MISSION_SAVE_VERSION,
  OLDER_VERSION_REASON,
  digestOf,
  parseSuspended,
  prepareResume,
  restoreMission,
  serializeSuspended,
  suspendMission,
  type JsonValue,
  type SuspendedMission,
} from './mission-save';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The economy room used here is not a campaign mission, so its id is told to be shipped; the real check has its own tests below. */
const parse = (text: string) => parseSuspended(text, { knownMission: () => true });

const CAMPAIGN: JsonValue = { ledger: { 'campaign.mission_results': { m0: { stars: 2 } }, credits: 120 }, account: { owned: ['mbt_lavi'], tiers: { mbt_lavi: 1 } }, roar: { paid: 0 } };
const SHELL: JsonValue = { losses: [{ id: 'a', cause: 'atgm' }], kills: 3, deadlinesWarned: [60] };

class Feed implements MatchTransport {
  readonly local = false;
  private frames: Frame[];
  constructor(frames: readonly Frame[]) { this.frames = [...frames]; }
  queueCommand(): void {}
  take(max: number): Frame[] { return this.frames.splice(0, max); }
  reportTick(): void {}
  status(): TransportStatus { return { kind: 'live', behind: this.frames.length }; }
  close(): void {}
}

interface Client { w: MatchWorld & { runtime: NonNullable<MatchWorld['runtime']> }; next: number }
const frames = economyStreamFrames();
const config: MatchConfig = economyStreamConfig();

function client(): Client {
  const w = buildMatchWorld(config);
  if (w.runtime === null) throw new Error('the economy room must have a runtime');
  return { w: w as Client['w'], next: 0 };
}
/** Runs the frames from `c.next` up to (not including) `to`, as the browser's room body does. */
function advance(c: Client, to: number): void {
  const step = { transport: new Feed(frames.slice(c.next, to)), sim: c.w.sim, seatWorld: seatWorldFor(config, c.w.sim), config, runTick: () => { matchTick(c.w); } };
  const r = runFrames(step, to - c.next);
  c.next += r.ran;
  expect(c.next).toBe(to);
}
const figures = (c: Client) => ({ sim: c.w.sim.hash() >>> 0, runtime: c.w.runtime.digest() >>> 0 });
const encoding = (c: Client) => Buffer.from(encodeSim(c.w.sim, {}, c.w.runtime)).toString('base64');

async function save(c: Client, over: { campaign?: JsonValue; shell?: JsonValue; maxCompressedBytes?: number } = {}) {
  const r = await suspendMission({
    sim: c.w.sim, runtime: c.w.runtime, contentDigest: shippedContentDigest(), missionId: 'wadi_tarfan_room', seed: config.seed, build: '0.130.9', savedAt: 1_790_000_000_000,
    campaign: over.campaign ?? CAMPAIGN, shell: over.shell ?? SHELL, ...(over.maxCompressedBytes === undefined ? {} : { maxCompressedBytes: over.maxCompressedBytes }),
  });
  if (!r.ok) throw new Error(`suspend refused: ${r.reason} ${r.detail}`);
  return r.record;
}
/** The record as a store returns it. */
const stored = (rec: SuspendedMission): SuspendedMission => {
  const p = parse(serializeSuspended(rec));
  if (!p.ok) throw new Error(`the record did not survive storage: ${p.reason}`);
  return p.record;
};
async function resumeOnto(rec: SuspendedMission, c: Client = client()) {
  const prep = await prepareResume(rec, { contentDigest: shippedContentDigest() });
  if (!prep.ok) return { ok: false as const, reason: prep.reason, c };
  const r = restoreMission(prep, c.w);
  return r.ok ? { ok: true as const, c, contentChanged: prep.contentChanged } : { ok: false as const, reason: r.reason, c };
}

describe('resume parity: the saved mission and the uninterrupted one stay equal', () => {
  // 0: before anything; 100: builds in flight and a rally set; 520: second wave; 760: the tunnel raid is under way.
  for (const T of [0, 100, 520, 760]) {
    it(`cut at tick ${T}: the restored world hashes alike at once, every 20 ticks after, and encodes byte for byte alike`, async () => {
      const a = client();
      advance(a, T);
      const rec = stored(await save(a));
      expect(rec.simTick).toBe(T);
      const r = await resumeOnto(rec);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const b = r.c;
      b.next = T;
      expect(figures(b)).toEqual(figures(a)); // the done-means: equal at the save, before any tick
      expect(encoding(b)).toBe(encoding(a));
      for (let t = T + 20; t <= T + 300; t += 20) {
        advance(a, t);
        advance(b, t);
        expect(figures(b), `tick ${t}`).toEqual(figures(a));
      }
      expect(encoding(b)).toBe(encoding(a));
    }, 60_000);
  }

  it('the frozen campaign inputs and the shell record come back exactly as saved', async () => {
    const a = client();
    advance(a, 40);
    const rec = stored(await save(a));
    expect(rec.campaign).toEqual(CAMPAIGN);
    expect(rec.shell).toEqual(SHELL);
    expect(rec.campaignDigest).toBe(digestOf(CAMPAIGN));
    expect(rec.build).toBe('0.130.9');
    expect(rec.simEpoch).toBe(SIM_EPOCH);
    expect(rec.snapshotFormat).toBe(SNAPSHOT_FORMAT);
  });
});

describe('a one-field tamper or a dropped column is refused, never loaded', () => {
  it('the saved hash moved by one, either figure: damaged', async () => {
    const a = client();
    advance(a, 200);
    const rec = await save(a);
    for (const which of ['sim', 'runtime'] as const) {
      const bad = { ...rec, hashAtSave: { ...rec.hashAtSave, [which]: (rec.hashAtSave[which] + 1) >>> 0 } };
      expect(await resumeOnto(stored(bad)), which).toMatchObject({ ok: false, reason: 'damaged' });
    }
  });

  it('a snapshot with one column zeroed (hp) restores cleanly but is refused by the hash check', async () => {
    const a = client();
    advance(a, 200);
    const rec = await save(a);
    const c = client();
    advance(c, 200);
    c.w.sim.state.hp.fill(0);
    const gz = await gzipBytes(encodeSim(c.w.sim, { matchId: rec.missionId, frameTick: 200 }, c.w.runtime));
    const raw = encodeSim(c.w.sim, { matchId: rec.missionId, frameTick: 200 }, c.w.runtime);
    const forged: SuspendedMission = { ...rec, snapshot: Buffer.from(gz).toString('base64'), rawBytes: raw.byteLength };
    expect(await resumeOnto(stored(forged))).toMatchObject({ ok: false, reason: 'damaged' });
  });

  it('one byte flipped anywhere in the inflated snapshot: refused every time it is read as a different world', async () => {
    const a = client();
    advance(a, 200);
    const rec = await save(a);
    const raw = (await gunzipCapped(Buffer.from(rec.snapshot, 'base64'), 8 * 1024 * 1024));
    if (!raw.ok) throw new Error('gunzip');
    let refused = 0;
    let tried = 0;
    for (let at = 64; at < raw.bytes.length; at += Math.max(1, Math.floor(raw.bytes.length / 60))) {
      const bytes = new Uint8Array(raw.bytes);
      bytes[at] = (bytes[at] ?? 0) ^ 0xff;
      const forged: SuspendedMission = { ...rec, snapshot: Buffer.from(await gzipBytes(bytes)).toString('base64') };
      const r = await resumeOnto(stored(forged));
      tried++;
      if (!r.ok) refused++;
    }
    expect(tried).toBeGreaterThan(40);
    // A flip in a byte the hash does not read can pass (the hash is not the whole encoding); the rest must not. Most of the file is read.
    expect(refused).toBeGreaterThan(tried * 0.5);
  });

  it('the frozen campaign or the shell record changed by one field: damaged', async () => {
    const a = client();
    advance(a, 60);
    const rec = await save(a);
    const campaign = { ...(CAMPAIGN as Record<string, JsonValue>), ledger: { 'campaign.mission_results': { m0: { stars: 3 } }, credits: 120 } };
    expect(parse(JSON.stringify({ ...rec, campaign }))).toEqual({ ok: false, reason: 'damaged' });
    expect(parse(JSON.stringify({ ...rec, shell: { ...(SHELL as Record<string, JsonValue>), kills: 4 } }))).toEqual({ ok: false, reason: 'damaged' });
  });

  it('a corrupt or truncated snapshot payload: damaged', async () => {
    const a = client();
    advance(a, 60);
    const rec = await save(a);
    expect(await resumeOnto(stored({ ...rec, snapshot: '!!!not base64!!!' }))).toMatchObject({ ok: false, reason: 'damaged' });
    expect(await resumeOnto(stored({ ...rec, snapshot: rec.snapshot.slice(0, Math.floor(rec.snapshot.length / 2)) }))).toMatchObject({ ok: false, reason: 'damaged' });
  });
});

describe('the version stamp: refused only when the sim or the format version changed', () => {
  async function record(): Promise<SuspendedMission> {
    const a = client();
    advance(a, 60);
    return save(a);
  }

  it.each([
    ['the record version', { version: MISSION_SAVE_VERSION + 1 }],
    ['the sim epoch', { simEpoch: SIM_EPOCH + 1 }],
    ['the snapshot format', { snapshotFormat: SNAPSHOT_FORMAT + 1 }],
  ])('%s differs: older_version, and the record parses no further', async (_name, patch) => {
    const rec = await record();
    expect(parse(JSON.stringify({ ...rec, ...patch }))).toEqual({ ok: false, reason: 'older_version' });
  });

  it('the state table changed (schema digest word in the snapshot header): older_version', async () => {
    const rec = await record();
    const raw = await gunzipCapped(Buffer.from(rec.snapshot, 'base64'), 8 * 1024 * 1024);
    if (!raw.ok) throw new Error('gunzip');
    const bytes = new Uint8Array(raw.bytes);
    bytes[6] = (bytes[6] ?? 0) ^ 0x01; // the schema digest word sits after the magic and the format
    const forged: SuspendedMission = { ...rec, snapshot: Buffer.from(await gzipBytes(bytes)).toString('base64') };
    expect(await resumeOnto(stored(forged))).toMatchObject({ ok: false, reason: 'older_version' });
  });

  it('a different BUILD string is not grounds for refusal: a save survives an update that did not change the sim (lead, GH-1393)', async () => {
    const rec = await record();
    const r = await resumeOnto(stored({ ...rec, build: '0.999.0' }));
    expect(r.ok).toBe(true);
  });

  it('changed shipped data is reported, not refused: contentChanged', async () => {
    const rec = await record();
    const prep = await prepareResume(stored(rec), { contentDigest: (rec.contentDigest + 1) >>> 0 });
    expect(prep.ok && prep.contentChanged).toBe(true);
    const same = await prepareResume(stored(rec), { contentDigest: shippedContentDigest() });
    expect(same.ok && same.contentChanged).toBe(false);
  });

  it('text that is not a record: unreadable', () => {
    expect(parse('')).toEqual({ ok: false, reason: 'unreadable' });
    expect(parse('{')).toEqual({ ok: false, reason: 'unreadable' });
    expect(parse('[]')).toEqual({ ok: false, reason: 'unreadable' });
    expect(parse('{"version":1}')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a record missing one field: unreadable', async () => {
    const rec = await record();
    const { missionId: _m, ...rest } = rec;
    void _m;
    expect(parse(JSON.stringify(rest))).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('the world it is restored onto', () => {
  it('a world built for another map is world_mismatch, not a half-loaded mission', async () => {
    const a = client();
    advance(a, 60);
    const rec = await save(a);
    const other = buildMatchWorld({ ...config, map: 'wadi_tarfan_l' });
    if (other.runtime === null) throw new Error('the other room must have a runtime');
    const r = await resumeOnto(stored(rec), { w: other as Client['w'], next: 0 });
    expect(r).toMatchObject({ ok: false, reason: 'world_mismatch' });
  });
});

describe('saving', () => {
  it('a snapshot over the size cap is too_large, never a truncated record', async () => {
    const a = client();
    advance(a, 200);
    const r = await suspendMission({ sim: a.w.sim, runtime: a.w.runtime, contentDigest: shippedContentDigest(), missionId: 'm', seed: 1, build: 'b', savedAt: 1, campaign: CAMPAIGN, maxCompressedBytes: 100 });
    expect(r).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('inputs that are not JSON are encode_failed, never thrown', async () => {
    const a = client();
    const r = await suspendMission({ sim: a.w.sim, runtime: a.w.runtime, contentDigest: shippedContentDigest(), missionId: 'm', seed: 1, build: 'b', savedAt: 1, campaign: { n: Number.NaN } });
    expect(r).toMatchObject({ ok: false, reason: 'encode_failed' });
  });

  it('a mid-fight economy room fits well inside the size cap (the S0 census: raw, gzip and stored text)', async () => {
    const a = client();
    advance(a, 900);
    const rec = await save(a);
    const gz = Buffer.from(rec.snapshot, 'base64').length;
    expect(gz).toBeLessThan(128 * 1024);
    expect(serializeSuspended(rec).length).toBeLessThan(250 * 1024);
  });
});

describe('invariant 4: the library reaches the sim only through restoreSim', () => {
  it('mission-save.ts names no sim column, no snapshot internals and no storage', () => {
    const src = readFileSync(join(__dirname, 'mission-save.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\.state\b|internals\(|localStorage|sessionStorage|indexedDB/);
  });
});



describe('the refusal reasons the mapping depends on are pinned against the real sim (GH-1393 review note 3)', () => {
  /** A real, valid snapshot's bytes with one header word changed, restored onto a fresh world: the reason the sim gives. */
  async function reasonFor(patch: (raw: Uint8Array) => void): Promise<string> {
    const a = client();
    advance(a, 60);
    const rec = await save(a);
    const raw = await gunzipCapped(Buffer.from(rec.snapshot, 'base64'), 8 * 1024 * 1024);
    if (!raw.ok) throw new Error('gunzip');
    const bytes = new Uint8Array(raw.bytes);
    patch(bytes);
    const b = client();
    try {
      restoreSim(b.w.sim, bytes, b.w.runtime);
    } catch (e) {
      return (e as { reason?: string }).reason ?? String(e);
    }
    throw new Error('the doctored snapshot restored');
  }

  // Header: magic(4) format(u16 at 4) schema digest(u32 at 6) match digest(u32 at 10) content(u32 at 14) frameTick(u32 at 18) tickCount(i32 at 22)
  // capacity(u32 at 26) width(u32 at 30) height(u32 at 34) boulders(u8 at 38) hasRuntime(u8 at 39) runtimeSchemaDigest(u32 at 40).
  it('a different format word reads "format N, ...": an older save', async () => {
    const why = await reasonFor((b) => { b[4] = (b[4] ?? 0) ^ 0x02; });
    expect(why).toMatch(/^format /);
    expect(OLDER_VERSION_REASON.test(why), why).toBe(true);
  });

  it('a different schema digest reads "schema digest differs...": an older save', async () => {
    const why = await reasonFor((b) => { b[6] = (b[6] ?? 0) ^ 0x01; });
    expect(why).toMatch(/^schema digest differs/);
    expect(OLDER_VERSION_REASON.test(why), why).toBe(true);
  });

  it('a different runtime schema digest reads "runtime schema digest differs...": an older save', async () => {
    const why = await reasonFor((b) => { b[40] = (b[40] ?? 0) ^ 0x01; });
    expect(why).toMatch(/^runtime schema digest differs/);
    expect(OLDER_VERSION_REASON.test(why), why).toBe(true);
  });

  it('the STRUCTURAL refusals (another capacity, another map size, a runtime on one side only) are NOT older saves', async () => {
    const cases: [(b: Uint8Array) => void, RegExp][] = [
      [(b) => { b[26] = (b[26] ?? 0) ^ 0x01; }, /^capacity /],
      [(b) => { b[30] = (b[30] ?? 0) ^ 0x01; }, /^width /],
      [(b) => { b[39] = 0; }, /^the snapshot carries no runtime, this world has one/],
    ];
    for (const [patch, expected] of cases) {
      const why = await reasonFor(patch);
      expect(why).toMatch(expected); // the offset hit the word it names, not some other check
      expect(OLDER_VERSION_REASON.test(why), why).toBe(false);
    }
  });

  it('the pattern itself: it names the three and matches nothing it should not', () => {
    for (const yes of ['format 2, this build reads 1', 'schema digest differs: written by a build with another state table', 'runtime schema digest differs: written by a build with another runtime table']) expect(OLDER_VERSION_REASON.test(yes), yes).toBe(true);
    for (const no of ['capacity 128, this world has 256', 'boulders differ: the target world was not set up like the source', 'unit 3: type 9 is not registered', 'the snapshot carries a runtime, this world has none', 'malformed: truncated']) expect(OLDER_VERSION_REASON.test(no), no).toBe(false);
  });
});

describe('the mission must still be shipped (GH-1393 review note 5)', () => {
  it('a record naming a mission this build does not ship is mission_unknown, before its digests are looked at', async () => {
    const a = client();
    advance(a, 40);
    const rec = await save(a);
    expect(parseSuspended(serializeSuspended(rec))).toEqual({ ok: false, reason: 'mission_unknown' }); // the real, default check
    // even a record whose campaign digest is also wrong says the mission first: the cheaper, more useful answer
    expect(parseSuspended(JSON.stringify({ ...rec, campaign: { x: 1 } }))).toEqual({ ok: false, reason: 'mission_unknown' });
  });

  it('every shipped mission id passes the default check, and a near miss does not', async () => {
    const a = client();
    advance(a, 40);
    const rec = await save(a);
    const id = Object.keys(missions)[0] ?? '';
    expect(id).not.toBe('');
    expect(parseSuspended(JSON.stringify({ ...rec, missionId: id })).ok).toBe(true);
    expect(parseSuspended(JSON.stringify({ ...rec, missionId: id + '_x' })).ok).toBe(false);
    expect(parseSuspended(JSON.stringify({ ...rec, missionId: id.toUpperCase() })).ok).toBe(false);
    expect(parseSuspended(JSON.stringify({ ...rec, missionId: '__proto__' })).ok).toBe(false);
    expect(parseSuspended(JSON.stringify({ ...rec, missionId: 'constructor' })).ok).toBe(false);
  });
});

describe('the challenge amendments are stored, optional, and absent today (PR 1459, D10 pending)', () => {
  it('a save made without them has no amendments field at all, in the object or in the text', async () => {
    const a = client();
    advance(a, 40);
    const rec = await save(a);
    expect('amendments' in rec).toBe(false);
    expect(serializeSuspended(rec)).not.toContain('amendments');
    expect(parse(serializeSuspended(rec))).toMatchObject({ ok: true });
  });

  it('ids given at save time come back as they were, in order', async () => {
    const a = client();
    advance(a, 40);
    const r = await suspendMission({ sim: a.w.sim, runtime: a.w.runtime, contentDigest: shippedContentDigest(), missionId: 'm', seed: 1, build: 'b', savedAt: 1, campaign: CAMPAIGN, amendments: ['light_order', 'clean_hands'] });
    if (!r.ok) throw new Error(r.reason);
    const back = parse(serializeSuspended(r.record));
    expect(back.ok && back.record.amendments).toEqual(['light_order', 'clean_hands']);
  });

  it('an id that is not a plain lower-case id is not saved, and a record carrying one is unreadable', async () => {
    const a = client();
    advance(a, 40);
    const bad = await suspendMission({ sim: a.w.sim, runtime: a.w.runtime, contentDigest: shippedContentDigest(), missionId: 'm', seed: 1, build: 'b', savedAt: 1, campaign: CAMPAIGN, amendments: ['Light Order'] });
    expect(bad).toMatchObject({ ok: false, reason: 'encode_failed' });
    const rec = await save(a);
    for (const amendments of ['light_order', [1], ['A'], ['x'.repeat(41)], Array.from({ length: 17 }, (_, i) => `a${i}`)]) {
      expect(parse(JSON.stringify({ ...rec, amendments })), JSON.stringify(amendments)).toEqual({ ok: false, reason: 'unreadable' });
    }
  });
});
