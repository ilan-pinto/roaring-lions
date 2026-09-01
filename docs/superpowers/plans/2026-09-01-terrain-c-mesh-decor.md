# T1-C — Mesh Decor and Scatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw scattered terrain objects — rocks, trees, bushes, grass, sand — from GLB assets instead of procedural geometry, in one draw call.

**Architecture:** Two new pure modules (a closed decor role vocabulary, and a headless placement function that turns a `TerrainInput` into a list of placements) plus one three.js assembly module that feeds those placements into a single `THREE.BatchedMesh`. This mirrors the split every existing terrain builder already uses: a headless builder that a node test can drive, and a thin three.js wrapper in `ThreeRenderer`.

**Tech Stack:** TypeScript, three.js r170 (`BatchedMesh`, `DRACOLoader` — both already shipped in the dependency), Blender 5.2 headless for asset export, vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-terrain-t1-design.md`

## Global Constraints

- **`@lions/render` may import sim types read-only and must never mutate sim state.** Decor is presentation only: no collision, no cover, no sight effect (invariant 4).
- **Palette exactness.** Every decor colour comes from `data/palette.json` via `readRamp`. No hex literal in decor source. `pnpm validate:ui` rejects colour literals in UI source; decor must hold the same line by construction.
- **The mesh contract applies.** Every decor GLB ships **zero materials, zero images, zero textures**, and every mesh node carries `extras.rl_role` from the closed decor set. An unknown role must throw, never draw a default colour.
- **Determinism of appearance.** Placement uses `tileHash(x, y)` from `packages/render/src/tile-hash.ts`. Same tile, same look, every run and both backends. No `Math.random()`.
- **Payload budget.** The mesh set already costs **34 fetches / 25.3 MiB** at boot, measured. Decor GLBs are Draco-compressed before wiring.
- **Do not kill the dev server.** Never `pkill -f vite`.
- **Never `git add -A`.** Other sessions share this worktree; commit explicit paths.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/render/src/three/terrain/decor-role.ts` | The closed decor role vocabulary and its ramp table. Pure. |
| `packages/render/src/three/terrain/decor-role.test.ts` | Role set is closed; unknown role throws. |
| `packages/render/src/three/terrain/decor-place.ts` | `decorPlacements(input)` — headless, no three.js. The derived rule. |
| `packages/render/src/three/terrain/decor-place.test.ts` | Determinism and per-family mapping. (Override precedence: deferred, see Task 3.) |
| `packages/render/src/three/terrain/decor-mesh.ts` | Placements + loaded geometries -> one `THREE.BatchedMesh`. |
| `tools/terrain/export_meshy_decor.py` | Blender export for the six decor families. |
| `art/meshes/decor/*.glb` | The assets. |
| `packages/app/src/main.ts` | Loads the decor GLBs; hands them to the renderer. |
| `packages/render/src/three/ThreeRenderer.ts` | Owns the batched mesh, adds/removes it on terrain rebuild. |

**Correction to the spec, found while planning.** The spec's derived-mapping table is keyed by map *symbol*. `TerrainInput` does not carry symbols — it carries `decor` (the `DECOR_*` values in `terrain/shared.ts`), `cover`, `blocked` and `elevation`. The mapping below is keyed by what a builder can actually read. This is a correction, not a scope change.

---

### Task 1: The decor role vocabulary

**Files:**
- Create: `packages/render/src/three/terrain/decor-role.ts`
- Test: `packages/render/src/three/terrain/decor-role.test.ts`

**Interfaces:**
- Consumes: `readRamp` from `../units/mesh-role`.
- Produces: `DECOR_MESH_ROLES`, `type DecorMeshRole`, `isDecorMeshRole(role: string): role is DecorMeshRole`, `rampForDecorRole(role: string): readonly string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/render/src/three/terrain/decor-role.test.ts
import { describe, it, expect } from 'vitest';
import { DECOR_MESH_ROLES, isDecorMeshRole, rampForDecorRole } from './decor-role';

describe('the decor role vocabulary', () => {
  it('is exactly four roles', () => {
    // Closed per asset class, like every other class in the mesh contract:
    // vehicles have hull/plate/rubber/metal/glass/recess, buildings have
    // wall/roof/trim/..., VFX have core/mid/outer. Decor has these.
    expect([...DECOR_MESH_ROLES].sort()).toEqual(['foliage', 'rock', 'sand', 'trunk']);
  });

  it('gives every role a real multi-step ramp', () => {
    for (const role of DECOR_MESH_ROLES) {
      const ramp = rampForDecorRole(role);
      expect(ramp.length).toBeGreaterThan(1);
      for (const hex of ramp) expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('throws for a role outside the set rather than drawing a default', () => {
    // The contract's rule for every class: a wrong role is a loud failure on
    // both sides, never a silently-wrong colour.
    expect(isDecorMeshRole('hull')).toBe(false);
    expect(() => rampForDecorRole('hull')).toThrow(/decor-role/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/render/src/three/terrain/decor-role.test.ts`
Expected: FAIL — `Cannot find module './decor-role'`.

- [ ] **Step 3: Implement**

```ts
// packages/render/src/three/terrain/decor-role.ts
/**
 * The closed role vocabulary for scattered terrain decor.
 *
 * Decor is its own asset class, so it gets its own set -- the same reason
 * VFX got `core/mid/outer` rather than borrowing the vehicle set. `foliage`
 * and `trunk` are not `hull` and `plate` in any useful sense, and reusing
 * those names would make a decor GLB silently loadable as a vehicle.
 *
 * Unlike vehicles, decor has NO per-object table: a rock is the same grey
 * whichever family placed it, because decor has no faction and no paint job.
 * One role, one ramp, shared by every family.
 */
import { readRamp } from '../units/mesh-role';

export const DECOR_MESH_ROLES = ['foliage', 'trunk', 'rock', 'sand'] as const;

export type DecorMeshRole = (typeof DECOR_MESH_ROLES)[number];

export function isDecorMeshRole(role: string): role is DecorMeshRole {
  return (DECOR_MESH_ROLES as readonly string[]).includes(role);
}

/** `readRamp(band).slice(index)` to the END of the band, the same shading
 *  convention `vehicle-mesh-role.ts` uses for every entry in its own table. */
function sliceFrom(band: string, index: number): readonly string[] {
  return readRamp(band).slice(index);
}

const DECOR_ROLE_PALETTE: Record<DecorMeshRole, readonly string[]> = {
  // Living green, distinct from the olive a KDF uniform uses.
  foliage: sliceFrom('scrub', 0),
  // Woody stems: the dark end of dust, so a trunk reads against its own crown.
  trunk: sliceFrom('dust', 4),
  // Bare stone, the same band the ridge tone already uses.
  rock: sliceFrom('gunmetal', 1),
  // Ground litter: pale, so it reads as sand rather than as shadow.
  sand: sliceFrom('limestone', 3),
};

export function rampForDecorRole(role: string): readonly string[] {
  if (!isDecorMeshRole(role)) {
    throw new Error(
      `decor-role: unknown rl_role "${role}" -- not in the closed decor role vocabulary`
    );
  }
  return DECOR_ROLE_PALETTE[role];
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run packages/render/src/three/terrain/decor-role.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/three/terrain/decor-role.ts packages/render/src/three/terrain/decor-role.test.ts
git commit -m "feat(decor): the closed decor role vocabulary and its ramp table"
```

---

### Task 2: The derived placement rule

**Files:**
- Create: `packages/render/src/three/terrain/decor-place.ts`
- Test: `packages/render/src/three/terrain/decor-place.test.ts`

**Interfaces:**
- Consumes: `TerrainInput` from `./types`; `DECOR_GROVE`, `DECOR_KNOLL`, `DECOR_RIDGE`, `DECOR_ROAD`, `levelAt` from `./shared`; `tileHash` from `../../tile-hash`.
- Produces:
  ```ts
  export type DecorFamily = 'grass' | 'sand' | 'bush' | 'tree' | 'rock' | 'slab';
  export interface DecorPlacement {
    readonly family: DecorFamily;
    readonly variant: number;   // 0..VARIANTS_PER_FAMILY-1
    readonly x: number;         // world X
    readonly z: number;         // world Z
    readonly y: number;         // world Y, the tile's own top
    readonly yawTurns: number;  // 0..1
    readonly scale: number;     // ~0.8..1.2
  }
  export const VARIANTS_PER_FAMILY = 3;
  export function decorPlacements(input: TerrainInput): DecorPlacement[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
// packages/render/src/three/terrain/decor-place.test.ts
import { describe, it, expect } from 'vitest';
import { decorPlacements, VARIANTS_PER_FAMILY } from './decor-place';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';

/** A w*h map, everything open ground, with per-tile overrides applied after. */
function input(w: number, h: number, edit?: (i: TerrainInput) => void): TerrainInput {
  const t: TerrainInput = {
    width: w,
    height: h,
    decor: new Uint8Array(w * h),
    elevation: null,
    blocked: new Uint8Array(w * h),
    cover: new Uint8Array(w * h),
  };
  edit?.(t);
  return t;
}

describe('decorPlacements', () => {
  it('is deterministic: the same map twice gives an identical list', () => {
    // Appearance determinism is the whole reason this uses tileHash and not
    // Math.random -- two runs that merely both look scattered would make every
    // screenshot comparison noise.
    const a = decorPlacements(input(12, 12));
    const b = decorPlacements(input(12, 12));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('never places anything on a blocked tile', () => {
    // A rock inside a building is a bug report, and the building box is drawn
    // over the same ground.
    const out = decorPlacements(
      input(8, 8, (t) => t.blocked.fill(1))
    );
    expect(out).toEqual([]);
  });

  it('never places anything on a road', () => {
    const out = decorPlacements(
      input(8, 8, (t) => t.decor!.fill(DECOR_ROAD))
    );
    expect(out).toEqual([]);
  });

  it('puts trees on grove tiles, rocks on knolls, slabs on ridges', () => {
    const families = (decorValue: number): Set<string> => {
      const out = decorPlacements(input(10, 10, (t) => t.decor!.fill(decorValue)));
      return new Set(out.map((p) => p.family));
    };
    expect(families(DECOR_GROVE)).toEqual(new Set(['tree']));
    expect(families(DECOR_KNOLL)).toEqual(new Set(['rock']));
    expect(families(DECOR_RIDGE)).toEqual(new Set(['slab']));
  });

  it('puts bushes on cover tiles and gets denser with the cover level', () => {
    const count = (cover: number): number =>
      decorPlacements(input(16, 16, (t) => t.cover.fill(cover))).length;
    expect(count(3)).toBeGreaterThan(count(1));
  });

  it('keeps every variant index inside the family range', () => {
    for (const p of decorPlacements(input(20, 20))) {
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(VARIANTS_PER_FAMILY);
    }
  });

  it('sits a placement on its own tile top, not at elevation zero', () => {
    // Same property scatter.test.ts already proves for flat marks: a mark on
    // raised ground must rise with it or it sinks into the hill.
    const flat = decorPlacements(input(6, 6));
    const raised = decorPlacements(
      input(6, 6, (t) => {
        t.elevation = new Uint8Array(36).fill(4);
      })
    );
    expect(raised[0].y).toBeGreaterThan(flat[0].y);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/render/src/three/terrain/decor-place.test.ts`
Expected: FAIL — `Cannot find module './decor-place'`.

- [ ] **Step 3: Implement**

```ts
// packages/render/src/three/terrain/decor-place.ts
/**
 * Where scattered decor goes, as plain data.
 *
 * Headless on purpose -- no three.js -- so the placement rule is unit-tested
 * directly rather than inferred from a render, exactly like `buildScatter`
 * and `buildGroves` already are.
 *
 * Derived from what a builder can actually read. NOTE: the design doc's table
 * is keyed by map SYMBOL; `TerrainInput` carries no symbols, only the decoded
 * `decor`/`cover`/`blocked`/`elevation` layers, so the rule is keyed by those.
 *
 * Randomness is `tileHash(x, y)`, the same deterministic hash the Pixi
 * backend's ground grain uses -- two hashes that merely both looked random
 * would scatter differently per backend and make every comparison noise.
 * Several independent streams come from offsetting the coordinates, which is
 * cheaper than threading a seed and just as stable.
 */
import { tileHash } from '../../tile-hash';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD, WORLD_PER_LEVEL } from './shared';
import type { TerrainInput } from './types';

export type DecorFamily = 'grass' | 'sand' | 'bush' | 'tree' | 'rock' | 'slab';

export interface DecorPlacement {
  readonly family: DecorFamily;
  readonly variant: number;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly yawTurns: number;
  readonly scale: number;
}

export const VARIANTS_PER_FAMILY = 3;

/** How often a qualifying tile actually gets an object. Cover tiles scale
 *  with their level, so a cover-3 thicket reads denser than a cover-1 verge. */
const DENSITY: Record<DecorFamily, number> = {
  grass: 0.34,
  sand: 0.18,
  bush: 0.3,
  tree: 1.0,
  rock: 0.75,
  slab: 0.6,
};

/** Which family this tile offers, or null for "nothing grows here". */
function familyFor(decor: number, cover: number, roll: number): DecorFamily | null {
  if (decor === DECOR_ROAD) return null;
  if (decor === DECOR_GROVE) return 'tree';
  if (decor === DECOR_KNOLL) return 'rock';
  if (decor === DECOR_RIDGE) return 'slab';
  if (cover > 0) return 'bush';
  return roll < 0.6 ? 'grass' : 'sand';
}

export function decorPlacements(input: TerrainInput): DecorPlacement[] {
  const { width, height, blocked, cover, decor, elevation } = input;
  const out: DecorPlacement[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      if (blocked[t] !== 0) continue;
      const c = cover[t];
      const d = decor ? decor[t] : 0;
      const family = familyFor(d, c, tileHash(x + 977, y + 311));
      if (family === null) continue;

      // Cover level thickens a bush tile; every other family keeps its base
      // density. Clamped so a cover-3 tile cannot exceed 1.
      const density =
        family === 'bush' ? Math.min(1, DENSITY.bush * (0.5 + 0.5 * c)) : DENSITY[family];
      if (tileHash(x, y) >= density) continue;

      const jx = tileHash(x + 101, y + 7) - 0.5;
      const jy = tileHash(x + 13, y + 401) - 0.5;
      const level = elevation ? elevation[t] : 0;
      out.push({
        family,
        variant: Math.floor(tileHash(x + 53, y + 991) * VARIANTS_PER_FAMILY),
        // WORLD space, not screen. `MeshData`'s own doc: "game tile (x, y) ->
        // (x, height, y)". `isoX`/`isoY` are the projection the CAMERA
        // applies -- baking them in here would project twice. Jitter is
        // therefore in tile units (+/-0.3 of a tile).
        x: x + 0.5 + jx * 0.6,
        z: y + 0.5 + jy * 0.6,
        y: level * WORLD_PER_LEVEL,
        yawTurns: tileHash(x + 617, y + 29),
        scale: 0.8 + tileHash(x + 71, y + 137) * 0.4,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run packages/render/src/three/terrain/decor-place.test.ts`
Expected: PASS, 7 tests.

If the elevation test fails because `isoX`/`isoY` already fold elevation in, read `packages/render/src/project.ts` and use the same convention `buildScatter` uses for a raised mark (`levelAt` + `WORLD_PER_LEVEL`) rather than changing the assertion.

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/three/terrain/decor-place.ts packages/render/src/three/terrain/decor-place.test.ts
git commit -m "feat(decor): the derived placement rule, headless and deterministic"
```

---

### Task 3: Authored overrides — DEFERRED, not part of this plan

**Status: deferred to its own issue on 2026-09-01, by the project lead's decision.**

T1-C ships **derived-only**: scatter comes from the terrain symbols and the
per-tile hash, with no authored grid, no `decor_overrides` schema key, no
parser, and no `TerrainInput.decorOverride` field. `decor-place.ts` stays as
Task 2 shipped it.

The reasoning is worth keeping: an override path is only worth its two
placement paths — and the debugging cost of "which one put that rock there" —
if the derived rule turns out to need correcting. Nobody has seen the derived
scatter on a real map yet, so that is a guess. Decide it with evidence.

Everything the deferred task would have needed is written up in the issue,
including the exact `elevation` parser at `packages/data/src/map.ts:217-238`
that it should mirror, and the ruling that its JSON key must be
`decor_overrides` rather than `decor` (the latter collides with the
symbol-derived `ParsedMap.decor`).

---

### Task 4: The decor assets

**ASSETS DELIVERED 2026-09-01.** Sources are flat in
`/Users/ilpinto/dev/roaring-lions/art/blend/terrain object` (569 MB), except the
pre-existing `olive tree/` and `stone/` subdirectories. The family mapping is NOT
derivable from the filenames alone:

| family | source prefix | variants | note |
|---|---|---|---|
| grass | `Meshy_AI_foliage_grass_tuft_va` | **4** | one more than `VARIANTS_PER_FAMILY` (3) |
| sand | `Meshy_AI_sand_gravel_patch_var` | 3 | |
| bush | `Meshy_AI_shrub_desert_varN` | 3 | **each has a `_spl_..._part-segmentation` companion** |
| rock | `Meshy_AI_rock_cluster_varN` | 3 | |
| slab | `Meshy_AI_rock_outcrop_varN` | 3 | var3 is duplicated as `... (1).blend` |
| tree | `olive tree/` | **2** | pre-existing, one short of 3 |

**`Meshy_AI_rock_boulder_varN` (3 files) is NOT part of this task.** Those are the large
vehicle-blocking boulder for subsystem B (per-domain passability), a separate plan. B has
no `b` map symbol yet, so a boulder mesh would have nothing to draw on.

The bush part-segmentation files are load-bearing: the decor vocabulary needs `trunk` AND
`foliage` on a shrub, and a single-object export gives one flat colour — the exact
mechanism behind the "enemy building is missing details and colors" report. The
segmentation pass is how the split is obtained.

**Two decisions this task must settle, neither guessable:**
- grass ships 4 variants against `VARIANTS_PER_FAMILY = 3`. Use three, or raise the
  constant — but the constant feeds the placement hash, so raising it changes every
  existing placement's variant on every map.
- tree ships 2, not 3. Author a third, accept two (the loader already drops a missing key
  silently), or map variant 2 onto one of the first two.


**Files:**
- Create: `tools/terrain/export_meshy_decor.py`
- Create: `art/meshes/decor/{grass,sand,bush,tree,rock,slab}_{0,1,2}.glb`
- Modify: `tools/validate_mesh_assets.py` — recognise the decor class

**Interfaces:**
- Consumes: nothing in code.
- Produces: 18 GLBs at `art/meshes/decor/<family>_<variant>.glb`, each with zero materials and every mesh node carrying an `extras.rl_role` from `DECOR_MESH_ROLES`.

- [ ] **Step 1: Write the asset gate check first**

Add to `tools/validate_mesh_assets.py` a decor branch that, for every
`art/meshes/decor/*.glb`, asserts zero materials and every `rl_role` in
`{foliage, trunk, rock, sand}`, failing loudly otherwise. Run
`pnpm validate:meshes` and confirm it passes with **no** decor files present
(an empty class is not an error).

- [ ] **Step 2: Export the assets**

Sources are the supplied `art/blend/terrain object/olive tree` and `.../stone`
plus the Meshy assets authored from the prompts in
`docs/superpowers/specs/2026-09-01-terrain-t1-design.md`. Follow
`tools/buildings/export_meshy_camp.py` as the closest precedent: it produces a
multi-role, zero-material GLB from a Meshy source.

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python tools/terrain/export_meshy_decor.py
```

- [ ] **Step 3: Verify the contract mechanically, not by looking**

```bash
python3 - <<'PY'
import json, struct, glob
for fn in sorted(glob.glob('art/meshes/decor/*.glb')):
    f=open(fn,'rb'); f.read(12)
    ln,_=struct.unpack('<II', f.read(8)); j=json.loads(f.read(ln))
    roles=sorted({(n.get('extras') or {}).get('rl_role') for n in j.get('nodes',[])
                  if (n.get('extras') or {}).get('rl_role')})
    bad=[r for r in roles if r not in {'foliage','trunk','rock','sand'}]
    print(fn, 'materials', len(j.get('materials',[])), 'roles', roles, 'BAD' if bad or j.get('materials') else 'ok')
PY
```
Expected: every line `materials 0`, roles inside the set, `ok`.

- [ ] **Step 4: Draco-compress and measure**

Compress each decor GLB, then record the total added bytes. The budget line
from the spec is that the existing set is 25.3 MiB; state the new total in the
commit message.

- [ ] **Step 5: Commit**

```bash
git add tools/terrain/export_meshy_decor.py tools/validate_mesh_assets.py art/meshes/decor
git commit -m "feat(decor): six decor families, three variants each, contract-clean"
```

---

### Task 5: The batched mesh

**Files:**
- Create: `packages/render/src/three/terrain/decor-mesh.ts`

**Interfaces:**
- Consumes: `DecorPlacement`, `DecorFamily`, `VARIANTS_PER_FAMILY` from `./decor-place`; `rampForDecorRole` from `./decor-role`; `toonRampMaterial` from `../palette-material`.
- Produces:
  ```ts
  export interface DecorGeometrySet {
    /** Keyed `${family}_${variant}`, each a role-tagged geometry list. */
    readonly parts: ReadonlyMap<string, readonly { role: string; geometry: THREE.BufferGeometry }[]>;
  }
  export function buildDecorMesh(
    placements: readonly DecorPlacement[],
    set: DecorGeometrySet
  ): THREE.Group;
  export function disposeDecorMesh(group: THREE.Group): void;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// packages/render/src/three/terrain/decor-mesh.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildDecorMesh, disposeDecorMesh } from './decor-mesh';
import type { DecorPlacement } from './decor-place';

function geo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3));
  g.setIndex([0, 1, 2]);
  return g;
}
const SET = { parts: new Map([['rock_0', [{ role: 'rock', geometry: geo() }]]]) };
const P = (n: number): DecorPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    family: 'rock' as const, variant: 0, x: i, z: i, y: 0, yawTurns: 0, scale: 1,
  }));

describe('buildDecorMesh', () => {
  it('draws N objects of one family in a SINGLE batched draw', () => {
    // The whole reason this is BatchedMesh and not six instancers: draw-call
    // submission is the measured bottleneck on this project.
    const g = buildDecorMesh(P(50), SET);
    // `isBatchedMesh`, NOT `.type` — three.js r170 leaves BatchedMesh's `type`
    // as the inherited "Mesh", so a `.type === 'BatchedMesh'` filter finds
    // nothing and fails against a CORRECT implementation. Verified against the
    // installed build, not assumed.
    const batches = g.children.filter((c) => (c as THREE.BatchedMesh).isBatchedMesh === true);
    expect(batches.length).toBe(1);
  });

  it('places nothing, and adds no child, for an empty placement list', () => {
    expect(buildDecorMesh([], SET).children.length).toBe(0);
  });

  it('skips a placement whose geometry was never loaded, without throwing', () => {
    // A map may reference a family whose GLB failed to fetch. Losing a bush is
    // acceptable; a black screen is not.
    const missing = [{ family: 'tree' as const, variant: 2, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 }];
    expect(() => buildDecorMesh(missing, SET)).not.toThrow();
  });

  it('disposes every geometry and material it created', () => {
    const g = buildDecorMesh(P(4), SET);
    disposeDecorMesh(g);
    expect(g.children.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/render/src/three/terrain/decor-mesh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

**The code that shipped is NOT the code this plan originally contained, and the
original had two defects. Read `packages/render/src/three/terrain/decor-mesh.ts`
rather than re-running the block that used to live here.**

What changed, and why re-introducing either would be a regression:

- **`geomId` was keyed by `${family}_${variant}` alone**, inside the per-role loop. A
  family holding two parts of the SAME role -- a rock cluster built from several rock
  sub-meshes -- had the second `addGeometry` overwrite the first's id. The geometry was
  still counted in the batch budget, so it was uploaded to the GPU and never drawn,
  silently. The shipped code gives every part its own id and adds an instance per part.
- **`maxInstances = live.length * 4`** was an underived magic number. Once one placement
  can contribute several instances the bound genuinely changes -- and `BatchedMesh` is
  allocated up front and cannot grow. Fixing the collision alone made the batch throw
  `BatchedMesh: Maximum item count reached` (8 slots for 10 instances); that crash is the
  evidence. The shipped code derives the bound from the maximum same-role part count.

Everything else -- one batch per ROLE not per family, the two-pass shape, a missing
geometry skipped rather than thrown -- is as designed and as described above.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run packages/render/src/three/terrain/decor-mesh.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/three/terrain/decor-mesh.ts packages/render/src/three/terrain/decor-mesh.test.ts
git commit -m "feat(decor): one BatchedMesh per decor role"
```

---

### Task 6: Wire it in, and prove it draws

**FOUR SEAM PROBLEMS, found by the final whole-branch review. Read these before writing
the loader — each one bites on day one.**

1. **`geometry` alone is not enough.** `mesh.geometry` is in the mesh's LOCAL space; the
   GLB node hierarchy's transforms are lost, so a multi-part decor GLB — exactly the
   rock-cluster case — collapses every part onto the origin. Bake it:
   `mesh.updateWorldMatrix(true, false)` then
   `geometry.clone().applyMatrix4(mesh.matrixWorld)`.
2. **`MESH_SCALE` is `1/3`** (`mesh-anim.ts`; Blender builds at 3 units per tile). Every
   unit and building loader applies `root.scale.setScalar(MESH_SCALE)`. `buildDecorMesh`
   composes its matrix from `p.scale` (0.8–1.2) alone, so decor authored to the mesh
   contract will be **3x oversized** unless the loader bakes the scale in. Nothing in
   Tasks 1, 2 or 5 mentions this.
   Once the loader clones geometry it OWNS those clones and needs a
   `disposeDecorGeometrySet`; `disposeDecorMesh` deliberately does not dispose them.
3. **No materials handle.** `BuildingMeshTemplate` exposes `readonly materials` precisely
   so `ThreeRenderer` can register them with `flashLights`. `buildDecorMesh` returns a
   bare `THREE.Group` and creates its `ShaderMaterial`s privately, so decor is invisible
   to the muzzle-flash system. Return `{ group, materials }` or mirror the template shape.
4. **`composeTerrain` does not expose its `TerrainInput`.** It is built privately inside
   `ThreeRenderer.rebuildTerrain`, so the snippet below calling
   `buildDecorMesh(decorPlacements(input), ...)` has no `input` in scope. Either
   reconstruct it or give `composeTerrain` a decor layer — the latter is the coherent
   choice.

Also worth pricing, not redesigning: `rebuildTerrain` already costs 114–179 ms and fires
on structure destruction. `buildDecorMesh` disposes and recreates every batch and
re-uploads every geometry each time — a full GPU re-upload for an event that changes a
handful of tiles.


**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts`
- Modify: `packages/app/src/main.ts`

**Interfaces:**
- Consumes: Tasks 2 and 5. (Task 3 is deferred -- see #138; there is no override path.)
- Produces: `ThreeRenderer.loadDecorMeshes(urls: ReadonlyMap<string, string>): Promise<void>`, and a decor group rebuilt inside `rebuildTerrain`.

- [ ] **Step 1: Load the assets in `main.ts`**

Inside the `if (wantMesh) {` block, beside `MESH_BUILDINGS`:

```ts
      // Decor: six families, three variants each. Unlike units and buildings
      // these are keyed by `<family>_<variant>`, not by a unit type id --
      // nothing in the sim has a "bush", which is the point: decor is
      // presentation with no simulation counterpart at all.
      const DECOR_FAMILY_IDS = ['grass', 'sand', 'bush', 'tree', 'rock', 'slab'] as const;
      const decorUrls = new Map<string, string>();
      for (const fam of DECOR_FAMILY_IDS) {
        for (let v = 0; v < 3; v++) {
          const id = `${fam}_${v}`;
          decorUrls.set(id, new URL(`../../../art/meshes/decor/${id}.glb`, import.meta.url).href);
        }
      }
      await three.loadDecorMeshes(decorUrls);
```

- [ ] **Step 2: Build the group in `rebuildTerrain`**

Add the field and loader to `ThreeRenderer`:

```ts
  private decorSet: DecorGeometrySet = { parts: new Map() };
  private decorGroup: THREE.Group | null = null;

  /** Loads every decor GLB and keeps its role-tagged geometries. Mirrors
   *  `loadBuildingMesh`: the GLB carries no materials, so only geometry and
   *  `rl_role` survive the load. */
  async loadDecorMeshes(urls: ReadonlyMap<string, string>): Promise<void> {
    const parts = new Map<string, { role: string; geometry: THREE.BufferGeometry }[]>();
    await Promise.all(
      [...urls].map(async ([id, url]) => {
        const gltf = await new GLTFLoader().loadAsync(url);
        const list: { role: string; geometry: THREE.BufferGeometry }[] = [];
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const role = (mesh.userData as { rl_role?: string }).rl_role;
          // Throws by design for an unknown role -- never a default colour.
          if (role !== undefined) {
            rampForDecorRole(role);
            list.push({ role, geometry: mesh.geometry });
          }
        });
        if (list.length > 0) parts.set(id, list);
      })
    );
    this.decorSet = { parts };
  }
```

then, where `this.scatterMesh` is created in `rebuildTerrain`:

```ts
    if (this.decorGroup !== null) {
      this.scene.remove(this.decorGroup);
      disposeDecorMesh(this.decorGroup);
    }
    this.decorGroup = buildDecorMesh(decorPlacements(input), this.decorSet);
    this.scene.add(this.decorGroup);
```

- [ ] **Step 3: Run every gate**

```bash
npx vitest run && npx tsc --noEmit && pnpm lint && pnpm validate:meshes && pnpm validate:data && pnpm validate:ui
npx tsx tools/src/backtest/playtest.ts >/dev/null; echo "LADDER EXIT=$?"
```
Expected: all pass; the ladder exits 0. Decor is render-only, so the
determinism hash must NOT move — if it does, something reached the sim and
that is a stop-and-fix.

- [ ] **Step 4: Verify in the browser, not from the load list**

Load `http://localhost:5173/?mission=beit_sahwan_2_foothold&fresh` (no flags —
meshes are the default). Do NOT restart or kill the user's dev server. Then in
the console:

```js
const R = window.__lions.renderer;
const g = R.scene.children.find((c) => c.name === 'decor');
[...g.children].map((c) => [c.type, c.count ?? c.instanceCount]);
```
Expected: one or more `BatchedMesh` entries with non-zero instance counts.
Take a screenshot and confirm rocks and bushes are visible on open ground.

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/three/ThreeRenderer.ts packages/app/src/main.ts
git commit -m "feat(decor): draw scattered decor meshes by default"
```

---

### Task 7: Retire the procedural canopy

**Retiring `buildGroves` will THIN the canopy, and the interface cannot currently express
what it replaces.** `grove.ts` places **1 or 2** trees per grove tile (`twin =
tileHash(x*3, y*7) > 0.62`, the second at 0.68 scale). `decor-place.ts` sets
`tree: 1.0` — exactly one, always — and pushes at most ONE `DecorPlacement` per tile.
Wadi Halam goes from ~315 trees to 228 and loses the twin's size variation.

Decide deliberately: accept the thinner canopy, or let `decorPlacements` emit more than
one placement per tile. Do not discover it in a screenshot.


**Files:**
- Modify: `packages/render/src/three/terrain/grove.ts`, `ThreeRenderer.ts`

**Interfaces:** none new.

- [ ] **Step 1: Confirm the replacement draws first**

Only after Task 6's browser check shows tree meshes on grove tiles. Art
existing and art drawing are different things, and this branch has confused
them repeatedly — each retirement is its own verified step.

- [ ] **Step 2: Stop calling `buildGroves`**

Keep `grove.ts` and its tests in the tree for one release, as
`ASSET_PROVENANCE.md` does for superseded sprites -- delete the CALL, not the
code, so the retirement is one line to revert.

In `composeTerrain`, drop the groves layer from the returned object:

```ts
  const ground = buildGround(input, tones, background);
  const scatter = buildScatter(input, tones, background);
  // buildGroves is retired: grove tiles now get real tree meshes from
  // `decor-place.ts`'s `tree` family, drawn in the decor batch. The builder
  // and its tests stay in the tree for one release.
  const groves: MeshData = { positions: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) };
```

`ComposedTerrain.groves` keeps its field rather than being removed, so
`ThreeRenderer` and `terrain-parity.test.ts` need no signature change and the
retirement stays a one-line revert. An empty `MeshData` produces an empty
geometry, which `toGeometry` already handles -- `buildScatter` returns one for
a map with no marks.

- [ ] **Step 3: Run the gates and re-check the browser**

Same commands as Task 6 Step 3 and Step 4. Grove tiles must still show trees —
mesh ones now.

- [ ] **Step 4: Commit**

```bash
git add packages/render/src/three/terrain/grove.ts packages/render/src/three/ThreeRenderer.ts
git commit -m "refactor(decor): mesh trees replace the procedural canopy"
```
