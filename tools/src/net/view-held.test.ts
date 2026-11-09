import { describe, expect, it } from 'vitest';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { FogTracker } from './fog-tracker';
import { describeOrder } from './mcp-tools';
import type { OrderRecord } from './order-desk';
import { sideView, type UnitLine } from './view';
import { versusConfig } from './test-config';

function setup() {
  const w = buildMatchWorld(versusConfig('tel_marum'));
  const fog = new FogTracker(w.sim, 0);
  for (let i = 0; i < 4; i++) { w.sim.tick(); fog.step(); }
  const [a, b, c] = w.bySide[0];
  const row = (id: number): UnitLine => {
    const r = sideView(w, 0, fog, null).units.find((u) => u.id === id);
    if (r === undefined) throw new Error(`unit ${id} not in view`);
    return r;
  };
  const go = (id: number): void => {
    w.sim.queueCommand({ kind: 'attackMove', ids: [id], x: w.sim.state.posX[id] + (6 << 16), y: w.sim.state.posY[id] });
    w.sim.tick(); fog.step();
  };
  return { w, fog, a, b, c, row, go };
}

describe('GH-1098: observe says why a unit that was ordered to move is not advancing', () => {
  it('REPRO: an immobilised unit given an attackMove reads moving and immobile, and now says held: immobilised', () => {
    const { w, a, row, go } = setup();
    w.sim.state.mobilityKilled[a] = 1; // fixture: the component-damage outcome (line 8961 of sim.ts); there is no debug path to it
    go(a);
    const r = row(a);
    expect(r.flags).toContain('moving');
    expect(r.flags).toContain('immobile');
    expect(r.held).toBe('immobilised');
  });
  it('a pinned unit with an attackMove reads held: pinned', () => {
    const { w, b, row, go } = setup();
    w.sim.debugSuppress(b, 8 << 16); // capped; PIN_AT is 0.7
    go(b);
    const r = row(b);
    expect(r.flags).toContain('pinned');
    expect(r.held).toBe('pinned');
  });
  it('a free unit has no held reason', () => {
    const { c, row, go } = setup();
    go(c);
    expect(row(c)).not.toHaveProperty('held');
  });
});

describe('GH-1098: the other reasons, and the order log', () => {
  it('routed beats pinned and immobilised; garrisoned beats pinned (strongest cause first)', () => {
    const { w, a, row } = setup();
    w.sim.state.mobilityKilled[a] = 1; w.sim.state.pinned[a] = 1;
    expect(row(a).held).toBe('immobilised');
    w.sim.state.routed[a] = 1;
    expect(row(a).held).toBe('routed');
  });
  it('a garrisoned unit reads held: garrisoned', () => {
    const { w, b, row } = setup();
    w.sim.state.garrisonedIn[b] = 0; // fixture: the structure index is only read as >= 0
    expect(row(b).held).toBe('garrisoned');
  });
  it('a formation member waiting at a checkpoint reads held: checkpoint', () => {
    const { w, c, row } = setup();
    expect(row(c)).not.toHaveProperty('held');
    const sim = w.sim as unknown as { fmDuty: Uint8Array };
    sim.fmDuty[c] = 1; // FM_DUTY_WAIT; private column, no public writer outside a formation march (disabled in versus)
    expect(row(c).held).toBe('checkpoint');
  });
});

describe('GH-1098: an applied move says which of its units hold', () => {
  const rec = (kind: 'attackMove' | 'halt', ids: number[], status: OrderRecord['status'] = 'applied'): OrderRecord =>
    ({ ref: 1, status, cmd: kind === 'halt' ? { kind, ids } : { kind, ids, x: 0, y: 0 }, queuedTick: 1, sentTick: 1, settledTick: 2 }) as unknown as OrderRecord;
  it('lists the immobilised unit and not the free one', () => {
    const { w, fog, a, c, go } = setup();
    w.sim.state.mobilityKilled[a] = 1;
    go(a);
    const view = sideView(w, 0, fog, null);
    expect(describeOrder(rec('attackMove', [a, c]), view, null).holding).toEqual([{ id: a, held: 'immobilised' }]);
    expect(describeOrder(rec('halt', [a]), view, null)).not.toHaveProperty('holding');
    expect(describeOrder(rec('attackMove', [a], 'dropped'), view, null)).not.toHaveProperty('holding');
  });
});
