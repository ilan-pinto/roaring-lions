/**
 * The view (GH-1075 A2): what the server last confirmed, plus the ops still queued, applied in order. Pure.
 * Every read the app makes while signed in answers from this, so a write is visible at once and a response that
 * knows less than the outbox cannot take it away.
 */
import { roarEarn, ROAR_VERSION } from '@lions/economy';
import type { CampaignView, ParsedWorld, RoarWallet, ServerState, SlotMetaView, WalletView } from '@lions/economy';
import type { OutboxOp } from './outbox';

export function walletOf(v: WalletView): RoarWallet {
  return { version: ROAR_VERSION, coins: { free: v.free, paid: v.paid }, entitlements: v.entitlements, earn: v.earn, receipts: v.receipts };
}

function viewOfWallet(w: RoarWallet, revision: number): WalletView {
  return { free: w.coins.free, paid: 0, entitlements: w.entitlements, earn: w.earn, receipts: w.receipts, revision };
}

const byteLength = (s: unknown): number => new TextEncoder().encode(JSON.stringify(s)).length;

function withCampaign(c: CampaignView | null, body: { ledger: CampaignView['ledger']; brigade: CampaignView['brigade']; tutorialDone: boolean }): CampaignView {
  return { ...(c ?? { revision: 0, digest: '' }), ledger: body.ledger, brigade: body.brigade, tutorialDone: body.tutorialDone };
}

function putMeta(op: Extract<OutboxOp, { kind: 'slot.put' }>): SlotMetaView {
  return { id: op.slotId, name: op.slot.name, savedAt: op.slot.savedAt, build: op.slot.build, origin: op.origin, bytes: byteLength(op.slot) };
}

export function viewOf(confirmed: ServerState, outbox: readonly OutboxOp[], world: ParsedWorld): ServerState {
  let campaign = confirmed.campaign;
  let wallet = confirmed.wallet;
  let slots = confirmed.slots;
  for (const op of outbox) {
    if (op.kind === 'campaign') {
      campaign = withCampaign(campaign, op.campaign);
    } else if (op.kind === 'victory') {
      if (op.campaign !== null) campaign = withCampaign(campaign, op.campaign);
      // `start: null` carries no nonce, so the server pays nothing: the view moves no coin (§0.48).
      if (op.start !== null) {
        const at = wallet.receipts.reduce((n, r) => Math.max(n, r.at), 0);
        const ledger = campaign?.ledger ?? {};
        // The earn record rides in the wallet, so a second queued win of one mission awards nothing.
        const earned = roarEarn(walletOf(wallet), { missionId: op.missionId, stars: op.stars, ledger }, world, at);
        if (earned.awards.length > 0) wallet = viewOfWallet(earned.wallet, wallet.revision);
      }
    } else if (op.kind === 'slot.put') {
      slots = [...slots.filter((s) => s.id !== op.slotId), putMeta(op)];
    } else {
      slots = slots.filter((s) => s.id !== op.slotId);
    }
  }
  return { campaign, wallet, slots };
}
