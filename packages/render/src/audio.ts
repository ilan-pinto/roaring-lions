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

const MAX_VOICES_PER_TICK = 6;
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

export interface AudioManifest {
  version?: number;
  master_gain?: number;
  sets?: Record<string, AudioSet>;
}

interface LoadedSet {
  gain: number;
  jitter: number;
  buffers: AudioBuffer[];
}

/** Camera position + zoom, supplied by the app so sounds can be placed. */
export interface Listener {
  x: number;
  y: number;
}

export class BattleAudio {
  private ctx: AudioContext | null = null;
  private muted = false;
  private master: GainNode | null = null;
  private masterGain = 0.9;

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

  /** Browsers require a user gesture before audio starts. */
  attach(): void {
    const start = (): void => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.masterGain;
        this.master.connect(this.ctx.destination);
        void this.decodeAll();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
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

  private async decodeAll(): Promise<void> {
    const ctx = this.ctx;
    const man = this.manifest;
    if (!ctx || !man) return;
    for (const [name, spec] of Object.entries(man.sets ?? {})) {
      const variants = spec.variants ?? [];
      if (variants.length === 0) continue;
      const buffers: AudioBuffer[] = [];
      for (const v of variants) {
        // Try the primary encoding, fall back to `alt` (Safari cannot always
        // decode OGG). One buffer per variant either way.
        for (const url of [v.file, v.alt]) {
          if (!url) continue;
          try {
            const res = await fetch(`${this.baseUrl}${url}`);
            if (!res.ok) continue;
            buffers.push(await ctx.decodeAudioData(await res.arrayBuffer()));
            break;
          } catch {
            // Unplayable in this browser: try the alternate, else the synth.
          }
        }
      }
      if (buffers.length > 0) {
        this.sets.set(name, {
          gain: spec.gain ?? 1,
          jitter: spec.pitch_jitter ?? 0,
          buffers,
        });
      }
    }
  }

  setListener(l: Listener): void {
    this.listener = l;
  }

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
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

  onEvents(events: SimEvent[], sim: Sim): void {
    if (this.muted || this.ctx === null || this.ctx.state !== 'running') return;
    const st = sim.state;
    let voices = 0;
    for (const e of events) {
      if (voices >= MAX_VOICES_PER_TICK) break;
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
    const master = this.master;
    if (!ctx || !master || !setName) return false;
    const set = this.sets.get(setName);
    if (!set || set.buffers.length === 0) return false;

    const dx = wx - this.listener.x;
    const dy = wy - this.listener.y;
    const dist = Math.hypot(dx, dy);
    if (dist > AUDIBLE_TILES) return true; // audible sound exists, just too far
    const atten = 1 - dist / AUDIBLE_TILES;

    const src = ctx.createBufferSource();
    src.buffer = set.buffers[Math.floor(this.rand() * set.buffers.length)];
    if (set.jitter > 0) src.playbackRate.value = 1 + (this.rand() * 2 - 1) * set.jitter;

    // Screen-space left/right: in 2:1 dimetric, +x is right, +y is left.
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, (dx - dy) / (AUDIBLE_TILES * 0.7)));

    // Distance dulls as well as quietens — high frequencies go first.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200 + atten * atten * 12000;

    const g = ctx.createGain();
    g.gain.value = set.gain * atten * atten;

    src.connect(lp).connect(pan).connect(g).connect(master);
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
    return this.master;
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
