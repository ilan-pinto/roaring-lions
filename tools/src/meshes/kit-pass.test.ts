/**
 * The kit pass, against the in-memory vehicle and source of `kit-fixture.ts`.
 *
 * What it pins, in the order the plan asks for it (plan 3, Task 2): the part
 * lands where the Blender scene put it although it now hangs under its host's
 * parent (the inverse host transform); it takes its host's TRS, material, role
 * and attribute set; every live accessor is byte-identical afterwards; a
 * second run writes the same bytes; and every refusal the contract names is a
 * throw that leaves the target untouched.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeIO, type Accessor, type Document, type Node, type mat4, type vec3 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  KIT_VEHICLES,
  applyKitGraft,
  declaredTracks,
  parseKitArgs,
  runKitPass,
  stripKit,
} from './kit-pass';
import { DEFAULT_KIT, boxMesh, kitSource, kitVehicle, type KitPartSpec } from './kit-fixture';
import { applyWreckPass } from './wreck-pass';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const nodeNamed = (doc: Document, name: string): Node => {
  const found = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);
  if (!found) throw new Error(`no node "${name}"`);
  return found;
};

const kitNodes = (doc: Document): Node[] =>
  doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getName().startsWith('kit_'));

function apply(m: mat4, p: number[]): vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Every vertex of `node`'s mesh, in world space. */
function worldPositions(node: Node): vec3[] {
  const pos = node.getMesh()?.listPrimitives()[0].getAttribute('POSITION');
  if (!pos) throw new Error(`${node.getName()}: no POSITION`);
  const m = node.getWorldMatrix();
  const out: vec3[] = [];
  const el = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) out.push(apply(m, pos.getElement(i, el)));
  return out;
}

/**
 * The normal matrix of `m`: the inverse-transpose of its 3x3 linear part, by
 * cofactors, as a column-major mat4 with no translation. Written out here
 * rather than imported from `kit-pass.ts`, so the test's oracle cannot shift
 * with the code under test. The fixture's turret pivot carries a NON-UNIFORM
 * scale, so this is not the linear part: under [1, 2, 0.5] the two disagree,
 * and a graft that carried normals by the linear part reads wrong here.
 */
function normalMatrixOf(m: mat4): mat4 {
  // Column-major: element (row r, col c) is m[c * 4 + r].
  const a = (r: number, c: number): number => m[c * 4 + r];
  const det =
    a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) -
    a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) +
    a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
  // inverse(A)^T = cofactor(A) / det; cofactor (r, c) of the 3x3.
  const cof = (r: number, c: number): number => {
    const rs = [0, 1, 2].filter((k) => k !== r);
    const cs = [0, 1, 2].filter((k) => k !== c);
    const minor = a(rs[0], cs[0]) * a(rs[1], cs[1]) - a(rs[0], cs[1]) * a(rs[1], cs[0]);
    return ((r + c) % 2 === 0 ? 1 : -1) * minor;
  };
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 4 + r] = cof(r, c) / det;
  out[15] = 1;
  return out as unknown as mat4;
}

/** Every normal of `node`'s mesh, in world space, unit length. */
function worldNormals(node: Node): vec3[] {
  const nrm = node.getMesh()?.listPrimitives()[0].getAttribute('NORMAL');
  if (!nrm) throw new Error(`${node.getName()}: no NORMAL`);
  const nm = normalMatrixOf(node.getWorldMatrix());
  const out: vec3[] = [];
  const el = [0, 0, 0];
  for (let i = 0; i < nrm.getCount(); i++) {
    const v = apply(nm, nrm.getElement(i, el));
    const len = Math.hypot(v[0], v[1], v[2]);
    out.push([v[0] / len, v[1] / len, v[2] / len]);
  }
  return out;
}

const semanticsOf = (node: Node): string[] =>
  (node.getMesh()?.listPrimitives()[0].listSemantics() ?? []).slice().sort();

const bytes = async (doc: Document): Promise<Buffer> => Buffer.from(await io.writeBinary(doc));

/** A copy of an accessor's raw bytes. */
function rawOf(a: Accessor): Buffer {
  const arr = a.getArray();
  if (!arr) throw new Error(`${a.getName()}: no array`);
  return Buffer.from(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
}

describe('applyKitGraft', () => {
  it('hangs each part beside its host: same parent, same TRS, host material, host role, rl_kit', () => {
    const target = kitVehicle();
    const report = applyKitGraft(target, kitSource(), 'fixture');
    expect(report.grafted).toEqual([
      'kit_armour_1_hull_hull',
      'kit_armour_3_turret_hull',
      'kit_sensors_2_turret_metal',
    ]);

    for (const spec of DEFAULT_KIT) {
      const kit = nodeNamed(target, `kit_${spec.track}_${spec.tier}_${spec.host}`);
      const host = nodeNamed(target, spec.host);
      expect(kit.getParentNode()).toBe(host.getParentNode());
      expect(kit.getTranslation()).toEqual(host.getTranslation());
      expect(kit.getRotation()).toEqual(host.getRotation());
      expect(kit.getScale()).toEqual(host.getScale());
      expect(kit.getMesh()?.listPrimitives()[0].getMaterial()).toBe(host.getMesh()?.listPrimitives()[0].getMaterial());
      expect(kit.getExtras()).toEqual({
        rl_role: host.getExtras().rl_role,
        rl_kit: { track: spec.track, tier: spec.tier, host: spec.host },
      });
      expect(kit.listChildren()).toEqual([]);
    }
    // A hull part is a SCENE child (its host's parent is the scene).
    const scene = target.getRoot().listScenes()[0];
    expect(scene.listChildren()).toContain(nodeNamed(target, 'kit_armour_1_hull_hull'));
  });

  it('keeps every source vertex and normal where the Blender scene put it, in world space', () => {
    const source = kitSource();
    const target = kitVehicle();
    applyKitGraft(target, source, 'fixture');

    for (const spec of DEFAULT_KIT) {
      const name = `kit_${spec.track}_${spec.tier}_${spec.host}`;
      const want = worldPositions(nodeNamed(source, name));
      const got = worldPositions(nodeNamed(target, name));
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        for (let k = 0; k < 3; k++) expect(got[i][k], `${name} v${i}[${k}]`).toBeCloseTo(want[i][k], 5);
      }
      const wantN = worldNormals(nodeNamed(source, name));
      const gotN = worldNormals(nodeNamed(target, name));
      for (let i = 0; i < wantN.length; i++) {
        for (let k = 0; k < 3; k++) expect(gotN[i][k], `${name} n${i}[${k}]`).toBeCloseTo(wantN[i][k], 5);
      }
    }
  });

  it("takes the host's attribute set: TEXCOORD_0 kept on a textured host, dropped on a palette one", () => {
    const target = kitVehicle();
    applyKitGraft(target, kitSource(), 'fixture');
    expect(semanticsOf(nodeNamed(target, 'kit_armour_1_hull_hull'))).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
    expect(semanticsOf(nodeNamed(target, 'kit_armour_3_turret_hull'))).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
    expect(semanticsOf(nodeNamed(target, 'kit_sensors_2_turret_metal'))).toEqual(['NORMAL', 'POSITION']);
    expect(nodeNamed(target, 'kit_sensors_2_turret_metal').getMesh()?.listPrimitives()[0].getMaterial()).toBeNull();
    // The pinned texel survives the trip.
    const uv = nodeNamed(target, 'kit_armour_1_hull_hull').getMesh()?.listPrimitives()[0].getAttribute('TEXCOORD_0');
    expect(Array.from(uv?.getElement(0, [0, 0]) ?? [])).toEqual([0.75, 0.25]);
  });

  it('leaves every pre-existing accessor byte-identical, in memory and through a write', async () => {
    const target = kitVehicle();
    const accessors = target.getRoot().listAccessors();
    const snapshot = accessors.map(rawOf);
    const before = await io.readBinary(await bytes(target));

    applyKitGraft(target, kitSource(), 'fixture');

    accessors.forEach((a: Accessor, i) => {
      expect(target.getRoot().listAccessors()).toContain(a);
      expect(rawOf(a).equals(snapshot[i]), a.getName()).toBe(true);
    });
    // And through the writer, which regroups accessors by buffer view, so they
    // are matched by name: every live accessor is in the written file, equal.
    const after = await io.readBinary(await bytes(target));
    const now = new Map(after.getRoot().listAccessors().map((a) => [a.getName(), a] as const));
    const old = before.getRoot().listAccessors();
    expect(now.size).toBeGreaterThan(old.length);
    for (const a of old) {
      const b = now.get(a.getName());
      expect(b, a.getName()).toBeDefined();
      if (b) expect(rawOf(b).equals(rawOf(a)), a.getName()).toBe(true);
    }
  });

  it('is idempotent: a second graft writes the same bytes', async () => {
    const target = kitVehicle();
    applyKitGraft(target, kitSource(), 'fixture');
    const once = await bytes(target);
    const counts = [target.getRoot().listNodes().length, target.getRoot().listMeshes().length, target.getRoot().listAccessors().length];

    const report = applyKitGraft(target, kitSource(), 'fixture');
    expect(report.stripped).toBe(3);
    expect([target.getRoot().listNodes().length, target.getRoot().listMeshes().length, target.getRoot().listAccessors().length]).toEqual(counts);
    expect((await bytes(target)).equals(once)).toBe(true);
  });

  it('stripKit takes the file back to its ungrafted bytes -- no orphaned mesh or accessor', async () => {
    const target = kitVehicle();
    const pristine = await bytes(target);
    applyKitGraft(target, kitSource(), 'fixture');
    expect(stripKit(target)).toBe(3);
    expect((await bytes(target)).equals(pristine)).toBe(true);
  });

  it('runs inside the pipeline: kit -> wreck twice writes the same bytes as once', async () => {
    const target = kitVehicle();
    const recipe = { hull: 'wheeled' as const, turretPivot: 'turret_pivot' };
    applyKitGraft(target, kitSource(), 'fixture');
    applyWreckPass(target, 'fixture', recipe);
    const once = await bytes(target);
    applyKitGraft(target, kitSource(), 'fixture');
    applyWreckPass(target, 'fixture', recipe);
    expect((await bytes(target)).equals(once)).toBe(true);
  });

  it('the turret pivot is non-uniformly scaled, so a normal matrix is NOT the linear part there', () => {
    // Guards the fixture itself: under a rotation alone the inverse-transpose
    // IS the linear part, and the normal test above could not tell a graft
    // that carried normals by the wrong matrix from one that did not.
    const m = nodeNamed(kitVehicle(), 'turret_hull').getWorldMatrix();
    const nm = normalMatrixOf(m);
    const unit = (v: vec3): vec3 => {
      const l = Math.hypot(...v);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const lin = [...m.slice(0, 12), 0, 0, 0, 1] as unknown as mat4;
    const n: number[] = [1, 1, 0];
    const viaLinear = unit(apply(lin, n));
    const viaNormal = unit(apply(nm, n));
    expect(Math.hypot(viaLinear[0] - viaNormal[0], viaLinear[1] - viaNormal[1], viaLinear[2] - viaNormal[2])).toBeGreaterThan(0.1);
  });

  it("leaves rl_role ABSENT on a part whose host carries none -- not ''", () => {
    const target = kitVehicle();
    const host = nodeNamed(target, 'hull_hull');
    const extrasNoRole = { ...host.getExtras() };
    delete extrasNoRole.rl_role;
    host.setExtras(extrasNoRole);
    applyKitGraft(target, kitSource(), 'fixture');
    const extras = nodeNamed(target, 'kit_armour_1_hull_hull').getExtras();
    expect('rl_role' in extras).toBe(false);
    expect(extras.rl_role).toBe(host.getExtras().rl_role);
  });

  it('accepts a part whose source node is not at the identity, by its world matrix', () => {
    const source = kitSource();
    const node = nodeNamed(source, 'kit_armour_1_hull_hull');
    const want = worldPositions(node);
    // Move the node and counter-move its vertices: same world positions.
    node.setTranslation([5, 0, 0]);
    const pos = node.getMesh()?.listPrimitives()[0].getAttribute('POSITION');
    if (!pos) throw new Error('no POSITION');
    const el = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      pos.setElement(i, [el[0] - 5, el[1], el[2]]);
    }
    const target = kitVehicle();
    applyKitGraft(target, source, 'fixture');
    const got = worldPositions(nodeNamed(target, 'kit_armour_1_hull_hull'));
    for (let i = 0; i < want.length; i++) for (let k = 0; k < 3; k++) expect(got[i][k]).toBeCloseTo(want[i][k], 5);
  });

  const base = DEFAULT_KIT[0];
  const refusals: readonly [string, readonly KitPartSpec[], RegExp, { tracks?: ReadonlySet<string> }?][] = [
    ['an unknown host', [{ ...base, host: 'hull_nope' }], /names host "hull_nope", which is not a live mesh node/],
    ['a wreck twin as host', [{ ...base, host: 'WRECK_hull_hull' }], /not a live mesh node/],
    ['a host-less part', [{ ...base, rlKit: { track: 'armour', tier: 1 } }], /names no host/],
    ['a part with no rl_kit', [{ ...base, rlKit: null }], /carries no extras\.rl_kit/],
    ['a name that does not match its rl_kit', [{ ...base, name: 'kit_armour_2_hull_hull' }], /does not match its rl_kit/],
    ['a node that is not a kit part', [{ ...base, name: 'armour_plate' }], /is not a kit part/],
    ['tier 0', [{ ...base, tier: 0 }], /outside 1-3/],
    ['tier 4', [{ ...base, tier: 4 }], /outside 1-3/],
    ['a fractional tier', [{ ...base, tier: 1.5, name: 'kit_armour_1.5_hull_hull' }], /outside 1-3/],
    ['a malformed track', [{ ...base, track: 'Fire_power', name: 'kit_Fire_power_1_hull_hull' }], /not a lower-case track/],
    ['a duplicate (track, tier, host)', [base, { ...base, min: [0, 0, 0], max: [1, 1, 1] }], /two kit parts for/],
    ['a textured host with no TEXCOORD_0', [{ ...base, noUv: true }], /needs TEXCOORD_0/],
    ['a part carrying a material', [{ ...base, material: true }], /carries a material/],
    ['a part of two primitives', [{ ...base, extraPrimitive: true }], /has 2 primitives; a kit part is exactly one/],
    ['an unindexed part on an indexed host', [{ ...base, unindexed: true }], /is not indexed and host "hull_hull" is indexed/],
    ['a track the unit does not declare', [{ ...base, track: 'firepower', name: undefined }], /not one fixture's JSON declares/, { tracks: new Set(['armour', 'sensors']) }],
    ['an empty source', [], /has no parts/],
  ];
  it('refuses an indexed part on an unindexed host, and leaves the target untouched', async () => {
    const target = kitVehicle();
    const host = nodeNamed(target, 'hull_hull');
    const prim = host.getMesh()?.listPrimitives()[0];
    host.setMesh(
      boxMesh(target, 'hull_hull_flat', [-1, 0, -1], [1, 2, 1], { uv: [0.1, 0.2], material: prim?.getMaterial(), unindexed: true })
    );
    const before = await bytes(target);
    expect(() => applyKitGraft(target, kitSource([base]), 'fixture')).toThrow(/is indexed and host "hull_hull" is not/);
    expect((await bytes(target)).equals(before)).toBe(true);
  });

  for (const [what, parts, error, opts] of refusals) {
    it(`refuses ${what}, and leaves the target untouched`, async () => {
      const target = kitVehicle();
      applyKitGraft(target, kitSource(), 'fixture'); // a previous good run
      const before = await bytes(target);
      expect(() => applyKitGraft(target, kitSource(parts), 'fixture', opts ?? {})).toThrow(error);
      expect((await bytes(target)).equals(before)).toBe(true);
    });
  }
});

describe('parseKitArgs', () => {
  it('reads --id= flags, and tolerates the separator pnpm forwards verbatim', () => {
    expect(parseKitArgs([])).toBe('all');
    expect(parseKitArgs(['--'])).toBe('all');
    expect(parseKitArgs(['--', '--id=mbt_lavi', '--id=dozer_d9'])).toEqual(['mbt_lavi', 'dozer_d9']);
  });
  for (const argv of [['--id', 'mbt_lavi'], ['--ids=mbt_lavi'], ['--id='], ['mbt_lavi'], ['--all'], ['--id=mbt_lavi', '--force']]) {
    it(`refuses [${argv.join(' ')}]`, () => {
      expect(() => parseKitArgs(argv)).toThrow(/unrecognised argument/);
    });
  }
});

describe('KIT_VEHICLES', () => {
  it('is the eight KDF vehicles, every one declaring upgrade tracks in its unit JSON', () => {
    expect([...KIT_VEHICLES].sort()).toEqual([
      'apc_eitan',
      'apc_kipod',
      'dozer_d9',
      'heli_peten',
      'ifv_namer',
      'jeep_shoded',
      'mbt_lavi',
      'scout_shachaf',
    ]);
    for (const id of KIT_VEHICLES) expect(declaredTracks(id).size, id).toBeGreaterThan(0);
    // No firepower track on the D9: the check a source would have to fail.
    expect(declaredTracks('dozer_d9').has('firepower')).toBe(false);
  });
});

describe('runKitPass', () => {
  /** A throwaway tree: sources/, vehicles/, units/. */
  function tree(): { root: string; sources: string; vehicles: string; units: string } {
    const root = mkdtempSync(path.join(tmpdir(), 'kit-pass-'));
    const dirs = { root, sources: path.join(root, 'sources'), vehicles: path.join(root, 'vehicles'), units: path.join(root, 'units') };
    mkdirSync(dirs.vehicles);
    mkdirSync(dirs.units);
    return dirs;
  }

  it('with no sources at all reports "no kit sources" and grafts nothing', async () => {
    const t = tree();
    try {
      const lines: string[] = [];
      expect(await runKitPass('all', t, (l) => lines.push(l))).toEqual([]);
      expect(lines.join('\n')).toMatch(/no kit sources/);
      mkdirSync(t.sources);
      expect(await runKitPass('all', t, (l) => lines.push(l))).toEqual([]);
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });

  it('refuses --id for a kit vehicle with no source, and for a vehicle that carries no kit', async () => {
    const t = tree();
    try {
      await expect(runKitPass(['mbt_lavi'], t, () => {})).rejects.toThrow(/mbt_lavi: no kit source/);
      await expect(runKitPass(['technical'], t, () => {})).rejects.toThrow(/not a kit vehicle/);
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });

  it('refuses a source file that names no kit vehicle', async () => {
    const t = tree();
    try {
      mkdirSync(t.sources);
      writeFileSync(path.join(t.sources, 'mbt_lav.glb'), await bytes(kitSource()));
      await expect(runKitPass('all', t, () => {})).rejects.toThrow(/names no kit vehicle/);
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });

  it("grafts end to end, holding each part's track to the unit's JSON", async () => {
    const t = tree();
    try {
      mkdirSync(t.sources);
      writeFileSync(path.join(t.vehicles, 'mbt_lavi.glb'), await bytes(kitVehicle()));
      writeFileSync(path.join(t.sources, 'mbt_lavi.glb'), await bytes(kitSource()));
      writeFileSync(path.join(t.units, 'mbt_lavi.json'), JSON.stringify({ upgrades: { armour: {}, sensors: {} } }));
      const lines: string[] = [];
      expect(await runKitPass('all', t, (l) => lines.push(l))).toEqual(['mbt_lavi']);
      expect(lines[0]).toMatch(/^KIT_PASS_OK mbt_lavi 3 kit node\(s\)/);
      const written = await io.readBinary(readFileSync(path.join(t.vehicles, 'mbt_lavi.glb')));
      expect(kitNodes(written).map((n) => n.getName()).sort()).toEqual([
        'kit_armour_1_hull_hull',
        'kit_armour_3_turret_hull',
        'kit_sensors_2_turret_metal',
      ]);

      writeFileSync(path.join(t.units, 'mbt_lavi.json'), JSON.stringify({ upgrades: { armour: {} } }));
      await expect(runKitPass(['mbt_lavi'], t, () => {})).rejects.toThrow(/track "sensors" is not one mbt_lavi's JSON declares/);
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });
});
