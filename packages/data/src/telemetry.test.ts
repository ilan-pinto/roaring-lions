import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, it, expect } from 'vitest';
import { isTelemetryEvent, TELEMETRY_EVENT_TYPES, TELEMETRY_ORDER_VERBS } from './telemetry';

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
  { ...ENV, type: 'tutorial_step', step: 4, steps: 9, prevMs: 8123, id: 'identify_then_shoot' },
  { ...ENV, type: 'mission_start', mission: 'beit_sahwan_breach', replay: false },
  { ...ENV, type: 'objective', mission: 'beit_sahwan_breach', objective: 'hold_gate', objectiveType: 'hold_for', primary: true, status: 'complete', tick: 4000 },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'victory', tick: 6000, roe: 94, fielded: 12, lost: 2, objectivesDone: 3, objectivesTotal: 4 },
  { ...ENV, type: 'mission_end', mission: 'wadi_halam_5_depot', result: 'defeat', cause: 'objective:raze_depot', tick: 6000, roe: 61, fielded: 9, lost: 9, objectivesDone: 0, objectivesTotal: 2 },
  { ...ENV, type: 'mission_end', mission: 'wadi_halam_5_depot', result: 'abandoned', tick: 900, roe: 100, fielded: 9, lost: 0, objectivesDone: 0, objectivesTotal: 2 },
  { ...ENV, type: 'campaign_progress', mission: 'beit_sahwan_breach', missionsWon: 1 },
  { ...ENV, t: 9007199254740991, type: 'mission_start', mission: 'beit_sahwan_breach', replay: false },
  { ...ENV, type: 'tutorial_step', step: 0, steps: 1, prevMs: 9007199254740991 },
  { ...ENV, type: 'mission_start', mission: 'beit_sahwan_breach', replay: false, deployed: { inf_squad: 3, mbt_lavi: 1 }, fromRoster: { inf_squad: 2 } },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'victory', tick: 6000, roe: 94, fielded: 12, lost: 2, objectivesDone: 3, objectivesTotal: 4, bought: { inf_squad: 1 }, orders: { move: 40, attackMove: 12, strike: 1 } },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'abandoned', tick: 90, roe: 100, fielded: 4, lost: 0, objectivesDone: 0, objectivesTotal: 2, bought: {}, orders: {} },
  { ...ENV, type: 'account', reason: 'mission_start', mission: 'beit_sahwan_breach', credits: 340, earned: 900, unlocks: ['mbt_lavi'], tiers: ['inf_squad.armour.2', 'inf_squad.sensors.1'] },
  { ...ENV, type: 'account', reason: 'payout', mission: 'beit_sahwan_breach', credits: 120, earned: 120, unlocks: [], tiers: [], paid: 120 },
  { ...ENV, type: 'account', reason: 'purchase', credits: 225, earned: 900, unlocks: [], tiers: ['inf_squad.armour.1'], item: 'inf_squad.armour.1', price: 115 },
  { ...ENV, type: 'account', reason: 'purchase', credits: 0, earned: 900, unlocks: ['mbt_lavi'], tiers: [], item: 'mbt_lavi', price: 900 },
  { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: [] },
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
  ['t exceeds MAX_SAFE_INTEGER', { ...ENV, t: 9007199254740992, type: 'mission_start', mission: 'a', replay: false }],
  ['tutorial beat id that is free text', { ...ENV, type: 'tutorial_step', step: 0, steps: 9, prevMs: 0, id: 'Look around' }],
  ['tutorial beat id of the wrong type', { ...ENV, type: 'tutorial_step', step: 0, steps: 9, prevMs: 0, id: 4 }],
  ['prevMs exceeds MAX_SAFE_INTEGER', { ...ENV, type: 'tutorial_step', step: 0, steps: 1, prevMs: 9007199254740992 }],
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

  it('the schema and the guard agree on the order verbs, in order', () => {
    const verbs = (schema as { $defs: { orderVerb: { enum: string[] } } }).$defs.orderVerb.enum;
    expect(verbs).toEqual([...TELEMETRY_ORDER_VERBS]);
  });
});
