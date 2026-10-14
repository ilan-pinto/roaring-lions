// Report-only garrison measurements (garrison overhaul, 2026-10-14). Not a gate: neither has a
// passing band yet (L-4). Run: pnpm --filter @lions/tools exec tsx src/backtest/garrison-probes.ts
//
// 1. The #280 raid: 8 militia_cell attack-move on 2 inf_squad inside a 2x2 house, 20 seeds x
//    120 s. On main 7646107c the defenders were pinned 90 % of the time and killed 0.00.
// 2. The §5.7 urban town garrisoned: urbanAssault's three 4x3 blocks as real houses with two
//    militia_cell inside each, rifle squads at 1:1..4:1 plus one demo_squad per group sent at the
//    house once its group is within 10 tiles. On main it won 0 of 20 at every ratio.
import { Sim, fx, TICKS_PER_SECOND } from '@lions/sim';
import { structures } from '@lions/data';
import { units } from './harness';

const WEST = fx.from(0.5);

function raid(seed: number): { held: boolean; killed: number; defShots: number } {
  const sim = new Sim({ seed, width: 64, height: 64, capacity: 64 });
  const house = sim.addStructureType(structures.house as Parameters<typeof sim.addStructureType>[0]);
  const inf = sim.addUnitType(units.inf_squad);
  const militia = sim.addUnitType(units.militia_cell);
  const tiles = [30 * 64 + 20, 30 * 64 + 21, 31 * 64 + 20, 31 * 64 + 21];
  const s = sim.addStructure(house, tiles);
  const defs = [0, 1].map((k) => sim.spawn(inf, 0, fx.from(19.5), fx.from(30.5 + k)));
  sim.queueCommand({ kind: 'garrison', ids: defs, structure: s });
  for (let k = 0; k < 300 && defs.some((d) => sim.state.garrisonedIn[d] !== s); k++) sim.tick();
  const atts: number[] = [];
  for (let i = 0; i < 8; i++) atts.push(sim.spawn(militia, 1, fx.from(37 + (i % 2)), fx.from(28 + i), WEST));
  sim.queueCommand({ kind: 'attackMove', ids: atts, x: fx.from(22.5), y: fx.from(31) });
  let defShots = 0;
  for (let k = 0; k < 120 * TICKS_PER_SECOND; k++) {
    for (const e of sim.tick()) if (e.kind === 'fire' && defs.includes(e.shooter)) defShots++;
  }
  return {
    held: defs.some((d) => sim.state.alive[d] === 1),
    killed: atts.filter((a) => sim.state.alive[a] !== 1).length,
    defShots,
  };
}

function town(ratio: number, seed: number): { won: boolean; rifleLost: number } {
  const W = 40;
  const H = 28;
  const sim = new Sim({ seed, width: W, height: H, capacity: 64 });
  const inf = sim.addUnitType(units.inf_squad);
  const demo = sim.addUnitType(units.demo_squad);
  const militia = sim.addUnitType(units.militia_cell);
  const house = sim.addStructureType(structures.house as Parameters<typeof sim.addStructureType>[0]);
  const blocks: [number, number, number, number][] = [[28, 6, 4, 3], [30, 13, 4, 3], [28, 20, 4, 3]];
  const ids = blocks.map(([bx, by, bw, bh]) => {
    const tiles: number[] = [];
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) tiles.push(y * W + x);
    const s = sim.addStructure(house, tiles);
    for (let y = by - 1; y <= by + bh; y++) {
      for (let x = bx - 1; x <= bx + bw; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H && sim.blocked[y * W + x] === 0) sim.setCover(x, y, 2);
      }
    }
    return s;
  });
  const defs: number[] = [];
  blocks.forEach(([bx, by, bw], k) => {
    for (let j = 0; j < 2; j++) {
      const d = sim.spawn(militia, 1, fx.from(bx + bw + 0.5), fx.from(by + 0.5 + j), WEST);
      defs.push(d);
      sim.queueCommand({ kind: 'garrison', ids: [d], structure: ids[k] });
    }
  });
  for (let t = 0; t < 60; t++) sim.tick();
  const attackers = 6 * ratio;
  const groups: number[][] = [[], [], []];
  for (let a = 0; a < attackers; a++) {
    groups[a % 3].push(sim.spawn(inf, 0, fx.from(2.5 + Math.floor(a / 11) * 1.5), fx.from(3 + (a % 11) * 2)));
  }
  const objectives: [number, number][] = [[36, 7], [36, 15], [35, 24]];
  const sappers = [0, 1, 2].map((gi) => sim.spawn(demo, 0, fx.from(1.0), fx.from(6.5 + gi * 8)));
  for (let gi = 0; gi < 3; gi++) {
    const ids2 = [...groups[gi], sappers[gi]];
    sim.queueCommand({ kind: 'attackMove', ids: ids2, x: fx.fromInt(objectives[gi][0]), y: fx.fromInt(objectives[gi][1]), sweep: true });
  }
  const sent = [false, false, false];
  for (let t = 0; t < 300 * TICKS_PER_SECOND; t++) {
    if (t % 10 === 0) {
      for (let gi = 0; gi < 3; gi++) {
        if (sent[gi] || sim.state.alive[sappers[gi]] !== 1) continue;
        const [bx, by, bw, bh] = blocks[gi];
        const near = groups[gi].some(
          (a) => sim.state.alive[a] === 1 && Math.hypot(sim.state.posX[a] / 65536 - (bx + bw / 2), sim.state.posY[a] / 65536 - (by + bh / 2)) <= 10
        );
        if (near) {
          sim.queueCommand({ kind: 'demolish', ids: [sappers[gi]], structure: ids[gi] });
          sent[gi] = true;
        }
      }
    }
    sim.tick();
    if ((t & 31) === 0 && defs.every((d) => sim.state.alive[d] !== 1)) break;
  }
  const alive = groups.flat().filter((a) => sim.state.alive[a] === 1).length;
  return { won: defs.every((d) => sim.state.alive[d] !== 1) && alive >= Math.ceil(attackers * 0.25), rifleLost: attackers - alive };
}

const r = Array.from({ length: 20 }, (_, i) => raid(101 + i));
console.log(
  `#280 raid (2 inf_squad in a 2x2 house vs 8 militia, 20 seeds x 120 s): held ${r.filter((x) => x.held).length}/20, ` +
    `militia killed ${(r.reduce((a, x) => a + x.killed, 0) / 20).toFixed(2)}, defender shots ${(r.reduce((a, x) => a + x.defShots, 0) / 20).toFixed(0)}`
);
for (const ratio of [1, 2, 3, 4]) {
  const t = Array.from({ length: 20 }, (_, s) => town(ratio, 60000 + ratio * 1000 + s));
  console.log(
    `garrisoned town ${ratio}:1 (20 seeds): won ${t.filter((x) => x.won).length}/20, ` +
      `rifle squads lost ${(t.reduce((a, x) => a + x.rifleLost, 0) / 20).toFixed(1)}/${6 * ratio}`
  );
}
