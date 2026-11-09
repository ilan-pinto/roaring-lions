import { describe, expect, it } from 'vitest';
import { noiseExit } from './noise-check';

const h = (c: string) => c.repeat(64);

describe('noise-check verdict', () => {
  it('24 identical hashes pass', () => {
    expect(noiseExit(Array<string>(24).fill(h('a')), 24, 0)).toBe(0);
  });
  it('one differing capture in 24 fails (exit 1)', () => {
    expect(noiseExit([...Array<string>(23).fill(h('a')), h('b')], 24, 0)).toBe(1);
  });
  it('a process that failed is exit 2, even when the survivors agree', () => {
    expect(noiseExit(Array<string>(23).fill(h('a')), 24, 1)).toBe(2);
  });
  it('fewer captures than required cannot pass (vacuous agreement)', () => {
    expect(noiseExit([], 24, 0)).toBe(1);
    expect(noiseExit([h('a')], 24, 0)).toBe(1);
  });
});
