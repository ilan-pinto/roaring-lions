/**
 * Walk a real mission headless and print the world at chosen times.
 *
 *   npx tsx tools/src/walk_mission.ts beit_sahwan_2_foothold 0 60 65 68 80
 *
 * Why this exists. Every unit test in this repository builds its own small world
 * from fixtures, so none of them sees what an *authored* mission actually does. A
 * trigger naming a group no placement declares, a marker that turns out to be the
 * player's own start line, a drop timed for after the carrier has driven past its
 * destination -- all of those pass every test and fail in play.
 *
 * It found three in one sitting on the Beit Sahwan II delivery: the carrier was
 * being sent to `kdf_assembly`, which *is* the player start, so it died before its
 * drop; then the drop was timed 8s late, by which point the sweep behaviour had
 * taken the carrier onward; and the passenger was arriving by bail-out rather than
 * by delivery. The tests were green throughout.
 *
 * Lives under tools/src so `pnpm typecheck` covers it -- which is precisely the
 * gate that would have caught this file reaching into Sim's private `count`.
 *
 * Read-only: no files are written, nothing is rendered.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseMap } from '../../packages/data/src/index';
import { MissionRuntime } from '../../packages/sim/src/mission';
import { Sim, TICKS_PER_SECOND } from '../../packages/sim/src/sim';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const [missionId, ...marks] = process.argv.slice(2);
if (!missionId) {
  console.error('usage: npx tsx tools/src/walk_mission.ts <mission-id> [seconds...]');
  process.exit(1);
}
const seconds = (marks.length > 0 ? marks : ['0', '30', '60', '120', '240']).map(Number);

const mission = read(join(ROOT, `data/missions/${missionId}.json`));
const map = parseMap(read(join(ROOT, `data/maps/${mission.map.file}.json`)));

const units: Record<string, unknown> = {};
const collect = (dir: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) collect(join(dir, e.name));
    else if (e.name.endsWith('.json')) {
      const u = read(join(dir, e.name));
      if (u.id) units[u.id] = u;
    }
  }
};
collect(join(ROOT, 'data/units'));

const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 256 });
const typeIds = new Map<string, number>();
for (const [id, u] of Object.entries(units)) typeIds.set(id, sim.addUnitType(u as never));
const nameOf = new Map<number, string>([...typeIds].map(([id, t]) => [t, id]));

const runtime = new MissionRuntime(sim, mission, {
  typeIdOf: (u: string) => {
    const t = typeIds.get(u);
    if (t === undefined) throw new Error(`unknown unit ${u}`);
    return t;
  },
  markers: map.markers as never,
  zones: map.zones as never,
  unitInfo: (u: string) => (units[u] ?? null) as never,
});
runtime.start();

const T = (v: number) => (v / 65536).toFixed(1);
const SIDES = ['player', 'enemy', 'civilian'];

function report(): void {
  const bySide: string[][] = [[], [], []];
  for (let i = 0; i < sim.state.alive.length; i++) {
    if (sim.state.alive[i] !== 1) continue;
    const carried = sim.state.carriedBy[i];
    const pax = sim.passengerCount(i);
    const bits = [`${nameOf.get(sim.state.typeIdx[i]) ?? '?'}#${i}`, `(${T(sim.state.posX[i])},${T(sim.state.posY[i])})`];
    if (carried >= 0) bits.push(`aboard#${carried}`);
    if (pax > 0) bits.push(`carrying=${pax}`);
    if (sim.state.hp[i] !== undefined) bits.push(`hp=${T(sim.state.hp[i])}`);
    bySide[sim.state.side[i]]?.push(bits.join(' '));
  }
  for (let s = 0; s < 3; s++) {
    if (bySide[s].length === 0) continue;
    console.log(`  ${SIDES[s]}:`);
    for (const row of bySide[s]) console.log(`    ${row}`);
  }
}

for (const at of seconds) {
  while (sim.tickCount < at * TICKS_PER_SECOND) runtime.step(sim.tick());
  console.log(`t=${at}s  (tick ${sim.tickCount})`);
  report();
}
