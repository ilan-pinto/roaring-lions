// The computer ladder (GH-1389): does each computer level play stronger than the one below it?
//
//   pnpm computer:ladder [-- --seeds=30] [--maps=tel_marum,...] [--jobs=2] [--seed-base=89000] [--out=<json>]
//
// Every level in data/computer/levels.json (easy, medium, hard) against three scripted player plans (`passive`, `rush`,
// `sensible`, computer-ladder-match.ts) on EVERY open versus map (`VERSUS_FAIR_MAPS`, @lions/net), `--seeds` seeds a cell.
// Each match is the shipped offline match against the computer seat, played headlessly to the sim's own result (or the room's
// cap, decided on standing value by that same rule). The seed of game n is `seed-base + n`: the same seed for every level
// and plan, so a cell differs from its neighbour by the level alone.
//
// It prints the computer's win rate per map, plan and level, the rates pooled over every map, and what each level IS --
// the share of the force's value it fields, what it leaves at home, and whether it boosts income or vision, all derived
// from the level data (`levelBoosts`, tools/validate_computer_levels.mjs), never written here.
//
// THE GATE (exit 1): the levels must be STRICTLY ordered for the computer against each plan (`orderingViolations`,
// computer-ladder-gate.ts, with its stated noise margins), and no level may boost income or vision. Fairness of the map
// itself is the versus probe's question, not this one: this tool tunes nothing and changes no data.
//
// Maps run in child processes, at most `--jobs` at a time (default 2), each printing one JSON line a match.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSUS_FAIR_MAPS } from '@lions/net';
import type { ComputerLevelId } from '@lions/data';
import { LADDER_LEVELS, LADDER_MARGINS, ladderTable, orderingViolations } from './computer-ladder-gate';
import { PLAN_IDS, levelStatements, playMatch, tally, type MatchRun, type PlanId } from './computer-ladder-match';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

async function worker(map: string, seeds: number, base: number): Promise<void> {
  for (const level of LADDER_LEVELS) {
    for (const plan of PLAN_IDS) {
      for (let n = 0; n < seeds; n++) {
        const r = playMatch(map, level as ComputerLevelId, plan, base + n);
        process.stdout.write(`${JSON.stringify(r)}\n`);
      }
    }
  }
}

function runMap(map: string, seeds: number, base: number): Promise<MatchRun[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--worker', `--map=${map}`, `--seeds=${seeds}`, `--seed-base=${base}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    const runs: MatchRun[] = [];
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith('{')) runs.push(JSON.parse(line) as MatchRun);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(runs) : reject(new Error(`${map}: worker exited ${code}`))));
  });
}

async function main(): Promise<void> {
  const seeds = Number(arg('seeds') ?? 30);
  const base = Number(arg('seed-base') ?? 89000);
  if (process.argv.includes('--worker')) {
    const map = arg('map');
    if (map === undefined) throw new Error('--worker needs --map');
    await worker(map, seeds, base);
    return;
  }
  const maps = (arg('maps') ?? VERSUS_FAIR_MAPS.join(',')).split(',').filter(Boolean);
  const jobs = Math.max(1, Number(arg('jobs') ?? 2));
  const t0 = Date.now();
  const runs: MatchRun[] = [];
  const queue = [...maps];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let map = queue.shift(); map !== undefined; map = queue.shift()) {
      const got = await runMap(map, seeds, base);
      process.stderr.write(`${map}: ${got.length} games in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
      runs.push(...got);
    }
  }));
  // Map order as asked, whatever finished first.
  runs.sort((a, b) => maps.indexOf(a.map) - maps.indexOf(b.map));
  const cells = tally(runs);
  const statements = levelStatements();
  const plans: readonly PlanId[] = PLAN_IDS;
  const out: string[] = [];
  out.push(`computer ladder (GH-1389): ${maps.length} open map(s), ${seeds} seed(s) a cell (${base}..${base + seeds - 1}), ${runs.length} games, ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
  out.push('the player is seat 0 at the friendly end; the computer is the shipped computer seat at each level');
  out.push('');
  out.push(ladderTable(cells, statements, plans));
  out.push('');
  const violations = orderingViolations(cells);
  const boosted = statements.filter((s) => s.income || s.vision);
  out.push(`ordering gate (pooled step > ${(100 * LADDER_MARGINS.pooledStep).toFixed(0)} points; a cell may invert by at most ${(100 * LADDER_MARGINS.cellInversion).toFixed(0)} points):`);
  if (violations.length === 0) out.push('  PASS: easy < medium < hard against every plan');
  for (const v of violations) out.push(`  FAIL ${v.scope}${v.map === null ? '' : ` ${v.map}`} ${v.plan}: ${v.why}`);
  out.push(boosted.length === 0 ? 'boost check: PASS, no level boosts income or vision' : `boost check: FAIL, ${boosted.map((s) => s.level).join(', ')} boost income or vision`);
  process.stdout.write(`${out.join('\n')}\n`);
  const json = arg('out');
  if (json !== undefined) writeFileSync(json, `${JSON.stringify({ seeds, base, maps, runs }, null, 0)}\n`);
  if (violations.length > 0 || boosted.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exitCode = 2;
});
