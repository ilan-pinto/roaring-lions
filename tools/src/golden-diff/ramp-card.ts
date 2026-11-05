// GH-943 WebGPU-primary P1 (T3): the RAMP CARD, the one cross-renderer PIXEL check (design section 3).
//
//   pnpm --filter @lions/tools exec tsx src/golden-diff/ramp-card.ts --gpu=webgl2|webgpu [--port=5188]
//
// A card of flat linear-light patches (0..16 in log steps, three tints) goes through the real output stage twice: on the shipping
// legacy chain and on the node chain of `--gpu`, each in a FRESH page, with the vignette on and with and without the dusk grade.
// The patch centres are read off the photographed canvas and compared.
//
//   --gpu=webgl2  (F)  GATES: every channel of every patch within 1/255 (`RAMP_TOLERANCE`), exit 1 otherwise.
//   --gpu=webgpu  (G)  REPORT-ONLY (exit 0 whatever it reads): the plan expected G to differ through the fragCoord origin; the node
//                      dither flips it (see output-grade.node.ts), so G may well agree too. The reading is printed either way.
// Exit 2 is a harness failure (no page, a backend that is not the arm's), never a verdict.
//
// The pure half (layout, patches, the comparison) is `ramp-card-layout.ts`, so `ramp-card.test.ts` runs with no browser and the in-page
// half imports no pngjs. This file owns the PNG read and the driver, the only part that touches playwright.
import { PNG } from 'pngjs';
import { RAMP_LAYOUT, RAMP_TOLERANCE, cardRefusal, compareCards, rampPatches, type Rgb8 } from './ramp-card-layout';

export * from './ramp-card-layout';

/** The patch-centre RGB of a photographed card (PNG bytes), in `rampPatches()` order. */
export function readPatches(png: Buffer): Rgb8[] {
  const img = PNG.sync.read(png);
  if (img.width !== RAMP_LAYOUT.width || img.height !== RAMP_LAYOUT.height) {
    throw new Error(`ramp card: photographed ${img.width}x${img.height}, expected ${RAMP_LAYOUT.width}x${RAMP_LAYOUT.height}`);
  }
  return rampPatches().map((p) => {
    const i = (Math.floor(p.y) * img.width + Math.floor(p.x)) * 4;
    return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number] as const;
  });
}

// --- the driver -------------------------------------------------------------------------------------------------------------------
async function main(): Promise<number> {
  const [{ chromium }, path, { fileURLToPath }, { musicOffInitScript }, { claimPort }, browserMod, backendMod] = await Promise.all([
    import('playwright'),
    import('node:path'),
    import('node:url'),
    import('../ui-review/music-off'),
    import('../ui-review/port'),
    import('./browser'),
    import('./backend'),
  ]);
  const args = process.argv.slice(2);
  const arg = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const arm = backendMod.parseGpuArm(arg('gpu'));
  if (arm === null || arm === 'legacy') {
    console.error('[ramp-card] --gpu must be webgl2 or webgpu');
    return 2;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const port = await claimPort('ramp-card', 'RAMP_CARD_PORT', 5188);
  const server = await browserMod.ensureDevServer(port, root, 'ramp-card');
  const stop = browserMod.devServerStopper(server, 'ramp-card');
  const browser = await chromium.launch({ headless: true, args: backendMod.chromiumArgsFor(arm) });
  const MODULE = `/@fs${root}/tools/src/golden-diff/ramp-card-page.ts`;
  let code = 0;
  try {
    for (const graded of [false, true]) {
      const cards = new Map<string, Rgb8[]>();
      for (const which of ['legacy', arm] as const) {
        const page = await browser.newPage({ viewport: { width: RAMP_LAYOUT.width, height: RAMP_LAYOUT.height }, deviceScaleFactor: 1 });
        await page.addInitScript(musicOffInitScript());
        await page.addInitScript('window.__name = (f) => f; window.process = { env: {} };');
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 60000 });
        const run = (await page.evaluate(
          async ({ mod, which, graded }) => {
            const m = (await import(/* @vite-ignore */ mod)) as typeof import('./ramp-card-page');
            return m.drawRampCard(which, graded);
          },
          { mod: MODULE, which, graded }
        )) as { kind: string; adapter: string };
        const want = backendMod.expectedKind(which);
        if (run.kind !== want) {
          console.error(`[ramp-card] REFUSED: ${which} drew through ${run.kind}, expected ${want}`);
          return 2;
        }
        const png = await page.locator('#ramp-card').screenshot();
        await page.close();
        if (errors.length > 0) console.warn(`[ramp-card] ${which}: page errors: ${errors.slice(0, 3).join(' | ')}`);
        const patches = readPatches(png);
        const refusal = cardRefusal(patches, `${which} graded=${String(graded)}`);
        if (refusal !== null) {
          console.error(`[ramp-card] REFUSED: ${refusal}`);
          return 2;
        }
        cards.set(which, patches);
        console.log(`[ramp-card] ${which} graded=${String(graded)}: backend ${run.kind} (${run.adapter})`);
      }
      const v = compareCards(cards.get('legacy') as Rgb8[], cards.get(arm) as Rgb8[]);
      const gating = arm === 'webgl2';
      console.log(
        `[ramp-card] legacy vs ${arm} graded=${String(graded)}: max delta ${v.maxDelta}/255, ${v.failing}/${v.total} patches over ${RAMP_TOLERANCE}/255 -> ${v.pass ? 'PASS' : gating ? 'FAIL' : 'DIFFERS (report-only)'}`
      );
      if (v.worst) console.log(`[ramp-card]   worst: row ${v.worst.row} col ${v.worst.col} value ${v.worst.value.toFixed(4)} legacy ${v.worst.legacy.join(',')} node ${v.worst.node.join(',')}`);
      if (!v.pass && gating) code = 1;
    }
  } finally {
    await browser.close();
    stop();
  }
  return code;
}

if (process.argv[1] !== undefined && /ramp-card\.ts$/.test(process.argv[1])) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`[ramp-card] FAILED: ${(e as Error).stack ?? String(e)}`);
      process.exit(2);
    }
  );
}
