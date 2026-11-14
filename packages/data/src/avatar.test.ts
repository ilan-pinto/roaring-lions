import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { avatarPresets, defaultAvatar, defaultAvatarPool, fnv1a32, isAvatarPreset, resolveAvatar } from './avatar';

const en = JSON.parse(readFileSync(new URL('../../app/src/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;

// The pool as it was authored at version 1. Written out as a literal: the pool is frozen, so a reorder is a
// change to every member's default, and this is the line that goes red.
const FROZEN_POOL = [
  'crest-chevrons', 'crest-claw', 'crest-lion', 'crest-tower', 'crest-star', 'crest-wing',
  'crest-track', 'crest-sprig', 'crest-ridge', 'crest-wave', 'crest-dune', 'crest-reticle',
];

// Public ids in the Worker's shape (8 Crockford characters) and the crest each must get. Computed OUTSIDE this
// code (a Python FNV-1a over the UTF-8 bytes, then mod 12) at authoring, one id per pool index, so a swap of any
// two pool entries moves at least two of these rows.
const LITERALS: readonly (readonly [string, string])[] = [
  ['VMXXQKFB', 'crest-chevrons'], ['P1XPA7Z3', 'crest-claw'], ['6CQ643DZ', 'crest-lion'], ['Q5E6EYCN', 'crest-tower'],
  ['YA1DQ91K', 'crest-star'], ['D25VT4F5', 'crest-wing'], ['DJ8FSSZ5', 'crest-track'], ['CYBVN5SX', 'crest-sprig'],
  ['V37E3S3E', 'crest-ridge'], ['96Q14DR9', 'crest-wave'], ['M4FV4DK7', 'crest-dune'], ['M9S346Q3', 'crest-reticle'],
];

describe('fnv1a32', () => {
  it('matches the published FNV-1a 32-bit vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
  it('hashes UTF-8 bytes, not UTF-16 units', () => {
    // Python: FNV-1a over 'é'.encode() (c3 a9) is 0x1e9de8c1; over UTF-16-LE it would be 0x59fb6f0c.
    expect(fnv1a32('é')).toBe(0x1e9de8c1);
  });
});

describe('the default avatar (GH-1075 section 4.1)', () => {
  it('the pool is the frozen version-1 list, in order', () => {
    expect([...defaultAvatarPool]).toEqual(FROZEN_POOL);
  });
  it.each(LITERALS)('public id %s gets %s', (publicId, crest) => {
    expect(defaultAvatar(publicId)).toBe(crest);
  });
  it('the literals cover every pool index once', () => {
    expect(LITERALS.map(([, c]) => c)).toEqual(FROZEN_POOL);
  });
  it('10,000 seeded ids put every crest between 5% and 12%', () => {
    let s = 0x9e3779b9; // mulberry32, seeded: the test must repeat
    const next = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const counts = new Map<string, number>();
    for (let i = 0; i < 10000; i++) {
      let id = '';
      for (let k = 0; k < 8; k++) id += alphabet[Math.floor(next() * 32)];
      const crest = defaultAvatar(id);
      counts.set(crest, (counts.get(crest) ?? 0) + 1);
    }
    expect(counts.size).toBe(12);
    for (const [crest, n] of counts) {
      expect(n / 10000, crest).toBeGreaterThan(0.05);
      expect(n / 10000, crest).toBeLessThan(0.12);
    }
  });
  it('every pool id is a crest preset, and a default is never empty', () => {
    for (const id of defaultAvatarPool) {
      expect(avatarPresets.find((p) => p.id === id)?.family, id).toBe('crest');
    }
    for (const id of ['', ' ', 'x', 'é', '\u{1F981}']) expect(defaultAvatar(id)).not.toBe('');
  });
});

describe('the catalogue', () => {
  it('has 12 crests and 12 unit busts, unique ids, and every label in en.json', () => {
    expect(avatarPresets.filter((p) => p.family === 'crest')).toHaveLength(12);
    expect(avatarPresets.filter((p) => p.family === 'unit')).toHaveLength(12);
    expect(new Set(avatarPresets.map((p) => p.id)).size).toBe(24);
    for (const p of avatarPresets) expect(en[p.label], p.label).toBeTruthy();
  });
  it('a unit preset id is "unit-" plus its unit id', () => {
    for (const p of avatarPresets) if (p.family === 'unit') expect(p.id).toBe(`unit-${p.unit}`);
  });
});

describe('resolveAvatar', () => {
  const publicId = LITERALS[4]?.[0] ?? '';
  it('an upload wins and carries the chosen preset (or the default) as its fallback', () => {
    expect(resolveAvatar({ publicId, preset: 'unit-mbt_lavi', uploadRev: 3 })).toEqual({ kind: 'upload', rev: 3, fallback: 'unit-mbt_lavi' });
    expect(resolveAvatar({ publicId, uploadRev: 1 })).toEqual({ kind: 'upload', rev: 1, fallback: 'crest-star' });
  });
  it('a chosen preset is chosen; none is the default, unchosen', () => {
    expect(resolveAvatar({ publicId, preset: 'crest-claw' })).toEqual({ kind: 'preset', id: 'crest-claw', chosen: true });
    expect(resolveAvatar({ publicId, preset: null })).toEqual({ kind: 'preset', id: 'crest-star', chosen: false });
  });
  it('an id the catalogue does not hold is no choice, and the result is never empty', () => {
    expect(isAvatarPreset('crest-nope')).toBe(false);
    expect(resolveAvatar({ publicId, preset: 'crest-nope' })).toEqual({ kind: 'preset', id: 'crest-star', chosen: false });
    expect(resolveAvatar({ publicId: '' }).kind).toBe('preset');
  });
});
