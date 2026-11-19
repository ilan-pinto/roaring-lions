// GH-1394 slice 1: the campaign posture as the app reads, stores and applies it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { postureOf, DIFFICULTY_LEDGER_KEY, RELIEF_TRIGGER_ID } from '@lions/data';
import { missions } from '@lions/data/content';
import { reinforceKey, type MissionJson } from '@lions/sim';
import { sanitiseLedger } from './ledger-shape';
import { memoryLedgerStore, newCampaign } from './ledger-store';
import { campaignMission, withReliefOnLoan } from './posture';

const foothold = missions.beit_sahwan_2_foothold as unknown as MissionJson;

describe('the campaign.difficulty ledger key', () => {
  it('reads Standard when absent, unknown or the wrong type (D2), and the posture when it is one of the three', () => {
    expect(postureOf({})).toBe('standard');
    expect(postureOf(null)).toBe('standard');
    expect(postureOf({ [DIFFICULTY_LEDGER_KEY]: 'nightmare' })).toBe('standard');
    expect(postureOf({ [DIFFICULTY_LEDGER_KEY]: 2 })).toBe('standard');
    expect(postureOf({ [DIFFICULTY_LEDGER_KEY]: 'easier' })).toBe('easier');
    expect(postureOf({ [DIFFICULTY_LEDGER_KEY]: 'harder' })).toBe('harder');
  });

  it('round-trips sanitiseLedger by reference, and a wrong value is dropped (the key then reads Standard)', () => {
    for (const p of ['easier', 'standard', 'harder']) {
      const ledger = { [DIFFICULTY_LEDGER_KEY]: p, 'campaign.completed_missions': ['a'] };
      expect(sanitiseLedger(ledger)).toBe(ledger);
    }
    for (const bad of ['nightmare', 3, null, ['easier'], { easier: true }]) {
      const out = sanitiseLedger({ [DIFFICULTY_LEDGER_KEY]: bad, 'campaign.completed_missions': ['a'] } as never);
      expect(Object.hasOwn(out, DIFFICULTY_LEDGER_KEY)).toBe(false);
      expect(out['campaign.completed_missions']).toEqual(['a']);
    }
  });

  it('survives the store and is reset by New campaign', () => {
    const store = memoryLedgerStore();
    store.writeLedger({ [DIFFICULTY_LEDGER_KEY]: 'easier' });
    expect(postureOf(store.readLedger())).toBe('easier');
    newCampaign(store);
    expect(postureOf(store.readLedger())).toBe('standard');
  });

  it('survives a mission end: the victory write spreads the produced keys over the ledger, never replacing it', () => {
    // main.ts: `const updatedLedger = carryover ? carryover.ledger : { ...ledger, ...mev.ledger }`. A mission's
    // `ledger.produces` never names the key, so the runtime's produced ledger cannot overwrite it.
    for (const m of Object.values(missions) as unknown as MissionJson[]) {
      expect(m.ledger.produces).not.toContain(DIFFICULTY_LEDGER_KEY);
    }
  });

  it('no app source reads a difficulty URL parameter: the posture comes from the ledger only (S11)', () => {
    const root = join(__dirname);
    const hits: string[] = [];
    for (const f of readdirSync(root, { recursive: true }) as string[]) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const src = readFileSync(join(root, f), 'utf8');
      if (/\.(get|has)\(\s*['"]difficulty['"]/.test(src) || /[?&]difficulty=/.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});

describe('campaignMission', () => {
  it('is the mission itself under Standard, absent key and a wrong value', () => {
    expect(campaignMission(foothold, {})).toBe(foothold);
    expect(campaignMission(foothold, { [DIFFICULTY_LEDGER_KEY]: 'standard' })).toBe(foothold);
    expect(campaignMission(foothold, { [DIFFICULTY_LEDGER_KEY]: 'nightmare' })).toBe(foothold);
  });

  it('leaves the tutorial as written under every posture (D12)', () => {
    const tut = missions.beit_sahwan_0_tutorial as unknown as MissionJson;
    for (const p of ['easier', 'standard', 'harder']) expect(campaignMission(tut, { [DIFFICULTY_LEDGER_KEY]: p })).toBe(tut);
  });

  it('labels the relief through the resolver the app passes, and leaves it unlabelled without one', () => {
    const easier = campaignMission(foothold, { [DIFFICULTY_LEDGER_KEY]: 'easier' }, (k) => `<${k}>`);
    const relief = (easier.triggers ?? []).find((t) => t.id === RELIEF_TRIGGER_ID);
    expect(relief?.label).toBe('<difficulty.relief.label>');
    const bare = campaignMission(foothold, { [DIFFICULTY_LEDGER_KEY]: 'easier' });
    expect((bare.triggers ?? []).find((t) => t.id === RELIEF_TRIGGER_ID)?.label).toBeUndefined();
  });
});

describe('withReliefOnLoan', () => {
  it('is the same set when there is no relief', () => {
    const loaned = new Set(['0:0']);
    expect(withReliefOnLoan(foothold, loaned)).toBe(loaned);
  });

  it('lends every body the relief brings, keeping what was already lent', () => {
    const easier = campaignMission(foothold, { [DIFFICULTY_LEDGER_KEY]: 'easier' });
    const i = (easier.triggers ?? []).findIndex((t) => t.id === RELIEF_TRIGGER_ID);
    expect(i).toBeGreaterThanOrEqual(0);
    const out = withReliefOnLoan(easier, new Set(['x']));
    expect([...out].sort()).toEqual(['x', reinforceKey(i, 0), reinforceKey(i, 1)].sort());
  });
});
