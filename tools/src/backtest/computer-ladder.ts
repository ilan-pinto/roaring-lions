// The computer ladder (GH-1389): does each computer level play stronger than the one below it?
//
//   pnpm computer:ladder [-- --seeds=30] [--maps=tel_marum,... | --cells=wadi_tarfan:kdf:camp,...] [--jobs=2] [--seed-base=89000] [--out=<json>]
//
// Every level in data/computer/levels.json (easy, medium, hard) against three scripted player plans (`passive`, `rush`,
// `sensible`, computer-ladder-match.ts) on EVERY open versus map (`VERSUS_FAIR_MAPS`, @lions/net), `--seeds` seeds a cell.
// By default the cell is the mirror in annihilation (KDF v KDF). `--cells=map:matchup[:winMode]` names other cells instead
// (GH-1389, Sarim withholds): `wadi_tarfan:kdf:camp` is the human on KDF against the computer on SARIM, in camp mode, and the
// computer then fields its level's Sarim withhold. Cells are gated per computer faction, with that faction's statements.
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
import type { Matchup, WinMode } from '@lions/net';
import type { ComputerLevelId } from '@lions/data';
import { LADDER_LEVELS, LADDER_MARGINS, ladderTable, orderingViolations } from './computer-ladder-gate';
import { DEFAULT_CELL_MODE, PLAN_IDS, cellKey, computerFactionOf, ladderCells, levelStatements, playMatch, tally, type LadderCell, type LadderCellMode, type MatchRun, type PlanId } from './computer-ladder-match';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

async function worker(map: string, seeds: number, base: number, mode: LadderCellMode): Promise<void> {
  for (const level of LADDER_LEVELS) {
    for (const plan of PLAN_IDS) {
      for (let n = 0; n < seeds; n++) {
        const r = playMatch(map, level as ComputerLevelId, plan, base + n, mode);
        process.stdout.write(`${JSON.stringify(r)}\n`);
      }
    }
  }
}

function runCell(cell: LadderCell, seeds: number, base: number): Promise<MatchRun[]> {
  const { map } = cell;
  // The default cell's worker is spawned exactly as it always was; another cell adds its pairing and win mode.
  const modeArgs = cell.matchup === DEFAULT_CELL_MODE.matchup && cell.winMode === DEFAULT_CELL_MODE.winMode ? [] : [`--matchup=${cell.matchup}`, `--win-mode=${cell.winMode ?? 'annihilation'}`];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--worker', `--map=${map}`, ...modeArgs, `--seeds=${seeds}`, `--seed-base=${base}`], { stdio: ['ignore', 'pipe', 'inherit'] });
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
    child.on('exit', (code) => (code === 0 ? resolve(runs) : reject(new Error(`${cellKey(cell)}: worker exited ${code}`))));
  });
}

async function main(): Promise<void> {
  const seeds = Number(arg('seeds') ?? 30);
  const base = Number(arg('seed-base') ?? 89000);
  if (process.argv.includes('--worker')) {
    const map = arg('map');
    if (map === undefined) throw new Error('--worker needs --map');
    const winMode = arg('win-mode') ?? 'annihilation';
    await worker(map, seeds, base, { matchup: (arg('matchup') ?? DEFAULT_CELL_MODE.matchup) as Matchup, winMode: winMode === 'annihilation' ? null : (winMode as WinMode) });
    return;
  }
  const cellList = ladderCells({ maps: arg('maps'), cells: arg('cells') });
  const defaultRun = cellList.every((c) => c.matchup === DEFAULT_CELL_MODE.matchup && c.winMode === DEFAULT_CELL_MODE.winMode);
  const maps = cellList.map((c) => c.map);
  const keys = cellList.map(cellKey);
  const jobs = Math.max(1, Number(arg('jobs') ?? 2));
  const t0 = Date.now();
  const runs: MatchRun[] = [];
  const queue = [...cellList];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let cell = queue.shift(); cell !== undefined; cell = queue.shift()) {
      const got = await runCell(cell, seeds, base);
      process.stderr.write(`${cellKey(cell)}: ${got.length} games in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
      runs.push(...got);
    }
  }));
  // Cell order as asked, whatever finished first.
  runs.sort((a, b) => keys.indexOf(cellKey(a)) - keys.indexOf(cellKey(b)));
  const plans: readonly PlanId[] = PLAN_IDS;
  const out: string[] = [];
  out.push(`computer ladder (GH-1389): ${defaultRun ? `${maps.length} open map(s)` : `${cellList.length} cell(s)`}, ${seeds} seed(s) a cell (${base}..${base + seeds - 1}), ${runs.length} games, ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
  out.push('the player is seat 0 at the friendly end; the computer is the shipped computer seat at each level');
  // One table and one gate per faction the computer plays: a level's withhold, and so its strength, is per faction.
  const factions = [...new Set(cellList.map(computerFactionOf))];
  let failed = false;
  for (const faction of factions) {
    const cells = tally(runs.filter((r) => computerFactionOf({ matchup: r.matchup ?? DEFAULT_CELL_MODE.matchup }) === faction));
    const statements = levelStatements(faction);
    out.push('');
    if (!defaultRun) out.push(`## the computer playing ${faction}`, '');
    out.push(ladderTable(cells, statements, plans));
    out.push('');
    const violations = orderingViolations(cells);
    const boosted = statements.filter((s) => s.income || s.vision);
    out.push(`ordering gate (pooled step > ${(100 * LADDER_MARGINS.pooledStep).toFixed(0)} points; a cell may invert by at most ${(100 * LADDER_MARGINS.cellInversion).toFixed(0)} points):`);
    if (violations.length === 0) out.push('  PASS: easy < medium < hard against every plan');
    for (const v of violations) out.push(`  FAIL ${v.scope}${v.map === null ? '' : ` ${v.map}`} ${v.plan}: ${v.why}`);
    out.push(boosted.length === 0 ? 'boost check: PASS, no level boosts income or vision' : `boost check: FAIL, ${boosted.map((s) => s.level).join(', ')} boost income or vision`);
    if (violations.length > 0 || boosted.length > 0) failed = true;
  }
  process.stdout.write(`${out.join('\n')}\n`);
  const json = arg('out');
  if (json !== undefined) writeFileSync(json, `${JSON.stringify({ seeds, base, maps, ...(defaultRun ? {} : { cells: cellList }), runs }, null, 0)}\n`);
  if (failed) process.exitCode = 1;
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exitCode = 2;
});
