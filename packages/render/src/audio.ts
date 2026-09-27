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
  license?: string;
  source?: string;
  credit?: string;
}

export interface MusicSpec {
  /** Element volume, 0..1, multiplied by `master_gain`. */
  gain?: number;
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
}

export interface AudioManifest {
  version?: number;
  master_gain?: number;
  music?: MusicSpec;
  sets?: Record<string, AudioSet>;
  voices?: VoiceManifest;
}

/** Who wins a voice slot (N5): an order, then a KDF death, then an enemy death. */
export type VoicePriority = 'order' | 'kdf_death' | 'enemy_death';
/** N5's ranking as numbers; higher wins. */
export const VOICE_RANK: Readonly<Record<VoicePriority, number>> = { order: 3, kdf_death: 2, enemy_death: 1 };

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
/** The radio band every unplaced line passes through, in Hz (N13). */
export const RADIO_BAND_HZ = { low: 300, high: 3400 } as const;
/** The duck under a voice (N12): SFX -4 dB, music -3 dB, 80 ms in, 300 ms out. */
export const DUCK = { sfx: 0.631, music: 0.708, attackS: 0.08, releaseS: 0.3 } as const;
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
  /** The radio band's input (N13); it feeds the voice bus. */
  private radioIn: BiquadFilterNode | null = null;
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
  /** The duck is applied (N12). */
  private ducked = false;
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
        // The radio band (N13): every unplaced line enters here. Two filters,
        // not one bandpass, because a single biquad is not flat across 300-3400.
        this.radioIn = this.ctx.createBiquadFilter();
        this.radioIn.type = 'highpass';
        this.radioIn.frequency.value = RADIO_BAND_HZ.low;
        const top = this.ctx.createBiquadFilter();
        top.type = 'lowpass';
        top.frequency.value = RADIO_BAND_HZ.high;
        this.radioIn.connect(top).connect(this.voice);
        const bus = busGain(this.masterGain, this.user);
        this.master.gain.value = bus.master;
        this.sfx.gain.value = bus.sfx;
        this.voice.gain.value = bus.voice;
        this.decoding = this.decodeAll();
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
   * first user gesture); missing files are logged and fall back to the synth
   * rather than failing, so a half-filled library still plays.
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
    this.applyMusicVolume();
  }

  /** The music element's volume: its level times the duck under a voice. */
  private musicLevel(): number {
    return musicVolume(this.masterGain, this.manifest?.music?.gain ?? 1, this.user) * this.musicDuck;
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
   */
  private async decodeAll(): Promise<void> {
    const ctx = this.ctx;
    const man = this.manifest;
    if (!ctx || !man) return;
    const order = decodeOrder(man.sets);
    for (const [name, spec] of order) if (spec.event === 'ui') await this.decodeSet(ctx, name, spec);
    await this.queueVoiceDecode();
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
  playUi(setName: string): void {
    // Mute first, and HERE rather than at the call site. `m` toggles one flag
    // and the HUD says "audio muted" on the strength of it, so a sound that
    // checked the flag only at some of its callers would make that line a lie
    // the moment a new caller appeared -- which is exactly how this was found,
    // the alert layer being `playUi`'s first. `onEvents` (below) and both
    // music paths already guard here for the same reason; the gain buses
    // cannot stand in for it, because they are driven by the volume sliders
    // alone and mute is not a volume.
    if (this.muted) return;
    const ctx = this.ctx;
    const sfx = this.sfx;
    if (!ctx || !sfx) return;
    const set = this.sets.get(setName);
    if (set && set.buffers.length > 0) {
      const src = ctx.createBufferSource();
      src.buffer = set.buffers[Math.floor(this.rand() * set.buffers.length)];
      const g = ctx.createGain();
      g.gain.value = uiSetGain(set.gain);
      src.connect(g).connect(sfx);
      src.start();
      return;
    }
    // Two shapes, so the player can tell the two apart with their back to the
    // screen: an alert falls, an objective rises.
    if (setName === 'ui_objective') {
      this.tone(660, 0.09, 'sine', 0.05);
      window.setTimeout(() => this.tone(990, 0.12, 'sine', 0.045), 70);
    } else if (setName === 'ui_purchase') {
      // A shop, not an alarm (garage uplift §3.5): a low clunk under a rising
      // pair. Rising is the objective's meaning ("something went your way"),
      // kept deliberately short of the objective's own pitch.
      this.tone(196, 0.08, 'triangle', 0.06);
      window.setTimeout(() => this.tone(294, 0.12, 'sine', 0.045), 70);
    } else if (setName === 'ui_upgrade') {
      // Two pawl clicks of a ratchet, then the higher note.
      this.tone(1175, 0.02, 'square', 0.02);
      window.setTimeout(() => this.tone(1175, 0.02, 'square', 0.02), 35);
      window.setTimeout(() => this.tone(880, 0.1, 'sine', 0.045), 90);
    } else {
      this.tone(520, 0.08, 'triangle', 0.06);
      window.setTimeout(() => this.tone(390, 0.16, 'triangle', 0.05), 60);
    }
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
    const radio = this.radioIn;
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
    const g = ctx.createGain();
    g.gain.value = (line ? this.voiceGain : PLACEHOLDER_GAIN) * (place ? place.gain : 1);
    let head: AudioNode = g;
    if (place) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = place.lowpassHz;
      const pan = ctx.createStereoPanner();
      pan.pan.value = place.pan;
      lp.connect(pan).connect(g).connect(bus);
      head = lp;
    } else {
      g.connect(radio);
    }

    let src: AudioScheduledSourceNode;
    let seconds: number;
    let en: string | null = null;
    if (line) {
      const i = Math.floor(this.rand() * line.buffers.length);
      const b = ctx.createBufferSource();
      b.buffer = line.buffers[i];
      seconds = line.buffers[i].duration;
      en = line.en[i] ?? null;
      src = b;
    } else {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = placeholderHz(p.key);
      seconds = PLACEHOLDER_S;
      src = o;
    }
    src.connect(head);
    const id = this.nextVoiceId++;
    this.activeVoices.push({ id, priority: p.priority, src, gain: g });
    src.onended = () => this.voiceEnded(id);
    src.start();
    if (!line) src.stop(t + PLACEHOLDER_S);
    this.duck(true);
    return { status: line ? 'played' : 'placeholder', seconds, en, cut: admit.cut.length };
  }

  /** Fade every line out and let go of the duck: a mission leave. */
  stopVoices(): void {
    for (const v of [...this.activeVoices]) this.cutVoice(v.id);
    this.duck(false);
  }

  /** Cut one line short with a VOICE_CUT_S fade (N4). */
  private cutVoice(id: number): void {
    const i = this.activeVoices.findIndex((v) => v.id === id);
    const ctx = this.ctx;
    if (i < 0 || !ctx) return;
    const [v] = this.activeVoices.splice(i, 1);
    const t = ctx.currentTime;
    // A cut line is not an ending: it must not release the duck under the
    // line that replaced it.
    v.src.onended = null;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + VOICE_CUT_S);
    v.src.stop(t + VOICE_CUT_S);
  }

  private voiceEnded(id: number): void {
    this.activeVoices = this.activeVoices.filter((v) => v.id !== id);
    if (this.activeVoices.length === 0) this.duck(false);
  }

  /** Duck sfx and music under a voice, or let them go (N12). Idempotent. */
  private duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    const ctx = this.ctx;
    const d = this.sfxDuck;
    if (ctx && d) {
      const t = ctx.currentTime;
      d.gain.cancelScheduledValues(t);
      d.gain.setValueAtTime(d.gain.value, t);
      d.gain.linearRampToValueAtTime(on ? DUCK.sfx : 1, t + (on ? DUCK.attackS : DUCK.releaseS));
    }
    this.rampMusic(on ? DUCK.music : 1, (on ? DUCK.attackS : DUCK.releaseS) * 1000);
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

  private tone(freq: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    const dst = this.out();
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
