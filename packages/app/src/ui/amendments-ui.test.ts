// @vitest-environment jsdom
// GH-1395 slice 2: the challenge UI's DOM. The deploy panel ("Amendments to the orders", D11): its toggles, the marks, the
// freeze and the disposer; the board's coin mark beside a town's stars (never in them, D2); the debrief's challenge rung; and
// every chrome string through t() (C12, under the pseudo-locale). Every check was seen red under a one-line mutation.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeOf, missions } from '@lions/data';
import type { LedgerData, MissionJson } from '@lions/sim';
import worldJson from '../../../../data/campaign/world.json';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import { parseWorld } from '../campaign';
import { withChallengeMark } from '../challenge';
import { amendmentPanel, type AmendmentPanelDeps } from './amendments-ui';
import { challengeTownMark } from './challenge-board';
import { showDebrief, type DebriefOptions } from './debrief';
import type { AfterAction } from './after-action';
import { worldMap } from './worldmap';

const world = parseWorld(worldJson);
const BS2 = 'beit_sahwan_2_foothold';
const offer = (() => {
  const c = challengeOf(BS2);
  if (c === undefined) throw new Error('Beit Sahwan II is in the pilot');
  return c;
})();

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  setCatalogue('en', en);
  document.body.replaceChildren();
});

function panel(o: Partial<AmendmentPanelDeps> = {}) {
  const onChange = vi.fn<(next: string[]) => void>();
  const p = amendmentPanel({ offer, chosen: [], onChange, ...o });
  document.body.append(p.el);
  disposers.push(p.dispose);
  const rows = (): HTMLButtonElement[] => [...p.el.querySelectorAll<HTMLButtonElement>('.rl-amend__row')];
  const row = (id: string): HTMLButtonElement => {
    const b = rows().find((x) => x.dataset.amendment === id);
    if (b === undefined) throw new Error(`no row ${id}`);
    return b;
  };
  return { p, onChange: o.onChange === undefined ? onChange : (o.onChange as typeof onChange), rows, row };
}

describe('the deploy panel: "Amendments to the orders"', () => {
  it('is headed with the lead’s words, and offers the mission’s three, in its order, with their data text', () => {
    const { p, rows } = panel();
    expect(p.el.querySelector('.rl-amend__head')?.textContent).toBe('Amendments to the orders');
    expect(rows().map((b) => b.dataset.amendment)).toEqual(['no_medic', 'thin_purse', 'light_order']);
    expect(rows().map((b) => b.querySelector('.rl-amend__name')?.textContent)).toEqual(['Medics stay back', 'Thin purse', 'Light order']);
  });
  it('names the challenge and marks exactly the amendments it needs', () => {
    const { p, rows } = panel();
    expect(p.el.querySelector('.rl-amend__challenge-name')?.textContent).toContain('Quiet Souk');
    expect(rows().filter((b) => b.dataset.needed === 'true').map((b) => b.dataset.amendment)).toEqual(['no_medic', 'light_order']);
    expect(rows().filter((b) => b.querySelector('.rl-amend__need') !== null).length).toBe(2);
  });
  it('says what it pays: 10 Roar coins, once, no credits, no star or unit', () => {
    const { p } = panel();
    const pays = p.el.querySelector('.rl-amend__pays')?.textContent ?? '';
    expect(pays).toContain('10 Roar coins');
    expect(pays).toContain('once');
    expect(pays).toContain('no credits');
    expect(p.el.querySelector('.rl-amend__when')?.textContent).toContain('starts this briefing again');
  });
  it('shows what is on: pressed rows, the count, open when any is on, and armed only when every needed one is', () => {
    const none = panel();
    expect(none.p.el.open).toBe(false);
    expect(none.p.el.dataset.armed).toBe('false');
    expect(none.rows().every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    const half = panel({ chosen: ['light_order'] });
    expect(half.p.el.open).toBe(true);
    expect(half.p.el.dataset.armed).toBe('false');
    expect(half.row('light_order').getAttribute('aria-pressed')).toBe('true');
    const full = panel({ chosen: ['no_medic', 'light_order'] });
    expect(full.p.el.dataset.armed).toBe('true');
    expect(full.p.el.querySelector('.rl-amend__count')?.textContent).toBe('2 on');
  });
  it('a press asks for the new set, in the mission’s order, and the panel is spent (one press, one restart)', () => {
    const { onChange, row, rows } = panel({ chosen: ['light_order'] });
    row('no_medic').click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(['no_medic', 'light_order']);
    expect(rows().every((b) => b.disabled)).toBe(true);
    row('thin_purse').click();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it('a press on one that is on takes it off', () => {
    const { onChange, row } = panel({ chosen: ['no_medic', 'light_order'] });
    row('no_medic').click();
    expect(onChange).toHaveBeenLastCalledWith(['light_order']);
  });
  it('freeze (Deploy answered): every toggle disabled, and a press changes nothing', () => {
    const { p, onChange, row, rows } = panel();
    p.freeze();
    p.freeze();
    expect(rows().every((b) => b.disabled)).toBe(true);
    row('light_order').click();
    // A disabled button's click does not fire in a browser; the handler's own guard is what is under test here.
    row('light_order').dispatchEvent(new MouseEvent('click'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('dispose takes it down, and a late press changes nothing', () => {
    const { p, onChange, row } = panel();
    const b = row('light_order');
    p.dispose();
    expect(p.el.isConnected).toBe(false);
    b.click();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the board: a coin mark beside a town’s stars, never in them (D2)', () => {
  const opened: LedgerData = {
    'campaign.completed_missions': ['beit_sahwan_breach', 'beit_sahwan_1_recon', BS2],
    'campaign.mission_results': {
      beit_sahwan_breach: { stars: 2, roe: 90, ticks: 6000, lost: 1 },
      beit_sahwan_1_recon: { stars: 2, roe: 90, ticks: 8000, lost: 0 },
      [BS2]: { stars: 3, roe: 95, ticks: 8000, lost: 0 },
    },
  };
  const marked = withChallengeMark(opened, BS2, { id: 'quiet_souk', roe: 95, ticks: 8000, lost: 0 });
  const board = (ledger: LedgerData, mark: boolean): HTMLElement =>
    worldMap({ base: '/', world, countries: [], ledger, href: (id) => `/mission/${id}`, ...(mark ? { townMark: challengeTownMark(world, ledger) } : {}) });
  const town = (b: HTMLElement): Element | null => b.querySelector('[data-town="beit_sahwan"]');
  it('a beaten challenge draws the mark, done of the town’s challenge missions, with words for a screen reader', () => {
    const m = town(board(marked, true))?.querySelector('.rl-world__challenge');
    expect(m).not.toBeNull();
    expect(m?.textContent?.trim()).toBe('1/5');
    expect(m?.getAttribute('aria-label')).toBe('Challenges beaten here: 1 of 5');
  });
  it('none beaten: no mark; and the stars read the same with the mark drawn or not', () => {
    expect(town(board(opened, true))?.querySelector('.rl-world__challenge')).toBeNull();
    const stars = (b: HTMLElement) => town(b)?.querySelector('.rl-world__stars')?.textContent;
    expect(stars(board(marked, true))).toBe(stars(board(opened, false)));
    expect(stars(board(marked, true))).toBe(' 7/15★');
  });
  it('a town with no challenge mission draws none', () => {
    const mark = challengeTownMark(world, marked);
    const others = world.regions.flatMap((r) => r.towns).filter((x) => !x.missions.some((id) => challengeOf(id) !== undefined));
    expect(others.length).toBeGreaterThan(0);
    for (const x of others) expect(mark(x.id)).toBeNull();
  });
});

describe('the debrief draws the challenge rung after the stars, with the coin mark and no star', () => {
  const REPORT: AfterAction = {
    reason: [],
    ladder: [
      { stars: 1, met: true, text: 'Won the mission' },
      { stars: 2, met: true, text: 'Conduct 84, needed 60' },
      { stars: 3, met: false, text: 'none' },
    ],
    well: [],
    poor: [],
    changed: [],
    pins: [],
  };
  const mount = (r: AfterAction): HTMLElement => {
    const host = document.createElement('div');
    document.body.append(host);
    const o: DebriefOptions = { result: 'victory', stars: 2, report: r, missionId: BS2 };
    disposers.push(showDebrief(host, o));
    return host;
  };
  it('present: a fourth rung, last, with the coin and its text, met or missed; the three star rungs unchanged', () => {
    const host = mount({ ...REPORT, challenge: { met: true, text: 'Quiet Souk: beaten' } });
    const rungs = [...host.querySelectorAll('.rl-aar__rung')];
    expect(rungs).toHaveLength(4);
    const last = rungs[3];
    expect(last.classList.contains('rl-aar__rung--challenge')).toBe(true);
    expect(last.classList.contains('rl-aar__rung--met')).toBe(true);
    expect(last.querySelector('.rl-aar__rung-coin')).not.toBeNull();
    expect(last.querySelector('.rl-aar__rung-stars')).toBeNull();
    expect(last.textContent).toBe('Quiet Souk: beaten');
    expect(rungs.slice(0, 3).map((r) => (r as HTMLElement).dataset.stars)).toEqual(['1', '2', '3']);
    const missed = mount({ ...REPORT, challenge: { met: false, text: 'x' } }).querySelector('.rl-aar__rung--challenge');
    expect(missed?.classList.contains('rl-aar__rung--missed')).toBe(true);
  });
  it('absent: the ladder is the three stars alone', () => {
    expect(mount(REPORT).querySelectorAll('.rl-aar__rung')).toHaveLength(3);
  });
});

describe('C12: every chrome string goes through t(); the data text is shown as written', () => {
  it('under ?pseudo=1 the panel’s and the board mark’s own words are bracketed; the names and blurbs (data) are not', () => {
    setCatalogue('pseudo', en, pseudo);
    const data = new Set<string>();
    const { p } = panel({ chosen: ['light_order'] });
    // The data strings the panel was given: amendment labels and blurbs, the challenge's blurb.
    for (const el of p.el.querySelectorAll('.rl-amend__name, .rl-amend__blurb, .rl-amend__challenge-blurb')) data.add(el.textContent ?? '');
    const chrome = [...p.el.querySelectorAll('.rl-amend__head, .rl-amend__count, .rl-amend__need, .rl-amend__challenge-name, .rl-amend__challenge-state, .rl-amend__pays, .rl-amend__when')];
    expect(chrome.length).toBe(8);
    for (const el of chrome) expect(el.textContent, el.className).toMatch(/⟦[\s\S]*⟧/);
    for (const s of data) expect(s).not.toMatch(/⟦/);
    expect(p.el.querySelector('.rl-amend__rows')?.getAttribute('aria-label')).toMatch(/⟦/);
    const mark = challengeTownMark(world, withChallengeMark({}, BS2, { id: 'quiet_souk', roe: 95, ticks: 8000, lost: 0 }))('beit_sahwan');
    expect(mark?.getAttribute('aria-label')).toMatch(/⟦/);
    expect(missingKeys().filter((k) => k.startsWith('amend.') || k.startsWith('world.challenge'))).toEqual([]);
  });
  it('every amend.* / aar.challenge.* / world.challenge key the sources read exists, and none is unused', () => {
    const src = ['packages/app/src/ui/amendments-ui.ts', 'packages/app/src/ui/challenge-board.ts', 'packages/app/src/challenge.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const re = /['"`]((?:amend|aar\.challenge|world\.challenge)(?:\.[A-Za-z]+)*)['"`]/g;
    const used = new Set([...src.matchAll(re)].map((m) => m[1]));
    const keys = Object.keys(en).filter((k) => /^(amend\.|aar\.challenge\.|world\.challenge$)/.test(k));
    expect(keys.length).toBe(18);
    for (const k of keys) expect(used.has(k), `${k} is unused`).toBe(true);
    for (const k of used) expect(Object.hasOwn(en, k), `${k} is missing`).toBe(true);
  });
});

// Keep the mission import honest: the panel is only ever handed a pilot mission's offer.
it('the offer the panel was tested on is a shipped mission’s', () => {
  expect((missions as unknown as Record<string, MissionJson>)[BS2]?.id).toBe(BS2);
});
