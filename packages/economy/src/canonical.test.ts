import { describe, expect, it } from 'vitest';
import type { LedgerData } from '@lions/sim';
import type { CampaignBody } from './account-wire';
import { emptyAccount } from './brigade';
import { canonicalCampaign, canonicalSlot } from './canonical';
import { SAVE_VERSION, type SaveSlot } from './slot';

const ledgerOf = (done: string[], extra: Record<string, unknown> = {}): LedgerData => ({ 'campaign.completed_missions': done, ...extra }) as LedgerData;
const body = (ledger: LedgerData): CampaignBody => ({ ledger, brigade: emptyAccount(), tutorialDone: true });
const slot = (id: string, name: string): SaveSlot => ({
  version: SAVE_VERSION,
  id,
  name,
  savedAt: 5,
  build: 'b1',
  ledger: ledgerOf(['m1'], { 'roster.lost': {} }),
  account: emptyAccount(),
  tutorialDone: false,
});

describe('canonical forms', () => {
  it('a cleaned ledger has one canonical form', () => {
    const dirty = body(ledgerOf(['m1'], { 'roster.lost': {} }));
    const clean = body(ledgerOf(['m1']));
    expect(canonicalCampaign(dirty)).toBe(canonicalCampaign(clean));
    expect(canonicalCampaign(body(ledgerOf(['m2'])))).not.toBe(canonicalCampaign(clean));
  });

  it('canonical forms are idempotent', () => {
    const c = body(ledgerOf(['m1'], { 'roster.lost': {} }));
    const first = canonicalCampaign(c);
    expect(canonicalCampaign(JSON.parse(first) as CampaignBody)).toBe(first);
    // The campaign form is { ledger, brigade, tutorialDone }: the same keys the body has.
    const s = slot('a', 'A');
    const sf = canonicalSlot(s);
    const parsed = JSON.parse(sf) as Omit<SaveSlot, 'version' | 'id' | 'name'>;
    expect(canonicalSlot({ ...parsed, version: SAVE_VERSION, id: 'x', name: 'y' })).toBe(sf);
    expect(canonicalSlot(slot('other', 'Other name'))).toBe(sf);
  });
});
