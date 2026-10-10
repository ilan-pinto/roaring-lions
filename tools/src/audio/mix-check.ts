/**
 * A rendered mix check (audio plan AU-4, the polish audit's "hearing the
 * mix").
 *
 *   pnpm audio:mix                      measure and gate; exit 1 on a red gate
 *   pnpm audio:mix -- --out=<dir>       also write each scene's mix as a WAV
 *                                       (relative to the repo root)
 *
 * Renders scripted scenes (`mix-scenes.ts`) through the REAL mixer: the
 * shipped `packages/render/src/audio.ts` and `radio.ts`, type-stripped as-is
 * into a bare headless Chromium page (the `pnpm radio:clips` technique), the
 * shipped `data/audio.json` and the shipped clips, takes and music beds, at
 * the settings screen's default sliders. Its `AudioContext` is an
 * `OfflineAudioContext` that suspends every 512 frames; at each suspension a
 * fake clock fires the mixer's own timers (its duck steps, cue holds and
 * music crossfade are `window.setTimeout` chains) and the scene's events are
 * handed to the mixer's own entry points (`onEvents`, `playVoice`, `playCue`,
 * `setMusicScene`). The music is three `<audio>` elements in the game, not
 * graph nodes: here they are stand-ins whose `volume` the mixer steps as it
 * would, and whose bed is rendered into the graph at that volume.
 *
 * Every bus is tapped into its own channel pair (voice, sfx after its duck,
 * cue, ambience after its duck, music) beside the master, so one render gives
 * the mix and its stems exactly; the stems must sum back to the mix or the
 * run fails (a sound reaching the master outside every bus). Loudness is
 * ffmpeg's `ebur128` over each window (the gated loudness of exactly that
 * window: a radio line is under the 3 s short-term window, which would average
 * in the seconds around it).
 *
 * The gates, and where each threshold comes from, are printed with the
 * numbers. The ambience bus is tapped and measured, but no bed plays: the
 * lead switched ambience off on 2026-10-09 (`AMBIENCE_ENABLED`, main.ts).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPON_CLASS } from '@lions/sim';
import { chromium } from 'playwright';
import { DEFAULT_SETTINGS } from '../../../packages/app/src/settings';
import { buildScenes, passes, UNIT_TYPES, UNITS, type Gate, type ManifestLike, type Scene } from './mix-scenes';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const SR = 48_000;
/** The render's suspension step, in frames: four render quanta (10.7 ms),
 *  finer than the mixer's own 20 ms duck step. */
const STEP_FRAMES = 512;
/** Channel pairs: the master, then one per bus. */
const STEMS = ['full', 'voice', 'sfx', 'cue', 'amb', 'music'] as const;
type Stem = (typeof STEMS)[number];
const CH = STEMS.length * 2;
/** Audio plan 5.1: "the outcome line once the stinger's head has played
 *  (0.6 s), never over it". */
const PLAN_OUTCOME_HEAD_S = 0.6;
/** Voice onset: the first sample of the voice bus above this, in dBFS. */
const ONSET_DBFS = -50;

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** What one action did, read back from the mixer as it happened. */
interface Mark {
  status: string;
  /** Context time the action ran. */
  at: number;
  /** A voice: when its words start (after the squelch click). */
  lineAt?: number;
  /** Length of the line or the cue's clip, s. */
  seconds: number;
}
interface RenderResult {
  b64: string;
  frames: number;
  marks: Record<string, Mark>;
  /** Fake-element volume trace, for the report: [t, theme, calm, battle]. */
  music: [number, number, number, number][];
}

function wav(channels: Float32Array[], sampleRate: number, bits: 16 | 32): Buffer {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const bps = bits / 8;
  const b = Buffer.alloc(44 + n * ch * bps);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * ch * bps, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(bits === 32 ? 3 : 1, 20);
  b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * ch * bps, 28);
  b.writeUInt16LE(ch * bps, 32);
  b.writeUInt16LE(bits, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * ch * bps, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = channels[c]?.[i] ?? 0;
      if (bits === 32) b.writeFloatLE(v, o);
      else b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), o);
      o += bps;
    }
  }
  return b;
}

/** ffmpeg's EBU R128 reading of a stereo stem over [from, to) s: the
 *  integrated (gated) loudness of exactly that window, and its true peak. */
function ebur128(stem: Float32Array[], from: number, to: number, dir: string): { lufs: number; tp: number } {
  const a = Math.max(0, Math.round(from * SR));
  const z = Math.min(stem[0]?.length ?? 0, Math.round(to * SR));
  const file = join(dir, 'w.wav');
  writeFileSync(file, wav(stem.map((c) => c.subarray(a, z)), SR, 32));
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed (${run.error?.message ?? run.status}): ${run.stderr}`);
  const summary = run.stderr.slice(run.stderr.lastIndexOf('Summary:'));
  const i = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary);
  const p = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary);
  const num = (m: RegExpExecArray | null): number => (m?.[1] === undefined || m[1] === '-inf' ? -Infinity : Number(m[1]));
  return { lufs: num(i), tp: num(p) };
}

const sum = (...stems: Float32Array[][]): Float32Array[] =>
  [0, 1].map((c) => {
    const n = stems[0]?.[c]?.length ?? 0;
    const o = new Float32Array(n);
    for (const s of stems) {
      const d = s[c];
      if (d) for (let i = 0; i < n; i++) o[i] = (o[i] ?? 0) + (d[i] ?? 0);
    }
    return o;
  });
const minus = (a: Float32Array[], b: Float32Array[]): Float32Array[] =>
  [0, 1].map((c) => {
    const x = a[c] ?? new Float32Array(0);
    const y = b[c] ?? new Float32Array(0);
    return x.map((v, i) => v - (y[i] ?? 0));
  });

function peak(stem: Float32Array[]): number {
  let p = 0;
  for (const c of stem) for (const v of c) p = Math.max(p, Math.abs(v));
  return p;
}

function onsetAfter(stem: Float32Array[], fromS: number): number {
  const thr = Math.pow(10, ONSET_DBFS / 20);
  const n = stem[0]?.length ?? 0;
  for (let i = Math.max(0, Math.floor(fromS * SR)); i < n; i++) {
    if (Math.abs(stem[0]?.[i] ?? 0) > thr || Math.abs(stem[1]?.[i] ?? 0) > thr) return i / SR;
  }
  return Infinity;
}

const fmt = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d) : x > 0 ? '+inf' : '-inf');
const dbfs = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** The page's half: one scene, rendered through the shipped mixer. */
async function renderScene(
  page: import('playwright').Page,
  scene: Scene,
  manifest: unknown,
  gains: { master: number; music: number; sfx: number; voice: number },
  radio: boolean
): Promise<RenderResult> {
  return page.evaluate(
    async ({ scene, manifest, gains, radio, sr, ch, step, units, unitTypes }): Promise<RenderResult> => {
      // ---- a clock the mixer's timers run on, moved by the render --------
      type Timer = { id: number; due: number; fn: () => void };
      let now = 0;
      let seq = 1;
      const timers: Timer[] = [];
      const w = window as unknown as Record<string, unknown>;
      w.setTimeout = (fn: () => void, ms?: number): number => {
        const id = seq++;
        timers.push({ id, due: now + Math.max(0, ms ?? 0), fn });
        return id;
      };
      w.clearTimeout = (id: number): void => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      };
      const advance = (to: number): void => {
        for (;;) {
          let best: Timer | null = null;
          for (const t of timers) if (t.due <= to && (best === null || t.due < best.due || (t.due === best.due && t.id < best.id))) best = t;
          if (best === null) break;
          timers.splice(timers.indexOf(best), 1);
          now = best.due;
          best.fn();
        }
        now = to;
      };

      // ---- the music elements: stand-ins the mixer drives ---------------
      interface FakeEl {
        el: HTMLAudioElement;
        playing: boolean;
        pos: number;
        startedAt: number;
      }
      const els: FakeEl[] = [];
      w.Audio = function (): HTMLAudioElement {
        const el = document.createElement('audio');
        const f: FakeEl = { el, playing: false, pos: 0, startedAt: 0 };
        let src = '';
        Object.defineProperty(el, 'src', { get: () => src, set: (v: string) => (src = String(v)) });
        Object.defineProperty(el, 'paused', { get: () => !f.playing });
        Object.defineProperty(el, 'currentTime', {
          get: () => f.pos + (f.playing ? (now - f.startedAt) / 1000 : 0),
          set: (v: number) => {
            f.pos = v;
            f.startedAt = now;
          },
        });
        el.play = (): Promise<void> => {
          if (!f.playing) {
            f.playing = true;
            f.startedAt = now;
          }
          return Promise.resolve();
        };
        el.pause = (): void => {
          if (f.playing) f.pos += (now - f.startedAt) / 1000;
          f.playing = false;
        };
        els.push(f);
        return el;
      };

      // ---- the context the mixer will make --------------------------------
      const frames = Math.ceil(scene.lengthS * sr);
      const ctx = new OfflineAudioContext(ch, frames, sr);
      ctx.destination.channelInterpretation = 'discrete';
      let state: AudioContextState = 'running';
      Object.defineProperty(ctx, 'state', { get: () => state });
      w.AudioContext = function (): OfflineAudioContext {
        return ctx;
      };

      type Audio = typeof import('../../../packages/render/src/audio');
      const moduleUrl = 'http://mix.test/audio.js';
      const mod = (await import(moduleUrl)) as Audio;
      const audio = new mod.BattleAudio();
      /** The mixer's own nodes and state, read through the stripped privates. */
      const inner = audio as unknown as {
        master: GainNode;
        sfxDuck: GainNode;
        voice: GainNode;
        cue: GainNode;
        ambDuck: GainNode;
        activeVoices: { id: number; startedAt: number; squelch: { lineAt: number } | null }[];
        sets: Map<string, { buffers: AudioBuffer[] }>;
      };
      const man = manifest as Parameters<typeof audio.useManifest>[0];
      audio.useManifest(man, 'http://mix.test/audio/');
      audio.setGains(gains);
      audio.setRadioEffect(radio);
      audio.setVoiceLanguages(['he']);
      audio.attach();
      window.dispatchEvent(new Event('pointerdown'));
      await audio.decoded();

      // ---- taps: the master, then each bus, each into its own pair --------
      const masterLevel = inner.master.gain.value;
      inner.master.disconnect();
      const merger = ctx.createChannelMerger(ch);
      merger.connect(ctx.destination);
      const tap = (node: AudioNode, pair: number, level: number): void => {
        // Upmix a mono bus to stereo as the master does (speakers: L = R),
        // before the splitter, whose discrete interpretation would not.
        const g = ctx.createGain();
        g.channelCount = 2;
        g.channelCountMode = 'explicit';
        g.channelInterpretation = 'speakers';
        g.gain.value = level;
        const split = ctx.createChannelSplitter(2);
        node.connect(g).connect(split);
        split.connect(merger, 0, pair * 2);
        split.connect(merger, 1, pair * 2 + 1);
      };
      tap(inner.master, 0, 1);
      tap(inner.voice, 1, masterLevel);
      tap(inner.sfxDuck, 2, masterLevel);
      tap(inner.cue, 3, masterLevel);
      tap(inner.ambDuck, 4, masterLevel);
      // The elements play outside the graph, at their own volume (which
      // already carries master_gain and the sliders): into the mix and pair 5.
      const musicOut = ctx.createGain();
      tap(musicOut, 0, 1);
      tap(musicOut, 5, 1);

      const music = (manifest as { music?: { tracks?: { file: string }[]; beds?: Record<string, { file: string }> } }).music;
      const files = [...(music?.tracks ?? []).map((t) => t.file), ...Object.values(music?.beds ?? {}).map((b) => b.file)];
      const bufs = new Map<string, AudioBuffer>();
      for (const f of files) {
        const res = await fetch(`http://mix.test/audio/${f}`);
        if (res.ok) bufs.set(`http://mix.test/audio/${f}`, await ctx.decodeAudioData(await res.arrayBuffer()));
      }
      const musicNodes = new Map<FakeEl, { gain: GainNode; src: AudioBufferSourceNode | null }>();
      const trace: [number, number, number, number][] = [];
      const syncMusic = (t: number): void => {
        const vol: Record<string, number> = { theme: 0, calm: 0, battle: 0 };
        for (const f of els) {
          let n = musicNodes.get(f);
          if (!n) {
            const gain = ctx.createGain();
            gain.gain.value = 0;
            gain.connect(musicOut);
            n = { gain, src: null };
            musicNodes.set(f, n);
          }
          const buf = bufs.get(f.el.src);
          if (f.playing && n.src === null && buf) {
            const s = ctx.createBufferSource();
            s.buffer = buf;
            s.loop = true;
            s.connect(n.gain);
            s.start(t, f.el.currentTime % buf.duration);
            n.src = s;
          } else if (!f.playing && n.src !== null) {
            n.src.stop(t);
            n.src = null;
          }
          const v = f.playing ? f.el.volume : 0;
          n.gain.gain.setValueAtTime(v, t);
          vol[f.el.dataset.music ?? 'theme'] = v;
        }
        trace.push([t, vol.theme ?? 0, vol.calm ?? 0, vol.battle ?? 0]);
      };

      // ---- the fake board the mixer reads positions and weapons from -----
      const n = units.length;
      const sim = {
        state: {
          posX: Int32Array.from(units.map((u) => Math.round(u.x * 65536))),
          posY: Int32Array.from(units.map((u) => Math.round(u.y * 65536))),
          typeIdx: Uint16Array.from(units.map((u) => u.type)),
          side: Uint8Array.from(units.map((u) => u.side)),
        },
        unitTypes,
        tickCount: 0,
        entityCount: n,
      };
      type Ev = (typeof scene.combat)[number][number];
      const toSim = (events: Ev[]): unknown[] =>
        events.map((e) => (e.kind === 'nearMiss' ? { ...e, x: Math.round(e.x * 65536), y: Math.round(e.y * 65536) } : e));
      const onEvents = (events: Ev[]): void => {
        sim.tickCount = Math.floor(now / 50);
        audio.onEvents(toSim(events) as Parameters<typeof audio.onEvents>[0], sim as unknown as Parameters<typeof audio.onEvents>[1]);
      };

      // ---- warm-up: the music to where the scene starts --------------------
      // No context time passes and nothing sounds (`onEvents` is silent
      // unless the context runs); the elements' volumes and the intensity
      // reading move on the fake clock.
      state = 'suspended';
      if (scene.warmup.scene === 'battle') audio.setMusicScene('battle');
      const warmFire: Ev[] = [
        { kind: 'fire', shooter: 0, target: 6, weaponId: 'rifle' },
        { kind: 'fire', shooter: 6, target: 0, weaponId: 'rifle' },
      ];
      for (let ms = 0; ms < scene.warmup.ms; ms += 50) {
        onEvents(scene.warmup.combat ? warmFire : []);
        advance(now + 50);
      }
      state = 'running';
      const warmMs = now;

      // ---- the render ---------------------------------------------------
      const marks: Record<string, Mark> = {};
      const actions = [...scene.actions].sort((a, b) => a.atS - b.atS);
      let next = 0;
      let tickDone = -1;
      const runAction = (a: (typeof actions)[number]): void => {
        const t = ctx.currentTime;
        if (a.op === 'scene') {
          audio.setMusicScene(a.scene);
        } else if (a.op === 'cue') {
          const status = audio.playCue(a.id);
          const entry = man.cues?.[a.id];
          const seconds = typeof entry === 'string' ? (inner.sets.get(entry)?.buffers[0]?.duration ?? 0) : 0;
          marks[a.mark] = { status, at: t, seconds };
        } else {
          const r = audio.playVoice({ key: a.key, priority: a.priority, ...(a.delayS !== undefined ? { delayS: a.delayS } : {}) });
          const v = inner.activeVoices.find((x) => x.id === r.id);
          marks[a.mark] = { status: r.status, at: t, seconds: r.seconds, lineAt: v?.squelch?.lineAt ?? v?.startedAt ?? t };
        }
      };
      const stepTo = (t: number): void => {
        advance(warmMs + t * 1000);
        const tick = Math.floor(t * 20 + 1e-9);
        for (let k = tickDone + 1; k <= tick; k++) onEvents(scene.combat[k] ?? []);
        tickDone = tick;
        while (next < actions.length && (actions[next]?.atS ?? Infinity) <= t + 1e-9) {
          const a = actions[next++];
          if (a) runAction(a);
        }
        syncMusic(t);
      };
      stepTo(0);
      const count = Math.floor((frames - 1) / step);
      for (let k = 1; k <= count; k++) {
        void ctx.suspend((k * step) / sr).then(() => {
          stepTo(ctx.currentTime);
          void ctx.resume();
        });
      }
      const out = await ctx.startRendering();

      // Interleave and hand back as base64 (float32).
      const inter = new Float32Array(out.length * ch);
      for (let c = 0; c < ch; c++) {
        const d = out.getChannelData(c);
        for (let i = 0; i < out.length; i++) inter[i * ch + c] = d[i] ?? 0;
      }
      const bytes = new Uint8Array(inter.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      audio.dispose();
      return { b64: btoa(bin), frames: out.length, marks, music: trace };
    },
    { scene, manifest, gains, radio, sr: SR, ch: CH, step: STEP_FRAMES, units: UNITS, unitTypes: UNIT_TYPES }
  );
}

interface Stems {
  stems: Record<Stem, Float32Array[]>;
  marks: Record<string, Mark>;
  music: RenderResult['music'];
}

function split(r: RenderResult): Stems {
  const buf = Buffer.from(r.b64, 'base64');
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const stems = {} as Record<Stem, Float32Array[]>;
  STEMS.forEach((s, p) => {
    const l = new Float32Array(r.frames);
    const rr = new Float32Array(r.frames);
    for (let i = 0; i < r.frames; i++) {
      l[i] = all[i * CH + p * 2] ?? 0;
      rr[i] = all[i * CH + p * 2 + 1] ?? 0;
    }
    stems[s] = [l, rr];
  });
  return { stems, marks: r.marks, music: r.music };
}

function serveFile(urlPath: string): Buffer | null {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '');
  const base = join(ROOT, 'assets', 'audio');
  const full = join(base, rel);
  if (!full.startsWith(base + sep)) return null;
  try {
    return readFileSync(full);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const outArg = arg('out');
  const out = outArg === null ? null : resolve(ROOT, outArg);
  if (out) mkdirSync(out, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data/audio.json'), 'utf8')) as ManifestLike & Record<string, unknown>;

  // The shipped mixer, type-stripped: audio.ts's two imports point at the
  // radio beside it and at a module carrying the sim's own WEAPON_CLASS.
  const audioJs = stripTypeScriptTypes(readFileSync(join(ROOT, 'packages/render/src/audio.ts'), 'utf8'))
    .replace(/from '@lions\/sim'/, "from './sim.js'")
    .replace(/from '\.\/radio'/g, "from './radio.js'");
  const radioJs = stripTypeScriptTypes(readFileSync(join(ROOT, 'packages/render/src/radio.ts'), 'utf8'));
  const simJs = `export const WEAPON_CLASS = ${JSON.stringify(WEAPON_CLASS)};\n`;
  // OUTCOME_LINE_DELAY_S is read from the mixer itself, as the app does.
  const delay = /export const OUTCOME_LINE_DELAY_S = ([\d.]+);/.exec(audioJs);
  if (!delay?.[1]) throw new Error('audio.ts: OUTCOME_LINE_DELAY_S not found');
  const outcomeDelay = Number(delay[1]);

  const { scenes, unitLostCalls, unitLostFed } = buildScenes(manifest, outcomeDelay);
  const d = DEFAULT_SETTINGS.audio;
  const gains = { master: d.master, music: d.music, sfx: d.sfx, voice: d.voice };

  const t0 = Date.now();
  const browser = await chromium.launch();
  const rendered = new Map<string, Stems>();
  try {
    for (const scene of scenes) {
      // A fresh context per scene: no module state, listener or storage
      // carries from one render into the next.
      // music-off: exempt -- the mixer runs on a stub page against stand-in elements; nothing plays.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route('http://mix.test/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/audio.js') return route.fulfill({ contentType: 'text/javascript', body: audioJs });
        if (path === '/radio.js') return route.fulfill({ contentType: 'text/javascript', body: radioJs });
        if (path === '/sim.js') return route.fulfill({ contentType: 'text/javascript', body: simJs });
        if (path.startsWith('/audio/')) {
          const body = serveFile(path.slice('/audio/'.length));
          return body ? route.fulfill({ body }) : route.fulfill({ status: 404, body: '' });
        }
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>mix</title><body></body>' });
      });
      await page.addInitScript('globalThis.__name = (f) => f;');
      await page.goto('http://mix.test/');
      rendered.set(scene.id, split(await renderScene(page, scene, manifest, gains, DEFAULT_SETTINGS.audio.radio)));
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const renderMs = Date.now() - t0;

  const tmp = mkdtempSync(join(tmpdir(), 'audio-mix-'));
  const gates: Gate[] = [];
  const failures: string[] = [];
  try {
    const get = (id: string): Stems => {
      const s = rendered.get(id);
      if (!s) throw new Error(`scene ${id} was not rendered`);
      return s;
    };
    const mark = (s: Stems, sceneId: string, m: string): Mark => {
      const k = s.marks[m];
      if (!k) throw new Error(`${sceneId}: no mark "${m}"`);
      return k;
    };
    const L = (stem: Float32Array[], a: number, b: number): number => ebur128(stem, a, b, tmp).lufs;
    const bedOf = (s: Stems): Float32Array[] => sum(s.stems.sfx, s.stems.music, s.stems.amb);

    // Self-check: the stems sum back to the mix.
    for (const [id, s] of rendered) {
      const resid = minus(s.stems.full, sum(s.stems.voice, s.stems.sfx, s.stems.cue, s.stems.amb, s.stems.music));
      const r = peak(resid);
      if (r > 1e-4) failures.push(`${id}: the stems do not sum to the mix (residual ${fmt(dbfs(r))} dBFS): a sound reaches the master outside every bus`);
    }

    console.log(`audio:mix -- ${scenes.length} scenes rendered through the shipped mixer in ${(renderMs / 1000).toFixed(1)} s`);
    console.log('default sliders (settings.ts), radio effect on; loudness is ffmpeg ebur128 over each window\n');

    const lineReport = (sceneId: string, m: string, label: string): { voice: number; bed: number; win: [number, number] } => {
      const s = get(sceneId);
      const k = mark(s, sceneId, m);
      if (k.status !== 'played') failures.push(`${sceneId}: the ${label} did not play (${k.status})`);
      const a = k.lineAt ?? k.at;
      const b = a + k.seconds;
      const voice = L(s.stems.voice, a, b);
      const bed = L(bedOf(s), a, b);
      console.log(
        `  ${label.padEnd(26)} ${a.toFixed(2)}-${b.toFixed(2)} s  voice ${fmt(voice)} LUFS  ` +
          `sfx ${fmt(L(s.stems.sfx, a, b))}  music ${fmt(L(s.stems.music, a, b))}  sfx+music ${fmt(bed)}  ` +
          `cue ${fmt(L(s.stems.cue, a, b))}  -> margin ${fmt(voice - bed)} LU`
      );
      return { voice, bed, win: [a, b] };
    };
    const sceneHeader = (id: string): void => {
      const sc = scenes.find((x) => x.id === id);
      const s = get(id);
      const len = s.stems.full[0]?.length ?? 0;
      const whole = ebur128(s.stems.full, 0, len / SR, tmp);
      console.log(`(${id}) ${sc?.title ?? ''}`);
      console.log(
        `  whole mix: ${fmt(whole.lufs)} LUFS integrated, true peak ${fmt(whole.tp)} dBTP, sample peak ${fmt(dbfs(peak(s.stems.full)))} dBFS`
      );
      for (const n of sc?.notes ?? []) console.log(`  . ${n}`);
      gates.push({
        id: `${id}: sample peak of the mix`,
        source: 'no clipping at the output (a float render over full scale clips on every device); audio plan 2.1: a kill peaks to -3 dBFS',
        value: dbfs(peak(s.stems.full)),
        limit: 0,
        sense: 'max',
        unit: 'dBFS',
      });
    };

    // (a)
    sceneHeader('a_firefight');
    const a = lineReport('a_firefight', 'bark', 'order bark (he.infantry.attack)');
    {
      const s = get('a_firefight');
      console.log(`  battle bed before the bark (0.5-1.9 s): ${fmt(L(s.stems.music, 0.5, 1.9))} LUFS (audio plan 2.1 target -26, before any duck); sfx ${fmt(L(s.stems.sfx, 0.5, 1.9))} LUFS`);
    }
    gates.push({
      id: 'a: bark over sfx+music during the line',
      source: 'audio plan AU-4: "the bark is >= 6 LU over SFX+music during the line"',
      value: a.voice - a.bed,
      limit: 6,
      sense: 'min',
      unit: 'LU',
    });
    {
      const under = get('a_cue_under_bark');
      const alone = get('a_cue_alone');
      const c1 = mark(under, 'a_cue_under_bark', 'cue');
      const c0 = mark(alone, 'a_cue_alone', 'cue');
      const ducked = L(minus(under.stems.full, under.stems.voice), c1.at, c1.at + c1.seconds);
      const free = L(alone.stems.full, c0.at, c0.at + c0.seconds);
      const inMix = L(get('a_firefight').stems.cue, c1.at, c1.at + c1.seconds);
      console.log(
        `  objective cue ${c1.at.toFixed(2)}-${(c1.at + c1.seconds).toFixed(2)} s: ${fmt(free, 2)} LUFS alone, ` +
          `${fmt(ducked, 2)} LUFS under the bark's duck (the bark itself silenced), ${fmt(inMix, 2)} LUFS on the cue bus in the firefight`
      );
      gates.push({
        id: 'a: the cue under the bark, against the cue alone',
        source: 'audio plan AU-4: "the cue is never ducked by the voice"; 0.5 dB is under the shallowest duck any 2.2 row applies (3 dB)',
        value: Math.abs(ducked - free),
        limit: 0.5,
        sense: 'max',
        unit: 'dB',
      });
    }

    // (b)
    console.log('');
    sceneHeader('b_announce_calm');
    const b = lineReport('b_announce_calm', 'line', 'announcement (reinforcements)');
    console.log(`  calm bed before the line (0.2-1.4 s): ${fmt(L(get('b_announce_calm').stems.music, 0.2, 1.4))} LUFS (the battle_gain, as the battle bed)`);
    gates.push({
      id: 'b: announcement over the calm bed during the line',
      source: 'AU-4\'s 6 LU, for the radio net\'s other speaker: 2.2\'s announce row ducks deeper than the bark row (-6 vs -3 dB)',
      value: b.voice - b.bed,
      limit: 6,
      sense: 'min',
      unit: 'LU',
    });

    // (c)
    console.log('');
    sceneHeader('c_defeat');
    {
      const s = get('c_defeat');
      const st = mark(s, 'c_defeat', 'stinger');
      const c = lineReport('c_defeat', 'line', 'defeat line (lead, he)');
      const onset = onsetAfter(s.stems.voice, st.at);
      const stingerIn = L(s.stems.cue, c.win[0], c.win[1]);
      const head = L(s.stems.cue, st.at, st.at + PLAN_OUTCOME_HEAD_S);
      console.log(
        `  stinger ${st.at.toFixed(2)}-${(st.at + st.seconds).toFixed(2)} s (${st.status}): head (first ${PLAN_OUTCOME_HEAD_S} s) ${fmt(head)} LUFS, ` +
          `under the line ${fmt(stingerIn)} LUFS -> line over stinger ${fmt(c.voice - stingerIn)} LU`
      );
      console.log(`  voice bus first sounds at ${onset.toFixed(3)} s: ${((onset - st.at) * 1000).toFixed(0)} ms after the stinger`);
      gates.push({
        id: 'c: the line starts after the stinger head',
        source: `audio plan 5.1/5.4: "the outcome line once the stinger's head has played (0.6 s), never over it" (one ${STEP_FRAMES}-frame step of slack)`,
        value: onset - st.at,
        // The plan's literal, not the mixer's constant: a gate that read its
        // limit from the code under test moved with it (seen: a delay of 0
        // passed against a limit of 0).
        limit: PLAN_OUTCOME_HEAD_S - STEP_FRAMES / SR,
        sense: 'min',
        unit: 's',
      });
      gates.push({
        id: 'c: sfx+music under the defeat line',
        source: '2.2\'s outcome row: sfx and music "fade out 600 ms" under the stinger, which is when the line starts; -60 LUFS is silence (ebur128 reads -70 for none)',
        value: c.bed,
        limit: -60,
        sense: 'max',
        unit: 'LUFS',
      });
      const musicBefore = L(s.stems.music, st.at - 0.6, st.at);
      const musicFading = L(s.stems.music, st.at + 0.1, st.at + 0.5);
      console.log(
        `  music: ${fmt(musicBefore)} LUFS in the 0.6 s before the stinger, ${fmt(musicFading)} LUFS 0.1-0.5 s into it ` +
          `(${fmt(musicFading - musicBefore)} LU)`
      );
      gates.push({
        id: 'c: the music fades under the stinger, and does not cut',
        source:
          '2.2\'s outcome row: music "fade out 600 ms". A linear 600 ms fade reads about -6 LU 0.1-0.5 s in (-9.5 at its deepest), a cut reads -70; -12 LU sits between',
        value: musicFading - musicBefore,
        limit: -12,
        sense: 'min',
        unit: 'LU',
      });
      gates.push({
        id: 'c: defeat line over the stinger under it',
        source: 'not masked: AU-4\'s 6 LU, held against the one sound 2.2 lets play under the verdict (the stinger)',
        value: c.voice - stingerIn,
        limit: 6,
        sense: 'min',
        unit: 'LU',
      });
    }

    // (d)
    console.log('');
    sceneHeader('d_unit_lost');
    const dd = lineReport('d_unit_lost', 'line', 'death call (he.infantry.death)');
    const calls = unitLostCalls.length;
    const nSaid = unitLostCalls[0]?.n ?? 0;
    console.log(`  unit-lost announcements: ${calls} for ${unitLostFed} losses (n=${nSaid})`);
    gates.push({
      id: 'd: the six losses are one announcement',
      source: 'audio plan 5.1 / AU-5: losses inside UNIT_LOST_COALESCE_MS are one call with the whole count',
      value: calls === 1 && nSaid === unitLostFed ? 1 : 0,
      limit: 1,
      sense: 'min',
      unit: '(1 = one call, n = 6)',
    });
    // Reported, not gated: four of the six kills land inside the 1.1 s call,
    // each the loudest clip in the library, and the plan's own rule is that a
    // kill is allowed to peak ("explosions don't flatten", 2.2) -- no duck
    // the plan would accept clears four of them by 6 LU. The burst's gate is
    // the coalescing above; the death call's is d1's, below.
    console.log(`  (reported, not gated) the call over four overlapping kills: ${fmt(dd.voice - dd.bed)} LU`);

    console.log('');
    sceneHeader('d1_one_loss');
    const d1 = lineReport('d1_one_loss', 'line', 'death call, one loss');
    gates.push({
      id: 'd1: death call over sfx+music during the line (one loss)',
      source: 'AU-4\'s 6 LU: a death call is a bark (2.2\'s bark row: "order, ack, death"), and it speaks on the tick of its own kill',
      value: d1.voice - d1.bed,
      limit: 6,
      sense: 'min',
      unit: 'LU',
    });

    // (e)
    console.log('');
    sceneHeader('e_mission_start');
    const e = lineReport('e_mission_start', 'line', 'mission start line');
    gates.push({
      id: 'e: start line over the music during the line',
      source: 'AU-4\'s 6 LU, for an announcement (as b)',
      value: e.voice - e.bed,
      limit: 6,
      sense: 'min',
      unit: 'LU',
    });

    console.log('\ngates:');
    for (const g of gates) {
      const ok = passes(g);
      if (!ok) failures.push(`${g.id}: ${fmt(g.value, 2)} ${g.unit}, needs ${g.sense === 'min' ? '>=' : '<='} ${fmt(g.limit, 2)}`);
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${g.id}: ${fmt(g.value, 2)} ${g.unit} (${g.sense === 'min' ? '>=' : '<='} ${fmt(g.limit, 2)})`);
      console.log(`        ${g.source}`);
    }

    if (out) {
      for (const sc of scenes) {
        if (!sc.listen) continue;
        const s = get(sc.id);
        writeFileSync(join(out, `${sc.id}.wav`), wav(s.stems.full, SR, 16));
      }
      console.log(`\nlistening copies: ${out}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error(`\naudio:mix FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\naudio:mix: every gate passes');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
