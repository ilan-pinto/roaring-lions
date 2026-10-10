// The replay log (GH-464, spec §4.3): whole or nothing.
import { describe, expect, it } from 'vitest';
import { COMMANDS_MAX_BYTES, ReplayRecorder, START_MAX_BYTES, type ReplayLog, type ReplayStart } from './replay';

const start = (o: Partial<ReplayStart> = {}): ReplayStart => ({ mission: 'beit_sahwan_2_foothold', build: '0.122.0', seed: 20260727, ledger: {}, tiers: {}, unlocks: [], deploy: null, ...o });
const order = { kind: 'move', ids: [3, 4, 5], x: 1310720, y: 655360 };

describe('ReplayRecorder', () => {
  it('records orders and buys in tick order, from the mission start, with the end hash', () => {
    const r = new ReplayRecorder();
    r.record(1, order); // before the mission: nothing to replay it against
    r.begin(start());
    r.record(12, order);
    r.buy(40, 'jeep_shoded');
    const log = JSON.parse(r.log(97, 123456) ?? 'null') as ReplayLog;
    expect(log.start.mission).toBe('beit_sahwan_2_foothold');
    expect(log.commands).toEqual([{ tick: 12, cmd: order }, { tick: 40, buy: 'jeep_shoded' }]);
    expect([log.tick, log.hash]).toEqual([97, 123456]);
  });

  it('drops the log WHOLE past the command cap, never a truncated tail', () => {
    const r = new ReplayRecorder();
    r.begin(start());
    let n = 0;
    // Bounded, so a recorder that never gives up reads red, not as a hang.
    while (r.available && n < 5000) r.record(n++, order);
    expect(r.available).toBe(false);
    expect(n * JSON.stringify({ tick: n, cmd: order }).length).toBeGreaterThan(COMMANDS_MAX_BYTES * 0.95);
    expect(r.log(n, 1)).toBeNull();
    expect(r.count).toBe(0);
    r.record(n + 1, order);
    expect(r.log(n + 1, 1)).toBeNull();
  });

  it('gives no log for a start snapshot past its own cap', () => {
    const r = new ReplayRecorder();
    r.begin(start({ ledger: { big: 'x'.repeat(START_MAX_BYTES) } }));
    r.record(1, order);
    expect(r.available).toBe(false);
    expect(r.log(1, 1)).toBeNull();
  });

  it('starts clean on the next mission', () => {
    const r = new ReplayRecorder();
    r.begin(start());
    r.record(1, order);
    r.begin(start({ mission: 'tel_marum_1_recon' }));
    expect(r.count).toBe(0);
    expect(JSON.parse(r.log(0, 0) ?? 'null').start.mission).toBe('tel_marum_1_recon');
  });
});
