// Seeded per-entity PRNG (invariant 3). Every entity owns an independent
// mulberry32 stream, seeded from (worldSeed, entityId) through a murmur3
// finalizer. Per-entity streams are the reason mid-mission spawns and deaths
// never reshuffle anyone else's rolls — the property the determinism test
// exercises end to end.

/** ToInt32(a * b) without Math.imul (Math is banned here; this is bit-exact). */
export function imul32(a: number, b: number): number {
  const bu = b >>> 0;
  return ((((a >>> 16) * bu) << 16) + (a & 0xffff) * bu) | 0;
}

/** murmur3 finalizer — good avalanche so adjacent entity ids decorrelate. */
function mix(h0: number): number {
  let h = h0 | 0;
  h ^= h >>> 16;
  h = imul32(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = imul32(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

export class Rng {
  /** One mulberry32 state word per entity slot. Hashed into the world hash. */
  readonly state: Uint32Array;

  constructor(seed: number, capacity: number) {
    this.state = new Uint32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.state[i] = mix(mix((seed | 0) ^ 0x9e3779b9) ^ imul32(i + 1, 0x9e3779b9)) >>> 0;
    }
  }

  /** Next uniform u32 from entity `id`'s private stream. */
  nextU32(id: number): number {
    const a = ((this.state[id] | 0) + 0x6d2b79f5) | 0;
    this.state[id] = a >>> 0;
    let t = imul32(a ^ (a >>> 15), 1 | a);
    t = ((t + imul32(t ^ (t >>> 7), 61 | t)) | 0) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /**
   * Bernoulli roll on entity `id`'s stream. p is Q16.16 in [0, ONE];
   * the extremes are exact and consume no draw.
   */
  chance(id: number, p: number): boolean {
    if (p <= 0) return false;
    if (p >= 65536) return true;
    return this.nextU32(id) >>> 16 < p;
  }
}
