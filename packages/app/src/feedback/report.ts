/**
 * A report of the other player's chat (GH-1417 S3, the lead's D6): the `meta` part of a feedback note with category `report` and source
 * `match`, built to `data/schemas/feedback.schema.json` exactly as the Worker reads it (`packages/worker/src/feedback-meta.ts`).
 *
 * What it carries, and what it must not:
 * - the EVIDENCE is the reporter's own copy: the last few lines they received, in `context.lines` as `<seat>: <text>`. It is labelled
 *   unverified on the stats page, because nothing proves the other seat said it (D6; server-held lines are a v2 if forgery appears);
 * - the reporter is named by the session id alone, which the rate limit needs. NEVER a tester label, a contact or the persistent player
 *   id, and never the room code or a seat token (the context shape is closed, and the Worker refuses an extra key);
 * - the reported player is named by seat, and by `reported_public_id` only when they are a member. A guest cannot be recognised in a
 *   later room by design, and is never given an id here.
 */
import { BUILD_PATTERN, ID_PATTERN, MISSION_PATTERN } from '@lions/data/telemetry';
import { clip, TEXT_MAX } from './meta';

export const REPORT_REASONS = ['abuse', 'hate', 'sexual', 'threat', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_LINES_MAX = 10;
/** The Worker refuses a report whose `context` is over this many UTF-8 bytes before it reads the shape (`feedback-meta.ts`'s
 *  `CONTEXT_MAX_BYTES`; `report.test.ts` pins the two together). Ten lines of 280 characters from a script that takes three or four
 *  bytes a character are over it, so the lines are fitted to it: the OLDEST are dropped first. */
export const REPORT_CONTEXT_MAX_BYTES = 8 * 1024;
/** A line's text, in code points (the room's own chat cap). */
export const REPORT_LINE_TEXT_MAX = 280;
const PUBLIC_ID = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001F\u007F]+/g;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const MULTILINE_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** One received line, as the inbox kept it. */
export interface ReportLine {
  seat: 0 | 1;
  text: string;
}

export interface ReportContext {
  lines: string[];
  seat: 0 | 1;
  reported_seat: 0 | 1;
  reason: ReportReason;
  reported_public_id?: string;
}

export interface ReportMeta {
  v: 1;
  t: number;
  source: 'match';
  category: 'report';
  text: string;
  build: string;
  commit?: string;
  session?: string;
  map?: string;
  mission?: string;
  context: ReportContext;
}

export interface ReportInput {
  /** The reporter's seat and the seat reported. */
  seat: 0 | 1;
  reportedSeat: 0 | 1;
  reason: ReportReason;
  /** The reporter's optional note. */
  note: string;
  /** The reporter's copy of the recent lines, oldest first. At most the last ten are sent. */
  lines: readonly ReportLine[];
  /** The reported player's public id when they are a member, else absent. */
  reportedPublicId?: string | null;
  /** The reporter's session id, from telemetry; absent under an opt-out. */
  session?: string;
  build: string;
  commit?: string;
  map?: string;
  mission?: string;
  now: number;
}

/** `<seat>: <text>`, the text on one line and at most 280 code points. A line that is empty once cleaned is dropped by the caller. */
export function reportLine(l: ReportLine): string | null {
  const text = clip(l.text.replace(CONTROL, ' ').trim(), REPORT_LINE_TEXT_MAX);
  return text === '' ? null : `${l.seat}: ${text}`;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * The newest lines of `lines` whose report `context` fits `REPORT_CONTEXT_MAX_BYTES`, oldest dropped first, and how many of the usable ones were dropped for size.
 * Measured for the largest context any reason and any member id can make (a six-letter reason, a present public id), so the answer does
 * not depend on what the player picks next and the dialog can tell them BEFORE they send. A line that is empty once cleaned is not a line.
 */
export function fitReportLines(lines: readonly ReportLine[]): { lines: ReportLine[]; dropped: number } {
  const usable = lines.slice(-REPORT_LINES_MAX).filter((l) => reportLine(l) !== null);
  let keep = usable.length;
  const bytes = (n: number): number =>
    utf8Bytes(
      JSON.stringify({
        lines: usable.slice(usable.length - n).map((l) => reportLine(l)),
        seat: 0,
        reported_seat: 1,
        reason: 'sexual',
        reported_public_id: 'ZZZZZZZZ',
      }),
    );
  while (keep > 0 && bytes(keep) > REPORT_CONTEXT_MAX_BYTES) keep -= 1;
  return { lines: usable.slice(usable.length - keep), dropped: usable.length - keep };
}

/** Null when the input cannot make a valid report (nothing to report, or oneself), so the caller never sends a refusal. */
export function buildReportMeta(i: ReportInput): ReportMeta | null {
  if (i.seat === i.reportedSeat) return null;
  const lines = fitReportLines(i.lines)
    .lines.map(reportLine)
    .filter((l): l is string => l !== null);
  if (lines.length === 0) return null;
  const context: ReportContext = { lines, seat: i.seat, reported_seat: i.reportedSeat, reason: i.reason };
  if (i.reportedPublicId !== undefined && i.reportedPublicId !== null && PUBLIC_ID.test(i.reportedPublicId)) context.reported_public_id = i.reportedPublicId;
  const m: ReportMeta = {
    v: 1,
    t: Math.max(0, Math.floor(i.now)),
    source: 'match',
    category: 'report',
    text: clip(i.note.replace(MULTILINE_BAD, '').trim(), TEXT_MAX),
    build: i.build,
    context,
  };
  if (i.commit !== undefined && COMMIT_PATTERN.test(i.commit)) m.commit = i.commit;
  if (i.session !== undefined && ID_PATTERN.test(i.session)) m.session = i.session;
  if (i.map !== undefined && MISSION_PATTERN.test(i.map)) m.map = i.map;
  if (i.mission !== undefined && MISSION_PATTERN.test(i.mission)) m.mission = i.mission;
  return m;
}

/** Whether the build string is one the Worker accepts (kept beside the builder so a report is never refused for it). */
export const reportBuildOk = (b: string): boolean => BUILD_PATTERN.test(b);
