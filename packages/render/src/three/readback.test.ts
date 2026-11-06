import { describe, expect, it } from 'vitest';
import { AsyncPhotoMemo, READBACK_LAYOUT, normaliseReadback, paddedBufferBytes, paddedRowBytes } from './readback';
import { nodeCaptureSize } from './capture-view.node';

/** A w x h image whose texel (x, y) from the TOP has red = 10*y + x, so a wrong row or a wrong stride shows in the first byte. */
function topDownTight(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(10 * y + x, 0, 0, 255);
  return out;
}

/** What WebGPU hands back for it: rows padded to 256 bytes, the last row not, the padding filled with a poison byte. */
function webgpuBuffer(w: number, h: number): Uint8Array {
  const tight = topDownTight(w, h);
  const stride = paddedRowBytes(w);
  const buf = new Uint8Array(paddedBufferBytes(w, h)).fill(0xee);
  for (let y = 0; y < h; y++) for (let i = 0; i < w * 4; i++) buf[y * stride + i] = tight[y * w * 4 + i] ?? 0;
  return buf;
}

const reds = (px: Uint8Array, w: number, h: number): number[] => {
  const r: number[] = [];
  for (let y = 0; y < h; y++) r.push(px[y * w * 4] ?? -1);
  return r;
};

describe('row padding', () => {
  it('pads a row to 256 bytes, and the buffer does not pad the last row', () => {
    expect(paddedRowBytes(3)).toBe(256);
    expect(paddedRowBytes(64)).toBe(256);
    expect(paddedRowBytes(65)).toBe(512);
    expect(paddedBufferBytes(3, 2)).toBe(256 + 12);
  });
  it('strips the padding: no poison byte survives and every texel is where it was (3 x 4)', () => {
    const px = normaliseReadback(webgpuBuffer(3, 4), 3, 4, { padded: true, topDown: false });
    expect(px.length).toBe(3 * 4 * 4);
    expect(px.includes(0xee)).toBe(false);
    // top-down source with topDown false: rows are left in source order
    expect(reds(px, 3, 4)).toEqual([0, 10, 20, 30]);
  });
  it('a 65-texel row crosses the 256-byte boundary and still lands tight', () => {
    const px = normaliseReadback(webgpuBuffer(65, 2), 65, 2, { padded: true, topDown: false });
    expect(px.length).toBe(65 * 2 * 4);
    expect(px.includes(0xee)).toBe(false);
    expect(px[(65 * 4) + 4 * 64]).toBe(10 + 64);
  });
  it('refuses a buffer too short for its layout rather than returning a quietly wrong picture', () => {
    expect(() => normaliseReadback(new Uint8Array(10), 3, 4, { padded: true, topDown: false })).toThrow(/needed/);
  });
});

describe('row orientation: every backend comes out bottom-up', () => {
  it('WebGPU is top-down: the first output row is the BOTTOM row of the image', () => {
    const px = normaliseReadback(webgpuBuffer(3, 4), 3, 4, READBACK_LAYOUT['node-webgpu']);
    expect(reds(px, 3, 4)).toEqual([30, 20, 10, 0]);
  });
  it('three WebGL2 is already bottom-up and tight: rows are left alone', () => {
    const bottomUp = new Uint8Array(topDownTight(3, 4)); // here "row 0" is the bottom row, whatever its content
    const px = normaliseReadback(bottomUp, 3, 4, READBACK_LAYOUT['node-webgl2']);
    expect(reds(px, 3, 4)).toEqual([0, 10, 20, 30]);
  });
});

describe('the capture size', () => {
  it('keeps the aspect, is at most maxWidth wide and is never upscaled', () => {
    expect(nodeCaptureSize(2880, 1800, 1280)).toEqual({ width: 1280, height: 800 });
    expect(nodeCaptureSize(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
});

describe('the ground photograph memo: a stale generation is discarded', () => {
  const deferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void } => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('a photograph that lands after invalidate() is dropped, and the next request takes a fresh one', async () => {
    const memo = new AsyncPhotoMemo<string>();
    const first = deferred<string | null>();
    const r1 = memo.request(210, () => first.promise);
    memo.invalidate(); // the terrain was rebuilt while it flew
    first.resolve('OLD');
    expect(await r1).toBeNull();
    expect(memo.get(210)).toBeNull();
    const r2 = memo.request(210, async () => 'NEW');
    expect(await r2).toBe('NEW');
    expect(memo.get(210)).toBe('NEW');
  });
  it('is identity-stable until the next invalidate, one flight per generation and size', async () => {
    const memo = new AsyncPhotoMemo<{ n: number }>();
    let calls = 0;
    const take = async (): Promise<{ n: number }> => ({ n: ++calls });
    const [a, b] = await Promise.all([memo.request(64, take), memo.request(64, take)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(memo.get(64)).toBe(a);
    expect(memo.get(128)).toBeNull();
    memo.invalidate();
    expect(memo.get(64)).toBeNull();
  });
  it('settled() waits for a flight, and a failed photograph is just null', async () => {
    const memo = new AsyncPhotoMemo<string>();
    const d = deferred<string | null>();
    void memo.request(8, () => d.promise);
    let done = false;
    const s = memo.settled().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    d.resolve(null);
    await s;
    expect(done).toBe(true);
    expect(memo.get(8)).toBeNull();
    expect(await memo.request(8, () => Promise.reject(new Error('device lost')))).toBeNull();
  });
});
