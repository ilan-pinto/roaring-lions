/**
 * N3 Task 8: ONE economy-room frame stream with both seats producing, and one
 * client that plays it -- shared by `tools/src/net/two-client.test.ts` (two
 * clients in Node) and `tools/src/net/two-engine.ts` (the same client in
 * Chromium, Firefox and WebKit, imported by the page from the dev server at
 * `/src/net/economy-stream.test-helper.ts`). It lives under `packages/app/src`
 * for that reason alone: the dev server serves this tree, and everything it
 * imports is already in the app's own module graph. Nothing in the app imports it.
 *
 * The room is a Sarim-host `wadi_tarfan` match: seat 0 is Sarim on side 1
 * (LD1, KDF is side 0), seat 1 is KDF on side 0. Over 1,200 ticks both seats
 * `build` several units through FRAMES (never a direct runtime call), seat 1
 * cancels one queued item, both set a rally point and later clear it, and seat 0
 * forges one `build{side: 0}` -- a side it does not hold -- which every client
 * must drop before the queue (Review Focus 2).
 *
 * GH-681 T6: the room's rules file registers the Sarim end's routes, and the stream uses
 * one: four of seat 0's foot units `enterTunnel` on `wt_f_north`, crawl to the vent, two
 * `vent raid` and two `vent exit` later, those two `enterTunnel` at the vent end again --
 * and seat 1 (KDF) forges an `enterTunnel` into that Sarim route, which every client drops
 * (T-R4). Tunnel orders go to the sim, not the runtime, so `ECONOMY_STREAM_ACCEPTED` is unmoved.
 */
import { fx, type Command } from '@lions/sim';
import {
  canonicalOrder, sidesOfFactions, validateConfig,
  type Frame, type MatchConfig, type MatchTransport, type Stamped, type TransportStatus,
} from '@lions/net';
import { buildMatchWorld, matchTick, type MatchWorld } from './match-world';
import { runFrames, seatWorldFor } from './frame-step';

export const ECONOMY_STREAM_MAP = 'wadi_tarfan';
export const ECONOMY_STREAM_TICKS = 1200;
/** The tick seat 0's forged `build{side: 0}` is stamped at. */
export const ECONOMY_STREAM_FORGED_TICK = 100;
/** Runtime commands the stream sends that the runtime must ACCEPT (the forged one never reaches it). */
export const ECONOMY_STREAM_ACCEPTED = 16;
/** The Sarim end's route the tunnel orders use (registered from `data/versus/wadi_tarfan.json`). */
export const ECONOMY_STREAM_ROUTE = 'wt_f_north';
/** The ticks of the tunnel orders. `forged` is seat 1's enterTunnel into the Sarim route. */
export const ECONOMY_STREAM_TUNNEL = { enter: 20, forged: 20, raid: 720, exit: 800, reenter: 860 } as const;

/** The room: seat 0 Sarim (side 1), seat 1 KDF (side 0), the test fixture's own fields. */
export function economyStreamConfig(): MatchConfig {
  const factions = ['sarim', 'kdf'] as const;
  const sides = sidesOfFactions([...factions]);
  const seat = (s: 0 | 1) => ({
    seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [],
    player: `p${s}`, callsign: `c${s}`, kind: 'human' as const,
  });
  const c = validateConfig({
    matchId: 'M', code: 'ABCDEF', seed: 1234, map: ECONOMY_STREAM_MAP, mode: 'versus', seats: [seat(0), seat(1)],
    pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'test', dataDigest: 0,
  });
  if (c === null) throw new Error('economyStreamConfig: the fixture no longer validates');
  return c;
}

/** The nearest open, on-map tile to a camp exit, a few tiles out: a legal rally point. */
function rallyNear(w: MatchWorld, exit: readonly [number, number]): [number, number] {
  const ex = exit[0] >> 16;
  const ey = exit[1] >> 16;
  const { width, height, blocked } = w.sim;
  for (let r = 3; r < 12; r++) {
    for (const [dx, dy] of [[r, r], [r, 0], [0, r], [-r, r], [r, -r], [-r, -r], [-r, 0], [0, -r]]) {
      const x = ex + dx;
      const y = ey + dy;
      if (x >= 0 && y >= 0 && x < width && y < height && blocked[y * width + x] === 0) return [fx.from(x + 0.5), fx.from(y + 0.5)];
    }
  }
  throw new Error('economy stream: no open tile near the camp exit');
}

/**
 * How many of the named foot units the stream's route can hold, read off the sim that
 * registered it (`tunnelCapacity`, from `data/versus/wadi_tarfan.json`), capped by the number
 * named: the count `tunnel.below` must read at the vent. Never a literal, so a capacity change
 * in the data moves the expectation with it.
 */
export function economyStreamExpectedBelow(): number {
  const config = economyStreamConfig();
  const w = buildMatchWorld(config);
  const route = w.map.tunnels.findIndex((t) => t.id === ECONOMY_STREAM_ROUTE);
  if (route < 0) throw new Error(`economy stream: the room does not register ${ECONOMY_STREAM_ROUTE}`);
  return Math.min(tunnelFoot(w, config.seats[0].side as 0 | 1).length, w.sim.tunnelCapacity(route));
}

/** The four Sarim foot units the tunnel orders name: a route's default capacity, ground, unwheeled. */
function tunnelFoot(w: MatchWorld, side: 0 | 1): number[] {
  const foot = w.bySide[side].filter((id) => {
    const t = w.sim.unitTypes[w.sim.state.typeIdx[id]];
    return !t.isAir && !t.wheeled;
  }).slice(0, 4);
  if (foot.length !== 4) throw new Error(`economy stream: the Sarim side fielded ${foot.length} foot units, the tunnel orders need 4`);
  return foot;
}

/** The frame stream, one frame per tick. Every id and point is read off a fresh world. */
export function economyStreamFrames(): Frame[] {
  const config = economyStreamConfig();
  const w = buildMatchWorld(config);
  if (w.runtime === null) throw new Error('economy stream: a kdf-v-sarim room must have a runtime');
  const sarim = config.seats[0].side as 0 | 1;
  const kdf = config.seats[1].side as 0 | 1;
  const [sx, sy] = rallyNear(w, w.runtime.productionLines(sarim)[0].exit);
  const [kx, ky] = rallyNear(w, w.runtime.productionLines(kdf)[0].exit);
  const seq: [number, number] = [0, 0];
  const entries: [number, Stamped][] = [];
  const at = (tick: number, seat: 0 | 1, cmd: Command): void => { entries.push([tick, { seat, seq: seq[seat]++, cmd }]); };
  // Opening builds. Purses: KDF 1500, Sarim 2400 (the doctrines).
  at(5, 1, { kind: 'build', side: kdf, unit: 'inf_squad', line: 0 });        // 292
  at(5, 1, { kind: 'build', side: kdf, unit: 'at_team', line: 0 });          // 236
  at(5, 1, { kind: 'build', side: kdf, unit: 'mortar_team', line: 0 });      // 209
  at(5, 1, { kind: 'build', side: kdf, unit: 'jeep_shoded', line: 0 });      // 317, cancelled below
  at(6, 0, { kind: 'build', side: sarim, unit: 'recoilless_team', line: 0 }); // 205
  at(6, 0, { kind: 'build', side: sarim, unit: 'atgm_cell', line: 0 });       // 235
  at(6, 0, { kind: 'build', side: sarim, unit: 'gun_truck', line: 0 });       // 324
  // KDF cancels its last queued item (the jeep: index 2 behind the squad in progress), refunded.
  at(40, 1, { kind: 'cancelBuild', side: kdf, line: 0, index: 2 });
  at(60, 0, { kind: 'setRally', side: sarim, line: 0, x: sx, y: sy });
  at(60, 1, { kind: 'setRally', side: kdf, line: 0, x: kx, y: ky });
  // Forged: seat 0 holds side 1 and names side 0. Every client drops it.
  at(ECONOMY_STREAM_FORGED_TICK, 0, { kind: 'build', side: kdf, unit: 'inf_squad', line: 0 });
  // Second wave, with the rally points cleared first on one side and later on the other.
  at(500, 1, { kind: 'clearRally', side: kdf, line: 0 });
  at(520, 1, { kind: 'build', side: kdf, unit: 'recon_drone', line: 0 });
  at(520, 0, { kind: 'build', side: sarim, unit: 'sarim_rifles', line: 0 });  // 340
  at(530, 0, { kind: 'build', side: sarim, unit: 'atgm_cell', line: 0 });     // 235
  at(800, 0, { kind: 'clearRally', side: sarim, line: 0 });
  at(820, 1, { kind: 'build', side: kdf, unit: 'at_team', line: 0 });        // 236
  // GH-681 T6: the Sarim seat's foot units use its own end's route. Ids are read off a fresh
  // world, exactly as the economy ids above are.
  const route = w.map.tunnels.findIndex((t) => t.id === ECONOMY_STREAM_ROUTE);
  if (route < 0 || w.sim.tunnelOwner(route) !== sarim) throw new Error(`economy stream: the room does not register ${ECONOMY_STREAM_ROUTE} for the Sarim side`);
  const foot = tunnelFoot(w, sarim);
  const T = ECONOMY_STREAM_TUNNEL;
  at(T.enter, 0, { kind: 'enterTunnel', ids: foot, tunnel: route });
  at(T.forged, 1, { kind: 'enterTunnel', ids: w.bySide[kdf].slice(0, 2), tunnel: route }); // dropped by every client
  at(T.raid, 0, { kind: 'vent', ids: foot.slice(0, 2), mode: 'raid' });
  at(T.exit, 0, { kind: 'vent', ids: foot.slice(2), mode: 'exit' });
  at(T.reenter, 0, { kind: 'enterTunnel', ids: foot.slice(2), tunnel: route });
  const byTick = new Map<number, Stamped[]>();
  for (const [tick, s] of entries) byTick.set(tick, [...(byTick.get(tick) ?? []), s]);
  const frames: Frame[] = [];
  for (let t = 0; t < ECONOMY_STREAM_TICKS; t++) frames.push({ tick: t, cmds: canonicalOrder(byTick.get(t) ?? []) });
  return frames;
}

/** A room stand-in: hands out a fixed stream and records each reported digest. */
class Feed implements MatchTransport {
  readonly local = false;
  readonly digests = new Map<number, number>();
  private frames: Frame[];
  constructor(frames: readonly Frame[]) { this.frames = [...frames]; }
  queueCommand(): void {}
  take(max: number): Frame[] { return this.frames.splice(0, max); }
  reportTick(tick: number, digest: number | null): void { if (digest !== null) this.digests.set(tick, digest); }
  status(): TransportStatus { return { kind: 'live', behind: this.frames.length }; }
  close(): void {}
}

export interface EconomyStreamResult {
  /** `[tick, reported digest]` on every hash tick, in order: `matchDigest(sim, runtime, content)`. */
  digests: [number, number][];
  /** `built` events per SIDE: `[side 0, side 1]`. */
  built: [number, number];
  /** The frame tick of every command the ownership check dropped, one entry per command. */
  droppedTicks: number[];
  /** Runtime commands the runtime accepted (`applyQueued`). */
  accepted: number;
  /** GH-681 T6: `surfaced` events seen, and how many of the four named units were below
   *  ground and arrived at the vent on the tick before the raid (a stream whose units never
   *  went under proves nothing). */
  tunnel: { surfaced: number; below: number };
  /** The runtime's own digest after the last tick. */
  runtimeDigest: number;
  /** Each side's purse after the last tick, `[side 0, side 1]` (`logisticsOf`). */
  purse: [number, number];
}

/**
 * One client: its own world, `frames`, and the browser's own room body --
 * `runFrames` over `matchTick`, the runtime's digest folded into each report.
 * `frames` is played in the order given: a test may hand it a stream with a
 * frame out of place or a command missing, as a faulty transport would.
 */
export function runEconomyClient(frames: readonly Frame[]): EconomyStreamResult {
  const config = economyStreamConfig();
  const w = buildMatchWorld(config);
  const rt = w.runtime;
  if (rt === null) throw new Error('economy stream: a kdf-v-sarim room must have a runtime');
  const feed = new Feed(frames);
  const built: [number, number] = [0, 0];
  const droppedTicks: number[] = [];
  let accepted = 0;
  let tick = -1;
  const foot = tunnelFoot(w, config.seats[0].side as 0 | 1);
  const route = w.map.tunnels.findIndex((t) => t.id === ECONOMY_STREAM_ROUTE);
  const tunnel = { surfaced: 0, below: 0 };
  const step = {
    transport: feed, sim: w.sim, seatWorld: seatWorldFor(config, w.sim), config,
    beforeFrame: (f: Frame) => { tick = f.tick; },
    runTick: () => {
      // The runtime's own drain, asked first so its count can be read; `matchTick`
      // (the browser's body) then drains an empty queue and ticks, exactly as
      // it would have with the commands still set aside.
      accepted += rt.applyQueued();
      const { sim, mission } = matchTick(w);
      for (const e of mission) if (e.kind === 'built') built[e.side]++;
      for (const e of sim) if (e.kind === 'surfaced') tunnel.surfaced++;
      if (tick === ECONOMY_STREAM_TUNNEL.raid - 1) {
        tunnel.below = foot.filter((id) => w.sim.state.tunnelIn[id] === route && w.sim.state.tunnelEta[id] === 0).length;
      }
    },
    runtimeDigest: () => rt.digest(),
  };
  // One frame at a time, so a drop is charged to its own frame's tick.
  for (;;) {
    const r = runFrames(step, 1);
    if (r.ran === 0) break;
    for (let i = 0; i < r.dropped; i++) droppedTicks.push(tick);
  }
  return { digests: [...feed.digests], built, droppedTicks, accepted, tunnel, runtimeDigest: rt.digest(), purse: [rt.logisticsOf(0), rt.logisticsOf(1)] };
}
