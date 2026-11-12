import { describe, expect, it } from 'vitest';
import { openTestD1 } from '../test-d1';
import { ACCOUNTS_MIGRATIONS, seedWalletMember } from './test-kit';
import { memberRecord } from './seat-member';

const NOW = 1_790_000_000_000;

describe('memberRecord (GH-1075 A3)', () => {
  it('every_agreed_result_counts', async () => {
    const db = openTestD1({ dir: ACCOUNTS_MIGRATIONS });
    await seedWalletMember(db, 'A', NOW);
    await seedWalletMember(db, 'B', NOW);
    const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
    const rec = (code: string, winner: number | null, agreed: number) =>
      run("INSERT INTO match_record VALUES (?1, 1000, 2000, 'm', 'x', NULL, 'k', 'annihilation', ?2, 10, 'b', ?3)", code, winner, agreed);
    const seat = (code: string, s: number, member: string | null, kind: string, label: string | null = null) =>
      run("INSERT INTO match_seat VALUES (?1, 1000, ?2, ?3, ?4, 'kdf', ?5)", code, s, member, kind, label);
    // won v member B
    await rec('R1', 0, 1); await seat('R1', 0, 'A', 'member'); await seat('R1', 1, 'B', 'member');
    // won v guest
    await rec('R2', 0, 1); await seat('R2', 0, 'A', 'member'); await seat('R2', 1, null, 'guest');
    // won v bot, from seat 1
    await rec('R3', 1, 1); await seat('R3', 0, null, 'bot', 'id:scripted'); await seat('R3', 1, 'A', 'member');
    // lost v a deleted seat
    await rec('R4', 1, 1); await seat('R4', 0, 'A', 'member'); await seat('R4', 1, null, 'deleted');
    // drawn v guest
    await rec('R5', null, 1); await seat('R5', 0, 'A', 'member'); await seat('R5', 1, null, 'guest');
    // a lone report (agreed = 0) never counts
    await rec('R6', 0, 0); await seat('R6', 0, 'A', 'member'); await seat('R6', 1, 'B', 'member');
    expect(await memberRecord(db, 'A')).toEqual({ won: 3, lost: 1, drawn: 1 });
    expect(await memberRecord(db, 'B')).toEqual({ won: 0, lost: 1, drawn: 0 });
  });
});
