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
import { HANDS_TEAMS, loadCarbine, loadHandsLib, runHandsPass } from './hands-pass';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SHIPPED = `${REPO}art/meshes/inf_squad.glb`;

async function load(): Promise<Document> {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(readFileSync(SHIPPED)));
}
const extrasOf = (doc: Document): Record<string, unknown> => doc.getRoot().listScenes()[0].getExtras() as Record<string, unknown>;

describe('the hands pass refuses what it cannot do honestly', () => {
  const spec = HANDS_TEAMS.inf_squad;

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
