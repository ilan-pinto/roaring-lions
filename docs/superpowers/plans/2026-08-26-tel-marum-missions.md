# Tel Marum Missions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author Tel Marum's three missions — recon, foothold, clearance — so the gateway town of the Sur front becomes playable, and so the narrow saddle finally costs something.

**Architecture:** Missions are declarative JSON in `data/missions/`, validated against `data/schemas/mission.schema.json`, registered in `packages/data/src/index.ts`, and listed in `data/campaign/world.json`. No engine code. The one behavioural idea — the Grad battery fires at whatever *any* Sarim unit has identified, so its spotters are killable — is already supported by the sim (`INDIRECT_MASK` at `sim.ts:223`, per-side contact at `sim.ts:2073`) and needs no change.

**Tech Stack:** TypeScript (strict), JSON Schema (ajv via `tools/validate_data.mjs`), vitest, pnpm. The headless proof harness is `tools/src/backtest/playtest.ts`, run with `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-08-26-tel-marum-missions-design.md`

## Global Constraints

- **No sim code in this slice.** `pnpm test:determinism` must produce an unmoved hash. Any movement is a bug in the work, not a tuning decision.
- **No floating point in `@lions/sim`**, no `Math.*`/`Date.*` — not touched here, but any test helper placed under `packages/sim/` inherits it. Put new tests under `tools/src/`.
- **Missions are data, never TypeScript.** If a mission needs a behaviour the schema cannot express, extend the schema — do not write mission logic.
- **Every mission must be listed by exactly one town** in `data/campaign/world.json`, or `validate_data.mjs:704` fails the build.
- **No region-unlock edits.** Marj → Sur → Naharin re-sequencing is slice 5. `validate_data.mjs:714` enforces an earlier-region ordering constraint a partial edit would violate.
- **Map edits are additive only.** The `rows` character grid and the `elevation` grid of `data/maps/tel_marum.json` are not touched.
- **Sight is measured, never sketched.** Any new claim about what can see what is asserted through the real `Sim` via `sim.debugDetection`, following `tools/src/tel_marum_sight.test.ts`.
- **This worktree is isolated.** Never `git add -A` — other sessions share the parent tree. Stage named paths only.
- **Only these objective types are implemented:** `locate`, `hold_for`, `capture`, `survive_until`, `eliminate_hvt`, `evacuate_before`, `raze`, `collapse`, `destroy_all`. `mark`, `escort` and `no_collateral_above` appear in the schema enum but exist nowhere in `packages/` or `tools/` — authoring one produces an objective that silently never evaluates. Do not use them.
- **The only command kinds the harness uses are `move`, `attackMove`, `chargeTunnel`, `demolish`.** There is no `attack`.
- Tags and names used across tasks, fixed here so tasks agree: `tm_hvt_battery`, `tm_spotter_west`, `tm_spotter_narrow`, `tm_pocket_east`, `tm_pocket_west`, `tm_bay_lip`, `tm_picket_wide`, `tm_manpad`; zones `approach` and `town_block`; marker `sarim_west`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `data/maps/tel_marum.json` | add zones `approach` and `town_block`, marker `sarim_west` | 1 |
| `tools/src/tel_marum_doctrine.test.ts` | assert the sight/range facts the missions rest on | 1 |
| `data/missions/tel_marum_1_recon.json` | mission I | 2 |
| `data/missions/tel_marum_2_foothold.json` | mission II | 3 |
| `data/missions/tel_marum_3_clearance.json` | mission III | 4 |
| `data/campaign/world.json` | list the three ids under `sur.towns[tel_marum]` | 2, 3, 4 |
| `packages/data/src/index.ts` | import + register each mission | 2, 3, 4 |
| `tools/src/backtest/playtest.ts` | one scripted plan + one no-orders control per mission | 2, 3, 4 |
| `CLAUDE.md` | retire the resolved saddle debt bullet | 5 |

Each mission task is self-contained: JSON, registration, world listing, plan and control ship together, because a mission that is authored but unlisted fails `validate:data` and a mission that is listed but unproven is not done.

---

### Task 1: The doctrine, as assertions

Pin the facts the three missions depend on *before* authoring them, and add the map's two new zones and one new marker. `tools/src/tel_marum_sight.test.ts` already exists and covers the map's original sight lines — this is its companion, covering the battery envelope and the spotter geometry.

**Files:**
- Create: `tools/src/tel_marum_doctrine.test.ts`
- Modify: `data/maps/tel_marum.json` (add two zones, one marker — grids untouched)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: zone `approach` = `[21,22,7,5]`, zone `town_block` = `[24,3,3,2]`, marker `sarim_west` = `[8,4]` in `maps.tel_marum`. `approach` is used by Task 3, `town_block` and `sarim_west` by Task 4.

- [ ] **Step 1: Write the failing test**

Create `tools/src/tel_marum_doctrine.test.ts`:

```ts
// Tel Marum's standoff doctrine, as assertions.
//
// The missions rest on three claims that arithmetic cannot settle: what the
// west pocket can see, what the northern valley can see into the narrow
// corridor, and what the Grad battery can reach. Range is arithmetic; sight is
// not, and a ray drawn by eye got all three wrong during design. Every claim
// here is driven through the real Sim.
//
// Every negative is paired with a positive on the same geometry. A test that
// only asserts "cannot see" passes when the spawn is broken, when sight range
// is too short, or when detection never ran.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

/** Sight far past anything on this map, so only terrain can hide. The longest
 *  ray here is the battery to the start line, 38 tiles, inside 48. */
const OBSERVER: UnitTypeJson = {
  id: 't_observer',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 48, signature: 0.6 },
};

type Pt = readonly [number, number];

function sees(a: Pt, b: Pt): boolean {
  const map = parseMap(maps.tel_marum as MapJson);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const t = sim.addUnitType(OBSERVER);
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  const detection = sim.debugDetection(watcher, target);
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return detection.visible;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** grad_122, from data/units/enemy/rocket_battery.json. */
const GRAD_RANGE = 20;
const GRAD_MIN_RANGE = 4;

const BATTERY: Pt = [25, 6];
const HOLLOW: Pt = [24, 29];
const APPROACH: Pt = [24, 24];
const START: Pt = [24, 44];
const SADDLE_NARROW: Pt = [10, 14];
const SADDLE_WIDE: Pt = [24, 14];
const PASS: Pt = [24, 12];
const OVERWATCH_W: Pt = [20, 16];
const SPOTTER_NARROW: Pt = [12, 4];

describe("the Grad battery's envelope", () => {
  it('reaches both saddles, the pass and the approach', () => {
    for (const p of [PASS, SADDLE_WIDE, SADDLE_NARROW, APPROACH]) {
      const d = dist(BATTERY, p);
      expect(d).toBeGreaterThan(GRAD_MIN_RANGE);
      expect(d).toBeLessThanOrEqual(GRAD_RANGE);
    }
  });

  it('reaches the narrow saddle that the Kornet pockets cannot', () => {
    // The whole point of the flank's price: 17.0 for the battery, and the
    // pocket is both out of range and behind rock (asserted below).
    expect(dist(BATTERY, SADDLE_NARROW)).toBeCloseTo(17.0, 1);
    expect(dist(BATTERY, SADDLE_NARROW)).toBeLessThanOrEqual(GRAD_RANGE);
  });

  it('does not reach the hollow or the start line', () => {
    expect(dist(BATTERY, HOLLOW)).toBeGreaterThan(GRAD_RANGE);
    expect(dist(BATTERY, START)).toBeGreaterThan(GRAD_RANGE);
  });
});

describe('the west pocket', () => {
  it('sees the approach, so the battery can be given eyes on it', () => {
    expect(sees(OVERWATCH_W, APPROACH)).toBe(true);
  });

  it('cannot see the hollow, so the hollow is dead ground twice over', () => {
    // Out of the battery's range AND unobservable. This is why foothold holds
    // the approach rather than the hollow.
    expect(sees(OVERWATCH_W, HOLLOW)).toBe(false);
  });

  it('cannot see the narrow saddle — the debt this front was left with', () => {
    // Not a near miss on range: x=12..18 at y=15..17 is solid rock between
    // them. Paired with the positive above so a broken spawn cannot pass.
    expect(sees(OVERWATCH_W, SADDLE_NARROW)).toBe(false);
  });
});

describe('the narrow corridor', () => {
  it('is watched from the northern valley along its whole length', () => {
    for (const y of [13, 15, 17]) {
      expect(sees(SPOTTER_NARROW, [10, y] as Pt)).toBe(true);
    }
  });

  it('is not watched from its own mouth', () => {
    // [8,9] sits at the corridor's north mouth and sees nothing down it.
    expect(sees([8, 9] as Pt, SADDLE_NARROW)).toBe(false);
  });

  it('leaves its watcher inside the battery envelope', () => {
    // So taking the flank puts the player on top of the thing pricing it.
    expect(dist(SPOTTER_NARROW, BATTERY)).toBeLessThanOrEqual(GRAD_RANGE);
  });
});

describe('the approach zone', () => {
  const zone = () => {
    const z = (maps.tel_marum as MapJson).zones?.approach;
    if (!z) throw new Error('map has no "approach" zone');
    return z;
  };

  it('exists, and every tile in it is open ground', () => {
    const [x, y, w, h] = zone();
    const rows = (maps.tel_marum as MapJson).rows;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) expect(rows[j][i]).toBe('.');
  });

  it('is a gradient, not a kill box', () => {
    // Held ground that is uniformly lethal is an endurance check. Held ground
    // where only part is both spottable and shellable is a decision.
    const [x, y, w, h] = zone();
    const tiles: Pt[] = [];
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) tiles.push([i, j] as Pt);
    const both = tiles.filter((p) => dist(p, BATTERY) <= GRAD_RANGE && sees(OVERWATCH_W, p));
    expect(both.length).toBeGreaterThan(0);
    expect(both.length).toBeLessThan(tiles.length);
  });

  it('contains the approach marker', () => {
    const [x, y, w, h] = zone();
    const [mx, my] = (maps.tel_marum as MapJson).markers.approach;
    expect(mx).toBeGreaterThanOrEqual(x);
    expect(mx).toBeLessThan(x + w);
    expect(my).toBeGreaterThanOrEqual(y);
    expect(my).toBeLessThan(y + h);
  });
});

describe('the western wave source', () => {
  it('stands on open ground behind the narrow saddle', () => {
    const [x, y] = (maps.tel_marum as MapJson).markers.sarim_west;
    expect((maps.tel_marum as MapJson).rows[y][x]).toBe('.');
    expect(y).toBeLessThan(12); // north of the wall
  });
});

describe('the flagged town block', () => {
  it('covers structures and nothing else', () => {
    // ROE has to have something to be about. Tel Marum fields no civilians,
    // so without a flagged zone the score sits at 100 and the HUD teaches
    // nothing. These six tiles are the only structures on the map.
    const z = (maps.tel_marum as MapJson).zones?.town_block;
    if (!z) throw new Error('map has no "town_block" zone');
    const [x, y, w, h] = z;
    const rows = (maps.tel_marum as MapJson).rows;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) expect(rows[j][i]).toBe('#');
  });

  it('sits inside the battery splash radius, so shelling the Grad is a choice', () => {
    const z = (maps.tel_marum as MapJson).zones?.town_block;
    if (!z) throw new Error('map has no "town_block" zone');
    const [x, y, w, h] = z;
    let nearest = Infinity;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) nearest = Math.min(nearest, dist([i, j] as Pt, BATTERY));
    expect(nearest).toBeLessThan(4);
  });
});
```

- [ ] **Step 2: Run it and confirm the zone/marker cases fail**

Run: `npx vitest run tools/src/tel_marum_doctrine.test.ts`

Expected: the battery-envelope, west-pocket and narrow-corridor blocks PASS (they describe the map as shipped). The four `approach zone` cases FAIL with `map has no "approach" zone`, both `flagged town block` cases FAIL with `map has no "town_block" zone`, and `the western wave source` FAILS on `markers.sarim_west` being undefined. That red is the point — it is what the map edit turns green.

- [ ] **Step 3: Add the zone and the marker**

In `data/maps/tel_marum.json`, add one entry to `markers` and one to `zones`. Do not touch `rows` or `elevation`.

```json
  "markers": {
    "start_line": [24, 44],
    "hollow": [24, 29],
    "approach": [24, 24],
    "saddle_wide": [24, 14],
    "saddle_narrow": [10, 14],
    "pass": [24, 12],
    "overwatch_east": [28, 16],
    "overwatch_west": [20, 16],
    "battery_position": [25, 6],
    "town_edge": [25, 2],
    "sarim_west": [8, 4]
  },
  "zones": {
    "valley_floor": [6, 18, 36, 30],
    "pass": [22, 12, 5, 6],
    "overwatch_east": [27, 15, 3, 3],
    "overwatch_west": [19, 15, 3, 3],
    "approach": [21, 22, 7, 5],
    "town_block": [24, 3, 3, 2]
  }
```

Preserve the file's existing formatting for the untouched keys — only insert the three new lines.

- [ ] **Step 4: Run the test and confirm green**

Run: `npx vitest run tools/src/tel_marum_doctrine.test.ts`
Expected: PASS, all blocks.

- [ ] **Step 5: Run the data validator**

Run: `pnpm validate:data`
Expected: PASS. The map still validates against `map.schema.json`; no mission references the new zone yet.

- [ ] **Step 6: Commit**

```bash
git add tools/src/tel_marum_doctrine.test.ts data/maps/tel_marum.json
git commit -m "test(tools): Tel Marum's standoff doctrine, as assertions

The three missions rest on claims arithmetic cannot settle. The west
pocket sees the approach and not the hollow; the narrow corridor is
watched from the northern valley and not from its own mouth; the Grad
reaches both saddles and neither the hollow nor the start line.

Adds the approach zone the foothold mission holds and the sarim_west
marker the clearance waves come from. Grids untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Mission I — Recon

**Files:**
- Create: `data/missions/tel_marum_1_recon.json`
- Modify: `data/campaign/world.json` (list the id)
- Modify: `packages/data/src/index.ts` (import + register)
- Modify: `tools/src/backtest/playtest.ts` (scripted plan + no-orders control)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime; the doctrine test guards the geometry this mission assumes.
- Produces: mission id `tel_marum_1_recon`; enemy tags `tm_pocket_east`, `tm_pocket_west`, `tm_hvt_battery`, `tm_spotter_west`, reused by Tasks 3 and 4. Ledger key `intel.marked_positions`, consumed by Task 3.

- [ ] **Step 1: Write the mission JSON**

Create `data/missions/tel_marum_1_recon.json`:

```json
{
  "id": "tel_marum_1_recon",
  "name": "Tel Marum I — The Gateway",
  "town": "tel_marum",
  "phase": "recon",
  "target_minutes": 7,
  "briefing": "Sur begins at the pass, and the pass is watched. Rockets have been falling on the north for a week and nobody can say from where, so tonight you find out. Push the drone up the valley and build the picture — two ATGM pockets on the wall, a Grad section behind it, and whoever is feeding them targets. Keep the metal in the hollow: the valley floor south of it is out of the battery's reach, and everything north of it is not. Bring back the picture, not casualties.",
  "map": {
    "file": "tel_marum",
    "player_start": [24, 44]
  },
  "ledger": {
    "requires": ["roster.surviving_units"],
    "produces": [
      "roster.surviving_units",
      "roe.mission_ratings",
      "campaign.completed_missions",
      "intel.marked_positions"
    ]
  },
  "starting_force": [
    { "unit": "recon_drone", "count": 1, "at": [24, 42] },
    { "unit": "jeep_shoded", "count": 1, "at": [22, 43] },
    { "unit": "inf_squad", "count": 3, "at": [24, 44], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [26, 44], "from_ledger": true },
    { "unit": "apc_eitan", "count": 1, "at": [22, 45] }
  ],
  "objectives": [
    {
      "id": "picture",
      "type": "locate",
      "primary": true,
      "count": 4,
      "text": "Identify four firing positions"
    },
    {
      "id": "find_battery",
      "type": "locate",
      "primary": false,
      "target": "tm_hvt_battery",
      "text": "Find the Grad section behind the wall"
    },
    {
      "id": "screen_out",
      "type": "survive_until",
      "primary": false,
      "seconds": 240,
      "text": "Stay in the field for four minutes"
    }
  ],
  "roe": {
    "enabled": true
  },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      {
        "unit": "atgm_cell",
        "count": 1,
        "at": [28.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_pocket_east"
      },
      {
        "unit": "atgm_cell",
        "count": 1,
        "at": [19.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_pocket_west"
      },
      {
        "unit": "sarim_rifles",
        "count": 1,
        "at": [20.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_spotter_west"
      },
      {
        "unit": "sarim_rifles",
        "count": 1,
        "at": [24.5, 13.5],
        "facing_deg": 180,
        "tag": "tm_picket_wide"
      },
      {
        "unit": "recoilless_team",
        "count": 1,
        "at": [26.5, 16.5],
        "facing_deg": 180,
        "stance": { "kind": "ambush", "tiles": 4 },
        "tag": "tm_bay_lip"
      },
      {
        "unit": "rocket_battery",
        "count": 1,
        "at": [25.5, 6.5],
        "facing_deg": 180,
        "tag": "tm_hvt_battery"
      }
    ]
  },
  "triggers": []
}
```

- [ ] **Step 2: Register it and list it**

In `packages/data/src/index.ts`, add the import beside the other mission imports (keep them grouped and alphabetical within the town):

```ts
import telMarum1Recon from '../../../data/missions/tel_marum_1_recon.json';
```

and add the entry to the `missions` object, after the `beit_sahwan_*` block and before `wadi_halam_1_fords`:

```ts
  tel_marum_1_recon: telMarum1Recon,
```

In `data/campaign/world.json`, under the `sur` region's `tel_marum` town:

```json
        {
          "id": "tel_marum",
          "name": "Tel Marum",
          "at": [421.4, 55.9],
          "missions": ["tel_marum_1_recon"]
        },
```

- [ ] **Step 3: Run the validator and typecheck**

Run: `pnpm validate:data && pnpm typecheck`

Expected: both PASS. If `validate:data` reports *"no town in world.json lists it"*, the `world.json` edit was missed. If `typecheck` fails on a literal-union field, the mission JSON has a value the generated type does not admit — fix the JSON, not the type.

- [ ] **Step 4: Add the scripted plan and the no-orders control**

In `tools/src/backtest/playtest.ts`, append after the Wadi Halam block:

```ts
// Tel Marum I — the picture, taken from dead ground.
//
// The mission is a recon and the whole trick is that the hollow at [24,29] is
// 23 tiles from the battery and the approach at [24,24] is 18. The drone goes
// forward alone; everything with a crew stays south of the hollow. Four
// positions is the objective and the drone can see all four from the approach
// without stopping there.
//
// Control: a player who gives no orders never moves the drone, so the picture
// is never built and the primary cannot complete. That must LOSE.
run('tel_marum_1_recon', () => {}, {}, 'defeat', 'tel_marum_1_recon (passive control)');

run(
  'tel_marum_1_recon',
  (sim, rt, ids, at) => {
    const drone = ids('recon_drone');
    const screen = ids('apc_eitan');
    const foot = ids('inf_squad');
    at(4, () => {
      // Screen forward to the hollow and stop there — out of the envelope.
      sim.queueCommand({ kind: 'move', ids: screen, ...M(24, 30) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(23, 31) });
      // The drone alone goes into the envelope.
      sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 25) });
    });
    at(40, () => {
      // Sweep west then east along the wall to pick up both pockets and the
      // picket without loitering on any one of them.
      sim.queueCommand({ kind: 'move', ids: drone, ...M(19, 19) });
    });
    at(75, () => {
      sim.queueCommand({ kind: 'move', ids: drone, ...M(28, 19) });
    });
    at(110, () => {
      // Far enough north to raise the battery, then straight back out.
      sim.queueCommand({ kind: 'move', ids: drone, ...M(25, 17) });
    });
    at(140, () => {
      sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 31) });
    });
  },
  {},
  'victory',
  'tel_marum_1_recon'
);
```

- [ ] **Step 5: Run the harness**

Run: `npx tsx tools/src/backtest/playtest.ts`

Expected: `tel_marum_1_recon (passive control): DEFEAT` and `tel_marum_1_recon: VICTORY`, and every pre-existing line unchanged. The harness exits 0.

If the scripted run loses, read the printed `objectives` field — `picture=f` means fewer than four positions were identified (extend the sweep or hold each leg longer); `screen_out=f` means the force died (the screen went too far north). If the *control* wins, the mission completes without orders and the objectives are too weak — that is a mission bug, not a plan bug.

- [ ] **Step 6: Run the full gate sweep**

Run: `pnpm validate:data && pnpm typecheck && pnpm test && pnpm test:determinism`
Expected: all PASS, determinism hash unmoved.

- [ ] **Step 7: Commit**

```bash
git add data/missions/tel_marum_1_recon.json data/campaign/world.json packages/data/src/index.ts tools/src/backtest/playtest.ts
git commit -m "feat(data): Tel Marum I — the picture, taken from dead ground

The gateway's first mission is a recon with one lesson: the hollow is 23
tiles from the Grad and the approach is 18. The drone goes into the
envelope; nothing with a crew does.

The battery is live from the first mission rather than scripted silent,
so the geography of the 20-tile circle is the teaching.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Mission II — Foothold

**Files:**
- Create: `data/missions/tel_marum_2_foothold.json`
- Modify: `data/campaign/world.json`
- Modify: `packages/data/src/index.ts`
- Modify: `tools/src/backtest/playtest.ts`

**Interfaces:**
- Consumes: zone `approach` from Task 1; tags `tm_spotter_west`, `tm_hvt_battery`, `tm_pocket_east`, `tm_pocket_west` from Task 2; ledger key `intel.marked_positions` produced by Task 2.
- Produces: mission id `tel_marum_2_foothold`.

- [ ] **Step 1: Write the mission JSON**

Create `data/missions/tel_marum_2_foothold.json`:

```json
{
  "id": "tel_marum_2_foothold",
  "name": "Tel Marum II — The Start Line",
  "town": "tel_marum",
  "phase": "foothold",
  "target_minutes": 6,
  "briefing": "The picture says the Grad cannot see past the wall — so somebody is telling it where to shoot. Take the approach and hold it for four minutes while the engineers mark the start line behind you. You will be shelled the moment you are seen, and the man doing the seeing is in the west pocket on the wall. Kill him and the rockets stop falling. Not every tile of the approach is watched: pick your ground before you are made to.",
  "map": {
    "file": "tel_marum",
    "player_start": [24, 44]
  },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": [
      "roster.surviving_units",
      "roe.mission_ratings",
      "campaign.completed_missions"
    ]
  },
  "starting_force": [
    { "unit": "inf_squad", "count": 3, "at": [24, 44], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [26, 44], "from_ledger": true },
    { "unit": "apc_eitan", "count": 2, "at": [22, 45] },
    { "unit": "mbt_lavi", "count": 1, "at": [26, 45] },
    { "unit": "mortar_team", "count": 1, "at": [24, 46] }
  ],
  "objectives": [
    {
      "id": "hold_approach",
      "type": "hold_for",
      "primary": true,
      "target": "approach",
      "seconds": 240,
      "text": "Hold the approach for four minutes"
    },
    {
      "id": "kill_spotter",
      "type": "eliminate_hvt",
      "primary": true,
      "target": "tm_spotter_west",
      "text": "Kill the observer in the west pocket"
    }
  ],
  "roe": {
    "enabled": true
  },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      {
        "unit": "sarim_rifles",
        "count": 1,
        "at": [20.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_spotter_west"
      },
      {
        "unit": "atgm_cell",
        "count": 1,
        "at": [19.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_pocket_west"
      },
      {
        "unit": "atgm_cell",
        "count": 1,
        "at": [28.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_pocket_east"
      },
      {
        "unit": "recoilless_team",
        "count": 1,
        "at": [26.5, 16.5],
        "facing_deg": 180,
        "stance": { "kind": "ambush", "tiles": 4 },
        "tag": "tm_bay_lip"
      },
      {
        "unit": "sarim_rifles",
        "count": 1,
        "at": [24.5, 13.5],
        "facing_deg": 180,
        "tag": "tm_picket_wide"
      },
      {
        "unit": "rocket_battery",
        "count": 1,
        "at": [25.5, 6.5],
        "facing_deg": 180,
        "tag": "tm_hvt_battery"
      }
    ],
    "waves": [
      {
        "at_seconds": 120,
        "to": "saddle_wide",
        "units": [{ "unit": "sarim_rifles", "count": 1, "from": "town_edge" }]
      },
      {
        "at_seconds": 210,
        "to": "saddle_wide",
        "units": [{ "unit": "recoilless_team", "count": 1, "from": "town_edge" }]
      }
    ]
  },
  "triggers": []
}
```

- [ ] **Step 2: Register it and list it**

In `packages/data/src/index.ts`:

```ts
import telMarum2Foothold from '../../../data/missions/tel_marum_2_foothold.json';
```

and in the `missions` object, directly after `tel_marum_1_recon`:

```ts
  tel_marum_2_foothold: telMarum2Foothold,
```

In `data/campaign/world.json`, extend the town's array:

```json
          "missions": ["tel_marum_1_recon", "tel_marum_2_foothold"]
```

- [ ] **Step 3: Run the validator and typecheck**

Run: `pnpm validate:data && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 4: Add the scripted plan and the no-orders control**

In `tools/src/backtest/playtest.ts`, append after the Task 2 block:

```ts
// Tel Marum II — the start line, and the man who calls the fire.
//
// The approach is 35 tiles and only 18 of them are both visible to the west
// pocket and inside the Grad's reach. The plan takes the southern edge of the
// zone, which counts for the hold and is the cheapest ground in it, then sends
// infantry up the west side of the bay to kill the observer. Once he is dead
// the battery has no eyes and the remaining hold is uncontested.
//
// Control: a player who gives no orders never enters the approach, so
// hold_for never starts. That must LOSE.
run('tel_marum_2_foothold', () => {}, {}, 'defeat', 'tel_marum_2_foothold (passive control)');

run(
  'tel_marum_2_foothold',
  (sim, rt, ids, at) => {
    const armour = ids('apc_eitan');
    const tank = ids('mbt_lavi');
    const foot = ids('inf_squad');
    const at_ = ids('at_team');
    const mortar = ids('mortar_team');
    at(3, () => {
      // Into the southern edge of the approach zone — inside it for the hold,
      // furthest from the battery.
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 26) });
      sim.queueCommand({ kind: 'move', ids: tank, ...M(26, 26) });
      sim.queueCommand({ kind: 'move', ids: at_, ...M(25, 26) });
      // Mortar stays in the hollow: 18 tiles of reach covers the bay lip from
      // ground the Grad cannot touch.
      sim.queueCommand({ kind: 'move', ids: mortar, ...M(24, 29) });
    });
    at(20, () => {
      // Infantry up the west side toward the pocket.
      sim.queueCommand({ kind: 'move', ids: foot, ...M(20, 22) });
    });
    at(70, () => {
      sim.queueCommand({ kind: 'move', ids: foot, ...M(20, 17) });
    });
    at(110, () => {
      sim.queueCommand({ kind: 'attackMove', ids: foot, ...M(20, 16) });
    });
  },
  {},
  'victory',
  'tel_marum_2_foothold'
);
```

- [ ] **Step 5: Run the harness**

Run: `npx tsx tools/src/backtest/playtest.ts`

Expected: `tel_marum_2_foothold (passive control): DEFEAT` and `tel_marum_2_foothold: VICTORY`.

Diagnosing a loss from the printed `objectives`: `hold_approach=f` means the zone was vacated — the holding group died or drifted out; `kill_spotter=f` means the infantry never reached the pocket, so lengthen the approach march or send a second squad. If `clean=f`, the mortar is firing into the bay with too much splash — that is ROE working, and the plan should stop shelling rather than the threshold move.

- [ ] **Step 6: Confirm the mechanic actually fired**

This mission's whole claim is that the battery shoots because the spotter sees. Confirm it rather than assume it: temporarily change the plan's `at(110, ...)` attack to fire at 20 seconds instead, re-run, and check the mission still reaches VICTORY *faster* and with more surviving roster. Then restore `at(110, ...)`.

Expected: killing the observer early measurably reduces losses. If it makes no difference, the battery was never firing at the held group and the mission is not teaching what it claims — stop and report before continuing.

- [ ] **Step 7: Full gate sweep and commit**

Run: `pnpm validate:data && pnpm typecheck && pnpm test && pnpm test:determinism`

```bash
git add data/missions/tel_marum_2_foothold.json data/campaign/world.json packages/data/src/index.ts tools/src/backtest/playtest.ts
git commit -m "feat(data): Tel Marum II — indirect fire is a man on a hill

Hold the approach for four minutes while a Grad you cannot see shells a
zone you are required to stand in. The battery fires because the observer
in the west pocket sees; kill him and it stops.

The approach is a gradient rather than a kill box: 24 of its 35 tiles are
watched, 29 are in range, and only 18 are both.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Mission III — Clearance

**Files:**
- Create: `data/missions/tel_marum_3_clearance.json`
- Modify: `data/campaign/world.json`
- Modify: `packages/data/src/index.ts`
- Modify: `tools/src/backtest/playtest.ts`

**Interfaces:**
- Consumes: marker `sarim_west` from Task 1; the tag vocabulary from Task 2; the spotter mechanic proven in Task 3.
- Produces: mission id `tel_marum_3_clearance`; completes the town's `missions` array.

- [ ] **Step 1: Write the mission JSON**

Create `data/missions/tel_marum_3_clearance.json`:

```json
{
  "id": "tel_marum_3_clearance",
  "name": "Tel Marum III — The Pass",
  "town": "tel_marum",
  "phase": "clearance",
  "target_minutes": 7,
  "briefing": "Two ways through the wall and neither is free. The wide saddle is covered by both Kornet pockets and will cost you vehicles. The narrow one costs nine extra tiles and no missiles — but the Grad reaches it, and there is a second observer in the northern valley who will call it down on you. Whichever way you go, deal with the eyes first. Take the pass, and put the battery out of the war.",
  "map": {
    "file": "tel_marum",
    "player_start": [24, 44]
  },
  "ledger": {
    "requires": ["roster.surviving_units"],
    "produces": [
      "roster.surviving_units",
      "roe.mission_ratings",
      "campaign.completed_missions"
    ]
  },
  "starting_force": [
    { "unit": "inf_squad", "count": 3, "at": [24, 44], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [26, 44], "from_ledger": true },
    { "unit": "mbt_lavi", "count": 2, "at": [26, 45] },
    { "unit": "apc_eitan", "count": 2, "at": [22, 45] },
    { "unit": "ifv_namer", "count": 1, "at": [20, 45] },
    { "unit": "mortar_team", "count": 1, "at": [24, 46] }
  ],
  "objectives": [
    {
      "id": "take_pass",
      "type": "capture",
      "primary": true,
      "target": "pass",
      "seconds": 20,
      "text": "Take the pass and hold it for 20 seconds"
    },
    {
      "id": "kill_battery",
      "type": "eliminate_hvt",
      "primary": true,
      "target": "tm_hvt_battery",
      "text": "Destroy the Grad section"
    }
  ],
  "roe": {
    "enabled": true,
    "flagged_zones": ["town_block"],
    "fail_below": 45
  },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      {
        "unit": "atgm_cell",
        "count": 1,
        "at": [19.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_pocket_west"
      },
      {
        "unit": "atgm_cell",
        "count": 1,
        "at": [28.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_pocket_east"
      },
      {
        "unit": "sarim_rifles",
        "count": 1,
        "at": [20.5, 16.5],
        "facing_deg": 180,
        "tag": "tm_spotter_west"
      },
      {
        "unit": "sarim_rifles",
        "count": 1,
        "at": [12.5, 4.5],
        "facing_deg": 180,
        "tag": "tm_spotter_narrow"
      },
      {
        "unit": "recoilless_team",
        "count": 1,
        "at": [26.5, 16.5],
        "facing_deg": 180,
        "stance": { "kind": "ambush", "tiles": 4 },
        "tag": "tm_bay_lip"
      },
      {
        "unit": "sarim_rifles",
        "count": 1,
        "at": [24.5, 13.5],
        "facing_deg": 180,
        "tag": "tm_picket_wide"
      },
      {
        "unit": "manpad_team",
        "count": 1,
        "at": [23.5, 8.5],
        "facing_deg": 180,
        "tag": "tm_manpad"
      },
      {
        "unit": "rocket_battery",
        "count": 1,
        "at": [25.5, 6.5],
        "facing_deg": 180,
        "tag": "tm_hvt_battery"
      }
    ],
    "waves": [
      {
        "at_seconds": 150,
        "to": "saddle_narrow",
        "units": [{ "unit": "sarim_rifles", "count": 1, "from": "sarim_west" }]
      },
      {
        "at_seconds": 240,
        "to": "pass",
        "units": [{ "unit": "recoilless_team", "count": 1, "from": "town_edge" }]
      }
    ]
  },
  "triggers": []
}
```

- [ ] **Step 2: Register it and list it**

In `packages/data/src/index.ts`:

```ts
import telMarum3Clearance from '../../../data/missions/tel_marum_3_clearance.json';
```

and in the `missions` object, after `tel_marum_2_foothold`:

```ts
  tel_marum_3_clearance: telMarum3Clearance,
```

In `data/campaign/world.json`:

```json
          "missions": ["tel_marum_1_recon", "tel_marum_2_foothold", "tel_marum_3_clearance"]
```

- [ ] **Step 3: Run the validator and typecheck**

Run: `pnpm validate:data && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 4: Add the scripted plan and the no-orders control**

In `tools/src/backtest/playtest.ts`, append after the Task 3 block:

```ts
// Tel Marum III — the pass, taken the expensive way on purpose.
//
// The plan takes the WIDE saddle. That is the costly route and it is chosen
// deliberately: the narrow saddle is nine tiles longer and its price is the
// Grad, which means the flank only pays once its observer at [12,4] is dead —
// and reaching him means going through the corridor the rockets already cover.
// A scripted proof should demonstrate the mission is winnable by the obvious
// line, not by the clever one.
//
// Mortars kill the west pocket's observer from the hollow first, because every
// tile of the wide saddle is inside the Grad's reach and being seen there is
// what makes it lethal rather than merely defended.
//
// Control: no orders means nobody enters the pass and the battery lives. LOSE.
run('tel_marum_3_clearance', () => {}, {}, 'defeat', 'tel_marum_3_clearance (passive control)');

run(
  'tel_marum_3_clearance',
  (sim, rt, ids, at) => {
    const tanks = ids('mbt_lavi');
    const namer = ids('ifv_namer');
    const armour = ids('apc_eitan');
    const foot = ids('inf_squad');
    const at_ = ids('at_team');
    const mortar = ids('mortar_team');
    at(3, () => {
      // Mortar into the hollow — 18 tiles of reach onto the wall, out of the
      // Grad's 20-tile circle at 23.
      sim.queueCommand({ kind: 'move', ids: mortar, ...M(24, 29) });
      sim.queueCommand({ kind: 'move', ids: at_, ...M(25, 28) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(23, 27) });
    });
    at(30, () => {
      // Kill the west observer before anything crosses the approach.
      sim.queueCommand({ kind: 'attackMove', ids: mortar, ...M(20, 16) });
    });
    at(85, () => {
      // Armour forward through the approach to the wide saddle mouth.
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 22) });
      sim.queueCommand({ kind: 'move', ids: tanks, ...M(25, 22) });
      sim.queueCommand({ kind: 'move', ids: namer, ...M(24, 23) });
    });
    at(130, () => {
      sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(28, 16) });
      sim.queueCommand({ kind: 'attackMove', ids: namer, ...M(20, 16) });
    });
    at(190, () => {
      sim.queueCommand({ kind: 'move', ids: tanks, ...M(24, 13) });
      sim.queueCommand({ kind: 'move', ids: armour, ...M(24, 14) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(24, 15) });
    });
    at(240, () => {
      // Into the pass zone, then the battery beyond it.
      sim.queueCommand({ kind: 'move', ids: foot, ...M(24, 12) });
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 12) });
      sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(25, 6) });
    });
  },
  {},
  'victory',
  'tel_marum_3_clearance'
);
```

- [ ] **Step 5: Run the harness**

Run: `npx tsx tools/src/backtest/playtest.ts`

Expected: `tel_marum_3_clearance (passive control): DEFEAT` and `tel_marum_3_clearance: VICTORY`, and all nine pre-existing missions still reporting their previous results. The harness exits 0.

Diagnosing a loss: `take_pass=f` means nothing survived to sit in the `pass` zone for 20 seconds — the armour died crossing, so kill the west observer earlier or push the mortar's suppression harder. `kill_battery=f` means the tanks never got a shot at [25,6]; the `manpad_team` at [23.5,8.5] guards that ground, so it may need engaging first.

- [ ] **Step 6: Measure the flank, and record what it costs**

The point of this mission is that both routes now cost something. Measure it rather than assert it. Duplicate the scripted plan under the temporary label `tel_marum_3_clearance (narrow)`, replacing the `at(85)`/`at(190)` legs with a western route through `[12,20] → [10,16] → [10,12] → [14,6]`, and run the harness.

Record for the report: victory or defeat, minutes, and `roster out` for both routes. Then delete the temporary run — it is a measurement, not a gate.

Expected: the narrow route is slower and, if its observer is left alive, at least as costly. If the narrow route is both faster *and* cheaper, the flank is still free and the mission has not done its job — stop and report the numbers rather than proceeding.

- [ ] **Step 7: Full gate sweep and commit**

Run: `pnpm validate:data && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm balance`

```bash
git add data/missions/tel_marum_3_clearance.json data/campaign/world.json packages/data/src/index.ts tools/src/backtest/playtest.ts
git commit -m "feat(data): Tel Marum III — both ways through the wall now cost

The wide saddle costs vehicles to the Kornet pockets. The narrow one
costs nine tiles and the Grad, which reaches it at 17 where the pockets
cannot at 10 — but only while the observer at [12,4] lives.

That prices the flank in mission data, using terrain exactly as authored,
with the rule the foothold mission taught.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Retire the resolved debt and walk it in the browser

The saddle debt in `CLAUDE.md` says the doctrine "never fires until a Tel Marum mission charges for that route some other way". Task 4 is that mission. The bullet now describes solved ground and must not outlive it.

**Files:**
- Modify: `CLAUDE.md` (the final "Known scaling debts" bullet)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Drive each mission in the real UI**

Run: `pnpm dev`, then open each of:
- `?sandbox=tel_marum` — confirm the new `approach` zone draws and the `sarim_west` marker resolves via `__lions.goto('sarim_west')`
- each mission from the campaign shell

Console shortcuts skip the code that breaks, so start each mission from the shell rather than via `__lions`. Confirm: objectives render with their text, the ROE HUD shows a score, and the Grad's fire actually lands on the approach in mission II.

Note anything cosmetic that looks wrong — Tel Marum is the first map with relief, so wrecks or tracers may sort behind ridges and VFX may not lift to terrain height. **Report these; do not fix them.** They are known-inert gaps outside this slice.

- [ ] **Step 2: Replace the debt bullet**

In `CLAUDE.md`, replace the final bullet of "Known scaling debts" (the one beginning *"Tel Marum's two saddles are supposed to be unequal"*) with:

```markdown
- Tel Marum's two saddles are unequal, and the pricing lives in the missions rather than
  the ground. A hollow → west flank → narrow saddle → battery route is +9 tiles (38 vs
  47) and crosses no tile either overwatch pocket can both see and reach at the
  `atgm_cell`'s 10-tile Kornet range — that part of the terrain is unchanged and correct.
  What charges for it is the Grad at `battery_position`, which reaches the narrow saddle
  at 17 tiles, but only while a spotter feeds it: `rocket` is in `INDIRECT_MASK`
  (`sim.ts:223`) so it needs no sight of its own, and `sim.ts:2073` gates every shot on
  **per-side** identification. `tel_marum_3_clearance` places that spotter at [12,4], the
  one ground in the northern valley that watches the corridor's whole length.
  Two sight facts worth keeping: **nothing north of the wall can see the hollow** — 841
  open tiles see [24,29] and not one is at y ≤ 17 — so the hollow is dead ground twice
  over, out of range and unobservable; and the corridor is **not** watchable from its own
  mouth at [8,9]. Both were drawn wrong by eye first. `tools/src/tel_marum_doctrine.test.ts`
  pins all of it.
```

- [ ] **Step 3: Confirm nothing else in CLAUDE.md went stale**

Run: `grep -n 'Tel Marum' CLAUDE.md`

Expected: the elevation bullet still says Tel Marum "has no missions and nothing fights in front of relief yet". That is now false — update that clause to say relief is fought over in the three Tel Marum missions, and that the cosmetic sorting gaps are therefore now reachable, listing anything Step 1 actually observed.

- [ ] **Step 4: Final full sweep**

Run: `pnpm validate:data && pnpm validate:ui && pnpm typecheck && pnpm lint && pnpm test && pnpm test:determinism && pnpm balance`
Then: `npx tsx tools/src/backtest/playtest.ts`

Expected: everything PASS, determinism hash unmoved, harness exits 0 with twelve missions reporting.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the saddle debt is paid, and by a mission

The narrow saddle now costs the Grad's attention rather than nothing.
Records the two sight facts that a ray drawn by eye got wrong — the
hollow is unobservable from every tile north of the wall, and the narrow
corridor is not watchable from its own mouth — and points at the test
that pins them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **`playtest.ts` is in neither `pnpm test` nor CI.** It must be run by hand at every task that touches it. "All gates green" has been said truthfully before while this one was red.
- **A scripted plan proves winnable, not well-paced.** The `target_minutes` values (7 / 6 / 7) are design intent. Record the harness's reported minutes for each mission in the final report and compare against the 0.51–1.00 band the other eight missions hold. A recon mission diverging widely is normal — `beit_sahwan_1_recon` sits at 0.07.
- **If a mission cannot be made winnable by a sensible plan, say so and stop.** Tuning enemy volume until a scripted clock reaches `target_minutes` produces missions no real player can finish.
- **Placement counts spread across tiles.** A `count: 3` group occupies three tiles, so a clear `at` does not guarantee clear ground for its siblings — check the neighbours of every multi-count placement against the grid.
