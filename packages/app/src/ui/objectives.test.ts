// packages/app/src/ui/objectives.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clockText } from './hud-model';
import { objectivesPanel, type ObjectiveRow } from './objectives';

const rows: ObjectiveRow[] = [
  { id: 'a', text: 'Take the crossroads', primary: true, carries: false, status: 'active' },
  { id: 'b', text: 'Hold it', primary: true, carries: false, status: 'complete' },
  { id: 'c', text: 'Do not level the clinic', primary: true, carries: false, status: 'failed' },
  { id: 'd', text: 'Mark the cache', primary: false, carries: true, status: 'active' },
  { id: 'e', text: 'Bring the jeep home', primary: false, carries: false, status: 'active' },
];

describe('objectivesPanel', () => {
  it('shows every objective of a five-objective mission, primaries first', () => {
    const host = document.createElement('div');
    const p = objectivesPanel(host, { rows: () => rows, paysCredits: true });
    const items = [...p.el.querySelectorAll('.rl-obj')];
    expect(items).toHaveLength(5);
    expect(items.map((el) => el.getAttribute('data-primary'))).toEqual(['1', '1', '1', '0', '0']);
    expect(items.map((el) => el.querySelector('.rl-obj__text')?.textContent)).toEqual(rows.map((r) => r.text));
    p.dispose();
  });

  it('names the reward on a secondary and never on a primary', () => {
    const host = document.createElement('div');
    const p = objectivesPanel(host, { rows: () => rows, paysCredits: true });
    const reward = (id: string): string | null =>
      p.el.querySelector(`.rl-obj[data-id="${id}"] .rl-obj__reward`)?.textContent ?? null;
    expect(reward('a')).toBeNull();
    expect(reward('d')).toContain('40');
    expect(reward('e')).toBe('Optional · no carry-over');
    p.dispose();
  });

  it('a status word is the catalogue label, never the sim enum', () => {
    const host = document.createElement('div');
    const p = objectivesPanel(host, { rows: () => rows, paysCredits: true });
    const words = [...p.el.querySelectorAll('.rl-obj__status')].map((el) => el.textContent);
    expect(words).not.toContain('complete');
    expect(words).toContain('Complete');
    p.dispose();
  });

  it('refresh() repaints from the thunk without remounting', () => {
    const host = document.createElement('div');
    let live = rows;
    const p = objectivesPanel(host, { rows: () => live, paysCredits: true });
    const el = p.el;
    live = [{ ...rows[0], status: 'complete' }];
    p.refresh();
    expect(p.el).toBe(el);
    expect(p.el.querySelectorAll('.rl-obj')).toHaveLength(1);
    p.dispose();
  });

  it('dispose takes it off the host and is idempotent', () => {
    const host = document.createElement('div');
    const p = objectivesPanel(host, { rows: () => rows, paysCredits: true });
    p.dispose();
    p.dispose();
    expect(host.childElementCount).toBe(0);
  });

  // Fix round 1: nothing exercised the ticksLeft branch -- every row above
  // omits it, so `.rl-obj__clock` never got built in any test even though
  // task 6's in-mission mount depends on exactly this rendering.
  it('shows a clock for a timed objective and none for an untimed one', () => {
    const host = document.createElement('div');
    const timed: ObjectiveRow[] = [
      { id: 'hold', text: 'Hold the crossroads', primary: true, carries: false, status: 'active', ticksLeft: 1500 },
      { id: 'sweep', text: 'Sweep the block', primary: false, carries: false, status: 'active' },
    ];
    const p = objectivesPanel(host, { rows: () => timed, paysCredits: true });
    const clock = (id: string): string | null =>
      p.el.querySelector(`.rl-obj[data-id="${id}"] .rl-obj__clock`)?.textContent ?? null;
    expect(clock('hold')).toBe(clockText(1500));
    expect(clock('sweep')).toBeNull();
    p.dispose();
  });
});
