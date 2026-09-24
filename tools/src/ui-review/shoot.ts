// One capture pass of every shell screen and HUD state, at commercial
// resolutions, so every reviewer works from identical evidence. Promoted
// from the shell review's scratch driver (`.superpowers/ui-review-2026-09-16/
// shoot.ts`, git-ignored, never wired to a script): this version manages its
// OWN dev server (never a human's `pnpm dev`) the way
// `tools/src/golden-diff/browser.ts`'s two gates do, and launches Chromium
// the way `tools/src/perf/wreck-captures.ts` does, so it runs unattended --
// no positional base-URL argument, no assumption a server is already up.
//
// Usage: pnpm ui:shots -- [--pseudo] [--res=1400x900,1920x1080,2560x1440] [--out=.superpowers/ui-shots] [--port=5176]
//
// The port is `--port=<n>`, else `UI_SHOTS_PORT`, else 5176 (`./port.ts`). A
// port something else already holds is REFUSED, exit 2, before a browser or a
// server starts: `ensureDevServer` would otherwise attach to that server and
// photograph whichever checkout it serves.
//
// Writes <out>/<WxH>/NN-<state>.png for the twenty-five states below (Phase
// 0 shipped seventeen; Phase 2's Task 14 added 18-hud-alert, 19-objectives,
// 20-keys, 21-tooltip, 22-groups and 23-minimap-ping; Phase 3's Task 6 added
// 25-outcome-defeat and 24-outcome-victory). Every later task's acceptance is
// read off these files -- see
// .superpowers/sdd/2026-09-16-shell-upgrade-phase-0/ and
// .superpowers/sdd/2026-09-18-shell-upgrade-phase-2/.
//
// `--pseudo` appends `?pseudo=1` to every navigation (`url()` below), which
// swaps the real catalogue for the bracketed pseudo-locale one
// (`i18n/pseudo.ts`) on whichever screen loads -- a plain, unbracketed word
// in a pseudo capture is a string that never went through `t()`.
//
// 16-end-defeat and 17-debrief are a SCRIPTED defeat: `debugKill` every
// player unit and step the sim until `checkEnd` notices, which a script can
// do without knowing a single thing about the mission. Task 5's outcome
// moment (`ui/outcome-moment.ts`) now holds in FRONT of the end screen, so
// `25-outcome-defeat` photographs it first and clicks `.rl-outcome__skip`
// before `.rl-endnav` (below) ever appears -- without the skip that wait
// times out at 15s, which is how this ordering was found. A victory needs
// the mission's own objectives satisfied for real rather than a `debugKill`
// equivalent (there is no `debugWin`, and adding one would be a sim change),
// so `24-outcome-victory` drives `beit_sahwan_1_recon`'s own primary
// (`picture`: locate 6 positions) by waypoint, the way `playtest.ts`'s own
// recon plan does (`tools/src/backtest/playtest.ts`) -- measured against the
// real runtime (`tools/src/mission-harness.ts`) to reach victory at tick 426
// (21.3s) at both the harness's own seed and `main.ts`'s real mission seed
// (20260727), so the margin stepped below is not sitting on the edge.
//
// Two things kept from the scratch pass, both learned the hard way: never
// abort `/@vite/client` (Vite dev injects CSS-module styles through it;
// aborting it produces blank PNGs -- this script does no request
// interception at all, which is the simplest way to keep that true), and the
// output directory must be OUTSIDE the watched tree (a PNG written inside
// packages/app or assets/ triggers vite-plugin-asset-watch and reloads the
// page being photographed) -- .superpowers/ is git-ignored and unwatched.
import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dismissDeployGate, ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { assertOutcomeStillPresent } from './outcome-guard';
import { claimPort } from './port';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'ui-shots';
// The DEFAULT: not the human dev-server convention (:5173) and not another
// tool's managed port (:5174 golden-diff, :5175 three-baseline). This script
// starts and stops its own server, so it needs a port nothing else claims --
// and on a machine where something does, `--port=`/`UI_SHOTS_PORT` pick
// another, and `claimPort` refuses the busy one rather than sharing it.
const DEFAULT_PORT = 5176;
const PORT = await claimPort(TAG, 'UI_SHOTS_PORT', DEFAULT_PORT);
const MISSION = 'beit_sahwan_1_recon';

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
// Value-less, unlike every other flag here: `--pseudo` is a switch, not a
// `--name=value` pair, so it is read straight off argv rather than through
// `arg()`.
const PSEUDO = argv.includes('--pseudo');
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

/** Counted across the whole run and printed at the end -- a per-shot line is
 *  easy to scroll past in 51 frames' worth of output. */
let OVERFLOW_TOTAL = 0;

interface LionsWindow extends Window {
  __lions?: {
    sim: { queueCommand(c: unknown): void; tick: number; debugKill(id: number): void };
    renderer: { camera: { x: number; y: number; zoom: number } };
    step(n: number): void;
    units(side?: number): { id: number; type: string; x: number; y: number }[];
    sel(ids: number[]): void;
  };
}

/**
 * Every element inside the shell's own chrome whose content is wider than the
 * box drawn for it.
 *
 * I5 (final review): until this, `shoot.ts` wrote PNGs and NOTHING measured
 * clipping -- so "the pseudo-localised capture pass shows no clipped chrome
 * string", a Phase 1 acceptance item, rested entirely on somebody looking at
 * 51 frames and nobody in the ledger recording that they had. A human still
 * has to look (a string can be wrong without overflowing, and an ellipsis can
 * be the intended design), but the mechanical half of the question is
 * mechanical and should be asked mechanically.
 *
 * **A printed report, not a gate, deliberately.** A threshold on "how much
 * overflow is acceptable" would be a fitted number of exactly the kind
 * CLAUDE.md warns about -- several of these are intentional (`text-overflow:
 * ellipsis` is a design decision, and a scroll container is SUPPOSED to be
 * wider than its viewport). What the probe is for is the case nobody thought
 * about: a row that overflowed only under a 40%-padded locale, on a screen
 * nobody happened to open.
 *
 * `+1` because `scrollWidth`/`clientWidth` are integers rounded from
 * fractional layout, so a sub-pixel box reports a 1px "overflow" that is not
 * one. Scoped to `.rl-menu`, `.rl-panel` and `.rl-garage` (the review's list):
 * the canvas and the HUD's own strip are drawn, not laid out, and would report
 * noise forever.
 */
async function overflows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const roots = document.querySelectorAll('.rl-menu, .rl-panel, .rl-garage');
    const hits: string[] = [];
    const seen = new Set<Element>();
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (!(el instanceof HTMLElement)) continue;
        if (el.scrollWidth <= el.clientWidth + 1) continue;
        // A selector a reader can paste into devtools, plus the numbers and
        // the first of the text, which is what makes a hit actionable rather
        // than a coordinate.
        const cls = el.className.toString().trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
        const sel = `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48);
        hits.push(`${sel} ${el.scrollWidth}>${el.clientWidth} "${text}"`);
      }
    }
    return hits;
  });
}

async function shot(page: Page, dir: string, name: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
  const over = await overflows(page);
  console.log(`  ${name}${over.length > 0 ? `  [overflow x${over.length}]` : ''}`);
  for (const line of over) console.log(`      ! ${line}`);
  OVERFLOW_TOTAL += over.length;
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

const BASE = `http://localhost:${PORT}`;
// The app's own paths (Task 1) plus the pseudo switch: `p` is always
// base-relative (`/campaign`, `/mission/x`), so every call site reads as the
// route it is rather than a hand-built query string. Named `p`, not `path`,
// so it does not shadow the `node:path` import above.
const url = (p: string): string => `${BASE}${p}${PSEUDO ? `${p.includes('?') ? '&' : '?'}pseudo=1` : ''}`;
const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
let browser: Browser | null = null;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
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

    await page.goto(url('/'), { waitUntil: 'load' });
    await settle(page, 2500);
    await shot(page, dir, '01-menu');
    await page.goto(url('/campaign'), { waitUntil: 'load' });
    await settle(page, 7000);
    await shot(page, dir, '02-campaign');
    await page.goto(url('/brigade'), { waitUntil: 'load' });
    await settle(page, 3000);
    await shot(page, dir, '03-brigade');
    await page.goto(url('/free-play'), { waitUntil: 'load' });
    await settle(page, 2500);
    await shot(page, dir, '04-sandboxes');

    // Task 13: the three plain menu screens routed since Task 1 but never
    // photographed -- settings, credits, saves.
    await page.goto(url('/settings'), { waitUntil: 'load' });
    await settle(page, 2000);
    await shot(page, dir, '12-settings');

    await page.goto(url('/credits'), { waitUntil: 'load' });
    await settle(page, 2000);
    // Open the first font's licence disclosure so the capture shows the OFL
    // fetch's result rather than every `<details>` collapsed.
    await page.locator('details summary').first().click();
    await settle(page, 800);
    await shot(page, dir, '13-credits');

    await page.goto(url('/saves'), { waitUntil: 'load' });
    await settle(page, 2000);
    await shot(page, dir, '14-saves');

    // The briefing / deploying screen, before the deploy click.
    await page.goto(url(`/mission/${MISSION}`), { waitUntil: 'load' });
    await settle(page, 6000);
    await shot(page, dir, '05-briefing');

    // Task 6: Escape on the briefing goes back to the campaign map, and no
    // longer deploys. A console line, not a gate -- driven on a separate
    // throwaway page/context so it cannot disturb the main `page`, which
    // keeps driving this SAME mission through deploy, selection and combat
    // below.
    {
      const backCtx = await browser.newContext({
        viewport: { width: res.width, height: res.height },
        deviceScaleFactor: 1,
      });
      const backPage = await backCtx.newPage();
      backPage.setDefaultTimeout(30000);
      await backPage.goto(url(`/mission/${MISSION}`), { waitUntil: 'load' });
      await settle(backPage, 6000);
      await backPage.keyboard.press('Escape');
      await backPage.waitForTimeout(300);
      const landedUrl = backPage.url();
      // Task 13: the router lands on the PATH now, not the old `?campaign`
      // query -- the redirect from that query is still live (router.ts), but
      // `onBack` navigates straight to `routes.campaign()`.
      //
      // The PATH, plus the sticky query rather than an exact string: since
      // Minor 12 (final review) `Router.navigate` carries `?pseudo=1` and
      // `?lang=` forward when the target does not name them, so under
      // `--pseudo` this lands on `/campaign?pseudo=1` -- which is the point of
      // that fix, not a miss. An exact-string check called it UNEXPECTED on
      // every pseudo run, which is how a diagnostic that cries wolf stops
      // being read at all. Carrying the flag is now part of what it asserts.
      const landed = new URL(landedUrl);
      const ok = landed.origin === BASE && landed.pathname === '/campaign' && landed.searchParams.has('pseudo') === PSEUDO;
      console.log(`  escape-from-briefing -> ${landedUrl} (${ok ? 'OK' : 'UNEXPECTED'})`);
      await backCtx.close();
    }

    try {
      await dismissDeployGate(page, TAG);
    } catch (err) {
      console.log(`  !! ${(err as Error).message}`);
      await ctx.close();
      continue;
    }
    await settle(page, 1500);
    await page.evaluate(() => (window as LionsWindow).__lions?.step(40));
    await settle(page, 600);
    await shot(page, dir, '06-hud-idle');

    // Phase 2, Task 14: six more HUD states, each the standing capture for
    // one of Tasks 4/6/7/8/10/11's own acceptance -- inserted here, after the
    // idle HUD settles and before the pause menu, so nothing below has to
    // move. Same shape every other state in this file already uses: act,
    // settle, shot.

    // 18-hud-alert -- Task 4's acceptance (a). Kill one player unit directly
    // (`sim.debugKill`, the same dev hook `16-end-defeat` below already
    // uses) and step one tick so the death's own event plumbing reaches the
    // feed line and the minimap mark. The alert's CUE (a flash, a sound) is
    // not something a screenshot can show and is recorded in the report
    // instead, not chased here.
    await page.evaluate(() => {
      const L = (window as LionsWindow).__lions;
      if (!L) return;
      const victim = L.units(0)[0];
      if (victim) L.sim.debugKill(victim.id);
      L.step(1);
    });
    await settle(page, 400);
    await shot(page, dir, '18-hud-alert');

    // 19-objectives -- Task 6. The strip's `+N` control opens the full
    // objective tracker. `renderStrip` innerHTMLs the strip's own body at
    // 4 Hz (hud.ts's own comment on this: it is WHY the click listener is
    // delegated onto `.rl-strip` rather than bound to the button), so a
    // Playwright `page.click` -- which waits for the target to be visible,
    // enabled AND STABLE before dispatching -- loses that race against the
    // rebuild indefinitely; a direct in-page `.click()` dispatches
    // synchronously against whichever node currently matches and sidesteps
    // it. The objective count is read back from the panel's own rows rather
    // than hard-coded, so this line keeps telling the truth if `MISSION`
    // ever changes out from under it.
    const clickMore = (): Promise<void> =>
      page.evaluate(() => (document.querySelector('.rl-strip__more') as HTMLElement | null)?.click());
    await clickMore();
    await settle(page, 500);
    const objectiveCount = await page.evaluate(
      () => document.querySelectorAll('.rl-obj-list .rl-obj').length
    );
    console.log(`  19-objectives: ${MISSION} declares ${objectiveCount} objective(s)`);
    await shot(page, dir, '19-objectives');
    // Closed the same way a second click on the strip control does, so the
    // tracker is not left open over the states that follow.
    await clickMore();
    await settle(page, 400);

    // 20-keys -- Task 8. F1's reference card, opened and closed the same
    // shape `15-pause` below uses: open, shoot, Escape.
    await page.keyboard.press('F1');
    await settle(page, 500);
    await shot(page, dir, '20-keys');
    await page.keyboard.press('Escape');
    await settle(page, 300);

    // 21-tooltip -- Task 7, Conduct first. Neither `page.hover()` nor a raw
    // `page.mouse.move` can reach this element AT ALL, and that is a finding
    // for the final review, not a script bug to route around quietly:
    // `.rl-strip` is `pointer-events: none` furniture (theme.css) and only
    // re-enables it for `<a>`/`<button>` descendants, but the Conduct
    // trigger is `<span data-tip="conduct">` wrapping `<b data-roe>` --
    // neither tag, and no `tabindex` either, so it is unreachable by mouse
    // OR keyboard for a real player. Confirmed with a throwaway Playwright
    // probe against this exact build: `document.elementFromPoint` on the
    // span's own centre resolves to the world canvas underneath it, and a
    // real `page.hover()` times out waiting for an element that will never
    // become hit-testable. To still photograph what the tooltip LOOKS like,
    // a `mouseover` is dispatched directly on the element -- it reaches
    // `bindDelegatedTip`'s listener the same way a real one would if the CSS
    // let it arrive, which is exactly what a fixed version needs to do.
    const roeExists = await page.evaluate(() => {
      const el = document.querySelector('.rl-strip [data-roe]');
      el?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return el !== null;
    });
    if (!roeExists) console.log('  !! .rl-strip [data-roe] not found -- 21-tooltip skipped the hover');
    await settle(page, 300);
    await shot(page, dir, '21-tooltip');
    // Closed the same explicit way it was opened, rather than relying on a
    // mouse leave that -- per the above -- was never real in the first place.
    await page.evaluate(() => {
      document.querySelector('.rl-strip [data-roe]')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    await settle(page, 200);

    // 22-groups -- Task 11. The same six-unit selection
    // `08-hud-selection-mixed` below uses, then Ctrl+1 assigns it to group
    // 1 -- one chip, its track tinted the same colour `renderer.unitGroup`'s
    // own badge draws a grouped unit with.
    await page.evaluate(() => {
      const L = (window as LionsWindow).__lions;
      if (!L) return;
      const us = L.units();
      const ids = us.slice(0, 6).map((u) => u.id);
      L.sel(ids);
    });
    await page.keyboard.press('Control+1');
    await settle(page, 500);
    await shot(page, dir, '22-groups');

    // 23-minimap-ping -- Task 10. Alt+click the minimap's own centre --
    // `onDown`'s ping branch, not the drag/jump path. `Mouse.click` (unlike
    // `Locator.click`/`Page.click`) takes no `modifiers` option, so the Alt
    // key is held with `Keyboard.down`/`up` around a plain coordinate click
    // over the element's bounding box.
    const minimapBox = await page.locator('.rl-minimap').boundingBox();
    if (minimapBox) {
      await page.keyboard.down('Alt');
      await page.mouse.click(minimapBox.x + minimapBox.width / 2, minimapBox.y + minimapBox.height / 2);
      await page.keyboard.up('Alt');
    } else {
      console.log('  !! .rl-minimap not found -- 23-minimap-ping skipped the click');
    }
    await settle(page, 300);
    await shot(page, dir, '23-minimap-ping');

    // Task 6's pause menu: Escape opens it over a running mission (its root
    // is `.rl-pause`), a second Escape resumes -- the same key, both ways,
    // exactly as CLAUDE.md's dev instruments describe it. Its own listener is
    // wired at boot alongside every other bound key (`main.ts`'s keydown
    // handler), not gated behind the deploy screen's `loading.done()`, so
    // unlike the deploy click this needs no retry loop.
    await page.keyboard.press('Escape');
    await settle(page, 700);
    await shot(page, dir, '15-pause');
    await page.keyboard.press('Escape');
    await settle(page, 400);

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

    // Scripted defeat: kill every player unit directly (`sim.debugKill`, the
    // same dev hook `perf/wreck-captures.ts` uses) and step until `checkEnd`
    // notices -- a script can force a wipe without knowing anything about
    // THIS mission's objectives.
    await page.evaluate(() => {
      const w = (window as LionsWindow).__lions;
      if (!w) return;
      for (const u of w.units(0)) w.sim.debugKill(u.id);
      w.step(40);
    });
    // Task 6: the moment (`ui/outcome-moment.ts`) is a held, full-screen
    // dialog in FRONT of the end screen. Photograph it FIRST, then skip it --
    // without the skip the `.rl-endnav` wait below times out, which is how
    // this line was found.
    await page.waitForSelector('.rl-outcome[data-outcome="defeat"]', { timeout: 15000 });
    await shot(page, dir, '25-outcome-defeat');
    // Fix round 1 (Task 6 review): `shot()` alone never checked that the
    // moment was STILL the thing on screen by the time its pixels were
    // rasterised. Under load, a real run captured this PNG after the
    // moment's 2600ms hold had already elapsed and `showEndScreen` had
    // already replaced it -- `outcome-guard.ts`'s header carries the full
    // account. `outcomeMoment` has no intermediate "dismissing" state to
    // check separately (its own header: `dismiss()` removes the node
    // SYNCHRONOUSLY, unlike `titleCard`'s fade) -- presence is the whole
    // check, and its absence here means the PNG just taken is mislabelled.
    assertOutcomeStillPresent(
      (await page.locator('.rl-outcome[data-outcome="defeat"]').count()) > 0,
      '25-outcome-defeat'
    );
    await page.click('.rl-outcome__skip');
    // `.rl-endnav` rather than a single `.rl-end` class: `showEndScreen`
    // (`ui/menu.ts`) builds its root from the shared `panel()` helper
    // (`.rl-panel[data-rank="alert"]`), and the nav row it appends last is
    // the one class unique to this screen that exists regardless of whether
    // the mission declared a `debrief` line for this outcome.
    await page.waitForSelector('.rl-endnav', { timeout: 15000 });
    await shot(page, dir, '16-end-defeat');
    await page.click('.rl-endnav__debrief');
    await page.waitForSelector('.rl-debrief', { timeout: 15000 });
    await shot(page, dir, '17-debrief');

    await ctx.close();

    // Task 6: 24-outcome-victory. There is no `debugWin`, and adding one
    // would be a sim change, so this drives `beit_sahwan_1_recon`'s own
    // primary (`picture`: locate 6 positions) by waypoint, the same route
    // `playtest.ts`'s own recon plan sends the drone and screen on (its
    // third and last screen order, at tick 480, is omitted below -- the
    // measured run ends at tick 426, before that order would ever be
    // issued). A SEPARATE context: the `page` above has already been driven
    // through combat and a scripted wipe, and this needs its own fresh
    // mission from the deploy screen.
    //
    // The plan is DATA passed through `page.evaluate`'s own argument, not a
    // closure over named `M`/`ids` helpers the way the sim-harness version
    // above the file reads: esbuild's `keepNames` transform (tsx's default)
    // rewrites `const ids = (type) => ...` to `const ids = __name((type) =>
    // ..., "ids")`, and `Function.prototype.toString()` -- how Playwright
    // ships a callback into the page -- carries that rewritten text verbatim
    // into a browser context with no `__name` global, throwing
    // `ReferenceError: __name is not defined` the instant the mission
    // actually reaches a real victory and this block runs. Measured directly
    // (`tsx`'s own transform output) before landing this shape. Every
    // coordinate below is pre-converted to Q16.16 in THIS (Node) context, so
    // the browser-side function is two anonymous `filter`/`map` callbacks
    // (safe -- confirmed unrenamed) and a plain loop over plain data.
    {
      const Q = (v: number): number => Math.round(v * 65536);
      const PLAN: { group: 'drone' | 'screen'; kind: 'move' | 'attackMove'; x: number; y: number; thenStep: number }[] = [
        { group: 'drone', kind: 'move', x: Q(21), y: Q(8), thenStep: 18 },
        { group: 'drone', kind: 'move', x: Q(40), y: Q(8), thenStep: 6 },
        { group: 'drone', kind: 'move', x: Q(40), y: Q(22), thenStep: 8 },
        { group: 'screen', kind: 'attackMove', x: Q(16), y: Q(22), thenStep: 28 },
        { group: 'drone', kind: 'move', x: Q(21), y: Q(30), thenStep: 90 },
        { group: 'drone', kind: 'move', x: Q(26), y: Q(40), thenStep: 90 },
        { group: 'screen', kind: 'attackMove', x: Q(22), y: Q(24), thenStep: 60 },
        // Measured (`tools/src/mission-harness.ts`) to end at tick 426 --
        // 200 more ticks is margin, not a number sat on the edge.
        { group: 'drone', kind: 'move', x: Q(30), y: Q(18), thenStep: 200 },
      ];
      const winCtx = await browser.newContext({
        viewport: { width: res.width, height: res.height },
        deviceScaleFactor: 1,
      });
      const winPage = await winCtx.newPage();
      winPage.setDefaultTimeout(30000);
      await winPage.goto(url(`/mission/${MISSION}`), { waitUntil: 'load' });
      await settle(winPage, 6000);
      await dismissDeployGate(winPage, `${TAG}-victory`);
      await settle(winPage, 1500);
      await winPage.evaluate((plan) => {
        const L = (window as LionsWindow).__lions;
        if (!L) return;
        const unitsAll = L.units();
        const drone = unitsAll.filter((u) => u.type === 'recon_drone').map((u) => u.id);
        const screen = unitsAll
          .filter((u) => u.type === 'apc_eitan' || u.type === 'mbt_lavi' || u.type === 'ifv_namer' || u.type === 'inf_squad' || u.type === 'at_team')
          .map((u) => u.id);
        for (const step of plan) {
          L.sim.queueCommand({ kind: step.kind, ids: step.group === 'drone' ? drone : screen, x: step.x, y: step.y });
          L.step(step.thenStep);
        }
      }, PLAN);
      await winPage.waitForSelector('.rl-outcome[data-outcome="victory"]', { timeout: 15000 });
      await shot(winPage, dir, '24-outcome-victory');
      // Fix round 1 (Task 6 review): same guard as the defeat capture above
      // -- see its comment and `outcome-guard.ts`'s header for the failure
      // this closes.
      assertOutcomeStillPresent(
        (await winPage.locator('.rl-outcome[data-outcome="victory"]').count()) > 0,
        '24-outcome-victory'
      );
      await winCtx.close();
    }
  }
} finally {
  if (browser) await browser.close();
  stopDevServer(devServer, TAG);
}
console.log(`\ndone -> ${OUT}`);
// The probe's own bottom line. Stated even at zero, because "no overflow was
// reported" and "the probe never ran" look identical in a log that only speaks
// up on a hit -- the failure mode CLAUDE.md names for every check that can
// return an empty answer in zero milliseconds.
console.log(`overflow probe: ${OVERFLOW_TOTAL} element(s) wider than their own box, across every shot above`);
