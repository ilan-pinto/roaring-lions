import { describe, expect, it } from 'vitest';
import { profileTotal, type CpuProfile } from './cpu-profile';

const frame = (functionName: string, lineNumber: number) => ({ functionName, url: 'http://localhost:5215/node_modules/three/build/three.webgpu.js', lineNumber });

// root(1) -> a(2) -> b(3); a(2) -> a(4), a recursion. Four samples of 1 ms: b, b, the inner a, the outer a.
const P: CpuProfile = {
  nodes: [
    { id: 1, callFrame: frame('(root)', 0), children: [2] },
    { id: 2, callFrame: frame('a', 9), children: [3, 4] },
    { id: 3, callFrame: frame('b', 19) },
    { id: 4, callFrame: frame('a', 9) },
  ],
  samples: [3, 3, 4, 2],
  timeDeltas: [1000, 1000, 1000, 1000],
  startTime: 0,
  endTime: 4000,
};

describe('profileTotal (GH-1152)', () => {
  it('counts a sample once toward every distinct function on its stack, recursion included once', () => {
    const rows = Object.fromEntries(profileTotal(P).map((r) => [r.fn, r]));
    expect(rows['(root)']?.totalMs).toBe(4);
    expect(rows.a?.totalMs).toBe(4);
    expect(rows.a?.selfMs).toBe(2);
    expect(rows.b?.totalMs).toBe(2);
    expect(rows.b?.selfMs).toBe(2);
  });
  it('sorts by inclusive time and keeps the file:line key', () => {
    const rows = profileTotal(P);
    expect(rows.map((r) => r.totalMs)).toEqual([4, 4, 2]);
    expect(rows.find((r) => r.fn === 'b')?.key).toBe('b  build/three.webgpu.js:20');
  });
});
