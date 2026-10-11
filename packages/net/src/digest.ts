/** The network hash (spec §3.4): `sim.hash()` folded with the mission
 *  runtime's digest (0 until N2 adds one) and the build's data digest, using
 *  the same word fold as `packages/sim/src/hash.ts`. Reimplemented rather than
 *  imported: the sim barrel does not export its hash primitives, and net must
 *  not reach into sim internals. */
export const DIGEST_SEED = 0x811c9dc5 | 0;
export function fold(h: number, w: number): number {
  return Math.imul(h ^ w, 16777619);
}
export function matchDigest(simHash: number, runtimeDigest: number, dataDigest: number): number {
  return fold(fold(fold(DIGEST_SEED, simHash | 0), runtimeDigest | 0), dataDigest | 0);
}
