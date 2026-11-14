// GH-1075 P2: the twelve avatar crests. Every check reads the files ON DISK (what ships), parses them with its own
// regexes, and takes its colours from data/palette.json, not from the generator's table.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avatarPresets, defaultAvatarPool } from '../../../packages/data/src/avatar';
import {
  CRESTS, FLOOR_EXEMPT_CRESTS, FLOOR_EXEMPT_PARTS, MAX_CLOSING_GAIN, MIN_RETENTION, buildAll, measureCharge, paletteHex, parsePath, readLion,
} from '../../avatars/crest_geometry.mjs';

const ROOT = join(__dirname, '..', '..', '..');
const DIR = join(ROOT, 'assets', 'ui', 'avatars', 'crests');
const palette = JSON.parse(readFileSync(join(ROOT, 'data', 'palette.json'), 'utf8')) as {
  ramps: Record<string, { colors: string[] }>;
  reserved: Record<string, { colors: Record<string, string>; variants?: Record<string, Record<string, string>> }>;
};
const rampHexes = new Set(Object.values(palette.ramps).flatMap((r) => r.colors.map((h) => h.toUpperCase())));
// Only the colour entries of each reserved band (and its CVD variants), never the prose notes that quote a hex.
const reservedHexes = new Set(
  Object.values(palette.reserved)
    .flatMap((band) => [...Object.values(band.colors), ...Object.values(band.variants ?? {}).flatMap((v) => Object.values(v))])
    .map((h) => h.toUpperCase()),
);
const hexOf = (key: string): string => {
  const [ramp, i] = key.split('.');
  return (palette.ramps[ramp ?? '']?.colors[Number(i)] ?? '').toUpperCase();
};

// Spec 3.2, written out: id -> [ground, rim, charge tones].
const TABLE: Record<string, [string, string, string[]]> = {
  'crest-chevrons': ['shadow.1', 'dust.4', ['dust.0', 'dust.2', 'dust.4']],
  'crest-claw': ['terracotta.1', 'terracotta.2', ['limestone.0']],
  'crest-lion': ['olive.2', 'olive.3', ['dust.0']],
  'crest-tower': ['gunmetal.3', 'shadow.0', ['limestone.1']],
  'crest-star': ['olive.3', 'olive.1', ['dust.0']],
  'crest-wing': ['water.1', 'gunmetal.3', ['limestone.0']],
  'crest-track': ['shadow.0', 'gunmetal.2', ['limestone.2']],
  'crest-sprig': ['limestone.1', 'limestone.5', ['scrub.1']],
  'crest-ridge': ['gunmetal.2', 'gunmetal.3', ['limestone.0']],
  'crest-wave': ['shadow.1', 'water.1', ['water.0']],
  'crest-dune': ['dust.5', 'dust.6', ['dust.0']],
  'crest-reticle': ['terracotta.2', 'shadow.0', ['dust.0']],
};
const IDS = Object.keys(TABLE);
const read = (id: string): string => readFileSync(join(DIR, `${id}.svg`), 'utf8');

const luminance = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
const chargeGroup = (svg: string): string => /<g id="charge">([\s\S]*)<\/g><\/svg>/.exec(svg)?.[1] ?? '';

describe('the crest files', () => {
  it('are exactly the twelve crest presets and the default pool, both ways', () => {
    const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
    expect(onDisk).toEqual([...IDS].sort());
    expect(avatarPresets.filter((p) => p.family === 'crest').map((p) => p.id).sort()).toEqual(onDisk);
    expect([...defaultAvatarPool].sort()).toEqual(onDisk);
    expect(CRESTS.map((c: { id: string }) => c.id)).toEqual(IDS);
  });

  it('a re-run is byte-identical: the generator reproduces every file as shipped', () => {
    for (const { id, svg } of buildAll() as { id: string; svg: string }[]) expect(svg, id).toBe(read(id));
  });

  it.each(IDS)('%s: every fill and stroke is a ramp colour, none a reserved band, and they are the spec table', (id) => {
    const svg = read(id);
    const painted = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1] ?? '');
    for (const v of painted) {
      if (v === 'none') continue;
      expect(rampHexes.has(v.toUpperCase()), `${id}: ${v} is not a palette ramp hex`).toBe(true);
      expect(reservedHexes.has(v.toUpperCase()), `${id}: ${v} is in a reserved band`).toBe(false);
    }
    const [ground, rim, tones] = TABLE[id] as [string, string, string[]];
    const groundHex = /id="ground"[^>]*fill="(#[0-9A-F]{6})"/.exec(svg)?.[1];
    const rimHex = /id="rim"[^>]*stroke="(#[0-9A-F]{6})"/.exec(svg)?.[1];
    expect(groundHex).toBe(hexOf(ground));
    expect(rimHex).toBe(hexOf(rim));
    const charge = new Set([...(id === 'crest-lion' ? svg : chargeGroup(svg)).matchAll(/fill="(#[0-9A-F]{6})"/g)].map((m) => m[1]));
    for (const t of tones) expect(charge.has(hexOf(t)), `${id}: charge tone ${t}`).toBe(true);
    if (id !== 'crest-lion') expect([...charge].sort(), id).toEqual(tones.map(hexOf).filter((v, i, a) => a.indexOf(v) === i).sort());
  });

  it.each(IDS)('%s: no image, script, style, foreignObject or reference that leaves the file; within its size', (id) => {
    const svg = read(id);
    expect(svg).not.toMatch(/<(image|script|style|foreignObject)\b/i);
    expect(svg).not.toMatch(/(?:https?|data|file):(?!\/\/www\.w3\.org\/2000\/svg)/);
    for (const m of svg.matchAll(/(?:xlink:)?href="([^"]*)"/g)) expect(m[1], id).toMatch(/^#/);
    expect(svg).not.toMatch(/url\(/);
    expect(Buffer.byteLength(svg), id).toBeLessThanOrEqual(id === 'crest-lion' ? 8 * 1024 : 3 * 1024);
  });

  it.each(IDS)('%s: every charge tone reaches 3:1 against the ground', (id) => {
    const [ground, , tones] = TABLE[id] as [string, string, string[]];
    for (const t of tones) expect(contrast(hexOf(ground), hexOf(t)), `${id} ${t} on ${ground}`).toBeGreaterThanOrEqual(3);
  });

  it.each(IDS)('%s: the charge sits inside radius 96 of the centre', (id) => {
    const svg = read(id);
    const pts: [number, number][] = [];
    if (id === 'crest-lion') {
      const m = /matrix\(([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(svg);
      const [s, , tx] = [Number(m?.[1]), 0, Number(m?.[3])];
      for (const d of [...svg.matchAll(/<path fill="#[0-9A-F]{6}" d="([^"]+)"/g)].map((x) => x[1] ?? '')) {
        for (const ring of parsePath(d) as [number, number][][]) for (const [x, y] of ring) { pts.push([x * s + tx, y * s + tx], [(200 - x) * s + tx, y * s + tx]); }
      }
    } else {
      for (const d of [...chargeGroup(svg).matchAll(/ d="([^"]+)"/g)].map((x) => x[1] ?? '')) for (const ring of parsePath(d) as [number, number][][]) pts.push(...ring);
    }
    expect(pts.length).toBeGreaterThan(5);
    for (const [x, y] of pts) expect(Math.hypot(x - 128, y - 128)).toBeLessThanOrEqual(96.05);
  });
});

describe('the legibility floor (18 units, 2 px at the 28 px chip)', () => {
  it('has exactly two named exemptions: the rim and crest-lion', () => {
    expect([...FLOOR_EXEMPT_CRESTS]).toEqual(['crest-lion']);
    expect([...FLOOR_EXEMPT_PARTS]).toEqual(['rim']);
  });

  it.each(IDS.filter((id) => id !== 'crest-lion'))('%s: no charge path thinner than 18, no gap narrower than 18', (id) => {
    const svg = read(id);
    expect(chargeGroup(svg)).not.toMatch(/stroke/);
    const paths = [...chargeGroup(svg).matchAll(/ d="([^"]+)"/g)].map((m) => ({ d: m[1] ?? '' }));
    const { retention, closingGain } = measureCharge(paths) as { retention: number[]; closingGain: number };
    // The measured values, recorded when the thresholds were set (lowest retention 0.82 on the reticle's ticks,
    // whose four corners are 16% of a 18 x 20 piece; highest closing gain 0.031 on the sprig).
    expect(Math.min(...retention), `${id} retention ${retention.map((r) => r.toFixed(2)).join(' ')}`).toBeGreaterThanOrEqual(MIN_RETENTION);
    expect(closingGain, id).toBeLessThanOrEqual(MAX_CLOSING_GAIN);
  });

  it('the measure goes red on a 10-unit stroke and on a 12-unit gap (the check can fail)', () => {
    const star = chargeGroup(read('crest-star'));
    const paths = [...star.matchAll(/ d="([^"]+)"/g)].map((m) => ({ d: m[1] ?? '' }));
    const stroke = { d: 'M60,60L230,60L230,70L60,70Z' };
    expect(Math.min(...(measureCharge([...paths, stroke]) as { retention: number[] }).retention)).toBeLessThan(MIN_RETENTION);
    const barA = { d: 'M60,100L230,100L230,140L60,140Z' };
    const barB = { d: 'M60,152L230,152L230,192L60,192Z' }; // 12 apart
    expect((measureCharge([barA, barB]) as { closingGain: number }).closingGain).toBeGreaterThan(MAX_CLOSING_GAIN);
  });
});

describe('crest-lion is read from the approved stencil, never redrawn', () => {
  it('carries every silhouette and cutout path of art/src/insignia/roaring_lion.svg, number for number', () => {
    const src = readLion() as { silhouette: { d: string }[]; cutouts: { d: string }[] };
    const svg = read('crest-lion');
    const drawn = [...svg.matchAll(/<path fill="#[0-9A-F]{6}" d="([^"]+)"/g)].map((m) => m[1] ?? '');
    const wanted = [...src.silhouette, ...src.cutouts].map((p) => p.d);
    expect(src.cutouts).toHaveLength(14); // ring gap, face gap, locks 2-8, eye, nose, philtrum, muzzle, mouth
    expect(drawn).toHaveLength(wanted.length);
    wanted.forEach((d, i) => {
      const a = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      const b = (drawn[i]?.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      expect(b, `path ${i}`).toEqual(a);
    });
    expect(svg).toContain('matrix(-1 0 0 1 200 0)');
  });
});

describe('the generator', () => {
  it('refuses a key outside ramps.* (team, vfx and group bands never reach a crest)', () => {
    expect(() => paletteHex('team.kedem')).toThrow();
    expect(() => paletteHex('vfx.fire')).toThrow();
    expect(paletteHex('olive.2')).toBe(hexOf('olive.2'));
  });
  it('has its output directory under assets/ui/avatars', () => {
    expect(existsSync(DIR)).toBe(true);
  });
});
