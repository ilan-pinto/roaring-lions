/**
 * Why a unit died (GH-1380): the one line the unit card and the debrief print, derived from `SimEvent`s the sim emits.
 *
 * Invariant 4: this only READS events. It writes nothing back to the sim. `destroyed` says HOW (`cause`: direct, splash, strike, bleed,
 * collapse, carrier, spent, other) and, when a weapon dealt it, WHICH (`weaponId`). Only a `direct` kill needs more than that, the plate
 * and whether it penetrated, so for that one the cause is a join across the target's earlier events:
 *   - `impact` that PENETRATED (a hard hull; carries the weapon, the arc that was hit, `penetrated`) -- a gun, or a kamikaze's terminal strike;
 *   - `fire` that `willHit` (a soft target: no impact event exists, so this names the weapon);
 *   - `beam` `struck` (a directed-energy hit);
 *   - `pinned` / `unpinned`, which say whether the victim was suppressed when it fell.
 * The join keys on `shooter === by` AND, when the event names one, `weapon === weaponId`: a record from anyone else, or from another of
 * the attacker's weapons, is not the killing blow. Candidates are kept per shooter and weapon, so a second attacker's later shot never
 * hides the first one's. A `destroyed` with no `cause` (a hand-built event, or a replay from before GH-1380's sim step) takes the join alone.
 */
import type { SimEvent } from '@lions/sim';
import { t } from './i18n/t';
import { weaponName } from './ui/weapon-name';

/** How long a hit stays a candidate for the kill. Ten seconds: a hull that burns after the hit still names the hit that started it. */
export const CAUSE_WINDOW_TICKS = 200;

/** The plate a round met, as the sim's `impact` event names it. */
export type KillArc = Extract<SimEvent, { kind: 'impact' }>['arc'];

export type KillCauseKind = 'gun' | 'kamikaze' | 'beam' | 'spent' | 'splash' | 'strike' | 'bleed' | 'collapse' | 'carrier' | 'other';

/** Structured, so it can be saved (`LostRecord.cause`) and re-worded in any language; never a pre-rendered sentence. */
export interface KillCause {
  kind: KillCauseKind;
  /** The attacker's sim type id (`by`'s type), absent when nobody is credited. */
  attacker?: string;
  /** The weapon id, when an event named it. */
  weapon?: string;
  /** The plate the killing penetration met. Absent for a soft target, a kamikaze (its strike is not aimed at a plate) and a beam. */
  arc?: KillArc;
  /** Whether the killing round penetrated. Present only on a hard-target `impact`. */
  penetrated?: boolean;
  /** The victim was pinned down when it fell. */
  suppressed: boolean;
}

const KINDS: readonly string[] = ['gun', 'kamikaze', 'beam', 'spent', 'splash', 'strike', 'bleed', 'collapse', 'carrier', 'other'];
const ARCS: readonly string[] = ['front', 'side', 'rear'];

/**
 * A `KillCause` out of untrusted JSON (a save, a slot, the account sync): the strict fields only, `undefined` if the shape is wrong. The card
 * words a stored cause through `t()`, so a record from a hand-edited save must never reach a key the catalogue does not hold.
 */
export function parseKillCause(v: unknown): KillCause | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !KINDS.includes(r.kind) || typeof r.suppressed !== 'boolean') return undefined;
  if (r.attacker !== undefined && typeof r.attacker !== 'string') return undefined;
  if (r.weapon !== undefined && typeof r.weapon !== 'string') return undefined;
  if (r.arc !== undefined && (typeof r.arc !== 'string' || !ARCS.includes(r.arc))) return undefined;
  if (r.penetrated !== undefined && typeof r.penetrated !== 'boolean') return undefined;
  return {
    kind: r.kind as KillCauseKind,
    ...(r.attacker !== undefined ? { attacker: r.attacker as string } : {}),
    ...(r.weapon !== undefined ? { weapon: r.weapon as string } : {}),
    ...(r.arc !== undefined ? { arc: r.arc as KillArc } : {}),
    ...(r.penetrated !== undefined ? { penetrated: r.penetrated as boolean } : {}),
    suppressed: r.suppressed,
  };
}

/** What the tracker needs to know that no event says. Both are reads of sim state. */
export interface CauseWorld {
  /** The sim type id of an entity (readable after death), or undefined. */
  typeIdOf(entity: number): string | undefined;
  /** True for a unit with the `kamikaze` ability. */
  isKamikaze(entity: number): boolean;
}

interface Hit {
  tick: number;
  shooter: number;
  kind: 'gun' | 'kamikaze' | 'beam';
  weapon: string;
  arc?: KillArc;
  penetrated?: boolean;
}

/** One shooter's candidates with one weapon on one victim: the latest of any kind, and the latest penetration. */
interface Slot {
  last: Hit;
  pen?: Hit;
}

type Destroyed = Extract<SimEvent, { kind: 'destroyed' }>;

export class KillCauseTracker {
  /** victim -> `${shooter}:${weapon}` -> its candidates. */
  private readonly hits = new Map<number, Map<string, Slot>>();
  private readonly pinned = new Set<number>();

  constructor(private readonly world: CauseWorld) {}

  /**
   * Feed every `SimEvent`, in order. Returns the cause when `ev` is a `destroyed`, otherwise undefined.
   * Bounded: an entry leaves with its victim's `destroyed`, so the map holds only units still in the fight.
   */
  observe(ev: SimEvent): KillCause | undefined {
    switch (ev.kind) {
      case 'fire':
        // A soft target takes no `impact`; the `fire` that will hit names the weapon. A hard hull's later penetrating `impact` replaces it.
        if (ev.willHit && ev.target >= 0) this.note(ev.target, { tick: ev.tick, shooter: ev.shooter, kind: 'gun', weapon: ev.weaponId });
        return undefined;
      case 'impact':
        // A bounce kills nothing (HP alone ends a vehicle), so only a penetration, or a kamikaze's strike, is a candidate.
        if (ev.penetrated) {
          const kamikaze = this.world.isKamikaze(ev.shooter);
          this.note(ev.target, {
            tick: ev.tick,
            shooter: ev.shooter,
            kind: kamikaze ? 'kamikaze' : 'gun',
            weapon: ev.weaponId,
            // The sim stamps a kamikaze's impact `arc: 'side'` as a constant, not a measured plate: never report it.
            ...(kamikaze ? {} : { arc: ev.arc }),
            penetrated: true,
          });
        }
        return undefined;
      case 'beam':
        // A `lockout` beam event has `target: -1` (no one is struck), so the target test alone leaves it out; only a strike is a cause.
        if (ev.target >= 0) this.note(ev.target, { tick: ev.tick, shooter: ev.shooter, kind: 'beam', weapon: ev.weaponId });
        return undefined;
      case 'pinned':
        this.pinned.add(ev.entity);
        return undefined;
      case 'unpinned':
        this.pinned.delete(ev.entity);
        return undefined;
      case 'destroyed': {
        const cause = this.causeOf(ev);
        this.hits.delete(ev.entity);
        this.pinned.delete(ev.entity);
        return cause;
      }
      default:
        return undefined;
    }
  }

  private note(target: number, hit: Hit): void {
    let slots = this.hits.get(target);
    if (slots === undefined) {
      slots = new Map();
      this.hits.set(target, slots);
    }
    const key = `${hit.shooter}:${hit.weapon}`;
    const slot = slots.get(key);
    if (slot === undefined) slots.set(key, hit.penetrated === true ? { last: hit, pen: hit } : { last: hit });
    else {
      slot.last = hit;
      if (hit.penetrated === true) slot.pen = hit;
    }
  }

  /**
   * The killing blow among `by`'s candidates on `entity` (with `weapon` when the event names it), or undefined. Within one shooter and
   * weapon a fresh penetration wins over a later `fire` (the NEXT round of the same gun is not a later cause: only a penetration ends a
   * hard hull). Across weapons the latest wins, so a beam that finishes a hull an earlier gun round holed names the beam.
   */
  private killingHit(entity: number, by: number, weapon: string | undefined, tick: number): Hit | undefined {
    const slots = this.hits.get(entity);
    if (slots === undefined || by < 0) return undefined;
    const fresh = (h: Hit | undefined): h is Hit => h !== undefined && tick - h.tick <= CAUSE_WINDOW_TICKS;
    let best: Hit | undefined;
    for (const slot of slots.values()) {
      if (slot.last.shooter !== by || (weapon !== undefined && slot.last.weapon !== weapon)) continue;
      const rep = fresh(slot.pen) ? slot.pen : fresh(slot.last) ? slot.last : undefined;
      if (rep !== undefined && (best === undefined || rep.tick >= best.tick)) best = rep;
    }
    return best;
  }

  private causeOf(ev: Destroyed): KillCause {
    const { entity, by, tick } = ev;
    const suppressed = this.pinned.has(entity);
    const attacker = by >= 0 ? this.world.typeIdOf(by) : undefined;
    const base = { ...(attacker === undefined ? {} : { attacker }), suppressed };
    const weapon = ev.weaponId;
    const withWeapon = weapon === undefined ? {} : { weapon };
    switch (ev.cause) {
      case 'spent':
        return { kind: 'spent', ...base };
      case 'splash':
        // A blast names no plate and no penetration, even when the same shooter holed this hull a moment earlier.
        return { kind: 'splash', ...base, ...withWeapon };
      case 'strike':
      case 'bleed':
      case 'collapse':
      case 'carrier':
      case 'other':
        return { kind: ev.cause, ...base };
      default:
        break; // 'direct', or no cause at all: the join below
    }
    const hit = this.killingHit(entity, by, weapon, tick);
    if (hit !== undefined) {
      return {
        kind: hit.kind,
        ...base,
        weapon: hit.weapon,
        ...(hit.arc === undefined ? {} : { arc: hit.arc }),
        ...(hit.penetrated === undefined ? {} : { penetrated: hit.penetrated }),
      };
    }
    // A kamikaze spends itself on its target: the sim destroys it `by` the thing it hit, which never fired on it. (An event with a `cause`
    // says `spent` itself, above; this is for one without.)
    if (ev.cause === undefined && this.world.isKamikaze(entity)) return { kind: 'spent', ...base };
    // A kamikaze's strike on a SOFT target pushes no impact event: the attacker's ability, and the event's weapon, are all there is.
    if (by >= 0 && this.world.isKamikaze(by)) return { kind: 'kamikaze', ...base, ...withWeapon };
    // A direct kill whose round left no candidate still names its weapon.
    if (weapon !== undefined && attacker !== undefined) return { kind: 'gun', ...base, weapon };
    return { kind: 'other', ...base };
  }
}

/** Catalogue KEYS (not text: nothing is resolved at module load), for the kinds that name only who, or nobody. */
const BY_KEY = { strike: 'cause.strikeBy', bleed: 'cause.bleedBy', collapse: 'cause.collapseBy', carrier: 'cause.carrierBy' } as const;
const ANON_KEY = { strike: 'cause.strike', bleed: 'cause.bleed', collapse: 'cause.collapse', carrier: 'cause.carrier' } as const;

/**
 * The debrief's line for several nameless losses of one type: each distinct cause line with how many it took, the commonest first (ties
 * in the order they fell), at most `CAUSE_SUMMARY_MAX` of them and then how many more fell some other way. A loss with no stored cause
 * counts under "Cause not recorded". Undefined for an empty list. Worded at call time, in the active language.
 */
export const CAUSE_SUMMARY_MAX = 2;
export function causeSummary(causes: readonly (KillCause | undefined)[], typeName: (id: string) => string): string | undefined {
  if (causes.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const c of causes) {
    const line = c === undefined ? t('cause.unknown') : causeText(c, typeName);
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  // Map keeps first-seen order and the sort is stable, so equal counts stay in the order they fell.
  const groups = [...counts].sort((a, b) => b[1] - a[1]);
  const shown = groups.slice(0, CAUSE_SUMMARY_MAX).map(([cause, n]) => t('cause.tally', { n, cause }));
  const rest = groups.slice(CAUSE_SUMMARY_MAX).reduce((sum, [, n]) => sum + n, 0);
  if (rest > 0) shown.push(t('cause.tallyMore', { n: rest }));
  return shown.join(' ');
}

/**
 * The one line, every word through `t()`. `typeName` turns a sim type id into the unit's player-facing name (`unit-text.ts`'s `unitName`).
 * Nothing here is a number the sim owns; a figure that is not on the event is not on the line.
 */
export function causeText(c: KillCause, typeName: (id: string) => string): string {
  const who = c.attacker === undefined ? '' : typeName(c.attacker);
  const weapon = c.weapon === undefined ? '' : weaponName(c.weapon);
  let head: string;
  switch (c.kind) {
    case 'gun':
      head =
        c.penetrated === true && c.arc !== undefined
          ? t('cause.gun.penetrated', { who, weapon, arc: t(`cause.arc.${c.arc}`) })
          : t('cause.gun.shot', { who, weapon });
      break;
    case 'kamikaze':
      head = t('cause.kamikaze', { who });
      break;
    case 'beam':
      head = t('cause.beam', { who, weapon });
      break;
    case 'spent':
      head = t('cause.spent');
      break;
    case 'splash':
      head = c.attacker === undefined ? t('cause.splash') : c.weapon === undefined ? t('cause.splashBy', { who }) : t('cause.splashWeapon', { who, weapon });
      break;
    case 'strike':
    case 'bleed':
    case 'collapse':
    case 'carrier':
      // One key per kind with an attacker, one without; written out, so a key search finds each.
      head = c.attacker === undefined ? t(ANON_KEY[c.kind]) : t(BY_KEY[c.kind], { who });
      break;
    default:
      head = c.attacker === undefined ? t('cause.unknown') : t('cause.other', { who });
  }
  return c.suppressed ? `${head} ${t('cause.pinned')}` : head;
}
