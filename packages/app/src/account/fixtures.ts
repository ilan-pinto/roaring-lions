/** Shared fixtures for the account store's specs (test-only). */
import { emptyAccount, emptyRoar, parseWorld } from '@lions/economy';
import type { ServerState, SaveSlot, WalletView } from '@lions/economy';
import worldJson from '../../../../data/campaign/world.json';
import type { StorageLike } from '../brigade-account';
import type { AccountCache } from './cache';

export const world = parseWorld(worldJson);

export function walletView(free = 0): WalletView {
  const w = emptyRoar();
  return { free, paid: 0, entitlements: w.entitlements, earn: w.earn, receipts: [], revision: 1 };
}

export function confirmedState(over: Partial<ServerState> = {}): ServerState {
  return { campaign: { ledger: {}, brigade: emptyAccount(), tutorialDone: false, revision: 3, digest: 'd' }, wallet: walletView(), slots: [], ...over };
}

export function cacheOf(confirmed: ServerState = confirmedState(), bodies: Record<string, SaveSlot> = {}): AccountCache {
  return { version: 1, publicId: 'pub1', confirmed, bodies };
}

export function slotOf(id: string, name = 'S', savedAt = 1): SaveSlot {
  return { version: 1, id, name, savedAt, build: 'b', ledger: {}, account: emptyAccount(), tutorialDone: false };
}

export function memStorage(): StorageLike & { map: Map<string, string>; length: number; key(i: number): string | null } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

let n = 0;
export const opIds = (): (() => string) => () => `op-${++n}`;

/** The A2 client methods a spec does not drive: each throws, so a call a test did not expect goes red (spread into a fake `AccountClient`). */
const unexpected = (what: string) => (): never => {
  throw new Error(`unexpected AccountClient.${what}`);
};
export const unusedA2Client = {
  state: unexpected('state'),
  slot: unexpected('slot'),
  missionStart: unexpected('missionStart'),
  victory: unexpected('victory'),
  putCampaign: unexpected('putCampaign'),
  spend: unexpected('spend'),
  coupon: unexpected('coupon'),
  resetFree: unexpected('resetFree'),
  putSlot: unexpected('putSlot'),
  deleteSlot: unexpected('deleteSlot'),
  claim: unexpected('claim'),
};
