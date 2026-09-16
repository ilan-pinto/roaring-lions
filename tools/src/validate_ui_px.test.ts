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
});
