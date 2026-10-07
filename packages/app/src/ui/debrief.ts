// The debrief: a full screen after a mission (storyline O7, spec §4.2). The end panel keeps
// its portrait and quote; this is the card that would not fit in 26.25rem. Pure DOM, no sim.
import type { Stars } from '@lions/sim';
import { t } from '../i18n/t';
import { escapeHtml } from './escape-html';
import { objectiveGlyph } from './hud-model';
import { symbolLabel } from './symbol';
import { panel } from './panel';
import { mountEndPanel } from './end-panel';
import { tierName } from './grade-copy';
import { withdrewLine } from './withdrew';
import { invoiceClock, type InvoiceLine } from './conduct-invoice';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';

export interface DebriefOptions {
  result: 'victory' | 'defeat';
  stars: Stars;
  tierLine?: { plate: string; text: string; portrait?: string };
  roe: number;
  roeFloor: number;
  /** GH-345: the Conduct invoice -- every deduction grouped by cause and
   *  place, already worded (`conduct-invoice.ts`'s `invoiceLines`). Drawn as
   *  a cause / when / cost table where the sim's raw reason lines used to be. */
  invoice: InvoiceLine[];
  ticks: number;
  targetMinutes?: number;
  lost: { type: string; count: number }[];
  /** Who was lost, by name (WP-G-E4). A SUBSET of `lost`'s count -- a fresh
   *  remnant spawned and killed inside one mission never reached the roster
   *  and has no service record to print (R-11), so `lost` stays the total
   *  and this is the names it can name. Defaults to empty when absent, so
   *  every existing call site and every existing spec still compiles. */
  lostNamed?: { name?: string; type: string }[];
  /** Who took a vacant place this mission (WP-G-E4) -- a slotless body
   *  `fillVacancies` handed a slot a death just vacated. Defaults to empty. */
  replacements?: { name: string; predecessor: string }[];
  secondaries: { text: string; complete: boolean; carries: boolean }[];
  marked: number;
  promoted: number;
  /** What this run paid into the brigade account (spec 2026-09-15 §4.2). Absent on a
   *  defeat, which pays nothing and shows nothing. */
  credits?: { paid: number; balance: number };
  /** The account of the taken (spec §4.4), already built by `hostagesLine` --
   *  "Fifteen still out. Four came back at the shaft head." The second sentence
   *  only exists here: the campaign board prints the standing total but does not
   *  know which mission was just played, and this screen does. Absent on a world
   *  that declares no `taken` at all. */
  taken?: string;
  unlocked: string[];
  promotion?: { rank: string; stars: number; line?: { plate: string; text: string } };
  next?: { id: string; name: string; villainLine?: string };
  missionId: string;
  /** Hostile units still alive at the end (victory only; see `withdrewLine`). */
  withdrew?: number;
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function clock(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function showDebrief(host: HTMLElement, o: DebriefOptions): Disposer {
  const won = o.result === 'victory';
  // PA-07: ONE name per outcome, the same one the outcome moment, the feed,
  // the HUD banner and the end panel use (`outcome.*`). The grade a victory
  // earned ("Named in brigade orders") is a grade, not the outcome's name,
  // so it sits under the title with the stars rather than replacing it; a
  // defeat earns no grade and shows none.
  const p = panel({
    rank: 'mission',
    title: t(won ? 'outcome.victory' : 'outcome.defeat'),
    tag: t('debrief.tag'),
    mark: true,
    // Width only: `.rl-endpanel` (`mountEndPanel`, below) centres it, caps its
    // height and scrolls the body, with the actions in a foot outside it.
    place: 'width:min(45rem,94vw)',
  });
  p.el.classList.add('rl-debrief', 'rl-enter');
  const b = p.body;

  if (won) {
    const head = el('div', 'rl-debrief__head');
    head.appendChild(el('div', 'rl-debrief__tier', tierName(o.stars) || tierName(1)));
    if (o.stars > 0) head.appendChild(el('div', 'rl-debrief__stars', '★'.repeat(o.stars)));
    b.appendChild(head);
  }

  // GH-234: the reward, promoted out of the row grid below and placed as the
  // most visible figure after the result title -- the same wording and the
  // same `{ paid, balance }` the outcome moment already showed (`main.ts`
  // computes it once, before either screen opens). Absent on a defeat, same
  // as before.
  if (o.credits) {
    const reward = el('div', 'rl-debrief__reward');
    reward.dataset.paid = o.credits.paid > 0 ? '1' : '0';
    reward.appendChild(
      el(
        'p',
        o.credits.paid > 0 ? 'rl-debrief__reward-figure' : 'rl-debrief__reward-none',
        o.credits.paid > 0 ? t('debrief.credits.paid', { n: o.credits.paid }) : t('debrief.credits.none')
      )
    );
    reward.appendChild(el('p', 'rl-debrief__reward-total', t('debrief.credits.total', { n: o.credits.balance })));
    b.appendChild(reward);
  }

  if (o.tierLine) {
    const q = el('blockquote', 'rl-debrief__line', t('debrief.tierLine.quote', { text: o.tierLine.text }));
    q.appendChild(el('cite', 'rl-debrief__who', o.tierLine.plate));
    b.appendChild(q);
  }

  const grid = el('dl', 'rl-debrief__grid');
  const row = (k: string, v: string, cls: string): void => {
    grid.appendChild(el('dt', '', k));
    grid.appendChild(el('dd', cls, v));
  };
  row(t('debrief.row.conduct.label'), t('debrief.row.conduct.value', { roe: o.roe, floor: o.roeFloor }), 'rl-debrief__conduct');
  row(
    t('debrief.row.time.label'),
    o.targetMinutes !== undefined
      ? t('debrief.row.time.value', { clock: clock(o.ticks), target: o.targetMinutes })
      : clock(o.ticks),
    'rl-debrief__time'
  );
  row(
    t('debrief.row.lost.label'),
    o.lost.length === 0 ? t('debrief.row.lost.none') : o.lost.map((l) => `${l.type} ×${l.count}`).join(', '),
    'rl-debrief__lost'
  );
  // R-11: the row above is the total and never changes. These two are the
  // named half beside it -- who, by name, and who took the vacant place --
  // and both are omitted entirely rather than printed empty (a nothing-to-
  // report row is noise on the screen a player sees most often).
  const lostNamed = o.lostNamed ?? [];
  if (lostNamed.length > 0) {
    row(
      t('debrief.row.lostNamed.label'),
      // A record with no callsign (a save written before names shipped)
      // falls back to its type, never to "undefined".
      lostNamed.map((l) => l.name ?? l.type).join(', '),
      'rl-debrief__lostNamed'
    );
  }
  const replacements = o.replacements ?? [];
  if (replacements.length > 0) {
    row(
      t('debrief.row.replaced.label'),
      replacements.map((r) => t('debrief.row.replaced.value', { name: r.name, predecessor: r.predecessor })).join(', '),
      'rl-debrief__replaced'
    );
  }
  row(t('debrief.row.marked.label'), String(o.marked), 'rl-debrief__marked');
  row(t('debrief.row.promoted.label'), String(o.promoted), 'rl-debrief__promoted');
  b.appendChild(grid);

  const withdrew = withdrewLine(o.result, o.withdrew);
  if (withdrew !== null) b.appendChild(el('div', 'rl-debrief__withdrew rl-dim', withdrew));

  if (o.taken) b.appendChild(el('div', 'rl-debrief__taken', o.taken));

  if (o.invoice.length > 0) {
    // GH-345: cause / when / cost. Each cell through `textContent`: a label
    // carries a place name, which is data.
    const table = el('table', 'rl-debrief__deductions');
    const head = el('tr', '');
    for (const k of ['conduct.invoice.cause', 'conduct.invoice.when', 'conduct.invoice.cost']) {
      head.appendChild(el('th', '', t(k)));
    }
    table.appendChild(head);
    for (const line of o.invoice) {
      const tr = el('tr', '');
      tr.appendChild(el('td', '', line.count > 1 ? `${line.label} ×${line.count}` : line.label));
      tr.appendChild(el('td', 'rl-debrief__when', line.ticks.map(invoiceClock).join(', ')));
      tr.appendChild(el('td', 'rl-debrief__cost', `−${line.total}`));
      table.appendChild(tr);
    }
    b.appendChild(table);
  }

  if (o.secondaries.length > 0) {
    const ul = el('ul', 'rl-debrief__secondaries');
    for (const s of o.secondaries) {
      // `s.text` is a param, never touched by the catalogue -- it is the mission's own
      // objective text, data flowing through unchanged, same as `o.taken`/`o.unlocked` above.
      const label = s.carries ? t('debrief.secondary.carries', { text: s.text }) : s.text;
      const li = el('li', 'rl-debrief__secondary');
      li.innerHTML = `${objectiveGlyph(s.complete ? 'complete' : 'active')} ${escapeHtml(label)}`;
      li.dataset.carries = s.carries ? '1' : '0';
      li.dataset.complete = s.complete ? '1' : '0';
      ul.appendChild(li);
    }
    b.appendChild(ul);
  }

  // One line per unlock, not a comma-joined run: each string carries its own
  // reason ("Campaign Conduct 58 → 62: Namer IFV available", spec §4.5), and two
  // of those in one sentence is unreadable.
  if (o.unlocked.length > 0) {
    const ul = el('ul', 'rl-debrief__unlocked');
    for (const u of o.unlocked) ul.appendChild(el('li', '', u));
    b.appendChild(ul);
  }

  if (o.promotion) {
    const pr = el(
      'div',
      'rl-debrief__promotion',
      t('debrief.promotion.value', { rank: o.promotion.rank, stars: '★'.repeat(o.promotion.stars) })
    );
    if (o.promotion.line) {
      pr.appendChild(
        el('blockquote', 'rl-debrief__line', t('debrief.promotion.line', { text: o.promotion.line.text, plate: o.promotion.line.plate }))
      );
    }
    b.appendChild(pr);
  }

  const nav = el('div', 'rl-endnav');
  let next: HTMLElement | null = null;
  if (won && o.next) {
    const a = document.createElement('a');
    a.className = 'rl-btn rl-debrief__next';
    a.href = routes.mission(o.next.id);
    a.innerHTML = symbolLabel('next', t('debrief.next', { name: o.next.name }), { after: true });
    nav.appendChild(a);
    next = a;
    if (o.next.villainLine) b.appendChild(el('div', 'rl-debrief__villain', o.next.villainLine));
  }
  const back = (label: string, href: string): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.className = 'rl-btn';
    a.href = href;
    a.textContent = label;
    nav.appendChild(a);
    return a;
  };
  const replay = back(t('debrief.replay', { result: o.result }), routes.mission(o.missionId));
  const campaign = back(t('nav.campaignMap'), routes.campaign());
  back(t('nav.menu'), routes.menu());

  // The same focus rule as the end screen it replaces.
  mountEndPanel(host, p, nav, next ?? (won ? campaign : replay));
  return () => p.el.remove();
}
