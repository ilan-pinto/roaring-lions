import { describe, expect, it } from "vitest";
import {
  GRASS_BLADES,
  GRASS_LOD1_BLADES,
  GRASS_LOD2_BLADES,
  GRASS_SCALE_MAX,
  GRASS_SCALE_MIN,
  GRASS_BLADE_BASE_WIDTH,
  GRASS_LOD2_BASE_WIDTH,
  GRASS_TIP_CAP,
  GRASS_WIDTH_ATTRIBUTE,
  NATURE_ATTRIBUTE,
  buildGrassClump,
  clampGrassScale,
  grassBlades,
  grassRootOcclusion,
  type GrassColours,
  type GrassGeometry,
  type GrassLod,
  type GrassVariant,
} from "./grass-blade";
import paletteJson from "../../../../../data/palette.json";
import { hexToLinear } from "./shared";
import { WIND_CLASS_GRASS } from "./wind";

const ramps = paletteJson.ramps as Record<
  string,
  { colors: string[] } | undefined
>;
function paletteColor(key: string): string {
  const [band, index] = key.split(".");
  const hex = ramps[band ?? ""]?.colors[Number(index)];
  if (hex === undefined) throw new Error(`no palette entry ${key}`);
  return hex;
}

const COLOURS: GrassColours = {
  root: paletteColor("grass.4"),
  tip3: paletteColor("grass.3"),
  tip2: paletteColor("grass.2"),
  tip1: paletteColor("grass.1"),
  strawRoot: paletteColor("dust.3"),
  strawTip: paletteColor("limestone.3"),
};
const VARIANTS: GrassVariant[] = [0, 1, 2];
const LODS: GrassLod[] = [0, 1, 2];

// Literals, not recomputed from the module under test.
const TRIS: Record<GrassLod, number[]> = {
  0: [84, 112, 140],
  1: [40, 50, 60],
  2: [5, 6, 7],
};

describe("triangles per LOD (design 2.1)", () => {
  for (const lod of LODS)
    for (const v of VARIANTS)
      it(`LOD${lod} variant ${v}`, () => {
        const g = buildGrassClump(v, lod, COLOURS);
        expect(g.triangles).toBe(TRIS[lod][v]);
        expect(g.indices.length).toBe(TRIS[lod][v] * 3);
      });
  it("blade counts are 12/16/20, 8/10/12, 5/6/7", () => {
    expect([...GRASS_BLADES]).toEqual([12, 16, 20]);
    expect([...GRASS_LOD1_BLADES]).toEqual([8, 10, 12]);
    expect([...GRASS_LOD2_BLADES]).toEqual([5, 6, 7]);
  });
  it("every index is in range and every attribute has one entry per vertex", () => {
    for (const lod of LODS)
      for (const v of VARIANTS) {
        const g = buildGrassClump(v, lod, COLOURS);
        const n = g.positions.length / 3;
        expect(g.normals.length).toBe(n * 3);
        expect(g.colors.length).toBe(n * 3);
        expect(g.nature.length).toBe(n * 3);
        for (const i of g.indices) expect(i).toBeLessThan(n);
      }
  });
});

describe("height cap and ground (N-4)", () => {
  it("no tip passes 0.12 tile after any legal clump scale, and nothing is below y 0", () => {
    for (const lod of LODS)
      for (const v of VARIANTS) {
        const g = buildGrassClump(v, lod, COLOURS);
        for (const s of [GRASS_SCALE_MIN, 1, GRASS_SCALE_MAX, 5]) {
          const k = clampGrassScale(v, s);
          let top = 0;
          for (let i = 1; i < g.positions.length; i += 3) {
            expect(g.positions[i]).toBeGreaterThanOrEqual(0);
            top = Math.max(top, g.positions[i] * k);
          }
          expect(top).toBeLessThanOrEqual(GRASS_TIP_CAP + 1e-6);
        }
      }
  });
  it("the clamp binds: an absurd scale is pulled in, a legal one is not", () => {
    for (const v of VARIANTS) {
      expect(clampGrassScale(v, 100)).toBeLessThan(GRASS_SCALE_MAX + 1e-9);
      expect(clampGrassScale(v, 0.9)).toBe(0.9);
    }
  });
  it("blade heights stay inside 0.05-0.12", () => {
    for (const v of VARIANTS)
      for (const b of grassBlades(v)) {
        expect(b.height).toBeGreaterThanOrEqual(0.05);
        expect(b.height).toBeLessThanOrEqual(0.12);
      }
  });
  it("the footprint is 0.17 tile across", () => {
    for (const v of VARIANTS) {
      const g = buildGrassClump(v, 0, COLOURS);
      for (let i = 0; i < g.positions.length; i += 3)
        expect(Math.hypot(g.positions[i], g.positions[i + 2])).toBeLessThan(
          0.17,
        );
    }
  });
});

describe("LOD subsets are stable", () => {
  it("every LOD2 and LOD1 blade tip is a LOD0 blade tip, bit for bit", () => {
    for (const v of VARIANTS) {
      const key = (g: GrassGeometry, vi: number): string =>
        `${g.positions[vi * 3]},${g.positions[vi * 3 + 1]},${g.positions[vi * 3 + 2]}`;
      const tipSet = (g: GrassGeometry): Set<string> => {
        // Tip vertices are the ones carrying `phase` and y at the blade top: the vertex that closes each blade's final triangle.
        const s = new Set<string>();
        const per = g.indices.length / 3 / g.blades;
        for (let b = 0; b < g.blades; b++)
          s.add(key(g, g.indices[(b * per + per - 1) * 3 + 2]));
        return s;
      };
      const t0 = tipSet(buildGrassClump(v, 0, COLOURS));
      const t1 = tipSet(buildGrassClump(v, 1, COLOURS));
      const t2 = tipSet(buildGrassClump(v, 2, COLOURS));
      expect(t0.size).toBe(GRASS_BLADES[v]);
      expect(t1.size).toBe(GRASS_LOD1_BLADES[v]);
      expect(t2.size).toBe(GRASS_LOD2_BLADES[v]);
      for (const k of t1) expect(t0.has(k)).toBe(true);
      for (const k of t2) expect(t1.has(k)).toBe(true);
    }
  });
  it("the tallest blade survives to LOD2", () => {
    for (const v of VARIANTS) {
      const g0 = buildGrassClump(v, 0, COLOURS);
      const g2 = buildGrassClump(v, 2, COLOURS);
      const top = (g: GrassGeometry): number =>
        Math.max(
          ...Array.from(
            { length: g.positions.length / 3 },
            (_, i) => g.positions[i * 3 + 1],
          ),
        );
      expect(top(g2)).toBeGreaterThan(top(g0) * 0.85);
    }
  });
  it("is a pure function", () => {
    const a = buildGrassClump(1, 0, COLOURS);
    const b = buildGrassClump(1, 0, COLOURS);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });
});

describe("straw and colours", () => {
  it("straw is 8% of blades, within one blade per variant (4 of 48)", () => {
    let straw = 0;
    let total = 0;
    for (const v of VARIANTS) {
      const bl = grassBlades(v);
      straw += bl.filter((b) => b.straw).length;
      total += bl.length;
    }
    expect(total).toBe(48);
    expect(straw).toBe(4);
    expect(straw / total).toBeGreaterThan(0.07);
    expect(straw / total).toBeLessThan(0.09);
  });
  it("tip classes split 45/35/12/8 over the three variants", () => {
    const n = [0, 0, 0, 0];
    for (const v of VARIANTS) for (const b of grassBlades(v)) n[b.tipClass]++;
    expect(n).toEqual([21, 17, 6, 4]); // of 48: 43.8%, 35.4%, 12.5%, 8.3%
  });
  it("colours are LINEAR palette keys: a root vertex at the bottom is grass.4 x 0.65, a straw root is dust.3 x 0.65", () => {
    const g = buildGrassClump(2, 0, COLOURS);
    const grassRoot = hexToLinear("#6E9E33"); // grass.4, a literal on purpose
    const strawRoot = hexToLinear("#AC8248"); // dust.3
    const seenRoots: number[][] = [];
    for (let i = 0; i < g.positions.length / 3; i++)
      if (g.positions[i * 3 + 1] === 0)
        seenRoots.push([
          g.colors[i * 3],
          g.colors[i * 3 + 1],
          g.colors[i * 3 + 2],
        ]);
    expect(seenRoots.length).toBe(40);
    const eq = (c: number[], ref: [number, number, number]): boolean =>
      c.every((x, k) => Math.abs(x - ref[k] * 0.65) < 1e-6);
    expect(seenRoots.filter((c) => eq(c, grassRoot)).length).toBe(36);
    expect(seenRoots.filter((c) => eq(c, strawRoot)).length).toBe(4);
    // Not sRGB: raw bytes would be far brighter than linear.
    expect(grassRoot[1]).toBeLessThan(0.4);
  });
  it("a tip vertex carries its tip colour, unshaded", () => {
    const g = buildGrassClump(0, 0, COLOURS);
    const wanted = [
      hexToLinear("#8AB04E"),
      hexToLinear("#A6BC66"),
      hexToLinear("#C0CE7E"),
      hexToLinear("#B8A182"),
    ]; // grass.3, grass.2, grass.1, limestone.3 (checked below)
    expect(paletteColor("limestone.3").toUpperCase()).toBe("#C8B494");
    wanted[3] = hexToLinear("#C8B494");
    let hits = 0;
    for (let i = 0; i < g.positions.length / 3; i++) {
      const c = [g.colors[i * 3], g.colors[i * 3 + 1], g.colors[i * 3 + 2]];
      if (
        wanted.some((w) =>
          w.every(
            (x, k) =>
              Math.abs(x * grassRootOcclusion(g.nature[i * 3]) - c[k]) < 1e-6,
          ),
        )
      )
        hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(12);
  });
  it("root occlusion is 0.65 at the root and 1 from 40% up", () => {
    expect(grassRootOcclusion(0)).toBeCloseTo(0.65, 12);
    expect(grassRootOcclusion(0.4)).toBeCloseTo(1, 12);
    expect(grassRootOcclusion(0.9)).toBe(1);
  });
});

describe("rlNature and normals", () => {
  it("x is height in the box (0..1, tallest tip 1 at LOD0), y is the grass class, z a phase in [0,1)", () => {
    for (const v of VARIANTS)
      for (const lod of LODS) {
        const g = buildGrassClump(v, lod, COLOURS);
        let maxX = 0;
        for (let i = 0; i < g.positions.length / 3; i++) {
          const x = g.nature[i * 3];
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1 + 1e-6);
          maxX = Math.max(maxX, x);
          expect(g.nature[i * 3 + 1]).toBe(WIND_CLASS_GRASS);
          expect(g.nature[i * 3 + 2]).toBeGreaterThanOrEqual(0);
          expect(g.nature[i * 3 + 2]).toBeLessThan(1);
        }
        if (lod === 0) expect(maxX).toBeCloseTo(1, 5);
      }
    expect(NATURE_ATTRIBUTE).toBe("rlNature");
  });
  it("the phase differs between blades", () => {
    const phases = new Set(grassBlades(2).map((b) => b.phase));
    expect(phases.size).toBe(20);
  });
  it("normals are unit and lean up (bent toward up-and-out), never down", () => {
    for (const v of VARIANTS) {
      const g = buildGrassClump(v, 0, COLOURS);
      for (let i = 0; i < g.normals.length; i += 3) {
        expect(
          Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]),
        ).toBeCloseTo(1, 5);
        expect(g.normals[i + 1]).toBeGreaterThan(0.3);
      }
    }
  });
});

describe("GH-1167 S4: the width record the node material's flutter and width floor read", () => {
  // Falsify: push `+half` on both ring vertices (the edge-pair spec goes red) / write `baseW` instead of `baseW / 2` (the root half
  // spec goes red) / write the axis without the twist (`b.twistRad * t` dropped: the axis-vs-positions spec goes red).
  it("is named rlGrassWidth and has four floats per vertex", () => {
    expect(GRASS_WIDTH_ATTRIBUTE).toBe("rlGrassWidth");
    const g = buildGrassClump(1, 0, COLOURS);
    expect(g.width.length).toBe((g.positions.length / 3) * 4);
  });

  it("each ring's two vertices sit at -half and +half along a unit axis that is exactly their separation; the tip has 0", () => {
    for (const lod of [0, 1, 2] as const) {
      for (const variant of [0, 1, 2] as const) {
        const g = buildGrassClump(variant, lod, COLOURS);
        const n = g.positions.length / 3;
        const rootHalf = (lod === 2 ? GRASS_LOD2_BASE_WIDTH : GRASS_BLADE_BASE_WIDTH) / 2;
        let tips = 0;
        let pairs = 0;
        for (let v = 0; v < n; v++) {
          const w = g.width.subarray(4 * v, 4 * v + 4);
          expect(Math.hypot(w[0], w[1])).toBeCloseTo(1, 6);
          expect(w[3]).toBeCloseTo(rootHalf, 9);
          if (w[2] === 0) {
            tips++;
            continue;
          }
          if (w[2] < 0) {
            // Its partner is the next vertex: same axis, +half, and the positions differ by axis * 2 * half.
            const u = g.width.subarray(4 * v + 4, 4 * v + 8);
            expect(u[2]).toBeCloseTo(-w[2], 9);
            expect(u[0]).toBeCloseTo(w[0], 9);
            expect(u[1]).toBeCloseTo(w[1], 9);
            const p = g.positions;
            expect(p[3 * v + 3] - p[3 * v]).toBeCloseTo(w[0] * 2 * u[2], 6);
            expect(p[3 * v + 4] - p[3 * v + 1]).toBeCloseTo(0, 6);
            expect(p[3 * v + 5] - p[3 * v + 2]).toBeCloseTo(w[1] * 2 * u[2], 6);
            pairs++;
          }
        }
        expect(tips, `tips v${variant} lod${lod}`).toBe(g.blades);
        // A root ring has the full root half width.
        expect(pairs).toBeGreaterThan(0);
        expect(Math.max(...Array.from({ length: n }, (_, v) => g.width[4 * v + 2]))).toBeCloseTo(rootHalf, 9);
      }
    }
  });
});
