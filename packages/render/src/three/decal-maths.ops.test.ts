/**
 * GH-943 P3 (T7) G1 and G3 on NUMBERS: the decal maths written once against `Ops<T>` / `IntOps<T>` (`decal-maths.ts`), which the
 * node twin (`decal-pool.node.ts`) builds as a graph. Every oracle here takes LITERALS, never a value imported from the code under
 * test: the pre-port `decalAlpha` is frozen below with its constants written out, the hash is re-derived in BigInt from its
 * published constants, and the crater and rim readings are hand-computed. Each spec names its one-line falsification, run by hand
 * and listed in the commit message.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NUMBER_INT_OPS, NUMBER_OPS } from './fog-ops';
import { tileHashOps } from '../tile-hash';
import {
  craterGradOps,
  craterHeight,
  craterHeightOps,
  decalAlpha,
  decalAlphaOps,
  decalGroundToneOps,
  decalKindOps,
  decalMultiplier,
  decalMultiplierOps,
  decalOutRatioOps,
  decalRimRatioOps,
  type DecalKind,
  type DecalRimLights,
} from './decal-maths';
import { decalRoadMix } from './terrain/decal-ground-tone';

// ---------------------------------------------------------------------------
// The FROZEN oracle: `decalAlpha` as it stood before the port (plain numbers, its own switch), every constant a literal.
// ---------------------------------------------------------------------------

const ss = (e0: number, e1: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
};
const c01 = (x: number): number => Math.min(1, Math.max(0, x));
const fr = (x: number): number => x - Math.floor(x);
const wob = (s: number, t: number, seed: number, amp: number, lobes: number): number => {
  const r = Math.hypot(s, t);
  const th = r > 0 ? Math.atan2(t, s) : 0;
  return r * (1 + amp * Math.sin(lobes * th + 2 * Math.PI * seed));
};
/** `tileHash` with its five published constants as literals (374761393, 668265263, 1274126177, 13, 16), the full 32 bits. */
const hash32 = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const KIND_INDEX: Record<DecalKind, number> = { crater: 0, scorch: 1, oil: 2, rubble: 3, tread: 4, tyre: 5, churn: 6 };

function frozenDecalAlpha(kind: DecalKind, s: number, t: number, seed: number, age: number, hl: number): { alpha: number; colour: number } {
  switch (kind) {
    case 'crater': {
      const rw = wob(s, t, seed, 0.04, 3);
      const bowl = 0.4 * (1 - ss(0.72, 0.8, rw));
      const lip = 0.25 * ss(0.76, 0.84, rw) * (1 - ss(0.92, 1.0, rw));
      return lip > bowl ? { alpha: lip, colour: 1 } : { alpha: bowl, colour: 0 };
    }
    case 'scorch':
      return { alpha: 0.45 * (1 - ss(0.55, 1, Math.hypot(s, t))), colour: 2 };
    case 'oil':
      return { alpha: 0.55 * (1 - ss(0.7, 1, wob(s, t, seed, 0.1, 2))), colour: 3 };
    case 'rubble': {
      const th = 2 * Math.PI * seed;
      const px = (s * hl) / 0.1;
      const pz = (t * hl) / 0.1;
      const qx = Math.cos(th) * px - Math.sin(th) * pz;
      const qz = Math.sin(th) * px + Math.cos(th) * pz;
      const cx = Math.floor(qx);
      const cz = Math.floor(qz);
      const ix = cx + 1024;
      const iz = cz + 1024 + Math.floor(1000 * seed);
      const h = hash32(ix, iz);
      const jx = 0.5 + 0.2 * (hash32(ix + 4099, iz) - 0.5);
      const jz = 0.5 + 0.2 * (hash32(ix, iz + 4099) - 0.5);
      const rc = (Math.hypot(cx + jx, cz + jz) * 0.1) / Math.max(hl, 1e-6);
      const chip = h < 0.7 * (1 - ss(0.55, 1, rc)) ? 1 : 0;
      const size = 0.55 + 0.45 * fr(13 * h);
      const disc = 1 - ss(0.2 * size, 0.38 * size, Math.hypot(qx - cx - jx, qz - cz - jz));
      return { alpha: 0.6 * chip * disc, colour: fr(7 * h) < 0.5 ? 4 : 5 };
    }
    case 'tread':
    case 'tyre': {
      const u = s * hl;
      const feather = c01((hl - Math.abs(u)) / 0.08);
      const side = 1 - ss(0.7, 1, Math.abs(t));
      const fade = c01(1 - Math.max(age, 0) / 180);
      let pattern = 1;
      if (kind === 'tread') {
        const p = u / 0.06;
        pattern = 0.65 + 0.35 * (p - Math.floor(p) >= 0.5 ? 1 : 0);
      }
      return { alpha: 0.35 * feather * side * fade * pattern, colour: kind === 'tread' ? 6 : 7 };
    }
    case 'churn': {
      const body = 1 - ss(0.45, 1, wob(s, t, seed, 0.12, 3));
      const r = Math.hypot(s, t);
      const theta = r > 0 ? Math.atan2(t, s) : 0;
      const raked = fr((theta / (2 * Math.PI)) * 9 + seed) >= 0.5 ? 1 : 0;
      const spoke = 0.6 + 0.4 * raked;
      const core = ss(0, 0.18, r);
      const fade = c01(1 - Math.max(age, 0) / 120);
      return { alpha: 0.5 * body * (1 + (spoke - 1) * core) * fade, colour: 6 };
    }
  }
}

/** A seeded linear congruential stream (the test's own, so the 500 points are the same every run). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

const KINDS: readonly DecalKind[] = ['crater', 'scorch', 'oil', 'rubble', 'tread', 'tyre', 'churn'];

describe('G1: the maths on numbers', () => {
  it('decalAlphaOps(NUMBER_OPS) equals the frozen pre-port decalAlpha on 500 seeded (kind, seed, age, offset) points', () => {
    const rnd = lcg(943);
    let nonZero = 0;
    const seenColours = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const kind = KINDS[i % KINDS.length] as DecalKind;
      const s = rnd() * 2.4 - 1.2;
      const t = rnd() * 2.4 - 1.2;
      const seed = rnd();
      const age = rnd() * 260 - 20;
      const hl = kind === 'rubble' ? 0.4 + rnd() * 1.6 : kind === 'tread' || kind === 'tyre' ? 0.29 : 0.3 + rnd();
      const want = frozenDecalAlpha(kind, s, t, seed, age, hl);
      const got = decalAlphaOps(NUMBER_OPS, NUMBER_INT_OPS, KIND_INDEX[kind], s, t, seed, age, hl);
      // The hash is read as its top 24 bits (the legacy material's rlHash), the frozen oracle as all 32: at most 2^-24 apart, so a
      // chip size moves by at most 13 * 2^-24.
      expect(got.alpha, `${kind} at (${s}, ${t}) seed ${seed} age ${age}`).toBeCloseTo(want.alpha, 5);
      expect(got.colour, `${kind} at (${s}, ${t})`).toBe(want.colour);
      // The plain export is the same body on numbers, with its signature kept.
      expect(decalAlpha(kind, s, t, seed, age, hl)).toEqual({ alpha: got.alpha, colour: got.colour });
      if (want.alpha > 0) nonZero++;
      seenColours.add(want.colour);
    }
    // Anti-vacuity: most points draw something, and every palette entry is reached.
    expect(nonZero).toBeGreaterThan(150);
    expect([...seenColours].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('an index outside the kind table reads opacity 0 (the legacy a = 0.0 and its discard); the kind decodes as int(x + 0.5)', () => {
    expect(decalAlphaOps(NUMBER_OPS, NUMBER_INT_OPS, 9, 0, 0, 0.3, 0, 1).alpha).toBe(0);
    expect(decalKindOps(NUMBER_OPS, 2.9999)).toBe(3);
    expect(decalKindOps(NUMBER_OPS, 3.0001)).toBe(3);
    expect(decalKindOps(NUMBER_OPS, 0)).toBe(0);
  });

  it('the rubble hash through IntOps equals rlHash on inputs whose hash has the top bit set (a signed shift drags it down)', () => {
    /** The legacy material's rlHash, in BigInt from its literals: uint arithmetic mod 2^32, the top 24 bits over 2^24. */
    const M = (1n << 32n) - 1n;
    const rlHash = (x: number, y: number): { h: bigint; v: number } => {
      let h = (BigInt(x) * 374761393n + BigInt(y) * 668265263n) & M;
      h = ((h ^ (h >> 13n)) * 1274126177n) & M;
      h = h ^ (h >> 16n);
      return { h, v: Number(h >> 8n) / 16777216 };
    };
    let topBit = 0;
    for (const [x, y] of [[1024, 1024], [1031, 1999], [1100, 1500], [2047, 1033], [1500, 1777], [1024 + 4099, 1024], [1888, 1024 + 4099]] as const) {
      const want = rlHash(x, y);
      // The intermediate h before the second xorshift, top bit set on most of these (the inputs are the rubble lattice's).
      const h1 = ((BigInt(x) * 374761393n + BigInt(y) * 668265263n) & M);
      if (h1 >= 1n << 31n) topBit++;
      const got = NUMBER_INT_OPS.toFloat01(tileHashOps(NUMBER_INT_OPS, x, y));
      expect(got, `(${x}, ${y})`).toBe(want.v);
    }
    expect(topBit, 'the witness needs inputs whose hash has the top bit set').toBeGreaterThanOrEqual(3);
  });

  it('craterHeight reads its literal values: the bowl floor, the bowl at half the lip, the rim crest and the rim slope', () => {
    // seed 0, t = 0: theta = 0, so the wobble's sine is 0 and rw = s. Shape (bowl 0.25, rim 0.12), the shipped uRimShape.
    expect(craterHeight(0, 0, 0, 0.25, 0.12)).toBeCloseTo(-0.25, 12);
    // x = 0.42 / 0.84 = 0.5: -0.25 * (1 - 0.25); the rim's rise starts at 0.66.
    expect(craterHeight(0.42, 0, 0, 0.25, 0.12)).toBeCloseTo(-0.1875, 12);
    // rw = rimC = (0.84 + 0.92) / 2 = 0.88: past the bowl, the rim at its crest.
    expect(craterHeight(0.88, 0, 0, 0.25, 0.12)).toBeCloseTo(0.12, 12);
    // rw = 0.77: halfway up the rim (smoothstep(0.66, 0.88, 0.77) = 0.5) over the bowl's last -0.25 * (1 - (0.77/0.84)^2).
    expect(craterHeight(0.77, 0, 0, 0.25, 0.12)).toBeCloseTo(-0.25 * (1 - (0.77 / 0.84) ** 2) + 0.06, 12);
    expect(craterHeightOps(NUMBER_OPS, 0.77, 0, 0, 0.25, 0.12)).toBe(craterHeight(0.77, 0, 0, 0.25, 0.12));
  });

  it('craterGradOps is the central difference of craterHeight with step 0.01, on both axes', () => {
    const at = (s: number, t: number, seed: number): void => {
      const g = craterGradOps(NUMBER_OPS, s, t, seed, 0.25, 0.12);
      const h = (a: number, b: number): number => craterHeight(a, b, seed, 0.25, 0.12);
      expect(g.hs).toBeCloseTo((h(s + 0.01, t) - h(s - 0.01, t)) / 0.02, 12);
      expect(g.ht).toBeCloseTo((h(s, t + 0.01) - h(s, t - 0.01)) / 0.02, 12);
    };
    at(0.77, 0, 0);
    at(0.5, 0.6, 0.3);
    // Inside the bowl along s at seed 0, t = 0: d/ds of -0.25 (1 - (s/0.84)^2) is 0.5 s / 0.84^2.
    expect(craterGradOps(NUMBER_OPS, 0.42, 0, 0, 0.25, 0.12).hs).toBeCloseTo((0.5 * 0.42) / 0.84 ** 2, 6);
  });

  it('decalMultiplierOps is 1 + a (decal / max(ground, 1e-4) - 1), and the plain export keeps its signature', () => {
    expect(decalMultiplierOps(NUMBER_OPS, 0.2, 0.5, 0.4)).toBeCloseTo(1 + 0.4 * (0.4 - 1), 12);
    expect(decalMultiplierOps(NUMBER_OPS, 0.2, 0, 1)).toBeCloseTo(2000, 9);
    const m = decalMultiplier([0.2, 0.6, 0.1], [0.5, 0.3, 0.1], 0.5);
    [0.7, 1.5, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 12));
  });

  it('decalGroundToneOps equals decalRoadMix (the road profile, a separate implementation) and the base tone with the roads off', () => {
    const base = [0.3, 0.25, 0.2] as const;
    const road = [0.6, 0.55, 0.5] as const;
    const sh = [0.7, 0.65, 0.6] as const;
    let moved = 0;
    for (let i = 0; i <= 40; i++) {
      const bG = i / 40;
      for (const bA of [0, 0.3, 0.5, 0.9]) {
        const want = decalRoadMix(base, road, sh, bG, bA);
        for (const c of [0, 1, 2] as const) {
          const got = decalGroundToneOps(NUMBER_OPS, base[c], road[c], sh[c], bG, bA, 1, 1);
          expect(got).toBeCloseTo(want[c], 9);
          expect(decalGroundToneOps(NUMBER_OPS, base[c], road[c], sh[c], bG, bA, 0, 1)).toBeCloseTo(base[c], 12);
          if (Math.abs(got - base[c]) > 1e-3) moved++;
        }
      }
    }
    expect(moved, 'anti-vacuity: the road and shoulder move the tone somewhere on the sweep').toBeGreaterThan(20);
  });
});

/** The G3 facet: dpx = (1, 0, 0), dpy = (0, 1, 0), so n0 = (0, 0, 1), r1 = (1, 0, 0), r2 = (0, 1, 0), det = 1. */
const FACET = { dpx: [1, 0, 0], dpy: [0, 1, 0], dstx: [1, 0], dsty: [0, 1] } as const;
/** Sun colour (1, 0.5, 0.25) at intensity 2, toward (-0.6, 0, 0.8); sky 0.2, ground 0.1 toward (0, 0, 1); ambient 0.05. */
const LIGHTS: DecalRimLights<number> = {
  ambient: [0.05, 0.05, 0.05],
  sunColor: [2, 1, 0.5],
  sunDir: [-0.6, 0, 0.8],
  hemiSky: [0.2, 0.2, 0.2],
  hemiGround: [0.1, 0.1, 0.1],
  hemiDir: [0, 0, 1],
};

describe('G3 (maths): the rim ratio on a known facet under literal lights', () => {
  // grad (0.75, 0) at halfLength 1, gain 1: surfGrad (0.75, 0, 0), n1 = normalize(-0.75, 0, 1) = (-0.6, 0, 0.8).
  // n1 . sun = 1, n0 . sun = 0.8; hemi weights 0.5 n.h + 0.5 = 0.9 (n1) and 1 (n0): hemi 0.19 and 0.2.
  it('lit: (0.24 + (2, 1, 0.5)) / (0.25 + 0.8 (2, 1, 0.5))', () => {
    const r = decalRimRatioOps(NUMBER_OPS, { hs: 0.75, ht: 0 }, 1, 1, FACET, LIGHTS, 1);
    expect(r[0]).toBeCloseTo(2.24 / 1.85, 12);
    expect(r[1]).toBeCloseTo(1.24 / 1.05, 12);
    expect(r[2]).toBeCloseTo(0.74 / 0.65, 12);
  });

  it('in full shadow: the ambient and hemisphere alone, 0.24 / 0.25 on every channel', () => {
    const r = decalRimRatioOps(NUMBER_OPS, { hs: 0.75, ht: 0 }, 1, 1, FACET, LIGHTS, 0);
    for (const c of r) expect(c).toBeCloseTo(0.96, 12);
  });

  it('a facet whose winding faces away is flipped toward the camera (n0.z < 0), and the gain scales the bump', () => {
    const flipped = { ...FACET, dpx: [0, 1, 0], dpy: [1, 0, 0], dstx: [0, 1], dsty: [1, 0] } as const;
    const r = decalRimRatioOps(NUMBER_OPS, { hs: 0.75, ht: 0 }, 1, 1, flipped, LIGHTS, 1);
    // Swapping the two screen axes swaps the frame consistently: the bumped normal is the same (-0.6, 0, 0.8).
    expect(r[0]).toBeCloseTo(2.24 / 1.85, 12);
    const flat = decalRimRatioOps(NUMBER_OPS, { hs: 0.75, ht: 0 }, 1, 0, FACET, LIGHTS, 1);
    for (const c of flat) expect(c).toBeCloseTo(1, 12);
  });

  it('decalOutRatioOps applies the rim on a crater with the gain on, and nowhere else', () => {
    expect(decalOutRatioOps(NUMBER_OPS, 0, 1, 0.8, 1.5)).toBeCloseTo(1.2, 12);
    expect(decalOutRatioOps(NUMBER_OPS, 0, 0, 0.8, 1.5)).toBe(0.8);
    for (const k of [1, 2, 3, 4, 5, 6]) expect(decalOutRatioOps(NUMBER_OPS, k, 1, 0.8, 1.5)).toBe(0.8);
  });
});

describe('the legacy material still carries the constants the Ops maths reads (the two cannot drift)', () => {
  it('the rim step is 0.01 and the irradiance floor 1e-4 in the legacy fragment', () => {
    const src = readFileSync(fileURLToPath(new URL('./decal-pool.ts', import.meta.url)), 'utf8');
    expect(src).toContain('float e = 0.01;');
    expect(src).toContain('max(rlIrradiance(n0, rlShadow), 1e-4)');
    expect(src).toContain('if (n0.z < 0.0) n0 = -n0;');
    expect(src).toContain('vec3 n1 = normalize(abs(det) * n0 - surfGrad);');
  });
});
