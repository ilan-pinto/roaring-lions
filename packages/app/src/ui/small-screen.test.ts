// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDialogOpen } from './confirm';
import { SMALL_SCREEN_DISMISSED_KEY, SMALL_SCREEN_QUERY, watchSmallScreen } from './small-screen';

// A controllable matchMedia: `setMatches` flips the answer and fires `change`
// to whoever is listening, exactly as a rotation does.
function fakeMedia(initial: boolean): { setMatches: (v: boolean) => void; listeners: () => number; asked: () => string[] } {
  let matches = initial;
  const ls = new Set<() => void>();
  const asked: string[] = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => {
      asked.push(q);
      return {
        get matches() {
          return matches;
        },
        media: q,
        addEventListener: (_: string, fn: () => void) => ls.add(fn),
        removeEventListener: (_: string, fn: () => void) => ls.delete(fn),
      };
    },
  });
  return {
    setMatches: (v) => {
      matches = v;
      for (const fn of [...ls]) fn();
    },
    listeners: () => ls.size,
    asked: () => asked,
  };
}

// jsdom here may carry a bare `{}` for storage (see CLAUDE.md), so install the
// shape these specs need.
function installSessionStorage(): Map<string, string> {
  const m = new Map<string, string>();
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    },
  });
  return m;
}

const card = (): HTMLElement | null => document.querySelector('.rl-small-screen');
const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.rl-small-screen button')];
const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

let store: Map<string, string>;
let navigate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  store = installSessionStorage();
  navigate = vi.fn();
});
afterEach(() => {
  document.body.replaceChildren();
});

const deps = () => ({ navigate: (h: string) => navigate(h), menuHref: '/' });

describe('watchSmallScreen: when it shows', () => {
  it('asks narrow-and-portrait, nothing else', () => {
    const m = fakeMedia(true);
    watchSmallScreen(deps())();
    expect(m.asked()).toEqual([SMALL_SCREEN_QUERY]);
    expect(SMALL_SCREEN_QUERY).toBe('(max-width: 767.98px) and (orientation: portrait)');
  });

  it('shows on a narrow portrait viewport, as a modal dialog with focus on the first button', () => {
    fakeMedia(true);
    const stop = watchSmallScreen(deps());
    const c = card();
    expect(c).not.toBeNull();
    expect(c?.getAttribute('role')).toBe('dialog');
    expect(c?.getAttribute('aria-modal')).toBe('true');
    expect(c?.querySelector('h2')?.textContent).toBe('Best on a larger screen');
    expect(buttons().map((b) => b.textContent)).toEqual(['Carry on anyway', 'Main menu']);
    expect(document.activeElement).toBe(buttons()[0]);
    expect(isDialogOpen()).toBe(true);
    stop();
  });

  it('mounts nothing and listens for no key on a desktop or landscape viewport', () => {
    fakeMedia(false);
    const spy = vi.spyOn(window, 'addEventListener');
    const before = document.body.childElementCount;
    const stop = watchSmallScreen(deps());
    expect(card()).toBeNull();
    expect(document.body.childElementCount).toBe(before);
    expect(spy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
    stop();
    spy.mockRestore();
  });

  it('follows a rotation: lands in landscape and goes, comes back upright and returns', () => {
    const m = fakeMedia(true);
    const stop = watchSmallScreen(deps());
    expect(card()).not.toBeNull();
    m.setMatches(false);
    expect(card()).toBeNull();
    // Rotating away is not an answer.
    expect(store.has(SMALL_SCREEN_DISMISSED_KEY)).toBe(false);
    m.setMatches(true);
    expect(card()).not.toBeNull();
    stop();
  });
});

describe('watchSmallScreen: dismissal', () => {
  it('"Carry on anyway" removes the card, remembers it for the session, and rotating back does not re-show it', () => {
    const m = fakeMedia(true);
    const stop = watchSmallScreen(deps());
    buttons()[0]?.click();
    expect(card()).toBeNull();
    expect(store.get(SMALL_SCREEN_DISMISSED_KEY)).toBe('1');
    m.setMatches(false);
    m.setMatches(true);
    expect(card()).toBeNull();
    stop();
  });

  it('a page loaded after dismissal in the same session never shows it', () => {
    store.set(SMALL_SCREEN_DISMISSED_KEY, '1');
    fakeMedia(true);
    const stop = watchSmallScreen(deps());
    expect(card()).toBeNull();
    stop();
  });

  it('still holds for the page when the browser refuses session storage', () => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    const m = fakeMedia(true);
    const stop = watchSmallScreen(deps());
    expect(card()).not.toBeNull();
    buttons()[0]?.click();
    m.setMatches(false);
    m.setMatches(true);
    expect(card()).toBeNull();
    stop();
  });

  it('Escape is "Carry on anyway", and the game never hears it', () => {
    fakeMedia(true);
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    const stop = watchSmallScreen(deps());
    window.dispatchEvent(key('Escape'));
    expect(card()).toBeNull();
    expect(store.get(SMALL_SCREEN_DISMISSED_KEY)).toBe('1');
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener('keydown', seen);
    stop();
  });

  it('while it is open, focus that lands outside the card is pulled back to the first button', () => {
    fakeMedia(true);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const stop = watchSmallScreen(deps());
    outside.focus();
    expect(document.activeElement).toBe(buttons()[0]);
    buttons()[0]?.click();
    outside.focus();
    expect(document.activeElement).toBe(outside);
    stop();
  });

  it('while it is open, a game key is swallowed and Enter/Tab are left alone', () => {
    fakeMedia(true);
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    const stop = watchSmallScreen(deps());
    window.dispatchEvent(key('h'));
    expect(seen).not.toHaveBeenCalled();
    window.dispatchEvent(key('Enter'));
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', seen);
    stop();
  });

  it('"Main menu" navigates softly to the menu and counts as an answer', () => {
    fakeMedia(true);
    const stop = watchSmallScreen({ navigate: (h) => navigate(h), menuHref: '/base/' });
    buttons()[1]?.click();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/base/');
    expect(card()).toBeNull();
    expect(store.get(SMALL_SCREEN_DISMISSED_KEY)).toBe('1');
    stop();
  });
});

describe('watchSmallScreen: the disposer', () => {
  it('removes the card, the media listener and the key guard, and is idempotent', () => {
    const m = fakeMedia(true);
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    const stop = watchSmallScreen(deps());
    expect(m.listeners()).toBe(1);
    stop();
    stop();
    expect(card()).toBeNull();
    expect(m.listeners()).toBe(0);
    // A key no longer meets a capture guard.
    window.dispatchEvent(key('h'));
    expect(seen).toHaveBeenCalledTimes(1);
    // And a later rotation does nothing.
    m.setMatches(false);
    m.setMatches(true);
    expect(card()).toBeNull();
    window.removeEventListener('keydown', seen);
  });

  it('leaves no keydown or focus listener behind after a dismissal either', () => {
    fakeMedia(true);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const dAdd = vi.spyOn(document, 'addEventListener');
    const dRemove = vi.spyOn(document, 'removeEventListener');
    const stop = watchSmallScreen(deps());
    buttons()[0]?.click();
    const added = add.mock.calls.filter(([t]) => t === 'keydown').length;
    const removed = remove.mock.calls.filter(([t]) => t === 'keydown').length;
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
    // The focus guard sits on the document, and goes with the card.
    const focusAdded = dAdd.mock.calls.filter(([t]) => t === 'focusin').length;
    const focusRemoved = dRemove.mock.calls.filter(([t]) => t === 'focusin').length;
    expect(focusAdded).toBeGreaterThan(0);
    expect(focusRemoved).toBe(focusAdded);
    dAdd.mockRestore();
    dRemove.mockRestore();
    stop();
    add.mockRestore();
    remove.mockRestore();
  });
});
