/**
 * WP-P1: photographs the camera doing what a player does to it, so a change
 * to pan feel, bounds or zoom has a before and an after a person can watch.
 *
 * Two clips per target, same map, same start, same keys:
 *  - `pan-edge`: from the map centre at zoom 1, hold D for 3 s (the tutorial's
 *    first beat), release, and keep filming 0.6 s -- does the view leave the
 *    map, and does it start and stop sharply or ease;
 *  - `zoom`: put the pointer over a fixed screen point off-centre, wheel in to
 *    the 2.5 ceiling, then out to the 0.35 floor, then hold A for 1.5 s --
 *    does the point under the pointer stay put, and where does the map sit
 *    fully zoomed out.
 *
 * Every frame records the camera (x, y, zoom) and the wall-clock time it was
 * taken at, beside the JPEG, in `<out>/<target>-<clip>/frames.json`; the GIF
 * is built from the REAL frame times, so its playback speed is the game's.
 *
 * It never starts or stops a dev server: serve the trees yourself, music off
 * is seeded here (`music-off.ts`), and port 5177 is refused.
 *   cd tools && npx tsx src/perf/camera-captures.ts --targets=before@5291 --out=<dir> [--gpu=metal]
 */
import { chromium, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SILENT_AUDIO, musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs, resolveGpuBackend } from '../ui-review/gpu';

const args = process.argv.slice(2);
const arg = (k: string, d: string): string => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const TARGETS = arg('targets', 'after@5291')
  .split(',')
  .map((t) => {
    const [name, port] = t.split('@');
    if (Number(port) === 5177) throw new Error('5177 is the lead’s dev server; use another port');
    return { name, port: Number(port) };
  });
const OUT = resolve(arg('out', '.superpowers/camera'));
const MAP = arg('map', 'beit_sahwan_outskirts');
const VIEW = { width: 1280, height: 720 };

interface Shot {
  file: string;
  t: number;
  x: number;
  y: number;
  zoom: number;
}

const camera = (page: Page): Promise<{ x: number; y: number; zoom: number }> =>
  page.evaluate(() => {
    const c = (window as unknown as { __lions: { renderer: { camera: { x: number; y: number; zoom: number } } } }).__lions
      .renderer.camera;
    return { x: c.x, y: c.y, zoom: c.zoom };
  });

async function film(page: Page, dir: string, ms: number, shots: Shot[], t0: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const file = `f${String(shots.length).padStart(3, '0')}.jpg`;
    const c = await camera(page);
    const t = Date.now() - t0;
    await page.screenshot({ path: `${dir}/${file}`, type: 'jpeg', quality: 80 });
    shots.push({ file, t, ...c });
  }
}

/** Frames closer together than this are dropped from the GIF (never from
 *  `frames.json`): a GIF at ~12 fps keeps the motion readable at a tenth of
 *  the bytes of every captured frame. */
const GIF_MIN_FRAME_MS = 80;

function gif(dir: string, all: Shot[], name: string): void {
  const shots: Shot[] = [];
  for (const s of all) if (shots.length === 0 || s.t - shots[shots.length - 1].t >= GIF_MIN_FRAME_MS) shots.push(s);
  // ffmpeg's concat demuxer takes a per-frame duration, so the GIF plays at
  // the speed the frames were really taken at rather than an invented rate.
  const lines: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const next = i + 1 < shots.length ? shots[i + 1].t : shots[i].t + 100;
    lines.push(`file '${shots[i].file}'`, `duration ${((next - shots[i].t) / 1000).toFixed(3)}`);
  }
  lines.push(`file '${shots[shots.length - 1].file}'`);
  writeFileSync(`${dir}/concat.txt`, lines.join('\n'));
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      `${dir}/concat.txt`,
      '-vf',
      'scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
      '-vsync',
      'vfr',
      `${OUT}/${name}.gif`,
    ],
    { cwd: dir }
  );
}

async function boot(page: Page, port: number): Promise<void> {
  await page.goto(`http://localhost:${port}/?sandbox=${MAP}`);
  await page.waitForFunction(() => 'step' in ((window as unknown as { __lions?: object }).__lions ?? {}), null, {
    timeout: 120_000,
  });
  // Let the boot tail (mesh uploads, first shadow pass) finish before filming.
  await page.waitForTimeout(4000);
  await page.mouse.move(VIEW.width / 2, VIEW.height / 2);
}

async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = (window as unknown as { __lions: { renderer: { camera: { x: number; y: number; zoom: number } } } }).__lions
      .renderer.camera;
    c.x = 24;
    c.y = 24;
    c.zoom = 1;
  });
  await page.waitForTimeout(400);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (args.includes('--gif-only')) {
    // Rebuild the GIFs from frames already on disk, without a browser.
    for (const target of TARGETS) {
      for (const clip of ['pan-edge', 'zoom']) {
        const dir = `${OUT}/${target.name}-${clip}`;
        gif(dir, JSON.parse(readFileSync(`${dir}/frames.json`, 'utf8')) as Shot[], `${target.name}-${clip}`);
      }
    }
    return;
  }
  const backend = resolveGpuBackend(args, process.platform);
  for (const target of TARGETS) {
    // One browser at a time, closed before the next target starts.
    const browser = await chromium.launch({ args: gpuLaunchArgs(backend) });
    try {
      const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
      await ctx.addInitScript(musicOffInitScript(SILENT_AUDIO));
      const page = await ctx.newPage();
      await boot(page, target.port);

      // --- pan to the edge -------------------------------------------------
      await reset(page);
      {
        const dir = `${OUT}/${target.name}-pan-edge`;
        mkdirSync(dir, { recursive: true });
        const shots: Shot[] = [];
        const t0 = Date.now();
        await film(page, dir, 300, shots, t0);
        await page.keyboard.down('d');
        await film(page, dir, 3000, shots, t0);
        await page.keyboard.up('d');
        await film(page, dir, 600, shots, t0);
        writeFileSync(`${dir}/frames.json`, JSON.stringify(shots, null, 1));
        gif(dir, shots, `${target.name}-pan-edge`);
        const last = shots[shots.length - 1];
        console.log(`[camera] ${target.name} pan-edge: ${shots.length} frames, ends at (${last.x.toFixed(2)}, ${last.y.toFixed(2)}) z${last.zoom}`);
      }

      // --- zoom toward the pointer, then out to the floor ------------------
      await reset(page);
      {
        const dir = `${OUT}/${target.name}-zoom`;
        mkdirSync(dir, { recursive: true });
        const shots: Shot[] = [];
        const t0 = Date.now();
        const px = Math.round(VIEW.width * 0.7);
        const py = Math.round(VIEW.height * 0.35);
        await page.mouse.move(px, py);
        await film(page, dir, 300, shots, t0);
        // One notch at a time (deltaY 100 is one wheel notch in Chromium).
        for (let i = 0; i < 12; i++) {
          await page.mouse.wheel(0, -100);
          await film(page, dir, 120, shots, t0);
        }
        for (let i = 0; i < 24; i++) {
          await page.mouse.wheel(0, 100);
          await film(page, dir, 120, shots, t0);
        }
        await page.keyboard.down('a');
        await film(page, dir, 1500, shots, t0);
        await page.keyboard.up('a');
        await film(page, dir, 400, shots, t0);
        writeFileSync(`${dir}/frames.json`, JSON.stringify(shots, null, 1));
        gif(dir, shots, `${target.name}-zoom`);
        const last = shots[shots.length - 1];
        console.log(`[camera] ${target.name} zoom: ${shots.length} frames, ends at (${last.x.toFixed(2)}, ${last.y.toFixed(2)}) z${last.zoom.toFixed(3)}`);
      }
    } finally {
      await browser.close();
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
