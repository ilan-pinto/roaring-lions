import { canonicalSlot, emptyAccount, SAVE_VERSION, type SaveSlot } from '@lions/economy';
import { describe, expect, it } from 'vitest';
import { digestOf } from './campaign';
import { accountHarness, racingD1, seedWalletMember, swappableHarness } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY;
const op = (n: number): string => `${String(n).padStart(8, '0')}-6666-4666-8666-666666666666`;
let seq = 100;
const nextOp = (): string => op(seq++);

const slotOf = (id: string, savedAt = 5): SaveSlot => ({
  version: SAVE_VERSION,
  id,
  name: 'n',
  savedAt,
  build: 'b1',
  ledger: { 'campaign.completed_missions': ['a'] } as SaveSlot['ledger'],
  account: emptyAccount(),
  tutorialDone: true,
});
const putBody = (id: string, extra: Record<string, unknown> = {}) => ({ op_id: nextOp(), name: 'My slot', savedAt: 5, build: 'b1', body: slotOf(id), ...extra });

const swappable = (clock: { t: number }) => swappableHarness(T0, clock);
const countRows = async (h: ReturnType<typeof accountHarness>) =>
  (await h.db.prepare('SELECT COUNT(*) AS n FROM save_slot').first<{ n: number }>())?.n ?? 0;
const seedPlayer = async (h: ReturnType<typeof accountHarness>, n: number) => {
  for (let i = 0; i < n; i++) {
    await h.db.prepare("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, origin, body, bytes) VALUES ('m1', ?1, 'x', 1, 'b', 'player', '{}', 2)").bind(`p${i}`).run();
  }
};

describe('PUT / DELETE slots/:id', () => {
  it('the answer digest is the digest of the canonical slot the server stores (A2-10 carry)', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    const body = putBody('s1', { savedAt: 77, build: 'bX' });
    (body.body as SaveSlot).savedAt = 77;
    (body.body as SaveSlot).build = 'bX';
    const res = await h.call('PUT', '/api/account/slots/s1', { cookie, body });
    expect(res.status).toBe(200);
    const { slot } = (await res.json()) as { slot: { digest: string; savedAt: number; origin: string } };
    expect(slot.digest).toBe(await digestOf(canonicalSlot(body.body as SaveSlot)));
    expect(slot.origin).toBe('player');
    // The column is the server's time, not the client's 77.
    expect(slot.savedAt).toBe(T0);
    const row = await h.db.prepare("SELECT body FROM save_slot WHERE slot_id = 's1'").first<{ body: string }>();
    expect(await digestOf(canonicalSlot(JSON.parse(row?.body ?? '{}') as SaveSlot))).toBe(slot.digest);
  });

  it('a replace with the same client savedAt still shows a new change token (§0.44)', async () => {
    const clock = { t: T0 };
    const { h } = swappable(clock);
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    const a = (await (await h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1') })).json()) as { slot: { savedAt: number } };
    // Same server clock reading: the write is still strictly newer than the row it replaces.
    const b = (await (await h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1') })).json()) as { slot: { savedAt: number } };
    expect(b.slot.savedAt).toBeGreaterThan(a.slot.savedAt);
    clock.t = T0 + 5000;
    const c = (await (await h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1') })).json()) as { slot: { savedAt: number } };
    expect(c.slot.savedAt).toBe(T0 + 5000);
  });

  it('caps: the 13th player slot answers cap, replacing slot 12 does not; claim is 400; names', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    await seedPlayer(h, 11);
    expect((await h.call('PUT', '/api/account/slots/new12', { cookie, body: putBody('new12') })).status).toBe(200);
    const thirteenth = await h.call('PUT', '/api/account/slots/new13', { cookie, body: putBody('new13') });
    expect(thirteenth.status).toBe(409);
    expect(await thirteenth.json()).toEqual({ error: 'cap' });
    expect((await h.call('PUT', '/api/account/slots/new12', { cookie, body: putBody('new12') })).status).toBe(200);
    expect(await countRows(h)).toBe(12);

    expect((await h.call('PUT', '/api/account/slots/c1', { cookie, body: putBody('c1', { origin: 'claim' }) })).status).toBe(400);
    expect((await h.call('PUT', '/api/account/slots/c2', { cookie, body: putBody('c2', { origin: 'conflict' }) })).status).toBe(200);

    const emoji21 = '😀'.repeat(21);
    expect((await h.call('PUT', '/api/account/slots/e1', { cookie, body: putBody('e1', { name: emoji21 }) })).status).toBe(409); // cap, not name: 12 players held
    await h.db.prepare("DELETE FROM save_slot WHERE slot_id = 'p0'").run();
    expect((await h.call('PUT', '/api/account/slots/e1', { cookie, body: putBody('e1', { name: emoji21 }) })).status).toBe(200);
    expect((await h.call('PUT', '/api/account/slots/e2', { cookie, body: putBody('e2', { name: 'a'.repeat(64) }) })).status).toBe(409);
    const long = await h.call('PUT', '/api/account/slots/e3', { cookie, body: putBody('e3', { name: '😀'.repeat(65) }) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'name' });
    for (const bad of ['a\u0000b', 'a‮b', '']) {
      expect((await h.call('PUT', '/api/account/slots/e4', { cookie, body: putBody('e4', { name: bad }) })).status).toBe(400);
    }
  });

  it('the slot cap holds under a race', async () => {
    const clock = { t: T0 };
    const { h, use } = swappable(clock);
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    await seedPlayer(h, 11);
    const raced = racingD1(h.db, 2, { arrivals: true });
    use(raced);
    const [a, b] = await Promise.all([
      h.call('PUT', '/api/account/slots/ra', { cookie, body: putBody('ra') }),
      h.call('PUT', '/api/account/slots/rb', { cookie, body: putBody('rb') }),
    ]);
    expect(raced.opened()).toBe(true);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const lost = a.status === 409 ? a : b;
    expect(await lost.json()).toEqual({ error: 'cap' });
    expect(await countRows(h)).toBe(12);
  });

  it('delete: another member\'s slot is 404 and survives; own slot goes', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    await seedWalletMember(h.db, 'm2', T0);
    await h.db.prepare("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, body, bytes) VALUES ('m2', 'theirs', 'T', 1, 'b', '{}', 2)").run();
    expect((await h.call('DELETE', '/api/account/slots/theirs', { cookie, body: { op_id: nextOp() } })).status).toBe(404);
    expect(await countRows(h)).toBe(1);
    await h.call('PUT', '/api/account/slots/mine', { cookie, body: putBody('mine') });
    expect(await countRows(h)).toBe(2);
    const del = await h.call('DELETE', '/api/account/slots/mine', { cookie, body: { op_id: nextOp() } });
    expect([del.status, await del.json()]).toEqual([200, { ok: true }]);
    expect(await countRows(h)).toBe(1);
  });
});

describe('PUT slots/:id fix round 1 (R18)', () => {
  const colOf = async (h: ReturnType<typeof accountHarness>, id: string) =>
    h.db.prepare('SELECT saved_at, origin, body FROM save_slot WHERE slot_id = ?1').bind(id).first<{ saved_at: number; origin: string; body: string }>();
  const seedSystem = async (h: ReturnType<typeof accountHarness>, n: number) => {
    for (let i = 0; i < n; i++) {
      await h.db.prepare("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, origin, body, bytes) VALUES ('m1', ?1, 'x', 1, 'b', ?2, '{}', 2)").bind(`s${i}`, i % 2 === 0 ? 'conflict' : 'claim').run();
    }
  };

  it('stores the body\'s own savedAt and build; the answer digest is the digest of the body alone', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    const inner = { ...slotOf('s1', 77), build: 'bX' };
    const res = await h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1', { savedAt: 77, build: 'bX', body: inner }) });
    expect(res.status).toBe(200);
    const { slot } = (await res.json()) as { slot: { digest: string; build: string } };
    expect(slot.digest).toBe(await digestOf(canonicalSlot(inner)));
    expect(slot.build).toBe('bX');
    const stored = JSON.parse((await colOf(h, 's1'))?.body ?? '{}') as SaveSlot;
    expect([stored.savedAt, stored.build]).toEqual([77, 'bX']);
  });

  it('a top-level savedAt or build that differs from the body\'s is 400 invalid, and nothing is written', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    for (const extra of [{ savedAt: 6 }, { build: 'other' }]) {
      const res = await h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1', extra) });
      expect([res.status, await res.json()]).toEqual([400, { error: 'invalid' }]);
    }
    expect(await countRows(h)).toBe(0);
  });

  it('system slots: a new conflict past 4 is cap, replacing one at 4 is fine', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    await seedSystem(h, 4);
    const attempt = putBody('c5', { origin: 'conflict' });
    const fifth = await h.call('PUT', '/api/account/slots/c5', { cookie, body: attempt });
    expect([fifth.status, await fifth.json()]).toEqual([409, { error: 'cap' }]);
    expect(await countRows(h)).toBe(4);
    // The pre-check logs its refusal under the op id, so a retry replays it even after room opens; the guard alone would not.
    await h.db.prepare("DELETE FROM save_slot WHERE slot_id = 's1'").run();
    expect((await h.call('PUT', '/api/account/slots/c5', { cookie, body: attempt })).status).toBe(409);
    expect(await countRows(h)).toBe(3);
    await h.db.prepare("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, origin, body, bytes) VALUES ('m1', 's1', 'x', 1, 'b', 'claim', '{}', 2)").run();
    const replace = await h.call('PUT', '/api/account/slots/s0', { cookie, body: putBody('s0', { origin: 'conflict' }) });
    expect(replace.status).toBe(200);
    expect(await countRows(h)).toBe(4);
  });

  it('the system slot cap holds under a race', async () => {
    const clock = { t: T0 };
    const { h, use } = swappable(clock);
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    await seedSystem(h, 3);
    const raced = racingD1(h.db, 2, { arrivals: true });
    use(raced);
    const [a, b] = await Promise.all([
      h.call('PUT', '/api/account/slots/ra', { cookie, body: putBody('ra', { origin: 'conflict' }) }),
      h.call('PUT', '/api/account/slots/rb', { cookie, body: putBody('rb', { origin: 'conflict' }) }),
    ]);
    expect(raced.opened()).toBe(true);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await countRows(h)).toBe(4);
  });

  it('a replace may not change the slot\'s origin, either way', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    await seedSystem(h, 2); // s0 conflict, s1 claim
    await seedPlayer(h, 1); // p0 player
    for (const [id, origin] of [['s0', 'player'], ['s1', 'player'], ['p0', 'conflict']] as const) {
      const res = await h.call('PUT', `/api/account/slots/${id}`, { cookie, body: putBody(id, { origin }) });
      expect([id, res.status, await res.json()]).toEqual([id, 400, { error: 'invalid' }]);
    }
    expect([(await colOf(h, 's0'))?.origin, (await colOf(h, 's1'))?.origin, (await colOf(h, 'p0'))?.origin]).toEqual(['conflict', 'claim', 'player']);
    expect((await colOf(h, 'p0'))?.saved_at).toBe(1);
  });

  it('saved_at strictly grows on a frozen clock, in the column and not just the answer', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      await h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1') });
      seen.push((await colOf(h, 's1'))?.saved_at ?? 0);
    }
    expect(seen).toEqual([T0, T0 + 1, T0 + 2]);
  });

  it('two replaces that both read the same row still end on a strictly newer token each (SQL, not the read)', async () => {
    const clock = { t: T0 };
    const { h, use } = swappable(clock);
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    await h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1') });
    const raced = racingD1(h.db, 2, { arrivals: true });
    use(raced);
    const [a, b] = await Promise.all([
      h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1') }),
      h.call('PUT', '/api/account/slots/s1', { cookie, body: putBody('s1') }),
    ]);
    expect(raced.opened()).toBe(true);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await colOf(h, 's1'))?.saved_at).toBe(T0 + 2);
  });
});
