// E6 G-NUM probe for `swarm.hit_mult` (GH-274 N2, N11 and the spec's `airDefence` claims).
// REPORT-ONLY: it prints, it claims nothing, and it exits 0. The value that lands in
// data/units/enemy/drone_swarm.json is the lead's call (E6 spec §10, G-NUM).
//
// Two sections, each at several hit_mult values (1 = today, the unit authors none):
//   N11  a lone shooter 4 tiles from a stationary, unarmed swarm: time to take all 12 members.
//   arms one swarm dives on a halted KDF group (2 inf_squad + apc_eitan): no AA fire, ordinary
//        fire (rifles + the Eitan's MG), and ordinary fire plus an aa_remetz beam.
//        Members spent = dives made before the swarm died.
//
// Run: pnpm --filter @lions/tools e6:swarm-probe [-- --seeds=30]

import { Sim, fx, TICKS_PER_SECOND, type UnitTypeJson } from '@lions/sim';
import { units } from './harness';

const SEEDS = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 30);
export const HIT_MULTS: readonly (number | undefined)[] = [undefined, 0.3, 0.15, 0.08, 0.05];
const WEST = 32768;
const X = (n: number) => fx.from(n);

type Json = UnitTypeJson & { swarm?: { count: number; member_hp: number; spread_tiles: number; hit_mult?: number } };

/** The shipped swarm with `hit_mult` replaced (undefined = absent, i.e. 1). */
export function swarmWith(hit: number | undefined, armed = true): UnitTypeJson {
  const base = units.drone_swarm as unknown as Json;
  const { hit_mult: _drop, ...rest } = base.swarm!;
  void _drop;
  // Unarmed means the N11 target dummy: it must also stay put (an unarmed unit withdraws from fire).
  const mobility = armed ? base.mobility : { ...base.mobility, speed_tiles_s: 0.0001 };
  return { ...base, mobility, weapons: armed ? base.weapons : [], swarm: hit === undefined ? rest : { ...rest, hit_mult: hit } } as UnitTypeJson;
}

// --- N11: one shooter at 4 tiles vs a stationary swarm that cannot hurt it -------------------
export function killSeconds(shooterId: 'apc_eitan' | 'inf_squad' | 'aa_remetz', hit: number | undefined, seed: number, capS = 400): number | null {
  const sim = new Sim({ seed, width: 24, height: 16, capacity: 4 });
  const sw = sim.addUnitType(swarmWith(hit, false));
  const sh = sim.addUnitType(units[shooterId]);
  const s = sim.spawn(sw, 1, X(12.5), X(8.5));
  sim.spawn(sh, 0, X(8.5), X(8.5));
  for (let t = 0; t < capS * TICKS_PER_SECOND; t++) {
    sim.identifyTo(0, s);
    sim.tick();
    if (sim.state.alive[s] === 0) return t / TICKS_PER_SECOND;
  }
  return null;
}

// --- arms ----------------------------------------------------------------------------------------
export type Arm = 'none' | 'fire' | 'fire+beam' | 'beam-alone';
export interface ArmRun {
  dives: number;
  killed: boolean;
  secondsToKill: number | null;
  hpLost: number;
  groupLost: number;
  beamDown: boolean;
}

export function armRun(arm: Arm, hit: number | undefined, seed: number, capS = 300): ArmRun {
  const sim = new Sim({ seed, width: 40, height: 20, capacity: 12 });
  const sw = sim.addUnitType(swarmWith(hit));
  const disarm = (u: UnitTypeJson, id: string): UnitTypeJson => ({ ...u, id, weapons: [] });
  const squad = sim.addUnitType(arm === 'none' ? disarm(units.inf_squad, 'inf_squad_cold') : units.inf_squad);
  const eitan = sim.addUnitType(arm === 'none' ? disarm(units.apc_eitan, 'apc_eitan_cold') : units.apc_eitan);
  const escort = arm !== 'beam-alone';
  const group = escort
    ? [
        sim.spawn(squad, 0, X(24.5), X(9.5), WEST),
        sim.spawn(squad, 0, X(24.5), X(11.5), WEST),
        sim.spawn(eitan, 0, X(26.5), X(10.5), WEST),
      ]
    : [];
  let beam = -1;
  if (arm === 'fire+beam' || arm === 'beam-alone') {
    beam = sim.spawn(sim.addUnitType(units.aa_remetz), 0, X(26.5), arm === 'beam-alone' ? X(10.5) : X(13.5), WEST);
    group.push(beam);
  }
  const hp0 = group.map((i) => fx.toNumber(sim.state.hp[i]));
  const s = sim.spawn(sw, 1, X(6.5), X(10.5));
  sim.queueCommand({ kind: 'attackMove', ids: [s], x: X(25), y: X(10.5) });
  let dives = 0;
  let t = 0;
  for (; t < capS * TICKS_PER_SECOND; t++) {
    for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === s) dives++;
    if (sim.state.alive[s] === 0) break;
  }
  const killed = sim.state.alive[s] === 0 && dives < 12;
  const hpLost = group.reduce((a, i, k) => a + (hp0[k] - (sim.state.alive[i] === 1 ? fx.toNumber(sim.state.hp[i]) : 0)), 0);
  return {
    dives,
    killed,
    secondsToKill: killed ? t / TICKS_PER_SECOND : null,
    hpLost,
    groupLost: group.filter((i) => sim.state.alive[i] === 0).length,
    beamDown: beam >= 0 && (sim.state.alive[beam] === 0 || sim.state.firepowerKilled[beam] === 1),
  };
}

const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs: number[]) => (xs.length === 0 ? NaN : [...xs].sort((a, b) => a - b)[xs.length >> 1]);
const label = (h: number | undefined) => (h === undefined ? '1 (today)' : String(h));

function main(): void {
  console.log(`E6 swarm hit_mult probe, ${SEEDS} seeds per cell. Report-only.\n`);
  console.log('N11: full-swarm kill time, shooter 4 tiles from a stationary unarmed swarm (spec: MG ~65 s, rifle squad ~90 s at 0.08)');
  console.log('hit_mult    | apc_eitan MG: median s (killed/seeds)  | inf_squad rifles: median s (killed/seeds)');
  for (const h of HIT_MULTS) {
    const cell = (id: 'apc_eitan' | 'inf_squad') => {
      const r = Array.from({ length: SEEDS }, (_, k) => killSeconds(id, h, 7000 + k));
      const ok = r.filter((x): x is number => x !== null);
      return `${median(ok).toFixed(1).padStart(6)} (${ok.length}/${SEEDS})`;
    };
    console.log(`${label(h).padEnd(11)} | ${cell('apc_eitan').padEnd(38)} | ${cell('inf_squad')}`);
  }
  const beam = Array.from({ length: SEEDS }, (_, k) => killSeconds('aa_remetz', undefined, 7000 + k)).filter((x): x is number => x !== null);
  console.log(`N10 for scale: aa_remetz beam on the same stationary swarm (no smoke, carrier halted; hit_mult does not touch it): median ${median(beam).toFixed(1)} s (${beam.length}/${SEEDS}); spec 24 s uninterrupted`);
  console.log('\nairDefence arms: one swarm dives on 2 inf_squad + apc_eitan, halted (members spent = dives; 12 = unopposed)');
  console.log('hit_mult    arm        | dives mean | swarm dead before half spent | dead at all | group hp lost | group lost | beam out');
  for (const h of HIT_MULTS) {
    for (const arm of ['none', 'fire', 'fire+beam', 'beam-alone'] as const) {
      const runs = Array.from({ length: SEEDS }, (_, k) => armRun(arm, h, 9000 + k));
      const half = runs.filter((r) => r.killed && r.dives < 6).length;
      const dead = runs.filter((r) => r.killed).length;
      console.log(
        `${label(h).padEnd(11)} ${arm.padEnd(10)} | ${mean(runs.map((r) => r.dives)).toFixed(1).padStart(10)} | ` +
          `${String(Math.round((100 * half) / SEEDS) + '%').padStart(28)} | ${String(Math.round((100 * dead) / SEEDS) + '%').padStart(11)} | ` +
          `${mean(runs.map((r) => r.hpLost)).toFixed(0).padStart(13)} | ${mean(runs.map((r) => r.groupLost)).toFixed(2).padStart(10)} | ` +
          `${String(Math.round((100 * runs.filter((r) => r.beamDown).length) / SEEDS) + '%').padStart(8)}`
      );
    }
  }
}

if (process.argv[1]?.endsWith('e6-swarm-probe.ts')) main();
