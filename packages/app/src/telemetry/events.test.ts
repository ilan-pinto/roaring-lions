import { describe, it, expect } from 'vitest';
import { isTelemetryEvent, type TelemetryEnvelope } from '@lions/data/telemetry';
import { INTENT_KINDS, type PlayerIntent } from '../input/intents';
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
