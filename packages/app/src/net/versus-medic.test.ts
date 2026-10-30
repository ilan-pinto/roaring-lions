/**
 * GH-707, the lead's ruling of 30 Oct 2026: the Nemala Medic Team (`inf_medic_squad`) is buildable at a
 * KDF camp's production line in a versus room. The ambulance and the medevac stay out.
 *
 * Driven the way a room's frames reach the sim: `runFrames` -> `applyFrame` -> `validateCommand` -> the
 * runtime's `applyQueued` -> `matchTick`, on a real KDF-v-Sarim `tel_marum` room. Nothing here calls
 * `requestBuild` directly except the refusal reads, which ask the runtime the question a click would.
 */
import { describe, expect, it } from 'vitest';
import { doctrines, units } from '@lions/data';
import { sidesOfFactions, validateConfig, type Frame, type MatchConfig, type MatchTransport, type TransportStatus } from '@lions/net';
import { fx, MED_IDLE, WOUND_DOWN, type Command } from '@lions/sim';
import { runFrames, seatWorldFor } from './frame-step';
import { buildMatchWorld, matchTick, type MatchWorld } from './match-world';
import { outcomeOf } from './outcome';
import { VERSUS_HELD_UNITS, versusRoster } from './versus-roster';

function roomConfig(): MatchConfig {
  const factions = ['kdf', 'sarim'] as const;
  const sides = sidesOfFactions([...factions]);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 4242, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}

class Feed implements MatchTransport {
  readonly local = false;
  private readonly byTick = new Map<number, Frame['cmds']>();
  private next = 0;
  constructor(private readonly last: number) {}
  at(tick: number, seat: 0 | 1, cmd: Command): void {
    const list = this.byTick.get(tick) ?? [];
    list.push({ seat, seq: list.length, cmd });
    this.byTick.set(tick, list);
  }
  queueCommand(): void {}
  take(max: number): Frame[] {
    const out: Frame[] = [];
    while (out.length < max && this.next <= this.last) {
      out.push({ tick: this.next, cmds: this.byTick.get(this.next) ?? [] });
      this.next++;
    }
    return out;
  }
  reportTick(): void {}
  status(): TransportStatus { return { kind: 'live', behind: 0 }; }
  close(): void {}
}

interface Run {
  w: MatchWorld;
  /** Runtime commands the runtime accepted, summed over the run. */
  accepted: number;
  /** Commands the ownership check dropped. */
  dropped: number;
  built: { side: number; unit: string }[];
  /** The kinds of the sim's events, in order (`woundAdmitted`, `woundRejoined` ...). */
  events: string[];
}

/** Plays `feed` over a fresh room: the room's own body, `applyQueued` first so its count can be read. */
function play(feed: Feed, ticks: number, before?: (w: MatchWorld, tick: number) => void): Run {
  const cfg = roomConfig();
  const w = buildMatchWorld(cfg);
  const rt = w.runtime;
  if (rt === null) throw new Error('a KDF-v-Sarim room must have a runtime');
  const run: Run = { w, accepted: 0, dropped: 0, built: [], events: [] };
  const step = {
    transport: feed, sim: w.sim, seatWorld: seatWorldFor(cfg, w.sim), config: cfg,
    beforeFrame: (f: Frame) => before?.(w, f.tick),
    runTick: () => {
      run.accepted += rt.applyQueued();
      const { sim, mission } = matchTick(w);
      for (const e of sim) run.events.push(e.kind);
      for (const e of mission) if (e.kind === 'built') run.built.push({ side: e.side, unit: e.unit });
    },
  };
  for (let i = 0; i < ticks; i++) {
    const r = runFrames(step, 1);
    if (r.ran === 0) break;
    run.dropped += r.dropped;
  }
  return run;
}

const typeIdx = (w: MatchWorld, id: string): number => w.sim.unitTypes.findIndex((t) => t.id === id);

function living(w: MatchWorld, id: string, side: number): number[] {
  const t = typeIdx(w, id);
  const out: number[] = [];
  for (let i = 0; i < w.sim.entityCount; i++) if (w.sim.state.alive[i] === 1 && w.sim.state.side[i] === side && w.sim.state.typeIdx[i] === t) out.push(i);
  return out;
}

/** An open tile `r` tiles from `id` along a row or column, the first of the four that is not blocked. */
function openTileBeyond(w: MatchWorld, id: number, r: number): [number, number] {
  const cx = Math.floor(w.sim.state.posX[id] / 65536);
  const cy = Math.floor(w.sim.state.posY[id] / 65536);
  for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    const x = cx + dx;
    const y = cy + dy;
    if (x >= 0 && y >= 0 && x < w.sim.width && y < w.sim.height && w.sim.blocked[y * w.sim.width + x] === 0) return [x, y];
  }
  throw new Error('no open tile beyond the medic');
}

/** One hit of `hp` on `id` by `by`: the sim's own damage path, as rescue.test.ts reaches it. */
function hit(w: MatchWorld, id: number, hp: number, by: number): void {
  (w.sim as unknown as { applyDamage(t: number, d: number, by: number): void }).applyDamage(id, fx.fromInt(hp), by);
}

describe('the medic team is on the KDF versus menu (GH-707, 30 Oct 2026)', () => {
  it('a room registers it; the ambulance and the medevac stay out', () => {
    const ids = new Set(versusRoster().map((u) => u.id));
    expect(ids.has('inf_medic_squad')).toBe(true);
    expect(ids.has('veh_ambulance')).toBe(false);
    expect(ids.has('air_medevac_heli')).toBe(false);
    expect([...VERSUS_HELD_UNITS].filter((id) => ['inf_medic_squad', 'veh_ambulance', 'air_medevac_heli'].includes(id)).sort()).toEqual(['air_medevac_heli', 'veh_ambulance']);
  });

  it('the KDF menu offers it, the Sarim menu does not, and no menu offers the other two', () => {
    expect(doctrines.kdf.menu).toContain('inf_medic_squad');
    expect(doctrines.sarim.menu).not.toContain('inf_medic_squad');
    for (const d of Object.values(doctrines)) for (const id of ['veh_ambulance', 'air_medevac_heli']) expect(d.menu, id).not.toContain(id);
  });

  it('its price is the unit JSON\'s: 295 logistics, 18 s, population 1 (production-numbers.md)', () => {
    expect(units.inf_medic_squad.cost).toEqual({ logistics: 295, build_time_s: 18, population: 1 });
  });

  it('the KDF line takes it and pays 295; the Sarim line, and both held vehicles, refuse', () => {
    const w = buildMatchWorld(roomConfig());
    const rt = w.runtime!;
    const purse = rt.logisticsOf(0);
    expect(rt.requestBuild('inf_medic_squad', undefined, 0)).toBe(true);
    expect(rt.logisticsOf(0)).toBe(purse - 295);
    // Another seat's menu: Sarim has no medic team (and no purse is touched).
    const sarim = rt.logisticsOf(1);
    expect(rt.requestBuild('inf_medic_squad', undefined, 1)).toBe(false);
    expect(rt.logisticsOf(1)).toBe(sarim);
    // The two rescue vehicles are on no menu and not in the room's roster.
    expect(rt.requestBuild('veh_ambulance', undefined, 0)).toBe(false);
    expect(rt.requestBuild('air_medevac_heli', undefined, 0)).toBe(false);
    expect(rt.logisticsOf(0)).toBe(purse - 295);
  });
});

describe('a medic team in a versus room does its job (GH-707)', () => {
  it('the KDF seat builds it from a frame, the Sarim seat\'s build of it is refused, a rescue order from a frame stabilises and lifts a downed man', () => {
    const feed = new Feed(2600);
    feed.at(0, 0, { kind: 'build', side: 0, unit: 'inf_medic_squad' });
    feed.at(0, 1, { kind: 'build', side: 1, unit: 'inf_medic_squad' });
    feed.at(1, 0, { kind: 'build', side: 0, unit: 'veh_ambulance' });
    let man = -1;
    let medic = -1;
    let rescued = false;
    const run = play(feed, 2600, (w, tick) => {
      if (tick === 0) return;
      if (medic < 0) {
        const m = living(w, 'inf_medic_squad', 0);
        if (m.length === 0) return;
        medic = m[0];
        // A KDF rifle squad on open ground just OUTSIDE the medic's own 8-tile search (`rescue.radius_tiles`), hit until a
        // man falls wounded and goes DOWN. Measured: without the order below he stays down (the camp's 12-tile dispatch does
        // not reach him from where the medic stands), so the order is what the test proves.
        const [sx, sy] = openTileBeyond(w, medic, 10);
        const squad = w.sim.spawn(typeIdx(w, 'inf_squad'), 0, fx.from(sx + 0.5), fx.from(sy + 0.5));
        const shooter = w.bySide[1][0];
        const before = w.sim.entityCount;
        for (let k = 0; k < 20 && w.sim.entityCount === before; k++) hit(w, squad, 100, shooter);
        man = before;
        expect(w.sim.entityCount, 'a man went down').toBeGreaterThan(before);
        expect(w.sim.state.woundState[man]).toBe(WOUND_DOWN);
        // The order a click sends (intents.ts), put in the NEXT frame through the room's own validation.
        feed.at(tick + 1, 0, { kind: 'rescue', ids: [medic], target: man });
        // A seat cannot order the other seat's medic: this one must drop on both machines.
        feed.at(tick + 1, 1, { kind: 'rescue', ids: [medic], target: man });
        rescued = true;
      }
    });
    // One medic team built, one accepted build (the Sarim medic and the ambulance were refused by the runtime).
    expect(run.built.filter((b) => b.side === 0).map((b) => b.unit)).toContain('inf_medic_squad');
    expect(run.built.filter((b) => b.unit === 'veh_ambulance' || (b.side === 1 && b.unit === 'inf_medic_squad'))).toEqual([]);
    expect(run.accepted).toBe(1);
    expect(medic).toBeGreaterThanOrEqual(0);
    expect(rescued).toBe(true);
    // The forged order from seat 1 dropped at the ownership check; seat 0's reached the sim.
    expect(run.dropped).toBe(1);
    // He was treated (bleeding stopped), lifted, carried to his own camp (the room's drop-off, `versus_aid`), admitted there and
    // sent back to his squad: the whole loop, in a room, from a frame's order.
    expect(run.events).toContain('woundStabilised');
    expect(run.events).toContain('woundAdmitted');
    expect(run.events).toContain('woundRejoined');
    expect(run.events).not.toContain('woundEvacuated');
    expect(run.w.sim.state.alive[man]).toBe(0); // admitted: off the board, alive in the squad again
    expect(run.w.sim.state.medState[medic]).toBe(MED_IDLE);
  });
});

describe('a room\'s win rule and a medic team (GH-707, 30 Oct 2026)', () => {
  it('on the real sim: a KDF side reduced to one medic team has lost by annihilation', () => {
    const w = buildMatchWorld(roomConfig());
    for (const id of w.bySide[0]) w.sim.debugKill(id);
    w.sim.spawn(typeIdx(w, 'inf_medic_squad'), 0, fx.from(10.5), fx.from(10.5));
    expect(living(w, 'inf_medic_squad', 0)).toHaveLength(1);
    expect(outcomeOf(w.sim, 100)).toEqual({ kind: 'won', side: 1, by: 'annihilation' });
    // Control: one armed rifle squad beside it keeps the side standing.
    w.sim.spawn(typeIdx(w, 'inf_squad'), 0, fx.from(12.5), fx.from(10.5));
    expect(outcomeOf(w.sim, 100)).toEqual({ kind: 'ongoing' });
  });
});
