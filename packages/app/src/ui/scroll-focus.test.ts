// packages/app/src/ui/scroll-focus.test.ts
// @vitest-environment jsdom
//
// GH-1408 (KS-14): the report's scrolling body is a tab stop only while it overflows. jsdom has no layout, so the two sizes are
// stubbed per element and `ResizeObserver` is a fake the test fires by hand; the geometry half is measured in a browser by
// `tools/src/ui-review/end-panel-check.ts`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scrollerFocusable } from './scroll-focus';

class FakeObserver {
  static live: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly cb: () => void) {
    FakeObserver.live.push(this);
  }
  observe(e: Element): void {
    this.observed.push(e);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

function box(scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div');
  el.append(document.createElement('p'), document.createElement('p'));
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => sizes.scroll });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => sizes.client });
  sizes.scroll = scrollHeight;
  sizes.client = clientHeight;
  document.body.append(el);
  return el;
}
const sizes = { scroll: 0, client: 0 };

beforeEach(() => {
  FakeObserver.live = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeObserver;
});
afterEach(() => {
  document.body.replaceChildren();
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

describe('scrollerFocusable', () => {
  it('an overflowing body gets a tab stop, a region role and its name', () => {
    const el = box(900, 400);
    scrollerFocusable(el, 'After-action report');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('After-action report');
  });

  it('a body that fits gets none of the three: a report that fits has no extra tab stop', () => {
    const el = box(400, 400);
    scrollerFocusable(el, 'After-action report');
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
  });

  it('a sub-pixel overflow (1 px) is not an overflow, 2 px is', () => {
    const el = box(401, 400);
    scrollerFocusable(el, 'x');
    expect(el.hasAttribute('tabindex')).toBe(false);
    sizes.scroll = 402;
    FakeObserver.live[0]?.cb();
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('follows a resize both ways: the window grows and the stop goes, shrinks and it returns', () => {
    const el = box(900, 400);
    scrollerFocusable(el, 'x');
    expect(el.getAttribute('tabindex')).toBe('0');
    sizes.client = 900;
    FakeObserver.live[0]?.cb();
    expect(el.hasAttribute('tabindex')).toBe(false);
    sizes.client = 300;
    FakeObserver.live[0]?.cb();
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('watches the element and each child, so growing content is seen too', () => {
    const el = box(900, 400);
    scrollerFocusable(el, 'x');
    expect(FakeObserver.live[0]?.observed).toEqual([el, ...Array.from(el.children)]);
  });

  it('the disposer disconnects, takes the attributes off, is idempotent, and a late callback does nothing', () => {
    const el = box(900, 400);
    const off = scrollerFocusable(el, 'x');
    off();
    off();
    expect(FakeObserver.live[0]?.disconnected).toBe(true);
    expect(el.hasAttribute('tabindex')).toBe(false);
    FakeObserver.live[0]?.cb();
    expect(el.hasAttribute('tabindex')).toBe(false);
  });

  it('without ResizeObserver it reads once and does not throw', () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    const el = box(900, 400);
    expect(() => scrollerFocusable(el, 'x')()).not.toThrow();
  });
});
