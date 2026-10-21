// packages/app/src/ui/advisor.ts
/**
 * The advisor panel and the proposal strip (N4a task 10, spec §11b): in a
 * versus room where an advisor sits beside this seat, a small feed of what the
 * advisor said, a box to answer it, and -- for an `assist` advisor -- the
 * strip that shows one proposed order at a time.
 *
 * THE PROPOSAL IS NOT AN ORDER UNTIL THE HUMAN LETS IT BE. It shows for
 * `PROPOSAL_MS` with its note and a plain-words description of the order;
 * X vetoes it, the Accept button takes it at once (Enter does not: it opens
 * the chat, and a player reaching for chat would accept by accident), and at
 * the deadline it is taken. Taking it means running `validate` (the same
 * ownership check both machines run, on the LIVE sim: the ids may have died
 * or the order may have gone stale while the human read it) and then queuing
 * the command through the battlefield's own transport as THIS seat's `cmd`,
 * so it is ordered, validated, framed and hashed exactly like a click. The
 * panel never touches the sim and sends the room only `accept` / `veto`,
 * which are bookkeeping for the advisor.
 *
 * There are no real timers here: `frame()` runs from the battlefield's frame
 * loop. The two seconds are the sum of the frames that RAN, each counted at
 * most `FRAME_CLAMP_MS` (as the renderer's own `frameDtMs` does), not the wall
 * clock since the proposal came up: a room pause (the loop skips `frame()`)
 * or a hidden tab (rAF stops) leaves the countdown where it was, and the first
 * frame back adds one clamped slice, so an order never fires the instant the
 * player returns with no chance to veto it. A test drives time by hand, and
 * `dispose` has nothing to forget to cancel except its own state.
 *
 * Everything the advisor writes is untrusted text and reaches the DOM through
 * `textContent` only.
 */
import { ONE, type Command } from '@lions/sim';
import type { AdvisorMsg, AdvisorScope } from '@lions/net';
import { t } from '../i18n/t';

/** How long a proposal shows before it is taken, unless vetoed (D11). */
export const PROPOSAL_MS = 2000;
/** Proposals held at once, the showing one included; a 4th vetoes the oldest WAITING. */
export const PROPOSAL_QUEUE = 3;
/** The most one frame may add to the countdown (the renderer's `frameDtMs` clamp). */
export const FRAME_CLAMP_MS = 100;
/** Lines the feed keeps. */
export const ADVISOR_FEED_LINES = 30;
/** The box's cap: the room's own chat cap, which `cleanChat` applies to advisor text too. */
const TEXT_MAX_CHARS = 280;

export interface AdvisorPanelDeps {
  /** `WsTransport.advisor`. */
  send(a: AdvisorMsg): void;
  /** The battlefield's transport: the order goes out as THIS seat's `cmd`. */
  queueCommand(cmd: Command): void;
  /** `validateCommand(cmd, mySeat, seatWorld)` on the live sim. */
  validate(cmd: Command): boolean;
  now(): number;
  /** "Move 3 units to (24, 31)", via `t()`. */
  describe(cmd: Command): string;
  /** The field ping (minimap flash and ground marker); the feed line is the panel's own. */
  ping?(x: number, y: number): void;
}

export interface AdvisorPanel {
  onAdvisor(from: 'human' | 'advisor', a: AdvisorMsg): void;
  onPresence(scope: AdvisorScope | null): void;
  /** Called from the frame loop: runs the 2 s deadline. */
  frame(): void;
  /** The X key. False when nothing shows, so the key goes on to whatever else it does. */
  veto(): boolean;
  /** The Accept button. False when nothing shows. Not bound to Enter. */
  accept(): boolean;
  /** Whether a proposal is on screen right now. */
  readonly showing: boolean;
  dispose(): void;
}

interface Pending { id: number; cmd: Command; note: string }

const tile = (v: number): number => Math.floor(v / ONE);

/** One order in plain words, for the strip. Every word is a catalogue line. */
export function describeCommand(cmd: Command): string {
  const n = 'ids' in cmd ? cmd.ids.length : 0;
  switch (cmd.kind) {
    case 'move': return t('net.advisor.cmd.move', { n, x: tile(cmd.x), y: tile(cmd.y) });
    case 'attackMove': return t('net.advisor.cmd.attackMove', { n, x: tile(cmd.x), y: tile(cmd.y) });
    case 'smoke': return t('net.advisor.cmd.smoke', { n, x: tile(cmd.x), y: tile(cmd.y) });
    case 'halt': return t('net.advisor.cmd.halt', { n });
    case 'setStance': return t(cmd.stance === 'hold' ? 'net.advisor.cmd.setStance.hold' : 'net.advisor.cmd.setStance.ambush', { n });
    case 'unload': return t('net.advisor.cmd.unload', { n });
    case 'garrison': return t('net.advisor.cmd.garrison', { n });
    case 'load': return t('net.advisor.cmd.load', { n });
    case 'demolish': return t('net.advisor.cmd.demolish', { n });
    case 'chargeTunnel': return t('net.advisor.cmd.chargeTunnel', { n });
    case 'attack': return t('net.advisor.cmd.attack', { n });
    case 'reveal': return t('net.advisor.cmd.reveal', { x: tile(cmd.x), y: tile(cmd.y) });
    case 'callStrike': return t('net.advisor.cmd.callStrike', { x: tile(cmd.x), y: tile(cmd.y) });
    case 'build': return t('net.advisor.cmd.build', { unit: cmd.unit });
    case 'cancelBuild':
      return cmd.index < 0
        ? t('net.advisor.cmd.cancelCurrent', { line: cmd.line })
        : t('net.advisor.cmd.cancelBuild', { line: cmd.line, index: cmd.index });
    case 'setRally': return t('net.advisor.cmd.setRally', { line: cmd.line, x: tile(cmd.x), y: tile(cmd.y) });
    case 'clearRally': return t('net.advisor.cmd.clearRally', { line: cmd.line });
    case 'support': return t('net.advisor.cmd.support', { support: cmd.support, x: tile(cmd.x), y: tile(cmd.y) });
  }
}

export function mountAdvisorPanel(host: HTMLElement, deps: AdvisorPanelDeps): AdvisorPanel {
  const root = document.createElement('section');
  root.className = 'rl-advisor';
  root.hidden = true;
  root.setAttribute('aria-label', t('net.advisor.panel.title'));
  const feed = document.createElement('ol');
  feed.className = 'rl-advisor__feed';
  feed.setAttribute('role', 'log');
  feed.setAttribute('aria-live', 'polite');
  const strip = document.createElement('div');
  strip.className = 'rl-advisor__strip';
  strip.hidden = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rl-advisor__input';
  input.maxLength = TEXT_MAX_CHARS;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = t('net.advisor.placeholder');
  input.setAttribute('aria-label', t('net.advisor.placeholder'));
  root.append(feed, strip, input);
  host.appendChild(root);

  let scope: AdvisorScope | null = null;
  let disposed = false;
  /** The showing proposal first, then those waiting, oldest first. */
  let queue: Pending[] = [];
  /** How much of the showing proposal's PROPOSAL_MS the running frames have used. */
  let elapsed = 0;
  /** `now()` at the last frame (or when the proposal came up) - the baseline for the next slice. */
  let lastAt = 0;

  // The strip's parts, rebuilt each time a proposal comes up.
  let noteEl: HTMLElement | null = null;
  let countEl: HTMLElement | null = null;

  const line = (text: string): void => {
    const li = document.createElement('li');
    li.className = 'rl-advisor__line';
    li.textContent = text;
    feed.appendChild(li);
    while (feed.childElementCount > ADVISOR_FEED_LINES) feed.firstElementChild?.remove();
    feed.scrollTop = feed.scrollHeight;
  };

  const paintCount = (): void => {
    if (countEl === null) return;
    const left = Math.max(0, PROPOSAL_MS - elapsed);
    countEl.textContent = t('net.advisor.countdown', { s: (left / 1000).toFixed(1) });
  };

  const paintStrip = (): void => {
    strip.replaceChildren();
    noteEl = null;
    countEl = null;
    const cur = queue[0];
    strip.hidden = cur === undefined;
    if (cur === undefined) return;
    noteEl = document.createElement('p');
    noteEl.className = 'rl-advisor__note';
    noteEl.textContent = cur.note;
    noteEl.hidden = cur.note === '';
    const what = document.createElement('p');
    what.className = 'rl-advisor__what';
    what.textContent = deps.describe(cur.cmd);
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'rl-advisor__accept';
    accept.textContent = t('net.advisor.accept');
    accept.addEventListener('click', () => { api.accept(); });
    const veto = document.createElement('button');
    veto.type = 'button';
    veto.className = 'rl-advisor__veto';
    veto.textContent = t('net.advisor.veto');
    veto.addEventListener('click', () => { api.veto(); });
    const hint = document.createElement('span');
    hint.className = 'rl-advisor__hint';
    hint.textContent = t('net.advisor.vetoHint');
    countEl = document.createElement('span');
    countEl.className = 'rl-advisor__count';
    const row = document.createElement('div');
    row.className = 'rl-advisor__row';
    row.append(accept, veto, hint, countEl);
    strip.append(noteEl, what, row);
    paintCount();
  };

  /** A proposal comes up: its two seconds start from nothing. */
  const restart = (): void => { elapsed = 0; lastAt = deps.now(); };

  /** The showing proposal is done; the next one starts its own clock. */
  const advance = (): void => {
    queue.shift();
    restart();
    paintStrip();
  };

  const take = (): void => {
    const cur = queue[0];
    if (cur === undefined) return;
    if (deps.validate(cur.cmd)) {
      deps.queueCommand(cur.cmd);
      deps.send({ kind: 'accept', id: cur.id });
    } else {
      deps.send({ kind: 'veto', id: cur.id });
      line(t('net.advisor.stale'));
    }
    advance();
  };

  const api: AdvisorPanel = {
    get showing() { return queue.length > 0; },
    onPresence(next) {
      if (disposed) return;
      scope = next;
      root.hidden = next === null;
      // An advisor that is gone has nobody to tell: its proposals just stop.
      if (next !== 'assist' && queue.length > 0) { queue = []; paintStrip(); }
    },
    onAdvisor(_from, a) {
      if (disposed) return;
      switch (a.kind) {
        case 'text':
          line(t(_from === 'human' ? 'net.advisor.feed.you' : 'net.advisor.feed.advisor', { text: a.text }));
          return;
        case 'ping':
          // The existing field ping (minimap flash and ground marker), and a line that names the tile.
          deps.ping?.(a.x, a.y);
          line(t('net.advisor.feed.ping', { x: a.x, y: a.y }));
          return;
        case 'proposal': {
          // Only an `assist` advisor proposes; the room already filters, and this is the second line.
          if (scope !== 'assist') return;
          queue.push({ id: a.id, cmd: a.cmd, note: a.note });
          if (queue.length === 1) { restart(); paintStrip(); }
          else if (queue.length > PROPOSAL_QUEUE) {
            // The oldest WAITING one goes, never the one the human is reading.
            const [dropped] = queue.splice(1, 1);
            deps.send({ kind: 'veto', id: dropped.id });
          }
          return;
        }
        case 'accept':
        case 'veto':
          return;
      }
    },
    frame() {
      if (disposed || queue.length === 0) return;
      const at = deps.now();
      elapsed += Math.min(Math.max(at - lastAt, 0), FRAME_CLAMP_MS);
      lastAt = at;
      if (elapsed >= PROPOSAL_MS) take();
      else paintCount();
    },
    veto() {
      if (disposed) return false;
      const cur = queue[0];
      if (cur === undefined) return false;
      deps.send({ kind: 'veto', id: cur.id });
      advance();
      return true;
    },
    accept() {
      if (disposed || queue.length === 0) return false;
      take();
      return true;
    },
    dispose() {
      disposed = true;
      queue = [];
      input.removeEventListener('keydown', onKey);
      root.remove();
    },
  };

  const onKey = (ev: KeyboardEvent): void => {
    // The game's keys must not fire while a line is typed here.
    ev.stopPropagation();
    if (ev.isComposing) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const text = input.value.trim();
      if (text === '') return;
      deps.send({ kind: 'text', text });
      line(t('net.advisor.feed.you', { text }));
      input.value = '';
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      // X types an x here, so the box has its own way to refuse: Escape vetoes
      // a showing proposal, and is the old Escape (clear and leave) otherwise.
      if (api.veto()) return;
      input.value = '';
      input.blur();
    }
  };
  input.addEventListener('keydown', onKey);
  return api;
}
