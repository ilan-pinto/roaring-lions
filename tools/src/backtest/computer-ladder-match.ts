// GH-1389: one match of the computer ladder, headless, down the battlefield's own path.
//
// The computer is the shipped computer seat (`offlineMatch`: the arena's `rush` plus `sweepStragglers`, its own fog, the
// order desk), at a level from data/computer/levels.json, as the lobby would arm it. The player is seat 0 at the friendly
// end, driven by a scripted PLAN that reads only its own fog-honest `SideView` and issues ordinary `Command`s through the
// same order desk the computer uses, queued on the transport as a human's clicks are. Frames run through `runFrames`
// (`applyFrame`'s ownership check, the hash-tick outcome); the match is decided by `decideOnHashTick` or, at the room's
// own cap, by that same rule asked at the cap. Nothing here writes sim state.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchCapTicksOf } from '@lions/net';
import { fx, type Command } from '@lions/sim';
import { computerLevels, withholdOf, type ComputerLevelCatalogue, type ComputerLevelId } from '@lions/data';
import { VERSUS_KDF, versusForceOf } from '../../../packages/app/src/net/versus-force';
import { levelBoosts } from '../../validate_computer_levels.mjs';
import { LADDER_LEVELS, type LadderCells, type LevelStatement } from './computer-ladder-gate';
import { offlineMatch, HUMAN_SEAT, COMPUTER_SEAT, type OfflineRequest } from '../../../packages/app/src/net/offline-match';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { runFrames, seatWorldFor } from '../../../packages/app/src/net/frame-step';
import { decideOnHashTick, goalsOf, productionOf, type LocalDecision } from '../../../packages/app/src/net/outcome';
import { FogTracker } from '../../../packages/app/src/net/computer/fog-tracker';
import { OrderDesk } from '../../../packages/app/src/net/computer/order-desk';
import { sideView, type SideView } from '../../../packages/app/src/net/computer/view';
import { passive, rush, REALTIME_EVERY_TICKS } from '../../../packages/app/src/net/computer/policy';

/** The three player plans the ladder plays each level against (GH-1389). */
export const PLAN_IDS = ['passive', 'rush', 'sensible'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

const MAX_IDS = 256;
/** `sensible` holds until this tick (2 minutes) unless it sees the enemy first. */
export const SENSIBLE_HOLD_TICKS = 2400;

/**
 * `sensible`: what a careful player does against an opponent who comes at them. Hold the start position (the defender's
 * ground, which GH-1388's sweep measured as the stronger side on tel_marum) until the enemy is SEEN or two minutes pass;
 * then attack-move every idle, able unit on the contact nearest its own centroid, else on the enemy camp a human reads off
 * the map. Every decision, so no unit is left standing once the fight is on. Reads only the view: no clock but the view's
 * tick, no randomness.
 */
export function sensible(view: SideView): Command[] {
  const able = view.units.filter((u) => u.flags.includes('idle') && !u.flags.some((f) => f === 'disarmed' || f === 'immobile' || f === 'routed'));
  if (able.length === 0) return [];
  if (view.contacts.length === 0 && view.tick < SENSIBLE_HOLD_TICKS) return [];
  let cx = 0;
  let cy = 0;
  for (const u of able) { cx += u.tile[0]; cy += u.tile[1]; }
  cx /= able.length;
  cy /= able.length;
  let [tx, ty] = view.enemyCamp;
  let best = Infinity;
  for (const c of view.contacts) {
    const d = (c.tile[0] - cx) ** 2 + (c.tile[1] - cy) ** 2;
    if (d < best) { best = d; tx = c.tile[0]; ty = c.tile[1]; }
  }
  const ids = able.map((u) => u.id);
  const out: Command[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS) out.push({ kind: 'attackMove', ids: ids.slice(i, i + MAX_IDS), x: fx.from(tx + 0.5), y: fx.from(ty + 0.5), sweep: true });
  return out;
}

export const PLANS: Readonly<Record<PlanId, (view: SideView) => Command[]>> = {
  passive: passive as (view: SideView) => Command[],
  rush: rush as (view: SideView) => Command[],
  sensible,
};

/** The player's seat: its own fog, its plan every `REALTIME_EVERY_TICKS` (the computer's cadence), its own order desk. */
class PlanSeat {
  private readonly fog: FogTracker;
  private fogged = 0;
  private readonly out: Command[] = [];
  private readonly desk = new OrderDesk((cmd) => { this.out.push(cmd); });
  constructor(private readonly world: MatchWorld, private readonly side: 0 | 1, private readonly plan: (v: SideView) => Command[]) {
    this.fog = new FogTracker(world.sim, side);
  }
  commandsFor(tick: number): Command[] {
    while (this.fogged < tick) { this.fog.step(); this.fogged++; }
    if (tick > 0 && tick % REALTIME_EVERY_TICKS === 0) {
      for (const cmd of this.plan(sideView(this.world, this.side, this.fog, null))) this.desk.submit(cmd, tick);
    }
    this.desk.onTick(tick);
    return this.out.splice(0);
  }
}

export type MatchVerdict = 'computer' | 'player' | 'draw';

export interface MatchRun {
  map: string;
  level: ComputerLevelId | null;
  plan: PlanId;
  seed: number;
  verdict: MatchVerdict;
  by: string;
  ticks: number;
}

/** One match: the player on `plan` against the computer at `level` (null: no level, today's computer), on `map`. */
export function playMatch(map: string, level: ComputerLevelId | null, plan: PlanId, seed: number): MatchRun {
  const req: OfflineRequest = { map, matchup: 'mirror', callsign: 'Plan', computerName: 'Computer', build: 'ladder+0', seed, ...(level === null ? {} : { level }) };
  const { transport, config } = offlineMatch(req);
  const world = buildMatchWorld(config);
  transport.attach(world);
  const player = new PlanSeat(world, config.seats[HUMAN_SEAT].side, PLANS[plan]);
  const cap = matchCapTicksOf(config);
  let decided: LocalDecision | null = null;
  const step = {
    transport, sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config,
    runTick: () => { matchTick(world); },
    runtimeDigest: () => world.runtime?.digest() ?? 0,
    stopAfter: (tick: number): boolean => {
      decided = decideOnHashTick(decided, tick, config, world.sim, productionOf(world), goalsOf(world));
      return decided !== null;
    },
  };
  while (decided === null && world.sim.tickCount <= cap) {
    for (const c of player.commandsFor(world.sim.tickCount)) transport.queueCommand(c);
    if (runFrames(step, 1).ran === 0) break;
  }
  const d = decided as LocalDecision | null;
  const computerSide = config.seats[COMPUTER_SEAT].side;
  let verdict: MatchVerdict = 'draw';
  let by = 'none';
  if (d !== null) {
    by = String(d.result.by);
    if (d.result.kind !== 'draw' && 'side' in d.result) verdict = d.result.side === computerSide ? 'computer' : 'player';
  }
  return { map, level, plan, seed, verdict, by, ticks: world.sim.tickCount };
}

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

function unitCosts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of readdirSync(join(ROOT, 'data', 'units'), { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const u = JSON.parse(readFileSync(join(e.parentPath, e.name), 'utf8')) as { id?: string; cost?: { logistics?: number } };
    if (u.id !== undefined && typeof u.cost?.logistics === 'number') out.set(u.id, u.cost.logistics);
  }
  return out;
}

/** What each level states, derived from its data: the force share it fields (by value, from the placed force it really
 *  spawns), what it leaves at home, and `levelBoosts`' reading of its keys. */
export function levelStatements(catalogue: ComputerLevelCatalogue = computerLevels): LevelStatement[] {
  const cost = unitCosts();
  const value = (force: readonly (readonly [string, number, number])[]): number => force.reduce((v, [id]) => v + (cost.get(id) ?? 0), 0);
  const whole = value(VERSUS_KDF);
  return catalogue.levels.map((l) => {
    const w = withholdOf(l);
    const b = levelBoosts(l);
    const fielded = value(versusForceOf('kdf', w));
    const withheld = Object.entries(w).map(([id, n]) => `${n} ${id}`).join(', ');
    return { level: l.id, forceShare: fielded / whole, withheld: withheld === '' ? 'nothing' : withheld, income: b.income, vision: b.vision };
  });
}

export function tally(runs: readonly MatchRun[]): LadderCells {
  const cells: LadderCells = {};
  for (const r of runs) {
    const level = r.level as (typeof LADDER_LEVELS)[number];
    cells[r.map] ??= {};
    cells[r.map][r.plan] ??= { easy: { computer: 0, player: 0, draw: 0 }, medium: { computer: 0, player: 0, draw: 0 }, hard: { computer: 0, player: 0, draw: 0 } };
    cells[r.map][r.plan][level][r.verdict]++;
  }
  return cells;
}

