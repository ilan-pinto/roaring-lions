/**
 * The signed-in half of the Garage's purchases (GH-1075 A2 Task 2.12, GH-1142): coin Buys, coupons and the brigade reset
 * as server calls through the sync loop's barrier (§0.18), the gate the screens read to draw them pending, and the
 * debrief's coin line that starts provisional and is corrected in place.
 *
 * Nothing here decides a price or an amount. A coin Buy sends WHICH item; a coupon sends the code; the server answers with
 * the wallet and, for a coupon or a reset, the campaign, and `sync.ts` has already written that answer into the view by
 * the time a promise below resolves. A guest never builds one of these.
 */
import type { CoinAsk, CoinAskWire } from '@lions/economy';
import type { CoinLineState, DebriefCoins } from '../ui/debrief';
import type { NetState, SpendGate } from '../ui/spend-gate';
import type { AccountLedgerStore } from './account-store';
import type { VictoryAnswer } from './client';
import type { BarrierOutcome, SyncHandle } from './sync';

/** What a Garage handler learns from a server call that is not an answer: say so, and change nothing. */
export type ServerOutcome = 'ok' | 'refused' | 'offline' | 'syncing' | 'error';

export interface RedeemResult {
  result: 'ok' | 'unknown' | 'used' | 'failed';
  credits: number;
  coins: number;
}

export interface SpendFlow {
  gate: SpendGate;
  /** A coin Buy: resolves once the server has answered (or the barrier refused it). The view has moved by then. */
  buy(ask: CoinAsk): Promise<ServerOutcome>;
  redeem(code: string): Promise<RedeemResult>;
  /** The brigade reset (reset-free). */
  reset(): Promise<ServerOutcome>;
  /** A response landed or an op was queued: the screens re-read. */
  notify(): void;
  /** The sync loop's own start: set after `startSync` returns (the store's `onChange` is built before it). */
  attach(sync: SyncHandle): void;
  /** `SyncOptions.onVictory`: remembers each victory answer by op id and hands it to whoever watches that op. */
  onVictory(opId: string, answer: VictoryAnswer): void;
  /**
   * The debrief's coin line for one queued victory (Review Focus 4): opens on `initial` (the provisional award), becomes
   * `saved` with the SERVER's figures when the op is answered, and says `willSync` when the win is still queued after a
   * flush. A retried op is answered with the first answer's figures, so the line counts once.
   */
  coinLine(opId: string, initial: CoinLineState): DebriefCoins;
}

/** The provisional line a victory opens on, or null: with no `mission/start` nonce the server pays no coins, so none are promised. */
export function provisionalLine(start: string | null, awarded: number, balance: number): CoinLineState | null {
  return start === null ? null : { coins: awarded, balance, phase: 'provisional' };
}

export interface SpendFlowOptions {
  store: AccountLedgerStore;
  online?: () => boolean;
}

const wireOf = (ask: CoinAsk): CoinAskWire =>
  ask.kind === 'unit' ? { item: 'unit', unitId: ask.unitId } : { item: 'tier', unitId: ask.unitId, track: ask.track, tier: ask.tier };

const defaultOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

function outcomeOf(o: BarrierOutcome<unknown>): ServerOutcome {
  return o.kind === 'ok' ? 'ok' : o.kind;
}

export function spendFlow(o: SpendFlowOptions): SpendFlow {
  const { store } = o;
  const online = o.online ?? defaultOnline;
  const listeners = new Set<() => void>();
  let sync: SyncHandle | null = null;
  // A coupon or a reset is a campaign-writing barrier (§0.39): while any is in flight the campaign-writing controls are frozen.
  let freezes = 0;
  const answers = new Map<string, VictoryAnswer>();
  const watchers = new Map<string, Set<(a: VictoryAnswer) => void>>();
  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };
  const net = (): NetState => (!online() ? 'offline' : store.outboxSize() > 0 ? 'syncing' : 'ok');
  const need = (): SyncHandle => {
    if (sync === null) throw new Error('spendFlow: attach(sync) before the first server call');
    return sync;
  };
  async function frozen<T>(run: (s: SyncHandle) => Promise<T>): Promise<T> {
    const s = need();
    freezes++;
    notify();
    try {
      return await run(s);
    } finally {
      freezes--;
      notify();
    }
  }
  return {
    gate: {
      pendingTracks: () => store.pendingSpends,
      campaignFrozen: () => freezes > 0,
      net,
      subscribe: (cb) => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      },
    },
    notify,
    attach: (s) => {
      sync = s;
    },
    async buy(ask) {
      const s = need();
      // The key is pending from the CLICK, not from the moment the barrier's lock is granted: a credit Buy of the same track
      // must already be held when the screens redraw (GH-1142). The sync loop marks and clears the same key; a Set holds it once.
      const key = ask.kind === 'unit' ? `unit:${ask.unitId}` : `${ask.unitId}.${ask.track}`;
      store.sync.markPending(key);
      notify();
      try {
        return outcomeOf(await s.spend(wireOf(ask)));
      } finally {
        store.sync.clearPending(key);
        notify();
      }
    },
    onVictory(opId, answer) {
      answers.set(opId, answer);
      for (const cb of [...(watchers.get(opId) ?? [])]) cb(answer);
    },
    coinLine(opId, initial) {
      const subs = new Set<(s: CoinLineState) => void>();
      let last = initial;
      const push = (st: CoinLineState): void => {
        last = st;
        for (const cb of [...subs]) cb(st);
      };
      const saved = (a: VictoryAnswer): void => push({ coins: a.coins, balance: a.wallet.free, phase: 'saved' });
      const set = watchers.get(opId) ?? new Set<(a: VictoryAnswer) => void>();
      set.add(saved);
      watchers.set(opId, set);
      const known = answers.get(opId);
      if (known !== undefined) saved(known);
      else
        void need()
          .flush()
          .catch(() => undefined)
          .then(() => {
            // Still queued after the flush ended: it is on this device and goes up when the connection does.
            if (last.phase === 'provisional' && store.sync.ops().some((op) => op.opId === opId)) push({ ...last, phase: 'willSync' });
          });
      return {
        initial,
        subscribe: (cb) => {
          subs.add(cb);
          if (last !== initial) cb(last);
          return () => void subs.delete(cb);
        },
      };
    },
    async redeem(code) {
      const out = await frozen((s) => s.coupon(code));
      if (out.kind === 'ok') return { result: out.body.result, credits: out.body.credits, coins: out.body.coins };
      // A 400 is the Worker's terminal "this is not a code" (a non-string, or over 256 characters): never a retry.
      if (out.kind === 'error' && out.status === 400) return { result: 'unknown', credits: 0, coins: 0 };
      return { result: 'failed', credits: 0, coins: 0 };
    },
    async reset() {
      return outcomeOf(await frozen((s) => s.resetFree()));
    },
  };
}

