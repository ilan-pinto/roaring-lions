/**
 * Print a mission's map with every placement overlaid, and fail on a bad one.
 *
 *   npx tsx tools/src/walk_placements.ts wadi_halam_5_depot
 *
 * Why this exists. `assertGroundClear` spreads a placement's bodies 1.25 tiles
 * apart -- body k lands at x + (k % 3) * 1.25, y + floor(k / 3) * 1.25 -- so a
 * count-3 group occupies its declared tile PLUS roughly three tiles east, and a
 * count-6 adds a second row two tiles south. A clear `at` therefore does not mean
 * clear ground. Its own docstring records a civilian group whose `at` was open
 * street putting its middle body inside a mosque, and that survived a hand audit
 * and a code review.
 *
 * Lives under tools/src so `pnpm typecheck` covers it. Read-only: nothing is
 * written, nothing is rendered.
 */
import { join } from 'node:path';

import { ROOT, makeWorld, read } from './walk_world';

interface Placement {
  unit: string;
  count?: number;
  at?: readonly [number, number];
  marker?: string;
}

/** Wave units use `from` instead of `marker` for their spawn point (mission.schema.json).
 *  mission.ts's spawnWave resolves it the same way spawnPlacement resolves `marker` --
 *  markerPos(u.from) feeds the very assertGroundClear this tool exists to pre-check --
 *  so a wave's `from` must be walked exactly like everyone else's `marker`. */
interface WavePlacement extends Placement {
  from?: string;
}

interface Mission {
  map: { file: string };
  starting_force?: readonly Placement[];
  civilians?: { groups?: readonly Placement[] };
  enemy?: { garrison?: readonly Placement[]; waves?: readonly { units: readonly WavePlacement[] }[] };
  triggers?: readonly { do?: { units?: readonly Placement[] } }[];
}

interface MapData {
  width: number;
  height: number;
  rows: readonly string[];
  markers?: Record<string, readonly [number, number]>;
  zones?: Record<string, readonly [number, number, number, number]>;
}

const missionId = process.argv[2];
if (!missionId) {
  console.error('usage: npx tsx tools/src/walk_placements.ts <mission-id>');
  process.exit(1);
}

const mission = read(join(ROOT, `data/missions/${missionId}.json`)) as Mission;
const { sim } = makeWorld(missionId);
const map = read(join(ROOT, `data/maps/${mission.map.file}.json`)) as MapData;

const W = map.width;
const H = map.height;
const cell: string[][] = [];
for (let y = 0; y < H; y++) {
  const row: string[] = [];
  for (let x = 0; x < W; x++) {
    row.push(sim.blocked[y * W + x] ? '#' : sim.cover[y * W + x] ? String(sim.cover[y * W + x]) : '.');
  }
  cell.push(row);
}
for (const [, [mx, my]] of Object.entries(map.markers ?? {})) {
  if (cell[my]?.[mx] !== undefined) cell[my][mx] = '+';
}

let bad = 0;
function place(p: Placement | WavePlacement, label: string): void {
  const markerName = p.marker ?? ('from' in p ? p.from : undefined);
  const at = p.at ?? (markerName ? map.markers?.[markerName] : undefined);
  if (!at) {
    console.error(`  ${label} ${p.unit}: neither at nor a resolvable marker`);
    bad++;
    return;
  }
  const n = p.count ?? 1;
  for (let k = 0; k < n; k++) {
    const bx = Math.floor(at[0] + (k % 3) * 1.25);
    const by = Math.floor(at[1] + Math.floor(k / 3) * 1.25);
    if (bx < 0 || bx >= W || by < 0 || by >= H) {
      console.error(`  ${label} ${p.unit} body ${k}: OFF-MAP at (${bx},${by})`);
      const ax = Math.floor(at[0]);
      const ay = Math.floor(at[1]);
      if (cell[ay]?.[ax] !== undefined) cell[ay][ax] = '!';
      bad++;
      continue;
    }
    if (sim.blocked[by * W + bx]) {
      console.error(`  ${label} ${p.unit} body ${k}: BLOCKED at (${bx},${by})`);
      const cellRow = cell[by];
      if (cellRow) cellRow[bx] = 'X';
      bad++;
      continue;
    }
    const cellRow = cell[by];
    if (cellRow) cellRow[bx] = 'o';
  }
}

for (const p of mission.starting_force ?? []) place(p, 'starting_force');
for (const p of mission.enemy?.garrison ?? []) place(p, 'garrison');
for (const p of mission.civilians?.groups ?? []) place(p, 'civilians');
for (const w of mission.enemy?.waves ?? []) for (const p of w.units) place(p, 'wave');
for (const t of mission.triggers ?? []) for (const p of t.do?.units ?? []) place(p, 'trigger');

console.log(cell.map((r) => r.join('')).join('\n'));
console.log(`\nzones: ${Object.entries(map.zones ?? {}).map(([k, v]) => `${k}[${v.join(',')}]`).join(' ')}`);
console.log(bad === 0 ? '\nall placements clear' : `\n${bad} bad placement(s)`);
process.exitCode = bad === 0 ? 0 : 1;
