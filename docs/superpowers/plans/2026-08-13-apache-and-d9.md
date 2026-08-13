# Apache gunship and D9 dozer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two KDF units — `heli_peten` (AH-64 Peten assault helicopter) and `dozer_d9` (D9 Dov armoured bulldozer) — as data, art and one schema-plus-sim change, per `docs/superpowers/specs/2026-08-13-apache-and-d9-design.md`.

**Architecture:** The Apache rides the existing `mobility.domain: "air"` rule and needs no new sim concept, only a `gunship` role-enum entry. The D9 needs the one real engine change: `demolition_time_s`, because `stepDemolition` counts every demolisher against a single global `DEMO_TICKS`. Both sheets render on `render_vehicle.py`'s existing `VehicleSpec`/`render_clip` machinery from `.blend` sources authored by scripts that already exist in the working tree.

**Tech Stack:** TypeScript strict (pnpm workspaces), Q16.16 fixed-point in `@lions/sim`, Blender 5.2 headless at `/Applications/Blender.app/Contents/MacOS/Blender`, Python for the render rig and gates, vitest for tests.

## Global Constraints

- Branch: `feat/apache-and-d9`, already created off `feat/enemy-raider-units` — the Apache depends on `domain: "air"`, which exists only in that unmerged commit. Do not branch off `main`.
- **The working tree is shared with concurrent sessions.** Stage explicit paths only, never `git add -A` or `-a`. After every commit, confirm the `[feat/apache-and-d9 <hash>]` prefix in the output; if it names another branch, stop and relocate the commit before doing anything else.
- **`pnpm test:determinism` must end 4/4 with the golden hash unmoved** for every task in this plan. No task here intends a behaviour change to an existing unit.
- `data/schemas/unit.schema.json` is `additionalProperties: false`. Any new key must be declared or `pnpm validate:data` rejects the file.
- `@lions/sim` bans `Math.*` and `Date.*`, enforced by lint. Seconds→ticks conversion uses `fx.toInt(fx.mul(fx.from(s), fx.fromInt(TICKS_PER_SECOND)))`, the form `apsReloadTicks` already uses.
- Palette is locked (`data/palette.json`). No new entries. Every Cycles render is off-palette until `python3 tools/quantize_sprites.py --sprites assets/sprites/<SHEET>` runs, which must happen before any gate check.
- Art gate: pairwise silhouette IoU < 0.88 at 64 px compared on `idle_f00_000.png` only, `MIN_FILL >= 6%`, binary alpha, no edge-touching.
- Sheet ids exactly: `heli_peten` → `APACHE_HULL`, `dozer_d9` → `D9_HULL`. Neither has a turret layer.
- Both units are `faction: "kdf"` — friendly, player-built, in `data/units/kdf/`.
- Blender binary: `/Applications/Blender.app/Contents/MacOS/Blender`. The live MCP session holds an unsaved `marj_shelf` scene in `Scene` belonging to another workstream; never `bpy.ops.wm.open_mainfile` in that session, and never modify or overwrite that scene.

## File Structure

**Already written and uncommitted** (Task 5 commits them, after adding wreck geometry):
- `tools/vehicles/author_d9.py` — builds `art/src/vehicles/d9.blend` from `kit.py` primitives, 26 objects.
- `tools/vehicles/author_apache.py` — builds `art/src/aircraft/apache.blend`, 44 objects, with local `taper`/`tube`/`rotor` helpers because `kit.py` is a ground-vehicle kit.
- `tools/vehicles/preview_d9.py`, `tools/vehicles/preview_apache.py` — 4-facing mock renders on the locked rig.

**To create:**
- `packages/sim/src/demolition.test.ts` — the per-unit demolition timer.
- `data/units/kdf/dozer_d9.json`, `data/units/kdf/heli_peten.json`.
- `tools/render_d9.py`, `tools/render_apache.py` — sheet renderers on `VehicleSpec`.

**To modify:**
- `data/schemas/unit.schema.json` — `demolition_time_s`, `gunship` role.
- `packages/sim/src/structures.ts` — export `DEMO_SECONDS`.
- `packages/sim/src/sim.ts` — `UnitType.demolitionTicks`, and two reads at `:957` and `:2578`.
- `packages/data/src/index.ts` — register both units.
- `packages/app/src/main.ts` — `SPRITE_MAP` entries and sandbox spawns.
- `packages/app/src/ui/hud.ts:386` — `gunship` glyph.

---

### Task 1: Per-unit demolition time

**Files:**
- Modify: `data/schemas/unit.schema.json`
- Modify: `packages/sim/src/structures.ts:76`
- Modify: `packages/sim/src/sim.ts` (interface `UnitType`, `unitTypeFromJson`, `demolitionProgress` at `:957`, `stepDemolition` at `:2578`)
- Test: `packages/sim/src/demolition.test.ts`

**Interfaces:**
- Consumes: `fx`, `TICKS_PER_SECOND`, `Sim`, `UnitTypeJson` from `./sim`; `DEMO_TICKS` from `./structures`.
- Produces: `DEMO_SECONDS: number` exported from `structures.ts`; `UnitType.demolitionTicks: number`; optional `UnitTypeJson.demolition_time_s?: number`. Task 3 sets `demolition_time_s: 2.0` in the D9's JSON.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/src/demolition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';

const SAPPER: UnitTypeJson = {
  id: 'test_sapper',
  role: 'engineer',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.85 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['demolish'],
  weapons: [],
};

const DOZER: UnitTypeJson = { ...SAPPER, id: 'test_dozer', demolition_time_s: 2.0 };

const SHACK: StructureTypeJson = { id: 'test_shack', hp_per_tile: 100 };

/** Park a demolisher beside a one-tile building and tick until it falls. */
function ticksToLevel(unit: UnitTypeJson): number {
  const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
  const st = sim.addStructureType(SHACK);
  sim.addStructure(st, [10 * 32 + 10]);
  const t = sim.addUnitType(unit);
  sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
  for (let n = 1; n <= 400; n++) {
    sim.tick();
    if (sim.structureAt(10, 10) < 0) return n;
  }
  return -1;
}

describe('per-unit demolition time', () => {
  it('defaults to 5 s (100 ticks) when the field is absent', () => {
    expect(ticksToLevel(SAPPER)).toBe(100);
  });

  it('honours demolition_time_s: 2.0 as 40 ticks', () => {
    expect(ticksToLevel(DOZER)).toBe(40);
  });

  it('reports progress against the unit-s own timer, not the global', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    sim.addStructure(st, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    for (let n = 0; n < 20; n++) sim.tick();
    // 20 of 40 ticks: half done. Against the old global 100 this read 0.2.
    expect(sim.demolitionProgress(id)).toBeCloseTo(0.5, 2);
  });

  // The D9 ships with no `weapons` key at all. recon_drone already does, but
  // nothing has combined that with an ability that runs a per-tick system, and
  // an unarmed unit reaching selectTarget is the way that breaks.
  it('an unarmed demolisher acquires no target and does not throw', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    sim.addStructure(st, [10 * 32 + 10]);
    const dozer = sim.addUnitType(DOZER);
    const enemy = sim.addUnitType({ ...SAPPER, id: 'test_enemy', abilities: [] });
    const id = sim.spawn(dozer, 0, fx.from(11.5), fx.from(10.5));
    sim.spawn(enemy, 1, fx.from(13.5), fx.from(10.5));
    expect(() => {
      for (let n = 0; n < 60; n++) sim.tick();
    }).not.toThrow();
    expect(sim.state.curTarget[id]).toBe(-1);
    expect(sim.state.engaging[id]).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/sim/src/demolition.test.ts`
Expected: FAIL. The 2.0 s case levels at 100 ticks like the default, and the progress case reads ~0.2. TypeScript will also reject `demolition_time_s` as not present on `UnitTypeJson`.

- [ ] **Step 3: Export the default in seconds**

In `packages/sim/src/structures.ts`, beside `export const DEMO_TICKS = 100;`:

```ts
/** The same default expressed in seconds, for `demolition_time_s`. Data is
 *  authored in real units and must not know the tick rate. */
export const DEMO_SECONDS = 5;
```

- [ ] **Step 4: Add the field to the JSON type and the converted type**

In `packages/sim/src/sim.ts`, add to `UnitTypeJson`:

```ts
  /** Seconds of held station to bring a building down. Absent = DEMO_SECONDS. */
  demolition_time_s?: number;
```

and to `interface UnitType`:

```ts
  /** Ticks of held station to bring a building down. Per unit since the D9. */
  demolitionTicks: number;
```

- [ ] **Step 5: Convert it in `unitTypeFromJson`**

In `unitTypeFromJson`, beside `canDemolish`, using the same form as `apsReloadTicks` on the line above — no `Math.*` in the sim:

```ts
    demolitionTicks: fx.toInt(
      fx.mul(fx.from(json.demolition_time_s ?? DEMO_SECONDS), fx.fromInt(TICKS_PER_SECOND)),
    ),
```

Add `DEMO_SECONDS` to the existing `./structures` import.

- [ ] **Step 6: Read the per-unit value in both places**

`stepDemolition`, `sim.ts:2578` — `type` is already in scope:

```ts
      if (++this.demoTicks[i] >= type.demolitionTicks) {
```

`demolitionProgress`, `sim.ts:957`. This is the line most likely to be skipped, and skipping it leaves the HUD bar filling to 40% before the building falls:

```ts
  demolitionProgress(id: number): number {
    return this.demoTicks[id] / this.unitTypes[this.typeIdx[id]].demolitionTicks;
  }
```

- [ ] **Step 7: Declare the field in the schema**

In `data/schemas/unit.schema.json`, as a new top-level entry under `properties` — required because the schema is `additionalProperties: false`:

```json
    "demolition_time_s": {
      "type": "number",
      "minimum": 0.5,
      "default": 5.0,
      "description": "Seconds a `demolish` unit must hold station to bring a building down. Absent means 5.0, which is what every demolisher did before the field existed."
    },
```

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run packages/sim/src/demolition.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 9: Prove no existing unit moved**

Run: `pnpm test:determinism`
Expected: PASS 4/4 **with the golden hash unchanged**. Every shipped unit omits the field, resolves to 5.0 s, and converts back to exactly 100 ticks. If the hash moved, the conversion is wrong — do not update the golden value to make it pass.

Run: `pnpm lint && pnpm test && pnpm validate:data`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add data/schemas/unit.schema.json packages/sim/src/structures.ts packages/sim/src/sim.ts packages/sim/src/demolition.test.ts
git commit -m "feat(sim): demolition time is a per-unit property

stepDemolition counted every demolisher against one global DEMO_TICKS, so
'brings buildings down faster' was not expressible in data. demolition_time_s
defaults to the 5.0 s that constant already encoded, so no shipped unit moves
and the determinism hash is unchanged."
```

---

### Task 2: The `gunship` role

**Files:**
- Modify: `data/schemas/unit.schema.json` (role enum)
- Modify: `packages/app/src/ui/hud.ts:386`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `"gunship"` as a legal `role`. Task 4 sets it on `heli_peten`.

Four places read `role`, and three need no change: `FOOT_ROLES` at `sim.ts:175` correctly excludes it so `can_embark` defaults false; `mission.ts:529` correctly gives it no drone intel; `renderer.ts:1553`'s procedural fallback only matters before the sheet exists. Only the HUD glyph needs a case.

- [ ] **Step 1: Add the enum entry**

In `data/schemas/unit.schema.json`, the `role` enum becomes:

```json
    "role": {
      "enum": ["recon", "mbt", "ifv", "apc", "infantry", "at_team", "engineer", "eod", "artillery", "aa", "drone", "gunship", "technical", "sniper", "support"]
    },
```

- [ ] **Step 2: Give it a glyph**

In `packages/app/src/ui/hud.ts`, the glyph chain currently falls from `drone` to `sniper` to `transportSlots` to `isSoft` to `'■'`. A helicopter carrying a tank's mark is a permanent wart. Insert after the `drone` case:

```ts
    const glyph = type.isKamikaze
      ? '✹'
      : type.role === 'drone'
        ? '⬡'
        : type.role === 'gunship'
          ? '✈'
          : type.role === 'sniper'
            ? '✛'
            : type.transportSlots > 0
              ? '▤'
              : type.isSoft
                ? '▲'
                : '■';
```

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm validate:data && pnpm validate:ui`
Expected: all pass. `validate:ui` matters because `hud.ts` is UI source and must contain no colour literal — this change adds none.

- [ ] **Step 4: Commit**

```bash
git add data/schemas/unit.schema.json packages/app/src/ui/hud.ts
git commit -m "feat(data): a gunship role, with its own HUD glyph

support and engineer are FOOT_ROLES, so an Apache labelled either would
default to can_embark: true and could ride inside a Namer."
```

---

### Task 3: `dozer_d9` unit data

**Files:**
- Create: `data/units/kdf/dozer_d9.json`
- Modify: `packages/data/src/index.ts`
- Modify: `packages/app/src/main.ts` (`sandboxSpawns`)

**Interfaces:**
- Consumes: `demolition_time_s` from Task 1.
- Produces: `units.dozer_d9` in `@lions/data`. Task 8 adds its `SPRITE_MAP` entry.

- [ ] **Step 1: Write the unit**

Create `data/units/kdf/dozer_d9.json`:

```json
{
  "id": "dozer_d9",
  "name": "D9 Dov",
  "faction": "kdf",
  "role": "engineer",
  "cost": { "logistics": 430, "build_time_s": 26, "population": 1 },
  "unlock": { "roe_rating_min": 60 },
  "hull": {
    "hp": 2400,
    "armor": { "front": 240, "side": 170, "rear": 110 },
    "crew": 2,
    "suppression_resistance": 0.75,
    "can_embark": false
  },
  "mobility": { "speed_tiles_s": 0.6, "turn_rate_deg_s": 45 },
  "sensors": { "optics": 0.8, "sight_tiles": 7, "signature": 1.15, "firing_signature_mult": 1.0 },
  "abilities": ["demolish"],
  "demolition_time_s": 2.0
}
```

No `weapons` key at all — `recon_drone` already ships without one. `can_embark: false` is required because `engineer` is a `FOOT_ROLE`. Do **not** set `can_crush` or `reshapes_terrain`: both are read by no sim code, and `reshapes_terrain` would additionally apply a ×1.25 mobility multiplier in `tools/validate_balance.py:155` for a capability that does not exist.

- [ ] **Step 2: Register it**

In `packages/data/src/index.ts`, beside the other kdf imports:

```ts
import dozerD9 from '../../../data/units/kdf/dozer_d9.json';
```

and in the `units` map:

```ts
  dozer_d9: dozerD9,
```

- [ ] **Step 3: Put one in the sandbox**

In `packages/app/src/main.ts`, in `sandboxSpawns`, after `spawn('recon_drone', 0, 8, 23);`:

```ts
  // Engineering assets sit behind the line of contact -- both are slow and
  // one is unarmed, so spawning them forward would just feed them to the
  // militia before the player has seen them.
  spawn('dozer_d9', 0, 3, 20);
```

- [ ] **Step 4: Verify it loads and demolishes**

Run: `pnpm validate:data`
Expected: `data gate passed` with the file count up by one.

Run: `pnpm lint && pnpm test && pnpm test:determinism`
Expected: all pass, golden hash unmoved — a new unit type appended to the roster does not change any existing entity's behaviour.

- [ ] **Step 5: Commit**

```bash
git add data/units/kdf/dozer_d9.json packages/data/src/index.ts packages/app/src/main.ts
git commit -m "feat(units): D9 Dov, an unarmed armoured dozer that levels in 2 s

Bounces rifles, the DShK and the ZU-23; dies to any RPG or ATGM, front or
side. Committing one means committing an escort."
```

---

### Task 4: `heli_peten` unit data

**Files:**
- Create: `data/units/kdf/heli_peten.json`
- Modify: `packages/data/src/index.ts`
- Modify: `packages/app/src/main.ts` (`sandboxSpawns`)

**Interfaces:**
- Consumes: the `gunship` role from Task 2.
- Produces: `units.heli_peten` in `@lions/data`. Task 8 adds its `SPRITE_MAP` entry.

- [ ] **Step 1: Write the unit**

Create `data/units/kdf/heli_peten.json`:

```json
{
  "id": "heli_peten",
  "name": "AH-64 Peten",
  "faction": "kdf",
  "role": "gunship",
  "cost": { "logistics": 880, "build_time_s": 42, "population": 2 },
  "unlock": { "roe_rating_min": 65 },
  "hull": {
    "hp": 640,
    "armor": { "front": 45, "side": 28, "rear": 20 },
    "crew": 2,
    "suppression_resistance": 0.7
  },
  "mobility": { "speed_tiles_s": 3.4, "turn_rate_deg_s": 110, "domain": "air" },
  "sensors": {
    "optics": 1.6,
    "sight_tiles": 15,
    "thermal": true,
    "signature": 1.2,
    "firing_signature_mult": 2.5
  },
  "weapons": [
    {
      "id": "chain_gun_30",
      "type": "autocannon",
      "range_tiles": 7.5,
      "effective_range_tiles": 6.0,
      "accuracy": 0.6,
      "penetration": 120,
      "damage": 85,
      "rof_per_min": 625,
      "suppression": 90,
      "can_target": ["ground", "air", "structure"],
      "collateral_risk": 0.5
    },
    {
      "id": "hellfire",
      "type": "atgm",
      "range_tiles": 10.5,
      "effective_range_tiles": 9.0,
      "accuracy": 0.8,
      "penetration": 900,
      "damage": 420,
      "splash_tiles": 0.8,
      "rof_per_min": 6,
      "suppression": 15,
      "can_target": ["ground", "structure"],
      "collateral_risk": 0.2
    }
  ]
}
```

Front armour 45 sits above `SOFT_ARMOR_LIMIT` (30 mm, `tuning.ts:67`) so the airframe is not classed soft. The Hellfire's 9.0 effective against the gun truck's 8.5 effective / 11 reach is the counterplay: the Apache strikes from beyond the ZU-23's useful range while staying inside its reach, so the exchange turns on who fires first.

- [ ] **Step 2: Register it**

In `packages/data/src/index.ts`:

```ts
import heliPeten from '../../../data/units/kdf/heli_peten.json';
```

and in the `units` map:

```ts
  heli_peten: heliPeten,
```

- [ ] **Step 3: Put one in the sandbox**

In `packages/app/src/main.ts`, immediately after the `dozer_d9` spawn from Task 3:

```ts
  spawn('heli_peten', 0, 6, 31);
```

- [ ] **Step 4: Verify**

Run: `pnpm validate:data && pnpm lint && pnpm test && pnpm test:determinism`
Expected: all pass, golden hash unmoved.

- [ ] **Step 5: Confirm it actually flies**

Start the dev server via the preview tooling (never `pnpm dev` in Bash) and open `?sandbox`, then in the console:

```js
(() => { const S = window.__lions.sim;
  const i = [...Array(S.count).keys()].find(k => S.unitTypes[S.typeIdx[k]].id === 'heli_peten');
  return JSON.stringify({ isAir: S.unitTypes[S.typeIdx[i]].isAir, alive: S.alive[i] }); })()
```

Expected: `isAir: true`. This is the one property that makes the unit what it is, and nothing in the unit tests covers the JSON→`UnitType` path for it.

- [ ] **Step 6: Commit**

```bash
git add data/units/kdf/heli_peten.json packages/data/src/index.ts packages/app/src/main.ts
git commit -m "feat(units): AH-64 Peten, a two-weapon gunship on the air domain

Hellfire at 9.0 effective against the gun truck's 8.5: the Apache strikes
from beyond the ZU-23's useful range but stays inside its reach, so the
exchange is decided by who fires first."
```

---

### Task 5: Wreck geometry, and commit the model sources

**Files:**
- Modify: `tools/vehicles/author_d9.py`
- Modify: `tools/vehicles/author_apache.py`
- Commit: both author scripts, both preview scripts, `art/src/vehicles/d9.blend`, `art/src/aircraft/apache.blend`

**Interfaces:**
- Consumes: `kit.box`, `kit._mesh`, and the local `plate`/`pipe` (D9) and `taper`/`tube`/`rotor` (Apache) helpers already in those files.
- Produces: objects named `WRECK_*` in both `.blend` files. Tasks 6 and 7 split on that prefix to render the `wreck` clip.

Both author scripts exist in the working tree and build clean models, but neither produces wreck geometry. `render_loiter.py:88` splits meshes by a `WRECK_` name prefix into live and debris groups, and `render_clip` renders each group with the other hidden. Without it there is no `wreck` clip and the manifest is a frame short.

- [ ] **Step 1: Add the D9 wreck**

At the end of `build()` in `tools/vehicles/author_d9.py`, before `kit.save(OUT)`:

```python
    # ---- wreck: a separate group the renderer swaps in ----------------------
    # render_clip hides one group while drawing the other, split on this prefix.
    # A dead D9 is not a scorched D9: the blade drops flat, the cab folds toward
    # the tracks, and the stack goes over. Sitting lower than the live model is
    # most of what reads at 131 px.
    kit.box("WRECK_hull", (4.40, 2.90, 1.05), (-0.40, 0.0, 0.90), "hull")
    for side, sy in (("l", -TRACK_Y), ("r", TRACK_Y)):
        kit.box(f"WRECK_track_{side}", (5.20, 0.95, 0.95), (-0.30, sy, 0.47), "rubber")
    kit.box("WRECK_cab", (1.85, 2.10, 0.85), (-1.30, 0.10, 1.85), "hull")
    plate("WRECK_blade", [
        (3.30, 0.02), (3.90, 0.10), (3.86, 0.46), (3.26, 0.38),
    ], 2.30, "metal")
    kit.box("WRECK_stack", (1.30, 0.34, 0.32), (0.90, -1.05, 1.55), "metal")
    kit.box("WRECK_ripper", (1.30, 0.42, 0.34), (-3.05, 0.0, 0.60), "metal")
```

- [ ] **Step 2: Add the Apache wreck**

At the end of `build()` in `tools/vehicles/author_apache.py`, before `kit.save(OUT)`:

```python
    # ---- wreck --------------------------------------------------------------
    # Down on its belly with the rotor sheared: two stub blades at an angle
    # rather than four level ones, which is what stops the wreck reading as a
    # parked aircraft at 128 px.
    kit.hull_box("WRECK_fuse", 5.00, 1.40, 1.05, (-0.40, 0.0, 0.10), slope_deg=14.0)
    taper("WRECK_boom", -5.60, -2.10, 0.36, 0.58, 0.40, 0.62, 0.55, 0.72, "hull")
    taper("WRECK_fin", -6.40, -5.60, 0.24, 0.28, 1.10, 0.80, 1.15, 0.95, "hull")
    kit.box("WRECK_wing", (1.20, 4.60, 0.24), (-0.30, 0.0, 0.42), "hull")
    for k, ang in enumerate((0.35, 2.30)):
        ca, sa = math.cos(ang), math.sin(ang)
        hl, hw, hh = 2.60, 0.23, 0.05
        pts = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
        rot = [(-0.30 + u * ca - w * sa, u * sa + w * ca) for u, w in pts]
        v = [(x, y, 1.28 - hh) for x, y in rot] + [(x, y, 1.28 + hh) for x, y in rot]
        f = [(0, 1, 2, 3), (7, 6, 5, 4)]
        for i in range(4):
            j = (i + 1) % 4
            f.append((i, j, j + 4, i + 4))
        kit._mesh(f"WRECK_blade_{k}", v, f, "metal")
    tube("WRECK_hub", 0.40, 0.22, (-0.30, 0.0, 1.22), "z", "metal", 10)
```

- [ ] **Step 3: Rebuild both and check the groups split**

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender
$B --background --python tools/vehicles/author_d9.py
$B --background --python tools/vehicles/author_apache.py
```

Expected: `saved .../d9.blend` with 32 objects (26 + 6) and `saved .../apache.blend` with 51 objects (44 + 7).

- [ ] **Step 4: Look at both before committing**

```bash
$B --background --python tools/vehicles/preview_d9.py
$B --background --python tools/vehicles/preview_apache.py
```

Read `art/showcase/d9_mock.png` and `art/showcase/apache_mock.png`. The wreck parts are in these renders too — they are not hidden until `render_clip` runs — so expect the live model with debris overlapping it. Confirm the wreck geometry sits *lower* than the live model; that is all this check is for.

- [ ] **Step 5: Commit the sources**

```bash
git add tools/vehicles/author_d9.py tools/vehicles/author_apache.py \
        tools/vehicles/preview_d9.py tools/vehicles/preview_apache.py \
        art/src/vehicles/d9.blend art/src/aircraft/apache.blend
git commit -m "feat(art): author scripts and .blend sources for the D9 and Apache

kit.py is a ground-vehicle kit, so the airframe's taper/tube/rotor helpers
live in author_apache.py rather than being pushed into the shared kit.
Blade height 2.20 was chosen against 1.88 and a 1.15 cab, rendered side by
side: it is the only variant where the moldboard clears the deck from the
default facing."
```

---

### Task 6: Render `D9_HULL`

**Files:**
- Create: `tools/render_d9.py`
- Output: `assets/sprites/D9_HULL/` (33 files: 32 PNG + manifest)

**Interfaces:**
- Consumes: `art/src/vehicles/d9.blend` from Task 5; `VehicleSpec`, `setup`, `render_clip`, `write_manifest`, `burnt_material` from `tools/render_vehicle.py`.
- Produces: `assets/sprites/D9_HULL/manifest.json` with `scale` ≈ 2.05. Task 8 points `SPRITE_MAP` at it.

- [ ] **Step 1: Write the renderer**

Create `tools/render_d9.py`, modelled on `tools/render_gun_truck.py` (a hull-only sheet with no turret) rather than `render_loiter.py` (which animates):

```python
"""Render the D9 Dov to assets/sprites/D9_HULL.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_d9.py

Hull sheet only: the D9 is unarmed, so `turret_meshes` stays empty and
render_vehicle never runs a second pass. Clips are `idle` and `wreck`, one frame
each -- the same shape as TECH_HULL and GUNTRUCK_HULL.

`target_scale`, not `real_metres`. The machine is 7.8 m over blade and ripper,
which would derive well past the main battle tank's 126 px; 2.05 draws it at
131 px, marginally the largest ground silhouette in the set, which is what a
62-tonne dozer should be.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_vehicle import (  # noqa: E402
    VehicleSpec, burnt_material, render_clip, setup, write_manifest,
)

ROLE_PALETTE = {
    "hull": "olive.1",      # KDF vehicle body
    "plate": "olive.2",     # fenders, bonnet, cab roof
    "metal": "gunmetal.1",  # moldboard, push arms, stack, ripper
    "rubber": "shadow.0",   # tracks
    "glass": "gunmetal.3",  # cab glazing
    "recess": "shadow.1",   # the gaps a flat box does not have
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/vehicles/d9.blend"),
    out_hull=os.path.abspath("assets/sprites/D9_HULL"),
    out_turr=os.path.abspath("assets/sprites/D9_TURR_UNUSED"),  # never written
    real_metres=None,
    target_scale=2.05,
    size_class="heavy_vehicle",
    credit="D9 armoured dozer -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="d9_hull",
    turret_unit="d9_turret_unused",
    role_palette=ROLE_PALETTE,
    # Blade on +X and the rig constant is -90 deg, so (c - phi)/22.5 = -4 = 12.
    facing_offset=12,
)


def groups():
    live, debris = [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        (debris if o.name.startswith("WRECK_") else live).append(o)
    if not live or not debris:
        raise SystemExit(f"unexpected grouping: live={len(live)} debris={len(debris)}")
    print(f"groups: live={len(live)} debris={len(debris)}")
    return live, debris


def main():
    pivot, _hull, _turret, _olive, framing = setup(SPEC)
    live, debris = groups()

    files = []
    render_clip(pivot, live, debris, SPEC.out_hull, "idle", files)

    burnt = burnt_material()
    for o in debris:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    render_clip(pivot, debris, live, SPEC.out_hull, "wreck", files)

    write_manifest(
        SPEC, SPEC.out_hull, SPEC.hull_unit,
        {
            "idle": {"frames": 1, "fps": 0, "loop": False},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        files, framing,
    )
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Render**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_d9.py
```

Expected: `DONE 32 frames -> .../assets/sprites/D9_HULL`.

- [ ] **Step 3: Quantize to the locked palette**

Every Cycles render is off-palette until this runs, and the gate will reject it otherwise.

```bash
python3 tools/quantize_sprites.py --sprites assets/sprites/D9_HULL
```

- [ ] **Step 4: Run the art gate**

```bash
pnpm validate:assets
```

Expected: `art gate passed`, sprite count up by 32.

If it fails on **IoU against `TNK_HULL`, `EITAN_HULL` or `NAMER_HULL`**, that is the risk this model was shaped around. The dials, in order: raise `BLADE_TOP` in `author_d9.py` above 2.20, lengthen `ripper_tine`, raise the stack. Do **not** change `target_scale` — the gate compares silhouettes at a normalised 64 px, so scale does not move the number.

If it fails on `MIN_FILL`, the frame is too empty: reduce the gap between blade and hull by moving the moldboard aft.

- [ ] **Step 5: Look at it at gameplay size**

Open `assets/sprites/D9_HULL/idle_f00_000.png` and confirm the blade, stack and ripper are all legible. The gate passing is necessary, not sufficient — it measures overlap, not whether the machine reads.

- [ ] **Step 6: Commit**

```bash
git add tools/render_d9.py assets/sprites/D9_HULL
git commit -m "feat(art): render D9_HULL, 16 facings plus wreck"
```

---

### Task 7: Render `APACHE_HULL`

**Files:**
- Create: `tools/render_apache.py`
- Output: `assets/sprites/APACHE_HULL/` (81 files: 80 PNG + manifest)

**Interfaces:**
- Consumes: `art/src/aircraft/apache.blend` from Task 5; the same `render_vehicle` exports as Task 6.
- Produces: `assets/sprites/APACHE_HULL/manifest.json`, `idle` with 4 frames per facing. Task 8 points `SPRITE_MAP` at it.

This is the animated case, so `render_loiter.py` is the template, not `render_gun_truck.py`.

- [ ] **Step 1: Write the renderer**

Create `tools/render_apache.py`:

```python
"""Render the AH-64 Peten to assets/sprites/APACHE_HULL.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_apache.py

Hull sheet only. The chin gun is about three pixels at gameplay size, so it is
fixed to the nose and there is no turret layer.

`idle` carries four rotor phases and there is deliberately no `fire` clip. A
4-blade rotor has 90 deg rotational symmetry, so four phases at 22.5 deg cover
exactly one visual cycle and loop seamlessly. Giving `fire` its own four phases
would cost another 64 renders; giving it one would freeze the rotor the instant
the aircraft shoots. Omitted, clipOrFallback resolves `fire` back to `idle` and
the shot is carried by the muzzle flash, firingTimer and recoil the renderer
already runs. Same reasoning drops `move`.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_vehicle import (  # noqa: E402
    VehicleSpec, burnt_material, render_clip, setup, write_manifest,
)

FRAMES = 4
FPS = 12
BLADE_BARS = 2                      # two full-diameter bars = four blades
SPIN_DEG = 90.0 / FRAMES            # 22.5 deg per phase closes the cycle
BOB = 0.06                          # a hover is never perfectly still

ROLE_PALETTE = {
    "hull": "olive.1",
    "plate": "olive.2",
    "metal": "gunmetal.2",   # rotor, mast, gun, gear legs
    "rubber": "shadow.0",
    "glass": "gunmetal.3",   # tandem canopy
    "recess": "shadow.1",
}


def _spin(k):
    """Pose both rotor bars for frame k. Absolute, never a delta -- render_clip
    calls this once per facing per frame, so deltas would accumulate."""
    for i in range(BLADE_BARS):
        ob = bpy.data.objects.get(f"blade_{i}")
        if ob is None:
            raise SystemExit(f"rotor bar missing from the source: blade_{i}")
        ob.rotation_euler.z = math.radians(SPIN_DEG) * k


SPEC = VehicleSpec(
    src=os.path.abspath("art/src/aircraft/apache.blend"),
    out_hull=os.path.abspath("assets/sprites/APACHE_HULL"),
    out_turr=os.path.abspath("assets/sprites/APACHE_TURR_UNUSED"),  # never written
    real_metres=None,
    target_scale=2.00,
    size_class="air",
    credit="AH-64 assault helicopter -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="apache_hull",
    turret_unit="apache_turret_unused",
    role_palette=ROLE_PALETTE,
    # Nose along +X and the rig constant is -90 deg, so offset 12.
    facing_offset=12,
    # The rotor sweeps outside its rest silhouette as it turns.
    bounds_poses=tuple((lambda k: (lambda: _spin(k)))(k) for k in range(FRAMES)),
    bounds_z_pad=BOB,
)


def groups():
    live, debris = [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        (debris if o.name.startswith("WRECK_") else live).append(o)
    if not live or not debris:
        raise SystemExit(f"unexpected grouping: live={len(live)} debris={len(debris)}")
    print(f"groups: live={len(live)} debris={len(debris)}")
    return live, debris


def main():
    pivot, _hull, _turret, _olive, framing = setup(SPEC)
    live, debris = groups()
    base_z = pivot.location.z

    def air_pose(piv, k):
        piv.location.z = base_z + BOB * math.sin(2.0 * math.pi * k / FRAMES)
        _spin(k)

    files = []
    render_clip(pivot, live, debris, SPEC.out_hull, "idle", files,
                frames=FRAMES, pose=air_pose)

    # Absolute reset: render_clip's exit pose restores frame 0's bob, but the
    # wreck must sit level on the ground.
    pivot.location.z = base_z
    _spin(0)

    burnt = burnt_material()
    for o in debris:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    render_clip(pivot, debris, live, SPEC.out_hull, "wreck", files)

    write_manifest(
        SPEC, SPEC.out_hull, SPEC.hull_unit,
        {
            "idle": {"frames": FRAMES, "fps": FPS, "loop": True},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        files, framing,
    )
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Render**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_apache.py
```

Expected: `DONE 80 frames -> .../assets/sprites/APACHE_HULL`. This is the long one — 80 Cycles frames.

- [ ] **Step 3: Quantize**

```bash
python3 tools/quantize_sprites.py --sprites assets/sprites/APACHE_HULL
```

- [ ] **Step 4: Run the art gate**

```bash
pnpm validate:assets
```

Expected: `art gate passed`, sprite count up by 80.

`MIN_FILL >= 6%` is the likely failure here, not IoU — a thin tailboom and an open rotor leave a lot of empty frame, which is why the airframe was already shortened to 11.5 m from 15 m true. If it fails, shorten the boom further in `author_apache.py` and re-run from Task 5 Step 3.

- [ ] **Step 5: Check the loop**

Open `idle_f00_000.png` through `idle_f00_003.png` in order. The rotor must advance by a quarter of a blade spacing each frame and frame 3 must lead back into frame 0. If it jumps, `SPIN_DEG` is wrong for the bar count.

- [ ] **Step 6: Commit**

```bash
git add tools/render_apache.py assets/sprites/APACHE_HULL
git commit -m "feat(art): render APACHE_HULL, 16 facings x 4 rotor phases plus wreck"
```

---

### Task 8: Wire the sheets to the units

**Files:**
- Modify: `packages/app/src/main.ts` (`SPRITE_MAP`)

**Interfaces:**
- Consumes: `assets/sprites/D9_HULL/` and `assets/sprites/APACHE_HULL/` from Tasks 6 and 7; `units.dozer_d9` and `units.heli_peten` from Tasks 3 and 4.
- Produces: both units drawing from their own sheets in the sandbox.

- [ ] **Step 1: Add the entries**

In `packages/app/src/main.ts`, in the sheet map beside the other KDF entries. Neither takes a `turretPath` — the D9 is unarmed and the Apache's chin gun is fixed to the airframe:

```ts
    dozer_d9: { path: `${BASE}sprites/D9_HULL/` },
    heli_peten: { path: `${BASE}sprites/APACHE_HULL/` },
```

- [ ] **Step 2: Verify in the running sandbox, by driving it**

Start the dev server through the preview tooling and open `?sandbox`. Console shortcuts skip the code that breaks, so check the loaded atlas *and* a drawn sprite:

```js
(() => { const R = window.__lions.renderer, S = window.__lions.sim;
  const out = [];
  for (let i = 0; i < S.count; i++) {
    const id = S.unitTypes[S.typeIdx[i]].id;
    if (id === 'dozer_d9' || id === 'heli_peten') {
      const s = R.entitySprites[i];
      out.push({ id, sheet: R.spriteAtlas.has(id), sprite: !!s,
                 tex: s && s.texture.label.split('/sprites/')[1] });
    }
  }
  return JSON.stringify(out); })()
```

Expected: both `sheet: true`, both `sprite: true`, textures from `D9_HULL/` and `APACHE_HULL/`. Both spawn on side 0 in KDF territory, so no fog gate applies.

- [ ] **Step 3: Screenshot both**

Take a screenshot with both units on screen. Confirm the Apache draws lifted off its tile with a ground shadow, and the D9 does not.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main.ts
git commit -m "feat(app): point the D9 and Apache at their sheets"
```

---

### Task 9: Fit the costs and re-validate balance

**Files:**
- Modify: `data/units/kdf/dozer_d9.json`, `data/units/kdf/heli_peten.json` (the `cost.logistics` values only)

**Interfaces:**
- Consumes: both unit files from Tasks 3 and 4.
- Produces: costs inside the cost-curve tolerance band, with all four §5.7 targets still passing.

The spec is explicit that 430 and 880 are opening bids. `validate_balance.py` fits a power curve across the whole roster and rejects deviations past ±18%. The D9 is an awkward shape for it — zero offence, extreme defence, worst-in-game mobility — and the Apache's two-weapon offence score is high.

- [ ] **Step 1: Check where both sit**

```bash
python3 tools/validate_balance.py --units data/units --tolerance 0.18
```

Expected either `balance gate passed` — in which case skip to Step 3 — or a line per offending unit giving its `deviation=`.

- [ ] **Step 2: Move the cost, not the stats**

If a unit is outside the band, change only `cost.logistics`, in the direction the reported deviation indicates, and re-run. A positive deviation means the unit is priced above what the curve says its stats are worth, so the cost comes down.

Do **not** adjust `hp`, `armor`, `penetration` or ranges to make the gate pass. Those numbers encode the design decisions in the spec — the Hellfire's 9.0 effective range in particular is the entire air-counterplay design and must not be tuned for a cost curve.

- [ ] **Step 3: Confirm the combat model still holds**

```bash
pnpm balance
```

Expected: all four §5.7 targets `PASS`, in particular `Urban assault force ratio` still reporting 3:1 as reliable at ≥65%.

A fast, thermal, two-weapon air unit that the enemy can barely reach is exactly the sort of thing that moves this target. If 3:1 has slipped, the dial is the **Hellfire's `effective_range_tiles`**, not its penetration: dropping it toward the gun truck's 8.5 hands the initiative back to the AA. Record what moved and why in the commit message.

- [ ] **Step 4: Full gate sweep**

```bash
pnpm lint && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:assets && pnpm validate:ui
```

Expected: all pass, determinism golden hash unmoved.

- [ ] **Step 5: Commit**

```bash
git add data/units/kdf/dozer_d9.json data/units/kdf/heli_peten.json
git commit -m "balance: fit the D9 and Apache to the cost curve"
```

---

## Done when

- Both units spawn in the sandbox, draw from their own sheets, and the Apache reads as airborne.
- A D9 parked against a building levels it in 40 ticks; Combat Engineers still take 100.
- `pnpm test:determinism` passes with the golden hash it had before this branch.
- `pnpm balance` passes all four §5.7 targets.
- `pnpm validate:data`, `validate:assets` and `validate:ui` all pass.
- `art/src/vehicles/d9.blend` and `art/src/aircraft/apache.blend` are committed alongside their sprites, per CLAUDE.md.
