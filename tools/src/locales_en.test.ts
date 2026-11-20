// GH-1406 part 2: `data/locales/en/missions.json` is the GENERATED English template. These checks prove it can neither miss a string nor
// keep a stale one, and that it is not an overlay the game fetches. The oracle reads the mission files itself and compares by hand; it
// does not call the builder to decide what the file should say.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMissionLocale, type MissionLocaleOverlay } from '@lions/data';
// @ts-expect-error: a plain .mjs module with no declarations, like the other validators the tools tests import.
import { buildEnglishCatalogue, buildEnglishPlaces, buildEnglishUnits, englishCatalogueFailures, englishMissionText, englishPlaceFailures, englishUnitFailures, overlayFailures, placeOverlayFailures, unitOverlayFailures } from '../validate_narrative.mjs';

const ROOT = join(__dirname, '..', '..');
interface Say { speaker: string; text: string }
interface M {
  id: string; name?: string; briefing?: string; dispatch?: string; aftermath?: string; hostages_place?: string;
  debrief?: { victory?: Say; defeat?: Say };
  briefing_sections?: { id: string; text: string }[];
  objectives?: { id: string; text?: string; say?: Say; say_on_fail?: Say }[];
  triggers?: { id?: string; label?: string; say?: Say }[];
  enemy?: { waves?: { say?: Say }[] };
}
const missions: M[] = readdirSync(join(ROOT, 'data/missions')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'data/missions', f), 'utf8')) as M);
const fileText = readFileSync(join(ROOT, 'data/locales/en/missions.json'), 'utf8');
const catalogue = JSON.parse(fileText) as MissionLocaleOverlay;
const check = (c: unknown, ms: M[] = missions): string[] => englishCatalogueFailures('en/missions.json', c, ms) as string[];

describe('the English mission catalogue (GH-1406 part 2)', () => {
  it('has an entry for every shipped mission, and for nothing else', () => {
    expect(Object.keys(catalogue).sort()).toEqual(missions.map((m) => m.id).sort());
    expect(missions.length).toBeGreaterThan(25);
  });

  it('carries every name, briefing, objective text and trigger label, equal to the mission file (hand-compared)', () => {
    for (const m of missions) {
      const e = catalogue[m.id];
      expect(e.name, `${m.id} name`).toBe(m.name);
      expect(e.briefing, `${m.id} briefing`).toBe(m.briefing);
      for (const o of m.objectives ?? []) if (o.text !== undefined) expect(e.objectives?.[o.id], `${m.id} objective ${o.id}`).toBe(o.text);
      for (const t of m.triggers ?? []) if (t.id !== undefined && t.label !== undefined) expect(e.triggers?.[t.id], `${m.id} trigger ${t.id}`).toBe(t.label);
      // GH-1406 part 3: the rest of the player-facing text, each read off the mission file by hand.
      expect(e.dispatch, `${m.id} dispatch`).toBe(m.dispatch);
      expect(e.aftermath, `${m.id} aftermath`).toBe(m.aftermath);
      expect(e.hostages_place, `${m.id} hostages_place`).toBe(m.hostages_place);
      expect(e.debrief?.victory, `${m.id} debrief victory`).toBe(m.debrief?.victory?.text);
      expect(e.debrief?.defeat, `${m.id} debrief defeat`).toBe(m.debrief?.defeat?.text);
      for (const sec of m.briefing_sections ?? []) expect((e.sections as Record<string, string> | undefined)?.[sec.id], `${m.id} section ${sec.id}`).toBe(sec.text);
      for (const o of m.objectives ?? []) {
        expect(e.objective_say?.[o.id], `${m.id} objective ${o.id} say`).toBe(o.say?.text);
        expect(e.objective_say_on_fail?.[o.id], `${m.id} objective ${o.id} say_on_fail`).toBe(o.say_on_fail?.text);
      }
      for (const t of m.triggers ?? []) if (t.id !== undefined) expect(e.trigger_say?.[t.id], `${m.id} trigger ${t.id} say`).toBe(t.say?.text);
      (m.enemy?.waves ?? []).forEach((w, i) => expect(e.wave_say?.[String(i)], `${m.id} wave ${i} say`).toBe(w.say?.text));
    }
  });

  it('holds exactly the census of radio lines, sections and plain strings (no silent drop, none invented)', () => {
    const count = (f: (m: M) => number): number => missions.reduce((n, m) => n + f(m), 0);
    const have = Object.values(catalogue);
    const sum = (key: 'objective_say' | 'objective_say_on_fail' | 'trigger_say' | 'wave_say' | 'sections'): number => have.reduce((n, e) => n + Object.keys(e[key] ?? {}).length, 0);
    expect(sum('objective_say')).toBe(count((m) => (m.objectives ?? []).filter((o) => o.say !== undefined).length));
    expect(sum('objective_say_on_fail')).toBe(count((m) => (m.objectives ?? []).filter((o) => o.say_on_fail !== undefined).length));
    expect(sum('trigger_say')).toBe(count((m) => (m.triggers ?? []).filter((t) => t.id !== undefined && t.say !== undefined).length));
    expect(sum('wave_say')).toBe(count((m) => (m.enemy?.waves ?? []).filter((w) => w.say !== undefined).length));
    expect(sum('sections')).toBe(count((m) => (m.briefing_sections ?? []).length));
    expect(have.filter((e) => e.dispatch !== undefined)).toHaveLength(missions.filter((m) => m.dispatch !== undefined).length);
    expect(have.filter((e) => e.aftermath !== undefined)).toHaveLength(missions.filter((m) => m.aftermath !== undefined).length);
    expect(have.filter((e) => e.debrief?.victory !== undefined)).toHaveLength(missions.filter((m) => m.debrief?.victory !== undefined).length);
    // and they are not zero: a census that found nothing would pass the equalities above vacuously
    expect(sum('objective_say')).toBeGreaterThan(20);
    expect(sum('wave_say')).toBeGreaterThan(10);
    expect(sum('sections')).toBeGreaterThan(20);
  });

  it('holds exactly the counts a census of the mission files gives (no silent drop, no extra)', () => {
    const objectives = missions.reduce((n, m) => n + (m.objectives ?? []).filter((o) => o.text !== undefined).length, 0);
    const labelled = missions.reduce((n, m) => n + (m.triggers ?? []).filter((t) => t.id !== undefined && t.label !== undefined).length, 0);
    const have = Object.values(catalogue);
    expect(have.reduce((n, e) => n + Object.keys(e.objectives ?? {}).length, 0)).toBe(objectives);
    expect(have.reduce((n, e) => n + Object.keys(e.triggers ?? {}).length, 0)).toBe(labelled);
  });

  it('is byte-for-byte what the generator writes today (a stale file fails here)', () => {
    expect(fileText).toBe(JSON.stringify(buildEnglishCatalogue(missions), null, 2) + '\n');
  });

  it('is a no-op overlay: applying it leaves every mission deep-equal to its source', () => {
    for (const m of missions) expect(applyMissionLocale(m as never, catalogue), m.id).toEqual(m);
  });

  it('is never fetched: `main.ts` sends the mission overlay through `fetchLocaleJson`, which returns before any request for `en` and the pseudo-locales', () => {
    const src = readFileSync(join(ROOT, 'packages/app/src/main.ts'), 'utf8');
    expect(src).toMatch(/async function loadMissionOverlay\(lang: string, base: string\)[^{]*\{[^}]*fetchLocaleJson<MissionLocaleOverlay>\(lang, `\$\{base\}locales\/\$\{lang\}\/missions\.json`/);
    const helper = readFileSync(join(ROOT, 'packages/app/src/i18n/overlay-fetch.ts'), 'utf8');
    expect(helper).toContain("if (lang === 'en' || lang === 'pseudo' || lang === 'pseudo-rtl') return null;");
  });

  describe('the checker fails on each fault (constructed, not imagined)', () => {
    const clone = (): MissionLocaleOverlay => JSON.parse(fileText) as MissionLocaleOverlay;
    const first = missions[0];
    it('passes the real file', () => expect(check(catalogue)).toEqual([]));
    it('a missing file is one failure, not a pass', () => expect(check(null, [])).toHaveLength(1));
    it('a missing mission entry', () => {
      const c = clone(); delete c[first.id];
      expect(check(c).join('\n')).toContain(`no entry for mission "${first.id}"`);
    });
    it('a stale mission entry (a deleted mission)', () => {
      const c = clone(); c.ghost_mission = { name: 'x' };
      expect(check(c).join('\n')).toContain('"ghost_mission", which is not a mission');
    });
    it('a briefing that differs from the file', () => {
      const c = clone(); c[first.id].briefing = (c[first.id].briefing ?? '') + ' ';
      expect(check(c).join('\n')).toContain(`mission "${first.id}" briefing differs`);
    });
    it('a missing and a stale objective', () => {
      const c = clone(); const o = c[first.id].objectives ?? {}; const k = Object.keys(o)[0];
      delete o[k]; o.ghost_objective = 'x';
      const out = check(c).join('\n');
      expect(out).toContain(`objectives "${k}" is missing`);
      expect(out).toContain('objectives "ghost_objective" is not in the mission file');
    });
    it('a trigger label that differs, and a key the overlay does not read', () => {
      const withTrigger = missions.find((m) => (m.triggers ?? []).some((t) => t.id && t.label)) as M;
      const c = clone(); const trs = c[withTrigger.id].triggers ?? {}; const k = Object.keys(trs)[0]; trs[k] += '!';
      (c[withTrigger.id] as Record<string, unknown>).dispach = 'x';
      const out = check(c).join('\n');
      expect(out).toContain(`triggers "${k}" differs`);
      expect(out).toContain('carries "dispach"');
    });
    it('a missing dispatch, a differing debrief line, a missing wave index and a missing section (part 3)', () => {
      const withAll = missions.find((m) => m.dispatch !== undefined && m.debrief?.victory !== undefined && (m.enemy?.waves ?? []).some((w) => w.say) && (m.briefing_sections ?? []).length > 0) as M;
      const c = clone();
      const e = c[withAll.id];
      delete e.dispatch;
      if (e.debrief) e.debrief.victory += '!';
      const waveKey = Object.keys(e.wave_say ?? {})[0];
      delete (e.wave_say as Record<string, string>)[waveKey];
      delete (e.sections as Record<string, string>)[Object.keys(e.sections ?? {})[0]];
      const out = check(c).join('\n');
      expect(out).toContain(`mission "${withAll.id}" dispatch is missing`);
      expect(out).toContain('debrief "victory" differs');
      expect(out).toContain(`wave_say "${waveKey}" is missing`);
      expect(out).toMatch(/sections "[a-z]+" is missing/);
    });
    it('a stale radio line: a line the mission no longer has', () => {
      const c = clone();
      const e = c[first.id];
      (e.objective_say ??= {}).ghost_objective = 'x';
      expect(check(c).join('\n')).toContain('objective_say "ghost_objective" is not in the mission file (stale)');
    });
    it('a changed mission file makes the committed catalogue stale', () => {
      const edited = missions.map((m, i) => (i === 0 ? { ...m, name: `${m.name} (edited)` } : m));
      expect(check(catalogue, edited).join('\n')).toContain(`mission "${first.id}" name differs`);
    });
    it('the per-mission builder skips what the loader cannot overlay (an unlabelled or id-less trigger)', () => {
      const e = englishMissionText({ id: 'x', name: 'n', objectives: [{ id: 'a', text: 't' }], triggers: [{ id: 'k' }, { label: 'no id' }] }) as { triggers?: unknown };
      expect(e.triggers).toBeUndefined();
    });
  });

  // GH-1406 part 5: every entry carries `src`, the hash of its English, so a translation copied from this file carries the hashes it was made from.
  describe('the src hashes (stale-translation guard)', () => {
    // the oracle is node's SHA-256 written out here, and the path walk is by hand: nothing is read back from the module under test
    const h8 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 8);
    type Entry = Record<string, unknown> & { src?: Record<string, string> };
    const expected = (e: Entry): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [key, v] of Object.entries(e)) {
        if (key === 'src') continue;
        if (typeof v === 'string') out[key] = h8(v);
        else for (const [k, t] of Object.entries(v as Record<string, string>)) out[`${key}.${k}`] = h8(t);
      }
      return out;
    };
    const entries = (): [string, Entry][] => Object.entries(catalogue as Record<string, Entry>);

    it('holds, for every mission, exactly one hash per string and each is the hash of that string', () => {
      let paths = 0;
      for (const [id, e] of entries()) {
        expect(e.src, id).toEqual(expected(e));
        paths += Object.keys(e.src ?? {}).length;
      }
      // the same count from the mission files, not from the catalogue: 214 radio lines + 99 sections + the rest
      expect(paths).toBeGreaterThan(500);
    });
    it('is the last key of an entry, and is not text: applying the catalogue still changes nothing', () => {
      for (const [id, e] of entries()) expect(Object.keys(e).at(-1), id).toBe('src');
    });
    it('goes red when a hash is altered, dropped or invented', () => {
      const c = JSON.parse(fileText) as Record<string, Entry>;
      const e = c[missions[0].id];
      const path = Object.keys(e.src ?? {})[0];
      (e.src as Record<string, string>)[path] = '00000000';
      expect(check(c).join('\n')).toContain(`src "${path}" differs from the mission file`);
      delete (e.src as Record<string, string>)[path];
      expect(check(c).join('\n')).toContain(`src "${path}" is missing`);
      (e.src as Record<string, string>).ghost = 'abcdef12';
      expect(check(c).join('\n')).toContain('src "ghost" is not in the mission file (stale)');
    });

    // A fixture non-en locale built from the REAL catalogue and the REAL missions: the English text copied unchanged, hashes carried over.
    const fixtureLocale = (): MissionLocaleOverlay => JSON.parse(fileText) as MissionLocaleOverlay;
    const byId = (ms: M[]): Map<string, M> => new Map(ms.map((m) => [m.id, m]));
    it('a non-en locale copied from the catalogue passes against the missions it was made from', () => {
      expect(overlayFailures('fr/missions.json', fixtureLocale(), byId(missions))).toEqual([]);
    });
    it('goes red when a mission reorders its waves (wave_say is keyed by index)', () => {
      const m = missions.find((x) => x.id === 'beit_sahwan_breach') as M;
      const waves = [...(m.enemy?.waves ?? [])];
      expect(waves[0]?.say && waves[2]?.say, 'the fixture mission needs lines at waves 0 and 2').toBeTruthy();
      [waves[0], waves[2]] = [waves[2], waves[0]];
      const reordered = missions.map((x) => (x.id === m.id ? { ...x, enemy: { ...x.enemy, waves } } : x));
      const out = overlayFailures('fr/missions.json', fixtureLocale(), byId(reordered)) as string[];
      expect(out.filter((f) => f.includes('beit_sahwan_breach') && f.includes('is stale')).sort()).toHaveLength(2);
      expect(out.join('\n')).toContain('"wave_say.0" is stale');
      expect(out.join('\n')).toContain('"wave_say.2" is stale');
    });
    it('goes red when an English line is edited after the translation, for a name-free one-character edit', () => {
      const m = missions.find((x) => x.dispatch !== undefined) as M;
      const edited = missions.map((x) => (x.id === m.id ? { ...x, dispatch: `${x.dispatch}.` } : x));
      const out = overlayFailures('fr/missions.json', fixtureLocale(), byId(edited)) as string[];
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(`mission "${m.id}" overlay "dispatch" is stale`);
    });
  });
});

// The same for unit text: `data/locales/en/units.json` is generated from data/units/**, carries a hash per text, and a copy of it is the fixture locale.
describe('the English unit catalogue (GH-1406 part 5)', () => {
  const jsonIn = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? jsonIn(p) : f.endsWith('.json') ? [p] : [];
    });
  const units = jsonIn(join(ROOT, 'data/units')).map((f) => JSON.parse(readFileSync(f, 'utf8')) as { id: string; name?: string; blurb?: string });
  const unitText = readFileSync(join(ROOT, 'data/locales/en/units.json'), 'utf8');
  const h8 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 8);

  it('has an entry for every shipped unit, with its name, its blurb when it has one, and the hash of each (hand-compared)', () => {
    const c = JSON.parse(unitText) as Record<string, { name?: string; blurb?: string; src: Record<string, string> }>;
    expect(Object.keys(c).sort()).toEqual(units.map((u) => u.id).sort());
    expect(units.length).toBeGreaterThan(40);
    for (const u of units) {
      expect(c[u.id].name, u.id).toBe(u.name);
      expect(c[u.id].blurb, u.id).toBe(u.blurb);
      expect(c[u.id].src.name, u.id).toBe(u.name === undefined ? undefined : h8(u.name));
      expect(c[u.id].src.blurb, u.id).toBe(u.blurb === undefined ? undefined : h8(u.blurb));
    }
  });
  it('is byte-for-byte what the generator writes today, and checks clean', () => {
    expect(unitText).toBe(JSON.stringify(buildEnglishUnits(units), null, 2) + '\n');
    expect(englishUnitFailures('en/units.json', JSON.parse(unitText), units)).toEqual([]);
  });
  it('a locale copied from it passes; one blurb edited in data/units goes red', () => {
    const byId = new Map(units.map((u) => [u.id, u]));
    expect(unitOverlayFailures('fr/units.json', JSON.parse(unitText), byId)).toEqual([]);
    const withBlurb = units.find((u) => u.blurb !== undefined) as { id: string; blurb: string };
    const edited = new Map(byId);
    edited.set(withBlurb.id, { ...(byId.get(withBlurb.id) as object), id: withBlurb.id, blurb: `${withBlurb.blurb}!` });
    const out = unitOverlayFailures('fr/units.json', JSON.parse(unitText), edited) as string[];
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(`unit "${withBlurb.id}" overlay blurb is stale`);
  });
});

// Place names (GH-1406): `data/locales/en/places.json` is generated from data/campaign/world.json and data/maps/*.json, carries a hash per name,
// and a copy of it is the fixture locale. The oracles are LITERALS and hand reads of the source files, never the builder's own output.
describe('the English place catalogue (GH-1406)', () => {
  interface W { name: string; regions: { id: string; name: string; towns: { id: string; name: string }[] }[] }
  interface P { world: string; regions: Record<string, string>; towns: Record<string, string>; maps: Record<string, string>; src: Record<string, string> }
  const world = JSON.parse(readFileSync(join(ROOT, 'data/campaign/world.json'), 'utf8')) as W;
  const mapFiles = readdirSync(join(ROOT, 'data/maps')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'data/maps', f), 'utf8')) as { id: string; name: string });
  const placeText = readFileSync(join(ROOT, 'data/locales/en/places.json'), 'utf8');
  const en = (): P => JSON.parse(placeText) as P;
  const h8 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 8);
  const byId = new Map(mapFiles.map((m) => [m.id, m]));
  const towns = world.regions.flatMap((r) => r.towns);
  const parity = (c: unknown, mf = mapFiles, w: unknown = world): string[] => englishPlaceFailures('en/places.json', c, w as object, mf) as string[];
  const overlay = (c: unknown, opts: { staged?: boolean; lag?: string[] } = {}, mm = byId, w: unknown = world): string[] =>
    placeOverlayFailures('fr/places.json', c, w as object, mm, opts) as string[];

  it('has the world, every region, every town and every map, each equal to its source file (hand-compared, with literal census)', () => {
    const c = en();
    expect(mapFiles).toHaveLength(51);
    expect(world.regions).toHaveLength(3);
    expect(towns).toHaveLength(10);
    expect(c.world).toBe(world.name);
    expect(c.world).toBe('The Sahar Basin');
    expect(Object.keys(c.regions)).toEqual(world.regions.map((r) => r.id));
    expect(Object.keys(c.towns)).toEqual(towns.map((t) => t.id));
    expect(Object.keys(c.maps).sort()).toEqual(mapFiles.map((m) => m.id).sort());
    for (const r of world.regions) expect(c.regions[r.id], r.id).toBe(r.name);
    for (const t of towns) expect(c.towns[t.id], t.id).toBe(t.name);
    for (const m of mapFiles) expect(c.maps[m.id], m.id).toBe(m.name);
    expect(c.src.world).toBe(h8(world.name));
    for (const r of world.regions) expect(c.src[`regions.${r.id}`], r.id).toBe(h8(r.name));
    for (const t of towns) expect(c.src[`towns.${t.id}`], t.id).toBe(h8(t.name));
    for (const m of mapFiles) expect(c.src[`maps.${m.id}`], m.id).toBe(h8(m.name));
    expect(Object.keys(c.src)).toHaveLength(1 + 3 + 10 + 51);
  });

  it('is byte-for-byte what the generator writes today, and checks clean', () => {
    expect(placeText).toBe(JSON.stringify(buildEnglishPlaces(world, mapFiles), null, 2) + '\n');
    expect(parity(en())).toEqual([]);
  });

  describe('the parity check fails on each fault (constructed, then run)', () => {
    it('a missing file', () => expect(parity(null).join('\n')).toContain('is missing or is not a JSON object'));
    it('a missing map (the catalogue lacks one the data has)', () => {
      const c = en();
      const gone = Object.keys(c.maps)[0];
      delete c.maps[gone];
      expect(parity(c)).toContain(`en/places.json: no entry for map "${gone}"`);
    });
    it('a map the data no longer has (stale)', () => {
      const c = en();
      c.maps.ghost_map = 'Ghost';
      expect(parity(c).join('\n')).toContain('has a map "ghost_map", which is not in data/maps (stale)');
    });
    it('a map renamed in its file after the template was written (drift)', () => {
      const m = mapFiles[0];
      const out = parity(en(), [{ ...m, name: `${m.name}!` }, ...mapFiles.slice(1)]);
      expect(out.join('\n')).toContain(`map "${m.id}" differs from data/maps`);
      expect(out.join('\n')).toContain(`src.maps.${m.id} is not the hash of its English name`);
    });
    it('a region, a town and the world drifting', () => {
      const w = JSON.parse(JSON.stringify(world)) as W;
      w.name = 'Renamed';
      w.regions[0].name = 'Renamed region';
      w.regions[0].towns[0].name = 'Renamed town';
      const out = parity(en(), mapFiles, w).join('\n');
      expect(out).toContain('world differs from world.json');
      expect(out).toContain(`region "${w.regions[0].id}" differs from world.json`);
      expect(out).toContain(`town "${w.regions[0].towns[0].id}" differs from world.json`);
    });
    it('a missing, wrong or left-over hash, and a key the overlay does not read', () => {
      const c = en();
      const id = Object.keys(c.maps)[0];
      delete c.src[`maps.${id}`];
      c.src[`towns.${towns[0].id}`] = '00000000';
      c.src['maps.ghost'] = 'deadbeef';
      (c as unknown as Record<string, unknown>).blurb = 'x';
      const out = parity(c).join('\n');
      expect(out).toContain(`src.maps.${id} is missing`);
      expect(out).toContain(`src.towns.${towns[0].id} is not the hash of its English name`);
      expect(out).toContain('src has "maps.ghost", which names nothing (stale)');
      expect(out).toContain('carries "blurb", which the overlay does not read');
    });
  });

  describe('a translator\'s file (placeOverlayFailures)', () => {
    const fr = (): P => {
      const c = en();
      return { ...c, world: 'Le bassin du Sahar', regions: { marj: 'La bande de Marj' }, towns: { beit_sahwan: 'Beit Sahwan' }, maps: { bir_tarsha: 'Puits de Tarsha' }, src: { world: c.src.world, 'regions.marj': c.src['regions.marj'], 'towns.beit_sahwan': c.src['towns.beit_sahwan'], 'maps.bir_tarsha': c.src['maps.bir_tarsha'] } };
    };
    it('a copy of the English template passes (the translator copies it and changes the values), and so does a partial translation', () => {
      expect(overlay(en())).toEqual([]);
      expect(overlay(fr())).toEqual([]);
      expect(overlay({})).toEqual([]);
      expect(overlay(null)).toEqual([]);
    });
    it('refuses an unknown region, town and map id', () => {
      const c = fr();
      c.regions.nowhere = 'X';
      c.towns.nowhere = 'Y';
      c.maps.nowhere = 'Z';
      const out = overlay(c).join('\n');
      expect(out).toContain('overlay names region "nowhere", which is not in world.json');
      expect(out).toContain('overlay names town "nowhere", which is not in world.json');
      expect(out).toContain('overlay names map "nowhere", which is not in data/maps');
    });
    it('refuses a value that is empty, not a string, untrimmed, or over 48 characters; and the cap is exact', () => {
      for (const bad of ['', '  ', 7, null, ' x', 'x ']) {
        const c = fr();
        (c.maps as Record<string, unknown>).bir_tarsha = bad;
        expect(overlay(c).length, JSON.stringify(bad)).toBeGreaterThan(0);
      }
      const c = fr();
      c.maps.bir_tarsha = 'x'.repeat(49);
      expect(overlay(c).join('\n')).toContain('is 49 characters; a place name is capped at 48');
      c.maps.bir_tarsha = 'x'.repeat(48);
      c.src['maps.bir_tarsha'] = en().src['maps.bir_tarsha'];
      expect(overlay(c)).toEqual([]);
      const w = fr();
      w.world = '';
      expect(overlay(w).join('\n')).toContain('world must be a non-empty string');
    });
    it('refuses a key it does not read, and a table that is not an object', () => {
      expect(overlay({ ...fr(), blurb: 'x' }).join('\n')).toContain('overlay carries "blurb"');
      expect(overlay({ ...fr(), maps: ['bir_tarsha'] }).join('\n')).toContain('maps is not an object');
      expect(overlay([]).join('\n')).toContain('is not a JSON object');
    });
    it('a translated name with NO src, or a src that is not the English hash: lag when staged (collected, not failed), a failure when shipped', () => {
      const missing = fr();
      delete missing.src['maps.bir_tarsha'];
      const wrong = fr();
      wrong.src['towns.beit_sahwan'] = '00000000';
      for (const c of [missing, wrong]) {
        const lag: string[] = [];
        expect(overlay(c, { staged: true, lag })).toEqual([]);
        expect(lag).toHaveLength(1);
        expect(overlay(c, { staged: false })).toHaveLength(1);
        expect(overlay(c)).toHaveLength(1);
      }
      expect(overlay(missing).join('\n')).toContain(`carries no src hash for it: copy src.maps.bir_tarsha (${en().src['maps.bir_tarsha']})`);
      expect(overlay(wrong).join('\n')).toContain('overlay towns.beit_sahwan is stale: it was translated from English 00000000');
    });
    it('a name edited in the data after translation goes stale, in a map, a town and the world', () => {
      const w = JSON.parse(JSON.stringify(world)) as W;
      w.name += '!';
      w.regions[0].towns[0].name += '!';
      const mm = new Map(byId);
      mm.set('bir_tarsha', { ...(byId.get('bir_tarsha') as object), id: 'bir_tarsha', name: 'Bir Tarsha!' });
      const lag: string[] = [];
      expect(overlay(fr(), { staged: true, lag }, mm, w)).toEqual([]);
      expect(lag).toHaveLength(3);
      expect(overlay(fr(), { staged: false }, mm, w)).toHaveLength(3);
    });
    it('STAGED still fails on what is wrong rather than stale: a bad hash shape, a hash for an untranslated name, an unknown id, an over-cap name', () => {
      const lag: string[] = [];
      const shape = fr();
      shape.src['maps.bir_tarsha'] = 'XYZ';
      expect(overlay(shape, { staged: true, lag }).join('\n')).toContain('src.maps.bir_tarsha is not 8 lowercase hex characters');
      const upper = fr();
      upper.src['maps.bir_tarsha'] = en().src['maps.bir_tarsha'].toUpperCase().replace(/[0-9]/g, 'A');
      expect(overlay(upper, { staged: true, lag }).join('\n')).toContain('not 8 lowercase hex characters');
      const extra = fr();
      extra.src['maps.tel_marum'] = en().src['maps.tel_marum'];
      expect(overlay(extra, { staged: true, lag }).join('\n')).toContain('overlay src names maps.tel_marum, which this file does not translate');
      const nonObjectSrc = { ...fr(), src: 'x' };
      expect(overlay(nonObjectSrc, { staged: true, lag }).join('\n')).toContain('overlay src is not an object');
      const ghost = fr();
      ghost.maps.nowhere = 'Z';
      expect(overlay(ghost, { staged: true, lag }).join('\n')).toContain('map "nowhere"');
      const long = fr();
      long.maps.bir_tarsha = 'x'.repeat(49);
      expect(overlay(long, { staged: true, lag }).join('\n')).toContain('capped at 48');
    });
  });
});
