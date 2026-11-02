/**
 * L3 (GH-943): `validate_mesh_assets.py`'s texture budget per asset class, falsified. Each mutation
 * below must turn the real Python check red; the unmutated tree must stay green, so a check that
 * stopped looking cannot pass by silence.
 *
 * The size oracle takes LITERALS: the Lavi's three 2048-px images are `22,369,621` bytes each
 * (2048 x 2048 x 4 x 4/3, truncated), written out here by hand and never recomputed from the
 * module's own constants. A mutated mip-chain factor must move the Python's answer off the literal.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-texture-budget-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** One PNG's worth of header: all the budget reads (width and height at bytes 16..24). */
function pngHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(33, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/** A GLB whose only content is `sizes.length` embedded images of those sizes. */
function fakeGlb(sizes: [number, number][]): Buffer {
  const parts = sizes.map(([w, h]) => pngHeader(w, h));
  let off = 0;
  const bufferViews = parts.map((p) => {
    const v = { buffer: 0, byteOffset: off, byteLength: p.length };
    off += p.length;
    return v;
  });
  const bin = Buffer.concat(parts);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const json = { asset: { version: '2.0' }, buffers: [{ byteLength: binPadded.length }], bufferViews, images: parts.map((_p, i) => ({ bufferView: i, name: `img${i}`, mimeType: 'image/png' })) };
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + text.length + 8 + binPadded.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(text.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binPadded.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, text, bh, binPadded]);
}

let n = 0;
/** class -> directory holding the given fake GLBs. */
function roots(files: Partial<Record<'vehicle' | 'building' | 'infantry', Record<string, [number, number][]>>>): Record<string, string> {
  const base = path.join(scratch, `case${n++}`);
  const out: Record<string, string> = {};
  for (const [cls, glbs] of Object.entries(files)) {
    const dir = path.join(base, cls);
    mkdirSync(dir, { recursive: true });
    for (const [name, sizes] of Object.entries(glbs ?? {})) writeFileSync(path.join(dir, `${name}.glb`), fakeGlb(sizes));
    out[cls] = dir;
  }
  return out;
}

function py(body: string): { failures: string[]; value: unknown } {
  const code =
    'import sys, json\n' +
    `sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})\n` +
    'sys.argv = ["x"]\n' +
    'import validate_mesh_assets as v\n' +
    body;
  const r = spawnSync('python3', ['-c', code], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop()!) as { failures: string[]; value: unknown };
}

const budgetOf = (r: Record<string, string>, pre = ''): string[] =>
  py(`${pre}f, rows = v.check_texture_budget(${JSON.stringify(r)})\nprint(json.dumps({"failures": f, "value": rows}))`).failures;

const TWO_K: [number, number] = [2048, 2048];

describe('the texture budget per class', () => {
  it('the real tree passes: today is the ceiling, not over it', () => {
    const real = path.join(REPO, 'art', 'meshes');
    const f = budgetOf({
      vehicle: path.join(real, 'vehicles'),
      building: path.join(real, 'buildings'),
      infantry: real,
    });
    expect(f).toEqual([]);
  });

  it('three 2048 images in a vehicle pass (the Lavi pilot, 64.0 MiB of 80)', () => {
    expect(budgetOf(roots({ vehicle: { a: [TWO_K, TWO_K, TWO_K] } }))).toEqual([]);
  });

  it('a FOURTH 2048 image (85.3 MiB) fails a vehicle', () => {
    const f = budgetOf(roots({ vehicle: { a: [TWO_K, TWO_K, TWO_K, TWO_K] } }));
    expect(f.join('\n')).toMatch(/vehicle a holds 85\.3 MiB .*ceiling of 80 MiB/);
  });

  it('a 4096-px normal map fails on its edge as well as its bytes', () => {
    const f = budgetOf(roots({ vehicle: { a: [TWO_K, [4096, 4096], TWO_K] } }));
    expect(f.join('\n')).toMatch(/a 4096-px image, over the vehicle limit of 2560 px/);
    expect(f.join('\n')).toMatch(/MiB of textures/);
  });

  it('a building over 2048 px fails, an infantry atlas at 3072 does not', () => {
    expect(budgetOf(roots({ building: { b: [[2560, 2560]] } })).join('\n')).toMatch(/building b has a 2560-px image/);
    expect(budgetOf(roots({ infantry: { i: [[3072, 1024]] } }))).toEqual([]);
    expect(budgetOf(roots({ infantry: { i: [[4096, 1024]] } })).join('\n')).toMatch(/infantry i has a 4096-px image/);
  });

  it('a class with no entry is a failure, not a pass', () => {
    const f = budgetOf(roots({ vehicle: { a: [TWO_K] } }), 'v.TEXTURE_BUDGET.pop("vehicle")\n');
    expect(f.join('\n')).toMatch(/class 'vehicle' has no budget entry/);
  });
});

describe('the size oracle takes literals', () => {
  const LAVI = path.join(REPO, 'art', 'meshes', 'vehicles', 'mbt_lavi.glb');
  const sizeOf = (pre = ''): number =>
    Number(py(`${pre}print(json.dumps({"failures": [], "value": v.glb_texture_bytes(${JSON.stringify(LAVI)})}))`).value);

  it('the shipped Lavi holds exactly three 2048-px images: 3 x 22,369,621 logical bytes', () => {
    expect(sizeOf()).toBe(67_108_863);
  });

  it('a mutated mip-chain factor moves the answer off the literal', () => {
    expect(sizeOf('v.MIP_CHAIN_FACTOR = 1.0\n')).not.toBe(67_108_863);
    expect(sizeOf('v.MIP_CHAIN_FACTOR = 2.0\n')).not.toBe(67_108_863);
  });
});
