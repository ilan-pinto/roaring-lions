import { describe, expect, it } from 'vitest';
import { SAND_FADE_START } from './garage-frame';
import { mountGarageView, sandAlpha } from './garage-view';

describe('mountGarageView: a garage left before the model mounted', () => {
  it('rejects with an AbortError before it fetches anything or makes a context', async () => {
    const ac = new AbortController();
    ac.abort();
    const host = { clientWidth: 566, clientHeight: 378 } as unknown as HTMLElement;
    // A URL that could not be fetched under `environment: 'node'` at all: if
    // the door got as far as the loader, this would fail some other way.
    const err = await mountGarageView(host, {
      typeId: 'inf_squad',
      kind: 'rigged',
      meshUrl: 'not-a-url',
      dracoDecoderPath: '/draco/',
      colors: { key: 'white', fill: 'white', sky: 'white', bounce: 'white', ground: 'white' },
      signal: ac.signal,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
  });
});

describe('sandAlpha: the patch fades out at its rim', () => {
  const size = 64;
  const tex = sandAlpha(size);
  const data = tex.image.data as Uint8Array;
  const at = (x: number, y: number): number => data[(y * size + x) * 4 + 1];

  it('is opaque at the centre and out to the fade start, and clear in the corners', () => {
    expect(at(size / 2, size / 2)).toBe(255);
    const inside = Math.floor((size / 2) * (1 + SAND_FADE_START * 0.9));
    expect(at(inside, size / 2)).toBe(255);
    expect(at(0, 0)).toBe(0);
    expect(at(size - 1, size - 1)).toBe(0);
  });

  it('never gets more opaque moving outward', () => {
    let last = 256;
    for (let x = size / 2; x < size; x++) {
      expect(at(x, size / 2)).toBeLessThanOrEqual(last);
      last = at(x, size / 2);
    }
  });
});
