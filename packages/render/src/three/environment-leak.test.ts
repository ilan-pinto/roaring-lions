/**
 * L1 (GH-943), review N1: nothing GL-free guards `scene.environment === null`.
 *
 * The whole design is per-material `envMap` with `scene.environment` left null:
 * in three 0.186.1 a material with no `envMap` of its own and a non-null scene
 * environment reads ONE global `environmentIntensity`, which would hand the
 * ground, decals and smoke the sky the class table exists to withhold.
 * `ThreeRenderer`'s tests are GL-free and the registry's texture is null there,
 * so a renderer that assigned `scene.environment` in `init()` kept every one of
 * them green (the reviewer's mutation survived 264 files).
 *
 * So the guard reads the SOURCE: no non-test file under `packages/render/src`
 * may assign `<anything but this>.environment`, `.environmentIntensity`,
 * `.environmentRotation`. Falsified, each run red and put back: the reviewer's
 * `this.scene.environment = this.environment?.texture ?? null` after the attach in
 * `init`, and `this.scene.environmentIntensity = 0.3` on the same line.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** A line that WRITES a scene-wide environment: `x.environment = `, `x.environmentIntensity = `, `x.environmentRotation`... */
const WRITES_SCENE_ENVIRONMENT = /(?<![\w$])(?!this\.environment\b)[\w$.\])]+\.environment(Intensity|Rotation)?\s*=[^=]/;

describe('scene.environment stays null (the per-material envMap design)', () => {
  const files = sources(SRC);

  it('walks the renderer source (a vacuous walk would pass anything)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('ThreeRenderer.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('environment.ts'))).toBe(true);
  });

  it('no non-test file assigns a scene-wide environment, intensity or rotation', () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (WRITES_SCENE_ENVIRONMENT.test(code)) hits.push(`${relative(SRC, f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('the matcher sees the leak it exists for, and not the registry field the renderer owns', () => {
    expect(WRITES_SCENE_ENVIRONMENT.test('this.scene.environment = this.environment?.texture ?? null;')).toBe(true);
    expect(WRITES_SCENE_ENVIRONMENT.test('scene.environment = tex;')).toBe(true);
    expect(WRITES_SCENE_ENVIRONMENT.test('this.scene.environmentIntensity = 0.5;')).toBe(true);
    expect(WRITES_SCENE_ENVIRONMENT.test('this.environment = opts.environmentLight !== false ? new X() : null;')).toBe(false);
    expect(WRITES_SCENE_ENVIRONMENT.test('if (scene.environment === null) return;')).toBe(false);
  });
});
