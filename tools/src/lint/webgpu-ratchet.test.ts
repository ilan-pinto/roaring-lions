import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { BANNED_NAMES, PORTED_FILES, TWINS, portedFilesBlocks } from '../../webgpu_ratchet.mjs';
import { RATCHET_BASE } from '../../webgpu_fences.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function lint(code: string, ported: readonly string[]): Promise<string[]> {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
      ...(ported.length === 0 ? [] : (portedFilesBlocks(ported, RATCHET_BASE) as never[])),
    ],
  });
  const [res] = await eslint.lintText(code, { filePath: path.join(ROOT, 'packages/render/src/three/fixture-ported.ts') });
  return (res?.messages ?? []).map((m) => `${m.ruleId}: ${m.message.slice(0, 40)}`);
}

/** Append the file you port, in the PR that ports it. */
const PORTED_FLOOR: readonly string[] = ['packages/render/src/three/post-chain.node.ts'];
const FIXTURE = 'packages/render/src/three/fixture-ported.ts';

describe('webgpu ratchet', () => {
  it('PORTED_FILES only GROWS: every entry of the committed floor is still there', () => {
    // Append the file you port to PORTED_FLOOR in the same PR. A removal makes this red; the floor is never edited downward
    // (the P7 cutover deletes the whole ratchet, not entries from it).
    for (const f of PORTED_FLOOR) expect(PORTED_FILES, `${f} left PORTED_FILES`).toContain(f);
  });
  it('every PORTED_FILES entry is an existing .node.ts under packages/render/src/three, and is some TWINS twin', () => {
    const twins = new Set(Object.values(TWINS));
    for (const f of PORTED_FILES) {
      expect(f, f).toMatch(/^packages\/render\/src\/three\/.+\.node\.ts$/);
      expect(existsSync(path.join(ROOT, f)), `${f} does not exist`).toBe(true);
      expect(twins.has(f), `${f} is in no TWINS row (add the legacy -> twin pair)`).toBe(true);
    }
  });
  it('an empty list emits no block (a flat-config files: [] is invalid)', () => {
    expect(portedFilesBlocks([], RATCHET_BASE)).toEqual([]);
  });
  it('refuses to build a block without the standing fences, or for a file outside the folder they belong to', () => {
    expect(() => portedFilesBlocks([FIXTURE], undefined)).toThrow(/standing import fences/);
    expect(() => portedFilesBlocks(['packages/app/src/x.ts'], RATCHET_BASE)).toThrow(/outside packages\/render\/src\/three/);
  });
  it('the ratchet block ADDS to the standing import fences (--print-config keeps every one)', async () => {
    // The REAL config, plus the ratchet block appended exactly where eslint.config.mjs appends it. Falsified by restoring the
    // replace: build the block with a `base` that drops the fences and this goes red.
    const eslint = new ESLint({
      cwd: ROOT,
      overrideConfigFile: path.join(ROOT, 'eslint.config.mjs'),
      overrideConfig: portedFilesBlocks([FIXTURE], RATCHET_BASE) as never[],
    });
    const cfg = (await eslint.calculateConfigForFile(path.join(ROOT, FIXTURE))) as {
      rules: Record<string, unknown[]>;
    };
    const syntax = JSON.stringify(cfg.rules['no-restricted-syntax']);
    const imports = JSON.stringify(cfg.rules['no-restricted-imports']);
    expect(syntax).toContain('@lions/render may import @lions/sim only'); // the app|data fence
    expect(syntax).toContain('onBeforeCompile'); // the ratchet's own ban
    expect(imports).toContain('**/roar-wallet'); // the Roar-coin fence
    expect(imports).toContain('three/addons/postprocessing/*'); // the ratchet's own ban
    // And the same fences hold for a file that is NOT ported, as a control that the config loaded at all.
    const plain = (await new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, 'eslint.config.mjs') }).calculateConfigForFile(
      path.join(ROOT, FIXTURE)
    )) as { rules: Record<string, unknown[]> };
    expect(JSON.stringify(plain.rules['no-restricted-imports'])).toContain('**/roar-wallet');
    expect(JSON.stringify(plain.rules['no-restricted-syntax'])).not.toContain('onBeforeCompile');
  });
  it('a ported file importing the app or the wallet is still an error, and the ratchet bans still fire', async () => {
    const eslint = new ESLint({
      cwd: ROOT,
      overrideConfigFile: path.join(ROOT, 'eslint.config.mjs'),
      overrideConfig: portedFilesBlocks([FIXTURE], RATCHET_BASE) as never[],
    });
    const run = async (code: string): Promise<number> => {
      const [res] = await eslint.lintText(code, { filePath: path.join(ROOT, FIXTURE) });
      return (res?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax').length;
    };
    expect(await run("import { x } from '../../../app/src/roar-wallet'; void x;")).toBeGreaterThan(0);
    expect(await run("import { y } from '@lions/data'; void y;")).toBeGreaterThan(0);
    expect(await run('const m = {}; m.onBeforeCompile = () => undefined;')).toBeGreaterThan(0);
    expect(await run('export const ok = 1;')).toBe(0);
  });
  it.each([
    ['onBeforeCompile', 'const m = {}; m.onBeforeCompile = () => undefined;'],
    ['customProgramCacheKey', 'const m = { customProgramCacheKey() { return "a"; } };'],
    ['ShaderMaterial', 'import * as THREE from "three"; const m = new THREE.ShaderMaterial({});'],
    ['RawShaderMaterial', 'import * as THREE from "three"; const m = new THREE.RawShaderMaterial({});'],
    ['a glsl template', 'declare const glsl: (s: TemplateStringsArray) => string; const f = glsl`void main() {}`;'],
    ['a legacy post pass', 'import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js"; void SMAAPass;'],
  ])('flags %s in a ported file', async (_name, code) => {
    const msgs = await lint(code, [FIXTURE]);
    expect(msgs.length).toBeGreaterThan(0);
  });
  it('is silent on a clean ported file, and on the same hook in a file that is not ported', async () => {
    expect(await lint('export const x = 1;', [FIXTURE])).toEqual([]);
    expect(await lint('const m = {}; m.onBeforeCompile = () => undefined;', [])).toEqual([]);
  });
  it('every banned name has a selector (a name added to the list but not the block would pass here)', async () => {
    for (const name of BANNED_NAMES) {
      const msgs = await lint(`const o = {}; void o.${name};`, [FIXTURE]);
      expect(msgs.length, name).toBeGreaterThan(0);
    }
  });
  it('no ported file carries a /* glsl */ comment (ESLint cannot select one, so the text is scanned)', () => {
    for (const f of PORTED_FILES) {
      expect(readFileSync(path.join(ROOT, f), 'utf8'), f).not.toMatch(/\/\*\s*glsl\s*\*\//i);
    }
  });
});
