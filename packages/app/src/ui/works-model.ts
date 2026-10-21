// Field works (GH-277), Task 10: the placement preview, as pure data.
//
// No DOM and no three here. `main.ts` (Task 11) reads the cursor tile, asks the
// runtime `constructReason`, and hands the answer to `worksPreview`, which says
// what the renderer draws: a gridded flat footprint pad (valid or not), the
// aura rings, and the cursor tooltip's catalogue key. Treatment B (spec §6):
// the pad is an outline and a grid, the rings are dashed or dotted with NO
// fill, so neither type carries a fill field and a test holds it.

import type { MissionEvent, StructureType, WorksRefusal } from '@lions/sim';
import { DOMAIN_FOOT, DOMAIN_VEHICLE, REGEN_FRAC, fx, worksRefund } from '@lions/sim';
import type { AuraRingView, PlacementPreview } from '@lions/render';
import { t } from '../i18n/t';
import { escapeHtml } from './escape-html';
import type { Tone } from './hud-model';

/** What a preview needs of a structure type, in tiles (not Q16.16). */
export interface WorksShape {
  fw: number;
  fh: number;
  area: readonly { radius: number }[];
  sensor: { sight: number; tunnelRadius: number } | null;
}

/**
 * The parsed sim type in tiles. Radii are stored squared, so they are rooted
 * here, once, at the app's float boundary; the integers authored in
 * `data/structures.json` (4, 10, 10) round-trip exactly. A type with no
 * `buildable` block has no footprint and reads 1x1.
 */
export function worksShapeOf(type: StructureType): WorksShape {
  const root = (sq: number): number => Math.round(Math.sqrt(fx.toNumber(sq)) * 1000) / 1000;
  const aura = type.aura;
  return {
    fw: type.buildable?.fw ?? 1,
    fh: type.buildable?.fh ?? 1,
    area: aura === null ? [] : aura.area.map((a) => ({ radius: root(a.radiusSq) })),
    sensor: aura?.sensor == null ? null : { sight: fx.toNumber(aura.sensor.sight), tunnelRadius: root(aura.sensor.tunnelRadiusSq) },
  };
}

export interface WorksPreview {
  pad: PlacementPreview;
  rings: AuraRingView[];
  /** `works.refuse.<code>` for the cursor tooltip, or null when the pad is valid. */
  tooltipKey: string | null;
}

/** `works.refuse.<code>`: every refusal the runtime can return has a line. */
export function refusalKey(r: WorksRefusal | 'no_site_slot' | 'no_builder'): string {
  return `works.refuse.${r}`;
}

/**
 * The preview for a works type at tile (`tx`, `ty`), its top-left tile. Rings
 * are centred on the footprint. Equal area radii draw once (the workshop's
 * repair and accuracy areas share one circle). The intel centre draws its sight
 * ring dashed and its tunnel ring dotted, both at their authored radius; the
 * renderer sets the dotted one a few screen pixels outside where they coincide.
 */
export function worksPreview(type: WorksShape, tx: number, ty: number, reason: WorksRefusal | null): WorksPreview {
  return {
    pad: { x: tx, y: ty, w: type.fw, h: type.fh, valid: reason === null },
    rings: worksRings(type, tx + type.fw / 2, ty + type.fh / 2),
    tooltipKey: reason === null ? null : refusalKey(reason),
  };
}

/** The rings of a works type centred on (`cx`, `cy`) in tiles: the same set whether the works
 *  is being placed or already stands (hover / selection). Equal area radii draw once. */
export function worksRings(type: WorksShape, cx: number, cy: number): AuraRingView[] {
  const rings: AuraRingView[] = [];
  const seen = new Set<number>();
  for (const a of type.area) {
    if (a.radius <= 0 || seen.has(a.radius)) continue;
    seen.add(a.radius);
    rings.push({ cx, cy, radius: a.radius, style: 'dashed' });
  }
  if (type.sensor !== null) {
    if (type.sensor.sight > 0 && !seen.has(type.sensor.sight)) rings.push({ cx, cy, radius: type.sensor.sight, style: 'dashed' });
    if (type.sensor.tunnelRadius > 0) rings.push({ cx, cy, radius: type.sensor.tunnelRadius, style: 'dotted' });
  }
  return rings;
}

/** The sight and tunnel rings coincide at the approved 10/10; while an intel centre is being
 *  placed the cursor tooltip names both. Catalogue keys, in the order drawn. */
export function worksLegendKeys(type: WorksShape): string[] {
  if (type.sensor === null) return [];
  const keys: string[] = [];
  if (type.sensor.sight > 0) keys.push('dock.works.legend.sight');
  if (type.sensor.tunnelRadius > 0) keys.push('dock.works.legend.tunnel');
  return keys;
}

/** What the own-unit card says an aura is doing for this unit right now: the medic chip for a
 *  foot unit healed above the field-regen floor while hurt, the workshop chip for a vehicle
 *  repaired (hit points above the floor while hurt, or a killed component in a repair area). */
export interface AuraChipInput {
  domain: number;
  healRate: number;
  hp: number;
  maxHp: number;
  compAt: number;
  componentKilled: boolean;
}

export function auraChipKey(c: AuraChipInput): 'hud.card.chip.medic' | 'hud.card.chip.workshop' | null {
  const healed = c.healRate > REGEN_FRAC && c.hp < c.maxHp;
  if (c.domain === DOMAIN_FOOT) return healed ? 'hud.card.chip.medic' : null;
  if (c.domain === DOMAIN_VEHICLE) return healed || (c.compAt > 0 && c.componentKilled) ? 'hud.card.chip.workshop' : null;
  return null;
}

/** The works card: what the HUD prints for a selected own works. A complete works has no
 *  card (rings only, §0: no sell), so this is null for one. */
export interface WorksCardModel {
  name: string;
  percent: number;
  /** Whole logistics a cancel gives back now. */
  refund: number;
}

export function worksCardModel(name: string, progress: number, one: number, logistics: number): WorksCardModel {
  return { name, percent: Math.min(100, Math.floor((progress * 100) / one)), refund: worksRefund(logistics, progress) };
}

/** The feed line for a `works` mission event, or null. The type's display name is data and is
 *  escaped before it reaches `t()` (the feed sets innerHTML). */
export function worksEventNotice(e: Extract<MissionEvent, { kind: 'works' }>, name: string): [string, Tone] | null {
  const n = escapeHtml(name);
  switch (e.phase) {
    case 'started':
      return [t('feed.works.started', { name: n }), 'info'];
    case 'complete':
      return [t('feed.works.complete', { name: n }), 'good'];
    case 'destroyed':
      return [t('feed.works.destroyed', { name: n }), 'bad'];
    case 'cancelled':
      return [t('feed.works.cancelled', { name: n }), 'info'];
    case 'refused':
      return [t('feed.works.refused', { name: n, reason: t(refusalKey(e.reason ?? 'no_builder')) }), 'bad'];
  }
}
