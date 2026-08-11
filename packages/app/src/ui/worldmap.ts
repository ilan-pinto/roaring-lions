// The campaign world: the Sahar Basin, its three regions, and which of them are
// still asking for you. Replaces the flat mission list.
//
// A view over the ledger and nothing more. Region status is derived by @lions/data
// from campaign.completed_missions, so this file persists nothing and cannot disagree
// with what was played.
//
// The map SVG is *inlined* rather than loaded through <img> on purpose: its fills name
// palette tokens, and an <img>-loaded SVG cannot see the page's custom properties.

import type { LedgerData } from '@lions/sim';

import {
  campaignRoe,
  nextMissionOf,
  regionProgress,
  townProgress,
  type ParsedWorld,
  type WorldRegion,
} from '../campaign';

export interface WorldMapOptions {
  base: string;
  world: ParsedWorld;
  ledger: LedgerData;
  /** The campaign art's source, inlined by the caller. */
  svg: string;
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

export function worldMap(opts: WorldMapOptions): HTMLElement {
  const wrap = el('div', 'rl-world');

  // --- the map itself ------------------------------------------------------
  const board = el('div', 'rl-world__board');
  // Parsed as XML and adopted, rather than assigned to innerHTML. The asset is our own
  // build-time file, so this is not an injection fix -- it is that innerHTML on a string
  // that arrived over the network is indistinguishable, at a glance and to a scanner, from
  // the version of this line that would be a hole. DOMParser cannot execute script, so the
  // safe reading is the only reading.
  const parsed = new DOMParser().parseFromString(opts.svg, 'image/svg+xml');
  const svg = parsed.documentElement;
  const ok = svg.nodeName === 'svg' && parsed.querySelector('parsererror') === null;
  if (ok) {
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    board.appendChild(document.importNode(svg, true));
  } else if (opts.svg !== '') {
    // An empty string is the caller's documented "fetch failed"; anything else that fails
    // to parse is a corrupt asset and worth saying so.
    console.error('campaign map did not parse as SVG; drawing the cards without it');
  }

  for (const region of opts.world.regions) {
    const p = regionProgress(region, opts.ledger);
    const g = board.querySelector(`#region-${region.id}`);
    // A region with no shape in the art is caught by validate:data, so a miss here means
    // either the SVG was edited without running the gate or the fetch failed. Either way
    // the cards below still render, which is why this is a skip and not a throw.
    if (g) g.setAttribute('data-status', p.status);

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
