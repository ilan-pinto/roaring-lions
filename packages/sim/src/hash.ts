// FNV-1a-style word hash over sim state. Not cryptographic and not standard
// FNV (it folds whole words, not bytes) — it only needs to be stable and
// sensitive, so replays can assert bit-identical state (the determinism
// canary for invariants 2 and 3).

import { imul32 } from './rng';

export const HASH_SEED = 0x811c9dc5 | 0;

export function hashWord(h: number, w: number): number {
  return imul32(h ^ w, 16777619);
}

export function hashArray(
  h0: number,
  arr: Uint8Array | Uint16Array | Int32Array | Uint32Array
): number {
  let h = h0;
  for (let i = 0; i < arr.length; i++) h = hashWord(h, arr[i] | 0);
  return h;
}
