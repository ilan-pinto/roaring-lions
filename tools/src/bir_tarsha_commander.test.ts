// Bir Tarsha V: the block commander (`take_the_commander`, an optional `eliminate_hvt`) is still on the map and reachable.
//
// `bt5_commander_moves` fires inside the first ten seconds of every run: two charge squads and the shaft cell at (9,15) die at once, and 3 of 9 is
// 33%. The post (the commander and two guard cells, group `post`) then walks. It used to walk to `north_exit` (40,2), the map's north-east corner,
// out of every unit's sight from about 25 s, so the optional objective was unreachable. It now walks to `commander_post` (44,10) on the east lane:
// out of every foe-gate box the winning plan (plans/bir_tarsha_5.ts) uses and out of weapon reach (7 tiles) of its units, so that plan's
// results are byte for byte what they were, and still within 8 tiles of the chamber approach so that a squad heading there meets him.
//
// What this pins: the data facts, the geometry that keeps the unchanged plan unchanged, the unchanged plan's results on the thirty sweep
// seeds, and a SCRATCH hunter variant (defined here, not a change to the shipped plan) that goes for him and takes the objective.
//
// What it is not: a claim about how long a player takes. A scripted plan has perfect information.
import { describe, expect, it } from 'vitest';
import { maps, missions } from '@lions/data/content';
import { run, runLog, setSweep, tapMissionEvents, type Plan } from './backtest/playtest-run';
import { SWEEP_SEEDS } from './backtest/passive-sweep';
import { BIR_TARSHA_CHAIN, BIR_TARSHA_PLANS } from './backtest/plans/bir_tarsha';
import { M } from './backtest/plans/bir_tarsha_util';
import type { LedgerData } from '@lions/sim';

const ID = 'bir_tarsha_5_subterranean';
type Pt = readonly [number, number];
interface Trigger { id: string; label?: string; on: { kind: string; value: number }; do: { kind: string; group: string; to: string } }
interface Garrison { unit: string; count?: number; at: Pt; tag?: string; group?: string }
const mission = (missions as unknown as Record<string, { triggers: Trigger[]; enemy: { garrison: Garrison[] } }>)[ID];
const mapJson = (maps as unknown as Record<string, { markers: Record<string, Pt>; zones: Record<string, [number, number, number, number]>; tunnels: { id: string; mouth: Pt }[] }>)['bir_tarsha_5'];
const trigger = mission.triggers.find((t) => t.id === 'bt5_commander_moves') as Trigger;

/** The mouths of the five routes in order, as the plan reads them, and the plan's foe gate on routes 2 to 4: a 24-tile box around the mouth. */
const MOUTHS: readonly Pt[] = [[8, 27], [19, 25], [29, 27], [34, 24], [40, 26]];
const FRONT: Pt = [38.5, 23.5];
const MILITIA_RANGE = 7; // data/units/enemy/militia_cell.json, rifles range_tiles

describe('the data', () => {
  it('the retreat keeps its trigger, its group and its words, and walks to a marker that exists and is not north_exit', () => {
    expect([trigger.on.kind, trigger.on.value, trigger.do.kind, trigger.do.group]).toEqual(['casualties_pct', 33, 'withdraw_to', 'post']);
    expect(trigger.label).toBe('The block commander is pulling north');
    expect(trigger.do.to).toBe('commander_post');
    expect(trigger.do.to).not.toBe('north_exit');
    expect(mapJson.markers[trigger.do.to], 'the destination marker').toBeDefined();
    expect(mapJson.markers['north_exit']).toEqual([40, 2]); // still defined: the sandbox anchors (hostile) read it
  });
  it('the post is the commander and two guard cells, all group post', () => {
    const post = mission.enemy.garrison.filter((p) => p.group === 'post');
    expect(post.reduce((n, p) => n + (p.count ?? 1), 0)).toBe(3);
    expect(post.filter((p) => p.tag === 'bt5_block_commander').map((p) => [p.unit, p.count ?? 1])).toEqual([['militia_cell', 1]]);
  });
  it('the route mouths this test reads are the map\'s own', () => {
    expect(mapJson.tunnels.map((t) => t.mouth)).toEqual(MOUTHS);
  });
});

describe('the geometry that keeps the unchanged plan unchanged', () => {
  const [px, py] = mapJson.markers['commander_post'] ?? [NaN, NaN];
  // The post arrives in a row, one tile apart: the marker and one tile either side (measured: 43.5, 44.5, 45.5).
  const standing: Pt[] = [-1, 0, 1].map((dx) => [px + dx + 0.5, py + 0.5]);
  it('stands outside the plan\'s foe-gate box around the mouths of routes 2, 3 and 4, by a tile, so the plan never waits on him', () => {
    for (const [mx, my] of MOUTHS.slice(2))
      for (const [x, y] of standing) {
        const inside = x >= mx - 12 - 1 && x < mx + 12 + 1 && y >= my - 12 - 1 && y < my + 12 + 1;
        expect(inside, `(${x},${y}) against the box of the mouth (${mx},${my}) grown by a tile`).toBe(false);
      }
  });
  it('stands more than the militia range plus two tiles from every mouth and from the plan\'s front', () => {
    for (const [mx, my] of [...MOUTHS, FRONT])
      for (const [x, y] of standing) expect(Math.hypot(x - mx, y - my), `(${x},${y}) to (${mx},${my})`).toBeGreaterThan(MILITIA_RANGE + 2);
  });
  it('is within 8 tiles of the chamber approach, so a squad heading for the chamber meets him', () => {
    const [zx, zy, zw] = mapJson.zones['chamber_reach'];
    const near = Math.min(...standing.map(([x, y]) => Math.hypot(Math.max(zx - x, 0, x - (zx + zw)), Math.max(zy - y, 0))));
    expect(near).toBeLessThanOrEqual(8);
  });
});

// --- the world ---------------------------------------------------------------------------------------------------------------------

interface Result {
  result: string;
  seconds: number;
  roe: number;
  stars: number;
  credits: number;
  cause?: string;
  /** The commander at 30, 60 and 100 s: alive and where. */
  seen: Record<number, { alive: boolean; x: number; y: number }>;
  allFive: string;
  takeTheCommander: string;
  takenAt: number;
}

const ledgers = new Map<number, LedgerData>();
/** The ledger BT V is played on: what the plans of the missions before it produce on the same seed (as `pnpm playtest` threads it). */
function ledgerFor(seed: number): LedgerData {
  let led = ledgers.get(seed);
  if (led !== undefined) return led;
  led = {};
  setSweep(seed === 424242 ? undefined : seed, true);
  for (const prior of BIR_TARSHA_CHAIN.slice(0, BIR_TARSHA_CHAIN.indexOf(ID))) led = { ...led, ...run(prior, BIR_TARSHA_PLANS[prior], led, 'victory', prior) };
  ledgers.set(seed, led);
  return led;
}

function play(plan: Plan, seed: number): Result {
  const code = process.exitCode;
  const measured = { result: 'ongoing', stars: 0, roeScore: 0, credits: 0 } as NonNullable<Parameters<typeof run>[10]>;
  const seen: Result['seen'] = {};
  let allFive = '';
  let takeTheCommander = '';
  let takenAt = -1;
  try {
    const led = ledgerFor(seed);
    setSweep(seed === 424242 ? undefined : seed, true);
    let cmd = -1;
    tapMissionEvents((_evs, rt, sim) => {
      const tags = (rt as unknown as { tags: Map<string, number[]> }).tags;
      if (cmd < 0) cmd = (tags.get('bt5_block_commander') ?? [-1])[0];
      if (cmd < 0) throw new Error('the tag bt5_block_commander resolved to no unit');
      allFive = rt.objectiveStatus('all_five');
      takeTheCommander = rt.objectiveStatus('take_the_commander');
      if (takeTheCommander === 'complete' && takenAt < 0) takenAt = sim.tickCount / 20;
      if (sim.tickCount % 20 === 0 && [30, 60, 100].includes(sim.tickCount / 20))
        seen[sim.tickCount / 20] = { alive: sim.state.alive[cmd] === 1, x: Number(sim.state.posX[cmd]) / 65536, y: Number(sim.state.posY[cmd]) / 65536 };
    });
    run(ID, plan, led, 'victory', ID, 0, undefined, undefined, undefined, undefined, measured);
    const r = runLog[runLog.length - 1];
    return { result: r.result, seconds: Math.round(r.minutes * 60), roe: r.roe, stars: r.stars, credits: measured.credits, cause: measured.cause, seen, allFive, takeTheCommander, takenAt };
  } finally {
    tapMissionEvents(undefined);
    setSweep(undefined, false);
    process.exitCode = code;
  }
}

const shipped: Plan = BIR_TARSHA_PLANS[ID];

/**
 * The shipped plan plus a hunt, defined here and not shipped: from `at` seconds the squads and the Lavi attack-move onto the post's marker, every five
 * seconds while the commander lives (the plan's own later attack-move to the east end would otherwise pull them back). The wide route is held until he is
 * down or 250 s, because the mission ends the moment the last charge goes and a hunt that has not finished by then simply loses the secondary. A
 * `never` hunt (at Infinity) is the control: the same hold, no hunters.
 */
const hunters = (at0: number): Plan => (sim, rt, ids, at) => {
  const commander = (): number => ((rt as unknown as { tags: Map<string, number[]> }).tags.get('bt5_block_commander') ?? [-1])[0];
  const alive = (): boolean => sim.state.alive[commander()] === 1;
  const yah = ids('yahalom_squad');
  const front = [...ids('inf_squad'), ...ids('mbt_lavi')];
  const queue = sim.queueCommand.bind(sim);
  // Hold the wide route's charge until he is down (or 250 s). The shipped plan orders it once; this variant re-issues it itself.
  sim.queueCommand = (c) => {
    if (c.kind === 'chargeTunnel' && c.tunnel === 4 && alive() && sim.tickCount < 250 * 20) return;
    queue(c);
  };
  shipped(sim, rt, ids, at);
  let sent = false;
  for (let s = 2; s < 400; s += 2)
    at(s, () => {
      if (sent || sim.tnAlive[4] === 0 || (alive() && s < 250)) return;
      if (sim.tnAlive[0] + sim.tnAlive[1] + sim.tnAlive[2] + sim.tnAlive[3] > 0) return; // the plan's own order for the earlier routes comes first
      sent = true;
      queue({ kind: 'chargeTunnel', ids: yah.filter((i) => sim.state.alive[i] === 1), tunnel: 4 });
    });
  if (Number.isFinite(at0))
    for (let s = at0; s < 400; s += 5)
      at(s, () => {
        if (!alive()) return;
        const [x, y] = mapJson.markers['commander_post'];
        queue({ kind: 'attackMove', ids: front.filter((i) => sim.state.alive[i] === 1), ...M(x + 0.5, y + 3) });
      });
};

describe('the world: the unchanged plan on the thirty sweep seeds', () => {
  it('still wins every one at the dev times, with the dev stars, Conduct and credits, and the commander stands alive at the post at 30, 60 and 100 s', { timeout: 280_000 }, () => {
    const [mx, my] = mapJson.markers['commander_post'];
    for (const seed of SWEEP_SEEDS) {
      const r = play(shipped, seed);
      expect([r.result, r.stars, r.roe], `seed ${seed}`).toEqual(['victory', 3, 100]);
      expect([97, 99, 101, 103], `seed ${seed} won in ${r.seconds} s`).toContain(r.seconds);
      expect([245, 255], `seed ${seed} credits`).toContain(r.credits);
      for (const t of [30, 60]) {
        const c = r.seen[t];
        expect(c.alive, `seed ${seed}: alive at ${t} s`).toBe(true);
        expect(Math.hypot(c.x - (mx + 0.5), c.y - (my + 0.5)), `seed ${seed}: within a tile of the post at ${t} s`).toBeLessThanOrEqual(1.5);
      }
      expect(r.takeTheCommander, `seed ${seed}: nobody went for him, so it is still open at the win`).toBe('active');
    }
  });
});

describe('the world: a hunter variant reaches him', () => {
  // 20 s: the squads are already on the lane. 45 s and 90 s: the mission would end first, so the hold above keeps the last charge back until he is down.
  for (const from of [20, 45, 90]) {
    it(`hunters ordered at ${from} s take the commander, the mission is still won and all_five is not at risk, on every seed`, { timeout: 280_000 }, () => {
      const times: number[] = [];
      const roes: number[] = [];
      for (const seed of SWEEP_SEEDS) {
        const r = play(hunters(from), seed);
        expect(r.result, `seed ${seed} (${r.cause})`).toBe('victory');
        expect(r.takeTheCommander, `seed ${seed}`).toBe('complete');
        expect(r.allFive, `seed ${seed}`).toBe('complete');
        expect(r.takenAt, `seed ${seed}: taken before the end`).toBeGreaterThan(from);
        expect(r.seconds, `seed ${seed}: all_five has a 390 s clock, and 120 s of headroom is the house floor`).toBeLessThanOrEqual(390 - 120);
        expect(r.roe, `seed ${seed}: Conduct`).toBeGreaterThanOrEqual(90);
        times.push(r.seconds);
        roes.push(r.roe);
      }
      process.stderr.write(`hunters at ${from} s: ${SWEEP_SEEDS.length}/30 won, slowest ${Math.max(...times)} s, fastest ${Math.min(...times)} s, lowest Conduct ${Math.min(...roes)}\n`);
    });
  }
  it('control: with no hunters the same hold leaves him alive and the objective open at 250 s, and the mission is won only then', { timeout: 120_000 }, () => {
    for (const seed of [424242, 1, 2]) {
      const r = play(hunters(Infinity), seed);
      expect(r.takeTheCommander, `seed ${seed}`).toBe('active');
      expect(r.seen[100]?.alive, `seed ${seed}: alive at 100 s`).toBe(true);
      // The hold works: the shipped plan wins at 103 s, this one only once the 250 s hold lets the last charge go, with the clock still ahead.
      expect([r.result, r.seconds > 250, r.seconds <= 390 - 120], `seed ${seed}: won at ${r.seconds} s`).toEqual(['victory', true, true]);
    }
  });
});
