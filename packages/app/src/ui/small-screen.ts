// The small-screen notice (polish pass K, K-17).
//
// Held upright, a phone cannot fit the command strip or the feed. Measured at
// 390x844: the menu is 407 px wide and a mission 821 px, and `html`/`body`
// already compute `overflow-x: hidden` on every route, so the content is not
// scrolled but CLIPPED -- the strip runs off the right edge and nothing says
// the game wants a mouse and a wider screen. This card says so, once.
//
// WHEN. `SMALL_SCREEN_QUERY`: viewport narrower than 768 CSS px AND portrait
// (height greater than width). Portrait is what makes it a notice rather than
// a nag: the same phone turned sideways is 640-930 wide, the cure the card
// names is to rotate, and a media query reports the rotation with no polling.
// A desktop window dragged narrow is usually landscape, so it does not see the
// card either. 768 is the usual phone/tablet line and the card's own copy says
// "a phone". Measured with the card out of the way, a mission is 821 px wide
// at every width below that (menu 407 at 390, 600 at 600, 768 at 768), so a
// tablet held upright at 768 loses about 53 px of the strip to the same clip
// and is NOT flagged: a real narrow layout for the strip is pass I's, and
// widening this to 821 would have the notice fitted to a layout that is
// expected to change. A 768-820 px portrait tablet is the known gap.
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
// `sessionStorage`, with an in-memory copy for a browser that refuses it, so
// rotating to landscape and back never re-shows it. "Main menu" is a soft
// navigation and counts as an answer too: left standing, the card would sit
// over the menu it was asked to open. Rotating to landscape removes the card
// on its own and does NOT dismiss it -- turning the phone back upright without
// having answered shows it again.
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { focusTrap } from './focus-trap';

/** Narrow AND portrait. See the file header for why 768. */
export const SMALL_SCREEN_QUERY = '(max-width: 767.98px) and (orientation: portrait)';
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
 * Watch the viewport and show the notice while it is narrow portrait and has
 * not been answered. Returns the disposer: it takes the media listener, the
 * key guard, the focus trap and the card away, and is safe to call twice.
 */
export function watchSmallScreen(deps: SmallScreenDeps): Disposer {
  const win = deps.win ?? window;
  const doc = win.document;
  // jsdom and very old browsers have no matchMedia: nothing to watch.
  if (typeof win.matchMedia !== 'function') return () => {};
  const mq = win.matchMedia(SMALL_SCREEN_QUERY);

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
