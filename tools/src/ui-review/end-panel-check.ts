// Are the end-of-mission actions reachable at every viewport size?
//
// The lead's bug (WH V victory, live site): the end panel sat at `top: 62%`
// and grew downward with the debrief quote and the aftermath, so its
// next-mission and replay buttons landed below the viewport and could not be
// clicked. jsdom has no layout, so the GEOMETRY half of the fix can only be
// judged in a browser; the structural half (the action row lives outside the
// scrolling body, focus lands on the primary) is pinned in
// `packages/app/src/ui/end-panel.test.ts` and runs in `pnpm test`.
//
// What this does: boots ONE sandbox on the WH V map behind its own dev server,
// mounts the real `showEndScreen`/`showDebrief` over it with WH V's own
// authored debrief and aftermath, and at each viewport asks of every action in
// the panel's nav: is its box inside the viewport, and does a hit test at its
// centre land on it (so a HUD element drawn over it counts as unreachable)? It
// also reports which element holds focus. Exit 1 on any miss.
//
// Run locally, once, one browser -- it is evidence for a bug fix, not a CI
// gate: `pnpm --filter @lions/tools end-panel:check [--port=<n>] [--out=<dir>]`.
// `--out` writes the 1440x900 and 1280x720 screenshots the PR quotes.
import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { claimGpuBackend, gpuLaunchArgs } from './gpu';
import { claimPort } from './port';
import { musicOffInitScript } from './music-off';

const TAG = 'end-panel';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice('--out='.length)) : null;

/** The brief's five desktop sizes, plus a 1280x600 window and the same window
 *  with ~120 px of browser toolbars taken off the top. */
const VIEWPORTS: readonly [number, number][] = [
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
  [1280, 600],
  [1280, 480],
];
const SHOTS = new Set(['1440x900', '1280x720']);

const wh5 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/missions/wadi_halam_5_depot.json'), 'utf8')) as {
  debrief: { victory: { text: string }; defeat: { text: string } };
  aftermath: string;
};
const tut = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/missions/beit_sahwan_0_tutorial.json'), 'utf8')) as {
  debrief: { victory: { text: string } };
};

type Case = 'victory' | 'defeat' | 'tutorial' | 'debrief';
const CASES: readonly Case[] = ['victory', 'defeat', 'tutorial', 'debrief'];

/** Mounts one end-of-mission surface in the page, through the app's own
 *  modules (same URLs `main.ts` imports, so the same i18n catalogue). Returns
 *  nothing; the panel is the last `.rl-panel` on `document.body`. */
async function mount(page: Page, kind: Case): Promise<void> {
  const shaiFace = '/ui/portraits/shai_hammai.png';
  const iditFace = '/ui/portraits/idit_zohar.png';
  await page.evaluate(
    async ({ kind, wh5, tut, shaiFace, iditFace }) => {
      const w = window as unknown as { __endCheckDispose?: () => void };
      w.__endCheckDispose?.();
      // Served by the dev server, so the same module instances `main.ts` holds.
      const menuUrl: string = '/src/ui/menu.ts';
      const debriefUrl: string = '/src/ui/debrief.ts';
      const menu = (await import(/* @vite-ignore */ menuUrl)) as typeof import('../../../packages/app/src/ui/menu');
      const debrief = (await import(/* @vite-ignore */ debriefUrl)) as typeof import('../../../packages/app/src/ui/debrief');
      const body = document.body;
      if (kind === 'victory') {
        w.__endCheckDispose = menu.showEndScreen(body, {
          result: 'victory',
          roe: 94,
          survivors: 11,
          conduct: 'Clinic struck ×2 −10 · +1 more',
          withdrew: 3,
          missionId: 'wadi_halam_5_depot',
          nextMissionId: 'tel_marum_1_recon',
          debrief: { plate: 'Hammai', text: wh5.debrief.victory.text, portrait: shaiFace, speaker: 'shai' },
          aftermath: wh5.aftermath,
          onDebrief: () => undefined,
        });
      } else if (kind === 'defeat') {
        w.__endCheckDispose = menu.showEndScreen(body, {
          result: 'defeat',
          roe: 61,
          survivors: 0,
          missionId: 'wadi_halam_5_depot',
          debrief: { plate: 'Zohar', text: wh5.debrief.defeat.text, portrait: iditFace, speaker: 'idit' },
          onDebrief: () => undefined,
        });
      } else if (kind === 'tutorial') {
        w.__endCheckDispose = menu.showEndScreen(body, {
          result: 'victory',
          roe: 100,
          survivors: 9,
          missionId: 'beit_sahwan_0_tutorial',
          nextMissionId: 'beit_sahwan_1_recon',
          debrief: { plate: 'Hammai', text: tut.debrief.victory.text, portrait: shaiFace, speaker: 'shai' },
          onDebrief: () => undefined,
        });
      } else {
        w.__endCheckDispose = debrief.showDebrief(body, {
          result: 'victory',
          stars: 3,
          tierLine: { plate: 'Hammai', text: wh5.debrief.victory.text },
          roe: 94,
          roeFloor: 60,
          invoice: [
            { label: 'Clinic struck', cause: 'struck', count: 2, total: 10, ticks: [2400, 3100] },
            { label: 'Civilians killed', cause: 'civilians', count: 1, total: 5, ticks: [5200] },
          ],
          ticks: 8400,
          targetMinutes: 7,
          lost: [
            { type: 'inf_squad', count: 2 },
            { type: 'apc_eitan', count: 1 },
          ],
          lostNamed: [{ name: 'Barkai', type: 'inf_squad' }],
          replacements: [{ name: 'Gilad', predecessor: 'Barkai' }],
          secondaries: [
            { text: 'Keep the clinic standing', complete: true, carries: true },
            { text: 'Mark the depot vents', complete: true, carries: false },
            { text: 'Bring the drivers home', complete: false, carries: true },
          ],
          marked: 4,
          promoted: 2,
          credits: { paid: 320, balance: 1180 },
          taken: 'Fifteen still out. Four came back at the shaft head.',
          unlocked: ['Campaign Conduct 58 → 62: Namer IFV available', 'Five stars: the Ari’im company'],
          promotion: { rank: 'Ari Actual', stars: 5, line: { plate: 'Zohar', text: wh5.aftermath } },
          next: { id: 'tel_marum_1_recon', name: 'Tel Marum I', villainLine: 'Abu Sakhr, on the net: “Come up the hill.”' },
          missionId: 'wadi_halam_5_depot',
          withdrew: 3,
        });
      }
    },
    { kind, wh5, tut, shaiFace, iditFace }
  );
  // Past `.rl-enter` (var(--dur)) and any image decode.
  await page.waitForTimeout(500);
}

interface Reading {
  label: string;
  inView: boolean;
  hit: boolean;
  rect: [number, number, number, number];
}

async function measure(page: Page): Promise<{ actions: Reading[]; primary: string | null; focused: string | null }> {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('body > .rl-panel')];
    const p = panels[panels.length - 1];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const actions = [...p.querySelectorAll<HTMLElement>('.rl-endnav a, .rl-endnav button')].map((a) => {
      const r = a.getBoundingClientRect();
      const inView = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
      const at = inView ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      const hit = at !== null && (at === a || a.contains(at));
      return {
        label: (a.textContent ?? '').trim(),
        inView,
        hit,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] as [number, number, number, number],
      };
    });
    const primaryEl = p.querySelector<HTMLElement>('.rl-endnav [data-end-primary]');
    const focused = document.activeElement && p.contains(document.activeElement) ? (document.activeElement.textContent ?? '').trim() : null;
    return { actions, primary: primaryEl ? (primaryEl.textContent ?? '').trim() : null, focused };
  });
}

const port = await claimPort(TAG, 'END_PANEL_PORT', 5194);
const devServer = await ensureDevServer(port, REPO_ROOT, TAG);
let browser: Browser | null = null;
let failures = 0;
try {
  browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(claimGpuBackend(TAG)) });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(musicOffInitScript());
  // tsx compiles this file with esbuild's keepNames, which wraps named
  // functions inside the `page.evaluate` bodies in a `__name` helper the page
  // does not have.
  await ctx.addInitScript('globalThis.__name = (f) => f;');
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?sandbox=wadi_halam_5`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined, null, {
    timeout: 90_000,
  });
  await page.waitForTimeout(1500);
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  for (const kind of CASES) {
    await mount(page, kind);
    for (const [w, h] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      const m = await measure(page);
      const bad = m.actions.filter((a) => !a.inView || !a.hit);
      if (m.actions.length === 0) failures++;
      failures += bad.length;
      const verdict = m.actions.length > 0 && bad.length === 0 ? 'PASS' : 'FAIL';
      console.log(
        `[${TAG}] ${verdict} ${kind.padEnd(8)} ${`${w}x${h}`.padEnd(9)} ` +
          `${m.actions.length} action(s), ${bad.length} unreachable` +
          `${bad.length ? ` [${bad.map((b) => `${b.label}@${b.rect.join(',')}${b.inView ? ' covered' : ''}`).join('; ')}]` : ''}` +
          ` | primary=${m.primary ?? '-'} focus=${m.focused ?? '-'}`
      );
      const key = `${w}x${h}`;
      if (OUT && SHOTS.has(key) && (kind === 'victory' || kind === 'debrief')) {
        await page.screenshot({ path: path.join(OUT, `${kind}-${key}.png`) });
      }
    }
  }
  await ctx.close();
} finally {
  await browser?.close();
  stopDevServer(devServer, TAG);
}
console.log(`[${TAG}] ${failures === 0 ? 'every action reachable' : `${failures} unreachable action reading(s)`}`);
process.exit(failures === 0 ? 0 : 1);
