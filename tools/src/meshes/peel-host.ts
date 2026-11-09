/**
 * Peel a finished vehicle GLB back to its HOST: remove what the kit, wreck and damage passes added, and nothing else.
 *
 *     pnpm --filter @lions/tools exec tsx src/meshes/peel-host.ts -- --id=ifv_namer --id=apc_eitan --id=apc_kipod
 *
 * Why it exists (L3, GH-943). The mark pass runs BEFORE the kit (`mark-pass.ts` refuses a file that carries `kit_*` or
 * `death_root`), and for most vehicles that means re-running the Blender export. Three KDF carriers cannot do that:
 * the Namer's Meshy source is not in the tree, and the Eitan and Kipod went through `rws-swap.ts` (a widened atlas and a
 * station written into the shipped bytes), so a fresh export would not be the file that ships. Their HOST, the live
 * hull, running gear and station, is already in the shipped GLB. The three late passes are each idempotent by
 * construction, so stripping them is exactly the inverse of running them.
 *
 * Order matters, and is the reverse of the pipeline: damage (points each damaged twin back at its live mesh), wreck
 * (disposes `death_root` and the clips), kit. Every live accessor stays byte-identical; the test in
 * `mark-pass.test.ts` pins that a peel followed by kit, wreck and damage writes the shipped bytes back.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { stripDamage } from './damage-pass';
import { stripKit } from './kit-pass';
import { stripWreck } from './wreck-pass';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');

/** The pure half. Returns how many `kit_*` nodes went. */
export function peelToHost(doc: Document): number {
  stripDamage(doc);
  stripWreck(doc);
  return stripKit(doc);
}

export function parsePeelArgs(argv: readonly string[]): readonly string[] {
  const ids: string[] = [];
  for (const a of argv) {
    if (a === '--') continue;
    const m = /^--id=(.+)$/.exec(a);
    if (!m) throw new Error(`peel-host: unknown argument ${a} (use --id=<vehicle>)`);
    ids.push(m[1]);
  }
  if (ids.length === 0) throw new Error('peel-host: name at least one --id=');
  return ids;
}

export async function runPeel(ids: readonly string[], dir: string = VEHICLES): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const id of ids) {
    const file = path.join(dir, `${id}.glb`);
    const doc = await io.read(file);
    const kit = peelToHost(doc);
    await io.write(file, doc);
    console.log(`PEEL_OK ${id}: ${kit} kit node(s) stripped, wreck twins and clips stripped`);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  runPeel(parsePeelArgs(process.argv.slice(2))).then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
