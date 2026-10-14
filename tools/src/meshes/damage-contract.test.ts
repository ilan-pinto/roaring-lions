/**
 * `validate_mesh_assets.py`'s wreck contract, clause 3's damaged-copy branch
 * and clause 3c's cap, falsified: each mutation of a SCRATCH copy of the
 * shipped damaged Lavi must turn the Python check red, and the unmutated copy
 * must stay green -- so a clause that stopped looking cannot pass by silence.
 *
 * The check runs the real Python (`check_vehicle_wrecks`), the way
 * `e5_staged.test.ts` runs `validate_balance.py`, against both shipped forms:
 * the raw source of record and the Draco mirror.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-damage-contract-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Gltf = {
  nodes: { name?: string; mesh?: number; extras?: Record<string, unknown> }[];
  meshes: { name?: string; extras?: Record<string, unknown>; primitives: { material?: number; attributes: Record<string, number> }[] }[];
};

/** A GLB as (json, bin), and back. Only the JSON chunk is ever mutated. */
function splitGlb(buf: Buffer): { json: Gltf; bin: Buffer } {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  return { json, bin: buf.subarray(20 + jsonLen) };
}
function joinGlb(json: Gltf, bin: Buffer): Buffer {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (text.length % 4)) % 4;
  text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + bin.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, text, bin]);
}

/** Run clause 3/3c over one directory; returns the failure lines. */
function check(dir: string, caps?: { draco: number; raw: number }): string[] {
  const capPatch = caps
    ? `v.damage_caps = lambda path=None: (${caps.draco}, ${caps.raw})\n`
    : '';
  const py =
    'import sys, json\n' +
    `sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})\n` +
    'sys.argv = ["x"]\n' +
    'import validate_mesh_assets as v\n' +
    capPatch +
    `f, c = v.check_vehicle_wrecks([${JSON.stringify(dir)}])\n` +
    'print(json.dumps({"failures": f, "counts": c}))\n';
  const r = spawnSync('python3', ['-c', py], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!) as { failures: string[]; counts: [string, number][] };
  expect(out.counts[0]![1]).toBe(1); // it really read the one file
  return out.failures;
}

/** A scratch dir holding mbt_lavi.glb (raw or Draco), optionally mutated. */
function variant(tag: string, form: 'art' | 'assets', mutate?: (g: Gltf) => void): string {
  const dir = path.join(scratch, `${form}-${tag}`);
  rmSync(dir, { recursive: true, force: true });
  spawnSync('mkdir', ['-p', dir]);
  const src = path.join(REPO, form, 'meshes', 'vehicles', 'mbt_lavi.glb');
  const dst = path.join(dir, 'mbt_lavi.glb');
  if (!mutate) {
    copyFileSync(src, dst);
    return dir;
  }
  const { json, bin } = splitGlb(readFileSync(src));
  mutate(json);
  writeFileSync(dst, joinGlb(json, bin));
  return dir;
}

const twin = (g: Gltf, name: string) => g.nodes.find((n) => n.name === name)!;
const meshOf = (g: Gltf, name: string) => g.meshes[twin(g, name).mesh!]!;

describe.each(['art', 'assets'] as const)('wreck contract on the damaged Lavi (%s)', (form) => {
  it('the shipped file passes', () => {
    expect(check(variant('clean', form))).toEqual([]);
  });

  it('a copy with no rl_damage declaration fails (the old clause 3)', () => {
    const f = check(
      variant('undeclared', form, (g) => {
        delete twin(g, 'WRECK_hull_hull').extras!.rl_damage;
      })
    );
    expect(f.join('\n')).toMatch(/WRECK_hull_hull.*declares no extras\.rl_damage\.source/);
  });

  it('a source that is not the twin its name says fails', () => {
    const f = check(
      variant('wrongsource', form, (g) => {
        twin(g, 'WRECK_hull_hull').extras!.rl_damage = { source: 'hull_rubber' };
      })
    );
    expect(f.join('\n')).toMatch(/a twin's source is the live node its own name twins/);
  });

  it('an unmarked copy MESH fails (a re-wreck could not strip it)', () => {
    const f = check(
      variant('unmarkedmesh', form, (g) => {
        delete meshOf(g, 'WRECK_turret_metal').extras;
      })
    );
    expect(f.join('\n')).toMatch(/WRECK_turret_metal.*mesh does not itself carry/);
  });

  it('a copy whose attribute set differs from its source fails', () => {
    const f = check(
      variant('attrs', form, (g) => {
        delete meshOf(g, 'WRECK_hull_rubber').primitives[0]!.attributes._RL_TRACK;
      })
    );
    expect(f.join('\n')).toMatch(/WRECK_hull_rubber.*exactly the same set/);
  });

  it('a copy on a different material fails', () => {
    const f = check(
      variant('material', form, (g) => {
        meshOf(g, 'WRECK_hull_hull').primitives[0]!.material = 99;
      })
    );
    expect(f.join('\n')).toMatch(/WRECK_hull_hull.*uses material 99/);
  });

  it('a stale rl_damage flag on a twin that shares its live mesh fails', () => {
    const f = check(
      variant('stale', form, (g) => {
        twin(g, 'WRECK_turret_hull').extras!.rl_damage = { source: 'turret_hull' };
      })
    );
    expect(f.join('\n')).toMatch(/WRECK_turret_hull.*stale flag/);
  });

  it('the cap: the same file fails under a 1-byte cap', () => {
    // A literal cap of 1 byte must fail; the shipped cap passes (the first
    // test above). Reading the spend back to set the cap would be circular.
    const f = check(variant('clean', form), { draco: 1, raw: 1 });
    expect(f.join('\n')).toMatch(/damaged wreck copies .* against a cap of 1 /);
  });
});
