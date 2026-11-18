// ci.yml's `changes` job decides whether a pull request runs the macOS and
// Windows determinism legs (lead, 17 Nov 2026: the macOS runners are the
// bottleneck). These pins read the filter straight out of ci.yml, so the
// globs tested are the globs CI runs, and the paths are LITERALS: a path the
// sim reads that the filter misses would let a PR skip the cross-platform
// replay it needed.
//
// The matcher is node's `path.posix.matchesGlob` (minimatch semantics);
// dorny/paths-filter uses picomatch with `dot: true`. The two agree on every
// pattern in the list, none of which puts a wildcard over a dot segment.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

/** The `sim:` filter's globs, in order. Empty if the block is not found. */
function simGlobs(text: string): string[] {
  const lines = text.split('\n');
  const job = lines.findIndex((l) => l === '  changes:');
  if (job < 0) return [];
  const head = lines.findIndex((l, i) => i > job && l.trim() === 'sim:');
  if (head < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(head + 1)) {
    const m = /^\s+- '([^']+)'$/.exec(l);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

const globs = simGlobs(ci);
const counts = (path: string) => globs.some((g) => posix.matchesGlob(path, g));

describe('the determinism path filter (ci.yml `changes`)', () => {
  it('is found, and is not vacuous', () => {
    expect(globs.length).toBeGreaterThanOrEqual(10);
    expect(globs).toContain('.github/workflows/ci.yml');
  });

  it.each([
    'packages/sim/src/x.ts',
    'packages/sim/src/tuning.ts',
    'packages/sim/src/determinism.test.ts',
    'packages/sim/src/snapshot-witness.test.ts',
    'packages/sim/src/snapshot-witness-runtime.test.ts',
    'packages/sim/package.json',
    'data/units/a.json',
    'data/structures.json',
    'data/formations/attack.json',
    'packages/data/src/y.ts',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'patches/three@0.186.1.patch',
    'vitest.config.ts',
    'vitest.setup.ts',
    'tsconfig.base.json',
    '.github/workflows/ci.yml',
  ])('runs every leg for %s', (path) => {
    expect(counts(path)).toBe(true);
  });

  it.each([
    'packages/worker/src/z.ts',
    'docs/a.md',
    'packages/app/src/ui/b.ts',
    'packages/render/src/three/x.ts',
    'packages/net/src/x.ts',
    'tools/src/ci/x.ts',
    'packages/app/package.json',
    'packages/simulator/x.ts',
    '.github/workflows/visual-baseline.yml',
    'CLAUDE.md',
  ])('runs Linux only for %s', (path) => {
    expect(counts(path)).toBe(false);
  });
});

describe('the determinism job reads the filter one way', () => {
  // runs-on picks the runner and RUN_LEG gates the steps. If the two
  // conditions drift apart, a macOS leg can run the replay on Linux and report
  // it as macOS, or queue a macOS runner to do nothing.
  const runsOn = /^ {4}runs-on: \$\{\{ \((.+)\) && matrix\.os \|\| 'ubuntu-latest' \}\}$/m.exec(ci)?.[1];
  const runLeg = /^ {6}RUN_LEG: \$\{\{ (.+) \}\}$/m.exec(ci)?.[1];

  it('uses the same condition for the runner and the steps', () => {
    expect(runsOn).toBeDefined();
    expect(runLeg).toBe(runsOn);
  });

  it('runs all three off a pull request, Linux always, and fails safe on an empty filter', () => {
    expect(runLeg).toBe(
      "github.event_name != 'pull_request' || matrix.os == 'ubuntu-latest' || needs.changes.outputs.sim != 'false'",
    );
  });
});
