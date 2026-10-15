import { describe, expect, it } from 'vitest';
import { addToTally, emptyTally, stripInlineSourceMaps } from './strip-inline-maps';

const MAP = '//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==';

describe('stripInlineSourceMaps', () => {
  it('removes the trailing inline map and the newline before it', () => {
    const s = stripInlineSourceMaps(`export const a = 1;\n${MAP}\n`);
    expect(s.text).toBe('export const a = 1;');
    expect(s.maps).toBe(1);
    expect(s.removed).toBe(MAP.length + 2);
  });

  it('removes a CRLF-terminated map and the legacy `//@` spelling', () => {
    expect(stripInlineSourceMaps(`a();\r\n${MAP}\r\n`).text).toBe('a();');
    expect(stripInlineSourceMaps(`a();\n${MAP.replace('//#', '//@')}`).text).toBe('a();');
  });

  it('removes a CSS block map', () => {
    const s = stripInlineSourceMaps('.x{color:red}\n/*# sourceMappingURL=data:application/json;base64,e30= */\n');
    expect(s.text).toBe('.x{color:red}');
    expect(s.maps).toBe(1);
  });

  it('removes stacked maps at the end, all of them', () => {
    const s = stripInlineSourceMaps(`a();\n${MAP}\n${MAP}\n`);
    expect(s.text).toBe('a();');
    expect(s.maps).toBe(2);
  });

  it('leaves a map that lives in its own file alone', () => {
    const src = 'a();\n//# sourceMappingURL=three.js.map\n';
    expect(stripInlineSourceMaps(src)).toEqual({ text: src, removed: 0, maps: 0 });
  });

  it('never cuts a module that merely CONTAINS the text, mid-file', () => {
    // A library that builds a map and appends it to generated code.
    const src = `const tail = "\\n${MAP}";\nexport function f() { return tail; }\n`;
    expect(stripInlineSourceMaps(src)).toEqual({ text: src, removed: 0, maps: 0 });
  });

  it('is the identity on a module with no map', () => {
    expect(stripInlineSourceMaps('export {};\n')).toEqual({ text: 'export {};\n', removed: 0, maps: 0 });
  });
});

describe('the tally', () => {
  it('counts scripts, the ones with maps, the maps and the characters removed', () => {
    const t = emptyTally();
    addToTally(t, stripInlineSourceMaps(`a();\n${MAP}`));
    addToTally(t, stripInlineSourceMaps('b();'));
    expect(t).toEqual({ scripts: 2, withMaps: 1, maps: 1, removed: MAP.length + 1 });
  });
});
