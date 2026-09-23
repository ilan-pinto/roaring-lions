// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showDebrief, type DebriefOptions } from './debrief';
import { tierName } from './grade-copy';

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
    expect(text(host, '.rl-debrief__tier')).toBe(tierName(2));
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
    // The " · carries" suffix goes through the catalogue (`debrief.secondary.carries`);
    // the objective text itself is a param and reads through untouched.
    expect(row.textContent).toBe('☑ Build the picture · carries');
  });

  it('shows the objective text alone, with no suffix, when it does not carry', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ secondaries: [{ text: 'Hold the crossing', complete: false, carries: false }] }));
    const row = host.querySelector('.rl-debrief__secondary')!;
    expect(row.textContent).toBe('☐ Hold the crossing');
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
    expect(a.getAttribute('href')).toBe('/mission/beit_sahwan_4_subterranean');
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

  it('prints what the run paid into the brigade account', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ credits: { paid: 120, balance: 460 } }));
    expect(text(host, '.rl-debrief__credits')).toBe('+120 credits · 460 on hand');
  });

  it('says so when a replay did not improve on the best', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ credits: { paid: 0, balance: 460 } }));
    expect(text(host, '.rl-debrief__credits')).toBe('no improvement over your best, nothing paid · 460 on hand');
  });

  it('shows no credits row at all on a defeat', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ result: 'defeat', stars: 0 }));
    expect(host.querySelector('.rl-debrief__credits')).toBeNull();
  });

  it('offers the main menu, like the end panel does', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    expect([...host.querySelectorAll('.rl-endnav a')].some((a) => a.textContent === 'menu' && a.getAttribute('href') === '/')).toBe(true);
  });
});

describe('the memorial half of the service record', () => {
  let host: HTMLElement;
  const mount = (over: Partial<DebriefOptions>): void => {
    host = document.createElement('div');
    showDebrief(host, base(over));
  };

  // R-11: the named list is a SUBSET of the count. A fresh remnant killed on the
  // mission it spawned in has no service record to print, and a player who reads
  // "3 rifle squads" above "Barkai, Dekel" has not found a bug.
  it('keeps the aggregate as the total and names the roster units beside it', () => {
    mount({
      lost: [{ type: 'Rifle squad', count: 3 }],
      lostNamed: [{ name: 'Barkai', type: 'Rifle squad' }, { name: 'Dekel', type: 'Rifle squad' }],
    });
    expect(text(host, '.rl-debrief__lost')).toContain('×3');
    expect(text(host, '.rl-debrief__lostNamed')).toContain('Barkai');
    expect(text(host, '.rl-debrief__lostNamed')).toContain('Dekel');
  });

  it('says who took a vacant place', () => {
    mount({ replacements: [{ name: 'Gilad', predecessor: 'Barkai' }] });
    expect(text(host, '.rl-debrief__replaced')).toContain('Gilad');
    expect(text(host, '.rl-debrief__replaced')).toContain('Barkai');
  });

  // The zero paths, both of them. The existing "nobody" row must not regress,
  // and two rows that print an empty value are two rows of visual noise on the
  // screen a player sees most often.
  it('renders the existing nobody row unchanged and omits both new rows when empty', () => {
    mount({ lost: [], lostNamed: [], replacements: [] });
    expect(text(host, '.rl-debrief__lost')).toBe('nobody');
    expect(host.querySelector('.rl-debrief__lostNamed')).toBe(null);
    expect(host.querySelector('.rl-debrief__replaced')).toBe(null);
  });

  // A loss with no callsign is possible on a save written before names shipped.
  // It must read as a unit, never as "undefined".
  it('falls back to the type for a lost unit with no callsign', () => {
    mount({ lost: [{ type: 'Mortar team', count: 1 }], lostNamed: [{ type: 'Mortar team' }] });
    expect(text(host, '.rl-debrief__lostNamed')).toContain('Mortar team');
    expect(text(host, '.rl-debrief__lostNamed')).not.toContain('undefined');
  });
});
