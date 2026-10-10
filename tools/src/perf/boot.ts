// The boot half of the perf harnesses: drive a mission URL from navigation to
// its first frame, reading the four milestones off the page's own DOM, and
// start a `vite preview` of the production build.
//
// Moved out of `load-profile.ts` (low-end assessment, 2026-10-09) so
// `low-end.ts` reads boot time with the SAME loop `pnpm perf:load` does,
// rather than a second copy that would drift from it. Behaviour unchanged.
//
//   loading-screen   the deploy screen appears (everything before is the mesh phase)
//   sheets           the loading bar reaches its 'ready' state
//   ready            the deploy button can be clicked
//   first-frame      `window.__lions` exists after the click
import { spawn, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright';
import { isServerUp, stopDevServer } from '../golden-diff/browser';

export type Milestones = { loadingScreen: number | null; sheets: number | null; ready: number | null; firstFrame: number | null; bootError: string | null };

export async function driveBoot(page: Page, url: string, timeoutMs: number): Promise<Milestones> {
  const m: Milestones = { loadingScreen: null, sheets: null, ready: null, firstFrame: null, bootError: null };
  const startedAt = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  // One poll loop over the page's own DOM, so every milestone is read against
  // the same clock (`performance.now()` in the page).
  while (Date.now() - startedAt < timeoutMs) {
    const s = await page.evaluate(() => {
      const wrap = document.querySelector('.rl-loading');
      const countState = document.querySelector<HTMLElement>('.rl-loading__count')?.dataset.state ?? '';
      const deploy = document.querySelector<HTMLButtonElement>('.rl-loading__deploy');
      const text = document.body?.innerText ?? ''; // null at 'commit' on a re-navigation
      const bootError = /boot failed/i.test(text) ? text.slice(0, 200) : null;
      return {
        now: performance.now(),
        loading: wrap !== null,
        // The counter's own STATE, not its words (`ui/loading.ts`): 'ready'
        // is a full bar, whether every asset counted in or there was nothing
        // to count. Matching the words stalled this loop forever once, when
        // a mesh-only boot read 'meshes only' and nothing here knew it
        // (found 2026-10-04, A3.3); the words are a player's since WP-P2.
        sheetsDone: countState === 'ready',
        deploy: deploy !== null,
        lions: typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined',
        bootError,
      };
    });
    if (s.bootError) {
      m.bootError = s.bootError;
      return m;
    }
    if (m.loadingScreen === null && s.loading) m.loadingScreen = s.now;
    if (m.sheets === null && s.sheetsDone) m.sheets = s.now;
    if (m.ready === null && m.sheets !== null) {
      // `loading.done()` attaches the click handler only once every art job
      // has settled; a click before that is silently lost (the gate's own
      // finding), so keep clicking until the screen goes.
      m.ready = s.now;
    }
    if (m.ready !== null && s.loading && s.deploy) {
      await page.evaluate(() => document.querySelector<HTMLButtonElement>('.rl-loading__deploy')?.click());
    }
    if (s.lions) {
      m.firstFrame = s.now;
      return m;
    }
    await page.waitForTimeout(50);
  }
  return m;
}

export async function startPreview(port: number, repoRoot: string, tag: string): Promise<ChildProcess> {
  const child = spawn('pnpm', ['--filter', '@lions/app', 'exec', 'vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isServerUp(port)) return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  stopDevServer(child, tag);
  throw new Error(`vite preview did not come up on :${port} -- run \`pnpm build\` first`);
}
