import { describe, expect, it } from 'vitest';
import { RETIRED_DINGBATS, dingbatFailures } from '../validate_ui_palette.mjs';

describe('dingbatFailures', () => {
  it('names a listed dingbat with its file and line', () => {
    expect(dingbatFailures('ui/hud.ts', 'info.push("▣ " + x)')).toEqual([
      'ui/hud.ts:1  retired dingbat ▣ -- draw it with symbolSvg (ui/symbol.ts)',
    ]);
  });

  it('is silent on typography, the star exception and Q10 survivors', () => {
    const src = [
      'const label = `${deg}°C, 12·5`;', // typography, not a dingbat
      "el('span', 'rl-commend', '★'.repeat(vet));", // Q5 exception
      "t('garage.benefit.plain', { before, after });", // '→' lives in en.json, not here
      "const arrow = '→';",
      "const status = complete ? '☑' : '☐';", // Q10 survivor
    ].join('\n');
    expect(dingbatFailures('ui/hud.ts', src)).toEqual([]);
  });

  it('is silent on a .test.ts file', () => {
    expect(dingbatFailures('ui/hud.test.ts', 'expect(x).toBe("▣")')).toEqual([]);
  });

  it('is silent on the two modules that draw the replacement marks', () => {
    const src = '// ▣ used to mark this before symbolSvg drew it';
    expect(dingbatFailures('packages/app/src/ui/symbol.ts', src)).toEqual([]);
    expect(dingbatFailures('packages/app/src/ui/order-sight.ts', src)).toEqual([]);
  });

  it('reports a catalogue (i18n JSON) line', () => {
    const src = '{\n  "x": "◎ intel"\n}';
    expect(dingbatFailures('packages/app/src/i18n/en.json', src)).toEqual([
      'packages/app/src/i18n/en.json:2  retired dingbat ◎ -- draw it with symbolSvg (ui/symbol.ts)',
    ]);
  });

  it('lists every retired dingbat once, and never the star exception', () => {
    expect(RETIRED_DINGBATS).toHaveLength(17);
    expect(new Set(RETIRED_DINGBATS).size).toBe(17);
    expect(RETIRED_DINGBATS).not.toContain('★');
  });

  it('retires ▼ now that pinned is drawn (GH-262)', () => {
    expect(dingbatFailures('i18n/en.json', '"hud.strip.pinned": "▼ {n} pinned"')).toHaveLength(1);
  });
});
