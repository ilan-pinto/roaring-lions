/**
 * One tick of events, turned into the few things worth telling a commander
 * about. Pure: no DOM, no `Sim`, no clock of its own -- everything it needs
 * about the world arrives through `AlertWorld`, so the whole model is
 * node-testable and a caller can hand it a fixture instead of a battle.
 *
 * Three jobs, and the middle one is the point:
 *
 *  - CLASSIFY. A tick's `SimEvent`s and `MissionEvent`s say a great many
 *    things; three of them are worth an alert -- a unit lost, a unit taking
 *    fire, an objective moving.
 *  - COALESCE. A transport dying disembarks its riders hurt and kills some of
 *    them in the SAME tick, so several `unitLost` events arrive together. One
 *    line per unit TYPE per tick, with a count, is the answer: a squad wipe
 *    reads "Rifle squad lost (3)" rather than three identical lines, and a
 *    burst spanning two types is two lines by design, because "you lost 4
 *    things" tells a commander nothing he can act on.
 *  - COOL DOWN. Under fire is a CONDITION, not an event, and the sim reports
 *    it as one `fire` per round. Without a per-entity cooldown the feed is a
 *    firehose that says the same thing forty times a second.
 *
 * Two exclusions, both deliberate.
 *
 * `nearMiss` is not read at all. It carries `shooter`, `weaponId`, `x` and
 * `y` and NO target (`packages/sim/src/sim.ts`, the `nearMiss` member of
 * `SimEvent`) -- so it cannot name a victim without a spatial query this
 * model has no world for. `fire` and `impact` both carry `target`, and that
 * is the whole of the under-fire signal here.
 *
 * A unit lost this tick raises no under-fire alert, even though the round
 * that killed him lands in the same tick and is in the same array. The loss
 * is the louder fact; two lines for one event is exactly the noise this
 * model exists to stop.
 *
 * No `t()` call in this file. It returns catalogue KEYS and params, and the
 * caller resolves them where it renders -- the convention
 * `selection-model.ts`'s `ORDERS[].label` and `input/keymap.ts`'s
 * `ACTIONS[].label` already follow, for the identical reason: a table
 * resolved at import time freezes in whatever locale was active before
 * `main.ts`'s boot ever calls `setCatalogue`.
 */

import type { MissionEvent, SimEvent } from '@lions/sim';
import type { Tone } from './hud-model';

/** A line for the feed, as a catalogue key and its params -- never wording.
 *  `tone` is semantic and never a colour (`hud-model.ts`'s own rule). */
export interface AlertLine {
  key: string;
  params: Readonly<Record<string, string | number>>;
  tone: Tone;
}

export interface Alert {
  kind: 'unitLost' | 'underFire' | 'objective';
  /** The feed line, or `null` when another part of the HUD owns the wording
   *  -- an objective's text is `describeMissionEvent`'s, not this model's. */
  line: AlertLine | null;
  sound: 'ui_alert' | 'ui_objective' | null;
  /** Where the camera jumps when the player acts on the alert, in tiles, or
   *  `null` when nothing on the map can be pointed at. */
  at: { x: number; y: number } | null;
  /** How many events this one alert stands for. */
  count: number;
}

/** Everything about the world this model may ask, and nothing more. Kept
 *  structural so a test supplies four functions rather than a `Sim`. */
export interface AlertWorld {
  posOf(entity: number): { x: number; y: number } | null;
  sideOf(entity: number): number;
  unitName(typeId: string): string;
  objectiveAt(id: string): { x: number; y: number } | null;
}

/** What has to survive between ticks: when each entity last made the feed.
 *  Read-only on the way in and copy-on-write on the way out, so a caller
 *  holding an older state cannot have it changed underneath. */
export interface AlertState {
  readonly lastUnderFire: ReadonlyMap<number, number>;
}

/**
 * Five seconds at the sim's 20 Hz tick.
 *
 * A number rather than "once per engagement" because an engagement has no
 * end this function can see: it is handed one tick's events and no history
 * beyond a map of stamps, and nothing in the sim's event stream says "that
 * firefight is over". A fixed window is the only thing a pure function can
 * answer with, and five seconds is long enough that a sustained burst is one
 * line while a unit pinned for a minute still speaks up a dozen times.
 */
export const UNDER_FIRE_COOLDOWN_TICKS = 100;

export function initAlertState(): AlertState {
  return { lastUnderFire: new Map() };
}

export function alertsForTick(
  state: AlertState,
  sim: readonly SimEvent[],
  mission: readonly MissionEvent[],
  world: AlertWorld,
  tick: number,
): { state: AlertState; alerts: Alert[] } {
  // --- the mission half: what was lost, and what moved ---------------------
  const lostByType = new Map<string, number[]>();
  const lostEntities = new Set<number>();
  const objectives: string[] = [];
  for (const e of mission) {
    if (e.kind === 'unitLost') {
      const group = lostByType.get(e.unit);
      if (group) group.push(e.entity);
      else lostByType.set(e.unit, [e.entity]);
      lostEntities.add(e.entity);
    } else if (e.kind === 'objective') {
      objectives.push(e.id);
    }
  }

  // --- the sim half: who is being shot at ---------------------------------
  // Ordered and de-duplicated: the first entity to take a round is the one
  // the camera jumps to, and a unit hit six times is still one unit.
  const underFire: number[] = [];
  const seen = new Set<number>();
  for (const e of sim) {
    if (e.kind !== 'fire' && e.kind !== 'impact') continue;
    const target = e.target;
    // -1 is a round aimed at a building rather than at anybody -- `fire`'s
    // own field doc in `SimEvent`.
    if (target < 0) continue;
    // An enemy under fire is good news, and nobody needs telling about it.
    if (world.sideOf(target) !== 0) continue;
    // He is already the subject of a `unitLost` line this same tick.
    if (lostEntities.has(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    underFire.push(target);
  }

  const kept = underFire.filter(
    (entity) => tick - (state.lastUnderFire.get(entity) ?? -Infinity) >= UNDER_FIRE_COOLDOWN_TICKS,
  );

  // Copy-on-write, and the old object back untouched when nothing was
  // stamped -- so a caller can compare identity to know the tick was quiet.
  let nextState = state;
  if (kept.length > 0) {
    const lastUnderFire = new Map(state.lastUnderFire);
    for (const entity of kept) lastUnderFire.set(entity, tick);
    nextState = { lastUnderFire };
  }

  // --- emit, loudest first ------------------------------------------------
  const alerts: Alert[] = [];
  for (const [typeId, entities] of lostByType) {
    alerts.push({
      kind: 'unitLost',
      line: {
        key: 'alert.unitLost',
        params: { name: world.unitName(typeId), n: entities.length },
        tone: 'bad',
      },
      sound: 'ui_alert',
      at: world.posOf(entities[0]),
      count: entities.length,
    });
  }
  if (kept.length > 0) {
    alerts.push({
      kind: 'underFire',
      line: { key: 'alert.underFire', params: { n: kept.length }, tone: 'warn' },
      sound: 'ui_alert',
      at: world.posOf(kept[0]),
      count: kept.length,
    });
  }
  for (const id of objectives) {
    alerts.push({
      kind: 'objective',
      line: null,
      sound: 'ui_objective',
      at: world.objectiveAt(id),
      count: 1,
    });
  }

  return { state: nextState, alerts };
}
