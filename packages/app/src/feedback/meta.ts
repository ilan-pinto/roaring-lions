/**
 * The `meta` part of a feedback note (GH-464), built to
 * `data/schemas/feedback.schema.json` exactly as the Worker reads it
 * (`packages/worker/src/feedback-meta.ts`): what the player wrote, who sent
 * it, and where they were. Pure, so the field list and the caps are tested
 * without a browser.
 */
import { BUILD_PATTERN, ID_PATTERN, MISSION_PATTERN, TESTER_PATTERN } from '@lions/data/telemetry';
import type { FeedbackContext } from './context';

export const FEEDBACK_KINDS = ['bug', 'balance', 'confusing', 'idea', 'praise'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackCategory = FeedbackKind | 'rating';
export type FeedbackSource = 'pause' | 'debrief' | 'menu';

/** Caps, in code points (spec §7; the Worker counts the same way). */
export const TEXT_MAX = 2000;
export const LINE_MAX = 280;
export const CONTACT_MAX = 120;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;

export interface FeedbackMeta {
  v: 1;
  t: number;
  source: FeedbackSource;
  category: FeedbackCategory;
  text: string;
  rating?: number;
  contact?: string;
  build: string;
  commit?: string;
  player?: string;
  session?: string;
  tester?: string;
  mission?: string;
  map?: string;
  tick?: number;
  context: FeedbackContext;
}

/** Who a note is sent as. Absent fields are not sent. Under an opt-out
 *  (`?notrack`, GPC, DNT) all three are absent: the note goes anonymously. */
export interface SenderIds {
  player?: string;
  session?: string;
  tester?: string;
}

export interface MetaInput {
  source: FeedbackSource;
  category: FeedbackCategory;
  text: string;
  rating?: number;
  contact?: string;
  ids: SenderIds;
  build: string;
  commit?: string;
  mission?: string;
  map?: string;
  tick?: number;
  context: FeedbackContext;
  now: number;
}

/** First `n` code points, so a cap never splits a surrogate pair. */
export const clip = (s: string, n: number): string => {
  const cps = [...s];
  return cps.length <= n ? s : cps.slice(0, n).join('');
};
/** A one-line field keeps no control character at all. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const oneLine = (s: string): string => s.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
/** Text keeps tab, newline and carriage return, and nothing else below 0x20. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const multiLine = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

export function buildMeta(i: MetaInput): FeedbackMeta {
  const rating = i.category === 'rating';
  const m: FeedbackMeta = {
    v: 1,
    t: Math.max(0, Math.floor(i.now)),
    source: i.source,
    category: i.category,
    text: rating ? clip(oneLine(i.text), LINE_MAX) : clip(multiLine(i.text).trim(), TEXT_MAX),
    build: i.build,
    context: i.context,
  };
  if (rating && i.rating !== undefined) m.rating = Math.min(5, Math.max(1, Math.round(i.rating)));
  const contact = i.contact === undefined ? '' : clip(oneLine(i.contact), CONTACT_MAX);
  if (!rating && contact !== '') m.contact = contact;
  if (i.commit !== undefined && COMMIT_PATTERN.test(i.commit)) m.commit = i.commit;
  if (i.ids.player !== undefined && ID_PATTERN.test(i.ids.player)) m.player = i.ids.player;
  if (i.ids.session !== undefined && ID_PATTERN.test(i.ids.session)) m.session = i.ids.session;
  if (i.ids.tester !== undefined && TESTER_PATTERN.test(i.ids.tester)) m.tester = i.ids.tester;
  if (i.mission !== undefined && MISSION_PATTERN.test(i.mission)) m.mission = i.mission;
  if (i.map !== undefined && MISSION_PATTERN.test(i.map)) m.map = i.map;
  if (i.tick !== undefined && Number.isInteger(i.tick) && i.tick >= 0) m.tick = i.tick;
  return m;
}

/** Is the build string one the Worker accepts? (`0.122.0`, not `0.122`.) */
export const validBuild = (b: string): boolean => BUILD_PATTERN.test(b);
