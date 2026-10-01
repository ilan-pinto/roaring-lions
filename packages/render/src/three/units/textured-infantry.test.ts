import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXTURED_INFANTRY_TYPES } from './textured-infantry';
import { buildMeshUnitTemplate } from './mesh-unit';
import { rampMaterial } from '../world-materials';
import { rampForRole } from './mesh-role';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

/** A `GLTFLoader`-shaped result: one mesh per part, each arriving with
 *  whatever material the test hands it -- mirrors `textured-vehicle.test.ts`. */
function sceneOf(parts: { role: string; map: THREE.Texture | null }[]): {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
} {
  const scene = new THREE.Group();
  for (const part of parts) {
    const material = new THREE.MeshStandardMaterial();
    if (part.map) material.map = part.map;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = part.role;
    mesh.userData = { rl_role: part.role };
    scene.add(mesh);
  }
  return { scene, animations: [] };
}

const texture = () => new THREE.Texture();

describe('the textured infantry opt-out is a named list', () => {
  // Filled one team at a time as its GLB lands: B0b shipped the first two (GH-286),
  // then B3 and B4 (GH-179) three each and B5/B6 one each. The exact list is pinned
  // so an entry with no bake behind it is an edit made on purpose.
  it('names exactly the teams that ship a bake', () => {
    expect([...TEXTURED_INFANTRY_TYPES].sort()).toEqual([
      'at_team',
      'atgm_cell',
      'breach_team',
      'charge_squad',
      'demo_squad',
      'digger_crew',
      'inf_squad',
      'manpad_team',
      'militia_cell',
      'mortar_crew',
      'moto_rpg',
      'officer_engineer',
      'officer_fires',
      'officer_infantry',
      'recoilless_team',
      'recon_zikit',
      'rpg_team',
      'sarim_rifles',
    ]);
  });

  it('agrees with TEXTURED_INFANTRY_EXEMPT in tools/validate_mesh_assets.py', () => {
    const py = readFileSync(`${REPO}tools/validate_mesh_assets.py`, 'utf8');
    // Written as `set()` while empty and as `{...}` once filled; accept both.
    const block = /TEXTURED_INFANTRY_EXEMPT\s*=\s*(?:set\(\s*\)|\{([^}]*)\})/.exec(py);
    expect(block, 'TEXTURED_INFANTRY_EXEMPT not found in tools/validate_mesh_assets.py').not.toBeNull();
    const ids = [...((block as RegExpExecArray)[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...TEXTURED_INFANTRY_TYPES].sort());
  });

  it('is part of the union the gate actually checks', () => {
    const py = readFileSync(`${REPO}tools/validate_mesh_assets.py`, 'utf8');
    expect(py).toMatch(/TEXTURED_MESH_EXEMPT\s*=\s*\([^)]*TEXTURED_INFANTRY_EXEMPT[^)]*\)/);
  });
});

describe('buildMeshUnitTemplate, textured path', () => {
  it('refuses a texture from a team outside the named list', () => {
    expect(() =>
      buildMeshUnitTemplate(sceneOf([{ role: 'uniform', map: texture() }]), 'kdf', 'at_team.glb')
    ).toThrow(/at_team\.glb.*not in TEXTURED_INFANTRY_TYPES/);
  });

  it('keeps the loader\'s own bake for a listed team, not the faction ramp', () => {
    const map = texture();
    const gltf = sceneOf([{ role: 'uniform', map }]);
    let loaded: THREE.Material | null = null;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) loaded = m.material as THREE.Material;
    });

    const template = buildMeshUnitTemplate(gltf, 'kdf', 'at_team.glb', true);
    const mat = template.materials[0] as THREE.MeshStandardMaterial;
    expect(mat).toBe(loaded);
    expect(mat.map).toBe(map);
    expect(mat.color.getHexString()).not.toBe(
      rampMaterial(rampForRole('uniform', 'kdf')).color.getHexString()
    );
  });

  it('a textured mesh needs no entry in the role table', () => {
    expect(() =>
      buildMeshUnitTemplate(sceneOf([{ role: 'shell', map: texture() }]), 'kdf', 'at_team.glb', true)
    ).not.toThrow();
  });

  it('leaves an unmapped, untextured mesh failing exactly as before, even on a listed team', () => {
    expect(() =>
      buildMeshUnitTemplate(sceneOf([{ role: 'shell', map: null }]), 'kdf', 'at_team.glb', true)
    ).toThrow(/no ramp for rl_role shell/);
  });

  it('an untextured mesh on a listed team still takes the faction ramp', () => {
    const template = buildMeshUnitTemplate(
      sceneOf([{ role: 'uniform', map: null }]),
      'kdf',
      'at_team.glb',
      true
    );
    const mat = template.materials[0] as THREE.MeshStandardMaterial;
    expect(mat.map).toBeNull();
    expect(mat.color.getHexString()).toBe(
      rampMaterial(rampForRole('uniform', 'kdf')).color.getHexString()
    );
  });
});

describe('shipped infantry teams', () => {
  // With the list empty, NO team GLB may ship an image or texture: the new
  // throw above would otherwise turn a previously-silent repaint into a boot
  // failure. Read from the GLB's own JSON chunk, so no loader is involved.
  const dir = `${REPO}art/meshes/`;
  const teams = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.glb'))
    .map((e) => e.name.slice(0, -'.glb'.length))
    .sort();

  it('finds the team GLBs at all', () => {
    expect(teams.length).toBeGreaterThanOrEqual(16);
  });

  it.each(teams)('%s: ships no texture unless it is on the list', (team) => {
    const buf = readFileSync(`${dir}${team}.glb`);
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
      images?: unknown[];
      textures?: unknown[];
    };
    const textured = (json.images?.length ?? 0) + (json.textures?.length ?? 0) > 0;
    expect(textured).toBe(TEXTURED_INFANTRY_TYPES.has(team));
  });
});
