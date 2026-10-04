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
 */
import type { AnnouncementDef, AnnouncementManifest } from '@lions/render';
import type { MissionEvent } from '@lions/sim';
import type { VoiceCue } from './director';

export type AnnounceEventId =
  | 'objective_active'
  | 'objective_complete'
  | 'objective_failed'
  | 'deadline'
  | 'wave'
  | 'reinforcements'
  | 'unit_lost';

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
}

export const INITIAL_ANNOUNCE: AnnounceState = Object.freeze({ spoke: Object.freeze({}), hold: null });

export const ANNOUNCE_RANK: Readonly<Record<AnnouncementDef['priority'], number>> = { high: 3, normal: 2, low: 1 };

export type AnnounceWhy = 'line' | 'silent:cooldown' | 'silent:outranked' | 'silent:held' | 'silent:unknown';

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
    else if (e.kind === 'built') out.push({ event: 'reinforcements' });
  }
  if (lost > 0) out.push({ event: 'unit_lost', params: { n: lost } });
  return out;
}

/**
 * Decide this tick's announcement: at most one. `inputs` may name several
 * events; the highest-priority one that is off cooldown and not held down
 * speaks (first wins a tie, in the order given).
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

  for (const input of inputs) {
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
  if (best === null) return { state: s, notes, cue: null };

  const cue: AnnounceCue = {
    key: best.def.audio,
    lang,
    speaker: 'infantry',
    trigger: 'announce',
    priority: 'announce',
    at: null,
    caption: best.def.caption,
    captionParams: best.input.params ?? {},
    captionSeconds: table.caption_s,
  };
  const state: AnnounceState = {
    spoke: { ...s.spoke, [best.input.event]: nowMs },
    hold: { rank: best.rank, untilMs: nowMs + table.hold_s * 1000 },
  };
  notes.push({ event: best.input.event, why: 'line', cue });
  return { state, notes, cue };
}
