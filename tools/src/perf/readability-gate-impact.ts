/**
 * GH-346: which visual-gate scenarios a renderer change moves, by how much and
 * WHERE -- measured by the gate's OWN capture protocol (`capture()`,
 * `captureScript`, its SwiftShader browser and its `region`s), not guessed.
 *
 * Two dev servers: `--base-port` serves the reference tree (e.g. `main` in a
 * second worktree) and `--port` the changed one. For every scenario in
 * `SCENARIOS`, three captures: base (`off`), base again (`off2`, the
 * run-to-run control) and the changed tree (`on`). Prints both diffs against
 * `off` with the baseline's own thresholds beside them, and the bounding box
 * of what changed, so a bless can be planned before the gate goes red.
 *
 *   cd tools && npx tsx src/perf/readability-gate-impact.ts --base-port=5272 --port=5271 --out=<dir>
 *
 * Runs against dev servers you started; never starts or stops one.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { SCENARIOS, captureScript, threeUrl } from '../golden-diff/capture-protocol';
import { capture, launchCaptureBrowser } from '../golden-diff/browser';
import { computeDiff } from '../golden-diff/diff';
import { specFor } from '../golden-diff/baseline';
import { SILENT_AUDIO, musicOffInitScript } from '../ui-review/music-off';

const args = process.argv.slice(2);
const arg = (k: string, d: string): string => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PORT = Number(arg('port', '5271'));
const BASE_PORT = Number(arg('base-port', '5272'));
if (PORT === 5177 || BASE_PORT === 5177) throw new Error('5177 is the lead’s dev server; use another port');
const OUT = resolve(arg('out', '.superpowers/readability-gate'));
mkdirSync(OUT, { recursive: true });

/** The box (capture px) holding every pixel whose channels differ by more
 *  than 8, or `none`. */
function changedBox(a: string, b: string): string {
  const A = PNG.sync.read(readFileSync(a));
  const B = PNG.sync.read(readFileSync(b));
  let x0 = A.width;
  let y0 = A.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < A.height; y++)
    for (let x = 0; x < A.width; x++) {
      const i = (y * A.width + x) * 4;
      const d = Math.max(
        Math.abs(A.data[i] - B.data[i]),
        Math.abs(A.data[i + 1] - B.data[i + 1]),
        Math.abs(A.data[i + 2] - B.data[i + 2])
      );
      if (d <= 8) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return x1 < 0 ? 'none' : `${x0},${y0}-${x1},${y1}`;
}

const browser = await launchCaptureBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(musicOffInitScript(SILENT_AUDIO));
console.log(`[gate-impact] base :${BASE_PORT} vs changed :${PORT}`);
for (const sc of SCENARIOS) {
  const spec = specFor(sc.id);
  const files: Record<string, string> = {};
  for (const [label, port] of [['off', BASE_PORT], ['off2', BASE_PORT], ['on', PORT]] as const) {
    const page = await ctx.newPage();
    const file = `${OUT}/${sc.id}-${label}.png`;
    await capture(page, threeUrl(port, sc), captureScript(sc), file, `${sc.id}/${label}`, sc.mission !== undefined);
    await page.close();
    files[label] = file;
  }
  const region = spec.region ?? undefined;
  const control = computeDiff(files.off, files.off2, { region });
  const changed = computeDiff(files.off, files.on, { region });
  console.log(
    `[gate-impact] ${sc.id.padEnd(12)} ${spec.gated === false ? 'report-only' : 'GATED      '} ` +
      `control ${control.diffPixels} px / ${control.meanAbsChannelDelta.toFixed(4)}   ` +
      `changed ${changed.diffPixels} px / ${changed.meanAbsChannelDelta.toFixed(4)} in ${changedBox(files.off, files.on)}   ` +
      `(thresholds ${spec.maxDiffPixels} px / ${spec.maxMeanAbsChannelDelta}${region ? `, region ${JSON.stringify(region)}` : ''})`
  );
}
await browser.close();
