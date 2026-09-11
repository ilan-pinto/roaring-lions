// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showDebrief, type DebriefOptions } from './debrief';
import { TIER_NAMES } from './grade-copy';

const base = (over: Partial<DebriefOptions> = {}): DebriefOptions => ({
  result: 'victory',
  stars: 2,
  tierLine: { plate: 'Zohar', text: 'Brigade read the file to the end.' },
  roe: 84,
  roeFloor: 60,
  deductions: [{ penalty: 5, reason: 'fire into protected structure (clinic)' }],
  ticks: 20 * 60 * 4 + 20 * 30,
  targetMinutes: 7,
  lost: [{ type: 'inf_squad', count: 2 }],
  secondaries: [{ text: 'Build the picture', complete: true, carries: true }],
  marked: 3,
  promoted: 1,
  unlocked: ['Namer IFV'],
  missionId: 'beit_sahwan_3_clearance',
  ...over,
});

const text = (host: HTMLElement, sel: string): string => host.querySelector(sel)?.textContent ?? '';

describe('showDebrief', () => {
  it('names the tier and speaks its line', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    expect(text(host, '.rl-debrief__tier')).toBe(TIER_NAMES[2]);
    expect(text(host, '.rl-debrief__stars')).toBe('★★');
    expect(text(host, '.rl-debrief__line')).toContain('Brigade read the file');
  });

  it('shows Conduct with its floor and every deduction by reason', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    expect(text(host, '.rl-debrief__conduct')).toContain('Conduct 84');
    expect(text(host, '.rl-debrief__conduct')).toContain('60');
    expect(text(host, '.rl-debrief__deductions')).toContain('−5 fire into protected structure (clinic)');
  });

  it('shows time against target and losses by type, never as a grade', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    expect(text(host, '.rl-debrief__time')).toBe('4:30 of 7:00');
    expect(text(host, '.rl-debrief__lost')).toContain('inf_squad ×2');
  });

  it('lists secondaries, marking the ones that carry', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    const row = host.querySelector('.rl-debrief__secondary')!;
    expect(row.getAttribute('data-carries')).toBe('1');
    expect(row.getAttribute('data-complete')).toBe('1');
  });

  it('announces unlocks and a promotion when there is one', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ promotion: { rank: 'Major', stars: 3, line: { plate: 'Zohar', text: 'Third star.' } } }));
    expect(text(host, '.rl-debrief__unlocked')).toContain('Namer IFV');
    expect(text(host, '.rl-debrief__promotion')).toContain('Major');
    expect(text(host, '.rl-debrief__promotion')).toContain('Third star.');
  });

  it('gives each unlock its own line, with the reason it opened', () => {
    // Spec §4.5: the announcement carries the WHY. Joining them into one
    // comma-separated run turned two sentences with arrows in them into an
    // unreadable line, so each is its own `li`.
    const host = document.createElement('div');
    showDebrief(
      host,
      base({ unlocked: ['Campaign Conduct 58 → 62: Namer IFV available', 'D9 Dozer available'] })
    );
    const items = host.querySelectorAll('.rl-debrief__unlocked li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('Campaign Conduct 58 → 62: Namer IFV available');
    expect(items[1].textContent).toBe('D9 Dozer available');
  });

  it('names the next mission with the villain\'s line, and links to it', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ next: { id: 'beit_sahwan_4_subterranean', name: 'Beit Sahwan IV — Subterranean', villainLine: 'The digger.' } }));
    const a = host.querySelector<HTMLAnchorElement>('a.rl-debrief__next')!;
    expect(a.getAttribute('href')).toBe('?mission=beit_sahwan_4_subterranean');
    expect(a.textContent).toContain('Beit Sahwan IV');
    expect(text(host, '.rl-debrief__villain')).toBe('The digger.');
  });

  it('accounts for the taken when this mission brought some back', () => {
    // Spec §4.4's second sentence. The board can only print the standing total
    // -- it does not know which mission was just played -- so "N came back at
    // <place>" belongs here, where the mission is known. `hostagesLine` builds
    // the string; this screen only has to give it a place to land.
    const host = document.createElement('div');
    showDebrief(host, base({ taken: 'Fifteen still out. Four came back at the shaft head.' }));
    expect(text(host, '.rl-debrief__taken')).toBe(
      'Fifteen still out. Four came back at the shaft head.'
    );
  });

  it('says nothing about the taken on a world that keeps no such account', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    expect(host.querySelector('.rl-debrief__taken')).toBeNull();
  });

  it('renders a defeat with no tier and no stars', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ result: 'defeat', stars: 0, tierLine: undefined }));
    expect(text(host, '.rl-debrief__tier')).toBe('Withdraw and regroup');
    expect(host.querySelector('.rl-debrief__stars')).toBeNull();
  });
});
