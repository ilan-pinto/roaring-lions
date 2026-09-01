// The campaign world: Kedem at the centre, the fronts and placeholder countries
// around it, and which of them are still asking for you.
//
// A view over the ledger and nothing more. Region status is derived by @lions/data
// from campaign.completed_missions, so this file persists nothing and cannot disagree
// with what was played.
//
// The board is the flat world render (one PNG) under an SVG overlay built here from
// countries.json -- the geometry the render generator wrote, so the overlay cannot
// drift from the art. Per-country state is CSS on the overlay: a translucent veil on
// locked countries, the brigade lion flag on completed ones, a stroked border on the
// live front.

import type { LedgerData } from '@lions/sim';

import {
  campaignRoe,
  nextMissionOf,
  regionProgress,
  townProgress,
  type ParsedWorld,
  type WorldCountry,
  type WorldRegion,
} from '../campaign';

export interface WorldMapOptions {
  base: string;
  world: ParsedWorld;
  /** Generated country geometry; ids join with world.regions ids. */
  countries: readonly WorldCountry[];
  ledger: LedgerData;
  href: (missionId: string) => string;
}

/** viewBox the town coordinates in world.json are expressed in. */
const VIEW_W = 1140;
const VIEW_H = 790;

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const svgEl = (tag: string, attrs: Record<string, string>): SVGElement => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/** The brigade lion flying over a completed country, centred on its anchor.
 *  66x44 keeps the banner asset's 3:2 and reads at board scale. */
const FLAG_W = 66;
const FLAG_H = 44;

export function worldMap(opts: WorldMapOptions): HTMLElement {
  const wrap = el('div', 'rl-world');

  // --- the map itself ------------------------------------------------------
  const board = el('div', 'rl-world__board');
  const svg = svgEl('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    preserveAspectRatio: 'xMidYMid meet',
  });
  svg.appendChild(
    svgEl('image', {
      href: `${opts.base}${opts.world.art}`,
      x: '0',
      y: '0',
      width: String(VIEW_W),
      height: String(VIEW_H),
    })
  );
  // The first town, in authored order, still asking for a mission: what a click
  // on the country's ground should start.
  const nextMissionOfRegion = (region: WorldRegion): string | null => {
    for (const town of region.towns) {
      const next = nextMissionOf(town, opts.ledger);
      if (next !== null) return next;
    }
    return null;
  };

  const regionById = new Map(opts.world.regions.map((r) => [r.id, r]));
  for (const c of opts.countries) {
    // The homeland carries no campaign state: no veil, no border, no flag.
    if (c.home) continue;
    const region = regionById.get(c.id);
    // A country with no region in world.json has no campaign authored at all:
    // locked, permanently, until data exists for it.
    const p = region ? regionProgress(region, opts.ledger) : null;
    const points = c.outline.map(([x, y]) => `${x},${y}`).join(' ');
    const g = svgEl('g', { id: `region-${c.id}` });
    g.setAttribute('data-status', p?.status ?? 'locked');

    // The whole country is the control, not just its town labels: its interior
    // takes the hover (pointer-events: fill in the stylesheet), and a live
    // country is a real link into its next mission -- an SVG <a>, so middle
    // click and keyboard focus behave like every other link.
    const fill = svgEl('polygon', { class: 'country-fill', points });
    const line = svgEl('polygon', { class: 'region-outline', points, fill: 'none' });
    const next = region && p?.status === 'live' ? nextMissionOfRegion(region) : null;
    if (next !== null) {
      const hit = svgEl('a', { class: 'country-hit', href: opts.href(next) });
      hit.append(fill, line);
      g.appendChild(hit);
    } else {
      g.append(fill, line);
    }
    if (p?.status === 'complete') {
      g.appendChild(
        svgEl('image', {
          class: 'country-flag',
          href: `${opts.base}campaign/flag_brigade.png`,
          x: String(c.anchor[0] - FLAG_W / 2),
          y: String(c.anchor[1] - FLAG_H / 2),
          width: String(FLAG_W),
          height: String(FLAG_H),
        })
      );
    }
    // Same glow contract the town markers use, from the country's own ground --
    // but ONLY where the ground is actually a control. These were attached to
    // every non-home country regardless, so a locked country and an unlocked
    // one with nothing authored both lit up under the cursor and then did
    // nothing when clicked. Hover feedback is the affordance that says "this is
    // a control", so it is gated on the same `next` the <a> wrapper is.
    if (next !== null) {
      g.addEventListener('mouseenter', () => g.setAttribute('data-hover', '1'));
      g.addEventListener('mouseleave', () => g.removeAttribute('data-hover'));
      g.addEventListener('focusin', () => g.setAttribute('data-hover', '1'));
      g.addEventListener('focusout', () => g.removeAttribute('data-hover'));
    }
    svg.appendChild(g);
  }
  board.appendChild(svg);

  for (const region of opts.world.regions) {
    const p = regionProgress(region, opts.ledger);
    const g = board.querySelector(`#region-${region.id}`);

    for (const town of region.towns) {
      const next = nextMissionOf(town, opts.ledger);
      const tp = townProgress(town, opts.ledger);
      const marker = el('div', 'rl-world__town');
      marker.dataset.town = town.id;
      // The town's own state, not the region's: a region can be 'live' while
      // most of its towns have nothing authored yet, and stamping every town
      // with the region status is what made an empty town read as struck
      // through -- the same false-completion signal regionProgress's
      // total === 0 guard exists to prevent, just leaking in one level down.
      marker.dataset.status =
        tp.total > 0 && tp.done === tp.total ? 'done' : tp.total === 0 ? 'empty' : p.status;
      // Percentages, so the markers track the SVG as it scales.
      marker.style.left = `${((town.at[0] / VIEW_W) * 100).toFixed(3)}%`;
      marker.style.top = `${((town.at[1] / VIEW_H) * 100).toFixed(3)}%`;

      // Hovering a town glows its region's edge, so it is obvious which ground the town
      // belongs to before you click. The region group is a sibling of this marker rather
      // than its ancestor, so this is wired in JS: a pure-CSS :has() version would need a
      // selector per region id, generated from the data.
      if (g) {
        marker.addEventListener('mouseenter', () => g.setAttribute('data-hover', '1'));
        marker.addEventListener('mouseleave', () => g.removeAttribute('data-hover'));
        marker.addEventListener('focusin', () => g.setAttribute('data-hover', '1'));
        marker.addEventListener('focusout', () => g.removeAttribute('data-hover'));
      }

      const label = `${town.name}${tp.total > 0 ? ` ${tp.done}/${tp.total}` : ''}`;
      if (next !== null && p.status !== 'locked') {
        const a = document.createElement('a');
        a.className = 'rl-world__townlink';
        a.href = opts.href(next);
        a.textContent = label;
        marker.appendChild(a);
      } else {
        marker.appendChild(el('span', 'rl-world__townname', label));
      }
      board.appendChild(marker);
    }
  }
  wrap.appendChild(board);

  // --- the status panel ----------------------------------------------------
  const cards = el('div', 'rl-world__cards');
  for (const region of opts.world.regions) cards.appendChild(regionCard(region, opts));
  wrap.appendChild(cards);

  wrap.appendChild(ledgerLine(opts.ledger));
  return wrap;
}

function regionCard(region: WorldRegion, opts: WorldMapOptions): HTMLElement {
  const p = regionProgress(region, opts.ledger);
  const card = el('div', 'rl-world__card');
  card.dataset.regionCard = region.id;
  card.dataset.status = p.status;

  card.appendChild(el('div', 'rl-world__cardname', region.name));
  card.appendChild(el('div', 'rl-world__carddoctrine rl-info', `${region.faction} · ${region.doctrine}`));

  const progress =
    p.status === 'locked'
      ? (p.lockedBecause ?? 'locked')
      : p.total === 0
        ? 'no operations authored yet'
        : `${p.done} / ${p.total} missions`;
  card.appendChild(el('div', 'rl-world__cardprogress', progress));
  card.appendChild(el('span', 'rl-world__badge', p.status));
  return card;
}

/** Roster, campaign ROE, and -- when the rating is dragging -- the mission dragging it.
 *  #22 asks for the ledger to be visible and for a low rating to be explainable, and a
 *  bare number explains nothing. */
function ledgerLine(ledger: LedgerData): HTMLElement {
  const line = el('div', 'rl-world__ledger rl-info');
  const parts: string[] = [];

  const roster = ledger['roster.surviving_units'];
  if (Array.isArray(roster) && roster.length > 0) {
    const vets = roster.filter((r) => r.veterancy > 0).length;
    parts.push(`roster ${roster.length}${vets > 0 ? ` (${vets}★)` : ''}`);
  }

  // The mean lives in campaignRoe, not in the ledger: the sim stores per-mission bests and
  // does not divide. This is also the figure a locked region's "requires campaign ROE 45"
  // is asking you to raise, so the two read together.
  const roe = campaignRoe(ledger);
  if (roe !== null) {
    parts.push(`ROE ${roe.mean}`);
    if (roe.worst !== null) parts.push(`worst ${roe.worst[0]} (${roe.worst[1]})`);
  }

  line.textContent = parts.length > 0 ? parts.join(' · ') : 'campaign: fresh start';
  return line;
}
