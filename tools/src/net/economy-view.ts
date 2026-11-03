/**
 * What the skirmish economy shows the seat that plays it, as data (GH-954, D-W8): the same facts the browser's
 * dock and strip show the viewer, and no others. Present only in an economy room (`MatchWorld.runtime` is not
 * null: KDF against Sarim). It is the viewer's OWN side throughout -- its purse, its camps' queues and rally
 * points, its menu -- so nothing here reads past the seat's fog. A pure read: it writes nothing to the sim.
 *
 * `productionRefusal` is the same facts turned into the sentence an `order` refusal carries. It decides nothing:
 * the runtime's own pre-checks (`canBuild`, `buildBlockedReason`, `canSetRally`, and the line snapshot the dock
 * draws its rows from) speak, and this words them. The authoritative drop is still `applyQueued`'s, a frame later.
 */
import { doctrines } from '@lions/data';
import type { Command } from '@lions/sim';
import { versusUnitInfo, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { roomEconomyView } from '../../../packages/app/src/net/room-economy';

/** One camp's production line, as `productionLines(side)` snapshots it. `line` is the index every production order carries. */
export interface LineLine {
  line: number;
  /** False once the camp has fallen: the line keeps its index and holds nothing. */
  alive: boolean;
  /** Where its units appear (and walk on from, unless a rally point says otherwise). */
  tile: [number, number];
  /** The unit in production, or null. `cancelBuild` index -1 is this item. */
  building: string | null;
  /** Percent of the item in progress that is done. */
  progress: number;
  /** Whole seconds until the item in progress is out. */
  secondsLeft: number;
  /** True while an enemy on the ground stands at the camp's exit: the clock is frozen. */
  contested: boolean;
  /** Waiting behind it, in order: `cancelBuild` index 0 is the first of these. */
  queued: string[];
  /** The rally point (a tile) new units walk to, or null. */
  rally: [number, number] | null;
}

/** One doctrine-menu entry. `blocked` is present when `build` would refuse it now, and says why. */
export interface MenuLine { unit: string; cost: number; population: number; buildSeconds: number; blocked?: string }

export interface EconomyView {
  /** Logistics you can spend now. */
  purse: number;
  /** What your held income zones pay a minute. */
  perMin: number;
  /** Population used and its cap, or null when uncapped. */
  population: { used: number; cap: number } | null;
  lines: LineLine[];
  menu: MenuLine[];
}

const TICKS_PER_SECOND = 20;

/** The seat's economy, or null when the room has none (a mirror room). */
export function economyView(w: MatchWorld, side: 0 | 1): EconomyView | null {
  const rt = w.runtime;
  if (rt === null) return null;
  const faction = w.factions[side];
  const info = versusUnitInfo([doctrines[w.factions[0]].menu, doctrines[w.factions[1]].menu]);
  const purse = rt.logisticsOf(side);
  const menu: MenuLine[] = [];
  for (const unit of doctrines[faction].menu) {
    const i = info(unit, side);
    if (i === null) continue; // a menu id the room's roster does not field: the runtime refuses it as well
    const line: MenuLine = { unit, cost: i.logistics, population: i.population, buildSeconds: i.buildTimeS };
    const why = buildRefusal(w, side, unit);
    if (why !== null) line.blocked = why;
    menu.push(line);
  }
  const lines: LineLine[] = rt.productionLines(side).map((l, line) => ({
    line,
    alive: l.alive,
    tile: [l.exit[0] >> 16, l.exit[1] >> 16],
    building: l.current,
    progress: Math.round(l.progress / 10),
    secondsLeft: Math.ceil(l.ticksLeft / TICKS_PER_SECOND),
    contested: l.contested,
    queued: l.items,
    rally: l.rally === null ? null : [l.rally[0] >> 16, l.rally[1] >> 16],
  }));
  const strip = roomEconomyView(rt, side, faction);
  return { purse, perMin: strip.ratePerMin, population: rt.populationView(side), lines, menu };
}

/** Why `build` would refuse `unit` now (on `line`, or the shortest queue), in the runtime's own words, or null. */
export function buildRefusal(w: MatchWorld, side: 0 | 1, unit: string, line?: number): string | null {
  const rt = w.runtime;
  if (rt === null) return 'this room has no production';
  if (rt.canBuild(unit, line, side)) return null;
  if (line !== undefined && rt.productionLines(side)[line]?.alive !== true) return lineRefusal(w, side, line);
  const why = rt.buildBlockedReason(unit, side);
  if (why !== null) return why;
  // The runtime checks the purse last, and `buildBlockedReason` does not speak of it.
  const cost = versusUnitInfo([doctrines[w.factions[0]].menu, doctrines[w.factions[1]].menu])(unit, side)?.logistics;
  return cost === undefined ? 'not available in the field' : `not enough logistics (costs ${cost}, you have ${rt.logisticsOf(side)})`;
}

function lineRefusal(w: MatchWorld, side: 0 | 1, line: number): string {
  const lines = w.runtime?.productionLines(side) ?? [];
  if (lines[line] === undefined) return `no such line (yours are 0-${lines.length - 1})`;
  return 'that camp has fallen';
}

/**
 * Why the runtime would set the production order `cmd` aside unspent, or null when it would take it. For the four
 * production kinds only; any other command answers null. Advisory, like every pre-check here: `applyQueued` decides.
 */
export function productionRefusal(w: MatchWorld, side: 0 | 1, cmd: Command): string | null {
  const rt = w.runtime;
  if (rt === null) return null; // ownership already said no to a room without production
  switch (cmd.kind) {
    case 'build':
      return buildRefusal(w, side, cmd.unit, cmd.line);
    case 'setRally':
      if (rt.canSetRally(cmd.line, cmd.x, cmd.y, side)) return null;
      return rt.productionLines(side)[cmd.line]?.alive === true ? 'the rally point must be an open tile (not a building, ridge or boulder)' : lineRefusal(w, side, cmd.line);
    case 'clearRally':
      return rt.productionLines(side)[cmd.line]?.alive === true ? null : lineRefusal(w, side, cmd.line);
    case 'cancelBuild': {
      const l = rt.productionLines(side)[cmd.line];
      if (l?.alive !== true) return lineRefusal(w, side, cmd.line);
      if (cmd.index === -1) return l.current === null ? 'nothing is in production on that line' : null;
      return cmd.index < l.items.length ? null : `nothing is queued at index ${cmd.index} (${l.items.length} waiting)`;
    }
    default:
      return null;
  }
}
