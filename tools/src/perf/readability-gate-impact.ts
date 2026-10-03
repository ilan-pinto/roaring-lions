/**
 * GH-346: which visual-gate scenarios a readability lever would move, and by
 * how much -- measured by the gate's OWN capture protocol (`capture()`,
 * `captureScript`, its SwiftShader browser and its `region`s), not guessed.
 *
 * For every sandbox scenario in `SCENARIOS`, three captures: the scenario as
 * shipped (`off`), again (`off2`, the run-to-run control) and with the lever
 * flags appended to its `sandboxFlags` (`on`). Prints both diffs against
 * `off` with the baseline's own thresholds beside them. A `mission=` scenario
 * (`combat`) is skipped and SAID so: the levers are sandbox-only, so a flag
 * cannot reach it -- a shipped lever would move it, and this cannot say how far.
 *
 *   cd tools && npx tsx src/perf/readability-gate-impact.ts --port=5271 --out=<dir> --flags=teamband,bigrings
 *
 * Runs against a dev server you started; never starts or stops one.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCENARIOS, captureScript, threeUrl, type Scenario } from '../golden-diff/capture-protocol';
import { capture, launchCaptureBrowser } from '../golden-diff/browser';
import { computeDiff } from '../golden-diff/diff';
import { specFor } from '../golden-diff/baseline';

const args = process.argv.slice(2);
const arg = (k: string, d: string): string => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PORT = Number(arg('port', '5271'));
if (PORT === 5177) throw new Error('5177 is the lead’s dev server; use another port');
const OUT = resolve(arg('out', '.superpowers/readability-gate'));
const FLAGS = arg('flags', 'teamband').split(',');
mkdirSync(OUT, { recursive: true });

const browser = await launchCaptureBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  localStorage.setItem('lions.settings', JSON.stringify({ version: 1, audio: { master: 1, music: 0, sfx: 0, voice: 0, radio: false } }));
});
const tag = FLAGS.join('+');
console.log(`[gate-impact] levers: ${tag}`);
for (const sc of SCENARIOS) {
  if (sc.mission !== undefined) {
    console.log(`[gate-impact] ${sc.id}: SKIPPED -- a mission scenario; the levers are sandbox-only`);
    continue;
  }
  const spec = specFor(sc.id);
  const on: Scenario = { ...sc, sandboxFlags: [...(sc.sandboxFlags ?? []), ...FLAGS] };
  const files: Record<string, string> = {};
  for (const [label, s] of [['off', sc], ['off2', sc], ['on', on]] as const) {
    const page = await ctx.newPage();
    const file = `${OUT}/${sc.id}-${label === 'on' ? tag : label}.png`;
    await capture(page, threeUrl(PORT, s), captureScript(s), file, `${sc.id}/${label}`);
    await page.close();
    files[label] = file;
  }
  const region = spec.region ?? undefined;
  const control = computeDiff(files.off, files.off2, { region });
  const lever = computeDiff(files.off, files.on, { region });
  console.log(
    `[gate-impact] ${sc.id.padEnd(12)} ${spec.gated === false ? 'report-only' : 'GATED      '} ` +
      `control ${control.diffPixels} px / ${control.meanAbsChannelDelta.toFixed(4)}   ` +
      `lever ${lever.diffPixels} px / ${lever.meanAbsChannelDelta.toFixed(4)}   ` +
      `(thresholds ${spec.maxDiffPixels ?? '-'} px / ${spec.maxMeanAbsChannelDelta ?? '-'})`
  );
}
await browser.close();
