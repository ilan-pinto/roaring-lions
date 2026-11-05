import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { BANNED_NAMES, PORTED_FILES, portedFilesBlocks } from '../../webgpu_ratchet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function lint(code: string, ported: readonly string[]): Promise<string[]> {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
      ...(portedFilesBlocks(ported) as never[]),
    ],
  });
  const [res] = await eslint.lintText(code, { filePath: path.join(ROOT, 'packages/render/src/three/fixture-ported.ts') });
  return (res?.messages ?? []).map((m) => `${m.ruleId}: ${m.message.slice(0, 40)}`);
}

const FIXTURE = 'packages/render/src/three/fixture-ported.ts';

describe('webgpu ratchet', () => {
  it('starts EMPTY: nothing is ported at P0, so no block exists to turn a shipped file red', () => {
    expect(PORTED_FILES).toEqual([]);
    expect(portedFilesBlocks(PORTED_FILES)).toEqual([]);
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
