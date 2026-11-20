// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { CoinRowView, CoinsView } from '@lions/economy';
import type { CallResult } from '../account/client';
import { t } from '../i18n/t';
import { coinAmountText, coinHistory, coinWhatText, shownRow, type CoinNames } from './coin-history';

afterEach(() => document.body.replaceChildren());

const names: CoinNames = {
  mission: (id) => (id === 'first_light' ? 'First Light' : undefined),
  unit: (id) => (id === 'sniper_team' ? 'Sniper Team' : undefined),
};
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const okPage = (rows: CoinRowView[], next: string | null): CallResult<CoinsView> => ({ ok: true, status: 200, body: { rows, next } });
const earn = (delta: number, source: string, missionId?: string, at = 1_700_000_000_000): CoinRowView => ({ at, delta, what: { kind: 'earn', source, ...(missionId === undefined ? {} : { missionId }) } });

describe('the wording per journal kind (spec 2.2)', () => {
  it('words every kind, through the localized lookups', () => {
    expect(coinWhatText({ kind: 'earn', source: 'welcome' }, 10, names)).toBe('Welcome issue');
    expect(coinWhatText({ kind: 'earn', source: 'first_win', missionId: 'first_light' }, 10, names)).toBe('First win: First Light');
    expect(coinWhatText({ kind: 'earn', source: 'star', missionId: 'first_light' }, 10, names)).toBe('New stars: First Light');
    expect(coinWhatText({ kind: 'earn', source: 'campaign' }, 10, names)).toBe('Campaign complete');
    expect(coinWhatText({ kind: 'earn', source: 'something_new' }, 10, names)).toBe('Mission reward');
    expect(coinWhatText({ kind: 'move' }, 405, names)).toBe('Guest progress moved to your account');
    expect(coinWhatText({ kind: 'unit', unitId: 'sniper_team', moved: false }, -60, names)).toBe('Bought: Sniper Team');
    expect(coinWhatText({ kind: 'unit', unitId: 'sniper_team', moved: true }, -60, names)).toBe('Carried over in the move: Sniper Team');
    expect(coinWhatText({ kind: 'tier', unitId: 'sniper_team', track: 'armour', tier: 2, moved: false }, -40, names)).toBe('Bought: Sniper Team Armour, tier 2');
    expect(coinWhatText({ kind: 'tier', unitId: 'sniper_team', track: 'armour', tier: 2, moved: true }, -40, names)).toBe('Carried over in the move: Sniper Team Armour, tier 2');
    expect(coinWhatText({ kind: 'tier', unitId: 'sniper_team', track: 'armour', tier: 3, moved: false, refund: true }, 95, names)).toBe('Returned: Sniper Team Armour, tier 3');
    expect(coinWhatText({ kind: 'coupon' }, 100, names)).toBe('Code redeemed');
    expect(coinWhatText({ kind: 'reset' }, -30, names)).toBe('Brigade reset: free coins cleared');
    expect(coinWhatText({ kind: 'team' }, 50, names)).toBe('From the team');
    expect(coinWhatText({ kind: 'team' }, -50, names)).toBe('Corrected by the team');
    expect(coinWhatText({ kind: 'other' }, 5, names)).toBe('Coin change');
  });

  it('never shows a raw id: an unknown mission, unit or track gets the generic wording', () => {
    const texts = [
      coinWhatText({ kind: 'earn', source: 'first_win', missionId: 'retired_mission_x' }, 10, names),
      coinWhatText({ kind: 'earn', source: 'star', missionId: 'retired_mission_x' }, 10, names),
      coinWhatText({ kind: 'earn', source: 'first_win' }, 10, names),
      coinWhatText({ kind: 'unit', unitId: 'gone_unit_x', moved: false }, -5, names),
      coinWhatText({ kind: 'unit', unitId: 'gone_unit_x', moved: true }, -5, names),
      coinWhatText({ kind: 'tier', unitId: 'sniper_team', track: 'no_such_track', tier: 1, moved: false }, -5, names),
      coinWhatText({ kind: 'tier', unitId: 'gone_unit_x', track: 'armour', tier: 1, moved: false }, -5, names),
      coinWhatText({ kind: 'tier', unitId: 'gone_unit_x', track: 'armour', tier: 3, moved: false, refund: true }, 95, names),
    ];
    expect(texts).toEqual([
      'First win of a mission',
      'New star on a mission',
      'First win of a mission',
      'Bought: an item',
      'Carried over in the move: an item',
      'Bought: an upgrade',
      'Bought: an upgrade',
      'Returned: an upgrade',
    ]);
    for (const x of texts) expect(x).not.toMatch(/retired_mission_x|gone_unit_x|no_such_track/);
  });

  it('signs the amount with U+2212 for a deduction', () => {
    expect(coinAmountText(405)).toBe('+405');
    expect(coinAmountText(-60)).toBe('−60');
    expect(coinAmountText(0)).toBe('0');
  });
});

describe('zero rows (D6)', () => {
  it('hides a zero row except the guest-to-account move', () => {
    expect(shownRow(earn(0, 'welcome'))).toBe(false);
    expect(shownRow({ at: 1, delta: 0, what: { kind: 'reset' } })).toBe(false);
    expect(shownRow({ at: 1, delta: 0, what: { kind: 'team' } })).toBe(false);
    expect(shownRow({ at: 1, delta: 0, what: { kind: 'move' } })).toBe(true);
    expect(shownRow(earn(10, 'welcome'))).toBe(true);
  });

  it('draws the move at 0 and drops the other zero rows from the table', async () => {
    const box = coinHistory({
      load: async () => okPage([{ at: 3, delta: 0, what: { kind: 'move' } }, { at: 2, delta: 0, what: { kind: 'reset' } }, earn(10, 'welcome')], null),
      names,
      isDisposed: () => false,
    });
    document.body.appendChild(box);
    await flush();
    const kinds = [...box.querySelectorAll<HTMLElement>('tbody tr')].map((r) => r.dataset.kind);
    expect(kinds).toEqual(['move', 'earn']);
    expect(box.querySelector('tbody tr .rl-profile__coin-amount')?.textContent).toBe('0');
  });
});

describe('paging (D7)', () => {
  it('asks for the first page at once, follows `next`, and stops at a null `next`', async () => {
    const asked: (string | undefined)[] = [];
    const pages: Record<string, CallResult<CoinsView>> = {
      first: okPage([earn(10, 'welcome', undefined, 3)], '17'),
      '17': okPage([earn(5, 'campaign', undefined, 2)], '9'),
      '9': okPage([earn(1, 'star', 'first_light', 1)], null),
    };
    const box = coinHistory({ load: async (b) => (asked.push(b), pages[b ?? 'first'] as CallResult<CoinsView>), names, isDisposed: () => false });
    document.body.appendChild(box);
    await flush();
    const more = box.querySelector<HTMLButtonElement>('.rl-profile__more');
    expect(asked).toEqual([undefined]);
    expect(more?.hidden).toBe(false);
    more?.click();
    await flush();
    expect(asked).toEqual([undefined, '17']);
    expect(more?.hidden).toBe(false);
    more?.click();
    await flush();
    expect(asked).toEqual([undefined, '17', '9']);
    expect(more?.hidden).toBe(true);
    expect(box.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('says there are no coins yet when the first page is empty and last', async () => {
    const box = coinHistory({ load: async () => okPage([], null), names, isDisposed: () => false });
    document.body.appendChild(box);
    await flush();
    expect(box.textContent).toContain(t('profile.coins.empty'));
    expect(box.querySelector<HTMLElement>('table')?.hidden).toBe(true);
  });

  it('offline: says it needs a connection and re-asks the same page; a 429 has its own line', async () => {
    const asked: (string | undefined)[] = [];
    let fail: CallResult<CoinsView> = { ok: false, status: 0, body: { error: 'off' } };
    const box = coinHistory({
      load: async (b) => (asked.push(b), fail.ok ? fail : asked.length === 1 ? fail : okPage([earn(10, 'welcome')], null)),
      names,
      isDisposed: () => false,
    });
    document.body.appendChild(box);
    await flush();
    expect(box.textContent).toContain(t('profile.coins.needsConnection'));
    fail = { ok: false, status: 429, body: {} };
    const retry = box.querySelector<HTMLButtonElement>('.rl-profile__coin-retry');
    expect(retry?.hidden).toBe(false);
    retry?.click();
    await flush();
    expect(asked).toEqual([undefined, undefined]);
    expect(box.querySelectorAll('tbody tr').length).toBe(1);
    expect(retry?.hidden).toBe(true);
  });

  it('ignores a late answer after the screen was disposed', async () => {
    let gone = false;
    const box = coinHistory({ load: async () => ((gone = true), okPage([earn(10, 'welcome')], null)), names, isDisposed: () => gone });
    document.body.appendChild(box);
    await flush();
    expect(box.querySelectorAll('tbody tr').length).toBe(0);
  });
});

describe('the admin note', () => {
  it('shows the note as text, never markup, and no reason or admin identity', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1"><b>hi</b> {n} ICU';
    const box = coinHistory({
      load: async () => okPage([{ at: 5, delta: 50, what: { kind: 'team', note: hostile } }, { at: 4, delta: -20, what: { kind: 'team' } }], null),
      names,
      isDisposed: () => false,
    });
    document.body.appendChild(box);
    await flush();
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('b')).toBeNull();
    const note = box.querySelector('.rl-profile__coin-note');
    expect(note?.textContent).toBe(`“${hostile}”`);
    const rows = [...box.querySelectorAll('tbody tr')];
    expect(rows[0]?.querySelector('.rl-profile__coin-main')?.textContent).toBe('From the team');
    expect(rows[1]?.querySelector('.rl-profile__coin-main')?.textContent).toBe('Corrected by the team');
    expect(rows[1]?.querySelector('.rl-profile__coin-note')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
