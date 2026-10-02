/**
 * The Conduct invoice (GH-345, spec §d): every Conduct deduction this mission,
 * grouped by cause and place, worded for a player.
 *
 * The sim says WHY it deducted only as an English string (`stepRoe` in
 * `packages/sim/src/mission.ts`), and the sim is closed until Stage 4, when a
 * structured `category`/`zone` on the `roe` event can replace this. Until then
 * this file PARSES data it does not own -- which is exactly why
 * `conduct-invoice.test.ts` lists every template `stepRoe` can produce,
 * literally, and reads `mission.ts`'s own source to prove each one is still
 * there: change a template there and that spec goes red, rather than the
 * invoice quietly filing a new reason under "other".
 *
 * Pure: no DOM, no sim. Labels go through `t()`; a place name is data (a
 * structure's catalogue `name`, or the zone id when the map has no structure
 * there) and flows through unchanged.
 */

import { t } from '../i18n/t';

/** What `stepRoe` charged for. The two danger-close templates share one cause:
 *  to a player they are the same mistake. */
export type ConductCause = 'destroyed' | 'civilians' | 'struck' | 'strike' | 'danger_close' | 'other';

export interface ConductReason {
  cause: ConductCause;
  /** A flagged zone's id (`struck`, `strike`) or a structure type id
   *  (`destroyed`). Absent for causes with no place. */
  place?: string;
}

/** One `roe` event, as `main.ts` collects it. `tick` is when it landed. */
export interface Deduction {
  penalty: number;
  reason: string;
  tick?: number;
}

export interface InvoiceLine {
  /** Already worded: "Clinic struck", "Civilians killed". */
  label: string;
  cause: ConductCause;
  count: number;
  /** Points lost to this line, summed (positive). */
  total: number;
  /** When each deduction on this line landed, in ticks, oldest first. */
  ticks: number[];
}

const PROTECTED = /^(fire|strike) into protected structure \((.+)\)$/;
const DESTROYED = /^([A-Z][a-z0-9_]*) destroyed$/;

/** Read one of `stepRoe`'s reason strings. */
export function classifyReason(reason: string): ConductReason {
  if (reason === 'civilian casualties') return { cause: 'civilians' };
  if (reason === 'strike called danger-close to civilians' || reason === 'heavy ordnance danger-close to civilians') {
    return { cause: 'danger_close' };
  }
  const prot = PROTECTED.exec(reason);
  if (prot) return { cause: prot[1] === 'fire' ? 'struck' : 'strike', place: prot[2] };
  const dest = DESTROYED.exec(reason);
  if (dest) return { cause: 'destroyed', place: dest[1].charAt(0).toLowerCase() + dest[1].slice(1) };
  return { cause: 'other' };
}

/**
 * Names for the places a reason mentions. `zone` resolves a flagged zone's id
 * to the structure standing in it (`z_clinic` -> "Clinic"); `structure`
 * resolves a structure type id to its catalogue name. Either may answer null,
 * and the line then names the raw id rather than nothing.
 */
export interface PlaceNames {
  zone: (zoneId: string) => string | null;
  structure: (typeId: string) => string | null;
}

/**
 * Place names from a map: a zone resolves to the structure type with the most
 * tiles inside its rectangle, a type id to its catalogue name. Structural
 * types, so a test can hand it a three-tile map rather than a parsed one.
 */
export function placeNamesFor(
  map: {
    width: number;
    zones: Readonly<Record<string, readonly number[]>>;
    structures: readonly { type: string; tiles: readonly number[] }[];
  },
  catalogue: Readonly<Record<string, { name: string } | undefined>>
): PlaceNames {
  const structure = (id: string): string | null => catalogue[id]?.name ?? null;
  const zone = (zoneId: string): string | null => {
    const r = map.zones[zoneId];
    if (r === undefined || r.length < 4) return null;
    const [zx, zy, zw, zh] = r;
    const tilesOf = new Map<string, number>();
    for (const b of map.structures) {
      let n = 0;
      for (const tile of b.tiles) {
        const x = tile % map.width;
        const y = (tile - x) / map.width;
        if (x >= zx && x < zx + zw && y >= zy && y < zy + zh) n++;
      }
      if (n > 0) tilesOf.set(b.type, (tilesOf.get(b.type) ?? 0) + n);
    }
    let best: string | null = null;
    let most = 0;
    for (const [type, n] of tilesOf) {
      if (n > most) {
        most = n;
        best = type;
      }
    }
    return best === null ? null : structure(best);
  };
  return { zone, structure };
}

/** The player-facing label for one reason. */
export function reasonLabel(reason: string, names: PlaceNames): string {
  const r = classifyReason(reason);
  switch (r.cause) {
    case 'civilians':
      return t('conduct.cause.civilians');
    case 'danger_close':
      return t('conduct.cause.dangerClose');
    case 'struck':
      return t('conduct.cause.struck', { place: names.zone(r.place ?? '') ?? r.place ?? '' });
    case 'strike':
      return t('conduct.cause.strike', { place: names.zone(r.place ?? '') ?? r.place ?? '' });
    case 'destroyed':
      return t('conduct.cause.destroyed', { place: names.structure(r.place ?? '') ?? r.place ?? '' });
    case 'other':
      // Unparsed: the sim's own words, which are data. The template test is
      // what keeps this branch for reasons a future sim adds, never for
      // one of today's.
      return reason;
  }
}

/** Group deductions into invoice lines, in order of first occurrence. */
export function invoiceLines(deductions: readonly Deduction[], names: PlaceNames): InvoiceLine[] {
  const byLabel = new Map<string, InvoiceLine>();
  for (const d of deductions) {
    const label = reasonLabel(d.reason, names);
    let line = byLabel.get(label);
    if (line === undefined) {
      line = { label, cause: classifyReason(d.reason).cause, count: 0, total: 0, ticks: [] };
      byLabel.set(label, line);
    }
    line.count++;
    line.total += d.penalty;
    if (d.tick !== undefined) line.ticks.push(d.tick);
  }
  return [...byLabel.values()];
}

/** "Clinic struck ×2 −10" -- one line, the count only when it is above one. */
export function lineText(line: InvoiceLine): string {
  return t('conduct.line', { label: line.label, count: line.count, total: line.total });
}

/**
 * The end screen's one-line summary: the costliest line, and a count of the
 * rest. Empty when nothing was deducted -- the end screen then prints the
 * bare score, which is the honest summary of a clean fight.
 */
export function invoiceSummary(lines: readonly InvoiceLine[]): string {
  if (lines.length === 0) return '';
  const worst = [...lines].sort((a, b) => b.total - a.total)[0];
  const rest = lines.length - 1;
  return rest > 0 ? t('conduct.summary.more', { line: lineText(worst), n: rest }) : lineText(worst);
}

/** A mission clock, m:ss from ticks at 20 Hz. */
export function invoiceClock(tick: number): string {
  const s = Math.floor(tick / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
