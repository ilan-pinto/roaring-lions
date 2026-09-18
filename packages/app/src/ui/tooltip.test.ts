// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDelegatedTip, bindTip, closeTip } from './tooltip';

afterEach(() => closeTip());
const tip = (): HTMLElement | null => document.querySelector('.rl-tip');

/** Stubs `el`'s `getBoundingClientRect` for `positionTip`'s own arithmetic --
 *  jsdom computes no real layout, so every real element reads all zeroes. */
function stubRect(el: HTMLElement, rect: { top: number; bottom: number; left: number }): void {
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.left + 100,
      width: 100,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Same idea for the TIP element's own size, which `positionTip` needs to
 *  place it above (or, fix round 1, below) the trigger. Returns the
 *  restorer, since the tip is one shared element reused by every test in
 *  this file. */
function stubSize(el: HTMLElement, width: number, height: number): () => void {
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  return () => {
    Reflect.deleteProperty(el, 'offsetWidth');
    Reflect.deleteProperty(el, 'offsetHeight');
  };
}

describe('bindTip', () => {
  it('shows on hover and on focus, and hides on both partners', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => '<b>Conduct</b>');
    expect(tip()?.hidden ?? true).toBe(true);
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.hidden).toBe(false);
    expect(tip()?.innerHTML).toBe('<b>Conduct</b>');
    el.dispatchEvent(new Event('mouseleave'));
    expect(tip()?.hidden).toBe(true);
    el.dispatchEvent(new Event('focus'));
    expect(tip()?.hidden).toBe(false);
    el.dispatchEvent(new Event('blur'));
    expect(tip()?.hidden).toBe(true);
    off();
  });

  it('calls the thunk on every show, so live numbers are live', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    let n = 0;
    const off = bindTip(el, () => `${++n}`);
    el.dispatchEvent(new Event('mouseenter'));
    el.dispatchEvent(new Event('mouseleave'));
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.innerHTML).toBe('2');
    off();
  });

  it('Escape closes it, because a tooltip a keyboard cannot dismiss is a trap', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip()?.hidden).toBe(true);
    off();
  });

  it('the disposer removes every listener and hides a tip it was showing', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('mouseenter'));
    off();
    expect(tip()?.hidden).toBe(true);
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.hidden).toBe(true);
  });

  it('describes its element for a screen reader while it is up, and stops after', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('focus'));
    expect(el.getAttribute('aria-describedby')).toBe(tip()?.id);
    el.dispatchEvent(new Event('blur'));
    expect(el.hasAttribute('aria-describedby')).toBe(false);
    off();
  });
});

// Fix round 1, I2: `positionTip` only ever placed the tip ABOVE the trigger,
// so the strip's own tooltips (`.rl-strip` sits at `top: 0`) landed over the
// row that opened them rather than beside it.
describe('positioning', () => {
  it('places the tip above the trigger when there is room', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    stubRect(el, { top: 300, bottom: 320, left: 50 });
    const off = bindTip(el, () => 'x');
    const t = tip()!;
    const restore = stubSize(t, 100, 40);
    el.dispatchEvent(new Event('mouseenter'));
    expect(t.classList.contains('rl-tip--below')).toBe(false);
    expect(t.style.getPropertyValue('--tip-y')).toBe('252px'); // 300 - 40 - 8
    restore();
    off();
  });

  // Falsified by hand: deleting the flip (always using the "above" formula)
  // turns this red -- `--tip-y` comes out negative instead of 28px, and
  // `rl-tip--below` is never added.
  it('flips below when there is no room above, the way the strip needs', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    stubRect(el, { top: 0, bottom: 20, left: 50 });
    const off = bindTip(el, () => 'x');
    const t = tip()!;
    const restore = stubSize(t, 100, 40);
    el.dispatchEvent(new Event('mouseenter'));
    expect(t.classList.contains('rl-tip--below')).toBe(true);
    expect(t.style.getPropertyValue('--tip-y')).toBe('28px'); // 20 + 8
    restore();
    off();
  });
});

describe('bindDelegatedTip', () => {
  it('refreshes a shown tip onto its replacement after a rebuild, or hides it when nothing replaces it', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let value = 'first';
    const node = document.createElement('span');
    node.dataset.tip = 'k';
    container.appendChild(node);
    const { dispose, refresh } = bindDelegatedTip(container, (target) =>
      target.dataset.tip === 'k' ? value : null
    );

    node.dispatchEvent(new Event('mouseover', { bubbles: true }));
    expect(tip()?.innerHTML).toBe('first');
    expect(node.getAttribute('aria-describedby')).toBe(tip()?.id);

    // The container's own 4 Hz rebuild: a brand-new node carrying the same
    // `data-tip`, and the value it resolves to has moved on -- with no
    // mouse event of its own for the delegated listener to notice by.
    value = 'second';
    const replacement = document.createElement('span');
    replacement.dataset.tip = 'k';
    container.replaceChildren(replacement);
    refresh();
    expect(tip()?.hidden).toBe(false);
    expect(tip()?.innerHTML).toBe('second');
    expect(replacement.getAttribute('aria-describedby')).toBe(tip()?.id);
    expect(node.hasAttribute('aria-describedby')).toBe(false);

    // A second rebuild drops the tipped node entirely (the count it named
    // went to zero, the field stopped applying) -- refresh hides, and
    // releases the app-wide Escape listener along with it.
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    container.replaceChildren(document.createElement('span'));
    refresh();
    expect(tip()?.hidden).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeSpy.mockRestore();

    dispose();
  });

  // Falsified by hand: making `refresh` a no-op turns the previous test red
  // at its first assertion after the rebuild ('second').
  it('does nothing when no tip is shown, or when the shown node was not touched', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const node = document.createElement('span');
    node.dataset.tip = 'k';
    container.appendChild(node);
    const { dispose, refresh } = bindDelegatedTip(container, () => 'x');

    expect(() => refresh()).not.toThrow();
    expect(tip()?.hidden ?? true).toBe(true);

    node.dispatchEvent(new Event('mouseover', { bubbles: true }));
    const before = tip()?.innerHTML;
    refresh(); // `node` is still connected: this rebuild never happened.
    expect(tip()?.innerHTML).toBe(before);
    expect(tip()?.hidden).toBe(false);

    dispose();
  });
});
