import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BotModel } from '@lions/net';
import { OPS_ALL } from '../account/config';
import { ACCOUNTS_MIGRATIONS, recordingD1 as recording, seedWalletMember } from '../account/test-kit';
import { memberRecord } from '../account/seat-member';
import { dayOf } from '../rate-day';
import { openTestD1 } from '../test-d1';
import { writeMatchRecord, type MatchRecordInput, type RecordSeat } from './record';

const NOW = 1_790_000_000_000;
const draft = { startedAt: 1000, endedAt: 9000, reason: 'annihilation' as const, winnerSeat: 0 as const, ticks: 400, agreed: true };
const member = (memberId: string, side = 'kdf'): RecordSeat => ({ memberId, claimedBot: false, botModel: null, side });
const guest = (side = 'sarim'): RecordSeat => ({ memberId: null, claimedBot: false, botModel: null, side });
const bot = (botModel: BotModel | null, side = 'sarim'): RecordSeat => ({ memberId: null, claimedBot: true, botModel, side });
const input = (seats: [RecordSeat, RecordSeat], over: Partial<MatchRecordInput> = {}): MatchRecordInput => ({
  code: 'ABCDEF', draft, map: 'tel_marum', matchup: 'kdf-sarim', winMode: null, kit: 'matched', build: 'b1', seats, ...over,
});

async function world() {
  const db = openTestD1({ dir: ACCOUNTS_MIGRATIONS, foreignKeys: true });
  await seedWalletMember(db, 'A', NOW);
  await seedWalletMember(db, 'B', NOW);
  return db;
}
const seats = (db: ReturnType<typeof openTestD1>) =>
  db.raw.prepare('SELECT seat, member_id, kind, side, bot_label FROM match_seat ORDER BY code, seat').all();
const count = (db: ReturnType<typeof openTestD1>, table: string): number =>
  (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const acctAll = (db: ReturnType<typeof openTestD1>): number =>
  (db.raw.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM rate_day WHERE scope = 'acct-all'").get() as { n: number }).n;

describe('writeMatchRecord (GH-1075 A3 Task 3.4)', () => {
  it('nothing_identifies_a_guest (the writer half): no bound value carries a guest identifier, and a stray model never reaches a guest row', async () => {
    const raw = await world();
    const { db, bound } = recording(raw);
    const stray = { id: 'other', name: 'ZZ-SENTINEL-MODEL' } as const;
    const g: RecordSeat = { memberId: null, claimedBot: false, botModel: stray, side: 'sarim' };
    expect(await writeMatchRecord(db, NOW, input([member('A'), g]))).toBe('written');
    expect(seats(raw)[1]).toEqual({ seat: 1, member_id: null, kind: 'guest', side: 'sarim', bot_label: null });
    expect(JSON.stringify(bound)).not.toContain('ZZ-SENTINEL-MODEL');
    const dump = JSON.stringify([raw.raw.prepare('SELECT * FROM match_record').all(), raw.raw.prepare('SELECT * FROM match_seat').all()]);
    expect(dump).not.toContain('ZZ-SENTINEL-MODEL');
  });

  it('the_declared_model_is_stored_on_the_bot_row', async () => {
    const run = async (model: BotModel | null) => {
      const db = await world();
      expect(await writeMatchRecord(db, NOW, input([member('A'), bot(model)]))).toBe('written');
      return seats(db) as { kind: string; bot_label: string | null }[];
    };
    const typed = await run({ id: 'other', name: 'MyNet v3' });
    expect(typed[1]).toMatchObject({ kind: 'bot', bot_label: 'other:MyNet v3' });
    expect(typed[0]).toMatchObject({ kind: 'member', bot_label: null });
    const listed = await run({ id: 'claude-opus-5-5' });
    expect(listed[1]).toMatchObject({ kind: 'bot', bot_label: 'id:claude-opus-5-5' });
    expect(listed[0].bot_label).toBeNull();
    const none = await run(null);
    expect(none[1]).toMatchObject({ kind: 'bot', bot_label: null });
    expect(none[0].bot_label).toBeNull();
  });

  it('a_seat_with_a_member_is_never_a_bot (Task 3.3 review): a member claiming bot is recorded as the member, with no label', async () => {
    const db = await world();
    const claimsBot: RecordSeat = { memberId: 'B', claimedBot: true, botModel: { id: 'other', name: 'ZZ-SENTINEL-MODEL' }, side: 'sarim' };
    expect(await writeMatchRecord(db, NOW, input([member('A'), claimsBot]))).toBe('written');
    expect(seats(db)).toEqual([
      { seat: 0, member_id: 'A', kind: 'member', side: 'kdf', bot_label: null },
      { seat: 1, member_id: 'B', kind: 'member', side: 'sarim', bot_label: null },
    ]);
    expect(await memberRecord(db, 'B')).toEqual({ won: 0, lost: 1, drawn: 0 });
  });

  it('every_agreed_result_counts: a win over a guest and over a bot reads won 2', async () => {
    const db = await world();
    await writeMatchRecord(db, NOW, input([member('A'), guest()], { code: 'AAAAAA' }));
    await writeMatchRecord(db, NOW, input([member('A'), bot(null)], { code: 'BBBBBB' }));
    expect(await memberRecord(db, 'A')).toEqual({ won: 2, lost: 0, drawn: 0 });
  });

  it('bot_v_bot_writes_nothing (A3-6)', async () => {
    const db = await world();
    expect(await writeMatchRecord(db, NOW, input([bot(null, 'kdf'), bot(null)]))).toBe('skipped');
    expect(count(db, 'match_record')).toBe(0);
    expect(count(db, 'match_seat')).toBe(0);
    expect(await writeMatchRecord(db, NOW, input([guest('kdf'), guest()]))).toBe('skipped');
    expect(count(db, 'match_record')).toBe(0);
    expect(acctAll(db)).toBe(0);
  });

  it('a_member_deleted_mid_match (§0.25)', async () => {
    const db = await world();
    db.raw.exec("DELETE FROM member WHERE id = 'A'");
    expect(await writeMatchRecord(db, NOW, input([member('A'), member('B', 'sarim')]))).toBe('written');
    expect(count(db, 'match_record')).toBe(1);
    expect(seats(db)).toEqual([
      { seat: 0, member_id: null, kind: 'deleted', side: 'kdf', bot_label: null },
      { seat: 1, member_id: 'B', kind: 'member', side: 'sarim', bot_label: null },
    ]);
  });

  it('written_once: the same draft written twice leaves one record and two seats', async () => {
    const db = await world();
    expect(await writeMatchRecord(db, NOW, input([member('A'), guest()]))).toBe('written');
    expect(await writeMatchRecord(db, NOW, input([member('A'), guest()]))).toBe('written');
    expect(count(db, 'match_record')).toBe(1);
    expect(count(db, 'match_seat')).toBe(2);
  });

  it('the_breaker: flags.records closed writes nothing; a spent day writes nothing and bumps nothing', async () => {
    const closed = await world();
    closed.raw.exec("INSERT INTO flags (name, value, updated_at) VALUES ('records', 'closed', 1)");
    expect(await writeMatchRecord(closed, NOW, input([member('A'), guest()]))).toBe('closed');
    expect(count(closed, 'match_record')).toBe(0);
    expect(count(closed, 'match_seat')).toBe(0);
    // any other value is open
    closed.raw.exec("UPDATE flags SET value = 'open' WHERE name = 'records'");
    expect(await writeMatchRecord(closed, NOW, input([member('A'), guest()]))).toBe('written');

    const spent = await world();
    spent.raw.prepare("INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-all', '', ?1, ?2)").run(dayOf(NOW), OPS_ALL - 3);
    expect(await writeMatchRecord(spent, NOW, input([member('A'), guest()]))).toBe('spent');
    expect(count(spent, 'match_record')).toBe(0);
    expect(acctAll(spent)).toBe(OPS_ALL - 3);
    // exactly room for one more: it writes, and the counter reaches the cap
    spent.raw.prepare("UPDATE rate_day SET n = ?1 WHERE scope = 'acct-all'").run(OPS_ALL - 4);
    expect(await writeMatchRecord(spent, NOW, input([member('A'), guest()]))).toBe('written');
    expect(acctAll(spent)).toBe(OPS_ALL);
  });

  it('one_record_writer: only record.ts inserts into match_record', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && n !== 'test-kit.ts') files.push(p);   // test-kit.ts seeds fixtures, tests only
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(30);
    const offenders = files.filter((f) => /INSERT\s+(OR\s+\w+\s+)?INTO\s+match_record/i.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual(['match/record.ts']);
  });

  it('versus_pays_nothing (A3-7, the source half): the match sources never name the economy', () => {
    const dir = join(__dirname);
    const files = readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const word of ['@lions/economy', 'wallet', 'coin_journal']) expect(src.includes(word), `${f} names ${word}`).toBe(false);
    }
  });
});
