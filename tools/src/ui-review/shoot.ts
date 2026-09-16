// One capture pass of every shell screen and HUD state, at commercial
// resolutions, so every reviewer works from identical evidence. Promoted
// from the shell review's scratch driver (`.superpowers/ui-review-2026-09-16/
// shoot.ts`, git-ignored, never wired to a script): this version manages its
// OWN dev server (never a human's `pnpm dev`) the way
// `tools/src/golden-diff/browser.ts`'s two gates do, and launches Chromium
// the way `tools/src/perf/wreck-captures.ts` does, so it runs unattended --
// no positional base-URL argument, no assumption a server is already up.
//
// Usage: pnpm ui:shots -- [--res=1400x900,1920x1080,2560x1440] [--out=.superpowers/ui-shots]
//
// Writes <out>/<WxH>/NN-<state>.png for the eleven states below. Every later
// Phase 0 task's acceptance is read off these files -- see
// .superpowers/sdd/2026-09-16-shell-upgrade-phase-0/.
//
// Two things kept from the scratch pass, both learned the hard way: never
// abort `/@vite/client` (Vite dev injects CSS-module styles through it;
// aborting it produces blank PNGs -- this script does no request
// interception at all, which is the simplest way to keep that true), and the
// output directory must be OUTSIDE the watched tree (a PNG written inside
// packages/app or assets/ triggers vite-plugin-asset-watch and reloads the
// page being photographed) -- .superpowers/ is git-ignored and unwatched.
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'ui-shots';
// Not the human dev-server convention (:5173) and not another tool's managed
// port (:5174 golden-diff, :5175 three-baseline) -- this script starts and
// stops its own, so it needs a port nothing else claims.
const PORT = 5176;
const MISSION = 'beit_sahwan_1_recon';

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
// Resolved against the repo root, not process.cwd(): `pnpm ui:shots` always
// reaches this file through `pnpm --filter @lions/tools`, which runs the
// script with cwd set to tools/ (verified directly: `pnpm --filter
// @lions/tools exec pwd`), so a bare `path.resolve(arg(...))` would land
// under tools/.superpowers/ instead of the repo root every later task's
// briefs assume when they write `--out=.superpowers/ui-shots/taskN`.
// `path.resolve(REPO_ROOT, p)` leaves an absolute --out untouched, same as
// three-baseline-gate.ts's outDir.
const OUT = path.resolve(REPO_ROOT, arg('out', '.superpowers/ui-shots'));
const RESOLUTIONS = arg('res', '1400x900,1920x1080,2560x1440')
  .split(',')
  .map((s) => {
    const [w, h] = s.split('x').map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error(`bad --res entry "${s}"`);
    return { width: w, height: h };
  });

interface LionsWindow extends Window {
  __lions?: {
    sim: { queueCommand(c: unknown): void; tick: number };
    renderer: { camera: { x: number; y: number; zoom: number } };
    step(n: number): void;
    units(): { id: number; type: string; x: number; y: number }[];
    sel(ids: number[]): void;
  };
}

async function shot(page: Page, dir: string, name: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
  console.log(`  ${name}`);
}

async function settle(page: Page, ms: number): Promise<void> {
  // Fonts and the module graph first, then the entrance motion.
  await page
    .waitForFunction(
      () => document.fonts.status === 'loaded' && document.body.innerText.trim().length > 20,
      null,
      { timeout: 30000 }
    )
    .catch(() => undefined);
  await page.waitForTimeout(ms);
}

async function passDeployGate(page: Page): Promise<boolean> {
  // main.ts holds `await loading.done()` until the deploy button is clicked,
  // and the click listener is attached inside done() itself -- so click every
  // 250 ms until __lions exists (the golden-diff harness learned this the hard way).
  for (let i = 0; i < 120; i++) {
    const ready = await page.evaluate(() => !!(window as LionsWindow).__lions?.renderer);
    if (ready) return true;
    const btn = page.getByRole('button', { name: /deploy/i }).first();
    try {
      await btn.click({ timeout: 200 });
    } catch {
      /* not attached yet */
    }
    await page.waitForTimeout(250);
  }
  return false;
}

const BASE = `http://localhost:${PORT}`;
const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  for (const res of RESOLUTIONS) {
    const dirName = `${res.width}x${res.height}`;
    const dir = path.join(OUT, dirName);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n== ${dirName}`);
    const ctx = await browser.newContext({
      viewport: { width: res.width, height: res.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);

    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await settle(page, 2500);
    await shot(page, dir, '01-menu');
    await page.goto(`${BASE}/?campaign`, { waitUntil: 'load' });
    await settle(page, 7000);
    await shot(page, dir, '02-campaign');
    await page.goto(`${BASE}/?brigade`, { waitUntil: 'load' });
    await settle(page, 3000);
    await shot(page, dir, '03-brigade');
    await page.goto(`${BASE}/?sandboxes`, { waitUntil: 'load' });
    await settle(page, 2500);
    await shot(page, dir, '04-sandboxes');

    // The briefing / deploying screen, before the deploy click.
    await page.goto(`${BASE}/?mission=${MISSION}`, { waitUntil: 'load' });
    await settle(page, 6000);
    await shot(page, dir, '05-briefing');

    const deployed = await passDeployGate(page);
    if (!deployed) {
      console.log('  !! deploy gate never cleared');
      await ctx.close();
      continue;
    }
    await settle(page, 1500);
    await page.evaluate(() => (window as LionsWindow).__lions?.step(40));
    await settle(page, 600);
    await shot(page, dir, '06-hud-idle');

    // Selection cluster: one squad, then a mixed group.
    const picked = await page.evaluate(() => {
      const L = (window as LionsWindow).__lions;
      if (!L) return null;
      const us = L.units();
      const squad = us.find((u) => u.type === 'inf_squad') ?? us[0];
      if (!squad) return null;
      L.sel([squad.id]);
      L.renderer.camera.x = squad.x;
      L.renderer.camera.y = squad.y;
      return squad;
    });
    await settle(page, 700);
    await shot(page, dir, '07-hud-selection-squad');

    await page.evaluate(() => {
      const L = (window as LionsWindow).__lions;
      if (!L) return;
      const us = L.units();
      const ids = us.slice(0, 6).map((u) => u.id);
      L.sel(ids);
    });
    await settle(page, 700);
    await shot(page, dir, '08-hud-selection-mixed');

    await page.evaluate(() => {
      const L = (window as LionsWindow).__lions;
      if (L) L.renderer.camera.zoom = 2.5;
    });
    await settle(page, 700);
    await shot(page, dir, '09-hud-zoom2.5');
    await page.evaluate(() => {
      const L = (window as LionsWindow).__lions;
      if (L) L.renderer.camera.zoom = 0.5;
    });
    await settle(page, 700);
    await shot(page, dir, '10-hud-zoom0.5');
    await page.evaluate(() => {
      const L = (window as LionsWindow).__lions;
      if (L) L.renderer.camera.zoom = 1;
    });

    // Combat: attack-move the squad toward the far side of the map and step
    // until something happens, so the feed, suppression and ROE strip draw.
    await page.evaluate((sq) => {
      const L = (window as LionsWindow).__lions;
      if (!L || !sq) return;
      L.sel([sq.id]);
      L.sim.queueCommand({
        kind: 'attackMove',
        ids: [sq.id],
        x: Math.round((sq.x + 18) * 65536),
        y: Math.round(sq.y * 65536),
      });
      L.step(360);
      L.renderer.camera.x = sq.x + 9;
      L.renderer.camera.y = sq.y;
    }, picked);
    await settle(page, 900);
    await shot(page, dir, '11-hud-combat');

    await ctx.close();
  }
} finally {
  await browser.close();
  stopDevServer(devServer, TAG);
}
console.log(`\ndone -> ${OUT}`);
