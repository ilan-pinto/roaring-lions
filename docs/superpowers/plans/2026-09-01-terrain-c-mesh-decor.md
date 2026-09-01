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
| `packages/render/src/three/terrain/decor-place.ts` | `decorPlacements(input)` — headless, no three.js. The derived rule plus overrides. |
| `packages/render/src/three/terrain/decor-place.test.ts` | Determinism, per-family mapping, override precedence. |
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

### Task 3: Authored overrides

**Files:**
- Modify: `data/schemas/map.schema.json`
- Modify: `packages/data/src/map.ts` — parse the grid, expose it on `ParsedMap`
- Modify: `packages/render/src/three/terrain/types.ts` — `TerrainInput.decorOverride`
- Modify: `packages/render/src/three/terrain/decor-place.ts`
- Test: `packages/data/src/map.test.ts`, `packages/render/src/three/terrain/decor-place.test.ts`

**Interfaces:**
- Consumes: Task 2's `decorPlacements` and `DecorFamily`.
- Produces: `TerrainInput.decorOverride: Uint8Array | null`, and `ParsedMap.decorOverride: Uint8Array | null`. Encoding: `0` = derive, `1..6` = force family, in `DECOR_FAMILIES` order (`['grass','sand','bush','tree','rock','slab']`), `7` = force nothing.

- [ ] **Step 1: Write the failing test**

First extend the `input` helper from Task 2 -- Task 3 makes `decorOverride` a
required field on `TerrainInput`, so the helper must set it or nothing in this
file compiles:

```ts
function input(w: number, h: number, edit?: (i: TerrainInput) => void): TerrainInput {
  const t: TerrainInput = {
    width: w,
    height: h,
    decor: new Uint8Array(w * h),
    elevation: null,
    blocked: new Uint8Array(w * h),
    cover: new Uint8Array(w * h),
    decorOverride: null,
  };
  edit?.(t);
  return t;
}
```

```ts
// append to packages/render/src/three/terrain/decor-place.test.ts
import { DECOR_FAMILIES, OVERRIDE_NONE } from './decor-place';

describe('authored overrides', () => {
  it('forces the named family on the tile that names one', () => {
    // Asserted on a map that derives NO trees, so a tree can only have come
    // from the override. `cover: 1` derives bushes everywhere.
    const w = 8;
    const t = input(w, w, (i) => i.cover.fill(1));
    t.decorOverride = new Uint8Array(w * w);
    t.decorOverride[3 * w + 3] = DECOR_FAMILIES.indexOf('tree') + 1;
    const trees = decorPlacements(t).filter((p) => p.family === 'tree');
    expect(trees.length).toBe(1);
  });

  it('places an authored object even where the density roll would have skipped it', () => {
    // An authored placement is a decision, not a probability. Every tile is
    // forced, so every tile must produce exactly one object.
    const w = 6;
    const t = input(w, w);
    t.decorOverride = new Uint8Array(w * w).fill(DECOR_FAMILIES.indexOf('rock') + 1);
    expect(decorPlacements(t).length).toBe(w * w);
  });

  it('suppresses decor entirely where the author asked for none', () => {
    const w = 6;
    const t = input(w, w);
    t.decorOverride = new Uint8Array(w * w).fill(OVERRIDE_NONE);
    expect(decorPlacements(t)).toEqual([]);
  });

  it('derives normally on tiles with no override', () => {
    const w = 8;
    const bare = decorPlacements(input(w, w));
    const t = input(w, w);
    t.decorOverride = new Uint8Array(w * w);
    expect(decorPlacements(t)).toEqual(bare);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/render/src/three/terrain/decor-place.test.ts`
Expected: FAIL — `DECOR_FAMILIES` and `OVERRIDE_NONE` are not exported.

- [ ] **Step 3: Implement**

In `decor-place.ts`, export the family order and the sentinel, add the field, and consult it first:

```ts
export const DECOR_FAMILIES: readonly DecorFamily[] = [
  'grass', 'sand', 'bush', 'tree', 'rock', 'slab',
];
/** Author says "nothing here" -- distinct from 0, which means "derive". */
export const OVERRIDE_NONE = 7;
```

Inside the tile loop, immediately after the `blocked` check:

```ts
      const ov = input.decorOverride ? input.decorOverride[t] : 0;
      if (ov === OVERRIDE_NONE) continue;
      const forced = ov > 0 ? DECOR_FAMILIES[ov - 1] : null;
```

then use `forced ?? familyFor(...)` and skip the density roll when `forced !== null`
(an authored placement is a decision, not a probability).

In `types.ts`, add to `TerrainInput`:

```ts
  /** Per tile: 0 derive, 1..6 force a DECOR_FAMILIES entry, 7 force nothing.
   *  Null when the map authored none, which is every map today. */
  decorOverride: Uint8Array | null;
```

In `map.ts`, parse an optional `decor` array of strings the same way `elevation`
is parsed (same dimension check, one character per tile), mapping
`.`=0 `g`=1 `s`=2 `b`=3 `t`=4 `r`=5 `k`=6 `-`=7 and throwing on any other
character with the tile coordinates in the message.

In `map.schema.json`, add `decor` beside `elevation` with the same
`minItems`/`maxItems` shape and a description naming the characters.

- [ ] **Step 4: Run every affected gate**

```bash
npx vitest run packages/render/src/three/terrain packages/data
pnpm validate:data
npx tsc --noEmit
```
Expected: all pass. `TerrainInput` gained a required field, so every construction
site must be updated — the compiler lists them.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/map.schema.json packages/data/src/map.ts packages/data/src/map.test.ts \
  packages/render/src/three/terrain/types.ts packages/render/src/three/terrain/decor-place.ts \
  packages/render/src/three/terrain/decor-place.test.ts
git commit -m "feat(decor): an optional authored decor grid overriding the derived rule"
```

---

### Task 4: The decor assets

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

```ts
// packages/render/src/three/terrain/decor-mesh.ts
/**
 * Scattered decor as batched geometry.
 *
 * ONE BatchedMesh PER ROLE, not per family. Every family's `rock` parts share
 * one ramp and therefore one material, so a rock cluster, a boulder and a slab
 * all land in the same batch -- which is the whole point: draw-call submission
 * is this project's measured bottleneck, with the GPU otherwise idle. Six
 * families across four roles is four draws, not eighteen.
 */
import * as THREE from 'three';
import { toonRampMaterial } from '../palette-material';
import { rampForDecorRole } from './decor-role';
import type { DecorPlacement } from './decor-place';

export interface DecorGeometrySet {
  readonly parts: ReadonlyMap<string, readonly { role: string; geometry: THREE.BufferGeometry }[]>;
}

const TAU = Math.PI * 2;

export function buildDecorMesh(
  placements: readonly DecorPlacement[],
  set: DecorGeometrySet
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'decor';

  // Pass 1: which parts are actually referenced, and how big each role's
  // batch must be. BatchedMesh is sized up front and cannot grow.
  const used = new Map<string, { role: string; geometry: THREE.BufferGeometry }[]>();
  const live: DecorPlacement[] = [];
  for (const p of placements) {
    const key = `${p.family}_${p.variant}`;
    const parts = set.parts.get(key);
    // A family whose GLB failed to fetch loses its objects. Losing a bush is
    // acceptable; throwing here would lose the whole frame.
    if (!parts) continue;
    used.set(key, [...parts]);
    live.push(p);
  }
  if (live.length === 0) return group;

  const byRole = new Map<string, { verts: number; idx: number; parts: Set<string> }>();
  for (const [key, parts] of used) {
    for (const part of parts) {
      const acc = byRole.get(part.role) ?? { verts: 0, idx: 0, parts: new Set<string>() };
      const pos = part.geometry.getAttribute('position');
      acc.verts += pos.count;
      acc.idx += part.geometry.getIndex()?.count ?? pos.count;
      acc.parts.add(key);
      byRole.set(part.role, acc);
    }
  }

  // Pass 2: one batch per role. Instance count is bounded by (placements x
  // parts-per-placement), so size it from the worst case.
  const maxInstances = live.length * 4;
  for (const [role, acc] of byRole) {
    const mesh = new THREE.BatchedMesh(
      maxInstances,
      acc.verts,
      acc.idx,
      toonRampMaterial(rampForDecorRole(role))
    );
    // geometryId per "${family}_${variant}::role", so one addGeometry per
    // distinct part rather than one per placement.
    const geomId = new Map<string, number>();
    for (const key of acc.parts) {
      for (const part of used.get(key) ?? []) {
        if (part.role !== role) continue;
        geomId.set(key, mesh.addGeometry(part.geometry));
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    let added = 0;
    for (const p of live) {
      const id = geomId.get(`${p.family}_${p.variant}`);
      if (id === undefined) continue;
      const inst = mesh.addInstance(id);
      q.setFromAxisAngle(axis, p.yawTurns * TAU);
      scale.set(p.scale, p.scale, p.scale);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, scale);
      mesh.setMatrixAt(inst, m);
      added++;
    }
    if (added === 0) {
      mesh.material.dispose();
      mesh.dispose();
      continue;
    }
    group.add(mesh);
  }
  return group;
}

export function disposeDecorMesh(group: THREE.Group): void {
  for (const child of [...group.children]) {
    const mesh = child as THREE.BatchedMesh;
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
    group.remove(child);
  }
}
```

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

**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts`
- Modify: `packages/app/src/main.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
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
