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
 * SLICE 2 (GH-1391) adds two more, both OFF unless `CommanderOptions` turns them on (measured: neither raised the win rate, the PR body), both from what the seat's fog shows it and nothing else:
 *   0. THE SCOUT (before task 1). At its first decision the seat sends the fastest of the cheaper half of its free units (cost at or under the median, by
 *      the unit data; never its only unit, and nobody when the camps are no further apart than the standoff) with a `move` to a point `RUSH_HOME_TILES` short of the enemy camp, the anchor a human reads off the map, to look. It is kept
 *      out of the march and the sweep, and out of task 1. One scout, never replaced: what it saw is remembered, not re-sent for.
 *   3b. THE COUNTER (inside task 3). The seat remembers, per enemy type, the most of it ever in sight at once (`view.contacts`, nothing else), classed
 *      by `composition.ts` (armour = a hull only an anti-armour weapon can hurt; soft = any other armed ground unit). Seeing more armour than soft,
 *      it builds an anti-armour menu unit whose weapon beats the strongest front plate seen, until it has one for every armoured hull seen at once;
 *      seeing more soft than armour, an infantry-role menu unit until it has as many as the soft units seen at once; otherwise, and once that parity
 *      is met, the furthest-below-start-mix rule of slice 1. A counter nothing in the menu can supply falls through to that rule.
 *
 * SLICE 3 (GH-1391) adds RETREAT, OFF unless `CommanderOptions.retreat` is set, from the same view:
 *   0b. RETREAT (after the scout, before task 1). The engaged group is every able unit away from home (beyond `RUSH_HOME_TILES` of the camp) with a contact
 *      within `RUSH_HOME_TILES` of it. Each side is valued as the sum of `cost x hp` (the unit data's cost; hp is the view's percent; a contact is valued at the
 *      hp it shows), the foe being the contacts within that radius of any engaged unit. When the foe is worth strictly more, the whole engaged group is
 *      sent home with a `move` (not an attack-move: it stops fighting and walks) and is kept out of every other task, but only if it could win once joined by
 *      every other able unit and what the camps are building (own + those > foe): a group with nothing to join fights on. (First version, measured: no such
 *      test, 8787 retreats in 992 games, wins 665 to 598; GH-1391.) Home, it is REGROUPED, and released to
 *      the other tasks (so the march sends it out again: the re-engage) when what stands at home is worth at least the foe that beat it, or when nothing
 *      is queued or building that could add to it (a room with no economy); at once, all of it, when a contact comes within `DEFEND_TILES` of the camp
 *      (it defends). A member that cannot walk (disabled, routed, carried, garrisoned, underground), that stopped idle short of home or that has not moved a
 *      tile since the last decision is let go, so one cripple never holds the rest. All
 *      whole-number comparisons; no new tuned number.
 *
 * SLICE 4 (GH-1391) decides WHEN the march goes, OFF unless `CommanderOptions.mass` is set, from the same view (fog-visible contacts only):
 *   5. THE MARCH, MASSED. The seat is MASSING or COMMITTED. While massing, the units task 5 would send (idle at home) are held where they stand (kept from the
 *      march and from the straggler sweep). Its strength is the sum of `cost x hp` over its able units; the foe's is the largest sum over the contacts in sight at one
 *      decision, remembered after they leave sight (what it HAS SEEN: nothing it cannot see is read), and never less than what the seat started with (a matched
 *      room: the foe's first force is assumed to be its own, since a snapshot of the fog under-counts). It COMMITS (the march runs, as `rush`) when its strength is strictly greater than that,
 *      or, in a room with no economy, while it has seen nothing (there is nothing to wait for or to learn by waiting). It RE-PLANS after a lost engagement, which is the retreat's
 *      reading: the units away from home with a contact in reach are worth strictly less than the contacts around them. It then masses again until its
 *      strength is strictly greater than the same foe it commits on (the largest force it has now seen, never below its own first force). Units already
 *      out are never recalled (that is `retreat`), and only the idle units AT HOME are held: a zone share away from home still goes forward. Whole-number
 *      comparisons; no new tuned number. With it on, task 4 (the guard) is off: the army massed at home is the defending group, and a guard that never
 *      marches could never add to the edge the seat waits for.
 *
 * `CommanderOptions` switch tasks 1 to 3 off one at a time. They exist for the scenarios of the tests ("removing it changes the result"), and the
 * default is all on.
 */
import { fx, type Command } from '@lions/sim';
import { units } from '@lions/data';
import { RUSH_HOME_TILES, rush } from './policy';
import type { SideView } from './view';
import { antiArmourPenetrationOf, classOf, costOf, frontArmourOf, roleOf, speedOf } from './composition';

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

export interface CommanderOptions { defend?: boolean; zones?: boolean; produce?: boolean; guard?: boolean; /** Zones on, but the idle units are not sent to take any (they still hold what they stand in). */ takeZones?: boolean;
  /** Slice 2, OFF unless asked for (it did not pay in the probe, GH-1391): send a fast, cheaper unit to look at the enemy camp. */
  scout?: boolean;
  /** Slice 2, OFF unless asked for (it did not pay in the probe, GH-1391): build against what the seat has seen. */
  counter?: boolean;
  /** Slice 3, OFF unless asked for: pull a losing group back to the camp, regroup, and let the march send it out again. */
  retreat?: boolean;
  /** Slice 4, OFF unless asked for: hold the march until the seat's strength beats the strongest force it has seen, and mass again after a lost engagement. */
  mass?: boolean;
}

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

/** The point the scout goes to: `RUSH_HOME_TILES` short of the enemy camp, on the line back to the seat's own. Null when the camps are no further apart than that (there is no standoff to take). */
function standoff(own: readonly [number, number], enemy: readonly [number, number]): [number, number] | null {
  const d = dist(own, enemy);
  if (d <= RUSH_HOME_TILES) return null;
  return [Math.round(enemy[0] + ((own[0] - enemy[0]) * RUSH_HOME_TILES) / d), Math.round(enemy[1] + ((own[1] - enemy[1]) * RUSH_HOME_TILES) / d)];
}

function march(ids: readonly number[], to: readonly [number, number], sweep: boolean): Command[] {
  const out: Command[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_COMMAND) {
    out.push({ kind: 'attackMove', ids: ids.slice(i, i + MAX_IDS_PER_COMMAND), x: tileCentre(to[0]), y: tileCentre(to[1]), ...(sweep ? { sweep: true } : {}) });
  }
  return out;
}

/**
 * The menu units to build FROM against what has been seen, or null for the slice 1 rule. `peak` is per enemy type the most in sight at once; `have`
 * is the seat's own living + queued + in progress by type. Whole-number comparisons only.
 */
export function counterPool(menu: readonly string[], afford: ReadonlySet<string>, peak: ReadonlyMap<string, number>, have: ReadonlyMap<string, number>): Set<string> | null {
  let armour = 0;
  let soft = 0;
  let plate = 0;
  for (const [t, n] of peak) {
    const c = classOf(t);
    if (c === 'armour') { armour += n; plate = Math.max(plate, frontArmourOf(t)); }
    else if (c === 'soft') soft += n;
  }
  if (armour > soft) {
    // `menu` is every unit the room would let the seat build (priced or not): the answer is chosen from what the menu HAS, then bought only if affordable now.
    // Units whose round beats the strongest plate seen; if the menu has none, the ones with the strongest anti-armour round it has (a weaker hit is still a hit).
    const beats = menu.filter((u) => antiArmourPenetrationOf(u) > plate);
    let best = 0;
    for (const u of menu) best = Math.max(best, antiArmourPenetrationOf(u));
    const bar = beats.length > 0 ? plate : best - 1;
    const pool = menu.filter((u) => antiArmourPenetrationOf(u) > bar && best > 0);
    if (pool.length === 0) return null;
    // One for every armoured hull seen at once, counted over what the seat has (living, queued, in progress) that clears the same bar.
    let own = 0;
    for (const [t, n] of have) if (antiArmourPenetrationOf(t) > bar) own += n;
    if (own >= armour) return null;
    const now = pool.filter((u) => afford.has(u));
    return now.length > 0 ? new Set(now) : null; // none of the right kind affordable yet: the slice 1 rule builds something else meanwhile
  }
  if (soft > armour) {
    const pool = menu.filter((u) => roleOf(u) === 'infantry');
    if (pool.length === 0) return null;
    let own = 0;
    for (const [t, n] of have) if (roleOf(t) === 'infantry') own += n;
    if (own >= soft) return null;
    const now = pool.filter((u) => afford.has(u));
    return now.length > 0 ? new Set(now) : null;
  }
  return null;
}

/** One commander per match: it remembers the force the seat started with, so a second match needs a second instance (a stabilised casualty who returns to view is, by id, a new unit, and joins the guard: accepted). */
export function createCommander(o: CommanderOptions = {}): CommanderPolicy {
  const defendOn = o.defend !== false;
  const zonesOn = o.zones !== false;
  const produceOn = o.produce !== false;
  // Slice 4 replaces the guard: the army it masses at home IS the defending group (a guard that never marches could never add to the edge it waits for).
  const guardOn = o.guard !== false && o.mass !== true;
  const takeOn = o.takeZones !== false;
  const scoutOn = o.scout === true;
  const counterOn = o.counter === true;
  const retreatOn = o.retreat === true;
  const massOn = o.mass === true;
  /** Units ordered home and not yet released (slice 3), and the foe's value that beat them (`cost x hp`). */
  const retreating = new Set<number>();
  /** Where each retreating unit stood at the last decision: one that has not moved a tile since is stuck. */
  const lastTile = new Map<number, [number, number]>();
  let beatenBy = 0;
  /** Slice 4. Massing until the seat out-strengths what it has seen; the largest contact value seen at one decision; the seat's own first force, the assumed foe. */
  let massing = true;
  let seenPeakValue = 0;
  let startValue = 0;
  /** The scout's unit id once chosen (null before, and kept after it dies: it is never replaced). */
  let scoutId: number | null = null;
  /** The scout is chosen at one decision only, whether or not anyone qualified. */
  let scoutDecided = false;
  /** The tile the scout was last sent from. */
  let lastSentFrom: [number, number] | null = null;
  /** Per enemy type, the most of it ever in sight at one decision: what the seat has SEEN of the enemy's force. */
  const peak = new Map<string, number>();
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

    // What the fog shows now, folded into the memory of the most seen at once (task 3b reads it).
    const nowSeen = new Map<string, number>();
    for (const c of view.contacts) nowSeen.set(c.type, (nowSeen.get(c.type) ?? 0) + 1);
    for (const [t, n] of nowSeen) if (n > (peak.get(t) ?? 0)) peak.set(t, n);

    // 0. THE SCOUT: a fast, cheaper unit looks at the enemy camp from the script's home radius short of it; it is not given to any other task.
    if (scoutOn) {
      if (!scoutDecided && started !== null) {
        // Once, at the first decision with a force: the fastest of the cheaper half of the units free to go (cost at or under the median), so the slow
        // fire-support piece that is the cheapest is not the one sent. Never the only unit. If the camps are too close for a standoff, nobody goes.
        scoutDecided = true;
        const free = view.units.filter((u) => u.flags.includes('idle') && able(u.flags) && home(u) && speedOf(u.type) > 0);
        if (view.units.length >= 2 && free.length > 0 && standoff(view.camp, view.enemyCamp) !== null) {
          const costs = free.map((u) => costOf(u.type)).sort((x, y) => x - y);
          const median = costs[Math.floor((costs.length - 1) / 2)];
          let pick: SideView['units'][number] | null = null;
          for (const u of free) {
            if (costOf(u.type) > median) continue;
            const better = pick === null
              || speedOf(u.type) > speedOf(pick.type)
              || (speedOf(u.type) === speedOf(pick.type) && (costOf(u.type) < costOf(pick.type) || (costOf(u.type) === costOf(pick.type) && u.id < pick.id)));
            if (better) pick = u;
          }
          if (pick !== null) scoutId = pick.id;
        }
      }
      const s = scoutId === null ? undefined : view.units.find((u) => u.id === scoutId);
      const to = standoff(view.camp, view.enemyCamp);
      if (s !== undefined && to !== null) {
        keep.add(s.id); // kept units are offered to no task: not defend, not the zone shares, not the march, not the sweep
        // Idle short of the standoff: sent. Idle on the very tile it was last sent from is stuck (the point cannot be reached): not sent again.
        const stuck = lastSentFrom !== null && lastSentFrom[0] === s.tile[0] && lastSentFrom[1] === s.tile[1];
        if (s.flags.includes('idle') && able(s.flags) && dist(s.tile, to) > 1 && !stuck) {
          commands.push({ kind: 'move', ids: [s.id], x: tileCentre(to[0]), y: tileCentre(to[1]) });
          lastSentFrom = [s.tile[0], s.tile[1]];
        }
      }
    }

    // 0b. RETREAT: a group worth less than the foe in its face walks home, regroups there, and is let go again.
    if (retreatOn) {
      const worth = (type: string, hp: number): number => costOf(type) * hp;
      /** Cannot walk home whatever it is told: disabled, routed, carried, garrisoned or underground. Never engaged, and let go if it was. */
      const cannotWalk = (u: SideView['units'][number]): boolean => !able(u.flags) || u.held === 'routed' || u.held === 'immobilised' || u.held === 'carried' || u.held === 'garrisoned' || u.held === 'tunnel';
      // Those already walking home: forget the dead and the disabled; give back to the march one that stopped short of home (idle, away) and one that has
      // not moved a tile since the last decision (stuck, so it cannot hold the rest for ever).
      const byId = new Map(view.units.map((u) => [u.id, u]));
      for (const id of retreating) {
        const u = byId.get(id);
        const last = lastTile.get(id);
        if (u === undefined || cannotWalk(u) || (!home(u) && (u.flags.includes('idle') || (last !== undefined && last[0] === u.tile[0] && last[1] === u.tile[1])))) { retreating.delete(id); lastTile.delete(id); }
        else lastTile.set(id, [u.tile[0], u.tile[1]]);
      }
      // A contact at the camp ends the retreat: whoever is home defends it.
      if (view.contacts.some((c) => dist(c.tile, view.camp) <= DEFEND_TILES)) { retreating.clear(); lastTile.clear(); }
      const field = view.units.filter((u) => !cannotWalk(u) && u.id !== scoutId && !retreating.has(u.id) && !home(u));
      const engaged = field.filter((u) => view.contacts.some((c) => dist(c.tile, u.tile) <= RUSH_HOME_TILES));
      if (engaged.length > 0) {
        const own = engaged.reduce((a, u) => a + worth(u.type, u.hp), 0);
        const foe = view.contacts.filter((c) => engaged.some((u) => dist(c.tile, u.tile) <= RUSH_HOME_TILES)).reduce((a, c) => a + worth(c.type, c.hp), 0);
        // Worth walking home only to a fight that can be won once together: what the group is joined by (every other able unit, and what the camps
        // are building) must tip the balance. A group with nothing to join would only walk away from its shots and come back.
        const engagedIds = new Set(engaged.map((u) => u.id));
        let joins = view.units.filter((u) => able(u.flags) && !engagedIds.has(u.id)).reduce((acc, u) => acc + worth(u.type, u.hp), 0);
        for (const l of view.economy?.lines ?? []) {
          if (l.building !== null) joins += worth(l.building, 100);
          for (const q of l.queued) joins += worth(q, 100);
        }
        if (foe > own && own + joins > foe) {
          const ids = engaged.map((u) => u.id);
          for (let i = 0; i < ids.length; i += MAX_IDS_PER_COMMAND) {
            commands.push({ kind: 'move', ids: ids.slice(i, i + MAX_IDS_PER_COMMAND), x: tileCentre(view.camp[0]), y: tileCentre(view.camp[1]) });
          }
          for (const u of engaged) { retreating.add(u.id); lastTile.set(u.id, [u.tile[0], u.tile[1]]); }
          beatenBy = foe;
        }
      }
      if (retreating.size > 0) {
        const mine = view.units.filter((u) => retreating.has(u.id));
        const arrived = mine.every((u) => home(u) && !u.flags.includes('moving'));
        if (arrived) {
          const atHome = view.units.filter((u) => able(u.flags) && home(u)).reduce((a, u) => a + worth(u.type, u.hp), 0);
          const adding = view.economy !== undefined && view.economy.lines.some((l) => l.building !== null || l.queued.length > 0);
          if (atHome >= beatenBy || !adding) { retreating.clear(); lastTile.clear(); }
        }
        for (const id of retreating) keep.add(id);
      }
    }

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
        if (!u.flags.includes('idle') || !able(u.flags) || taken.has(u.id) || u.id === scoutId) continue;
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
        const counter = counterOn ? counterPool(eco.menu.filter((m) => m.blocked === undefined && armed(m.unit)).map((m) => m.unit), new Set(cands.map((m) => m.unit)), peak, have) : null;
        // The lowest have/weight, compared by cross-multiplication (whole numbers); ties by menu order (the sort is stable).
        const order = [...(counter === null ? cands : cands.filter((m) => counter.has(m.unit)))].sort((a, b) => (have.get(a.unit) ?? 0) * weight(b.unit) - (have.get(b.unit) ?? 0) * weight(a.unit));
        const pick = order[0];
        if (pick === undefined) continue;
        commands.push({ kind: 'build', side: view.side, unit: pick.unit, line: l.line });
        purse -= pick.cost;
        have.set(pick.unit, (have.get(pick.unit) ?? 0) + 1);
      }
    }

    // 5. THE MARCH: rush over what is left; with slice 4, only once the seat is committed.
    if (massOn) {
      const worthOf = (type: string, hp: number): number => costOf(type) * hp;
      if (startValue === 0) startValue = view.units.reduce((a, u) => a + worthOf(u.type, u.hp), 0);
      seenPeakValue = Math.max(seenPeakValue, view.contacts.reduce((a, c) => a + worthOf(c.type, c.hp), 0));
      const strength = view.units.filter((u) => able(u.flags)).reduce((a, u) => a + worthOf(u.type, u.hp), 0);
      // Never less than its own first force: a snapshot of the fog under-counts a matched foe (version 1 took the snapshot alone, attacked on a few units seen, and lost
      // the clock to a foe that had never been dented: wins 665 to 607).
      const foe = Math.max(seenPeakValue, startValue);
      if (massing) {
        // With no economy and nothing yet seen there is nothing to wait for or to learn by waiting: go. Once a foe has been seen the edge is required, whatever the room.
        if (strength > foe || (view.economy === undefined && seenPeakValue === 0)) massing = false;
      } else {
        // A lost engagement: the units away from home with a contact in reach are worth strictly less than the contacts around them. It masses again against the
        // same floor it commits on (`foe`, never below its own first force), so a snapshot it has seen cannot hold it committed where it would not have committed.
        const out = view.units.filter((u) => able(u.flags) && !home(u) && u.id !== scoutId && view.contacts.some((c) => dist(c.tile, u.tile) <= RUSH_HOME_TILES));
        if (out.length > 0) {
          const mine = out.reduce((a, u) => a + worthOf(u.type, u.hp), 0);
          const theirs = view.contacts.filter((c) => out.some((u) => dist(c.tile, u.tile) <= RUSH_HOME_TILES)).reduce((a, c) => a + worthOf(c.type, c.hp), 0);
          if (theirs > mine) massing = strength <= foe;
        }
      }
      if (massing) {
        for (const u of view.units) if (u.flags.includes('idle') && home(u) && !taken.has(u.id)) keep.add(u.id);
      }
    }
    const free = view.units.filter((u) => !taken.has(u.id) && !keep.has(u.id));
    commands.push(...(rush({ ...view, units: free }) as Command[]));
    return { commands, keep };
  };
}
