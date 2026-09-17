// The unit-icon freshness gate.
//
// `tools/crop_unit_icons.py` crops a unit's own alpha bounding box out of its
// portrait frame at build time and writes `assets/ui/icons/units/<SHEET>.png`
// plus a manifest recording exactly which sprite-sheet frame(s) each icon was
// built from, by content hash (docs/superpowers/plans/2026-09-17-unit-icons-crop.md,
// "Global Constraints" for the manifest schema). None of that is worth anything
// unless something asserts the shipped files actually match: a sheet
// re-rendered without a matching `pnpm icons:units` run would otherwise ship a
// stale crop indefinitely, since nothing else reads `assets/ui/icons/units/`.
//
// This file makes each of the freshness gate's claims a real assertion over
// the files on disk, rather than trusting `--check`'s own exit code:
//   (a) every recorded sha256 matches the sprite-sheet frame it names;
//   (b) every hull sheet under assets/sprites/ has a manifest entry and a PNG,
//       and nothing else does;
//   (c) every icon PNG is manifest.size x manifest.size and its own alpha
//       content matches the manifest's declared `extent` exactly;
//   (d) the manifest's top-level shape, and that every `box` is square,
//       has a positive side, and sits inside the 256px source frame.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SPRITES_DIR = `${REPO}assets/sprites`;
const ICONS_DIR = `${REPO}assets/ui/icons/units`;

interface IconSource {
  path: string;
  sha256: string;
}

interface IconEntry {
  file: string;
  sources: IconSource[];
  facing: number;
  /** Only present on a composited (hull+turret) entry, and always equal to
   *  `facing` -- crop_unit_icons.py raises rather than shipping a mismatch. */
  turretFacing?: number;
  box: [number, number, number, number];
  extent: [number, number];
}

interface IconManifest {
  version: number;
  /** Every icon's pixel width and height -- the one source of truth, read
   *  back here rather than a hardcoded literal kept in sync by hand. */
  size: number;
  icons: Record<string, IconEntry>;
}

function loadManifest(): IconManifest {
  return JSON.parse(readFileSync(`${ICONS_DIR}/manifest.json`, 'utf8')) as IconManifest;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every directory under assets/sprites/ with its own manifest.json, excluding
 * buildings (`BLD_*`) and turret layers (`*_TURR`) -- the same discovery rule
 * `crop_unit_icons.py`'s `discover_sheets` applies, reimplemented here rather
 * than imported so this test does not just re-run the script against itself. */
function hullSheetNames(): string[] {
  return readdirSync(SPRITES_DIR)
    .filter((name) => {
      const dir = `${SPRITES_DIR}/${name}`;
      if (!statSync(dir).isDirectory()) return false;
      if (name.startsWith('BLD_') || name.endsWith('_TURR')) return false;
      return existsSync(`${dir}/manifest.json`);
    })
    .sort();
}

function decodePng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

/** [x, y, w, h] of the pixels whose alpha exceeds `threshold`, or null if none
 * do -- the same ALPHA_CUT=8 threshold the Python script crops against. */
function alphaBBox(png: PNG, threshold = 8): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const alpha = png.data[(png.width * y + x) * 4 + 3];
      if (alpha > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX === Infinity) return null;
  return [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

const manifest = loadManifest();
const hullSheets = hullSheetNames();

describe('unit icon manifest shape', () => {
  it('is version 1 with an icons object', () => {
    expect(manifest.version).toBe(1);
    expect(typeof manifest.icons).toBe('object');
    expect(manifest.icons).not.toBeNull();
    // Sanity on the fixture itself: a manifest with zero entries would make
    // every loop below vacuously pass and this whole file would be inert.
    expect(Object.keys(manifest.icons).length).toBeGreaterThan(0);
    expect(manifest.size, 'manifest.size').toBeGreaterThan(0);
  });

  it('gives every icon a square, positive-sized box inside the 256px source frame', () => {
    for (const [name, entry] of Object.entries(manifest.icons)) {
      const [x, y, w, h] = entry.box;
      expect(w, `${name}: box is not square (${w}x${h})`).toBe(h);
      expect(w, `${name}: box w is not positive`).toBeGreaterThan(0);
      expect(x, `${name}: box x negative`).toBeGreaterThanOrEqual(0);
      expect(y, `${name}: box y negative`).toBeGreaterThanOrEqual(0);
      expect(x + w, `${name}: box extends past x=256`).toBeLessThanOrEqual(256);
      expect(y + h, `${name}: box extends past y=256`).toBeLessThanOrEqual(256);
    }
  });
});

describe('unit icon manifest matches the hull sheets on disk', () => {
  it('has exactly one entry per hull sheet, and no entry lacking a PNG', () => {
    const manifestNames = Object.keys(manifest.icons).sort();
    expect(manifestNames, 'manifest icons vs. discovered hull sheets').toEqual(hullSheets);
    for (const name of manifestNames) {
      const pngPath = `${ICONS_DIR}/${manifest.icons[name].file}`;
      expect(existsSync(pngPath), `${name}: manifest entry has no PNG at ${pngPath}`).toBe(true);
    }
  });
});

describe('unit icon manifest is pinned to the frames it was cut from', () => {
  for (const [name, entry] of Object.entries(manifest.icons)) {
    it(`${name}: every source sha256 matches the sprite-sheet file on disk`, () => {
      expect(entry.sources.length).toBeGreaterThan(0);
      for (const source of entry.sources) {
        const abs = `${REPO}${source.path}`;
        expect(existsSync(abs), `${name}: ${source.path} does not exist`).toBe(true);
        expect(sha256File(abs), `${name}: ${source.path} sha256 mismatch`).toBe(source.sha256);
      }
    });
  }
});

describe('unit icon PNGs match their manifest size and declared extent exactly', () => {
  for (const [name, entry] of Object.entries(manifest.icons)) {
    it(`${name}`, () => {
      const png = decodePng(`${ICONS_DIR}/${entry.file}`);
      expect(png.width, `${name}: width`).toBe(manifest.size);
      expect(png.height, `${name}: height`).toBe(manifest.size);

      const bbox = alphaBBox(png);
      expect(bbox, `${name}: icon has no pixel above the alpha threshold`).not.toBeNull();
      const [, , w, h] = bbox as [number, number, number, number];

      expect(
        w === entry.extent[0] && h === entry.extent[1],
        `${name}: measured alpha extent ${w}x${h} does not match the manifest's declared extent ` +
          `${entry.extent[0]}x${entry.extent[1]}`
      ).toBe(true);
    });
  }
});
