# T1 — Terrain: slope, per-domain passability, and mesh decor

Design, 2026-09-01. Approved in chat before writing; not yet implemented.

Three subsystems shipped as one milestone. They are presented A/B/C here
because that is the order of increasing risk; they are BUILT C -> B -> A (see
Order of work). They are
independent enough to build separately and were specified together
deliberately: all three read the same elevation grid and the same terrain
symbols, and splitting them would have meant designing that shared reading
three times.

---

## Why this is not "add elevation"

Elevation already exists and already works. `map.schema.json` carries an
optional `elevation` grid (0–9, one digit per tile, same dimensions as
`rows`), `applyTerrain` feeds it to the `Sim`, and `losRay` reads it —
high ground sees over lower obstacles, every blocking tile stands two levels
above its own ground, and a one-level rise sits exactly at eye level so it
obscures nothing.

What elevation does NOT do today is affect movement, pathing, or sight range.
`sim.ts` reads `this.elevation` in exactly one place: the line-of-sight ray.

So "hills and valleys" is largely an **authoring** job — Tel Marum is the only
shipped map with any relief — and the engine work is the three pieces below.

---

## A. Slope affects movement cost

### The change

`FlowField.compute(blocked, gx, gy)` becomes
`compute(blocked, elevation, gx, gy)`. Its relaxation step is currently

```ts
const nc = c + (diag ? COST_DIAG : COST_ORTH);
```

a **uniform** per-tile cost. It becomes

```ts
const climb = elevation[t] - elevation[n];        // see the sign note
const nc = c + (diag ? COST_DIAG : COST_ORTH)
             + (climb > 0 ? climb * UPHILL_PER_LEVEL : 0);
```

Downhill is free. That asymmetry is the point: high ground is expensive to
attack and cheap to withdraw from, which is the tactical shape worth having.
A symmetric cost would say descending a hill is as hard as climbing it and
would remove the withdraw-downhill option entirely.

### The sign, which is the easy thing to get backwards

The field expands **goal-outward**. When the loop is at tile `t` and relaxes
neighbour `n`, the *unit* travels `n → t`, not `t → n`. So the climb is
`elevation[t] - elevation[n]`, the opposite of how the loop reads. Getting
this backwards produces a field that makes units *prefer* to climb, and it
would look like a plausible-but-odd pathing bug rather than an inverted sign.
The implementation must have a test that puts a goal on a hill and asserts the
approach path goes around the slope, not over it.

### Constraints

- **Integer arithmetic only.** `COST_ORTH`/`COST_DIAG` are ints and the cost
  array is integer; `UPHILL_PER_LEVEL` is an int. No Q16.16 conversion is
  needed and no float may appear (invariant 2).
- `UPHILL_PER_LEVEL` lives in `packages/sim/src/tuning.ts`, not in
  `flowfield.ts`. §5.7 targets outrank formula text.
- Dijkstra already handles variable edge cost correctly — this is a cost term,
  not a new algorithm. The priority queue needs no change.

### Blast radius

The determinism golden hash probably does **not** move, and that is a weakness
rather than a comfort. `determinism.test.ts` says so itself: its replay never
calls `setElevation`, so `elevation[t] !== 0` is false everywhere and "neither
run can falsify an elevation leak". With `climb` 0 on every tile the new
arithmetic is identical to the old, so the golden replay would stay green
through a completely broken slope implementation.

The implementation must therefore **add a replay with relief** rather than
lean on the existing hash. If the existing hash does move, that is a red flag
worth chasing — it would mean the change altered flat-ground behaviour, which
it must not.

Fifteen of sixteen shipped missions are flat, so their behaviour is unchanged
by construction. Only Tel Marum's three missions re-tune. `pnpm balance` must still meet all five §5.7
targets, and the 16-mission `playtest.ts` ladder must still exit 0.

---

## B. Boulders: passable to infantry, impassable to vehicles

### The change

A new terrain symbol — `b` — that is open ground for infantry and blocked for
vehicles. It is **only** that: no cover, no sight-blocking, no HP, not
destructible. Those were each considered and cut (see Out of scope).

The mechanism already exists and is the reason this is cheap.
`FlowField.compute` takes the blocked mask **as a parameter**, so per-domain
passability needs a second mask, not a second pathfinder:

```
blocked        = buildings | ridges                  (infantry, unchanged)
blockedVehicle = buildings | ridges | boulders       (wheeled and tracked)
```

Air is untouched and keeps using `blocked`.

### The real cost: the field cache

`Sim.fieldFor(gx, gy)` keys its cache by goal tile alone:

```ts
const key = gy * this.width + gx;
```

and **never evicts** — `this.fields.push(field)` grows for the life of the
mission. Passability becoming per-domain means the key gains a domain, so the
pool roughly doubles. This lands on top of an existing scaling debt (detection
is already O(N²) pairs per tick), so the implementation must:

1. Make the key `(goal, domain)` explicitly, not by stuffing a bit into the
   tile index.
2. Only allocate a vehicle field when a vehicle actually asks for one. On a
   map with no `b` tiles the two masks are identical, and the implementation
   should return the shared field rather than compute a duplicate. That check
   is `boulderCount === 0`, decided once at map load.

### What "vehicle" means — and the trap in the obvious answer

Domain comes from the unit type, not a hardcoded id list. `paramotor` and
`heli_peten` declare `mobility.domain: "air"`; everything else is ground.
Ground must then split into foot and vehicle.

**`FOOT_ROLES` is the obvious predicate and it is WRONG here.** It already
exists (`sim.ts:205`) and already splits foot from vehicle for `canEmbark`:

```ts
const FOOT_ROLES = new Set(['infantry','at_team','artillery','engineer','sniper','support']);
```

but it contains `artillery`, and `rocket_battery` — a Grad on a 6x6 truck —
declares `role: "artillery"`. Reusing `FOOT_ROLES` would let a rocket truck
drive through a boulder field that stops a jeep. `mortar_crew` and
`mortar_team` are genuinely foot artillery, so the role alone cannot separate
them; the category conflates crew-served weapons with the vehicles carrying
them.

**Decision: add an explicit `mobility.wheeled` boolean to the unit schema**,
defaulting to `!FOOT_ROLES.has(role)` so every existing unit keeps its current
classification, and set it to `true` on `rocket_battery` — the one unit the
default gets wrong. An explicit field is right here because the question
"can this thing drive over a boulder" is a real property of a unit that no
existing field answers, and deriving it from `role` is what produces the bug
above. The default keeps the change to one line of data.

This must be pinned by a test that asserts `rocket_battery` is wheeled and
`mortar_team` is not — the two sides of the conflation.

### Files a new terrain symbol touches

This is more than the legend, and the repo already has a guard that will fail
loudly if any is missed:

- `packages/data/src/map.ts` — `TERRAIN_LEGEND`
- `tools/validate_data.mjs` — `TERRAIN_SYMBOLS`
- `packages/data/src/map.test.ts` — the "still decodes exactly eight terrain
  symbols" assertion becomes nine
- `tools/src/terrain_symbols.test.ts` — reads the validator's source and
  asserts the two agree; it will fail if only one side is updated

### Blast radius

No shipped map contains `b`, so the determinism hash does **not** move until
one does. The masks are identical on every existing map.

---

## C. Mesh decor and scatter

### The change

A new `packages/render/src/three/terrain/decor-mesh.ts` that draws scattered
objects from GLB assets, replacing the procedural marks in `scatter.ts` (flat
quads) and the hand-built trunk-and-crown geometry in `grove.ts`.

Built on **`THREE.BatchedMesh`** (present in three r170, already a dependency).
`InstancedMesh` draws N copies of one geometry; `BatchedMesh` draws N copies of
*many* geometries in a single draw call. Six decor families in one call is the
point: draw-call submission is this project's measured bottleneck, with the GPU
otherwise idle.

### Placement: derived, with authored overrides

Placement is a **pure function** of the tile, so it is testable without a
renderer and identical on every machine:

```
decorFor(symbol, elevation, hash(tileIndex, mapSeed)) -> DecorPlacement | null
```

The default mapping, derived from symbols that already exist:

| symbol | family |
|---|---|
| `.` open | sand/gravel patches, grass tufts |
| `1`–`3` cover | bushes and scrub, denser with the cover level |
| `o` grove | olive trees (already this rule, via `grove.ts`) |
| `n` knoll | rock clusters |
| `^` ridge | boulders, rock slabs |
| `b` boulder | the large vehicle-blocking boulder |

The hash also picks the variant, rotation and scale jitter. Every shipped map
therefore gains scatter with **zero authoring**.

**DEFERRED 2026-09-01 (see the T1-C plan and its issue):** an optional authored
grid overriding specific tiles where a landmark is wanted. Overrides win where present; absent tiles fall to the
derived rule. Two placement paths is a real cost and is accepted deliberately:
the derived rule gives every map something for free, and the override is what
makes a set-piece possible without hand-placing hundreds of objects.

### Decor gets its own role vocabulary

The mesh contract's role sets are closed **per asset class** — vehicles have
`hull/plate/rubber/metal/glass/recess`, buildings have `wall/roof/trim/...`,
VFX have `core/mid/outer`. Decor gets its own:

```
foliage · trunk · rock · sand
```

`rampForDecorRole(role)` follows the established shape: it throws for a role
outside the set rather than returning a default colour, matching every other
class. Colour is per-role and shared across families — decor has no faction.

### Assets

Six families, three variants each, authored in Meshy and exported through a
new `tools/terrain/export_meshy_decor.py`. `olive tree` and `stone` are already
supplied; the remaining prompts were given in chat. Every asset must ship with
zero materials, named objects mapping to the four roles above, and a silhouette
readable at a 45° elevated view.

### Constraints

- **Render-only. This must not touch simulation outcomes** (invariant 4).
  Decor has no collision, no cover, no sight effect. The `b` symbol's
  mechanical meaning comes from section B and the terrain grid, never from
  whether a boulder mesh happened to be placed there.
- The mesh payload is already **34 fetches / 25.3 MiB at boot**, measured.
  Decor GLBs must be Draco-compressed (`DRACOLoader` ships with three) or the
  budget grows past what a real network will carry.

### Known gaps this makes visible

Real relief is the first thing that exposes three dormant bugs, all recorded
in CLAUDE.md and none of them created by this work:

1. `raySmoke` (`sim.ts`) never reads elevation, and `losRay` calls it before
   any height reasoning runs — smoke pooled in a valley will block a ray
   passing six levels above it.
2. VFX are not lifted to terrain height, and extruded terrain cannot occlude
   units.
3. `trailG`, `fxG` and `wreckLayer` sit below `spriteLayer` unconditionally,
   so a wreck or tracer in front of a ridge is covered by it.

None is in scope here. They are listed so the first person to author a real
hill does not read them as regressions from this milestone.

---

## Out of scope, deliberately

- **Destructible boulders.** Needs HP, a damage path and a rubble state —
  closer to the structure system than to terrain.
- **Boulder cover and sight-blocking.** A boulder that hides a tank is a
  different object from one that merely stops it; CLAUDE.md's own rule is that
  a low-profile obstacle should not block sight.
- **Downhill cover**, cut from E3 for the same reason it is cut here: it is a
  combat-model change wearing a terrain hat.
- **Slope-aware unit facing** (tilting a hull to the ground plane).
- **Sight range varying with elevation.** CLAUDE.md is explicit: elevation
  affects what you can see over, never how far.

---

## Testing

- **A:** a goal on a hill, asserting the path goes around not over; a flat map
  producing a byte-identical field to today's; the determinism hash updated
  deliberately with its reason; `pnpm balance` green; the ladder green.
- **B:** infantry crossing a `b` tile and a vehicle routing around it, on the
  same map, to the same goal — one test, two domains, which is also the guard
  against the two domains sharing a cached field. Plus: a map with no `b`
  allocates no second field.
- **C:** `decorFor` is pure, so it is unit-tested directly — same symbol and
  seed gives the same placement, and different tiles give different variants.
  Overrides beat the derived rule. Rendering itself is not unit-tested, per
  the repo convention that combat maths requires tests and rendering does not.

## Order of work

C → B → A. C carries no simulation risk at all and can land while the other
two are still being designed in detail; B is small and self-contained; A moves
the determinism hash and re-tunes Tel Marum, so it goes last, once relief is
actually worth pathing over.
