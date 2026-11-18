// B6-6: the synchronous content manifest is generated from the data, and `validate:data` fails on drift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapManifest, missionManifest } from '@lions/data';
import { maps, missions } from '@lions/data/content';
import { MANIFEST_PATH, contentManifestFailures, missionSummary, renderContentManifest } from '../content_manifest.mjs';

const ROOT = join(__dirname, '../..');
const onDisk = readFileSync(join(ROOT, MANIFEST_PATH), 'utf8');

describe('the content manifest drift check', () => {
  it('is clean on the checked-in manifest: the file is what the data generates', () => {
    expect(contentManifestFailures(ROOT)).toEqual([]);
    expect(renderContentManifest(ROOT)).toBe(onDisk);
  });

  it('goes red on a hand-edit of the manifest, naming the line and the fix', () => {
    const edited = onDisk.replace('"name":"Khan Rafid"', '"name":"Khan Rafid!"');
    expect(edited).not.toBe(onDisk);
    const f = contentManifestFailures(ROOT, edited);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/stale against the data \(first difference at line \d+\); run `pnpm content:manifest -- --write`/);
  });

  it('goes red on a missing loader line and on an added mission field', () => {
    expect(contentManifestFailures(ROOT, onDisk.replace(/^ {2}tutorial_ground: \(\) => import\([^\n]*\n/m, ''))).toHaveLength(1);
    expect(contentManifestFailures(ROOT, onDisk.replace('"tagged":[]', '"tagged":[],"x":1'))).toHaveLength(1);
  });
});

describe('the manifest against the eager registry (literal field names, not the generator)', () => {
  it('names every map and mission, in the registry order (the Free Play picker and the versus list read it)', () => {
    expect(Object.keys(mapManifest)).toEqual(Object.keys(maps));
    expect(Object.keys(missionManifest)).toEqual(Object.keys(missions));
    expect(Object.keys(mapManifest).length).toBeGreaterThanOrEqual(40);
    expect(Object.keys(missionManifest).length).toBeGreaterThanOrEqual(30);
  });

  it("carries each map's name, and each mission's name, map, objectives' type and primary, and ledger contract", () => {
    for (const [id, m] of Object.entries(maps) as [string, { name: string }][]) {
      expect((mapManifest as Record<string, { name: string }>)[id]).toEqual({ name: m.name });
    }
    for (const [id, raw] of Object.entries(missions)) {
      const m = raw as unknown as { name: string; map: { file: string }; objectives: { type: string; primary: boolean }[]; ledger: { requires: string[]; produces: string[] } };
      const s = (missionManifest as Record<string, unknown>)[id] as Record<string, unknown>;
      expect(s.name).toBe(m.name);
      expect(s.map).toEqual({ file: m.map.file });
      expect(s.objectives).toEqual(m.objectives.map((o) => ({ type: o.type, primary: o.primary })));
      expect(s.ledger).toEqual({ requires: m.ledger.requires, produces: m.ledger.produces });
    }
  });

  it('carries every tagged placement as { unit, tag }, found wherever it sits (garrison, waves, trigger spawns, passengers)', () => {
    // An independent oracle: a JSON text scan for `"tag":` beside `"unit":`, not the generator's walk.
    for (const [id, raw] of Object.entries(missions)) {
      const text = JSON.stringify(raw);
      const tags = new Set([...text.matchAll(/"tag":"([^"]+)"/g)].map((x) => x[1]));
      const s = (missionManifest as Record<string, { tagged: readonly { unit: string; tag: string }[] }>)[id];
      expect(new Set(s.tagged.map((p) => p.tag)), id).toEqual(tags);
    }
    // The walk is not vacuous: the Beit Sahwan recon tags are read by later missions (carryReaderOf, GH-912 G-T).
    const tagged = Object.values(missionManifest).filter((s) => s.tagged.length > 0).length;
    expect(tagged).toBeGreaterThanOrEqual(5);
    expect(missionSummary({ a: [{ b: { unit: 'x', tag: 't' } }, { unit: 'y' }, { unit: 'x', tag: 't' }] }).tagged).toEqual([{ unit: 'x', tag: 't' }]);
  });
});
