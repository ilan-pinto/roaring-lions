/**
 * GH-1167 S6 (design 2026-11-11, section 5.2): the 3D grass probe. COUNTS ONLY, report-only, on SwiftShader on CI
 * (`webgpu-noise.yml probe=grass`): the G arm on `wadi_halam_4` with the green theme's tones (the field exists), the `grass-field` layer
 * shown against hidden at z0.5, z1, z1.5 and z2.5 and at each figure count, reading `stats().perPass` calls and triangles of one frame.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-grass-probe.ts --out-dir=<dir> [--counts=0,300] [--map=wadi_halam_4]
 *       [--port=5199] [--falsify=no-field]
 *
 * REFUSES (exit 2): a backend that is not node-webgpu; a console GPUValidationError; and a grass-on arm that drew 0 grass calls (no visible
 * grass mesh, or no more scene calls than the off arm), a grass-off arm that still shows grass, or a layer toggle that changed nothing
 * (`grassRefusals`). `--falsify=no-field` boots with no field on purpose: the run MUST exit 2, which is how the refusal is watched going red.
 * Its timing is the Metal hold's (`webgpu:abba --grass`), never SwiftShader's.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { resolveCensusGpu } from './bloom-census-args';
import { ARM_KIND } from './webgpu-refusals';
import { GRASS_ZOOMS, grassCondition, grassRefusals, grassTable, type GrassReading, type GrassState } from './webgpu-grass-lib';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(TOOLS, '..');
const MAP = arg('map', 'wadi_halam_4');
const COUNTS = arg('counts', '0,300').split(',').map(Number);
const OUT = path.resolve(arg('out-dir', ''));
const FALSIFY = arg('falsify', '');
const MODULE = `/@fs${ROOT}/tools/src/perf/webgpu-page.ts`;
const WARM_FIRST = 61;
const WARM_AFTER_TOGGLE = 3;
const BAD_CONSOLE = [/GPUValidationError/i, /Destroyed texture/i, /uploaded again/i];

function refuse(msg: string): never {
  console.error(`webgpu-grass-probe: REFUSED: ${msg}`);
  process.exit(2);
}
if (args.find((a) => a.startsWith('--out-dir=')) === undefined) refuse('--out-dir=<dir> is required');
if (FALSIFY !== '' && FALSIFY !== 'no-field') refuse(`--falsify=${FALSIFY}: expected no-field`);
if (COUNTS.some((n) => !Number.isInteger(n) || n < 0)) refuse(`--counts=${arg('counts', '')}: expected non-negative integers`);
mkdirSync(OUT, { recursive: true });

const port = await claimPort('webgpu-grass-probe', 'WEBGPU_GRASS_PROBE_PORT', 5199);
const startedAt = new Date().toISOString();
const stop = devServerStopper(await ensureDevServer(port, ROOT, 'webgpu-grass-probe'), 'webgpu-grass-probe');
const gpu = resolveCensusGpu(['--gpu=webgpu', '--hw=swiftshader'], process.platform);
const browser = await chromium.launch(gpu.launchArgs.length === 0 ? { headless: true } : { headless: true, args: gpu.launchArgs });
const lines: string[] = [];
const readings: (GrassReading & { n: number })[] = [];
interface Boot {
  backendKind: string;
  adapter: string;
  grass: GrassState;
}
let boot: Boot | undefined;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  await page.addInitScript('window.__name = (f) => f; window.process = { env: {} };');
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') lines.push(m.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 120_000 });
  const booted = (await page.evaluate(
    async ({ mod, mapId, capacity, noField }) => {
      const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
      return m.submitSetup({ mapId: mapId as never, arm: 'G', capacity, timestamps: false, grass: 'on', noField });
    },
    { mod: MODULE, mapId: MAP, capacity: Math.max(...COUNTS) + 50, noField: FALSIFY === 'no-field' }
  )) as Boot | null;
  if (booted === null) refuse('the page returned no boot reading');
  boot = booted;
  if (booted.backendKind !== ARM_KIND.G) refuse(`backendInfo().kind is "${booted.backendKind}", expected "${ARM_KIND.G}" (a fallback is evidence about the fallback)`);
  for (const n of COUNTS) {
    let first = true;
    for (const zoom of GRASS_ZOOMS) {
      // `on` first at every zoom, so the `off` reading that follows it always has a change to report.
      for (const grass of ['on', 'off'] as const) {
        const r = (await page.evaluate(
          async ({ mod, p }) => {
            const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
            return m.grassRead(p);
          },
          { mod: MODULE, p: { zoom, grass, n, warmFrames: first ? WARM_FIRST : WARM_AFTER_TOGGLE } }
        )) as GrassReading;
        first = false;
        readings.push({ ...r, n });
        console.log(`[grass-probe] n${n} z${zoom} grass ${grass}: scene calls ${r.perPass.scene.calls}, shadow ${r.perPass.shadow.calls}, ao ${r.perPass.ao.calls}, tris ${r.triangles}, grass meshes ${r.grassMeshes}, layer changed ${r.layerChanged}`);
      }
    }
  }
  await page.close();
} finally {
  await browser.close();
  stop();
}

const refusals: string[] = [];
for (const l of lines) for (const re of BAD_CONSOLE) if (re.test(l)) refusals.push(`console carries ${re.source}: "${l.slice(0, 120)}"`);
for (const n of COUNTS) refusals.push(...grassRefusals(readings.filter((r) => r.n === n)).map((m) => `n${n} ${m}`));

const conditions = [
  `map=${MAP} 1280x720 DPR 1, quality high, music off, reduced motion, hw=swiftshader`,
  `arm G (${boot?.backendKind} on ${boot?.adapter}); the field's mode at boot: ${boot === undefined ? 'n/a' : grassCondition(boot.grass.mode)}, ${boot?.grass.meshes} visible grass meshes right after init (the layer shown against hidden per reading)`,
  `counts only (no timing on SwiftShader), figures ${COUNTS.join(', ')}, zooms ${GRASS_ZOOMS.join(', ')}`,
  `green theme tones (the field exists); L is not read here (it draws no field)`,
  FALSIFY === '' ? 'no falsification' : `FALSIFIED: --falsify=${FALSIFY} (no field built on purpose: this run must refuse)`,
  `loadavg at end ${os.loadavg()[0]?.toFixed(2)}`,
].join('\n- ');
const md = [
  '# GH-1167 S6: the 3D grass probe (SwiftShader, counts only)',
  '',
  `Run ${startedAt}. Machine: ${os.cpus()[0]?.model ?? 'unknown'}, ${os.platform()}.`,
  '',
  `Conditions:\n- ${conditions}`,
  '',
  ...COUNTS.flatMap((n) => [`## n${n}`, '', ...grassTable(readings.filter((r) => r.n === n)), '']),
  '## Refusals',
  '',
  ...(refusals.length === 0 ? ['none'] : refusals.map((r) => `- ${r}`)),
];
writeFileSync(path.join(OUT, 'grass-probe.md'), md.join('\n') + '\n');
writeFileSync(path.join(OUT, 'grass-probe.json'), JSON.stringify({ startedAt, conditions, boot, readings, refusals, console: lines }, null, 2));
console.log(md.join('\n'));
if (refusals.length > 0) refuse(`${refusals.length} refusal(s); the table above is what was read`);
process.exit(0);
