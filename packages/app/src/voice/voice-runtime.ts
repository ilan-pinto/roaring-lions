/**
 * The voice runtime (WP-AU1 §7, Task 9): the one stateful object between the
 * input and the mixer.
 *
 * The director (`./director.ts`) is pure and decides WHAT to say for one
 * gesture or one tick. This class is what turns a stream of intents into
 * gestures, threads the director's state from call to call, hands each cue
 * to the mixer, captions what actually played, and keeps a ring of every
 * voiced decision for `__lions.voiceLog()`.
 *
 * The gesture boundary (R-3). One click or key fans out into several
 * intents through `intentListeners`, synchronously, inside one input event
 * handler. The runtime collects them and flushes on ONE scheduled callback
 * (`queueMicrotask` in the app), so everything a single handler dispatched is
 * one gesture and gets at most one line. A pointing site calls `hint` first
 * with whether the pointer was over a hostile -- the one fact `winningVerb`
 * needs that intents cannot carry -- and that hint belongs to this gesture
 * only: the flush resets it, so the next gesture starts from `false` unless
 * its own site says otherwise (the minimap always says `false`).
 *
 * A missing line is not an error (R-9). The mixer answers `missing` for a
 * key with no decoded line -- not recorded yet, or still decoding -- and the
 * runtime notes it once per key, through `info` (a dev-only `console.info`
 * in the app), never as a warning.
 *
 * Invariant 4: nothing here touches sim state. `onTick` only reads the
 * events the sim already emitted, and `look` is read-only. Every clock is
 * the injected wall clock (R-17), never the tick.
 *
 * After `dispose` (the battlefield's leave), nothing plays: a gesture whose
 * flush is already queued finds the flag and drops out, and a later tick or
 * intent is ignored.
 */
import type { MissionEvent, SimEvent } from '@lions/sim';
import type { AnnouncementManifest, VoiceResult, VoiceStatus } from '@lions/render';
import type { PlayerIntent } from '../input/intents';
import { INITIAL_ANNOUNCE, announceInputsOf, decideAnnouncements, type AnnounceInput, type AnnounceState, type AnnounceWhy } from './announce';
import {
  INITIAL_DIRECTOR,
  decideDeaths,
  decideOrder,
  type DirectorLook,
  type DirectorState,
  type VoiceCue,
  type Why,
} from './director';

export interface VoiceRuntimeDeps {
  /** Wall-clock ms (`performance.now` in the app, R-17). */
  now(): number;
  /** Run `fn` once the current input handler has finished dispatching
   *  (`queueMicrotask` in the app): the gesture boundary. */
  schedule(fn: () => void): void;
  look: DirectorLook;
  /** Faction -> language, the manifest's `voices.languages`. */
  languages: Readonly<Record<string, string>>;
  /** Hand a cue to the mixer (`battleAudio().playVoice`). */
  play(cue: VoiceCue): VoiceResult;
  /** Show a line's meaning for `seconds`. `always` is set for an
   *  announcement: mission information captions whatever the captions
   *  setting says (polish pass F, A5), while a bark follows the setting. */
  caption(text: string, seconds: number, always?: boolean): void;
  /** i18n lookup (`t` in the app, identity in tests). GH-262: used to render
   *  a cue's `caption` key when the mixer has no take to caption itself. */
  text(key: string, params?: Readonly<Record<string, string | number>>): string;
  /** `console.info` in a dev build, a no-op in production. */
  info(message: string): void;
  /** The keys already noted as missing. The app passes ONE set for the whole
   *  document, so a second battlefield boot does not note a key again; left
   *  out, the runtime keeps its own. */
  noted?: Set<string>;
  /** GH-110: the manifest's announcement table. Absent, nothing announces. */
  announcements?: AnnouncementManifest;
  /** The language the radio net speaks (the player faction's). */
  announceLang?: string;
  /** An objective's label by id, for the caption. */
  labelOf?(objectiveId: string): string;
}

/** One voiced decision, silent ones included. `status` is the mixer's answer,
 *  or `null` when the director chose silence and nothing was handed over. */
export interface VoiceLogEntry {
  at: number;
  source: 'order' | 'death' | 'announce';
  trigger: string | null;
  key: string | null;
  why: Why | AnnounceWhy;
  status: VoiceStatus | null;
}

/** How many entries `log()` keeps: the most recent ones. */
export const VOICE_LOG_SIZE = 64;

/** How long the pinned caption stands in for a take's length (GH-262 §2.4):
 *  1.5 s plus the mixer's own 1 s extra hold. */
export const PINNED_CAPTION_S = 1.5;

export class VoiceRuntime {
  private readonly deps: VoiceRuntimeDeps;
  private state: DirectorState = INITIAL_DIRECTOR;
  private announceState: AnnounceState = INITIAL_ANNOUNCE;
  private pending: PlayerIntent[] = [];
  private hostile = false;
  private scheduled = false;
  private disposed = false;
  private readonly entries: VoiceLogEntry[] = [];
  private readonly noted: Set<string>;

  constructor(deps: VoiceRuntimeDeps) {
    this.deps = deps;
    this.noted = deps.noted ?? new Set<string>();
  }

  /** The pointing site's hint for the gesture it is about to dispatch. */
  hint(h: { hostile: boolean }): void {
    if (this.disposed) return;
    this.hostile = h.hostile;
    this.arm();
  }

  /** One intent from `intentListeners`; it joins the gesture in flight. */
  observe(intent: PlayerIntent): void {
    if (this.disposed) return;
    this.pending.push(intent);
    this.arm();
  }

  /** The tick's events: deaths get their radio calls. */
  onTick(events: readonly SimEvent[]): void {
    if (this.disposed) return;
    const at = this.deps.now();
    const { state, notes } = decideDeaths(this.state, events, this.deps.look, this.deps.languages, at);
    this.state = state;
    for (const note of notes) this.speak(at, 'death', 'death', note.cue, note.why);
  }

  /** GH-110: the tick's mission events, plus any announcement the app raises
   *  itself (a deadline warning), become at most one announcement. */
  onMission(events: readonly MissionEvent[], extra: readonly AnnounceInput[] = []): void {
    if (this.disposed || !this.deps.announcements) return;
    const labelOf = this.deps.labelOf ?? ((id: string) => id);
    const inputs = [...announceInputsOf(events, labelOf), ...extra];
    if (inputs.length === 0) return;
    const at = this.deps.now();
    const d = decideAnnouncements(this.announceState, inputs, this.deps.announcements, this.deps.announceLang ?? 'he', at);
    this.announceState = d.state;
    for (const note of d.notes) this.speak(at, 'announce', note.event, note.cue, note.why);
  }

  /** Copies of the ring, oldest first. */
  log(): VoiceLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  dispose(): void {
    this.disposed = true;
    this.pending = [];
    this.hostile = false;
  }

  private arm(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.deps.schedule(() => this.flush());
  }

  private flush(): void {
    this.scheduled = false;
    const intents = this.pending;
    const hostile = this.hostile;
    this.pending = [];
    this.hostile = false;
    if (this.disposed || intents.length === 0) return;
    const at = this.deps.now();
    const d = decideOrder(this.state, { intents, hostile }, this.deps.look, this.deps.languages, at);
    this.state = d.state;
    // A gesture nobody can voice (a selection, a civilian) is not a voiced
    // decision at all: nothing to log.
    if (d.why === 'silent:unvoiced') return;
    this.speak(at, 'order', d.trigger, d.cue, d.why);
  }

  private speak(at: number, source: VoiceLogEntry['source'], trigger: string | null, cue: VoiceCue | null, why: Why | AnnounceWhy): void {
    let status: VoiceStatus | null = null;
    if (cue && cue.trigger === 'announce') {
      // GH-110: caption always, from the cue's own i18n key -- the line's
      // wording is the house's, and the take (when one exists) only adds
      // sound. An empty audio key is "not recorded": nothing is handed to the
      // mixer at all and the status stays null. A key the mixer cannot play
      // (missing, still decoding, muted) leaves the caption standing alone.
      if (cue.key !== '') status = this.deps.play(cue).status;
      if (cue.caption !== undefined) {
        this.deps.caption(this.deps.text(cue.caption, cue.captionParams), cue.captionSeconds ?? PINNED_CAPTION_S, true);
      }
    } else if (cue) {
      const r = this.deps.play(cue);
      status = r.status;
      if (r.status === 'missing' && !this.noted.has(cue.key)) {
        this.noted.add(cue.key);
        this.deps.info(`[voice] ${cue.key}: no decoded line (not recorded yet, or still decoding), so nothing plays`);
      }
      if (r.status === 'played' && r.en !== null) {
        this.deps.caption(r.en, r.seconds);
      } else if ((r.status === 'missing' || r.status === 'placeholder') && cue.caption !== undefined) {
        // GH-262: the take doesn't exist yet, but the cue still names an
        // i18n key -- caption from that instead of the mixer's own `en`.
        this.deps.caption(this.deps.text(cue.caption), PINNED_CAPTION_S);
      }
    }
    this.entries.push({ at, source, trigger, key: cue?.key ?? null, why, status });
    if (this.entries.length > VOICE_LOG_SIZE) this.entries.splice(0, this.entries.length - VOICE_LOG_SIZE);
  }
}

/** The `?voicetick` placeholder (R-10): a dev build that asked for it, only. */
export function voicePlaceholderOn(params: URLSearchParams, dev: boolean): boolean {
  return dev && params.has('voicetick');
}
