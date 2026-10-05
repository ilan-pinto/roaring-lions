/**
 * Give a rig.py team GLB a `moveFire` WITHOUT re-exporting it.
 *
 *     pnpm --filter @lions/tools exec tsx src/meshes/move-fire-splice.ts -- --id=charge_squad
 *
 * Then `pnpm gait:meshes -- --id=<id>` and `pnpm encode:meshes`, as after an
 * export.
 *
 * ## Why this exists, and why only for two files
 *
 * Every rig.py team now builds a `moveFire` (`tools/units/rig.py`'s
 * `build_move_fire_clip`, 2026-10-05): the legs of `move`, the upper body of
 * `fire`. Fourteen GLBs were re-exported for it, and each one's existing clips
 * and geometry came back byte-identical to what shipped -- checked, mesh by
 * mesh and channel by channel. Two did not: `charge_squad` and `mortar_crew`
 * were last exported in B4 (1 Oct), before `import_meshy_crew_team.py` moved
 * on (the B7 review's bisected cut, among others), and a re-export today
 * changes their boot and uniform meshes (charge 444 -> 544 boot vertices,
 * mortar_crew 600 -> 814) and every bone's rest. That is an art change nobody
 * asked for, so it is not shipped under a motion fix.
 *
 * For those two the clip `build_move_fire_clip` would write is exactly
 * computable from what the file already carries, because neither has a figure
 * whose arms fire: `mortar_crew`'s tube is a `prop`, packed while its crew
 * walks, so its `moveFire` IS its `move`; `charge_squad`'s `fire` is a
 * FIRE_ROOT_LEAN brace, a constant rotation on each figure's `root`, so its
 * `moveFire` is its `move` plus that rotation. This pass builds exactly that:
 * every `move` channel, sharing `move`'s own accessors, plus -- for each node
 * `fire` rotates and `move` does not -- a constant channel holding `fire`'s
 * first value over `move`'s time range. A file whose `fire` keys anything
 * else (a shooter's arms) is refused: that clip needs `rig.py`.
 *
 * Idempotent: an existing `moveFire` is stripped first, with the accessors
 * only it used.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Accessor, type Animation, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

function strip(doc: Document, anim: Animation): void {
  const accessors = new Set<Accessor>();
  for (const s of anim.listSamplers()) {
    const i = s.getInput();
    const o = s.getOutput();
    if (i) accessors.add(i);
    if (o) accessors.add(o);
  }
  for (const c of anim.listChannels()) c.dispose();
  for (const s of anim.listSamplers()) s.dispose();
  anim.dispose();
  for (const a of accessors) {
    if (a.listParents().every((p) => p === doc.getRoot())) a.dispose();
  }
}

export function spliceMoveFire(doc: Document): { channels: number; braced: string[] } {
  const root = doc.getRoot();
  const old = root.listAnimations().find((a) => a.getName() === 'moveFire');
  if (old) strip(doc, old);
  const move = root.listAnimations().find((a) => a.getName() === 'move');
  if (!move) throw new Error('no `move` clip');
  const fire = root.listAnimations().find((a) => a.getName() === 'fire');
  // A clip's value for a node it holds still. Exported bones carry their REST
  // orientation in every channel (a figure root reads [0,-1,0,0], not the
  // identity), so "not animated" means CONSTANT, not identity.
  const constantValue = (a: Accessor | null | undefined): number[] | null => {
    if (!a) return null;
    const first = Array.from(a.getElement(0, []));
    for (let i = 1; i < a.getCount(); i++) {
      const v = a.getElement(i, []);
      if (v.some((x, k) => Math.abs(x - first[k]) > 1e-6)) return null;
    }
    return first;
  };
  const moveBy = new Map(move.listChannels().map((c) => [`${c.getTargetNode()?.getName()}.${c.getTargetPath()}`, c]));
  // The brace: every node `fire` holds at a rotation other than the one
  // `move` holds it at, where neither animates it.
  const brace = new Map<string, number[]>();
  for (const c of fire?.listChannels() ?? []) {
    if (c.getTargetPath() !== 'rotation') continue;
    const key = `${c.getTargetNode()?.getName()}.${c.getTargetPath()}`;
    const mine = moveBy.get(key);
    const held = constantValue(mine?.getSampler()?.getOutput());
    const fired = constantValue(c.getSampler()?.getOutput());
    if (!mine || !held) continue; // move animates it (or never names it): move wins
    if (!fired) {
      throw new Error(`fire animates ${key} -- an arm or a recoil, not a brace; this file's moveFire needs rig.py`);
    }
    if (fired.every((x, k) => Math.abs(x - held[k]) < 1e-6)) continue;
    if (!c.getTargetNode()?.getName().endsWith('_root')) {
      throw new Error(`fire turns ${key}, which is not a root brace -- this file's moveFire needs rig.py`);
    }
    brace.set(key, fired);
  }
  const out = doc.createAnimation('moveFire');
  const braced: string[] = [];
  for (const c of move.listChannels()) {
    const s = c.getSampler();
    if (!s) continue;
    const key = `${c.getTargetNode()?.getName()}.${c.getTargetPath()}`;
    let output = s.getOutput();
    const value = brace.get(key);
    if (value && output) {
      const n = output.getCount();
      const data = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) data.set(value, i * 4);
      output = doc.createAccessor().setType('VEC4').setArray(data).setBuffer(root.listBuffers()[0]);
      braced.push(c.getTargetNode()?.getName() ?? '?');
    }
    const ns = doc.createAnimationSampler().setInput(s.getInput()).setOutput(output).setInterpolation(s.getInterpolation());
    out.addSampler(ns);
    const targetPath = c.getTargetPath();
    if (!targetPath) throw new Error(`move channel ${key} has no target path`);
    out.addChannel(doc.createAnimationChannel().setTargetNode(c.getTargetNode()).setTargetPath(targetPath).setSampler(ns));
  }
  return { channels: out.listChannels().length, braced };
}

async function main(): Promise<void> {
  const id = process.argv.find((a) => a.startsWith('--id='))?.slice(5);
  if (!id) throw new Error('usage: move-fire-splice.ts -- --id=<team>');
  const file = path.join(REPO, 'art', 'meshes', `${id}.glb`);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const r = spliceMoveFire(doc);
  await io.write(file, doc);
  console.log(`MOVE_FIRE_SPLICED ${id}: ${r.channels} channels, braced roots [${r.braced.join(', ')}]`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
