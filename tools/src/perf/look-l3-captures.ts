/**
 * Look uplift L3 (GH-943): the APPROVAL instrument for the Lavi's normal/ORM maps and team mask -- not a gate.
 *
 *   pnpm exec tsx tools/src/perf/look-l3-captures.ts --out=<dir> --today=<old encoded mbt_lavi.glb>
 *       [--only=garage,ingame] [--port=5187]
 *
 * One Metal Chromium, music off, its own dev server on its own port (never 5177), ONE page at a time.
 *
 * - **garage**  Sheet A. The bay's own turntable (`mountGarageView`, 1440x960 CSS px, DPR 2): three headings
 *               x {today, maps, maps + mask}, and a 2x crop of the turret for each. "today" is the Lavi as it
 *               shipped before this change: `--today` is that GLB, served in place of the new one by a route
 *               interception, so the two arms differ by the GLB alone.
 * - **ingame**  Sheet B. The gated `vehicle` framing (beit_sahwan_outskirts sandbox, tick 140), at zoom 1 and
 *               2.5, day / dawn / dusk, today vs L3; and the mask at zoom 2.5 as own, hostile and deuteranopia
 *               beside a mask-off column. Every column is the SAME page repainted at zero elapsed time, with only
 *               a debug layer or `setTeamColors` between two photographs. The HOSTILE column writes the hostile
 *               hex into the OWN slot: the hook reads one shared uniform per slot, so it is pixel-identical to a
 *               hostile hull, and the sheet says so.
 *
 * Writes PNGs and `capture.json` (GPU, resolution, tick). `tools/look_l3_sheet.py` composes the two sheets.
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { paletteColor } from '@lions/data';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach } from '../ui-review/port';

const TAG = 'look-l3';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = path.resolve(flag('out') ?? path.join(REPO_ROOT, '.superpowers/look-l3'));
const only = new Set((flag('only') ?? 'garage,ingame').split(','));
const TODAY = flag('today');
if (!TODAY || !fs.existsSync(TODAY)) throw new Error('--today=<the pre-change encoded mbt_lavi.glb> is required');
const todayBytes = fs.readFileSync(TODAY);
fs.mkdirSync(OUT, { recursive: true });

const GARAGE_W = 1440;
const GARAGE_H = 960;
const GARAGE_YAWS = [30, 150, 270];
const STUB = '/__look-l3-garage__';
const meta: Record<string, unknown> = { tag: TAG, generated: new Date().toISOString() };

const { port } = await claimPortOrAttach(TAG, 'LOOK_L3_PORT', 5187);
const stopServer = devServerStopper(await ensureDevServer(port, REPO_ROOT, TAG), TAG);
const base = `http://localhost:${port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const say = (s: string): void => console.log(`[${TAG}] ${s}`);

async function gpuOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
}

/** Replaces the Lavi GLB the page requests with the pre-change one. */
async function serveToday(page: Page): Promise<void> {
  await page.route('**/vehicles/mbt_lavi.glb*', (route) =>
    route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: todayBytes })
  );
}

// ---------------------------------------------------------------- Sheet A

function stubHtml(): string {
  const fsPath = (rel: string): string => `/@fs${path.join(REPO_ROOT, rel)}`;
  const background = paletteColor('shadow.0');
  return `<!doctype html><html><head><meta charset="utf-8"><title>look l3 garage</title></head>
<body style="margin:0;background:${background}">
<div id="host" style="width:${GARAGE_W}px;height:${GARAGE_H}px;background:${background}"></div>
<script type="module">
import { mountGarageView } from ${JSON.stringify(fsPath('packages/render/src/three/garage/garage-view.ts'))};
import { garageModelSource, garageColors, garageGroundTexture } from ${JSON.stringify(fsPath('packages/app/src/garage-model-source.ts'))};
import { dracoDecoderPath } from ${JSON.stringify(fsPath('packages/app/src/mesh-catalogue.ts'))};
let view = null;
window.__dispose = () => { if (view) { view.dispose(); view = null; } };
window.__mount = async (id, withTeam) => {
  window.__dispose();
  const source = garageModelSource(id);
  const colors = garageColors();
  const c = withTeam ? colors : { key: colors.key, fill: colors.fill, sky: colors.sky, bounce: colors.bounce, ground: colors.ground };
  view = await mountGarageView(document.getElementById('host'), {
    typeId: id, kind: source.kind, meshUrl: source.url, faction: source.faction,
    dracoDecoderPath: dracoDecoderPath(), groundTextureUrl: garageGroundTexture('/'), colors: c,
  });
  return { cls: view.info.cls, camera: view.info.camera };
};
window.__draw = (yaw) => view.draw(yaw);
window.__ready = true;
</script></body></html>`;
}

function savePng(png: PNG, name: string): void {
  fs.writeFileSync(path.join(OUT, name), PNG.sync.write(png));
}

function crop(png: PNG, x: number, y: number, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, x, y, w, h, 0, 0);
  return out;
}

async function sheetA(): Promise<void> {
  const arms: { id: string; today: boolean; team: boolean }[] = [
    { id: 'today', today: true, team: false },
    { id: 'maps', today: false, team: false },
    { id: 'maps_mask', today: false, team: true },
  ];
  const shots: Record<string, { file: string; crop: string }> = {};
  for (const arm of arms) {
    const page = await browser.newPage({ viewport: { width: GARAGE_W + 40, height: GARAGE_H + 40 }, deviceScaleFactor: 2 });
    try {
      await page.addInitScript(musicOffInitScript());
      page.on('console', (m) => {
        if (m.type() === 'error') say(`  page error: ${m.text()}`);
      });
      if (arm.today) await serveToday(page);
      await page.route(`${base}${STUB}`, (route) => route.fulfill({ contentType: 'text/html', body: stubHtml() }));
      await page.goto(`${base}${STUB}`, { waitUntil: 'load', timeout: 120_000 });
      await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 120_000 });
      meta.gpu = await gpuOf(page);
      const info = await page.evaluate(
        ([id, team]) => (window as unknown as { __mount: (i: string, t: boolean) => Promise<unknown> }).__mount(id, team),
        ['mbt_lavi', arm.team] as [string, boolean]
      );
      say(`garage ${arm.id}: ${JSON.stringify(info)}`);
      for (const yaw of GARAGE_YAWS) {
        await page.evaluate((y) => (window as unknown as { __draw: (y: number) => void }).__draw(y), yaw);
        const png = PNG.sync.read(await page.locator('#host').screenshot({ type: 'png', scale: 'device' }));
        const file = `garage_${arm.id}_yaw${yaw}.png`;
        const cropFile = `garage_${arm.id}_yaw${yaw}_turret.png`;
        savePng(png, file);
        // The turret sits above centre on the bay's camera: a 2x crop of its neighbourhood (device px).
        savePng(crop(png, Math.round(png.width * 0.28), Math.round(png.height * 0.12), Math.round(png.width * 0.44), Math.round(png.height * 0.40)), cropFile);
        shots[`${arm.id}/${yaw}`] = { file, crop: cropFile };
      }
      meta.garagePng = { width: GARAGE_W * 2, height: GARAGE_H * 2, cssWidth: GARAGE_W, cssHeight: GARAGE_H, dpr: 2 };
      await page.evaluate(() => (window as unknown as { __dispose: () => void }).__dispose());
    } finally {
      await page.close();
    }
  }
  meta.sheetA = shots;
}

// ---------------------------------------------------------------- Sheet B

interface L {
  renderer: {
    camera: { x: number; y: number; zoom: number };
    canvas: HTMLCanvasElement;
    frame(a: number, dt: number): void;
    setDebugLayerVisible(n: string, v: boolean): number;
    setTeamColors(c: [string, string, string], r: (k: string) => string): void;
  };
  sim: { tickCount: number };
  step(n: number): void;
  goto(x: number, y: number): void;
}
declare const LL: L;

async function bootIngame(today: boolean, tod: 'day' | 'dawn' | 'dusk'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  await page.addInitScript("window.__name = (f) => f; Object.defineProperty(window, 'LL', { get() { return window.__lions; } });");
  if (today) await serveToday(page);
  const todParam = tod === 'day' ? '' : `&tod=${tod}`;
  await page.goto(`${base}/?sandbox=beit_sahwan_outskirts${todParam}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 180_000 });
  await page.waitForTimeout(5000);
  await page.evaluate(async (tick) => {
    const w = window as unknown as { requestAnimationFrame: (f: FrameRequestCallback) => number };
    const raf = w.requestAnimationFrame.bind(window);
    w.requestAnimationFrame = () => 0;
    await new Promise((r) => raf(() => raf(() => r(null))));
    LL.step(Math.max(0, tick - LL.sim.tickCount));
  }, 140);
  await page.addStyleTag({ content: '.rl-feed{display:none !important}' });
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    for (const el of Array.from(document.body.children)) {
      if (canvas && el.contains(canvas)) continue;
      (el as HTMLElement).style.display = 'none';
    }
  });
  meta.gpu = await gpuOf(page);
  if (/SwiftShader/i.test(String(meta.gpu))) throw new Error('software GPU: refusing (Metal only)');
  return page;
}

async function frame(page: Page, zoom: number): Promise<PNG> {
  await page.evaluate((z) => {
    LL.goto(4.5, 20.5);
    LL.renderer.camera.zoom = z;
    LL.renderer.frame(1, 0);
    LL.renderer.frame(1, 0);
  }, zoom);
  const rect = await page.evaluate(() => {
    const r = LL.renderer.canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return PNG.sync.read(await page.screenshot({ type: 'png', clip: rect }));
}

const TEAM_SET_SCRIPT = `
  const data = await import('/@fs${path.join(REPO_ROOT, 'packages/data/src/index.ts')}');
  window.__teamSet = (variant) => { const t = data.paletteTeamColors(variant); LL.renderer.setTeamColors(t, data.variantAwareResolver(variant)); return t; };
  window.__teamSetRaw = (hexes) => { LL.renderer.setTeamColors(hexes, data.variantAwareResolver('default')); return hexes; };
  return true;`;

async function sheetB(): Promise<void> {
  const shots: Record<string, string> = {};
  const rows: { tod: 'day' | 'dawn' | 'dusk'; zooms: number[] }[] = [
    { tod: 'day', zooms: [1, 2.5] },
    { tod: 'dawn', zooms: [1] },
    { tod: 'dusk', zooms: [1] },
  ];
  for (const row of rows) {
    // today: the old GLB, a page of its own
    const today = await bootIngame(true, row.tod);
    try {
      for (const z of row.zooms) {
        const name = `ingame_${row.tod}_z${z}_today.png`;
        savePng(await frame(today, z), name);
        shots[`${row.tod}/${z}/today`] = name;
      }
    } finally {
      await today.close();
    }
    const page = await bootIngame(false, row.tod);
    try {
      for (const z of row.zooms) {
        const name = `ingame_${row.tod}_z${z}_l3.png`;
        savePng(await frame(page, z), name);
        shots[`${row.tod}/${z}/l3`] = name;
        await page.evaluate(() => LL.renderer.setDebugLayerVisible('team-mask', false));
        const off = `ingame_${row.tod}_z${z}_maskoff.png`;
        savePng(await frame(page, z), off);
        shots[`${row.tod}/${z}/maskoff`] = off;
        await page.evaluate(() => LL.renderer.setDebugLayerVisible('team-mask', true));
        await page.evaluate(() => LL.renderer.setDebugLayerVisible('normal-maps', false));
        const nm = `ingame_${row.tod}_z${z}_nomaps.png`;
        savePng(await frame(page, z), nm);
        shots[`${row.tod}/${z}/nomaps`] = nm;
        await page.evaluate(() => LL.renderer.setDebugLayerVisible('normal-maps', true));
      }
      if (row.tod === 'day') {
        // The mask as own / hostile / deuteranopia at zoom 2.5. One page; only the slot colours move.
        await page.evaluate(`(async () => {${TEAM_SET_SCRIPT}})()`);
        const colours: Record<string, unknown> = {};
        const variants: [string, string][] = [
          ['own', 'default'],
          ['deuteranopia_own', 'deuteranopia'],
        ];
        for (const [label, variant] of variants) {
          colours[label] = await page.evaluate((v) => (window as unknown as { __teamSet: (v: string) => unknown }).__teamSet(v), variant);
          const name = `ingame_mask_${label}_z2.5.png`;
          savePng(await frame(page, 2.5), name);
          shots[`mask/${label}`] = name;
        }
        // Hostile: the hostile hex in the OWN slot.
        const hostile = await page.evaluate(() => {
          const t = (window as unknown as { __teamSet: (v: string) => string[] }).__teamSet('default');
          return (window as unknown as { __teamSetRaw: (h: string[]) => string[] }).__teamSetRaw([t[1], t[1], t[1]]);
        });
        colours.hostile = hostile;
        savePng(await frame(page, 2.5), 'ingame_mask_hostile_z2.5.png');
        shots['mask/hostile'] = 'ingame_mask_hostile_z2.5.png';
        // mask off, restored colours
        await page.evaluate((v) => (window as unknown as { __teamSet: (v: string) => unknown }).__teamSet(v), 'default');
        await page.evaluate(() => LL.renderer.setDebugLayerVisible('team-mask', false));
        savePng(await frame(page, 2.5), 'ingame_mask_off_z2.5.png');
        shots['mask/off'] = 'ingame_mask_off_z2.5.png';
        await page.evaluate(() => LL.renderer.setDebugLayerVisible('team-mask', true));
        meta.teamColours = colours;
      }
      meta.tick = await page.evaluate(() => LL.sim.tickCount);
    } finally {
      await page.close();
    }
  }
  meta.ingame = { viewport: '1400x900 CSS, DPR 2', camera: 'goto(4.5, 20.5), zoom as named', sheetB: shots };
}

try {
  if (only.has('garage')) await sheetA();
  if (only.has('ingame')) await sheetB();
  fs.writeFileSync(path.join(OUT, 'capture.json'), `${JSON.stringify(meta, null, 2)}\n`);
  say(`wrote ${OUT}`);
} finally {
  await browser.close();
  stopServer();
}
