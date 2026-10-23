import { describe, expect, it } from 'vitest';
import { fx, type StructureType, type WorksRefusal } from '@lions/sim';
import {
  auraChipKey,
  refusalKey,
  siteOfSelection,
  siteSelection,
  worksCardModel,
  worksEventNotice,
  worksLegendKeys,
  worksPreview,
  worksRings,
  worksShapeOf,
  type WorksShape,
} from './works-model';

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
  it('draws five distinct currentColor marks with no colour literal', async () => {
    const { worksMarkSvg, WORKS_MARK_IDS } = await import('./mark');
    expect(WORKS_MARK_IDS).toEqual(['kdf_medic_station', 'kdf_outpost', 'kdf_intel_centre', 'kdf_aid_post', 'kdf_workshop']);
    const svgs = WORKS_MARK_IDS.map((id) => worksMarkSvg(id, 16));
    expect(new Set(svgs).size).toBe(5);
    for (const svg of svgs) {
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3,6}|rgb/);
    }
  });
});

describe('works rings, legend, chips, card, feed', () => {
  it('worksRings centres on the given point (a standing works), same set as the preview', () => {
    expect(worksRings(INTEL, 12, 9)).toEqual([
      { cx: 12, cy: 9, radius: 10, style: 'dashed' },
      { cx: 12, cy: 9, radius: 10, style: 'dotted' },
    ]);
    expect(worksRings(OUTPOST, 12, 9)).toEqual([]);
  });

  it('the legend names sight and tunnel for the intel centre only', () => {
    expect(worksLegendKeys(INTEL)).toEqual(['dock.works.legend.sight', 'dock.works.legend.tunnel']);
    expect(worksLegendKeys(MEDIC)).toEqual([]);
  });

  // REGEN_FRAC is 16 (0.00024 of hp a tick): the literal, not the import.
  it('the medic chip needs a foot unit, a heal rate ABOVE the field-regen floor, and hp below max', () => {
    const base = { domain: 0, healRate: 100, hp: 5, maxHp: 10, compAt: 0, componentKilled: false };
    expect(auraChipKey(base)).toBe('hud.card.chip.medic');
    expect(auraChipKey({ ...base, healRate: 16 })).toBeNull(); // field regen alone does not light it
    expect(auraChipKey({ ...base, healRate: 0 })).toBeNull();
    expect(auraChipKey({ ...base, hp: 10 })).toBeNull();
  });

  it('the workshop chip is for a vehicle: healed, or a killed component in a repair area', () => {
    const base = { domain: 1, healRate: 100, hp: 5, maxHp: 10, compAt: 0, componentKilled: false };
    expect(auraChipKey(base)).toBe('hud.card.chip.workshop');
    expect(auraChipKey({ ...base, healRate: 0, compAt: 600, componentKilled: true })).toBe('hud.card.chip.workshop');
    expect(auraChipKey({ ...base, healRate: 0, compAt: 600, componentKilled: false })).toBeNull();
    expect(auraChipKey({ ...base, domain: 0 })).toBe('hud.card.chip.medic');
  });

  it('the card refund is (cost x (ONE - progress)) >> 16, whole units', () => {
    // 300 logistics, 25% built: 300 * 0.75 = 225.
    expect(worksCardModel('Workshop', 16384, 65536, 300)).toEqual({ name: 'Workshop', percent: 25, refund: 225 });
    expect(worksCardModel('Workshop', 0, 65536, 300).refund).toBe(300);
    // 10 logistics, one third built (21845): 10 * 43691 >> 16 = 6 (truncated).
    expect(worksCardModel('X', 21845, 65536, 10).refund).toBe(6);
  });

  it('the feed escapes a structure name', () => {
    const started = { kind: 'works', tick: 1, phase: 'started', typeId: 'x', site: 0, builder: 3, refund: 0 } as const;
    const [html] = worksEventNotice(started, '<b>Tent</b>')!;
    expect(html).not.toContain('<b>Tent</b>');
    expect(html).toContain('&lt;b&gt;Tent&lt;/b&gt;');
    expect(html).toContain('works begun');
  });

  it('a refusal names its reason', () => {
    const refused = { kind: 'works', tick: 1, phase: 'refused', typeId: 'x', site: -1, builder: -1, refund: 100, reason: 'overlap' } as const;
    expect(worksEventNotice(refused, 'Tent')![0]).toContain('occupied');
  });
});

describe('the works selection encoding', () => {
  it('a structure row and nothing are never a site; a site round-trips', () => {
    expect(siteOfSelection(-1)).toBe(-1);
    expect(siteOfSelection(0)).toBe(-1);
    expect(siteOfSelection(12)).toBe(-1);
    expect(siteSelection(0)).toBe(-2);
    expect(siteSelection(5)).toBe(-7);
    expect(siteOfSelection(-2)).toBe(0);
    expect(siteOfSelection(-7)).toBe(5);
  });
});
