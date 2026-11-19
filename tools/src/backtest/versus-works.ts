// The field-works arm of the versus probe (the lead's ruling, 18 Nov 2026: field works as a room option in KDF v KDF
// annihilation, 1,000 logistics a player). REPORT-ONLY: balance is parked (13 Nov), so this prints a table and exits 0
// whatever it says, and nothing here tunes anything.
//
//   pnpm versus:probe -- --field-works                         tel_marum and milh_flats, 30 seeds, on against off
//   pnpm versus:probe -- --field-works --maps=wadi_tarfan --seeds=12
//
// The game. A room's own world for the KDF mirror, annihilation (`buildMatchWorld` of the probe's `roomConfig`, with and
// without `fieldWorks`), stepped by the room's `matchTick`, decided by the real rule (`outcomeOf` with `productionOf` and
// the map's own cap, as `play` decides): both arms build the same world byte for byte but the runtime (`match-world.ts`).
// Every 20 s each side's combat units attack-move on the other's centroid, exactly as the probe's other arms.
//
// The works plan (the ON arm; both seats alike, reading nothing of the other side). A side's builders (every `construct`
// unit it fields: the D9) stay home and raise one work at a time, in a fixed order -- aid post, workshop, outpost, medic
// station, intel centre, then round again -- each on the first legal pad found walking outward from a point 4 tiles from
// the side's own anchor toward the map's centre, while the purse covers the next one. When nothing more is affordable the
// builders join the march. Requests go down the sim's queue as `raiseWorks` commands for the seat's own side, which
// `matchTick` prices (`applyQueued`) -- a room's own path. The OFF arm has no runtime and no plan: the builders march with
// everyone else, as in every other probe arm.
//
// What it reports per map and arm: the win split by SEAT (seat 0 is the host, side 0, the friendly end), how the games
// ended, the mean works COMPLETED per side, and the mean time to each side's first work started and completed (over the
// games where one was). What it cannot say: the plan is the dumbest one that spends the purse; a player who raises an
// aid post where the fight is, or an outpost on the line of advance, is not modelled. Works stand at home while the
// armies meet in the middle, so an even table says the option costs no seat its edge under this plan, not that the
// works are worthless.

import type { Sim } from '@lions/sim';
import { maps } from '@lions/data/content';
import { matchCapTicks, validateConfig, type MatchConfig } from '@lions/net';
import type { MapId } from '@lions/data';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { outcomeOf, productionOf, unitCost, type MatchResult } from '../../../packages/app/src/net/outcome';
import { CAP_TICKS_DEFAULT, DECIDE_EVERY_TICKS, ORDER_EVERY_TICKS, livingOf, order, roomConfig, seedOf, type Finish } from './versus-probe';

const TICKS_PER_SECOND = 20;
/** The arm's default sample (the brief: 30 seeds) and maps (two open KDF-v-KDF maps). */
export const WORKS_SEEDS_DEFAULT = 30;
export const WORKS_MAPS_DEFAULT: readonly MapId[] = ['tel_marum', 'milh_flats'];
/** The order the plan raises works in, round and round while the purse lasts. */
export const WORKS_ORDER: readonly string[] = ['kdf_aid_post', 'kdf_workshop', 'kdf_outpost', 'kdf_medic_station', 'kdf_intel_centre'];
/** How far from the side's own anchor, toward the centre, the pad search starts (tiles). */
const PAD_FORWARD_TILES = 4;

export interface WorksGame {
  /** The winning SEAT, or null for a draw. In the KDF mirror seat s is side s. */
  winner: 0 | 1 | null;
  by: Finish;
  ticks: number;
  /** Works completed, by side. */
  completed: [number, number];
  /** The tick each side's first work started / completed, or -1. */
  firstStarted: [number, number];
  firstComplete: [number, number];
  /** Each side's purse when the game was decided (logistics), -1 with no runtime. */
  purse: [number, number];
}

function config(mapId: MapId, seed: number, on: boolean): MatchConfig {
  const base = roomConfig(mapId, ['kdf', 'kdf'], seed);
  const c = validateConfig({ ...base, ...(on ? { fieldWorks: true } : {}) });
  if (c === null) throw new Error(`versus works probe: no valid config for ${mapId}`);
  return c;
}

/** A unit the sim takes a `construct` order from. */
const builds = (sim: Sim, id: number): boolean => sim.unitTypes[sim.state.typeIdx[id]].canConstruct;

/** The first legal pad for `typeId` on `side`, walking outward from 4 tiles ahead of the side's anchor. */
export function padFor(w: MatchWorld, typeId: string, side: 0 | 1): [number, number] | null {
  const rt = w.runtime;
  if (rt === null) return null;
  const [ax, ay] = w.anchors[w.endOfSide[side]];
  const dx = w.sim.width / 2 - ax;
  const dy = w.sim.height / 2 - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ox = Math.round(ax + (dx / len) * PAD_FORWARD_TILES);
  const oy = Math.round(ay + (dy / len) * PAD_FORWARD_TILES);
  for (let r = 0; r <= 10; r++) {
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = ox + i;
        const y = oy + j;
        if (rt.constructReason(typeId, x, y, undefined, side) === null) return [x, y];
      }
    }
  }
  return null;
}

/** One round of a side's works plan: if none of its works is charged or building, raise the next affordable one. Returns
 *  whether the side still has a work it could afford (if not, its builders march). */
function planWorks(w: MatchWorld, side: 0 | 1, next: { i: number }, busy: boolean): boolean {
  const rt = w.runtime;
  if (rt === null) return false;
  const offers = rt.worksOffers(side);
  const purse = rt.logisticsOf(side);
  const affordable = offers.some((o) => o.left > 0 && o.logistics <= purse);
  if (!affordable || busy) return affordable || busy;
  for (let k = 0; k < WORKS_ORDER.length; k++) {
    const typeId = WORKS_ORDER[(next.i + k) % WORKS_ORDER.length];
    const offer = offers.find((o) => o.typeId === typeId);
    if (offer === undefined || offer.left < 1 || offer.logistics > purse) continue;
    const pad = padFor(w, typeId, side);
    if (pad === null) continue;
    w.sim.queueCommand({ kind: 'raiseWorks', side, works: typeId, x: pad[0], y: pad[1], ids: [] });
    next.i = (next.i + k + 1) % WORKS_ORDER.length;
    return true;
  }
  return false;
}

export function playWorks(mapId: MapId, seed: number, on: boolean, capTicks = CAP_TICKS_DEFAULT): WorksGame {
  const w = buildMatchWorld(config(mapId, seed, on));
  if (on !== (w.runtime !== null)) throw new Error(`versus works probe: ${mapId} built ${w.runtime === null ? 'no' : 'a'} runtime with the option ${on ? 'on' : 'off'}`);
  const roomCap = matchCapTicks(mapId);
  const production = productionOf(w);
  const sideOfEnd: [0 | 1, 0 | 1] = [0, 1];
  const completed: [number, number] = [0, 0];
  const firstStarted: [number, number] = [-1, -1];
  const firstComplete: [number, number] = [-1, -1];
  const building: [number, number] = [0, 0]; // works charged or under construction, by side
  const planning: [boolean, boolean] = [on, on];
  const next = [{ i: 0 }, { i: 0 }];
  const done = (o: MatchResult, ticks: number): WorksGame => ({
    winner: o.kind === 'won' ? o.side : null,
    by: o.by === 'annihilation' || o.by === 'mutual' || o.by === 'stalemate' ? o.by : 'cap',
    ticks,
    completed,
    firstStarted,
    firstComplete,
    purse: [w.runtime?.logisticsOf(0) ?? -1, w.runtime?.logisticsOf(1) ?? -1],
  });
  for (let t = 0; t < capTicks; t++) {
    if (t % ORDER_EVERY_TICKS === 0) {
      for (const side of sideOfEnd) if (planning[side]) planning[side] = planWorks(w, side, next[side], building[side] > 0);
      // A side's builders stay home while its plan runs; everyone else marches.
      order(w.sim, (side) => livingOf(w.sim, side).filter((id) => !(planning[side] && builds(w.sim, id))), sideOfEnd);
    }
    const ev = matchTick(w);
    for (const e of ev.mission) {
      if (e.kind !== 'works' || e.side === undefined) continue;
      const s = e.side;
      if (e.phase === 'started') {
        building[s]++;
        if (firstStarted[s] < 0) firstStarted[s] = w.sim.tickCount;
      } else if (e.phase === 'complete') {
        building[s]--;
        completed[s]++;
        if (firstComplete[s] < 0) firstComplete[s] = w.sim.tickCount;
      } else if (e.phase === 'cancelled' || (e.phase === 'destroyed' && building[s] > 0)) {
        building[s]--;
      }
    }
    if (w.sim.tickCount % DECIDE_EVERY_TICKS === 0) {
      const o = outcomeOf(w.sim, w.sim.tickCount, unitCost, production, roomCap);
      if (o.kind !== 'ongoing') return done(o, w.sim.tickCount);
    }
  }
  const o = outcomeOf(w.sim, roomCap, unitCost, production, roomCap);
  if (o.kind === 'ongoing') throw new Error('the cap rule left a game ongoing');
  return done(o, w.sim.tickCount);
}

const mean = (xs: readonly number[]): string => (xs.length === 0 ? '-' : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1));
const secs = (ticks: readonly number[]): string => {
  const got = ticks.filter((t) => t >= 0);
  return got.length === 0 ? '-' : `${mean(got.map((t) => t / TICKS_PER_SECOND))} s (${got.length})`;
};

export function worksRow(mapId: MapId, on: boolean, games: readonly WorksGame[]): string {
  const n = games.length;
  const won = (s: 0 | 1): number => games.filter((g) => g.winner === s).length;
  const draws = games.filter((g) => g.winner === null).length;
  const by = (f: Finish): number => games.filter((g) => g.by === f).length;
  const pct = (k: number): string => `${((100 * k) / n).toFixed(0)}%`;
  return [
    mapId.padEnd(22),
    (on ? 'on' : 'off').padEnd(4),
    `${won(0)} (${pct(won(0))})`.padEnd(10),
    `${won(1)} (${pct(won(1))})`.padEnd(10),
    String(draws).padEnd(6),
    `${by('annihilation')}/${by('mutual')}/${by('stalemate')}/${by('cap')}`.padEnd(12),
    `${mean(games.map((g) => g.completed[0]))} : ${mean(games.map((g) => g.completed[1]))}`.padEnd(12),
    `${secs(games.map((g) => g.firstStarted[0]))} : ${secs(games.map((g) => g.firstStarted[1]))}`.padEnd(28),
    `${secs(games.map((g) => g.firstComplete[0]))} : ${secs(games.map((g) => g.firstComplete[1]))}`.padEnd(28),
    mean(games.map((g) => g.ticks / TICKS_PER_SECOND)),
  ].join(' ');
}

const flag = (args: readonly string[], name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** `--field-works`: the table. Report-only, exit 0; a game that contradicts its own arm (a runtime off, a works event
 *  with the option off, no work completed by either side in any ON game) is a probe fault, exit 2. */
export function worksMain(args: readonly string[]): number {
  const mapIds = (flag(args, 'maps')?.split(',') ?? WORKS_MAPS_DEFAULT) as MapId[];
  for (const id of mapIds) if (!(id in maps)) throw new Error(`--maps: "${id}" is not a shipped map`);
  const seeds = Number(flag(args, 'seeds') ?? WORKS_SEEDS_DEFAULT);
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('--seeds must be a whole number of at least 1');
  console.log(`versus field works probe: KDF v KDF annihilation, ${seeds} seeds per arm (seedOf 0..${seeds - 1}), report-only (balance parked)`);
  console.log('plan (on): builders stay home and raise aid post, workshop, outpost, medic station, intel centre in turn, one at a time,');
  console.log('           4 tiles ahead of their anchor, while the 1,000 purse lasts, then march; off: no runtime, everyone marches.');
  console.log(['map'.padEnd(22), 'arm'.padEnd(4), 'seat 0'.padEnd(10), 'seat 1'.padEnd(10), 'draws'.padEnd(6), 'ann/mut/stl/cap'.padEnd(12), 'works 0 : 1'.padEnd(12), 'first started 0 : 1 (games)'.padEnd(28), 'first complete 0 : 1 (games)'.padEnd(28), 'mean s'].join(' '));
  let fault = false;
  for (const mapId of mapIds) {
    for (const on of [false, true]) {
      const games: WorksGame[] = [];
      for (let n = 0; n < seeds; n++) games.push(playWorks(mapId, seedOf(n), on));
      console.log(worksRow(mapId, on, games));
      if (!on && games.some((g) => g.completed[0] + g.completed[1] > 0)) fault = true;
      if (on && games.every((g) => g.completed[0] + g.completed[1] === 0)) fault = true;
    }
  }
  if (fault) {
    console.error('versus works probe: SELF-CHECK FAILED (an off game built a work, or no on game built any)');
    return 2;
  }
  return 0;
}
