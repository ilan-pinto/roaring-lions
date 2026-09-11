// The debrief: a full screen after a mission (storyline O7, spec §4.2). The end panel keeps
// its portrait and quote; this is the card that would not fit in 420px. Pure DOM, no sim.
import type { Stars } from '@lions/sim';
import { panel } from './panel';
import { TIER_NAMES } from './grade-copy';

export interface DebriefOptions {
  result: 'victory' | 'defeat';
  stars: Stars;
  tierLine?: { plate: string; text: string; portrait?: string };
  roe: number;
  roeFloor: number;
  deductions: { penalty: number; reason: string }[];
  ticks: number;
  targetMinutes?: number;
  lost: { type: string; count: number }[];
  secondaries: { text: string; complete: boolean; carries: boolean }[];
  marked: number;
  promoted: number;
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

export function showDebrief(host: HTMLElement, o: DebriefOptions): void {
  const won = o.result === 'victory';
  const p = panel({
    rank: 'mission',
    title: won ? TIER_NAMES[o.stars] || 'Entered in the log' : 'Withdraw and regroup',
    tag: won ? 'Debrief' : 'Defeat',
    mark: true,
    place: 'top:6%;left:50%;transform:translateX(-50%);width:min(720px,94vw);max-height:88vh;overflow:auto',
  });
  p.el.classList.add('rl-debrief', 'rl-enter');
  const b = p.body;

  const head = el('div', 'rl-debrief__head');
  head.appendChild(el('div', 'rl-debrief__tier', won ? TIER_NAMES[o.stars] : 'Withdraw and regroup'));
  if (won && o.stars > 0) head.appendChild(el('div', 'rl-debrief__stars', '★'.repeat(o.stars)));
  b.appendChild(head);

  if (o.tierLine) {
    const q = el('blockquote', 'rl-debrief__line', `“${o.tierLine.text}”`);
    q.appendChild(el('cite', 'rl-debrief__who', o.tierLine.plate));
    b.appendChild(q);
  }

  const grid = el('dl', 'rl-debrief__grid');
  const row = (k: string, v: string, cls: string): void => {
    grid.appendChild(el('dt', '', k));
    grid.appendChild(el('dd', cls, v));
  };
  row('Conduct', `Conduct ${o.roe} · orders floor ${o.roeFloor}`, 'rl-debrief__conduct');
  row('Time', o.targetMinutes !== undefined ? `${clock(o.ticks)} of ${o.targetMinutes}:00` : clock(o.ticks), 'rl-debrief__time');
  row('Lost', o.lost.length === 0 ? 'nobody' : o.lost.map((l) => `${l.type} ×${l.count}`).join(', '), 'rl-debrief__lost');
  row('Marked', String(o.marked), 'rl-debrief__marked');
  row('Promoted', String(o.promoted), 'rl-debrief__promoted');
  b.appendChild(grid);

  if (o.taken) b.appendChild(el('div', 'rl-debrief__taken', o.taken));

  if (o.deductions.length > 0) {
    const ul = el('ul', 'rl-debrief__deductions');
    for (const d of o.deductions) ul.appendChild(el('li', '', `−${d.penalty} ${d.reason}`));
    b.appendChild(ul);
  }

  if (o.secondaries.length > 0) {
    const ul = el('ul', 'rl-debrief__secondaries');
    for (const s of o.secondaries) {
      const li = el('li', 'rl-debrief__secondary', `${s.complete ? '☑' : '☐'} ${s.text}${s.carries ? ' · carries' : ''}`);
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
    const pr = el('div', 'rl-debrief__promotion', `Promoted: ${o.promotion.rank} · ${'★'.repeat(o.promotion.stars)}`);
    if (o.promotion.line) pr.appendChild(el('blockquote', 'rl-debrief__line', `“${o.promotion.line.text}” — ${o.promotion.line.plate}`));
    b.appendChild(pr);
  }

  const nav = el('div', 'rl-endnav');
  if (won && o.next) {
    const a = document.createElement('a');
    a.className = 'rl-btn rl-debrief__next';
    a.href = `?mission=${o.next.id}`;
    a.textContent = `next: ${o.next.name} →`;
    nav.appendChild(a);
    if (o.next.villainLine) b.appendChild(el('div', 'rl-debrief__villain', o.next.villainLine));
  }
  const back = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.className = 'rl-btn';
    a.href = href;
    a.textContent = label;
    nav.appendChild(a);
  };
  back(won ? 'replay' : 'try again', `?mission=${o.missionId}`);
  back('campaign map', '?campaign');
  b.appendChild(nav);

  host.appendChild(p.el);
}
