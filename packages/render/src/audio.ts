// Battle audio. Two layers, one interface:
//   * recorded clips from data/audio.json when they exist, panned and
//     attenuated by where the event happened relative to the camera;
//   * a procedural WebAudio synth as the fallback, so the game is never
//     silent while the sound library is still being filled in.
//
// Presentation only (invariant 4): nothing here touches sim state, and
// variant choice draws from a *presentation* PRNG that is entirely separate
// from the sim's seeded streams — audio must never influence determinism
// (ART_PIPELINE §5).

import { WEAPON_CLASS, type Sim, type SimEvent } from '@lions/sim';
import { buildRadioChain, scheduleSquelch, type RadioChain, type Squelch } from './radio';

export { RADIO_BAND_HZ, RADIO_FX } from './radio';

/** Sound SOURCES started per `onEvents` call. Was `MAX_VOICES_PER_TICK`;
 *  renamed (R-19) because "voice" now means speech. */
const MAX_SOURCES_PER_TICK = 6;
/** Beyond this many tiles from the camera centre a sound is inaudible. */
const AUDIBLE_TILES = 26;

export interface AudioVariant {
  /** Primary encoding (OGG). */
  file: string;
  /** Same sound, alternate encoding for browsers that cannot decode `file`. */
  alt?: string;
  license?: string;
  source?: string;
  credit?: string;
}

export interface AudioSet {
  event: string;
  weapon_classes?: string[];
  gain?: number;
  pitch_jitter?: number;
  variants?: AudioVariant[];
}

export interface MusicTrack {
  file: string;
  alt?: string;
  title?: string;
  /** A level correction for this file alone, in dB, applied to the element's
   *  volume (polish pass F, F4): the theme's true peak reads +0.2 dBTP, so it
   *  carries -1.2. `pnpm validate:audio` re-measures it. */
  trim_db?: number;
  license?: string;
  source?: string;
  credit?: string;
}

export interface MusicSpec {
  /** Element volume on the menu screens, 0..1, multiplied by `master_gain`. */
  gain?: number;
  /** Element volume inside a mission (polish pass F, A10: 0.26 against the
   *  menu's 0.4). Absent reads as `gain`. */
  battle_gain?: number;
  /** Played in order and wrapped; a single track simply loops. */
  tracks?: MusicTrack[];
}

/** One recorded take (spec §6, D9): provenance plus `en`, the caption (R-18). */
export interface VoiceVariant extends AudioVariant {
  generator?: string;
  /** The line as spoken, in its own script. */
  text?: string;
  translit?: string;
  /** The English caption. */
  en?: string;
}

/** One key's takes. Declared empty (`variants: []`) is legal: that key plays
 *  nothing and reports `missing` (R-9). */
export interface VoiceLine {
  variants?: VoiceVariant[];
}

/** `data/audio.json`'s `voices` section. Keys are `<lang>.<class>.<trigger>`. */
export interface VoiceManifest {
  /** Line gain under the Voices slider (N11). */
  gain?: number;
  /** Faction -> language code. */
  languages?: Record<string, string>;
  lines?: Record<string, VoiceLine>;
  /** GH-110: the announcement table (`app`'s `voice/announce.ts` reads it). */
  announcements?: AnnouncementManifest;
}

/** One announcement (GH-110): a caption key now, an audio line key later. */
export interface AnnouncementDef {
  /** An i18n key, never text. */
  caption: string;
  /** A key in `voices.lines`, or empty while nothing is recorded (D5). */
  audio: string;
  /** Seconds before THIS announcement may speak again. */
  cooldown_s: number;
  /** high outranks normal outranks low. */
  priority: 'high' | 'normal' | 'low';
}

export interface AnnouncementManifest {
  /** Seconds a lower-priority announcement waits after a higher one spoke. */
  hold_s: number;
  /** Seconds a caption stays up. */
  caption_s: number;
  events: Record<string, AnnouncementDef>;
}

/** One ambience bed (polish pass F, A11): a seamless loop with its own
 *  level. `file`/`alt` as a clip's; `loop_s` and `channels` are written by
 *  tools/gen_audio.py and re-measured by `pnpm validate:audio`. */
export interface AmbienceBed extends AudioVariant {
  /** The bed's level on the `amb` bus, 0..1: it is heard at -34 LUFS. */
  gain?: number;
  loop_s?: number;
  channels?: number;
}

/** `data/audio.json`'s `ambience` section: bed id -> bed. */
export interface AmbienceSpec {
  beds?: Record<string, AmbienceBed>;
}

/** One critical event's sound (polish pass F, AU-1): a set name, or a
 *  deliberate silence with its reason. */
export type CueEntry = string | { silent: string };

export interface AudioManifest {
  version?: number;
  master_gain?: number;
  music?: MusicSpec;
  /** The ambience beds (A11), played on the `amb` bus. */
  ambience?: AmbienceSpec;
  sets?: Record<string, AudioSet>;
  /** Cue id -> set (AU-1). The app plays a cue by id through `playCue`,
   *  never by set name. `$comment` is allowed and ignored. */
  cues?: Record<string, CueEntry>;
  voices?: VoiceManifest;
}

/** Who wins a voice slot (N5): an order, then a KDF death, then an enemy death. */
export type VoicePriority = 'announce' | 'order' | 'kdf_death' | 'enemy_death';
/** N5's ranking as numbers; higher wins. */
export const VOICE_RANK: Readonly<Record<VoicePriority, number>> = { announce: 4, order: 3, kdf_death: 2, enemy_death: 1 };

/** A request to speak one line. `at` places it in the world; absent means the
 *  radio net, heard through the radio band (N13). */
export interface VoicePlay {
  key: string;
  priority: VoicePriority;
  at?: { x: number; y: number };
}

/** What became of a `VoicePlay`. `missing` is not an error (R-9). */
export type VoiceStatus =
  | 'played'
  | 'placeholder'
  | 'missing'
  | 'muted'
  | 'volume-zero'
  | 'dropped'
  | 'no-context'
  | 'too-far';

/** What `playVoice` did (N4, N5, R-9): status, length, caption, lines cut. */
export interface VoiceResult {
  status: VoiceStatus;
  /** How long the line lasts, 0 when nothing plays. */
  seconds: number;
  /** The caption, when the take carries one. */
  en: string | null;
  /** How many playing lines this one cut short (N4, N5). */
  cut: number;
}

/** The decode and playback readback (N16, R-10): languages, keys, bytes, budget. */
export interface VoiceStats {
  /** The roster's languages, sorted. */
  languages: string[];
  /** Voice keys with at least one decoded take. */
  keys: number;
  /** Decoded PCM held for voices, in bytes. */
  bytes: number;
  /** A take was skipped because it would have crossed the decode budget (N16). */
  overBudget: boolean;
  /** The dev placeholder tick is on (R-10). */
  placeholder: boolean;
  /** Lines playing now. */
  active: number;
}

/** Voices that may sound at once (N5). */
export const VOICE_CAP = 2;
/** Decoded voice PCM held at most, in bytes (N16). */
export const VOICE_DECODE_BUDGET_BYTES = 16 * 1024 * 1024;
/** One row of the mix's ducking table: what a trigger does to the layers
 *  under it while it sounds, as linear gains, and how fast. */
export interface DuckRow {
  readonly sfx: number;
  readonly music: number;
  /** The ambience bed (A11), on its own bus. */
  readonly amb: number;
  readonly attackS: number;
  readonly releaseS: number;
}

/**
 * The ducking table (polish pass F, docs/polish/audio-plan.md section 2.2).
 * Rows are triggers; each says what happens to combat SFX and the music while
 * it sounds. A cue's own bus is never in a row: a critical cue is information
 * and never loses to the bark it coincides with (the `cue` bus, below).
 *
 * - `bark` is N12, shipped: SFX -4 dB, music -3 dB, 80 / 300 ms.
 * - `announce`, a line on the radio net speaking for the mission: -6 / -6.
 * - `cue`, an objective cue or an important alert: -3 / -3, 20 / 250 ms.
 * - `major`, a major alert: -6 / -6, 20 / 500 ms.
 * - `outcome`, victory or defeat: SFX and music fade out over 600 ms under
 *   the stinger (the sim has stopped, only tails remain), and come back over
 *   2 s once the stinger and a breath after it are done.
 * - `pause`, the pause menu: music -6 dB, and every voice stops.
 *
 * The ambience column (A11): a bark leaves the bed alone, an announcement and
 * a major alert take it 3 dB down, an objective cue leaves it, the outcome
 * takes it 12 dB down (and keeps it there: `AMB_AFTER_OUTCOME`), and the pause
 * menu silences it -- the brief's "it stops on pause", where the plan's row had
 * -6 dB and a low-pass -- and `setPaused` then stops the source outright.
 * Deepest wins when rows overlap (`duckLevels`).
 */
export const DUCK_TABLE = {
  bark: { sfx: 0.631, music: 0.708, amb: 1, attackS: 0.08, releaseS: 0.3 },
  announce: { sfx: 0.501, music: 0.501, amb: 0.708, attackS: 0.08, releaseS: 0.4 },
  cue: { sfx: 0.708, music: 0.708, amb: 1, attackS: 0.02, releaseS: 0.25 },
  major: { sfx: 0.501, music: 0.501, amb: 0.708, attackS: 0.02, releaseS: 0.5 },
  outcome: { sfx: 0, music: 0, amb: 0.251, attackS: 0.6, releaseS: 2 },
  pause: { sfx: 1, music: 0.501, amb: 0, attackS: 0.15, releaseS: 0.3 },
} as const satisfies Record<string, DuckRow>;
export type DuckRowName = keyof typeof DUCK_TABLE;

/** The duck under a voice (N12): SFX -4 dB, music -3 dB, 80 ms in, 300 ms out. */
export const DUCK = DUCK_TABLE.bark;

/** Several rows at once: the deepest duck per layer wins, never a product --
 *  a bark over a major alert must not push combat further down than the
 *  alert alone does. No rows is no duck. */
export function duckLevels(rows: readonly DuckRow[]): { sfx: number; music: number; amb: number } {
  let sfx = 1;
  let music = 1;
  let amb = 1;
  for (const r of rows) {
    sfx = Math.min(sfx, r.sfx);
    music = Math.min(music, r.music);
    amb = Math.min(amb, r.amb);
  }
  return { sfx, music, amb };
}

/** After the outcome stinger's own hold lets go, the bed stays at the
 *  outcome's -12 dB until the mission is left: the place is still there under
 *  the verdict and the debrief, but the fight is over. Touches nothing else. */
export const AMB_AFTER_OUTCOME: DuckRow = { sfx: 1, music: 1, amb: DUCK_TABLE.outcome.amb, attackS: DUCK_TABLE.outcome.attackS, releaseS: 0.3 };
/** A bed fades in over this as the deploy gate clears (section 2.2's
 *  mission-start row: "fades in from -inf over 1.5 s"). */
export const AMB_FADE_IN_S = 1.5;
/** A bed fades out over this when it is stopped (teardown, mute, a new bed). */
export const AMB_FADE_OUT_S = 0.3;

/** What `setAmbience` did. `loading` will start the bed once it decodes. */
export type AmbienceResult = 'started' | 'loading' | 'stopped' | 'unknown' | 'muted' | 'paused' | 'no-context';

/** The ambience readback (tests, the sandbox): the bed asked for, the bed
 *  whose PCM is held, whether a source is sounding, and whether the pause
 *  menu holds it. */
export interface AmbienceState {
  bed: string | null;
  loaded: string | null;
  playing: boolean;
  paused: boolean;
}

/** Which ducking row a cue id brings with it, if any. */
export function cueDuckRow(id: string): DuckRowName | null {
  if (id === 'outcome.victory' || id === 'outcome.defeat') return 'outcome';
  if (id === 'alert.major') return 'major';
  if (id === 'alert.important' || id.startsWith('objective.')) return 'cue';
  return null;
}

/** After an outcome stinger starts, every other cue is held off this long:
 *  the verdict is the one sound (section 2.2, the outcome row). */
export const OUTCOME_CUE_BLOCK_S = 3;
/** The breath after the stinger before the music comes back. */
export const OUTCOME_HOLD_TAIL_S = 1;
/** How long the music takes to move between the menu and battle levels. */
export const MUSIC_SCENE_S = 2;

/** The music's scene: the menu screens, or inside a mission (A10). */
export type MusicScene = 'menu' | 'battle';

/** The element volume a scene asks for, before master, sliders and duck. */
export function musicSceneGain(spec: MusicSpec | undefined, scene: MusicScene): number {
  const menu = spec?.gain ?? 1;
  return scene === 'battle' ? (spec?.battle_gain ?? menu) : menu;
}

/** A track's `trim_db` as a linear factor; absent is unity. */
export function trimGain(db: number | undefined): number {
  return db === undefined ? 1 : Math.pow(10, db / 20);
}

/** What `playCue` did. `unmapped` is an id the manifest does not name: a
 *  coverage gap, which `cues.test.ts` exists to make impossible. */
export type CueResult = 'played' | 'silent' | 'unmapped' | 'blocked' | 'muted' | 'no-context';
/** The fade a cut line gets (N4). */
export const VOICE_CUT_S = 0.04;
/** The dev placeholder's pitch per trigger (R-10), none used by any other sound here. */
export const PLACEHOLDER_HZ = { move: 1318, attack: 1480, task: 1661, death: 1244, ack: 2093, verb: 1865 } as const;
/** The dev placeholder's length, in seconds (R-10). */
export const PLACEHOLDER_S = 0.12;
/** The dev placeholder's gain (R-10). */
export const PLACEHOLDER_GAIN = 0.15;
/** How often the music element's duck steps its volume, in ms (N12, R-2). */
export const MUSIC_DUCK_STEP_MS = 20;

/** N4 and N5 as one pure rule. `active` is oldest-first. */
export function admitVoice(
  active: readonly { id: number; priority: VoicePriority }[],
  incoming: VoicePriority,
  cap = VOICE_CAP
): { play: boolean; cut: number[] } {
  const cut: number[] = [];
  let rest = active;
  if (incoming === 'order') {
    for (const v of active) if (v.priority === 'order') cut.push(v.id);
    rest = active.filter((v) => v.priority !== 'order');
  }
  if (rest.length < cap) return { play: true, cut };
  let low = rest[0];
  for (const v of rest) if (VOICE_RANK[v.priority] < VOICE_RANK[low.priority]) low = v;
  // A tie loses to what is already speaking: a queued line describes the past.
  if (VOICE_RANK[low.priority] >= VOICE_RANK[incoming]) return { play: false, cut: [] };
  return { play: true, cut: [...cut, low.id] };
}

/** A linear ramp's value `elapsedMs` into it, holding `to` once it is over (N12). */
export function duckRamp(from: number, to: number, elapsedMs: number, durMs: number): number {
  if (elapsedMs >= durMs) return to;
  return from + ((to - from) * elapsedMs) / durMs;
}

/** Where a placed sound sits relative to the listener. */
export interface Placement {
  audible: boolean;
  gain: number;
  pan: number;
  lowpassHz: number;
}

/** `playSet`'s placement arithmetic, lifted verbatim so a placed voice and a
 *  battle clip cannot drift. `gain` excludes the set's own gain. */
export function placement(dx: number, dy: number): Placement {
  const dist = Math.hypot(dx, dy);
  if (dist > AUDIBLE_TILES) return { audible: false, gain: 0, pan: 0, lowpassHz: 0 };
  const atten = 1 - dist / AUDIBLE_TILES;
  return {
    audible: true,
    gain: atten * atten,
    // Screen-space left/right: in 2:1 dimetric, +x is right, +y is left.
    pan: Math.max(-1, Math.min(1, (dx - dy) / (AUDIBLE_TILES * 0.7))),
    // Distance dulls as well as quietens -- high frequencies go first.
    lowpassHz: 1200 + atten * atten * 12000,
  };
}

/** The dev tick's pitch for a key: its trigger's own, and one shared pitch for
 *  every order verb, so the ear can tell the line CLASS apart (R-10). */
function placeholderHz(key: string): number {
  const trigger = key.split('.')[2];
  switch (trigger) {
    case 'move':
    case 'attack':
    case 'task':
    case 'death':
    case 'ack':
      return PLACEHOLDER_HZ[trigger];
    default:
      return PLACEHOLDER_HZ.verb;
  }
}

/** One line sounding now. */
interface ActiveVoice {
  id: number;
  priority: VoicePriority;
  src: AudioScheduledSourceNode;
  /** The line's own gain, which a cut fades. */
  gain: GainNode;
  /** Every node the line made, its source first; disconnected when it ends. */
  nodes: AudioNode[];
  /** The line's click and static, when it went out with the radio effect (N19). */
  squelch: Squelch | null;
}

/**
 * The order `decodeAll` fetches and decodes a manifest's sets in: every `ui`
 * set first, then the rest, each group in manifest order.
 *
 * The garage uplift's parked item (c), as its final review re-scoped it. A
 * session's first gesture is what builds the AudioContext and starts
 * decoding, and on the garage that gesture is often the first Buy -- so with
 * thirty-odd battle clips ahead of them in manifest order, the purchase and
 * upgrade cues played their synth arms for as long as that decode took. They
 * are a few kilobytes and a screen can be waiting on them; the battle
 * library cannot be heard before a mission starts anyway. Building a context
 * at mount to decode sooner was rejected: that is a context before a gesture,
 * which is exactly what `ui:routes`' constructor count forbids.
 */
export function decodeOrder(sets: Record<string, AudioSet> | undefined): [string, AudioSet][] {
  const all = Object.entries(sets ?? {});
  return [...all.filter(([, s]) => s.event === 'ui'), ...all.filter(([, s]) => s.event !== 'ui')];
}

/** The user-facing levels the settings screen drives, each 0..1. */
export interface AudioGains {
  master: number;
  music: number;
  sfx: number;
  /** The Voices slider. Optional, and absent reads as 1 (R-11). */
  voice?: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * An `<audio>` element's volume: the manifest's own master level times the
 * track's own gain times the user's master and music sliders. Pure so the
 * settings screen (Task 4) and this module's tests can compute it without an
 * AudioContext.
 */
export function musicVolume(manifestMaster: number, trackGain: number, g: AudioGains): number {
  return clamp01(manifestMaster * trackGain * g.master * g.music);
}

/**
 * The three WebAudio bus gains: the master carries the manifest's own level
 * times the user's master slider, and the sfx and voice buses carry the
 * user's own slider alone (both sit under the master, so master attenuation
 * already applies once there). A gains object with no Voices slider reads it
 * as 1 (R-11).
 */
export function busGain(manifestMaster: number, g: AudioGains): { master: number; sfx: number; voice: number } {
  return { master: clamp01(manifestMaster * g.master), sfx: clamp01(g.sfx), voice: clamp01(g.voice ?? 1) };
}

/** A UI cue's gain, clamped. The manifest's own sanity check allows up to
 *  MAX_GAIN (1.5) because a battlefield one-shot is attenuated by distance
 *  before it is heard; a UI cue is not attenuated by anything, so 1.5 here is
 *  1.5 in the player's ears. */
export function uiSetGain(manifestSetGain: number): number {
  return Math.max(0, Math.min(1, manifestSetGain));
}

interface LoadedSet {
  gain: number;
  jitter: number;
  buffers: AudioBuffer[];
}

/** One voice key's decoded takes, with each take's caption and the PCM it holds. */
interface LoadedVoice {
  buffers: AudioBuffer[];
  en: (string | null)[];
  bytes: number;
}

/** A voice key's language: its first dot-separated part. */
const voiceLanguage = (key: string): string => key.split('.')[0] ?? '';

/** Camera position + zoom, supplied by the app so sounds can be placed. */
export interface Listener {
  x: number;
  y: number;
}

/**
 * Where the music was, so a full page load continues it rather than starting
 * over. Every screen here is its own document -- the menu, the campaign board
 * and a mission are links, not routes -- so without this the theme restarted
 * from the first bar on every navigation. sessionStorage on purpose: it is the
 * TAB's listening position, and a second tab is a fresh start.
 */
const MUSIC_POSITION_KEY = 'lions.music';
/** The mute preference. localStorage: `m` on one screen should hold on the next. */
const MUTE_KEY = 'lions.muted';
/** How often the position is written while playing, in seconds of track time. */
const POSITION_WRITE_INTERVAL = 1;

type Store = 'localStorage' | 'sessionStorage';

/**
 * Storage is optional everywhere here. jsdom under this vitest config exposes
 * a bare `{}` for it, a browser with site data blocked THROWS on the property
 * access itself, and a private window can hand back nothing -- so every read
 * and write is guarded and the music plays from the top when storage is gone.
 */
function readStore(store: Store, key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window[store]?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function writeStore(store: Store, key: string, value: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window[store]?.removeItem?.(key);
    else window[store]?.setItem?.(key, value);
  } catch {
    // Storage refused: the music simply does not carry over.
  }
}

interface MusicPosition {
  i: number;
  t: number;
}

function readPosition(): MusicPosition | null {
  const raw = readStore('sessionStorage', MUSIC_POSITION_KEY);
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const { i, t } = v as Record<string, unknown>;
    if (typeof i !== 'number' || typeof t !== 'number' || !Number.isFinite(t) || t < 0) return null;
    return { i: Math.max(0, Math.floor(i)), t };
  } catch {
    return null;
  }
}

function writePosition(i: number, t: number): void {
  writeStore('sessionStorage', MUSIC_POSITION_KEY, JSON.stringify({ i, t }));
}

/**
 * `play()` returns a promise in every browser and `undefined` in jsdom, whose
 * media elements are stubs. Swallow the rejection either way: autoplay being
 * refused is the expected path before the first gesture, not an error.
 */
function tryPlay(el: HTMLAudioElement): void {
  const p: unknown = el.play();
  if (p instanceof Promise) p.catch(() => {});
}

/** One synth note: frequency (Hz), length (s), waveform, gain, delay (ms). */
type SynthNote = readonly [number, number, OscillatorType, number, number];

/**
 * The synth stand-in for every UI and critical cue, used only while its clip
 * is not decoded. Each keeps its clip's SHAPE, so the player can tell them
 * apart with their back to the screen before the library arrives: an
 * objective rises when complete, falls when failed and stays level when new;
 * an alert falls, in one, two or three notes by tier; an outcome resolves up
 * or sinks.
 */
export const SYNTH_CUES: Readonly<Record<string, readonly SynthNote[]>> = {
  ui_purchase: [[196, 0.08, 'triangle', 0.06, 0], [294, 0.12, 'sine', 0.045, 70]],
  ui_upgrade: [[1175, 0.02, 'square', 0.02, 0], [1175, 0.02, 'square', 0.02, 35], [880, 0.1, 'sine', 0.045, 90]],
  // Bolt-on (GH-238 K10): a short rattle of four square pawl clicks, then a
  // low triangle clank landing on them. Not ui_upgrade's click-then-note
  // shape, and nowhere near the alert's falling pair.
  ui_kit_fitted: [
    [2600, 0.012, 'square', 0.02, 12],
    [2540, 0.012, 'square', 0.024, 37],
    [2480, 0.012, 'square', 0.028, 62],
    [2420, 0.012, 'square', 0.032, 87],
    [420, 0.09, 'triangle', 0.06, 150],
  ],
  ui_confirm: [[1320, 0.04, 'sine', 0.03, 0]],
  ui_deny: [[147, 0.06, 'square', 0.03, 0], [147, 0.07, 'square', 0.03, 100]],
  alert_minor: [[880, 0.06, 'triangle', 0.04, 0]],
  alert_important: [[520, 0.08, 'triangle', 0.06, 0], [390, 0.16, 'triangle', 0.05, 60]],
  alert_major: [[659, 0.12, 'triangle', 0.06, 0], [587, 0.12, 'triangle', 0.06, 200], [494, 0.3, 'triangle', 0.06, 400]],
  objective_new: [[784, 0.08, 'sine', 0.05, 70], [784, 0.12, 'sine', 0.05, 200]],
  objective_complete: [[660, 0.09, 'sine', 0.05, 0], [990, 0.12, 'sine', 0.045, 70]],
  objective_failed: [[440, 0.12, 'sine', 0.05, 0], [311, 0.2, 'sine', 0.05, 140]],
  mission_start: [[587, 0.12, 'sine', 0.045, 100], [880, 0.2, 'sine', 0.045, 240], [73, 0.6, 'triangle', 0.06, 400]],
  victory: [[294, 0.4, 'triangle', 0.05, 0], [440, 0.4, 'triangle', 0.05, 0], [370, 0.9, 'triangle', 0.05, 620]],
  defeat: [[294, 0.5, 'triangle', 0.05, 0], [220, 0.4, 'triangle', 0.05, 0], [208, 1.2, 'triangle', 0.05, 500]],
};

export class BattleAudio {
  private ctx: AudioContext | null = null;
  private muted = readStore('localStorage', MUTE_KEY) === '1';
  private master: GainNode | null = null;
  /** SFX bus, under the master: every synth/recorded source connects here, never to `master` directly. */
  private sfx: GainNode | null = null;
  /** The duck stage between the sfx bus and the master (N12). */
  private sfxDuck: GainNode | null = null;
  /** Voice bus, under the master, carrying the Voices slider (N11). */
  private voice: GainNode | null = null;
  /** The cue bus (polish pass F): every UI and critical cue, straight into
   *  the master and NOT under the sfx duck, so a voice line never ducks an
   *  objective chime. Rides the SFX slider; it has none of its own. */
  private cue: GainNode | null = null;
  /** The ambience bus (A11): the bed, under its own duck stage, into the
   *  master. Rides the SFX slider; it has none of its own (section 2.1). */
  private amb: GainNode | null = null;
  /** The duck stage under the amb bus: the duck table's ambience column. */
  private ambDuck: GainNode | null = null;
  /** The bed asked for (`setAmbience`), whether or not it is sounding. */
  private ambBed: string | null = null;
  /** The decoded bed, one at a time: a 40 s loop is ~8 MB of PCM. */
  private ambLoaded: { bed: string; buffer: AudioBuffer } | null = null;
  /** The bed sounding now: its source, its fade gain, and where in the loop
   *  it began (context time, offset), so a pause can resume where it was. */
  private ambSource: { src: AudioBufferSourceNode; gain: GainNode; at: number; offset: number } | null = null;
  /** Where in the loop a stopped bed resumes. */
  private ambOffset = 0;
  private ambPaused = false;
  /** The radio's shared paths (N13, N17): the band alone, the walkie-talkie
   *  chain, and the static's own band. All three feed the voice bus. */
  private radio: RadioChain | null = null;
  /** The walkie-talkie colour on unplaced lines (N17). Read once per line,
   *  at its start: flipping it re-routes the NEXT line and touches nothing
   *  that is sounding. */
  private radioFx = true;
  private masterGain = 0.9;
  /** The user's own master/music/sfx/voice sliders, from the settings screen (Task 4). */
  private user: AudioGains = { master: 1, music: 1, sfx: 1 };

  /** The manifest's `voices` section, when it has one. */
  private voices: VoiceManifest | null = null;
  /** The roster's languages: the only ones decoded (N16). */
  private voiceWanted = new Set<string>();
  /** voice key -> decoded takes. Absent means the line plays nothing. */
  private readonly voiceLines = new Map<string, LoadedVoice>();
  /** Decoded voice PCM held, in bytes. */
  private voiceBytes = 0;
  /** The latest voice pass skipped a line for the budget (N16). */
  private voiceOverBudget = false;
  /** Keys a pass left out for the budget. Not retried until bytes are freed:
   *  retrying sooner would decode them only to throw them away again. */
  private readonly voiceBudgetSkipped = new Set<string>();
  /** Take files that would not fetch or decode. Never retried this session:
   *  a 404 or an undecodable file does not change while the page is open. */
  private readonly voiceFailed = new Set<string>();
  private voicePlaceholder = false;
  /** The app's own build flag (`import.meta.env.DEV`), set by `setDev`. */
  private dev = false;
  /** The manifest's line gain, under the Voices slider (N11). */
  private voiceGain = 1;
  /** Lines sounding now, oldest first (N5). */
  private activeVoices: ActiveVoice[] = [];
  private nextVoiceId = 1;
  /** Squelches not yet at their own end, whether or not their words are
   *  still sounding: the tail outlives the line by up to RADIO_FX.tailS, and
   *  a stop in that window must silence it too. Pruned by `endsAt`. */
  private squelchTails: Squelch[] = [];
  /** The ducking rows holding the mix down now, by who holds them: `voice`
   *  for the lines sounding (bark or announce), and one per cue row. */
  private readonly holds = new Map<string, DuckRow>();
  /** When a timed hold lets go, by hold id. */
  private readonly holdTimers = new Map<string, number>();
  /** The later notes of a synth cue, each pending until it sounds. */
  private readonly toneTimers = new Set<number>();
  /** Context time before which only an outcome cue may sound. */
  private cueBlockUntil = 0;
  /** The music scene and its gain, which steps towards the scene's level. */
  private musicScene: MusicScene = 'menu';
  private musicSceneLevel: number | null = null;
  private musicSceneTimer: number | null = null;
  /** The music element's duck factor, 1 when no voice speaks (N12, R-2). */
  private musicDuck = 1;
  /** The music duck's next step, while one is ramping. */
  private musicDuckTimer: number | null = null;
  /** A thrown voice pass has been noted once already (R-9). */
  private voicePassNoted = false;
  /** The voice pass in flight; every new one chains after it, so two never
   *  run at once and a key is never decoded twice. It never rejects. */
  private voiceJob: Promise<void> = Promise.resolve();
  /** The decode the first gesture started. */
  private decoding: Promise<void> = Promise.resolve();

  /** set name → decoded clips. Empty/missing means "use the synth". */
  private readonly sets = new Map<string, LoadedSet>();
  /** event kind (+ weapon class) → set name. */
  private readonly byFireClass = new Map<number, string>();
  private readonly byEvent = new Map<string, string>();
  private manifest: AudioManifest | null = null;
  private baseUrl = '';

  /** Presentation PRNG — deliberately NOT the sim's. */
  private prng = 0x9e3779b9 | 0;

  private listener: Listener = { x: 0, y: 0 };

  /**
   * Background music. An `<audio>` element rather than a decoded buffer: a
   * three-minute track decodes to tens of megabytes of PCM, and the element
   * streams it and loops it for free. Not routed through the AudioContext —
   * nothing positional applies to it, so it needs none of the graph above.
   */
  private music: HTMLAudioElement | null = null;
  private musicIndex = 0;

  /** Browsers require a user gesture before audio starts. */
  attach(): void {
    const start = (): void => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.sfx = this.ctx.createGain();
        // The duck stage (N12) sits UNDER the sfx slider's own gain, so the
        // slider and the duck never fight over one AudioParam.
        this.sfxDuck = this.ctx.createGain();
        this.sfx.connect(this.sfxDuck).connect(this.master);
        this.voice = this.ctx.createGain();
        this.voice.connect(this.master);
        // The radio (N13, N17): every unplaced line enters one of its paths.
        // Built once here, both of them, so the settings toggle only ever
        // chooses between standing chains and never builds one mid-line.
        this.radio = buildRadioChain(this.ctx, this.voice);
        // The cue bus, after the radio so the four buses above keep their
        // places: into the master directly, never through the sfx duck.
        this.cue = this.ctx.createGain();
        this.cue.connect(this.master);
        // The ambience bus (A11), after the cue bus for the same reason: its
        // duck stage UNDER the slider's gain, like the sfx bus's.
        this.amb = this.ctx.createGain();
        this.ambDuck = this.ctx.createGain();
        this.amb.connect(this.ambDuck).connect(this.master);
        const bus = busGain(this.masterGain, this.user);
        this.master.gain.value = bus.master;
        this.sfx.gain.value = bus.sfx;
        this.voice.gain.value = bus.voice;
        this.cue.gain.value = bus.sfx;
        this.amb.gain.value = bus.sfx;
        this.decoding = this.decodeAll();
        // A bed asked for before the first gesture loads now.
        if (this.ambBed !== null) this.loadAmbience(this.ambBed);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.startMusic();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    // And once right now. A first visit is refused here and waits for the
    // gesture above, but a same-origin navigation the player clicked into is
    // allowed to keep sounding in Chromium, which is how the theme carries
    // from the home page into the campaign board and the mission unbroken.
    this.startMusic();
  }

  /**
   * Register the manifest. Decoding waits for the AudioContext (i.e. the
   * first user gesture); a file that is missing or will not decode is skipped
   * in silence (`fetchDecode` tries the `alt` encoding, then gives up) and its
   * set falls back to the synth rather than failing, so a half-filled library
   * still plays. Nothing is logged: the browser's own network 404 is the only
   * trace, and a console message here would fail `pnpm ui:routes`.
   */
  useManifest(manifest: AudioManifest, baseUrl: string): void {
    this.manifest = manifest;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.masterGain = manifest.master_gain ?? 0.9;
    this.voices = manifest.voices ?? null;
    this.voiceGain = clamp01(manifest.voices?.gain ?? 1);
    // A new manifest can name different files, or the same ones now present:
    // what the last one could not fetch, or could not fit, is not remembered.
    this.voiceFailed.clear();
    this.voiceBudgetSkipped.clear();
    // Re-apply the user's own sliders now that the manifest's level is known,
    // so the two compose whichever order they arrive in (a manifest can load
    // after the settings screen has already set gains, or before).
    this.setGains(this.user);
    for (const [name, spec] of Object.entries(manifest.sets ?? {})) {
      if (spec.event === 'fire') {
        for (const cls of spec.weapon_classes ?? []) {
          const idx = WEAPON_CLASS[cls];
          if (idx !== undefined) this.byFireClass.set(idx, name);
        }
      } else {
        this.byEvent.set(spec.event, name);
      }
    }
  }

  /**
   * Set the user's master/music/sfx sliders and apply them immediately to
   * whatever is live: the two WebAudio buses (if `attach()` has run) and the
   * music element's volume (if it exists). Safe to call before either does —
   * the values are simply stored and applied when they show up (`attach()`'s
   * `start`, `startMusic()`).
   */
  setGains(g: AudioGains): void {
    this.user = { master: clamp01(g.master), music: clamp01(g.music), sfx: clamp01(g.sfx) };
    // Kept absent when absent (R-11): `gains()` hands back what was given.
    if (g.voice !== undefined) this.user.voice = clamp01(g.voice);
    const bus = busGain(this.masterGain, this.user);
    if (this.master) this.master.gain.value = bus.master;
    if (this.sfx) this.sfx.gain.value = bus.sfx;
    if (this.voice) this.voice.gain.value = bus.voice;
    if (this.cue) this.cue.gain.value = bus.sfx;
    if (this.amb) this.amb.gain.value = bus.sfx;
    this.applyMusicVolume();
  }

  /** The music element's volume: the scene's level (menu or battle, A10)
   *  times the track's own trim, under the sliders, times the duck. */
  private musicLevel(): number {
    const spec = this.manifest?.music;
    const scene = this.musicSceneLevel ?? musicSceneGain(spec, this.musicScene);
    const trim = trimGain(spec?.tracks?.[this.musicIndex]?.trim_db);
    return musicVolume(this.masterGain, scene * trim, this.user) * this.musicDuck;
  }

  /**
   * Move the music to a scene's level (A10): the menu's 0.4 or a mission's
   * 0.26, stepped over MUSIC_SCENE_S like the duck, so a deploy never jumps.
   * Calling it with the scene already set does nothing.
   */
  setMusicScene(scene: MusicScene): void {
    if (scene === this.musicScene) return;
    const spec = this.manifest?.music;
    const from = this.musicSceneLevel ?? musicSceneGain(spec, this.musicScene);
    this.musicScene = scene;
    const to = musicSceneGain(spec, scene);
    if (this.musicSceneTimer !== null) window.clearTimeout(this.musicSceneTimer);
    this.musicSceneTimer = null;
    if (!this.music) {
      this.musicSceneLevel = null;
      return;
    }
    const ms = MUSIC_SCENE_S * 1000;
    let step = 0;
    const tick = (): void => {
      step++;
      const elapsed = step * MUSIC_DUCK_STEP_MS;
      this.musicSceneLevel = elapsed >= ms ? null : duckRamp(from, to, elapsed, ms);
      this.applyMusicVolume();
      this.musicSceneTimer = elapsed < ms ? window.setTimeout(tick, MUSIC_DUCK_STEP_MS) : null;
    };
    this.musicSceneLevel = from;
    this.musicSceneTimer = window.setTimeout(tick, MUSIC_DUCK_STEP_MS);
  }

  /** The music scene now. */
  musicSceneNow(): MusicScene {
    return this.musicScene;
  }

  private applyMusicVolume(): void {
    if (this.music) this.music.volume = this.musicLevel();
  }

  gains(): AudioGains {
    return { ...this.user };
  }

  /**
   * Decode in the order a player can need them (spec §7): every `ui` set,
   * then the roster's voice lines, then the battle library. A screen can be
   * waiting on a UI cue and an order can be waiting on a line; the battle
   * library cannot be heard before a mission starts.
   *
   * The ui sets and the voices decode TOGETHER, every ui fetch issued first
   * and in manifest order, and the battle library only once both are done.
   * They used to run one ui set at a time before the first voice was asked
   * for, which was harmless at two sets and was not at thirteen (polish pass
   * F): under SwiftShader every await waits behind a frame that can cost
   * seconds, and ui:routes measured the shipped ack still undecoded 83 s
   * after the first gesture -- the voice slot played its placeholder.
   */
  private async decodeAll(): Promise<void> {
    const ctx = this.ctx;
    const man = this.manifest;
    if (!ctx || !man) return;
    const order = decodeOrder(man.sets);
    const ui = order.filter(([, spec]) => spec.event === 'ui').map(([name, spec]) => this.decodeSet(ctx, name, spec));
    await Promise.all([...ui, this.queueVoiceDecode()]);
    for (const [name, spec] of order) if (spec.event !== 'ui') await this.decodeSet(ctx, name, spec);
  }

  /** One variant's buffer: the primary encoding, else `alt` (Safari cannot
   *  always decode OGG), else null. */
  private async fetchDecode(ctx: AudioContext, v: AudioVariant): Promise<AudioBuffer | null> {
    for (const url of [v.file, v.alt]) {
      if (!url) continue;
      try {
        const res = await fetch(`${this.baseUrl}${url}`);
        if (!res.ok) continue;
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        // Unplayable in this browser: try the alternate, else the synth.
      }
    }
    return null;
  }

  private async decodeSet(ctx: AudioContext, name: string, spec: AudioSet): Promise<void> {
    const buffers: AudioBuffer[] = [];
    for (const v of spec.variants ?? []) {
      const b = await this.fetchDecode(ctx, v);
      if (b) buffers.push(b);
    }
    if (buffers.length > 0) {
      this.sets.set(name, {
        gain: spec.gain ?? 1,
        jitter: spec.pitch_jitter ?? 0,
        buffers,
      });
    }
  }

  /** Decode whatever the roster wants and is not yet loaded, after any
   *  decode already in flight. */
  private queueVoiceDecode(): Promise<void> {
    // A pass that throws must not stall every pass after it, nor the battle
    // library that `decodeAll` decodes once this resolves. The lines it did
    // not reach stay undecoded, which is `missing` (R-9): nothing plays.
    this.voiceJob = this.voiceJob.then(() => this.decodeVoices()).catch(() => this.notePassThrown());
    return this.voiceJob;
  }

  /**
   * A thrown pass is information, not a fault (R-9): one `console.info` per
   * instance, and only in a dev session -- a dev build (`setDev`), or the
   * placeholder switch, which only a dev build can turn on (R-10).
   */
  private notePassThrown(): void {
    if (!(this.dev || this.voicePlaceholder) || this.voicePassNoted) return;
    this.voicePassNoted = true;
    console.info('[voice] a decode pass stopped early; the lines it did not reach play nothing until the next pass');
  }

  /**
   * Resolves once the decode the first gesture started, and every voice pass
   * queued since, has settled. Before a gesture there is none, and it
   * resolves at once. A readback for tests and the sandbox; playback never
   * waits on it.
   *
   * A test/dev drain ONLY. It does not settle while a fetch is stalled (a
   * fetch has no timeout here), so game code must never await it: a line
   * that has not decoded yet is `missing` (R-9), not something to wait for.
   */
  async decoded(): Promise<void> {
    await this.decoding.catch(() => {});
    let job: Promise<void>;
    do {
      job = this.voiceJob;
      await job;
    } while (job !== this.voiceJob);
  }

  /**
   * Decode the wanted languages' lines, in manifest order, within the budget
   * (N16). A take that would cross it is skipped and flagged rather than
   * kept: 16 MB of PCM is the ceiling, not a target.
   *
   * A pass does not stop at the ceiling. A take's size is known only once it
   * is decoded, and a shorter take later in the manifest can still fit; the
   * brief's rule is "skip the variant", not "stop". What stops the waste is
   * `voiceBudgetSkipped`: a key left out once is not decoded again until
   * bytes are freed. The battle library after this pass is not voice PCM and
   * is not held to this budget, so the ui -> voice -> battle order stands.
   */
  private async decodeVoices(): Promise<void> {
    this.voiceOverBudget = false;
    const ctx = this.ctx;
    const lines = this.voices?.lines;
    if (!ctx || !lines) return;
    for (const [key, line] of Object.entries(lines)) {
      const lang = voiceLanguage(key);
      if (!this.voiceWanted.has(lang) || this.voiceLines.has(key)) continue;
      if (this.voiceBudgetSkipped.has(key)) {
        // Still silent for the budget, so this pass is over it too.
        this.voiceOverBudget = true;
        continue;
      }
      const loaded: LoadedVoice = { buffers: [], en: [], bytes: 0 };
      let skipped = false;
      for (const v of line.variants ?? []) {
        if (this.voiceFailed.has(v.file)) continue;
        const b = await this.fetchDecode(ctx, v);
        if (!b) {
          this.voiceFailed.add(v.file);
          continue;
        }
        const bytes = b.length * b.numberOfChannels * 4;
        if (this.voiceBytes + loaded.bytes + bytes > VOICE_DECODE_BUDGET_BYTES) {
          this.voiceOverBudget = true;
          skipped = true;
          continue;
        }
        loaded.buffers.push(b);
        loaded.en.push(v.en ?? null);
        loaded.bytes += bytes;
      }
      // The roster can change while a key decodes; a language that left
      // meanwhile is not stored, so its bytes are never counted.
      if (!this.voiceWanted.has(lang)) continue;
      if (loaded.buffers.length === 0) {
        if (skipped) this.voiceBudgetSkipped.add(key);
        continue;
      }
      this.voiceLines.set(key, loaded);
      this.voiceBytes += loaded.bytes;
    }
  }

  /**
   * The languages the mission's roster speaks (N16): only these decode. A
   * language that joins decodes now (or at the first gesture, when there is no
   * context yet); one that leaves is freed at once.
   */
  setVoiceLanguages(langs: readonly string[]): void {
    this.voiceWanted = new Set(langs);
    let freed = 0;
    for (const [key, loaded] of this.voiceLines) {
      if (this.voiceWanted.has(voiceLanguage(key))) continue;
      this.voiceLines.delete(key);
      this.voiceBytes -= loaded.bytes;
      freed += loaded.bytes;
    }
    // Room under the budget again: what it kept out may fit now.
    if (freed > 0) this.voiceBudgetSkipped.clear();
    if (this.ctx) void this.queueVoiceDecode();
  }

  voiceStats(): VoiceStats {
    return {
      languages: [...this.voiceWanted].sort(),
      keys: this.voiceLines.size,
      bytes: this.voiceBytes,
      overBudget: this.voiceOverBudget,
      placeholder: this.voicePlaceholder,
      active: this.activeVoices.length,
    };
  }

  /** Whether this is a dev build: the app passes `import.meta.env.DEV`, which
   *  the render package cannot read for itself. Only the dev notes read it. */
  setDev(on: boolean): void {
    this.dev = on;
  }

  /** The walkie-talkie colour on unplaced lines (N17): on, the default, or
   *  the band alone. Takes effect from the next line. */
  setRadioEffect(on: boolean): void {
    this.radioFx = on;
  }

  radioEffect(): boolean {
    return this.radioFx;
  }

  /** The dev placeholder tick (R-10): a line with no take plays a tick instead. */
  setVoicePlaceholder(on: boolean): void {
    this.voicePlaceholder = on;
  }

  setListener(l: Listener): void {
    this.listener = l;
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggle(): boolean {
    this.muted = !this.muted;
    writeStore('localStorage', MUTE_KEY, this.muted ? '1' : null);
    // Pause rather than zero the volume: a muted player is not paying to
    // stream and decode a track nobody hears, and unmuting resumes where it
    // stopped instead of mid-bar somewhere else.
    if (this.music) {
      if (this.muted) this.music.pause();
      else tryPlay(this.music);
    }
    // `m` is one flag the HUD reports as "audio muted" -- a line left
    // sounding (and its duck still held) through a mute would make that
    // claim false the moment a voice was speaking when the player pressed it.
    if (this.muted) this.stopVoices();
    // The bed is a running source, not a one-shot that checks the flag: stop
    // it, and start it again on unmute.
    if (this.muted) this.stopAmbienceSource(AMB_FADE_OUT_S);
    else this.startAmbience(AMB_FADE_OUT_S);
    return this.muted;
  }

  /**
   * Start the manifest's music, or resume it. Creating the element happens
   * once; every later call is a cheap "play it if it should be playing", which
   * is what the gesture path needs when the boot-time attempt was refused.
   * Tracks play in manifest order and wrap, which for the usual single track
   * is a plain loop. A track that will not load or play is skipped rather
   * than fatal, in the same spirit as a missing clip falling back to the
   * synth: the game must never depend on music to run.
   */
  private startMusic(): void {
    if (this.music) {
      if (!this.muted && this.music.paused) tryPlay(this.music);
      return;
    }
    const spec = this.manifest?.music;
    const tracks = spec?.tracks ?? [];
    if (tracks.length === 0) return;
    const el = new Audio();
    el.preload = 'auto';
    el.volume = this.musicLevel();
    el.loop = tracks.length === 1;

    // Where the previous document left off, if this tab has one.
    const saved = readPosition();
    let resumeAt = saved && saved.i < tracks.length ? saved.t : 0;
    const startIndex = saved && saved.i < tracks.length ? saved.i : 0;

    const cue = (i: number): void => {
      this.musicIndex = ((i % tracks.length) + tracks.length) % tracks.length;
      el.src = `${this.baseUrl}${tracks[this.musicIndex].file}`;
      if (!this.muted) tryPlay(el);
    };
    // Seeking before metadata is unreliable across browsers; seek once it is
    // known, and only for the document's first cue -- a wrapped track starts
    // from its own top.
    el.addEventListener('loadedmetadata', () => {
      if (resumeAt > 0 && resumeAt < el.duration) el.currentTime = resumeAt;
      resumeAt = 0;
    });
    let lastWrite = -POSITION_WRITE_INTERVAL;
    el.addEventListener('timeupdate', () => {
      if (el.currentTime - lastWrite < POSITION_WRITE_INTERVAL && el.currentTime >= lastWrite) return;
      lastWrite = el.currentTime;
      writePosition(this.musicIndex, el.currentTime);
    });
    // `pagehide` is the last reliable moment before the next document; the
    // throttled write above can be up to a second stale by then.
    window.addEventListener('pagehide', () => writePosition(this.musicIndex, el.currentTime));
    el.addEventListener('ended', () => cue(this.musicIndex + 1));
    el.addEventListener('error', () => {
      // Every track failing would spin here forever; stop after one lap.
      if (this.musicIndex + 1 < tracks.length) cue(this.musicIndex + 1);
    });
    // Parented and hidden rather than left detached: a detached element plays
    // just as well, but then nothing outside this class can tell whether the
    // music is playing, paused or failed. `document.querySelector('audio')` is
    // the readback, the same way the cursor is read from `canvas.dataset`.
    el.hidden = true;
    document.body.appendChild(el);
    this.music = el;
    cue(startIndex);
  }

  /** xorshift — presentation randomness only. */
  private rand(): number {
    let x = this.prng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.prng = x | 0;
    return ((x >>> 0) % 100000) / 100000;
  }

  /**
   * Play a cue that is about the PLAYER rather than about a place -- an alert,
   * an objective landing. No panner, no distance attenuation and no lowpass:
   * every one of those asks "where is this", and the answer for a HUD cue is
   * "nowhere". That is the whole reason this is not `playSet` with a listener
   * position of its own -- `playSet`'s first act is a distance early-out
   * (`dist > AUDIBLE_TILES`), so a cue routed through it would go silent the
   * moment the camera was far from the origin.
   *
   * Falls back to the synth when the set ships no clips, exactly as every
   * battlefield event already does. Safe before `attach()`: with no context
   * there is nothing to play and nothing to complain about.
   */
  playUi(setName: string): number {
    // Mute first, and HERE rather than at the call site. `m` toggles one flag
    // and the HUD says "audio muted" on the strength of it, so a sound that
    // checked the flag only at some of its callers would make that line a lie
    // the moment a new caller appeared. The gain buses cannot stand in for
    // it: they are driven by the volume sliders alone, and mute is not a
    // volume. Returns how long the cue sounds, 0 when nothing plays.
    if (this.muted) return 0;
    const ctx = this.ctx;
    const bus = this.cue;
    if (!ctx || !bus) return 0;
    const set = this.sets.get(setName);
    if (set && set.buffers.length > 0) {
      const src = ctx.createBufferSource();
      const buffer = set.buffers[Math.floor(this.rand() * set.buffers.length)];
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = uiSetGain(set.gain);
      src.connect(g).connect(bus);
      src.start();
      return buffer.duration;
    }
    // No clip decoded (not shipped, or the first gesture's decode has not
    // reached it): the synth stands in, in the cue's own shape, so a missing
    // file never sounds like some other cue. An unknown name falls to the
    // important alert's fall, as every unknown UI name always has.
    const shape = SYNTH_CUES[setName] ?? SYNTH_CUES.alert_important;
    let seconds = 0;
    for (const [freq, dur, type, gain, delayMs] of shape) {
      if (delayMs === 0) this.tone(freq, dur, type, gain, bus);
      else {
        const id = window.setTimeout(() => {
          this.toneTimers.delete(id);
          this.tone(freq, dur, type, gain, bus);
        }, delayMs);
        this.toneTimers.add(id);
      }
      seconds = Math.max(seconds, delayMs / 1000 + dur);
    }
    return seconds;
  }

  /**
   * Play a critical cue by its id (polish pass F, AU-1): `outcome.victory`,
   * `objective.failed`, `alert.major`, `ui.deny`... The manifest's `cues`
   * table names the set, so the app never spells one; an id mapped to
   * `{ silent }` is a decision, and plays nothing.
   *
   * The mix comes with it (section 2.2): an objective cue or an important
   * alert holds SFX and music 3 dB down for its length, a major alert 6 dB,
   * and an outcome stinger stops every voice, fades SFX and music out under
   * itself and holds every other cue off for OUTCOME_CUE_BLOCK_S. The cue
   * itself is on its own bus, so nothing it triggers can duck it.
   */
  playCue(id: string): CueResult {
    const entry = id.startsWith('$') ? undefined : this.manifest?.cues?.[id];
    if (entry === undefined) return 'unmapped';
    if (typeof entry !== 'string') return 'silent';
    if (this.muted) return 'muted';
    const ctx = this.ctx;
    if (!ctx) return 'no-context';
    const row = cueDuckRow(id);
    if (row !== 'outcome' && ctx.currentTime < this.cueBlockUntil) return 'blocked';
    if (row === 'outcome') {
      this.stopVoices();
      this.cueBlockUntil = ctx.currentTime + OUTCOME_CUE_BLOCK_S;
      this.setHold('ambience-outcome', AMB_AFTER_OUTCOME);
    }
    const seconds = this.playUi(entry);
    if (row !== null) this.holdFor(row, row, seconds + (row === 'outcome' ? OUTCOME_HOLD_TAIL_S : 0));
    return 'played';
  }

  /**
   * The pause menu (section 2.2's pause row): every voice stops -- a paused
   * line describes a moment that has frozen -- and the music steps down
   * 6 dB until the menu closes. Idempotent both ways.
   */
  setPaused(on: boolean): void {
    if (on) {
      this.stopVoices();
      this.setHold('pause', DUCK_TABLE.pause);
      // The bed STOPS (A11): the duck takes it to silence over the row's
      // attack, and the source ends there, remembering where it was.
      this.ambPaused = true;
      this.stopAmbienceSource(DUCK_TABLE.pause.attackS);
    } else {
      this.setHold('pause', null);
      if (this.ambPaused) {
        this.ambPaused = false;
        this.startAmbience(DUCK_TABLE.pause.releaseS);
      }
    }
  }

  /**
   * Let go of every timer the mixer owns: the music scene and duck steps, the
   * cue holds and the pending notes of a synth cue. A timer that outlives its
   * owner fires into whatever is left (a torn-down test environment threw
   * "window is not defined" and turned the gates job red), so a screen that
   * is done with the mixer calls this. Idempotent, and safe before `attach()`.
   */
  dispose(): void {
    if (this.musicSceneTimer !== null) window.clearTimeout(this.musicSceneTimer);
    this.musicSceneTimer = null;
    if (this.musicDuckTimer !== null) window.clearTimeout(this.musicDuckTimer);
    this.musicDuckTimer = null;
    for (const t of this.holdTimers.values()) window.clearTimeout(t);
    this.holdTimers.clear();
    for (const t of this.toneTimers) window.clearTimeout(t);
    this.toneTimers.clear();
  }

  /**
   * A mission is over or left: every cue hold and block lets go, voices stop,
   * and the music goes back to the menu's level. The router's teardown calls
   * this; so does nothing else.
   */
  leaveMission(): void {
    this.stopVoices();
    this.setAmbience(null);
    for (const id of [...this.holds.keys()]) this.setHold(id, null);
    this.cueBlockUntil = 0;
    this.setMusicScene('menu');
  }

  /**
   * The ambience bed (A11): one loop per kind of ground, asked for by id as
   * the deploy gate clears (the app picks it from the map), on the `amb` bus.
   * It fades in over AMB_FADE_IN_S, loops seamlessly until the mission is
   * left (`leaveMission` calls this with null), stops on the pause menu and
   * on mute, and comes back on resume and unmute.
   *
   * Decoded on demand and one at a time -- a bed is only ever wanted inside
   * a mission, and a 40 s loop is ~8 MB of PCM. Safe before `attach()`: the
   * id is remembered and loads with the first gesture's context.
   */
  setAmbience(bed: string | null): AmbienceResult {
    if (bed === null) {
      this.ambBed = null;
      this.ambPaused = false;
      this.stopAmbienceSource(AMB_FADE_OUT_S);
      this.ambLoaded = null;
      this.ambOffset = 0;
      return 'stopped';
    }
    const spec = this.manifest?.ambience?.beds?.[bed];
    if (!spec || bed.startsWith('$')) return 'unknown';
    if (this.ambBed === bed && this.ambSource) return 'started';
    this.stopAmbienceSource(AMB_FADE_OUT_S);
    this.ambBed = bed;
    if (this.ambLoaded?.bed !== bed) {
      this.ambLoaded = null;
      this.ambOffset = -1; // a fresh bed starts at a random place in its loop
    }
    if (!this.ctx) return 'no-context';
    if (this.ambLoaded) return this.startAmbience(AMB_FADE_IN_S);
    this.loadAmbience(bed);
    return this.muted ? 'muted' : 'loading';
  }

  ambienceState(): AmbienceState {
    return { bed: this.ambBed, loaded: this.ambLoaded?.bed ?? null, playing: this.ambSource !== null, paused: this.ambPaused };
  }

  /** Fetch and decode a bed, then start it if it is still the one wanted. */
  private loadAmbience(bed: string): void {
    const ctx = this.ctx;
    const spec = this.manifest?.ambience?.beds?.[bed];
    if (!ctx || !spec) return;
    void this.fetchDecode(ctx, spec).then((buffer) => {
      // Left, or another bed asked for, while this decoded: drop it.
      if (this.ambBed !== bed || !buffer) return;
      this.ambLoaded = { bed, buffer };
      this.startAmbience(AMB_FADE_IN_S);
    });
  }

  /** Start the wanted, decoded bed looping, fading in over `fadeS`, unless
   *  muted, paused or already sounding. */
  private startAmbience(fadeS: number): AmbienceResult {
    const ctx = this.ctx;
    const bus = this.amb;
    const loaded = this.ambLoaded;
    if (!ctx || !bus) return 'no-context';
    if (this.muted) return 'muted';
    if (this.ambPaused) return 'paused';
    if (!loaded || loaded.bed !== this.ambBed) return 'loading';
    if (this.ambSource) return 'started';
    const duration = loaded.buffer.duration;
    if (this.ambOffset < 0) this.ambOffset = this.rand() * duration;
    const offset = duration > 0 ? this.ambOffset % duration : 0;
    const src = ctx.createBufferSource();
    src.buffer = loaded.buffer;
    src.loop = true;
    const g = ctx.createGain();
    const level = clamp01(this.manifest?.ambience?.beds?.[loaded.bed]?.gain ?? 1);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + fadeS);
    src.connect(g).connect(bus);
    src.start(t, offset);
    this.ambSource = { src, gain: g, at: t, offset };
    return 'started';
  }

  /** Fade the sounding bed out over `fadeS` and stop it there, remembering
   *  where in the loop it was. The bed stays wanted. */
  private stopAmbienceSource(fadeS: number): void {
    const ctx = this.ctx;
    const s = this.ambSource;
    if (!ctx || !s) return;
    this.ambSource = null;
    const t = ctx.currentTime;
    const duration = s.src.buffer?.duration ?? 0;
    this.ambOffset = duration > 0 ? (s.offset + (t - s.at)) % duration : 0;
    s.gain.gain.cancelScheduledValues(t);
    s.gain.gain.setValueAtTime(s.gain.gain.value, t);
    s.gain.gain.linearRampToValueAtTime(0, t + fadeS);
    s.src.stop(t + fadeS);
    const nodes: AudioNode[] = [s.src, s.gain];
    s.src.onended = () => {
      for (const n of nodes) n.disconnect();
    };
  }

  /**
   * Speak one line (WP-AU1 §7). Unplaced lines go through the radio band
   * (N13); a placed one -- an enemy death -- sits in the world like a battle
   * clip, on the voice bus so the Voices slider still owns it (R-14). Two
   * lines at most (N5); a new order cuts the last order (N4); every line
   * ducks sfx and music until the last one ends (N12).
   *
   * The status order is part of the contract: nothing is made, and nothing
   * ducks, for a line nobody can hear.
   */
  playVoice(p: VoicePlay): VoiceResult {
    const none = (status: VoiceStatus): VoiceResult => ({ status, seconds: 0, en: null, cut: 0 });
    // Mute first, and HERE, for playUi's reason: `m` is one flag the HUD reports.
    if (this.muted) return none('muted');
    const ctx = this.ctx;
    const bus = this.voice;
    const radio = this.radio;
    // A context can exist and still not be running -- suspended until the
    // browser's autoplay gate lifts, same as `onEvents` already guards (N16's
    // sibling check): a line scheduled against a clock that is not advancing
    // would hold a slot and a duck for audio that never actually sounds.
    if (!ctx || !bus || !radio || ctx.state !== 'running') return none('no-context');
    if ((this.user.voice ?? 1) === 0 || this.user.master === 0) return none('volume-zero');
    const place = p.at ? placement(p.at.x - this.listener.x, p.at.y - this.listener.y) : null;
    if (place && !place.audible) return none('too-far');
    const line = this.voiceLines.get(p.key);
    // Not recorded, or not decoded yet: both play nothing (R-9). The tick
    // stands in only when a dev session asked for it (R-10).
    if (!line && !this.voicePlaceholder) return none('missing');
    const admit = admitVoice(this.activeVoices, p.priority);
    if (!admit.play) return none('dropped');
    for (const id of admit.cut) this.cutVoice(id);

    const t = ctx.currentTime;
    const take = line ? Math.floor(this.rand() * line.buffers.length) : 0;
    const seconds = line ? line.buffers[take].duration : PLACEHOLDER_S;
    // The walkie-talkie colour (N17): unplaced lines only, and only when the
    // setting is on AS THIS LINE STARTS. The click and static are made first
    // so the line's own source is the last one created.
    const squelch = !place && this.radioFx ? scheduleSquelch(ctx, radio, t, seconds, this.rand()) : null;
    const at = squelch ? squelch.lineAt : t;

    const g = ctx.createGain();
    g.gain.value = (line ? this.voiceGain : PLACEHOLDER_GAIN) * (place ? place.gain : 1);
    let head: AudioNode = g;
    /** The line's own nodes, let go of when it ends or is cut. */
    const nodes: AudioNode[] = [g];
    if (place) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = place.lowpassHz;
      const pan = ctx.createStereoPanner();
      pan.pan.value = place.pan;
      lp.connect(pan).connect(g).connect(bus);
      head = lp;
      nodes.push(lp, pan);
    } else {
      g.connect(squelch ? radio.fx : radio.clean);
    }

    let src: AudioScheduledSourceNode;
    let en: string | null = null;
    if (line) {
      const b = ctx.createBufferSource();
      b.buffer = line.buffers[take];
      en = line.en[take] ?? null;
      src = b;
    } else {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = placeholderHz(p.key);
      src = o;
    }
    src.connect(head);
    nodes.unshift(src);
    const id = this.nextVoiceId++;
    this.activeVoices.push({ id, priority: p.priority, src, gain: g, nodes, squelch });
    if (squelch) {
      this.squelchTails = this.squelchTails.filter((q) => q.endsAt > ctx.currentTime);
      this.squelchTails.push(squelch);
    }
    src.onended = () => {
      // The line's own nodes are one-shots too: let go of them with it.
      for (const n of nodes) n.disconnect();
      this.voiceEnded(id);
    };
    src.start(at);
    if (!line) src.stop(at + PLACEHOLDER_S);
    this.voiceHold();
    return { status: line ? 'played' : 'placeholder', seconds, en, cut: admit.cut.length };
  }

  /** Fade every line out and let go of the duck: a mission leave. */
  stopVoices(): void {
    for (const v of [...this.activeVoices]) this.cutVoice(v.id);
    // Lines whose words already ended may still be sounding their tail.
    const ctx = this.ctx;
    if (ctx) {
      const t = ctx.currentTime;
      for (const q of this.squelchTails) if (q.endsAt > t) q.cut(t, VOICE_CUT_S);
    }
    this.squelchTails = [];
    this.setHold('voice', null);
  }

  /** Cut one line short with a VOICE_CUT_S fade (N4). */
  private cutVoice(id: number): void {
    const i = this.activeVoices.findIndex((v) => v.id === id);
    const ctx = this.ctx;
    if (i < 0 || !ctx) return;
    const [v] = this.activeVoices.splice(i, 1);
    const t = ctx.currentTime;
    // A cut line is not an ending: it must not release the duck under the
    // line that replaced it. Its nodes still have to be let go of.
    const nodes = v.nodes;
    v.src.onended = () => {
      for (const n of nodes) n.disconnect();
    };
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + VOICE_CUT_S);
    v.src.stop(t + VOICE_CUT_S);
    if (v.squelch) {
      v.squelch.cut(t, VOICE_CUT_S);
      this.squelchTails = this.squelchTails.filter((q) => q !== v.squelch);
    }
  }

  private voiceEnded(id: number): void {
    this.activeVoices = this.activeVoices.filter((v) => v.id !== id);
    this.voiceHold();
  }

  /** The voices' own row: an announcement's while one is sounding, a bark's
   *  otherwise, none once the last line ends (N12). */
  private voiceHold(): void {
    if (this.activeVoices.length === 0) return this.setHold('voice', null);
    const announcing = this.activeVoices.some((v) => v.priority === 'announce');
    this.setHold('voice', announcing ? DUCK_TABLE.announce : DUCK_TABLE.bark);
  }

  /** Hold a row for `seconds`, then let it go; a second call restarts it. */
  private holdFor(id: string, row: DuckRowName, seconds: number): void {
    const prev = this.holdTimers.get(id);
    if (prev !== undefined) window.clearTimeout(prev);
    this.setHold(id, DUCK_TABLE[row]);
    this.holdTimers.set(
      id,
      window.setTimeout(() => {
        this.holdTimers.delete(id);
        this.setHold(id, null);
      }, Math.max(0, seconds) * 1000)
    );
  }

  /**
   * Set or clear one hold, and move the mix to what every hold still standing
   * asks for (`duckLevels`). A hold that is already the row asked for is left
   * alone, so a duck already applied is re-used, never re-triggered (no
   * pumping). Going down takes the new row's attack; coming back up takes the
   * released row's release.
   */
  private setHold(id: string, row: DuckRow | null): void {
    const was = this.holds.get(id) ?? null;
    if (was === row) return;
    if (row === null) {
      this.holds.delete(id);
      const timer = this.holdTimers.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      this.holdTimers.delete(id);
    } else {
      this.holds.set(id, row);
    }
    const target = duckLevels([...this.holds.values()]);
    const seconds = row !== null ? row.attackS : (was?.releaseS ?? 0);
    const ctx = this.ctx;
    const d = this.sfxDuck;
    if (ctx && d) {
      const t = ctx.currentTime;
      d.gain.cancelScheduledValues(t);
      d.gain.setValueAtTime(d.gain.value, t);
      d.gain.linearRampToValueAtTime(target.sfx, t + seconds);
    }
    const a = this.ambDuck;
    if (ctx && a) {
      const t = ctx.currentTime;
      a.gain.cancelScheduledValues(t);
      a.gain.setValueAtTime(a.gain.value, t);
      a.gain.linearRampToValueAtTime(target.amb, t + seconds);
    }
    this.rampMusic(target.music, seconds * 1000);
  }

  /**
   * Step the music element's duck towards `to` over `ms`. The element is not
   * in the AudioContext, so it has no AudioParam to automate (R-2): its volume
   * is stepped every MUSIC_DUCK_STEP_MS instead. Steps are counted rather than
   * timed from a clock, so fake timers drive it exactly.
   */
  private rampMusic(to: number, ms: number): void {
    if (this.musicDuckTimer !== null) window.clearTimeout(this.musicDuckTimer);
    this.musicDuckTimer = null;
    if (!this.music) {
      this.musicDuck = to;
      return;
    }
    const from = this.musicDuck;
    let step = 0;
    const tick = (): void => {
      step++;
      const elapsed = step * MUSIC_DUCK_STEP_MS;
      this.musicDuck = duckRamp(from, to, elapsed, ms);
      this.applyMusicVolume();
      this.musicDuckTimer = elapsed < ms ? window.setTimeout(tick, MUSIC_DUCK_STEP_MS) : null;
    };
    this.musicDuckTimer = window.setTimeout(tick, MUSIC_DUCK_STEP_MS);
  }

  onEvents(events: SimEvent[], sim: Sim): void {
    if (this.muted || this.ctx === null || this.ctx.state !== 'running') return;
    const st = sim.state;
    let voices = 0;
    for (const e of events) {
      if (voices >= MAX_SOURCES_PER_TICK) break;
      const at = (id: number): [number, number] => [st.posX[id] / 65536, st.posY[id] / 65536];

      if (e.kind === 'fire') {
        const type = sim.unitTypes[st.typeIdx[e.shooter]];
        const w = type.weapons.find((x) => x.id === e.weaponId);
        const cls = w?.cls ?? WEAPON_CLASS.small_arms;
        voices++;
        const [x, y] = at(e.shooter);
        if (!this.playSet(this.byFireClass.get(cls), x, y)) this.synthFire(cls);
      } else if (e.kind === 'impact') {
        voices++;
        const [x, y] = at(e.target);
        const set = e.penetrated ? this.byEvent.get('penetration') : this.byEvent.get('ricochet');
        if (!this.playSet(set, x, y)) {
          if (e.penetrated) {
            this.tone(1500, 0.06, 'square', 0.03);
            this.tone(500, 0.1, 'sawtooth', 0.03);
          } else {
            this.tone(2600, 0.05, 'square', 0.02);
          }
        }
      } else if (e.kind === 'nearMiss') {
        voices++;
        const x = e.x / 65536;
        const y = e.y / 65536;
        if (!this.playSet(this.byEvent.get('near_miss'), x, y)) this.noise(0.09, 300, 0.015);
      } else if (e.kind === 'aps' && e.intercepted) {
        voices++;
        const [x, y] = at(e.target);
        if (!this.playSet(this.byEvent.get('aps_intercept'), x, y)) this.sweep(2200, 300, 0.09, 0.035);
      } else if (e.kind === 'destroyed') {
        voices++;
        const [x, y] = at(e.entity);
        if (!this.playSet(this.byEvent.get('destroyed'), x, y)) {
          this.tone(55, 0.7, 'triangle', 0.09);
          this.noise(0.5, 180, 0.06);
        }
      }
    }
  }

  /**
   * Play a clip from `setName` at a world position. Returns false when no
   * recording is loaded for it, so the caller can fall back to the synth.
   */
  private playSet(setName: string | undefined, wx: number, wy: number): boolean {
    const ctx = this.ctx;
    const sfx = this.sfx;
    if (!ctx || !sfx || !setName) return false;
    const set = this.sets.get(setName);
    if (!set || set.buffers.length === 0) return false;

    const p = placement(wx - this.listener.x, wy - this.listener.y);
    if (!p.audible) return true; // audible sound exists, just too far

    const src = ctx.createBufferSource();
    src.buffer = set.buffers[Math.floor(this.rand() * set.buffers.length)];
    if (set.jitter > 0) src.playbackRate.value = 1 + (this.rand() * 2 - 1) * set.jitter;

    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.lowpassHz;
    const g = ctx.createGain();
    g.gain.value = set.gain * p.gain;

    src.connect(lp).connect(pan).connect(g).connect(sfx);
    src.start();
    return true;
  }

  private synthFire(cls: number): void {
    if (cls === WEAPON_CLASS.small_arms || cls === WEAPON_CLASS.hmg) {
      this.noise(0.05, 2400, 0.025);
    } else if (cls === WEAPON_CLASS.autocannon) {
      this.tone(220, 0.08, 'square', 0.03);
    } else if (cls === WEAPON_CLASS.atgm || cls === WEAPON_CLASS.rpg) {
      this.noise(0.35, 700, 0.03);
    } else if (cls === WEAPON_CLASS.mortar) {
      this.tone(130, 0.12, 'sine', 0.04);
    } else {
      this.tone(90, 0.22, 'triangle', 0.06);
      this.noise(0.15, 400, 0.04);
    }
  }

  private out(): AudioNode | null {
    return this.sfx;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, to?: AudioNode): void {
    const ctx = this.ctx;
    const dst = to ?? this.out();
    if (!ctx || !dst) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(dst);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  private sweep(from: number, to: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    const dst = this.out();
    if (!ctx || !dst) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(dst);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  private noise(dur: number, cutoff: number, gain: number): void {
    const ctx = this.ctx;
    const dst = this.out();
    if (!ctx || !dst) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (this.rand() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(dst);
    src.start();
  }
}
