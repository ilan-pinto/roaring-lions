// The after-action report's content (GH-417, H4 + H5, Field order): what the
// player did well, what it cost them, what changed. Pure: every rule here is
// proved without a DOM, and `debrief.ts` only draws what this returns.
//
// Three columns that ALWAYS appear, in the same order, on a win and on a
// loss, so the screen teaches where to look. Above them, the verdict with its
// reason and -- on a win -- the star ladder, which says what earned each star
// and what the missing one needs (`grade.ts`'s `starsFor`: a win; Conduct at
// the star floor; every carrying secondary).

import type { Stars } from '@lions/sim';
import { t } from '../i18n/t';
import type { MissionLog } from '../mission-log';
import type { InvoiceLine } from './conduct-invoice';
import type { GroundPin } from './ground-view';

const mmss = (ticks: number): string => {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface AfterActionObjective {
  id: string;
  text: string;
  primary: boolean;
  carries: boolean;
  status: 'active' | 'complete' | 'failed';
}

/** A body that went up a stripe this mission. */
export interface Promotion {
  name?: string;
  type: string;
  from: number;
  to: number;
}

/** A unit type the campaign can now BUY in the garage -- never a unit added
 *  to the force (PA-21: "Lavi MBT available" read as a Lavi in the next
 *  mission's force). */
export interface Unlock {
  name: string;
}

export interface AfterActionInputs {
  result: 'victory' | 'defeat';
  stars: Stars;
  roe: number;
  roeFloor: number;
  ticks: number;
  targetMinutes?: number;
  objectives: readonly AfterActionObjective[];
  log: MissionLog;
  invoice: readonly InvoiceLine[];
  /** Why the mission was lost (`mission-failure.ts`), already worded. */
  failure?: string | null;
  /** Hostile units still alive at the end (victory only). */
  withdrew?: number;
  credits?: { paid: number; balance: number };
  promotions: readonly Promotion[];
  replacements: readonly { name: string; predecessor: string }[];
  unlocks: readonly Unlock[];
  next?: { name: string };
  /** The hostages line (`hostagesLine`), already worded. */
  taken?: string;
  /** A unit type's display name. */
  typeName(type: string): string;
}

export type ItemTone = 'good' | 'bad' | 'commend' | 'plain';

export interface AfterActionItem {
  /** The short mark in the left gutter: a time, a cost, a count. */
  mark: string;
  tone: ItemTone;
  text: string;
  sub?: string;
  /** A person: the report draws their portrait, greyed when `lost`. */
  person?: { type: string; lost: boolean };
  /** An objective outcome with no time to show: drawn as the objective
   *  tracker's own GH-261 mark rather than a character. */
  glyph?: 'complete' | 'failed';
}

export interface LadderRung {
  stars: 1 | 2 | 3;
  met: boolean;
  text: string;
}

export interface AfterAction {
  reason: string[];
  ladder: LadderRung[];
  well: AfterActionItem[];
  poor: AfterActionItem[];
  changed: AfterActionItem[];
  pins: GroundPin[];
}

export function afterAction(i: AfterActionInputs): AfterAction {
  const won = i.result === 'victory';
  const doneAt = new Map(i.log.objectives.filter((o) => o.status === 'complete').map((o) => [o.id, o.tick]));
  const failedAt = new Map(i.log.objectives.filter((o) => o.status === 'failed').map((o) => [o.id, o.tick]));

  // --- the verdict's reason ---------------------------------------------
  const reason: string[] = [];
  if (won) {
    for (const o of i.objectives.filter((x) => x.primary && x.status === 'complete').slice(0, 3)) {
      const at = doneAt.get(o.id);
      reason.push(at !== undefined ? t('aar.reason.done', { text: o.text, at: mmss(at) }) : o.text);
    }
    reason.push(
      i.targetMinutes !== undefined
        ? t('aar.reason.clock', { clock: mmss(i.ticks), target: i.targetMinutes })
        : t('aar.reason.clockBare', { clock: mmss(i.ticks) })
    );
  } else if (i.failure) {
    reason.push(i.failure);
  }

  // --- the star ladder (a win only) -------------------------------------
  const ladder: LadderRung[] = [];
  if (won) {
    const carrying = i.objectives.filter((o) => !o.primary && o.carries);
    const carried = carrying.filter((o) => o.status === 'complete');
    ladder.push({ stars: 1, met: true, text: t('aar.ladder.won') });
    ladder.push({ stars: 2, met: i.roe >= i.roeFloor, text: t('aar.ladder.conduct', { roe: i.roe, floor: i.roeFloor }) });
    ladder.push(
      carrying.length === 0
        ? { stars: 3, met: false, text: t('aar.ladder.none') }
        : {
            stars: 3,
            met: i.roe >= i.roeFloor && carried.length === carrying.length,
            text: t('aar.ladder.carries', { n: carried.length, of: carrying.length }),
          }
    );
  }

  // --- done well ---------------------------------------------------------
  const well: AfterActionItem[] = [];
  for (const o of i.objectives.filter((x) => x.status === 'complete')) {
    const at = doneAt.get(o.id);
    well.push({
      mark: at !== undefined ? mmss(at) : '',
      ...(at === undefined ? { glyph: 'complete' as const } : {}),
      tone: 'good',
      text: o.text,
      sub: o.carries ? t('aar.carries') : undefined,
    });
  }
  if (i.roe >= i.roeFloor) well.push({ mark: String(i.roe), tone: 'good', text: t('aar.well.conduct', { floor: i.roeFloor }) });
  if (i.log.kills > 0) {
    well.push({
      mark: String(i.log.kills),
      tone: 'good',
      text: won && i.withdrew !== undefined && i.withdrew > 0 ? t('aar.well.killsWithdrew', { n: i.log.kills, w: i.withdrew }) : t('aar.well.kills', { n: i.log.kills }),
    });
  }

  // --- cost you / what went wrong ------------------------------------------
  const poor: AfterActionItem[] = [];
  if (!won) {
    for (const o of i.objectives.filter((x) => x.status === 'failed')) {
      const at = failedAt.get(o.id);
      poor.push({
        mark: at !== undefined ? mmss(at) : '',
        ...(at === undefined ? { glyph: 'failed' as const } : {}),
        tone: 'bad',
        text: t('aar.poor.failed', { text: o.text }),
      });
    }
  }
  for (const line of i.invoice) {
    poor.push({
      mark: `−${line.total}`,
      tone: 'bad',
      text: line.count > 1 ? t('aar.poor.deductionTimes', { label: line.label, n: line.count }) : line.label,
      sub: line.ticks.map(mmss).join(', '),
    });
  }
  const named = i.log.losses.filter((l) => l.name !== undefined);
  for (const l of named) {
    const took = i.replacements.find((r) => r.predecessor === l.name);
    poor.push({
      mark: '',
      tone: 'bad',
      text: t('aar.poor.lostNamed', { name: l.name as string, type: i.typeName(l.type) }),
      sub: took ? t('aar.poor.lostAtReplaced', { at: mmss(l.tick), name: took.name }) : t('aar.poor.lostAt', { at: mmss(l.tick) }),
      person: { type: l.type, lost: true },
    });
  }
  const fresh = new Map<string, number>();
  for (const l of i.log.losses) if (l.name === undefined) fresh.set(l.type, (fresh.get(l.type) ?? 0) + 1);
  for (const [type, n] of fresh) poor.push({ mark: `−${n}`, tone: 'bad', text: t('aar.poor.lostFresh', { type: i.typeName(type), n }) });
  if (won) {
    for (const o of i.objectives.filter((x) => !x.primary && x.status !== 'complete')) {
      poor.push({ mark: o.carries ? '★★★' : '—', tone: 'bad', text: t('aar.poor.missed', { text: o.text }) });
    }
  }

  // --- what changed ----------------------------------------------------------
  const changed: AfterActionItem[] = [];
  if (!won) {
    changed.push({ mark: '0', tone: 'commend', text: t('aar.changed.nothing'), sub: t('aar.changed.nothingSub') });
  } else {
    if (i.credits) {
      changed.push(
        i.credits.paid > 0
          ? { mark: `+${i.credits.paid}`, tone: 'commend', text: t('aar.changed.credits', { n: i.credits.balance }), sub: t('aar.changed.creditsSub') }
          : { mark: '+0', tone: 'plain', text: t('aar.changed.creditsNone', { n: i.credits.balance }) }
      );
    }
    for (const p of i.promotions) {
      changed.push({
        mark: '',
        tone: 'commend',
        text: t('aar.changed.promoted', { name: p.name ?? i.typeName(p.type), from: '★'.repeat(p.from), to: '★'.repeat(p.to) }),
        sub: i.typeName(p.type),
        person: { type: p.type, lost: false },
      });
    }
    for (const r of i.replacements) changed.push({ mark: '', tone: 'plain', text: t('aar.changed.replaced', { name: r.name, predecessor: r.predecessor }) });
    if (i.unlocks.length > 0) {
      changed.push({ mark: t('aar.mark.garage'), tone: 'commend', text: t('aar.changed.buyable', { list: i.unlocks.map((u) => u.name).join(', ') }), sub: t('aar.changed.buyableSub') });
    }
    for (const o of i.objectives.filter((x) => !x.primary && x.carries && x.status === 'complete')) {
      changed.push({
        mark: t('aar.mark.carries'),
        tone: 'commend',
        text: i.next ? t('aar.changed.carriesInto', { text: o.text, next: i.next.name }) : t('aar.changed.carries', { text: o.text }),
      });
    }
  }
  if (i.taken) changed.push({ mark: '', tone: 'plain', text: i.taken });

  // --- pins on the ground ----------------------------------------------------
  const pins: GroundPin[] = [];
  for (const l of i.log.losses) {
    pins.push({ kind: 'loss', x: l.x, y: l.y, label: t('aar.pin.loss', { who: l.name ?? i.typeName(l.type), at: mmss(l.tick) }) });
  }
  for (const d of i.log.deductions) {
    if (d.x === undefined || d.y === undefined) continue;
    pins.push({ kind: 'deduction', x: d.x, y: d.y, label: t('aar.pin.deduction', { n: d.penalty, at: mmss(d.tick) }) });
  }

  return { reason, ladder, well, poor, changed, pins };
}

/**
 * Who went up a stripe: the roster after a win against the roster before it,
 * matched by `slot` (the durable place id E4 issues). A place a replacement
 * took is not a promotion of the replacement -- the body changed -- so a slot
 * whose NAME changed is skipped.
 */
export function promotionsBetween(
  before: readonly { slot?: number; name?: string; type: string; veterancy: number }[],
  after: readonly { slot?: number; name?: string; type: string; veterancy: number }[]
): Promotion[] {
  const was = new Map<number, { name?: string; veterancy: number }>();
  for (const e of before) if (e.slot !== undefined) was.set(e.slot, e);
  const out: Promotion[] = [];
  for (const e of after) {
    if (e.slot === undefined) continue;
    const b = was.get(e.slot);
    if (!b || b.name !== e.name || e.veterancy <= b.veterancy) continue;
    out.push({ ...(e.name !== undefined ? { name: e.name } : {}), type: e.type, from: b.veterancy, to: e.veterancy });
  }
  return out;
}
