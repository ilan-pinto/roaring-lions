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
// mounts the real after-action report (`showDebrief`, GH-417) over it with WH V's own
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

// The reports, as plain data built here: a function defined INSIDE
// page.evaluate would be rewritten by tsx's keepNames with a `__name` helper
// the page does not have (garage-seed.ts's note).
const item = (mark: string, text: string, sub?: string) => ({ mark, tone: 'plain' as const, text, ...(sub ? { sub } : {}) });
const SHORT = { reason: ['7:03 on the clock, of about 7:00'], ladder: [], well: [item('4:12', 'Raze the depot inside five minutes')], poor: [], changed: [], pins: [] };
const LONG = {
  reason: ['Raze the depot inside five minutes · 4:12', 'Kill or capture whoever is holding the gate', 'Hold the depot for four minutes once it is down · 8:24', '7:03 on the clock, of about 7:00'],
  ladder: [
    { stars: 1 as const, met: true, text: 'Won the mission' },
    { stars: 2 as const, met: true, text: 'Conduct 94, needed 60' },
    { stars: 3 as const, met: false, text: 'Optional objectives that carry forward: 1 of 2' },
  ],
  well: [item('4:12', 'Raze the depot inside five minutes'), item('8:24', 'Hold the depot for four minutes'), item('94', 'Conduct held above the second-star line (60)'), item('31', '31 enemy killed · 3 withdrew')],
  poor: [item('−10', 'Clinic struck ×2', '2:00, 2:35'), item('−5', 'Civilians killed', '4:20'), item('', 'Barkai · Rifle Squad', 'Lost at 5:40. Gilad takes the place.'), item('−2', 'Rifle Squad ×2 lost (fresh crew)'), item('★★★', 'Missed: Bring the drivers home')],
  changed: [item('+320', 'Credits paid · brigade now 1180', 'Paid only for beating your best on this mission.'), item('', 'Tzur ★★ → ★★★'), item('', 'Gilad took Barkai’s place'), item('Garage', 'Can now be bought: Namer IFV', 'Campaign Conduct 58 → 62. In the garage; not added to your force.'), item('Taken', 'Fifteen still out. Four came back at the shaft head.')],
  pins: [],
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
    async ({ kind, wh5, tut, shaiFace, iditFace, SHORT, LONG }) => {
      const w = window as unknown as { __endCheckDispose?: () => void };
      w.__endCheckDispose?.();
      // Served by the dev server, so the same module instances `main.ts` holds.
      const debriefUrl: string = '/src/ui/debrief.ts';
      const debrief = (await import(/* @vite-ignore */ debriefUrl)) as typeof import('../../../packages/app/src/ui/debrief');
      const body = document.body;
      // GH-417 (L-7): one screen after a mission now, the after-action report.
      // The four cases keep their shapes: a rich victory, a defeat, the
      // tutorial's ending, and a report as long as one can get.
      if (kind === 'victory') {
        w.__endCheckDispose = debrief.showDebrief(body, {
          result: 'victory', stars: 2, report: LONG, missionId: 'wadi_halam_5_depot',
          speaker: { plate: 'Hammai', text: wh5.debrief.victory.text, portrait: shaiFace, speaker: 'shai' },
          aftermath: wh5.aftermath,
          next: { id: 'tel_marum_1_recon', name: 'Tel Marum I' },
        });
      } else if (kind === 'defeat') {
        w.__endCheckDispose = debrief.showDebrief(body, {
          result: 'defeat', stars: 0, missionId: 'wadi_halam_5_depot',
          report: { ...SHORT, reason: ['Objective failed: Raze the depot inside five minutes · 5:00'], changed: [{ mark: '0', tone: 'plain', text: 'Nothing was written to the campaign' }] },
          speaker: { plate: 'Zohar', text: wh5.debrief.defeat.text, portrait: iditFace, speaker: 'idit' },
        });
      } else if (kind === 'tutorial') {
        w.__endCheckDispose = debrief.showDebrief(body, {
          result: 'victory', stars: 2, report: SHORT, missionId: 'beit_sahwan_0_tutorial',
          speaker: { plate: 'Hammai', text: tut.debrief.victory.text, portrait: shaiFace, speaker: 'shai' },
          next: { id: 'beit_sahwan_1_recon', name: 'Beit Sahwan I' },
        });
      } else {
        w.__endCheckDispose = debrief.showDebrief(body, {
          result: 'victory', stars: 3, report: LONG, missionId: 'wadi_halam_5_depot',
          tierLine: { plate: 'Hammai', text: wh5.debrief.victory.text },
          speaker: { plate: 'Hammai', text: wh5.debrief.victory.text, portrait: shaiFace, speaker: 'shai' },
          aftermath: wh5.aftermath,
          promotion: { rank: 'Ari Actual', stars: 5, line: { plate: 'Zohar', text: wh5.aftermath } },
          next: { id: 'tel_marum_1_recon', name: 'Tel Marum I', villainLine: 'Abu Sakhr, on the net: “Come up the hill.”' },
        });
      }
    },
    { kind, wh5, tut, shaiFace, iditFace, SHORT, LONG }
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
    const actions = [...p.querySelectorAll<HTMLElement>('.rl-foot a, .rl-foot button')].map((a) => {
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
    const primaryEl = p.querySelector<HTMLElement>('.rl-foot [data-end-primary]');
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
