/**
 * Before/after clips of the radio net (GH-282, WP-AU1 N17-N20).
 *
 *   pnpm radio:clips -- --out=<dir>     (relative to the repo root)
 *
 * Renders shipped voice takes through the REAL radio code
 * (`packages/render/src/radio.ts`, type-stripped as-is into a bare headless
 * Chromium page) with an OfflineAudioContext, so the clip is what the game
 * plays and not an approximation of it. The graph is `playVoice`'s own: the
 * take at the manifest's line gain into one of the radio's paths, the paths
 * into a voice bus at 1, that into a master at the manifest's `master_gain`.
 *
 * Writes, as 16-bit mono WAV at 48 kHz:
 *   a_band_only.wav         one take through today's band alone (effect off);
 *   b_walkie.wav            the same take through the walkie-talkie chain;
 *   c_sequence.wav          three takes one after another, the chain on;
 *   calib_walkie_dry.wav    b with the static silenced: the words alone;
 *   calib_squelch_only.wav  b with a silent take: the click and static alone;
 *   calib_noise_unity.wav   the static at unity gain, the scale for `levels`;
 * and prints peaks and the bed's RMS. Loudness is the caller's to measure
 * (`ffmpeg -i f.wav -af ebur128=peak=true -f null -`); `RADIO_FX`'s comments
 * quote what that read when the numbers were set.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const SR = 48_000;

function arg(name: string, dflt: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}

function wav16(samples: number[], sampleRate: number): Buffer {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return b;
}

const db = (x: number): string => (x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : '-inf');

interface Render {
  samples: number[];
  peak: number;
}
interface Result {
  band: Render;
  walkie: Render;
  sequence: Render;
  /** The chain on with the static silenced: the coloured words alone. */
  walkieDry: Render;
  /** The static at unity gain, steady, under a silent take: the scale the
   *  `levels` are set against. */
  noiseUnity: Render;
  /** The chain on, a silent take: only the click and static sound. */
  squelchOnly: Render;
  /** RMS of the bed alone, over the silent take's middle. */
  bedRms: number;
  /** When the line starts in b_walkie, and when the tail is cut, in s. */
  lineAt: number;
  endsAt: number;
  takeSeconds: number;
}

async function main(): Promise<void> {
  const out = resolve(ROOT, arg('out', 'radio-clips'));
  mkdirSync(out, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data/audio.json'), 'utf8')) as {
    master_gain?: number;
    voices?: { gain?: number };
  };
  const master = manifest.master_gain ?? 0.9;
  const lineGain = manifest.voices?.gain ?? 1;
  const takes = ['he/infantry/move_01a.ogg', 'he/infantry/attack_01a.ogg', 'he/common/ack_01a.ogg'].map((f) =>
    readFileSync(join(ROOT, 'assets/audio/voice', f)).toString('base64')
  );
  // radio.ts is erasable TypeScript (no enums, no parameter properties, no
  // imports), so Node's own type stripper turns it into the module the page
  // loads: no `typescript` dependency, and the code is otherwise untouched.
  const radioJs = stripTypeScriptTypes(readFileSync(join(ROOT, 'packages/render/src/radio.ts'), 'utf8'));

  const browser = await chromium.launch();
  try {
    // music-off: exempt -- renders radio.ts offline on a stub page, not the game.
    const page = await browser.newPage();
    await page.route('http://radio.test/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('/radio.js')) return route.fulfill({ contentType: 'text/javascript', body: radioJs });
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>radio</title>' });
    });
    // tsx compiles the page function's inner arrows with a `__name` helper
    // the page does not have (routes-check.ts's note); give it one.
    await page.addInitScript('globalThis.__name = (f) => f;');
    await page.goto('http://radio.test/');
    const result = await page.evaluate(
      async ({ takes, master, lineGain, sr }): Promise<Result> => {
        type Radio = typeof import('../../../packages/render/src/radio');
        const moduleUrl = 'http://radio.test/radio.js';
        const radio = (await import(moduleUrl)) as Radio;
        const decoder = new OfflineAudioContext(1, 1, sr);
        const bufs: AudioBuffer[] = [];
        for (const b64 of takes) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          bufs.push(await decoder.decodeAudioData(bytes.buffer));
        }
        const pad = 0.3;
        const tail = radio.RADIO_FX.clickS + radio.RADIO_FX.tailS + 0.3;

        type Line = { buf: AudioBuffer; at: number };
        const render = async (
          lines: Line[],
          fx: boolean,
          levels?: { click: number; burst: number; bed: number; tail: number }
        ): Promise<{ r: Render; squelch: { lineAt: number; endsAt: number }[] }> => {
          const end = Math.max(...lines.map((l) => l.at + l.buf.duration)) + tail;
          const ctx = new OfflineAudioContext(1, Math.ceil(end * sr), sr);
          const m = ctx.createGain();
          m.gain.value = master;
          m.connect(ctx.destination);
          const voice = ctx.createGain();
          voice.connect(m);
          const chain = radio.buildRadioChain(ctx, voice);
          const sq: { lineAt: number; endsAt: number }[] = [];
          lines.forEach((l, i) => {
            const s = fx ? radio.scheduleSquelch(ctx, chain, l.at, l.buf.duration, (i * 0.37) % 1, levels) : null;
            if (s) sq.push({ lineAt: s.lineAt, endsAt: s.endsAt });
            const g = ctx.createGain();
            g.gain.value = lineGain;
            g.connect(fx ? chain.fx : chain.clean);
            const src = ctx.createBufferSource();
            src.buffer = l.buf;
            src.connect(g);
            src.start(s ? s.lineAt : l.at);
          });
          const rendered = await ctx.startRendering();
          const d = rendered.getChannelData(0);
          let peak = 0;
          for (const v of d) peak = Math.max(peak, Math.abs(v));
          return { r: { samples: Array.from(d), peak }, squelch: sq };
        };

        const [move, attack, ack] = bufs;
        if (!move || !attack || !ack) throw new Error('a take did not decode');
        const band = await render([{ buf: move, at: pad }], false);
        const walkie = await render([{ buf: move, at: pad }], true);
        const walkieDry = await render([{ buf: move, at: pad }], true, { click: 0, burst: 0, bed: 0, tail: 0 });
        const gap = 0.9;
        const seqLines: Line[] = [];
        let at = pad;
        for (const buf of [move, attack, ack]) {
          seqLines.push({ buf, at });
          at += buf.duration + radio.RADIO_FX.clickS + radio.RADIO_FX.tailS + gap;
        }
        const sequence = await render(seqLines, true);
        const silent = new AudioBuffer({ length: move.length, sampleRate: move.sampleRate, numberOfChannels: 1 });
        const squelchOnly = await render([{ buf: silent, at: pad }], true);
        const noiseUnity = await render([{ buf: silent, at: pad }], true, { click: 0, burst: 1, bed: 1, tail: 1 });
        // The bed alone: a window inside the line, clear of the burst's decay.
        const bedFrom = Math.round((pad + radio.RADIO_FX.clickS + radio.RADIO_FX.burstS + 0.1) * sr);
        const bedTo = Math.round((pad + radio.RADIO_FX.clickS + silent.duration - 0.05) * sr);
        let acc = 0;
        for (let i = bedFrom; i < bedTo; i++) acc += (squelchOnly.r.samples[i] ?? 0) ** 2;
        const sq0 = walkie.squelch[0];
        if (!sq0) throw new Error('no squelch scheduled');
        return {
          band: band.r,
          walkie: walkie.r,
          walkieDry: walkieDry.r,
          sequence: sequence.r,
          squelchOnly: squelchOnly.r,
          noiseUnity: noiseUnity.r,
          bedRms: Math.sqrt(acc / Math.max(1, bedTo - bedFrom)),
          lineAt: sq0.lineAt - pad,
          endsAt: sq0.endsAt - pad,
          takeSeconds: move.duration,
        };
      },
      { takes, master, lineGain, sr: SR }
    );

    const files: [string, Render][] = [
      ['a_band_only.wav', result.band],
      ['b_walkie.wav', result.walkie],
      ['c_sequence.wav', result.sequence],
      ['calib_walkie_dry.wav', result.walkieDry],
      ['calib_squelch_only.wav', result.squelchOnly],
      ['calib_noise_unity.wav', result.noiseUnity],
    ];
    for (const [name, r] of files) {
      writeFileSync(join(out, name), wav16(r.samples, SR));
      console.log(`${name.padEnd(24)} ${(r.samples.length / SR).toFixed(2)} s  peak ${db(r.peak)}`);
    }
    console.log(`bed RMS (silent take)  ${db(result.bedRms)}`);
    console.log(
      `take ${result.takeSeconds.toFixed(3)} s; line starts +${(result.lineAt * 1000).toFixed(0)} ms, ` +
        `squelch cut +${(result.endsAt * 1000).toFixed(0)} ms after the click`
    );
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
