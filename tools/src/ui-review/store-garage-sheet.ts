// The Store/Garage look sheet for the lead (plan 2026-11-07 WP10). Evidence, not a gate.
//
// Seeds the mixed track (`store-garage-seed.ts`) and photographs, into OUT (default
// /Users/ilpinto/dev/roaring-lions-ep/_coord/store-garage/sheet/, never the repo):
//   1. the Stores with "What it adds" open on spg_long_range, then inf_medic_squad, at 1920x1080 and 1280x720;
//   2. the same two under ?pseudo=1 (a plain word in a pseudo capture never went through t());
//   3. the howitzer's tier rows (run label and credit Buy beside the coin Buy);
//   4. the Garage bay on spg_long_range with its two tracks and the run-labelled credit Buy;
//   5. index.html: a contact sheet of the 11 new close-ups beside mbt_lavi's shipped three; every
//      whole-model frame (manifest `subject: "whole"`, R0.7) is captioned.
// Each page also reports overflow, raw i18n keys and (pseudo) unbracketed leaf strings to index.html.
//
// Run ONCE, locally: one browser, Metal, music off, own port (default 5239; 5177 is refused).
//   pnpm --filter @lions/tools store-garage:sheet [--port=<n>] [--out=<dir>]
import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { claimGpuBackend, gpuLaunchArgs } from './gpu';
import { musicOffInitScript } from './music-off';
import { claimPort, resolvePort } from './port';
import { storeSeedScript } from './store-garage-seed';

const TAG = 'store-garage-sheet';
const DEFAULT_PORT = 5239;
const LEAD_PORT = 5177;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice('--out='.length)) : '/Users/ilpinto/dev/roaring-lions-ep/_coord/store-garage/sheet';

let wanted: number;
try {
  wanted = resolvePort(process.argv.slice(2), process.env, 'STORE_GARAGE_SHEET_PORT', DEFAULT_PORT).port;
} catch (err) {
  console.error(`[${TAG}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
if (wanted === LEAD_PORT) {
  console.error(`[${TAG}] port ${LEAD_PORT} is the lead's dev server and is off-limits`);
  process.exit(2);
}
const port = await claimPort(TAG, 'STORE_GARAGE_SHEET_PORT', DEFAULT_PORT);
const devServer = await ensureDevServer(port, REPO_ROOT, TAG);
const base = `http://localhost:${port}`;
fs.mkdirSync(OUT, { recursive: true });

interface Shot { file: string; title: string; notes: string[] }
const shots: Shot[] = [];

async function scan(page: Page, pseudo: boolean): Promise<string[]> {
  return page.evaluate((isPseudo) => {
    const notes: string[] = [];
    const roots = document.querySelectorAll('.rl-menu--garage, .rl-stores');
    let visited = 0;
    let dataNames = 0;
    const DATA_TEXT = ['rl-stores__card-name', 'rl-garage__card-name', 'rl-garage__name', 'rl-garage__blurb'];
    const seen = new Set<Element>();
    const name = (el: HTMLElement): string => {
      const cls = el.className.toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
    };
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(el) || !(el instanceof HTMLElement) || el.getClientRects().length === 0) continue;
        // Visually hidden screen-reader text is 1px wide by design: its scrollWidth is not an overflow.
        if (el.classList.contains('rl-sr-only')) continue;
        seen.add(el);
        visited++;
        if (el.scrollWidth > el.clientWidth + 1) {
          notes.push(`overflow ${name(el)} ${el.scrollWidth}>${el.clientWidth} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`);
        }
        if (el.children.length === 0) {
          const text = (el.textContent ?? '').trim();
          if (/^(stores|garage|brigade|common|ui|role)\.[a-z][\w.]*$/.test(text)) notes.push(`raw key ${name(el)} "${text}"`);
          // A unit's display name and blurb are DATA (UnitType), never through t(), like mission text: counted, not flagged.
          else if (isPseudo && DATA_TEXT.some((c) => el.classList.contains(c))) dataNames++;
          else if (isPseudo && /[A-Za-z]{3}/.test(text) && !text.startsWith('⟦')) notes.push(`unbracketed ${name(el)} "${text.slice(0, 50)}"`);
        }
      }
    }
    // A scan that visits nothing cannot fail: say how many elements it read.
    notes.unshift(`scanned ${visited} elements${isPseudo ? `, ${dataNames} unit-name/blurb texts skipped as data` : ''}`);
    return notes;
  }, pseudo);
}

async function snap(page: Page, file: string, title: string, pseudo: boolean): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, file) });
  const notes = await scan(page, pseudo);
  shots.push({ file, title, notes });
  console.log(`[${TAG}] ${file}  [${notes[0]}; ${notes.length - 1} finding(s)]`);
}

async function clip(page: Page, selector: string, file: string, title: string, pseudo: boolean): Promise<void> {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) {
    shots.push({ file, title, notes: [`MISSING ${selector}`] });
    console.log(`[${TAG}] ${file} MISSING ${selector}`);
    return;
  }
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await loc.screenshot({ path: path.join(OUT, file) });
  shots.push({ file, title, notes: await scan(page, pseudo) });
  console.log(`[${TAG}] ${file}`);
}

let browser: Browser | null = null;
let failed = false;
try {
  browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(claimGpuBackend(TAG)) });
  const errors: string[] = [];
  for (const [w, h] of [[1920, 1080], [1280, 720]] as const) {
    for (const pseudo of [false, true]) {
      const tag = `${w}${pseudo ? '-pseudo' : ''}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await ctx.addInitScript(musicOffInitScript());
      await ctx.addInitScript('globalThis.__name = (f) => f;');
      await ctx.addInitScript(storeSeedScript());
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${tag}: ${String(e)}`));
      await page.goto(`${base}/brigade${pseudo ? '?pseudo=1' : ''}`, { waitUntil: 'load' });
      await page.locator('.rl-garage__view[data-view="stores"]').click();
      // The howitzer is bought, so its unit card sits behind the owned toggle.
      await page.locator('button.rl-stores__owned').click();
      for (const id of ['spg_long_range', 'inf_medic_squad']) {
        const btn = page.locator(`[data-focus="adds:${id}"]`);
        if ((await btn.count()) === 0) {
          shots.push({ file: `(none)`, title: `${id} ${tag}`, notes: [`MISSING What it adds control for ${id}`] });
          continue;
        }
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        await snap(page, `stores-adds-${id}-${tag}.png`, `Stores, What it adds, ${id}, ${w}x${h}${pseudo ? ' pseudo' : ''}`, pseudo);
        await clip(page, `.rl-stores__adds[data-adds="${id}"]`, `stores-adds-${id}-${tag}-panel.png`, `The panel alone, ${id}, ${w}x${h}${pseudo ? ' pseudo' : ''}`, pseudo);
        // Reachability: the panel must be fully inside the viewport OR scroll inside itself to its last block.
        const reach = await page.evaluate((sel) => {
          const p = document.querySelector(sel) as HTMLElement | null;
          if (p === null) return 'panel absent';
          const r = p.getBoundingClientRect();
          const scrolls = getComputedStyle(p).overflowY !== 'visible' && p.scrollHeight > p.clientHeight;
          const before = p.scrollTop; p.scrollTop = p.scrollHeight; const reached = p.scrollTop; p.scrollTop = before;
          return `panel ${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight}px, content ${p.scrollHeight}px in ${p.clientHeight}px, ` + (scrolls ? `scrolls inside itself (reached ${reached}px)` : 'no inner scroll') + `, last block bottom ${Math.round((p.lastElementChild as HTMLElement).getBoundingClientRect().bottom)}`;
        }, `.rl-stores__adds[data-adds="${id}"]`);
        shots.push({ file: '', title: `panel reach ${id} ${tag}`, notes: [reach] });
        console.log(`[${TAG}] ${tag} ${id}: ${reach}`);
      }
      if (w === 1920 || pseudo) {
        await clip(page, '[data-item="tiers:spg_long_range"]', `stores-tiers-spg_long_range-${tag}.png`, `Tier rows on the howitzer (run label beside the coin Buy), ${w}x${h}${pseudo ? ' pseudo' : ''}`, pseudo);
        const credit = await page.locator('button[data-buy^="credits:spg_long_range"]').allTextContents();
        console.log(`[${TAG}] ${tag} credit Buy text: ${JSON.stringify(credit)}`);
        shots.push({ file: '', title: `credit Buy labels ${tag}`, notes: credit.map((c) => `label "${c}"`) });
      }
      // The Garage bay.
      await page.locator('.rl-garage__view[data-view="brigade"]').click().catch(() => undefined);
      const card = page.locator('.rl-garage__card[data-unit="spg_long_range"]');
      if ((await card.count()) > 0) {
        await card.click();
        await snap(page, `garage-bay-spg_long_range-${tag}.png`, `Garage bay, spg_long_range, ${w}x${h}${pseudo ? ' pseudo' : ''}`, pseudo);
        const buys = await page.locator('.rl-garage__buy-tier').allTextContents();
        shots.push({ file: '', title: `Garage credit Buy labels ${tag}`, notes: buys.map((c) => `label "${c}"`) });
        console.log(`[${TAG}] ${tag} garage Buy text: ${JSON.stringify(buys)}`);
      } else shots.push({ file: '(none)', title: `Garage bay ${tag}`, notes: ['MISSING garage card spg_long_range'] });
      await ctx.close();
    }
  }
  if (errors.length > 0) console.log(`[${TAG}] page errors: ${errors.slice(0, 4).join(' | ')}`);
  shots.push({ file: '', title: 'page errors', notes: errors });
} catch (err) {
  failed = true;
  console.error(`[${TAG}] ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  await browser?.close();
  stopDevServer(devServer, TAG);
}

// --- The close-up contact sheet (no browser) --------------------------------------------------
const CLOSEUPS = path.join(REPO_ROOT, 'assets/ui/garage/closeups');
const manifest = JSON.parse(fs.readFileSync(path.join(CLOSEUPS, 'manifest.json'), 'utf8')) as {
  closeups: Record<string, { file: string; unit: string; track: string; subject?: string }>;
};
const NEW = ['air_medevac_heli', 'mbt_lavi_camo', 'spg_cluster', 'spg_long_range', 'veh_ambulance'];
const SHIPPED = ['mbt_lavi'];
fs.mkdirSync(path.join(OUT, 'closeups'), { recursive: true });
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const figure = (key: string, isNew: boolean): string => {
  const e = manifest.closeups[key];
  if (e === undefined) return `<figure class="bad"><figcaption>${esc(key)}: NOT IN MANIFEST</figcaption></figure>`;
  fs.copyFileSync(path.join(CLOSEUPS, e.file), path.join(OUT, 'closeups', e.file));
  const whole = e.subject === 'whole';
  return (
    `<figure class="${isNew ? 'new' : 'old'}${whole ? ' whole' : ''}"><img src="closeups/${esc(e.file)}" width="480" height="320" alt="${esc(key)}">` +
    `<figcaption><b>${esc(e.unit)}</b> ${esc(e.track)} ${isNew ? '(new)' : '(shipped, for scale)'}` +
    (whole ? '<br><span class="warn">R0.7 whole-model frame: the part is not isolated, the whole vehicle is shown</span>' : '') +
    '</figcaption></figure>'
  );
};
const rows = (ids: string[], isNew: boolean): string =>
  ids.map((id) => Object.keys(manifest.closeups).filter((k) => manifest.closeups[k].unit === id).sort().map((k) => figure(k, isNew)).join('')).join('');
const newCount = NEW.reduce((n, id) => n + Object.values(manifest.closeups).filter((e) => e.unit === id).length, 0);

const html =
  `<!doctype html><meta charset="utf-8"><title>Store/Garage look sheet</title>` +
  `<style>body{font:14px system-ui;background:#16181a;color:#ddd;margin:24px}figure{display:inline-block;margin:6px;vertical-align:top;max-width:480px}` +
  `img{display:block;border:2px solid #444}.new img{border-color:#6a6}.whole img{border-color:#c93}.warn{color:#e9a53a}.bad{color:#f66}` +
  `.pngs img{max-width:100%;height:auto}h2{margin-top:36px}code,li{font-size:12px}</style>` +
  `<h1>Store/Garage look sheet</h1>` +
  `<h2>Close-ups: the ${newCount} new beside mbt_lavi's shipped three</h2><div>${rows(SHIPPED, false)}<hr>${rows(NEW, true)}</div>` +
  `<h2>Screens</h2><div class="pngs">` +
  shots.map((s) =>
    (s.file !== '' && s.file !== '(none)' ? `<h3>${esc(s.title)}</h3><a href="${esc(s.file)}"><img src="${esc(s.file)}" loading="lazy"></a>` : `<h3>${esc(s.title)}</h3>`) +
    (s.notes.length > 0 ? `<ul>${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '')
  ).join('') + '</div>';
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`[${TAG}] wrote ${path.join(OUT, 'index.html')} (${shots.length} entries, ${newCount} new close-ups)`);
process.exit(failed ? 1 : 0);
