/**
 * The wire contract of the account routes (GH-1075 A2): types only, imported by the app's
 * account client and by the Worker's routes, so the two cannot drift. Every write body carries
 * `op_id` (a UUID, `validOpId`). `toCoinAsk` is the one converter to `stores.ts`'s `CoinAsk`.
 */
import type { CoinAsk } from './stores';
import type { BrigadeAccount } from './brigade';
import type { SaveSlot } from './slot';
import type { EarnRecord, RoarReceipt, RoarWallet } from './wallet';
import type { LedgerData } from '@lions/sim';

export interface WalletView { free: number; paid: 0; entitlements: RoarWallet['entitlements']; earn: EarnRecord; receipts: RoarReceipt[]; revision: number }
export interface CampaignBody { ledger: LedgerData; brigade: BrigadeAccount; tutorialDone: boolean }
export interface CampaignView extends CampaignBody { revision: number; digest: string }
// `savedAt` + `bytes` is the change token (§0.44); `digest` is present only in PUT slots/:id and claim answers.
export interface SlotMetaView { id: string; name: string; savedAt: number; build: string; origin: 'player' | 'claim' | 'conflict'; bytes: number; digest?: string }
export interface ServerState { campaign: CampaignView | null; wallet: WalletView; slots: SlotMetaView[] }
/** `PUT campaign`'s 409: `campaign` is null when the server holds no campaign row (R19). */
export interface CampaignStaleAnswer { error: 'stale'; campaign: CampaignView | null; conflict: ConflictAnswer }
export type ConflictAnswer = { slot: SlotMetaView } | { held: true };
export type InventoryItem =
  | { deviceId: string; status: 'stored'; serverId: string; digest: string }
  | { deviceId: string; status: 'rejected'; reason: 'cap' | 'size' | 'invalid' };
// Not `CoinAsk`: that name is stores.ts's `{ kind }` type (§0.45). `toCoinAsk` converts.
export type CoinAskWire = { item: 'unit'; unitId: string } | { item: 'tier'; unitId: string; track: string; tier: number };

export interface ClaimBody {
  op_id: string;
  device_id: string;                 // a UUID (validOpId), minted by ensureDeviceId
  campaign: CampaignBody | null;     // null: the device has no campaign
  slots: { id: string; slot: SaveSlot }[];   // at most 32; valid slots only; damaged ones are never sent (§0.15)
  wallet: unknown;                   // the device's RoarWallet as stored; the server runs migrateRoar on it
  coupons: string[];                 // at most 16: brigade.coupons plus every coupon receipt's couponIds
}
export interface ClaimResult {
  coins: number;                     // net free coins credited by this claim
  earned: number;                    // the earn difference against earn_lifetime
  coupons: { id: string; credited: number; capped: boolean }[];
  carried: CoinAskWire[];
  notCarried: { ask: CoinAskWire; reason: 'coins' | 'closed' | 'owned' }[];
  campaign: InventoryItem | null;    // deviceId 'campaign'
  slots: InventoryItem[];            // one per sent slot, by the device's own id
  state: ServerState;                // read fresh, also on a repeated device_id
}

/** The wire form of a coin ask, as `stores.ts` names it. */
export function toCoinAsk(w: CoinAskWire): CoinAsk {
  return w.item === 'unit' ? { kind: 'unit', unitId: w.unitId } : { kind: 'tier', unitId: w.unitId, track: w.track, tier: w.tier };
}
