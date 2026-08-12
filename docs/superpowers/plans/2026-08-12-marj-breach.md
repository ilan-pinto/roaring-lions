# First Light — the Marj breach: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the campaign's opening mission — a defence the player is meant to nearly lose — plus the two capabilities it needs: a `breach` phase and the `evacuate_before` objective.

**Architecture:** Four layers, bottom-up. The schema and GDD gain a sixth phase (metadata only — nothing reads `mission.phase`). The sim's `MissionRuntime` gains civilian *shepherding* (proximity to a player unit sends a civilian to the refuge) and the `evacuate_before` objective that counts arrivals against a deadline. Then a new structure type — a wall you cannot fight from, drawn per tile because a wall run is any length — with its sprite. Then the content: a new 48×48 map and the mission JSON, both declarative. Finally the campaign wiring, so the breach's cost carries into recon.

**Tech Stack:** TypeScript strict, Vitest, Q16.16 fixed-point sim (`packages/sim`), JSON content validated by AJV (`tools/validate_data.mjs`), headless harnesses in `tools/src`.

## Global Constraints

- **Sim is fixed-point only.** No `Math.*`, no `Date.*`, no floats inside `packages/sim`. Use `fx.*` from `packages/sim/src/fixed`. Enforced by lint.
- **Squared-distance idiom:** shift Q16.16 deltas right by 8, multiply as integers. `D` tiles squared is `D * D * 65536` (see `DANGER_CLOSE_SQ = 262144` for 2 tiles, `CONTEST_RADIUS_SQ = 2359296` for 6).
- **Missions are data, never TypeScript.** Behaviour comes from the GDD §6 vocabulary: one stance per unit, a handful of triggers per mission.
- **Civilians are never commandable or targetable.** They are side 2, hurt only by ordnance.
- **No colour literals in UI source** (`pnpm validate:ui`). Colours come from palette keys in data; the renderer resolves them.
- **Unit ids available.** KDF: `inf_squad`, `at_team`, `sniper_team`, `demo_squad`, `apc_eitan`, `ifv_namer`, `mbt_lavi`, `mortar_team`, `jeep_shoded`, `recon_drone`, `attack_drone`. Enemy: `militia_cell`, `rpg_team`, `atgm_cell`, `technical`, `mortar_crew`. Civilians: `civilians`. **No other enemy units exist** — mass comes from counts, not new types.
- **Map symbols:** terrain `.` open, `1`/`2`/`3` cover, `r`/`o`/`n`; structures `s` shanty, `h` house, `a` apartment, `w` warehouse, `#` concrete, `m` mosque, `=` wall (added by Task 4).
- **Gates that must pass before any commit is final:** `pnpm test`, `pnpm validate:data`, `pnpm lint`, `pnpm test:determinism`.

## Two corrections to the spec

The spec was written before I read every signature. Both corrections make the work *smaller*, and the plan below is authoritative:

1. **`ObjectiveStatus` already includes `'failed'`, and the HUD already renders it** — `packages/app/src/ui/hud.ts:205-206` draws `☒` in a `bad` tone, and the change-flash at line 177 already handles it. Nothing has ever *set* it. So there is **no type change and no HUD work**; `evacuate_before` is simply the first producer.
2. **The determinism golden hash will not move.** `packages/sim/src/determinism.test.ts` imports only `fx`, `Sim` and `UnitTypeJson` — it never constructs a `MissionRuntime`. This plan changes mission-runtime code only, so the hash at `determinism.test.ts:87` (`484379662`) stays. Run the suite to prove it; do **not** update the constant.

## File Structure

| File | Responsibility |
|---|---|
| `data/schemas/mission.schema.json` | Add `breach` to the phase enum |
| `docs/GDD.md` | §4 becomes six phases |
| `packages/sim/src/mission.ts` | Shepherding + `evacuate_before` evaluation and its deadline in `view()` |
| `packages/sim/src/mission.test.ts` | Tests for both |
| `data/structures.json` | The `wall` structure type |
| `data/schemas/structure.schema.json` | The `per_tile` flag |
| `packages/render/src/renderer.ts` | Draw a `per_tile` structure's sprite once per tile |
| `tools/buildings/author_wall.py` | The wall .blend source |
| `tools/render_building.py` | Wall entry in `BUILDINGS` |
| `data/maps/marj_perimeter.json` | The map: staging, perimeter, settlements, strongpoint, refuge |
| `data/missions/beit_sahwan_breach.json` | The mission |
| `packages/data/src/index.ts` | Register the map and mission |
| `data/campaign/world.json` | Campaign order: breach first; recon requires the roster |
| `data/missions/beit_sahwan_1_recon.json` | Draw scouts `from_ledger` |
| `tools/src/backtest/playtest.ts` | A plan proving First Light winnable |

---

### Task 1: The `breach` phase

**Files:**
- Modify: `data/schemas/mission.schema.json` (phase enum)
- Modify: `docs/GDD.md:84` and `docs/GDD.md:99`

**Interfaces:**
- Consumes: nothing.
- Produces: the string `"breach"` as a legal `mission.phase` value, used by Task 7.

- [ ] **Step 1: Add the enum value**

In `data/schemas/mission.schema.json`, find the `phase` property and add `"breach"` **first** — it is the first phase in campaign order:

```json
    "phase": {
      "enum": [
        "breach",
        "recon",
        "foothold",
        "buildup",
        "clearance",
        "subterranean"
      ],
      "description": "The phase this mission is built around. One lead phase per mission."
    },
```

- [ ] **Step 2: Update GDD §4**

`docs/GDD.md:84` currently reads `Five phases. Each is normally the spine of its own **short mission** (see §6), and each writes to the campaign ledger that later phases read.`

Replace that line with:

```markdown
Six phases. Each is normally the spine of its own **short mission** (see §6), and each writes to the campaign ledger that later phases read.
```

Then insert a new numbered entry **before** the existing `1. **Recon**` line, and renumber the rest 2–6:

```markdown
1. **Breach** — the enemy attacks and the player is the one holding. Outnumbered, no corridor, no reinforcements: survive, get civilians clear, and still hold a position when relief arrives. Losing ground is the design, not a failure state. Any doctrine can open on the back foot.
```

- [ ] **Step 3: Fix the closing line of §4**

`docs/GDD.md:99` reads `This is one system expressed five ways, not five minigames.` Replace with:

```markdown
This is one system expressed six ways, not six minigames.
```

- [ ] **Step 4: Prove the schema accepts it and still rejects nonsense**

Run: `pnpm validate:data`
Expected: `data gate passed: 45 file(s) validated, palette keys resolved` — unchanged, because no mission uses `breach` yet.

Then verify the enum really changed:

Run: `python3 -c "import json;print(json.load(open('data/schemas/mission.schema.json'))['properties']['phase']['enum'])"`
Expected: `['breach', 'recon', 'foothold', 'buildup', 'clearance', 'subterranean']`

- [ ] **Step 5: Commit**

```bash
git add data/schemas/mission.schema.json docs/GDD.md
git commit -m "feat(data): a sixth phase — breach, for missions that open on the back foot

GDD §4 had five phases, all of which assume the player is advancing. An
opening mission where the player is overrun fits none of them. mission.phase
is read by no code, so this is a canon change plus one enum entry."
```

---

### Task 2: Civilians follow soldiers who come for them

**Files:**
- Modify: `packages/sim/src/mission.ts` (new constant near `CIV_FLEE_AT` at line ~219; `stepCivilians` at line ~820)
- Test: `packages/sim/src/mission.test.ts` (the `civilians and ROE (GDD §6)` describe block, which already has the `civWorld` helper)

**Interfaces:**
- Consumes: `this.playerIds` (`number[]`), `this.civIds` (`number[]`), `this.civFled` (`Set<number>`), `this.markerPos(name): [Fx, Fx]`, `CIV_FLEE_AT`.
- Produces: shepherding behaviour inside `private stepCivilians(): void`. Task 3 relies on shepherded civilians actually walking to `civilians.refuge`.

**Why this exists:** civilians currently move for exactly one reason — suppression above `CIV_FLEE_AT`. An evacuation objective built on that alone would reward *shooting near civilians to herd them*, the precise inversion of what ROE teaches. Proximity to a soldier is the player-driven cause.

- [ ] **Step 1: Write the failing tests**

Add to `packages/sim/src/mission.test.ts`, inside the existing `describe('civilians and ROE (GDD §6)', ...)` block (it already defines `civWorld`, whose `markers` include `refuge: [2, 10]`):

```ts
  it('a civilian walks out when a soldier comes within shepherding range', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
    });
    const civ = w.sim.entityCount - 1;
    const startX = w.sim.state.posX[civ];
    w.step(40);
    // Heading for the refuge at [2, 10]: west and south of where it started.
    expect(w.sim.state.posX[civ]).toBeLessThan(startX);
  });

  it('a civilian with no soldier near it stays put', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [2, 2] }],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
    });
    const civ = w.sim.entityCount - 1;
    const startX = w.sim.state.posX[civ];
    w.step(40);
    expect(w.sim.state.posX[civ]).toBe(startX);
  });

  it('shepherding is issued once, so a soldier standing there does not re-order every tick', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
    });
    const civ = w.sim.entityCount - 1;
    w.step(120);
    const x1 = w.sim.state.posX[civ];
    w.step(120);
    // Still travelling toward the refuge, not pinned in place by re-issued orders.
    expect(w.sim.state.posX[civ]).toBeLessThan(x1);
  });
```

- [ ] **Step 2: Run them and watch the first and third fail**

Run: `pnpm vitest run packages/sim/src/mission.test.ts -t 'shepherd'`
Expected: FAIL — the civilian does not move, because nothing but suppression moves it.

- [ ] **Step 3: Add the radius constant**

In `packages/sim/src/mission.ts`, directly after the `CIV_FLEE_AT` constant (line ~219):

```ts
/** A soldier this close is walking these people out: 4 tiles, squared, in the
 *  Q8.8 form the other radius checks use. Civilians move for exactly one other
 *  reason -- fear -- and an evacuation objective built on fear alone would
 *  reward shooting near them to herd them. */
const SHEPHERD_RADIUS_SQ = 1048576;
```

- [ ] **Step 4: Extend `stepCivilians`**

Replace the whole of `private stepCivilians(): void` (line ~820) with:

```ts
  /** Civilians shelter in place until fire lands close, then break for the
   *  refuge — once, in fear, not as a controlled unit. They also go when a
   *  soldier reaches them: that is the player evacuating them, and it is the
   *  only way `evacuate_before` can be satisfied without shooting at them. */
  private stepCivilians(): void {
    const refuge = this.mission.civilians?.refuge;
    if (refuge === undefined) return;
    const st = this.sim.state;
    for (const civ of this.civIds) {
      if (st.alive[civ] === 0 || this.civFled.has(civ)) continue;
      let leaving = st.suppression[civ] > CIV_FLEE_AT;
      if (!leaving) {
        for (const p of this.playerIds) {
          if (st.alive[p] === 0) continue;
          const dx = (fx.sub(st.posX[civ], st.posX[p]) >> 8) | 0;
          const dy = (fx.sub(st.posY[civ], st.posY[p]) >> 8) | 0;
          if (dx * dx + dy * dy <= SHEPHERD_RADIUS_SQ) {
            leaving = true;
            break;
          }
        }
      }
      if (!leaving) continue;
      // The same latch as fleeing: one order per person. A civilian already
      // running cannot be re-shepherded, and one being walked out cannot be
      // re-panicked into a second, conflicting order.
      this.civFled.add(civ);
      const [rx, ry] = this.markerPos(refuge);
      this.sim.queueCommand({ kind: 'move', ids: [civ], x: rx, y: ry });
    }
  }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run packages/sim/src/mission.test.ts`
Expected: PASS, all tests in the file including the three new ones.

- [ ] **Step 6: Prove the fixed-point rule and determinism hold**

Run: `pnpm lint`
Expected: clean — no `Math.*` introduced.

Run: `pnpm test:determinism`
Expected: 4 tests pass. The golden hash must be **unchanged**; if it moved, stop — that means sim internals were touched, which this task does not do.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts
git commit -m "feat(sim): civilians follow a soldier who reaches them

Civilians moved for exactly one reason: suppression. An evacuation objective
on that mechanic alone would reward shooting near civilians to herd them, so
proximity to a living player unit is now a second cause, sharing the same
one-order latch as fleeing."
```

---

### Task 3: The `evacuate_before` objective

**Files:**
- Modify: `packages/sim/src/mission.ts` — `SUPPORTED` (line ~214), `start()` zone validation (line ~492), `stepObjectives` (line ~961), `view()` (line ~449)
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Consumes: shepherding from Task 2; `this.zone(name): readonly number[] | undefined`; `this.civIds`; the objective loop's `complete` flag pattern.
- Produces: `evacuate_before` as a runtime-supported objective type, used by Task 7. Semantics: `target` is a **zone** id, `count` is a number of **civilian entities**, `seconds` is the deadline. Completes when `count` have arrived; latches `'failed'` at the deadline. Arrival is permanent.

- [ ] **Step 1: Write the failing tests**

Add to `packages/sim/src/mission.test.ts` inside the `describe('civilians and ROE (GDD §6)', ...)` block. Note `civWorld` puts `refuge` at `[2, 10]`, so the tests below add a `refuge_zone` around it via the `ctx` override:

```ts
  const REFUGE_CTX = { zones: { clinic: [20, 2, 4, 4], refuge_zone: [0, 8, 6, 4] } };

  it('counts civilians who reach the refuge zone and completes at the count', () => {
    const w = civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 600 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    const evs = w.step(600);
    const done = evs.mission.filter((m) => m.kind === 'objective' && m.id === 'evac' && m.status === 'complete');
    expect(done).toHaveLength(1);
  });

  it('marks the evacuation failed when the deadline passes short of the count', () => {
    const w = civWorld(
      {
        // No soldier near the civilian: nobody is coming for them.
        starting_force: [{ unit: 'm_squad', count: 1, at: [24, 2] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 5 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    const evs = w.step(5 * TICKS_PER_SECOND + 2);
    const failed = evs.mission.filter((m) => m.kind === 'objective' && m.id === 'evac' && m.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(w.runtime.objectiveList.find((o) => o.id === 'evac')?.status).toBe('failed');
  });

  it('a failed secondary evacuation does not lose the mission', () => {
    const w = civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [24, 2] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 5 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    w.step(5 * TICKS_PER_SECOND + 2);
    expect(w.runtime.result).toBe('ongoing');
  });

  it('shows the evacuation deadline as a countdown, so an expiring clock is visible', () => {
    const w = civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [24, 2] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 60 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    w.step(20);
    const view = w.runtime.objectiveList.find((o) => o.id === 'evac');
    expect(view?.ticksLeft).toBe(60 * TICKS_PER_SECOND - 20);
  });

  it('refuses an evacuate_before whose target is not a zone', () => {
    expect(() =>
      civWorld(
        {
          civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
          objectives: [
            { id: 'evac', type: 'evacuate_before', primary: false, target: 'not_a_zone', count: 1, seconds: 60 },
          ],
        },
        REFUGE_CTX
      )
    ).toThrow(/needs a valid zone/);
  });
```

`objectiveList` is the public getter for the objective view — `packages/sim/src/mission.ts:433`, also used by `tools/src/backtest/playtest.ts:60`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run packages/sim/src/mission.test.ts -t 'evacua'`
Expected: FAIL — `objective type "evacuate_before" is not supported by the runtime yet`.

- [ ] **Step 3: Support the type and validate its target**

In `packages/sim/src/mission.ts`, add `'evacuate_before'` to `SUPPORTED` (line ~214):

```ts
const SUPPORTED = new Set([
  'locate', 'eliminate_hvt', 'capture', 'hold_for', 'survive_until', 'destroy_all', 'evacuate_before',
]);
```

Add the evacuation tracking field beside `civFled` (line ~270):

```ts
  /** Civilians who reached the refuge zone. Latched: getting people out is not
   *  undone by what happens afterwards. */
  private readonly civEvacuated = new Set<number>();
```

In `start()`, extend the existing zone check (line ~492) so the new type is validated the same way:

```ts
      if (
        (o.def.type === 'capture' || o.def.type === 'hold_for' || o.def.type === 'evacuate_before') &&
        !this.zone(o.def.target)
      ) {
        throw new Error(`mission ${this.mission.id}: objective "${o.def.id}" needs a valid zone`);
      }
```

- [ ] **Step 4: Evaluate arrivals and the deadline**

In `stepObjectives` (line ~961), the loop is `for (const o of this.objectives) { if (o.status !== 'active') continue; const d = o.def; let complete = false; ... }`. Add a `failed` flag next to `complete`:

```ts
      let complete = false;
      let failed = false;
```

Add this branch to the end of the `if/else if` chain, after the `hold_for` branch:

```ts
      } else if (d.type === 'evacuate_before') {
        const z = this.zone(d.target);
        if (z !== undefined) {
          const st = this.sim.state;
          for (const civ of this.civIds) {
            if (this.civEvacuated.has(civ) || st.alive[civ] === 0) continue;
            const tx = st.posX[civ] >> 16;
            const ty = st.posY[civ] >> 16;
            if (tx >= z[0] && tx < z[0] + z[2] && ty >= z[1] && ty < z[1] + z[3]) {
              this.civEvacuated.add(civ);
            }
          }
        }
        complete = this.civEvacuated.size >= (d.count ?? 1);
        // The deadline is the whole point: a clock the player cannot see expire
        // is a hidden model (GDD §5.8), which is why this latches a status the
        // HUD already draws rather than failing silently.
        failed = !complete && tick >= (d.seconds ?? 300) * TICKS_PER_SECOND;
      }
```

Then replace the loop's tail:

```ts
      if (complete) {
        o.status = 'complete';
        out.push({ kind: 'objective', tick, id: d.id, status: 'complete' });
      } else if (failed) {
        o.status = 'failed';
        out.push({ kind: 'objective', tick, id: d.id, status: 'failed' });
      }
```

- [ ] **Step 5: Show the countdown**

In `view()` (line ~449), the `ticksLeft` block handles `survive_until`, `hold_for` and `capture`. Add `evacuate_before`, which counts down from mission start exactly like `survive_until`:

```ts
          if (o.def.type === 'survive_until' || o.def.type === 'evacuate_before') {
            const left = secs * TICKS_PER_SECOND - this.sim.tickCount;
            ticksLeft = left > 0 ? left : 0;
          } else if (o.def.type === 'hold_for' || o.def.type === 'capture') {
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run packages/sim/src/mission.test.ts`
Expected: PASS, whole file.

- [ ] **Step 7: Run every gate**

Run: `pnpm test`
Expected: all test files pass.

Run: `pnpm test:determinism`
Expected: pass with the golden hash **unchanged**.

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts
git commit -m "feat(sim): evacuate_before — get civilians clear on a clock

Closes #3. Counts civilians who reach a refuge zone against a deadline;
arrival is latched, and expiry sets the 'failed' status the HUD has always
been able to draw but nothing ever set. Validated like hold_for: the target
must be a real zone."
```

---

### Task 4: The `wall` structure type, and per-tile sprite drawing

**Files:**
- Modify: `data/schemas/structure.schema.json` (add a `per_tile` property)
- Modify: `data/structures.json` (add the `wall` type)
- Modify: `packages/render/src/renderer.ts` (`rebuildTerrain`'s sprited-structure branch at line ~923, and `drawStructureSprite` at line ~1126)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: map symbol `=` for walls, and the rule that a structure type with `per_tile: true` draws its sprite once per occupied tile instead of once per footprint. Task 5 renders the sprite this consumes; Task 6's map places `=`.

**Why a wall cannot be `concrete`.** Every existing structure has `garrison_slots` of 1 or more — `concrete` has 2. A perimeter built from concrete would hand attackers two fighting positions inside the wall itself, which silently changes the mission's balance. A wall is the first structure in this game you cannot fight from.

**Why `per_tile` exists.** `parseMap` groups contiguous same-symbol tiles into ONE structure, and `drawStructureSprite` draws one sprite at the footprint's centre at a fixed scale from the manifest. That is right for a compact building and wrong for a linear run: a 20-tile perimeter would render as a single wall sprite floating at the midpoint with 19 tiles invisible. The procedural extrusion already draws per tile, which is why walls look correct without art today.

- [ ] **Step 1: Add the schema flag**

In `data/schemas/structure.schema.json`, inside the `types` `additionalProperties.properties` object, add after the `height_px` property:

```json
     "per_tile": {
      "type": "boolean",
      "default": false,
      "description": "Draw this type's sprite once per occupied tile rather than once for the whole footprint. For linear structures -- walls, fences -- whose runs are of arbitrary length. A compact building leaves this false."
     },
```

- [ ] **Step 2: Add the wall type**

In `data/structures.json`, add to `types` after the `concrete` entry:

```json
    "wall": {
      "id": "wall",
      "name": "Compound Wall",
      "symbol": "=",
      "hp_per_tile": 90,
      "garrison_slots": 0,
      "rubble_cover": 1,
      "height_px": 7,
      "color": "limestone.5",
      "roe_penalty": 0,
      "per_tile": true
    }
```

Every number here is a decision, not a default: 90 hp is weaker than a breeze-block shed (120) so the enemy genuinely breaches rather than routing around; 0 garrison slots is the point of the type; `roe_penalty` 0 because flattening a wall is not a war crime; `rubble_cover` 1 leaves something to crouch behind.

- [ ] **Step 3: Verify the symbol collides with nothing**

Run: `pnpm validate:data`
Expected: passes. The gate already checks that structure symbols do not collide with terrain symbols (`. 1 2 3 r o n`) and that no two structures share one, so a collision fails here by name.

Then confirm the catalogue parses with the new entry:

Run: `python3 -c "import json;t=json.load(open('data/structures.json'))['types'];print({k:v['symbol'] for k,v in t.items()});print('wall garrison:',t['wall']['garrison_slots'],'hp:',t['wall']['hp_per_tile'],'per_tile:',t['wall']['per_tile'])"`
Expected: the symbol map includes `'wall': '='`, and `wall garrison: 0 hp: 90 per_tile: True`.

- [ ] **Step 4: Teach the renderer to draw per-tile types once per tile**

Read `packages/render/src/renderer.ts` around line 915-930. The sprited-structure branch currently reads, inside the per-tile loop over the terrain:

```ts
            if (!this.drawnStructures.has(sIdx)) {
              this.drawnStructures.add(sIdx);
              this.drawStructureSprite(sIdx, stype.id);
            }
```

The `drawnStructures` set is what makes a footprint draw once. A `per_tile` type must bypass it and draw at the current tile instead. Change that block to:

```ts
            if (stype.perTile === true) {
              // A linear structure -- a wall -- is a run of arbitrary length, so
              // its sprite belongs on every tile it occupies. The footprint-centre
              // draw below would put one sprite at the middle of a 20-tile
              // perimeter and leave the rest of it invisible.
              this.drawStructureTileSprite(x, y, stype.id);
            } else if (!this.drawnStructures.has(sIdx)) {
              this.drawnStructures.add(sIdx);
              this.drawStructureSprite(sIdx, stype.id);
            }
```

Confirm the loop variables holding the current tile really are named `x` and `y` at that point, and use whatever they are actually called.

- [ ] **Step 5: Add the per-tile draw**

Add this method directly after `drawStructureSprite` in `packages/render/src/renderer.ts`:

```ts
  /**
   * One tile of a per-tile structure. Same art and scale as a footprint draw,
   * but anchored on this tile's centre and depth-sorted on this tile alone --
   * a wall's far end must not sort as though it stood at the near end.
   */
  private drawStructureTileSprite(x: number, y: number, structureId: string): void {
    const art = this.structureAtlas.get(structureId);
    if (!art) return;
    const cx = x + 0.5;
    const cy = y + 0.5;
    const spr = new Sprite({ texture: art.texture, anchor: 0.5 });
    spr.position.set(isoX(cx, cy), isoY(cx, cy));
    spr.scale.set((art.scale * TILE_W) / art.texture.width);
    spr.zIndex = depthZ(x + 1, y + 1);
    this.spriteLayer.addChild(spr);
    this.buildingSprites.push(spr);
  }
```

Note this draw deliberately omits the integrity-based alpha that `drawStructureSprite` applies: hp lives on the whole run, so fading every tile of a long wall because one section was shelled reads as the entire perimeter dissolving. The procedural per-tile path already darkens individual tiles, which is the behaviour to match if a future task wants damage feedback on sprited walls.

- [ ] **Step 6: Confirm `perTile` reaches the renderer**

The renderer reads `stype.perTile`, so the structure type the sim holds must carry it. Check how `structureTypes` entries are built — `sim.addStructureType` in `packages/sim/src/sim.ts` and the call site in `packages/app/src/main.ts` that passes `data/structures.json` entries through. If the field is dropped on the way, add it, following exactly how `heightPx` and `color` are carried (the same snake_case-to-camelCase step).

Run: `pnpm typecheck`
Expected: clean. If `perTile` is not a known property, that is this step's work — do not cast it away with `as` or `any`.

- [ ] **Step 7: Prove nothing regressed**

Run: `pnpm test && pnpm validate:data && pnpm lint && pnpm typecheck`
Expected: all clean. No wall sprite exists yet, so every existing map still renders exactly as before: a type with no sheet keeps the procedural extrusion (`renderer.ts:429`).

This repo has no renderer test harness, by design — CLAUDE.md states combat maths requires tests and rendering does not. The per-tile path is therefore verified visually in Task 6, once a map actually places `=`. Say so in your report rather than inventing a harness.

- [ ] **Step 8: Commit**

```bash
git add data/schemas/structure.schema.json data/structures.json packages/render/src/renderer.ts
git commit -m "feat(data): a wall you cannot fight from, drawn per tile

Every structure so far has garrison slots -- concrete has two -- so a
perimeter built from concrete would hand attackers fighting positions inside
the wall. The wall type has none, 90 hp a tile so it breaches under fire, and
no ROE cost for knocking it down.

Sprited structures draw once per footprint, which is right for a building and
wrong for a run of arbitrary length: per_tile draws the sprite on every tile
it occupies instead."
```

---

### Task 5: The wall sprite

**Files:**
- Create: `tools/buildings/author_wall.py`
- Create: `art/src/buildings/wall.blend` (written by that script)
- Modify: `tools/render_building.py` (the `BUILDINGS` dict at line ~686)
- Create: `assets/sprites/BLD_WALL/` (render output plus `manifest.json`)

**Interfaces:**
- Consumes: the `wall` type and its `per_tile: true` from Task 4; the renderer's per-tile draw from Task 4.
- Produces: `assets/sprites/BLD_WALL/idle_f00_000.png` and its manifest, loaded by the same `loadStructureSprite` path every other building uses. Task 6's map is where it first appears in play.

**The art spec, decided before rendering.** A render costs fifteen minutes; a spec costs a line.

- **Square in plan, one tile across.** `kit.tiles(1)` is 3.0 world units (`UNITS_PER_TILE = 3.0`). The segment is authored 3.0 × 3.0 so consecutive tiles abut with no seam, and **square** so one sprite serves a run going either direction — in dimetric an east-west wall and a north-south wall are different shapes, and a square segment is the only honest way for a single sprite to read as both.
- **Low.** Body 1.55 units under a coping band 0.20 high overhanging 0.12 a side, so about 1.75 total against a 7.60-unit concrete tower. It must read as something troops fight *over*, not through.
- **Two tones.** Body `limestone.5` matching the catalogue's `color`; coping `limestone.3` one step lighter, so the top edge catches a highlight line and the segment does not render as a flat slab.
- **No openings.** Gates are authored as gaps in the map's run, not modelled — a doorway baked into the sprite would appear on every tile of every wall.

- [ ] **Step 1: Write the author script**

Create `tools/buildings/author_wall.py`, following the shape of `tools/buildings/author_concrete.py` (read it first — it documents the kit and the silhouette budget):

```python
"""Author art/src/buildings/wall.blend.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_wall.py

The compound wall: 90 HP a tile, no garrison slots, no ROE cost. The first
structure in the set you cannot fight from, and the first drawn per tile
rather than per footprint -- a wall run is any length, so one sprite has to
serve every tile of it.

Square in plan on purpose. In dimetric an east-west wall and a north-south
wall are different shapes, so a single sprite can only serve both if the
segment has no long axis. Authored a full tile across (3.0 units) so
consecutive tiles abut with no seam.

Silhouette: nothing else in the set is a low flat bar. The five authored
buildings occupy 0.28 (shanty), 0.41 (warehouse), 0.45 (house), 0.66
(apartment) and ~0.85 (concrete) against their nearest neighbour; a segment
1.75 units tall on a 3.0-unit base is far below all of them, so the IoU gate
has room. The coping is the only feature, and it is what stops this reading
as an untextured block.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

W = kit.tiles(1)          # 3.0 -- full tile, so runs abut
D = kit.tiles(1)          # 3.0 -- square, so one sprite reads in both directions
BODY = 1.55
COPING_H = 0.20
COPING_OVER = 0.12

kit.new_scene()
kit.box("wall_body", (W, D, BODY), (0.0, 0.0, BODY / 2.0), role="wall")
kit.box(
    "wall_coping",
    (W + COPING_OVER * 2.0, D + COPING_OVER * 2.0, COPING_H),
    (0.0, 0.0, BODY + COPING_H / 2.0),
    role="trim",
)
kit.save(os.path.join(kit.REPO if hasattr(kit, "REPO") else "", "art/src/buildings/wall.blend"))
```

Before running it, read `tools/buildings/kit.py` and confirm the real signatures of `new_scene`, `box`, `tiles` and `save` — in particular whether `save` takes a repo-relative path or an absolute one, and what the `role` values are named. Match the existing author scripts exactly rather than trusting the sketch above.

- [ ] **Step 2: Author the .blend**

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/buildings/author_wall.py`
Expected: no traceback, and `art/src/buildings/wall.blend` exists afterwards.

- [ ] **Step 3: Register it for rendering**

In `tools/render_building.py`, add an entry to the `BUILDINGS` dict following the existing entries exactly. It needs `src` pointing at `art/src/buildings/wall.blend`, `out_dir` `assets/sprites/BLD_WALL`, `unit` `wall`, the same `credit` string the others use, `footprint_tiles` 1, and `colour_key` `limestone.5` to match `data/structures.json`.

- [ ] **Step 4: Render, quantize, and gate**

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_building.py`
Then: `python3 tools/quantize_sprites.py --sprites assets/sprites`
Then: `pnpm validate:assets`

Expected: the render writes `assets/sprites/BLD_WALL/idle_f00_000.png` plus `manifest.json`; the quantizer reports the frame rewritten onto the palette; `validate:assets` passes, including the silhouette IoU check against the other buildings. Cycles output is off-palette with soft alpha, so skipping the quantizer makes the gate reject the frame — that ordering is not optional.

If the IoU check fails, the wall is too similar in outline to an existing building. Do not tune the gate. Make the segment lower or the coping more pronounced, re-author, and re-render, recording what you changed and the resulting number.

- [ ] **Step 5: Look at it**

Run: `python3 -c "from PIL import Image; im=Image.open('assets/sprites/BLD_WALL/idle_f00_000.png'); print(im.size, im.mode); bb=im.getbbox(); print('ink bbox', bb, 'fill', round(100*(bb[2]-bb[0])*(bb[3]-bb[1])/(im.size[0]*im.size[1]),1), '%')"`
Expected: a 512×512 RGBA frame whose ink occupies a wide, short band low in the canvas — a tall bbox would mean the segment came out as a tower, which is the failure this step exists to catch.

- [ ] **Step 6: Commit**

Building `.blend` sources ARE tracked in this repo, unlike vehicle sources — `tools/render_building.py` says so explicitly. Commit the source with its sprite.

```bash
git add tools/buildings/author_wall.py art/src/buildings/wall.blend tools/render_building.py assets/sprites/BLD_WALL
git commit -m "feat(art): the compound wall sprite

Square in plan and a full tile across, so one sprite serves a run in either
direction and consecutive tiles abut with no seam -- in dimetric an east-west
wall and a north-south wall are different shapes, and a per-tile linear
structure gets exactly one sprite. Coping band in a lighter tone so the top
edge reads as masonry rather than a slab."
```

---

### Task 6: The map — `marj_perimeter`

**Files:**
- Create: `data/maps/marj_perimeter.json`
- Modify: `packages/data/src/index.ts:11` (import) and `:64-67` (`maps` export)

**Interfaces:**
- Consumes: nothing.
- Produces: map id `marj_perimeter`, 48×48. Markers `kdf_line`, `ashwar_north`, `ashwar_centre`, `ashwar_south`, `tunnel_north`, `tunnel_south`, `strongpoint_centre`, `civ_refuge`. Zones `strongpoint`, `refuge_zone`, `clinic`, `settlements`. Task 7 references all of these by name.

Geography, west to east — the Marj lies west of Kedem on the campaign map, so the enemy breaks *eastward* and everything behind the KDF line is Kedem's own ground:

| Band | x | Contents |
|---|---|---|
| Ashwar staging | 0–8 | open, the three assembly markers |
| Approach | 9–13 | scattered cover |
| KDF perimeter | 14–18 | berm cover and two concrete positions; longer than the force can hold |
| Open ground | 19–21 | the killing space they must cross |
| Settlements | 22–30 | two dense villages, a mosque, the clinic; the civilians and both tunnel exits |
| Strongpoint | 32–36 | walled compound — the `hold_for` zone |
| Road east | 37–39 | open |
| Refuge | 40–47 | the evacuation zone |

- [ ] **Step 1: Generate the map file**

Maps are hand-editable text, but 48 rows are error-prone to type. Generate once, deterministically, then edit by hand thereafter. Save this as `/tmp/gen_marj.py` and run it:

```python
import json

W = H = 48
grid = [['.'] * W for _ in range(H)]

def rect(x0, y0, x1, y1, ch):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            grid[y][x] = ch

# Approach: scattered light cover, on a fixed lattice so it is reproducible.
for y in range(4, 44):
    for x in range(9, 14):
        if (x * 7 + y * 5) % 11 == 0:
            grid[y][x] = '1'

# The KDF perimeter: a long berm with two hard positions.
for y in range(6, 42):
    grid[y][16] = '2'
    if y % 6 == 0:
        grid[y][15] = '2'
rect(14, 20, 15, 22, '#')
rect(14, 26, 15, 28, '#')

# North village: houses on a street grid, a mosque, and the clinic.
for y in range(9, 20):
    for x in range(22, 31):
        if y % 3 != 0 and x % 3 != 0:
            grid[y][x] = 'h'
rect(24, 12, 25, 13, 'a')
rect(28, 16, 29, 17, 'm')
rect(27, 10, 29, 12, '#')          # the clinic

# South village: denser, poorer, shanties.
for y in range(29, 40):
    for x in range(22, 31):
        if y % 3 != 0 and x % 3 != 0:
            grid[y][x] = 's'
rect(23, 33, 24, 34, 'h')
rect(27, 36, 28, 37, 'w')

# The strongpoint: a walled compound with a gap on the west face.
rect(32, 20, 36, 20, '#')
rect(32, 28, 36, 28, '#')
rect(36, 21, 36, 27, '#')
grid[21][32] = '#'
grid[27][32] = '#'
rect(33, 23, 34, 25, '2')          # cover inside the yard

# Refuge: a walled yard in the east, open to the road.
rect(41, 22, 41, 26, '2')

rows = ["".join(r) for r in grid]
doc = {
    "id": "marj_perimeter",
    "name": "The Marj Perimeter",
    "width": W,
    "height": H,
    "rows": rows,
    "markers": {
        "kdf_line": [16, 23],
        "ashwar_north": [3, 10],
        "ashwar_centre": [3, 24],
        "ashwar_south": [3, 38],
        "tunnel_north": [26, 15],
        "tunnel_south": [26, 34],
        "strongpoint_centre": [34, 24],
        "civ_refuge": [44, 24],
    },
    "zones": {
        "strongpoint": [32, 20, 5, 9],
        "refuge_zone": [40, 18, 8, 13],
        "clinic": [27, 10, 3, 3],
        "settlements": [22, 9, 9, 31],
    },
}
with open("data/maps/marj_perimeter.json", "w") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
print("rows", len(rows), "x", len(rows[0]))
```

Run: `python3 /tmp/gen_marj.py`
Expected: `rows 48 x 48`

- [ ] **Step 2: Register the map**

In `packages/data/src/index.ts`, add the import after line 11:

```ts
import marjPerimeter from '../../../data/maps/marj_perimeter.json';
```

and add it to the `maps` export:

```ts
export const maps = {
  beit_sahwan_outskirts: beitSahwanOutskirts,
  marj_perimeter: marjPerimeter,
  tutorial_ground: tutorialGround,
} as const;
```

- [ ] **Step 3: Prove it parses and the named geometry is all there**

Save as `/tmp/check_marj.ts` and run with `npx tsx`:

```ts
import { maps, parseMap } from './packages/data/src/index';

const m = parseMap(maps.marj_perimeter);
console.log('size', m.width, m.height, 'structures', m.structures.length);
for (const k of ['kdf_line', 'ashwar_north', 'ashwar_centre', 'ashwar_south', 'tunnel_north', 'tunnel_south', 'strongpoint_centre', 'civ_refuge']) {
  if (!m.markers[k]) throw new Error(`missing marker ${k}`);
}
for (const k of ['strongpoint', 'refuge_zone', 'clinic', 'settlements']) {
  if (!m.zones[k]) throw new Error(`missing zone ${k}`);
}
console.log('markers and zones all present');
```

Run: `npx tsx /tmp/check_marj.ts`
Expected: prints a non-zero structure count and `markers and zones all present`.

- [ ] **Step 4: Run the gates**

Run: `pnpm validate:data`
Expected: `data gate passed: 46 file(s) validated` — one more than before.

Run: `pnpm typecheck && pnpm test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add data/maps/marj_perimeter.json packages/data/src/index.ts
git commit -m "feat(data): the Marj perimeter map

48x48, west to east: Ashwar staging, the approach, a KDF berm deliberately
longer than one force can hold, two dense Kedem border villages with a
clinic and two tunnel exits, the strongpoint compound, and the refuge."
```

---

### Task 7: The mission — First Light

**Files:**
- Create: `data/missions/beit_sahwan_breach.json`
- Modify: `packages/data/src/index.ts` (import + `missions` export)
- Modify: `data/campaign/world.json` (campaign order)

**Interfaces:**
- Consumes: phase `breach` (Task 1), `evacuate_before` (Task 3), the map's markers and zones (Task 6).
- Produces: mission id `beit_sahwan_breach`, producing ledger keys `roster.surviving_units`, `roe.mission_ratings`, `campaign.completed_missions`, `civ.settlements_evacuated`. Task 8 consumes the roster.

**Why the id has no numeral:** renaming `beit_sahwan_1_recon` and its siblings would invalidate `campaign.completed_missions` in every saved ledger and break Sur's `unlock.after_mission` gate. Campaign order lives in `world.json`'s array, so the breach goes first there and the existing ids stay untouched.

**Why there is no retreat trigger:** the perimeter is not an objective. The player starts spread along it, it is longer than the force can hold, and abandoning it costs nothing mechanically. The geometry does what a script would otherwise fake — and GDD §6 forbids the script.

**Why survival is the only primary.** `checkEnd` wins only when *every* primary is complete and loses only on wipe-out or ROE collapse. If the compound hold were also primary, a player alive at 780s who never banked 300s in the compound would sit in a mission that never ends — no victory, no defeat. Making `survive_until` the sole primary bounds the mission at thirteen minutes and matches issue #65's own framing: *the win condition is survival, not territory*. The hold and the evacuation are secondary — they score, they show in the HUD, and they carry through ROE and the ledger.

- [ ] **Step 1: Write the mission**

Create `data/missions/beit_sahwan_breach.json`:

```json
{
  "id": "beit_sahwan_breach",
  "name": "Beit Sahwan — First Light",
  "town": "beit_sahwan",
  "phase": "breach",
  "target_minutes": 14,
  "briefing": "They came at dawn, across the whole front, and the corridor is cut behind us. There is no relief for thirteen minutes and nothing coming before it. Get the villages out through the eastern yard, put what is left of the company in the compound, and still be standing when the column arrives.",
  "map": {
    "file": "marj_perimeter",
    "player_start": [16, 23]
  },
  "ledger": {
    "requires": [],
    "produces": [
      "roster.surviving_units",
      "roe.mission_ratings",
      "campaign.completed_missions",
      "civ.settlements_evacuated"
    ]
  },
  "starting_force": [
    { "unit": "inf_squad", "count": 2, "at": [16, 14] },
    { "unit": "inf_squad", "count": 1, "at": [16, 34] },
    { "unit": "at_team", "count": 1, "at": [15, 21] },
    { "unit": "sniper_team", "count": 1, "at": [15, 27] },
    { "unit": "apc_eitan", "count": 1, "at": [18, 23] },
    { "unit": "jeep_shoded", "count": 1, "at": [19, 24] }
  ],
  "resources": {
    "logistics_start": 150,
    "supply_corridor": false
  },
  "objectives": [
    {
      "id": "survive_relief",
      "type": "survive_until",
      "primary": true,
      "seconds": 780,
      "text": "Still be standing when the relief column arrives"
    },
    {
      "id": "hold_strongpoint",
      "type": "hold_for",
      "primary": false,
      "target": "strongpoint",
      "seconds": 300,
      "text": "Hold the compound for five minutes"
    },
    {
      "id": "evac_settlements",
      "type": "evacuate_before",
      "primary": false,
      "target": "refuge_zone",
      "count": 6,
      "seconds": 480,
      "text": "Get six civilian groups clear through the eastern yard"
    }
  ],
  "roe": {
    "enabled": true,
    "flagged_zones": ["clinic"]
  },
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [
      { "unit": "civilians", "count": 3, "at": [24, 13] },
      { "unit": "civilians", "count": 3, "at": [28, 17] },
      { "unit": "civilians", "count": 3, "at": [24, 33] },
      { "unit": "civilians", "count": 2, "at": [28, 37] }
    ]
  },
  "enemy": {
    "faction": "ashwar",
    "doctrine_profile": "mass infiltration across a wide front",
    "garrison": [
      {
        "unit": "militia_cell",
        "count": 2,
        "marker": "tunnel_north",
        "facing_deg": 270,
        "stance": { "kind": "ambush", "tiles": 4 },
        "group": "north_infiltrators"
      },
      {
        "unit": "rpg_team",
        "count": 1,
        "marker": "tunnel_south",
        "facing_deg": 270,
        "stance": { "kind": "ambush", "tiles": 3 },
        "group": "south_infiltrators"
      },
      {
        "unit": "militia_cell",
        "count": 2,
        "marker": "tunnel_south",
        "facing_deg": 270,
        "stance": { "kind": "ambush", "tiles": 4 },
        "group": "south_infiltrators"
      }
    ],
    "waves": [
      { "at_seconds": 20, "to": "kdf_line", "units": [
        { "unit": "militia_cell", "count": 3, "from": "ashwar_centre" },
        { "unit": "militia_cell", "count": 2, "from": "ashwar_north" }
      ] },
      { "at_seconds": 90, "to": "kdf_line", "units": [
        { "unit": "militia_cell", "count": 3, "from": "ashwar_south" },
        { "unit": "rpg_team", "count": 1, "from": "ashwar_centre" }
      ] },
      { "at_seconds": 180, "to": "strongpoint_centre", "units": [
        { "unit": "technical", "count": 2, "from": "ashwar_centre" },
        { "unit": "militia_cell", "count": 2, "from": "ashwar_north" }
      ] },
      { "at_seconds": 300, "to": "strongpoint_centre", "units": [
        { "unit": "militia_cell", "count": 3, "from": "ashwar_south" },
        { "unit": "atgm_cell", "count": 1, "from": "ashwar_centre" }
      ] },
      { "at_seconds": 430, "to": "strongpoint_centre", "units": [
        { "unit": "mortar_crew", "count": 1, "from": "ashwar_north" },
        { "unit": "militia_cell", "count": 3, "from": "ashwar_centre" }
      ] },
      { "at_seconds": 560, "to": "strongpoint_centre", "units": [
        { "unit": "technical", "count": 2, "from": "ashwar_south" },
        { "unit": "rpg_team", "count": 2, "from": "ashwar_centre" }
      ] },
      { "at_seconds": 690, "to": "strongpoint_centre", "units": [
        { "unit": "militia_cell", "count": 4, "from": "ashwar_centre" }
      ] }
    ]
  },
  "triggers": [
    {
      "id": "villages_rise",
      "on": { "kind": "first_contact" },
      "do": { "kind": "commit", "group": "north_infiltrators" }
    },
    {
      "id": "south_rises",
      "on": { "kind": "timer_s", "value": 240 },
      "do": { "kind": "commit", "group": "south_infiltrators" }
    }
  ]
}
```

The placement keys above are verified against `$defs/placement` in
`data/schemas/mission.schema.json`: legal properties are `unit`, `count`, `at`,
`marker`, `facing_deg`, `group`, `tag`, `stance`, `passengers`, with `unit` and
`count` required. Note `stance` is an **object** — `{ "kind": "ambush", "tiles": 4 }`,
where `kind` is one of `hold_position | ambush | patrol | garrison` — not a bare
string. `additionalProperties` is false, so a stray key fails the gate loudly.

- [ ] **Step 2: Register the mission**

In `packages/data/src/index.ts`, add the import beside the others (after line 13):

```ts
import beitSahwanBreach from '../../../data/missions/beit_sahwan_breach.json';
```

and add it **first** in the `missions` export, since it opens the campaign:

```ts
export const missions = {
  beit_sahwan_breach: beitSahwanBreach,
  beit_sahwan_0_tutorial: beitSahwan0,
  beit_sahwan_1_recon: beitSahwan1,
  beit_sahwan_2_foothold: beitSahwan2,
  beit_sahwan_3_clearance: beitSahwan3,
} as const;
```

- [ ] **Step 3: Put it first in campaign order**

In `data/campaign/world.json`, the `beit_sahwan` town's `missions` array becomes:

```json
          "missions": [
            "beit_sahwan_breach",
            "beit_sahwan_1_recon",
            "beit_sahwan_2_foothold",
            "beit_sahwan_3_clearance"
          ]
```

Leave Sur's `unlock.after_mission` (`beit_sahwan_3_clearance`) alone — it still gates on the town being finished.

- [ ] **Step 4: Validate the data**

Run: `pnpm validate:data`
Expected: `data gate passed: 47 file(s) validated`. The gate cross-checks that every mission file is listed by exactly one town and that markers/zones/units resolve, so a typo in any name fails here with the offending id named.

- [ ] **Step 5: Walk the mission in a real world**

This is the step that catches what unit tests cannot: a trigger naming a group no placement declares, a wave sent to the player's own start line, a stance that dies on spawn.

Run: `npx tsx tools/src/walk_mission.ts beit_sahwan_breach 0 30 120 300 480 780`
Expected: no throw; each sample prints the world. Confirm by eye that enemy counts climb with the waves, that civilians exist in both villages, and that nothing spawns on top of the player's line at `[16, 23]`.

- [ ] **Step 6: Run the suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: clean. `packages/app/src/ui/worldmap.test.ts` counts missions per town from `world.json`, so if a count assertion now fails, update the expectation — the extra mission is intended.

- [ ] **Step 7: Commit**

```bash
git add data/missions/beit_sahwan_breach.json packages/data/src/index.ts data/campaign/world.json
git commit -m "feat(data): First Light — the campaign opens with the player holding

Issue #65's Mission 1. Outnumbered on a perimeter too long to hold, corridor
cut, two villages to evacuate through the eastern yard, and a compound to be
standing in when relief arrives at thirteen minutes. Losing the perimeter is
the map's geometry, not a scripted retreat.

Id carries no numeral on purpose: renaming the existing three would
invalidate saved campaign.completed_missions and Sur's unlock gate. Campaign
order lives in world.json's array."
```

---

### Task 8: The breach's cost carries into recon

**Files:**
- Modify: `data/missions/beit_sahwan_1_recon.json` (`ledger.requires`, and `from_ledger` on the scout placements)

**Interfaces:**
- Consumes: `roster.surviving_units` as produced by Task 5.
- Produces: nothing new. This closes issue #65's acceptance item "ledger output consumed by at least one downstream mission, and that mission still playable on a thin ledger".

**Why this degrades correctly for free:** `spawnPlacement` (`packages/sim/src/mission.ts:628-644`) already treats an **absent** `roster.surviving_units` as a fresh start at full strength, a **sparse** roster as fewer units, and a **gutted** one as a single fresh remnant. Playing recon standalone is therefore unchanged, with no new code.

- [ ] **Step 1: Require the roster**

In `data/missions/beit_sahwan_1_recon.json`, change:

```json
  "ledger": {
    "requires": [],
```

to:

```json
  "ledger": {
    "requires": ["roster.surviving_units"],
```

- [ ] **Step 2: Draw the screen from survivors**

In the same file's `starting_force`, add `"from_ledger": true` to the **infantry and light** placements — `inf_squad`, `at_team`, and `sniper_team` if present. Leave the drone fresh: a drone is issued, not a survivor. For example, a placement that reads

```json
    { "unit": "inf_squad", "count": 2, "at": [6, 21] }
```

becomes

```json
    { "unit": "inf_squad", "count": 2, "at": [6, 21], "from_ledger": true }
```

- [ ] **Step 3: Prove the carry-over both ways**

Run: `npx tsx tools/src/walk_carryover.ts`
Expected: no throw. This is the harness built for exactly this question.

Then prove the thin-ledger path explicitly. Save as `/tmp/thin_ledger.ts`:

```ts
import { Sim, MissionRuntime, type MissionJson, type LedgerData } from './packages/sim/src/index';
import { units, maps, missions, parseMap } from './packages/data/src/index';

function count(ledger: LedgerData): number {
  const mission = missions.beit_sahwan_1_recon as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 128 });
  const ids = new Map<string, number>();
  for (const [id, spec] of Object.entries(units)) ids.set(id, sim.addUnitType(spec as never));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => ids.get(u) ?? (() => { throw new Error(u); })(),
    markers: map.markers,
    zones: map.zones,
    ledger,
  });
  rt.start();
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) n++;
  return n;
}

const fresh = count({});
const gutted = count({ 'roster.surviving_units': [] });
console.log('no ledger at all:', fresh, '| gutted roster:', gutted);
if (fresh <= gutted) throw new Error('a gutted roster should field fewer units than a fresh start');
```

Run: `npx tsx /tmp/thin_ledger.ts`
Expected: the no-ledger count is the authored full strength and the gutted count is smaller — recon is harder after a bad breach, never broken. The import paths are correct as written: `packages/sim/package.json` maps `exports["."]` to `./src/index.ts`.

- [ ] **Step 4: Gates**

Run: `pnpm validate:data && pnpm test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add data/missions/beit_sahwan_1_recon.json
git commit -m "feat(data): recon fields the survivors of First Light

Recon was the campaign's origin and required nothing. Now the breach comes
first, so the screen draws from roster.surviving_units: a costly opening
fields a thinner patrol. An absent roster is still a fresh start at full
strength, so recon standalone is unchanged."
```

---

### Task 9: Prove it is winnable, not merely survivable-looking

**Files:**
- Modify: `tools/src/backtest/playtest.ts` (add a plan before the existing `beit_sahwan_1_recon` plan at line ~72)

**Interfaces:**
- Consumes: `run(id, plan, ledger?)` from the same file, whose `plan` signature is `(sim, rt, ids, at) => void`; `ids(unitTypeId): number[]` returns living player entity ids of that type; `at(seconds, fn)` schedules; `M(x, y)` builds fixed-point coordinates.
- Produces: the breach's produced ledger, passed into the recon plan so the chain is exercised end to end.

- [ ] **Step 1: Write the plan**

In `tools/src/backtest/playtest.ts`, insert **before** the `const led1 = run('beit_sahwan_1_recon', ...)` block:

```ts
// 0 — First Light: give up the perimeter on purpose, walk the villages out
// with the jeep and a squad, and hold the compound with everything else.
const led0 = run('beit_sahwan_breach', (sim, _rt, ids, at) => {
  const shepherds = [...ids('jeep_shoded'), ...ids('inf_squad').slice(0, 1)];
  const holders = [
    ...ids('at_team'),
    ...ids('sniper_team'),
    ...ids('apc_eitan'),
    ...ids('inf_squad').slice(1),
  ];
  // The perimeter is indefensible and not an objective: fall back at once.
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: holders, ...M(34, 24) });
    sim.queueCommand({ kind: 'move', ids: shepherds, ...M(24, 13) });
  });
  // Sweep the north village, then the south, then run east to the yard.
  at(60, () => sim.queueCommand({ kind: 'move', ids: shepherds, ...M(28, 17) }));
  at(140, () => sim.queueCommand({ kind: 'move', ids: shepherds, ...M(24, 33) }));
  at(220, () => sim.queueCommand({ kind: 'move', ids: shepherds, ...M(28, 37) }));
  at(320, () => sim.queueCommand({ kind: 'move', ids: shepherds, ...M(44, 24) }));
  // Then they join the defence.
  at(420, () => sim.queueCommand({ kind: 'attackMove', ids: shepherds, ...M(34, 24) }));
});
```

- [ ] **Step 2: Feed the chain**

Change the recon plan's call so it starts from the breach's ledger. It currently reads `const led1 = run('beit_sahwan_1_recon', (sim, _rt, ids, at) => { ... });` — add `led0` as the third argument, matching how `led2` already passes `led1`:

```ts
const led1 = run('beit_sahwan_1_recon', (sim, _rt, ids, at) => {
  // ...body unchanged...
}, led0);
```

- [ ] **Step 3: Run it**

Run: `cd tools && npx tsx src/backtest/playtest.ts; cd ..`
Expected: a line beginning `beit_sahwan_breach: VICTORY in 13.0 min` (survival is the only primary, so victory lands exactly on the relief clock), and all three later missions still VICTORY. The harness sets a non-zero exit code on any non-victory.

Also read the objective letters on that line. `survive_relief=c` is the win. `hold_strongpoint` and `evac_settlements` are secondary, so `f` on either does **not** fail the run — but both showing `c` is the target, because a plan that survives while abandoning the compound and the villages proves the mission is too easy to be about anything.

- [ ] **Step 4: Tune if it fails, and say what you changed**

If the breach loses, the mission is too hard; if it wins with most of the force alive and ROE near 100, it is too easy for a mission whose premise is catastrophe. Tune in this order, one change at a time, re-running after each:

1. Wave counts in `data/missions/beit_sahwan_breach.json` (±1 `militia_cell` per wave).
2. Wave timings (later waves ease the middle).
3. `starting_force` counts — last resort; the player being thin is the premise.

Do not tune against the §5.7 cost curve: being outnumbered is the point, and `pnpm balance` is not the gate for this mission.

- [ ] **Step 5: Confirm the evacuation is actually achievable**

The playtest line prints objective letters. `evac_settlements=c` means the shepherding route works. If it prints `f`, the route is too slow: move the `at(320, ...)` run-east earlier, or reduce the objective's `count` from 6 to 5. Record which you chose in the commit message.

- [ ] **Step 6: Full gate sweep**

Run: `pnpm test && pnpm test:determinism && pnpm validate:data && pnpm lint && pnpm typecheck`
Expected: all clean, golden hash unchanged.

- [ ] **Step 7: Commit**

```bash
git add tools/src/backtest/playtest.ts data/missions/beit_sahwan_breach.json
git commit -m "test(playtest): First Light is winnable, and its ledger feeds recon

A scripted plan that gives up the perimeter deliberately, walks both
villages out through the eastern yard, and holds the compound to the relief
clock. Recon now starts from the breach's produced ledger, so the whole
Beit Sahwan chain is exercised in one run."
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the `breach` phase → Task 1; shepherding → Task 2; `evacuate_before`, its `failed` status and the visible deadline → Task 3; the map → Task 8; the mission, its objectives, enemy, ROE and ledger contract → Task 7; downstream consumption and graceful degradation → Task 8; the playtest and the difficulty question → Task 9. The spec's two risks (accumulating `hold_for`, tutorial adjacency) are recorded, not implemented — correct, they are accepted and deferred.

**Corrections carried in.** The spec's claims that the status union and HUD need `failed`, and that the determinism hash moves, are both wrong; the plan states the correction up front and Tasks 2 and 3 assert the hash is unchanged rather than updating it. Fix the spec to match when convenient.

**Type consistency.** `SHEPHERD_RADIUS_SQ` (Task 2) is used only in Task 2. `civEvacuated` (Task 3) is declared and used in Task 3 only. `objectiveList` is used in Tasks 3 and 9 and must be verified against the real accessor name in `mission.ts` at Task 3 Step 1. Zone and marker names are declared in Task 4 and consumed by name in Task 5; the four zones (`strongpoint`, `refuge_zone`, `clinic`, `settlements`) and eight markers match exactly between the two tasks. `led0` is produced in Task 9 Step 1 and consumed in Step 2.

**Names verified against source, not assumed.** All three doubtful references were checked and are now stated as fact rather than left as homework: `$defs/placement` allows exactly `unit`, `count`, `at`, `marker`, `facing_deg`, `group`, `tag`, `stance`, `passengers` — and `stance` is an object, which corrected a genuine bug in Task 5's first draft (it had `"stance": "ambush"` with a sibling `ambush_tiles`, both of which `additionalProperties: false` would have rejected). `objectiveList` is a getter at `mission.ts:433`. `packages/sim/package.json` maps `exports["."]` to `./src/index.ts`, so Task 8's script imports resolve.

**Map coordinates are the one thing this plan cannot prove on paper.** The zones, markers and starting positions in Tasks 6 and 7 are internally consistent (every marker and zone Task 7 names is created in Task 4, and no starting position sits inside a structure band), but whether the strongpoint is *holdable* and the shepherding route *walkable* in the time allowed is an empirical question. Task 7 Step 5's `walk_mission` run and Task 9's playtest are where that gets settled, and Task 9 Step 4 gives the tuning order.
