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
