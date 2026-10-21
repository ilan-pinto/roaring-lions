import { describe, expect, it } from 'vitest';
import { fx, type StructureType, type WorksRefusal } from '@lions/sim';
import { refusalKey, worksPreview, worksShapeOf, type WorksShape } from './works-model';

// Oracles are literals read off data/structures.json (radius 4 medic and
// workshop, sight 10 and tunnel radius 10 intel centre), never imported.
const MEDIC: WorksShape = { fw: 2, fh: 2, area: [{ radius: 4 }], sensor: null };
const INTEL: WorksShape = { fw: 2, fh: 2, area: [], sensor: { sight: 10, tunnelRadius: 10 } };
const WORKSHOP: WorksShape = { fw: 2, fh: 2, area: [{ radius: 4 }, { radius: 4 }], sensor: null };
const OUTPOST: WorksShape = { fw: 2, fh: 2, area: [], sensor: null };

describe('worksPreview', () => {
  it('the intel centre draws a dashed sight ring and a dotted tunnel ring, both at 10', () => {
    const p = worksPreview(INTEL, 5, 7, null);
    expect(p.rings).toEqual([
      { cx: 6, cy: 8, radius: 10, style: 'dashed' },
      { cx: 6, cy: 8, radius: 10, style: 'dotted' },
    ]);
  });

  it('the medic draws one dashed ring at 4, and the workshop’s two equal areas draw once', () => {
    expect(worksPreview(MEDIC, 0, 0, null).rings).toEqual([{ cx: 1, cy: 1, radius: 4, style: 'dashed' }]);
    expect(worksPreview(WORKSHOP, 0, 0, null).rings).toHaveLength(1);
  });

  it('a type with no aura area or sensor draws no ring', () => {
    expect(worksPreview(OUTPOST, 3, 3, null).rings).toEqual([]);
  });

  it('the pad is the footprint at the top-left tile, and valid only with no reason', () => {
    expect(worksPreview(MEDIC, 9, 4, null).pad).toEqual({ x: 9, y: 4, w: 2, h: 2, valid: true });
    for (const r of ['off_map', 'blocked', 'no_footing', 'not_level', 'overlap', 'seals_passage', 'locked', 'none_left'] as const) {
      const p = worksPreview(MEDIC, 9, 4, r);
      expect(p.pad.valid).toBe(false);
      expect(p.tooltipKey).toBe(`works.refuse.${r}`);
    }
    expect(worksPreview(MEDIC, 9, 4, null).tooltipKey).toBeNull();
  });

  it('draws no fill: neither the pad nor a ring carries a fill key (treatment B)', () => {
    const p = worksPreview(INTEL, 1, 1, null);
    expect(Object.keys(p.pad).sort()).toEqual(['h', 'valid', 'w', 'x', 'y']);
    for (const ring of p.rings) expect(Object.keys(ring).sort()).toEqual(['cx', 'cy', 'radius', 'style']);
  });
});

describe('refusalKey', () => {
  it('names every refusal the runtime can return', () => {
    const all: Record<WorksRefusal, string> = {
      not_listed: 'works.refuse.not_listed',
      none_left: 'works.refuse.none_left',
      locked: 'works.refuse.locked',
      unaffordable: 'works.refuse.unaffordable',
      needs_engineers: 'works.refuse.needs_engineers',
      off_map: 'works.refuse.off_map',
      blocked: 'works.refuse.blocked',
      no_footing: 'works.refuse.no_footing',
      not_level: 'works.refuse.not_level',
      overlap: 'works.refuse.overlap',
      seals_passage: 'works.refuse.seals_passage',
    };
    for (const [r, key] of Object.entries(all)) expect(refusalKey(r as WorksRefusal)).toBe(key);
  });
});

describe('worksShapeOf', () => {
  it('roots the squared radii back to the authored tiles', () => {
    const type = {
      buildable: { fw: 2, fh: 2 },
      aura: {
        area: [{ radiusSq: fx.from(16) }],
        sensor: { sight: fx.from(10), tunnelRadiusSq: fx.from(100) },
      },
    } as unknown as StructureType;
    expect(worksShapeOf(type)).toEqual({ fw: 2, fh: 2, area: [{ radius: 4 }], sensor: { sight: 10, tunnelRadius: 10 } });
  });
});

describe('worksMarkSvg', () => {
  it('draws four distinct currentColor marks with no colour literal', async () => {
    const { worksMarkSvg, WORKS_MARK_IDS } = await import('./mark');
    expect(WORKS_MARK_IDS).toEqual(['kdf_medic_station', 'kdf_outpost', 'kdf_intel_centre', 'kdf_workshop']);
    const svgs = WORKS_MARK_IDS.map((id) => worksMarkSvg(id, 16));
    expect(new Set(svgs).size).toBe(4);
    for (const svg of svgs) {
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3,6}|rgb/);
    }
  });
});
