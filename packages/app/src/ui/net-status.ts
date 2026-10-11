/**
 * The room's one HUD line (N0 task 11): waiting for the other seat, a stall
 * and who it is waiting on, or a desync. Hidden in single-player and while the
 * match runs live, so a healthy room shows nothing. Mounted on
 * `document.body`, so the battlefield that makes it removes it (`dispose`, in
 * its own `onDispose` -- the disposer contract).
 */
import type { Seat, TransportStatus } from '@lions/net';
import { TICKS_PER_SECOND } from '@lions/sim';
import { t } from '../i18n/t';

/** The line for a status, or null when there is nothing to say. `nameOf(null)`
 *  is this machine's own seat: a `connecting` stall is our socket, not theirs. */
export function netStatusText(s: TransportStatus, nameOf: (seat: Seat | null) => string): string | null {
  switch (s.kind) {
    case 'local':
    case 'live':
    case 'closed':
      return null;
    case 'waiting':
      return t('net.waiting');
    case 'stalled':
      return s.reason === 'behind'
        ? t('net.stall.behind', { seat: nameOf(s.seat) })
        : t('net.stall.gone', { seat: nameOf(s.reason === 'connecting' ? null : s.seat) });
    case 'desync':
      return t('net.desync', { time: matchClock(s.tick) });
  }
}

/** The match time a desync was found at, as m:ss. A hash closes a window of
 *  20 ticks -- one second -- so the end of the window the bad hash covered is
 *  a whole second and the clock loses nothing the tick number carried; and a
 *  player reads a time where "tick" is developer language (PA-01). */
export function matchClock(tick: number): string {
  const s = Math.floor((tick + 1) / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class NetStatusLine {
  private readonly el: HTMLDivElement;
  private shown: string | null = null;

  constructor(parent: HTMLElement, private readonly nameOf: (seat: Seat | null) => string) {
    this.el = document.createElement('div');
    this.el.className = 'rl-net-status';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  /** Called every frame; touches the DOM only when the line changes. */
  paint(status: TransportStatus): void {
    const text = netStatusText(status, this.nameOf);
    if (text === this.shown) return;
    this.shown = text;
    this.el.dataset.net = status.kind;
    this.el.textContent = text ?? '';
    this.el.hidden = text === null;
  }

  dispose(): void {
    this.el.remove();
  }
}
