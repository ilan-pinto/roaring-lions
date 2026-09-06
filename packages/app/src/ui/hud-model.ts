// The HUD's arithmetic, with no DOM in it.
//
// Split out of hud.ts for one reason: the floating layout reports the same
// fact in two places at once. The hold clock is drawn big and centred AND
// stamped inline beside its objective in the top strip; the ROE tone colours a
// numeral in the strip and nothing else. A second derivation of either is a
// bug that shows up as two parts of the HUD disagreeing with each other, which
// is exactly the failure a player cannot diagnose and cannot ignore.
//
// So: one function per fact, called from every place that draws it.
//
// The only sim import here is TICKS_PER_SECOND — a constant, not state
// (invariant 4: the HUD renders what the sim reports and mutates nothing).

import { TICKS_PER_SECOND } from '@lions/sim';

export interface ObjectiveView {
  id: string;
  /** The schema's objective type. The strip reads it for one thing only:
   *  whether a clock is a DEADLINE that loses the mission when it runs out. */
  type?: string;
  text: string;
  primary: boolean;
  status: string;
  ticksLeft?: number;
  paused?: 'contested' | 'unheld';
}

/** The objective types whose `seconds` is a deadline the mission is LOST on
 *  when it expires -- the failable three. `hold_for`/`survive_until` clocks
 *  are the opposite kind: running out is how they complete. */
const DEADLINE_TYPES: ReadonlySet<string> = new Set(['raze', 'collapse', 'evacuate_before']);

export interface MissionView {
  name: string;
  objectives: ObjectiveView[];
  result: 'ongoing' | 'victory' | 'defeat';
  /** One-line campaign summary (roster size, cumulative ROE). */
  campaign?: string;
  /** Live mission ROE score 0-100 — always visible (GDD §6). */
  roe?: number;
  /** Logistics in hand, and what the mission pays per minute. Structured
   *  rather than the prose line this used to be: the strip stamps the two
   *  resources as separate fields with their own glyphs, and splitting a
   *  sentence back apart in the renderer is how the two drift. */
  logistics?: number;
  logisticsRate?: number;
  intel?: number;
  /** The story voice's closing line (GDD §11), shown on the victory banner
   *  only -- `mission.ts`'s own doc comment on the field: "Shown on the
   *  victory banner." */
  aftermath?: string;
}

/** Semantic tone for a notice or a value. Never a colour — the mapping from
 *  meaning to colour belongs to theme.css, in one place. */
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'live' | 'mute';

/** m:ss, rounded up so a clock never shows 0:00 with time still on it. */
export function clockText(ticksLeft: number): string {
  const secs = Math.ceil(ticksLeft / TICKS_PER_SECOND);
  const mm = Math.floor(secs / 60);
  const ss = (secs % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export interface HoldClock {
  /** Which objective the clock belongs to, so the strip can tell whether the
   *  clock it is about to stamp is the one beside the objective it is showing
   *  or a different objective's entirely. */
  id: string;
  /** Ready to draw, including the reason a paused clock is paused. */
  text: string;
  tone: '' | 'warn' | 'bad';
  /** Contested is the only state that pulses. */
  contested: boolean;
}

/**
 * The mission's live clock, or null when nothing is timed.
 *
 * A paused clock must say why, or it reads as a broken game. Amber under a
 * minute: the last stretch of a hold is the part worth watching.
 */
export function holdClock(m: MissionView | null): HoldClock | null {
  const timed = m?.objectives.find((o) => o.status === 'active' && o.ticksLeft !== undefined);
  if (!timed || timed.ticksLeft === undefined) return null;
  const secs = Math.ceil(timed.ticksLeft / TICKS_PER_SECOND);
  const why =
    timed.paused === 'contested'
      ? 'CONTESTED'
      : timed.paused === 'unheld'
        ? 'NOBODY HOLDING'
        : '';
  return {
    id: timed.id,
    text: why ? `${clockText(timed.ticksLeft)}  ${why}` : clockText(timed.ticksLeft),
    tone:
      timed.paused === 'contested' ? 'bad' : timed.paused === 'unheld' || secs <= 60 ? 'warn' : '',
    contested: timed.paused === 'contested',
  };
}

/** ROE gates campaign progression, so its colour is a verdict, not decoration. */
export function roeTone(roe: number): 'good' | 'warn' | 'bad' {
  return roe >= 80 ? 'good' : roe >= 50 ? 'warn' : 'bad';
}

export interface StripObjectives {
  /** The one objective the strip has room for. */
  primary: ObjectiveView | null;
  /** A second line the strip makes room for: the most urgent active FAILABLE
   *  primary with a clock, when it is not the primary already shown. Null
   *  when there is none, or when the shown primary is itself that deadline
   *  (its clock is then stamped inline instead). */
  deadline: StripDeadline | null;
  /** Active primaries the strip is NOT showing -- neither as the primary
   *  nor as the deadline. Zero when the strip is telling the whole story. */
  primaryOpen: number;
  /** Everything else, as a count. */
  secondaryOpen: number;
}

export interface StripDeadline {
  objective: ObjectiveView;
  /** Ready to draw. */
  text: string;
  tone: '' | 'warn' | 'bad';
}

/**
 * What the top strip says about objectives: one primary, a deadline if one is
 * running out of sight, and counts.
 *
 * The strip has room for a single line, so it shows the primary the player is
 * currently working — the first ACTIVE one. Falling back to the first primary
 * rather than to nothing matters at the end of a mission: with every primary
 * complete the strip should say so, not go blank.
 *
 * The deadline line exists because of Tel Marum II (2026-09-06): three
 * primaries, the strip showing the hold, and a 300 s `raze` deadline on the
 * cache that no surface showed anywhere. The player held the approach for
 * four minutes, the hold ticked complete, and the mission was lost on a clock
 * they had never seen. A clock that loses the mission when it runs out is
 * never allowed to run out of sight: when the most urgent active failable
 * primary is not the one the strip is showing, it gets its own line, with
 * its own clock. Amber under a minute, red under thirty seconds.
 *
 * Secondaries are counted only while still active. A completed secondary is
 * not something the player has left to do, and counting it would leave the
 * strip advertising work that is finished.
 */
export function stripObjectives(m: MissionView): StripObjectives {
  const primaries = m.objectives.filter((o) => o.primary);
  const active = primaries.filter((o) => o.status === 'active');
  const primary = active[0] ?? primaries[0] ?? null;
  const urgent = active
    .filter((o) => o.ticksLeft !== undefined && o.type !== undefined && DEADLINE_TYPES.has(o.type))
    .sort((a, b) => (a.ticksLeft ?? 0) - (b.ticksLeft ?? 0))[0];
  let deadline: StripDeadline | null = null;
  if (urgent && urgent.ticksLeft !== undefined && primary && urgent.id !== primary.id) {
    const secs = Math.ceil(urgent.ticksLeft / TICKS_PER_SECOND);
    deadline = {
      objective: urgent,
      text: clockText(urgent.ticksLeft),
      tone: secs <= 30 ? 'bad' : secs <= 60 ? 'warn' : '',
    };
  }
  const shown = new Set([primary?.id, deadline?.objective.id]);
  return {
    primary,
    deadline,
    primaryOpen: active.filter((o) => !shown.has(o.id)).length,
    secondaryOpen: m.objectives.filter((o) => !o.primary && o.status === 'active').length,
  };
}

/** The glyph an objective wears, by status. */
export function objectiveGlyph(status: string): string {
  return status === 'complete' ? '☑' : status === 'failed' ? '☒' : '☐';
}

/** Structural, so this needs no sim import and a test can hand it four plain
 *  arrays instead of building a battle. */
export interface SuppressionSource {
  alive: ArrayLike<number>;
  side: ArrayLike<number>;
  routed: ArrayLike<number>;
  pinned: ArrayLike<number>;
}

export interface Suppression {
  pinned: number;
  broken: number;
}

/**
 * Force-wide suppression — visible even when the units are not.
 *
 * Broken outranks pinned rather than adding to it: a routed unit is also
 * flagged pinned in the sim, and counting it twice would have the strip
 * reporting more suppressed men than the player owns.
 */
export function countSuppressed(s: SuppressionSource, entityCount: number): Suppression {
  let pinned = 0;
  let broken = 0;
  for (let i = 0; i < entityCount; i++) {
    if (s.alive[i] === 0 || s.side[i] !== 0) continue;
    if (s.routed[i] === 1) broken++;
    else if (s.pinned[i] === 1) pinned++;
  }
  return { pinned, broken };
}

/**
 * The two factors actually degrading a shot, worst first.
 *
 * Anything at or above 99.5% is dropped: it rounds to "100%", and a penalty
 * row that says a factor costs nothing is noise in a panel the player reads
 * mid-fight. The weapon's own accuracy is deliberately not a candidate — it is
 * the baseline, not something the player can act on.
 */
export function worstPenalties(factors: [string, number][]): string[] {
  return factors
    .filter(([, v]) => v < 0.995)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([label, v]) => `${label} ${Math.round(v * 100)}%`);
}

/**
 * Page the commander's briefing beats.
 *
 * Clamped rather than wrapping. A briefing is an ordered account of what is
 * about to happen, so running off the end onto beat 1 again would misreport
 * the order of events; the arrows disable instead, which is what the spec
 * draws.
 */
export function stepBeat(index: number, total: number, dir: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, index + dir));
}

/**
 * The label a `say` line's speaker wears on the commander bar: the plate for
 * the two named voices, or a literal word for the other two --
 * `commander.schema.json`'s own comment on `people`: "net and enemy are not
 * people on this roster -- the HUD names them literally (NET, ENEMY) rather
 * than looking them up here." `.rl-cmd__who`'s own CSS uppercases
 * unconditionally, so the casing returned here is cosmetic either way.
 */
export function speakerPlate(
  people: { shai: { plate: string }; idit: { plate: string } },
  speaker: string
): string {
  if (speaker === 'shai') return people.shai.plate;
  if (speaker === 'idit') return people.idit.plate;
  return speaker === 'net' ? 'NET' : 'ENEMY';
}

/**
 * The photo `.rl-cmd__face` shows for whoever is currently speaking on the
 * bar -- the same `speaker` string `speakerPlate` reads, resolved against
 * each person's ALREADY-RESOLVED portrait URL (`HudCommanderInfo`'s own doc
 * comment; this function does no path-to-URL resolution of its own).
 * `net` is not a person on this roster and has no portrait to look up, so it
 * falls to `undefined` exactly like a named person who simply has none
 * authored yet -- both mean "show the hatch". `enemy` gets the SAME
 * treatment as `net` only when `people.enemy` is absent (a sandbox with no
 * owning town, or a front whose villain has no portrait authored yet,
 * `main.ts`'s own resolution via `villainPortrait`, `campaign.ts`) --
 * `speakerPlate` still never names him (storyline.md G18: a face, never a
 * name).
 */
export function speakerPortrait(
  people: { shai: { portrait?: string }; idit: { portrait?: string }; enemy?: { portrait?: string } },
  speaker: string
): string | undefined {
  if (speaker === 'shai') return people.shai.portrait;
  if (speaker === 'idit') return people.idit.portrait;
  if (speaker === 'enemy') return people.enemy?.portrait;
  return undefined;
}

/** How long a beat stays open before the bar folds back to the portrait.
 *
 *  Proportional to its own length, because the beats are split on sentence
 *  boundaries and differ by a factor of three — a fixed dwell either clips the
 *  long ones or leaves the short ones sitting over the map. ~13 characters a
 *  second is unhurried adult reading; the floor covers a one-word beat. */
export function beatDwellMs(text: string): number {
  return Math.max(6000, Math.round((text.length / 13) * 1000));
}
