// GH-1418: the build-time half of the desktop demo's content cut. Literal oracles: the variable, the file, the ids.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_CUT_ENV, DEMO_CUT_FILE, demoCutDefine, demoCutFromEnv, demoCutPlugin } from './vite-plugin-demo-cut';

const LEAD = ['beit_sahwan_0_tutorial', 'beit_sahwan_breach', 'beit_sahwan_1_recon', 'beit_sahwan_2_foothold', 'beit_sahwan_3_clearance', 'beit_sahwan_4_subterranean'];

describe('demoCutFromEnv', () => {
  it('unset or empty is no cut', () => {
    expect(demoCutFromEnv(undefined)).toBeNull();
    expect(demoCutFromEnv('')).toBeNull();
  });
  it('reads a list of ids', () => expect(demoCutFromEnv(JSON.stringify(LEAD))).toEqual(LEAD));
  it.each([
    ['not JSON', 'beit_sahwan_1_recon'],
    ['an empty list', '[]'],
    ['an object', '{"missions":[]}'],
    ['null spelled out', 'null'],
    ['a number in the list', '[1]'],
    ['an id with a path in it', '["../x"]'],
    ['a duplicate', '["a","a"]'],
  ])('refuses %s', (_name, raw) => expect(() => demoCutFromEnv(raw)).toThrow(new RegExp(DEMO_CUT_ENV)));
});

describe('the define and the emitted file', () => {
  it('defines null with no cut and the list with one', () => {
    expect(demoCutDefine(null)).toBe('null');
    expect(demoCutDefine(LEAD)).toBe(JSON.stringify(LEAD));
  });
  const emitted = (cut: readonly string[] | null): unknown[] => {
    const files: unknown[] = [];
    const hook = demoCutPlugin(cut).generateBundle as unknown as (this: { emitFile(f: unknown): string }) => void;
    hook.call({ emitFile: (f) => (files.push(f), 'id') });
    return files;
  };
  it('writes demo-cut.json in a cut build, and nothing in any other', () => {
    expect(DEMO_CUT_FILE).toBe('demo-cut.json');
    expect(emitted(LEAD)).toEqual([{ type: 'asset', fileName: 'demo-cut.json', source: `${JSON.stringify({ missions: LEAD })}\n` }]);
    expect(emitted(null)).toEqual([]);
  });
  it('vite.config.ts reads the variable once, defines the constant and installs the plugin', () => {
    const config = readFileSync(new URL('./vite.config.ts', import.meta.url), 'utf8');
    expect(config).toContain('const DEMO_CUT = demoCutFromEnv(process.env[DEMO_CUT_ENV]);');
    expect(config).toContain('__DEMO_MISSIONS__: demoCutDefine(DEMO_CUT),');
    expect(config).toContain('demoCutPlugin(DEMO_CUT),');
  });
});
