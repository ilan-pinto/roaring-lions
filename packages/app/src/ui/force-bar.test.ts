// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { LedgerRosterEntry } from '@lions/sim';
import { deployRosterView, type DeployRosterView } from './deploy-roster';
import { defaultSelection, type DeploySelection } from './deploy-select';
import { benchOrder, forceBar } from './force-bar';

const NAMES: Record<string, string> = { inf_squad: 'Rifle Squad', at_team: 'Spike AT Team', dozer_d9: 'D9 Dov', apc_eitan: 'Eitan APC' };
const unitName = (id: string): string => NAMES[id] ?? id;

const MISSION = {
  ledger: { requires: ['roster.surviving_units'] },
  starting_force: [
    { unit: 'inf_squad', count: 2, from_ledger: true },
    { unit: 'at_team', count: 1, from_ledger: true },
    { unit: 'apc_eitan', count: 1, from_ledger: true },
    { unit: 'dozer_d9', count: 1 },
  ],
};

/** Pool order is NOT record order: the sim's own draw takes the first two
 *  rifle squads it meets, a rookie and a veteran. */
const POOL: LedgerRosterEntry[] = [
  { type: 'inf_squad', veterancy: 0, name: 'Gefen', missions: 1, kills: 0 },
  { type: 'inf_squad', veterancy: 2, name: 'Tzur', missions: 4, kills: 6 },
  { type: 'inf_squad', veterancy: 2, name: 'Dror', missions: 4, kills: 8 },
  { type: 'inf_squad', veterancy: 0 },
  { type: 'inf_squad', veterancy: 0 },
  { type: 'at_team', veterancy: 1, name: 'Sela', missions: 3, kills: 3 },
  { type: 'mbt_lavi', veterancy: 0 },
  { type: 'mbt_lavi', veterancy: 0 },
];

function view(pool = POOL): DeployRosterView {
  const v = deployRosterView(MISSION, { 'roster.surviving_units': pool }, unitName);
  if (!v) throw new Error('fixture');
  return v;
}

function mount(v: DeployRosterView | null = view()): { el: HTMLElement; deploy: HTMLButtonElement; changes: DeploySelection[]; bar: ReturnType<typeof forceBar> } {
  const deploy = document.createElement('button');
  const changes: DeploySelection[] = [];
  const bar = forceBar({
    view: v,
    attached: [{ type: 'dozer_d9', name: 'D9 Dov', count: 1 }],
    deploy,
    unitName,
    onChange: (s) => changes.push(s),
  });
  document.body.appendChild(bar.el);
  return { el: bar.el, deploy, changes, bar };
}

const names = (el: HTMLElement, sel: string): string[] => [...el.querySelectorAll(sel)].map((n) => n.querySelector('.rl-force__name')?.textContent?.trim() ?? '');

describe('forceBar (GH-417, H2)', () => {
  it('one card per demanded place, holding the sim draw, then the attached units', () => {
    const { el, deploy } = mount();
    const slots = [...el.querySelectorAll<HTMLElement>('.rl-force__slot')];
    expect(slots.map((s) => s.dataset.type)).toEqual(['inf_squad', 'inf_squad', 'at_team', 'apc_eitan', 'dozer_d9']);
    // defaultSelection is the sim's draw: pool order, Gefen then Tzur.
    expect(names(el, '.rl-force__slot[data-type="inf_squad"]')).toEqual(['Gefen', 'Tzur ★★']);
    // No Eitan in the pool: a fresh remnant, fixed, nothing to choose.
    expect(el.querySelector('.rl-force__slot--fixed[data-type="apc_eitan"]')?.textContent).toContain('fresh crew');
    expect(el.querySelector('.rl-force__slot--fixed[data-type="dozer_d9"]')?.textContent).toContain('from brigade');
    expect(el.querySelector('.rl-force__placed')?.textContent).toBe('4 of 4 placed');
    expect(deploy.disabled).toBe(false);
  });

  // Ruling L-4: the only reserve number on this screen is per place.
  // Falsified: a "{n} in reserve" line built from eligible + undrawable.
  it('names no global reserve, only the others of each place’s own type', () => {
    const { el } = mount();
    expect(el.textContent).not.toMatch(/in reserve/);
    const swap = (type: string): string | undefined => el.querySelector(`.rl-force__slot[data-type="${type}"] .rl-force__swap`)?.textContent ?? undefined;
    expect(swap('inf_squad')).toBe('⇄ 3');
    expect(el.querySelector('.rl-force__slot[data-type="at_team"] .rl-force__swap')).toBeNull();
  });

  it('shows what a veteran’s stripes do', () => {
    const { el } = mount();
    expect(el.querySelectorAll('.rl-force__slot[data-type="inf_squad"]')[1].querySelector('.rl-force__fx')?.textContent).toBe('+12% aim · −16% suppression');
  });

  it('the bench ranks by record and folds the unrecorded into one line', () => {
    const { el } = mount();
    el.querySelector<HTMLButtonElement>('.rl-force__slot[data-type="inf_squad"]')?.click();
    const rows = [...el.querySelectorAll('.rl-force__bench-row')].map((r) => r.querySelector('.rl-force__bench-name')?.textContent);
    expect(rows).toEqual(['Dror', 'Tzur', 'Gefen']);
    expect(el.querySelector('.rl-force__bench-more')?.textContent).toBe('and 2 more with no record yet');
    el.querySelector<HTMLButtonElement>('.rl-force__bench-more')?.click();
    expect(el.querySelectorAll('.rl-force__bench-row')).toHaveLength(5);
  });

  // A pick on a FULL type is a swap: the place's own body out, the pick in,
  // in THAT place -- the other card does not move. Falsified: dropping the
  // "toggle the current one out first" line leaves toggleEntry refusing.
  it('picking someone at base swaps them into the place that was clicked', () => {
    const { el, changes, deploy } = mount();
    el.querySelector<HTMLButtonElement>('[data-place="inf_squad:0"]')?.click(); // Gefen's place
    [...el.querySelectorAll<HTMLButtonElement>('.rl-force__bench-row')].find((r) => r.textContent?.includes('Dror'))?.click();
    expect(changes).toHaveLength(1);
    expect([...changes[0].chosen].sort()).toEqual([1, 2, 5]);
    expect(names(el, '.rl-force__slot[data-type="inf_squad"]')).toEqual(['Dror ★★', 'Tzur ★★']);
    expect(el.querySelector('.rl-force__bench')).toBeNull();
    expect(deploy.disabled).toBe(false);
    // Review: focus returns to the place, not to <body> (where the next
    // Escape would leave the briefing).
    expect((document.activeElement as HTMLElement | null)?.dataset.place).toBe('inf_squad:0');
  });

  it('a body going in another place cannot be picked from this one', () => {
    const { el } = mount();
    el.querySelector<HTMLButtonElement>('[data-place="inf_squad:0"]')?.click();
    const tzur = [...el.querySelectorAll<HTMLButtonElement>('.rl-force__bench-row')].find((r) => r.textContent?.includes('Tzur'));
    expect(tzur?.disabled).toBe(true);
    const gefen = [...el.querySelectorAll<HTMLButtonElement>('.rl-force__bench-row')].find((r) => r.textContent?.includes('Gefen'));
    expect(gefen?.getAttribute('aria-pressed')).toBe('true');
  });

  it('a place with nobody else to put in it is not a control', () => {
    const { el } = mount();
    const sela = el.querySelector('.rl-force__slot[data-type="at_team"]');
    expect(sela?.tagName).toBe('DIV');
    expect(sela?.classList.contains('rl-force__slot--only')).toBe(true);
  });

  it('dismiss() closes an open bench even when focus has left it', () => {
    const { el, bar } = mount();
    el.querySelector<HTMLButtonElement>('[data-place="inf_squad:1"]')?.click();
    el.querySelector<HTMLButtonElement>('.rl-force__bench-more')?.click();
    expect(el.querySelector('.rl-force__bench')?.contains(document.activeElement)).toBe(true);
    (document.activeElement as HTMLElement).blur();
    expect(bar.dismiss()).toBe(true);
    expect(el.querySelector('.rl-force__bench')).toBeNull();
    expect(bar.dismiss()).toBe(false);
  });

  it('picking the one already going benches them, and Deploy waits for the open place', () => {
    const { el, deploy } = mount();
    el.querySelector<HTMLButtonElement>('[data-place="inf_squad:0"]')?.click();
    [...el.querySelectorAll<HTMLButtonElement>('.rl-force__bench-row')].find((r) => r.textContent?.includes('Gefen'))?.click();
    expect(el.querySelectorAll('.rl-force__slot--open')).toHaveLength(1);
    expect(el.querySelector('.rl-force__placed')?.textContent).toBe('3 of 4 placed');
    expect(deploy.disabled).toBe(true);
  });

  it('Escape closes the bench and stops there', () => {
    const { el } = mount();
    let reachedWindow = 0;
    const onKey = (e: KeyboardEvent): void => void (e.key === 'Escape' && reachedWindow++);
    window.addEventListener('keydown', onKey);
    el.querySelector<HTMLButtonElement>('.rl-force__slot[data-type="inf_squad"]')?.click();
    el.querySelector('.rl-force__bench')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', onKey);
    expect(el.querySelector('.rl-force__bench')).toBeNull();
    expect(reachedWindow).toBe(0);
  });

  it('with no roster to choose from, every unit is a fixed card and Deploy is free', () => {
    const { el, deploy } = mount(null);
    expect(el.querySelectorAll('.rl-force__slot--fixed')).toHaveLength(1);
    expect(el.querySelector('.rl-force__slot--fixed')?.textContent).not.toContain('from brigade');
    expect(deploy.disabled).toBe(false);
  });

  it('the default is untouched: an unopened bar fields exactly defaultSelection', () => {
    const v = view();
    const { bar } = mount(v);
    expect(bar.selection().chosen).toEqual(defaultSelection(v).chosen);
    expect([...bar.selection().chosen].sort()).toEqual([0, 1, 5]);
  });

  it('benchOrder: stripes, then missions, then kills, then pool order', () => {
    const e = (poolIndex: number, veterancy: number, missions: number, kills: number) => ({ poolIndex, type: 'x', typeName: 'X', veterancy, missions, kills });
    const sorted = [e(0, 0, 0, 0), e(1, 1, 0, 0), e(2, 1, 2, 0), e(3, 1, 2, 5), e(4, 0, 0, 0)].sort(benchOrder);
    expect(sorted.map((x) => x.poolIndex)).toEqual([3, 2, 1, 0, 4]);
  });
});
