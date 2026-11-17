/**
 * Why a unit died (GH-1380): the one line the unit card and the debrief print, derived from `SimEvent`s the sim already emits.
 *
 * Invariant 4: this only READS events. It writes nothing back to the sim and adds no field to any event. `destroyed` carries
 * `{ entity, by }` and no weapon, so the cause is a join across the target's earlier events:
 *   - `impact` that PENETRATED (a hard hull; carries the weapon, the arc that was hit, `penetrated`) -- a gun, or a kamikaze's terminal strike;
 *   - `fire` that `willHit` (a soft target: no impact event exists, so this names the weapon);
 *   - `beam` `struck` (a directed-energy hit);
 *   - `pinned` / `unpinned`, which say whether the victim was suppressed when it fell.
 * The join keys on `shooter === by`: a record from anyone else is not the killing blow, and the line then names only the attacker.
 * What the events cannot say (a splash or an indirect round that never named the victim) comes out as `other`, never a guess. The smallest
 * sim-side addition that would close that gap is a `weaponId` on `destroyed`; it is NOT made here (the event is the sim's, guarded separately).
 */
import type { SimEvent } from '@lions/sim';
import { t } from './i18n/t';
import { weaponName } from './ui/weapon-name';

/** How long a hit stays a candidate for the kill. Ten seconds: a hull that burns after the hit still names the hit that started it. */
export const CAUSE_WINDOW_TICKS = 200;

/** The plate a round met, as the sim's `impact` event names it. */
export type KillArc = Extract<SimEvent, { kind: 'impact' }>['arc'];

export type KillCauseKind = 'gun' | 'kamikaze' | 'beam' | 'spent' | 'other';

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

const KINDS: readonly string[] = ['gun', 'kamikaze', 'beam', 'spent', 'other'];
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

export class KillCauseTracker {
  private readonly hits = new Map<number, Hit>();
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
        const cause = this.causeOf(ev.entity, ev.by, ev.tick);
        this.hits.delete(ev.entity);
        this.pinned.delete(ev.entity);
        return cause;
      }
      default:
        return undefined;
    }
  }

  private note(target: number, hit: Hit): void {
    const prior = this.hits.get(target);
    // A penetration is the only thing that ends a hard hull, and the `fire` of the NEXT round (same shooter) is not a later cause: it
    // never replaces a penetrating `impact`. Anything else, the latest event wins.
    if (prior !== undefined && prior.shooter === hit.shooter && prior.penetrated === true && hit.penetrated !== true) return;
    this.hits.set(target, hit);
  }

  private causeOf(entity: number, by: number, tick: number): KillCause {
    const suppressed = this.pinned.has(entity);
    const attacker = by >= 0 ? this.world.typeIdOf(by) : undefined;
    const base = { ...(attacker === undefined ? {} : { attacker }), suppressed };
    const hit = this.hits.get(entity);
    if (hit !== undefined && hit.shooter === by && tick - hit.tick <= CAUSE_WINDOW_TICKS) {
      return {
        kind: hit.kind,
        ...base,
        weapon: hit.weapon,
        ...(hit.arc === undefined ? {} : { arc: hit.arc }),
        ...(hit.penetrated === undefined ? {} : { penetrated: hit.penetrated }),
      };
    }
    // A kamikaze spends itself on its target: the sim destroys it `by` the thing it hit, which never fired on it.
    if (this.world.isKamikaze(entity)) return { kind: 'spent', ...base };
    // A kamikaze's strike on a SOFT target pushes no impact event: the attacker's ability is all the events can say.
    if (by >= 0 && this.world.isKamikaze(by)) return { kind: 'kamikaze', ...base };
    return { kind: 'other', ...base };
  }
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
    default:
      head = c.attacker === undefined ? t('cause.unknown') : t('cause.other', { who });
  }
  return c.suppressed ? `${head} ${t('cause.pinned')}` : head;
}
