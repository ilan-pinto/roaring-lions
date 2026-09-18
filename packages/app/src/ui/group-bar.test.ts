// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { groupBar, groupChips } from './group-bar';

const facts = (id: number) => ({ alive: id < 10, hp: 50, hpMax: 100 });

describe('groupChips', () => {
  it('one chip per assigned slot, in slot order, with the living count', () => {
    const g = new Map([[3, [1, 2, 11]], [1, [4]]]);
    expect(groupChips(g, facts)).toEqual([
      { slot: 1, count: 1, hpPct: 0.5 },
      { slot: 3, count: 2, hpPct: 0.5 },
    ]);
  });
  it('a slot whose members are all dead shows nothing -- not an empty chip', () => {
    expect(groupChips(new Map([[2, [11, 12]]]), facts)).toEqual([]);
  });
  it('an unassigned slot is absent, never a placeholder', () => {
    expect(groupChips(new Map(), facts)).toEqual([]);
  });
});

describe('groupBar', () => {
  it('draws the slot number and recalls on click', () => {
    const host = document.createElement('div');
    const recalled: number[] = [];
    const bar = groupBar(host, {
      chips: () => [{ slot: 2, count: 3, hpPct: 0.8 }],
      onRecall: (s) => recalled.push(s),
      groupColor: () => 'var(--live)',
    });
    const chip = bar.el.querySelector<HTMLButtonElement>('.rl-group[data-slot="2"]');
    expect(chip?.textContent).toContain('2');
    expect(chip?.textContent).toContain('3');
    chip?.click();
    expect(recalled).toEqual([2]);
    bar.dispose();
  });
  it('refresh() rebuilds from the thunk, and the click still works after', () => {
    const host = document.createElement('div');
    const recalled: number[] = [];
    let live = [{ slot: 1, count: 1, hpPct: 1 }];
    const bar = groupBar(host, { chips: () => live, onRecall: (s) => recalled.push(s), groupColor: () => 'var(--live)' });
    live = [{ slot: 5, count: 2, hpPct: 0.4 }];
    bar.refresh();
    bar.el.querySelector<HTMLButtonElement>('.rl-group[data-slot="5"]')?.click();
    expect(recalled).toEqual([5]);
    bar.dispose();
  });
});
