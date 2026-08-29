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

export interface DiffSummary {
  baseline: string;
  candidate: string;
  width: number;
  height: number;
  totalPixels: number;
  /** Pixels pixelmatch counted as different, at `threshold`, with its own
   *  built-in anti-aliased-pixel exclusion (see this file's top comment on
   *  why that default is left on rather than fought). */
  diffPixels: number;
  diffPixelPct: number;
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

export interface DominantColorSummary {
  region: { x: number; y: number; w: number; h: number };
  totalPixels: number;
  distinctColors: number;
  dominantColor: readonly [number, number, number];
  dominantFraction: number;
}

/** Same-image, single-capture analysis -- no baseline/candidate pair, unlike
 *  everything else in this file. Added alongside `Scenario.groundTextureCheck`
 *  (capture-protocol.ts): a targeted self-check for a defect class the ordinary
 *  pixi-vs-three diff was measured NOT to discriminate for the open-ground
 *  scenario -- see that scenario's own doc comment for the full derivation and
 *  real before/after numbers. Crops `pngPath` to `region` and reports what
 *  fraction of it is the single most common RGB colour: a stone-grain mark that
 *  silently collapsed into its own tile's background colour (the exact shape of
 *  the scatter bug this exists to catch) pushes that fraction up, independent of
 *  whatever Pixi's own rendering looks like. RGB only, alpha ignored (an opaque
 *  canvas capture is always 255). */
export function computeDominantColorFraction(
  pngPath: string,
  region: { x: number; y: number; w: number; h: number }
): DominantColorSummary {
  const img = loadPng(pngPath);
  if (region.x < 0 || region.y < 0 || region.x + region.w > img.width || region.y + region.h > img.height) {
    throw new Error(
      `computeDominantColorFraction: region ${JSON.stringify(region)} falls outside ${pngPath}'s ` +
        `${img.width}x${img.height} bounds`
    );
  }
  const counts = new Map<number, number>(); // packed 0xRRGGBB -> count
  for (let dy = 0; dy < region.h; dy++) {
    for (let dx = 0; dx < region.w; dx++) {
      const x = region.x + dx;
      const y = region.y + dy;
      const idx = (img.width * y + x) << 2;
      const packed = (img.data[idx] << 16) | (img.data[idx + 1] << 8) | img.data[idx + 2];
      counts.set(packed, (counts.get(packed) ?? 0) + 1);
    }
  }
  let dominantPacked = 0;
  let dominantCount = 0;
  for (const [packed, count] of counts) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantPacked = packed;
    }
  }
  const totalPixels = region.w * region.h;
  return {
    region,
    totalPixels,
    distinctColors: counts.size,
    dominantColor: [(dominantPacked >> 16) & 0xff, (dominantPacked >> 8) & 0xff, dominantPacked & 0xff],
    dominantFraction: dominantCount / totalPixels,
  };
}

export function computeDiff(
  baselinePath: string,
  candidatePath: string,
  opts: { outDir?: string; threshold?: number; diffFileName?: string } = {}
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
  const totalPixels = width * height;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      sumAbsDelta += d;
      if (d > maxAbsDelta) maxAbsDelta = d;
    }
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
    width,
    height,
    totalPixels,
    diffPixels,
    diffPixelPct: (diffPixels / totalPixels) * 100,
    meanAbsChannelDelta,
    maxAbsChannelDelta: maxAbsDelta,
    thresholdUsed: threshold,
    diffImagePath,
  };
}

export function formatSummary(s: DiffSummary): string {
  return [
    `[golden-diff] ${s.baseline}  vs  ${s.candidate}`,
    `  ${s.width}x${s.height} = ${s.totalPixels} px, threshold=${s.thresholdUsed}`,
    `  differing pixels: ${s.diffPixels} (${s.diffPixelPct.toFixed(3)}%)`,
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
