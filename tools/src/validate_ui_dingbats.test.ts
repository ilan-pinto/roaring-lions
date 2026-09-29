import { describe, expect, it } from 'vitest';
import { RETIRED_DINGBATS, dingbatFailures } from '../validate_ui_palette.mjs';

describe('dingbatFailures', () => {
  it('names a listed dingbat with its file and line', () => {
    expect(dingbatFailures('ui/hud.ts', 'info.push("▣ " + x)')).toEqual([
      'ui/hud.ts:1  retired dingbat ▣ -- draw it with symbolSvg (ui/symbol.ts)',
    ]);
  });

  it('is silent on typography, the star exception and the Q10 survivors', () => {
    const src = [
      'const label = `${deg}°C, 12·5`;', // typography, not a dingbat
      "el('span', 'rl-commend', '★'.repeat(vet));", // Q5 exception
      "t('garage.benefit.plain', { before, after });", // '→' lives in en.json, not here
      "const arrow = '→';", // Q10 survivor: before -> after reads as typography
    ].join('\n');
    expect(dingbatFailures('ui/hud.ts', src)).toEqual([]);
  });

  // GH-261: the Military set drew these, so each is a defect wherever it
  // turns up again.
  it.each([
    ['▮▮', "{ speed: 0, label: '▮▮' }"],
    ['◂', "prev.textContent = '◂';"],
    ['▸', "next.textContent = '▸';"],
    ['🔇', "chip.textContent = muted ? '🔇' : x;"],
    ['🔊', "chip.textContent = '🔊';"],
    ['♪', '"menu.audio.on": "♪ audio on",'],
    ['☑', "const g = done ? '☑' : x;"],
    ['☒', "const g = '☒';"],
    ['☐', "const g = '☐';"],
    ['←', '"nav.backToMenu": "← main menu",'],
    ['⌂', '"hud.leave.link": "⌂ leave",'],
    ['⚠', '"hud.card.weaponHeavy": "⚠ heavy",'],
    ['⚑', '"hud.strip.broken": "⚑ {n} broken",'],
  ])('rejects %s, drawn by GH-261', (glyph, line) => {
    const ch = glyph === '▮▮' ? '▮' : glyph;
    expect(dingbatFailures('packages/app/src/i18n/en.json', line)).toContain(
      `packages/app/src/i18n/en.json:1  retired dingbat ${ch} -- draw it with symbolSvg (ui/symbol.ts)`
    );
  });

  it("lets the keymap's key names keep their arrow as typography, and nothing else", () => {
    const labels = "space: 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',";
    expect(dingbatFailures('packages/app/src/input/keymap.ts', labels)).toEqual([]);
    expect(dingbatFailures('packages/app/src/ui/menu.ts', labels)).toHaveLength(1);
    expect(dingbatFailures('packages/app/src/input/keymap.ts', "x = '⚑';")).toHaveLength(1);
  });

  it('allows the keymap its arrow only as a key-name LABELS entry, not anywhere else in the file', () => {
    const keymap = 'packages/app/src/input/keymap.ts';
    expect(dingbatFailures(keymap, "// press ← to go back")).toEqual([
      `${keymap}:1  retired dingbat ← -- draw it with symbolSvg (ui/symbol.ts)`,
    ]);
    expect(dingbatFailures(keymap, "const back = '←';")).toHaveLength(1);
    expect(dingbatFailures(keymap, "  arrowleft: '←', hint: '← back',")).toHaveLength(1);
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
    expect(RETIRED_DINGBATS).toHaveLength(30);
    expect(new Set(RETIRED_DINGBATS).size).toBe(30);
    expect(RETIRED_DINGBATS).not.toContain('★');
  });

  it('retires ▼ now that pinned is drawn (GH-262)', () => {
    expect(dingbatFailures('i18n/en.json', '"hud.strip.pinned": "▼ {n} pinned"')).toHaveLength(1);
  });
});
