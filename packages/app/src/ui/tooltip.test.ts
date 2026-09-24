// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDelegatedTip, bindTip, closeTip, computeTipPosition } from './tooltip';

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

  // `bindTip`'s own `clear` option (GH-229), end to end: a row-2 tile inside
  // a taller dock grid must clear the GRID's top, not its own.
  it('clears the `clear` option element, not the bound element, when the two differ', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    stubRect(grid, { top: 557, bottom: 892, left: 8 });
    const el = document.createElement('button');
    grid.appendChild(el);
    stubRect(el, { top: 640, bottom: 700, left: 72 });
    const off = bindTip(el, () => 'x', { clear: grid });
    const t = tip()!;
    const restore = stubSize(t, 230, 108);
    el.dispatchEvent(new Event('mouseenter'));
    // Above the GRID's top (557), not the tile's own (640) -- 557-108-8=441.
    expect(t.style.getPropertyValue('--tip-y')).toBe('441px');
    // Still beside the TILE's own column, not the grid's.
    expect(t.style.getPropertyValue('--tip-x')).toBe('72px');
    restore();
    off();
  });
});

// GH-229: the dock's tip, opened on a row below the first, used to land on
// top of the row above it -- `positionTip` cleared only the hovered tile's
// own rect, and two dock rows sit closer together (~64-84px, one tile plus a
// gap) than a tip with a blurb is tall (~100-150px). `computeTipPosition` is
// the DOM-free half of the fix: a `clear` rect distinct from `trigger` lets a
// caller say "clear this taller stack", not just "clear yourself".
describe('computeTipPosition', () => {
  const viewport = { width: 1400, height: 900 };
  const tip = { width: 230, height: 108 };

  it('places the tip above the trigger, inside the viewport, when clear === trigger', () => {
    const trigger = { top: 300, bottom: 360, left: 50 };
    const p = computeTipPosition(trigger, trigger, tip, viewport);
    expect(p.below).toBe(false);
    expect(p.top).toBe(300 - 108 - 8); // TIP_GAP_PX
    expect(p.left).toBe(50);
    // Inside the viewport on every edge.
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top + tip.height).toBeLessThanOrEqual(viewport.height);
    expect(p.left + tip.width).toBeLessThanOrEqual(viewport.width);
  });

  it('follows the TRIGGER column, not the clear rect, for its left edge', () => {
    // The dock's whole grid starts at x=8; a tile three columns in sits at
    // x=136. The tip must anchor beside the TILE, not slide back to the
    // grid's own left edge -- that would stop reading as "this tile's tip".
    const trigger = { top: 640, bottom: 700, left: 136 };
    const clear = { top: 557, bottom: 892, left: 8 };
    const p = computeTipPosition(trigger, clear, tip, viewport);
    expect(p.left).toBe(136);
  });

  it('never overlaps the CLEAR rect, even when the trigger is a lower row inside it', () => {
    // Falsified by hand: passing `trigger` for `clear` here (the pre-fix
    // shape) instead gives top = 640 - 108 - 8 = 524, which is inside
    // [557, 892] -- i.e. on top of the grid the tile sits in. This is
    // `dock-row2-1400x900.png` from the GH-229 repro, numbers unchanged:
    // hovering `recon_drone` at row 2 (tile rect top 640) with the whole
    // dock's own rect (top 557, bottom 892) as `clear`.
    const trigger = { top: 640, bottom: 700, left: 72 };
    const clear = { top: 557, bottom: 892, left: 8 };
    const p = computeTipPosition(trigger, clear, tip, viewport);
    expect(p.below).toBe(false);
    const tipBottom = p.top + tip.height;
    expect(tipBottom).toBeLessThanOrEqual(clear.top - 8); // TIP_GAP_PX clearance
    expect(tipBottom).toBeLessThanOrEqual(clear.top); // never overlaps
  });

  it('flips below, and stays inside the viewport, when the clear rect leaves no room above', () => {
    const trigger = { top: 20, bottom: 40, left: 50 };
    const clear = { top: 0, bottom: 40, left: 50 };
    const p = computeTipPosition(trigger, clear, tip, viewport);
    expect(p.below).toBe(true);
    expect(p.top).toBe(40 + 8); // clear.bottom + TIP_GAP_PX
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + tip.height).toBeLessThanOrEqual(viewport.height);
  });

  it('clamps off the RIGHT edge without leaving the viewport', () => {
    const trigger = { top: 300, bottom: 360, left: 1350 }; // 1350 + 230 > 1400
    const p = computeTipPosition(trigger, trigger, tip, viewport);
    expect(p.left).toBeLessThanOrEqual(viewport.width - tip.width);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it('clamps off the BOTTOM edge without leaving the viewport, even after a flip', () => {
    // No room above (clear.top is 0) AND no room below either (the viewport
    // is barely taller than the tip) -- the flip fires but the raw "below"
    // top would still run off the bottom, so the final clamp has to hold.
    const trigger = { top: 5, bottom: 20, left: 50 };
    const clear = { top: 0, bottom: 20, left: 50 };
    const shortViewport = { width: 1400, height: 116 }; // tip.height + 8
    const p = computeTipPosition(trigger, clear, tip, shortViewport);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + tip.height).toBeLessThanOrEqual(shortViewport.height);
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
