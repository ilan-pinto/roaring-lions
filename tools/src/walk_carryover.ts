/**
 * Walk the carry-over spine across a real mission boundary.
 *
 *   npx tsx tools/src/walk_carryover.ts
 *
 * Why this exists. `intel.marked_positions` is a list of authored tag names, so the
 * whole mechanism turns on two JSON files agreeing about strings. A tag mission III
 * waits for that mission I never writes is invisible: the mission loads, plays the hard
 * version, and looks exactly like a fresh campaign. Every unit test builds its own
 * fixture world, so none of them can see it -- the tags in a fixture always line up,
 * because the same test wrote both halves.
 *
 * So this plays the real sweep. Mission I is driven east until its marked list stops
 * growing; mission III is then started twice, once fresh and once carrying that ledger,
 * and the two spawn states are printed side by side. A misaligned tag shows up as a row
 * that is unidentified in both columns.
 *
 * Read-only: no files are written, nothing is rendered.
 */
import { join } from 'node:path';

import { fx } from '../../packages/sim/src/fixed';
import { type LedgerData } from '../../packages/sim/src/mission';
import { TICKS_PER_SECOND } from '../../packages/sim/src/sim';
import { ROOT, idsOf, loadUnits, makeWorld, read, type MissionLike, type World } from './walk_world';

const RECON = 'beit_sahwan_1_recon';
const CLEARANCE = 'beit_sahwan_3_clearance';

/** How long to let the recon sweep run. Missions target 12-20 minutes; the sweep
 *  saturates well before that, and the loop below stops early when it does. */
const SWEEP_SECONDS = 600;

/** Waypoints west to east across the emplacements, at three latitudes. A recon that
 *  nobody drives identifies nothing, so the walk drives it the way the objective asks
 *  a player to. */
const LEGS: readonly [number, number][] = [
  [16, 20],
  [24, 14],
  [30, 24],
  [36, 22],
  [44, 24],
  [40, 34],
  [26, 37],
];

const UNITS = loadUnits();

/** The authored tag of the placement that spawned `id`, matched by position -- which is
 *  how the two mission files themselves line up. */
function tagAt(w: World, id: number): string | undefined {
  const x = fx.toNumber(w.sim.state.posX[id]!);
  const y = fx.toNumber(w.sim.state.posY[id]!);
  for (const p of w.mission.enemy?.garrison ?? []) {
    if (p.tag === undefined || p.at === undefined) continue;
    if (Math.abs(p.at[0]! - x) < 1.5 && Math.abs(p.at[1]! - y) < 1.5) return p.tag;
  }
  return undefined;
}

/** Tags whose units the player side currently holds at `identified`. */
function markedTags(w: World): string[] {
  const out = new Set<string>();
  for (const id of idsOf(w.sim, 1)) {
    const tag = tagAt(w, id);
    if (tag !== undefined && w.sim.contactLevel(0, id) >= 2) out.add(tag);
  }
  return [...out].sort();
}

/**
 * Play the recon east and return the intel it earns -- taken from the ledger the
 * mission actually produces, not from live contact state.
 *
 * The difference matters and cost an hour. Sim contact decays every tick a target is
 * unobserved, so sampling `contactLevel` at the end of a sweep reports what the force
 * can see *now* and misses everything it identified on the way in. The runtime's own
 * `identified` set is cumulative, which is the right meaning for intel: you saw it, you
 * wrote it down. Reading the produced ledger also exercises the code path that writes
 * the save file, rather than a reconstruction of it.
 */
function sweep(): string[] {
  const w = makeWorld(RECON, { units: UNITS });
  let produced: string[] | null = null;
  let ended = false;
  let leg = 0;
  let last = -1;
  let quiet = 0;

  for (let t = 0; t < SWEEP_SECONDS * TICKS_PER_SECOND && !ended; t++) {
    if (t % (45 * TICKS_PER_SECOND) === 0) {
      const [x, y] = LEGS[Math.min(leg, LEGS.length - 1)]!;
      const ids = idsOf(w.sim, 0);
      if (ids.length > 0) w.sim.queueCommand({ kind: 'move', ids, x: fx.from(x), y: fx.from(y) });
      leg++;
    }
    for (const e of w.runtime.step(w.sim.tick())) {
      if (e.kind === 'missionEnd') {
        produced = (e.ledger['intel.marked_positions'] ?? []) as string[];
        console.log(
          `  mission ended t=${(t / TICKS_PER_SECOND).toFixed(0)}s: ${e.result}, ` +
            `produced ${produced.length} tag(s)`
        );
        ended = true;
      }
    }
    if (t % (30 * TICKS_PER_SECOND) === 0) {
      const n = markedTags(w).length;
      console.log(
        `  t=${t / TICKS_PER_SECOND}s  in contact ${n}  player alive ${idsOf(w.sim, 0).length}`
      );
      if (n === last) {
        // Nothing new for two minutes after the last leg was issued: the sweep is done.
        if (++quiet >= 4 && leg > LEGS.length) break;
      } else {
        quiet = 0;
        last = n;
      }
    }
  }
  // A mission that never ended produced nothing, so fall back to what is in contact --
  // strictly a lower bound, and the walk says so rather than quietly reporting it as
  // the produced list.
  if (produced === null) {
    console.log('  (mission did not end within the sweep window; using live contact)');
    return markedTags(w);
  }
  return produced;
}

function authoredTags(missionId: string): string[] {
  const m = read(join(ROOT, `data/missions/${missionId}.json`)) as MissionLike;
  const out = new Set<string>();
  for (const p of m.enemy?.garrison ?? []) if (p.tag !== undefined) out.add(p.tag);
  return [...out].sort();
}

function main(): number {
  console.log(`sweeping ${RECON}`);
  const marked = sweep();
  const authored = authoredTags(RECON);

  console.log();
  console.log(`marked ${marked.length} of ${authored.length} authored tags`);
  for (const t of authored) console.log(`  ${marked.includes(t) ? 'seen  ' : 'missed'} ${t}`);

  // Same mission file, two ledgers. Everything below is the payoff the spec claims.
  const carried: LedgerData = { 'intel.marked_positions': marked };
  console.log();
  console.log(`starting ${CLEARANCE} fresh, then carrying that ledger`);
  const fresh = makeWorld(CLEARANCE, { units: UNITS });
  const withIntel = makeWorld(CLEARANCE, { units: UNITS, ledger: carried });

  const rows: [string, number, number][] = [];
  for (const id of idsOf(fresh.sim, 1)) {
    const tag = tagAt(fresh, id);
    if (tag === undefined) continue;
    rows.push([tag, fresh.sim.contactLevel(0, id), withIntel.sim.contactLevel(0, id)]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));

  console.log();
  console.log('  tag                       fresh  carried');
  let wrong = 0;
  for (const [tag, f, c] of rows) {
    const want = marked.includes(tag) ? 2 : 0;
    const bad = f !== 0 || c !== want;
    if (bad) wrong++;
    console.log(`  ${tag.padEnd(25)} ${f}      ${c}${bad ? '   <-- WRONG' : ''}`);
  }

  // Disarm is the effect with teeth, so say how far it actually reached on real content.
  // The behaviour itself is covered by mission.test.ts; what no test can see is how many
  // of *these* emplacements are ambushes the player has now defused.
  const ambushes = (withIntel.mission.enemy?.garrison ?? [])
    .filter((p) => p.stance?.kind === 'ambush' && p.tag !== undefined)
    .map((p) => p.tag!);
  const defused = ambushes.filter((t) => marked.includes(t));
  console.log();
  console.log(
    `ambushes: ${ambushes.length} authored, ${defused.length} disarmed by this ledger` +
      (defused.length > 0 ? ` (${defused.join(', ')})` : '')
  );

  const stranded = marked.filter((t) => !rows.some((r) => r[0] === t));
  if (stranded.length > 0) {
    console.log();
    console.log(`note: marked in I but no tagged placement in III: ${stranded.join(', ')}`);
  }

  console.log();
  if (rows.length === 0) {
    console.log('FAIL: no tagged enemy spawned in the clearance mission at all');
    return 1;
  }
  if (wrong > 0) {
    console.log(`FAIL: ${wrong} row(s) did not spawn as the ledger says they should`);
    return 1;
  }
  console.log(
    `OK: ${rows.length} tagged emplacements; fresh all unknown, carried match the ${marked.length} marked`
  );
  return 0;
}

process.exit(main());
