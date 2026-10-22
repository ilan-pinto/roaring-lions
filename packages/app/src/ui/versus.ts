// packages/app/src/ui/versus.ts
/**
 * Play with a friend (N1b task 6): `/versus`, where a player picks a callsign
 * and either hosts a room or joins one by its code, and `/versus/:code`, the
 * room's lobby -- the code shown large, a link to copy, the two seats, the
 * map, Ready, and Leave.
 *
 * Drawn as a FACE-OFF (the lead's direction C with A's map card, 2026-10-16):
 * the host picks a side first (KDF, Sarim or Mirror, one radio group), and the
 * two sides stand as cards -- yours, VS, your friend's -- tinted by RELATION
 * as the match draws them (`--side-you`/`--side-friend`: the own and hostile
 * team colours, which follow the colour-vision setting; the faction is in the
 * name and portrait, never the colour). The side narrows the ground: on a faction pick, the mirror-only
 * maps grey out with the reason. Then the ground (a map card: its picture with
 * both starts, its line, "Measured even" and its pairing), the brigade
 * switch, and Open a room. In the lobby the room code stands in your friend's
 * empty card, where they will stand, announced once. The menu's still plate
 * sits behind both screens (never a live scene host).
 *
 * One socket from the host's click to the battlefield. `/versus` opens the
 * room (`deps.open`, which is `openRoom` in `net/connect.ts`: created or
 * joined, socket open, nothing said but `hello`) and parks it in
 * `pendingLobby` under its code before navigating; the lobby takes it from
 * there, once. At the room's `start` the lobby hands the transport to the
 * battlefield (`net/handoff.ts`) and replaces itself with the match's URL.
 * A direct link to a lobby (the guest's whole path) finds nothing parked, so
 * it asks for a callsign and joins first. A parked room nobody takes within
 * `PENDING_LOBBY_EXPIRE_MS` is closed: it must not leave a socket open. A
 * join into a room this tab holds a seat in that has ALREADY STARTED (a
 * lobby reloaded after the start) goes to the match instead, whose
 * `connectMatch` rejoins with the stored ticket.
 *
 * Who owns the socket, which is the disposer contract here: `/versus` owns a
 * room that opens after it was left (closed, never navigated to); the lobby
 * owns it until the start (its disposer says `bye`, which ends the room for
 * both seats); after the start the battlefield does (nothing in the disposer).
 *
 * Callsigns, chat lines and the code are typed by players. They reach the
 * DOM through `textContent` only, never through markup (the lobby chat is
 * `NetChat`, which keeps to that too).
 */
import { maps } from '@lions/data';
import { ADVISOR_SCOPES, MAX_CALLSIGN_CHARS, callsignOrDefault, cleanCallsign, versusMapAllowed, type AdvisorScope, type Faction, type LobbyKit, type Matchup, type Seat, type SeatState, type WsTransport } from '@lions/net';
import { t } from '../i18n/t';
import { RoomRefused, RoomStarted, type OpenedRoom, type RoomRequest } from '../net/connect';
import { handOver } from '../net/handoff';
import { isTextEntry } from '../shell/escape-back';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';
import { confirmDialog, isDialogOpen, type ConfirmHandle } from './confirm';
import { markConfirm } from './confirm-cue';
import { footBack, screenFoot } from './foot';
import { stagger } from './motion';
import { NetChat } from './net-chat';
import { symbolLabel } from './symbol';
import { factionArt, factionBlurb, factionName, friendSide, hostSide, matchupLabel } from './versus-faction';
import { mapCard, mapPicture, pairsBoth, splitMapLabel } from './versus-ground';

/** The Worker's room-code alphabet (`packages/worker/src/match/code.ts`, no
 *  0/O/1/I). The app cannot import the Worker, so this is a copy, and
 *  `versus.test.ts` pins it against that file's text. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** The room's own cap (`@lions/net`'s `MAX_CALLSIGN_CHARS`, one number for both sides). */
export const CALLSIGN_MAX = MAX_CALLSIGN_CHARS;
/** The map a host is offered first, when it ships. */
const DEFAULT_MAP = 'tel_marum';
/** The host's side picker, in the order the segmented control lists them
 *  (ruling 2026-10-16): the two factions, then the mirror. The mirror is still
 *  the default pick. */
const SIDE_ORDER: readonly Matchup[] = ['kdf', 'sarim', 'mirror'];
/** How long a room opened on `/versus` waits for its lobby to take it, like
 *  `handoff.ts`'s `HANDOFF_EXPIRE_MS`: then it is closed. */
export const PENDING_LOBBY_EXPIRE_MS = 10_000;

/** What a typed room code becomes: upper case, the alphabet only, six at most. */
export function filterCode(raw: string): string {
  return [...raw.toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).join('').slice(0, CODE_LENGTH);
}

/** The maps a room can be hosted on (R-B9): the free-play picker's maps that
 *  the lead opened for versus (GH-561, 2026-10-14) -- the ones measured close
 *  to even, `VERSUS_FAIR_MAPS` -- by their own names. The tile studies and the
 *  tutorial ground are not among them, and neither is a map nobody has
 *  measured; the Worker refuses those too (`versusMapAllowed`). */
export function versusMaps(catalogue: Record<string, { name: string }> = maps): { id: string; label: string }[] {
  return Object.keys(catalogue)
    .filter(versusMapAllowed)
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
  /** The server's origin, as the advisor's command names it (`--server`). */
  serverOrigin: string;
  /** Trades this tab's seat ticket for an advisor ticket (`inviteAdvisor`,
   *  `net/connect.ts`). Rejects with an `AdvisorRefused` when the room says no. */
  advisorTicket(code: string, scope: AdvisorScope): Promise<string>;
  /** The menu's still plate (`${BASE}${menuDiorama.plate}`), drawn behind
   *  both screens; absent, the screens draw on the plain ground. */
  plateUrl?: string;
  /** The browser asked to spend less data: the plate is not fetched. */
  saveData?: () => boolean;
}

/** Where the lobby tells a player to save the copied advisor ticket: a private
 *  file the command reads (`--ticket-file`). A ticket on a command line shows
 *  in the process list and the shell history, and the MCP client that spawns
 *  the agent owns its stdin, so a file is the one channel that works. */
export const ADVISOR_TICKET_FILE = '~/.roaring-lions/advisor-ticket';

/** The ready-to-paste command. The ticket is never in it. */
export function advisorCommand(origin: string, code: string, scope: AdvisorScope): string {
  return `pnpm --silent agent -- --server ${origin} --code ${code} --scope ${scope} --ticket-file ${ADVISOR_TICKET_FILE}`;
}

/** A room between `/versus` and the start. */
interface Room {
  readonly code: string;
  readonly seat: Seat;
  readonly transport: WsTransport;
  seats: SeatState[];
  map: string;
  /** Each seat's faction, by seat (the host's matchup). */
  factions: [Faction, Faction];
  /** The room's kit rule (per-seat kit), shown to both seats. */
  kit: LobbyKit;
  /** `closed`: this tab left (and said `bye`). `ended`: the room ended under it. */
  phase: 'lobby' | 'started' | 'ended' | 'closed';
  /** An i18n key for a refusal the room sent after the lobby opened. */
  error: string | null;
  /** The mounted lobby's repaint, or null while none is mounted. */
  repaint: (() => void) | null;
  /** The mounted lobby's chat, or null while none is mounted. */
  chat: NetChat | null;
  /** The advisor each seat has seated, as the room last said (N4a). */
  advisors: [AdvisorScope | null, AdvisorScope | null];
}

/** Opened on `/versus`, waiting for its lobby to mount: the lobby takes it
 *  once, and one nobody takes is closed at its expiry. */
const pendingLobby = new Map<string, { room: Room; timer: ReturnType<typeof setTimeout> }>();

/** Parks `room` for its lobby; a room already parked under that code is closed. */
function park(room: Room): void {
  takePending(room.code)?.transport.close();
  const timer = setTimeout(() => {
    // Only the entry this timer was armed for: a take, or a newer park for the
    // same code, leaves another entry (or none) and nothing happens.
    if (pendingLobby.get(room.code)?.room !== room) return;
    pendingLobby.delete(room.code);
    room.phase = 'closed';
    room.transport.close();
  }, PENDING_LOBBY_EXPIRE_MS);
  pendingLobby.set(room.code, { room, timer });
}

/** One take only; cancels the expiry. */
function takePending(code: string): Room | null {
  const entry = pendingLobby.get(code);
  if (entry === undefined) return null;
  pendingLobby.delete(code);
  clearTimeout(entry.timer);
  return entry.room;
}

const ERROR_KEY: Record<RoomRefused['reason'], string> = {
  not_found: 'versus.error.notFound',
  full: 'versus.error.full',
  build: 'versus.error.build',
  failed: 'versus.error.failed',
};
const errorLine = (err: unknown): string => t(err instanceof RoomRefused ? ERROR_KEY[err.reason] : 'versus.error.failed');

/** A join into a room that has already started goes to the match on its map,
 *  replacing this screen: the battlefield rejoins with the stored ticket. */
function startedElsewhere(err: unknown, deps: VersusDeps): boolean {
  if (!(err instanceof RoomStarted)) return false;
  deps.navigate(`${routes.sandbox(err.map)}?net=${encodeURIComponent(err.code)}`, { replace: true });
  return true;
}

/** Takes an opened room into the screens: its hooks from here are the lobby's. */
function adopt(o: OpenedRoom, deps: VersusDeps): Room {
  const room: Room = {
    code: o.code, seat: o.seat, transport: o.transport,
    seats: o.lobby.seats, map: o.lobby.map, factions: o.lobby.factions, kit: o.lobby.kit,
    phase: 'lobby', error: null, repaint: null, chat: null, advisors: [null, null],
  };
  o.transport.setHooks({
    onLobby: (seats, _you, map, factions, kit) => {
      room.seats = seats;
      room.map = map;
      if (factions !== undefined) room.factions = factions;
      // The room names the rule only when it is `brigade`; silence is matched.
      room.kit = kit ?? 'matched';
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
    // A refused ticket or a different build is final: the transport stops
    // (`WsTransport`), so the lobby ends -- a line that says why, and no Ready.
    onError: (code) => {
      if (room.phase !== 'lobby' || (code !== 'build_mismatch' && code !== 'bad_ticket')) return;
      room.phase = 'ended';
      room.error = code === 'build_mismatch' ? 'versus.error.build' : null;
      room.repaint?.();
    },
    // The room echoes every line to both seats, this one's own included.
    onChat: (seat, text) => room.chat?.receive(seat, text),
    // The badges: the transport clears them on a reconnect, before the room's next say.
    onAdvisors: (present) => {
      room.advisors = present;
      room.repaint?.();
    },
  });
  return room;
}

/** How long after the lobby is in the document its live region is filled. A
 *  region that ENTERS the document already holding its text is not announced
 *  by most screen readers (they speak changes), so it mounts empty and is
 *  filled once the insertion has been rendered (fix round 1, Important 1). */
export const ANNOUNCE_AFTER_MOUNT_MS = 100;

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
  input.value = cleanCallsign(deps.callsign.get());
  // Cleaned the way the room will clean it (`cleanCallsign`), so the field
  // shows what the other player will see; kept empty when nothing is left, and
  // 'Lion' only where it is sent (`callsignOrDefault`).
  input.addEventListener('change', () => {
    input.value = cleanCallsign(input.value);
    deps.callsign.set(input.value);
  });
  el.append(name, input);
  return { el, input };
}

/** The "Invite an advisor" control for this seat (N4a, decision D1): a scope
 *  choice, a button that asks the room for an advisor ticket, and then the
 *  command to paste and a Copy ticket button. Built once per lobby and moved
 *  between repaints, so a minted command survives a ready toggle. The ticket
 *  lives in this closure only: never in the DOM, a URL or the command. */
function advisorInvite(room: Room, deps: VersusDeps, alive: () => boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'rl-versus__advisor-invite';
  const heading = document.createElement('span');
  heading.className = 'rl-versus__label';
  heading.textContent = t('net.advisor.invite');

  const scopes = document.createElement('fieldset');
  scopes.className = 'rl-versus__advisor-scope';
  const legend = document.createElement('legend');
  legend.className = 'rl-versus__advisor-legend';
  legend.textContent = t('net.advisor.scope');
  scopes.appendChild(legend);
  let scope: AdvisorScope = 'advise';
  for (const value of ADVISOR_SCOPES) {
    const label = document.createElement('label');
    label.className = 'rl-versus__advisor-choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `advisor-scope-${room.code}`;
    radio.value = value;
    radio.checked = value === scope;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      scope = value;
      // The ticket and the command in view were for the other scope.
      retire();
      hint.textContent = t(`net.advisor.scope.${scope}.hint`);
    });
    const text = document.createElement('span');
    text.textContent = t(`net.advisor.scope.${value}`);
    label.append(radio, text);
    scopes.appendChild(label);
  }
  const hint = document.createElement('p');
  hint.className = 'rl-versus__advisor-hint';
  hint.textContent = t(`net.advisor.scope.${scope}.hint`);

  const mint = button(t('net.advisor.mint'), 'rl-versus__advisor-mint');
  const status = messageLine('rl-versus__advisor-status');
  const note = document.createElement('p');
  note.className = 'rl-versus__advisor-note';
  note.textContent = t('net.advisor.note');
  const result = document.createElement('div');
  result.className = 'rl-versus__advisor-result';

  let ticket: string | null = null;
  let asking = 0;
  let busy = false;
  /** Forgets the ticket and takes the command off screen. */
  function retire(): void {
    asking++;
    busy = false;
    mint.disabled = false;
    ticket = null;
    status.textContent = '';
    result.replaceChildren();
  }
  const showTicket = (minted: string, forScope: AdvisorScope): void => {
    ticket = minted;
    const caption = document.createElement('span');
    caption.className = 'rl-versus__label';
    caption.textContent = t('net.advisor.command.label');
    const cmd = document.createElement('code');
    cmd.className = 'rl-versus__advisor-command';
    cmd.textContent = advisorCommand(deps.serverOrigin, room.code, forScope);
    const file = document.createElement('p');
    file.className = 'rl-versus__advisor-file';
    file.textContent = t('net.advisor.ticketFile', { path: ADVISOR_TICKET_FILE });
    const copy = button(t('net.advisor.copyTicket'), 'rl-versus__advisor-copy');
    const copied = messageLine('rl-versus__advisor-copied');
    copy.addEventListener('click', () => {
      const mine = ticket;
      if (mine === null) return;
      void deps.copy(mine).then((ok) => {
        if (alive() && ticket === mine) copied.textContent = t(ok ? 'net.advisor.ticketCopied' : 'net.advisor.ticketCopyFailed');
      });
    });
    result.replaceChildren(caption, cmd, file, copy, copied);
  };
  mint.addEventListener('click', () => {
    if (busy) return;
    retire();
    busy = true;
    mint.disabled = true;
    const mine = asking;
    const forScope = scope;
    status.textContent = t('net.advisor.minting');
    deps.advisorTicket(room.code, forScope).then(
      (minted) => {
        if (!alive() || asking !== mine) return;
        busy = false;
        mint.disabled = false;
        status.textContent = '';
        showTicket(minted, forScope);
      },
      () => {
        if (!alive() || asking !== mine) return;
        busy = false;
        mint.disabled = false;
        status.textContent = t('net.advisor.failed');
      },
    );
  });

  el.append(heading, scopes, hint, mint, status, note, result);
  return el;
}

let uid = 0;
/** A document-unique id, so `aria-describedby`/`aria-labelledby` resolve even
 *  when a screen is mounted beside another (a test, a soft navigation). */
const nextId = (what: string): string => `rl-versus-${what}-${++uid}`;

/** Text a screen reader reads and the eye does not need twice. */
function srOnly(text: string, id?: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'rl-versus__sr';
  s.textContent = text;
  if (id !== undefined) s.id = id;
  return s;
}

/** The one commit on a screen, in a menu tile's face (VR-20's stamp). */
function stamp(label: string, className: string): HTMLButtonElement {
  const b = button(label, `rl-versus__stamp ${className}`);
  markConfirm(b);
  return b;
}

/**
 * Both screens' frame (the face-off, 2026-10-16): a full screen like the menu,
 * so not a `panel()` (a screen's rank is the screen) -- the menu's still plate
 * behind it, the hero title, a body, the one footer row, and a polite live
 * region for what changes without the player's hand (the room opening).
 */
function frame(deps: VersusDeps, title: string): {
  wrap: HTMLElement;
  headEnd: HTMLElement;
  body: HTMLElement;
  footStart: HTMLElement;
  live: HTMLElement;
} {
  const wrap = document.createElement('div');
  wrap.className = 'rl-versus';
  // The menu's own plate (the scene host's held frame), not a live host: no
  // second GPU context, nothing that moves. Save-data skips the 421 KB fetch.
  if (deps.plateUrl !== undefined && deps.plateUrl !== '' && deps.saveData?.() !== true) {
    const back = document.createElement('div');
    back.className = 'rl-versus__backdrop';
    back.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.className = 'rl-versus__backdrop-img';
    img.alt = '';
    img.src = deps.plateUrl;
    // A plate that does not load is removed, never drawn broken.
    img.addEventListener('error', () => back.remove(), { once: true });
    back.appendChild(img);
    wrap.appendChild(back);
  }
  const main = document.createElement('section');
  main.className = 'rl-versus__frame';
  const head = document.createElement('header');
  head.className = 'rl-versus__head';
  const h = document.createElement('h2');
  h.className = 'rl-versus__title';
  h.id = nextId('title');
  h.textContent = title;
  main.setAttribute('aria-labelledby', h.id);
  const headEnd = document.createElement('div');
  headEnd.className = 'rl-versus__head-end';
  head.append(h, headEnd);
  const body = document.createElement('div');
  body.className = 'rl-versus__body';
  const foot = screenFoot();
  const live = messageLine('rl-versus__live');
  main.append(head, body, foot.el, live);
  wrap.appendChild(main);
  return { wrap, headEnd, body, footStart: foot.start, live };
}

/** The face-off's VS, decoration between the two cards. */
function versusMark(): HTMLElement {
  const vs = document.createElement('span');
  vs.className = 'rl-versus__vs';
  vs.setAttribute('aria-hidden', 'true');
  vs.textContent = t('versus.lobby.vs');
  return vs;
}

/** `/versus`: pick a side, then the ground, open a room -- or join one by its code. */
export function showVersus(stage: HTMLElement, deps: VersusDeps): Disposer {
  let disposed = false;
  const leaving = new AbortController();
  const { wrap, headEnd, body, footStart } = frame(deps, t('versus.title'));

  const callsign = callsignField(deps);
  headEnd.appendChild(callsign.el);

  /** What the host has picked so far. The mirror first, as every room was
   *  before the matchup existed. */
  let side: Matchup = 'mirror';
  let map = deps.maps.some((m) => m.id === DEFAULT_MAP) ? DEFAULT_MAP : (deps.maps[0]?.id ?? '');
  let kit = false;
  // KDF vs Sarim plays only on `FACTION_MATCHUP_MAPS` (the lead, 2026-10-14;
  // the room refuses it anywhere else). A build that ships none of them
  // offers the mirror alone.
  const offered = deps.maps.filter((m) => pairsBoth(m.id));

  // --- the side: a segmented radio group, picked FIRST (ruling 2026-10-16) --
  const sides = document.createElement('fieldset');
  sides.className = 'rl-versus__sides';
  const sidesLegend = document.createElement('legend');
  sidesLegend.className = 'rl-versus__label';
  sidesLegend.textContent = t('versus.lobby.side.pick');
  sides.appendChild(sidesLegend);
  const sideName = nextId('side');
  const sideReasonId = nextId('side-reason');
  const sideRadios = new Map<Matchup, HTMLInputElement>();
  for (const m of SIDE_ORDER) {
    const label = document.createElement('label');
    label.className = 'rl-versus__side';
    label.dataset.side = m;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.className = 'rl-versus__side-radio';
    radio.name = sideName;
    radio.value = m;
    radio.checked = m === side;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      side = m;
      syncSide();
    });
    const name = document.createElement('span');
    name.className = 'rl-versus__side-name';
    name.textContent = matchupLabel(m);
    label.append(radio, name);
    sides.appendChild(label);
    sideRadios.set(m, radio);
  }
  const sideReason = document.createElement('p');
  sideReason.className = 'rl-versus__side-reason';
  sideReason.id = sideReasonId;
  sideReason.textContent = t('versus.lobby.side.none');
  sideReason.hidden = offered.length > 0;
  sides.appendChild(sideReason);
  // N3 Task 6: KDF against Sarim plays the skirmish rules -- a camp, a purse and a
  // production line each -- where the mirror is today's placed-force match. Said
  // while a faction side is picked, and tied to both faction radios.
  const matchupNote = document.createElement('p');
  matchupNote.className = 'rl-versus__matchup-note';
  matchupNote.id = nextId('matchup-note');
  matchupNote.textContent = t('versus.matchup.economy');
  sides.appendChild(matchupNote);
  for (const [m, radio] of sideRadios) if (m !== 'mirror') radio.setAttribute('aria-describedby', matchupNote.id);
  for (const [m, radio] of sideRadios) {
    if (m === 'mirror' || offered.length > 0) continue;
    radio.disabled = true;
    radio.setAttribute('aria-describedby', sideReasonId);
    (radio.closest('label') as HTMLElement).dataset.off = '1';
  }
  body.appendChild(sides);

  // --- the face-off: your card, VS, your friend's ---------------------------
  const faceoff = document.createElement('div');
  faceoff.className = 'rl-versus__faceoff';
  const youCard = document.createElement('div');
  youCard.className = 'rl-versus__fcard';
  youCard.dataset.who = 'you';
  const friendCard = document.createElement('div');
  friendCard.className = 'rl-versus__fcard';
  friendCard.dataset.who = 'friend';
  faceoff.append(youCard, versusMark(), friendCard);
  body.appendChild(faceoff);
  const youName = document.createElement('span');
  youName.className = 'rl-versus__fcard-who';
  const paintCard = (card: HTMLElement, f: Faction, who: HTMLElement): void => {
    if (card.dataset.faction === f && card.firstChild === who) return;
    card.dataset.faction = f;
    const name = document.createElement('span');
    name.className = 'rl-versus__fcard-name';
    name.textContent = factionName(f);
    const blurb = document.createElement('span');
    blurb.className = 'rl-versus__fcard-blurb';
    blurb.textContent = factionBlurb(f);
    card.replaceChildren(who, factionArt(f, 'rl-versus__art--big'), name, blurb);
  };
  const friendWho = document.createElement('span');
  friendWho.className = 'rl-versus__fcard-who';
  friendWho.textContent = t('versus.lobby.friend');
  const nameYou = (): void => {
    youName.textContent = callsignOrDefault(callsign.input.value);
  };
  callsign.input.addEventListener('input', nameYou);
  nameYou();

  // --- the ground: the map card, and the maps as radio tiles ----------------
  const ground = document.createElement('div');
  ground.className = 'rl-versus__ground';
  const cardSlot = document.createElement('div');
  cardSlot.className = 'rl-versus__mapcard-slot';
  const mapsSet = document.createElement('fieldset');
  mapsSet.className = 'rl-versus__maps';
  const mapsLegend = document.createElement('legend');
  mapsLegend.className = 'rl-versus__label';
  mapsLegend.textContent = t('versus.lobby.ground.pick');
  mapsSet.appendChild(mapsLegend);
  const mapName = nextId('map');
  const tiles: { id: string; radio: HTMLInputElement; label: HTMLLabelElement; sub: HTMLElement }[] = [];
  for (const m of deps.maps) {
    const label = document.createElement('label');
    label.className = 'rl-versus__tile';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.className = 'rl-versus__map-radio';
    radio.name = mapName;
    radio.value = m.id;
    radio.checked = m.id === map;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      map = m.id;
      paintGround();
    });
    const text = document.createElement('span');
    text.className = 'rl-versus__tile-text';
    const name = document.createElement('span');
    name.className = 'rl-versus__tile-name';
    name.id = nextId('map-name');
    name.textContent = splitMapLabel(m.label).name;
    const sub = document.createElement('span');
    sub.className = 'rl-versus__tile-sub';
    sub.id = nextId('map-sub');
    radio.setAttribute('aria-labelledby', name.id);
    radio.setAttribute('aria-describedby', sub.id);
    text.append(name, sub);
    label.append(radio, mapPicture(m.id, 'rl-versus__pic--thumb', null), text);
    mapsSet.appendChild(label);
    tiles.push({ id: m.id, radio, label, sub });
  }
  // Said under the tiles while a side other than the mirror narrows them.
  const sideNote = document.createElement('p');
  sideNote.className = 'rl-versus__side-note';
  sideNote.textContent = t('versus.host.side.note');
  mapsSet.appendChild(sideNote);
  ground.append(cardSlot, mapsSet);
  body.appendChild(ground);
  const paintGround = (): void => {
    const label = deps.maps.find((m) => m.id === map)?.label;
    cardSlot.replaceChildren(...(label === undefined ? [] : [mapCard(map, label, 0)]));
  };

  // --- bring your brigade: a switch, and its one-line hint ------------------
  // HOST only, off by default, friends-only: the room cannot check a claim
  // against an account (no server ledger yet), and the joiner has no say.
  const act = document.createElement('div');
  act.className = 'rl-versus__act';
  const kitRow = document.createElement('div');
  kitRow.className = 'rl-versus__kit';
  const kitSwitch = document.createElement('button');
  kitSwitch.type = 'button';
  kitSwitch.className = 'rl-versus__kit-toggle';
  kitSwitch.setAttribute('role', 'switch');
  const knob = document.createElement('span');
  knob.className = 'rl-versus__knob';
  knob.setAttribute('aria-hidden', 'true');
  const kitName = document.createElement('span');
  kitName.className = 'rl-versus__kit-label';
  kitName.textContent = t('versus.host.kit');
  kitSwitch.append(knob, kitName);
  const kitHint = document.createElement('span');
  kitHint.className = 'rl-versus__kit-hint';
  kitHint.id = nextId('kit-hint');
  kitSwitch.setAttribute('aria-describedby', kitHint.id);
  const paintKit = (): void => {
    kitSwitch.setAttribute('aria-checked', String(kit));
    kitHint.textContent = t('versus.lobby.kit.hint', { on: String(kit) });
  };
  kitSwitch.addEventListener('click', () => {
    kit = !kit;
    paintKit();
  });
  paintKit();
  kitRow.append(kitSwitch, kitHint);
  const openBtn = stamp(t('versus.host.open'), 'rl-versus__open');
  // Open a room says its own failure here, beside the stamp, on a line
  // reserved like the join bar's -- never under the join cells.
  const openMsg = messageLine('rl-versus__open-msg');
  const openCol = document.createElement('div');
  openCol.className = 'rl-versus__open-col';
  openCol.append(openBtn, openMsg);
  act.append(kitRow, openCol);
  body.appendChild(act);

  /** A side narrows the ground: a mirror-only map greys out with its reason,
   *  and a pick on one moves to the first map the pairing plays. */
  function syncSide(): void {
    const narrowed = side !== 'mirror';
    if (narrowed && !pairsBoth(map) && offered.length > 0) map = offered[0]!.id;
    for (const tile of tiles) {
      const off = narrowed && !pairsBoth(tile.id);
      tile.radio.disabled = off;
      tile.radio.checked = tile.id === map;
      if (off) tile.label.dataset.off = '1';
      else delete tile.label.dataset.off;
      tile.sub.textContent = off ? t('versus.lobby.map.offReason') : t('versus.lobby.map.pairing', { both: String(pairsBoth(tile.id)) });
    }
    sideNote.hidden = !narrowed;
    matchupNote.hidden = !narrowed;
    paintCard(youCard, hostSide(side), youName);
    paintCard(friendCard, friendSide(side), friendWho);
    paintGround();
  }
  syncSide();

  // --- join: one bar, six drawn cells over one real input --------------------
  const joinBar = document.createElement('section');
  joinBar.className = 'rl-versus__join-bar';
  const joinLead = document.createElement('h3');
  joinLead.className = 'rl-versus__join-lead';
  joinLead.id = nextId('join');
  joinLead.textContent = t('versus.lobby.join.lead');
  joinBar.setAttribute('aria-labelledby', joinLead.id);
  const entry = document.createElement('label');
  entry.className = 'rl-versus__code-entry';
  const field = document.createElement('span');
  field.className = 'rl-versus__code-field';
  const cells = document.createElement('span');
  cells.className = 'rl-versus__code-cells';
  cells.setAttribute('aria-hidden', 'true');
  const cellEls: HTMLElement[] = [];
  for (let i = 0; i < CODE_LENGTH; i++) {
    const c = document.createElement('span');
    c.className = 'rl-versus__code-cell';
    cells.appendChild(c);
    cellEls.push(c);
  }
  const code = document.createElement('input');
  code.type = 'text';
  code.className = 'rl-versus__code-input';
  code.autocomplete = 'off';
  code.spellcheck = false;
  code.maxLength = CODE_LENGTH;
  code.setAttribute('autocapitalize', 'characters');
  const codeHintId = nextId('code-hint');
  code.setAttribute('aria-describedby', codeHintId);
  field.append(cells, code);
  entry.append(srOnly(t('versus.join.code')), field, srOnly(t('versus.lobby.join.hint'), codeHintId));
  const goBtn = button(t('versus.join.go'), 'rl-versus__join');
  const row = document.createElement('div');
  row.className = 'rl-versus__join-row';
  row.append(entry, goBtn);
  // The error line is RESERVED (ruling 2026-10-16): always in the layout, one
  // line tall, so an error does not push the screen down.
  const msg = messageLine('rl-versus__msg');
  joinBar.append(joinLead, row, msg);
  body.appendChild(joinBar);

  let busy = false;
  const sync = (): void => {
    openBtn.disabled = busy || deps.maps.length === 0;
    goBtn.disabled = busy || code.value.length !== CODE_LENGTH;
    cellEls.forEach((c, i) => {
      c.textContent = code.value[i] ?? '';
      if (i === code.value.length) c.dataset.next = '1';
      else delete c.dataset.next;
    });
  };
  const sayError = (text: string): void => {
    msg.textContent = text;
    if (text === '') {
      delete msg.dataset.tone;
      code.removeAttribute('aria-invalid');
      delete field.dataset.bad;
    } else {
      msg.dataset.tone = 'bad';
      code.setAttribute('aria-invalid', 'true');
      field.dataset.bad = '1';
    }
  };
  const start = (req: RoomRequest, fromJoin: boolean): void => {
    if (busy) return;
    busy = true;
    sync();
    sayError('');
    openMsg.textContent = '';
    delete openMsg.dataset.tone;
    deps.open(req, leaving.signal).then(
      (o) => {
        // Left while the room opened: nobody will take it, so it is closed here.
        if (disposed) { o.transport.close(); return; }
        park(adopt(o, deps));
        deps.navigate(routes.versusRoom(o.code));
      },
      (err: unknown) => {
        if (disposed || startedElsewhere(err, deps)) return;
        busy = false;
        sync();
        if (fromJoin) sayError(errorLine(err));
        else {
          openMsg.dataset.tone = 'bad';
          openMsg.textContent = errorLine(err);
        }
      },
    );
  };
  openBtn.addEventListener('click', () => start({ kind: 'create', map, matchup: side, kit: kit ? 'brigade' : 'matched', callsign: callsignOrDefault(callsign.input.value) }, false));
  const join = (): void => {
    if (code.value.length !== CODE_LENGTH) return;
    start({ kind: 'join', code: code.value, callsign: callsignOrDefault(callsign.input.value) }, true);
  };
  goBtn.addEventListener('click', join);
  code.addEventListener('input', () => {
    const v = filterCode(code.value);
    if (v !== code.value) code.value = v;
    if (msg.textContent !== '') sayError('');
    sync();
  });
  code.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') join();
  });
  sync();

  footStart.appendChild(footBack(t('nav.backToMenu'), routes.menu()));

  stagger(body);
  stage.appendChild(wrap);
  return () => {
    disposed = true;
    leaving.abort();
    wrap.remove();
  };
}

/** The room's code as the big cells: one cell a character, spelled for a
 *  screen reader (a six-letter run read as a word is no use to a friend). */
function codeCells(code: string): HTMLElement {
  const big = document.createElement('div');
  big.className = 'rl-versus__code';
  big.setAttribute('role', 'img');
  big.setAttribute('aria-label', [...code].join(' '));
  for (const ch of code) {
    const c = document.createElement('span');
    c.className = 'rl-versus__code-char';
    c.textContent = ch;
    big.appendChild(c);
  }
  return big;
}

/** `/versus/:code`: the room's lobby, or -- by a direct link -- a callsign and Join first. */
export function showVersusRoom(stage: HTMLElement, code: string, deps: VersusDeps): Disposer {
  let disposed = false;
  const leaving = new AbortController();
  let room: Room | null = takePending(code);
  let leaveDialog: ConfirmHandle | null = null;

  const { wrap, headEnd, body, footStart, live } = frame(deps, t('versus.title'));
  /** What takes the focus once the screen is in the document (Copy link, when
   *  the room opens with the code in the friend's card). */
  const focusOnMount: { el: HTMLElement | null } = { el: null };
  /** What the live region says once the screen is in the document. */
  let announceOnMount: string | null = null;
  let announceTimer: ReturnType<typeof setTimeout> | null = null;
  const announce = (text: string): void => {
    live.textContent = '';
    if (announceTimer !== null) clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      announceTimer = null;
      if (!disposed) live.textContent = text;
    }, ANNOUNCE_AFTER_MOUNT_MS);
  };
  const roomName = document.createElement('span');
  roomName.className = 'rl-versus__room-name';
  roomName.textContent = t('versus.room.title', { code });

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
    // The code, built once and MOVED between repaints: into the friend's empty
    // card while the room waits for them (where the friend will stand), and
    // up beside the title once they are in.
    const codeBlock = document.createElement('div');
    codeBlock.className = 'rl-versus__room';
    const tag = document.createElement('span');
    tag.className = 'rl-versus__room-tag';
    tag.textContent = t('versus.lobby.room.open');
    const share = document.createElement('p');
    share.className = 'rl-versus__share';
    share.textContent = t('versus.room.share');
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
    const link = document.createElement('code');
    link.className = 'rl-versus__link';
    link.textContent = deps.linkFor(r.code);
    codeBlock.append(tag, share, codeCells(r.code), copyRow, link);

    const seats = document.createElement('div');
    seats.className = 'rl-versus__seats rl-versus__faceoff';
    // The ground and the rule, under the cards.
    const lower = document.createElement('div');
    lower.className = 'rl-versus__room-lower';
    const mapSlot = document.createElement('div');
    mapSlot.className = 'rl-versus__room-map';
    const side = document.createElement('div');
    side.className = 'rl-versus__room-side';
    // The room's kit rule, the same line for both seats.
    const kitLine = document.createElement('p');
    kitLine.className = 'rl-versus__room-kit';
    const kitLabel = document.createElement('span');
    kitLabel.className = 'rl-versus__label';
    kitLabel.textContent = t('versus.room.kit');
    const kitValue = document.createElement('span');
    kitValue.className = 'rl-versus__kit-name';
    kitLine.append(kitLabel, kitValue);
    const status = messageLine('rl-versus__status');
    const ready = stamp(t('versus.room.ready'), 'rl-versus__ready');
    ready.setAttribute('aria-pressed', 'false');
    let readySent = false;
    ready.addEventListener('click', () => {
      if (readySent || r.phase !== 'lobby') return;
      readySent = true;
      r.transport.ready();
      paint();
    });
    side.append(kitLine, ready, status);
    lower.append(mapSlot, side);
    // The lobby chat (N1b task 9, R-B10): docked, so its input is always there.
    const chat = document.createElement('div');
    chat.className = 'rl-versus__chat';
    chat.setAttribute('role', 'region');
    chat.setAttribute('aria-label', t('versus.room.chat'));
    r.chat?.dispose();
    r.chat = new NetChat(chat, {
      send: (text) => r.transport.chat(text),
      nameOf: (seat) => r.seats.find((x) => x.seat === seat)?.callsign ?? '',
    }, { docked: true });

    // Built once: only this seat's card ever holds it, and a repaint moves it.
    const invite = advisorInvite(r, deps, () => !disposed && r.repaint !== null);

    const card = (n: Seat): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'rl-versus__seat rl-versus__fcard';
      el.dataset.seat = String(n);
      el.dataset.who = n === r.seat ? 'you' : 'friend';
      // The force this seat commands: KDF or Sarim, which is also its tint.
      el.dataset.faction = r.factions[n];
      const s = r.seats.find((x) => x.seat === n);
      const who = document.createElement('span');
      who.className = 'rl-versus__fcard-who';
      const force = document.createElement('span');
      force.className = 'rl-versus__force rl-versus__fcard-name';
      force.dataset.faction = r.factions[n];
      force.textContent = factionName(r.factions[n]);
      const state = document.createElement('span');
      state.className = 'rl-versus__state';
      if (s === undefined) {
        el.dataset.empty = '1';
        who.textContent = t('versus.lobby.friend');
        state.textContent = t('versus.room.waiting');
        if (r.phase === 'lobby') {
          el.dataset.room = '1';
          el.append(who, codeBlock, force, state);
        } else {
          el.append(who, factionArt(r.factions[n], 'rl-versus__art--big'), force, state);
        }
        return el;
      }
      const dot = document.createElement('span');
      dot.className = 'rl-versus__dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.dataset.connected = s.connected ? '1' : '0';
      const name = document.createElement('span');
      name.className = 'rl-versus__name';
      name.textContent = s.callsign;
      who.append(dot, name);
      if (n === r.seat) {
        const you = document.createElement('span');
        you.className = 'rl-versus__you';
        you.textContent = t('versus.room.you');
        who.appendChild(you);
      }
      el.append(who, factionArt(r.factions[n], 'rl-versus__art--big'), force);
      if (s.ready) el.dataset.ready = '1';
      state.textContent = t(s.ready ? 'versus.room.ready' : 'versus.room.notReady');
      el.appendChild(state);
      // Whoever the room says advises this seat, for both players to see (D1).
      const advisor = r.advisors[n];
      if (advisor !== null) {
        const badge = document.createElement('span');
        badge.className = 'rl-versus__advisor-badge';
        badge.dataset.scope = advisor;
        badge.textContent = t('net.advisor.badge', { scope: advisor });
        el.appendChild(badge);
      }
      // Only the viewer's own seat invites an advisor, and only while the lobby is open.
      if (n === r.seat && r.phase === 'lobby') el.appendChild(invite);
      return el;
    };

    let paintedMap: string | null = null;
    const paint = (): void => {
      // Your card first, your friend's across from it, whichever seat you hold.
      const mine = r.seat;
      const theirs: Seat = mine === 0 ? 1 : 0;
      // Moving the code block drops a focus inside it to <body>: put it back.
      const held = document.activeElement;
      const keep = held instanceof HTMLElement && codeBlock.contains(held) ? held : null;
      seats.replaceChildren(card(mine), versusMark(), card(theirs));
      // The code is beside the title unless it is in the friend's card.
      if (!seats.contains(codeBlock)) {
        codeBlock.dataset.place = 'head';
        headEnd.replaceChildren(codeBlock);
      } else {
        codeBlock.dataset.place = 'card';
        headEnd.replaceChildren(roomName);
      }
      if (keep !== null && keep.isConnected && document.activeElement !== keep) keep.focus({ preventScroll: true });
      if (paintedMap !== r.map) {
        paintedMap = r.map;
        const label = deps.maps.find((m) => m.id === r.map)?.label ?? r.map;
        mapSlot.replaceChildren(mapCard(r.map, label, r.seat, 'rl-versus__mapcard--room'));
      }
      kitLine.dataset.kit = r.kit;
      kitValue.textContent = t('versus.room.kit.value', { kit: r.kit });
      const me = r.seats.find((x) => x.seat === r.seat);
      const pressed = readySent || me?.ready === true;
      ready.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      ready.disabled = pressed || r.phase !== 'lobby';
      status.textContent = r.error !== null ? t(r.error) : r.phase === 'ended' ? t('versus.room.ended') : '';
    };
    r.repaint = paint;
    body.append(seats, lower, chat);
    paint();
    // The room is open and the friend's seat holds its code: say so once, and
    // put the player on the control that sends it.
    if (seats.contains(codeBlock)) {
      const text = t('versus.lobby.room.announce', { code: r.code });
      focusOnMount.el = copyBtn;
      if (wrap.isConnected) {
        announce(text);
        copyBtn.focus({ preventScroll: true });
      } else {
        live.textContent = '';
        announceOnMount = text;
      }
    }

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
    headEnd.replaceChildren(roomName);
    const box = document.createElement('div');
    box.className = 'rl-versus__prompt';
    const lead = document.createElement('p');
    lead.className = 'rl-versus__prompt-lead';
    lead.textContent = t('versus.lobby.prompt', { code });
    const callsign = callsignField(deps);
    const go = stamp(t('versus.join.go'), 'rl-versus__join');
    const msg = messageLine('rl-versus__msg');
    let busy = false;
    go.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      go.disabled = true;
      msg.textContent = '';
      delete msg.dataset.tone;
      deps.open({ kind: 'join', code, callsign: callsignOrDefault(callsign.input.value) }, leaving.signal).then(
        (o) => {
          if (disposed) { o.transport.close(); return; }
          room = adopt(o, deps);
          lobby(room);
        },
        (err: unknown) => {
          if (disposed || startedElsewhere(err, deps)) return;
          busy = false;
          go.disabled = false;
          msg.dataset.tone = 'bad';
          msg.textContent = errorLine(err);
        },
      );
    });
    box.append(lead, callsign.el, go, msg);
    body.appendChild(box);
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

  stagger(body);
  stage.appendChild(wrap);
  focusOnMount.el?.focus({ preventScroll: true });
  if (announceOnMount !== null) announce(announceOnMount);
  return () => {
    disposed = true;
    leaving.abort();
    if (announceTimer !== null) clearTimeout(announceTimer);
    window.removeEventListener('keydown', onKey);
    leaveDialog?.close();
    if (room !== null) {
      room.repaint = null;
      room.chat?.dispose();
      room.chat = null;
      // Before the start this tab leaves the room (`bye`); an ended room only
      // needs its transport stopped. After the start the battlefield owns it.
      if (room.phase === 'lobby') leaveNow();
      else if (room.phase === 'ended') { room.phase = 'closed'; room.transport.close(); }
    }
    wrap.remove();
  };
}
