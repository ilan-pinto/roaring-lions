/**
 * The `meta` part of POST /api/feedback (GH-464, spec
 * docs/superpowers/specs/2026-10-08-in-game-feedback-design.md §5.2 and its
 * "Server contract as built" section).
 *
 * `data/schemas/feedback.schema.json` is the authority the client builds
 * against. This file is its hand-written twin for the Worker, which cannot run
 * Ajv (no `new Function` in the Workers runtime) -- the same arrangement as
 * `@lions/data/telemetry`. `feedback-meta.test.ts` runs every fixture through
 * both and fails on any disagreement. Two rules the schema cannot say live
 * only here and are listed in its description: `context` serialises to at
 * most 8 KB, and the multipart part caps (picture, replay, whole body).
 */
import { BUILD_PATTERN, ID_PATTERN, MISSION_PATTERN, TESTER_PATTERN } from '@lions/data/telemetry';

export const FEEDBACK_VERSION = 1;
export const FEEDBACK_SOURCES = ['pause', 'debrief', 'menu', 'match'] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
/** The five a player picks in the pause/menu form, plus `rating`, which only
 *  the debrief prompt sends. */
export const FEEDBACK_KINDS = ['bug', 'balance', 'confusing', 'idea', 'praise'] as const;
/** `report` (GH-1417 S3, the lead's D6) is a player reporting the other player's chat, sent from the match or the lobby with source `match`
 *  and no other. Its evidence rides in `context` in one strict shape (`reportContextProblem`), is the reporter's own copy, and is NEVER
 *  verified. Readable on /stats only, never turned into a GitHub issue link. */
export const FEEDBACK_CATEGORIES = [...FEEDBACK_KINDS, 'rating', 'report'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Caps, in code points for text and bytes for everything else (spec §7). */
export const TEXT_MAX = 2000;
export const LINE_MAX = 280;
export const CONTACT_MAX = 120;
export const CONTEXT_MAX_BYTES = 8 * 1024;
export const META_MAX_BYTES = 24 * 1024;
export const SHOT_MAX_BYTES = 64 * 1024;
export const REPLAY_MAX_BYTES = 96 * 1024;
export const BODY_MAX_BYTES = 448 * 1024;
export const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const TICK_MAX = 1_000_000_000;

/** Why a player reported a line (a closed set, so the stats page can count them). */
export const REPORT_REASONS = ['abuse', 'hate', 'sexual', 'threat', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** The lines a report may carry: the last few the reporter received, each `<seat>: <text>`. */
export const REPORT_LINES_MAX = 10;
/** A member's public id (8 Crockford characters, `@lions/net`'s `PUBLIC_ID_RE`). It is NOT a telemetry player id (a UUID). */
export const PUBLIC_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** Fields a `report` may not carry: nothing that names the reporter beyond the session the rate limit needs. A tester label, a contact
 *  and the persistent anonymous player id would each tie an abuse report to a person; the room's join code and a seat token are not fields
 *  at all (the context shape is closed), so they cannot ride in. The schema says the same. */
export const REPORT_FORBIDDEN = ['tester', 'contact', 'player'] as const;

export interface FeedbackMeta {
  v: 1;
  /** Client epoch milliseconds. */
  t: number;
  source: FeedbackSource;
  category: FeedbackCategory;
  text: string;
  /** 1-5, present exactly when `category` is `rating`. */
  rating?: number;
  contact?: string;
  build: string;
  commit?: string;
  /** Telemetry identity; all three absent when the player opted out (§7). */
  player?: string;
  session?: string;
  tester?: string;
  mission?: string;
  map?: string;
  tick?: number;
  dev?: true;
  context: Record<string, unknown>;
}

type Rec = Record<string, unknown>;
const KEYS = new Set([
  'v', 't', 'source', 'category', 'text', 'rating', 'contact', 'build', 'commit',
  'player', 'session', 'tester', 'mission', 'map', 'tick', 'dev', 'context',
]);

const codePoints = (s: string): number => [...s].length;
/** One reported line: the seat that said it (0 or 1), a colon and a space, then 1 to 280 code points with no control character. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const REPORT_LINE = /^[01]: [^\u0000-\u001F\u007F]{1,280}$/u;
const REPORT_CONTEXT_KEYS = new Set(['lines', 'seat', 'reported_seat', 'reason', 'reported_public_id']);
/** C0 controls and DEL. Text may keep \t \n \r; a one-line field keeps none. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const TEXT_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const LINE_BAD = /[\u0000-\u001F\u007F]/;
const isInt = (x: unknown, min: number, max: number): boolean =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const matches = (x: unknown, re: RegExp): boolean => typeof x === 'string' && re.test(x);
const optional = (e: Rec, k: string, ok: (v: unknown) => boolean): boolean => e[k] === undefined || ok(e[k]);

/** Null when the report's `context` is the one strict shape, otherwise the reason. The evidence is the reporter's own copy: this checks its
 *  SHAPE, never that the other player said it. */
export function reportContextProblem(c: Rec): string | null {
  for (const k of Object.keys(c)) if (!REPORT_CONTEXT_KEYS.has(k)) return 'context key';
  const lines = c.lines;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > REPORT_LINES_MAX) return 'context.lines';
  for (const l of lines) if (typeof l !== 'string' || !REPORT_LINE.test(l)) return 'context.lines';
  if (!isInt(c.seat, 0, 1)) return 'context.seat';
  if (!isInt(c.reported_seat, 0, 1) || c.reported_seat === c.seat) return 'context.reported_seat';
  if (!(REPORT_REASONS as readonly unknown[]).includes(c.reason)) return 'context.reason';
  if (!optional(c, 'reported_public_id', (v) => matches(v, PUBLIC_ID_PATTERN))) return 'context.reported_public_id';
  return null;
}

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Null when valid, otherwise a short reason (it goes back in the 400 body). */
export function feedbackMetaProblem(x: unknown): string | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'meta is not an object';
  const e = x as Rec;
  for (const k of Object.keys(e)) if (!KEYS.has(k)) return 'unknown field';
  if (e.v !== FEEDBACK_VERSION) return 'v';
  if (!isInt(e.t, 0, Number.MAX_SAFE_INTEGER)) return 't';
  if (!(FEEDBACK_SOURCES as readonly unknown[]).includes(e.source)) return 'source';
  if (!(FEEDBACK_CATEGORIES as readonly unknown[]).includes(e.category)) return 'category';
  const isRating = e.category === 'rating';
  const isReport = e.category === 'report';
  // The debrief prompt sends ratings and nothing else; the forms never do. A report comes from a match and from nothing else.
  if (isRating !== (e.source === 'debrief')) return 'category does not match source';
  if (isReport !== (e.source === 'match')) return 'category does not match source';
  // A report names no tester, no contact and no persistent player id (GH-1417 S3): the session the rate limit needs is all it carries.
  if (isReport) for (const k of REPORT_FORBIDDEN) if (e[k] !== undefined) return k;
  if (typeof e.text !== 'string' || TEXT_BAD.test(e.text)) return 'text';
  const n = codePoints(e.text);
  // A report's note is optional: the reason and the lines are the report.
  if (isRating ? n > LINE_MAX || LINE_BAD.test(e.text) : isReport ? n > TEXT_MAX : n < 1 || n > TEXT_MAX || e.text.trim() === '') return 'text';
  if (isRating ? !isInt(e.rating, 1, 5) : e.rating !== undefined) return 'rating';
  if (!optional(e, 'contact', (v) => typeof v === 'string' && codePoints(v) >= 1 && codePoints(v) <= CONTACT_MAX && !LINE_BAD.test(v))) return 'contact';
  if (!matches(e.build, BUILD_PATTERN)) return 'build';
  if (!optional(e, 'commit', (v) => matches(v, COMMIT_PATTERN))) return 'commit';
  if (!optional(e, 'player', (v) => matches(v, ID_PATTERN))) return 'player';
  if (!optional(e, 'session', (v) => matches(v, ID_PATTERN))) return 'session';
  if (!optional(e, 'tester', (v) => matches(v, TESTER_PATTERN))) return 'tester';
  if (!optional(e, 'mission', (v) => matches(v, MISSION_PATTERN))) return 'mission';
  if (!optional(e, 'map', (v) => matches(v, MISSION_PATTERN))) return 'map';
  if (!optional(e, 'tick', (v) => isInt(v, 0, TICK_MAX))) return 'tick';
  if (!optional(e, 'dev', (v) => v === true)) return 'dev';
  const c = e.context;
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return 'context';
  if (Object.keys(c).length > 64) return 'context';
  if (utf8Bytes(JSON.stringify(c)) > CONTEXT_MAX_BYTES) return 'context over 8 KB';
  if (isReport) return reportContextProblem(c as Rec);
  return null;
}

export const isFeedbackMeta = (x: unknown): x is FeedbackMeta => feedbackMetaProblem(x) === null;

/** `FB-0042`. Four digits at least; it grows past 9999 rather than wrapping. */

export const feedbackRef = (id: number): string => `FB-${String(id).padStart(4, '0')}`;
