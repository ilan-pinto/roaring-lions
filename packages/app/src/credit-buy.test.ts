// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { createTelemetry, type TelemetryDeps } from './telemetry';
import type { TelemetryEvent } from '@lions/data/telemetry';
import { t } from './i18n/t';
import { buyTierWithCredits } from './credit-buy';
import { creditAsk } from './upgrade-pay';
import type { BrigadeAccount } from './brigade-account';
import { showBrigade, type BrigadeOptions, type BrigadeUnit, type GarageState } from './ui/brigade';

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const schema = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/schemas/telemetry_event.schema.json'), 'utf8')
) as object;
const validateEvent = new Ajv2020({ allErrors: true }).compile(schema);

const PRICES = [100, 200, 300];
const UNIT_ID = 'mbt_lavi';
const unit = (): BrigadeUnit =>
  ({
    id: UNIT_ID,
    name: 'Lavi',
    role: 'mbt',
    isKamikaze: false,
    transportSlots: 0,
    isSoft: false,
    canCarry: null,
    canEmbark: false,
    upgrades: { armour: { tiers: PRICES.map((price, i) => ({ price, patch: { 'hull.hp': 10 * (i + 1) } })) } },
  }) as BrigadeUnit;

const BASE = { id: UNIT_ID, hull: { hp: 100, armor: { front: 1, side: 1, rear: 1 } }, sensors: { optics: 1, sight_tiles: 8 }, weapons: [] };
const account = (over: Partial<BrigadeAccount> = {}): BrigadeAccount =>
  ({ balance: 1000, earned_total: 1000, unlocks: [UNIT_ID], upgrades: {}, grants: [], campaign_paid: {}, paid: 0, ...over }) as unknown as BrigadeAccount;

/** A tiny Garage wired exactly as `main.ts` wires it: a store this closure owns, a fresh read per press. */
function garage(coinTier: number, start: BrigadeAccount = account(), locked = false) {
  let acct = start;
  let coin = coinTier;
  const owned = (): Record<string, Record<string, number>> => ({
    [UNIT_ID]: { armour: Math.max(coin, acct.upgrades[UNIT_ID]?.armour ?? 0) },
  });
  const state = (landed?: boolean): GarageState => ({
    units: [{ ...unit(), unlock: locked ? { roeMin: 999 } : undefined } as BrigadeUnit],
    credits: acct.balance,
    owned: owned(),
    earned: acct.upgrades,
    ...(landed === undefined ? {} : { landed }),
  });
  const events: { item: string; price: number }[] = [];
  const landed: boolean[] = [];
  const host = document.createElement('div');
  showBrigade(host, {
    missionName: () => undefined,
    baseOf: () => BASE,
    ...state(),
    ledger: {},
    possibleStars: 78,
    onBuyUpgrade: (unitId, track, to, price) => {
      const r = buyTierWithCredits({ account: acct, owned: owned() }, PRICES, unitId, track, to, price);
      landed.push(r.ok);
      if (!r.ok) return state(false);
      acct = r.account;
      events.push({ item: r.item, price });
      return state(true);
    },
  } as BrigadeOptions);
  return { host, events, landed, account: () => acct, setCoin: (n: number) => (coin = n), read: () => ({ account: acct, owned: owned() }) };
}
const buyBtn = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier');

describe('the Garage credit Buy asks creditAsk (WP5)', () => {
  it('T19 mixed track: coins own tier 1, earned 0 -> the Buy lands and earned reads 2', () => {
    const g = garage(1);
    const b = buyBtn(g.host);
    expect(b?.textContent).toContain('ier 2');
    b?.click();
    expect(g.landed).toEqual([true]);
    expect(g.account().upgrades[UNIT_ID]?.armour).toBe(2);
    expect(g.account().balance).toBe(1000 - 300); // tiers 1 and 2, on credits
    expect(g.events).toEqual([{ item: 'mbt_lavi.armour.2', price: 300 }]);
  });

  it('the run label names the run: coins 2, earned 0 -> tiers 1-2 again, through t()', () => {
    const g = garage(2);
    const b = buyBtn(g.host);
    expect(b?.textContent).toBe(t('garage.buy.run', { to: 3, price: 600, from: 1, last: 2 }));
    expect(b?.textContent).toContain('ier 3');
    expect(b?.textContent).toContain('600');
    expect(b?.textContent).toContain('tiers 1-2');
    expect(b?.getAttribute('aria-label')).toBe(t('garage.buy.run.aria', { name: 'Lavi', track: 'Armour', to: 3, price: 600, from: 1, last: 2 }));
    b?.click();
    expect(g.account().upgrades[UNIT_ID]?.armour).toBe(3);
    expect(g.account().balance).toBe(400);
  });

  it('Review Focus 2, a stale ask: the coin tier moved after the draw -> landed false, account untouched', () => {
    const g = garage(0);
    expect(buyBtn(g.host)?.textContent).toContain('ier 1');
    const stale = creditAsk(PRICES, 0, 0); // drawn: Tier 1 · 100
    g.setCoin(2); // a coin Buy in another tab
    const before = g.account();
    const r = buyTierWithCredits(g.read(), PRICES, UNIT_ID, 'armour', stale!.to, stale!.price);
    expect(r.ok).toBe(false);
    expect(r.account).toBe(before);
    // and the shape the plan names: a press of {to: 2, price: 400} after the coin tier moved to 2
    const r2 = buyTierWithCredits({ account: before, owned: { [UNIT_ID]: { armour: 2 } } }, PRICES, UNIT_ID, 'armour', 2, 400);
    expect(r2.ok).toBe(false);
    expect(r2.account).toBe(before);
  });

  it('Review Focus 3: a locked bought unit with dormant tiers shows no credit Buy', () => {
    const g = garage(0, account({ upgrades: { [UNIT_ID]: { armour: 1 } } }), true);
    expect(buyBtn(g.host)).toBeNull();
    expect(g.host.querySelector('.rl-garage__track-lock')?.textContent).toBe(t('garage.locked.unlockFirst'));
    expect(g.host.querySelector('.rl-garage__kept')).not.toBeNull();
  });

  it('Review Focus 6: a run reports <unit>.<track>.<to> and passes the shipped schema', () => {
    const sent: TelemetryEvent[] = [];
    const deps: TelemetryDeps = {
      identity: { player: '0f8fad5b-d9cb-469f-a165-70867728950e', returning: false, optedOut: false },
      newSession: () => '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      build: '0.78.0',
      dev: false,
      now: () => 1000,
      viewport: () => [1440, 900],
      visible: () => true,
      setInterval: () => 0,
      clearInterval: () => {},
      onPagehide: () => {},
      sink: { push: (e) => void sent.push(e), flush: () => {} },
    };
    const tel = createTelemetry(deps);
    const g = garage(2);
    buyBtn(g.host)?.click();
    const [ev] = g.events;
    tel.account('purchase', g.account(), { item: ev.item, price: ev.price });
    expect(sent[0]).toMatchObject({ type: 'account', item: 'mbt_lavi.armour.3', price: 600 });
    expect(validateEvent(sent[0]), JSON.stringify(validateEvent.errors)).toBe(true);
    expect(validateEvent({ ...sent[0], item: 'mbt_lavi.armour.1-3' })).toBe(false);
  });
});
