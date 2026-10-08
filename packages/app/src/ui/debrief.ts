// The after-action report (GH-417, H4 + H5, direction A "Field order", ruled
// 7 Oct 2026): the one screen after a mission. It replaces BOTH the small end
// panel and the debrief it led to (ruling L-7) -- the outcome moment
// (`outcome-moment.ts`) hands over straight to this.
//
// What it answers, top to bottom: the verdict and its reason; on a win, the
// star ladder; the closing word of whoever speaks for the mission; then three
// columns that always appear in the same order -- done well, cost you (what
// went wrong, on a defeat), what changed -- beside the ground with the
// battle's pins on it. One primary action.
//
// Every word comes from `after-action.ts` (pure, tested) or the catalogue;
// this file only draws. It sits on an opaque backdrop so the live HUD -- the
// radio panel, the feed, the dock -- cannot show through or collide with it
// (PA-21). Framing is `end-panel.ts`'s: centred, height-capped, the action row
// in a foot outside the scrolling body, focus on the primary action, a held
// Enter ignored (PR 434).

import type { Stars } from '@lions/sim';
import { t } from '../i18n/t';
import { objectiveGlyph } from './hud-model';
import { symbolLabel } from './symbol';
import { panel } from './panel';
import { mountEndPanel } from './end-panel';
import { tierName } from './grade-copy';
import { markSvg } from './mark';
import { unitIcon } from './portrait';
import { groundView } from './ground-view';
import type { AfterAction, AfterActionItem } from './after-action';
import type { GroundMark } from './ground-marks';
import type { PreviewMap, PreviewTones } from './map-preview';
import { markConfirm } from './confirm-cue';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';

/** The mission's own closing word (`mission.debrief.victory`/`.defeat`). */
export interface ReportSpeaker {
  plate: string;
  text: string;
  /** Already-resolved portrait URL; absent falls back to the hatch. */
  portrait?: string;
  /** The raw `say` speaker id: `net` paints the brigade mark, not a face. */
  speaker: string;
}

export interface DebriefOptions {
  result: 'victory' | 'defeat';
  stars: Stars;
  report: AfterAction;
  speaker?: ReportSpeaker;
  /** A victory's closing narration (`mission.aftermath`). */
  aftermath?: string;
  /** The brigade's word on the grade (`grade.tier.N.line`). */
  tierLine?: { plate: string; text: string };
  /** The commander's own promotion, when this win earned one. */
  promotion?: { rank: string; stars: number; line?: { plate: string; text: string } };
  /** The ground, for the battle's pins. Drawn when present. */
  ground?: { map: PreviewMap; tones: PreviewTones; marks: readonly GroundMark[]; photo?: ImageData | null };
  next?: { id: string; name: string; villainLine?: string };
  missionId: string;
  /** The rating prompt (GH-464), mounted in the foot above the nav. Built and
   *  disposed by the caller; this only places it. */
  prompt?: HTMLElement;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function clock(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function speakerFace(s: ReportSpeaker): HTMLElement {
  const face = el('div', 'rl-enddebrief__face');
  if (s.speaker === 'net') face.classList.add('rl-enddebrief__face--net');
  const img = el('img', 'rl-enddebrief__face-img');
  img.alt = '';
  img.hidden = true;
  img.addEventListener('error', () => {
    img.hidden = true;
    img.removeAttribute('src');
  });
  if (s.speaker !== 'net' && s.portrait !== undefined) {
    img.src = s.portrait;
    img.hidden = false;
  }
  const mark = el('div', 'rl-enddebrief__face-mark');
  mark.innerHTML = markSvg(86, 52);
  face.append(img, mark);
  return face;
}

function item(i: AfterActionItem): HTMLLIElement {
  const li = el('li', `rl-aar__item rl-aar__item--${i.tone}`);
  const mark = el('span', 'rl-aar__mark');
  if (i.person) {
    mark.classList.add('rl-aar__mark--person');
    if (i.person.lost) mark.classList.add('rl-aar__mark--lost');
    const icon = unitIcon(i.person.type, 'chip');
    if (icon) {
      const img = el('img', '');
      img.alt = '';
      img.src = icon.url;
      img.addEventListener('error', () => img.remove());
      mark.appendChild(img);
    }
  } else if (i.glyph) {
    mark.innerHTML = objectiveGlyph(i.glyph);
  } else {
    mark.textContent = i.mark;
  }
  const body = el('span', 'rl-aar__text', i.text);
  if (i.sub) body.appendChild(el('small', 'rl-aar__sub', i.sub));
  li.append(mark, body);
  return li;
}

function column(cls: string, title: string, items: readonly AfterActionItem[], extra?: HTMLElement[]): HTMLElement {
  const col = el('section', `rl-aar__col rl-aar__col--${cls}`);
  col.appendChild(el('h3', 'rl-aar__col-title', title));
  const ul = el('ul', 'rl-aar__items');
  for (const i of items) ul.appendChild(item(i));
  col.appendChild(ul);
  for (const e of extra ?? []) col.appendChild(e);
  return col;
}

export function showDebrief(host: HTMLElement, o: DebriefOptions): Disposer {
  const won = o.result === 'victory';
  const r = o.report;

  // Behind everything: the live HUD must not show through (PA-21).
  const backdrop = el('div', 'rl-aar-backdrop');
  host.appendChild(backdrop);

  const p = panel({
    // The document the player reads after either outcome: the briefing's
    // rank, always (VR-24). Defeat is told by the grade and the reason, never
    // by borrowing the transient alert band.
    rank: 'mission',
    title: t(won ? 'outcome.victory' : 'outcome.defeat'),
    tag: t('debrief.tag'),
    mark: true,
  });
  p.el.classList.add('rl-debrief', 'rl-aar', 'rl-enter');
  p.el.dataset.result = o.result;
  const b = p.body;

  // --- the verdict ---------------------------------------------------------
  const verdict = el('div', 'rl-aar__verdict');
  const grade = el('div', 'rl-aar__grade');
  if (won) {
    grade.appendChild(el('div', 'rl-debrief__tier rl-aar__tier', tierName(o.stars) || tierName(1)));
    const stars = el('div', 'rl-debrief__stars rl-aar__stars');
    // The countable mark (validate_ui_palette.mjs's Q5 exception): earned
    // stars lit, the rest dim, so the missing one is visible as missing.
    stars.appendChild(el('span', 'rl-aar__star-on', '★'.repeat(o.stars)));
    stars.appendChild(el('span', 'rl-aar__star-off', '★'.repeat(Math.max(0, 3 - o.stars))));
    grade.appendChild(stars);
  }
  verdict.appendChild(grade);
  if (r.reason.length > 0) {
    const why = el('ul', 'rl-aar__reason');
    for (const line of r.reason) why.appendChild(el('li', '', line));
    verdict.appendChild(why);
  }
  b.appendChild(verdict);

  // --- the ladder (a win) ---------------------------------------------------
  if (r.ladder.length > 0) {
    const ladder = el('ol', 'rl-aar__ladder');
    for (const rung of r.ladder) {
      const li = el('li', `rl-aar__rung rl-aar__rung--${rung.met ? 'met' : 'missed'}`);
      li.dataset.stars = String(rung.stars);
      li.append(el('span', 'rl-aar__rung-stars', '★'.repeat(rung.stars)), el('span', 'rl-aar__rung-text', rung.text));
      ladder.appendChild(li);
    }
    b.appendChild(ladder);
  }

  // --- the closing word -----------------------------------------------------
  if (o.speaker || o.aftermath) {
    const word = el('div', 'rl-aar__word');
    if (o.speaker) {
      word.appendChild(speakerFace(o.speaker));
      const q = el('blockquote', 'rl-aar__quote', t('menu.end.quote', { text: o.speaker.text }));
      q.appendChild(el('cite', 'rl-aar__cite', o.speaker.plate));
      word.appendChild(q);
    }
    if (o.aftermath) word.appendChild(el('p', 'rl-endaftermath rl-aar__aftermath', o.aftermath));
    b.appendChild(word);
  }

  // --- the ground and the three answers ------------------------------------
  const grid = el('div', 'rl-aar__grid');
  if (o.ground) {
    const g = groundView({ map: o.ground.map, tones: o.ground.tones, marks: o.ground.marks, pins: r.pins, caption: t('aar.ground') });
    if (o.ground.photo) g.setPhoto(o.ground.photo);
    g.el.classList.add('rl-aar__ground');
    grid.appendChild(g.el);
  }
  const wellExtra: HTMLElement[] = [];
  if (o.tierLine) {
    const q = el('blockquote', 'rl-debrief__line rl-aar__brigade', t('debrief.tierLine.quote', { text: o.tierLine.text }));
    q.appendChild(el('cite', 'rl-debrief__who', o.tierLine.plate));
    wellExtra.push(q);
  }
  const changedExtra: HTMLElement[] = [];
  if (o.promotion) {
    const pr = el('div', 'rl-debrief__promotion rl-aar__promotion', t('debrief.promotion.value', { rank: o.promotion.rank, stars: '★'.repeat(o.promotion.stars) }));
    if (o.promotion.line) {
      pr.appendChild(el('blockquote', 'rl-debrief__line', t('debrief.promotion.line', { text: o.promotion.line.text, plate: o.promotion.line.plate })));
    }
    changedExtra.push(pr);
  }
  if (won && o.next?.villainLine) changedExtra.push(el('div', 'rl-debrief__villain rl-aar__villain', o.next.villainLine));
  grid.append(
    column('well', t('aar.col.well'), r.well, wellExtra),
    column('poor', t(won ? 'aar.col.poor' : 'aar.col.poor.defeat'), r.poor),
    column('changed', t('aar.col.changed'), r.changed, changedExtra)
  );
  b.appendChild(grid);

  // --- one primary action ------------------------------------------------------
  const nav = el('div', 'rl-endnav rl-aar__nav');
  const link = (label: string, href: string, cls = 'rl-btn'): HTMLAnchorElement => {
    const a = el('a', cls);
    a.href = href;
    a.textContent = label;
    return a;
  };
  const replay = link(t('debrief.replay', { result: o.result }), routes.mission(o.missionId), 'rl-btn rl-aar__replay');
  const campaign = link(t('nav.campaignMap'), routes.campaign());
  const menu = link(t('nav.menu'), routes.menu());
  let primary: HTMLAnchorElement;
  if (won && o.next) {
    primary = el('a', 'rl-btn rl-debrief__next rl-aar__primary');
    primary.href = routes.mission(o.next.id);
    primary.innerHTML = symbolLabel('next', t('debrief.next', { name: o.next.name }), { after: true });
    nav.append(replay, campaign, menu, primary);
  } else if (won) {
    primary = campaign;
    primary.classList.add('rl-aar__primary');
    nav.append(replay, menu, primary);
  } else {
    primary = replay;
    primary.classList.add('rl-aar__primary');
    nav.append(campaign, menu, primary);
  }
  // The onward action is the report's primary: the confirm cue marks it, as
  // it marked the end screen's next-mission link.
  markConfirm(primary);
  mountEndPanel(host, p, nav, primary, o.prompt);
  return () => {
    p.el.remove();
    backdrop.remove();
  };
}
