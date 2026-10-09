// The phone notice (polish pass K, K-17; widened to any phone and either
// orientation by GH-502).
//
// Roaring Lions is a mouse-and-wide-screen game. A phone cannot fit the command
// strip or the feed (measured at 390x844: the menu is 407 px wide and a mission
// 821 px, clipped, not scrolled), has no right-click or edge pan, and turned
// sideways is only ~390 px tall. So the card appears on ANY phone, in either
// orientation, and routes the player to a computer or a large screen. It does
// not tell them to rotate: that was the first version's cure, and it is no cure.
//
// WHEN. `PHONE_QUERY` is "a touch-first device with a small physical screen":
//   (pointer: coarse)               the PRIMARY pointer is a finger, and
//   (not (any-pointer: fine))       no mouse, trackpad or pen is attached, and
//   min(screen.width, screen.height) < 600 CSS px
// The last clause is written as `(max-device-width: 599.98px) or
// (max-device-height: 599.98px)` because a media query has no `min()` and the
// OR is the same thing: it is true when EITHER side of the screen is short, so
// it needs no orientation and no polling. (`device-width` is the physical
// screen, not the window, and is deprecated only as a layout tool; every engine
// still answers it. iOS Safari reports the screen upright even when the phone is
// turned, which is exactly why the rule must not read one named side.)
//
// WHY 600. Every phone's short side is 320-440 CSS px, and the largest
// foldables unfolded and small tablets start at 600-810. 768 is the tablet
// line the first version used; 600 spares a 768x1024 tablet (and a 600x960 one)
// while a phone in landscape (844x390, 932x430) is still far below it.
//
// WHAT IT SPARES. A desktop browser window dragged small is NOT a phone: its
// pointer is fine, so it gets nothing, whatever the window width (and a tester
// shrinking a window to look at the layout is not nagged). A touchscreen laptop
// and a phone with a mouse paired both report a fine pointer somewhere
// (`any-pointer: fine`) and are spared too; a tablet's screen is over 600. The
// same query can never match in the test and CI browsers: headless Chromium
// reports a fine pointer.
//
// WHERE. App-wide, wired ONCE from `main.ts` beside `interceptLinks`, because
// the card must follow the player across every route and a route's disposer
// cannot own something that outlives the route. It therefore carries its own
// teardown (the disposer contract in CLAUDE.md): the one `change` listener on
// the media query, the one capture-phase `keydown` listener and the focus trap
// exist only while the card is on screen, and `watchSmallScreen`'s disposer
// removes all of it. On a wide screen nothing is mounted and nothing is
// listening for keys, so `ui:routes`' body-child count is undisturbed.
//
// DISMISSAL. "Carry on anyway" (and Escape) is remembered for the session in
// `sessionStorage`, with an in-memory copy for a browser that refuses it, so a
// phone that has answered is never asked again until the tab is closed (a
// tester can still look). "Main menu" is a soft navigation and counts as an
// answer too: left standing, the card would sit over the menu it was asked to
// open. The query ceasing to match (a mouse attached to a phone-sized screen)
// removes the card on its own and does NOT dismiss it.
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { focusTrap } from './focus-trap';

/** A phone: touch-first, no fine pointer, a screen side under 600. See the
 *  file header for each clause. */
export const PHONE_QUERY =
  '(pointer: coarse) and (not (any-pointer: fine)) and ((max-device-width: 599.98px) or (max-device-height: 599.98px))';
/** `sessionStorage` key: present once the player has answered the card. */
export const SMALL_SCREEN_DISMISSED_KEY = 'lions.smallScreen.dismissed';

export interface SmallScreenDeps {
  /** A SOFT navigation (`router.navigate`) -- never a page load. */
  navigate: (href: string) => void;
  /** Where "Main menu" goes (`routes.menu()`). */
  menuHref: string;
  win?: Window;
}

function storedDismissed(win: Window): boolean {
  try {
    return win.sessionStorage.getItem(SMALL_SCREEN_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeDismissed(win: Window): void {
  try {
    win.sessionStorage.setItem(SMALL_SCREEN_DISMISSED_KEY, '1');
  } catch {
    // Private mode or blocked site data: the in-memory flag in the closure
    // still holds for the life of this page.
  }
}

/** The card itself: the boot-failure card's own classes inside its scrim (the
 *  approved mock was composed from exactly these), as a modal dialog. */
function buildCard(doc: Document): { scrim: HTMLElement; keep: HTMLButtonElement; menu: HTMLButtonElement; card: HTMLElement } {
  const scrim = doc.createElement('div');
  scrim.className = 'rl-boot-scrim rl-small-screen';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  scrim.setAttribute('aria-labelledby', 'rl-small-screen-title');
  scrim.setAttribute('aria-describedby', 'rl-small-screen-body');

  const card = doc.createElement('div');
  card.className = 'rl-boot-error';

  const h = doc.createElement('h2');
  h.id = 'rl-small-screen-title';
  h.className = 'rl-boot-error__title';
  h.textContent = t('smallScreen.title');
  card.appendChild(h);

  const p = doc.createElement('p');
  p.id = 'rl-small-screen-body';
  p.className = 'rl-boot-error__body';
  p.textContent = t('smallScreen.body');
  card.appendChild(p);

  const n = doc.createElement('p');
  n.className = 'rl-boot-error__next';
  n.textContent = t('smallScreen.next');
  card.appendChild(n);

  const row = doc.createElement('div');
  row.className = 'rl-boot-error__actions';
  const keep = doc.createElement('button');
  keep.type = 'button';
  keep.className = 'rl-btn rl-small-screen__keep';
  keep.textContent = t('smallScreen.keep');
  const menu = doc.createElement('button');
  menu.type = 'button';
  menu.className = 'rl-btn rl-small-screen__menu';
  menu.textContent = t('smallScreen.menu');
  row.append(keep, menu);
  card.appendChild(row);

  scrim.appendChild(card);
  return { scrim, keep, menu, card };
}

/**
 * Watch the device and show the notice while it is a phone and has not been
 * answered. Returns the disposer: it takes the media listener, the
 * key guard, the focus trap and the card away, and is safe to call twice.
 */
export function watchSmallScreen(deps: SmallScreenDeps): Disposer {
  const win = deps.win ?? window;
  const doc = win.document;
  // jsdom and very old browsers have no matchMedia: nothing to watch.
  if (typeof win.matchMedia !== 'function') return () => {};
  const mq = win.matchMedia(PHONE_QUERY);

  let dismissed = storedDismissed(win);
  let teardownCard: (() => void) | null = null;
  let disposed = false;

  const answer = (): void => {
    dismissed = true;
    storeDismissed(win);
    teardownCard?.();
  };

  const show = (): void => {
    if (teardownCard) return;
    const opener = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const { scrim, keep, menu, card } = buildCard(doc);
    const disposeTrap = focusTrap(card);
    // The card claims to be modal, so nothing outside it may answer the
    // keyboard: a bare Escape would open the pause menu under it and the game
    // verbs would fire behind it. Escape is the card's own "Carry on anyway";
    // Enter and Tab stay (Enter presses the focused button, Tab is the trap's).
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' || e.key === 'Enter') return;
      e.stopPropagation();
      if (e.key === 'Escape') answer();
    };
    // Modal means focus stays in the card too. The mission's briefing screen
    // focuses its own Deploy button once the art is ready, which would hand an
    // Enter press to the screen under the card; pull focus back instead.
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof Node && !scrim.contains(e.target)) keep.focus({ preventScroll: true });
    };
    keep.addEventListener('click', answer);
    menu.addEventListener('click', () => {
      answer();
      deps.navigate(deps.menuHref);
    });
    win.addEventListener('keydown', onKey, true);
    doc.addEventListener('focusin', onFocusIn);
    doc.body.appendChild(scrim);
    keep.focus();
    teardownCard = () => {
      teardownCard = null;
      win.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('focusin', onFocusIn);
      disposeTrap();
      const hadFocus = scrim.contains(doc.activeElement);
      scrim.remove();
      if (hadFocus) opener?.focus();
    };
  };

  const sync = (): void => {
    if (disposed) return;
    if (mq.matches && !dismissed) show();
    else teardownCard?.();
  };

  mq.addEventListener('change', sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    mq.removeEventListener('change', sync);
    teardownCard?.();
  };
}
