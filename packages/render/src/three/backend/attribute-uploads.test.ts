/**
 * GH-943 P3 (T14, GH-1152) G2, the lever's structural guard: on a static scene a dynamic attribute is uploaded at creation and never
 * again; it is uploaded once more after each write (a version bump); a static attribute and three's other paths are unchanged.
 *
 * The class under the wrap is THREE's OWN `Attributes` (`three/src/renderers/common/Attributes.js`, the source of the bundled class the
 * node renderer holds), over a stub backend that counts what three asks it to upload. The oracles are literals.
 *
 * Falsification (run by hand, in the commit message): in `installVersionedUploads`, drop the early `return` (count but upload): the
 * static-scene, write, two-calls-a-frame and interleaved specs go red (4 red, run). The drift guard below goes red if a
 * three upgrade drops the always-upload rule (then this wrap has nothing left to do and should be deleted).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- three ships no declarations for its renderers' src/ classes; the two methods used are typed below (`AttributesLike`).
import AttributesUntyped from 'three/src/renderers/common/Attributes.js';
import { installVersionedUploads, type AttributesLike } from './attribute-uploads';

/** `AttributeType.VERTEX` (three 0.186.1 `renderers/common/Constants.js`). */
const VERTEX = 1;
const FRAMES = 10;

interface Counts {
  created: number;
  uploaded: number;
}
function threeAttributes(): { attributes: AttributesLike; counts: Counts } {
  const counts: Counts = { created: 0, uploaded: 0 };
  const backend = {
    createAttribute: (): void => {
      counts.created++;
    },
    updateAttribute: (): void => {
      counts.uploaded++;
    },
    destroyAttribute: (): void => {},
  };
  const info = { createAttribute: (): void => {}, destroyAttribute: (): void => {} };
  const Attributes = AttributesUntyped as unknown as new (b: unknown, i: unknown) => AttributesLike;
  return { attributes: new Attributes(backend, info), counts };
}

const dynamicAttribute = (): THREE.BufferAttribute => new THREE.BufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage);

describe('installVersionedUploads (P3 T14 G2)', () => {
  it("three's own rule re-uploads an unchanged dynamic attribute every frame (the premise)", () => {
    const { attributes, counts } = threeAttributes();
    const a = dynamicAttribute();
    for (let f = 0; f < 1 + FRAMES; f++) attributes.update(a, VERTEX);
    expect(counts).toEqual({ created: 1, uploaded: FRAMES });
  });

  it('a static scene: an unchanged dynamic attribute is uploaded at creation and never again', () => {
    const { attributes, counts } = threeAttributes();
    const up = installVersionedUploads(attributes, THREE.DynamicDrawUsage);
    const a = dynamicAttribute();
    for (let f = 0; f < 1 + FRAMES; f++) attributes.update(a, VERTEX);
    expect(counts).toEqual({ created: 1, uploaded: 0 });
    expect(up.takeSkipped()).toBe(FRAMES);
    expect(up.takeSkipped()).toBe(0);
  });

  it('a write (needsUpdate) is uploaded once, in the next call, and not again until the next write', () => {
    const { attributes, counts } = threeAttributes();
    installVersionedUploads(attributes, THREE.DynamicDrawUsage);
    const a = dynamicAttribute();
    attributes.update(a, VERTEX);
    a.needsUpdate = true;
    attributes.update(a, VERTEX);
    attributes.update(a, VERTEX);
    a.needsUpdate = true;
    attributes.update(a, VERTEX);
    expect(counts).toEqual({ created: 1, uploaded: 2 });
  });

  it('two render calls a frame (a pass that refreshes the same batch again) upload a still attribute zero times', () => {
    const { attributes, counts } = threeAttributes();
    installVersionedUploads(attributes, THREE.DynamicDrawUsage);
    const a = dynamicAttribute();
    attributes.update(a, VERTEX);
    for (let f = 0; f < FRAMES; f++) {
      attributes.update(a, VERTEX);
      attributes.update(a, VERTEX);
    }
    expect(counts.uploaded).toBe(0);
  });

  it('an interleaved dynamic attribute follows its buffer: uploaded when the buffer version moves', () => {
    const { attributes, counts } = threeAttributes();
    installVersionedUploads(attributes, THREE.DynamicDrawUsage);
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(32), 16, 1).setUsage(THREE.DynamicDrawUsage);
    const a = new THREE.InterleavedBufferAttribute(buf, 4, 0);
    attributes.update(a as never, VERTEX);
    attributes.update(a as never, VERTEX);
    buf.needsUpdate = true;
    attributes.update(a as never, VERTEX);
    expect(counts).toEqual({ created: 1, uploaded: 1 });
  });

  it('a static attribute is three\'s path, unchanged (uploaded on a version change only)', () => {
    const { attributes, counts } = threeAttributes();
    installVersionedUploads(attributes, THREE.DynamicDrawUsage);
    const a = new THREE.BufferAttribute(new Float32Array(12), 3);
    attributes.update(a, VERTEX);
    attributes.update(a, VERTEX);
    a.needsUpdate = true;
    attributes.update(a, VERTEX);
    expect(counts).toEqual({ created: 1, uploaded: 1 });
  });

  it('dispose puts the instance back on the class method (three re-uploads again)', () => {
    const { attributes, counts } = threeAttributes();
    const up = installVersionedUploads(attributes, THREE.DynamicDrawUsage);
    const a = dynamicAttribute();
    attributes.update(a, VERTEX);
    up.dispose();
    expect(Object.prototype.hasOwnProperty.call(attributes, 'update')).toBe(false);
    attributes.update(a, VERTEX);
    expect(counts.uploaded).toBe(1);
  });

  it('drift guard: the bundled node renderer still carries the always-upload rule this wrap undoes', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('three/webgpu'), 'utf8');
    expect(bundle).toContain('data.version < bufferAttribute.version || bufferAttribute.usage === DynamicDrawUsage');
  });
});
