/**
 * The hands pass (GH-826 step 2), checked on the real shipped Rifle Squad.
 *
 * The pass's input (the importer's output, git 13f667ff) is not in the tree once the pass has run, so the refusals that
 * need an unprocessed file are driven from the shipped file with its pass markers stripped: that file has the right
 * skin, roles and clips, and the wrong weapon (the reshaped carbine, 380 triangles), which is itself one of the
 * refusals. Each refusal below was watched fail on a constructed input before it was written down as a test; the
 * mutation that proves the stretch limit is in the commit message (it needs the unprocessed bytes).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { HANDS_TEAMS, livingBodyHidden, loadCarbine, loadHandsLib, runHandsPass } from './hands-pass';
import { runMotionPass } from './motion-pass';
import { MOTION_TEAMS } from './motion/teams';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SHIPPED = `${REPO}art/meshes/inf_squad.glb`;

async function load(): Promise<Document> {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(readFileSync(SHIPPED)));
}
const extrasOf = (doc: Document): Record<string, unknown> => doc.getRoot().listScenes()[0].getExtras() as Record<string, unknown>;

describe('the hands pass refuses what it cannot do honestly', () => {
  const spec = HANDS_TEAMS.inf_squad;

  it('the motion pass refuses a hands team the hands pass has not been through', async () => {
    const doc = await load();
    const ex = extrasOf(doc);
    delete ex.rl_motion;
    delete ex.rl_hands;
    doc.getRoot().listScenes()[0].setExtras(ex);
    expect(() => runMotionPass(doc, 'inf_squad', MOTION_TEAMS.inf_squad, 'test')).toThrow(/hands pass has not been through/);
  });

  it('refuses a file already through the motion pass', async () => {
    const doc = await load();
    expect(extrasOf(doc).rl_motion, 'the shipped file has been through the motion pass').toBeDefined();
    await expect(Promise.resolve().then(async () => runHandsPass(doc, 'inf_squad', spec, await loadHandsLib(), await loadCarbine(), 'test'))).rejects.toThrow(/already through the motion pass/);
  });

  it('refuses a file already through the hands pass', async () => {
    const doc = await load();
    const ex = extrasOf(doc);
    delete ex.rl_motion;
    doc.getRoot().listScenes()[0].setExtras(ex);
    expect(ex.rl_hands, 'the shipped file carries rl_hands').toBeDefined();
    expect(() => runHandsPass(doc, 'inf_squad', spec, awaitedLib, awaitedCarbine, 'test')).toThrow(/already through the hands pass/);
  });

  it('refuses a hand library without the part it needs', async () => {
    const doc = await load();
    const ex = extrasOf(doc);
    delete ex.rl_motion;
    delete ex.rl_hands;
    doc.getRoot().listScenes()[0].setExtras(ex);
    const lib = await loadHandsLib();
    const parts = new Map(lib.parts);
    parts.delete('inf_fist_L');
    expect(() => runHandsPass(doc, 'inf_squad', spec, { ...lib, parts }, awaitedCarbine, 'test')).toThrow(/hand library has no inf_fist_L/);
  });

  it('refuses a file whose rifles are not the importer\'s (the shipped ones ride their own weapon bones, not the forearms)', async () => {
    const doc = await load();
    const ex = extrasOf(doc);
    delete ex.rl_motion;
    delete ex.rl_hands;
    doc.getRoot().listScenes()[0].setExtras(ex);
    expect(() => runHandsPass(doc, 'inf_squad', spec, awaitedLib, awaitedCarbine, 'test')).toThrow(/f0 has 0 weapon vertices/);
  });
});

// loaded once, before the cases run (vitest runs top-level awaits)
const awaitedLib = await loadHandsLib();
const awaitedCarbine = await loadCarbine();

describe('a stray key on a hidden living bone is reset, on a drawn one it is refused (Demolition, GH-826 step 3)', () => {
  const DEMO = `${REPO}art/meshes/demo_squad.glb`;
  const anim = async (name: string) => {
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(readFileSync(DEMO)));
    return { doc, a: doc.getRoot().listAnimations().find((x) => x.getName() === name)! };
  };

  it('the shipped `down` scales the living root to nothing, so its stray limb keys are not a drawn body; `idle` and `fire` are', async () => {
    expect(livingBodyHidden((await anim('down')).a, 'demo_b')).toBe(true);
    expect(livingBodyHidden((await anim('wreck')).a, 'demo_a')).toBe(true);
    expect(livingBodyHidden((await anim('idle')).a, 'demo_b')).toBe(false);
    expect(livingBodyHidden((await anim('fire')).a, 'demo_a')).toBe(false);
  });

  it('the check can fail: `down` with the living root left at full scale is a drawn body (constructed failing input)', async () => {
    const { a } = await anim('down');
    const ch = a.listChannels().find((c) => c.getTargetNode()?.getName() === 'demo_b_root' && c.getTargetPath() === 'scale')!;
    const acc = ch.getSampler()!.getOutput()!;
    acc.setArray(new Float32Array((acc.getArray() as Float32Array).length).fill(1));
    expect(livingBodyHidden(a, 'demo_b')).toBe(false);
  });

  it('a clip that is not a dead one is never "hidden", whatever its root does', async () => {
    const { a } = await anim('idle');
    const ch = a.listChannels().find((c) => c.getTargetNode()?.getName() === 'demo_b_root' && c.getTargetPath() === 'scale');
    if (ch) {
      const acc = ch.getSampler()!.getOutput()!;
      acc.setArray(new Float32Array((acc.getArray() as Float32Array).length).fill(0));
    }
    expect(livingBodyHidden(a, 'demo_b')).toBe(false);
  });
});
