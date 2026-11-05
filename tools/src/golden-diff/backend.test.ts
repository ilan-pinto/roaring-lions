import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { backendRefusal, backendTerm, chromiumArgsFor, expectedKind, mixedBackendRefusal, parseGpuArm, urlGpuParam } from './backend';
import { envKey } from './baseline';

const BASELINES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../golden-baselines');
const RENDER_GPU = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/render/src/gpu.ts');

describe('envKey: legacy keys never move', () => {
  it('reproduces every committed baseline directory name from its manifest, with no backend argument and with legacy-gl', () => {
    const dirs = readdirSync(BASELINES, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) {
      const m = JSON.parse(readFileSync(path.join(BASELINES, d.name, 'manifest.json'), 'utf8')) as {
        platform: string;
        arch: string;
        unmaskedRenderer: string;
      };
      expect(envKey(m.platform, m.arch, m.unmaskedRenderer), d.name).toBe(d.name);
      expect(envKey(m.platform, m.arch, m.unmaskedRenderer, 'legacy-gl'), d.name).toBe(d.name);
    }
  });
  it('the node backends get their own keys', () => {
    expect(envKey('linux', 'x64', 'SwiftShader', 'node-webgl2')).toBe('linux-x64-swiftshader-wgl2');
    expect(envKey('linux', 'x64', 'SwiftShader', 'node-webgpu')).toBe('linux-x64-swiftshader-wgpu');
  });
});

describe('arms', () => {
  it('parse, with absent meaning legacy and a typo refused', () => {
    expect(parseGpuArm(undefined)).toBe('legacy');
    expect(parseGpuArm('webgpu')).toBe('webgpu');
    expect(parseGpuArm('wgpu')).toBeNull();
  });
  it('a legacy URL gains nothing; the others name their backend', () => {
    expect(urlGpuParam('legacy')).toBe('');
    expect(urlGpuParam('webgl2')).toBe('&gpu=webgl2');
    expect(chromiumArgsFor('legacy')).toEqual([]);
    expect(chromiumArgsFor('webgl2')).toEqual([]);
    expect(chromiumArgsFor('webgpu')).toContain('--enable-unsafe-webgpu');
  });
  it('the key terms agree with the renderer package (tools may not import it, so the source text is read)', () => {
    const src = readFileSync(RENDER_GPU, 'utf8');
    expect(src).toContain("kind === 'node-webgl2' ? 'wgl2' : kind === 'node-webgpu' ? 'wgpu' : ''");
    expect(src).toContain("export type BackendKind = 'legacy-gl' | 'node-webgpu' | 'node-webgl2';");
    expect(backendTerm('node-webgl2')).toBe('wgl2');
    expect(backendTerm('node-webgpu')).toBe('wgpu');
    expect(backendTerm('legacy-gl')).toBe('');
  });
});

describe('the backend refusals (exit 2)', () => {
  it('a page that drew through another backend than the arm asked for is refused', () => {
    expect(backendRefusal('webgpu', { kind: expectedKind('webgpu'), adapter: 'a' })).toBeNull();
    expect(backendRefusal('webgpu', { kind: 'node-webgl2', adapter: 'webgl2' })).toMatch(/fallback is evidence about the fallback/);
    expect(backendRefusal('legacy', { kind: 'node-webgl2', adapter: 'webgl2' })).not.toBeNull();
    expect(backendRefusal('webgl2', undefined)).toMatch(/did not report/);
  });
  it('a run that mixes backends, or adapters, is refused', () => {
    const a = { id: 'quiet', backend: { kind: 'node-webgpu', adapter: 'x' } };
    expect(mixedBackendRefusal([a, { id: 'open', backend: { kind: 'node-webgpu', adapter: 'x' } }])).toBeNull();
    expect(mixedBackendRefusal([a, { id: 'open', backend: { kind: 'node-webgl2', adapter: 'webgl2' } }])).toMatch(/mixed backends/);
    expect(mixedBackendRefusal([a, { id: 'open', backend: { kind: 'node-webgpu', adapter: 'y' } }])).toMatch(/mixed backends/);
    expect(mixedBackendRefusal([])).toBeNull();
  });
});
