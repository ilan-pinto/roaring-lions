/**
 * One tick of events, turned into the few things worth telling a commander
 * about. Pure: no DOM, no `Sim`, no clock of its own -- everything it needs
 * about the world arrives through `AlertWorld`, so the whole model is
 * node-testable and a caller can hand it a fixture instead of a battle.
 *
 * Four jobs, and the middle two are the point:
 *
 *  - CLASSIFY. A tick's `SimEvent`s and `MissionEvent`s say a great many
 *    things; a few are worth an alert -- a unit lost, a unit taking fire, an
 *    objective moving, (WP-P5) something ARRIVING: an enemy wave, a unit
 *    from the dock, a scripted reinforcement, and (PA-19) an enemy the
 *    player's own units killed. Each gets a TIER --
 *    minor / important / major (audit pass C3, and the same three names the
 *    audio plan's cue tiers use, `docs/polish/audio-plan.md` §3 and D-A2) --
 *    which the feed styles by and the jump key ranks by.
 *  - SAY WHO AND WHERE (WP-P5, PA-06). Every line names the unit and a
 *    `Place` (`alert-place.ts`): "in view", or a compass bearing from the
 *    camera. "under fire — 1 unit" told a commander that something,
 *    somewhere, was wrong; he could not act on it.
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

import type { MissionEvent, ObjectiveStatus, SimEvent } from '@lions/sim';
import { TICKS_PER_SECOND } from '@lions/sim';
import { distinctPlaces, type Place } from './alert-place';
import { ALERT_CUE, OBJECTIVE_CUE, type CueId } from './cues';
import type { Tone } from './hud-model';

/**
 * How loud an event is (audit pass C3; B1's Level 1 is `important` and
 * `major`). The names are shared with the audio cue tiers on purpose -- one
 * vocabulary for what the player hears and what the feed shows:
 *
 *  - `minor`: under fire, a man pinned; an enemy on foot killed (PA-19);
 *    an arrival of ours, dock or scripted (VR-37). Glanceable,
 *    never nagging.
 *  - `important`: a foot unit lost, an enemy wave, a new tasking, a man or a
 *    civilian taken, an ambush (VR-37),
 *    a Conduct penalty, one of ours broken, one of our vehicles immobilised
 *    or its gun knocked out (pass C2/C4, A1) -- something went wrong or
 *    changed, and here is where.
 *  - `major`: a vehicle, an aircraft or a named veteran lost; an enemy
 *    vehicle or aircraft killed (PA-19); an objective completed or failed;
 *    the mission ending -- a fact that changes the plan.
 */
export type AlertTier = 'minor' | 'important' | 'major';

export const TIER_RANK: Readonly<Record<AlertTier, number>> = { minor: 0, important: 1, major: 2 };

/** A line for the feed, as a catalogue key and its params -- never wording.
 *  `tone` is semantic and never a colour (`hud-model.ts`'s own rule).
 *  `place` is worded where the line is rendered (`alertNotice` resolves it
 *  into the `{place}` param), for the same import-time-locale reason this
 *  file never calls `t()`. */
export interface AlertLine {
  key: string;
  params: Readonly<Record<string, string | number>>;
  tone: Tone;
  place?: readonly Place[];
}

export interface Alert {
  kind: 'unitLost' | 'kill' | 'underFire' | 'objective' | 'wave' | 'arrival' | 'pinned' | 'ambush' | 'removed' | 'roe' | 'broken' | 'damaged' | 'tunnel';
  tier: AlertTier;
  /** Good or bad, as the minimap ring wears it (VR-36): the line's own tone
   *  where there is a line, and for a lineless alert the tone its line would
   *  have had -- an objective by its status, a man taken `bad`, a pinned man
   *  `warn`. Semantic, never a colour (`hud-model.ts`'s rule). */
  tone: Tone;
  /** The feed line, or `null` when another part of the HUD owns the wording
   *  -- an objective's text is `describeMissionEvent`'s, not this model's. */
  line: AlertLine | null;
  /** The cue the mixer plays for it (polish pass F, `cues.ts` ->
   *  `data/audio.json`), or null. An alert's cue is its TIER's
   *  (`ALERT_CUE`), so what the feed shows and what the player hears are one
   *  vocabulary; an objective sounds its own status instead (new, complete
   *  and failed are three cues), and an arrival is silent -- the announcer
   *  and the dock carry it. The caller plays one cue a tick (`tickCue`). */
  cue: CueId | null;
  /** Where the camera jumps when the player acts on the alert, in tiles, or
   *  `null` when nothing on the map can be pointed at. */
  at: { x: number; y: number } | null;
  /** Every point the minimap should flash: `at` and, for a wave that enters
   *  from several markers at once, each of the others. */
  marks: readonly { x: number; y: number }[];
  /** How many events this one alert stands for. */
  count: number;
}

/** A mission wave as the alert layer needs it: a structural subset of
 *  `MissionJson`'s `enemy.waves[]`, so a test can hand it a literal. */
export interface AlertWave {
  at_seconds: number;
  trigger?: string;
  units: readonly { count: number; from?: string }[];
}

/** Everything about the world this model may ask, and nothing more. Kept
 *  structural so a test supplies plain functions rather than a `Sim`. */
export interface AlertWorld {
  posOf(entity: number): { x: number; y: number } | null;
  sideOf(entity: number): number;
  /** The unit type id an entity is (`sim.unitTypes[typeIdx].id`). */
  typeOf(entity: number): string;
  unitName(typeId: string): string;
  objectiveAt(id: string): { x: number; y: number } | null;
  /** WP-P5: where a tile point lies from the camera, right now. */
  placeOf(x: number, y: number): Place;
  /** WP-P5: how heavy a loss of this unit is -- `major` for a vehicle, an
   *  aircraft or a named veteran, `important` for anything on foot. PA-19
   *  reads it for an enemy kill too: `major` there is a vehicle or an
   *  aircraft, and anything else is a minor line. */
  lossTier(entity: number, typeId: string): AlertTier;
  /** WP-P5: the mission's waves, in authored order (`[]` without one). */
  waves: readonly AlertWave[];
  /** WP-P5: is this objective complete now -- the gate a `trigger` wave
   *  waits on (`MissionRuntime.stepWaves`). */
  objectiveDone(id: string): boolean;
  /** WP-P5: a named map marker, in tiles, or null. */
  markerAt(name: string): { x: number; y: number } | null;
  /** WP-P5: the unit the dock just delivered -- the newest living side-0
   *  unit of this type -- in tiles, or null. */
  arrivedAt(typeId: string): { x: number; y: number } | null;
  /** WP-P5: for a LABELLED `reinforce` trigger, its label and where its
   *  units arrive; null for any other trigger. */
  reinforcement(triggerId: string): { label: string; points: readonly { x: number; y: number }[] } | null;
}

/** What has to survive between ticks. Read-only on the way in and
 *  copy-on-write on the way out, so a caller holding an older state cannot
 *  have it changed underneath. */
export interface AlertState {
  /** When each entity last made the feed as under fire. */
  readonly lastUnderFire: ReadonlyMap<number, number>;
  /** Indices into `AlertWorld.waves` already announced. */
  readonly wavesSeen: ReadonlySet<number>;
  /** The tick the pinned cue last sounded (polish pass F), for its own
   *  cooldown. */
  readonly lastPinned: number;
  /** GH-471: tunnel routes whose discovery has been announced this mission. */
  readonly tunnelsAnnounced: ReadonlySet<number>;
}

/**
 * Five seconds at the sim's 20 Hz tick.
 *
 * A number rather than "once per engagement" because an engagement has no
 * end this function can see: it is handed one tick's events and no history
 * beyond a map of stamps, and nothing in the sim's event stream says "that
 * firefight is over". A fixed window is the only thing a pure function can
 * answer with, and five seconds is long enough that a sustained burst is one
 * line while a unit pinned for a minute still speaks up a dozen times --
 * each of which the feed now merges into the line already saying so
 * (`feed-model.ts`), rather than stacking.
 */
export const UNDER_FIRE_COOLDOWN_TICKS = 100;

export function initAlertState(): AlertState {
  return { lastUnderFire: new Map(), wavesSeen: new Set(), lastPinned: -Infinity, tunnelsAnnounced: new Set() };
}

/** A man pinned sounds the minor cue at most once in four seconds, whoever
 *  he is (the audio plan's "first in 4 s"): a pinned squad pins in a ripple,
 *  and the feed's own pinned line (GH-262) already names each one. */
export const PINNED_COOLDOWN_TICKS = 80;

/**
 * Which authored wave a `wave` event is. The event carries only its tick and
 * its head count (`MissionEvent`), and the sim is not to be changed for a
 * presentation fact -- so this replays `MissionRuntime.stepWaves`' own rule:
 * waves are visited in authored order, each spawns once, a `trigger` wave is
 * due once its objective is complete and any other once the clock passes
 * `at_seconds`. Several waves due in one tick emit their events in that same
 * order, so the k-th event of a tick is the k-th due, unannounced wave.
 * Returns -1 when no authored wave fits (a mission edited under a running
 * game, or a fixture), and the line then goes out without a place.
 */
function dueWave(world: AlertWorld, seen: ReadonlySet<number>, tick: number): number {
  for (let i = 0; i < world.waves.length; i++) {
    if (seen.has(i)) continue;
    const w = world.waves[i];
    const due = w.trigger !== undefined ? world.objectiveDone(w.trigger) : tick >= w.at_seconds * TICKS_PER_SECOND;
    if (due) return i;
  }
  return -1;
}

export function alertsForTick(
  state: AlertState,
  sim: readonly SimEvent[],
  mission: readonly MissionEvent[],
  world: AlertWorld,
  tick: number,
): { state: AlertState; alerts: Alert[] } {
  const alerts: Alert[] = [];
  let wavesSeen = state.wavesSeen;

  // --- the mission half: what was lost, what moved, what arrived -----------
  const lostByType = new Map<string, number[]>();
  const lostEntities = new Set<number>();
  const objectives: { id: string; status: ObjectiveStatus }[] = [];
  const arrivals: Alert[] = [];
  /** Sound-only alerts (polish pass F): another surface owns their words. */
  const quiet: Alert[] = [];
  for (const e of mission) {
    if (e.kind === 'unitLost') {
      const group = lostByType.get(e.unit);
      if (group) group.push(e.entity);
      else lostByType.set(e.unit, [e.entity]);
      lostEntities.add(e.entity);
    } else if (e.kind === 'objective') {
      objectives.push({ id: e.id, status: e.status });
    } else if (e.kind === 'wave') {
      const index = dueWave(world, wavesSeen, e.tick);
      // Head count per entry marker, in authored order: the camera jumps to
      // the heaviest entry, and the minimap flashes every one of them.
      const byMarker = new Map<string, { at: { x: number; y: number }; n: number }>();
      if (index >= 0) {
        const next = new Set(wavesSeen);
        next.add(index);
        wavesSeen = next;
        for (const u of world.waves[index].units) {
          if (u.from === undefined) continue;
          const at = world.markerAt(u.from);
          if (at === null) continue;
          const entry = byMarker.get(u.from);
          if (entry) entry.n += u.count;
          else byMarker.set(u.from, { at, n: u.count });
        }
      }
      const entries = [...byMarker.values()];
      let heaviest: { at: { x: number; y: number }; n: number } | null = null;
      for (const entry of entries) if (heaviest === null || entry.n > heaviest.n) heaviest = entry;
      arrivals.push({
        kind: 'wave',
        tier: 'important',
        tone: 'bad',
        line: {
          key: 'alert.wave',
          params: { n: e.count },
          tone: 'bad',
          place: distinctPlaces(entries.map((m) => world.placeOf(m.at.x, m.at.y))),
        },
        // New contact is an important alert (polish pass F, A2), on top of
        // the wave's own announcement.
        cue: ALERT_CUE.important,
        at: heaviest?.at ?? null,
        marks: entries.map((m) => m.at),
        count: e.count,
      });
    } else if (e.kind === 'built') {
      const at = world.arrivedAt(e.unit);
      // VR-37: minor and info, like the scripted reinforcement below. Both are
      // OUR units arriving, both are silent (the dock and the announcer carry
      // them), and the tier that matches a silent alert is the quiet one -- so
      // a delivery never draws the ring a lost tank does.
      arrivals.push({
        kind: 'arrival',
        tier: 'minor',
        tone: 'info',
        line: {
          key: 'alert.arrived',
          params: { name: world.unitName(e.unit) },
          tone: 'info',
          place: at === null ? [] : [world.placeOf(at.x, at.y)],
        },
        // Good news the dock and the announcer already carry: no cue.
        cue: null,
        at,
        marks: at === null ? [] : [at],
        count: 1,
      });
    } else if (e.kind === 'removed' && e.side === 0) {
      // One of ours taken off the board (polish pass F, A2): not a death,
      // but a man gone. Sound only -- `describeMissionEvent` words it.
      const at = world.posOf(e.entity);
      quiet.push(soundOnly('removed', 'important', 'bad', at));
    } else if (e.kind === 'removed' && e.side === 2) {
      // A civilian taken (VR-37): important and bad, the same weight as a
      // man of ours taken -- on an evacuation it is a scored loss. Still
      // silent (MISSION_EVENT_SOUND's contract for a civilian) and still
      // worded by `describeMissionEvent`; what it gains is the ring where
      // they were taken.
      const at = world.posOf(e.entity);
      quiet.push({ kind: 'removed', tier: 'important', tone: 'bad', line: null, cue: null, at, marks: at === null ? [] : [at], count: 1 });
    } else if (e.kind === 'roe') {
      // A Conduct penalty (A9): the game's own mechanic, silent until now.
      quiet.push(soundOnly('roe', 'important', 'bad', null));
    } else if (e.kind === 'trigger') {
      const r = world.reinforcement(e.id);
      if (r === null) continue;
      arrivals.push({
        kind: 'arrival',
        tier: 'minor',
        tone: 'info',
        line: {
          key: 'alert.reinforced',
          params: { label: r.label },
          tone: 'info',
          place: distinctPlaces(r.points.map((p) => world.placeOf(p.x, p.y))),
        },
        cue: null,
        at: r.points[0] ?? null,
        marks: r.points,
        count: 1,
      });
    }
  }

  // --- the sim half: who is being shot at ---------------------------------
  // Ordered and de-duplicated: the first entity to take a round is the one
  // the camera jumps to, and a unit hit six times is still one unit.
  const underFire: number[] = [];
  const seen = new Set<number>();
  let pinnedAt: number | null = null;
  let ambushed = false;
  const tunnelsFound: number[] = [];
  let tunnelsAnnounced = state.tunnelsAnnounced;
  /** VR-37: the first of ours a round was aimed at this tick -- where an
   *  ambush is marked. Never the ambusher: pointing at a hidden enemy is
   *  x-ray, and the man it hit is where the player has to look anyway. */
  let firstOwnHit = -1;
  /** PA-19: enemies the player's own units killed this tick, by type. */
  const killsByType = new Map<string, number[]>();
  /** Pass C2/C4 (A1): ours broken this tick, and our vehicles hit in a
   *  component -- by what the hit took. */
  const brokenOwn: number[] = [];
  const damagedOwn = new Map<'immobilised' | 'gunOut' | 'outOfAction', number[]>();
  for (const e of sim) {
    if (e.kind === 'routed') {
      if (world.sideOf(e.entity) === 0 && !lostEntities.has(e.entity)) brokenOwn.push(e.entity);
      continue;
    }
    if (e.kind === 'component') {
      const what =
        e.result === 'mobility_kill' ? 'immobilised' : e.result === 'firepower_kill' ? 'gunOut' : e.result === 'combat_ineffective' ? 'outOfAction' : null;
      if (what !== null && world.sideOf(e.target) === 0 && !lostEntities.has(e.target)) {
        const group = damagedOwn.get(what);
        if (group) group.push(e.target);
        else damagedOwn.set(what, [e.target]);
      }
      continue;
    }
    if (e.kind === 'destroyed') {
      // Only an ENEMY (side 1, never a civilian on side 2) and only one of
      // OURS killed: a unit dying to its own side's fire, to a collapse with
      // no killer, or to anything the player did not do is not his to be
      // told about -- and naming an enemy nobody of ours engaged would be
      // x-ray. A loss of ours is `unitLost`'s, from the mission half.
      if (world.sideOf(e.entity) !== 1 || e.by < 0 || world.sideOf(e.by) !== 0) continue;
      const typeId = world.typeOf(e.entity);
      const group = killsByType.get(typeId);
      if (group) group.push(e.entity);
      else killsByType.set(typeId, [e.entity]);
      continue;
    }
    if (e.kind === 'pinned') {
      if (pinnedAt === null && world.sideOf(e.entity) === 0 && !lostEntities.has(e.entity)) pinnedAt = e.entity;
      continue;
    }
    // GH-471: a tunnel route identified by our side is the discovery beat --
    // the feed line, the minimap ring and the important cue, beside the
    // renderer's x-ray sweep. Once per route per mission: identification is
    // live, so a carrier walking in and out of sight of the same route
    // re-identifies it every time, and that is not news. `observer` is the
    // carrier (-1 when spoil alone got there): the line is placed where it
    // stands and the ring drawn there, since the carrier is over the route.
    if (e.kind === 'tunnelContact' && e.side === 0 && e.level === 'identified') {
      if (!tunnelsAnnounced.has(e.tunnel)) {
        tunnelsFound.push(e.observer);
        tunnelsAnnounced = new Set(tunnelsAnnounced).add(e.tunnel);
      }
      continue;
    }
    if (e.kind === 'ambushSprung') {
      // `entity` is the ambusher: one of ours springing is good news. No
      // position: pointing the minimap at a hidden enemy would be x-ray.
      if (world.sideOf(e.entity) !== 0) ambushed = true;
      continue;
    }
    if (e.kind !== 'fire' && e.kind !== 'impact') continue;
    const target = e.target;
    // -1 is a round aimed at a building rather than at anybody -- `fire`'s
    // own field doc in `SimEvent`.
    if (target < 0) continue;
    // An enemy under fire is good news, and nobody needs telling about it.
    if (world.sideOf(target) !== 0) continue;
    if (firstOwnHit < 0) firstOwnHit = target;
    // He is already the subject of a `unitLost` line this same tick.
    if (lostEntities.has(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    underFire.push(target);
  }

  const kept = underFire.filter(
    (entity) => tick - (state.lastUnderFire.get(entity) ?? -Infinity) >= UNDER_FIRE_COOLDOWN_TICKS,
  );

  // Copy-on-write, and the old object back untouched when nothing changed --
  // so a caller can compare identity to know the tick was quiet.
  let lastUnderFire = state.lastUnderFire;
  if (kept.length > 0) {
    const next = new Map(state.lastUnderFire);
    for (const entity of kept) next.set(entity, tick);
    lastUnderFire = next;
  }
  const pinnedSounds = pinnedAt !== null && tick - state.lastPinned >= PINNED_COOLDOWN_TICKS;
  const lastPinned = pinnedSounds ? tick : state.lastPinned;
  const nextState: AlertState =
    lastUnderFire === state.lastUnderFire && wavesSeen === state.wavesSeen && lastPinned === state.lastPinned && tunnelsAnnounced === state.tunnelsAnnounced
      ? state
      : { lastUnderFire, wavesSeen, lastPinned, tunnelsAnnounced };

  // --- emit, loudest first ------------------------------------------------
  for (const [typeId, entities] of lostByType) {
    const at = world.posOf(entities[0]);
    let tier: AlertTier = 'important';
    for (const entity of entities) {
      const t = world.lossTier(entity, typeId);
      if (TIER_RANK[t] > TIER_RANK[tier]) tier = t;
    }
    alerts.push({
      kind: 'unitLost',
      tier,
      tone: 'bad',
      line: {
        key: 'alert.unitLost',
        params: { name: world.unitName(typeId), n: entities.length },
        tone: 'bad',
        place: at === null ? [] : [world.placeOf(at.x, at.y)],
      },
      cue: ALERT_CUE[tier],
      at,
      marks: at === null ? [] : [at],
      count: entities.length,
    });
  }
  for (const { id, status } of objectives) {
    const at = world.objectiveAt(id);
    alerts.push({
      kind: 'objective',
      tier: status === 'active' ? 'important' : 'major',
      tone: status === 'complete' ? 'good' : status === 'failed' ? 'bad' : 'info',
      line: null,
      cue: OBJECTIVE_CUE[status],
      at,
      marks: at === null ? [] : [at],
      count: 1,
    });
  }
  alerts.push(...arrivals);
  // PA-19: an enemy kill, one line per type per tick like a loss. Good news,
  // so it is silent -- the blast and the round already sound -- and points
  // the jump key nowhere: Space goes to trouble, never to a wreck of theirs.
  // Tiered like a loss (C3): a vehicle or an aircraft is major, a man on foot
  // minor, so a firefight's dead read quietly and a tank kill lands.
  for (const [typeId, entities] of killsByType) {
    const at = world.posOf(entities[0]);
    let tier: AlertTier = 'minor';
    for (const entity of entities) if (world.lossTier(entity, typeId) === 'major') tier = 'major';
    alerts.push({
      kind: 'kill',
      tier,
      tone: 'good',
      line: {
        key: 'alert.kill',
        params: { name: world.unitName(typeId), n: entities.length },
        tone: 'good',
        place: at === null ? [] : [world.placeOf(at.x, at.y)],
      },
      cue: null,
      at: null,
      marks: [],
      count: entities.length,
    });
  }
  // Pass C2/C4 (A1): one of ours broken, and one of our vehicles that can
  // no longer move or fire -- the `important` tier, like a foot unit lost:
  // the plan around that unit just changed. One line per kind per tick,
  // naming the first and counting the rest.
  if (brokenOwn.length > 0) alerts.push(ownStateAlert('broken', 'alert.broken', brokenOwn, world));
  for (const [what, entities] of damagedOwn) alerts.push(ownStateAlert('damaged', `alert.${what}`, entities, world));
  // GH-471: routes found this tick, one line with a count (several routes in
  // sight at once -- a mission start -- read as "3 tunnels found").
  if (tunnelsFound.length > 0) {
    const observer = tunnelsFound.find((o) => o >= 0) ?? -1;
    const at = observer >= 0 ? world.posOf(observer) : null;
    alerts.push({
      kind: 'tunnel',
      tier: 'important',
      tone: 'warn',
      line: { key: 'alert.tunnelFound', params: { n: tunnelsFound.length }, tone: 'warn', place: at === null ? [] : [world.placeOf(at.x, at.y)] },
      cue: ALERT_CUE.important,
      at,
      marks: at === null ? [] : [at],
      count: tunnelsFound.length,
    });
  }
  if (ambushed) {
    // VR-37: an ambush gets a line and a mark, not only a sound.
    const at = firstOwnHit >= 0 ? world.posOf(firstOwnHit) : null;
    alerts.push({
      kind: 'ambush',
      tier: 'important',
      tone: 'bad',
      line: { key: 'alert.ambush', params: {}, tone: 'bad', place: at === null ? [] : [world.placeOf(at.x, at.y)] },
      cue: ALERT_CUE.important,
      at,
      marks: at === null ? [] : [at],
      count: 1,
    });
  }
  alerts.push(...quiet);
  if (kept.length > 0) {
    const points = kept.map((entity) => world.posOf(entity)).filter((p): p is { x: number; y: number } => p !== null);
    alerts.push({
      kind: 'underFire',
      tier: 'minor',
      tone: 'warn',
      line: {
        key: 'alert.underFire',
        // The first unit by name, and how many more: "under fire — Rifle
        // Squad and 2 more". Naming three types in one line is a paragraph.
        params: { name: world.unitName(world.typeOf(kept[0])), more: kept.length - 1 },
        tone: 'warn',
        place: distinctPlaces(points.map((p) => world.placeOf(p.x, p.y))),
      },
      cue: ALERT_CUE.minor,
      at: points[0] ?? null,
      marks: points.slice(0, 1),
      count: kept.length,
    });
  }

  // VR-37: pinned is minor and warn -- the under-fire family, the same ring.
  if (pinnedSounds && pinnedAt !== null) alerts.push(soundOnly('pinned', 'minor', 'warn', world.posOf(pinnedAt)));

  return { state: nextState, alerts };
}

/** A line about the state of one or more of OUR units (pass C2/C4, A1). */
function ownStateAlert(kind: 'broken' | 'damaged', key: string, entities: readonly number[], world: AlertWorld): Alert {
  const points = entities.map((e) => world.posOf(e)).filter((p): p is { x: number; y: number } => p !== null);
  return {
    kind,
    tier: 'important',
    tone: 'bad',
    line: {
      key,
      params: { name: world.unitName(world.typeOf(entities[0])), more: entities.length - 1 },
      tone: 'bad',
      place: distinctPlaces(points.map((p) => world.placeOf(p.x, p.y))),
    },
    cue: ALERT_CUE.important,
    at: points[0] ?? null,
    marks: points.slice(0, 1),
    count: entities.length,
  };
}

/** An alert that only sounds (polish pass F): another surface owns its words,
 *  and its cue is its tier's. */
function soundOnly(kind: Alert['kind'], tier: AlertTier, tone: Tone, at: { x: number; y: number } | null): Alert {
  return { kind, tier, tone, line: null, cue: ALERT_CUE[tier], at, marks: at === null ? [] : [at], count: 1 };
}

/**
 * The feed tier of a `MissionEvent` line `describeMissionEvent` (main.ts)
 * words -- the lines this model leaves to it. `null` for a kind that writes
 * no line or carries no weight worth styling (a story `say`, a rescue's
 * "clear (1)" punctuation).
 */
export function missionEventTier(e: MissionEvent): AlertTier | null {
  switch (e.kind) {
    case 'objective':
      return e.status === 'active' ? 'important' : 'major';
    case 'missionEnd':
      return 'major';
    case 'roe':
    case 'trigger':
      return 'important';
    case 'removed':
      // VR-37: a civilian taken is as heavy as a man of ours taken -- it was
      // minor here while its tone was bad (`removedNotice`).
      return 'important';
    default:
      return null;
  }
}

/**
 * Where the jump key goes (WP-P5): the latest `important` or `major` alert.
 * A minor one -- under fire -- takes the key only while nothing heavier has
 * happened yet, so the key is never dead in a mission's opening firefight,
 * and is never stolen from a lost tank by the next rifle round.
 */
export interface JumpTarget {
  at: { x: number; y: number };
  tier: AlertTier;
}

export function nextJump(current: JumpTarget | null, tier: AlertTier, at: { x: number; y: number } | null): JumpTarget | null {
  if (at === null) return current;
  if (tier !== 'minor' || current === null || current.tier === 'minor') return { at, tier };
  return current;
}
