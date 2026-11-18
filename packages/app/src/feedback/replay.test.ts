// The replay log (GH-464, spec §4.3): whole or nothing.
import { describe, expect, it } from 'vitest';
import { COMMANDS_MAX_BYTES, ReplayRecorder, START_MAX_BYTES, replayStartPicks, type ReplayLog, type ReplayStart } from './replay';

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

  it('a recorder that was never begun (a RESUMED mission: main.ts does not begin it) records nothing and gives no log (GH-1393)', () => {
    // A replay rebuilds a mission from tick 0 plus every order since. A resumed mission starts at the saved tick with the earlier orders
    // unknown, so a log begun there would reproduce a different battle while claiming to be this one: the Bug note offers no replay instead.
    const r = new ReplayRecorder();
    r.record(5, order);
    r.buy(6, 'jeep_shoded');
    expect([r.available, r.count, r.approxBytes, r.log(10, 1)]).toEqual([false, 0, 0, null]);
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

// GH-1384, the PR 1584 review's N2: the replay start's `picks` come only through `replayStartPicks`, whose default is the
// branch switch. Closed (as shipped), the start the battlefield begins is dev's: no `picks` key, byte for byte.
describe('replayStartPicks (GH-1384)', () => {
  const owned = { mbt_lavi: { firepower: 2 } };
  it('closed, as shipped: adds nothing, so the recorded start is dev\'s bytes', () => {
    expect(replayStartPicks(owned)).toEqual({});
    const r = new ReplayRecorder();
    r.begin({ ...start(), ...replayStartPicks(owned) });
    expect(r.log(0, 0)).toBe(
      '{"v":1,"start":{"mission":"beit_sahwan_2_foothold","build":"0.122.0","seed":20260727,"ledger":{},"tiers":{},"unlocks":[],"deploy":null},"commands":[],"hash":0,"tick":0}'
    );
  });
  it('open (a test passes the switch): carries the picks as the prepass read them', () => {
    expect(replayStartPicks(owned, true)).toEqual({ picks: { mbt_lavi: { firepower: 2 } } });
    expect(replayStartPicks(owned, false)).toEqual({});
  });
});
