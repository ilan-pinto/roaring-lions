// Report-only: is a one-man sandbag post too strong against rifles? (GH-66 field
// works, 2026-10-15.) NOT a gate -- it has no passing band. The shipped post is read
// from data/structures.json (`sandbag_post`: 120 HP, garrison_cover 1, the
// coordinator's ruling); the first proposal's numbers (240 HP, garrison_cover 2) stay
// declared here as `post240`, so the two sit side by side.
//
//   pnpm --filter @lions/tools exec tsx src/backtest/sandbag-post-probe.ts
//
// Why it exists: on the blockout mock (probe P1) a squad garrisoned in the post killed a
// militia cell 6 tiles out and the cell never fired back -- a garrisoned unit is not a
// direct-fire target, and its building is shot only once an occupant is identified. A
// post has 240 HP and `STRUCT_DAMAGE` small arms is 0.01, so if rifles cannot open it the
// post is a pillbox. This prints the same fight in seven postures, side by side:
//
//   post        one inf_squad garrisoned in the shipped 1x1 sandbag post
//   post240     the same in the first proposal's post (240 HP, garrison_cover 2)
//   sandbags    in the open, behind a 3-tile shipped `sandbag_wall` run (sc 2)
//   wall        the same squad in the open, behind a 3-tile shipped `wall` run (sc 2)
//   hesco       behind a 3-tile shipped `hesco` run (sc 3)
//   house       garrisoned in a 2x2 shipped `house` (garrison_cover 3)
//   open        in the open on bare ground
//
// against N militia_cell attack-moving through it, from 9 tiles east to 3 tiles west (N = 1, 3), and once
// against 1 rpg_team (does HE open the post?). 20 seeds x 120 s each.
//
// What it read on 2026-10-15 (art/field-works-2), 20 seeds each:
//   vs 3 militia_cell  post240 held 20/20, post HP lost 5%: a house (house 20/20, 1%).
//                      post    held  8/20, post HP lost 99%, died at 116 s mean. At
//                              garrison_cover 1 the occupant is pinned and spotted, the
//                              cells keep firing at the post (2,251 rounds against 239),
//                              and 0.01 small-arms structure damage takes 120 HP in two
//                              minutes. No longer a house; still the best open-ground
//                              posture (wall, sandbags, HESCO: 0/20, dead at 36 s).
//   vs 1 rpg_team      post    held 15/20. Its mean 25% HP lost is five runs of 100%:
//                              one rocket that lands levels a 120 HP post, and the
//                              collapse kills the squad inside.
import { Sim, fx, TICKS_PER_SECOND } from '@lions/sim';
import { structures } from '@lions/data';
import { units } from './harness';

type StructJson = Parameters<Sim['addStructureType']>[0];

/** The first proposal's numbers (240 HP, garrison_cover 2), never shipped. */
const SANDBAG_POST_PROPOSED: StructJson = {
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

type Posture = 'post' | 'post240' | 'wall' | 'sandbags' | 'hesco' | 'house' | 'open';
type Attacker = 'militia_cell' | 'rpg_team';

interface Result {
  held: boolean;
  killed: number;
  defShots: number;
  attShots: number;
  attShotsAtStructure: number;
  structHpLost: number;
  defenderDiedAt: number;
  /** The squad was outside its building (broken out, or never back) while alive. */
  leftCover: boolean;
}

function fight(posture: Posture, attacker: Attacker, n: number, seed: number): Result {
  const sim = new Sim({ seed, width: W, height: H, capacity: 32 });
  const inf = sim.addUnitType(units.inf_squad);
  const att = sim.addUnitType(units[attacker]);
  let s = -1;
  let maxHp = 0;
  if (posture === 'post' || posture === 'post240') {
    const t = sim.addStructureType(posture === 'post' ? (structures.sandbag_post as StructJson) : SANDBAG_POST_PROPOSED);
    s = sim.addStructure(t, [DY * W + DX]);
  } else if (posture === 'house') {
    const t = sim.addStructureType(structures.house as StructJson);
    s = sim.addStructure(t, [DY * W + DX, DY * W + DX + 1, (DY + 1) * W + DX, (DY + 1) * W + DX + 1]);
  } else if (posture === 'wall' || posture === 'hesco' || posture === 'sandbags') {
    // A short north-south run one tile east of the squad, facing the attack.
    const t = sim.addStructureType(structures[posture === 'sandbags' ? 'sandbag_wall' : posture] as StructJson);
    for (const y of [DY - 1, DY, DY + 1]) sim.addStructure(t, [y * W + DX + 1]);
  }
  const def = sim.spawn(inf, 0, fx.from(DX - (posture === 'post' || posture === 'post240' || posture === 'house' ? 1 : 0) + 0.5), fx.from(DY + 0.5));
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
  let leftCover = false;
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
    if (s >= 0 && sim.state.alive[def] === 1 && sim.state.garrisonedIn[def] !== s) leftCover = true;
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
    leftCover,
  };
}

const SEEDS = 20;
const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;

function row(posture: Posture, attacker: Attacker, n: number): void {
  const r = Array.from({ length: SEEDS }, (_, i) => fight(posture, attacker, n, 7100 + i));
  const deaths = r.filter((x) => x.defenderDiedAt >= 0).map((x) => x.defenderDiedAt);
  console.log(
    `${posture.padEnd(8)} vs ${n} ${attacker.padEnd(12)} held ${String(r.filter((x) => x.held).length).padStart(2)}/${SEEDS}` +
      `  killed ${mean(r.map((x) => x.killed)).toFixed(2)}/${n}` +
      `  def shots ${mean(r.map((x) => x.defShots)).toFixed(0).padStart(3)}` +
      `  att shots ${mean(r.map((x) => x.attShots)).toFixed(0).padStart(3)} (at structure ${mean(r.map((x) => x.attShotsAtStructure)).toFixed(0)})` +
      `  structure HP lost ${(100 * mean(r.map((x) => x.structHpLost))).toFixed(0)}%` +
      (deaths.length ? `  defender died at ${mean(deaths).toFixed(0)} s mean` : '') +
      (r.some((x) => x.leftCover) ? `  left its building alive in ${r.filter((x) => x.leftCover).length}/${SEEDS}` : '')
  );
}

console.log(`sandbag post probe (report-only), ${SEEDS} seeds x 120 s, attackers start 9 tiles east`);
for (const n of [1, 3]) {
  for (const p of ['post', 'post240', 'wall', 'sandbags', 'hesco', 'house', 'open'] as const) row(p, 'militia_cell', n);
  console.log('');
}
for (const p of ['post', 'post240', 'wall', 'house'] as const) row(p, 'rpg_team', 1);
