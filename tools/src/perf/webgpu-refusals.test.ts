import { describe, expect, it } from 'vitest';
import { harnessRefusals, type ArmReading, type ViewReading } from './webgpu-refusals';

const view = (zoom: number, over: Partial<ViewReading> = {}): ViewReading => ({
  zoom,
  cpuRenderMs: 3,
  triangles: zoom === 1 ? 100000 : 60000,
  entriesCullOn: zoom === 1 ? 400 : 150,
  entriesCullOff: 900,
  ...over,
});
const arm = (id: 'L' | 'F' | 'G', over: Partial<ArmReading> = {}): ArmReading => ({
  arm: id,
  backendKind: id === 'L' ? 'legacy-gl' : id === 'F' ? 'node-webgl2' : 'node-webgpu',
  rafSource: 'function requestAnimationFrame() { [native code] }',
  consoleLines: [],
  views: [view(1), view(2.5)],
  timestampQueryAvailable: false,
  ...over,
});
const good = (): ArmReading[] => [arm('L'), arm('F'), arm('G')];

describe('harnessRefusals: each refusal is driven red by a constructed input', () => {
  it('passes a clean three-arm reading', () => {
    expect(harnessRefusals(good())).toEqual([]);
  });
  it('refuses CPU render 0', () => {
    expect(harnessRefusals([arm('G', { views: [view(1, { cpuRenderMs: 0 }), view(2.5)] })])).toEqual([expect.stringMatching(/CPU render reads 0/)]);
  });
  it('refuses triangle counts that do not change between z1 and z2.5', () => {
    expect(harnessRefusals([arm('L', { views: [view(1), view(2.5, { triangles: 100000 })] })]).join()).toMatch(/view did not change/);
  });
  it('refuses triangle counts that disagree across arms by more than 1%', () => {
    const g = arm('G', { views: [view(1, { triangles: 102000 }), view(2.5)] });
    expect(harnessRefusals([arm('L'), g]).join()).toMatch(/differ by more than 1%/);
    const near = arm('G', { views: [view(1, { triangles: 100900 }), view(2.5)] });
    expect(harnessRefusals([arm('L'), near])).toEqual([]);
  });
  it('refuses BatchedMesh entries that do not follow zoom, or the cull flag', () => {
    expect(harnessRefusals([arm('L', { views: [view(1), view(2.5, { entriesCullOn: 400 })] })]).join()).toMatch(/follow zoom/);
    expect(harnessRefusals([arm('L', { views: [view(1, { entriesCullOff: 400 }), view(2.5)] })]).join()).toMatch(/follow the cull flag/);
  });
  it.each(['GPUValidationError: bad', 'Destroyed texture ShadowDepthTexture used in a submit', 'texture uploaded again'])('refuses a console line: %s', (line) => {
    expect(harnessRefusals([arm('G', { consoleLines: ['fine', line] })])).toHaveLength(1);
  });
  it('refuses a stubbed rAF', () => {
    expect(harnessRefusals([arm('F', { rafSource: 'function () { return 0; }' })]).join()).toMatch(/not native code/);
  });
  it('refuses a backend that is not the arm', () => {
    expect(harnessRefusals([arm('G', { backendKind: 'node-webgl2' })]).join()).toMatch(/expected "node-webgpu"/);
  });
  it('refuses a missing GPU timestamp only where the adapter offers one', () => {
    expect(harnessRefusals([arm('G', { timestampQueryAvailable: true })]).join()).toMatch(/timestamp-query is available/);
    expect(harnessRefusals([arm('G', { timestampQueryAvailable: true, gpuTimestampMs: 2.1 })])).toEqual([]);
    expect(harnessRefusals([arm('G', { timestampQueryAvailable: false })])).toEqual([]);
  });
});
