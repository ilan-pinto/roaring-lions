/**
 * `pnpm validate:meshes`'s backdrop-kit gate (`check_backdrop_meshes` in
 * `tools/validate_mesh_assets.py`, GH-161) can fail.
 *
 * A gate that has only ever passed is evidence about the gate, not about the
 * thing it guards (CLAUDE.md, "Every check gets an input that makes it fail").
 * Each case below hands the REAL function a copy of the shipped kit GLB with
 * one defect constructed in it and requires the named complaint:
 *
 *   the shipped file ........................ passes (non-vacuous: it also names the exempt kit)
 *   its texture stripped .................... "must ship exactly one material/image/texture"
 *   the same file under an unlisted kit id ... "is not in TEXTURED_BACKDROP_EXEMPT"
 *   a node without rl_textured .............. "does not declare rl_textured"
 *   a node naming a piece outside the list ... "outside the closed piece list"
 *   a piece named twice (and one missing) .... "appears 2 times" / "no mesh node for piece"
 *   a piece over its triangle cap ............ "over its cap"
 *   a piece with no LOD1 twin ................ "has no LOD1 twin"
 *   an LOD1 as big as its main mesh .......... "over 40% of its main mesh"
 *   an LOD1 of the olive ..................... "the olive has no LOD1"
 *   an atlas that is not 2048 x 2048 ......... "the atlas is"
 *   malformed olives ......................... "malformed rl_olives"
 *
 * The function is stdlib-only and called in a child `python3`, so this runs
 * wherever `pnpm test` does.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SHIPPED = path.join(REPO, 'art', 'meshes', 'backdrop', 'wadi_halam_kit.glb');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-backdrop-gate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Glb {
  json: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  bin: Buffer;
}

function parse(buf: Buffer): Glb {
  let at = 12;
  let json: Glb['json'] = {};
  let bin = Buffer.alloc(0);
  while (at < buf.readUInt32LE(8)) {
    const len = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = Buffer.from(body);
    at += 8 + len;
  }
  return { json, bin };
}

function pack(g: Glb): Buffer {
  const j = Buffer.from(JSON.stringify(g.json), 'utf8');
  const jp = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const bp = Buffer.concat([g.bin, Buffer.alloc((4 - (g.bin.length % 4)) % 4, 0)]);
  const total = 12 + 8 + jp.length + 8 + bp.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const ch = (len: number, type: number): Buffer => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([head, ch(jp.length, 0x4e4f534a), jp, ch(bp.length, 0x004e4942), bp]);
}

const shipped = readFileSync(SHIPPED);

/** Writes `<scratch>/<case>/<kit>.glb` from a mutated copy of the shipped file and runs the real gate on it. */
function gate(name: string, mutate: (g: Glb) => void, kit = 'wadi_halam_kit'): { failures: string[]; textured: string[] } {
  const g = parse(shipped);
  mutate(g);
  const dir = path.join(scratch, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${kit}.glb`), pack(g));
  const out = execFileSync(
    'python3',
    ['-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import validate_mesh_assets as v; print(json.dumps(v.check_backdrop_meshes(sys.argv[2])))', path.join(REPO, 'tools'), dir],
    { encoding: 'utf8' }
  );
  const [failures, textured] = JSON.parse(out) as [string[], string[]];
  return { failures, textured };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The main (LOD0) mesh nodes, then the LOD1 twins. */
const meshNodes = (g: Glb): Record<string, any>[] => g.json.nodes.filter((n: Record<string, any>) => n.mesh !== undefined && n.extras?.rl_lod === undefined);
const lod1Nodes = (g: Glb): Record<string, any>[] => g.json.nodes.filter((n: Record<string, any>) => n.mesh !== undefined && n.extras?.rl_lod === 1);
/* eslint-enable @typescript-eslint/no-explicit-any */
const mention = (r: { failures: string[] }, re: RegExp): boolean => r.failures.some((f) => re.test(f));

describe('check_backdrop_meshes', () => {
  it('passes the shipped kit, and names it as NOT palette-checked', () => {
    const r = gate('shipped', () => {});
    expect(r.failures).toEqual([]);
    expect(r.textured).toEqual(['wadi_halam_kit.glb']);
  });

  it('fails a kit whose atlas was lost', () => {
    const r = gate('no-texture', (g) => {
      delete g.json.images;
      delete g.json.textures;
      for (const m of g.json.materials) delete m.pbrMetallicRoughness.baseColorTexture;
    });
    expect(mention(r, /must ship exactly one material\/image\/texture, but carries 1\/0\/0/)).toBe(true);
  });

  it('fails a kit that ships a second material', () => {
    const r = gate('two-materials', (g) => g.json.materials.push({ ...g.json.materials[0], name: 'extra' }));
    expect(mention(r, /carries 2\/1\/1/)).toBe(true);
  });

  it('fails a textured GLB in this directory that is not on the list', () => {
    const r = gate('unlisted', () => {}, 'some_other_kit');
    expect(mention(r, /carries 1 material\(s\), 1 image\(s\), 1 texture\(s\) but 'some_other_kit' is not in TEXTURED_BACKDROP_EXEMPT/)).toBe(true);
    expect(r.textured).toEqual([]);
  });

  it('fails a node that does not declare rl_textured', () => {
    const r = gate('no-flag', (g) => delete meshNodes(g)[0].extras.rl_textured);
    expect(mention(r, /does not declare rl_textured/)).toBe(true);
  });

  it('fails a piece outside the closed list', () => {
    const r = gate('foreign-piece', (g) => (meshNodes(g)[0].extras.rl_piece = 'bd_not_a_piece'));
    expect(mention(r, /outside the closed piece list/)).toBe(true);
    expect(mention(r, /no mesh node for piece/)).toBe(true);
  });

  it('fails a piece named twice, and says which one went missing', () => {
    const r = gate('twice', (g) => {
      const [a, b] = meshNodes(g);
      b.extras.rl_piece = a.extras.rl_piece;
    });
    expect(mention(r, /appears 2 times/)).toBe(true);
    expect(mention(r, /no mesh node for piece/)).toBe(true);
  });

  it('fails a piece over its triangle cap', () => {
    const r = gate('over-cap', (g) => {
      const n = meshNodes(g).find((x) => x.extras.rl_piece === 'bd_olive');
      const prim = g.json.meshes[(n as Record<string, number>).mesh].primitives[0];
      g.json.accessors[prim.indices].count += 3 * 10; // 62 + 10 triangles against a cap of 64
    });
    expect(mention(r, /piece 'bd_olive' has 72 triangles, over its cap of 64/)).toBe(true);
  });

  it('fails a piece with no LOD1 twin', () => {
    const r = gate('no-lod1', (g) => {
      const victim = lod1Nodes(g).find((n) => n.extras.rl_piece === 'bd_taper') as Record<string, unknown>;
      victim.extras = { ...(victim.extras as object), rl_piece: 'bd_not_a_piece' }; // as good as removed from the census
    });
    expect(mention(r, /piece 'bd_taper' has no LOD1 twin/)).toBe(true);
  });

  it('fails an LOD1 twin that is as big as its main mesh', () => {
    const r = gate('fat-lod1', (g) => {
      const main = meshNodes(g).find((n) => n.extras.rl_piece === 'bd_terrace_a') as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const twin = lod1Nodes(g).find((n) => n.extras.rl_piece === 'bd_terrace_a') as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const count = g.json.accessors[g.json.meshes[main.mesh].primitives[0].indices].count;
      g.json.accessors[g.json.meshes[twin.mesh].primitives[0].indices].count = count;
    });
    expect(mention(r, /piece 'bd_terrace_a': LOD1 has \d+ triangles, over 40% of its main mesh's/)).toBe(true);
  });

  it('fails an LOD1 twin of the olive', () => {
    const r = gate('olive-lod1', (g) => {
      const twin = lod1Nodes(g).find((n) => n.extras.rl_piece === 'bd_terrace_a') as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      twin.extras.rl_piece = 'bd_olive';
    });
    expect(mention(r, /the olive has no LOD1/)).toBe(true);
  });

  it('fails an atlas that is not 2048 x 2048', () => {
    const r = gate('small-atlas', (g) => {
      const view = g.json.bufferViews[g.json.images[0].bufferView];
      const start = view.byteOffset ?? 0;
      const jpeg = g.bin.subarray(start, start + view.byteLength);
      // The SOF0/SOF2 marker: FF C0|C2, length, precision, height (2), width (2).
      let i = 2;
      let patched = false;
      while (i + 9 < jpeg.length && !patched) {
        if (jpeg[i] === 0xff && (jpeg[i + 1] === 0xc0 || jpeg[i + 1] === 0xc2)) {
          jpeg.writeUInt16BE(1024, i + 5);
          jpeg.writeUInt16BE(1024, i + 7);
          patched = true;
        } else if (jpeg[i] === 0xff && jpeg[i + 1] !== 0xd8) i += 2 + jpeg.readUInt16BE(i + 2);
        else i += 1;
      }
      expect(patched, 'found the JPEG SOF marker to patch').toBe(true);
    });
    expect(mention(r, /the atlas is \[1024, 1024\]|the atlas is \(1024, 1024\)/)).toBe(true);
  });

  it('fails malformed olive and anchor extras', () => {
    const r = gate('bad-extras', (g) => {
      const t = meshNodes(g).find((x) => x.extras.rl_piece === 'bd_terrace_a') as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      t.extras.rl_olives = '[[1, 2]]';
      t.extras.rl_anchors = '{"not": "a list"}';
    });
    expect(mention(r, /malformed rl_olives/)).toBe(true);
    expect(mention(r, /malformed rl_anchors/)).toBe(true);
  });
});
