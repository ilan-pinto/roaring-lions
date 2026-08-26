/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { releaseCursorToCss, type CursorOwner } from './cursor-ownership';

/**
 * PixiJS 8's `EventSystem.setCursor`, reproduced from
 * `pixi.js/lib/events/EventSystem.mjs`, reduced to the branches that decide
 * whether anything is written to the element.
 *
 * Copied rather than imported because the point is to hold OUR configuration
 * against THEIR algorithm: importing the real system would need a WebGL
 * context, and asserting on our own config alone would prove nothing about
 * what Pixi does with it. If Pixi changes this algorithm the test drifts --
 * which is the correct failure, because the fix depends on it.
 */
function pixiSetCursor(
  owner: CursorOwner,
  domElement: { style: { cursor: string } },
  mode: string | null
): void {
  const m = mode || 'default';
  const style = owner.cursorStyles[m];
  if (style) {
    if (typeof style === 'string') domElement.style.cursor = style;
    return;
  }
  if (typeof m === 'string' && !Object.prototype.hasOwnProperty.call(owner.cursorStyles, m)) {
    domElement.style.cursor = m;
  }
}

/** Pixi's shipped defaults, which are the whole problem. */
const pixiDefaults = (): CursorOwner => ({
  cursorStyles: { default: 'inherit', pointer: 'pointer' },
});

describe('releaseCursorToCss', () => {
  it('leaves every mode present as an own property', () => {
    // Load-bearing: an ABSENT key sends setCursor down the branch that writes
    // the mode name literally, so `delete` would be worse than doing nothing.
    const owner = pixiDefaults();
    releaseCursorToCss(owner);
    for (const mode of ['default', 'pointer']) {
      expect(Object.prototype.hasOwnProperty.call(owner.cursorStyles, mode)).toBe(true);
      expect(owner.cursorStyles[mode]).toBeUndefined();
    }
  });

  it('makes Pixi write nothing at all for the default mode', () => {
    const owner = pixiDefaults();
    const el = { style: { cursor: '' } };
    releaseCursorToCss(owner);
    pixiSetCursor(owner, el, 'default');
    expect(el.style.cursor).toBe('');
  });

  it('makes Pixi write nothing for the pointer mode either', () => {
    // An interactive display object would otherwise take the cursor back.
    const owner = pixiDefaults();
    const el = { style: { cursor: '' } };
    releaseCursorToCss(owner);
    pixiSetCursor(owner, el, 'pointer');
    expect(el.style.cursor).toBe('');
  });

  it('without the fix, Pixi writes inherit — the bug this exists to stop', () => {
    const owner = pixiDefaults();
    const el = { style: { cursor: '' } };
    pixiSetCursor(owner, el, 'default');
    expect(el.style.cursor).toBe('inherit');
  });

  it('deleting the key instead would make Pixi write the literal mode name', () => {
    // Pins why the implementation assigns undefined rather than deleting.
    const owner = pixiDefaults();
    const el = { style: { cursor: '' } };
    delete owner.cursorStyles.default;
    pixiSetCursor(owner, el, 'default');
    expect(el.style.cursor).toBe('default');
  });
});

describe('the contextual cursor survives a pointer interaction', () => {
  // Asserts on COMPUTED STYLE, which is the only assertion that catches this.
  // The attribute, the emitted CSS and the selector match were all correct
  // while every cursor in the game resolved to `auto`.
  const RULE =
    `canvas[data-cursor='move-armour']{cursor:url("data:image/svg+xml,%3Csvg%2F%3E") 16 16, auto}`;

  function build(): { window: Window & typeof globalThis; canvas: HTMLCanvasElement } {
    const dom = new JSDOM(`<style>${RULE}</style><div id="stage"><canvas></canvas></div>`);
    const window = dom.window as unknown as Window & typeof globalThis;
    const canvas = window.document.querySelector('canvas') as HTMLCanvasElement;
    canvas.dataset.cursor = 'move-armour';
    return { window, canvas };
  }

  it('resolves to the drawn image before anything touches the canvas', () => {
    const { window, canvas } = build();
    expect(window.getComputedStyle(canvas).cursor).toMatch(/^url\(/);
  });

  it('still resolves to the drawn image after Pixi handles a pointer event', () => {
    const { window, canvas } = build();
    const owner = pixiDefaults();
    releaseCursorToCss(owner);
    pixiSetCursor(owner, canvas as unknown as { style: { cursor: string } }, 'default');
    expect(window.getComputedStyle(canvas).cursor).toMatch(/^url\(/);
  });

  it('is destroyed by an unpatched Pixi, proving the assertion has teeth', () => {
    const { window, canvas } = build();
    const owner = pixiDefaults(); // no releaseCursorToCss
    pixiSetCursor(owner, canvas as unknown as { style: { cursor: string } }, 'default');
    expect(window.getComputedStyle(canvas).cursor).toBe('auto');
  });
});
