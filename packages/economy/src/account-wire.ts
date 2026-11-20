/**
 * The wire contract of the account routes (GH-1075 A2): types only, imported by the app's
 * account client and by the Worker's routes, so the two cannot drift. Every write body carries
 * `op_id` (a UUID, `validOpId`). `toCoinAsk` is the one converter to `stores.ts`'s `CoinAsk`.
 */
import type { BranchPick } from './branches';
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
/** `branch` (GH-1384) names the branch of a BRANCHED tier and is absent on every other ask: the server reads it only while branching is open. */
export type CoinAskWire = { item: 'unit'; unitId: string } | { item: 'tier'; unitId: string; track: string; tier: number; branch?: BranchPick };

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
  return w.item === 'unit'
    ? { kind: 'unit', unitId: w.unitId }
    : { kind: 'tier', unitId: w.unitId, track: w.track, tier: w.tier, ...(w.branch !== undefined ? { branch: w.branch } : {}) };
}

// GH-1075 A3: `GET /api/account/matches`. The opponent's name is read NOW (a rename follows, §5.3).
export type MatchBotModel = { id: string } | { id: 'other'; name: string };
export type MatchOpponent =
  | { kind: 'member'; name: string; publicId: string }
  | { kind: 'guest' }
  | { kind: 'bot'; model: MatchBotModel | null }
  | { kind: 'deleted' };
export interface MatchView {
  code: string;
  startedAt: number;
  endedAt: number;
  map: string;
  matchup: string;
  winMode: string | null;
  kit: string;
  reason: string;
  /** The winning seat, or null for a draw. */
  winnerSeat: 0 | 1 | null;
  ticks: number;
  /** False: a lone report, listed but never counted in `record`. */
  agreed: boolean;
  /** The member's own seat. */
  seat: 0 | 1;
  side: string;
  opponent: MatchOpponent;
}
export interface MatchesView {
  matches: MatchView[];
  /** The `before` of the next page (opaque: `<started_at>.<code>`), or null on the last. */
  next: string | null;
  record: { won: number; lost: number; drawn: number };
}

// GH-1370 C1: `GET /api/account/coins`. The member's own coin journal, picked field by field; wording is the app's.
export type CoinWhat =
  | { kind: 'earn'; source: string; missionId?: string }
  | { kind: 'move' }
  | { kind: 'unit'; unitId: string; moved: boolean }
  /** `refund` (GH-1384, Q4): a Return of a legacy tier 3, journalled as a `tier` row with a positive delta. Absent on a purchase. */
  | { kind: 'tier'; unitId: string; track: string; tier: number; moved: boolean; refund?: true }
  | { kind: 'coupon' }
  | { kind: 'reset' }
  | { kind: 'team'; note?: string }
  | { kind: 'other' };
export interface CoinRowView {
  at: number;
  delta: number;
  what: CoinWhat;
}
export interface CoinsView {
  rows: CoinRowView[];
  /** The `before` of the next page (the last row's journal id), or null on the last. */
  next: string | null;
}
