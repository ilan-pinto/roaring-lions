/**
 * The commander, slice 1 (GH-1391): a computer seat that USES the economy it has, TAKES AND HOLDS the income zones, and DEFENDS its camp.
 * Opt-in: `ComputerSeat` still plays `rush` unless it is given this (`ComputerSeatOptions.commander`); which one the lobby offers, and under
 * what name, is the lead's (HOLD FOR LEAD, the PR body).
 *
 * It is a player like any other. It reads the same fog-honest `SideView` the arena's models read, plus the PUBLIC income-zone board a human
 * reads off the HUD (`ZoneFact`, built from the runtime's zones: holders are public, the units standing in them stay behind the fog), and it
 * returns ordinary `Command`s. It names no sim column, reaches no sim method and writes no state: `computer-seat.test.ts` scans the seat for
 * that and this file is held to the same scan. Every decision is a plain heuristic over those facts. No vision or information cheat.
 *
 * Each decision, in this order, every idle unit being given to the FIRST task that wants it (so one unit never holds two orders):
 *   1. DEFEND. A contact in sight within `DEFEND_TILES` of the seat's own camp is a threat: every idle unit still at home attack-moves on the
 *      contact nearest the camp, instead of marching out. (`DEFEND_TILES` is `RUSH_HOME_TILES`, the script's own "at home" radius: no new number.)
 *   2. ZONES. Income zones the seat does not hold (nobody's, the enemy's, contested), nearest to its camp first: the idle units at home are
 *      shared out, one share per zone and one share left for the march (shares from counts, not a tuned size), and each share attack-moves to its
 *      zone. One unit standing idle INSIDE a zone the seat holds or contests is KEPT (the first by id; a zone is held by being stood in): neither
 *      this policy's march nor the seat's straggler sweep orders it away. That is "holds". The rest of its share rejoin the march.
 *   3. PRODUCTION. In a room with an economy (`view.economy`), each of the seat's living camps whose line has nothing waiting gets one `build`
 *      for the armed menu unit the seat is furthest below (own living + queued + in progress, over how many of that type it STARTED with, at
 *      least 1; ties by menu order; a unit the room would refuse now is passed over; the purse is spent down locally). Orders go through the
 *      desk as `Command`s, never as a sim write, and a built unit appears at the camp's exit, idle at home, where 1 to 2 and the march pick it up.
 *   4. THE GUARD. A unit the seat BUILT (it was not in the force the seat started with) and that stands idle at home stays there: it is the
 *      defending group, kept from the march and from the straggler sweep, and task 1 sends it out when a contact comes within `DEFEND_TILES`.
 *      With production off there is no guard, and a room with no economy never has one.
 *   5. THE MARCH. What is left is `rush`, untouched, over a view without the units tasks 1 to 4 took or kept.
 *
 * `CommanderOptions` switch tasks 1 to 3 off one at a time. They exist for the scenarios of the tests ("removing it changes the result"), and the
 * default is all on.
 */
import { fx, type Command } from '@lions/sim';
import { units } from '@lions/data';
import { RUSH_HOME_TILES, rush } from './policy';
import type { SideView } from './view';

/** The radius, in tiles, around the seat's own camp inside which a contact is a threat. HOLD FOR LEAD: it is the script's existing home radius, not a tuned value. */
export const DEFEND_TILES = RUSH_HOME_TILES;

/** Who holds a zone, from this seat's chair. */
export type ZoneHolderNow = 'mine' | 'theirs' | 'contested' | 'none';

/** One income zone as the HUD shows it to a human: public by design (the holder, never the units in it). */
export interface ZoneFact { zone: string; at: readonly [number, number, number, number]; holder: ZoneHolderNow; perMin: number }

export interface CommanderContext { zones: readonly ZoneFact[] }

export interface PolicyResult {
  commands: Command[];
  /** Units the seat's straggler sweep must leave where they stand (they hold a zone). */
  keep: ReadonlySet<number>;
}

export type CommanderPolicy = (view: SideView, ctx: CommanderContext) => PolicyResult;

export interface CommanderOptions { defend?: boolean; zones?: boolean; produce?: boolean; guard?: boolean; /** Zones on, but the idle units are not sent to take any (they still hold what they stand in). */ takeZones?: boolean }

const MAX_IDS_PER_COMMAND = 256;
const tileCentre = (t: number): number => fx.from(t + 0.5);
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ABLE_NOT = ['disarmed', 'immobile', 'routed'] as const;
const able = (flags: readonly string[]): boolean => !flags.some((f) => (ABLE_NOT as readonly string[]).includes(f));

/** A unit id that carries a weapon and is not a rescue unit (the outcome rule's own "armed"). */
const armed = (id: string): boolean => {
  const u = (units as Record<string, { weapons?: readonly unknown[]; rescue?: unknown } | undefined>)[id];
  return (u?.weapons?.length ?? 0) > 0 && u?.rescue === undefined;
};

const inside = (r: readonly [number, number, number, number], t: readonly number[]): boolean => t[0] >= r[0] && t[0] < r[0] + r[2] && t[1] >= r[1] && t[1] < r[1] + r[3];
const centre = (r: readonly [number, number, number, number]): [number, number] => [Math.floor(r[0] + r[2] / 2), Math.floor(r[1] + r[3] / 2)];

function march(ids: readonly number[], to: readonly [number, number], sweep: boolean): Command[] {
  const out: Command[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_COMMAND) {
    out.push({ kind: 'attackMove', ids: ids.slice(i, i + MAX_IDS_PER_COMMAND), x: tileCentre(to[0]), y: tileCentre(to[1]), ...(sweep ? { sweep: true } : {}) });
  }
  return out;
}

/** One commander per match: it remembers the force the seat started with, so a second match needs a second instance (a stabilised casualty who returns to view is, by id, a new unit, and joins the guard: accepted). */
export function createCommander(o: CommanderOptions = {}): CommanderPolicy {
  const defendOn = o.defend !== false;
  const zonesOn = o.zones !== false;
  const produceOn = o.produce !== false;
  const guardOn = o.guard !== false;
  const takeOn = o.takeZones !== false;
  /** What the seat started with, by type: captured at its first decision (the force it was handed), the weight production rebuilds toward. */
  let started: Map<string, number> | null = null;
  /** The ids of the force the seat started with: a unit not in it was built (the guard). */
  let startIds: Set<number> | null = null;

  return (view, ctx) => {
    if (started === null && view.units.length > 0) {
      started = new Map();
      for (const u of view.units) started.set(u.type, (started.get(u.type) ?? 0) + 1);
      startIds = new Set(view.units.map((u) => u.id));
    }
    const startMix = started ?? new Map<string, number>();
    const first = startIds ?? new Set<number>();
    const commands: Command[] = [];
    const taken = new Set<number>();
    const keep = new Set<number>();
    const home = (u: SideView['units'][number]): boolean => dist(u.tile, view.camp) <= RUSH_HOME_TILES;
    const idleHome = (): number[] => view.units.filter((u) => u.flags.includes('idle') && able(u.flags) && home(u) && !taken.has(u.id) && !keep.has(u.id)).map((u) => u.id);

    // 4. THE GUARD (decided first so tasks 2 and 5 leave it where it stands; task 1 may still send it out)
    const guard = new Set<number>();
    if (guardOn && view.economy !== undefined) {
      for (const u of view.units) if (!first.has(u.id) && u.flags.includes('idle') && able(u.flags) && home(u)) guard.add(u.id);
    }

    // 1. DEFEND
    if (defendOn) {
      let near: SideView['contacts'][number] | null = null;
      let best = Infinity;
      for (const c of view.contacts) {
        const d = dist(c.tile, view.camp);
        if (d <= DEFEND_TILES && d < best) { best = d; near = c; }
      }
      if (near !== null) {
        const ids = idleHome();
        if (ids.length > 0) {
          commands.push(...march(ids, near.tile, true));
          for (const id of ids) { taken.add(id); guard.delete(id); }
        }
      }
    }
    // What is still guard now stays: not offered to the zone shares, not marched, not swept.
    for (const id of guard) keep.add(id);

    // 2. ZONES: hold what is held, take what is not.
    if (zonesOn && ctx.zones.length > 0) {
      // One holder a zone: the first idle, able unit standing in it (by id). A zone is held by being stood in, so one is enough; the rest of a
      // share that took it rejoin the march (they are idle and not kept, so the march and the sweep pick them up).
      const held = new Set<string>();
      for (const u of view.units) {
        if (!u.flags.includes('idle') || !able(u.flags) || taken.has(u.id)) continue;
        const z = ctx.zones.find((x) => (x.holder === 'mine' || x.holder === 'contested') && inside(x.at, u.tile));
        if (z !== undefined && !held.has(z.zone)) { held.add(z.zone); keep.add(u.id); }
      }
      const wanted = ctx.zones.filter((z) => z.holder !== 'mine').sort((a, b) => dist(centre(a.at), view.camp) - dist(centre(b.at), view.camp));
      const ids = idleHome();
      if (takeOn && wanted.length > 0 && ids.length > 0) {
        // One share per zone and one for the march, from counts. At least one unit a share while units last.
        const share = Math.max(1, Math.floor(ids.length / (wanted.length + 1)));
        let at = 0;
        for (const z of wanted) {
          if (at >= ids.length) break;
          const mine = ids.slice(at, at + share);
          at += share;
          commands.push(...march(mine, centre(z.at), false));
          for (const id of mine) taken.add(id);
        }
      }
    }

    // 3. PRODUCTION
    if (produceOn && view.economy !== undefined) {
      const eco = view.economy;
      let purse = eco.purse;
      const have = new Map<string, number>();
      for (const u of view.units) have.set(u.type, (have.get(u.type) ?? 0) + 1);
      for (const l of eco.lines) {
        if (l.building !== null) have.set(l.building, (have.get(l.building) ?? 0) + 1);
        for (const q of l.queued) have.set(q, (have.get(q) ?? 0) + 1);
      }
      const weight = (id: string): number => Math.max(1, startMix.get(id) ?? 0);
      for (const l of eco.lines) {
        if (!l.alive || l.queued.length > 0) continue;
        const cands = eco.menu.filter((m) => m.blocked === undefined && armed(m.unit) && m.cost <= purse);
        // The lowest have/weight, compared by cross-multiplication (whole numbers); ties by menu order (the sort is stable).
        const order = [...cands].sort((a, b) => (have.get(a.unit) ?? 0) * weight(b.unit) - (have.get(b.unit) ?? 0) * weight(a.unit));
        const pick = order[0];
        if (pick === undefined) continue;
        commands.push({ kind: 'build', side: view.side, unit: pick.unit, line: l.line });
        purse -= pick.cost;
        have.set(pick.unit, (have.get(pick.unit) ?? 0) + 1);
      }
    }

    // 5. THE MARCH: rush over what is left.
    const free = view.units.filter((u) => !taken.has(u.id) && !keep.has(u.id));
    commands.push(...(rush({ ...view, units: free }) as Command[]));
    return { commands, keep };
  };
}
