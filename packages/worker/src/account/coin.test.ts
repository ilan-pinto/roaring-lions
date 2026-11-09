import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { budgetedOp } from './budget';
import { asRoar, capGuard, isCapFailure, isCasFailure, readWallet, receiptsOf, walletView, walletWrite, type JournalEntry } from './coin';
import { accountHarness, ctxFor, seedWalletMember } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY;
const op = (n: number): string => `${String(n).padStart(8, '0')}-3333-4333-8333-333333333333`;
type H = ReturnType<typeof accountHarness>;

const entry = (delta: number, opId = op(1)): JournalEntry => ({ kind: 'earn', delta, receipt: null, detail: { source: 'test' }, opId, at: T0 });
async function moveTo(h: H, free: number, j: JournalEntry[]) {
  const before = await readWallet(h.db, 'm1');
  const roar = asRoar(before, []);
  roar.coins.free = free;
  return { before, statements: walletWrite(h.db, before, { roar, earnLifetime: before.earnLifetime }, j) };
}
const freeOf = async (h: H): Promise<number> => (await h.db.prepare('SELECT free FROM wallet').first<{ free: number }>())?.free ?? -99;
const sumOf = async (h: H): Promise<number> => (await h.db.prepare('SELECT COALESCE(SUM(free_delta), 0) AS s FROM coin_journal').first<{ s: number }>())?.s ?? -99;

describe('walletWrite', () => {
  it("the journal entries sum to the wallet's change", async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    const ok = await moveTo(h, 135, [entry(100), entry(35)]);
    await h.db.batch(ok.statements);
    expect(await freeOf(h)).toBe(135);
    expect(await sumOf(h)).toBe(135);
    expect((await readWallet(h.db, 'm1')).revision).toBe(1);
    expect(() => walletWrite(h.db, ok.before, { roar: { ...asRoar(ok.before, []), coins: { free: 135, paid: 0 } }, earnLifetime: ok.before.earnLifetime }, [entry(100), entry(30)])).toThrow(/sums to 130/);
    expect(() => walletWrite(h.db, ok.before, { roar: { ...asRoar(ok.before, []), coins: { free: 135, paid: 0 } }, earnLifetime: ok.before.earnLifetime }, [])).toThrow();
    // Unmoved with no entries is a plain update (an entitlement-only change would be one).
    const still = await readWallet(h.db, 'm1');
    expect(() => walletWrite(h.db, still, { roar: asRoar(still, []), earnLifetime: still.earnLifetime }, [])).not.toThrow();
  });

  it('a receipt rides in detail.receipt and walletView reads the last ones back, oldest first', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    const r = (n: number) => ({ kind: 'earn' as const, id: `r${n}`, at: T0 + n, coins: { free: 10, paid: 0 }, source: 'star' as const });
    const a = await moveTo(h, 20, [{ ...entry(10), receipt: r(1) }, { ...entry(10), receipt: r(2) }]);
    await h.db.batch(a.statements);
    const b = await moveTo(h, 25, [entry(5)]);
    await h.db.batch(b.statements);
    const view = await walletView(h.db, 'm1');
    expect(view.free).toBe(25);
    expect(view.receipts.map((x) => x.id)).toEqual(['r1', 'r2']);
    expect((await receiptsOf(h.db, 'm1')).length).toBe(2);
    expect(view.revision).toBe(2);
  });

  it('a stale wallet write fails whole (A2-24 core)', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    await h.db.prepare("UPDATE wallet SET revision = 4 WHERE member_id = 'm1'").run();
    const mine = await moveTo(h, 50, [entry(50)]);
    expect(mine.before.revision).toBe(4);
    await h.db.prepare("UPDATE wallet SET revision = 5 WHERE member_id = 'm1'").run();
    let caught: unknown = null;
    await h.db.batch(mine.statements).catch((e: unknown) => { caught = e; });
    expect(caught).toBeInstanceOf(Error);
    expect(isCasFailure(caught)).toBe(true);
    expect(await freeOf(h)).toBe(0);
    expect(await sumOf(h)).toBe(0);
    expect((await readWallet(h.db, 'm1')).revision).toBe(5);
  });

  it('a real check failure is not a race', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    let builds = 0;
    const out = await budgetedOp(ctxFor(h.env, T0), { memberId: 'm1', opId: op(9), kind: 'test' }, async () => {
      builds++;
      return { ...(await moveTo(h, -5, [entry(-5)])), status: 200, response: {} };
    });
    expect(out.status).toBe(500);
    expect(builds).toBe(1);
    expect(await freeOf(h)).toBe(0);
  });
});

describe('capGuard', () => {
  it('trips past its cap', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    const slot = (n: number) => h.db.prepare("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, body, bytes) VALUES ('m1', ?1, 'S', 1, 'b', '{}', 2)").bind(`s${n}`);
    const count = "SELECT COUNT(*) FROM save_slot WHERE member_id = ?1 AND origin = 'player'";
    await h.db.batch([...Array.from({ length: 12 }, (_, i) => slot(i)), capGuard(h.db, 'm1', count, 12)]);
    let caught: unknown = null;
    await h.db.batch([slot(12), capGuard(h.db, 'm1', count, 12)]).catch((e: unknown) => { caught = e; });
    expect(caught).not.toBeNull();
    expect(isCapFailure(caught)).toBe(true);
    expect(isCasFailure(caught)).toBe(false);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM save_slot').first<{ n: number }>())?.n).toBe(12);
  });
});

describe('only coin.ts writes the wallet (A2-27, plan)', () => {
  it('UPDATE wallet and INSERT INTO coin_journal appear in coin.ts alone', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-kit.ts');
    expect(files.length).toBeGreaterThanOrEqual(20);
    const hits = (re: RegExp) => files.filter((f) => re.test(readFileSync(dir + f, 'utf8')));
    expect(hits(/UPDATE\s+wallet\b/i)).toEqual(['coin.ts']);
    expect(hits(/INSERT\s+INTO\s+coin_journal\b/i)).toEqual(['coin.ts']);
  });
});
