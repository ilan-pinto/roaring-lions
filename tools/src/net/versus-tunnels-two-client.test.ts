// GH-681 T2: the Sarim seat's tunnel orders through the real lockstep path --
// one frame stream, two clients, each its own `buildMatchWorld` on a KDF-v-Sarim
// config, `applyFrame` through the real `seatWorldFor` -- hashed every tick.
// The route is added by hand, owned by the Sarim side, because no versus map
// carries one until T3 registers them from the rules file.
import { describe, it, expect } from 'vitest';
import type { Command, SimEvent } from '@lions/sim';
import { LockstepClock, applyFrame, canonicalOrder, type Frame, type Stamped } from '@lions/net';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { seatWorldFor } from '../../../packages/app/src/net/frame-step';
import { versusConfig } from './test-config';

const CONFIG = versusConfig('tel_marum', { factions: ['kdf', 'sarim'] });
/** The spec's strawman north-east route (§6.3), owned by side 1 (the Sarim seat). */
const ROUTE = { id: 'tm_n_east', points: [[30, 10], [36, 14], [36, 24]] as const, dig_tiles_per_s: 1, pre_dug: true, side: 1 };
const ENTER = 5;
const VENT = 1400;
const EXIT = 1500;
const REENTER = 1560;
const TICKS = 1700;

function world() {
  const w = buildMatchWorld(CONFIG);
  const route = w.sim.addTunnel(ROUTE);
  // Four Sarim foot units: the route's default capacity.
  const foot = w.bySide[1].filter((id) => {
    const t = w.sim.unitTypes[w.sim.state.typeIdx[id]];
    return !t.isAir && !t.wheeled;
  }).slice(0, 4);
  return { ...w, route, foot };
}

function frames(withTunnelOrders: boolean): Frame[] {
  const probe = world();
  const at = (tick: number, seat: 0 | 1, seq: number, cmd: Command): [number, Stamped] => [tick, { seat, seq, cmd }];
  const kdf = probe.bySide[0].slice(0, 2);
  const entries: [number, Stamped][] = [
    // Crafted: the KDF seat orders its own units into the Sarim route (T-R4). Dropped by both.
    at(ENTER, 0, 0, { kind: 'enterTunnel', ids: kdf, tunnel: probe.route }),
    ...(withTunnelOrders
      ? [
          at(ENTER, 1, 0, { kind: 'enterTunnel', ids: probe.foot, tunnel: probe.route }),
          at(VENT, 1, 1, { kind: 'vent', ids: probe.foot.slice(0, 2), mode: 'raid' }),
          at(EXIT, 1, 2, { kind: 'vent', ids: probe.foot.slice(2), mode: 'exit' }),
          at(REENTER, 1, 3, { kind: 'enterTunnel', ids: probe.foot.slice(2), tunnel: probe.route }),
        ]
      : []),
  ];
  const byTick = new Map<number, Stamped[]>();
  for (const [tick, s] of entries) byTick.set(tick, [...(byTick.get(tick) ?? []), s]);
  const out: Frame[] = [];
  for (let t = 0; t < TICKS; t++) out.push({ tick: t, cmds: canonicalOrder(byTick.get(t) ?? []) });
  return out;
}

function client(stream: Frame[]) {
  const w = world();
  const seatWorld = seatWorldFor(CONFIG, w.sim);
  const clock = new LockstepClock(0);
  const hashes: number[] = [];
  const drops: number[] = [];
  const events: SimEvent[] = [];
  let belowBeforeVent = 0;
  for (const f of stream) {
    expect(clock.push(f)).toBe('ok');
    for (const ready of clock.take(1)) {
      const r = applyFrame(ready, w.sim, seatWorld);
      for (let i = 0; i < r.dropped; i++) drops.push(ready.tick);
      events.push(...w.sim.tick());
      hashes.push(w.sim.hash());
      if (ready.tick === VENT - 1) {
        belowBeforeVent = w.foot.filter((id) => w.sim.state.tunnelIn[id] === w.route && w.sim.state.tunnelEta[id] === 0).length;
      }
    }
  }
  return { w, hashes, drops, events, belowBeforeVent };
}

describe('versus tunnels: two clients, one frame stream (GH-681)', () => {
  it('agree on every tick through enter, crawl, raid, exit and re-entry, and drop the KDF seat\'s enterTunnel identically', () => {
    const stream = frames(true);
    const a = client(stream);
    const b = client(stream);
    expect(a.w.foot).toHaveLength(4);
    expect(a.hashes).toHaveLength(TICKS);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.drops).toEqual([ENTER]);
    expect(b.drops).toEqual([ENTER]);
    // The orders did what they say: all four had crawled to the vent before it was used...
    expect(a.belowBeforeVent).toBe(4);
    // ...two came up at the vent on order, two more for good, and those two went back down at the vent.
    const surfaced = a.events.filter((e) => e.kind === 'surfaced').map((e) => (e as { entity: number }).entity);
    expect(new Set(surfaced)).toEqual(new Set(a.w.foot));
    for (const id of a.w.foot.slice(2)) expect(a.w.sim.state.tunnelIn[id]).toBe(a.w.route);
    // And they moved the hash: without them the last tick differs.
    const idle = client(frames(false));
    expect(idle.hashes[TICKS - 1]).not.toBe(a.hashes[TICKS - 1]);
  }, 120_000);
});
