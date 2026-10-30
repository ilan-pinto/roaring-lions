/**
 * The formation row's markup (GH-859 P1a; the approved HUD mock, Q1-Q3): a button's glyph, and the
 * tooltip with its schematic.
 *
 * Strings only, no DOM and no sim. Every WORD comes from `formation-model.ts`'s accessors (so it
 * goes through `t()` at the moment it is asked); every SHAPE comes from the model's
 * `schematicSlots`, which is the sim's `templateOffsets` over the compiled shipped formation, so
 * the picture cannot disagree with the order. The marks are drawn in semantic tokens through
 * `var(--ink)`, `var(--good)` and the like: there is no colour literal here.
 */
import {
  formationBlurb,
  formationFacingLine,
  formationLabel,
  formationLegendMark,
  formationLegendRows,
  schematicRing,
  schematicSlots,
  type FormationCounts,
  type FormationId,
  type LegendClass,
  type SchematicSlot,
} from './formation-model';
import { symbolSvg } from './symbol';

/** The glyph's height in the button, as the order row's own. */
export const FORMATION_GLYPH_PX = 14;

const FAMILY: Readonly<Record<FormationId, 'manoeuvre' | 'offensive' | 'control'>> = {
  column: 'manoeuvre',
  attack: 'offensive',
  ambush: 'control',
};

/** The button's glyph span: the family colour is theme.css's, keyed on `data-family`. */
export function formationGlyphHtml(id: FormationId): string {
  return `<span class="rl-order__glyph" data-family="${FAMILY[id]}">${symbolSvg(`formation-${id}`, FORMATION_GLYPH_PX)}</span>`;
}

/** One class's mark, centred on (cx, cy). Ported from the mock's `mark()`. */
function mark(c: LegendClass, cx: number, cy: number): string {
  const ink = 'var(--ink)';
  switch (c) {
    case 'armour':
      return `<rect x="${cx - 5}" y="${cy - 4}" width="10" height="8" fill="${ink}"/>`;
    case 'light_vehicle':
      return `<rect x="${cx - 3.2}" y="${cy - 3.2}" width="6.4" height="6.4" fill="none" stroke="${ink}" stroke-width="1.6"/>`;
    case 'recon':
      return `<path d="M${cx} ${cy - 4} L${cx + 4} ${cy} L${cx} ${cy + 4} L${cx - 4} ${cy} Z" fill="none" stroke="${ink}" stroke-width="1.6"/>`;
    case 'infantry':
      return `<circle cx="${cx}" cy="${cy}" r="3.3" fill="var(--ink-mute)"/>`;
    case 'support_weapon':
      return `<path d="M${cx} ${cy - 4} L${cx + 4} ${cy + 3} L${cx - 4} ${cy + 3} Z" fill="var(--ink-mute)"/>`;
    case 'medic':
      return `<path d="M${cx - 1.3} ${cy - 4} h2.6 v2.7 h2.7 v2.6 h-2.7 v2.7 h-2.6 v-2.7 h-2.7 v-2.6 h2.7 Z" fill="var(--good)"/>`;
    case 'ccp':
      return (
        `<rect x="${cx - 4.2}" y="${cy - 4.2}" width="8.4" height="8.4" fill="none" stroke="var(--good)" stroke-width="1.4"/>` +
        `<path d="M${cx - 1} ${cy - 2.8} h2 v1.8 h1.8 v2 h-1.8 v1.8 h-2 v-1.8 h-1.8 v-2 h1.8 Z" fill="var(--good)"/>`
      );
    case 'aircraft':
      return `<path d="M${cx - 5} ${cy - 3} L${cx} ${cy + 1.5} L${cx + 5} ${cy - 3} L${cx + 5} ${cy - 0.8} L${cx} ${cy + 3.7} L${cx - 5} ${cy - 0.8} Z" fill="var(--info)"/>`;
  }
}

const CELL = 17;

/**
 * The schematic: one mark per unit on open ground, the click as a hairline cross (attack) or a
 * kill-zone cross inside the dashed ring (ambush), and a travel arrow. Slots arrive as the sim's
 * `{forward, lateral}`; the picture puts forward up, so `y = -forward`.
 */
export function schematicSvg(id: FormationId, slots: readonly SchematicSlot[]): string {
  const radius = id === 'ambush' ? schematicRing(id, slots) : 0;
  const pts = slots.map((s) => ({ c: s.cls, x: s.lateral, y: -s.forward }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 1.2;
  const minX = Math.min(...xs, id === 'ambush' ? -radius : 0) - pad;
  const maxX = Math.max(...xs, id === 'ambush' ? radius : 0) + pad;
  const minY = Math.min(...ys, id === 'ambush' ? -radius : -1) - pad;
  const maxY = Math.max(...ys, 0) + pad;
  const W = Math.max(7, maxX - minX) * CELL;
  const H = (maxY - minY) * CELL;
  const px = (x: number): number => (x - minX) * CELL;
  const py = (y: number): number => (y - minY) * CELL;
  let g = '';
  if (id === 'attack') {
    g += `<path d="M${px(0)} ${py(-0.9)} V${py(0.9)} M${px(-1.1)} ${py(0)} H${px(1.1)}" stroke="var(--order-offensive)" stroke-width="1.2" opacity="0.8"/>`;
  }
  if (id === 'ambush') {
    g += `<circle cx="${px(0)}" cy="${py(0)}" r="${radius * CELL}" fill="none" stroke="var(--panel-rule)" stroke-dasharray="2 3" stroke-width="1"/>`;
    g += `<path d="M${px(-0.6)} ${py(-0.6)} L${px(0.6)} ${py(0.6)} M${px(0.6)} ${py(-0.6)} L${px(-0.6)} ${py(0.6)}" stroke="var(--warn)" stroke-width="1.8"/>`;
  }
  for (const p of pts) g += `<g transform="translate(${px(p.x)} ${py(p.y)}) scale(1.3)">${mark(p.c, 0, 0)}</g>`;
  if (id === 'column' || id === 'attack') {
    g += `<path d="M${px(minX + 0.35)} ${py(minY + 1.9)} V${py(minY + 0.5)} m-3 2.4 l3 -2.8 l3 2.8" fill="none" stroke="var(--ink-dim)" stroke-width="1.3"/>`;
  } else {
    g += `<path d="M${W - 8} ${H - 4} V${H - 26} m-3 2.4 l3 -2.8 l3 2.8" fill="none" stroke="var(--ink-dim)" stroke-width="1.3"/>`;
  }
  return `<svg class="rl-formtip__svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" aria-hidden="true">${g}</svg>`;
}

/** The legend: a mark, the class and its count per present class, then the click or kill-zone line. */
function legendHtml(id: FormationId, counts: FormationCounts): string {
  const rows = formationLegendRows(counts)
    .map((r) => `<li><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">${mark(r.cls, 7, 6)}</svg><span>${r.label}</span><b>${r.n}</b></li>`)
    .join('');
  const extra = formationLegendMark(id);
  const tail =
    extra === null
      ? ''
      : extra.mark === 'click'
        ? `<li><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M7 1 V11 M2 6 H12" stroke="var(--order-offensive)" stroke-width="1.4"/></svg><span>${extra.label}</span></li>`
        : `<li><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M3 2 L11 10 M11 2 L3 10" stroke="var(--warn)" stroke-width="1.8"/></svg><span>${extra.label}</span></li>`;
  return `<ul class="rl-formtip__legend">${rows}${tail}</ul>`;
}

/**
 * The whole tooltip body: name, blurb, schematic and legend, the composed face / drill / shape
 * line, and (an inert button) why. `counts` are the free placeable units of the selection.
 */
export function formationTipHtml(id: FormationId, counts: FormationCounts, reason: string | null): string {
  const slots = schematicSlots(id, counts);
  const body =
    slots.length === 0
      ? ''
      : `<div class="rl-formtip">${schematicSvg(id, slots)}${legendHtml(id, counts)}</div>`;
  const why = reason === null ? '' : `<div class="rl-tip__blurb rl-dim">${reason}</div>`;
  return (
    `<div class="rl-tip__head"><span class="rl-tip__name">${formationLabel(id)}</span></div>` +
    `<div class="rl-tip__blurb">${formationBlurb(id)}</div>` +
    body +
    `<div class="rl-tip__blurb rl-dim">${formationFacingLine(id)}</div>` +
    why
  );
}
