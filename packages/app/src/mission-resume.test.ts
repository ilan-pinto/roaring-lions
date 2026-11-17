/** GH-1393 slice 2: what a resumed mission is rebuilt from, and every reason a resume does not start. */
import { afterEach, describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import { SIM_EPOCH, SNAPSHOT_FORMAT } from '@lions/sim';
import { MISSION_SAVE_VERSION, digestOf, serializeSuspended, type SuspendedMission } from './mission-save';
import { SUSPEND_KEY, type KeyStore } from './mission-save-store';
import { captureShell, shellJson } from './mission-shell';
import { newMissionLog } from './mission-log';
import { campaignMoved, clearResumeProblem, loadResume, noteResumeProblem, parseStartInputs, peekResumeMoved, peekResumePosture, peekResumeProblem, startInputsJson, whatMoved } from './mission-resume';
import type { CampaignLedger } from './ledger-store';
import { gzipBytes } from '@lions/net';

const MISSION = Object.keys(missions).find((id) => !id.includes('tutorial')) ?? '';
const LEDGER = { 'campaign.mission_results': { m0: { stars: 2 } } } as unknown as CampaignLedger;
const TIERS = { mbt_lavi: { armour: 1 } };
const inputs = () => startInputsJson({ ledger: LEDGER, tiers: TIERS, unlocks: new Set(['b', 'a']), deploy: new Set([2, 0]) });
const shell = () => shellJson(captureShell({ log: newMissionLog(), deductions: [], lost: [], narratedRoe: new Set(), evacuated: 0, deadlinesWarned: new Set(), limitWarned: false }));
const LIVE = { ledger: LEDGER, unlocks: ['a', 'b'], tiers: TIERS };

async function record(over: Partial<SuspendedMission> = {}): Promise<SuspendedMission> {
  const raw = new Uint8Array(40); // not a real snapshot: loadResume only inflates and checks the header it can; see below
  void raw;
  const campaign = inputs();
  const shellRec = shell();
  // a header-valid stand-in is built by the real encoder in mission-save.test.ts; here only the record's own fields matter
  const gz = await gzipBytes(new Uint8Array([0x52, 0x4c, 0x53, 0x53, SNAPSHOT_FORMAT, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  return {
    version: MISSION_SAVE_VERSION, simEpoch: SIM_EPOCH, snapshotFormat: SNAPSHOT_FORMAT, build: 'b', missionId: MISSION, seed: 20260727, savedAt: 1, simTick: 0,
    contentDigest: 1, campaign, campaignDigest: digestOf(campaign), shell: shellRec, shellDigest: digestOf(shellRec), hashAtSave: { sim: 1, runtime: 2 }, rawBytes: 26,
    snapshot: Buffer.from(gz).toString('base64'), ...over,
  };
}
const store = (text: string | null): KeyStore => ({ getItem: () => text, setItem: () => undefined, removeItem: () => undefined });

afterEach(() => clearResumeProblem());

describe('the start inputs', () => {
  it('round-trip through JSON: sets sorted, the deploy pick as indices', () => {
    const j = JSON.parse(JSON.stringify(inputs()));
    const back = parseStartInputs(j);
    expect(back).toEqual({ ledger: LEDGER, tiers: TIERS, unlocks: ['a', 'b'], deploy: [0, 2] });
  });

  it('the deploy pick may be absent (the screen was never touched)', () => {
    const j = JSON.parse(JSON.stringify(startInputsJson({ ledger: LEDGER, tiers: {}, unlocks: [], deploy: null })));
    expect(parseStartInputs(j)?.deploy).toBeNull();
  });

  it('anything that is not exactly the shape is refused', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test pokes arbitrary nested fields of a plain JSON value
    type Loose = Record<string, any>;
    const good = JSON.parse(JSON.stringify(inputs())) as Loose;
    const bad = (mut: (o: Loose) => void): unknown => { const o = structuredClone(good); mut(o); return parseStartInputs(o); };
    expect(bad((o) => { delete o.ledger; })).toBeNull();
    expect(bad((o) => { o.unlocks = [1]; })).toBeNull();
    expect(bad((o) => { o.tiers.mbt_lavi.armour = -1; })).toBeNull();
    expect(bad((o) => { o.tiers.mbt_lavi.armour = 1.5; })).toBeNull();
    expect(bad((o) => { o.tiers = []; })).toBeNull();
    expect(bad((o) => { o.deploy = [0, 'x']; })).toBeNull();
    expect(bad((o) => { o.deploy = undefined; })).toBeNull();
    expect(parseStartInputs(null)).toBeNull();
  });
});

describe('campaignMoved: the live campaign is still the one the mission was started from', () => {
  const frozen = parseStartInputs(JSON.parse(JSON.stringify(inputs())))!;
  it('the same campaign is not moved, whatever the key order', () => {
    expect(campaignMoved(frozen, LIVE)).toBe(false);
    expect(campaignMoved(frozen, { ...LIVE, unlocks: ['b', 'a'] })).toBe(false);
  });
  it('another mission won, a unit bought, a tier bought: each is moved', () => {
    expect(campaignMoved(frozen, { ...LIVE, ledger: { ...LEDGER, 'campaign.mission_results': { m0: { stars: 2 }, m1: { stars: 1 } } } as unknown as CampaignLedger })).toBe(true);
    expect(campaignMoved(frozen, { ...LIVE, unlocks: ['a', 'b', 'c'] })).toBe(true);
    expect(campaignMoved(frozen, { ...LIVE, tiers: { mbt_lavi: { armour: 2 } } })).toBe(true);
  });
});

describe('whatMoved: which part of the campaign changed (GH-1393 follow-up)', () => {
  const frozen = parseStartInputs(JSON.parse(JSON.stringify(inputs())))!;
  const wonAnother = { ...LEDGER, 'campaign.mission_results': { m0: { stars: 2 }, m1: { stars: 1 } } } as unknown as CampaignLedger;
  it('names exactly the part that changed, one at a time', () => {
    expect(whatMoved(frozen, LIVE)).toEqual([]);
    expect(whatMoved(frozen, { ...LIVE, ledger: wonAnother })).toEqual(['ledger']);
    expect(whatMoved(frozen, { ...LIVE, unlocks: ['a', 'b', 'c'] })).toEqual(['units']);
    expect(whatMoved(frozen, { ...LIVE, tiers: { mbt_lavi: { armour: 2 } } })).toEqual(['upgrades']);
  });
  it('names all three in a fixed order when all three changed, and campaignMoved agrees with "not empty"', () => {
    const live = { ledger: wonAnother, unlocks: ['a', 'b', 'c'], tiers: { mbt_lavi: { armour: 2 } } };
    expect(whatMoved(frozen, live)).toEqual(['ledger', 'units', 'upgrades']);
    expect(campaignMoved(frozen, live)).toBe(true);
    expect(campaignMoved(frozen, LIVE)).toBe(whatMoved(frozen, LIVE).length > 0);
  });
});

describe('whatMoved: a posture change is its own reason (GH-1394 slice 2, ruling 6)', () => {
  const frozen = parseStartInputs(JSON.parse(JSON.stringify(inputs())))!;
  const on = (p: string | undefined): CampaignLedger => (p === undefined ? { ...LEDGER } : { ...LEDGER, 'campaign.difficulty': p }) as CampaignLedger;
  it('a changed posture alone reads as posture, never as another mission completed', () => {
    expect(whatMoved(frozen, { ...LIVE, ledger: on('easier') })).toEqual(['posture']);
    expect(whatMoved({ ...frozen, ledger: on('harder') }, { ...LIVE, ledger: on('easier') })).toEqual(['posture']);
  });
  it('an absent key and an explicit standard are the same campaign', () => {
    expect(whatMoved(frozen, { ...LIVE, ledger: on('standard') })).toEqual([]);
    expect(whatMoved({ ...frozen, ledger: on('standard') }, LIVE)).toEqual([]);
  });
  it('a posture change beside another mission won names both, the posture last', () => {
    const wonAnother = { ...on('easier'), 'campaign.mission_results': { m0: { stars: 2 }, m1: { stars: 1 } } } as unknown as CampaignLedger;
    expect(whatMoved(frozen, { ...LIVE, ledger: wonAnother })).toEqual(['ledger', 'posture']);
  });
});

describe('loadResume: every reason a resume does not start, and what it leaves behind', () => {
  const load = (rec: SuspendedMission | null, o: Partial<Parameters<typeof loadResume>[0]> = {}) =>
    loadResume({ missionId: MISSION, store: store(rec === null ? null : serializeSuspended(rec)), seed: 20260727, live: LIVE, ...o });

  it('nothing stored, or no storage: none, and no problem is noted', async () => {
    expect(await load(null)).toEqual({ ok: false, why: 'none' });
    expect(await loadResume({ missionId: MISSION, store: null, seed: 1, live: LIVE })).toEqual({ ok: false, why: 'none' });
    expect(peekResumeProblem()).toBeNull();
  });

  it('a save that will not load (an older epoch) is refused, kept, and noted by the card, not here', async () => {
    expect(await load(await record({ simEpoch: SIM_EPOCH + 1 }))).toEqual({ ok: false, why: 'refused' });
    expect(peekResumeProblem()).toBeNull();
  });

  it('another mission\'s save, or another seed: failed, noted', async () => {
    const other = Object.keys(missions).find((id) => id !== MISSION && !id.includes('tutorial')) ?? '';
    expect(await load(await record({ missionId: other }))).toEqual({ ok: false, why: 'failed' });
    expect(peekResumeProblem()).toBe('failed');
    clearResumeProblem();
    expect(await load(await record(), { seed: 5 })).toEqual({ ok: false, why: 'failed' });
  });

  it('a campaign that moved since the save: moved, noted, and the save is untouched', async () => {
    const moved = await load(await record(), { live: { ...LIVE, unlocks: ['a', 'b', 'extra'] } });
    expect(moved).toEqual({ ok: false, why: 'moved' });
    expect(peekResumeProblem()).toBe('moved');
    expect(peekResumeMoved()).toEqual(['units']); // and the board is told WHAT moved
    clearResumeProblem();
    expect(peekResumeMoved()).toEqual([]);
  });

  it('a posture changed since the save: moved, and the board is told which two postures', async () => {
    const moved = await load(await record(), { live: { ...LIVE, ledger: { ...LEDGER, 'campaign.difficulty': 'easier' } as CampaignLedger } });
    expect(moved).toEqual({ ok: false, why: 'moved' });
    expect(peekResumeMoved()).toEqual(['posture']);
    expect(peekResumePosture()).toEqual({ was: 'standard', now: 'easier' });
    clearResumeProblem();
    expect(peekResumePosture()).toBeNull();
    noteResumeProblem('moved', ['units'], { was: 'standard', now: 'standard' });
    expect(peekResumePosture()).toBeNull(); // kept only when the posture is one of the things that moved
    clearResumeProblem();
  });

  it('a later problem that is not "moved" forgets the cause it was holding', () => {
    noteResumeProblem('moved', ['ledger']);
    noteResumeProblem('failed', ['units']);
    expect(peekResumeMoved()).toEqual([]);
  });

  it('inputs or a shell that are not exactly their shapes: failed', async () => {
    const campaign = { ledger: {}, tiers: {}, unlocks: 'x', deploy: null };
    expect(await load(await record({ campaign: campaign as never, campaignDigest: digestOf(campaign as never) }))).toEqual({ ok: false, why: 'failed' });
    const sh = { v: 2 };
    expect(await load(await record({ shell: sh as never, shellDigest: digestOf(sh as never) }))).toEqual({ ok: false, why: 'failed' });
  });

  it('a good save loads: the record, the inflated snapshot, the inputs and the shell, and no problem is noted', async () => {
    noteResumeProblem('failed');
    const got = await load(await record());
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.loaded.inputs.unlocks).toEqual(['a', 'b']);
    expect(got.loaded.shell.v).toBe(1);
    expect(got.loaded.prepared.raw.byteLength).toBe(26);
    // loading does not clear an earlier note: the boot clears it once the restore has actually succeeded
    expect(peekResumeProblem()).toBe('failed');
  });

  it('the key it reads is the store\'s one key', async () => {
    let asked = '';
    const spy: KeyStore = { getItem: (k) => { asked = k; return null; }, setItem: () => undefined, removeItem: () => undefined };
    await loadResume({ missionId: MISSION, store: spy, seed: 1, live: LIVE });
    expect(asked).toBe(SUSPEND_KEY);
  });
});
