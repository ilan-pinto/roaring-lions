/**
 * Measures the visible-toggle signal of relief read's two debug layers
 * (`slope-light`, `height-contours`) on the gated scenarios that carry relief,
 * EXACTLY the way `ci/three-baseline-gate.ts`'s `runSelfChecks` does -- the
 * gate's own URL, capture script, freeze, repaint control, toggle script,
 * region and pixelmatch threshold -- without running the gate (no baseline
 * compare, no other scenario, no screen checks). It exists to set the two
 * layers' floors by the one-third rule from a measured reading, and to be
 * re-run when they need re-deriving.
 *
 *   npx tsx src/perf/relief-read-signal.ts --port=<n> --attach [--runs=3] [--scenario=relief,aftermath] [--layers=slope-light,height-contours] [--out-dir=...]
 *
 * `--layers=crown` measures the crown summits' toggle (`terrain/crown.ts`) the same way.
 *
 * Drives a dev server the CALLER started on that port, confirmed by `--attach`
 * (`ui-review/port.ts`'s `requireAttach`: refused unless something listens
 * there); starts none and kills none. Each run is a fresh page. Prints every reading and, per scenario and
 * layer, the floor a third of the smallest run gives.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  captureScript,
  layerToggleScript,
  REPAINT_SCRIPT,
  SCENARIOS,
  threeUrl,
} from '../golden-diff/capture-protocol';
import { computeDiff } from '../golden-diff/diff';
import { specFor } from '../golden-diff/baseline';
import { CAPTURE_VIEWPORT, capture, launchCaptureBrowser, readUnmaskedRenderer, rephotograph } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { requireAttach } from '../ui-review/port';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const port = Number(arg('port', ''));
if (!port) throw new Error('--port=<n> is required: the dev server this measures against');
await requireAttach('relief-read-signal', [port]);
const runs = Number(arg('runs', '3'));
const wanted = arg('scenario', 'relief,aftermath').split(',');
const outDir = path.resolve(arg('out-dir', '.superpowers/relief-read-signal'));
const LAYERS = arg('layers', 'slope-light,height-contours').split(',');
const PIXELMATCH_THRESHOLD = 0.1; // the gate's own

const browser = await launchCaptureBrowser();
console.log(`renderer: ${await readUnmaskedRenderer(browser)}`);
const readings: Record<string, Record<string, { px: number; mean: number }[]>> = {};
try {
  for (const id of wanted) {
    const scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) throw new Error(`no scenario "${id}"`);
    const spec = specFor(id);
    readings[id] = Object.fromEntries(LAYERS.map((l) => [l, []]));
    for (let r = 0; r < runs; r++) {
      const dir = path.join(outDir, id, `r${r + 1}`);
      mkdirSync(dir, { recursive: true });
      const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT } });
      await page.addInitScript(musicOffInitScript());
      const png = path.join(dir, 'current.png');
      const res = await capture(page, threeUrl(port, scenario), captureScript(scenario), png, `relief-signal/${id}`, scenario.mission !== undefined);
      const shown = path.join(dir, 'shown.png');
      await rephotograph(page, REPAINT_SCRIPT, shown, res.rect);
      const control = computeDiff(png, shown, { outDir: dir, diffFileName: 'diff-control.png', threshold: PIXELMATCH_THRESHOLD, region: spec?.region ?? undefined });
      console.log(`${id} r${r + 1}: repaint control ${control.diffPixels} px / ${control.meanAbsChannelDelta.toFixed(4)}`);
      for (const layer of LAYERS) {
        const hidden = path.join(dir, `${layer}-hidden.png`);
        await rephotograph(page, layerToggleScript(layer, false), hidden, res.rect);
        await page.evaluate(layerToggleScript(layer, true));
        // The gate's own region rule: a layer check's own region, else the scenario's.
        const check = spec?.layerChecks?.find((c) => c.layer === layer);
        const region = check && check.region !== undefined ? check.region : spec?.region;
        const d = computeDiff(shown, hidden, { outDir: dir, diffFileName: `diff-${layer}.png`, threshold: PIXELMATCH_THRESHOLD, region: region ?? undefined });
        readings[id]![layer]!.push({ px: d.diffPixels, mean: d.meanAbsChannelDelta });
        console.log(`${id} r${r + 1}: hiding "${layer}" moves ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)}`);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log('\nfloors (one third of the smallest of the runs):');
for (const [id, byLayer] of Object.entries(readings)) {
  for (const [layer, rs] of Object.entries(byLayer)) {
    const px = Math.min(...rs.map((x) => x.px));
    const mean = Math.min(...rs.map((x) => x.mean));
    console.log(`  ${id} ${layer}: min ${px} px / ${mean.toFixed(4)} over ${rs.length} -> floor ${Math.floor(px / 3)} px / ${(mean / 3).toFixed(4)}`);
  }
}
