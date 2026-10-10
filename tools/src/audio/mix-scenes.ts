/**
 * The scripted scenes of `pnpm audio:mix` (audio plan AU-4), and the gates
 * the rendered mix is held to. Node-side and pure: nothing here renders.
 *
 * Every mission-level decision a scene makes is made by the APP's own code,
 * not by this file: which cue a tick of losses raises (`alertsForTick` +
 * `tickCue`), which death call speaks (`decideDeaths`), and whether a burst
 * of losses is one announcement or six (`announceInputsOf` +
 * `decideAnnouncements`). The outcome and mission-start sequences are the
 * call order `main.ts` uses, written out (they are inline there, not a
 * function a tool could call). What this file supplies is the scene: where
 * the units stand, when they fire, and when they die.
 */
import { WEAPON_CLASS } from '@lions/sim';
import type { MissionEvent, SimEvent } from '@lions/sim';
import {
  INITIAL_ANNOUNCE,
  announceInputsOf,
  decideAnnouncements,
  hasPendingAnnouncement,
  type AnnounceState,
} from '../../../packages/app/src/voice/announce';
import { INITIAL_DIRECTOR, decideDeaths, type DirectorLook, type DirectorState } from '../../../packages/app/src/voice/director';
import { alertsForTick, initAlertState, type AlertWorld } from '../../../packages/app/src/ui/alerts';
import { tickCue, CRITICAL_CUES, OUTCOME_CUE } from '../../../packages/app/src/ui/cues';

/** The voice ladder's rungs, as `packages/render/src/audio.ts` names them. */
export type Priority = 'outcome' | 'announce_high' | 'order' | 'announce' | 'kdf_death' | 'announce_low' | 'enemy_death';

/** One thing a scene does at a moment, in render seconds. */
export type Action =
  | { atS: number; op: 'voice'; mark: string; key: string; priority: Priority; delayS?: number }
  | { atS: number; op: 'cue'; mark: string; id: string }
  | { atS: number; op: 'scene'; scene: 'menu' | 'battle' };

/** A combat event the mixer hears: `onEvents`' own shapes, with positions
 *  looked up in the scene's fake sim. */
export type CombatEvent =
  | { kind: 'fire'; shooter: number; target: number; weaponId: string }
  | { kind: 'impact'; shooter: number; target: number; penetrated: boolean }
  | { kind: 'nearMiss'; x: number; y: number }
  | { kind: 'destroyed'; entity: number };

export interface Scene {
  id: string;
  title: string;
  /** Rendered length, s. */
  lengthS: number;
  /** Fake-clock time run before the render, with no AudioContext time
   *  passing: it moves the MUSIC (elements, not graph) to where the scene
   *  starts. `combat` feeds the intensity reading so the battle bed is up. */
  warmup: { scene: 'menu' | 'battle'; ms: number; combat: boolean };
  /** Sim tick (20 Hz, render time) -> the combat events of that tick. */
  combat: Record<number, CombatEvent[]>;
  actions: Action[];
  /** What the scene's own deciders said, for the report. */
  notes: string[];
  /** Is this a scene for the listening copies, or a measurement variant. */
  listen: boolean;
}

/** The fake sim the mixer reads: positions and weapons only. Player units
 *  0..5 stand 3-6 tiles from the camera at (0,0); hostiles 6..11 at 8-12. */
export const UNITS: readonly { x: number; y: number; side: number; type: number }[] = [
  { x: 3, y: 1, side: 0, type: 0 },
  { x: 4, y: -1, side: 0, type: 0 },
  { x: 2, y: 4, side: 0, type: 1 },
  { x: 5, y: 2, side: 0, type: 0 },
  { x: -3, y: 3, side: 0, type: 2 },
  { x: 6, y: 0, side: 0, type: 0 },
  { x: 10, y: 3, side: 1, type: 0 },
  { x: 9, y: 6, side: 1, type: 0 },
  { x: 11, y: -2, side: 1, type: 1 },
  { x: 8, y: 8, side: 1, type: 0 },
  { x: 12, y: 1, side: 1, type: 0 },
  { x: 7, y: 9, side: 1, type: 2 },
];
export const UNIT_TYPES = [
  { id: 'inf_squad', weapons: [{ id: 'rifle', cls: WEAPON_CLASS.small_arms }] },
  { id: 'mg_team', weapons: [{ id: 'mg', cls: WEAPON_CLASS.hmg }] },
  { id: 'mbt_lavi', weapons: [{ id: 'gun_120', cls: WEAPON_CLASS.tank_gun }] },
] as const;

/** A tiny deterministic generator: the scene is a script, not a dice roll. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * A firefight from tick `from` to `to` (exclusive): both sides trading rifle
 * fire, a machine gun in bursts, rounds landing and passing close, and one
 * tank shot. About 9 shots, 4 impacts and 2 near misses a second -- busier
 * than most of a real mission, which is the point of a mix check.
 */
export function firefight(from: number, to: number, seed = 7): Record<number, CombatEvent[]> {
  const r = lcg(seed);
  const out: Record<number, CombatEvent[]> = {};
  const push = (t: number, e: CombatEvent): void => {
    (out[t] ??= []).push(e);
  };
  for (let t = from; t < to; t++) {
    const kdf = Math.floor(r() * 6);
    const foe = 6 + Math.floor(r() * 6);
    if (r() < 0.25) push(t, { kind: 'fire', shooter: kdf === 2 ? 0 : kdf === 4 ? 1 : kdf, target: foe, weaponId: 'rifle' });
    if (r() < 0.2) push(t, { kind: 'fire', shooter: foe === 8 || foe === 11 ? 6 : foe, target: kdf, weaponId: 'rifle' });
    // The machine gun fires a burst every second and a half.
    if ((t - from) % 30 < 6 && (t - from) % 2 === 0) push(t, { kind: 'fire', shooter: 2, target: foe, weaponId: 'mg' });
    if (r() < 0.2) push(t, { kind: 'impact', shooter: foe, target: kdf, penetrated: r() < 0.3 });
    if (r() < 0.1) push(t, { kind: 'nearMiss', x: 2 + r() * 3, y: r() * 3 });
  }
  const tank = from + Math.floor((to - from) * 0.55);
  push(tank, { kind: 'fire', shooter: 4, target: 11, weaponId: 'gun_120' });
  push(tank + 2, { kind: 'impact', shooter: 4, target: 11, penetrated: true });
  return out;
}

const TICK_MS = 50;

/** The app's alert world, for a fake board: foot units lose as `important`. */
function alertWorld(): AlertWorld {
  return {
    posOf: (e) => (UNITS[e] ? { x: UNITS[e].x, y: UNITS[e].y } : null),
    sideOf: (e) => UNITS[e]?.side ?? -1,
    typeOf: (e) => UNIT_TYPES[UNITS[e]?.type ?? 0].id,
    unitName: (id) => id,
    objectiveAt: () => null,
    placeOf: () => 'here',
    lossTier: (_e, typeId) => (typeId === 'mbt_lavi' ? 'major' : 'important'),
    waves: [],
    objectiveDone: () => false,
    markerAt: () => null,
    arrivedAt: () => null,
    reinforcement: () => null,
  };
}

function directorLook(): DirectorLook {
  return {
    unitOf: (id) => (UNITS[id] ? { faction: UNITS[id].side === 0 ? 'kdf' : 'sarim', voice: 'infantry' } : null),
    side: (id) => UNITS[id]?.side ?? -1,
    pos: (id) => ({ x: UNITS[id]?.x ?? 0, y: UNITS[id]?.y ?? 0 }),
    isVisible: () => true,
    camera: () => ({ x: 0, y: 0 }),
  };
}

export interface ManifestLike {
  voices?: {
    languages?: Record<string, string>;
    announcements?: Parameters<typeof decideAnnouncements>[2];
  };
}

/**
 * Run the app's mission-side deciders over a scene's ticks: the losses' cue,
 * the death calls and the announcements, as the battlefield does each tick
 * (`announceAlerts`, `VoiceRuntime.onTick`/`onMission`). Returns the actions
 * they produce and a line per decision for the report.
 */
function decideMission(
  manifest: ManifestLike,
  warmMs: number,
  ticks: number,
  combat: Record<number, CombatEvent[]>,
  mission: Record<number, MissionEvent[]>
): { actions: Action[]; notes: string[]; announced: { event: string; n?: number }[] } {
  const table = manifest.voices?.announcements;
  const languages = manifest.voices?.languages ?? {};
  if (!table) throw new Error('data/audio.json has no voices.announcements');
  let alerts = initAlertState();
  let director: DirectorState = INITIAL_DIRECTOR;
  let announce: AnnounceState = INITIAL_ANNOUNCE;
  const actions: Action[] = [];
  const notes: string[] = [];
  const announced: { event: string; n?: number }[] = [];
  const world = alertWorld();
  const look = directorLook();
  for (let t = 0; t < ticks; t++) {
    const sim = (combat[t] ?? []) as unknown as SimEvent[];
    const mis = mission[t] ?? [];
    const now = warmMs + t * TICK_MS;
    const atS = t / 20;
    if (sim.length === 0 && mis.length === 0 && !hasPendingAnnouncement(announce)) continue;
    const a = alertsForTick(alerts, sim, mis, world, t);
    alerts = a.state;
    const cue = tickCue(a.alerts.map((x) => x.cue));
    if (cue) {
      actions.push({ atS, op: 'cue', mark: `cue@${atS.toFixed(2)}`, id: cue });
      notes.push(`t=${atS.toFixed(2)} s  alerts -> cue ${cue}`);
    }
    const d = decideDeaths(director, sim, look, languages, now);
    director = d.state;
    for (const n of d.notes) {
      if (n.cue) {
        actions.push({ atS, op: 'voice', mark: `death@${atS.toFixed(2)}`, key: n.cue.key, priority: n.cue.priority });
        notes.push(`t=${atS.toFixed(2)} s  decideDeaths -> ${n.cue.key} (${n.cue.priority})`);
      } else notes.push(`t=${atS.toFixed(2)} s  decideDeaths -> ${n.why}`);
    }
    const inputs = announceInputsOf(mis, (id) => id);
    const r = decideAnnouncements(announce, inputs, table, 'he', now);
    announce = r.state;
    for (const n of r.notes) {
      if (n.why !== 'line') {
        notes.push(`t=${atS.toFixed(2)} s  announce ${n.event}: ${n.why}`);
        continue;
      }
      const params = r.cue?.captionParams ?? {};
      announced.push({ event: n.event, ...(typeof params.n === 'number' ? { n: params.n } : {}) });
      const key = r.cue?.key ?? '';
      notes.push(
        `t=${atS.toFixed(2)} s  announce ${n.event}${typeof params.n === 'number' ? ` (n=${params.n})` : ''}: ` +
          (key === '' ? 'caption only (no recorded take)' : `${key} (${r.cue?.priority})`)
      );
      if (key !== '' && r.cue) actions.push({ atS, op: 'voice', mark: `announce@${atS.toFixed(2)}`, key, priority: r.cue.priority });
    }
  }
  return { actions, notes, announced };
}

/** What a scene built by `buildScenes` also reports for the gates. */
export interface SceneSet {
  scenes: Scene[];
  /** Scene d: the unit-lost announcements the app's own announcer made. */
  unitLostCalls: { event: string; n?: number }[];
  /** Scene d: the losses fed in. */
  unitLostFed: number;
}

/** The scenes, (a)-(e) plus the two measurement variants of (a). */
export function buildScenes(manifest: ManifestLike, outcomeLineDelayS: number): SceneSet {
  const scenes: Scene[] = [];
  const BATTLE_WARM = { scene: 'battle' as const, ms: 4000, combat: true };

  // (a) The plan's own scene: a firefight with a bark, and an objective cue
  // landing while the bark speaks.
  const barkAt = 2.0;
  const cueAt = 2.2;
  const aCombat = firefight(0, 110);
  // The under-fire alerts the firefight raises, as the app would sound them;
  // the objective's own tick plays the objective cue (one cue a tick).
  const aAlerts = decideMission(manifest, 4000, 120, aCombat, {});
  scenes.push({
    id: 'a_firefight',
    title: 'firefight + order bark + objective cue, battle music',
    lengthS: 6,
    warmup: BATTLE_WARM,
    combat: aCombat,
    actions: [
      ...aAlerts.actions.filter((x) => x.op === 'cue' && Math.round(x.atS * 20) !== Math.round(cueAt * 20)),
      { atS: barkAt, op: 'voice', mark: 'bark', key: 'he.infantry.attack', priority: 'order' },
      { atS: cueAt, op: 'cue', mark: 'cue', id: CRITICAL_CUES.objectiveComplete },
    ],
    notes: ['the order bark at 2.0 s; objective.complete lands at 2.2 s, inside the line', ...aAlerts.notes],
    listen: true,
  });
  // The same cue with the same bark ducking under it, and nothing else; and
  // the cue alone. The cue's level must not differ between the two.
  scenes.push({
    id: 'a_cue_under_bark',
    title: 'variant: the bark and the cue alone',
    lengthS: 4,
    warmup: { scene: 'menu', ms: 0, combat: false },
    combat: {},
    actions: [
      { atS: barkAt, op: 'voice', mark: 'bark', key: 'he.infantry.attack', priority: 'order' },
      { atS: cueAt, op: 'cue', mark: 'cue', id: CRITICAL_CUES.objectiveComplete },
    ],
    notes: [],
    listen: false,
  });
  scenes.push({
    id: 'a_cue_alone',
    title: 'variant: the cue alone',
    lengthS: 4,
    warmup: { scene: 'menu', ms: 0, combat: false },
    combat: {},
    actions: [{ atS: cueAt, op: 'cue', mark: 'cue', id: CRITICAL_CUES.objectiveComplete }],
    notes: [],
    listen: false,
  });

  // (b) An announcement over the calm bed: reinforcements arrive (a `built`
  // mission event; its arrival alert is silent by design, VR-37).
  const b = decideMission(manifest, 2500, 100, {}, { 30: [{ kind: 'built', tick: 30, unit: 'inf_squad' }] });
  scenes.push({
    id: 'b_announce_calm',
    title: 'announcement (reinforcements) over the calm bed',
    lengthS: 5,
    warmup: { scene: 'battle', ms: 2500, combat: false },
    combat: {},
    actions: b.actions.map((a) => (a.op === 'voice' ? { ...a, mark: 'line' } : a)),
    notes: b.notes,
    listen: true,
  });

  // (c) Defeat: the fight is on, then the verdict -- main.ts's own order:
  // the stinger, the hush, Shai's line (delayed on the mixer's clock), and
  // the music back to the menu scene.
  const outAt = 2.0;
  const cCombat = firefight(0, outAt * 20);
  const cAlerts = decideMission(manifest, 4000, outAt * 20, cCombat, {});
  scenes.push({
    id: 'c_defeat',
    title: 'defeat stinger + the defeat line, out of a firefight',
    lengthS: 8,
    warmup: BATTLE_WARM,
    combat: cCombat,
    actions: [
      ...cAlerts.actions.filter((x) => x.op === 'cue'),
      { atS: outAt, op: 'cue', mark: 'stinger', id: OUTCOME_CUE.defeat },
      {
        atS: outAt,
        op: 'voice',
        mark: 'line',
        key: manifest.voices?.announcements?.events.defeat?.audio ?? '',
        priority: 'outcome',
        delayS: outcomeLineDelayS,
      },
      { atS: outAt, op: 'scene', scene: 'menu' },
    ],
    notes: [`stinger at ${outAt} s; the line asked for ${outcomeLineDelayS} s later (OUTCOME_LINE_DELAY_S)`, ...cAlerts.notes],
    listen: true,
  });

  // (d) Six of ours lost across a second, inside a firefight.
  const lossTicks: [number, number[]][] = [
    [30, [0, 1]],
    [36, [3]],
    [42, [5, 2]],
    [50, [4]],
  ];
  const dCombat = firefight(0, 120, 11);
  const dMission: Record<number, MissionEvent[]> = {};
  let fed = 0;
  for (const [t, ids] of lossTicks) {
    for (const id of ids) {
      (dCombat[t] ??= []).push({ kind: 'destroyed', entity: id });
      (dMission[t] ??= []).push({ kind: 'unitLost', tick: t, entity: id, side: 0, unit: UNIT_TYPES[UNITS[id].type].id });
      fed++;
    }
  }
  const d = decideMission(manifest, 4000, 140, dCombat, dMission);
  let deathN = 0;
  scenes.push({
    id: 'd_unit_lost',
    title: 'six units lost across a second, in a firefight',
    lengthS: 7,
    warmup: BATTLE_WARM,
    combat: dCombat,
    actions: d.actions.map((a) => (a.op === 'voice' && a.priority === 'kdf_death' ? { ...a, mark: deathN++ === 0 ? 'line' : a.mark } : a)),
    notes: d.notes,
    listen: true,
  });

  // (d1) One loss and its call, inside the same firefight: the case every
  // KDF death near the camera is, since the call speaks on the tick of the
  // kill whose explosion is the loudest sound in the library.
  const d1Combat = firefight(0, 120, 11);
  (d1Combat[30] ??= []).push({ kind: 'destroyed', entity: 0 });
  const d1 = decideMission(manifest, 4000, 140, d1Combat, { 30: [{ kind: 'unitLost', tick: 30, entity: 0, side: 0, unit: 'inf_squad' }] });
  scenes.push({
    id: 'd1_one_loss',
    title: 'variant: one loss and its death call, in the same firefight',
    lengthS: 5,
    warmup: BATTLE_WARM,
    combat: d1Combat,
    actions: d1.actions.map((a) => (a.op === 'voice' && a.priority === 'kdf_death' ? { ...a, mark: 'line' } : a)),
    notes: d1.notes,
    listen: false,
  });

  // (e) The mission start, main.ts's order: the music to the battle scene
  // (theme -> calm bed), the start cue, and Shai's line from the announcer.
  const table = manifest.voices?.announcements;
  if (!table) throw new Error('data/audio.json has no voices.announcements');
  const start = decideAnnouncements(INITIAL_ANNOUNCE, [{ event: 'mission_start' }], table, 'he', 0);
  const startKey = start.cue?.key ?? '';
  scenes.push({
    id: 'e_mission_start',
    title: 'mission start: the start cue and the start line as the theme turns to the calm bed',
    lengthS: 6,
    warmup: { scene: 'menu', ms: 1000, combat: false },
    combat: {},
    actions: [
      { atS: 0.5, op: 'scene', scene: 'battle' },
      { atS: 0.5, op: 'cue', mark: 'cue', id: CRITICAL_CUES.missionStart },
      ...(startKey !== '' && start.cue ? [{ atS: 0.5, op: 'voice' as const, mark: 'line', key: startKey, priority: start.cue.priority }] : []),
    ],
    notes: [`announce mission_start: ${startKey === '' ? 'caption only' : startKey}`],
    listen: true,
  });

  return { scenes, unitLostCalls: d.announced.filter((x) => x.event === 'unit_lost'), unitLostFed: fed };
}

/** One gate's verdict. */
export interface Gate {
  id: string;
  /** Where the threshold comes from. */
  source: string;
  value: number;
  limit: number;
  /** `min`: value >= limit passes; `max`: value <= limit passes. */
  sense: 'min' | 'max';
  unit: string;
}

export const passes = (g: Gate): boolean => (g.sense === 'min' ? g.value >= g.limit : g.value <= g.limit);
