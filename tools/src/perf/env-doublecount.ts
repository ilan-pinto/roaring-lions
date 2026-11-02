/**
 * Look uplift L1 (GH-943): the falsifier of the `fogged` scenario -- how far a
 * DOUBLE-COUNTED environment moves the gated frame.
 *
 *   npx tsx src/perf/env-doublecount.ts --port=<n> --attach [--runs=3] [--scenario=fogged,vehicle] [--factor=2] [--out-dir=...]
 *
 * Exactly the way `relief-read-signal.ts` captures (the gate's own URL, capture
 * script, freeze, repaint control, region and pixelmatch threshold), then
 * multiplies every environment-carrying material's `envMapIntensity` by
 * `--factor` (2: the environment counted twice) and re-photographs at zero
 * elapsed time. It prints how many pixels and how much mean channel delta that
 * moves, beside the scenario's own `maxDiffPixels` / `maxMeanAbsChannelDelta`:
 * a defect that moved the frame past NEITHER ceiling would be a scenario that
 * cannot see it, and the tool exits 1 (the gate fails on either ceiling, the magnitude
 * being the primary one).
 *
 * `--mode=haze` is the OTHER half of the coupling (review N2): the haze, rain, water and smoke read
 * `resolvedLights.hemiIntensity` (`hazeRadiance`), which L1 scales. If the haze were fed the UNSCALED
 * (shipped, pre-L1) lights while the ground is lit by the scaled ones, the haze tint would be off by
 * `(2.6 sunY + 0.9) / (2.6 sunY + 0.82)`. This mode does exactly that in the page (`resolvedLights.hemiIntensity`
 * back to the preset's shipped value, then `applyHaze()`), re-photographs at zero elapsed time, and reads how far
 * it moves the frame, with the same past-both-ceilings verdict.
 *
 * Drives a dev server the CALLER started on that port, confirmed by `--attach`;
 * starts none and kills none.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { captureScript, REPAINT_SCRIPT, SCENARIOS, threeUrl } from '../golden-diff/capture-protocol';
import { computeDiff } from '../golden-diff/diff';
import { specFor } from '../golden-diff/baseline';
import { CAPTURE_VIEWPORT, capture, launchCaptureBrowser, readUnmaskedRenderer, rephotograph } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { requireAttach } from '../ui-review/port';

const arg = (n: string, d: string): string => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const port = Number(arg('port', ''));
if (!port) throw new Error('--port=<n> is required: the dev server this measures against');
await requireAttach('env-doublecount', [port]);
const runs = Number(arg('runs', '3'));
const wanted = arg('scenario', 'fogged').split(',');
const factor = Number(arg('factor', '2'));
const mode = arg('mode', 'intensity');
if (mode !== 'intensity' && mode !== 'haze') throw new Error(`--mode=${mode}: want intensity or haze`);
const outDir = path.resolve(arg('out-dir', '.superpowers/env-doublecount'));
const PIXELMATCH_THRESHOLD = 0.1;

/** In-page: scale every material the registry gave an envMap. The registry holds them weakly, so walk the scene. */
const scaleScript = (k: number): string => `(async () => {
  const R = window.__lions.renderer;
  const tex = R.environment && R.environment.texture;
  let n = 0;
  const seen = new Set();
  R.scene.traverse((o) => {
    const mat = o.material;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (seen.has(m) || !m.envMap || m.envMap !== tex) continue;
      seen.add(m);
      m.envMapIntensity *= ${k};
      n++;
    }
  });
  R.frame(1, 0);
  return JSON.stringify({ scaled: n });
})()`;

/** In-page: the haze fed the shipped (pre-L1) hemisphere, the rest of the lights as they are. */
const hazeScript = `(async () => {
  const R = window.__lions.renderer;
  const shipped = R.lightPreset.hemiIntensity;
  const was = R.resolvedLights.hemiIntensity;
  R.resolvedLights = { ...R.resolvedLights, hemiIntensity: shipped };
  R.applyHaze();
  R.frame(1, 0);
  return JSON.stringify({ scaled: 0, was, shipped });
})()`;

const browser = await launchCaptureBrowser();
console.log(`renderer: ${await readUnmaskedRenderer(browser)}`);
let failed = false;
try {
  for (const id of wanted) {
    const scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) throw new Error(`no scenario "${id}"`);
    const spec = specFor(id);
    const rows: { px: number; mean: number }[] = [];
    for (let r = 0; r < runs; r++) {
      const dir = path.join(outDir, id, `r${r + 1}`);
      mkdirSync(dir, { recursive: true });
      const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT } });
      await page.addInitScript(musicOffInitScript());
      const png = path.join(dir, 'current.png');
      const res = await capture(page, threeUrl(port, scenario), captureScript(scenario), png, `env-doublecount/${id}`, scenario.mission !== undefined);
      const shown = path.join(dir, 'shown.png');
      await rephotograph(page, REPAINT_SCRIPT, shown, res.rect);
      const doubled = path.join(dir, 'doubled.png');
      const info = (await rephotograph(page, mode === 'haze' ? hazeScript : scaleScript(factor), doubled, res.rect)) as { scaled: number };
      const d = computeDiff(shown, doubled, { outDir: dir, diffFileName: 'diff-doubled.png', threshold: PIXELMATCH_THRESHOLD, region: spec?.region ?? undefined });
      rows.push({ px: d.diffPixels, mean: d.meanAbsChannelDelta });
      console.log(
        mode === 'haze'
          ? `${id} r${r + 1}: haze fed the unscaled lights (${JSON.stringify(info)}) moves ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)}`
          : `${id} r${r + 1}: environment x${factor} on ${info.scaled} materials moves ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)}`
      );
      await page.close();
    }
    const px = Math.min(...rows.map((x) => x.px));
    const mean = Math.min(...rows.map((x) => x.mean));
    const maxPx = spec?.maxDiffPixels ?? 0;
    const maxMean = spec?.maxMeanAbsChannelDelta ?? 0;
    // The gate's own verdict (`evaluateBaseline`): it fails on EITHER ceiling, the magnitude being the primary one.
    const past = [px > maxPx ? 'pixels' : null, mean > maxMean ? 'magnitude' : null].filter((x) => x !== null);
    const ok = past.length > 0;
    if (!ok) failed = true;
    console.log(`${id}: smallest of ${rows.length}: ${px} px / ${mean.toFixed(4)} against the scenario's ceilings ${maxPx} px / ${maxMean} -> ${ok ? `the gate FAILS it (past ${past.join(' and ')}): the scenario can see this defect` : 'under both ceilings: the scenario cannot see this defect'}`);
  }
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
