// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDialogOpen } from './confirm';
import { PHONE_QUERY, SMALL_SCREEN_DISMISSED_KEY, watchSmallScreen } from './small-screen';

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
  it('asks the one phone query, nothing else', () => {
    const m = fakeMedia(true);
    watchSmallScreen(deps())();
    expect(m.asked()).toEqual([PHONE_QUERY]);
  });

  it('shows on a phone, as a modal dialog with focus on the first button', () => {
    fakeMedia(true);
    const stop = watchSmallScreen(deps());
    const c = card();
    expect(c).not.toBeNull();
    expect(c?.getAttribute('role')).toBe('dialog');
    expect(c?.getAttribute('aria-modal')).toBe('true');
    expect(c?.querySelector('h2')?.textContent).toBe('Play on a computer or large screen');
    expect(buttons().map((b) => b.textContent)).toEqual(['Carry on anyway', 'Main menu']);
    expect(document.activeElement).toBe(buttons()[0]);
    expect(isDialogOpen()).toBe(true);
    stop();
  });

  it('mounts nothing and listens for no key on a desktop', () => {
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

  it('says the same thing to a computer or large screen, and never tells the player to rotate', () => {
    fakeMedia(true);
    const stop = watchSmallScreen(deps());
    const text = card()?.textContent ?? '';
    expect(text).toMatch(/computer/i);
    expect(text).toMatch(/large screen/i);
    expect(text).not.toMatch(/rotat|upright|sideways|landscape|portrait/i);
    stop();
  });

  it('a match that goes away takes the card with it and is not an answer', () => {
    // E.g. a phone-sized browser given a mouse: the query stops matching.
    const m = fakeMedia(true);
    const stop = watchSmallScreen(deps());
    expect(card()).not.toBeNull();
    m.setMatches(false);
    expect(card()).toBeNull();
    expect(store.has(SMALL_SCREEN_DISMISSED_KEY)).toBe(false);
    m.setMatches(true);
    expect(card()).not.toBeNull();
    stop();
  });
});

// --- the rule itself, evaluated against device profiles ---------------------
// A tiny Media Queries evaluator (and / or / not / parentheses, plus the
// features the phone query uses), so the boundaries are tested on the REAL
// query string rather than on a fake that answers true or false by decree.
interface Device {
  pointer: 'fine' | 'coarse' | 'none';
  anyPointerFine: boolean;
  /** screen.width x screen.height in CSS px (the physical screen, not the window). */
  screen: [number, number];
}
function evalMedia(query: string, d: Device): boolean {
  const toks = query.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const feature = (text: string): boolean => {
    const [name, raw] = text.split(':').map((x) => x.trim());
    const num = parseFloat(raw ?? '');
    switch (name) {
      case 'pointer':
        return d.pointer === raw;
      case 'any-pointer':
        return raw === 'fine' ? d.anyPointerFine : false;
      case 'max-device-width':
        return d.screen[0] <= num;
      case 'max-device-height':
        return d.screen[1] <= num;
      default:
        throw new Error(`evaluator does not know the feature "${name}"`);
    }
  };
  const term = (): boolean => {
    if (toks[i] === 'not') {
      i++;
      return !term();
    }
    if (toks[i] !== '(') throw new Error(`expected "(" at ${toks[i]}`);
    i++;
    let v: boolean;
    if (toks[i] === '(' || toks[i] === 'not') v = or();
    else {
      let text = '';
      while (toks[i] !== ')') text += toks[i++];
      v = feature(text);
    }
    if (toks[i++] !== ')') throw new Error('expected ")"');
    return v;
  };
  const and = (): boolean => {
    let v = term();
    while (toks[i] === 'and') {
      i++;
      v = term() && v;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (toks[i] === 'or') {
      i++;
      v = and() || v;
    }
    return v;
  };
  const r = or();
  if (i !== toks.length) throw new Error(`trailing tokens from ${toks[i]}`);
  return r;
}
const touch = (w: number, h: number): Device => ({ pointer: 'coarse', anyPointerFine: false, screen: [w, h] });

describe('the phone rule: PHONE_QUERY against devices', () => {
  it.each([
    ['phone portrait 390x844', touch(390, 844), true],
    ['phone landscape 844x390', touch(844, 390), true],
    ['small phone 360x640', touch(360, 640), true],
    ['large phone landscape 932x430', touch(932, 430), true],
        ['short side 599 is a phone', touch(599, 1000), true],
    ['short side 600 is not', touch(600, 960), false],
    ['tablet 768x1024 portrait', touch(768, 1024), false],
    ['tablet 1024x768 landscape', touch(1024, 768), false],
    ['small tablet 810x1080', touch(810, 1080), false],
    ['desktop, small window, mouse (screen is 1920x1080)', { pointer: 'fine', anyPointerFine: true, screen: [1920, 1080] }, false],
    ['a phone-sized screen with a mouse attached', { pointer: 'fine', anyPointerFine: true, screen: [390, 844] }, false],
    ['a phone whose primary pointer is touch but a mouse is paired', { pointer: 'coarse', anyPointerFine: true, screen: [390, 844] }, false],
    ['a touchscreen laptop (touch primary, trackpad present)', { pointer: 'coarse', anyPointerFine: true, screen: [1440, 900] }, false],
    ['headless / no pointer at all', { pointer: 'none', anyPointerFine: false, screen: [390, 844] }, false],
  ] as Array<[string, Device, boolean]>)('%s -> %s', (_name, device, expected) => {
    expect(evalMedia(PHONE_QUERY, device)).toBe(expected);
  });

  it('the evaluator itself can say no and yes (it is not a constant)', () => {
    expect(evalMedia('(pointer: coarse)', touch(1, 1))).toBe(true);
    expect(evalMedia('(not (pointer: coarse))', touch(1, 1))).toBe(false);
    expect(evalMedia('(max-device-width: 100px) or (max-device-height: 100px)', touch(500, 90))).toBe(true);
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
