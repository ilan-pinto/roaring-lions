// The witness for tools/maps/lib/ (GH-920 B1): Rujm Sawda's generator was lifted onto the library, and
// `node tools/maps/rujm_sawda/build.mjs --check` writes nothing and exits 1 if either shipped file differs
// from what it builds, so it stays at exit 0 only while every helper does what it did when it lived in
// that file. A byte-identical result is evidence about the library only if the check CAN go red on the
// library, so this breaks each helper Rujm uses by one line, in a copy of tools/maps, and requires the
// check to fail. The control (no mutation) must pass, and a mutation that is not in the file's text is an
// error rather than a silent skip.
//
// Two boundary mutations are EQUIVALENT on Rujm's data and so are not here: shelfSteps' reach (a tile at
// x + y == 52 is given the level it already had) and scatterPatches' disc (no tile lies at exactly 2.6).
// map_lib.test.ts holds both with literals, and the helpers only Wadi Tarfan (large) uses (the upscale
// stages) are held by the same file's oracles. Those were mutated one line at a time by hand, 27
// mutations of upscale.mjs, common.mjs and shapes.mjs, every one red (the list is in the PR).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
// realpath: build.mjs runs its CLI only when import.meta.url (the resolved path) equals argv[1], and macOS's
// tmpdir is a symlink, so an unresolved path would make every run a silent no-op that exits 0.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maplib-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A fresh copy of tools/maps beside a link to data/, so build.mjs's ROOT (three levels up) finds the shipped files. */
function copy(name: string): string {
  const dir = join(scratch, name);
  cpSync(join(ROOT, 'tools', 'maps'), join(dir, 'tools', 'maps'), { recursive: true });
  symlinkSync(join(ROOT, 'data'), join(dir, 'data'));
  return dir;
}

function check(dir: string, generator = 'rujm_sawda'): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [join(dir, 'tools', 'maps', generator, 'build.mjs'), '--check'], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

function mutate(dir: string, file: string, from: string, to: string): void {
  const path = join(dir, 'tools', 'maps', 'lib', file);
  const src = readFileSync(path, 'utf8');
  expect(src.split(from).length - 1, `${file} must contain exactly one "${from}"`).toBe(1);
  writeFileSync(path, src.replace(from, to));
}

const MUTATIONS: readonly (readonly [string, string, string, string])[] = [
  ['hash: a constant', 'common.mjs', 'h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;', 'h = Math.imul(h ^ (h >>> 13), 3266489919) >>> 0;'],
  ['hash: the salt is dropped', 'common.mjs', 'Math.imul(salt + 1, 83492791)', 'Math.imul(1, 83492791)'],
  ['halfTurnOf.mirror: off by one', 'common.mjs', 'mirror: ([x, y]) => [size - 1 - x, size - 1 - y],', 'mirror: ([x, y]) => [size - x, size - y],'],
  ['halfTurnOf.mirrorRect: off by one', 'common.mjs', 'mirrorRect: ([x, y, w, h]) => [size - x - w, size - y - h, w, h],', 'mirrorRect: ([x, y, w, h]) => [size - 1 - x - w, size - 1 - y - h, w, h],'],
  ['halfTurn: a flip, not a half-turn', 'common.mjs', '      t[y][x] = t[size - 1 - y][size - 1 - x];', '      t[y][x] = t[size - 1 - y][x];'],
  ['halfTurn: the elevation is not turned', 'common.mjs', '      el[y][x] = el[size - 1 - y][size - 1 - x];', '      el[y][x] = el[y][x];'],
  ['serialise: the number-array layout', 'common.mjs', "return `[${v.join(', ')}]`;", "return `[${v.join(',')}]`;"],
  ['sortedByKey: the order', 'common.mjs', 'a < b ? -1 : 1', 'a < b ? 1 : -1'],
  ['farmAt: a gate is closed', 'shapes.mjs', "for (const [gx, gy] of gates) t[gy][gx] = '.';", "for (const [gx, gy] of gates) t[gy][gx] = '=';"],
  ['farmAt: the wall is two tiles of box', 'shapes.mjs', 'x === x0 + 7 || y === y0 || y === y0 + 7', 'x === x0 + 6 || y === y0 || y === y0 + 7'],
  ['ringTiles: the right edge', 'shapes.mjs', 'x === x0 + w - 1 ||', 'x === x0 + w - 2 ||'],
  ['stampChain: the symbol', 'shapes.mjs', 't[y][x] = symbol;', "t[y][x] = 'x';"],
  ['shelfSteps: the band limit is exclusive', 'shapes.mjs', 'x + y <= limit', 'x + y < limit'],
  ['scatterPatches: the centre symbol', 'shapes.mjs', 'x === cx && y === cy ? centreSymbol : symbol', 'symbol'],
];

describe('tools/maps/lib is what Rujm Sawda was built from', () => {
  it('control: an unmutated copy of the library writes exactly the shipped files, and its --check really runs', () => {
    expect(check(copy('control'))).toEqual({ status: 0, stderr: '' });
    // a --check that is a silent no-op also exits 0: an absent shipped file must make it exit 1 and say so
    const gone = copy('control-gone');
    rmSync(join(gone, 'data'));
    symlinkSync(join(scratch, 'nowhere'), join(gone, 'data'));
    const r = check(gone);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('differs from what tools/maps/rujm_sawda/build.mjs writes');
  });

  for (const [name, file, from, to] of MUTATIONS) {
    it(`${name}: Rujm's --check goes red`, () => {
      const dir = copy(`m-${MUTATIONS.findIndex((m) => m[0] === name)}`);
      mutate(dir, file, from, to);
      expect(check(dir).status, `--check stayed green with ${name}`).toBe(1);
    });
  }

  it('the red comes from the --check comparison itself: with it disabled, a mutated library exits 0', () => {
    const dir = copy('disabled');
    mutate(dir, 'common.mjs', 'h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;', 'h = Math.imul(h ^ (h >>> 13), 3266489919) >>> 0;');
    expect(check(dir).status).toBe(1);
    mutate(dir, 'common.mjs', 'process.exit(bad ? 1 : 0);', 'process.exit(0);');
    expect(check(dir).status).toBe(0);
  });
});
