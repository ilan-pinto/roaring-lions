// GH-1406 part 2: `data/locales/en/missions.json` is the GENERATED English template. These checks prove it can neither miss a string nor
// keep a stale one, and that it is not an overlay the game fetches. The oracle reads the mission files itself and compares by hand; it
// does not call the builder to decide what the file should say.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMissionLocale, type MissionLocaleOverlay } from '@lions/data';
// @ts-expect-error: a plain .mjs module with no declarations, like the other validators the tools tests import.
import { buildEnglishCatalogue, englishCatalogueFailures, englishMissionText } from '../validate_narrative.mjs';

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
});
