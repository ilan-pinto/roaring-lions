/**
 * The cue map's app half (polish pass F, AU-1; docs/polish/audio-plan.md
 * section 3): every critical game event, and the cue id it sounds.
 *
 * Two halves, deliberately split. THIS file says which EVENT plays which CUE
 * ID, as typed exhaustive records, so a new `MissionEvent` kind or objective
 * status is a `tsc` error here rather than a silent gap. `data/audio.json`'s
 * `cues` table says which SET a cue id plays, so the sound itself is data
 * and the app never spells a set name. `cues.test.ts` holds the two to each
 * other.
 *
 * Pure, and no `t()`: ids only.
 */
import type { MissionEvent, ObjectiveStatus } from '@lions/sim';

/** Every cue id the app may ask the mixer for. */
export const CUE_IDS = [
  'outcome.victory',
  'outcome.defeat',
  'objective.active',
  'objective.complete',
  'objective.failed',
  'alert.minor',
  'alert.important',
  'alert.major',
  'mission.start',
  'ui.confirm',
  'ui.deny',
] as const;
export type CueId = (typeof CUE_IDS)[number];

/**
 * Three alert tiers (A2), so "a squad lost" and "the Lavi is gone" stop
 * sounding alike, and under fire stops sounding like either:
 *  - minor: your men are taking fire, or pinned -- glanceable, never nagging;
 *  - important: a foot unit lost, a deadline a minute out, a new wave, a
 *    soldier taken, an ambush sprung on you, a Conduct penalty (A9);
 *  - major: a vehicle, an aircraft or a named veteran lost.
 */
export type AlertTier = 'minor' | 'important' | 'major';

export const ALERT_CUE: Readonly<Record<AlertTier, CueId>> = {
  minor: 'alert.minor',
  important: 'alert.important',
  major: 'alert.major',
};

/** An objective's three statuses are three different sounds: new is level,
 *  complete rises, failed falls. A failure must never sound like a success. */
export const OBJECTIVE_CUE: Readonly<Record<ObjectiveStatus, CueId>> = {
  active: 'objective.active',
  complete: 'objective.complete',
  failed: 'objective.failed',
};

export const OUTCOME_CUE: Readonly<Record<'victory' | 'defeat', CueId>> = {
  victory: 'outcome.victory',
  defeat: 'outcome.defeat',
};

/** What one event kind may sound: the cues it can raise, or the reason it is
 *  quiet. Silence is a decision with a reason, never a gap. */
export type EventSound = { readonly cues: readonly CueId[] } | { readonly silent: string };

/**
 * Every `MissionEvent` kind. A `Record` over the union, so adding a kind to
 * the sim without deciding its sound here does not compile.
 */
export const MISSION_EVENT_SOUND: Readonly<Record<MissionEvent['kind'], EventSound>> = {
  objective: { cues: [OBJECTIVE_CUE.active, OBJECTIVE_CUE.complete, OBJECTIVE_CUE.failed] },
  unitLost: { cues: [ALERT_CUE.important, ALERT_CUE.major] },
  wave: { cues: [ALERT_CUE.important] },
  removed: { cues: [ALERT_CUE.important] },
  roe: { cues: [ALERT_CUE.important] },
  missionEnd: { cues: [OUTCOME_CUE.victory, OUTCOME_CUE.defeat] },
  trigger: { silent: 'a trigger speaks through its label in the feed; what it does (a wave, an objective) carries its own cue' },
  built: { silent: 'a reinforcement arriving is good news the dock and the feed already show; the announcer carries it' },
  evacuated: { silent: 'a rescue is counted on the HUD; a cue per civilian reaching the refuge would nag' },
  say: { silent: 'the story voice owns the commander bar; a cue under it would talk over it' },
};

/**
 * The plan's critical moments (section 3, rows 1 to 11), each to its cue.
 * Kit fitted (row 12) belongs to PR 418 (GH-238 K10) and is not here.
 */
export const CRITICAL_CUES = {
  victory: OUTCOME_CUE.victory,
  defeat: OUTCOME_CUE.defeat,
  objectiveComplete: OBJECTIVE_CUE.complete,
  objectiveFailed: OBJECTIVE_CUE.failed,
  objectiveNew: OBJECTIVE_CUE.active,
  alertMinor: ALERT_CUE.minor,
  alertImportant: ALERT_CUE.important,
  alertMajor: ALERT_CUE.major,
  missionStart: 'mission.start',
  uiConfirm: 'ui.confirm',
  uiDeny: 'ui.deny',
} as const satisfies Record<string, CueId>;

/**
 * When several cues land in one tick, only one sounds: two chimes at once
 * read as noise, not as two facts. Most urgent first -- a loss that changes
 * the plan, then a door closing, then progress, then the rest. The feed
 * still carries every line.
 */
export const CUE_PRECEDENCE: readonly CueId[] = [
  'outcome.defeat',
  'outcome.victory',
  'alert.major',
  'objective.failed',
  'objective.complete',
  'alert.important',
  'objective.active',
  'alert.minor',
];

/** The one cue a tick sounds, or null. Ids outside the precedence list
 *  (UI cues) never compete here. */
export function tickCue(cues: readonly (CueId | null)[]): CueId | null {
  let best: CueId | null = null;
  let rank = Infinity;
  for (const c of cues) {
    if (c === null) continue;
    const r = CUE_PRECEDENCE.indexOf(c);
    if (r >= 0 && r < rank) {
      best = c;
      rank = r;
    }
  }
  return best;
}
