// Report-only: is a one-man sandbag post too strong against rifles? (GH-66 field
// works, 2026-10-15.) NOT a gate -- it has no passing band, and the post is not a
// shipped structure type yet, so its numbers are declared here, from the field-works
// proposal (`_coord/field-works/proposal.md` §3.4), not read from data/structures.json.
//
//   pnpm --filter @lions/tools exec tsx src/backtest/sandbag-post-probe.ts
//
// Why it exists: on the blockout mock (probe P1) a squad garrisoned in the post killed a
// militia cell 6 tiles out and the cell never fired back -- a garrisoned unit is not a
// direct-fire target, and its building is shot only once an occupant is identified. A
// post has 240 HP and `STRUCT_DAMAGE` small arms is 0.01, so if rifles cannot open it the
// post is a pillbox. This prints the same fight in five postures, side by side:
//
//   post        one inf_squad garrisoned in the 1x1 sandbag post
//   wall        the same squad in the open, behind a 3-tile shipped `wall` run (sc 2)
//   hesco       behind a 3-tile shipped `hesco` run (sc 3)
//   house       garrisoned in a 2x2 shipped `house` (garrison_cover 3)
//   open        in the open on bare ground
//
// against N militia_cell attack-moving through it, from 9 tiles east to 3 tiles west (N = 1, 3), and once
// against 1 rpg_team (does HE open the post?). 20 seeds x 120 s each.
import { Sim, fx, TICKS_PER_SECOND } from '@lions/sim';
import { structures } from '@lions/data';
import { units } from './harness';

type StructJson = Parameters<Sim['addStructureType']>[0];

/** The proposal's numbers (§3, table), not shipped. */
const SANDBAG_POST: StructJson = {
  id: 'sandbag_post',
  name: 'Sandbag Position',
  symbol: 'q',
  hp_per_tile: 240,
  garrison_slots: 1,
  garrison_cover: 2,
  floors: 1,
  rubble_cover: 1,
  height_px: 0,
  roe_penalty: 0,
  per_tile: true,
  low_profile: true,
  standing_cover: 2,
} as StructJson;

const W = 40;
const H = 24;
const WEST = fx.from(0.5);
const DX = 20; // defender column
const DY = 12; // defender row

type Posture = 'post' | 'wall' | 'hesco' | 'house' | 'open';
type Attacker = 'militia_cell' | 'rpg_team';

interface Result {
  held: boolean;
  killed: number;
  defShots: number;
  attShots: number;
  attShotsAtStructure: number;
  structHpLost: number;
  defenderDiedAt: number;
}

function fight(posture: Posture, attacker: Attacker, n: number, seed: number): Result {
  const sim = new Sim({ seed, width: W, height: H, capacity: 32 });
  const inf = sim.addUnitType(units.inf_squad);
  const att = sim.addUnitType(units[attacker]);
  let s = -1;
  let maxHp = 0;
  if (posture === 'post') {
    const t = sim.addStructureType(SANDBAG_POST);
    s = sim.addStructure(t, [DY * W + DX]);
  } else if (posture === 'house') {
    const t = sim.addStructureType(structures.house as StructJson);
    s = sim.addStructure(t, [DY * W + DX, DY * W + DX + 1, (DY + 1) * W + DX, (DY + 1) * W + DX + 1]);
  } else if (posture === 'wall' || posture === 'hesco') {
    // A short north-south run one tile east of the squad, facing the attack.
    const t = sim.addStructureType(structures[posture] as StructJson);
    for (const y of [DY - 1, DY, DY + 1]) sim.addStructure(t, [y * W + DX + 1]);
  }
  const def = sim.spawn(inf, 0, fx.from(DX - (posture === 'post' || posture === 'house' ? 1 : 0) + 0.5), fx.from(DY + 0.5));
  if (s >= 0) {
    maxHp = sim.structures.hp[s];
    sim.queueCommand({ kind: 'garrison', ids: [def], structure: s });
    for (let k = 0; k < 200 && sim.state.garrisonedIn[def] !== s; k++) sim.tick();
    if (sim.state.garrisonedIn[def] !== s) throw new Error(`${posture}: the squad never got in`);
  }
  const atts: number[] = [];
  for (let i = 0; i < n; i++) atts.push(sim.spawn(att, 1, fx.from(DX + 9.5), fx.from(DY - 1 + i + 0.5), WEST));
  // At the defender's own ground, west of any run, so the attackers have to come round or through.
  sim.queueCommand({ kind: 'attackMove', ids: atts, x: fx.from(DX - 2.5), y: fx.from(DY + 0.5) });
  let defShots = 0;
  let attShots = 0;
  let attShotsAtStructure = 0;
  let diedAt = -1;
  const end = 120 * TICKS_PER_SECOND;
  for (let k = 0; k < end; k++) {
    for (const e of sim.tick()) {
      if (e.kind !== 'fire') continue;
      if (e.shooter === def) defShots++;
      else if (atts.includes(e.shooter)) {
        attShots++;
        if (e.target === -1) attShotsAtStructure++;
      }
    }
    if (diedAt < 0 && sim.state.alive[def] !== 1) diedAt = k / TICKS_PER_SECOND;
    if ((k & 31) === 0 && atts.every((a) => sim.state.alive[a] !== 1)) break;
  }
  return {
    held: sim.state.alive[def] === 1,
    killed: atts.filter((a) => sim.state.alive[a] !== 1).length,
    defShots,
    attShots,
    attShotsAtStructure,
    structHpLost: s >= 0 && maxHp > 0 ? 1 - Math.max(0, sim.structures.hp[s]) / maxHp : 0,
    defenderDiedAt: diedAt,
  };
}

const SEEDS = 20;
const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;

function row(posture: Posture, attacker: Attacker, n: number): void {
  const r = Array.from({ length: SEEDS }, (_, i) => fight(posture, attacker, n, 7100 + i));
  const deaths = r.filter((x) => x.defenderDiedAt >= 0).map((x) => x.defenderDiedAt);
  console.log(
    `${posture.padEnd(6)} vs ${n} ${attacker.padEnd(12)} held ${String(r.filter((x) => x.held).length).padStart(2)}/${SEEDS}` +
      `  killed ${mean(r.map((x) => x.killed)).toFixed(2)}/${n}` +
      `  def shots ${mean(r.map((x) => x.defShots)).toFixed(0).padStart(3)}` +
      `  att shots ${mean(r.map((x) => x.attShots)).toFixed(0).padStart(3)} (at structure ${mean(r.map((x) => x.attShotsAtStructure)).toFixed(0)})` +
      `  structure HP lost ${(100 * mean(r.map((x) => x.structHpLost))).toFixed(0)}%` +
      (deaths.length ? `  defender died at ${mean(deaths).toFixed(0)} s mean` : '')
  );
}

console.log(`sandbag post probe (report-only), ${SEEDS} seeds x 120 s, attackers start 9 tiles east`);
for (const n of [1, 3]) {
  for (const p of ['post', 'wall', 'hesco', 'house', 'open'] as const) row(p, 'militia_cell', n);
  console.log('');
}
for (const p of ['post', 'wall', 'house'] as const) row(p, 'rpg_team', 1);
