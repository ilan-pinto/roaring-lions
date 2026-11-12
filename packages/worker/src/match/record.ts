/** The one writer of a versus record (GH-1075 A3 Task 3.4). Only this file inserts into `match_record`; the room
 *  calls it once, with a draft `recordOf` produced. W-L is not its business: every agreed record counts (ruling 1).
 *  Nothing here takes a callsign, a player id or a token, so none can be written (A3-3). */
import { encodeBotModel, type BotModel } from '@lions/net';
import type { D1Like } from '../d1';
import { OPS_ALL, RECORD_ROWS } from '../account/config';
import { countToday, dayOf } from '../rate-day';
import type { RecordDraft } from './room-core';

export interface RecordSeat { memberId: string | null; claimedBot: boolean; botModel: BotModel | null; side: string }
export interface MatchRecordInput {
  code: string;
  draft: RecordDraft;
  map: string;
  matchup: string;
  winMode: string | null;
  kit: string;
  build: string;
  seats: [RecordSeat, RecordSeat];
}
export type RecordOutcome = 'written' | 'skipped' | 'closed' | 'spent';

export async function writeMatchRecord(db: D1Like, now: number, r: MatchRecordInput): Promise<RecordOutcome> {
  if (r.seats[0].memberId === null && r.seats[1].memberId === null) return 'skipped';
  const flag = await db.prepare(`SELECT value FROM flags WHERE name = 'records'`).first<{ value: string }>();
  if (flag !== null && flag.value === 'closed') return 'closed';
  if ((await countToday(db, 'acct-all', '', now)) + RECORD_ROWS > OPS_ALL) return 'spent';
  const d = r.draft;
  const seatStmt = (seat: 0 | 1) => {
    const s = r.seats[seat];
    if (s.memberId !== null) {
      // A seat with a member is that member, never a bot, whatever kind it claimed; a member deleted mid-match is 'deleted' (§0.25).
      return db
        .prepare(
          `INSERT OR IGNORE INTO match_seat (code, started_at, seat, member_id, kind, side, bot_label)
           VALUES (?1, ?2, ?3, (SELECT id FROM member WHERE id = ?4),
                   CASE WHEN (SELECT id FROM member WHERE id = ?4) IS NULL THEN 'deleted' ELSE 'member' END, ?5, NULL)`,
        )
        .bind(r.code, d.startedAt, seat, s.memberId, s.side);
    }
    const kind = s.claimedBot ? 'bot' : 'guest';
    const label = kind === 'bot' && s.botModel !== null ? encodeBotModel(s.botModel) : null;
    return db
      .prepare(`INSERT OR IGNORE INTO match_seat (code, started_at, seat, member_id, kind, side, bot_label) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)`)
      .bind(r.code, d.startedAt, seat, kind, s.side, label);
  };
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO match_record (code, started_at, ended_at, map, matchup, win_mode, kit, reason, winner_seat, ticks, build, agreed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(r.code, d.startedAt, d.endedAt, r.map, r.matchup, r.winMode, r.kit, d.reason, d.winnerSeat, d.ticks, r.build, d.agreed ? 1 : 0),
    seatStmt(0),
    seatStmt(1),
    db
      .prepare(`INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-all', '', ?1, ?2) ON CONFLICT (scope, key, day) DO UPDATE SET n = n + ?2`)
      .bind(dayOf(now), RECORD_ROWS),
  ]);
  return 'written';
}
