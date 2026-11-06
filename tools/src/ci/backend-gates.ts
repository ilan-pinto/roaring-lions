// GH-943 P0: the node-backend gates that are not a baseline comparison.
//
//   pnpm --filter @lions/tools exec tsx src/ci/backend-gates.ts --gpu=webgl2|webgpu [--scenario=quiet] [--runs=5] [--port=5176]
//
//   1. BIT-IDENTICAL CAPTURES: the scenario is captured `--runs` times, each in a FRESH page (fresh context), and every PNG must
//      hash the same. Each capture already passed the settled-frame check inside `capture()` (two zero-time repaints, byte-equal).
//   2. THE BACKEND IS ASSERTED from the page's `backendInfo()` on every run (exit 2 on a mismatch or a mix).
//   3. THE ZERO-UNPORTED CENSUS is printed in full from `renderer.unportedHooks()`. REPORT-ONLY in P0.
//   4. A PICTURE, ACCEPTED BY THE GPU (GH-943 P1, inside `capture()` for every node arm): a run whose page logged a GPU validation
//      error, or whose frame is black or near-constant (`golden-diff/frame-content.ts`), is REFUSED (exit 2). Five identical black
//      frames are "5 of 5 byte-identical": that is how G drew nothing on 2026-11-06 and this gate still said PASS.
//
// Exit codes: 0 all pass, 1 the pictures differ, 2 usage / refused backend / capture failure. No baseline is read or written.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, captureScript, threeUrl } from '../golden-diff/capture-protocol';
import { backendRefusal, expectedKind, mixedBackendRefusal, parseGpuArm, type PageBackend } from '../golden-diff/backend';
import { bitIdenticalVerdict, unportedVerdict, type UnportedRow } from '../golden-diff/backend-gates';
import { CAPTURE_VIEWPORT, capture, ensureDevServer, launchCaptureBrowser, stopDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const TAG = 'backend-gates';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const arg = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

async function main(): Promise<number> {
  const arm = parseGpuArm(arg('gpu'));
  if (arm === null || arm === 'legacy') {
    console.error(`[${TAG}] --gpu must be webgl2 or webgpu (the legacy arm has the golden-baseline gate)`);
    return 2;
  }
  const scenario = SCENARIOS.find((s) => s.id === (arg('scenario') ?? 'quiet'));
  if (scenario === undefined) {
    console.error(`[${TAG}] unknown scenario "${arg('scenario')}"`);
    return 2;
  }
  const runs = Number(arg('runs') ?? '5');
  const outDir = path.resolve(REPO_ROOT, arg('out-dir') ?? 'backend-gates-output', arm);
  mkdirSync(outDir, { recursive: true });
  const port = await claimPort(TAG, 'BACKEND_GATES_PORT', 5176);
  const server = await ensureDevServer(port, REPO_ROOT, TAG);
  const browser = await launchCaptureBrowser(arm);
  const hashes: string[] = [];
  const seen: { id: string; backend: PageBackend }[] = [];
  let census: UnportedRow[] = [];
  const t0 = Date.now();
  try {
    for (let i = 0; i < runs; i++) {
      // A FRESH page per run: the 5 captures share nothing but the browser process.
      const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT } });
      await page.addInitScript(musicOffInitScript());
      const png = path.join(outDir, `run-${i}.png`);
      const result = await capture(page, threeUrl(port, scenario, arm), captureScript(scenario, arm), png, `${TAG}/${arm}/${i}`, scenario.mission !== undefined, arm);
      const refusal = backendRefusal(arm, result.backend);
      if (refusal !== null) throw new Error(`REFUSED run ${i}: ${refusal}`);
      seen.push({ id: `${scenario.id}#${i}`, backend: result.backend as PageBackend });
      const mixed = mixedBackendRefusal(seen);
      if (mixed !== null) throw new Error(`REFUSED: ${mixed}`);
      hashes.push(createHash('sha256').update(readFileSync(png)).digest('hex'));
      if (i === 0) census = (await page.evaluate('window.__lions.renderer.unportedHooks()')) as UnportedRow[];
      await page.close();
      console.log(`[${TAG}] ${arm} run ${i + 1}/${runs}: sha256 ${hashes[i]?.slice(0, 12)} backend ${result.backend?.kind} (${result.backend?.adapter})`);
    }
  } catch (e) {
    console.error(`[${TAG}] ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  } finally {
    await browser.close();
    stopDevServer(server, TAG);
  }
  const wallS = ((Date.now() - t0) / 1000).toFixed(1);
  const verdict = bitIdenticalVerdict(hashes, runs);
  console.log(`[${TAG}] ${arm} ${scenario.id}: ${verdict.ok ? 'PASS' : 'FAIL'} -- ${verdict.message} (${runs} fresh-page captures in ${wallS} s, expected backend ${expectedKind(arm)})`);
  for (const l of unportedVerdict(census, true).lines) console.log(`[${TAG}] ${l}`);
  return verdict.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => {
    const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
    const t = setTimeout(() => process.exit(code), 2000);
    t.unref();
    process.stdout.write('', () => process.exit(code));
  });
