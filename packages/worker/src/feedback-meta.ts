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
export const FEEDBACK_SOURCES = ['pause', 'debrief', 'menu'] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
/** The five a player picks in the pause/menu form, plus `rating`, which only
 *  the debrief prompt sends. */
export const FEEDBACK_KINDS = ['bug', 'balance', 'confusing', 'idea', 'praise'] as const;
export const FEEDBACK_CATEGORIES = [...FEEDBACK_KINDS, 'rating'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Caps, in code points for text and bytes for everything else (spec §7). */
export const TEXT_MAX = 2000;
export const LINE_MAX = 280;
export const CONTACT_MAX = 120;
export const CONTEXT_MAX_BYTES = 8 * 1024;
export const META_MAX_BYTES = 24 * 1024;
export const SHOT_MAX_BYTES = 300 * 1024;
export const REPLAY_MAX_BYTES = 96 * 1024;
export const BODY_MAX_BYTES = 448 * 1024;
export const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const TICK_MAX = 1_000_000_000;

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
/** C0 controls and DEL. Text may keep \t \n \r; a one-line field keeps none. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const TEXT_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const LINE_BAD = /[\u0000-\u001F\u007F]/;
const isInt = (x: unknown, min: number, max: number): boolean =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const matches = (x: unknown, re: RegExp): boolean => typeof x === 'string' && re.test(x);
const optional = (e: Rec, k: string, ok: (v: unknown) => boolean): boolean => e[k] === undefined || ok(e[k]);

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Null when valid, otherwise a short reason (it goes back in the 400 body). */
export function feedbackMetaProblem(x: unknown): string | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'meta is not an object';
  const e = x as Rec;
  for (const k of Object.keys(e)) if (!KEYS.has(k)) return `unknown field ${k}`;
  if (e.v !== FEEDBACK_VERSION) return 'v';
  if (!isInt(e.t, 0, Number.MAX_SAFE_INTEGER)) return 't';
  if (!(FEEDBACK_SOURCES as readonly unknown[]).includes(e.source)) return 'source';
  if (!(FEEDBACK_CATEGORIES as readonly unknown[]).includes(e.category)) return 'category';
  const isRating = e.category === 'rating';
  // The debrief prompt sends ratings and nothing else; the forms never do.
  if (isRating !== (e.source === 'debrief')) return 'category does not match source';
  if (typeof e.text !== 'string' || TEXT_BAD.test(e.text)) return 'text';
  const n = codePoints(e.text);
  if (isRating ? n > LINE_MAX || LINE_BAD.test(e.text) : n < 1 || n > TEXT_MAX || e.text.trim() === '') return 'text';
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
  return null;
}

export const isFeedbackMeta = (x: unknown): x is FeedbackMeta => feedbackMetaProblem(x) === null;

/** `FB-0042`. Four digits at least; it grows past 9999 rather than wrapping. */
export const feedbackRef = (id: number): string => `FB-${String(id).padStart(4, '0')}`;
