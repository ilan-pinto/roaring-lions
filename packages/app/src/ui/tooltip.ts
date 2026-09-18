// One tooltip component, shared by every screen that needs one.
//
// Before this, `production.ts` had its own private `bindTip` and everything
// else — the strip's Conduct figure, the order row, the chip row — used a
// bare `title=`. A native title is unstyled, arrives after a long hover
// delay, never shows for a touch player, and (Safari and Chrome both) is
// unreachable by keyboard: there is no `focus` event a browser fires a title
// off of. This module is what both call sites now share.
//
// Two supported shapes:
//
//   1. `bindTip(el, html)` — for a PERSISTENT element, bound once. `el`
//      itself carries the `mouseenter`/`focus`/`mouseleave`/`blur`
//      listeners; the returned disposer removes them and hides the tip if
//      it currently owns it. Used for the reinforcements dock's tiles and
//      the HUD's five order buttons — all built once and only repainted, so
//      binding directly to the element is correct and simplest.
//
//   2. Delegated: `bindDelegatedTip(container, resolve)` — for a container
//      whose children are torn down and rebuilt (the HUD's strip fields at
//      4 Hz, its chip row at 4 Hz). Bind ONCE on the container, which
//      survives every rebuild, rather than once per child, which would not.
//      A descendant opts in with a `data-tip="<key>"` attribute; `resolve`
//      receives whichever such descendant is under the pointer or has
//      focus and returns the tip's html, or `null` for "no tip here". One
//      `mouseover`/`focusin` pair (and their `mouseout`/`focusout`
//      partners) does the delegation — `mouseenter`/`mouseleave` do not
//      bubble and cannot be delegated this way. Returns `{ dispose, refresh
//      }` rather than a bare disposer: the container's own rebuild replaces
//      the element the tip is currently anchored to with a NEW node (same
//      `data-tip`, different identity) and fires no event of its own, so a
//      shown tip would otherwise freeze on stale content until the pointer
//      physically leaves and re-enters. The caller runs `refresh()` after
//      every repaint of `container`'s tipped descendants; it is a no-op
//      unless THIS binding's tip is currently shown, and it re-resolves onto
//      the replacement carrying the same `data-tip` value if one exists, or
//      hides if none does.
//
// Both shapes share one tip element per HOST (lazily created, `opts.host`,
// default `document.body`) rather than one per bound element — "one
// tooltip", not one per trigger — and share the app-wide Escape handling:
// a single `window` `keydown` listener, attached the moment any tip is
// shown and removed the moment none is, never one per bound element.
// Multiple bindings on the SAME host correctly hand the one tip element
// back and forth: each binding only hides it if it is the one that most
// recently showed it, so a stale `mouseleave` from an element that lost the
// tip to a later focus cannot blank out what the later one is showing.
import type { Disposer } from '../shell/router';

export interface BindTipOptions {
  /**
   * Where the tip element lives. Default `document.body` — fine for a
   * caller with nothing of its own to hang it on. Pass a host the caller
   * OWNS and tears down itself (`production.ts` passes its dock's own root)
   * so the tip goes with it rather than sitting on `document.body` forever;
   * `position: fixed` means the host's place in the tree has no bearing on
   * where the tip is drawn, only on who is responsible for removing it.
   */
  host?: HTMLElement;
}

/** Clearance from the trigger, and from the viewport edge, in CSS pixels —
 *  the one place in this file `rem` cannot reach, since both numbers are
 *  arithmetic against `getBoundingClientRect()`, which only speaks px. */
const TIP_GAP_PX = 8;
const TIP_EDGE_MARGIN_PX = 8;

interface TipState {
  readonly el: HTMLDivElement;
  /** Whichever bound element most recently showed this tip, or `null` while
   *  it is hidden. The one guard that makes sharing one element safe: a
   *  `hide` call only acts if it is still the current owner asking. */
  owner: HTMLElement | null;
}

const tipsByHost = new WeakMap<HTMLElement, TipState>();
let tipSeq = 0;

function ensureTip(host: HTMLElement): TipState {
  const existing = tipsByHost.get(host);
  if (existing) return existing;
  const el = document.createElement('div');
  el.className = 'rl-tip';
  // The first tip this session ever creates keeps the plain, predictable
  // id; a second host (the dock, alongside the HUD's) gets a distinct one so
  // two simultaneously-mounted tips never collide.
  el.id = tipSeq === 0 ? 'rl-tip' : `rl-tip-${tipSeq}`;
  tipSeq++;
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  host.appendChild(el);
  const state: TipState = { el, owner: null };
  tipsByHost.set(host, state);
  return state;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Above the trigger by default, flipped below when there is no room above,
 * both clamped so the tip never leaves the viewport — a fixed-position
 * element ignores every ancestor's clipping and offset, so this is the one
 * place that has to keep it on screen.
 *
 * The strip sits at `top: 0`, so every strip tooltip (Conduct first) has no
 * room above it at all: `rect.top - h - gap` is negative there, and the old
 * unconditional "above" placement put the tip over its own trigger row
 * rather than beside it. `.rl-tip--below` is toggled alongside the flip so a
 * later arrow/border can point the other way; it changes nothing on its own
 * today.
 */
function positionTip(tip: HTMLDivElement, el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const th = tip.offsetHeight;
  const tw = tip.offsetWidth;
  const above = rect.top - th - TIP_GAP_PX;
  const below = above < TIP_EDGE_MARGIN_PX;
  const rawTop = below ? rect.bottom + TIP_GAP_PX : above;
  const left = clamp(rect.left, TIP_EDGE_MARGIN_PX, Math.max(TIP_EDGE_MARGIN_PX, vw - tw - TIP_EDGE_MARGIN_PX));
  const top = clamp(rawTop, TIP_EDGE_MARGIN_PX, Math.max(TIP_EDGE_MARGIN_PX, vh - th - TIP_EDGE_MARGIN_PX));
  tip.style.setProperty('--tip-x', `${left}px`);
  tip.style.setProperty('--tip-y', `${top}px`);
  tip.classList.toggle('rl-tip--below', below);
}

// --- Escape, one listener for the whole app -------------------------------

/** Every tip currently shown, across every host — almost always zero or one,
 *  but never assumed to be: a mouse resting on one control while Tab moves
 *  focus to another can legitimately show two at once. */
const shownStates = new Set<TipState>();
let escBound = false;

function onEscapeKey(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  for (const state of [...shownStates]) {
    if (state.owner) hideState(state, state.owner);
  }
}

function ensureEscapeListener(): void {
  if (escBound) return;
  window.addEventListener('keydown', onEscapeKey);
  escBound = true;
}

function releaseEscapeListenerIfIdle(): void {
  if (escBound && shownStates.size === 0) {
    window.removeEventListener('keydown', onEscapeKey);
    escBound = false;
  }
}

// --- shared show/hide, under both bindTip and bindDelegatedTip -----------

function showState(state: TipState, el: HTMLElement, html: () => string): void {
  // Fresh every time: a live number (logistics, a chip's health) shown once
  // and never again would be a tooltip that lies the second time it opens.
  state.el.innerHTML = html();
  state.el.hidden = false;
  positionTip(state.el, el);
  state.owner = el;
  el.setAttribute('aria-describedby', state.el.id);
  shownStates.add(state);
  ensureEscapeListener();
}

function hideState(state: TipState, el: HTMLElement): void {
  // Not ours to close: a later `show` on the same host has already handed
  // the one tip element to a different owner.
  if (state.owner !== el) return;
  state.el.hidden = true;
  el.removeAttribute('aria-describedby');
  state.owner = null;
  shownStates.delete(state);
  releaseEscapeListenerIfIdle();
}

/**
 * Bind a tooltip to one persistent element. `html` is called fresh on every
 * show, never cached, so a live number stays live. Returns a disposer that
 * removes every listener this call added and, if this element's tip is the
 * one currently showing, hides it.
 */
export function bindTip(el: HTMLElement, html: () => string, opts: BindTipOptions = {}): Disposer {
  const state = ensureTip(opts.host ?? document.body);
  const show = (): void => showState(state, el, html);
  const hide = (): void => hideState(state, el);
  el.addEventListener('mouseenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('blur', hide);
  return () => {
    el.removeEventListener('mouseenter', show);
    el.removeEventListener('focus', show);
    el.removeEventListener('mouseleave', hide);
    el.removeEventListener('blur', hide);
    hide();
  };
}

/** Returned by `bindDelegatedTip` — see that function's own header for why
 *  this is not a bare `Disposer` the way `bindTip`'s return is. */
export interface DelegatedTip {
  /** Removes every listener this call added and, if this binding's tip is
   *  the one currently showing, hides it. */
  dispose: Disposer;
  /**
   * Re-anchors a currently-shown tip onto its replacement after the
   * container's tipped descendants were rebuilt, or hides it if no
   * replacement carries the same `data-tip` value. A no-op when this
   * binding has no tip currently shown, or when the shown tip's element is
   * still connected (nothing to refresh). Call once after every repaint of
   * `container`'s tipped descendants.
   */
  refresh: () => void;
}

/**
 * Bind a tooltip to a CONTAINER whose tipped descendants are torn down and
 * rebuilt (an innerHTML repaint), rather than to those descendants
 * themselves, which would lose the binding on the very next rebuild. A
 * descendant marks itself with `data-tip` (any value; `resolve` reads
 * whatever else the caller stamped beside it — a type id, a key — off the
 * matched element); `resolve` returns that element's tip html, or `null` to
 * show nothing for it.
 */
export function bindDelegatedTip(
  container: HTMLElement,
  resolve: (target: HTMLElement) => string | null,
  opts: BindTipOptions = {}
): DelegatedTip {
  const state = ensureTip(opts.host ?? document.body);
  let current: HTMLElement | null = null;

  const targetOf = (ev: Event): HTMLElement | null => {
    const start = ev.target as HTMLElement | null;
    const found = start?.closest<HTMLElement>('[data-tip]') ?? null;
    return found && container.contains(found) ? found : null;
  };

  const onOver = (ev: Event): void => {
    const target = targetOf(ev);
    if (!target || target === current) return;
    const html = resolve(target);
    if (html === null) return;
    current = target;
    showState(state, target, () => html);
  };
  const onOut = (ev: Event): void => {
    if (!current) return;
    const related = (ev as MouseEvent | FocusEvent).relatedTarget;
    // Moving to a child of the same tipped element is not a leave.
    if (related instanceof Node && current.contains(related)) return;
    const closing = current;
    current = null;
    hideState(state, closing);
  };

  container.addEventListener('mouseover', onOver);
  container.addEventListener('focusin', onOver);
  container.addEventListener('mouseout', onOut);
  container.addEventListener('focusout', onOut);

  const refresh = (): void => {
    // Nothing shown, or the shared tip belongs to a different binding now
    // (a later focus elsewhere took it) -- not ours to touch either way.
    if (current === null || state.owner !== current) return;
    // Still the same node, still in the document: this call is not
    // following a rebuild that touched it, so its content is not stale.
    if (container.contains(current)) return;
    const stale = current;
    const key = stale.dataset.tip;
    const replacement =
      key !== undefined ? container.querySelector<HTMLElement>(`[data-tip="${CSS.escape(key)}"]`) : null;
    if (!replacement) {
      current = null;
      hideState(state, stale);
      return;
    }
    const html = resolve(replacement);
    if (html === null) {
      current = null;
      hideState(state, stale);
      return;
    }
    // The stale node is detached and never queried again, but it should not
    // go on claiming to describe a tip it no longer owns.
    stale.removeAttribute('aria-describedby');
    current = replacement;
    showState(state, replacement, () => html);
  };

  const dispose = (): void => {
    container.removeEventListener('mouseover', onOver);
    container.removeEventListener('focusin', onOver);
    container.removeEventListener('mouseout', onOut);
    container.removeEventListener('focusout', onOut);
    if (current) hideState(state, current);
    current = null;
  };

  return { dispose, refresh };
}

/**
 * Hide whatever tip(s) are currently shown, across every host. For a
 * teardown that happens mid-hover — a screen unmounting, a mission ending
 * while the pointer sits on a tile — so the Escape listener and the tip's
 * `aria-describedby` do not outlive the element that opened them. Disposers
 * already do this for their own binding; this is for the case where no
 * disposer runs at all (the router clearing the stage out from under an
 * open tip that belongs to a screen with no destroy hook of its own).
 */
export function closeTip(): void {
  for (const state of [...shownStates]) {
    if (state.owner) hideState(state, state.owner);
  }
}
