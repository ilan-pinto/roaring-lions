/**
 * The infantry kit as SHIPPED (GH-826): `art/meshes/<team>.glb` and the
 * `assets/meshes/<team>.glb` the game loads, read back from disk, for every team
 * in `INFANTRY_KIT_TEAMS` (the Rifle Squad, then the Demolition squad).
 *
 * `infantry-kit-pass.test.ts` proves the graft against a fixture; this proves
 * the bytes in the tree. What it holds that nothing else does:
 *
 *  - the kit is OWED: the unit's JSON declares three tracks of three tiers,
 *    and the file carries parts for every (track, tier). A tier whose parts
 *    were dropped would still load, still draw, and just never show up in the
 *    garage or the field -- `owes` is the check, and it is run below on a
 *    mutated copy that must fail it;
 *  - the budgets (<= 1,200 drawn per figure at max kit, <= 5,000 per file);
 *  - the part table matches the vertices: every part id on a vertex is a row
 *    of `rl_kit.parts`, and every row has its triangles;
 *  - the Blender source and the mesh agree: `rl_kit_base` (the hash of the
 *    body the parts were fitted to) equals the hash of the body in the file,
 *    so a re-export of the team without re-fitting the kit goes red here and
 *    not in a screenshot;
 *  - the ENCODED file carries the same kit, and grew by no more than the +64
 *    KiB budget over the pre-kit encode.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { INFANTRY_KIT_FIGURE_TRIS, INFANTRY_KIT_FILE_TRIS, INFANTRY_KIT_HOSTS, KIT_MAX_TIER } from './kit-contract';
import { INFANTRY_KIT_TAG_ATTR, baseHash, declaredTeamTracks, drawnFigureTris, type InfantryKitTag } from './infantry-kit-pass';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * What differs per team. `preKitEncodedBytes` is `assets/meshes/<team>.glb` as encoded on main before its kit.
 * `hosts` are the role primitives its kit joins: the Demolition squad's weapon primitive is a palette one with no UVs, so
 * its devices ride `uniform`. `leaderOnly` are the parts only the radio man carries.
 */
const TEAMS: Readonly<
  Record<
    string,
    { figures: string[]; hosts: string[]; leader: string; preKitEncodedBytes: number; gunBone: string; noShoulderArmour: boolean }
  >
> = {
  inf_squad: { figures: ['f0', 'f1', 'f2'], hosts: ['uniform', 'weapon'], leader: 'f1', preKitEncodedBytes: 1_799_936, gunBone: 'weapon', noShoulderArmour: false },
  demo_squad: { figures: ['demo_a', 'demo_b'], hosts: ['uniform'], leader: 'demo_b', preKitEncodedBytes: 1_018_964, gunBone: 'weapon', noShoulderArmour: true },
  // Breach: both carbines are bound to the SPINE (the team's skin has no `_weapon` bone), so a gun accessory rides the spine; the
  // textured weapon primitive is a host (devices ride `weapon` and `uniform`). The lead (30 Oct): no shoulder or sleeve armour.
  breach_team: { figures: ['brc_point', 'brc_cover'], hosts: ['uniform', 'weapon'], leader: 'brc_cover', preKitEncodedBytes: 708_272, gunBone: 'spine', noShoulderArmour: true },
};
/** The parts that mount on the gun: they ride whatever bone the team's carbine is bound to. */
const GUN_PARTS = ['red_dot', 'foregrip', 'lpvo', 'prism_sight', 'laser_box', 'weapon_light', 'suppressor'];
const GROWTH_BUDGET_BYTES = 64 * 1024;

type Packed = InfantryKitTag & { name: string; tris: number };

const plain = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function kitParts(doc: Document): Map<string, Packed[]> {
  const out = new Map<string, Packed[]>();
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getName().startsWith('kit_')) continue;
    const rl = n.getExtras().rl_kit as { host: string; parts: Packed[] };
    out.set(rl.host, rl.parts);
  }
  return out;
}

/** What the unit's JSON owes the file: every declared track at every tier, on a host it may join. */
function owes(parts: ReadonlyMap<string, Packed[]>, tracks: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const host of parts.keys()) if (!INFANTRY_KIT_HOSTS.includes(host)) problems.push(`host ${host} is not a kit host`);
  const all = [...parts.values()].flat();
  for (const track of tracks) {
    for (let tier = 1; tier <= KIT_MAX_TIER; tier++) {
      if (!all.some((p) => p.track === track && p.tier === tier)) problems.push(`no part for ${track} tier ${tier}`);
    }
  }
  for (const p of all) if (!tracks.has(p.track)) problems.push(`${p.name}: track ${p.track} is not declared`);
  return problems;
}

for (const [team, spec] of Object.entries(TEAMS)) {
const ART = path.join(REPO, 'art', 'meshes', `${team}.glb`);
const SOURCE = path.join(REPO, 'art', 'parts', 'inf_kit', `${team}.glb`);
const SHIPPED = path.join(REPO, 'assets', 'meshes', `${team}.glb`);

describe(`${team}: the kit in art/meshes`, () => {
  const doc = plain.readBinary(readFileSync(ART));
  const tracks = declaredTeamTracks(team);

  it('declares three tracks, so `owes` is not vacuous', () => {
    expect([...tracks].sort()).toEqual(['armour', 'firepower', 'sensors']);
  });

  it('carries a packed node per host and a part for every track and tier it owes', async () => {
    const parts = kitParts(await doc);
    expect([...parts.keys()].sort()).toEqual([...spec.hosts].sort());
    expect(owes(parts, tracks)).toEqual([]);
  });

  it('`owes` goes red on a file with a tier missing or a track nobody declared (falsification)', async () => {
    const parts = kitParts(await doc);
    const dropped = new Map([...parts].map(([h, ps]) => [h, ps.filter((p) => !(p.track === 'sensors' && p.tier === 3))]));
    expect(owes(dropped, tracks)).toContain('no part for sensors tier 3');
    expect(owes(parts, new Set(['armour', 'sensors']))).toContainEqual(expect.stringMatching(/track firepower is not declared/));
  });

  it('is inside the triangle budgets, per figure as drawn and per file', async () => {
    const all = [...kitParts(await doc).values()].flat();
    expect(all.reduce((n, p) => n + p.tris, 0)).toBeLessThanOrEqual(INFANTRY_KIT_FILE_TRIS);
    const drawn = drawnFigureTris(all.map((p) => ({ tag: p, tris: p.tris })));
    expect(Object.keys(drawn).sort()).toEqual([...spec.figures].sort());
    for (const n of Object.values(drawn)) expect(n).toBeLessThanOrEqual(INFANTRY_KIT_FIGURE_TRIS);
  });

  it('puts the radio whip and the pack on the leader only', async () => {
    const all = [...kitParts(await doc).values()].flat();
    for (const part of ['whip_short', 'whip_long', 'radio_panel', 'radio_pack']) {
      expect(all.filter((p) => p.part === part).map((p) => p.figure)).toEqual([spec.leader]);
    }
  });

  it('rides gun accessories on the bone the carbine is bound to, and keeps shoulder armour off where the lead ruled it out', async () => {
    const all = [...kitParts(await doc).values()].flat();
    const guns = all.filter((p) => GUN_PARTS.includes(p.part));
    expect(guns.length).toBeGreaterThan(0);
    for (const p of guns) expect(p.bone, p.name).toBe(spec.gunBone);
    const shoulder = all.filter((p) => p.part === 'deltoid' || p.part === 'sleeve');
    if (spec.noShoulderArmour) expect(shoulder.map((p) => p.name)).toEqual([]);
    else expect(shoulder.length).toBeGreaterThan(0);
  });

  it('every vertex carries a part id that is a row of the table, and every row has its triangles', async () => {
    const d = await doc;
    for (const n of d.getRoot().listNodes()) {
      if (!n.getName().startsWith('kit_')) continue;
      const rl = n.getExtras().rl_kit as { parts: Packed[] };
      const prim = n.getMesh()!.listPrimitives()[0];
      const tag = prim.getAttribute(INFANTRY_KIT_TAG_ATTR)!.getArray() as Uint8Array;
      const idx = prim.getIndices()!.getArray()!;
      const tris = new Array<number>(rl.parts.length).fill(0);
      for (let i = 0; i < idx.length; i += 3) {
        const id = tag[idx[i]];
        expect(id).toBeLessThan(rl.parts.length);
        tris[id]++;
      }
      rl.parts.forEach((p, i) => expect(tris[i], p.name).toBe(p.tris));
    }
  });

  it('is bound to the bones its table names, at weight 1, on the team\'s own skin', async () => {
    const d = await doc;
    const skin = d.getRoot().listSkins()[0];
    const joints = skin.listJoints().map((j) => j.getName());
    for (const n of d.getRoot().listNodes()) {
      if (!n.getName().startsWith('kit_')) continue;
      expect(n.getSkin()).toBe(skin);
      const rl = n.getExtras().rl_kit as { parts: Packed[] };
      const prim = n.getMesh()!.listPrimitives()[0];
      const tag = prim.getAttribute(INFANTRY_KIT_TAG_ATTR)!;
      const j = prim.getAttribute('JOINTS_0')!;
      const w = prim.getAttribute('WEIGHTS_0')!;
      const ej = [0, 0, 0, 0];
      const ew = [0, 0, 0, 0];
      for (let v = 0; v < j.getCount(); v++) {
        j.getElement(v, ej);
        w.getElement(v, ew);
        const p = rl.parts[tag.getScalar(v)];
        expect(joints[ej[0]]).toBe(`${p.figure}_${p.bone}`);
        expect(ew[0]).toBe(1);
      }
    }
  });

  it('is the body the Blender source was fitted to', async () => {
    const source = await plain.read(SOURCE);
    expect(source.getRoot().listScenes()[0].getExtras().rl_kit_base).toBe(baseHash(await doc));
  });
});

describe(`${team}: the kit in assets/meshes`, () => {
  it('is the same kit, encoded, within +64 KiB of the pre-kit file', async () => {
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
    const shipped = await io.read(SHIPPED);
    const art = await plain.read(ART);
    const a = kitParts(art);
    const s = kitParts(shipped);
    expect([...s.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [host, parts] of a) expect(s.get(host)?.map((p) => p.name)).toEqual(parts.map((p) => p.name));
    const bytes = readFileSync(SHIPPED).length;
    expect(bytes - spec.preKitEncodedBytes).toBeLessThanOrEqual(GROWTH_BUDGET_BYTES);
    expect(bytes).toBeGreaterThan(spec.preKitEncodedBytes); // the kit is in it
  });
});

if (team === 'breach_team') {
  describe('breach_team: the shield light', () => {
    it('is one firepower tier-2 part on brc_point only, riding the shield\'s own bone', async () => {
      const doc = await plain.readBinary(readFileSync(ART));
      const all = [...kitParts(doc).values()].flat();
      const light = all.filter((p) => p.part === 'shield_light');
      expect(light.map((p) => [p.figure, p.bone, p.track, p.tier])).toEqual([['brc_point', 'shield', 'firepower', 2]]);
      expect(light[0].tris).toBeLessThanOrEqual(Math.floor(28 * 1.1));
    });

    it('wears a 4x prism sight as its tier-2 optic, not the 0.265 m LPVO (the lead, 30 Oct: real stations on the carbine)', async () => {
      const doc = await plain.readBinary(readFileSync(ART));
      const all = [...kitParts(doc).values()].flat();
      expect([...new Set(all.filter((p) => p.slot === 'optic').map((p) => `${p.part}:${p.tier}`))].sort()).toEqual(['prism_sight:2', 'red_dot:1']);
      expect(all.some((p) => p.part === 'lpvo')).toBe(false);
    });
  });
}
}
