/**
 * GH-943 P3 (T13, GH-1152) G4: the timestamp option is off by default. `timestamps` false (or absent) never passes `trackTimestamp`
 * to the `WebGPURenderer` constructor; true passes `trackTimestamp: true`. Read on the constructor's own arguments: `three/webgpu`'s
 * `WebGPURenderer` is replaced by a recorder whose `init` rejects, so `createNodeBackend` returns its refusal straight after building it.
 *
 * Falsification (run by hand, in the commit message): default it true in `nodeRendererParameters`
 * (`opts.timestamps === true` -> `opts.timestamps !== false`): the two default specs go red.
 */
import { describe, expect, it, vi } from 'vitest';
import { createNodeBackend, nodeRendererParameters, type NodeBackendOptions } from './node-backend';

const made = vi.hoisted(() => ({ args: [] as unknown[] }));

vi.mock('three/webgpu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three/webgpu')>();
  class RecordingRenderer {
    constructor(params: unknown) {
      made.args.push(params);
    }
    init(): Promise<never> {
      return Promise.reject(new Error('spec: no GPU'));
    }
    dispose(): void {}
  }
  return { ...actual, WebGPURenderer: RecordingRenderer };
});

const OPTS = { background: '#000000', adapter: 'spec' } as unknown as NodeBackendOptions;

async function constructorArgs(extra: Partial<NodeBackendOptions>): Promise<Record<string, unknown>> {
  made.args.length = 0;
  const out = await createNodeBackend({ ...OPTS, forceWebGL: false, ...extra });
  expect('reason' in out && out.reason).toMatch(/spec: no GPU/);
  expect(made.args).toHaveLength(1);
  return made.args[0] as Record<string, unknown>;
}

describe('the node renderer timestamp option (G4)', () => {
  it('absent: the constructor never sees trackTimestamp', async () => {
    const args = await constructorArgs({});
    expect('trackTimestamp' in args).toBe(false);
    expect(args).toEqual({ antialias: false, alpha: false, forceWebGL: false });
  });

  it('false: the constructor never sees trackTimestamp', async () => {
    const args = await constructorArgs({ timestamps: false });
    expect('trackTimestamp' in args).toBe(false);
  });

  it('true: trackTimestamp true', async () => {
    const args = await constructorArgs({ timestamps: true });
    expect(args.trackTimestamp).toBe(true);
  });

  it('the parameters helper agrees on all three', () => {
    expect(nodeRendererParameters({ forceWebGL: true })).toEqual({ antialias: false, alpha: false, forceWebGL: true });
    expect(nodeRendererParameters({ forceWebGL: true, timestamps: false })).toEqual({ antialias: false, alpha: false, forceWebGL: true });
    expect(nodeRendererParameters({ forceWebGL: true, timestamps: true })).toEqual({ antialias: false, alpha: false, forceWebGL: true, trackTimestamp: true });
  });
});
