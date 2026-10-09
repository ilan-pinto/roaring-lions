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
 *
 * Voice director v2 (AU-5, audio plan §5.1) adds two things here.
 *
 * Captions in step with what is voiced. The caption slot is one line, so it
 * follows the same ladder the mixer does (`VOICE_RANK`): a caption never
 * writes over a higher-ranked one while that one still stands, a line the
 * mixer dropped or a hush silenced shows nothing, and a line cut short takes
 * its caption with it when the line that cut it has none of its own.
 *
 * Intentional silence (`hush`). No bark for `HUSH.startMs` as the deploy gate
 * clears, nothing at or below a death call for `HUSH.majorMs` after a major
 * alert, and nothing at all after the outcome. A hushed decision is logged
 * and NOT committed to the director's state: a death the hush swallowed does
 * not start a throttle that would swallow the next one too.
 *
 * Neither arms a timer. Every window is a clock read on the next call, so
 * `dispose` has nothing to clear (the lesson of PR 446, kept by a test).
 */
import type { MissionEvent, SimEvent } from '@lions/sim';
import { isAnnouncementPriority, VOICE_RANK, type AnnouncementManifest, type VoiceResult, type VoiceStatus } from '@lions/render';
import { captionHoldMs } from '../ui/voice-caption';
import type { PlayerIntent } from '../input/intents';
import {
  INITIAL_ANNOUNCE,
  announceInputsOf,
  decideAnnouncements,
  hasPendingAnnouncement,
  type AnnounceInput,
  type AnnounceState,
  type AnnounceWhy,
} from './announce';
import {
  INITIAL_DIRECTOR,
  decideCalls,
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
  /** AU-5: take the caption down (`hud.clearCaption`) when the line it
   *  belongs to was cut short, or the mission is over. Absent, a caption
   *  simply runs out its own hold. */
  clearCaption?(): void;
}

/** AU-5: the intentional silences (audio plan §5.1), in wall-clock ms. */
export const HUSH = {
  /** No bark while the start cue and the title card own the moment. */
  startMs: 2000,
  /** Nothing at or below a death call after a major alert. */
  majorMs: 1500,
} as const;

/** What `hush` is told: the deploy gate cleared, a major alert sounded, or
 *  the verdict landed. */
export type HushReason = 'start' | 'major' | 'outcome';

/** One voiced decision, silent ones included. `status` is the mixer's answer,
 *  or `null` when the director chose silence and nothing was handed over. */
export interface VoiceLogEntry {
  at: number;
  source: 'order' | 'death' | 'announce';
  trigger: string | null;
  key: string | null;
  why: Why | AnnounceWhy | 'silent:hushed';
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
  /** AU-5: the hush windows, and whether the verdict has landed. */
  private barksQuietUntil = Number.NEGATIVE_INFINITY;
  private lowQuietUntil = Number.NEGATIVE_INFINITY;
  private ended = false;
  /** AU-5: the caption on screen -- its rank, when its hold runs out, and the
   *  mixer's id for the line it belongs to (null for one with no take). */
  private captionOwner: { rank: number; untilMs: number; voiceId: number | null; announce: boolean } | null = null;

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
    if (this.disposed || this.ended) return;
    const at = this.deps.now();
    const { state, notes } = decideDeaths(this.state, events, this.deps.look, this.deps.languages, at);
    if (!this.anyHushed(notes, at)) this.state = state;
    for (const note of notes) this.speak(at, 'death', 'death', note.cue, note.why);
    // Pass C2/C4 (A1): broken, immobilised, gun out -- after the deaths, so a
    // death call outranks a state call in the same tick's clocks.
    const calls = decideCalls(this.state, events, this.deps.look, this.deps.languages, at);
    if (!this.anyHushed(calls.notes, at)) this.state = calls.state;
    for (const note of calls.notes) this.speak(at, 'death', note.cue?.trigger ?? 'call', note.cue, note.why);
  }

  /**
   * AU-5's intentional silences. `start` as the deploy gate clears: no bark
   * for `HUSH.startMs`. `major` as a major alert sounds: nothing at or below a
   * death call for `HUSH.majorMs`. `outcome` as the verdict lands: nothing at
   * all from now on, and a bark's caption still standing goes with it.
   */
  hush(reason: HushReason): void {
    if (this.disposed) return;
    const now = this.deps.now();
    if (reason === 'start') this.barksQuietUntil = Math.max(this.barksQuietUntil, now + HUSH.startMs);
    else if (reason === 'major') this.lowQuietUntil = Math.max(this.lowQuietUntil, now + HUSH.majorMs);
    else {
      this.ended = true;
      this.pending = [];
      this.hostile = false;
      if (this.captionOwner !== null && !this.captionOwner.announce && now < this.captionOwner.untilMs) this.dropCaption();
    }
  }

  /** GH-110: the tick's mission events, plus any announcement the app raises
   *  itself (a deadline warning), become at most one announcement. */
  onMission(events: readonly MissionEvent[], extra: readonly AnnounceInput[] = []): void {
    if (this.disposed || this.ended || !this.deps.announcements) return;
    const labelOf = this.deps.labelOf ?? ((id: string) => id);
    const inputs = [...announceInputsOf(events, labelOf), ...extra];
    // AU-5: a quiet tick still asks when a gathered loss count is waiting
    // for its window to close.
    if (inputs.length === 0 && !hasPendingAnnouncement(this.announceState)) return;
    const at = this.deps.now();
    const d = decideAnnouncements(this.announceState, inputs, this.deps.announcements, this.deps.announceLang ?? 'he', at);
    // A hushed call is not spent: its cooldown does not start, and a gathered
    // loss count stays gathered until the hush is over.
    if (d.cue === null || !this.isHushed(d.cue, at)) this.announceState = d.state;
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
    if (this.disposed || this.ended || intents.length === 0) return;
    const at = this.deps.now();
    const d = decideOrder(this.state, { intents, hostile }, this.deps.look, this.deps.languages, at);
    if (d.cue === null || !this.isHushed(d.cue, at)) this.state = d.state;
    // A gesture nobody can voice (a selection, a civilian) is not a voiced
    // decision at all: nothing to log.
    if (d.why === 'silent:unvoiced') return;
    this.speak(at, 'order', d.trigger, d.cue, d.why);
  }

  private speak(at: number, source: VoiceLogEntry['source'], trigger: string | null, cue: VoiceCue | null, why: Why | AnnounceWhy): void {
    if (cue && this.isHushed(cue, at)) {
      this.record({ at, source, trigger, key: cue.key, why: 'silent:hushed', status: null });
      return;
    }
    let status: VoiceStatus | null = null;
    if (cue && cue.trigger === 'announce') {
      // GH-110: caption always, from the cue's own i18n key -- the line's
      // wording is the house's, and the take (when one exists) only adds
      // sound. An empty audio key is "not recorded": nothing is handed to the
      // mixer at all and the status stays null. A key the mixer cannot play
      // (missing, still decoding, muted) leaves the caption standing alone.
      const r = cue.key !== '' ? this.deps.play(cue) : null;
      status = r?.status ?? null;
      if (cue.caption !== undefined) {
        // AU-5: a take longer than the house hold keeps its caption up for as long as it speaks.
        const seconds = Math.max(cue.captionSeconds ?? PINNED_CAPTION_S, r?.status === 'played' ? r.seconds : 0);
        this.showCaption(at, cue, this.deps.text(cue.caption, cue.captionParams), seconds, r, true);
      } else if (r) this.afterCut(r, false);
    } else if (cue) {
      const r = this.deps.play(cue);
      status = r.status;
      if (r.status === 'missing' && !this.noted.has(cue.key)) {
        this.noted.add(cue.key);
        this.deps.info(`[voice] ${cue.key}: no decoded line (not recorded yet, or still decoding), so nothing plays`);
      }
      if (r.status === 'played' && r.en !== null) {
        this.showCaption(at, cue, r.en, r.seconds, r, false);
      } else if ((r.status === 'missing' || r.status === 'placeholder') && cue.caption !== undefined) {
        // GH-262: the take doesn't exist yet, but the cue still names an
        // i18n key -- caption from that instead of the mixer's own `en`.
        this.showCaption(at, cue, this.deps.text(cue.caption), PINNED_CAPTION_S, r, false);
      } else this.afterCut(r, false);
    }
    this.record({ at, source, trigger, key: cue?.key ?? null, why, status });
  }

  private record(entry: VoiceLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > VOICE_LOG_SIZE) this.entries.splice(0, this.entries.length - VOICE_LOG_SIZE);
  }

  /** AU-5: is this cue inside a hush? The outcome line itself never is. */
  private isHushed(cue: VoiceCue, at: number): boolean {
    if (cue.priority === 'outcome') return false;
    if (this.ended) return true;
    if (!isAnnouncementPriority(cue.priority) && at < this.barksQuietUntil) return true;
    return VOICE_RANK[cue.priority] <= VOICE_RANK.kdf_death && at < this.lowQuietUntil;
  }

  private anyHushed(notes: readonly { cue: VoiceCue | null }[], at: number): boolean {
    return notes.some((n) => n.cue !== null && this.isHushed(n.cue, at));
  }

  /**
   * AU-5: put a caption up, unless a higher-ranked one is still standing.
   * `always` is the announcement's (polish pass F, A5). Either way, a line
   * this one cut takes its caption with it if this one shows none.
   */
  private showCaption(at: number, cue: VoiceCue, text: string, seconds: number, r: VoiceResult | null, always: boolean): void {
    const rank = VOICE_RANK[cue.priority];
    const o = this.captionOwner;
    if (o !== null && at < o.untilMs && rank < o.rank) {
      if (r) this.afterCut(r, false);
      return;
    }
    if (always) this.deps.caption(text, seconds, true);
    else this.deps.caption(text, seconds);
    this.captionOwner = { rank, untilMs: at + captionHoldMs(seconds), voiceId: r?.id ?? null, announce: isAnnouncementPriority(cue.priority) };
  }

  /** AU-5: the mixer cut lines to play this one; if the caption on screen
   *  was one of theirs and this line put up none, it comes down. */
  private afterCut(r: VoiceResult, captioned: boolean): void {
    const o = this.captionOwner;
    if (captioned || o === null || o.voiceId === null) return;
    if (r.cutIds?.includes(o.voiceId)) this.dropCaption();
  }

  private dropCaption(): void {
    this.captionOwner = null;
    this.deps.clearCaption?.();
  }
}

/** The `?voicetick` placeholder (R-10): a dev build that asked for it, only. */
export function voicePlaceholderOn(params: URLSearchParams, dev: boolean): boolean {
  return dev && params.has('voicetick');
}
