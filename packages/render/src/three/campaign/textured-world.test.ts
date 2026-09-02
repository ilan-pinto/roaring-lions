import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_MAP_ROLES,
  isTexturedCampaignMap,
  TEXTURED_CAMPAIGN_MAPS,
  townOfNode,
} from './textured-world';

const repoFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url)), 'utf8');

/**
 * The glTF JSON chunk of a .glb, without a loader. A GLB is a 12-byte header
 * then length-prefixed chunks; the first is always JSON.
 */
interface GltfNode {
  name?: string;
  mesh?: number;
  extras?: Record<string, unknown>;
}
interface GltfJson {
  nodes?: GltfNode[];
  materials?: unknown[];
  images?: unknown[];
  textures?: unknown[];
}

function glbJson(rel: string): GltfJson {
  const buf = readFileSync(fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url)));
  const total = buf.readUInt32LE(8);
  let at = 12;
  while (at < total) {
    const len = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    if (type === 0x4e4f534a) return JSON.parse(buf.toString('utf8', at + 8, at + 8 + len)) as GltfJson;
    at += 8 + len;
  }
  throw new Error(`${rel}: no JSON chunk`);
}

interface World {
  id: string;
  regions: { id: string; towns: { id: string }[] }[];
}

const WORLD = JSON.parse(repoFile('data/campaign/world.json')) as World;
const GLB = `art/meshes/campaign/${WORLD.id}.glb`;

describe('the textured-campaign opt-out is a named list', () => {
  it('covers exactly the Sahar Basin', () => {
    // If this grows, the growth should be a decision someone made, not
    // something that arrived with an asset.
    expect([...TEXTURED_CAMPAIGN_MAPS].sort()).toEqual(['sahar_basin']);
    expect(isTexturedCampaignMap('sahar_basin')).toBe(true);
    expect(isTexturedCampaignMap('some_other_world')).toBe(false);
  });

  // Drift between the two sides is the failure this exists to stop: listed
  // here but not there and the gate rejects a GLB the runtime requires;
  // listed there but not here and the runtime draws a bake the gate waved
  // past without ever checking it carries one.
  it('agrees with TEXTURED_CAMPAIGN_EXEMPT in tools/validate_mesh_assets.py', () => {
    const py = repoFile('tools/validate_mesh_assets.py');
    const block = /TEXTURED_CAMPAIGN_EXEMPT\s*=\s*\{([^}]*)\}/.exec(py);
    expect(
      block,
      'TEXTURED_CAMPAIGN_EXEMPT not found in tools/validate_mesh_assets.py'
    ).not.toBeNull();
    const ids = [...(block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(ids).toEqual([...TEXTURED_CAMPAIGN_MAPS].sort());
  });

  it('agrees with CAMPAIGN_MAP_ROLES in tools/validate_mesh_assets.py', () => {
    const py = repoFile('tools/validate_mesh_assets.py');
    const block = /CAMPAIGN_MAP_ROLES\s*=\s*\{([^}]*)\}/.exec(py);
    expect(block, 'CAMPAIGN_MAP_ROLES not found in tools/validate_mesh_assets.py').not.toBeNull();
    const roles = [...(block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(roles).toEqual([...CAMPAIGN_MAP_ROLES].sort());
  });
});

describe('townOfNode', () => {
  it('reads the town id out of the extras, and nothing else', () => {
    expect(townOfNode({ rl_town: 'tel_marum' })).toBe('tel_marum');
    expect(townOfNode({ rl_map_role: 'region', rl_region: 'sur' })).toBeNull();
    expect(townOfNode({ rl_town: '' })).toBeNull();
    expect(townOfNode({ rl_town: 7 })).toBeNull();
    expect(townOfNode(undefined)).toBeNull();
  });
});

/**
 * The shipped bytes, not the exporter's own report of them. `pnpm test`
 * runs on every push in seconds; `pnpm validate:meshes` needs Blender and
 * checks the same contract there. The join these assert -- mesh node names
 * against `world.json`'s ids -- is the one the whole design rests on, and
 * its failure mode is silence: rename a region in the JSON and the screen
 * looks up a mesh that is not there.
 */
describe(`${GLB} carries the campaign contract`, () => {
  const gltf = glbJson(GLB);
  const meshNodes = (gltf.nodes ?? []).filter((n) => n.mesh !== undefined);
  const emptyNodes = (gltf.nodes ?? []).filter((n) => n.mesh === undefined);

  it('ships exactly one material, image and texture', () => {
    // None means the bake was lost and the world draws untextured. More than
    // one means metallic_roughness or normal survived an export that must
    // drop them -- there are no lights in this scene to consume either.
    expect(gltf.materials ?? []).toHaveLength(1);
    expect(gltf.images ?? []).toHaveLength(1);
    expect(gltf.textures ?? []).toHaveLength(1);
  });

  it('declares rl_textured and a known rl_map_role on every mesh node', () => {
    expect(meshNodes.length).toBeGreaterThan(0);
    for (const n of meshNodes) {
      expect(n.extras?.rl_textured, `${n.name}: rl_textured`).toBe(true);
      expect(CAMPAIGN_MAP_ROLES as readonly string[], `${n.name}: rl_map_role`).toContain(
        n.extras?.rl_map_role
      );
    }
  });

  it('names exactly the regions data/campaign/world.json declares', () => {
    const got = meshNodes
      .filter((n) => n.extras?.rl_map_role === 'region')
      .map((n) => n.extras?.rl_region as string)
      .sort();
    expect(got).toEqual(WORLD.regions.map((r) => r.id).sort());
  });

  it('carries a marker node for every town, and no town it does not declare', () => {
    const want = WORLD.regions.flatMap((r) => r.towns.map((t) => t.id)).sort();
    const got = emptyNodes
      .map((n) => townOfNode(n.extras))
      .filter((t): t is string => t !== null)
      .sort();
    expect(got).toEqual(want);
  });

  it('puts every town marker inside its own region and above the ground plane', () => {
    // A marker in the wrong region is the one failure a pair of authored
    // numbers ships in silence; the exporter raycasts and refuses, and this
    // re-reads the result from the bytes.
    const byTown = new Map(
      WORLD.regions.flatMap((r) => r.towns.map((t) => [t.id, r.id] as const))
    );
    for (const n of emptyNodes) {
      const town = townOfNode(n.extras);
      if (town === null) continue;
      expect(n.extras?.rl_region, `${town}: region`).toBe(byTown.get(town));
      expect((n as { translation?: number[] }).translation?.[1], `${town}: height`).toBeGreaterThan(
        0
      );
    }
  });
});
