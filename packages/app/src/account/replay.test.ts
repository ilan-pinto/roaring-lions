import { describe, expect, it } from 'vitest';
import { emptyAccount } from '@lions/economy';
import { worldMissionIds } from '@lions/economy';
import type { BrigadeAccount } from '@lions/economy';
import type { OutboxOp } from './outbox';
import { viewOf } from './replay';
import { confirmedState, slotOf, world } from './fixtures';

const A: BrigadeAccount = { ...emptyAccount(), unlocks: ['purchase_a'] };
const B: BrigadeAccount = { ...emptyAccount(), unlocks: ['purchase_a', 'purchase_b'] };
const mission = worldMissionIds(world)[0] ?? '';
const camp = (brigade: BrigadeAccount): OutboxOp => ({ kind: 'campaign', opId: 'c1', campaign: { ledger: {}, brigade, tutorialDone: false } });

describe('viewOf', () => {
  it('the_view_is_confirmed_plus_queued (A2-17, pure half)', () => {
    const confirmed = confirmedState();
    confirmed.campaign = { ...confirmed.campaign!, brigade: A };
    const queued = camp(B);
    expect(viewOf(confirmed, [queued], world).campaign?.brigade.unlocks).toEqual(['purchase_a', 'purchase_b']);
    // A response that knows only A, with B still queued, still shows B.
    const refreshed = confirmedState();
    refreshed.campaign = { ...refreshed.campaign!, brigade: A, revision: 9 };
    const v = viewOf(refreshed, [queued], world);
    expect(v.campaign?.brigade.unlocks).toContain('purchase_b');
    expect(v.campaign?.revision).toBe(9);
  });

  it('two_queued_wins_award_once (§0.48)', () => {
    const win = (opId: string): OutboxOp => ({ kind: 'victory', opId, missionId: mission, stars: 2, start: 'nonce', campaign: null });
    const one = viewOf(confirmedState(), [win('v1')], world);
    const two = viewOf(confirmedState(), [win('v1'), win('v2')], world);
    expect(one.wallet.free).toBe(120);
    expect(two.wallet.free).toBe(120);
    expect(two.wallet.earn.missions[mission]).toEqual({ won: true, stars: 2 });
  });

  it('a victory with start null changes no coin but still carries its campaign', () => {
    const v = viewOf(confirmedState(), [{ kind: 'victory', opId: 'v', missionId: mission, stars: 3, start: null, campaign: { ledger: { 'campaign.completed_missions': [mission] }, brigade: A, tutorialDone: false } }], world);
    expect(v.wallet.free).toBe(0);
    expect(v.campaign?.brigade.unlocks).toEqual(['purchase_a']);
  });

  it('slot ops edit the slot list', () => {
    const confirmed = confirmedState({ slots: [{ id: 's1', name: 'old', savedAt: 1, build: 'b', origin: 'player', bytes: 10 }] });
    const put: OutboxOp = { kind: 'slot.put', opId: 'p', slotId: 's2', slot: slotOf('s2', 'new'), origin: 'player' };
    expect(viewOf(confirmed, [put], world).slots.map((s) => s.id)).toEqual(['s1', 's2']);
    const del: OutboxOp = { kind: 'slot.delete', opId: 'd', slotId: 's1' };
    expect(viewOf(confirmed, [put, del], world).slots.map((s) => s.id)).toEqual(['s2']);
  });
});
