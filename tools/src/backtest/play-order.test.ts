// The harness's credit walk plays the campaign in the order the board offers it (GH-912).
//
// Falsified (run when this was written): replacing the `missionOpen(...)` call in play-order.ts with `true` returns
// the LISTED order and turns three of the four specs red (the placement, the open-at-its-turn walk, the stuck
// case); replacing it with `false` turns the same three red.
import { describe, expect, it } from 'vitest';
import { world } from '@lions/data';
import { missionOpen, parseWorld } from '../../../packages/app/src/campaign';
import { playOrderOf } from './play-order';

const parsed = parseWorld(world);
const listed = parsed.regions.flatMap((r) => r.towns.flatMap((t) => [...t.missions]));

describe('playOrderOf', () => {
  it('puts Ein Qasab after Wadi Halam III, though world.json lists the town first in Naharin', () => {
    const { order, stuck } = playOrderOf(parsed, listed);
    expect(stuck).toEqual([]);
    expect(listed.indexOf('ein_qasab_1_recon')).toBeLessThan(listed.indexOf('wadi_halam_1_fords'));
    expect(order.indexOf('ein_qasab_1_recon')).toBeGreaterThan(order.indexOf('wadi_halam_3_counterraid'));
    expect(order.indexOf('ein_qasab_3_buildup')).toBe(order.indexOf('ein_qasab_1_recon') + 2);
  });

  it('plays every listed mission once, and each is open when its turn comes', () => {
    const { order } = playOrderOf(parsed, listed);
    expect([...order].sort()).toEqual([...listed].sort());
    order.forEach((id, k) => {
      expect(missionOpen(parsed, id, { 'campaign.completed_missions': order.slice(0, k) }), id).toBe(true);
    });
  });

  it('is the listed order wherever nothing is gated', () => {
    const { order } = playOrderOf(parsed, listed);
    const wo = (ids: readonly string[]) => ids.filter((id) => !id.startsWith('ein_qasab') && !id.startsWith('wadi_halam'));
    expect(wo(order)).toEqual(wo(listed));
  });

  it('names what is left when a gate can never open', () => {
    const { order, stuck } = playOrderOf(parsed, [...listed, 'no_such_mission']);
    expect(stuck).toEqual(['no_such_mission']);
    expect(order.at(-1)).toBe('no_such_mission');
  });
});
