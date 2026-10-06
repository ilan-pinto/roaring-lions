/**
 * `pnpm motion:meshes` -- the infantry motion realism pass (5 Oct, approved
 * at the motion checkpoint). Rewrites a rigged infantry GLB in place:
 *
 *   hold      each shooter's weapon on its own bone on the chest, placed by
 *             the hold (`motion/hold.ts`), both hands on it by two-bone IK;
 *   kneel     `kneel`, `kneelIn`, `kneelOut` for every standing armed team;
 *   wedge     the figures re-spaced into a wedge (three) or echelon (two);
 *   stride    locomotion legs warped to a realistic cadence, the knee
 *             clamped, the feet planted (`motion/stride.ts`);
 *   carry     a long item held in one hand carried tip-up while walking,
 *             the arm not swinging; an item worn on the torso lifted to
 *             run (`motion/carry.ts`);
 *   ground    nothing under the ground in idle, fire, move or moveFire --
 *             a figure buried at rest seated, a foot planted, a static
 *             kneeler raised, a prop seated, a wheel held up on its axle
 *             (`motion/ground.ts`). Before the kneel, which builds from
 *             the grounded idle.
 *
 * Order in the mesh pipeline: export (Blender) -> THIS -> `pnpm gait:meshes`
 * -> `pnpm encode:meshes`. A file that has been through it carries
 * `extras.rl_motion` and is refused a second time: the pass is not
 * idempotent (it rebinds vertices and warps tracks), so a re-run starts from
 * the pre-pass bytes -- `--from=<rev>` reads them out of git.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { applyHold } from './motion/apply-hold';
import { applyKneel } from './motion/kneel';
import { applyCarry } from './motion/carry';
import { applyGround } from './motion/ground';
import { applyFormation } from './motion/formation';
import { applyStride } from './motion/stride';
import { tidyArms } from './motion/tidy';
import { addFeet } from './motion/feet';
import { MOTION_TEAMS, MOTION_VERSION, recoilOf, type MotionTeam } from './motion/teams';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

export interface MotionReport {
  readonly id: string;
  readonly lines: string[];
}

export function runMotionPass(doc: Document, id: string, spec: MotionTeam, base: string): MotionReport {
  const scene = doc.getRoot().listScenes()[0];
  const extras = (scene.getExtras() ?? {}) as Record<string, unknown>;
  if (extras.rl_motion) throw new Error(`${id}: already through the motion pass (${JSON.stringify(extras.rl_motion)})`);
  const lines: string[] = [];
  const posed = spec.figures.filter((f) => f.weapon || f.kneels).map((f) => f.prefix);
  if (posed.length > 0) lines.push(...tidyArms(doc, posed));
  if (spec.formation) lines.push(...applyFormation(doc, spec));
  // An ankle for every walker the pass grounds, too: a foot is planted at it.
  if (spec.stride || spec.kneel || spec.ground) lines.push(...addFeet(doc));
  if (spec.stride) lines.push(...applyStride(doc, id, spec));
  const holds = spec.hold ? applyHold(doc, id, spec) : [];
  lines.push(...holds.map((h) => h.line));
  lines.push(...applyCarry(doc, id, spec));
  lines.push(...applyGround(doc, id, spec));
  if (spec.kneel) lines.push(...applyKneel(doc, id, spec, holds[0]?.ctx ?? []));
  scene.setExtras({
    ...extras,
    rl_motion: { version: MOTION_VERSION, base },
    // Read by the renderer (`units/squad-rig.ts`): who kicks on a shot, and
    // whether the team is drawn as a squad of separate men.
    rl_figures: spec.figures.map((f) => ({ prefix: f.prefix, recoil: recoilOf(f), squad: spec.squad ?? spec.formation })),
  });
  return { id, lines };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const only = args.find((a) => a.startsWith('--id='))?.slice(5);
  const from = args.find((a) => a.startsWith('--from='))?.slice(7);
  // --in/--out: one file, anywhere (a scratch preview); never with --from.
  const inFile = args.find((a) => a.startsWith('--in='))?.slice(5);
  const outFile = args.find((a) => a.startsWith('--out='))?.slice(6);
  const ids = only ? only.split(',') : Object.keys(MOTION_TEAMS);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const id of ids) {
    const spec = MOTION_TEAMS[id];
    if (!spec) throw new Error(`motion: no MOTION_TEAMS entry for ${id}`);
    const rel = path.join('art', 'meshes', spec.dir ?? '', `${id}.glb`);
    const file = path.join(REPO, rel);
    const bytes = inFile
      ? readFileSync(inFile)
      : from
        ? execFileSync('/usr/bin/git', ['-C', REPO, 'show', `${from}:${rel}`], { maxBuffer: 1 << 28 })
        : readFileSync(file);
    const doc = await io.readBinary(new Uint8Array(bytes));
    const r = runMotionPass(doc, id, spec, from ?? (inFile ? 'scratch' : 'working tree'));
    writeFileSync(outFile ?? file, await io.writeBinary(doc));
    console.log(`MOTION ${id}`);
    for (const l of r.lines) console.log(`  ${l}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
