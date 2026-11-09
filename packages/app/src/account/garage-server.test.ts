// @vitest-environment jsdom
// Task 2.12 fix round 2: an account store with no spend flow (a signed-in device whose client module would not load) is OFFLINE,
// not a guest. The real Garage over the real account store; the handlers come from `serverControls`, as main.ts wires them.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coinHalfFor } from '@lions/economy';
import { units, type UpgradableUnit } from '@lions/data';
import en from '../i18n/en.json';
import { setCatalogue, t } from '../i18n/t';
import { blockedLedgerStore } from '../ledger-store';
import { showBrigade, type BrigadeUnit, type GarageState } from '../ui/brigade';
import { accountLedgerStore } from './account-store';
import { cacheOf, memStorage, opIds, world } from './fixtures';
import { garageServerMode, serverControls, type ServerHandlers } from './garage-server';
import { spendFlow } from './spend-flow';

beforeAll(() => setCatalogue('en', en));
const UNIT = 'mbt_lavi';
const mounted: (() => void)[] = [];
afterEach(() => {
  for (const d of mounted.splice(0)) d();
  document.body.innerHTML = '';
});
const roster = (): BrigadeUnit[] =>
  Object.values(units)
    .filter((u) => u.faction === 'kdf')
    .map((u) => ({ id: u.id, name: u.name, role: u.role, isKamikaze: false, transportSlots: 0, isSoft: false, canCarry: null, canEmbark: false, upgrades: 'upgrades' in u ? u.upgrades : undefined }) as BrigadeUnit);
const state = (): GarageState => ({ units: roster(), credits: 5000, owned: {}, earned: {} });
const accountStore = () => accountLedgerStore({ storage: memStorage(), cache: cacheOf(), world, onChange: () => {}, newOpId: opIds(), tabId: 'T1' });

function mount(store: ReturnType<typeof accountStore>, handlers: ServerHandlers<GarageState>, gate: ReturnType<typeof serverControls>['gate']): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mounted.push(
    showBrigade(host, {
      units: roster(),
      ledger: {},
      missionName: () => undefined,
      baseOf: (id) => ((units as Record<string, unknown>)[id] as UpgradableUnit | undefined) ?? { id },
      possibleStars: 3,
      credits: 5000,
      owned: {},
      earned: {},
      reducedMotion: () => true,
      ...(gate !== undefined ? { gate, pendingTracks: gate.pendingTracks } : {}),
      stores: {
        coinSrc: (s) => `/c${s}.png`,
        open: true,
        ...(gate !== undefined ? { pendingTracks: gate.pendingTracks } : {}),
        read: () => ({ coin: coinHalfFor({ brigade: store.readAccount(), roar: store.readRoar() }), wallet: { coins: 5000, receipts: [] } }),
        onBuy: handlers.buy,
      },
      onBuy: () => ({ ...state(), landed: false }),
      onRedeem: handlers.redeem,
      onReset: handlers.reset,
    })
  );
  return host;
}
const q = (h: HTMLElement, sel: string): HTMLButtonElement => {
  const e = h.querySelector<HTMLButtonElement>(sel);
  if (e === null) throw new Error(`no ${sel}`);
  return e;
};

describe('garageServerMode', () => {
  it('is decided by the store: an account store with no flow is offline, a local store is a guest', () => {
    const acct = accountStore();
    expect(garageServerMode(acct, null).mode).toBe('offline');
    expect(garageServerMode(blockedLedgerStore(), null).mode).toBe('guest');
    const flow = spendFlow({ store: acct });
    expect(garageServerMode(acct, flow).mode).toBe('flow');
  });
});

describe('an account store with no spend flow', () => {
  it('draws the coin Buy, the coupon and the reset disabled with stores.offlineNow, and no handler touches the wallet', async () => {
    const store = accountStore();
    const writeRoar = vi.spyOn(store, 'writeRoar');
    const resetAccount = vi.spyOn(store, 'resetAccount');
    const guest = vi.fn(() => {
      throw new Error('the guest path must not be built');
    });
    const ctl = serverControls(garageServerMode(store, null), state, { guest, flow: guest });
    expect(guest).not.toHaveBeenCalled();
    const h = mount(store, ctl.handlers, ctl.gate);
    q(h, '[data-view="stores"]').click();
    const coin = h.querySelector<HTMLButtonElement>('.rl-stores__buy[data-buy^="tier:"], .rl-stores__buy[data-buy^="unit:"]');
    expect(coin).not.toBeNull();
    expect(coin?.disabled).toBe(true);
    expect(coin?.title).toBe(t('stores.offlineNow'));
    expect(q(h, '.rl-garage__redeem-go').title).toBe(t('stores.offlineNow'));
    expect(q(h, '.rl-garage__reset').title).toBe(t('stores.offlineNow'));
    expect(q(h, '.rl-garage__reset').disabled).toBe(true);
    // Even called directly (a stale handle), no handler throws or writes.
    expect(ctl.handlers.buy({ kind: 'unit', unitId: UNIT })).toEqual(state());
    expect(ctl.handlers.reset()).toEqual(state());
    expect(await ctl.handlers.redeem('X')).toMatchObject({ result: 'failed', credits: 0, coins: 0 });
    expect(writeRoar).not.toHaveBeenCalled();
    expect(resetAccount).not.toHaveBeenCalled();
  });
  it('the credit Buy is not blocked by the offline gate', () => {
    const ctl = serverControls(garageServerMode(accountStore(), null), state, { guest: () => ({}) as never, flow: () => ({}) as never });
    expect(ctl.gate?.campaignFrozen()).toBe(false);
    expect([...(ctl.gate?.pendingTracks() ?? ['x'])]).toEqual([]);
  });
});

describe('a guest', () => {
  it('gets the guest handlers and no gate: the synchronous path, unchanged', () => {
    const guestHandlers: ServerHandlers<GarageState> = { buy: () => state(), reset: () => state(), redeem: () => ({ state: state(), result: 'ok' }) };
    const ctl = serverControls(garageServerMode(blockedLedgerStore(), null), state, { guest: () => guestHandlers, flow: () => ({}) as never });
    expect(ctl.handlers).toBe(guestHandlers);
    expect(ctl.gate).toBeUndefined();
  });
});
