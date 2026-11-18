// The self-hosted faces against the @font-face rules that load them
// (GH-1407, lead ruling D6: Cyrillic for the shipped faces before translation
// starts).
//
// CSS has no unit tests and jsdom loads no font, so this reads `theme.css` and
// the woff2 files back off disk and decodes each file's character map (a
// minimal WOFF2 reader below: the table directory, the one Brotli stream, and
// cmap formats 4 and 12; cmap is never a transformed table). What it holds:
//
//   * every woff2 under assets/fonts is loaded by exactly one rule, and every
//     rule's file exists;
//   * a face that declares a unicode-range maps every code point in it (no
//     tofu inside the range the browser routes to it);
//   * that range shares no code point with the latin file of the same family
//     and weight, so latin text can never be drawn from the new file: latin
//     rendering is unchanged by construction, not by inspection;
//   * the latin rules still carry no unicode-range (they were the whole face
//     before this change, and still are);
//   * every ranged file maps NOTHING outside its unicode-range, so no Latin
//     code point can come from one (the companions below are different faces
//     under a family's name, which makes this the check that matters);
//   * every family sets Russian in every weight it declares. Barlow and Big
//     Shoulders Display have no Cyrillic in any OFL source, so since the
//     lead's ruling of 17 Nov 2026 (option B) they take companions: Fira
//     Sans for Barlow, Oswald for Big Shoulders Display. There is no gap
//     list any more.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FONTS = resolve(ROOT, 'assets/fonts');
const css = readFileSync(resolve(ROOT, 'packages/app/src/ui/theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** WOFF2's 63 known table tags, by flag index (W3C WOFF2, section 5.1). */
const KNOWN_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea ' +
  'vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar ' +
  'gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
)
  .split(' ')
  .map((t) => t.replace('_', ' '));

/** The code points a woff2 file's cmap maps to a real glyph (glyph id 0, .notdef, is not a mapping). */
function woff2Codepoints(bytes: Buffer): Set<number> {
  if (bytes.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file');
  const numTables = bytes.readUInt16BE(12);
  const compressedLength = bytes.readUInt32BE(20);
  let p = 48;
  const base128 = (): number => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = bytes[p++];
      v = v * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
    throw new Error('bad UIntBase128');
  };
  let offset = 0;
  let cmap: { at: number; length: number } | null = null;
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[p++];
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = bytes.toString('latin1', p, p + 4);
      p += 4;
    }
    const version = flags >> 6;
    const origLength = base128();
    const glyfOrLoca = tag === 'glyf' || tag === 'loca';
    const transformed = glyfOrLoca ? version === 0 : version !== 0;
    const length = transformed ? base128() : origLength;
    if (tag === 'cmap') cmap = { at: offset, length };
    offset += length;
  }
  if (cmap === null) throw new Error('no cmap table');
  const stream = brotliDecompressSync(bytes.subarray(p, p + compressedLength));
  const t = stream.subarray(cmap.at, cmap.at + cmap.length);
  const subtables = new Map<string, number>();
  for (let i = 0; i < t.readUInt16BE(2); i++) {
    const r = 4 + i * 8;
    subtables.set(`${t.readUInt16BE(r)}.${t.readUInt16BE(r + 2)}`, t.readUInt32BE(r + 4));
  }
  const out = new Set<number>();
  const full = subtables.get('3.10') ?? subtables.get('0.4');
  if (full !== undefined && t.readUInt16BE(full) === 12) {
    const groups = t.readUInt32BE(full + 12);
    for (let g = 0; g < groups; g++) {
      const r = full + 16 + g * 12;
      const [start, end, glyph] = [t.readUInt32BE(r), t.readUInt32BE(r + 4), t.readUInt32BE(r + 8)];
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
    }
    return out;
  }
  const bmp = subtables.get('3.1') ?? subtables.get('0.3');
  if (bmp === undefined || t.readUInt16BE(bmp) !== 4) throw new Error('no format 4 or 12 Unicode cmap');
  const segs = t.readUInt16BE(bmp + 6) / 2;
  const ends = bmp + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const ranges = deltas + segs * 2;
  for (let s = 0; s < segs; s++) {
    const [end, start] = [t.readUInt16BE(ends + s * 2), t.readUInt16BE(starts + s * 2)];
    const delta = t.readInt16BE(deltas + s * 2);
    const ro = t.readUInt16BE(ranges + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (ro === 0) glyph = (c + delta) & 0xffff;
      else {
        const raw = t.readUInt16BE(ranges + s * 2 + ro + (c - start) * 2);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(c);
    }
  }
  return out;
}

interface Face {
  family: string;
  weight: string;
  file: string;
  range: Set<number> | null;
  rangeText: string | null;
}

/** `U+0400-045F, U+2116` as a set of code points. */
function parseRange(text: string): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^\s*U\+([0-9A-F]+)(?:-([0-9A-F]+))?\s*$/i.exec(part);
    if (m === null) throw new Error(`unicode-range part not understood: ${part}`);
    const lo = parseInt(m[1], 16);
    const hi = m[2] === undefined ? lo : parseInt(m[2], 16);
    for (let c = lo; c <= hi; c++) out.add(c);
  }
  return out;
}

const faces: Face[] = [...css.matchAll(/@font-face\s*\{([^{}]*)\}/g)].map((m) => {
  const body = m[1];
  const rangeText = /unicode-range:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? null;
  return {
    family: /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? '',
    weight: /font-weight:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? '',
    file: /url\('\/fonts\/([^']+)'\)/.exec(body)?.[1] ?? '',
    range: rangeText === null ? null : parseRange(rangeText),
    rangeText,
  };
});

const cmapCache = new Map<string, Set<number>>();
const cmapOf = (file: string): Set<number> => {
  let got = cmapCache.get(file);
  if (got === undefined) {
    got = woff2Codepoints(readFileSync(resolve(FONTS, file)));
    cmapCache.set(file, got);
  }
  return got;
};

const hex = (c: number): string => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
/** Russian: А-я plus Ё and ё. */
const RUSSIAN = [...Array.from({ length: 0x450 - 0x410 }, (_, i) => 0x410 + i), 0x401, 0x451];

/** The Cyrillic file each family and weight draws from (the lead's option B: a companion face under the family's own name). */
const CYRILLIC_FILE: Record<string, string> = {
  'Barlow|400': 'fira-sans-cyrillic-400.woff2',
  'Barlow|600': 'fira-sans-cyrillic-600.woff2',
  'Big Shoulders Display|400 900': 'oswald-cyrillic.woff2',
  'IBM Plex Mono|400': 'ibm-plex-mono-cyrillic-400.woff2',
  'IBM Plex Mono|600': 'ibm-plex-mono-cyrillic-600.woff2',
};

describe('self-hosted font faces (theme.css @font-face against assets/fonts)', () => {
  it('reads real rules and real character maps', () => {
    // A parse that found nothing would pass every spec below vacuously.
    expect(faces.length).toBeGreaterThanOrEqual(10);
    const latin = cmapOf('barlow-latin-400.woff2');
    expect(latin.has(0x41)).toBe(true); // A
    expect(latin.has(0xe9)).toBe(true); // é
    expect(latin.has(0x42f)).toBe(false); // Я
    expect(cmapOf('ibm-plex-mono-cyrillic-400.woff2').has(0x42f)).toBe(true);
  });

  it('loads every woff2 under assets/fonts exactly once, and every rule names a file that exists', () => {
    const files = readdirSync(FONTS).filter((f) => f.endsWith('.woff2')).sort();
    expect(faces.map((f) => f.file).sort()).toEqual(files);
  });

  it('leaves the latin rules as the whole face, and ranges every other file', () => {
    // A latin rule with a range would change what latin text draws from; a
    // non-latin file WITHOUT one would be consulted first for every character
    // and downloaded for an English screen.
    for (const f of faces) {
      if (f.file.includes('-latin')) expect(f.rangeText, f.file).toBeNull();
      else expect(f.rangeText, `${f.file} has no unicode-range`).not.toBeNull();
    }
  });

  it('maps every code point a face declares in its unicode-range', () => {
    const ranged = faces.filter((f) => f.range !== null);
    expect(ranged.length).toBeGreaterThan(0);
    for (const f of ranged) {
      const have = cmapOf(f.file);
      const missing = [...(f.range ?? [])].filter((c) => !have.has(c)).map(hex);
      expect(missing, `${f.file} declares glyphs it does not have`).toEqual([]);
    }
  });

  it('routes no code point the latin file of the same face draws to a ranged file', () => {
    for (const f of faces.filter((x) => x.range !== null)) {
      const latin = faces.find((x) => x.family === f.family && x.weight === f.weight && x.range === null);
      expect(latin, `${f.file}: no latin face of the same family and weight`).toBeDefined();
      if (latin === undefined) continue;
      const theirs = cmapOf(latin.file);
      const stolen = [...(f.range ?? [])].filter((c) => theirs.has(c)).map(hex);
      expect(stolen, `${f.file} would take these from ${latin.file}`).toEqual([]);
    }
  });

  it('maps nothing outside its unicode-range in any ranged file: a Latin code point can never come from one', () => {
    for (const f of faces.filter((x) => x.range !== null)) {
      const outside = [...cmapOf(f.file)].filter((c) => !(f.range ?? new Set()).has(c)).map(hex);
      expect(outside, `${f.file} maps code points outside its range`).toEqual([]);
      // and in particular nothing Latin: the basic Latin and Latin-1 blocks, which the latin files own
      expect([...cmapOf(f.file)].filter((c) => c < 0x250).map(hex), `${f.file} maps Latin`).toEqual([]);
    }
  });

  it('serves each Cyrillic file under the EXISTING family name, so no new family appears and a Russian session needs no CSS change', () => {
    expect([...new Set(faces.map((f) => f.family))].sort()).toEqual(['Barlow', 'Big Shoulders Display', 'IBM Plex Mono']);
    for (const [key, file] of Object.entries(CYRILLIC_FILE)) {
      const [family, weight] = key.split('|');
      const face = faces.find((f) => f.file === file);
      expect(face, `${file} has a rule`).toBeDefined();
      expect([face?.family, face?.weight], file).toEqual([family, weight]);
      expect(face?.rangeText, `${file} is ranged`).not.toBeNull();
    }
  });

  it('sets Russian in every weight of every family', () => {
    const byFace = new Map<string, Face[]>();
    for (const f of faces) byFace.set(`${f.family}|${f.weight}`, [...(byFace.get(`${f.family}|${f.weight}`) ?? []), f]);
    expect([...byFace.keys()].sort()).toEqual(Object.keys(CYRILLIC_FILE).sort());
    for (const [key, group] of byFace) {
      // What the browser can draw for this family and weight: each file's
      // own map, cut to its declared range when it has one.
      const drawable = (c: number): boolean => group.some((f) => cmapOf(f.file).has(c) && (f.range === null || f.range.has(c)));
      const missing = RUSSIAN.filter((c) => !drawable(c)).map(hex);
      expect(missing, `${key} cannot set Russian`).toEqual([]);
    }
  });
});
