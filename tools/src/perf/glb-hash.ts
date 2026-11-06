/**
 * The hash a derived picture records of the GLB it was made from (GH-1079).
 *
 * A garage plate, kit plate, close-up or portrait is a photograph of
 * `assets/meshes/**` (the encoded file the game serves). When the GLB changes
 * and the picture does not, nothing used to notice. Each tool now writes
 * `glb_sha256` beside the picture's manifest entry, and
 * `packages/app/src/ui/art-freshness.test.ts` compares it with the bytes on
 * disk. Date-free on purpose: git dates do not survive a fresh clone.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** `assets/meshes/<id>.glb` for a figure team, `assets/meshes/vehicles/<id>.glb` otherwise. */
export function glbPathFor(id: string, root: string = REPO_ROOT): string {
  const vehicle = path.join(root, 'assets/meshes/vehicles', `${id}.glb`);
  if (fs.existsSync(vehicle)) return vehicle;
  const team = path.join(root, 'assets/meshes', `${id}.glb`);
  if (fs.existsSync(team)) return team;
  throw new Error(`no GLB for "${id}" under assets/meshes/ or assets/meshes/vehicles/`);
}

export function glbSha256(id: string, root: string = REPO_ROOT): string {
  return crypto.createHash('sha256').update(fs.readFileSync(glbPathFor(id, root))).digest('hex');
}
