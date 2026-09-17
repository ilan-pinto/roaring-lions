// Backtest harness plumbing: build headless engagements from the real
// data/units roster, batch-run them across seeds, and measure outcomes.
// This is where the combat model is held against GDD §5.7.

import { Sim, type SimEvent, type UnitTypeJson } from '@lions/sim';
import { units as baseUnits, applyUpgrades, maxTiers } from '@lions/data';

type Roster = typeof baseUnits;

/** Every KDF entry in the shipped roster, patched to its own maximum tiers --
 *  the same pre-pass `main.ts` runs for a bought tier (`applyUpgrades(u, ownedTiers[u.id]
 *  ?? {})`), maxed rather than owned. Enemy (non-kdf) entries are untouched, matching
 *  `main.ts` and `playtest.ts`'s own `tiers: 'max'` pass exactly. Used by `cli.ts`'s
 *  second table. */
export const unitsAtMaxTier: Roster = Object.fromEntries(
  Object.entries(baseUnits).map(([id, u]) => [
    id,
    u.faction === 'kdf' ? applyUpgrades(u, maxTiers(u)) : u,
  ])
) as Roster;

/** Live module bindings, mutable only through `withRoster` below -- every target
 *  function in `targets.ts` reads these two by name (`units.at_team`, `MBT_BARE`,
 *  …) rather than taking a roster parameter, so ES module live bindings are what
 *  let `withRoster` redirect every one of them for the duration of a callback with
 *  no change to `targets.ts` itself. */
export let units: Roster = baseUnits;

function deriveBare(roster: Roster): UnitTypeJson {
  return {
    ...roster.mbt_lavi,
    id: 'mbt_bare',
    hull: { ...roster.mbt_lavi.hull, aps: undefined },
    weapons: [],
  };
}

/** MBT with the Trophy removed — the "unprotected armour" target. Re-derived from
 *  whichever roster is currently active (see `withRoster`), so a max-tier pass
 *  measures the max-tier Lavi's hull, not the base one. */
export let MBT_BARE: UnitTypeJson = deriveBare(units);

/** Runs `fn` with `units`/`MBT_BARE` swapped to `roster` for its duration, restoring
 *  the base roster afterward regardless of outcome (including a thrown target
 *  failure) -- so the CLI's two tables never bleed into each other and a later
 *  caller never inherits a roster some earlier call forgot to restore. */
export function withRoster<T>(roster: Roster, fn: () => T): T {
  const prevUnits = units;
  const prevBare = MBT_BARE;
  units = roster;
  MBT_BARE = deriveBare(roster);
  try {
    return fn();
  } finally {
    units = prevUnits;
    MBT_BARE = prevBare;
  }
}

export interface BattleResult {
  ticks: number;
  alive: [number, number];
  events: SimEvent[];
}

export function countAlive(sim: Sim): [number, number] {
  const alive: [number, number] = [0, 0];
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] === 1) alive[sim.state.side[i]]++;
  }
  return alive;
}

/** Run until one side is wiped out or maxTicks pass. */
export function runBattle(sim: Sim, maxTicks: number, collectEvents = false): BattleResult {
  const events: SimEvent[] = [];
  let t = 0;
  for (; t < maxTicks; t++) {
    const evs = sim.tick();
    if (collectEvents) events.push(...evs);
    if ((t & 31) === 0) {
      const alive = countAlive(sim);
      if (alive[0] === 0 || alive[1] === 0) break;
    }
  }
  return { ticks: t, alive: countAlive(sim), events };
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export interface TargetResult {
  name: string;
  detail: string;
  measured: string;
  target: string;
  pass: boolean;
}

/** `label` names which roster this table measured ('base' or 'max tier') --
 *  `cli.ts` runs the five targets twice, and a table with no label would leave a
 *  reader unable to tell the two apart in one scrollback. */
export function report(results: TargetResult[], label = 'base'): boolean {
  const w = Math.max(...results.map((r) => r.name.length)) + 2;
  console.log('');
  console.log(`GDD §5.7 validation targets — ${label}`);
  console.log('─'.repeat(78));
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(`${status}  ${r.name.padEnd(w)} measured ${r.measured}  (target ${r.target})`);
    console.log(`      ${' '.repeat(w)}${r.detail}`);
  }
  console.log('─'.repeat(78));
  const ok = results.every((r) => r.pass);
  console.log(
    ok ? `backtest (${label}): all targets met` : `backtest (${label}): TARGETS MISSED — the model is wrong (GDD §5.7)`
  );
  return ok;
}
