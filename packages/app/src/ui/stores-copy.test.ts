// @vitest-environment jsdom
// The Stores' honest copy (GH-317, gate G-U1): the numbers in "Roar coins are free..."
// and "How to earn" are READ from the earn table, never typed beside it, and every
// new string goes through t() (an unbracketed word under ?pseudo=1 never did).
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue, t } from '../i18n/t';
import type { EarnAward } from '../roar-earn';
import { coinAwardText } from './after-action';
import { showStores } from './stores';

// Distinct numbers, none of them the shipped ones: copy that hard-codes 100, 10 or 5
// cannot pass with these.
vi.mock('../roar-earn', async (orig) => ({ ...(await orig<typeof import('../roar-earn')>()), EARN: { welcome: 71, firstWin: 13, star: 7, campaign: 59 } }));

const coinSrc = (size: number): string => `/ui/roar_coin/roar_coin_${size}.png`;

function mount(live: boolean): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = showStores(host, {
    units: [],
    ledger: {},
    credits: 0,
    owned: {},
    coinSrc,
    missionName: () => undefined,
    ...(live ? { wallet: { coins: 12, receipts: [] } } : {}),
  });
  return { host, dispose };
}

afterEach(() => {
  setCatalogue('en', en);
  document.body.replaceChildren();
});

describe('G-U1: the Stores copy reads its numbers from the earn table', () => {
  it('the honest line carries every payout figure', () => {
    const { host, dispose } = mount(true);
    const about = host.querySelector('.rl-stores__about')?.textContent ?? '';
    expect(about).toContain('71 on your first win');
    expect(about).toContain("13 for each mission's first win");
    expect(about).toContain('7 for each new star');
    expect(about).toContain('59 when the campaign is done');
    expect(about).toMatch(/Nothing here costs money\.$/);
    dispose();
  });

  it('"How to earn" lists the same four payouts and says what pays nothing', () => {
    const { host, dispose } = mount(true);
    const rows = [...host.querySelectorAll<HTMLElement>('.rl-stores__earn-row')];
    expect(rows.map((r) => [r.dataset.earn, r.querySelector('.rl-stores__earn-n')?.textContent])).toEqual([
      ['welcome', '+71'],
      ['firstWin', '+13'],
      ['star', '+7'],
      ['campaign', '+59'],
    ]);
    expect(host.querySelector('.rl-stores__earn-none')?.textContent).toMatch(/Replays, Conduct points and versus matches pay no coins/);
    dispose();
  });

  it('a preview (no wallet) shows neither: it says why there is nothing to earn into', () => {
    const { host, dispose } = mount(false);
    expect(host.querySelector('.rl-stores__about')).toBeNull();
    expect(host.querySelector('.rl-stores__earn')).toBeNull();
    expect(host.querySelector('.rl-stores__notice')?.textContent).toMatch(/cannot keep a Roar-coin wallet/);
    dispose();
  });
});

describe('G-U1: every new string is bracketed under ?pseudo=1', () => {
  const awards: EarnAward[] = [
    { source: 'welcome', coins: 100 },
    { source: 'first_win', coins: 10 },
    { source: 'star', coins: 10, stars: 2 },
    { source: 'campaign', coins: 100 },
  ];

  it('the Stores\' own chrome, the earn panel and the receipts shelf', () => {
    setCatalogue('pseudo', en, pseudo);
    const { host, dispose } = mount(true);
    const texts = [
      host.querySelector('.rl-stores__about'),
      host.querySelector('.rl-stores__earn-h'),
      host.querySelector('.rl-stores__earn-none'),
      ...host.querySelectorAll('.rl-stores__earn-what'),
      host.querySelector('[data-shelf="receipts"].rl-stores__panel .rl-stores__empty'),
    ].map((e) => e?.textContent ?? '');
    expect(texts).toHaveLength(8);
    for (const text of texts) expect(text.startsWith('⟦') && text.endsWith('⟧'), text).toBe(true);
    expect(missingKeys().filter((k) => k.startsWith('stores.') || k.startsWith('debrief.coins'))).toEqual([]);
    dispose();
  });

  it('the debrief rows and the receipts rows', () => {
    setCatalogue('pseudo', en, pseudo);
    for (const a of awards) expect(coinAwardText(a).startsWith('⟦'), a.source).toBe(true);
    for (const key of ['debrief.coins.total', 'debrief.coins.totalSub', 'stores.receipt.earn.welcome', 'stores.receipt.earn.first_win', 'stores.receipt.earn.star', 'stores.receipt.earn.campaign']) {
      expect(t(key, { n: 5 }).startsWith('⟦'), key).toBe(true);
    }
  });

  it('every key this feature added exists in the English catalogue', () => {
    const keys = Object.keys(en).filter((k) => /^(stores\.(about|earn\.|receipt\.earn\.)|debrief\.coins\.)/.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect((en as Record<string, string>)[k].length).toBeGreaterThan(0);
  });
});
