// The Roar-coin wallet, end to end in a real browser (GH-317). Boots Beit Sahwan I behind its OWN dev
// server, wins it through the runtime's own app->runtime channel (`completeObjective`, then ticks, so
// the REAL victory handler in main.ts runs: ledger, credits and wallet in one write), opens the
// brigade screen's Stores tab, and asks of it what a player would: does it show a balance, and does
// a Buy spend it and keep the unit after a reload? Exit 1 on any miss.
//
// Run locally, once, one browser, Metal, music off: it is evidence for the PR, not a CI gate.
//   pnpm --filter @lions/tools coin-wallet:check [--port=<n>] [--out=<dir>]
// Port 5177 is the lead's and is refused by `coin-wallet-port.ts` (a pure function, tested).
import { chromium, type Browser } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dismissDeployGate, ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { coinWalletPort } from './coin-wallet-port';
import { claimGpuBackend, gpuLaunchArgs } from './gpu';
import { musicOffInitScript } from './music-off';
import { claimPort } from './port';

const TAG = 'coin-wallet';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice('--out='.length)) : null;

const guard = coinWalletPort(process.argv.slice(2), process.env);
if (!guard.ok) {
  console.error(`[${TAG}] ${guard.message}`);
  process.exit(2);
}
const port = await claimPort(TAG, 'COIN_WALLET_PORT', guard.port);
const devServer = await ensureDevServer(port, REPO_ROOT, TAG);
const base = `http://localhost:${port}`;

const failures: string[] = [];
const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`[${TAG}] ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(what);
};

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(claimGpuBackend(TAG)) });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(musicOffInitScript());
  await ctx.addInitScript('globalThis.__name = (f) => f;');
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const readWallet = async (): Promise<{ raw: string | null; legacy: string | null }> =>
    page.evaluate(() => ({ raw: localStorage.getItem('lions.roar'), legacy: localStorage.getItem('lions.roar.test') }));

  // 1. A fresh player: no wallet yet, nothing earned.
  await page.goto(`${base}/brigade`, { waitUntil: 'load' });
  await page.locator('.rl-garage__view[data-view="stores"]').click();
  check((await page.locator('.rl-stores__wallet-n').textContent()) === '0', 'a fresh player\'s Stores show 0 coins');
  check((await page.locator('.rl-stores__about').count()) === 1, 'the honest line is up for a live wallet');
  check((await page.locator('button[data-buy^="unit:"]:not([disabled])').count()) === 0, 'with 0 coins no unit Buy is enabled');
  check((await page.locator('button[data-buy^="pack:"]:not([disabled])').count()) === 0, 'no pack is enabled');

  // 2. A scripted first victory, through the real handler.
  await page.goto(`${base}/mission/beit_sahwan_1_recon`, { waitUntil: 'load' });
  await dismissDeployGate(page, TAG);
  const ended = await page.evaluate(async () => {
    const l = (window as unknown as { __lions: { runtime: { completeObjective(id: string): boolean; result: string }; step(n: number): number } }).__lions;
    const completed = l.runtime.completeObjective('picture');
    l.step(60);
    return { completed, result: l.runtime.result };
  });
  check(ended.completed && ended.result === 'victory', 'the mission was won through the runtime', JSON.stringify(ended));
  await page.waitForTimeout(1500);
  const wallet = await readWallet();
  const parsed = wallet.raw === null ? null : (JSON.parse(wallet.raw) as { coins: { free: number; paid: number }; earn: { welcomed: boolean; missions: Record<string, { won: boolean; stars: number }> } });
  check(parsed !== null && parsed.earn.welcomed && parsed.earn.missions.beit_sahwan_1_recon?.won === true, 'lions.roar records the welcome and the first win');
  const earned = parsed?.coins.free ?? 0;
  const stars = parsed?.earn.missions.beit_sahwan_1_recon?.stars ?? -1;
  check(earned === 100 + 10 + 5 * stars && parsed?.coins.paid === 0, `the win paid 100 + 10 + 5 x ${stars} stars`, `free ${earned}, paid ${parsed?.coins.paid}`);
  check(wallet.legacy === null, 'no lions.roar.test key was written');
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'victory.png') });
  }

  // 3. The Stores show that balance.
  await page.goto(`${base}/brigade`, { waitUntil: 'load' });
  await page.locator('.rl-garage__view[data-view="stores"]').click();
  const shown = Number(await page.locator('.rl-stores__wallet-n').textContent());
  check(shown === earned && earned > 0, 'the Stores show the balance the win paid', `${shown} of ${earned}`);

  // 4. A Buy works: the cheapest unit the balance covers.
  const buy = page.locator('button[data-buy^="unit:"]:not([disabled])').first();
  const key = (await buy.getAttribute('data-buy')) ?? '';
  const unitId = key.slice(5);
  check(key !== '', 'something is affordable', key);
  if (OUT) await page.screenshot({ path: path.join(OUT, 'stores-before.png') });
  if (key !== '') {
    await buy.click();
    const card = page.locator(`[data-item="${unitId}"]`);
    check((await card.getAttribute('data-state')) === 'coins', `${unitId} reads "bought with coins"`);
    const after = Number(await page.locator('.rl-stores__wallet-n').textContent());
    check(after < shown, 'the balance went down', `${shown} -> ${after}`);
    if (OUT) await page.screenshot({ path: path.join(OUT, 'stores-after.png') });
    const bytes = await readWallet();
    const w2 = bytes.raw === null ? null : (JSON.parse(bytes.raw) as { coins: { free: number }; entitlements: { units: Record<string, unknown> }; receipts: { kind: string }[] });
    check(w2 !== null && unitId in w2.entitlements.units && w2.coins.free === after, 'lions.roar holds the entitlement and the new balance');
    check(w2 !== null && w2.receipts.some((r) => r.kind === 'unit'), 'a receipt was written');
    // 5. ...and it survives a reload.
    await page.reload({ waitUntil: 'load' });
    await page.locator('.rl-garage__view[data-view="stores"]').click();
    check(Number(await page.locator('.rl-stores__wallet-n').textContent()) === after, 'the balance survives a reload');
    check((await page.locator(`[data-item="${unitId}"]`).getAttribute('data-state')) === 'coins', 'the purchase survives a reload');
  }
  check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
} finally {
  await browser?.close();
  stopDevServer(devServer, TAG);
}
if (failures.length > 0) {
  console.error(`[${TAG}] ${failures.length} check(s) failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(`[${TAG}] all checks passed`);
process.exit(0);
