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
 * Two things this tool must mirror exactly, or it checks the wrong tile or the
 * wrong placements:
 *
 * - `markerPos` (mission.ts:686-690) adds a +0.5 tile-centre offset to a marker
 *   before spreading bodies from it. The `at` path (mission.ts:738-740) does not --
 *   an authored `at` is used exactly as written. A marker- or `from`-resolved
 *   placement therefore spreads from a different fractional origin than an
 *   `at`-resolved one, and a body landing on a `.5` fraction (k ≡ 2 mod 3, or the
 *   third row at count >= 7) checks a different tile depending on which path it
 *   came from.
 * - A garrison stance is exempt from the clearance check entirely
 *   (`spawnPlacement`, mission.ts:769-774): the unit is ordered into the building
 *   and walks in on its first ticks, so standing on the building's tile at spawn
 *   is the job, not a trap (mission.ts:659-665). This tool skips the
 *   blocked/off-map check for those bodies too, but still marks them on the grid
 *   (`g`) so they read as "present but deliberately unchecked" rather than
 *   silently absent or falsely failed.
 *
 * Lives under tools/src so `pnpm typecheck` covers it. Read-only: nothing is
 * written, nothing is rendered.
 */
import { join } from 'node:path';

import { TERRAIN_LEGEND } from '../../packages/data/src/index';
import { ROOT, makeWorld, read } from './walk_world';

interface Placement {
  unit: string;
  count?: number;
  at?: readonly [number, number];
  marker?: string;
  stance?: { kind?: string };
}

/** Wave units use `from` instead of `marker` for their spawn point (mission.schema.json).
 *  mission.ts's spawnWave resolves it the same way spawnPlacement resolves `marker` --
 *  markerPos(u.from) feeds the very assertGroundClear this tool exists to pre-check --
 *  so a wave's `from` must be walked exactly like everyone else's `marker`, offset
 *  included. */
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
    const ch = map.rows[y][x];
    // Rock is the first blocked tile that is NOT a building, so '#' -- the
    // building glyph -- would print a ridge as a house nobody placed. Any
    // blocked tile whose character is in the terrain legend is terrain, so
    // print the authored character itself: the grid round-trips with the map
    // source, and a future blocked terrain symbol needs no edit here.
    const blockedGlyph = TERRAIN_LEGEND[ch] !== undefined ? ch : '#';
    row.push(
      sim.blocked[y * W + x]
        ? blockedGlyph
        : sim.cover[y * W + x]
          ? String(sim.cover[y * W + x])
          : '.'
    );
  }
  cell.push(row);
}
for (const [, [mx, my]] of Object.entries(map.markers ?? {})) {
  if (cell[my]?.[mx] !== undefined) cell[my][mx] = '+';
}

let bad = 0;
function place(p: Placement | WavePlacement, label: string): void {
  const markerName = p.marker ?? ('from' in p ? p.from : undefined);
  // `at` is used exactly as authored (mission.ts:738-740). A marker/`from` name
  // resolves through markerPos, which adds a +0.5 tile-centre offset
  // (mission.ts:686-690) before spreading -- so only the marker path gets it.
  let origin: readonly [number, number] | undefined;
  if (p.at !== undefined) {
    origin = p.at;
  } else if (markerName !== undefined) {
    const m = map.markers?.[markerName];
    origin = m ? [m[0] + 0.5, m[1] + 0.5] : undefined;
  }
  if (!origin) {
    console.error(`  ${label} ${p.unit}: neither at nor a resolvable marker`);
    bad++;
    return;
  }
  // spawnPlacement never calls assertGroundClear for a garrison stance
  // (mission.ts:769-774) -- overlapping the building it enters is intended, not
  // a bug. Mirror that: no BLOCKED/OFF-MAP verdict for these bodies, just a
  // distinct mark so the grid shows them instead of hiding them.
  const garrison = p.stance?.kind === 'garrison';
  const n = p.count ?? 1;
  for (let k = 0; k < n; k++) {
    const bx = Math.floor(origin[0] + (k % 3) * 1.25);
    const by = Math.floor(origin[1] + Math.floor(k / 3) * 1.25);
    if (garrison) {
      const cellRow = cell[by];
      if (bx >= 0 && bx < W && cellRow) cellRow[bx] = 'g';
      continue;
    }
    if (bx < 0 || bx >= W || by < 0 || by >= H) {
      console.error(`  ${label} ${p.unit} body ${k}: OFF-MAP at (${bx},${by})`);
      const ax = Math.floor(origin[0]);
      const ay = Math.floor(origin[1]);
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
