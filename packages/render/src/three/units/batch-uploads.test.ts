/**
 * GH-1152 (12 Nov): the fixed-capacity per-frame batches upload what they drew on a node boot (`batchUploads: 'drawn'`) and the whole
 * buffer otherwise (`'capacity'`, the legacy behaviour, byte for byte).
 *
 * Falsification (run by hand, in the commit message): delete the `addUpdateRange` line in `markFrameUpload`: the 'drawn' specs go red
 * (0 ranges, a full upload); drop the `vertices > 0` early return: the empty-frame specs go red (a version bump at a draw range of 0).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { markFrameUpload } from './batch-uploads';
import { OverlayBatch } from './overlays';
import { ShellBatch, TracerBatch } from './fx';
import { spawnTracer } from './tracers';
import { spawnShell } from './shells';

const attr = (n: number, itemSize: number): THREE.BufferAttribute => new THREE.BufferAttribute(new Float32Array(n * itemSize), itemSize).setUsage(THREE.DynamicDrawUsage);
type Geo = THREE.BufferGeometry;
const attrsOf = (g: Geo): THREE.BufferAttribute[] => ['position', 'aColor', 'aAlpha'].map((k) => g.getAttribute(k) as THREE.BufferAttribute);
const versions = (g: Geo): number[] => attrsOf(g).map((a) => a.version);
const ranges = (g: Geo): { start: number; count: number }[][] => attrsOf(g).map((a) => a.updateRanges.map((r) => ({ start: r.start, count: r.count })));

describe('markFrameUpload', () => {
  it("'capacity' bumps every attribute and sets no range (the whole buffer uploads, as before)", () => {
    const a = attr(100, 3);
    const b = attr(100, 1);
    markFrameUpload([a, b], 7, 'capacity');
    expect([a.version, b.version]).toEqual([1, 1]);
    expect([a.updateRanges.length, b.updateRanges.length]).toEqual([0, 0]);
  });
  it("'drawn' sets one range over the drawn prefix, per item size, and bumps", () => {
    const a = attr(100, 3);
    const b = attr(100, 1);
    markFrameUpload([a, b], 7, 'drawn');
    expect(a.updateRanges).toEqual([{ start: 0, count: 21 }]);
    expect(b.updateRanges).toEqual([{ start: 0, count: 7 }]);
    expect([a.version, b.version]).toEqual([1, 1]);
  });
  it("'drawn' replaces the last frame's range rather than adding to it", () => {
    const a = attr(100, 3);
    markFrameUpload([a], 9, 'drawn');
    markFrameUpload([a], 4, 'drawn');
    expect(a.updateRanges).toEqual([{ start: 0, count: 12 }]);
  });
  it("'drawn' with nothing drawn uploads nothing (no bump: a range-less bump would upload the whole buffer)", () => {
    const a = attr(100, 3);
    markFrameUpload([a], 0, 'drawn');
    expect(a.version).toBe(0);
    expect(a.updateRanges).toEqual([]);
  });
});

describe('the batches', () => {
  it('OverlayBatch: capacity by default; drawn after setUploads, over the vertices it drew', () => {
    const legacy = new OverlayBatch(64);
    legacy.beginFrame();
    legacy.rect([0, 0, 0], -12, -10, 12, -7, '#FF0000', 0.8);
    legacy.endFrame();
    expect(legacy.uploadsMode).toBe('capacity');
    expect(versions(legacy.mesh.geometry)).toEqual([1, 1, 1]);
    expect(ranges(legacy.mesh.geometry)).toEqual([[], [], []]);

    const node = new OverlayBatch(64);
    node.setUploads('drawn');
    node.beginFrame();
    node.rect([0, 0, 0], -12, -10, 12, -7, '#FF0000', 0.8);
    node.endFrame();
    expect(node.mesh.geometry.drawRange.count).toBe(6);
    expect(ranges(node.mesh.geometry)).toEqual([[{ start: 0, count: 18 }], [{ start: 0, count: 18 }], [{ start: 0, count: 6 }]]);
    node.beginFrame();
    node.endFrame();
    expect(node.mesh.geometry.drawRange.count).toBe(0);
    expect(versions(node.mesh.geometry)).toEqual([1, 1, 1]);
  });

  it('TracerBatch: count quads read the first 4 * count vertices; an empty frame uploads nothing on drawn, everything on capacity', () => {
    const tracers = [spawnTracer(0, 0, 3, 0, 0), spawnTracer(1, 0, 4, 0, 0)];
    const node = new TracerBatch(16);
    node.setUploads('drawn');
    node.update(tracers, ['#FFFFFF', '#FFFFFF'], null, 0, 0, 0);
    expect(node.mesh.geometry.drawRange.count).toBe(12);
    expect(ranges(node.mesh.geometry)).toEqual([[{ start: 0, count: 24 }], [{ start: 0, count: 24 }], [{ start: 0, count: 8 }]]);
    node.update([], ['#FFFFFF', '#FFFFFF'], null, 0, 0, 0);
    expect(versions(node.mesh.geometry)).toEqual([1, 1, 1]);

    const legacy = new TracerBatch(16);
    legacy.update([], ['#FFFFFF', '#FFFFFF'], null, 0, 0, 0);
    expect(legacy.uploadsMode).toBe('capacity');
    expect(versions(legacy.mesh.geometry)).toEqual([1, 1, 1]);
    expect(ranges(legacy.mesh.geometry)).toEqual([[], [], []]);
  });

  it('ShellBatch: the same contract', () => {
    const shells = [spawnShell(0, 0, 8, 0, 0, 'mortar')];
    const node = new ShellBatch(8);
    node.setUploads('drawn');
    node.update([], ['#FFFFFF', '#FFFFFF'], null, 0, 0, 0);
    expect(versions(node.mesh.geometry)).toEqual([0, 0, 0]);
    node.update(shells, ['#FFFFFF', '#FFFFFF'], null, 0, 0, 0);
    const quads = node.mesh.geometry.drawRange.count / 6;
    expect(quads).toBeGreaterThan(0);
    expect(ranges(node.mesh.geometry)).toEqual([[{ start: 0, count: quads * 12 }], [{ start: 0, count: quads * 12 }], [{ start: 0, count: quads * 4 }]]);

    const legacy = new ShellBatch(8);
    legacy.update(shells, ['#FFFFFF', '#FFFFFF'], null, 0, 0, 0);
    expect(legacy.uploadsMode).toBe('capacity');
    expect(ranges(legacy.mesh.geometry)).toEqual([[], [], []]);
  });
});
