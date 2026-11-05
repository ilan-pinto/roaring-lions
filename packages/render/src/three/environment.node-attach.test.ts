/**
 * GH-943 P1 (T6): a node boot attaches the registry to the node PMREM host. `init()` needs a live WebGPU device, which no unit
 * test has, so this pins the wiring in the source: inside the `if (this.nodeBackend)` branch of `init`, before its `return`,
 * `this.environment?.attach(this.nodeBackend.pmrem)` must appear. Without it the node path has no sky at all.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('node init attaches the environment', () => {
  it('calls environment.attach(nodeBackend.pmrem) inside the node branch, before it returns', () => {
    const src = readFileSync(new URL('./ThreeRenderer.ts', import.meta.url), 'utf8');
    const start = src.indexOf('if (this.nodeBackend) {\n      this.nodeBackend.setPixelRatio');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('return;', start);
    expect(end).toBeGreaterThan(start);
    // Comments stripped first: a commented-out line must not satisfy the pin.
    const code = src
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/^\s*this\.environment\?\.attach\(this\.nodeBackend\.pmrem\);\s*$/m);
  });
});
