// applyOverlays -- the one pure pre-pass over a mission's JSON that GH-1394's difficulty postures and
// GH-1395's challenge amendments share (designs 2026-11-15-difficulty-settings-design.md §3-§4 and
// 2026-11-15-challenge-star-design.md §3; lead rulings 16 Nov 2026). It runs where `applyUpgrades` runs:
// before the runtime is built, in the app, the playtest harness and the backtest. @lions/sim imports
// nothing from here and never learns a posture exists.
//
// Three rules hold it:
//   - the operation set is CLOSED (`data/schemas/overlay_ops.schema.json`; the switch below is exhaustive
//     and throws on anything else). Nothing here touches tuning, Conduct scoring, a primary's own clock, an
//     objective's id, type or target, or a tag; `fail_below` moves only UP, through GH-1395's `raise_fail_below`;
//   - the posture first, the amendments last, in this one function and never at a call site;
//   - no operations means the mission ITSELF comes back, by reference (Standard is the identity).
//
// Leaf package rule (CLAUDE.md): @lions/data imports no other @lions package. The mission is typed
// structurally, generic over the caller's own `MissionJson`, as `applyMissionLocale` is.

import posturesJson from '../../../data/difficulty/postures.json';

/** The three postures (lead ruling D1), in picker order. */
export const POSTURE_IDS = ['easier', 'standard', 'harder'] as const;
export type PostureId = (typeof POSTURE_IDS)[number];

/** The campaign-ledger key the posture lives under (design §6). Read from the ledger ONLY: no URL
 *  flag reaches it, so no dev flag can change how a campaign mission scores. */
export const DIFFICULTY_LEDGER_KEY = 'campaign.difficulty';

/** The id the `reinforce_player` op gives its trigger, so a caller can lend the relief (`reliefTriggerIndices`). */
export const RELIEF_TRIGGER_ID = 'posture_relief';

export type OverlayOp =
  | { op: 'scale_time_limit'; num: number; den: number }
  | { op: 'scale_waves'; num: number; den: number; skip_tagged: true }
  | { op: 'shift_waves'; seconds: number }
  | { op: 'reinforce_player'; at_seconds: number; label_key: string; units: readonly { unit: string; count: number }[] }
  | { op: 'uncarry' }
  | { op: 'add_wave'; wave: OverlayWave }
  // GH-1395: the amendment operations, each a restriction (design rule A1). None of them can add a starting
  // body, a carrying secondary or a lower Conduct floor (rule A2), which is what keeps an amended win's credits
  // at or below the plain win's (`tools/src/challenges.test.ts`, each of creditsFor's inputs on its own).
  | { op: 'raise_fail_below'; by: number }
  | { op: 'remove_starting'; unit: string; count: number }
  | { op: 'scale_resources'; num: number; den: number }
  | { op: 'set_intel_start'; value: number };

export interface PostureJson {
  id: PostureId;
  label_key: string;
  blurb_key: string;
  ops: readonly OverlayOp[];
}

export interface PostureCatalogue {
  postures: readonly PostureJson[];
}

/** The shipped catalogue, `data/difficulty/postures.json`. */
export const postures: PostureCatalogue = posturesJson as unknown as PostureCatalogue;

/** A wave as far as this module needs to see it (mission.schema.json's `enemy.waves[]`). */
export interface OverlayWave {
  at_seconds: number;
  trigger?: string;
  units: readonly { unit: string; count: number; tag?: string }[];
}

/** A mission's JSON as far as the overlays need to see it. */
export interface OverlayMission {
  time_limit_s?: number;
  ledger: { produces: readonly string[] };
  objectives: readonly { carries?: boolean }[];
  enemy?: { waves?: readonly OverlayWave[] };
  triggers?: readonly unknown[];
  /** GH-1395: what the amendment operations read. */
  roe?: { fail_below?: number };
  starting_force?: readonly { unit: string; count: number; tag?: string }[];
  resources?: { logistics_start?: number; logistics_rate_per_min?: number; intel_start?: number };
}

/** The highest `fail_below` `raise_fail_below` will set: the two-star Conduct floor is `fail_below + 20`
 *  (`starRoeFloor`, @lions/sim), and a floor above 100 would put the second star out of reach on any run. */
export const FAIL_BELOW_CEILING = 80;

/** What a run is played under: one posture (absent = Standard) and any amendments, each an op list. */
export interface OverlayChoice {
  posture?: PostureId;
  amendments?: readonly (readonly OverlayOp[])[];
}

export interface OverlayOptions {
  /** Resolves a `label_key` to the player-facing text (the app passes `t`). Absent: the relief trigger is
   *  added unlabelled, which the runtime treats exactly the same. */
  label?: (key: string) => string;
}

/** The posture a campaign ledger names: `easier`, `standard` or `harder`; anything else (absent, an unknown
 *  string, a wrong type: an old save, a hand-edited one) reads as Standard (ruling D2). */
export function postureOf(ledger: Readonly<Record<string, unknown>> | null | undefined): PostureId {
  const v = ledger?.[DIFFICULTY_LEDGER_KEY];
  return typeof v === 'string' && (POSTURE_IDS as readonly string[]).includes(v) ? (v as PostureId) : 'standard';
}

/** Whether a posture applies to this mission at all: a mission that produces nothing for the campaign (the
 *  tutorial, ruling D12) is played as written under every posture. Keyed on the ledger contract, never a
 *  name list, the same gate brigade credits use (CLAUDE.md, "Brigade credits"). */
export function postureApplies(mission: OverlayMission): boolean {
  return mission.ledger.produces.length > 0;
}

/** The ops one posture applies. Throws on an id the catalogue does not carry (a data fault, not a player one). */
export function postureOps(id: PostureId, catalogue: PostureCatalogue = postures): readonly OverlayOp[] {
  const p = catalogue.postures.find((x) => x.id === id);
  if (p === undefined) throw new Error(`difficulty: no posture "${id}" in the catalogue`);
  return p.ops;
}

/** a * num / den, rounded up, in integers (no float on the way). */
function ceilRatio(a: number, num: number, den: number): number {
  return Math.floor((a * num + den - 1) / den);
}

/** a * num / den, rounded half up, in integers. */
function roundRatio(a: number, num: number, den: number): number {
  return Math.floor((2 * a * num + den) / (2 * den));
}

function applyOne<T extends OverlayMission>(m: T, op: OverlayOp, opts: OverlayOptions): T {
  switch (op.op) {
    case 'scale_time_limit': {
      if (m.time_limit_s === undefined) return m;
      return { ...m, time_limit_s: ceilRatio(m.time_limit_s, op.num, op.den) };
    }
    case 'scale_waves': {
      const waves = m.enemy?.waves;
      if (waves === undefined || waves.length === 0) return m;
      // The ratio is applied to the mission's wave BODIES, not to each entry: walking every untagged wave unit in
      // authored order, an entry gets what brings the running total to round(running authored total * num / den),
      // never below 1. Rounding each entry on its own does not keep the ratio, because almost every shipped entry
      // is 1 or 2 bodies: rounded up, x3/4 thinned 2 of 119 entries (175 bodies to 173) and x5/4 raised all 119
      // (175 to 294, +68%). Carried, the shipped waves go to 143 (x0.82: the floor of 1 is what stops it at 0.75)
      // and 223 (x1.27). A tagged unit is never scaled and does not enter the running totals.
      let authored = 0;
      let given = 0;
      const scaled = (count: number): number => {
        authored += count;
        const target = roundRatio(authored, op.num, op.den);
        const n = Math.max(1, target - given);
        given += n;
        return n;
      };
      // A grown entry keeps its authored count and its extra bodies follow as a second entry, same unit and spawn
      // point: a placement spreads its bodies east in rows of three, so a bigger count can walk off the map edge
      // (Khan Rafid III's north_road is at x 45 of 48). The extra is never more than the authored count, so it lands
      // on tiles the first entry's own bodies already proved clear -- the shape two shipped entries at one `from`
      // already have. A thinned entry just shrinks.
      return {
        ...m,
        enemy: {
          ...m.enemy,
          waves: waves.map((w) => ({
            ...w,
            units: w.units.flatMap((u) => {
              if (u.tag !== undefined) return [u];
              const n = scaled(u.count);
              return n > u.count ? [u, { ...u, count: n - u.count }] : [{ ...u, count: n }];
            }),
          })),
        },
      };
    }
    case 'shift_waves': {
      const waves = m.enemy?.waves;
      if (waves === undefined || waves.length === 0) return m;
      return {
        ...m,
        enemy: { ...m.enemy, waves: waves.map((w) => (w.trigger !== undefined ? w : { ...w, at_seconds: Math.max(0, w.at_seconds + op.seconds) })) },
      };
    }
    case 'reinforce_player': {
      const trigger: Record<string, unknown> = {
        id: RELIEF_TRIGGER_ID,
        ...(opts.label === undefined ? {} : { label: opts.label(op.label_key) }),
        on: { kind: 'timer_s', value: op.at_seconds },
        do: { kind: 'reinforce', units: op.units.map((u) => ({ unit: u.unit, count: u.count })) },
      };
      return { ...m, triggers: [...(m.triggers ?? []), trigger] };
    }
    case 'uncarry': {
      if (!m.objectives.some((o) => o.carries !== undefined)) return m;
      return {
        ...m,
        objectives: m.objectives.map((o) => {
          if (o.carries === undefined) return o;
          const rest = { ...o };
          delete rest.carries;
          return rest;
        }),
      };
    }
    case 'add_wave': {
      return { ...m, enemy: { ...m.enemy, waves: [...(m.enemy?.waves ?? []), op.wave] } };
    }
    case 'raise_fail_below': {
      const fb = m.roe?.fail_below;
      if (fb === undefined) return m;
      const raised = Math.min(FAIL_BELOW_CEILING, fb + op.by);
      if (raised <= fb) return m;
      return { ...m, roe: { ...m.roe, fail_below: raised } };
    }
    case 'remove_starting': {
      const force = m.starting_force ?? [];
      // From the LAST untagged top-level placement of the unit backwards: the authored order puts the main body first,
      // so the cut falls on the tail. A tagged placement (an escort, an hvt's target) is never touched (rule A3).
      let left = op.count;
      const kept = force.slice();
      for (let i = kept.length - 1; i >= 0 && left > 0; i--) {
        const p = kept[i];
        if (p.unit !== op.unit || p.tag !== undefined) continue;
        const take = Math.min(left, p.count);
        left -= take;
        kept[i] = { ...p, count: p.count - take };
      }
      if (left > 0) throw new Error(`overlay: remove_starting wants ${op.count} untagged ${op.unit} and the starting force has ${op.count - left}`);
      return { ...m, starting_force: kept.filter((p) => p.count > 0) };
    }
    case 'scale_resources': {
      const r = m.resources;
      if (r === undefined || (r.logistics_start === undefined && r.logistics_rate_per_min === undefined)) return m;
      const down = (x: number | undefined): number | undefined => (x === undefined ? undefined : Math.floor((x * op.num) / op.den));
      const out: Record<string, unknown> = { ...r };
      if (r.logistics_start !== undefined) out.logistics_start = down(r.logistics_start);
      if (r.logistics_rate_per_min !== undefined) out.logistics_rate_per_min = down(r.logistics_rate_per_min);
      return { ...m, resources: out };
    }
    case 'set_intel_start': {
      const cur = m.resources?.intel_start;
      if (cur === undefined || cur <= op.value) return m;
      return { ...m, resources: { ...m.resources, intel_start: op.value } };
    }
    default: {
      const never: never = op;
      throw new Error(`overlay: unknown operation ${JSON.stringify(never)}`);
    }
  }
}

/** Applies `ops` in order. No ops: `mission` itself, by reference. Never mutates its input. */
export function applyOps<T extends OverlayMission>(mission: T, ops: readonly OverlayOp[], opts: OverlayOptions = {}): T {
  let m = mission;
  for (const op of ops) m = applyOne(m, op, opts);
  return m;
}

/**
 * The mission a run is played on: the posture's ops first (skipped where `postureApplies` is false), then each
 * amendment's, in order (design §4.1: `applyAmendments(applySetting(m, posture), amendments)`). Standard with no
 * amendments returns `mission` itself, by reference.
 */
export function applyOverlays<T extends OverlayMission>(
  mission: T,
  choice: OverlayChoice,
  catalogue: PostureCatalogue = postures,
  opts: OverlayOptions = {}
): T {
  const posture = choice.posture ?? 'standard';
  let m = postureApplies(mission) ? applyOps(mission, postureOps(posture, catalogue), opts) : mission;
  for (const a of choice.amendments ?? []) m = applyOps(m, a, opts);
  return m;
}

/** Indices into `mission.triggers` of the relief triggers a posture added. The caller lends every body they bring
 *  (`reinforceKey(i, j)` for each unit j), so a relief survivor goes back and never joins the brigade's roster:
 *  without it an Easier run would carry a free rifle squad home (design §5, "Easier pays no more"). */
export function reliefTriggerIndices(mission: { triggers?: readonly unknown[] }): number[] {
  const out: number[] = [];
  (mission.triggers ?? []).forEach((t, i) => {
    if (typeof t === 'object' && t !== null && (t as { id?: unknown }).id === RELIEF_TRIGGER_ID) out.push(i);
  });
  return out;
}
