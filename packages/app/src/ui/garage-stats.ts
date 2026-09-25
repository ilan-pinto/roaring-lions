// The stat panel: one reading of a unit's numbers -- base, kit and (while a
// rung is hovered) preview -- that the bay draws under the unit's name (T6b).
//
// This module owns the arithmetic and the DOM for that one panel. It is
// split out of `brigade.ts` (WP-S3g Task 6) so the pure half -- `previewDeltas`
// and `statBar` -- can be swept against `applyUpgrades` on its own, and so
// Task 7 can consume `previewDeltas` and `StatPanel.preview` without pulling
// in the whole garage screen.
//
// The one rule `previewDeltas` exists to get right: a tier's `patch` is
// cumulative over BASE (`upgrades.ts`'s own header), so what hovering a
// future tier changes is that tier's cumulative patch MINUS the tier the
// player already owns -- never minus the tier below the hovered one (that
// undercounts what is already bought into the tier below `owned`) and never
// minus nothing when the hovered tier IS the owned one (that is `undefined -
// undefined` read as a full re-buy, the Lavi's 3750 -> 3960 double-count F5
// found).
import { readPath, type UpgradableUnit, type UpgradeTrack } from '@lions/data';
import { t } from '../i18n/t';
import { prefersReducedMotion } from './motion';
import { asPercent, benefitLabel, type BenefitUnitKind } from './upgrade-benefit';

/** The six stats the bay's panel reads, in the order it draws them. Paths, not
 *  field names, because these are the SAME whitelist paths a tier's patch
 *  names. Moved here from `brigade.ts` (WP-S3g T6); this is the only copy --
 *  `brigade.ts` imports it for the roster maxima the bars scale against. */
export const PANEL_PATHS: readonly string[] = [
  'hull.hp',
  'hull.armor.front',
  'hull.armor.side',
  'hull.armor.rear',
  'sensors.sight_tiles',
  'weapons[0].accuracy',
];

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** One track at tier `n`, per path: `applyUpgrades`'s per-track rule (a
 *  tier's patch is cumulative over BASE, and the last tier to name a path
 *  wins), for this one track. */
function trackPatchAt(track: UpgradeTrack, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < Math.min(n, track.tiers.length); i++) Object.assign(out, track.tiers[i].patch);
  return out;
}

/** What hovering tier `tier` would change, over the unit as bought: tier
 *  `tier` of this track minus the OWNED tier of this track (R-6), per path,
 *  zeros dropped. Empty for an owned rung (F5) or a tier outside the track. */
export function previewDeltas(
  unit: UpgradableUnit,
  track: string,
  owned: number,
  tier: number
): ReadonlyMap<string, number> {
  const spec = unit.upgrades?.[track];
  const out = new Map<string, number>();
  if (spec === undefined || tier <= owned || tier < 1 || tier > spec.tiers.length) return out;
  const to = trackPatchAt(spec, tier);
  const from = trackPatchAt(spec, owned);
  for (const path of new Set([...Object.keys(to), ...Object.keys(from)])) {
    const d = round2((to[path] ?? 0) - (from[path] ?? 0));
    if (d !== 0) out.set(path, d);
  }
  return out;
}

export function statNumber(value: number, kind: string): string {
  return kind === 'percent' ? t('garage.stat.percent', { n: asPercent(value) }) : String(value);
}

export interface StatBar {
  readonly basePct: number;
  readonly kitPct: number;
  readonly previewPct: number;
  readonly figure: string;
  readonly kit: string | null;
}

/** One row's three segments, in percent of the roster's fully kitted
 *  maximum (R-5), each clamped so the three never overflow the track. */
export function statBar(i: {
  base: number | undefined;
  owned: number | undefined;
  preview: number;
  max: number;
  kind: BenefitUnitKind;
}): StatBar {
  if (i.base === undefined || i.owned === undefined) {
    return { basePct: 0, kitPct: 0, previewPct: 0, figure: t('garage.stat.none'), kit: null };
  }
  const pct = (v: number): number => (i.max > 0 ? (Math.max(0, v) * 100) / i.max : 0);
  const basePct = Math.min(100, pct(i.base));
  const kitDelta = round2(i.owned - i.base);
  const kitPct = Math.min(100 - basePct, pct(kitDelta));
  const previewPct = Math.min(100 - basePct - kitPct, pct(i.preview));
  const after = round2(i.owned + i.preview);
  return {
    basePct,
    kitPct,
    previewPct,
    figure:
      i.preview !== 0
        ? t('garage.stat.preview', { before: statNumber(i.owned, i.kind), after: statNumber(after, i.kind) })
        : statNumber(i.owned, i.kind),
    kit: kitDelta > 0 ? t('garage.stat.kit', { n: statNumber(kitDelta, i.kind) }) : null,
  };
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export interface StatPanel {
  readonly el: HTMLElement;
  preview(deltas: ReadonlyMap<string, number> | null): void;
}

interface PanelRow {
  readonly path: string;
  readonly kind: BenefitUnitKind;
  readonly base: number | undefined;
  readonly owned: number | undefined;
  readonly max: number;
  /** The whole row (fix round 1, F4): scrolled into view when its own
   *  preview changes, now that the panel scrolls internally rather than
   *  being guaranteed to already be on screen. */
  readonly el: HTMLElement;
  readonly fill: HTMLElement;
  readonly kitBar: HTMLElement;
  readonly deltaBar: HTMLElement;
  readonly num: HTMLElement;
  readonly kitN: HTMLElement;
}

/** The bay's `.rl-garage__stats` panel: one row per `PANEL_PATHS` entry that
 *  `benefitLabel` knows, each drawing `base` (ink), the kit `asOwned` bought
 *  over it (`--kit`) and, while `preview` holds a delta for its path, a third
 *  segment (`--good`) on top of that -- against `rosterMax`, the roster's own
 *  fully-kitted maximum for that stat (R-5). */
export function statPanel(
  base: UpgradableUnit,
  asOwned: UpgradableUnit,
  rosterMax: ReadonlyMap<string, number>
): StatPanel {
  const wrap = el('div', 'rl-garage__stats');
  wrap.appendChild(el('h3', 'rl-garage__board-title', t('garage.board.stats')));

  const rows: PanelRow[] = [];
  for (const path of PANEL_PATHS) {
    const meta = benefitLabel(path);
    if (meta === null) continue;
    const stat = el('div', 'rl-garage__stat');
    stat.dataset.path = path;
    stat.appendChild(el('span', 'rl-garage__stat-label', meta.label));

    const bar = el('span', 'rl-garage__stat-bar');
    const fill = el('span', 'rl-garage__stat-fill');
    const kitBar = el('span', 'rl-garage__stat-kit');
    const deltaBar = el('span', 'rl-garage__stat-delta');
    bar.append(fill, kitBar, deltaBar);
    stat.appendChild(bar);

    const num = el('span', 'rl-garage__stat-n');
    stat.appendChild(num);
    const kitN = el('span', 'rl-garage__stat-kitn');
    stat.appendChild(kitN);

    wrap.appendChild(stat);
    rows.push({
      path,
      kind: meta.unit,
      base: readPath(base, path),
      owned: readPath(asOwned, path),
      max: rosterMax.get(path) ?? 0,
      el: stat,
      fill,
      kitBar,
      deltaBar,
      num,
      kitN,
    });
  }

  function paint(deltas: ReadonlyMap<string, number> | null): void {
    for (const row of rows) {
      const preview = deltas?.get(row.path) ?? 0;
      const bar = statBar({ base: row.base, owned: row.owned, preview, max: row.max, kind: row.kind });
      row.fill.style.width = `${bar.basePct}%`;
      row.kitBar.style.width = `${bar.kitPct}%`;
      row.deltaBar.style.width = `${bar.previewPct}%`;
      row.num.textContent = bar.figure;
      row.kitN.textContent = bar.kit ?? '';
      row.kitN.hidden = bar.kit === null;
      // Fix round 1 (F4): the panel now scrolls inside its own region
      // instead of being guaranteed to fit whole, so a rung's preview has to
      // bring its own row along. `block: 'nearest'` moves only as far as
      // needed -- a row already on screen does not jump -- and reduced
      // motion drops the smoothing, never the scroll itself. jsdom carries
      // no `scrollIntoView` at all (`brigade.test.ts` hits every hover/focus
      // path this drives), so this is a no-op there rather than a throw.
      if (preview !== 0 && typeof row.el.scrollIntoView === 'function') {
        row.el.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    }
  }

  paint(null);

  return { el: wrap, preview: paint };
}
