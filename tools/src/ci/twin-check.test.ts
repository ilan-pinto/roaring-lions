import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TWINS } from '../../webgpu_ratchet.mjs';
import { EXEMPTIONS, hunksOutsideShader, runTwinCheck, shaderLines, twinRows, twinVerdict, type TwinIo } from './twin-check';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FOG = 'packages/render/src/three/fog-pass.ts';
const FOG_NODE = 'packages/render/src/three/fog-pass.node.ts';

/** A fixture checkout with the fog pair on disk. */
function fixtureIo(withTwin: boolean): TwinIo & { out: string[] } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'twin-check-'));
  mkdirSync(path.join(root, 'packages/render/src/three'), { recursive: true });
  writeFileSync(path.join(root, FOG), '');
  if (withTwin) writeFileSync(path.join(root, FOG_NODE), '');
  const out: string[] = [];
  return { root, out, log: (l) => out.push(l), err: (l) => out.push(l), changedSince: () => [], outsideShader: () => false };
}

describe('twin-check (the same-PR rule)', () => {
  it('exits 1 on a fixture that touches fog-pass.ts without fog-pass.node.ts', () => {
    const io = fixtureIo(true);
    expect(runTwinCheck([`--files=${FOG}`], io)).toBe(1);
    expect(io.out.join('\n')).toContain('VIOLATION');
  });
  it('exits 0 when both change', () => {
    expect(runTwinCheck([`--files=${FOG},${FOG_NODE}`], fixtureIo(true))).toBe(0);
  });
  it('exits 0 for the twin alone (a node-only fix needs no GLSL edit)', () => {
    expect(runTwinCheck([`--files=${FOG_NODE}`], fixtureIo(true))).toBe(0);
  });
  it('does not arm a row whose twin is not written yet', () => {
    const io = fixtureIo(false);
    expect(runTwinCheck([`--files=${FOG}`], io)).toBe(0);
    expect(io.out.join('\n')).toContain('not armed');
  });
  it('is not vacuous: no input and an empty table are both refused (exit 2)', () => {
    expect(runTwinCheck([], fixtureIo(true))).toBe(2);
    expect(runTwinCheck([`--files=${FOG}`], fixtureIo(true), {})).toBe(2);
  });
  it('reports an unreadable base as exit 2, not a pass', () => {
    const io: TwinIo = { ...fixtureIo(true), changedSince: () => { throw new Error('bad ref'); } };
    expect(runTwinCheck(['--base=nope'], io)).toBe(2);
  });
  // Each twin that serves several legacy files, with exactly the legacy files it serves (GH-943 P3 T11). A new shared recipe is added here
  // on purpose, in the same PR as its row.
  const THREE = 'packages/render/src/three/';
  const SHARED_RECIPES: Readonly<Record<string, readonly string[]>> = {
    [`${THREE}units/rim-fade.node.ts`]: [`${THREE}units/smoke-plume.ts`, `${THREE}units/collapse-shroud.ts`],
    // GH-1225 slice 3 (L7): ONE twin for the roof cut and the P4 holes, which have no name-paired twins of their own.
    [`${THREE}units/building-cut.node.ts`]: [
      `${THREE}units/cut-material.ts`,
      `${THREE}units/holed-material.ts`,
      `${THREE}units/building-cutaway.ts`,
      `${THREE}units/building-holes.ts`,
      `${THREE}units/building-cut-maths.ts`,
      `${THREE}units/building-mask.ts`,
    ],
  };
  it('the shipped TWINS table is a legacy -> .node.ts map over existing legacy files', () => {
    const rows = twinRows(TWINS);
    expect(rows.length).toBeGreaterThan(0);
    const own = (legacy: string): string => legacy.replace(/\.ts$/, '.node.ts');
    let shared = 0;
    for (const r of rows) {
      expect(existsSync(path.resolve(__dirname, '../../..', r.legacy)), r.legacy).toBe(true);
      // GH-943 P2: a legacy file whose maths a twin of ANOTHER file carries (T6 `wind.ts`, T7 `disturb.ts`, T4 `relief-read.ts`) points
      // at that twin, which must be the name-paired twin of some other row: no row may point at a twin nobody owns.
      // GH-943 P3 (T11): or the twin is ONE recipe for several legacy files (`rim-fade.node.ts` serves the plume and the shroud, which
      // have no name-paired twin of their own): then at least two rows must point at it.
      if (r.twin !== own(r.legacy)) {
        const namePaired = rows.some((o) => o.legacy !== r.legacy && o.twin === r.twin && own(o.legacy) === o.twin);
        // The shared recipes are named, not counted: a row pointing at a mistyped twin that a second row also mistypes would pass a count.
        const oneRecipe = (SHARED_RECIPES[r.twin] ?? []).includes(r.legacy);
        expect(namePaired || oneRecipe, `${r.legacy} -> ${r.twin}`).toBe(true);
        shared++;
      }
      expect(twinVerdict([r.legacy], [r], () => true).violations).toHaveLength(1);
    }
    // And every named member really points at its recipe.
    for (const [twin, legacies] of Object.entries(SHARED_RECIPES)) for (const l of legacies) expect(rows.find((r) => r.legacy === l)?.twin, l).toBe(twin);
    // Anti-vacuity: the name-paired rule still binds the rest.
    expect(rows.length - shared).toBeGreaterThan(shared);
  });
});

// The narrow exemption: a legacy file's change outside its shader program, VERIFIED from the diff (GH-1227).
const FX = 'packages/render/src/three/units/flipbook-fx.ts';
const FX_NODE = 'packages/render/src/three/units/flipbook-fx.node.ts';
const SRC = ['import x;', 'const VERT = /* glsl */ `', 'void main() {}', '`;', 'const SOFT_ANCHORS = {};', 'function splice() {}', 'export const FLIPBOOK_SHADERS = {};', 'class A {', '  dispose() {}', '}'].join('\n');
// Lines: 1 import, 2-4 glsl, 5-7 shader-building span, 8-10 lifecycle.
describe('twin-check exemption (change verified outside the shader program)', () => {
  it('finds the shader lines, and fails closed when a marker is missing', () => {
    expect([...(shaderLines(SRC) ?? [])].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(shaderLines('const x = 1;')).toBeNull();
  });
  it('honours a hunk in the lifecycle code only', () => {
    expect(hunksOutsideShader('@@ -9,0 +10,2 @@\n+a', SRC, SRC + '\n\n')).toBe(true);
    expect(hunksOutsideShader('@@ -9 +9 @@\n', SRC, SRC)).toBe(true);
  });
  it('refuses a hunk touching a GLSL line (old side, new side, or an insertion between GLSL lines)', () => {
    expect(hunksOutsideShader('@@ -3 +3 @@\n', SRC, SRC)).toBe(false);
    expect(hunksOutsideShader('@@ -3,0 +4 @@\n', SRC, SRC)).toBe(false);
    expect(hunksOutsideShader('@@ -6 +6 @@\n', SRC, SRC)).toBe(false);
    expect(hunksOutsideShader('@@ -9 +9 @@\n@@ -3 +3 @@\n', SRC, SRC)).toBe(false);
    expect(hunksOutsideShader('', SRC, SRC)).toBe(false);
  });
  it('judges each side against its OWN source: a hunk is refused when only the old side, or only the new side, lies in a shader (the sources differ)', () => {
    // Two lines inserted at the top shift the new file's shader to lines 4-9; the old file's stays 2-7.
    const SHIFTED = ['import a;', 'import b;', SRC].join('\n');
    expect(hunksOutsideShader('@@ -3 +10 @@\n', SRC, SHIFTED)).toBe(false); // old line 3 is GLSL; new line 10 is lifecycle
    expect(hunksOutsideShader('@@ -8 +5 @@\n', SRC, SHIFTED)).toBe(false); // old line 8 is lifecycle; new line 5 is GLSL
    expect(hunksOutsideShader('@@ -8 +10 @@\n', SRC, SHIFTED)).toBe(true); // lifecycle on both sides is honoured
  });
  it('is the shipped entry, and verdicts follow the verification', () => {
    expect(EXEMPTIONS.map((e) => e.file)).toEqual([FX]);
    const rows = [{ legacy: FX, twin: FX_NODE }];
    expect(twinVerdict([FX], rows, () => true, () => true).violations).toEqual([]);
    expect(twinVerdict([FX], rows, () => true, () => false).violations).toHaveLength(1);
    expect(twinVerdict([FX], rows, () => true, () => true, []).violations).toHaveLength(1);
    expect(twinVerdict(['packages/render/src/three/fog-pass.ts'], [{ legacy: 'packages/render/src/three/fog-pass.ts', twin: 'x.node.ts' }], () => true, () => true).violations).toHaveLength(1);
  });
  it('--files mode never honours it (nothing to diff)', () => {
    const io = fixtureIo(true);
    mkdirSync(path.join(io.root, 'packages/render/src/three/units'), { recursive: true });
    writeFileSync(path.join(io.root, FX), '');
    writeFileSync(path.join(io.root, FX_NODE), '');
    expect(runTwinCheck([`--files=${FX}`], { ...io, outsideShader: () => true })).toBe(1);
  });
});
