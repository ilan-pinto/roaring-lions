// packages/app/src/ui/versus.ts
/**
 * Play with a friend (N1b task 6): `/versus`, where a player picks a callsign
 * and either hosts a room on a map or joins one by its code, and
 * `/versus/:code`, the room's lobby -- the code shown large, a link to copy,
 * the two seats, the map, Ready, and Leave.
 *
 * One socket from the host's click to the battlefield. `/versus` opens the
 * room (`deps.open`, which is `openRoom` in `net/connect.ts`: created or
 * joined, socket open, nothing said but `hello`) and parks it in
 * `pendingLobby` under its code before navigating; the lobby takes it from
 * there, once. At the room's `start` the lobby hands the transport to the
 * battlefield (`net/handoff.ts`) and replaces itself with the match's URL.
 * A direct link to a lobby (the guest's whole path) finds nothing parked, so
 * it asks for a callsign and joins first.
 *
 * Who owns the socket, which is the disposer contract here: `/versus` owns a
 * room that opens after it was left (closed, never navigated to); the lobby
 * owns it until the start (its disposer says `bye`, which ends the room for
 * both seats); after the start the battlefield does (nothing in the disposer).
 *
 * Callsigns and the code are typed by players. They reach the DOM through
 * `textContent` only, never through markup.
 */
import { maps } from '@lions/data';
import type { Seat, SeatState, WsTransport } from '@lions/net';
import { t } from '../i18n/t';
import { RoomRefused, type OpenedRoom, type RoomRequest } from '../net/connect';
import { handOver } from '../net/handoff';
import { isTextEntry } from '../shell/escape-back';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';
import { confirmDialog, isDialogOpen, type ConfirmHandle } from './confirm';
import { markConfirm } from './confirm-cue';
import { footBack, screenFoot } from './foot';
import { stagger } from './motion';
import { panel } from './panel';
import { symbolLabel } from './symbol';

/** The Worker's room-code alphabet (`packages/worker/src/match/code.ts`, no
 *  0/O/1/I). The app cannot import the Worker, so this is a copy, and
 *  `versus.test.ts` pins it against that file's text. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** The room's own cap (`room-fields.ts`'s `MAX_CALLSIGN_CHARS`). */
export const CALLSIGN_MAX = 24;
/** The map a host is offered first, when it ships. */
const DEFAULT_MAP = 'tel_marum';
/** The two seats, in the order their cards are drawn. */
const SEAT_ORDER: readonly Seat[] = [0, 1];

/** What a typed room code becomes: upper case, the alphabet only, six at most. */
export function filterCode(raw: string): string {
  return [...raw.toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).join('').slice(0, CODE_LENGTH);
}

/** The maps a room can be hosted on (R-B9): the free-play picker's, by their
 *  own names, without the tile studies or the tutorial ground. */
export function versusMaps(catalogue: Record<string, { name: string }> = maps): { id: string; label: string }[] {
  return Object.keys(catalogue)
    .filter((id) => !id.startsWith('tile_') && id !== 'tutorial_ground')
    .map((id) => ({ id, label: catalogue[id].name }));
}

export interface VersusDeps {
  /** Creates or joins; resolves to the code, the seat, an OPEN, not-yet-started
   *  transport and the room's first lobby (`openRoom`). Rejects with a
   *  `RoomRefused` naming why. `signal` aborts when the screen is left. */
  open(req: RoomRequest, signal?: AbortSignal): Promise<OpenedRoom>;
  maps: readonly { id: string; label: string }[];
  /** The callsign last typed (`lions.versus.callsign`). */
  callsign: { get(): string; set(v: string): void };
  navigate(href: string, opts?: { replace?: boolean }): void;
  /** Puts `text` on the clipboard; false when the browser refuses. */
  copy(text: string): Promise<boolean>;
  /** The absolute URL of `routes.versusRoom(code)`. */
  linkFor(code: string): string;
}

/** A room between `/versus` and the start. */
interface Room {
  readonly code: string;
  readonly seat: Seat;
  readonly transport: WsTransport;
  seats: SeatState[];
  map: string;
  /** `closed`: this tab left (and said `bye`). `ended`: the room ended under it. */
  phase: 'lobby' | 'started' | 'ended' | 'closed';
  /** An i18n key for a refusal the room sent after the lobby opened. */
  error: string | null;
  /** The mounted lobby's repaint, or null while none is mounted. */
  repaint: (() => void) | null;
}

/** Opened on `/versus`, waiting for its lobby to mount: the lobby takes it once. */
const pendingLobby = new Map<string, Room>();

const ERROR_KEY: Record<RoomRefused['reason'], string> = {
  not_found: 'versus.error.notFound',
  full: 'versus.error.full',
  build: 'versus.error.build',
  failed: 'versus.error.failed',
};
const errorLine = (err: unknown): string => t(err instanceof RoomRefused ? ERROR_KEY[err.reason] : 'versus.error.failed');

/** Takes an opened room into the screens: its hooks from here are the lobby's. */
function adopt(o: OpenedRoom, deps: VersusDeps): Room {
  const room: Room = {
    code: o.code, seat: o.seat, transport: o.transport,
    seats: o.lobby.seats, map: o.lobby.map,
    phase: 'lobby', error: null, repaint: null,
  };
  o.transport.setHooks({
    onLobby: (seats, _you, map) => {
      room.seats = seats;
      room.map = map;
      room.repaint?.();
    },
    onStart: (config) => {
      if (room.phase !== 'lobby') return;
      room.phase = 'started';
      // The battlefield's `connectMatch` takes this for the URL's code: no
      // second socket, and the room's `start` is not missed.
      handOver(room.code, { transport: room.transport, seat: room.seat, config });
      deps.navigate(`${routes.sandbox(config.map)}?net=${room.code}`, { replace: true });
    },
    onEnded: () => {
      if (room.phase !== 'lobby') return;
      room.phase = 'ended';
      room.repaint?.();
    },
    onError: (code) => {
      if (code !== 'build_mismatch') return;
      room.error = 'versus.error.build';
      room.repaint?.();
    },
    // The lobby's chat line arrives with N1b task 9.
    onChat: () => {},
  });
  return room;
}

function heading(body: HTMLElement, text: string): void {
  const h = document.createElement('h3');
  h.className = 'rl-versus__section';
  h.textContent = text;
  body.appendChild(h);
}

function messageLine(className: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  p.setAttribute('role', 'status');
  p.setAttribute('aria-live', 'polite');
  return p;
}

function button(label: string, className: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `rl-btn ${className}`;
  b.textContent = label;
  return b;
}

/** The callsign field: prefilled, capped at the room's 24, saved on change. */
function callsignField(deps: VersusDeps): { el: HTMLElement; input: HTMLInputElement } {
  const el = document.createElement('label');
  el.className = 'rl-versus__field';
  const name = document.createElement('span');
  name.className = 'rl-versus__label';
  name.textContent = t('versus.callsign');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rl-versus__callsign';
  input.maxLength = CALLSIGN_MAX;
  input.setAttribute('autocomplete', 'nickname');
  input.spellcheck = false;
  input.value = deps.callsign.get().slice(0, CALLSIGN_MAX);
  input.addEventListener('change', () => deps.callsign.set(input.value.trim().slice(0, CALLSIGN_MAX)));
  el.append(name, input);
  return { el, input };
}

function frame(title: string): { wrap: HTMLElement; body: HTMLElement; footStart: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu rl-menu--versus';
  const p = panel({ rank: 'inspect', title });
  wrap.appendChild(p.el);
  // The one footer row (`foot.ts`, GH-498), sticky like Credits and Saves.
  const foot = screenFoot({ sticky: true });
  p.el.appendChild(foot.el);
  return { wrap, body: p.body, footStart: foot.start };
}

/** `/versus`: a callsign, then host a room on a map, or join one by its code. */
export function showVersus(stage: HTMLElement, deps: VersusDeps): Disposer {
  let disposed = false;
  const leaving = new AbortController();
  const { wrap, body, footStart } = frame(t('versus.title'));

  const callsign = callsignField(deps);
  body.appendChild(callsign.el);

  // --- host ----------------------------------------------------------------
  heading(body, t('versus.host.title'));
  const mapField = document.createElement('label');
  mapField.className = 'rl-versus__field';
  const mapName = document.createElement('span');
  mapName.className = 'rl-versus__label';
  mapName.textContent = t('versus.host.map');
  const select = document.createElement('select');
  select.className = 'rl-versus__map';
  for (const m of deps.maps) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    select.appendChild(o);
  }
  if (deps.maps.some((m) => m.id === DEFAULT_MAP)) select.value = DEFAULT_MAP;
  mapField.append(mapName, select);
  body.appendChild(mapField);
  const openBtn = button(t('versus.host.open'), 'rl-versus__open');
  markConfirm(openBtn);
  body.appendChild(openBtn);

  // --- join ----------------------------------------------------------------
  heading(body, t('versus.join.title'));
  const codeField = document.createElement('label');
  codeField.className = 'rl-versus__field';
  const codeName = document.createElement('span');
  codeName.className = 'rl-versus__label';
  codeName.textContent = t('versus.join.code');
  const code = document.createElement('input');
  code.type = 'text';
  code.className = 'rl-versus__code-input';
  code.autocomplete = 'off';
  code.spellcheck = false;
  code.setAttribute('autocapitalize', 'characters');
  codeField.append(codeName, code);
  body.appendChild(codeField);
  const goBtn = button(t('versus.join.go'), 'rl-versus__join');
  body.appendChild(goBtn);

  const msg = messageLine('rl-versus__msg');
  body.appendChild(msg);

  let busy = false;
  const sync = (): void => {
    openBtn.disabled = busy || deps.maps.length === 0;
    goBtn.disabled = busy || code.value.length !== CODE_LENGTH;
  };
  const start = (req: RoomRequest): void => {
    if (busy) return;
    busy = true;
    sync();
    msg.textContent = '';
    deps.open(req, leaving.signal).then(
      (o) => {
        // Left while the room opened: nobody will take it, so it is closed here.
        if (disposed) { o.transport.close(); return; }
        pendingLobby.get(o.code)?.transport.close();
        pendingLobby.set(o.code, adopt(o, deps));
        deps.navigate(routes.versusRoom(o.code));
      },
      (err: unknown) => {
        if (disposed) return;
        busy = false;
        sync();
        msg.textContent = errorLine(err);
      },
    );
  };
  openBtn.addEventListener('click', () => start({ kind: 'create', map: select.value, callsign: callsign.input.value.trim() }));
  const join = (): void => {
    if (code.value.length !== CODE_LENGTH) return;
    start({ kind: 'join', code: code.value, callsign: callsign.input.value.trim() });
  };
  goBtn.addEventListener('click', join);
  code.addEventListener('input', () => {
    const v = filterCode(code.value);
    if (v !== code.value) code.value = v;
    sync();
  });
  code.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') join();
  });
  sync();

  footStart.appendChild(footBack(t('nav.backToMenu'), routes.menu()));

  stagger(wrap);
  stage.appendChild(wrap);
  return () => {
    disposed = true;
    leaving.abort();
    wrap.remove();
  };
}

/** `/versus/:code`: the room's lobby, or -- by a direct link -- a callsign and Join first. */
export function showVersusRoom(stage: HTMLElement, code: string, deps: VersusDeps): Disposer {
  let disposed = false;
  const leaving = new AbortController();
  let room: Room | null = pendingLobby.get(code) ?? null;
  pendingLobby.delete(code);
  let leaveDialog: ConfirmHandle | null = null;

  const { wrap, body, footStart } = frame(t('versus.room.title', { code }));

  const leaveNow = (): void => {
    if (room === null || room.phase !== 'lobby') return;
    room.phase = 'closed';
    room.transport.close();
  };
  const askLeave = (): void => {
    if (room === null || leaveDialog !== null) return;
    // A room that already ended has nothing left to close for anyone.
    if (room.phase === 'ended') { deps.navigate(routes.versus()); return; }
    if (room.phase !== 'lobby') return;
    leaveDialog = confirmDialog(stage, {
      title: t('versus.room.leave.confirm.title'),
      body: t('versus.room.leave.confirm.body'),
      confirm: t('versus.room.leave.confirm.action'),
      danger: true,
    });
    void leaveDialog.answer.then((ok) => {
      leaveDialog = null;
      if (!ok || disposed) return;
      leaveNow();
      deps.navigate(routes.versus());
    });
  };

  const lobby = (r: Room): void => {
    body.replaceChildren();
    const share = document.createElement('p');
    share.className = 'rl-versus__share';
    share.textContent = t('versus.room.share');
    const big = document.createElement('div');
    big.className = 'rl-versus__code';
    big.textContent = r.code;
    const copyRow = document.createElement('div');
    copyRow.className = 'rl-versus__copy-row';
    const copyBtn = button(t('versus.room.copy'), 'rl-versus__copy');
    const copied = messageLine('rl-versus__copied');
    copyBtn.addEventListener('click', () => {
      void deps.copy(deps.linkFor(r.code)).then((ok) => {
        if (!disposed) copied.textContent = t(ok ? 'versus.room.copied' : 'versus.room.copyFailed');
      });
    });
    copyRow.append(copyBtn, copied);

    const seats = document.createElement('div');
    seats.className = 'rl-versus__seats';
    const mapLine = document.createElement('p');
    mapLine.className = 'rl-versus__room-map';
    const mapName = document.createElement('span');
    mapName.className = 'rl-versus__label';
    mapName.textContent = t('versus.host.map');
    const mapValue = document.createElement('span');
    mapValue.className = 'rl-versus__map-name';
    mapLine.append(mapName, mapValue);
    const status = messageLine('rl-versus__status');
    const ready = button(t('versus.room.ready'), 'rl-versus__ready');
    markConfirm(ready);
    ready.setAttribute('aria-pressed', 'false');
    let readySent = false;
    ready.addEventListener('click', () => {
      if (readySent || r.phase !== 'lobby') return;
      readySent = true;
      r.transport.ready();
      paint();
    });
    // The lobby chat line (N1b task 9) mounts here.
    const chat = document.createElement('div');
    chat.className = 'rl-versus__chat';
    chat.setAttribute('role', 'region');
    chat.setAttribute('aria-label', t('versus.room.chat'));

    const card = (n: Seat): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'rl-versus__seat';
      const s = r.seats.find((x) => x.seat === n);
      const state = document.createElement('span');
      state.className = 'rl-versus__state';
      if (s === undefined) {
        el.dataset.empty = '1';
        state.textContent = t('versus.room.waiting');
        el.appendChild(state);
        return el;
      }
      const dot = document.createElement('span');
      dot.className = 'rl-versus__dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.dataset.connected = s.connected ? '1' : '0';
      const name = document.createElement('span');
      name.className = 'rl-versus__name';
      name.textContent = s.callsign;
      el.append(dot, name);
      if (n === r.seat) {
        el.dataset.you = '1';
        const you = document.createElement('span');
        you.className = 'rl-versus__you';
        you.textContent = t('versus.room.you');
        el.appendChild(you);
      }
      if (s.ready) el.dataset.ready = '1';
      state.textContent = t(s.ready ? 'versus.room.ready' : 'versus.room.notReady');
      el.appendChild(state);
      return el;
    };

    const paint = (): void => {
      seats.replaceChildren(...SEAT_ORDER.map(card));
      mapValue.textContent = deps.maps.find((m) => m.id === r.map)?.label ?? r.map;
      const mine = r.seats.find((x) => x.seat === r.seat);
      const pressed = readySent || mine?.ready === true;
      ready.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      ready.disabled = pressed || r.phase !== 'lobby';
      status.textContent = r.phase === 'ended' ? t('versus.room.ended') : r.error !== null ? t(r.error) : '';
    };
    r.repaint = paint;
    body.append(share, big, copyRow, seats, mapLine, status, ready, chat);
    paint();

    // The way back is Leave, confirmed: it closes the room for both seats.
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'rl-btn rl-versus__leave';
    leave.innerHTML = symbolLabel('back', t('versus.room.leave'));
    leave.dataset.kind = 'back';
    leave.addEventListener('click', askLeave);
    footStart.replaceChildren(leave);
  };

  /** A direct link: no room parked for this code, so a callsign and Join first. */
  const prompt = (): void => {
    const callsign = callsignField(deps);
    const go = button(t('versus.join.go'), 'rl-versus__join');
    markConfirm(go);
    const msg = messageLine('rl-versus__msg');
    let busy = false;
    go.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      go.disabled = true;
      msg.textContent = '';
      deps.open({ kind: 'join', code, callsign: callsign.input.value.trim() }, leaving.signal).then(
        (o) => {
          if (disposed) { o.transport.close(); return; }
          room = adopt(o, deps);
          lobby(room);
        },
        (err: unknown) => {
          if (disposed) return;
          busy = false;
          go.disabled = false;
          msg.textContent = errorLine(err);
        },
      );
    });
    body.append(callsign.el, go, msg);
    footStart.appendChild(footBack(t('versus.title'), routes.versus()));
  };

  if (room !== null) lobby(room);
  else prompt();

  // Escape is the lobby's back control, so it asks first, like Leave
  // (`shell/escape-back.ts` leaves this route alone on purpose).
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || ev.repeat || ev.defaultPrevented || isDialogOpen() || isTextEntry(ev.target)) return;
    ev.preventDefault();
    if (room !== null) askLeave();
    else deps.navigate(routes.versus());
  };
  window.addEventListener('keydown', onKey);

  stagger(wrap);
  stage.appendChild(wrap);
  return () => {
    disposed = true;
    leaving.abort();
    window.removeEventListener('keydown', onKey);
    leaveDialog?.close();
    if (room !== null) {
      room.repaint = null;
      // Before the start this tab leaves the room (`bye`); an ended room only
      // needs its transport stopped. After the start the battlefield owns it.
      if (room.phase === 'lobby') leaveNow();
      else if (room.phase === 'ended') { room.phase = 'closed'; room.transport.close(); }
    }
    wrap.remove();
  };
}
