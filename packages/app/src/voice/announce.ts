/**
 * The announcement director (GH-110): the EVA half of the voice system.
 *
 * Unit barks answer a gesture or a death. An announcement is the radio net
 * speaking for the MISSION: an objective moved, a deadline is a minute out,
 * hostile reinforcements are coming, a unit is gone. They ride the voice
 * director's own cue and caption path (`VoiceCue`, `VoiceRuntime.speak`) --
 * there is no second one -- and this file only decides WHAT is announced and
 * WHETHER it may be, as a pure function over a state it returns anew.
 *
 * Every announcement carries a caption key now and an `audio` line key later.
 * While `audio` is empty (nothing recorded, ElevenLabs licence D5 pending) or
 * names a line the mixer has not decoded, the caption alone carries it.
 *
 * Three rules, all from the manifest's `announcements` table:
 *  - COOLDOWN: an event speaks at most once per its own `cooldown_s`.
 *  - PRIORITY: of the announcements competing in one tick, only the highest
 *    speaks. The rest are dropped, not queued -- a queued line describes the
 *    past -- and they do not start their cooldowns.
 *  - HOLD: for `hold_s` after a line spoke, anything of LOWER priority stays
 *    quiet, so a unit-lost call never talks over an objective call.
 *
 * And one of its own (AU-5, audio plan §5.1): unit-lost calls COALESCE over
 * `UNIT_LOST_COALESCE_MS`. The first loss opens a window; every loss inside it
 * adds to one count; when the window closes the count competes as one
 * `unit_lost` input, so a salvo that kills across three ticks is one call
 * with the whole count, not a call for the first tick and silence for the
 * rest. A count that meets its cooldown or a higher call's hold WAITS (it is
 * still news), and is dropped only once it is `UNIT_LOST_STALE_MS` old -- the
 * feed has carried every loss all along. The window is a clock read on the
 * next call, never a timer: the runtime asks every mission tick.
 */
import type { AnnouncementDef, AnnouncementManifest, VoicePriority } from '@lions/render';
import type { MissionEvent } from '@lions/sim';
import type { VoiceCue } from './director';

export type AnnounceEventId =
  | 'objective_active'
  | 'objective_complete'
  | 'objective_failed'
  | 'deadline'
  | 'wave'
  | 'reinforcements'
  | 'unit_lost'
  /** Polish pass F (A4): Shai on the net as the deploy gate clears. Raised
   *  by the app at the title card, like `deadline`. */
  | 'mission_start'
  /** Polish pass F (A9): a Conduct penalty, "Check your fire." */
  | 'roe';

/** One thing that happened, as the announcer needs it. `params` fill the
 *  caption (`label` for an objective, `n` for a loss). */
export interface AnnounceInput {
  event: AnnounceEventId;
  params?: Readonly<Record<string, string | number>>;
}

export interface AnnounceState {
  /** event id -> wall-clock ms it last spoke. */
  readonly spoke: Readonly<Record<string, number>>;
  /** The line currently holding the floor, if any. */
  readonly hold: { readonly rank: number; readonly untilMs: number } | null;
  /** AU-5: the losses gathered since the first one in the open window.
   *  Optional, so a state built before the rule reads as none pending. */
  readonly lost?: { readonly n: number; readonly sinceMs: number } | null;
}

export const INITIAL_ANNOUNCE: AnnounceState = Object.freeze({ spoke: Object.freeze({}), hold: null, lost: null });

export const ANNOUNCE_RANK: Readonly<Record<AnnouncementDef['priority'], number>> = { high: 3, normal: 2, low: 1 };

/** AU-5: the manifest's priority as a rung of the voice ladder (`VOICE_RANK`). */
export const ANNOUNCE_VOICE_PRIORITY: Readonly<Record<AnnouncementDef['priority'], VoicePriority>> = {
  high: 'announce_high',
  normal: 'announce',
  low: 'announce_low',
};

/** AU-5: losses within this long of the first are one call (audio plan §5.1). */
export const UNIT_LOST_COALESCE_MS = 2000;
/** AU-5: a gathered count older than this is no longer said. */
export const UNIT_LOST_STALE_MS = 8000;

export type AnnounceWhy =
  | 'line'
  | 'silent:cooldown'
  | 'silent:outranked'
  | 'silent:held'
  | 'silent:unknown'
  /** AU-5: a loss gathered into the open window, said when it closes. */
  | 'pending:coalesce'
  /** AU-5: a gathered count that waited too long to be said. */
  | 'silent:stale';

export interface AnnounceNote {
  event: AnnounceEventId;
  why: AnnounceWhy;
  cue: VoiceCue | null;
}

/** An announcement cue. `audio` empty still produces a cue: the runtime sees
 *  an empty key and goes straight to the caption. */
export interface AnnounceCue extends VoiceCue {
  captionParams: Readonly<Record<string, string | number>>;
  captionSeconds: number;
}

/** Mission events -> announcer inputs. Losses coalesce into ONE input with a
 *  count, so a squad wipe is one call, not three. */
export function announceInputsOf(events: readonly MissionEvent[], labelOf: (objectiveId: string) => string): AnnounceInput[] {
  const out: AnnounceInput[] = [];
  let lost = 0;
  for (const e of events) {
    if (e.kind === 'objective') {
      const event: AnnounceEventId =
        e.status === 'complete' ? 'objective_complete' : e.status === 'failed' ? 'objective_failed' : 'objective_active';
      out.push({ event, params: { label: labelOf(e.id) } });
    } else if (e.kind === 'unitLost') lost += 1;
    else if (e.kind === 'wave') out.push({ event: 'wave' });
    else if (e.kind === 'roe') out.push({ event: 'roe' });
    else if (e.kind === 'built') out.push({ event: 'reinforcements' });
  }
  if (lost > 0) out.push({ event: 'unit_lost', params: { n: lost } });
  return out;
}

/** AU-5: is a gathered loss count waiting to be said? The runtime asks the
 *  announcer on a quiet tick only when this is true. */
export function hasPendingAnnouncement(s: AnnounceState): boolean {
  return s.lost !== undefined && s.lost !== null;
}

/**
 * Decide this tick's announcement: at most one. `inputs` may name several
 * events; the highest-priority one that is off cooldown and not held down
 * speaks (first wins a tie, in the order given). A `unit_lost` input does not
 * compete directly: it joins the coalescing window (see the file header), and
 * the window's count competes once it closes.
 */
export function decideAnnouncements(
  s: AnnounceState,
  inputs: readonly AnnounceInput[],
  table: AnnouncementManifest,
  lang: string,
  nowMs: number
): { state: AnnounceState; notes: AnnounceNote[]; cue: AnnounceCue | null } {
  const notes: AnnounceNote[] = [];
  let best: { input: AnnounceInput; def: AnnouncementDef; rank: number } | null = null;
  const held = s.hold !== null && nowMs < s.hold.untilMs ? s.hold.rank : 0;

  // AU-5: gather this call's losses into the window, then let a closed
  // window's count compete as one input.
  let lost = s.lost ?? null;
  const competing: AnnounceInput[] = [];
  for (const input of inputs) {
    if (input.event !== 'unit_lost') {
      competing.push(input);
      continue;
    }
    const n = typeof input.params?.n === 'number' ? input.params.n : 1;
    lost = lost === null ? { n, sinceMs: nowMs } : { n: lost.n + n, sinceMs: lost.sinceMs };
  }
  let lostInput: AnnounceInput | null = null;
  if (lost !== null) {
    if (nowMs - lost.sinceMs >= UNIT_LOST_STALE_MS) {
      notes.push({ event: 'unit_lost', why: 'silent:stale', cue: null });
      lost = null;
    } else if (nowMs - lost.sinceMs >= UNIT_LOST_COALESCE_MS) {
      lostInput = { event: 'unit_lost', params: { n: lost.n } };
      competing.push(lostInput);
    } else if (inputs.some((i) => i.event === 'unit_lost')) {
      notes.push({ event: 'unit_lost', why: 'pending:coalesce', cue: null });
    }
  }

  for (const input of competing) {
    const def = Object.prototype.hasOwnProperty.call(table.events, input.event) ? table.events[input.event] : undefined;
    if (!def) {
      notes.push({ event: input.event, why: 'silent:unknown', cue: null });
      continue;
    }
    if (nowMs - (s.spoke[input.event] ?? Number.NEGATIVE_INFINITY) < def.cooldown_s * 1000) {
      notes.push({ event: input.event, why: 'silent:cooldown', cue: null });
      continue;
    }
    const rank = ANNOUNCE_RANK[def.priority];
    if (rank < held) {
      notes.push({ event: input.event, why: 'silent:held', cue: null });
      continue;
    }
    if (best === null || rank > best.rank) {
      if (best) notes.push({ event: best.input.event, why: 'silent:outranked', cue: null });
      best = { input, def, rank };
    } else {
      notes.push({ event: input.event, why: 'silent:outranked', cue: null });
    }
  }
  // A closed window that did not speak keeps its count (it waits out a
  // cooldown or a hold) unless the table does not know the event at all.
  const lostKept =
    lost !== null && lostInput !== null && best?.input !== lostInput && Object.prototype.hasOwnProperty.call(table.events, 'unit_lost');
  const lostAfter = lostInput === null ? lost : lostKept ? lost : null;
  if (best === null) return { state: { ...s, lost: lostAfter }, notes, cue: null };

  const cue: AnnounceCue = {
    key: best.def.audio,
    lang,
    speaker: 'infantry',
    trigger: 'announce',
    priority: ANNOUNCE_VOICE_PRIORITY[best.def.priority],
    at: null,
    caption: best.def.caption,
    captionParams: best.input.params ?? {},
    captionSeconds: table.caption_s,
  };
  const state: AnnounceState = {
    spoke: { ...s.spoke, [best.input.event]: nowMs },
    hold: { rank: best.rank, untilMs: nowMs + table.hold_s * 1000 },
    lost: lostAfter,
  };
  notes.push({ event: best.input.event, why: 'line', cue });
  return { state, notes, cue };
}
