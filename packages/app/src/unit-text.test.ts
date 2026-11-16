/**
 * GH-1406: unit names and blurbs resolve through a locale overlay. Each assertion below was watched to fail against a one-line mutation of
 * `unit-text.ts` or of a reader (named in the commit message).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { units } from '@lions/data';
import { loadUnitOverlay, localizedUnit, setUnitOverlay, unitBlurb, unitName } from './unit-text';

const ids = Object.keys(units);
const withBlurb = ids.find((id) => typeof (units as Record<string, { blurb?: string }>)[id].blurb === 'string') as string;
const source = (id: string) => (units as Record<string, { name: string; blurb?: string }>)[id];

afterEach(() => {
  setUnitOverlay(null);
  vi.unstubAllGlobals();
});

describe('unitName and unitBlurb', () => {
  it('read the source text with no overlay, and the id for a unit nobody knows', () => {
    expect(unitName(withBlurb)).toBe(source(withBlurb).name);
    expect(unitBlurb(withBlurb)).toBe(source(withBlurb).blurb);
    expect(unitName('no_such_unit')).toBe('no_such_unit');
    expect(unitBlurb('no_such_unit')).toBeUndefined();
  });

  it('read the overlay AT CALL TIME, not at import, and fall back per field', () => {
    setUnitOverlay({ [withBlurb]: { name: 'NOM' } });
    expect(unitName(withBlurb)).toBe('NOM');
    expect(unitBlurb(withBlurb)).toBe(source(withBlurb).blurb); // only the name was translated
    setUnitOverlay({ [withBlurb]: { blurb: 'DESC' } });
    expect(unitName(withBlurb)).toBe(source(withBlurb).name);
    expect(unitBlurb(withBlurb)).toBe('DESC');
    setUnitOverlay(null);
    expect(unitName(withBlurb)).toBe(source(withBlurb).name);
  });

  it('leave a unit the overlay does not mention in English', () => {
    const other = ids.find((id) => id !== withBlurb) as string;
    setUnitOverlay({ [withBlurb]: { name: 'NOM' } });
    expect(unitName(other)).toBe(source(other).name);
  });

  it('never write into @lions/data: the net content digest hashes that JSON, name included', () => {
    const before = JSON.stringify(units);
    setUnitOverlay({ [withBlurb]: { name: 'NOM', blurb: 'DESC' } });
    unitName(withBlurb);
    localizedUnit(source(withBlurb) as { id: string; name: string });
    expect(JSON.stringify(units)).toBe(before);
    expect(source(withBlurb).name).not.toBe('NOM');
  });

  it('localizedUnit returns the SAME object when nothing overlays it, and a copy when something does', () => {
    const u = { id: withBlurb, name: 'x', blurb: 'y' };
    expect(localizedUnit(u)).toBe(u);
    setUnitOverlay({ [withBlurb]: { name: 'NOM' } });
    const l = localizedUnit(u);
    expect(l).not.toBe(u);
    expect(l).toEqual({ id: withBlurb, name: 'NOM', blurb: 'y' });
    expect(u.name).toBe('x');
  });
});

describe('loadUnitOverlay', () => {
  it('never fetches for en', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await loadUnitOverlay('en', '/')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('asks for locales/<lang>/units.json under the base and returns the parsed overlay', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ a: { name: 'A' } })));
    vi.stubGlobal('fetch', f);
    expect(await loadUnitOverlay('fr', '/game/')).toEqual({ a: { name: 'A' } });
    expect(f).toHaveBeenCalledWith('/game/locales/fr/units.json');
  });

  it('degrades to a null overlay on a 404 and on a network failure, never a boot failure', async () => {
    // A 404 page that happens to be valid JSON must not be taken for an overlay.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ a: { name: 'NOT FOUND PAGE' } }), { status: 404 }));
    expect(await loadUnitOverlay('fr', '/')).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect(await loadUnitOverlay('fr', '/')).toBeNull();
  });
});

/** Non-test source files under packages/app/src, as [path relative to it, code with comment lines blanked]. */
function appSources(): [string, string][] {
  const root = __dirname;
  const out: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(name) && !/\.test\.ts$|\.test-helper\.ts$/.test(name)) {
        const code = readFileSync(p, 'utf8')
          .split('\n')
          .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l))
          .join('\n');
        out.push([relative(root, p), code]);
      }
    }
  };
  walk(root);
  return out;
}

describe('the readers go through the overlay (source guard)', () => {
  it('no app source reads a unit name or blurb straight off the data package', () => {
    const offenders = appSources().filter(([, code]) => /(?<![.\w])\(?units(?:\s+as\s[^)]*\))?\[[^\]]*\]\??\.(name|blurb)\b/.test(code)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('every sim type registered in the app is a localized copy (the diorama never shows a name, and is the one exemption)', () => {
    const offenders: string[] = [];
    for (const [file, code] of appSources()) {
      if (file === join('front', 'diorama.ts')) continue;
      for (const m of code.matchAll(/\.addUnitType\((?!localizedUnit\()/g)) offenders.push(`${file}@${m.index}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the pattern catches the shapes the old readers had: a bare read, a cast read, and an `as keyof` read', () => {
    const re = /(?<![.\w])\(?units(?:\s+as\s[^)]*\))?\[[^\]]*\]\??\.(name|blurb)\b/;
    expect(re.test('const a = units[id]?.name ?? id;')).toBe(true);
    expect(re.test('(units as Readonly<Record<string, { name?: string } | undefined>>)[id]?.name ?? id')).toBe(true);
    expect(re.test('units[id as keyof typeof units]?.name ?? id')).toBe(true);
    expect(re.test('d.units[typeId]?.name')).toBe(false); // the test seam in alert-world, behind `unitName?.()`
  });

  it('the scan sees something: this repository really registers unit types and builds names in the app', () => {
    const all = appSources();
    expect(all.filter(([, c]) => c.includes('.addUnitType(')).length).toBeGreaterThanOrEqual(2);
    expect(all.some(([f]) => f === 'unit-text.ts')).toBe(true);
  });
});
