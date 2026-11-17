// GH-1406: a STAGED language (not in LOCALES) may lag the English and only reports it; a SHIPPED language is held strictly; and a staged
// language still fails on what is wrong rather than stale. Every case below is a constructed input: the same input goes green staged and
// red shipped, or red in both, so a gate that stopped distinguishing the two would fail here.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chromeCatalogueFailures as chromeRaw, chromeSourceFailures as chromeSrcRaw } from '../validate_chrome_catalogue.mjs';
import { overlayFailures as overlayRaw, unitOverlayFailures as unitOverlayRaw } from '../validate_narrative.mjs';
// @ts-expect-error: a plain .mjs module with no declarations, like the other validators the tools tests import.
import { isStaged as isStagedRaw, shippedLocaleIds as shippedRaw, stagingOpts as stagingOptsRaw } from '../locale_staging.mjs';

// The validators are plain .mjs modules; these are their signatures as the tests call them.
type Fn = (...args: unknown[]) => unknown;
const chromeCatalogueFailures = chromeRaw as unknown as Fn;
const chromeSourceFailures = chromeSrcRaw as unknown as Fn;
const overlayFailures = overlayRaw as unknown as Fn;
const unitOverlayFailures = unitOverlayRaw as unknown as Fn;
const isStaged = isStagedRaw as unknown as (id: string, shipped: string[]) => boolean;
const shippedLocaleIds = shippedRaw as unknown as (root: string) => string[];
const stagingOpts = stagingOptsRaw as unknown as (lang: string, shipped: string[], lag: Map<string, string[]>) => { staged: boolean; lag: string[] };

const ROOT = join(__dirname, '..', '..');
const read = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T;
const chrome = (en: Record<string, string>, tr: unknown, staged: boolean): { failures: string[]; lag: string[] } => {
  const lag: string[] = [];
  const failures = chromeCatalogueFailures('de.json', en, tr, { staged, lag }) as string[];
  return { failures, lag };
};

describe('which languages are staged', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'staging-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  it('LOCALES today is English alone, and every other language with files is therefore staged', () => {
    const shipped = shippedLocaleIds(ROOT) as string[];
    expect(shipped).toEqual(['en']);
    const dirs = readdirSync(join(ROOT, 'data/locales')).filter((f) => statSync(join(ROOT, 'data/locales', f)).isDirectory() && f !== 'en');
    for (const d of dirs) expect(isStaged(d, shipped), d).toBe(true);
    expect(isStaged('en', shipped)).toBe(false);
  });
  it('reads LOCALES from the source: a fixture that lists German as shipped makes it NOT staged', () => {
    mkdirSync(join(tmp, 'packages/app/src/i18n'), { recursive: true });
    writeFileSync(join(tmp, 'packages/app/src/i18n/locales.ts'), "export const LOCALES: readonly Locale[] = [{ id: 'en', name: 'English', dir: 'ltr' }, { id: 'de', name: 'Deutsch', dir: 'ltr' }];\n");
    const shipped = shippedLocaleIds(tmp) as string[];
    expect(shipped).toEqual(['en', 'de']);
    expect(isStaged('de', shipped)).toBe(false);
    expect(isStaged('fr', shipped)).toBe(true);
  });
  it('a missing or unreadable locales.ts reads as English alone (never as "everything is shipped")', () => {
    expect(shippedLocaleIds(join(tmp, 'nowhere'))).toEqual(['en']);
  });
});

describe('chrome sidecar (source hashes): stale is lag, malformed is wrong', () => {
  const en = { 'a.plain': 'Back', 'a.name': 'Mute {name}' };
  const tr = { 'a.plain': 'Zurück', 'a.name': '{name} stummschalten' };
  // sourceHash is the first 8 hex of sha256; the fixtures take their hashes from the validator's own message for the English text.
  const want = (src: Record<string, string>): { failures: string[]; lag: string[] } => {
    const lag: string[] = [];
    return { failures: chromeSourceFailures('de/chrome.src.json', en, tr, src, { staged: false, lag }) as string[], lag };
  };
  const hashOf = (key: 'a.plain' | 'a.name'): string => /set it to ([0-9a-f]{8})/.exec(want({}).failures.find((f) => f.includes(`"${key}"`)) ?? '')?.[1] ?? '';
  const good = { 'a.plain': hashOf('a.plain'), 'a.name': hashOf('a.name') };
  const run = (src: unknown, staged: boolean): { failures: string[]; lag: string[] } => {
    const lag: string[] = [];
    return { failures: chromeSourceFailures('de/chrome.src.json', en, tr, src, { staged, lag }) as string[], lag };
  };
  it('current hashes are green both ways', () => {
    expect(good['a.plain']).toMatch(/^[0-9a-f]{8}$/);
    for (const staged of [true, false]) expect(run(good, staged)).toEqual({ failures: [], lag: [] });
  });
  it('a stale hash (the English changed after translation): STAGED green and reported, SHIPPED red', () => {
    const stale = { ...good, 'a.plain': '00000000' };
    const s = run(stale, true);
    expect(s.failures).toEqual([]);
    expect(s.lag.join('\n')).toContain('"a.plain" is stale');
    expect(run(stale, false).failures.join('\n')).toContain('"a.plain" is stale');
  });
  it('a translated key with no hash: STAGED green and reported, SHIPPED red', () => {
    const { 'a.name': _drop, ...partial } = good;
    void _drop;
    expect(run(partial, true).failures).toEqual([]);
    expect(run(partial, true).lag.join('\n')).toContain('"a.name" is translated but carries no source hash');
    expect(run(partial, false).failures.join('\n')).toContain('carries no source hash');
  });
  it('STAGED still fails on a malformed hash, a hash for a key it does not translate, and a sidecar that is not an object', () => {
    expect(run({ ...good, 'a.plain': 'XYZ' }, true).failures.join('\n')).toContain('is not 8 hex characters');
    expect(run({ ...good, 'a.ghost': 'abcdef12' }, true).failures.join('\n')).toContain('has a source hash for "a.ghost"');
    expect(run([], true).failures).toEqual(['de/chrome.src.json: not a JSON object of key -> source hash']);
  });
});

describe('validate:data wires the staging rule into all three gates', () => {
  it('stagingOpts hands a staged language its own lag array and a shipped one `staged: false`', () => {
    const map = new Map<string, string[]>();
    const de = stagingOpts('de', ['en'], map);
    expect(de.staged).toBe(true);
    de.lag.push('x');
    expect(map.get('de')).toEqual(['x']);
    expect(stagingOpts('de', ['en'], map).lag).toBe(de.lag); // the same array for the same language: chrome, missions and units pool
    expect(stagingOpts('de', ['en', 'de'], new Map()).staged).toBe(false);
    expect(stagingOpts('en', ['en'], new Map()).staged).toBe(false);
  });
  it('every chrome, sidecar, mission-overlay and unit-overlay call in validate_data.mjs passes stagingOf(...) (one source-level count, since the gate runs against the real tree)', () => {
    const src = readFileSync(join(ROOT, 'tools/validate_data.mjs'), 'utf8');
    for (const fn of ['chromeCatalogueFailures', 'chromeSourceFailures', 'overlayFailures', 'unitOverlayFailures']) {
      const calls = [...src.matchAll(new RegExp(`\\.\\.\\.${fn}\\(([^\\n]*)\\)\\);`, 'g'))].map((m) => m[1]);
      expect(calls.length, fn).toBe(1);
      expect(calls[0], fn).toMatch(/stagingOf\((lang|id)\)/);
    }
  });
});

describe('chrome catalogue: lag versus wrong', () => {
  const en = { 'a.plain': 'Back', 'a.name': 'Mute {name}', 'a.new': 'Saved' };
  const lagging = { 'a.plain': 'Zurück', 'a.name': '{name} stummschalten' }; // lacks a.new
  it('a key the English gained: STAGED is green and reported; SHIPPED is red', () => {
    const s = chrome(en, lagging, true);
    expect(s.failures).toEqual([]);
    expect(s.lag).toEqual(['de.json: missing key "a.new"']);
    const p = chrome(en, lagging, false);
    expect(p.failures).toEqual(['de.json: missing key "a.new"']);
    expect(p.lag).toEqual([]);
  });
  it('STAGED still fails on an extra key, a renamed placeholder, a changed ICU shape and a non-string', () => {
    expect(chrome(en, { ...lagging, 'a.old': 'x' }, true).failures).toEqual(['de.json: "a.old" is not a key of en.json']);
    expect(chrome(en, { ...lagging, 'a.name': '{nom} stummschalten' }, true).failures.join('\n')).toContain('"a.name" has the wrong placeholders');
    const plural = { 'a.n': '{n, plural, one {# unit} other {# units}}' };
    expect(chrome(plural, { 'a.n': '{n, plural, other {# Einheiten}}' }, true).failures.join('\n')).toContain('wrong placeholders');
    expect(chrome(en, { ...lagging, 'a.plain': '' }, true).failures.join('\n')).toContain('"a.plain" is not a non-empty string');
    expect(chrome(en, { ...lagging, 'a.plain': 5 }, true).failures.join('\n')).toContain('"a.plain" is not a non-empty string');
  });
  it('a catalogue that is not an object fails whether staged or not', () => {
    expect(chrome(en, null, true).failures).toEqual(['de.json: not a JSON object of key -> text']);
    expect(chrome(en, [], true).failures).toEqual(['de.json: not a JSON object of key -> text']);
  });
  it('a complete catalogue is green both ways and reports nothing', () => {
    const full = { ...lagging, 'a.new': 'Gespeichert' };
    for (const staged of [true, false]) expect(chrome(en, full, staged)).toEqual({ failures: [], lag: [] });
  });
});

describe('mission and unit overlays: stale is lag, unknown is wrong', () => {
  interface M { id: string; dispatch?: string; triggers?: { id?: string; label?: string }[] }
  const missions = readdirSync(join(ROOT, 'data/missions')).filter((f) => f.endsWith('.json')).map((f) => read<M>(`data/missions/${f}`));
  const byId = new Map(missions.map((m) => [m.id, m]));
  const overlay = (): Record<string, Record<string, unknown>> => read('data/locales/en/missions.json');
  const run = (ov: unknown, ms: Map<string, M>, staged: boolean): { failures: string[]; lag: string[] } => {
    const lag: string[] = [];
    return { failures: overlayFailures('de/missions.json', ov, ms, { staged, lag }) as string[], lag };
  };
  it('an English line edited after translation: STAGED is green and reported, SHIPPED is red', () => {
    const m = missions.find((x) => x.dispatch !== undefined) as M;
    const edited = new Map(byId);
    edited.set(m.id, { ...m, dispatch: `${m.dispatch}.` });
    const s = run(overlay(), edited, true);
    expect(s.failures).toEqual([]);
    expect(s.lag).toHaveLength(1);
    expect(s.lag[0]).toContain(`mission "${m.id}" overlay "dispatch" is stale`);
    const p = run(overlay(), edited, false);
    expect(p.failures).toHaveLength(1);
    expect(p.failures[0]).toContain('is stale');
    expect(p.lag).toEqual([]);
  });
  it('a translated string with no hash: STAGED is green and reported, SHIPPED is red', () => {
    const ov = overlay();
    const id = Object.keys(ov)[0];
    const src = ov[id].src as Record<string, string>;
    const path = Object.keys(src)[0];
    delete src[path];
    expect(run(ov, byId, true).failures).toEqual([]);
    expect(run(ov, byId, true).lag.join('\n')).toContain(`carries no src hash for it: copy src "${path}"`);
    expect(run(ov, byId, false).failures.join('\n')).toContain('carries no src hash');
  });
  it('a section the English gained (the overlay gives only some): STAGED is green and reported, SHIPPED is red', () => {
    const ov = overlay();
    const id = Object.keys(ov).find((k) => Object.keys((ov[k].sections as Record<string, string>) ?? {}).length >= 2) as string;
    const sections = ov[id].sections as Record<string, string>;
    delete sections[Object.keys(sections)[0]];
    const s = run(ov, byId, true);
    expect(s.failures.filter((f) => f.includes('gives some sections'))).toEqual([]);
    expect(s.lag.join('\n')).toContain('gives some sections but not');
    expect(run(ov, byId, false).failures.join('\n')).toContain('gives some sections but not');
  });
  it('STAGED still fails on a mission that does not exist, a malformed hash, and a trigger label over 48 characters', () => {
    const ghost = { ...overlay(), not_a_mission: { name: 'x' } };
    expect(run(ghost, byId, true).failures.join('\n')).toContain('overlay names mission "not_a_mission"');
    const bad = overlay();
    const id = Object.keys(bad)[0];
    (bad[id].src as Record<string, string>).name = 'XYZ';
    expect(run(bad, byId, true).failures.join('\n')).toContain('is not 8 lowercase hex characters');
    const withLabel = missions.find((x) => (x.triggers ?? []).some((t) => t.id !== undefined && t.label !== undefined)) as M;
    const t = (withLabel.triggers ?? []).find((x) => x.id !== undefined && x.label !== undefined) as { id: string };
    const long = overlay();
    long[withLabel.id].triggers = { ...((long[withLabel.id].triggers as object) ?? {}), [t.id]: 'x'.repeat(49) };
    expect(run(long, byId, true).failures.join('\n')).toMatch(/48/);
  });
  interface U { id: string; name?: string; blurb?: string }
  const jsonIn = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? jsonIn(p) : f.endsWith('.json') ? [p] : []; });
  const units = jsonIn(join(ROOT, 'data/units')).map((f) => JSON.parse(readFileSync(f, 'utf8')) as U).filter((u) => typeof u.id === 'string');
  const unitMap = new Map(units.map((u) => [u.id, u]));
  const runUnits = (ov: unknown, um: Map<string, U>, staged: boolean): { failures: string[]; lag: string[] } => {
    const lag: string[] = [];
    return { failures: unitOverlayFailures('de/units.json', ov, um, { staged, lag }) as string[], lag };
  };
  it('a unit blurb edited after translation: STAGED green and reported, SHIPPED red; an unknown unit is red either way', () => {
    const ov = read<Record<string, unknown>>('data/locales/en/units.json');
    const u = units.find((x) => x.blurb !== undefined) as U & { blurb: string };
    const edited = new Map(unitMap);
    edited.set(u.id, { ...u, blurb: `${u.blurb}!` });
    expect(runUnits(ov, edited, true).failures).toEqual([]);
    expect(runUnits(ov, edited, true).lag).toHaveLength(1);
    expect(runUnits(ov, edited, false).failures).toHaveLength(1);
    expect(runUnits({ ...ov, not_a_unit: { name: 'x' } }, unitMap, true).failures.join('\n')).toContain('overlay names unit "not_a_unit"');
  });
});
