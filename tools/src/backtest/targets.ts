// The four GDD §5.7 measurements. Each builds real engagements from the
// shipped roster and measures probabilities the way a range card would.

import { Sim, fx, TICKS_PER_SECOND } from '@lions/sim';
import { MBT_BARE, countAlive, mean, runBattle, units, type TargetResult } from './harness';

const WEST = 32768;

// ---------------------------------------------------------------------------
// 1. ATGM Pk vs unprotected armour ≈ 0.7
//    One Spike launch at a stationary bare MBT (frontal aspect, 5 tiles,
//    open ground). Pk = P(hit AND penetrate) per launch.
// ---------------------------------------------------------------------------
export function atgmPk(samples = 400): TargetResult {
  let launches = 0;
  let kills = 0;
  for (let s = 0; s < samples; s++) {
    const sim = new Sim({ seed: 41000 + s, width: 24, height: 8, capacity: 4 });
    const at = sim.addUnitType(units.at_team);
    const tank = sim.addUnitType(MBT_BARE);
    sim.spawn(at, 0, fx.from(2.5), fx.from(4.5));
    sim.spawn(tank, 1, fx.from(7.5), fx.from(4.5), WEST); // facing its attacker
    // Run long enough for identify + one launch + flight.
    const { events } = runBattle(sim, 30 * TICKS_PER_SECOND, true);
    const fire = events.find((e) => e.kind === 'fire' && e.shooter === 0);
    if (!fire || fire.kind !== 'fire') continue;
    launches++;
    const impact = events.find((e) => e.kind === 'impact' && e.shooter === 0);
    if (fire.willHit && impact?.kind === 'impact' && impact.penetrated) kills++;
  }
  const pk = kills / launches;
  return {
    name: 'ATGM Pk vs unprotected armour',
    detail: `${launches} launches, frontal, 5 tiles, stationary`,
    measured: pk.toFixed(2),
    target: '≈0.7 (0.60–0.80)',
    pass: pk >= 0.6 && pk <= 0.8,
  };
}

// ---------------------------------------------------------------------------
// 2. APS intercept 0.6–0.9 vs shaped charge
//    First engagement of a fresh Trophy magazine vs an inbound Spike.
// ---------------------------------------------------------------------------
export function apsIntercept(samples = 400): TargetResult {
  let attempts = 0;
  let intercepts = 0;
  for (let s = 0; s < samples; s++) {
    const sim = new Sim({ seed: 52000 + s, width: 24, height: 8, capacity: 4 });
    const at = sim.addUnitType(units.at_team);
    const tank = sim.addUnitType({ ...units.mbt_lavi, weapons: [] });
    sim.spawn(at, 0, fx.from(2.5), fx.from(4.5));
    sim.spawn(tank, 1, fx.from(7.5), fx.from(4.5), WEST);
    const { events } = runBattle(sim, 30 * TICKS_PER_SECOND, true);
    const aps = events.find((e) => e.kind === 'aps');
    if (aps?.kind !== 'aps') continue;
    attempts++;
    if (aps.intercepted) intercepts++;
  }
  const rate = intercepts / attempts;
  return {
    name: 'APS intercept vs shaped charge',
    detail: `${attempts} first-magazine engagements`,
    measured: rate.toFixed(2),
    target: '0.60–0.90',
    pass: rate >= 0.6 && rate <= 0.9,
  };
}

// ---------------------------------------------------------------------------
// 3. Urban assault needs ≈3:1 for reliable success
//    Militia garrisoned in heavy cover among buildings; KDF rifle squads
//    assault across open ground. Win = garrison cleared inside 10 minutes
//    with at least a quarter of the assault force still standing.
// ---------------------------------------------------------------------------
function urbanAssault(attackers: number, seed: number): boolean {
  const W = 40;
  const H = 28;
  const sim = new Sim({ seed, width: W, height: H, capacity: 64 });
  const inf = sim.addUnitType(units.inf_squad);
  const militia = sim.addUnitType(units.militia_cell);

  // Town: three building blocks with heavy-cover surroundings.
  const blocks: [number, number, number, number][] = [
    [28, 6, 4, 3],
    [30, 13, 4, 3],
    [28, 20, 4, 3],
  ];
  for (const [bx, by, bw, bh] of blocks) {
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) sim.setBlocked(x, y, true);
    for (let y = by - 1; y <= by + bh; y++) {
      for (let x = bx - 1; x <= bx + bw; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H && sim.blocked[y * W + x] === 0) sim.setCover(x, y, 2);
      }
    }
  }

  const defenders = 6;
  const defSpots: [number, number][] = [
    [27.5, 7.5],
    [30.5, 9.5],
    [29.5, 14.5],
    [34.5, 15.5],
    [27.5, 21.5],
    [31.5, 23.5],
  ];
  for (let d = 0; d < defenders; d++) {
    sim.spawn(militia, 1, fx.from(defSpots[d][0]), fx.from(defSpots[d][1]), WEST);
  }

  // A clearing plan, not a blob: three assault groups, one per block, so the
  // measurement is the combat model rather than sweep AI that M0 lacks.
  const groups: number[][] = [[], [], []];
  for (let a = 0; a < attackers; a++) {
    const row = 3 + (a % 11) * 2;
    const col = 2.5 + Math.floor(a / 11) * 1.5;
    groups[a % 3].push(sim.spawn(inf, 0, fx.from(col), fx.from(row)));
  }
  // Sweep objectives BEYOND each block: groups clear the west face, push
  // around the building, and meet whatever holds the east face.
  const objectives: [number, number][] = [
    [36, 7],
    [36, 15],
    [35, 24],
  ];
  for (let gi = 0; gi < 3; gi++) {
    sim.queueCommand({ kind: 'attackMove', ids: groups[gi], x: fx.fromInt(objectives[gi][0]), y: fx.fromInt(objectives[gi][1]) });
  }

  // Consolidation: every 120 s the commander re-tasks all survivors onto the
  // next objective in the cycle, so a cleared town cannot stalemate on one
  // hidden position. The 5-minute ceiling is the operational clock — success
  // means the assault carries, not that waves grind the town down all day.
  const maxTicks = 300 * TICKS_PER_SECOND;
  let wave = 0;
  for (let t = 0; t < maxTicks; t++) {
    if (t > 0 && t % (120 * TICKS_PER_SECOND) === 0) {
      const survivors: number[] = [];
      for (const g of groups) for (const id of g) if (sim.state.alive[id] === 1) survivors.push(id);
      const obj = objectives[wave % 3];
      wave++;
      if (survivors.length > 0) {
        sim.queueCommand({ kind: 'attackMove', ids: survivors, x: fx.fromInt(obj[0]), y: fx.fromInt(obj[1]) });
      }
    }
    sim.tick();
    if ((t & 31) === 0) {
      const alive = countAlive(sim);
      if (alive[0] === 0 || alive[1] === 0) break;
    }
  }
  const alive = countAlive(sim);
  return alive[1] === 0 && alive[0] >= Math.ceil(attackers * 0.25);
}

export function urbanRatio(seedsPerRatio = 20): TargetResult {
  const defenders = 6;
  const rates: Record<string, number> = {};
  for (const ratio of [1, 2, 3, 4]) {
    let wins = 0;
    for (let s = 0; s < seedsPerRatio; s++) {
      if (urbanAssault(defenders * ratio, 60000 + ratio * 1000 + s)) wins++;
    }
    rates[`${ratio}:1`] = wins / seedsPerRatio;
  }
  const detail = Object.entries(rates)
    .map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`)
    .join(' ');
  const pass = rates['1:1'] <= 0.25 && rates['2:1'] <= 0.6 && rates['3:1'] >= 0.65 && rates['4:1'] >= rates['3:1'] - 0.1;
  return {
    name: 'Urban assault force ratio',
    detail: `win rates by attacker:defender — ${detail}`,
    measured: `3:1 → ${(rates['3:1'] * 100).toFixed(0)}%`,
    target: '1:1 fails, 3:1 reliable (≥65%)',
    pass,
  };
}

// ---------------------------------------------------------------------------
// 4. Lanchester's square law emerges
//    Identical rifle squads, open ground, aimed fire. Concentration must win
//    superlinearly: survivors of the doubled force ≈ sqrt(A² − B²), clearly
//    above the linear-law prediction A − B.
// ---------------------------------------------------------------------------
function openFight(a: number, b: number, seed: number): number {
  const sim = new Sim({ seed, width: 36, height: 32, capacity: 64 });
  const inf = sim.addUnitType(units.inf_squad);
  const idsA: number[] = [];
  const idsB: number[] = [];
  for (let i = 0; i < a; i++) {
    idsA.push(sim.spawn(inf, 0, fx.from(8.5 + (i % 2)), fx.from(6.5 + i * 1.5)));
  }
  for (let i = 0; i < b; i++) {
    idsB.push(sim.spawn(inf, 1, fx.from(26.5 + (i % 2)), fx.from(9.5 + i * 2.2), WEST));
  }
  sim.queueCommand({ kind: 'attackMove', ids: idsA, x: fx.fromInt(27), y: fx.fromInt(15) });
  sim.queueCommand({ kind: 'attackMove', ids: idsB, x: fx.fromInt(9), y: fx.fromInt(15) });
  const { alive } = runBattle(sim, 600 * TICKS_PER_SECOND);
  return alive[1] === 0 ? alive[0] : 0; // survivors of A when B wiped, else 0
}

export function lanchester(seeds = 20): TargetResult {
  const cases: [number, number][] = [
    [12, 6],
    [16, 8],
  ];
  const details: string[] = [];
  let pass = true;
  for (const [a, b] of cases) {
    const survivors = [];
    for (let s = 0; s < seeds; s++) survivors.push(openFight(a, b, 70000 + a * 100 + s));
    const m = mean(survivors);
    const square = Math.sqrt(a * a - b * b);
    const linear = a - b;
    const threshold = linear + 0.55 * (square - linear); // decisively closer to square law
    details.push(`${a}v${b}: mean survivors ${m.toFixed(1)} (linear ${linear}, square ${square.toFixed(1)})`);
    if (m < threshold) pass = false;
  }
  return {
    name: 'Lanchester square law',
    detail: details.join(' · '),
    measured: 'see detail',
    target: 'survivors ≫ linear-law prediction',
    pass,
  };
}

// ---------------------------------------------------------------------------
// 5. Air is contested, not free
//    A gunship over an AA-covered position must be in a real fight. The whole
//    of the Apache's counterplay design is the Hellfire's 9.0 effective range
//    against the gun truck's 8.5 effective / 11 reach: the helicopter can open
//    from beyond the ZU-23's useful range, but never from outside its reach, so
//    the exchange turns on who fires first rather than on who outranges whom.
//
//    This target exists because nothing else here measures air at all. The
//    other four scenarios spawn only inf_squad and militia_cell, so before this
//    the whole domain -- and both units that use it -- could not move a single
//    number in `pnpm balance`. A gunship that always wins means the AA is
//    decoration; one that always dies means the airframe is not worth its cost.
// ---------------------------------------------------------------------------
function gunshipDuel(seed: number, standoffTiles: number): boolean {
  const sim = new Sim({ seed, width: 32, height: 12, capacity: 4 });
  const heli = sim.addUnitType(units.heli_peten);
  const aa = sim.addUnitType(units.gun_truck);
  // Both start nose-on and aware-capable; the standoff is the variable.
  sim.spawn(heli, 0, fx.from(4.5), fx.from(6.5));
  sim.spawn(aa, 1, fx.from(4.5 + standoffTiles), fx.from(6.5), WEST);
  const { alive } = runBattle(sim, 90 * TICKS_PER_SECOND);
  return alive[0] > 0 && alive[1] === 0; // gunship won outright
}

export function airContested(seedsPerRange = 40): TargetResult {
  // Inside the ZU-23's effective range, at the Hellfire's effective range, and
  // at the edge of the ZU-23's reach.
  const ranges = [6, 9, 11];
  const rates: Record<string, number> = {};
  for (const r of ranges) {
    let wins = 0;
    for (let s = 0; s < seedsPerRange; s++) if (gunshipDuel(88000 + r * 1000 + s, r)) wins++;
    rates[`${r}t`] = wins / seedsPerRange;
  }
  const detail = Object.entries(rates)
    .map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`)
    .join(' ');
  const at9 = rates['9t'];
  // Contested at the design range: neither a free kill nor a free loss.
  const pass = at9 >= 0.25 && at9 <= 0.85 && rates['6t'] <= rates['9t'];
  return {
    name: 'Air is contested by AA',
    detail: `gunship win rate vs one ZU-23 truck by standoff — ${detail}`,
    measured: `9 tiles → ${(at9 * 100).toFixed(0)}%`,
    target: 'contested at the Hellfire\'s 9t (25–85%), and worse when closer',
    pass,
  };
}
