/**
 * Which hands a team file carries, read off its bytes: `extras.rl_hands.source` on the scene. "meshy" is a figure whose
 * fists Meshy sculpted closed on the weapon and the importer skinned rigidly to `{p}_hand_{L|R}`
 * (`tools/units/import_meshy_skinned_team.py`, GH-746): no trigger-finger motion, no forearm tube, no library hand part.
 * Anything else (`undefined` or the hands pass's own stamp) is a figure the procedural hands pass built. Gates whose
 * subject is that pass's output key their population on this, never on a list of names.
 */
import { readAccessor, readGlb } from './mesh_gait';

export function rlHandsSource(path: string): string | undefined {
  const ex = (readGlb(path).json.scenes?.[0] as { extras?: { rl_hands?: { source?: string } } } | undefined)?.extras;
  return ex?.rl_hands?.source;
}

export const isFusedHands = (path: string): boolean => rlHandsSource(path) === 'meshy';

/** How many skinned vertices of the file carry any weight on joint `name` (every skinned mesh, kit nodes excluded). */
export function jointVertexCount(path: string, name: string): number {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  let n = 0;
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined || (node.name ?? '').startsWith('kit_')) continue;
    const skin = glb.json.skins![node.skin];
    const j = skin.joints.findIndex((ji) => nodes[ji].name === name);
    if (j < 0) continue;
    for (const prim of glb.json.meshes![node.mesh].primitives) {
      const J = readAccessor(glb, prim.attributes.JOINTS_0);
      const W = readAccessor(glb, prim.attributes.WEIGHTS_0);
      for (let v = 0; v < J.count; v++) {
        for (let c = 0; c < 4; c++) if (J.data[v * 4 + c] === j && W.data[v * 4 + c] > 0) { n++; break; }
      }
    }
  }
  return n;
}
