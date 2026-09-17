import { describe, expect, it } from 'vitest';
import { pxFailures } from '../validate_ui_palette.mjs';

describe('pxFailures', () => {
  it('rejects a layout px value and accepts hairlines and tagged lines', () => {
    const css = [
      '.a { width: 460px; }',
      '.b { border: 1px solid red; }',
      '.c { border-width: 2px; }',
      '.d { height: 42px; /* px-ok */ }',
      '.e { text-shadow: 0 1px 12px black; }',
      'html { font-size: calc(16px * var(--ui-scale)); /* px-ok */ }',
    ].join('\n');
    expect(pxFailures('theme.css', css)).toEqual(['theme.css:1: 460px -- use rem (or tag the line /* px-ok */ for a hairline)']);
  });

  it('flags a layout px sharing a line with an exempt shadow declaration', () => {
    // A whole-line skip on any shadow/filter keyword would let this 8px
    // escape detection just because a text-shadow happens to share its line.
    const css = '.f { margin: 8px; text-shadow: 0 1px 2px black; }';
    expect(pxFailures('theme.css', css)).toEqual(['theme.css:1: 8px -- use rem (or tag the line /* px-ok */ for a hairline)']);
  });
});
