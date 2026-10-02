import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyReason,
  invoiceClock,
  invoiceLines,
  invoiceSummary,
  lineText,
  placeNamesFor,
  reasonLabel,
  type PlaceNames,
} from './conduct-invoice';

const ROOT = new URL('../../../../', import.meta.url).pathname;

/**
 * Every reason `stepRoe` can emit, written out literally with a sample place.
 * The classifier parses strings the sim owns, so this list is the contract,
 * and the first tests below prove each template still exists in the sim's own
 * source -- mutate one there and this file goes red.
 */
const TEMPLATES = [
  { source: '} destroyed`', sample: 'House destroyed', cause: 'destroyed', place: 'house' },
  { source: "'civilian casualties'", sample: 'civilian casualties', cause: 'civilians' },
  {
    source: '`fire into protected structure (${zoneName})`',
    sample: 'fire into protected structure (z_clinic)',
    cause: 'struck',
    place: 'z_clinic',
  },
  {
    source: '`strike into protected structure (${zoneName})`',
    sample: 'strike into protected structure (z_clinic)',
    cause: 'strike',
    place: 'z_clinic',
  },
  {
    source: "'strike called danger-close to civilians'",
    sample: 'strike called danger-close to civilians',
    cause: 'danger_close',
  },
  {
    source: "'heavy ordnance danger-close to civilians'",
    sample: 'heavy ordnance danger-close to civilians',
    cause: 'danger_close',
  },
] as const;

const NAMES: PlaceNames = {
  zone: (z) => (z === 'z_clinic' ? 'Clinic' : null),
  structure: (s) => (s === 'house' ? 'House' : null),
};

describe('the sim reason templates', () => {
  const source = readFileSync(`${ROOT}packages/sim/src/mission.ts`, 'utf8');
  const from = source.indexOf('private stepRoe(');
  const roe = source.slice(from, source.indexOf('\n  private ', from + 10));
  for (const tpl of TEMPLATES) {
    it(`stepRoe still emits ${tpl.source}`, () => {
      expect(roe).toContain(tpl.source);
    });
    it(`classifies "${tpl.sample}" as ${tpl.cause}`, () => {
      const r = classifyReason(tpl.sample);
      expect(r.cause).toBe(tpl.cause);
      expect(r.place).toBe('place' in tpl ? tpl.place : undefined);
    });
  }
  it('stepRoe deducts in exactly as many places as there are templates', () => {
    // A seventh `deduct(` call site is a reason nobody has listed here yet.
    // (The arrow's own declaration is `const deduct = (`, not a call.)
    expect(roe.match(/\bdeduct\(/g)?.length).toBe(TEMPLATES.length);
  });
  it('an unknown reason is "other" and keeps the sim words', () => {
    expect(classifyReason('looting').cause).toBe('other');
    expect(reasonLabel('looting', NAMES)).toBe('looting');
  });
});

describe('invoice lines', () => {
  it('names the place, not the zone id', () => {
    expect(reasonLabel('fire into protected structure (z_clinic)', NAMES)).toBe('Clinic struck');
    expect(reasonLabel('House destroyed', NAMES)).toBe('House destroyed');
    // No structure there: the zone id, never nothing.
    expect(reasonLabel('fire into protected structure (ward)', NAMES)).toBe('ward struck');
  });
  it('groups by cause and place, sums, and keeps first-occurrence order and times', () => {
    const lines = invoiceLines(
      [
        { penalty: 3, reason: 'heavy ordnance danger-close to civilians', tick: 1440 },
        { penalty: 5, reason: 'fire into protected structure (z_clinic)', tick: 820 },
        { penalty: 5, reason: 'fire into protected structure (z_clinic)', tick: 1040 },
        { penalty: 3, reason: 'strike called danger-close to civilians', tick: 1500 },
      ],
      NAMES
    );
    expect(lines.map((l) => [l.label, l.count, l.total])).toEqual([
      ['Heavy fire near civilians', 2, 6],
      ['Clinic struck', 2, 10],
    ]);
    expect(lines[1].ticks).toEqual([820, 1040]);
    expect(lineText(lines[1])).toBe('Clinic struck ×2 −10');
    expect(lineText({ ...lines[1], count: 1, total: 5 })).toBe('Clinic struck −5');
  });
  it('the end-screen summary keeps the worst line and counts the rest', () => {
    const lines = invoiceLines(
      [
        { penalty: 3, reason: 'civilian casualties' },
        { penalty: 5, reason: 'fire into protected structure (z_clinic)' },
        { penalty: 5, reason: 'fire into protected structure (z_clinic)' },
      ],
      NAMES
    );
    expect(invoiceSummary(lines)).toBe('Clinic struck ×2 −10 · +1 more');
    expect(invoiceSummary([])).toBe('');
  });
  it('clocks a tick as m:ss', () => {
    expect(invoiceClock(820)).toBe('0:41');
    expect(invoiceClock(20 * 90)).toBe('1:30');
  });
});

describe('placeNamesFor', () => {
  // 4 wide: a clinic at tiles 5,6 (row 1), a house at 2 (row 0).
  const names = placeNamesFor(
    {
      width: 4,
      zones: { z_clinic: [1, 1, 2, 1], z_empty: [0, 3, 4, 1] },
      structures: [
        { type: 'clinic', tiles: [5, 6] },
        { type: 'house', tiles: [2] },
      ],
    },
    { clinic: { name: 'Clinic' }, house: { name: 'House' } }
  );
  it('resolves a zone to the structure standing in it', () => {
    expect(names.zone('z_clinic')).toBe('Clinic');
  });
  it('answers null for an empty zone or an unknown one, so the line names the id', () => {
    expect(names.zone('z_empty')).toBeNull();
    expect(names.zone('nowhere')).toBeNull();
    expect(reasonLabel('fire into protected structure (z_empty)', names)).toBe('z_empty struck');
  });
  it('names a structure type from the catalogue', () => {
    expect(names.structure('house')).toBe('House');
  });
});
