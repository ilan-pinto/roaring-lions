/**
 * The voice director for orders (WP-AU1 §2, Task 7): one line per gesture.
 *
 * A single click or key can carry several intents at once -- a right-click
 * that demolishes a building, garrisons a squad and attack-moves the rest is
 * three commands in one gesture. The cursor already ranks that gesture down
 * to ONE verb (`winningVerb`, `../input/cursor.ts`); the director reuses that
 * ranking literally (R-4) rather than re-deriving it, so the voice can never
 * say something the cursor did not promise. Once it has a verb and the ids it
 * applies to, it picks a speaker (the class with the most units in that
 * group, spec §2/R-5), then decides whether this gesture actually gets a
 * line: a run of identical gestures degrades line -> ack -> silence inside a
 * repeat window (N2), and a class that spoke too recently answers from the
 * shared ack pool instead of its own line (N3).
 *
 * Pure: no audio, no DOM, no sim mutation (invariant 4). `decideOrder` takes
 * a `DirectorState` and returns a new one; the caller (Task 9's wiring) owns
 * threading it and handing the resulting `VoiceCue` to the mixer's
 * `playVoice` (Task 5), which does its own ranking of WHETHER to actually
 * play it against whatever else is already sounding. The director only
 * decides WHAT to say.
 */
import type { PlayerIntent } from '../input/intents';
import { idsOf, winningVerb } from '../input/cursor';
import type { VoicePriority } from '@lions/render';
import {
  ackLineKey,
  languageOf,
  lineTriggerOf,
  orderLineKey,
  type LineTrigger,
  type OrderVerb,
  type VoiceClass,
} from './lines';

/** What the mixer needs to play one line: which sample, in what language, on
 *  whose behalf, and where (always `null` here -- an order cue has no world
 *  position; only death/ambient cues, outside this task, carry one). */
export interface VoiceCue {
  key: string;
  lang: string;
  speaker: VoiceClass;
  trigger: LineTrigger;
  priority: VoicePriority; // from @lions/render
  at: { x: number; y: number } | null;
}

/** One player gesture: every intent it produced, and whether the pointer
 *  hovered a hostile (the one fact `winningVerb` needs that intents alone
 *  cannot carry -- see `../input/cursor.ts`'s `CursorHints`). */
export interface Gesture {
  intents: readonly PlayerIntent[];
  hostile: boolean;
}

/** The narrow slice of the world the director needs to pick a speaker and
 *  (in later tasks) gate a line on visibility/range. A port, like
 *  `IntentWorld` and `BadgeHints` before it, so a test can describe a
 *  roster instead of building a Sim. */
export interface DirectorLook {
  unitOf(id: number): { faction: string; voice: VoiceClass } | null;
  side(id: number): number;
  pos(id: number): { x: number; y: number };
  isVisible(x: number, y: number): boolean;
  camera(): { x: number; y: number };
}

/** The director's whole memory, threaded call to call. Every field is
 *  readonly and every update below builds a fresh object -- `decideOrder`
 *  never writes into `s` (verification-before-completion: the "never
 *  mutates the state it is given" test asserts this). */
export interface DirectorState {
  /** The gesture currently inside its repeat window, or null before the
   *  first one. */
  readonly run: { readonly verb: OrderVerb; readonly sel: string; readonly openedMs: number; readonly count: number } | null;
  /** `${lang}.${class}` -> the wall-clock ms this class last spoke, ack or
   *  full line alike (a class's cooldown starts on any line it speaks). */
  readonly spoke: Readonly<Record<string, number>>;
  /** Reserved for the death director (a later task): per-class and global
   *  KDF death throttles. */
  readonly kdfDeathByClass: Readonly<Record<string, number>>;
  readonly kdfDeathAt: number;
  readonly enemyDeathAt: number;
}

/** Why this gesture got the cue it did, or none at all -- surfaced so a test
 *  (and later, a debug overlay) can tell "silent because nobody can speak"
 *  apart from "silent because it was said a moment ago." */
export type Why =
  | 'line'
  | 'ack:repeat'
  | 'ack:cooldown'
  | 'silent:repeat'
  | 'silent:unvoiced'
  | 'silent:throttle'
  | 'silent:unseen'
  | 'silent:far';

/** Every duration the director throttles on, named once. Wall time (N-clock
 *  rulings), not sim ticks -- a paused sim must not freeze these windows. */
export const VOICE_TIMING = {
  repeatWindowMs: 4000,
  classCooldownMs: 1500,
  kdfDeathClassMs: 4000,
  kdfDeathGlobalMs: 2500,
  enemyDeathGlobalMs: 6000,
  enemyDeathTiles: 18,
} as const;

export const INITIAL_DIRECTOR: DirectorState = Object.freeze({
  run: null,
  spoke: Object.freeze({}),
  kdfDeathByClass: Object.freeze({}),
  kdfDeathAt: Number.NEGATIVE_INFINITY,
  enemyDeathAt: Number.NEGATIVE_INFINITY,
});

/** The one verb this gesture means, and the ids it applies to -- the
 *  cursor's own ranking (`winningVerb`), called literally (R-4): the voice
 *  says what the cursor promised, never a second opinion. `winningVerb` has
 *  no rung for `move` (a bare order must never win ITS ranking, so
 *  `cursorFor`'s lower rungs stay reachable) or for `halt` (only a key
 *  issues it, and the cursor never previews a key). Both are the director's
 *  own fallback here, in that order -- `move` because it is what is left
 *  once nothing else has won, `halt` because it is the one intent kind that
 *  produces no other rung at all. */
export function gestureVerb(g: Gesture): { verb: OrderVerb; ids: readonly number[] } | null {
  const pick = (kind: PlayerIntent['kind'], verb: OrderVerb): { verb: OrderVerb; ids: readonly number[] } | null => {
    const i = g.intents.find((x) => x.kind === kind);
    return i ? { verb, ids: idsOf(i) } : null;
  };
  // The cursor's own ranking, called literally (R-4): the voice says what the cursor promised.
  switch (winningVerb({ intents: [...g.intents], roe: 'free', marker: false }, { hostile: g.hostile, blocked: false })) {
    case 'demolish':
      return pick('demolish', 'demolish');
    case 'charge':
      return pick('chargeTunnel', 'charge');
    case 'attack':
      return pick('order', 'attack');
    case 'garrison':
      return pick('garrison', 'garrison');
    case 'mount':
      return pick('mount', 'mount');
    case 'dismount':
      return pick('dismount', 'dismount');
    case 'smoke':
      return pick('smoke', 'smoke');
    default:
      return pick('order', 'move') ?? pick('halt', 'halt');
  }
}

/** Which class speaks for a group, and in what language. Counts classes over
 *  `ids`, recording each class's first index and faction as it goes; the
 *  highest count wins, and a tie goes to the class that appears earliest in
 *  the selection (spec §2, R-5). `null` means nobody CAN speak: either the
 *  ids resolve to no known unit, or the winning class's faction has no
 *  mapped language (civilians, D10). */
export function speakerOf(
  ids: readonly number[],
  look: DirectorLook,
  languages: Readonly<Record<string, string>>
): { cls: VoiceClass; lang: string } | null {
  let winner: { cls: VoiceClass; count: number; firstIndex: number; faction: string } | null = null;
  const byClass = new Map<VoiceClass, { count: number; firstIndex: number; faction: string }>();
  ids.forEach((id, index) => {
    const u = look.unitOf(id);
    if (!u) return;
    const entry = byClass.get(u.voice);
    if (entry) {
      entry.count += 1;
    } else {
      byClass.set(u.voice, { count: 1, firstIndex: index, faction: u.faction });
    }
  });
  for (const [cls, e] of byClass) {
    if (!winner || e.count > winner.count || (e.count === winner.count && e.firstIndex < winner.firstIndex)) {
      winner = { cls, ...e };
    }
  }
  if (!winner) return null;
  const lang = languageOf(winner.faction, languages);
  return lang === null ? null : { cls: winner.cls, lang };
}

/**
 * The one decision per gesture: what to say, if anything, and the state to
 * carry forward.
 *
 * 1. Find the verb (`gestureVerb`) and the speaker (`speakerOf`, over the
 *    winning verb's own ids). Either missing -- no ranked verb, no ids, or a
 *    speaker with no language -- and the gesture is `silent:unvoiced`; the
 *    state is returned unchanged.
 * 2. `sel` is the verb's ids, sorted numerically and joined with `,` -- the
 *    same selection said two different ways (`order(1,2)` vs `order(2,1)`)
 *    is one run.
 * 3. The run continues (count + 1, `openedMs` unchanged) iff the previous
 *    run's verb and `sel` match this gesture's AND it opened under
 *    `repeatWindowMs` ago. Otherwise this gesture opens a fresh run at
 *    count 1 -- the window opens at the first gesture of a run and is never
 *    extended by a repeat inside it.
 * 4. A run's third repeat (count >= 3) is silent: the player already heard
 *    the line and the ack, and a third acknowledgement would be noise. The
 *    run is still carried in the returned state, so a fourth attempt inside
 *    the same window reads count 4 and stays silent too.
 * 5. Otherwise: the SECOND gesture of a run (count === 2) answers with the
 *    shared ack (`ack:repeat`) rather than repeating the full line -- a
 *    player who orders the same thing twice already knows what unit they
 *    selected. Independently, a class that spoke (line OR ack) less than
 *    `classCooldownMs` ago also answers from ack (`ack:cooldown`) --
 *    invariant-4-safe rate limiting on the pool of samples, not a comment
 *    on the order. Anything else is a full `line`.
 * 6. The cue's key is `ackLineKey(lang)` for either ack path, or
 *    `orderLineKey(lang, speaker, verb)` for a line -- which is also where
 *    engineers answer `attack` from the infantry pool and `demolish` always
 *    resolves to `engineer.task`, both already encoded in `orderLineKey`
 *    (Task 2). The trigger mirrors that split: `'ack'` or
 *    `lineTriggerOf(verb)`. Priority is always `'order'` and `at` is always
 *    `null` -- an order cue names no world position; the mixer's own
 *    ranking (Task 5) decides whether it actually plays.
 * 7. The returned state stamps `spoke[\`${lang}.${cls}\`] = nowMs` for any
 *    speech at all (line or ack) -- a class's cooldown starts whether it got
 *    the full line or only the ack, deaths included (a later task's rule,
 *    named here because it is the same clock). A silenced repeat (step 4)
 *    stamps nothing: nothing was said.
 */
export function decideOrder(
  s: DirectorState,
  g: Gesture,
  look: DirectorLook,
  languages: Readonly<Record<string, string>>,
  nowMs: number
): { state: DirectorState; cue: VoiceCue | null; why: Why; trigger: OrderVerb | null } {
  const verb = gestureVerb(g);
  const speaker = verb && verb.ids.length > 0 ? speakerOf(verb.ids, look, languages) : null;
  if (!verb || verb.ids.length === 0 || !speaker) {
    return { state: s, cue: null, why: 'silent:unvoiced', trigger: verb?.verb ?? null };
  }

  const sel = [...verb.ids].sort((a, b) => a - b).join(',');
  const prevRun = s.run;
  const isRepeat =
    prevRun !== null &&
    prevRun.verb === verb.verb &&
    prevRun.sel === sel &&
    nowMs - prevRun.openedMs < VOICE_TIMING.repeatWindowMs;
  const run = isRepeat
    ? { verb: verb.verb, sel, openedMs: prevRun.openedMs, count: prevRun.count + 1 }
    : { verb: verb.verb, sel, openedMs: nowMs, count: 1 };

  if (run.count >= 3) {
    return { state: { ...s, run }, cue: null, why: 'silent:repeat', trigger: verb.verb };
  }

  const spokeKey = `${speaker.lang}.${speaker.cls}`;
  const onCooldown = nowMs - (s.spoke[spokeKey] ?? Number.NEGATIVE_INFINITY) < VOICE_TIMING.classCooldownMs;
  const why: Why = run.count === 2 ? 'ack:repeat' : onCooldown ? 'ack:cooldown' : 'line';
  const isAck = why !== 'line';

  const cue: VoiceCue = {
    key: isAck ? ackLineKey(speaker.lang) : orderLineKey(speaker.lang, speaker.cls, verb.verb),
    lang: speaker.lang,
    speaker: speaker.cls,
    trigger: isAck ? 'ack' : lineTriggerOf(verb.verb),
    priority: 'order',
    at: null,
  };
  const state: DirectorState = { ...s, run, spoke: { ...s.spoke, [spokeKey]: nowMs } };
  return { state, cue, why, trigger: verb.verb };
}
