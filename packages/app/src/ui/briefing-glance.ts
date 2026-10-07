// The briefing's five-row "at a glance" card (GH-417, Field order, ruling
// L-3): where, what happened, the objective, what matters, what to avoid.
//
// DERIVED, never authored. Every row is read off data a mission already
// declares -- the map's name and time of day, `target_minutes`, the briefing's
// own first beat, the objectives and their clocks, the star rules
// (`@lions/sim`'s `starRoeFloor`) and the ROE block -- so no mission needs a
// new field and a mission that changes its objectives changes its card with
// it. Pure: no DOM, so every rule is proved here without one.
//
// A row with nothing true to say is OMITTED, not padded: a sandbox-shaped
// mission with no ROE gets no "Avoid" row rather than "nothing".

import { starRoeFloor } from '@lions/sim';
import { t } from '../i18n/t';
import type { BriefingSection } from './briefing-sections';

/** m:ss from seconds. Local rather than `debrief.ts`'s `clock` so this module
 *  imports nothing from the screens that import it. */
function mmss(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export type GlanceKey = 'where' | 'happened' | 'objective' | 'matters' | 'avoid';

export interface GlanceRow {
  key: GlanceKey;
  /** The row's label, through `t()`. */
  label: string;
  text: string;
}

/** The objective types whose `seconds` is a DEADLINE (miss it and the
 *  objective fails), as opposed to a clock the player must endure
 *  (`hold_for`, `survive_until`). CLAUDE.md, "A scripted plan ... proves a
 *  mission WINNABLE": the same split. */
const DEADLINE_TYPES = new Set(['raze', 'collapse', 'evacuate_before']);

export interface GlanceObjective {
  type: string;
  primary: boolean;
  carries?: boolean;
  text?: string;
  seconds?: number;
}

export interface GlanceInputs {
  mapName?: string;
  timeOfDay?: string;
  targetMinutes?: number;
  /** The briefing's beats (`loading.ts`'s `briefingBeats`), passed in so
   *  this module does not import the screen that imports it. */
  beats?: readonly string[];
  sections?: readonly BriefingSection[] | null;
  objectives: readonly GlanceObjective[];
  roe?: { flagged_zones?: readonly string[]; fail_below?: number };
  /** `conduct-invoice.ts`'s `placeNamesFor(...).zone`: a zone id to the name
   *  of what stands in it ("civic hall"), or null. */
  zoneName?: (zoneId: string) => string | null;
}

const TOD = new Set(['dawn', 'day', 'dusk', 'night']);

/** The clock an objective shows on the briefing: "5:00 limit" for a deadline,
 *  "hold 4:00" for a clock to endure, nothing without `seconds`. The ground's
 *  marks and the briefing's objective rows use it too, so all three agree. */
export function objectiveClock(o: GlanceObjective): string | null {
  if (o.seconds === undefined) return null;
  const c = mmss(o.seconds);
  return DEADLINE_TYPES.has(o.type) ? t('glance.clock.deadline', { clock: c }) : t('glance.clock.endure', { clock: c });
}

export function briefingGlance(m: GlanceInputs): GlanceRow[] {
  const rows: GlanceRow[] = [];
  const push = (key: GlanceKey, text: string | null): void => {
    if (text !== null && text.trim().length > 0) rows.push({ key, label: t(`glance.${key}`), text });
  };

  // Where: the ground, the light, and the length.
  const where: string[] = [];
  if (m.mapName) where.push(m.mapName);
  if (m.timeOfDay && TOD.has(m.timeOfDay)) where.push(t(`glance.tod.${m.timeOfDay}`));
  if (m.targetMinutes !== undefined) where.push(t('glance.minutes', { n: m.targetMinutes }));
  push('where', where.length > 0 ? where.join(' · ') : null);

  // What happened: the Situation section's first beat when the briefing is
  // sectioned, else the briefing's own first beat.
  const situation = m.sections?.find((s) => s.id === 'situation')?.beats[0];
  push('happened', situation ?? m.beats?.[0] ?? null);

  // Objective: the first primary, and how many more.
  const primaries = m.objectives.filter((o) => o.primary && o.text);
  if (primaries.length > 0) {
    const first = primaries[0].text as string;
    push('objective', primaries.length > 1 ? t('glance.objective.more', { text: first, n: primaries.length - 1 }) : first);
  }

  // What matters: the star rules -- the second star's Conduct floor and the
  // third star's carrying secondaries (`grade.ts` `starsFor`).
  const matters: string[] = [t('glance.matters.floor', { floor: starRoeFloor(m.roe?.fail_below) })];
  const carrying = m.objectives.filter((o) => !o.primary && o.carries === true && o.text);
  if (carrying.length > 0) {
    matters.push(
      carrying.length === 1
        ? t('glance.matters.carries', { list: carrying[0].text as string })
        : t('glance.matters.carriesMany', { n: carrying.length })
    );
  }
  push('matters', matters.join('. '));

  // Avoid: protected ground by name, the Conduct line that ends the mission,
  // and every deadline.
  const avoid: string[] = [];
  const places = new Set<string>();
  for (const z of m.roe?.flagged_zones ?? []) {
    const name = m.zoneName?.(z);
    if (name) places.add(name);
  }
  for (const p of places) avoid.push(t('glance.avoid.zone', { place: p }));
  if (m.roe?.fail_below !== undefined) avoid.push(t('glance.avoid.conduct', { n: m.roe.fail_below }));
  for (const o of m.objectives) {
    if (o.primary && o.seconds !== undefined && DEADLINE_TYPES.has(o.type) && o.text) {
      avoid.push(t('glance.avoid.deadline', { clock: mmss(o.seconds), text: o.text }));
    }
  }
  push('avoid', avoid.length > 0 ? avoid.join('. ') : null);

  return rows;
}
