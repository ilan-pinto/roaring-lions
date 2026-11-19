/**
 * GH-1384 §4.4 with the branch switch as shipped (closed): the campaign PUT and the victory write dev's bytes. A body's `picks` and
 * `legacy` are dropped by the migration as they always were, and no pick is kept, made or marked. `branch-sticky.test.ts` holds the
 * switch open.
 */
import { BRANCHES_OPEN } from '@lions/data/branches-open';
import { describe, expect, it } from 'vitest';
import { body, member, put, revision, setup, stored, victory } from './branch-sticky-kit';

describe('the switch closed: the campaign write is dev\'s', () => {
  it('the switch is closed', () => {
    expect(BRANCHES_OPEN).toBe(false);
  });

  it('a body naming picks and a marker is stored without either, and a later stripped body changes nothing about that', async () => {
    const h = setup();
    const cookie = await member(h);
    expect((await put(h, cookie, 0, body({ picks: { mbt_lavi: { firepower: 2 } }, legacy: { mbt_lavi: { firepower: true } } }))).status).toBe(200);
    const row = await stored(h);
    expect(row).not.toHaveProperty('picks');
    expect(row).not.toHaveProperty('legacy');
    expect(row.upgrades).toEqual({ mbt_lavi: { firepower: 3 } });
    expect((await put(h, cookie, 1, body())).status).toBe(200);
    expect(await stored(h)).not.toHaveProperty('picks');
    expect(await revision(h)).toBe(2);
  });

  it('the victory\'s campaign half does the same', async () => {
    const h = setup();
    const cookie = await member(h);
    await put(h, cookie, 0, body());
    const r = await victory(h, cookie, 1, body({ picks: { mbt_lavi: { firepower: 2 } } }));
    expect(r.status).toBe(200);
    expect(await stored(h)).not.toHaveProperty('picks');
  });
});
