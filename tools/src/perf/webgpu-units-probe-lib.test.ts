import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BLAST_SUBJECTS } from './blast-captures';
import { DEBUG_LAYERS } from '../../../packages/render/src/three/debug-layers';
import {
  PORTED_PROBE_SUBJECTS,
  PROBE_SUBJECTS,
  allRefusals,
  emptySubjectRefusal,
  groupMoments,
  legacyDeltaRefusals,
  matchedCell,
  mixedBackendRefusals,
  momentKey,
  nodeCell,
  probeTable,
  probeVerdict,
  notRestoredRefusals,
  repaintControlRefusals,
  zeroObjectRefusals,
  selectSubjects,
  shaderMaterialRefusals,
  visibleShaderObjects,
  type SubjectReading,
} from './webgpu-units-probe-lib';

const d = (mean: number, px = mean > 0 ? 10 : 0) => ({ meanAbsChannelDelta: mean, changedPixels: px });
const reading = (over: Partial<SubjectReading> = {}): SubjectReading => ({
  id: 's',
  layer: 'overlays',
  band: 'tight',
  deltas: { L: d(2), Lm: d(2), F: d(2), G: d(2) },
  controlPx: { L: 0, F: 0, G: 0 },
  visibleShaders: { F: [], G: [] },
  ...over,
});

describe('G1: probeVerdict against literals', () => {
  it('r 1.00 is in for tight, and 0.80 is out for loose', () => {
    expect(probeVerdict({ band: 'tight', node: d(10), legacyMatched: d(10) })).toEqual({ r: 1, band: 'in', dead: false });
    const loose = probeVerdict({ band: 'loose', node: d(8), legacyMatched: d(10) });
    expect(loose.r).toBeCloseTo(0.8, 12);
    expect(loose.band).toBe('out');
    expect(loose.dead).toBe(false);
  });

  it('the band edges are inclusive: 0.95 and 1.05 are in for tight, 0.949 is out', () => {
    expect(probeVerdict({ band: 'tight', node: d(9.5), legacyMatched: d(10) }).band).toBe('in');
    expect(probeVerdict({ band: 'tight', node: d(10.5), legacyMatched: d(10) }).band).toBe('in');
    expect(probeVerdict({ band: 'tight', node: d(9.49), legacyMatched: d(10) }).band).toBe('out');
    expect(probeVerdict({ band: 'ao', node: d(7), legacyMatched: d(10) }).band).toBe('in');
  });

  it('a node delta of 0 with no floor is DEAD, with r 0 and the band out', () => {
    expect(probeVerdict({ band: 'loose', node: d(0), legacyMatched: d(10) })).toEqual({ r: 0, band: 'out', dead: true });
  });

  it('a zero band at 0 is not DEAD (a layer expected to move nothing is not dead for it)', () => {
    expect(probeVerdict({ band: 'zero', node: d(0), legacyMatched: d(0) })).toEqual({ r: null, band: 'in', dead: false });
    expect(probeVerdict({ band: 'zero', node: d(0), legacyMatched: d(3) }).band).toBe('out');
  });

  it('a delta EQUAL to the floor is not DEAD; one under it is', () => {
    const floor = 0.25;
    expect(probeVerdict({ band: 'loose', node: d(0.25), legacyMatched: d(0.25), nodeFloor: floor }).dead).toBe(false);
    expect(probeVerdict({ band: 'loose', node: d(0.2499), legacyMatched: d(0.25), nodeFloor: floor }).dead).toBe(true);
  });

  it('a missing arm judges nothing: no r, no band, not dead', () => {
    expect(probeVerdict({ band: 'tight', node: null, legacyMatched: d(5) })).toEqual({ r: null, band: null, dead: false });
    expect(probeVerdict({ band: 'tight', node: d(5), legacyMatched: null })).toEqual({ r: null, band: null, dead: false });
    // Legacy-matched read 0 (an unported subject): the ratio is undefined, never 0 or Infinity.
    expect(probeVerdict({ band: 'tight', node: d(5), legacyMatched: d(0) })).toEqual({ r: null, band: null, dead: false });
  });

  it('a NaN node delta is dead, never "in"', () => {
    const v = probeVerdict({ band: 'tight', node: d(Number.NaN), legacyMatched: d(5) });
    expect(v.dead).toBe(true);
    expect(v.band).not.toBe('in');
  });
});

describe('G2: a vacuous subject is refused', () => {
  it('a plain-legacy delta of 0 refuses, and names the subject', () => {
    const out = legacyDeltaRefusals([reading({ id: 'dead-one', deltas: { L: d(0), Lm: d(0), F: d(0), G: d(0) } })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('dead-one');
  });

  it('a NaN or missing legacy reading refuses (the stub that returns r = NaN and exit 0)', () => {
    expect(legacyDeltaRefusals([reading({ deltas: { L: d(Number.NaN, 5) } })])).toHaveLength(1);
    expect(legacyDeltaRefusals([reading({ deltas: {} })])).toHaveLength(1);
  });

  it('it reads the UNMATCHED arm: an unported subject (matched 0, plain moved) is NOT refused (Ruling P3-R5 i)', () => {
    expect(legacyDeltaRefusals([reading({ deltas: { L: d(3), Lm: d(0), F: d(0), G: d(0) } })])).toEqual([]);
    // ... and the reverse: matched moved but plain read 0 still refuses.
    expect(legacyDeltaRefusals([reading({ deltas: { L: d(0), Lm: d(3) } })])).toHaveLength(1);
  });

  it('a clean run refuses nothing', () => {
    expect(allRefusals('units', PROBE_SUBJECTS.units, [reading()], [{ arm: 'L', backendKind: 'legacy-gl', gpu: 'SwiftShader' }])).toEqual([]);
  });
});

describe('G3: census-hidden objects stay hidden', () => {
  const mesh = (material: unknown, over: Record<string, unknown> = {}) => ({ visible: true, name: 'm', type: 'Mesh', material, children: [], ...over });
  const scene = (...children: unknown[]) => ({ visible: true, type: 'Scene', children });

  it('a visible ShaderMaterial mesh is found, by isShaderMaterial and not by material.type', () => {
    // A RawShaderMaterial's `type` is "RawShaderMaterial", and three sets isShaderMaterial on both.
    const raw = { isShaderMaterial: true, type: 'RawShaderMaterial', visible: true };
    expect(visibleShaderObjects(scene(mesh(raw, { name: 'muzzle' })))).toEqual([expect.stringMatching(/^muzzle<Mesh> mat=RawShaderMaterial ro=0 n=1 \^Scene$/)]);
    const plain = { isShaderMaterial: true, type: 'ShaderMaterial', visible: true };
    expect(visibleShaderObjects(scene(mesh(plain, { name: 'plume' })))).toEqual([expect.stringMatching(/^plume</)]);
  });

  it('a hidden object, a hidden ancestor, a hidden material and a standard material are not visible shader objects', () => {
    const sh = { isShaderMaterial: true, type: 'ShaderMaterial', visible: true };
    expect(visibleShaderObjects(scene(mesh(sh, { visible: false })))).toEqual([]);
    expect(visibleShaderObjects(scene({ visible: false, children: [mesh(sh)] }))).toEqual([]);
    expect(visibleShaderObjects(scene(mesh({ ...sh, visible: false })))).toEqual([]);
    expect(visibleShaderObjects(scene(mesh({ isMeshStandardMaterial: true, type: 'MeshStandardMaterial' })))).toEqual([]);
  });

  it('a material array is walked', () => {
    const sh = { isShaderMaterial: true, type: 'RawShaderMaterial' };
    expect(visibleShaderObjects(scene(mesh([{ type: 'MeshBasicMaterial' }, sh], { name: 'two' })))).toEqual([expect.stringMatching(/^two</)]);
  });

  it('the refusal names the arm and the object', () => {
    const out = shaderMaterialRefusals([reading({ id: 'collapse', visibleShaders: { G: ['collapse-shroud'], F: [] } })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('collapse (G)');
    expect(out[0]).toContain('collapse-shroud');
    expect(shaderMaterialRefusals([reading()])).toEqual([]);
  });
});

describe('the other refusals', () => {
  it('a subject whose two zero-time repaints differ refuses, on the legacy arm too', () => {
    expect(repaintControlRefusals([reading({ controlPx: { L: 0, F: 0, G: 3 } })])).toHaveLength(1);
    const legacy = repaintControlRefusals([reading({ controlPx: { L: 40, F: 0, G: 0 } })]);
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toContain('(L)');
    expect(repaintControlRefusals([reading({ controlPx: { L: 0, F: 0, G: 0 } })])).toEqual([]);
  });

  it('a layer whose hide reported 0 objects refuses (the delta is something else\'s), whatever the delta', () => {
    const out = zeroObjectRefusals([reading({ id: 'smoke-own', layer: 'smoke-outline', hidObjects: { L: 0, Lm: 0 } })]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('smoke-own (L)');
    expect(zeroObjectRefusals([reading({ hidObjects: { L: 3, Lm: 3 } })])).toEqual([]);
    expect(zeroObjectRefusals([reading()])).toEqual([]);
  });

  it('a toggle that does not restore the frame refuses', () => {
    const out = notRestoredRefusals([reading({ id: 'wreck-lavi', layer: 'wreck-soot', notRestored: ['L', 'G'] })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('NOT RESTORED');
    expect(out[0]).toContain('L, G');
    expect(notRestoredRefusals([reading({ notRestored: [] })])).toEqual([]);
  });

  it('all three are part of the run\'s refusal list', () => {
    const bad = reading({ controlPx: { L: 5 }, hidObjects: { L: 0 }, notRestored: ['L'] });
    const out = allRefusals('units', PROBE_SUBJECTS.units, [bad], []);
    expect(out.filter((l) => /differ by|reported 0 objects|NOT RESTORED/.test(l))).toHaveLength(3);
  });

  it('a run mixing backends refuses: a fallback arm, or arms on different hardware', () => {
    expect(mixedBackendRefusals([{ arm: 'G', backendKind: 'node-webgl2', gpu: 'SwiftShader' }])).toHaveLength(1);
    const split = mixedBackendRefusals([
      { arm: 'L', backendKind: 'legacy-gl', gpu: 'Apple M2 (Metal)' },
      { arm: 'F', backendKind: 'node-webgl2', gpu: 'ANGLE (Google, Vulkan, SwiftShader)' },
    ]);
    expect(split.join(' ')).toMatch(/different hardware/);
    expect(
      mixedBackendRefusals([
        { arm: 'L', backendKind: 'legacy-gl', gpu: 'SwiftShader' },
        { arm: 'F', backendKind: 'node-webgl2', gpu: 'SwiftShader' },
        { arm: 'G', backendKind: 'node-webgpu', gpu: 'SwiftShader' },
      ])
    ).toEqual([]);
  });

  it('an empty subject list refuses, and short-circuits the rest', () => {
    expect(emptySubjectRefusal('fx', [])).toMatch(/empty/);
    expect(emptySubjectRefusal('fx', [1])).toBeNull();
    expect(allRefusals('fx', [], [reading({ deltas: {} })], [])).toHaveLength(1);
  });

  it('--only on an unknown id throws; a known id selects exactly that subject', () => {
    expect(() => selectSubjects('units', ['moving-lavi-typo'])).toThrow(/names no units subject/);
    expect(selectSubjects('units', ['valley']).map((s) => s.id)).toEqual(['valley']);
    expect(selectSubjects('fx', []).length).toBe(PROBE_SUBJECTS.fx.length);
  });
});

describe('the table', () => {
  it('prints n/a (unported) when the plain arm moved and the matched one did not', () => {
    expect(matchedCell(d(3), d(0))).toBe('n/a (unported)');
    expect(matchedCell(d(3), d(2))).toBe('2.0000 (10 px)');
    expect(matchedCell(d(3), undefined)).toBe('n/a');
  });

  it('labels a non-dead node row pre-port until its subject is ported, and a dead one DEAD', () => {
    const row = { band: 'loose' as const, node: d(2), legacyMatched: d(2) };
    expect(nodeCell('pre-port-id', row)).toContain('pre-port');
    expect(nodeCell('x', { ...row, node: d(0) })).toContain('DEAD');
    PORTED_PROBE_SUBJECTS.add('ported-id');
    try {
      const live = nodeCell('ported-id', row);
      expect(live).not.toContain('pre-port');
      expect(live).toContain('r 1.000 in');
    } finally {
      PORTED_PROBE_SUBJECTS.delete('ported-id');
    }
  });

  it('one line per reading, with the header', () => {
    const t = probeTable([reading(), reading({ id: 't2' })]);
    expect(t).toHaveLength(4);
    expect(t[2]).toContain('| s |');
    expect(t[3]).toContain('| t2 |');
  });
});

describe('the subject lists', () => {
  const all = [...PROBE_SUBJECTS.units, ...PROBE_SUBJECTS.fx];

  it('carry the brief\'s subjects', () => {
    expect(PROBE_SUBJECTS.units.map((s) => s.id)).toEqual([
      'moving-lavi', 'wreck-lavi', 'rain-kdf', 'wounded-squad', 'occluded', 'smoke-own', 'held-house', 'damaged-zone', 'route', 'trail', 'tunnel', 'valley',
    ]);
    const roots = new Set(PROBE_SUBJECTS.fx.map((s) => s.id.split('/')[0]));
    expect([...roots]).toEqual(['mortar-impact', 'vehicle-death', 'lavi-fire', 'smoke-screen', 'collapse', 'tracers', 'atgm', 'beam-swarm']);
  });

  it('have unique ids and a layer the renderer knows (a layer that no longer resolves would throw in the page)', () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    const known = new Set<string>([...DEBUG_LAYERS, 'swarm']);
    for (const s of all) expect(known.has(s.layer), `${s.id}: ${s.layer}`).toBe(true);
  });

  it('every @blast / @firefight moment names a BLAST_SUBJECTS id, and the camera is that subject\'s own', () => {
    for (const s of PROBE_SUBJECTS.fx) {
      const tag = s.setup.find((x) => x.startsWith('@blast:') || x.startsWith('@firefight:'));
      if (tag === undefined) continue;
      const b = BLAST_SUBJECTS.find((x) => x.id === tag.split(':')[1]);
      expect(b, `${s.id}: ${tag}`).toBeDefined();
      expect(s.map).toBe(b?.map ?? 'beit_sahwan_outskirts');
    }
  });

  it('subjects on one moment share a page; different moments do not', () => {
    const groups = groupMoments(PROBE_SUBJECTS.fx);
    const mortar = groups.find((g) => g.some((s) => s.id === 'mortar-impact'));
    expect(mortar?.map((s) => s.id)).toEqual(['mortar-impact', 'mortar-impact/flipbook']);
    const unitGroups = groupMoments(PROBE_SUBJECTS.units);
    expect(unitGroups.find((g) => g.some((s) => s.id === 'trail'))?.map((s) => s.id)).toEqual(['trail', 'tunnel']);
    expect(momentKey(PROBE_SUBJECTS.units[0] as never)).not.toBe(momentKey(PROBE_SUBJECTS.units[1] as never));
  });

  it('every fx subject has a frame-clock advance or is a tick-driven moment, and every setup is non-empty', () => {
    for (const s of all) expect(s.setup.length, s.id).toBeGreaterThan(0);
    for (const s of PROBE_SUBJECTS.fx) if (s.frameSteps !== undefined) expect(s.frameSteps.n).toBeGreaterThan(0);
  });
});

describe('T2b: the subjects name what the renderer actually draws', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it('the tracers subject stages a unit whose weapon class has no travelling round (flat tracer: demolition or interceptor)', () => {
    const t = PROBE_SUBJECTS.fx.find((s) => s.id === 'tracers');
    const unit = /__probe\.spawn\('([a-z_0-9]+)', 0/.exec((t?.setup ?? []).join('\n'))?.[1];
    expect(unit).toBe('demo_squad');
    const json = JSON.parse(readFileSync(join(here, '../../../data/units/kdf/demo_squad.json'), 'utf8')) as { weapons: { type: string }[] };
    expect(json.weapons.some((w) => w.type === 'demolition')).toBe(true);
  });
  it('the plume subject holds the shroud hidden and reads past the first second', () => {
    const p = PROBE_SUBJECTS.fx.find((s) => s.id === 'collapse/smoke-plume');
    expect(p?.alsoHide).toEqual(['collapse-shroud']);
    expect((p?.frameSteps?.n ?? 0) * (p?.frameSteps?.dtMs ?? 0)).toBeGreaterThanOrEqual(1500);
  });
  it('held-house waits for the garrison itself, never for a fixed tick count', () => {
    const h = PROBE_SUBJECTS.units.find((s) => s.id === 'held-house');
    const text = (h?.setup ?? []).join('\n');
    expect(text).toMatch(/garrisonedIn/);
    expect(text).not.toMatch(/step\(120\)/);
  });
  it('held-house and damaged-zone read a crop that keeps their animating figures out (x 426+ and x 403+ of the 1000 px frame)', () => {
    const h = PROBE_SUBJECTS.units.find((x) => x.id === 'held-house')?.crop;
    const d = PROBE_SUBJECTS.units.find((x) => x.id === 'damaged-zone')?.crop;
    expect((h?.[0] ?? 0) + (h?.[2] ?? 1e9)).toBeLessThanOrEqual(426);
    expect((d?.[0] ?? 0) + (d?.[2] ?? 1e9)).toBeLessThanOrEqual(403);
  });
});
