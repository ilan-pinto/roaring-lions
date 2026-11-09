import { canonicalCampaign, emptyAccount, type CampaignBody, type CampaignView, type ServerState } from '@lions/economy';
import { describe, expect, it } from 'vitest';
import { budgetedOp } from './budget';
import { isCasFailure } from './coin';
import { campaignViewOf, campaignWrite, conflictSlot, digestOf, readCampaign, stateOf } from './campaign';
import { OpReject } from './op';
import { accountHarness, ctxFor, racingD1, seedWalletMember } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY;
const op = (n: number): string => `${String(n).padStart(8, '0')}-4444-4444-8444-444444444444`;
type H = ReturnType<typeof accountHarness>;

const bodyOf = (done: string[], extra: Record<string, unknown> = {}): CampaignBody => ({
  ledger: { 'campaign.completed_missions': done, ...extra } as CampaignBody['ledger'],
  brigade: emptyAccount(),
  tutorialDone: true,
});
const revisionOf = async (h: H): Promise<number | null> =>
  (await h.db.prepare("SELECT revision FROM campaign_state WHERE member_id = 'm1'").first<{ revision: number }>())?.revision ?? null;

describe('campaignWrite', () => {
  it('two first writes race: one wins with revision 1, the other is stale, never 500 (A2 §0.34)', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    const raced = racingD1(h.db, 2, { match: /FROM campaign_state/ });
    const ctx = ctxFor({ ...h.env, ACCOUNTS: raced }, T0);
    // The test-only build R1 describes: base 0 means no row; a base that no longer matches is a stale 409.
    const put = (n: number, body: CampaignBody) =>
      budgetedOp(ctx, { memberId: 'm1', opId: op(n), kind: 'campaign.put' }, async () => {
        const cur = await readCampaign(raced, 'm1');
        if ((cur?.revision ?? 0) !== 0) {
          return { statements: [], status: 409, response: { error: 'stale', campaign: await campaignViewOf(cur as NonNullable<typeof cur>) } };
        }
        const view: CampaignView = { ...JSON.parse(canonicalCampaign(body)) as CampaignBody, revision: 1, digest: await digestOf(canonicalCampaign(body)) };
        return { statements: await campaignWrite(raced, 'm1', null, body, T0), status: 200, response: { campaign: view } };
      });
    const [a, b] = await Promise.all([put(1, bodyOf(['a'])), put(2, bodyOf(['b']))]);
    expect(raced.opened()).toBe(true);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? a : b;
    const lost = a.status === 200 ? b : a;
    expect((won.body as { campaign: CampaignView }).campaign.revision).toBe(1);
    expect((lost.body as { error: string }).error).toBe('stale');
    expect(await revisionOf(h)).toBe(1);

    // A stored 409 replays as a 409, and holds { revision, digest }, never the campaign's ledger.
    const loserOp = a.status === 200 ? op(2) : op(1);
    const again = await budgetedOp(ctx, { memberId: 'm1', opId: loserOp, kind: 'campaign.put' }, async () => { throw new Error('a stored answer must not rebuild'); });
    expect(again.status).toBe(409);
    const stored = (await h.db.prepare('SELECT response FROM account_op WHERE op_id = ?1').bind(loserOp).first<{ response: string }>())?.response ?? '';
    const parsed = JSON.parse(stored) as { s: number; b: { campaign: Record<string, unknown> } };
    expect(parsed.s).toBe(409);
    expect(Object.keys(parsed.b.campaign).sort()).toEqual(['digest', 'revision']);
    expect(stored).not.toContain('completed_missions');
  });

  it('a stale guarded update throws and leaves the revision; a current one lands', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    await h.db.batch(await campaignWrite(h.db, 'm1', null, bodyOf(['a']), T0));
    expect(await revisionOf(h)).toBe(1);
    const mine = await campaignWrite(h.db, 'm1', 1, bodyOf(['a', 'b']), T0 + 1);
    await h.db.batch(await campaignWrite(h.db, 'm1', 1, bodyOf(['a', 'c']), T0 + 1));
    expect(await revisionOf(h)).toBe(2);
    let caught: unknown = null;
    await h.db.batch(mine).catch((e: unknown) => { caught = e; });
    expect(isCasFailure(caught)).toBe(true);
    expect(await revisionOf(h)).toBe(2);
    const cur = await readCampaign(h.db, 'm1');
    expect(cur?.body.ledger['campaign.completed_missions']).toEqual(['a', 'c']);
  });

  it('a body over 262,144 canonical bytes refuses 413 and writes nothing', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    const big = bodyOf(['a'], { 'x.unknown': 'z'.repeat(262_200) });
    await expect(campaignWrite(h.db, 'm1', null, big, T0)).rejects.toMatchObject({ status: 413, body: { error: 'too_large' } });
    await expect(campaignWrite(h.db, 'm1', null, big, T0)).rejects.toBeInstanceOf(OpReject);
    expect(await revisionOf(h)).toBeNull();
    const edge = bodyOf(['a'], { 'x.unknown': 'z'.repeat(262_144 - canonicalCampaign(bodyOf(['a'], { 'x.unknown': '' })).length) });
    expect(new TextEncoder().encode(canonicalCampaign(edge)).length).toBe(262_144);
    await h.db.batch(await campaignWrite(h.db, 'm1', null, edge, T0));
    expect(await revisionOf(h)).toBe(1);
  });
});

describe('conflictSlot', () => {
  it('stores a system slot while fewer than 4 exist, then answers held with no statement; the guard rides along (R3)', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    for (let i = 0; i < 4; i++) {
      const c = await conflictSlot(h.db, 'm1', bodyOf([`m${i}`]), T0 + i, i % 2 === 0 ? 'conflict' : 'claim');
      expect(c.answer).toHaveProperty('slot');
      expect(c.statements).toHaveLength(2);
      await h.db.batch(c.statements);
    }
    const held = await conflictSlot(h.db, 'm1', bodyOf(['x']), T0, 'conflict');
    expect(held).toEqual({ statements: [], answer: { held: true } });

    // The guard is what stops two parallel requests that both read 3: a fifth slot forced in by hand rolls back.
    const h2 = accountHarness({ now: T0 });
    await seedWalletMember(h2.db, 'm1', T0);
    const racers = await Promise.all([0, 1, 2, 3, 4].map((i) => conflictSlot(h2.db, 'm1', bodyOf([`r${i}`]), T0, 'conflict')));
    const results = await Promise.all(racers.map((r) => h2.db.batch(r.statements).then(() => 'ok', () => 'cap')));
    expect(results.filter((r) => r === 'ok')).toHaveLength(4);
    expect((await h2.db.prepare('SELECT COUNT(*) AS n FROM save_slot').first<{ n: number }>())?.n).toBe(4);
  });
});

describe('GET state and GET slots/:id', () => {
  it('answers the campaign with its digest, the wallet with receipts, slot metadata without bodies; another member 404s', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 5 });
    await seedWalletMember(h.db, 'm2', T0);
    const body = bodyOf(['a', 'b']);
    await h.db.batch(await campaignWrite(h.db, 'm1', null, body, T0));
    const receipt = { kind: 'earn', id: 'r1', at: T0, coins: { free: 5, paid: 0 }, source: 'first_win' };
    await h.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'earn', 0, ?2, 'o2')").bind(T0, JSON.stringify({ receipt })).run();
    const c = await conflictSlot(h.db, 'm1', bodyOf(['z']), T0 + 7, 'conflict');
    await h.db.batch(c.statements);
    const slotId = (c.answer as { slot: { id: string } }).slot.id;
    await h.db.prepare("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, body, bytes) VALUES ('m2', 'theirs', 'T', 1, 'b', '{}', 2)").run();

    const res = await h.call('GET', '/api/account/state', { cookie });
    expect(res.status).toBe(200);
    const st = await res.json() as ServerState;
    expect(st.campaign?.revision).toBe(1);
    expect(st.campaign?.digest).toBe(await digestOf(canonicalCampaign(body)));
    expect(st.campaign?.ledger['campaign.completed_missions']).toEqual(['a', 'b']);
    expect(st.wallet.free).toBe(5);
    expect(st.wallet.receipts).toEqual([receipt]);
    expect(st.slots).toHaveLength(1);
    expect(st.slots[0]).toEqual({ id: slotId, name: 'conflict', savedAt: T0 + 7, build: 'server', origin: 'conflict', bytes: expect.any(Number) as number });
    expect(JSON.stringify(st.slots)).not.toContain('ledger');
    expect(await stateOf(h.db, 'm1')).toEqual(st);

    const one = await h.call('GET', `/api/account/slots/${slotId}`, { cookie });
    expect(one.status).toBe(200);
    const got = await one.json() as { slot: { id: string }; body: { ledger: Record<string, unknown> } };
    expect(got.slot.id).toBe(slotId);
    expect(got.body.ledger['campaign.completed_missions']).toEqual(['z']);
    expect((await h.call('GET', '/api/account/slots/theirs', { cookie })).status).toBe(404);
    expect((await h.call('GET', '/api/account/state')).status).toBe(401);
  });

  it('a member with no campaign answers null', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    const st = await (await h.call('GET', '/api/account/state', { cookie })).json() as ServerState;
    expect(st.campaign).toBeNull();
    expect(st.slots).toEqual([]);
  });
});
