/**
 * Before/after sheet for the damage pass: each vehicle's wreck as it shipped
 * BEFORE (`--rev`, default `origin/main`) beside the damaged one on disk,
 * through the LIVE renderer, at four headings and zoom 1.0 and 2.5.
 *
 *   npx tsx src/perf/wreck-damage-captures.ts <base> <outDir> [--ids=mbt_lavi,ifv_namer] [--rev=origin/main] [--swiftshader]
 *
 * Run from `tools/` against a dev server you started yourself on a free port.
 *
 * Built from `wreck-captures.ts` (the parade, debugKill, the music-off seed)
 * plus the one thing that harness lacks: `before` is served by INTERCEPTING
 * `/meshes/vehicles/<id>.glb` and answering from `git show <rev>:assets/...`,
 * the `gait-captures.ts` way, so nothing in the tree changes and the server
 * never restarts. **The interception is checked**: a `before` pass that did
 * not serve, for every id, bytes whose length differs from the file on disk
 * throws -- a route glob that stopped matching would otherwise produce a
 * "before" that is a second copy of "after", and looks exactly right.
 *
 * Wrecks are photographed 65 s of SIM time after the kill, past
 * `WRECK_SMOULDER_SECONDS` (60): the look a wreck keeps for the rest of the
 * mission, not the first seconds under its own smoke.
 */
import { chromium, type Page, type Route } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs } from '../ui-review/gpu';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (name: string, fallback: string): string => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const [base, out] = positional as [string, string];
if (!base || !out) throw new Error('usage: wreck-damage-captures.ts <base> <outDir> [--ids=a,b] [--rev=origin/main]');
const ids = flag('ids', 'mbt_lavi').split(',').filter(Boolean);
const rev = flag('rev', 'origin/main');
const gpu = process.argv.includes('--swiftshader') ? 'swiftshader' : 'metal';
const REPO = path.resolve(process.cwd(), '..');
fs.mkdirSync(out, { recursive: true });

const ZOOMS = [1.0, 2.5] as const;
const HEADINGS = [0, 0.25, 0.5, 0.75] as const;
/** Row 3 of beit_sahwan_outskirts is open ground end to end; 10 tiles apart keeps neighbours out of the 2.5 crop. */
const COLS = [6, 16, 26, 36] as const;
const ROW_Y = 3;
const CLIP: Record<number, { w: number; h: number }> = { 1: { w: 420, h: 280 }, 2.5: { w: 860, h: 560 } };

interface LionsWindow {
  __lions: {
    step(n: number): number;
    renderer: { camera: { x: number; y: number; zoom: number }; frame(a: number, dt: number): void };
    sim: {
      unitTypes: { id: string }[];
      spawn(typeIdx: number, side: number, x: number, y: number, facing?: number): number;
      debugKill(id: number): void;
    };
  };
}

const revBytes = (id: string): Buffer =>
  execFileSync('git', ['-C', REPO, 'show', `${rev}:assets/meshes/vehicles/${id}.glb`], { maxBuffer: 256 * 1024 * 1024 });
const diskLen = (id: string): number => fs.statSync(path.join(REPO, 'assets/meshes/vehicles', `${id}.glb`)).size;

const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(gpu) });
const served: { pass: string; id: string; bytes: number }[] = [];
const log: string[] = [];

async function run(pass: 'before' | 'after', id: string): Promise<void> {
  const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(musicOffInitScript());
  page.on('console', (m) => {
    if (m.type() === 'error') log.push(`${pass} ${id} console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => log.push(`${pass} ${id} pageerror: ${e.message}`));
  await page.route(`**/meshes/vehicles/${id}.glb*`, async (route: Route) => {
    if (pass === 'before') {
      const body = revBytes(id);
      served.push({ pass, id, bytes: body.length });
      await route.fulfill({ status: 200, contentType: 'model/gltf-binary', body });
      return;
    }
    const resp = await route.fetch();
    const body = await resp.body();
    served.push({ pass, id, bytes: body.length });
    await route.fulfill({ response: resp, body });
  });

  await page.goto(`${base}/?sandbox=beit_sahwan_outskirts`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 90000 });
  await page.waitForTimeout(3000);

  const entities = await page.evaluate(
    (arg: { vid: string; cols: number[]; y: number; heads: number[] }) => {
      const L = (window as unknown as LionsWindow).__lions;
      const FIXED = 65536;
      const t = L.sim.unitTypes.findIndex((u) => u.id === arg.vid);
      if (t < 0) throw new Error(`no unit type ${arg.vid}`);
      return arg.cols.map((x, k) => L.sim.spawn(t, 0, x * FIXED, arg.y * FIXED, Math.round(arg.heads[k]! * FIXED)));
    },
    { vid: id, cols: [...COLS] as number[], y: ROW_Y, heads: [...HEADINGS] as number[] }
  );

  const frames = (n: number) =>
    page.evaluate((c) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      for (let i = 0; i < c; i++) r.frame(1, 1000 / 60);
    }, n);
  const cam = async (x: number, z: number) => {
    await page.evaluate(
      ([cx, cy, cz]) => {
        const c = (window as unknown as LionsWindow).__lions.renderer.camera;
        c.x = cx!;
        c.y = cy!;
        c.zoom = cz!;
      },
      [x, ROW_Y, z]
    );
    await frames(3);
    await page.waitForTimeout(250);
  };
  const shot = async (name: string, zoom: number) => {
    const { w, h } = CLIP[zoom]!;
    await page.screenshot({ path: path.join(out, `${name}.png`), clip: { x: 720 - w / 2, y: 450 - h / 2, width: w, height: h } });
  };

  // The unrostered types arrive through `main.ts`'s 1 Hz sweep.
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(20));
  await page.waitForTimeout(6000);
  await frames(4);
  if (pass === 'after') {
    for (let k = 0; k < COLS.length; k++) for (const z of ZOOMS) {
      await cam(COLS[k]!, z);
      await shot(`${id}-live-h${HEADINGS[k]}-z${z}`, z);
    }
  }
  await page.evaluate((es) => {
    for (const e of es) (window as unknown as LionsWindow).__lions.sim.debugKill(e);
  }, entities);
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(1300));
  await frames(360);
  await page.waitForTimeout(1500);
  await frames(6);
  for (let k = 0; k < COLS.length; k++) for (const z of ZOOMS) {
    await cam(COLS[k]!, z);
    await shot(`${id}-${pass}-h${HEADINGS[k]}-z${z}`, z);
  }
  await page.close();
  console.log(`${id} ${pass} done`);
}

try {
  for (const id of ids) {
    await run('before', id);
    await run('after', id);
  }
} finally {
  await browser.close();
}

for (const id of ids) {
  const b = served.filter((s) => s.id === id && s.pass === 'before');
  const a = served.filter((s) => s.id === id && s.pass === 'after');
  if (b.length === 0 || b.some((s) => s.bytes === diskLen(id))) {
    throw new Error(`${id}: the before pass did not serve ${rev}'s bytes (served ${JSON.stringify(b)}, disk ${diskLen(id)})`);
  }
  if (a.length === 0 || a.some((s) => s.bytes !== diskLen(id))) {
    throw new Error(`${id}: the after pass did not serve the on-disk file (served ${JSON.stringify(a)}, disk ${diskLen(id)})`);
  }
}
const report = { gpu, rev, served, log };
fs.writeFileSync(path.join(out, 'capture-log.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (log.length) process.exitCode = 1;
