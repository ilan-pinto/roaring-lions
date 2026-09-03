// The measuring half of the golden-image diff harness -- Node-only, no
// browser, no GPU. Takes two already-captured PNGs (one per backend, same
// map/tick/camera -- see capture-protocol.ts for how those get made) and
// produces a per-pixel diff image plus a summary metric.
//
// Deliberately split from capture the same way three-units.ts splits its
// Node-CLI tick-cost mode from its browser render-cost mode (see that
// file's own top comment): this half needs no WebGL context and can run
// anywhere, including CI once a capture step exists there. The capture half
// cannot -- ThreeRenderer needs a real WebGLRenderer, per the design doc's
// Testing section amendment -- so it stays a browser-driven protocol,
// exactly the status `playtest.ts` already has in this codebase.
//
// Usage:
//   npx tsx tools/src/golden-diff/diff.ts <baseline.png> <candidate.png> [outDir] [--threshold=0.1]
//
// or via the workspace script:
//   pnpm --filter @lions/tools golden-diff -- <baseline.png> <candidate.png> [outDir]
//
// "baseline" is the Pixi capture (today's default, shipping renderer).
// "candidate" is the three.js capture. Naming them asymmetrically is
// deliberate: this harness measures how far three has to go before Phase D
// can flip the default, not a symmetric "which is right" comparison.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { EXPECTED_DIFFERENCES, formatExpectedDifferences } from './expected-differences';

/** A rectangle in capture-pixel coordinates. Shared by `computeDiff`'s optional
 *  `region` and, before it was retired, by `computeDominantColorFraction`. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffSummary {
  baseline: string;
  candidate: string;
  /** The sub-rectangle both images were cropped to before diffing, or `null`
   *  for a whole-frame diff. Every number below is over the CROP when this is
   *  set, never the whole capture. */
  region: Region | null;
  width: number;
  height: number;
  totalPixels: number;
  /** Pixels pixelmatch counted as different, at `threshold`, with its own
   *  built-in anti-aliased-pixel exclusion (see this file's top comment on
   *  why that default is left on rather than fought). */
  diffPixels: number;
  diffPixelPct: number;
  /** Pixels whose RGB is not EXACTLY equal between the two images -- no
   *  threshold, perceptual or otherwise. Deliberately not `diffPixels`: that
   *  is pixelmatch's own perceptual count, and on this palette it ignores
   *  changes below roughly one palette step. Measured on the scatter layer's
   *  own footprint, the two disagree by more than 2x (8558 exact against 3498
   *  perceptual), and the band between them is exactly where a
   *  palette-quantised mark lives. Used by the tone-collapse ratio, which is
   *  a comparison of two FOOTPRINTS and would read the perceptual count as
   *  "this mark is not there". */
  changedPixels: number;
  /** Mean absolute per-channel (R,G,B) delta across EVERY pixel, differing
   *  or not -- a magnitude signal pixelmatch's pass/fail count does not
   *  give. A diff that is 2% of pixels but each off by 250/255 (a real
   *  colour-family mismatch) reads very differently from 2% of pixels each
   *  off by 4/255 (AA fringe rounding), and diffPixelPct alone cannot tell
   *  those apart. */
  meanAbsChannelDelta: number;
  maxAbsChannelDelta: number;
  thresholdUsed: number;
  diffImagePath: string | null;
}

function loadPng(path: string): PNG {
  const buf = readFileSync(path);
  return PNG.sync.read(buf);
}

// `computeDominantColorFraction` USED TO LIVE HERE, and it is gone rather than
// left as an unused export. It cropped one capture and reported what fraction
// of the crop was the single most common RGB colour -- the whole of
// `Scenario.groundTextureCheck`, the gate's only reference-free check. Textured
// open ground (`c38f770`) took that fraction from 0.94-0.96 to 0.2330 against a
// <0.95 budget, so it could no longer fire on the defect it was built for, or
// on anything (measured on both stored baselines, 6,721 and 6,667 distinct
// colours). Its replacement is the visible-toggle A/B in
// `three-baseline-gate.ts`, which asks whether a layer CONTRIBUTES pixels
// rather than what the pixels look like. Do not reintroduce an appearance
// statistic here without a defect it catches that the toggles do not.

/** Copies `region` out of `img` into a fresh RGBA buffer, alpha forced opaque
 *  (a canvas capture is always 255 already; forcing it keeps a cropped buffer
 *  comparable with one that came from a PNG encoder that dropped the channel). */
function cropPixels(img: PNG, region: Region): Uint8Array {
  const out = new Uint8Array(region.w * region.h * 4);
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      const s = ((region.x + x) + (region.y + y) * img.width) << 2;
      const d = (x + y * region.w) << 2;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}

export function computeDiff(
  baselinePath: string,
  candidatePath: string,
  opts: { outDir?: string; threshold?: number; diffFileName?: string; region?: Region } = {}
): DiffSummary {
  const threshold = opts.threshold ?? 0.1;
  const a = loadPng(baselinePath);
  const b = loadPng(candidatePath);

  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `golden-diff: dimension mismatch -- ${baselinePath} is ${a.width}x${a.height}, ` +
        `${candidatePath} is ${b.width}x${b.height}. Both captures must use the same ` +
        `window size and canvas rect; see capture-protocol.ts.`
    );
  }

  // Region support exists because the noise measurement behind
  // `three-baseline-gate.ts` found the run-to-run instability in a capture is
  // NOT spread over the frame -- it sits in tight clusters around animating
  // units and real-time VFX, and everything else is bit-identical across
  // repeated captures. Diffing a declared stable sub-rectangle instead of the
  // whole frame took the open-ground scenario's own run-to-run noise from
  // 1762 differing pixels / 0.1544 meanAbsChannelDelta to 0 / 0.0000, which is
  // what makes a stored baseline usable there at all. See
  // `baseline.ts`'s BASELINES table for the measured per-scenario numbers.
  const region = opts.region ?? null;
  if (region) {
    if (
      region.x < 0 ||
      region.y < 0 ||
      region.w <= 0 ||
      region.h <= 0 ||
      region.x + region.w > a.width ||
      region.y + region.h > a.height
    ) {
      throw new Error(
        `golden-diff: region ${JSON.stringify(region)} falls outside the ${a.width}x${a.height} capture`
      );
    }
    a.data = Buffer.from(cropPixels(a, region));
    b.data = Buffer.from(cropPixels(b, region));
    a.width = region.w;
    a.height = region.h;
  }

  const { width, height } = a;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold,
    // AA-pixel exclusion stays ON (pixelmatch default) rather than fought --
    // see expected-differences.ts's `antialiasing` entry. This is a
    // heuristic (it compares each image's OWN local neighbourhood for an
    // AA-like pattern), not a guarantee it catches every edge pixel that
    // differs ONLY because one backend blends and the other quantises, so
    // `antialiasing`-shaped diffs are still expected to show up in the
    // count -- this just keeps the harness from double-penalizing them via
    // pixelmatch's own AA heuristic on top of the raw threshold.
  });

  // Magnitude pass, independent of pixelmatch's pass/fail count: mean/max
  // absolute per-channel delta over every pixel. RGB only (alpha is always
  // 255 for an opaque canvas capture; including it would dilute the signal
  // toward 0 for no reason).
  let sumAbsDelta = 0;
  let maxAbsDelta = 0;
  let changedPixels = 0;
  const totalPixels = width * height;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelMax = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      sumAbsDelta += d;
      if (d > maxAbsDelta) maxAbsDelta = d;
      if (d > pixelMax) pixelMax = d;
    }
    if (pixelMax > 0) changedPixels++;
  }
  const meanAbsChannelDelta = sumAbsDelta / (totalPixels * 3);

  let diffImagePath: string | null = null;
  if (opts.outDir) {
    mkdirSync(opts.outDir, { recursive: true });
    diffImagePath = `${opts.outDir}/${opts.diffFileName ?? 'diff.png'}`;
    writeFileSync(diffImagePath, PNG.sync.write(diff));
  }

  return {
    baseline: baselinePath,
    candidate: candidatePath,
    region,
    width,
    height,
    totalPixels,
    diffPixels,
    diffPixelPct: (diffPixels / totalPixels) * 100,
    changedPixels,
    meanAbsChannelDelta,
    maxAbsChannelDelta: maxAbsDelta,
    thresholdUsed: threshold,
    diffImagePath,
  };
}

export function formatSummary(s: DiffSummary): string {
  return [
    `[golden-diff] ${s.baseline}  vs  ${s.candidate}`,
    `  ${s.width}x${s.height} = ${s.totalPixels} px, threshold=${s.thresholdUsed}` +
      (s.region ? `, region ${s.region.x},${s.region.y} ${s.region.w}x${s.region.h}` : ', whole frame'),
    `  differing pixels: ${s.diffPixels} (${s.diffPixelPct.toFixed(3)}%)`,
    `  pixels not bit-identical: ${s.changedPixels}`,
    `  mean |channel delta| over ALL pixels: ${s.meanAbsChannelDelta.toFixed(3)} / 255`,
    `  max  |channel delta|: ${s.maxAbsChannelDelta} / 255`,
    s.diffImagePath ? `  diff image: ${s.diffImagePath}` : '  diff image: (not written -- pass outDir)',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): {
  baseline: string;
  candidate: string;
  outDir?: string;
  threshold: number;
} {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flags = new Map(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v ?? 'true'] as const;
      })
  );
  const [baseline, candidate, outDir] = positional;
  if (!baseline || !candidate) {
    console.error(
      'usage: tsx tools/src/golden-diff/diff.ts <baseline.png> <candidate.png> [outDir] [--threshold=0.1]'
    );
    process.exit(2);
  }
  return {
    baseline,
    candidate,
    outDir,
    threshold: flags.has('threshold') ? Number(flags.get('threshold')) : 0.1,
  };
}

async function main(): Promise<void> {
  const { baseline, candidate, outDir, threshold } = parseArgs(process.argv.slice(2));
  const summary = computeDiff(baseline, candidate, { outDir, threshold });
  console.log(formatSummary(summary));
  console.log('');
  console.log(
    `[golden-diff] Before triaging any of the ${summary.diffPixels} differing pixels as a bug, ` +
      `check them against the ${EXPECTED_DIFFERENCES.length} known expected-difference entries:`
  );
  console.log('');
  console.log(formatExpectedDifferences());
  if (outDir) {
    writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
  }
}

// Only run as a CLI when invoked directly (tsx), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
