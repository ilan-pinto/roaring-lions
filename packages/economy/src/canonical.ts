/**
 * Canonical forms (GH-1075 A2): one string for one campaign or slot, however it was stored, so a
 * digest compares content and not formatting. Strings only; the digest is the caller's, through
 * Web Crypto. `canonicalSlot` never covers `id` or `name`, which the server may rewrite (§0.43).
 */
import { migrateAccount } from './brigade';
import type { CampaignBody } from './account-wire';
import { sanitiseLedger } from './ledger-shape';
import { completedOf, parseSlot, type SaveSlot } from './slot';

export function canonicalCampaign(b: CampaignBody): string {
  return JSON.stringify({
    ledger: sanitiseLedger(b.ledger),
    brigade: migrateAccount(b.brigade, completedOf(b.ledger)),
    tutorialDone: b.tutorialDone === true,
  });
}

export function canonicalSlot(s: SaveSlot): string {
  const p = parseSlot(JSON.stringify(s));
  return JSON.stringify({ savedAt: p.savedAt, build: p.build, ledger: p.ledger, account: p.account, tutorialDone: p.tutorialDone });
}
