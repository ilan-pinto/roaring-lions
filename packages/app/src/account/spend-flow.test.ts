// @vitest-environment jsdom
// Task 2.12 (GH-1075 A2, GH-1142): coin Buys, coupons and the reset through the sync loop's barrier, with the screens drawing them
// pending. Every spec drives the REAL Garage (`showBrigade`) over the real account store, sync loop and spend flow; only the
// Worker is a fake (`sync-kit.ts`, with `spend`, `coupon` and `reset-free` given a body here).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { units, type UpgradableUnit } from '@lions/data';
import type { CampaignView, WalletView } from '@lions/economy';
import { emptyAccount } from '@lions/economy';
import en from '../i18n/en.json';
import { setCatalogue, t } from '../i18n/t';
import { accountView } from '../account-view';
import { buyTierWithCredits } from '../credit-buy';
import { buyUnlock } from '../brigade-account';
import { readActive, saveSlot } from '../profile';
import { showBrigade, type BrigadeOptions, type BrigadeUnit, type GarageState } from '../ui/brigade';
import { showMenu } from '../ui/menu';
import { showSaves } from '../ui/saves';
import { accountLedgerStore } from './account-store';
import type { AccountClient, CallResult, CouponAnswer } from './client';
import { cacheOf, memStorage, opIds, world } from './fixtures';
import { spendFlow, type SpendFlow } from './spend-flow';
import { startSync, type SyncHandle } from './sync';
import { clientFor, FakeServer, makeScheduler, tick } from './sync-kit';
import { coinHalfFor } from '@lions/economy';

beforeAll(() => setCatalogue('en', en));

const UNIT = 'mbt_lavi';
const TRACK = 'armour';
const OTHER = 'firepower';
const ok = <T,>(body: T): CallResult<T> => ({ ok: true, status: 200, body });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
};
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await tick();
};

function roster(bought: ReadonlySet<string>): BrigadeUnit[] {
  return Object.values(units)
    .filter((u) => u.faction === 'kdf')
    .map((u) => {
      const raw = 'unlock' in u ? (u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number }) : undefined;
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        unlock: raw && { roeMin: raw.roe_rating_min, starsMin: raw.stars_min, afterMission: raw.after_mission, price: raw.price, bought: bought.has(u.id) },
        isKamikaze: false,
        transportSlots: 0,
        isSoft: false,
        canCarry: null,
        canEmbark: false,
        upgrades: 'upgrades' in u ? u.upgrades : undefined,
      } as BrigadeUnit;
    });
}

interface Rig {
  server: FakeServer;
  store: ReturnType<typeof accountLedgerStore>;
  sync: SyncHandle;
  flow: SpendFlow;
  sched: ReturnType<typeof makeScheduler>;
  storage: ReturnType<typeof memStorage>;
  holds: { spend: Promise<void> | null; coupon: Promise<void> | null; reset: Promise<void> | null; couponStatus: number | null };
  online: { on: boolean };
}

function rig(o: { balance?: number; coins?: number } = {}): Rig {
  const server = new FakeServer();
  server.campaign = { ...(server.campaign as CampaignView), brigade: { ...emptyAccount(), balance: o.balance ?? 5000, earned_total: o.balance ?? 5000 } };
  // The Lavi is open (a coin-bought unit), so its tier rows draw in the Stores and its credit Buys can be asked.
  const entitlements = clone(server.wallet.entitlements);
  entitlements.units[UNIT] = { free: true };
  server.wallet = { ...server.wallet, free: o.coins ?? 5000, entitlements };
  const holds: Rig['holds'] = { spend: null, coupon: null, reset: null, couponStatus: null };
  const online = { on: true };
  const base = clientFor(server);
  const client: AccountClient = {
    ...base,
    // A coin Buy moves the server's wallet: the tier lands in the entitlements, a unit in `units`.
    spend: async (ask) => {
      server.calls.push({ name: 'POST spend', id: ask.item === 'unit' ? ask.unitId : `${ask.unitId}.${ask.track}` });
      if (holds.spend !== null) await holds.spend;
      const ent = clone(server.wallet.entitlements);
      if (ask.item === 'unit') ent.units[ask.unitId] = { free: true };
      else ent.upgrades[ask.unitId] = { ...(ent.upgrades[ask.unitId] ?? {}), [ask.track]: { tier: ask.tier, paidTiers: 0 } };
      server.wallet = { ...server.wallet, free: server.wallet.free - 7, entitlements: ent, revision: server.wallet.revision + 1 };
      return ok({ wallet: clone(server.wallet) as WalletView });
    },
    // A coupon pays 300 credits into the SERVER's campaign.
    coupon: async (code) => {
      server.calls.push({ name: 'POST coupon', id: code });
      if (holds.coupon !== null) await holds.coupon;
      if (holds.couponStatus !== null) return { ok: false, status: holds.couponStatus, body: { error: 'body' } };
      const c = server.campaign as CampaignView;
      server.campaign = { ...c, brigade: { ...c.brigade, balance: c.brigade.balance + 300, earned_total: c.brigade.earned_total + 300 }, revision: c.revision + 1, digest: `c${c.revision + 1}` };
      const body: CouponAnswer = { result: 'ok', ids: ['x'], coins: 0, credits: 300, wallet: clone(server.wallet), campaign: clone(server.campaign) };
      return ok(body);
    },
    resetFree: async () => {
      server.calls.push({ name: 'POST reset-free' });
      if (holds.reset !== null) await holds.reset;
      const c = server.campaign as CampaignView;
      server.campaign = { ...c, brigade: emptyAccount(), revision: c.revision + 1, digest: `r${c.revision + 1}` };
      server.wallet = { ...server.wallet, free: 0, revision: server.wallet.revision + 1 };
      return ok({ wallet: clone(server.wallet), campaign: clone(server.campaign) });
    },
  };
  const storage = memStorage();
  const sched = makeScheduler();
  const cache = cacheOf(server.snapshot());
  // eslint-disable-next-line prefer-const -- the store's onChange closes over the loop and the flow, which are built after it
  let syncRef: SyncHandle | undefined;
  // eslint-disable-next-line prefer-const -- as above
  let flowRef: SpendFlow | undefined;
  const store = accountLedgerStore({ storage, cache, world, onChange: () => (syncRef?.kick(), flowRef?.notify()), newOpId: opIds(), tabId: 'T1' });
  const flow = spendFlow({ store, online: () => online.on });
  flowRef = flow;
  const sync = startSync({ store, client, storage, now: sched.now, schedule: sched.schedule, online: () => online.on, onChange: () => flow.notify(), onVictory: (id, a) => flow.onVictory(id, a) });
  syncRef = sync;
  flow.attach(sync);
  return { server, store, sync, flow, sched, storage, holds, online };
}

const mounted: (() => void)[] = [];
afterEach(() => {
  for (const d of mounted.splice(0)) d();
  document.body.innerHTML = '';
});

/** The Garage as `main.ts` wires it for a signed-in player: the same handlers, over the rig. */
function garage(r: Rig, over: Partial<BrigadeOptions> = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const now = (): GarageState => {
    const a = accountView(r.store);
    return { units: roster(a.boughtUnits), credits: a.balance, owned: a.ownedTiers, earned: r.store.readAccount().upgrades };
  };
  const a0 = accountView(r.store);
  mounted.push(
    showBrigade(host, {
      units: roster(a0.boughtUnits),
      ledger: {},
      missionName: () => undefined,
      baseOf: (id) => ((units as Record<string, unknown>)[id] as UpgradableUnit | undefined) ?? { id },
      possibleStars: 3,
      credits: a0.balance,
      owned: a0.ownedTiers,
      earned: r.store.readAccount().upgrades,
      reducedMotion: () => true,
      gate: r.flow.gate,
      pendingTracks: r.flow.gate.pendingTracks,
      stores: {
        coinSrc: (s) => `/c${s}.png`,
        open: true,
        pendingTracks: r.flow.gate.pendingTracks,
        read: () => {
          const w = r.store.readRoar();
          return { coin: coinHalfFor({ brigade: r.store.readAccount(), roar: w }), wallet: { coins: w.coins.free, receipts: w.receipts } };
        },
        onBuy: (ask) => r.flow.buy(ask).then(() => now()),
      },
      onBuy: (unitId, price) => {
        const { account, ok: landed } = buyUnlock(r.store.readAccount(), unitId, price);
        if (!landed) return { ...now(), landed: false };
        r.store.writeAccount(account);
        return { ...now(), landed: true };
      },
      onBuyUpgrade: (unitId, track, tier, price) => {
        const prices = (roster(accountView(r.store).boughtUnits).find((u) => u.id === unitId)?.upgrades?.[track]?.tiers ?? []).map((x) => x.price);
        const done = buyTierWithCredits({ account: r.store.readAccount(), owned: accountView(r.store).ownedTiers }, prices, unitId, track, tier, price);
        if (!done.ok) return { ...now(), landed: false };
        r.store.writeAccount(done.account);
        return { ...now(), landed: true };
      },
      onRedeem: (code) => r.flow.redeem(code).then((out) => ({ state: now(), ...out })),
      onReset: () => r.flow.reset().then(() => now()),
      ...over,
    })
  );
  return host;
}

const q = <E extends HTMLElement = HTMLButtonElement>(host: HTMLElement, sel: string): E => {
  const e = host.querySelector<E>(sel);
  if (e === null) throw new Error(`no ${sel}`);
  return e;
};
const creditStores = (h: HTMLElement, track = TRACK): HTMLButtonElement => q(h, `[data-buy="credits:${UNIT}.${track}"]`);
const coinStores = (h: HTMLElement, tier = 1): HTMLButtonElement => q(h, `[data-buy="tier:${UNIT}.${TRACK}.${tier}"]`);
function toBrigade(h: HTMLElement): void {
  q(h, '[data-view="brigade"]').click();
  q(h, `[data-unit="${UNIT}"]`).click();
}
const creditBoard = (h: HTMLElement, track = TRACK): HTMLButtonElement => q(h, `[data-focus-key="buy:${track}"]`);

describe('A2-26 credit_buy_waits_for_a_coin_spend (GH-1142)', () => {
  it('a track with a coin spend in flight has its credit Buy disabled (Stores and Garage), another track is not, and both clear on the answer', async () => {
    const r = rig();
    const h = garage(r);
    // Before: both tracks' credit Buys are live.
    expect(creditStores(h).disabled).toBe(false);
    expect(creditStores(h, OTHER).disabled).toBe(false);
    const g = gate();
    r.holds.spend = g.promise;
    coinStores(h).click();
    await settle();
    expect(r.server.count('POST spend')).toHaveLength(1);
    expect(r.store.pendingSpends.has(`${UNIT}.${TRACK}`)).toBe(true);
    // The Stores row: the coin Buy reads pending, this track's credit Buy is disabled with its reason, the other track's is not.
    expect(coinStores(h).textContent).toContain(t('stores.pending'));
    expect(creditStores(h).disabled).toBe(true);
    expect(creditStores(h).title).toBe(t('stores.pendingCoin'));
    expect(creditStores(h, OTHER).disabled).toBe(false);
    // The Garage's rung, on the brigade tab.
    toBrigade(h);
    expect(creditBoard(h).disabled).toBe(true);
    expect(creditBoard(h).title).toBe(t('stores.pendingCoin'));
    expect(creditBoard(h, OTHER).disabled).toBe(false);
    // The answer lands: the pending key is gone and the coin tier shows.
    g.release();
    await settle();
    expect(r.store.pendingSpends.size).toBe(0);
    expect(creditBoard(h).disabled).toBe(false);
    expect(creditBoard(h).title).toBe('');
    q(h, '[data-view="stores"]').click();
    expect(creditStores(h).disabled).toBe(false);
    expect(h.querySelectorAll(`[data-item="tiers:${UNIT}"] [data-track="${TRACK}"] .rl-stores__pip--coins`).length).toBeGreaterThanOrEqual(1);
  });
});

describe('A2-29 server_ops_need_a_synced_outbox', () => {
  it('a queued campaign op disables the coin Buy, the coupon field and Reset with stores.syncing, and the drain re-enables them', async () => {
    const r = rig();
    r.store.writeLedger({ 'campaign.slots_issued': 1 }); // an op in the outbox; the debounce has not fired
    expect(r.store.outboxSize()).toBe(1);
    const h = garage(r);
    expect(coinStores(h).disabled).toBe(true);
    expect(coinStores(h).title).toBe(t('stores.syncing'));
    const go = q(h, '.rl-garage__redeem-go');
    expect(go.disabled).toBe(true);
    expect(go.title).toBe(t('stores.syncing'));
    expect(q<HTMLInputElement>(h, '.rl-garage__redeem-input').disabled).toBe(true);
    expect(q(h, '.rl-garage__reset').disabled).toBe(true);
    expect(q(h, '.rl-garage__reset').title).toBe(t('stores.syncing'));
    await r.sched.advance(2000); // the debounce fires and the op drains
    await r.sync.idle();
    await settle();
    expect(r.store.outboxSize()).toBe(0);
    expect(coinStores(h).disabled).toBe(false);
    expect(q(h, '.rl-garage__redeem-go').disabled).toBe(false);
    expect(q(h, '.rl-garage__reset').disabled).toBe(false);
  });

  it('offline disables all three with stores.offlineNow', async () => {
    const r = rig();
    const h = garage(r);
    expect(coinStores(h).disabled).toBe(false);
    r.online.on = false;
    r.flow.notify();
    expect(coinStores(h).disabled).toBe(true);
    expect(coinStores(h).title).toBe(t('stores.offlineNow'));
    expect(q(h, '.rl-garage__redeem-go').title).toBe(t('stores.offlineNow'));
    expect(q(h, '.rl-garage__reset').title).toBe(t('stores.offlineNow'));
    expect(r.server.calls.filter((c) => c.name.startsWith('POST'))).toEqual([]);
  });

  it('an empty outbox and a connection: the coin Buy shows stores.pending until the answer lands, and every other coin Buy is held', async () => {
    const r = rig();
    const h = garage(r);
    const g = gate();
    r.holds.spend = g.promise;
    coinStores(h).click();
    await settle();
    expect(coinStores(h).textContent).toContain(t('stores.pending'));
    expect(coinStores(h).disabled).toBe(true);
    expect(q(h, `[data-buy="tier:${UNIT}.${OTHER}.1"]`).disabled).toBe(true);
    g.release();
    await settle();
    expect(coinStores(h, 2).textContent).not.toContain(t('stores.pending'));
    expect(r.server.wallet.entitlements.upgrades[UNIT]?.[TRACK]?.tier).toBe(1);
  });
});

describe('a_coupon_freezes_campaign_writes (§0.39)', () => {
  it('while POST coupon is pending a credit Buy, a slot save and New campaign are disabled; the coupon credits are then in the view and a following credit Buy keeps them', async () => {
    const r = rig();
    // A slot to load, saved and flushed before the coupon (the barrier needs an empty outbox).
    saveSlot(r.store, 'a', 'Alpha', readActive(r.store), 'b', 1);
    await r.sync.flush();
    expect(r.store.outboxSize()).toBe(0);
    const h = garage(r, { stores: undefined });
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    mounted.push(showSaves(stage, { store: r.store, build: 'b', now: () => 2, back: '/', download: () => {}, pickFile: () => Promise.resolve(null), onChanged: () => {}, frozen: () => r.flow.gate.campaignFrozen(), subscribe: r.flow.gate.subscribe }));
    const menuStage = document.createElement('div');
    document.body.appendChild(menuStage);
    mounted.push(showMenu(menuStage, { base: '/', version: 't', world, tutorial: { id: 'tut', name: 'Tut', done: true }, newCampaign: () => {}, newCampaignFrozen: () => r.flow.gate.campaignFrozen() }));
    const newCampaign = (): HTMLButtonElement => q(menuStage, '[data-kind="aside"]:is(button)');
    expect(newCampaign().disabled).toBe(false);
    expect(q(stage, '.rl-saves__form button[type="submit"]').disabled).toBe(false);

    const g = gate();
    r.holds.coupon = g.promise;
    q<HTMLInputElement>(h, '.rl-garage__redeem-input').value = 'CODE';
    q<HTMLFormElement>(h, '.rl-garage__redeem').requestSubmit();
    await settle();
    expect(r.server.count('POST coupon')).toHaveLength(1);
    // Frozen: the rung's credit Buy, the slot save and load, New campaign.
    expect(creditBoard(h).disabled).toBe(true);
    expect(creditBoard(h).title).toBe(t('stores.pending'));
    expect(q(stage, '.rl-saves__form button[type="submit"]').disabled).toBe(true);
    expect(q(stage, 'button[data-action="load"]').disabled).toBe(true);
    // New campaign was drawn before the freeze: its click is refused, and the menu built NOW draws it disabled.
    const stage2 = document.createElement('div');
    document.body.appendChild(stage2);
    mounted.push(showMenu(stage2, { base: '/', version: 't', world, tutorial: { id: 'tut', name: 'Tut', done: true }, newCampaign: () => {}, newCampaignFrozen: () => r.flow.gate.campaignFrozen() }));
    expect(q(stage2, '[data-kind="aside"]:is(button)').disabled).toBe(true);
    expect(q(stage2, '[data-kind="aside"]:is(button)').title).toBe(t('stores.pending'));
    // The coupon lands: its 300 credits are in the view, the controls are back, and a following credit Buy keeps them.
    g.release();
    await settle();
    expect(r.store.readAccount().balance).toBe(5300);
    expect(creditBoard(h).disabled).toBe(false);
    expect(q(stage, '.rl-saves__form button[type="submit"]').disabled).toBe(false);
    const price = Number(q(h, `[data-track="${TRACK}"] .rl-garage__rung[data-state="next"] .rl-garage__rung-price`).textContent);
    creditBoard(h).click();
    await settle();
    const after = r.store.readAccount().balance;
    expect(after).toBe(5300 - price);
    await r.sched.advance(2000);
    await r.sync.idle();
    await settle();
    expect((r.server.campaign as CampaignView).brigade.balance).toBe(5300 - price); // the coupon's credits survived the Buy's PUT
  });

  it('a coin Buy of unit U in flight disables U\'s credit unlock (unit:<id>)', async () => {
    const r = rig({ balance: 90000, coins: 90000 });
    const h = garage(r);
    const target = [...h.querySelectorAll<HTMLButtonElement>('[data-buy^="credits:"]')]
      .map((b) => b.dataset.buy?.slice('credits:'.length) ?? '')
      .find((id) => !id.includes('.') && h.querySelector(`[data-buy="unit:${id}"]:not([disabled])`) !== null);
    expect(target).toBeDefined(); // a guard over nothing passes forever
    const id = target as string;
    expect(q(h, `[data-buy="credits:${id}"]`).disabled).toBe(false);
    const g = gate();
    r.holds.spend = g.promise;
    q(h, `[data-buy="unit:${id}"]`).click();
    await settle();
    expect(r.store.pendingSpends.has(`unit:${id}`)).toBe(true);
    expect(q(h, `[data-buy="credits:${id}"]`).disabled).toBe(true);
    expect(q(h, `[data-buy="credits:${id}"]`).title).toBe(t('stores.pendingCoin'));
    g.release();
    await settle();
    expect(r.store.pendingSpends.size).toBe(0);
  });
});

describe('the other server handlers', () => {
  it('a 400 on POST coupon is terminal: the unknown-code feedback, never a retry', async () => {
    const r = rig();
    r.holds.couponStatus = 400;
    expect(await r.flow.redeem('x'.repeat(300))).toEqual({ result: 'unknown', credits: 0, coins: 0 });
    expect(r.server.count('POST coupon')).toHaveLength(1);
    await r.sched.advance(120_000);
    expect(r.server.count('POST coupon')).toHaveLength(1);
    expect(r.flow.gate.campaignFrozen()).toBe(false);
    r.holds.couponStatus = 500;
    expect((await r.flow.redeem('x')).result).toBe('failed');
  });

  it('the reset is the server\'s: the brigade and the free coins come back empty, and the freeze lifts', async () => {
    const r = rig();
    const g = gate();
    r.holds.reset = g.promise;
    const done = r.flow.reset();
    await settle();
    expect(r.flow.gate.campaignFrozen()).toBe(true);
    g.release();
    expect(await done).toBe('ok');
    expect(r.flow.gate.campaignFrozen()).toBe(false);
    expect(r.store.readAccount().balance).toBe(0);
    expect(r.store.readRoar().coins.free).toBe(0);
  });

  it('A2-29 (the barrier half): a barrier that refuses (offline, an op queued) is stated, not sent', async () => {
    const r = rig();
    r.online.on = false;
    expect(await r.flow.reset()).toBe('offline');
    r.online.on = true;
    r.store.writeLedger({ 'campaign.slots_issued': 1 });
    expect(await r.flow.buy({ kind: 'unit', unitId: 'breach_team' })).toBe('syncing');
    expect((await r.flow.redeem('c')).result).toBe('failed');
    expect(r.server.calls.filter((c) => c.name.startsWith('POST'))).toEqual([]);
    expect(r.store.pendingSpends.size).toBe(0);
  });
});

describe('the debrief coin line (Review Focus 4)', () => {
  const win = { missionId: 'beit_sahwan_1_outskirts', stars: 2 as const, ledger: {} };
  it('opens provisional, then becomes the SERVER\'s figures when the victory is answered', async () => {
    const r = rig();
    r.store.recordVictory({ ledger: { 'campaign.slots_issued': 1 }, account: null, roar: null, win, start: 'nonce' });
    const op = r.store.sync.ops().find((o) => o.kind === 'victory');
    expect(op).toBeDefined();
    const line = r.flow.coinLine((op as { opId: string }).opId, { coins: 120, balance: 5120, phase: 'provisional' });
    const seen: string[] = [];
    line.subscribe((s) => seen.push(`${s.phase}:${s.coins}:${s.balance}`));
    await r.sync.flush();
    await settle();
    // The fake server pays 10 and moves the wallet by 10: the line is ITS figure, not the 120 it opened on.
    expect(seen).toEqual([`saved:10:${r.server.wallet.free}`]);
  });

  it('says willSync when the win is still queued after the flush', async () => {
    const r = rig();
    r.store.recordVictory({ ledger: { 'campaign.slots_issued': 1 }, account: null, roar: null, win, start: 'nonce' });
    const opId = (r.store.sync.ops().find((o) => o.kind === 'victory') as { opId: string }).opId;
    r.server.failWith.set(opId, 503);
    const line = r.flow.coinLine(opId, { coins: 120, balance: 5120, phase: 'provisional' });
    const seen: string[] = [];
    line.subscribe((s) => seen.push(s.phase));
    await r.sync.flush();
    await settle();
    expect(seen).toEqual(['willSync']);
    expect(r.store.outboxSize()).toBe(1);
  });

  it('a watcher added after the answer is told at once', async () => {
    const r = rig();
    r.store.recordVictory({ ledger: { 'campaign.slots_issued': 1 }, account: null, roar: null, win, start: 'nonce' });
    const opId = (r.store.sync.ops().find((o) => o.kind === 'victory') as { opId: string }).opId;
    await r.sync.flush();
    await settle();
    const seen: string[] = [];
    r.flow.coinLine(opId, { coins: 120, balance: 1, phase: 'provisional' }).subscribe((s) => seen.push(s.phase));
    expect(seen).toEqual(['saved']);
  });
});
