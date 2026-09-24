import { describe, it, expect } from 'vitest';
import { isTelemetryEvent, type TelemetryEnvelope } from '@lions/data/telemetry';
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
