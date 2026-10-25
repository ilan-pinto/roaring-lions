// F2 Task 7 (C-R4): every place that builds a mission runtime hands it the map's roads, from
// the one helper, so a convoy drives the same road in the game and in every harness. A site
// that forgets `roadMask` silently routes off-road (D5 falls back to the flow route), and no
// behavioural test would see it until a shipped mission paid a zone: so the sites are read as
// text, and the list of them is derived from the tree, not kept by hand.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('dist')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** The ctx a `startMission` call hands on is built in main.ts; every other site builds its own. */
const CTX_FILE: Record<string, string> = { 'packages/app/src/mission-start.ts': 'packages/app/src/main.ts' };

/** Sites whose runtime stands on a synthetic, road-free scene (no shipped map): there is no road
 *  to hand on, so they are held to loading no map at all instead. */
const SYNTHETIC = new Set([
  'tools/src/backtest/special-units-probes.ts',
  // The golden economy replay's world: a flat 48x48 sim with no map loaded and no roads.
  'packages/sim/src/golden-worlds.test-helper.ts',
]);

describe('the road mask reaches every mission runtime (C-R4)', () => {
  const sites = [...sources(join(ROOT, 'packages')), ...sources(join(ROOT, 'tools', 'src'))]
    .filter((p) => readFileSync(p, 'utf8').includes('new MissionRuntime('))
    .map((p) => relative(ROOT, p))
    .sort();

  it('the twelve sites are the ones on the tree', () => {
    expect(sites).toEqual([
      'packages/app/src/mission-start.ts',
      // N3 Task 3: a KDF-v-Sarim room's economy runtime.
      'packages/app/src/net/match-world.ts',
      // Net snapshot S1 Task 1: the golden economy replay's world, importable (synthetic, no map).
      'packages/sim/src/golden-worlds.test-helper.ts',
      'tools/src/backtest/enemy-production-probe.ts',
      'tools/src/backtest/fl_ladder.ts',
      'tools/src/backtest/playtest-run.ts',
      'tools/src/backtest/saddle-price.ts',
      'tools/src/backtest/special-units-probes.ts',
      'tools/src/backtest/wh_pacing.ts',
      'tools/src/mission-harness.ts',
      'tools/src/perf/income-cost.ts',
      'tools/src/walk_world.ts',
    ]);
  });

  it.each([...SYNTHETIC])('%s builds its runtime on no shipped map', (site) => {
    const text = readFileSync(join(ROOT, site), 'utf8');
    expect(text).not.toMatch(/\bparseMap\b|\bloadMap\b|\bmaps\b\s*[,}.[]|data\/maps/);
  });

  it.each(sites.filter((s) => !SYNTHETIC.has(s)))('%s fills roadMask from roadMaskOf', (site) => {
    const file = CTX_FILE[site] ?? site;
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(text).toMatch(/roadMask: roadMaskOf\(map\)/);
  });
});
