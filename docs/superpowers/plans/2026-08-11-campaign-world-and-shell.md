# Campaign World and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat mission list with a map of the Sahar Basin whose three regions show live, complete and locked state derived from the campaign ledger.

**Architecture:** `data/campaign/world.json` owns the campaign's logic and text — regions, towns, town positions, mission order, unlocks. `assets/campaign/sahar_basin.svg` owns shape only, one element per region, inlined into the DOM so its token fills resolve. A pure module in `@lions/data` derives region state from `campaign.completed_missions`, so the screen persists nothing of its own. The ROE rating changes from a moving average to the mean of best-per-mission so replaying a mission is meaningful.

**Tech Stack:** TypeScript strict, PixiJS (untouched here), vanilla DOM for UI, vitest, AJV via `tools/validate_data.mjs`, JSON Schema draft 2020-12.

**Spec:** [`docs/superpowers/specs/2026-08-10-campaign-world-and-shell-design.md`](../specs/2026-08-10-campaign-world-and-shell-design.md)

## Global Constraints

- **Sim runs at a fixed 20 Hz tick.** Never drive simulation from frame time.
- **`@lions/sim` uses Q16.16 fixed-point. No floating point, no `Math.*`, no `Date.*`.** Lint enforces it. Tasks 2 and 3 touch this package.
- **All randomness comes from `rng(entityId)`.** No global stream, no `Math.random()`.
- **Data flows one direction: commands in → sim → state + events out.** Nothing outside the sim may mutate sim state. The world map reads the ledger and never touches a sim.
- **Dependency direction is one-way:** `app → render → sim`, `data` is a leaf. The world map's pure logic goes in `@lions/data`, never in `app`.
- **TypeScript strict. No `any`. No non-null assertions in sim code.**
- **No colour literals in UI source.** `packages/app/src/ui/theme.css` is the only file allowed to name a `--rl-*` custom property. Everything else uses semantic tokens. `pnpm validate:ui` rejects a hex or `rgba()` literal with no allowlist; use `color-mix()` for translucency.
- **Content is JSON validated against `data/schemas/`.** Note: CLAUDE.md says `packages/data/schemas/`; the real path is `data/schemas/`.
- **`pnpm test:determinism` must pass before any commit touching `@lions/sim`.** The golden hash in `packages/sim/src/determinism.test.ts` changes only on a deliberate tuning change, in the same commit, with a stated reason. Tasks 2 and 3 must leave it unmoved.
- **Ten CI gates, not seven:** `typecheck lint test test:determinism validate:data validate:assets validate:ui validate:audio build balance`.
- **Never `git add -A` or `git commit -a`.** Concurrent sessions share this working tree; stage named paths only.
- **Branch:** `feat/campaign-world`.

---

## File Structure

| File | Responsibility |
|---|---|
| `data/campaign/world.json` | **create** — regions, towns, positions, mission order, unlocks |
| `data/schemas/world.schema.json` | **create** — structural validation of the above |
| `docs/GDD.md` | **modify** §2 — the basin's layout and the ordering principle, as canon |
| `tools/validate_data.mjs` | **modify** — four cross-file checks JSON Schema cannot express |
| `packages/sim/src/unlock.ts` | **create** — pure `unlockReason(unlock, ledger)`, shared by runtime and shell |
| `packages/sim/src/mission.ts` | **modify** — delegate to `unlockReason`; `roe.mission_ratings` |
| `packages/data/src/index.ts` | **modify** — import and export the raw `world` JSON, exactly as it does `missions` |
| `packages/app/src/campaign.ts` | **create** — world types, `parseWorld`, `regionProgress`, `townProgress`, `nextMissionOf`. All of it in `app`, which is the only package that may import both `data` and `sim` |
| `assets/campaign/sahar_basin.svg` | Task 1 **creates a stub** with the three region ids; Task 5 **replaces its geometry** — region outlines, token fills, no text |
| `packages/app/src/ui/theme.css` | **modify** — map state tokens |
| `packages/app/src/ui/worldmap.ts` | **create** — the screen: inline the SVG, apply state, place towns, status panel |
| `packages/app/src/ui/menu.ts` | **modify** — mount the world map in place of the flat list |
| `packages/app/src/main.ts` | **modify** — supply world + ledger; take next-mission order from the world |
| `tools/validate_ui_palette.mjs` | **modify** — add `assets/campaign` to `ROOTS` |

Region state is **derived, never stored**. No new localStorage key.

---

### Task 1: The world, its schema, and the gates that keep it honest

Content and validation first, so every later task has a coherent world to read and a gate that fails loudly when it stops being coherent.

**Files:**
- Create: `data/campaign/world.json`
- Create: `data/schemas/world.schema.json`
- Modify: `docs/GDD.md` (§2, after the region table at line ~37)
- Modify: `tools/validate_data.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `data/campaign/world.json` with this exact shape, which Tasks 4, 6 and 7 read:
  `{ id: string, name: string, art: string, regions: Region[] }` where
  `Region = { id: string, name: string, faction: string, doctrine: string, blurb?: string, unlock?: { after_mission?: string, roe_rating_min?: number }, towns: Town[] }` and
  `Town = { id: string, name: string, at: [number, number], missions: string[] }`.
  `at` is in the SVG's `viewBox` coordinate space, which is `0 0 1140 790`.

- [ ] **Step 1: Write the world data**

Create `data/campaign/world.json`. Town positions come from the approved mockup, `docs/superpowers/specs/assets/2026-08-10-sahar-basin-mockup.svg`. Sur and Naharin have no missions authored yet — empty `missions` arrays are correct and Task 1's gate must tolerate them.

```json
{
  "id": "sahar_basin",
  "name": "The Sahar Basin",
  "art": "campaign/sahar_basin.svg",
  "regions": [
    {
      "id": "marj",
      "name": "The Marj Strip",
      "faction": "Ashwar Front",
      "doctrine": "tunnels, IEDs, ambush, human terrain",
      "blurb": "A dense enclave between the sea and Kedem's coastal plain. No mountain, no river, no depth.",
      "towns": [
        {
          "id": "beit_sahwan",
          "name": "Beit Sahwan",
          "at": [150, 372],
          "missions": ["beit_sahwan_1_recon", "beit_sahwan_2_foothold", "beit_sahwan_3_clearance"]
        },
        { "id": "khan_rafid", "name": "Khan Rafid", "at": [142, 452], "missions": [] },
        { "id": "deir_amun", "name": "Deir Amun", "at": [148, 528], "missions": [] }
      ]
    },
    {
      "id": "sur",
      "name": "Sur",
      "faction": "Sarim Brigades",
      "doctrine": "rockets, ATGMs, standoff",
      "blurb": "Rockets range onto Kedem's north from behind a mountain wall.",
      "unlock": { "after_mission": "beit_sahwan_3_clearance" },
      "towns": [
        { "id": "tel_marum", "name": "Tel Marum", "at": [410, 168], "missions": [] },
        { "id": "umm_zeitoun", "name": "Umm Zeitoun", "at": [540, 172], "missions": [] }
      ]
    },
    {
      "id": "naharin",
      "name": "Naharin",
      "faction": "Rif Cells",
      "doctrine": "technicals, raids, smuggling, mobility",
      "blurb": "The corridor that supplied the Marj's tunnels and Sur's rocket stocks.",
      "unlock": { "after_mission": "umm_zeitoun_1" },
      "towns": [{ "id": "wadi_halam", "name": "Wadi Halam", "at": [956, 440], "missions": [] }]
    }
  ]
}
```

Note `naharin.unlock.after_mission` names `umm_zeitoun_1`, which does not exist yet. Step 5's gate deliberately allows an unlock to name an unauthored mission — otherwise the campaign could never be authored front-to-back — but requires that any mission listed in a `towns[].missions` array *does* exist.

- [ ] **Step 2: Write the schema**

Create `data/schemas/world.schema.json`, matching the style of `data/schemas/map.schema.json` (read it first for the `$schema` dialect and `additionalProperties` convention).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "world.schema.json",
  "title": "Campaign world",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "name", "art", "regions"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9_]+$" },
    "name": { "type": "string", "minLength": 1 },
    "art": { "type": "string", "pattern": "\\.svg$" },
    "regions": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "name", "faction", "doctrine", "towns"],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z0-9_]+$" },
          "name": { "type": "string", "minLength": 1 },
          "faction": { "type": "string", "minLength": 1 },
          "doctrine": { "type": "string", "minLength": 1 },
          "blurb": { "type": "string" },
          "unlock": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "after_mission": { "type": "string" },
              "roe_rating_min": { "type": "integer", "minimum": 0, "maximum": 100 }
            }
          },
          "towns": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["id", "name", "at", "missions"],
              "properties": {
                "id": { "type": "string", "pattern": "^[a-z0-9_]+$" },
                "name": { "type": "string", "minLength": 1 },
                "at": {
                  "type": "array",
                  "minItems": 2,
                  "maxItems": 2,
                  "items": { "type": "number", "minimum": 0 }
                },
                "missions": { "type": "array", "items": { "type": "string" } }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Amend GDD §2 with the geography**

Open `docs/GDD.md` and find the region table (ends with the **Towns:** line, around line 37). Insert immediately after it:

```markdown
**Layout.** Kedem sits in the centre of the basin with all three fronts on its borders,
and the geography sets the order of the war: **proximity, then standoff, then source.**

- **The Marj Strip — west, coastal.** Pressed between the sea and Kedem's most populous
  coastal plain, with no mountain, no river and no depth between them. An attack out of
  the Marj is inside Kedem's cities in minutes, which is why the war opens here and why
  it opens with a perimeter being lost rather than a push.
- **Sur — north, mountains.** Rockets range onto Kedem's north from behind a mountain
  wall. Second by sequencing rather than choice: you cannot climb into mountains with
  something at your throat on the coast.
- **Naharin — east, river desert.** The smuggling corridor that supplied the Marj's
  tunnels and Sur's rocket stocks. Last, because cutting supply is only decisive once the
  fronts it feeds are contained.

Every region is defined by terrain and doctrine, never by a people — see `CONTRIBUTING.md`.
```

- [ ] **Step 4: Run the data gate to confirm the schema accepts the world**

The gate does not yet know about `world.json`; this step only proves nothing regressed.

Run: `pnpm validate:data`
Expected: PASS, `43 file(s) validated` (world.json is not yet counted).

- [ ] **Step 5: Add the four cross-file checks**

Open `tools/validate_data.mjs`. Read how it loads schemas and missions first — it compiles schemas with AJV and iterates mission files, pushing to a `failures` array. Add world validation following that pattern:

```js
// --- the campaign world -----------------------------------------------------
// JSON Schema validates world.json's shape; these four checks are the cross-file
// facts it cannot see. Each one is a failure that would otherwise be invisible:
// a menu entry that starts nothing, a mission nothing can reach, a progression
// that locks itself, or a region with no shape on the map.
const worldPath = join(ROOT, 'data/campaign/world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));
validateAgainst('world.schema.json', world, 'data/campaign/world.json');

const missionIds = new Set(
  readdirSync(join(ROOT, 'data/missions')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
);
const listed = new Map();          // mission id -> town that lists it
const regionOrder = [];            // region ids, in campaign order
for (const region of world.regions) {
  regionOrder.push(region.id);
  for (const town of region.towns) {
    for (const m of town.missions) {
      if (!missionIds.has(m)) {
        failures.push(`data/campaign/world.json: town "${town.id}" lists mission "${m}", which has no file in data/missions/`);
      }
      const already = listed.get(m);
      if (already !== undefined) {
        failures.push(`data/campaign/world.json: mission "${m}" is listed by both "${already}" and "${town.id}" — a mission belongs to exactly one town`);
      }
      listed.set(m, town.id);
    }
  }
}

// Every mission must be reachable from the map, or it is unplayable content. The
// tutorial is the one exception: it is deliberately not on the map, because it
// teaches the mouse rather than the war.
const OFF_MAP = new Set(['beit_sahwan_0_tutorial']);
for (const m of missionIds) {
  if (!listed.has(m) && !OFF_MAP.has(m)) {
    failures.push(`data/missions/${m}.json: no town in world.json lists it, so nothing can start it`);
  }
}

// An unlock may name an unauthored mission -- the campaign is authored front to
// back -- but if that mission exists it must sit in an EARLIER region, or the
// progression contains a cycle and locks itself permanently.
for (let i = 0; i < world.regions.length; i++) {
  const after = world.regions[i].unlock?.after_mission;
  if (after === undefined || !listed.has(after)) continue;
  const ownerRegion = world.regions.findIndex((r) => r.towns.some((t) => t.missions.includes(after)));
  if (ownerRegion >= i) {
    failures.push(
      `data/campaign/world.json: region "${world.regions[i].id}" unlocks after "${after}", which is in ` +
        `"${world.regions[ownerRegion].id}" — that region is not earlier, so the progression cannot advance`
    );
  }
}

// A region with no shape in the art is an invisible region, and nothing else
// would catch it.
const artPath = join(ROOT, 'assets', world.art);
if (!existsSync(artPath)) {
  failures.push(`data/campaign/world.json: art "${world.art}" not found at assets/${world.art}`);
} else {
  const svg = readFileSync(artPath, 'utf8');
  for (const region of world.regions) {
    if (!svg.includes(`id="region-${region.id}"`)) {
      failures.push(`assets/${world.art}: no element with id="region-${region.id}" for region "${region.name}"`);
    }
  }
}
```

Add `existsSync` and `readdirSync` to the `node:fs` import at the top if they are not already there. Reuse the file's existing `validateAgainst`-equivalent helper — read the file and match its actual helper name rather than assuming this one.

- [ ] **Step 6: Watch each check fail, one at a time**

A validation check that has never failed is not known to work. For each of these, make the edit, run `pnpm validate:data`, confirm the specific message appears, then revert:

1. Change a mission id in `world.json` to `nonesuch` → expect `has no file in data/missions/`
2. Add `"beit_sahwan_1_recon"` to `khan_rafid.missions` → expect `is listed by both`
3. Remove `"beit_sahwan_2_foothold"` from Beit Sahwan's list → expect `no town in world.json lists it`
4. Set `marj.unlock.after_mission` to `"beit_sahwan_1_recon"` → expect `is not earlier`
5. Change `art` to `campaign/nope.svg` → expect `not found at assets/`

All five branches are verifiable in this task, because Step 1's stub SVG gives the region-id
check something real to read. Rename `id="region-sur"` to `id="region-soor"` for check 5's
second branch and confirm `no element with id="region-sur" for region "Sur"`.

- [ ] **Step 7: Confirm the gate passes on the real world**

Run: `pnpm validate:data`
Expected: PASS. The count rises to 44 files.

- [ ] **Step 8: Commit**

```bash
git add data/campaign/world.json data/schemas/world.schema.json docs/GDD.md tools/validate_data.mjs
git commit -m "feat(data): the Sahar Basin as data, with GDD geography to match

The campaign world existed as a table in GDD §2 with no layout, so nothing
explained why the war starts in the Marj. §2 now carries the basin's geography
and its ordering principle -- proximity, then standoff, then source -- and
world.json makes the same thing readable by the shell.

Four cross-file checks the schema cannot express: a listed mission must exist,
a mission belongs to exactly one town, every mission must be reachable from the
map (bar the tutorial, which is deliberately off it), and a region's unlock must
name a mission in an earlier region so the progression cannot lock itself. Each
was watched failing before being kept."
```

---

### Task 2: Lift the unlock predicate out of the sim

The map must say *why* a region is locked, and that logic currently lives on a sim class the shell must not instantiate. It depends on nothing but its two arguments, so it lifts cleanly.

**Files:**
- Create: `packages/sim/src/unlock.ts`
- Create: `packages/sim/src/unlock.test.ts`
- Modify: `packages/sim/src/mission.ts` (`buildBlockedReason`, around line 305)
- Modify: `packages/sim/src/index.ts` (export the new function and type)

**Interfaces:**
- Consumes: `LedgerData` from `packages/sim/src/mission.ts`.
- Produces:
  ```ts
  export interface UnlockGate { roeMin?: number; afterMission?: string }
  export function unlockReason(unlock: UnlockGate | undefined, ledger: LedgerData | undefined): string | null
  ```
  Returns `null` when unlocked, otherwise a player-facing sentence. Tasks 4, 6 and 7 call it.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/src/unlock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { unlockReason } from './unlock';

describe('unlockReason', () => {
  it('returns null when there is no gate at all', () => {
    expect(unlockReason(undefined, {})).toBe(null);
  });

  it('names the floor it wants when the campaign rating is too low', () => {
    const why = unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 20, b: 40 } });
    expect(why).toContain('45');
  });

  it('distinguishes no rating yet from a low rating', () => {
    expect(unlockReason({ roeMin: 45 }, {})).toContain('no missions rated yet');
  });

  it('passes when the average reaches the floor exactly, without dividing', () => {
    // 40 + 50 = 90, floor 45, two missions: 90 >= 45*2. Compared as integers, because
    // this package bans floating point -- and the comparison is exact, where a
    // truncated mean would have rejected a legitimately passing campaign.
    expect(unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 40, b: 50 } })).toBe(null);
  });

  it('rejects one point below the floor, where a truncating mean would have passed it', () => {
    // 44 + 45 = 89 < 90. A `(89/2)|0` mean is 44, so both agree here -- but 45+46=91
    // averages to 45 exactly and must pass.
    expect(unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 44, b: 45 } })).not.toBe(null);
    expect(unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 45, b: 46 } })).toBe(null);
  });

  it('honours a legacy save that has a bare cumulative rating and no map', () => {
    expect(unlockReason({ roeMin: 45 }, { 'roe.cumulative_rating': 60 })).toBe(null);
    expect(unlockReason({ roeMin: 45 }, { 'roe.cumulative_rating': 31 })).not.toBe(null);
  });

  it('names the mission that has not been cleared', () => {
    const why = unlockReason({ afterMission: 'beit_sahwan_3_clearance' }, {});
    expect(why).toContain('beit_sahwan_3_clearance');
  });

  it('passes once that mission is in the completed list', () => {
    const done = { 'campaign.completed_missions': ['beit_sahwan_3_clearance'] };
    expect(unlockReason({ afterMission: 'beit_sahwan_3_clearance' }, done)).toBe(null);
  });

  it('reports the ROE gate first when both gates fail, since it is the harder one to fix', () => {
    const why = unlockReason(
      { roeMin: 60, afterMission: 'beit_sahwan_3_clearance' },
      { 'roe.mission_ratings': { a: 10 } }
    );
    expect(why).toContain('60');
  });

  it('survives a ledger holding junk of the wrong type', () => {
    const junk = { 'campaign.completed_missions': 'not an array' } as unknown as Parameters<typeof unlockReason>[1];
    expect(unlockReason({ afterMission: 'x' }, junk)).toContain('x');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/sim/src/unlock.test.ts`
Expected: FAIL — cannot resolve `./unlock`.

- [ ] **Step 3: Write the implementation**

Create `packages/sim/src/unlock.ts`. This is a straight lift of the body of `MissionRuntime.buildBlockedReason`, with the two lookups passed in rather than read off `this.ctx`:

```ts
import type { LedgerData } from './mission';

/** A campaign progression gate, as parsed from `unlock` in unit or world data.
 *  Authoring spells these `roe_rating_min` and `after_mission`; the app maps them. */
export interface UnlockGate {
  roeMin?: number;
  afterMission?: string;
}

/**
 * Why this thing is still locked, or null when it is not.
 *
 * Pure, and deliberately outside any class: the campaign menu has to render the same
 * sentence the mission runtime does, and building a Sim to draw a menu would drag the
 * whole simulation into the shell for one string.
 *
 * Campaign gates only. Affordability changes tick to tick and is shown as a price;
 * a locked *thing* needs to say what would open it (GDD §6).
 */
export function unlockReason(unlock: UnlockGate | undefined, ledger: LedgerData | undefined): string | null {
  if (!unlock) return null;
  if (unlock.roeMin !== undefined && !roeAtLeast(ledger, unlock.roeMin)) {
    const rated = ratedCount(ledger);
    return (
      `requires campaign ROE ${unlock.roeMin}` + (rated === 0 ? ' (no missions rated yet)' : '')
    );
  }
  if (unlock.afterMission !== undefined) {
    const done = ledger?.['campaign.completed_missions'];
    if (!Array.isArray(done) || !done.includes(unlock.afterMission)) {
      return `requires clearing ${unlock.afterMission}`;
    }
  }
  return null;
}

const ratings = (ledger: LedgerData | undefined): Record<string, number> | null => {
  const r = ledger?.['roe.mission_ratings'];
  return r !== null && typeof r === 'object' ? (r as Record<string, number>) : null;
};

const ratedCount = (ledger: LedgerData | undefined): number => Object.keys(ratings(ledger) ?? {}).length;

/**
 * Whether the campaign's average ROE is at least `floor`, decided without dividing.
 *
 * `sum >= floor * count` is the same predicate as `sum / count >= floor` for positive
 * counts, using only integer multiplication -- so this package keeps its no-floating-point
 * invariant, and the test is *exact* where a truncated mean would wrongly reject a campaign
 * sitting right on the boundary.
 *
 * The message a locked thing shows names only the floor. The player's current figure is
 * rendered beside it by the shell, which may divide freely.
 */
function roeAtLeast(ledger: LedgerData | undefined, floor: number): boolean {
  const map = ratings(ledger);
  if (map !== null) {
    const keys = Object.keys(map);
    if (keys.length > 0) {
      let total = 0;
      for (const k of keys) total += map[k] ?? 0;
      return total >= floor * keys.length;
    }
  }
  // A save written before per-mission ratings existed carries a single number.
  const legacy = ledger?.['roe.cumulative_rating'];
  return typeof legacy === 'number' && legacy >= floor;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/sim/src/unlock.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Make the runtime delegate rather than duplicate**

In `packages/sim/src/mission.ts`, add `import { unlockReason, type UnlockGate } from './unlock';` alongside the existing imports, then replace the body of `buildBlockedReason` (the whole `if (!unlock) return null;` through the final `return null;`) with a delegation:

```ts
  buildBlockedReason(unitId: string): string | null {
    const info = this.ctx.unitInfo?.(unitId);
    if (!info) return 'not available in the field';
    return unlockReason(info.unlock as UnlockGate | undefined, this.ctx.ledger);
  }
```

Two duplicated definitions of "why is this locked" would drift, and the menu's copy is the one players read.

- [ ] **Step 6: Export from the package index**

In `packages/sim/src/index.ts`, add `unlockReason` and the `UnlockGate` type to the existing export block, matching how `LedgerData` is exported (`type LedgerData,`).

- [ ] **Step 7: Run the full test suite and the determinism canary**

Run: `pnpm test && pnpm test:determinism && pnpm typecheck`
Expected: all PASS. The existing `buildBlockedReason` tests must pass unchanged — that is the proof the lift preserved behaviour. The determinism hash must not move: this task changes no simulation arithmetic. If it moves, stop and find out why rather than updating the hash.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/unlock.ts packages/sim/src/unlock.test.ts packages/sim/src/mission.ts packages/sim/src/index.ts
git commit -m "refactor(sim): lift unlockReason out of MissionRuntime

The campaign map has to render the same 'locked because' sentence the runtime
does, and buildBlockedReason is a method on a sim class -- so drawing a menu
would have meant constructing a Sim. The predicate reads nothing but its unlock
record and the ledger, so it lifts into a pure function that both callers share.
A second copy would drift, and the menu's copy is the one players read.

Behaviour preserved: the existing buildBlockedReason tests pass unchanged, and
the determinism hash did not move."
```

---

### Task 3: Best-per-mission ROE, so replaying a mission means something

#22 requires that replaying for a better ROE has a clear effect. Today the rating is `(prev + rating) / 2` — an exponential moving average that can be farmed by replaying a good mission and never lets a replay replace a bad score.

**Files:**
- Modify: `packages/sim/src/mission.ts` — `LedgerData` (around line 62), the produce block (around line 993)
- Modify: `packages/sim/src/mission.test.ts` — append a describe block

**Interfaces:**
- Consumes: `LedgerData`.
- Produces: a new ledger key, read by Tasks 2, 4, 6 and 7:
  ```ts
  'roe.mission_ratings'?: Record<string, number>;   // mission id -> best rating earned
  ```
  The sim writes **only** this map — storage, no arithmetic. `'roe.cumulative_rating'` is no
  longer produced: the mean is division, `@lions/sim` bans floating point, and `| 0` on a
  float quotient is exactly the kind of "just this one calculation" the invariant exists to
  refuse. Display averaging moves to `campaignRoe` in Task 4; unlock gating compares
  integers in Task 2. Existing saves keep whatever `roe.cumulative_rating` they already
  hold, and both readers fall back to it.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sim/src/mission.test.ts`. Follow the existing helpers in that file — `baseMission`, `makeWorld` — and remember `baseMission` supplies **no** `starting_force`, so any test needing player units must declare one.

```ts
describe('ROE ratings per mission', () => {
  const roeMission = (id: string): MissionJson =>
    baseMission({
      id,
      ledger: { requires: [], produces: ['roe.mission_ratings', 'campaign.completed_missions'] },
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
      objectives: [{ id: 'win', type: 'survive_until', seconds: 1, primary: true }],
    });

  const finish = (id: string, ledger: LedgerData): LedgerData => {
    const w = makeWorld(roeMission(id), { ledger });
    for (let t = 0; t < 5 * TICKS_PER_SECOND; t++) {
      const out = w.step(1);
      for (const e of out.mission) if (e.kind === 'missionEnd') return e.ledger;
    }
    throw new Error(`mission ${id} never ended`);
  };

  it('records a rating per mission, keyed by mission id', () => {
    const out = finish('m_one', {});
    expect(out['roe.mission_ratings']).toBeDefined();
    expect(Object.keys(out['roe.mission_ratings'] as Record<string, number>)).toEqual(['m_one']);
  });

  it('accumulates an entry per mission played', () => {
    const both = finish('m_two', finish('m_one', {}));
    const ratings = both['roe.mission_ratings'] as Record<string, number>;
    expect(Object.keys(ratings).sort()).toEqual(['m_one', 'm_two']);
  });

  it('does not average in the sim at all -- no cumulative key is produced', () => {
    // An average is division, and @lions/sim bans floating point. campaignRoe does this
    // for display; unlockReason gates on it by integer comparison.
    expect(finish('m_one', {})['roe.cumulative_rating']).toBeUndefined();
  });

  it('leaves a legacy cumulative rating in the incoming ledger untouched', () => {
    // Saves written before this change carry the old key. The sim neither reads nor
    // rewrites it, and both readers fall back to it.
    const out = finish('m_one', { 'roe.cumulative_rating': 64 });
    expect(out['roe.mission_ratings']).toBeDefined();
  });

  it('keeps the better rating when a mission is replayed, never the newer one', () => {
    // Seed a rating this run cannot beat, then replay: the entry must not fall.
    const seeded: LedgerData = { 'roe.mission_ratings': { m_one: 100 } };
    const out = finish('m_one', seeded);
    expect((out['roe.mission_ratings'] as Record<string, number>).m_one).toBe(100);
  });

  it('cannot be farmed: replaying one mission leaves every other entry alone', () => {
    const seeded: LedgerData = { 'roe.mission_ratings': { m_one: 20, m_two: 90 } };
    const out = finish('m_one', seeded);
    const ratings = out['roe.mission_ratings'] as Record<string, number>;
    expect(ratings.m_two).toBe(90);
    expect(Object.keys(ratings).sort()).toEqual(['m_one', 'm_two']);
  });

  it('is order-independent, so the same campaign always reads the same', () => {
    const ab = finish('m_two', finish('m_one', {}))['roe.mission_ratings'];
    const ba = finish('m_one', finish('m_two', {}))['roe.mission_ratings'];
    // Same keys AND same serialisation: the object is rebuilt in sorted key order, so a
    // save file cannot differ by play order.
    expect(JSON.stringify(ab)).toBe(JSON.stringify(ba));
  });


});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run packages/sim/src/mission.test.ts -t "ROE ratings per mission"`
Expected: FAIL — `roe.mission_ratings` is undefined.

- [ ] **Step 3: Add the ledger key**

In `packages/sim/src/mission.ts`, inside `interface LedgerData`, after `'roe.cumulative_rating'?: number;`:

```ts
  /**
   * Best ROE rating each mission has earned, keyed by mission id.
   *
   * This replaces `roe.cumulative_rating`, which was `(previous + this mission) / 2` -- an
   * exponential moving average with three faults: replaying your best mission walked the
   * campaign rating upward without playing anything new, replaying a mission you did badly
   * could never replace the bad sample, and the number depended on the order missions were
   * played in. #22 asks for replay to have a clear effect, and none of those three allow it.
   *
   * Best-of rather than latest, so a replay can only ever help -- which is what makes going
   * back to a mission you scored badly on worth doing.
   *
   * Deliberately not averaged here. An average is division, this package bans floating
   * point, and `| 0` on a float quotient is the "just this one calculation" the invariant
   * exists to refuse. `campaignRoe` in the app averages for display; `unlockReason` gates
   * with `sum >= floor * count`, which needs no division and is exact at the boundary.
   * `roe.cumulative_rating` stays on this interface, read as a fallback for saves written
   * before this key existed, and written by nothing.
   */
  'roe.mission_ratings'?: Record<string, number>;
```

- [ ] **Step 4: Replace the moving average**

In the produce block, replace these two lines (around line 993):

```ts
    const prev = this.ctx.ledger?.['roe.cumulative_rating'];
    const cumulative = typeof prev === 'number' ? ((prev + roeRating) / 2) | 0 : roeRating;
```

with:

```ts
    // Best-of per mission. Storage only -- no averaging here, because an average is
    // division and this package bans floating point. See LedgerData['roe.mission_ratings'].
    const prevRatings = this.ctx.ledger?.['roe.mission_ratings'];
    const ratings: Record<string, number> = {};
    if (prevRatings !== null && typeof prevRatings === 'object') {
      // Rebuilt in sorted key order so the saved object is stable rather than
      // insertion-ordered, matching how intel.marked_positions is sorted below.
      const prior = prevRatings as Record<string, number>;
      for (const k of Object.keys(prior).sort()) ratings[k] = prior[k]!;
    }
    const best = ratings[this.mission.id];
    if (typeof best !== 'number' || roeRating > best) ratings[this.mission.id] = roeRating;
```

`Object.keys(...).sort()` keeps the iteration order stable rather than insertion-ordered, matching how `intel.marked_positions` is sorted a few lines below. Integer division via `| 0` keeps the value an integer, as `unlockReason`'s comparison expects.

**No floating point concern here:** `roeRating` and these ratings are plain integers on the 0–100 ROE scale, not Q16.16 fixed-point, and this code is score bookkeeping outside the tick loop. Do not convert it to `fx`.

- [ ] **Step 5: Produce the new key**

In the same produce block's `for (const key of this.mission.ledger.produces)` chain, add a branch alongside the others:

```ts
      else if (key === 'roe.mission_ratings') produced[key] = ratings;
```

and **delete** the `roe.cumulative_rating` branch — nothing produces it now. Leave the key on
`LedgerData`: saves in the wild still carry it and both readers fall back to it.

Then replace `'roe.cumulative_rating'` with `'roe.mission_ratings'` in the `produces` array of
every mission that declares it:

```bash
python3 - <<'PY'
import json, pathlib
for p in sorted(pathlib.Path('data/missions').glob('*.json')):
    d = json.loads(p.read_text())
    prod = d.get('ledger', {}).get('produces', [])
    if 'roe.cumulative_rating' in prod:
        d['ledger']['produces'] = ['roe.mission_ratings' if k == 'roe.cumulative_rating' else k
                                   for k in prod]
        p.write_text(json.dumps(d, indent=2) + '\n')
        print('updated', p.name)
PY
```

Verify the round-trip did not reformat anything else: `git diff --stat data/missions/` should show only small changes.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/sim/src/mission.test.ts`
Expected: PASS, including the six new tests. If `'is order-independent'` fails, the mean is being computed over insertion order somewhere — check the `.sort()`.

- [ ] **Step 7: Run the determinism canary and the whole suite**

Run: `pnpm test && pnpm test:determinism && pnpm typecheck && pnpm validate:data`
Expected: all PASS. The golden hash must not move — ROE scoring is not part of the simulation state it hashes. If it does move, stop: something in this edit reached into sim state.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts data/missions
git commit -m "feat(sim): ROE keeps the best rating per mission, not a moving average

#22 wants replaying a mission for a better ROE to have a clear effect, and the
old rule made that impossible: cumulative was (previous + this) / 2, so
replaying your best mission farmed the number upward, replaying a bad one never
replaced the bad sample, and the result depended on play order.

Now the ledger holds the best rating each mission has earned and the cumulative
is their mean. A replay can only improve its own entry, farming is impossible,
the number is order-independent, and it can be itemised for the player -- which
is what makes 'what a low rating has locked' explainable.

A save written before this has a bare cumulative rating and no map; that value
is respected rather than resetting the campaign to zero. Determinism hash
unmoved: ROE scoring is not simulation state."
```

---

### Task 4: Derive region state from the ledger

Pure logic, no DOM — that is what makes it testable.

**All of it in `app`, and the reason is load-bearing.** `packages/data/package.json`
declares **no dependencies at all**: `data` is a leaf, exactly as CLAUDE.md says
("Dependency direction is strictly one-way: `app → render → sim`, and `data` is a leaf").
Anything that reads a ledger needs `LedgerData` and `unlockReason` from `@lions/sim`, so it
cannot live in `data`.

An earlier draft split the module — parser in `data`, derived state in `app` — which forced
`WorldUnlock` to be declared twice, once in each package, as a verbatim copy. Duplicating a
type to satisfy a layering rule trades one defect for another. Instead `@lions/data` exports
only the raw `world` JSON, exactly as it already does for `missions` (whose `MissionJson`
type likewise lives elsewhere), and the whole campaign module is one file in `app` with one
definition of everything.

**Files:**
- Create: `packages/app/src/campaign.ts` (types, `parseWorld`, and ledger-derived state)
- Create: `packages/app/src/campaign.test.ts`
- Modify: `packages/data/src/index.ts` (export the raw JSON only)

**Interfaces:**
- Consumes: `unlockReason`, `UnlockGate` from Task 2; `LedgerData` from `@lions/sim`; `world.json` from Task 1.
- Produces from **`packages/app/src/campaign.ts`**, for Tasks 6 and 7:
  ```ts
  export interface WorldTown { id: string; name: string; at: readonly [number, number]; missions: readonly string[] }
  export interface WorldRegion { id: string; name: string; faction: string; doctrine: string; blurb?: string;
                                unlock?: UnlockGate; towns: readonly WorldTown[] }
  export interface ParsedWorld { id: string; name: string; art: string; regions: readonly WorldRegion[] }
  export type RegionStatus = 'live' | 'complete' | 'locked';
  export interface RegionProgress { status: RegionStatus; done: number; total: number; lockedBecause: string | null }

  export function parseWorld(json: unknown): ParsedWorld
  export function regionProgress(region: WorldRegion, ledger: LedgerData | undefined): RegionProgress
  export function nextMissionOf(town: WorldTown, ledger: LedgerData | undefined): string | null
  export function townProgress(town: WorldTown, ledger: LedgerData | undefined): { done: number; total: number }
  export function campaignRoe(ledger: LedgerData | undefined): { mean: number; worst: [string, number] | null } | null
  ```
  `UnlockGate` is imported from `@lions/sim` — one definition, used directly. `campaignRoe`
  is where the ROE mean is computed for display; see Task 3 for why it is not computed in
  the sim.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/campaign.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import worldJson from '../../../data/campaign/world.json';
import type { LedgerData } from '@lions/sim';
import { campaignRoe, nextMissionOf, parseWorld, regionProgress, townProgress } from './campaign';

const world = parseWorld(worldJson);
const marj = world.regions[0]!;
const sur = world.regions[1]!;
const beitSahwan = marj.towns[0]!;
const ALL_BS = beitSahwan.missions;

describe('parseWorld', () => {
  it('maps snake_case authoring keys onto the runtime spelling', () => {
    expect(sur.unlock?.afterMission).toBe('beit_sahwan_3_clearance');
  });

  it('keeps town positions as a fixed pair', () => {
    expect(beitSahwan.at).toHaveLength(2);
  });

  it('rejects a world whose regions are missing rather than yielding a half object', () => {
    expect(() => parseWorld({ id: 'x', name: 'x', art: 'a.svg' })).toThrow();
  });
});

describe('regionProgress', () => {
  it('is live with nothing done when the first region has no gate', () => {
    const p = regionProgress(marj, {});
    expect(p.status).toBe('live');
    expect(p.done).toBe(0);
    expect(p.lockedBecause).toBe(null);
  });

  it('counts completed missions across all of a region towns', () => {
    const p = regionProgress(marj, { 'campaign.completed_missions': [ALL_BS[0]!] });
    expect(p.done).toBe(1);
    expect(p.total).toBe(ALL_BS.length);
  });

  it('is complete only when every mission of every town is done', () => {
    const p = regionProgress(marj, { 'campaign.completed_missions': [...ALL_BS] });
    expect(p.status).toBe('complete');
    expect(p.done).toBe(p.total);
  });

  it('is locked, and says why, while its gate is unmet', () => {
    const p = regionProgress(sur, {});
    expect(p.status).toBe('locked');
    expect(p.lockedBecause).toContain('beit_sahwan_3_clearance');
  });

  it('opens once the gating mission is cleared', () => {
    const p = regionProgress(sur, { 'campaign.completed_missions': ['beit_sahwan_3_clearance'] });
    expect(p.status).toBe('live');
    expect(p.lockedBecause).toBe(null);
  });

  it('is not complete when it has no missions authored yet, however open it is', () => {
    // Sur's towns are empty until piece 2 authors them. total 0 must not read as
    // "finished", or an unwritten region would show up already greyed out.
    const p = regionProgress(sur, { 'campaign.completed_missions': ['beit_sahwan_3_clearance'] });
    expect(p.total).toBe(0);
    expect(p.status).toBe('live');
  });

  it('ignores completed missions that belong to other regions', () => {
    const p = regionProgress(sur, { 'campaign.completed_missions': [...ALL_BS] });
    expect(p.done).toBe(0);
  });
});

describe('nextMissionOf', () => {
  it('is the first mission when nothing is done', () => {
    expect(nextMissionOf(beitSahwan, {})).toBe(ALL_BS[0]);
  });

  it('skips what is already complete, in authored order', () => {
    expect(nextMissionOf(beitSahwan, { 'campaign.completed_missions': [ALL_BS[0]!] })).toBe(ALL_BS[1]);
  });

  it('returns the first incomplete mission even when a later one was cleared out of order', () => {
    const done = { 'campaign.completed_missions': [ALL_BS[2]!] };
    expect(nextMissionOf(beitSahwan, done)).toBe(ALL_BS[0]);
  });

  it('is null for a finished town, which is how the map knows to stop offering it', () => {
    expect(nextMissionOf(beitSahwan, { 'campaign.completed_missions': [...ALL_BS] })).toBe(null);
  });

  it('is null for a town with no missions authored yet', () => {
    expect(nextMissionOf(sur.towns[0]!, {})).toBe(null);
  });
});

describe('townProgress', () => {
  it('counts only its own missions', () => {
    const p = townProgress(beitSahwan, { 'campaign.completed_missions': [ALL_BS[0]!, 'unrelated'] });
    expect(p).toEqual({ done: 1, total: ALL_BS.length });
  });
});

describe('campaignRoe', () => {
  it('is null before any mission has been rated', () => {
    expect(campaignRoe({})).toBe(null);
  });

  it('averages the per-mission bests', () => {
    const r = campaignRoe({ 'roe.mission_ratings': { a: 40, b: 80 } });
    expect(r?.mean).toBe(60);
  });

  it('names the worst-rated mission, so a low average is explainable', () => {
    const r = campaignRoe({ 'roe.mission_ratings': { a: 40, b: 80 } });
    expect(r?.worst).toEqual(['a', 40]);
  });

  it('reports no worst mission when only one has been played', () => {
    expect(campaignRoe({ 'roe.mission_ratings': { a: 40 } })?.worst).toBe(null);
  });

  it('falls back to a legacy save with a bare cumulative rating and no map', () => {
    const r = campaignRoe({ 'roe.cumulative_rating': 64 } as LedgerData);
    expect(r?.mean).toBe(64);
    expect(r?.worst).toBe(null);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run packages/app/src/campaign.test.ts`
Expected: FAIL — cannot resolve `./campaign`.

- [ ] **Step 3: Write the module**

Create `packages/app/src/campaign.ts`:

```ts
/**
 * The campaign world, and what a ledger implies about it.
 *
 * All of it lives in `app` because it needs `LedgerData` and `unlockReason` from
 * `@lions/sim`, and `@lions/data` is a leaf that imports nothing. Splitting it so the
 * parser could sit in `data` would mean declaring the unlock type twice, once per package,
 * as a verbatim copy -- trading a layering nicety for duplicated types. `@lions/data`
 * therefore exports only the raw JSON, exactly as it already does for missions.
 *
 * Nothing here is persisted. A region's status is *derived* from
 * `campaign.completed_missions`, which the ledger already writes, so the map cannot
 * disagree with what was actually played and there is no second save file to migrate.
 */
import { unlockReason, type LedgerData, type UnlockGate } from '@lions/sim';

export interface WorldTown {
  id: string;
  name: string;
  /** Position in the campaign art's viewBox space, not in tiles. */
  at: readonly [number, number];
  missions: readonly string[];
}

export interface WorldRegion {
  id: string;
  name: string;
  faction: string;
  doctrine: string;
  blurb?: string;
  unlock?: UnlockGate;
  towns: readonly WorldTown[];
}

export interface ParsedWorld {
  id: string;
  name: string;
  /** Path under assets/, e.g. "campaign/sahar_basin.svg". */
  art: string;
  regions: readonly WorldRegion[];
}

export type RegionStatus = 'live' | 'complete' | 'locked';

export interface RegionProgress {
  status: RegionStatus;
  done: number;
  total: number;
  /** Player-facing sentence when locked, else null. */
  lockedBecause: string | null;
}

interface TownJson {
  id: string;
  name: string;
  at: number[];
  missions: string[];
}

interface RegionJson {
  id: string;
  name: string;
  faction: string;
  doctrine: string;
  blurb?: string;
  unlock?: { after_mission?: string; roe_rating_min?: number };
  towns: TownJson[];
}

interface WorldJson {
  id: string;
  name: string;
  art: string;
  regions: RegionJson[];
}

/** Read world.json into the runtime shape, mapping the authoring spelling of `unlock`
 *  (`after_mission`, `roe_rating_min`) onto the runtime's (`afterMission`, `roeMin`) --
 *  the same mapping main.ts already does for units. */
export function parseWorld(json: unknown): ParsedWorld {
  const w = json as WorldJson;
  if (!w || !Array.isArray(w.regions)) throw new Error('world: expected an object with a regions array');
  return {
    id: w.id,
    name: w.name,
    art: w.art,
    regions: w.regions.map((r) => {
      const unlock: UnlockGate = {};
      if (r.unlock?.after_mission !== undefined) unlock.afterMission = r.unlock.after_mission;
      if (r.unlock?.roe_rating_min !== undefined) unlock.roeMin = r.unlock.roe_rating_min;
      const region: WorldRegion = {
        id: r.id,
        name: r.name,
        faction: r.faction,
        doctrine: r.doctrine,
        towns: r.towns.map((t) => ({
          id: t.id,
          name: t.name,
          at: [t.at[0] ?? 0, t.at[1] ?? 0] as const,
          missions: [...t.missions],
        })),
      };
      if (r.blurb !== undefined) region.blurb = r.blurb;
      if (Object.keys(unlock).length > 0) region.unlock = unlock;
      return region;
    }),
  };
}

const completed = (ledger: LedgerData | undefined): ReadonlySet<string> => {
  const done = ledger?.['campaign.completed_missions'];
  return new Set(Array.isArray(done) ? done : []);
};

export function townProgress(town: WorldTown, ledger: LedgerData | undefined): { done: number; total: number } {
  const done = completed(ledger);
  return { done: town.missions.filter((m) => done.has(m)).length, total: town.missions.length };
}

export function regionProgress(region: WorldRegion, ledger: LedgerData | undefined): RegionProgress {
  let done = 0;
  let total = 0;
  for (const town of region.towns) {
    const p = townProgress(town, ledger);
    done += p.done;
    total += p.total;
  }
  const lockedBecause = unlockReason(region.unlock, ledger);
  // A region with nothing authored yet is not "finished". Treating total 0 as complete
  // would grey out every region piece 2 has not written, which reads as a bug.
  const status: RegionStatus =
    lockedBecause !== null ? 'locked' : total > 0 && done === total ? 'complete' : 'live';
  return { status, done, total, lockedBecause };
}

/** The mission a town would start now: the first in authored order that is not done.
 *  Null when the town is finished, or has nothing authored yet. */
export function nextMissionOf(town: WorldTown, ledger: LedgerData | undefined): string | null {
  const done = completed(ledger);
  return town.missions.find((m) => !done.has(m)) ?? null;
}

/**
 * The campaign ROE figure for display, and the mission dragging it down.
 *
 * The mean is computed here rather than in the sim on purpose: `@lions/sim` bans floating
 * point, and an average is division. The sim stores the per-mission bests -- bookkeeping,
 * no arithmetic -- and gates unlocks by integer comparison (Task 2). Presentation maths
 * belongs on this side of the boundary.
 */
export function campaignRoe(
  ledger: LedgerData | undefined
): { mean: number; worst: [string, number] | null } | null {
  const ratings = ledger?.['roe.mission_ratings'];
  if (ratings !== null && typeof ratings === 'object') {
    const entries = Object.entries(ratings as Record<string, number>);
    if (entries.length > 0) {
      const total = entries.reduce((a, [, v]) => a + v, 0);
      const worst = entries.length > 1 ? entries.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
      return { mean: Math.round(total / entries.length), worst };
    }
  }
  // A save written before per-mission ratings existed has a bare cumulative number.
  const legacy = ledger?.['roe.cumulative_rating'];
  return typeof legacy === 'number' ? { mean: legacy, worst: null } : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/app/src/campaign.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Export the raw world JSON from the data index**

In `packages/data/src/index.ts`, add the static import beside the existing ones (around line 10) and the export beside `maps`/`missions`:

```ts
import worldJson from '../../../data/campaign/world.json';
```

```ts
/** The campaign world. Shape matches world.schema.json; parsed by app/src/campaign.ts. */
export const world = worldJson;
```

Match the file's existing style. Export **only** the JSON — no parser, no types. `@lions/data` must not gain a dependency.

- [ ] **Step 6: Confirm `data` is still a leaf**

```bash
grep -rn "@lions/" packages/data/src/ | grep -v "\.test\.ts"
```

Expected: **no output.** `packages/data/package.json` declares no dependencies, and this is the invariant CLAUDE.md states. Any hit means campaign logic drifted into `data`; move it to `packages/app/src/campaign.ts` rather than adding a dependency.

- [ ] **Step 7: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/campaign.ts packages/app/src/campaign.test.ts packages/data/src/index.ts
git commit -m "feat(app): the campaign world, and its state derived from the ledger

parseWorld reads world.json; regionProgress and nextMissionOf turn
campaign.completed_missions into what the map draws. Nothing is persisted: a
region's status is derived, so the map cannot disagree with what was played and
there is no second save file to keep in step.

One file in app rather than split across app and data. @lions/data is a leaf
that declares no dependencies, and reading a ledger needs LedgerData and
unlockReason from the sim -- so a split would have meant declaring the unlock
type twice, once per package, as a verbatim copy. data exports only the raw
JSON, exactly as it already does for missions.

campaignRoe averages the per-mission ratings here rather than in the sim,
because an average is division and the sim bans floating point.

A region with no missions authored yet reports total 0 and stays live rather
than complete -- otherwise every region piece 2 has not written yet would show
up already greyed out, which reads as a bug rather than as a plan."
```

---

### Task 5: The map art, its tokens, and bringing it under the palette gate

**Files:**
- Modify: `assets/campaign/sahar_basin.svg` — **replace** the stub Task 1 created. The file already exists holding three empty `<g id="region-*">` elements and the `viewBox`; keep those ids and that `viewBox`, and fill in the geometry
- Modify: `packages/app/src/ui/theme.css`
- Modify: `tools/validate_ui_palette.mjs`

**Interfaces:**
- Consumes: region ids from Task 1 (`marj`, `sur`, `naharin`).
- Produces: an SVG with `viewBox="0 0 1140 790"` — the coordinate space `world.json`'s `at` values live in — containing one element per region with `id="region-<id>"`, and no text. Task 6 inlines it and sets `data-status` on those elements.

- [ ] **Step 1: Add the map state tokens**

In `packages/app/src/ui/theme.css` — the only file allowed to name `--rl-*` — add a block beside the existing semantic tokens (near `--band-mission`, around line 51):

```css
  /* Campaign map. Three region states that must be told apart at a glance.
     Dim by dropping texture and saturation, not brightness: laying shadow over a
     finished region turned it nearly black and cost every label inside it. */
  --map-sea: var(--rl-water-6);
  --map-land: var(--rl-limestone-2);
  --map-home: var(--rl-limestone-1);
  --map-live: var(--rl-dust-1);
  --map-spent: var(--rl-limestone-4);
  --map-locked: var(--rl-limestone-5);
  --map-urban: var(--rl-terracotta-2);
  --map-urban-line: var(--rl-terracotta-4);
  --map-rock: var(--rl-gunmetal-5);
  --map-scrub: var(--rl-scrub-2);
  --map-dune: var(--rl-dust-3);
  --map-dune-line: var(--rl-dust-5);
```

Confirm each `--rl-*` name exists: the Vite palette plugin publishes them from `data/palette.json` as `--rl-<ramp>-<index>`. Cross-check against `packages/app/vite-plugin-palette.ts` and fix any name that does not resolve.

- [ ] **Step 2: Author the SVG**

Replace the stub at `assets/campaign/sahar_basin.svg`. Start from the approved mockup at `docs/superpowers/specs/assets/2026-08-10-sahar-basin-mockup.svg` — the geometry is settled; what changes is that every hex becomes a token and every text element is removed, because labels come from `world.json`.

Requirements, all load-bearing:

- `viewBox="0 0 1140 790"`, matching the `at` coordinates in `world.json`
- one element per region carrying **exactly** `id="region-marj"`, `id="region-sur"`, `id="region-naharin"`. Task 1's gate greps for these strings
- each region element is a `<g>` wrapping its outline and terrain, so Task 6 can restyle a whole region by setting one attribute
- **no `<text>` anywhere.** Names, doctrines and unlock text are `world.json`'s, so they stay translatable and cannot drift from the data
- every `fill` and `stroke` names a token: `fill="var(--map-land)"`, never `fill="#E6D8BE"`
- pattern definitions (urban hatch, dunes) also use tokens
- no `width`/`height` attributes on the root `<svg>`; the container sizes it

Keep the coastline, Kedem's outline, the mountain belt, the river and the terrain textures from the mockup.

- [ ] **Step 3: Bring the file under the palette gate**

In `tools/validate_ui_palette.mjs`, extend the scan roots (line ~36):

```js
const ROOTS = ['packages/app/src', 'assets/campaign'];
```

Without this the map's fills sit outside the one rule this project enforces with no allowlist, and an advisory palette rule is how off-palette art ships. Check the file's extension filter includes `.svg`; if it only matches `.ts`/`.css`/`.html`, add `.svg` to it.

- [ ] **Step 4: Prove the gate now sees the file**

Temporarily put `fill="#ff0000"` on any shape in the SVG.

Run: `pnpm validate:ui`
Expected: FAIL, naming `assets/campaign/sahar_basin.svg` and the literal. Then remove it and re-run — expect PASS. If the deliberate hex passes, the root or the extension filter is not working and the rest of this task is unprotected.

- [ ] **Step 5: Prove the region ids survived the rewrite**

Task 1 already verified this check fires; what matters here is that replacing the geometry did
not drop or rename an id. Rename `id="region-sur"` to `id="region-soor"`.

Run: `pnpm validate:data`
Expected: FAIL — `no element with id="region-sur" for region "Sur"`. Restore the id and re-run — expect PASS.

- [ ] **Step 6: Look at it**

Rasterise and inspect at the size a player sees, not zoomed in:

```bash
rsvg-convert -w 1140 assets/campaign/sahar_basin.svg -o /tmp/world.png
```

`rsvg-convert` does not resolve CSS custom properties, so tokens render as black or transparent — that is expected and not a bug. This step checks **geometry** only: coastline, region outlines, mountains, river. Colour is verified in Task 6 in the browser, where the tokens actually resolve.

- [ ] **Step 7: Commit**

```bash
git add assets/campaign/sahar_basin.svg packages/app/src/ui/theme.css tools/validate_ui_palette.mjs
git commit -m "feat(app): the Sahar Basin map art, under the palette gate

Geometry from the approved mockup, with every hex replaced by a semantic token
and every text element removed -- names and doctrines belong to world.json, so
they stay translatable and cannot drift from the data. One <g> per region,
id=\"region-<id>\", which is the handle the shell restyles and the data gate greps
for.

validate_ui_palette.mjs scanned packages/app/src only, so art under assets/
would have shipped raw hex outside the one rule this project enforces with no
allowlist. assets/campaign is now a scan root, verified by watching a deliberate
#ff0000 fail."
```

---

### Task 6: The world map screen

**Files:**
- Create: `packages/app/src/ui/worldmap.ts`
- Create: `packages/app/src/ui/worldmap.test.ts`
- Modify: `packages/app/src/ui/theme.css` (layout rules for the screen)

**Interfaces:**
- Consumes: `ParsedWorld`, `regionProgress`, `townProgress`, `nextMissionOf` from Task 4; the SVG from Task 5.
- Produces, for Task 7:
  ```ts
  export interface WorldMapOptions {
    base: string;                    // deploy base, '/' locally
    world: ParsedWorld;
    ledger: LedgerData;
    svg: string;                     // the inlined SVG source
    href: (missionId: string) => string;
  }
  export function worldMap(opts: WorldMapOptions): HTMLElement
  ```
  Returns a detached element; the caller appends it. `worldMap` sets `data-status="live|complete|locked"` on each `#region-<id>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/ui/worldmap.test.ts`. Check whether the repo already has a DOM-based test to copy the environment setup from — if vitest is not configured with `environment: 'jsdom'` for this package, add `// @vitest-environment jsdom` as the first line of the file.

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import worldJson from '../../../../data/campaign/world.json';
import type { LedgerData } from '@lions/sim';
import { parseWorld } from '../campaign';
import { worldMap } from './worldmap';

const world = parseWorld(worldJson);
const SVG = '<svg viewBox="0 0 1140 790"><g id="region-marj"/><g id="region-sur"/><g id="region-naharin"/></svg>';
const ALL_BS = world.regions[0]!.towns[0]!.missions;

const render = (ledger: LedgerData): HTMLElement =>
  worldMap({ base: '/', world, ledger, svg: SVG, href: (id) => `?mission=${id}` });

const statusOf = (el: HTMLElement, region: string): string | null =>
  el.querySelector(`#region-${region}`)?.getAttribute('data-status') ?? null;

describe('worldMap', () => {
  it('marks each region with its derived status', () => {
    const el = render({});
    expect(statusOf(el, 'marj')).toBe('live');
    expect(statusOf(el, 'sur')).toBe('locked');
  });

  it('flattens a region once every one of its missions is done', () => {
    const el = render({ 'campaign.completed_missions': [...ALL_BS] });
    expect(statusOf(el, 'marj')).toBe('complete');
  });

  it('opens the next region when its gate is met', () => {
    const el = render({ 'campaign.completed_missions': ['beit_sahwan_3_clearance'] });
    expect(statusOf(el, 'sur')).toBe('live');
  });

  it('places one town marker per town, positioned from the data', () => {
    const el = render({});
    const towns = el.querySelectorAll('[data-town]');
    const total = world.regions.reduce((n, r) => n + r.towns.length, 0);
    expect(towns).toHaveLength(total);
    const bs = el.querySelector('[data-town="beit_sahwan"]') as HTMLElement;
    expect(bs.style.left).not.toBe('');
  });

  it('links a live town to its next mission', () => {
    const el = render({});
    const link = el.querySelector('[data-town="beit_sahwan"] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`?mission=${ALL_BS[0]}`);
  });

  it('links a town to its next unfinished mission after one is cleared', () => {
    const el = render({ 'campaign.completed_missions': [ALL_BS[0]!] });
    const link = el.querySelector('[data-town="beit_sahwan"] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`?mission=${ALL_BS[1]}`);
  });

  it('offers no link for a town with nothing left to play', () => {
    const el = render({ 'campaign.completed_missions': [...ALL_BS] });
    expect(el.querySelector('[data-town="beit_sahwan"] a')).toBe(null);
  });

  it('offers no link for a town with nothing authored yet', () => {
    expect(render({}).querySelector('[data-town="tel_marum"] a')).toBe(null);
  });

  it('says why a locked region is locked, naming the condition', () => {
    const panel = render({}).querySelector('[data-region-card="sur"]') as HTMLElement;
    expect(panel.textContent).toContain('beit_sahwan_3_clearance');
  });

  it('shows each region doctrine and mission count', () => {
    const card = render({}).querySelector('[data-region-card="marj"]') as HTMLElement;
    expect(card.textContent).toContain('tunnels');
    expect(card.textContent).toContain(`0 / ${ALL_BS.length}`);
  });

  it('shows the campaign ROE rating when there is one', () => {
    expect(render({ 'roe.mission_ratings': { a: 82 } }).textContent).toContain('82');
  });

  it('names the worst-rated mission, so a low rating is explainable', () => {
    const el = render({ 'roe.mission_ratings': { beit_sahwan_1_recon: 20, beit_sahwan_2_foothold: 60 } });
    expect(el.textContent).toContain('beit_sahwan_1_recon');
    expect(el.textContent).toContain('40'); // the mean of 20 and 60, computed here not in the sim
  });

  it('renders the cards even when the map failed to load', () => {
    // The caller passes '' when the fetch fails. Degrade, do not disappear.
    const el = worldMap({ base: '/', world, ledger: {}, svg: '', href: (id) => `?mission=${id}` });
    expect(el.querySelector('[data-region-card="marj"]')).not.toBe(null);
  });

  it('does not write to localStorage — the map is a view, not a save', () => {
    const before = window.localStorage.length;
    render({});
    expect(window.localStorage.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run packages/app/src/ui/worldmap.test.ts`
Expected: FAIL — cannot resolve `./worldmap`.

- [ ] **Step 3: Write the screen**

Create `packages/app/src/ui/worldmap.ts`. Read `packages/app/src/ui/menu.ts` and `panel.ts` first and follow their idiom: plain DOM construction, `rl-` class prefixes, no framework, no innerHTML for anything derived from data.

```ts
// The campaign world: the Sahar Basin, its three regions, and which of them are
// still asking for you. Replaces the flat mission list.
//
// A view over the ledger and nothing more. Region status is derived by @lions/data
// from campaign.completed_missions, so this file persists nothing and cannot disagree
// with what was played.
//
// The map SVG is *inlined* rather than loaded through <img> on purpose: its fills name
// palette tokens, and an <img>-loaded SVG cannot see the page's custom properties.

import type { LedgerData } from '@lions/sim';

import {
  campaignRoe,
  nextMissionOf,
  regionProgress,
  townProgress,
  type ParsedWorld,
  type WorldRegion,
} from '../campaign';

export interface WorldMapOptions {
  base: string;
  world: ParsedWorld;
  ledger: LedgerData;
  /** The campaign art's source, inlined by the caller. */
  svg: string;
  href: (missionId: string) => string;
}

/** viewBox the town coordinates in world.json are expressed in. */
const VIEW_W = 1140;
const VIEW_H = 790;

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export function worldMap(opts: WorldMapOptions): HTMLElement {
  const wrap = el('div', 'rl-world');

  // --- the map itself ------------------------------------------------------
  const board = el('div', 'rl-world__board');
  // Parsed as XML and adopted, rather than assigned to innerHTML. The asset is our own
  // build-time file, so this is not an injection fix -- it is that innerHTML on a string
  // that arrived over the network is indistinguishable, at a glance and to a scanner, from
  // the version of this line that would be a hole. DOMParser cannot execute script, so the
  // safe reading is the only reading.
  const parsed = new DOMParser().parseFromString(opts.svg, 'image/svg+xml');
  const svg = parsed.documentElement;
  const ok = svg.nodeName === 'svg' && parsed.querySelector('parsererror') === null;
  if (ok) {
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    board.appendChild(document.importNode(svg, true));
  } else if (opts.svg !== '') {
    // An empty string is the caller's documented "fetch failed"; anything else that fails
    // to parse is a corrupt asset and worth saying so.
    console.error('campaign map did not parse as SVG; drawing the cards without it');
  }

  for (const region of opts.world.regions) {
    const p = regionProgress(region, opts.ledger);
    const g = board.querySelector(`#region-${region.id}`);
    // A region with no shape in the art is caught by validate:data, so a miss here means
    // either the SVG was edited without running the gate or the fetch failed. Either way
    // the cards below still render, which is why this is a skip and not a throw.
    if (g) g.setAttribute('data-status', p.status);

    for (const town of region.towns) {
      const next = nextMissionOf(town, opts.ledger);
      const tp = townProgress(town, opts.ledger);
      const marker = el('div', 'rl-world__town');
      marker.dataset.town = town.id;
      marker.dataset.status = p.status;
      // Percentages, so the markers track the SVG as it scales.
      marker.style.left = `${((town.at[0] / VIEW_W) * 100).toFixed(3)}%`;
      marker.style.top = `${((town.at[1] / VIEW_H) * 100).toFixed(3)}%`;

      const label = `${town.name}${tp.total > 0 ? ` ${tp.done}/${tp.total}` : ''}`;
      if (next !== null && p.status !== 'locked') {
        const a = document.createElement('a');
        a.className = 'rl-world__townlink';
        a.href = opts.href(next);
        a.textContent = label;
        marker.appendChild(a);
      } else {
        marker.appendChild(el('span', 'rl-world__townname', label));
      }
      board.appendChild(marker);
    }
  }
  wrap.appendChild(board);

  // --- the status panel ----------------------------------------------------
  const cards = el('div', 'rl-world__cards');
  for (const region of opts.world.regions) cards.appendChild(regionCard(region, opts));
  wrap.appendChild(cards);

  wrap.appendChild(ledgerLine(opts.ledger));
  return wrap;
}

function regionCard(region: WorldRegion, opts: WorldMapOptions): HTMLElement {
  const p = regionProgress(region, opts.ledger);
  const card = el('div', 'rl-world__card');
  card.dataset.regionCard = region.id;
  card.dataset.status = p.status;

  card.appendChild(el('div', 'rl-world__cardname', region.name));
  card.appendChild(el('div', 'rl-world__carddoctrine rl-info', `${region.faction} · ${region.doctrine}`));

  const progress =
    p.status === 'locked'
      ? (p.lockedBecause ?? 'locked')
      : p.total === 0
        ? 'no operations authored yet'
        : `${p.done} / ${p.total} missions`;
  card.appendChild(el('div', 'rl-world__cardprogress', progress));
  card.appendChild(el('span', 'rl-world__badge', p.status));
  return card;
}

/** Roster, campaign ROE, and -- when the rating is dragging -- the mission dragging it.
 *  #22 asks for the ledger to be visible and for a low rating to be explainable, and a
 *  bare number explains nothing. */
function ledgerLine(ledger: LedgerData): HTMLElement {
  const line = el('div', 'rl-world__ledger rl-info');
  const parts: string[] = [];

  const roster = ledger['roster.surviving_units'];
  if (Array.isArray(roster) && roster.length > 0) {
    const vets = roster.filter((r) => r.veterancy > 0).length;
    parts.push(`roster ${roster.length}${vets > 0 ? ` (${vets}★)` : ''}`);
  }

  // The mean lives in campaignRoe, not in the ledger: the sim stores per-mission bests and
  // does not divide. This is also the figure a locked region's "requires campaign ROE 45"
  // is asking you to raise, so the two read together.
  const roe = campaignRoe(ledger);
  if (roe !== null) {
    parts.push(`ROE ${roe.mean}`);
    if (roe.worst !== null) parts.push(`worst ${roe.worst[0]} (${roe.worst[1]})`);
  }

  line.textContent = parts.length > 0 ? parts.join(' · ') : 'campaign: fresh start';
  return line;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/app/src/ui/worldmap.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Style the screen**

Add to `packages/app/src/ui/theme.css`, following the file's existing `.rl-menu__*` conventions. Use only semantic tokens and `color-mix()`; no hex, no `rgba()`.

```css
.rl-world { display: grid; gap: var(--s3); }
.rl-world__board { position: relative; width: 100%; max-width: 1140px; margin-inline: auto; }
.rl-world__board svg { display: block; width: 100%; height: auto; }

/* Three states, told apart by texture and saturation rather than brightness. */
[data-status='complete'] { filter: saturate(0.25); opacity: 0.75; }
[data-status='locked'] { filter: saturate(0.4); opacity: 0.45; }

.rl-world__town { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; }
.rl-world__townlink { color: var(--ink); font-weight: 600; }
.rl-world__townname { color: var(--ink-mute); text-decoration: line-through; }
.rl-world__town[data-status='locked'] .rl-world__townname { text-decoration: none; }

.rl-world__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--s2); }
.rl-world__card {
  border: 1px solid var(--panel-frame);
  border-left: 4px solid var(--map-spent);
  padding: var(--s2);
}
.rl-world__card[data-status='live'] { border-left-color: var(--map-live); }
.rl-world__card[data-status='locked'] { opacity: 0.6; }
.rl-world__badge { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); }
```

Confirm `--s3` exists; the file defines `--s1`, `--s2` and possibly more. Use only spacing tokens that are actually defined.

- [ ] **Step 6: Run the palette gate and the suite**

Run: `pnpm validate:ui && pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS. `validate:ui` failing here almost certainly means a colour literal crept into the CSS above.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/ui/worldmap.ts packages/app/src/ui/worldmap.test.ts packages/app/src/ui/theme.css
git commit -m "feat(app): the campaign world screen

Three region states set as data-status on the inlined SVG's region groups, town
markers positioned from world.json as percentages so they track the art as it
scales, and a card per region carrying doctrine, progress and -- when locked --
the condition that opens it.

The SVG is inlined rather than loaded through <img> because its fills name
palette tokens and an <img> SVG cannot see the page's custom properties.

The ledger line names the worst-rated mission rather than only printing a
number: #22 asks for a low rating to be explainable, and a bare figure explains
nothing. A test asserts the screen writes nothing to localStorage, because it is
a view over the ledger and must stay one."
```

---

### Task 7: Replace the flat list

**Files:**
- Modify: `packages/app/src/ui/menu.ts`
- Modify: `packages/app/src/main.ts` (menu branch around line 155–169; end-screen next-mission around line 761)

**Interfaces:**
- Consumes: `worldMap` from Task 6, `parseWorld`/`nextMissionOf` from Task 4, `world` from `@lions/data`.
- Produces: `MenuOptions` gains `world: ParsedWorld`, `ledger: LedgerData` and `svg: string`, and loses `missions` and `campaign`.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/ui/worldmap.test.ts`:

```ts
describe('showMenu', () => {
  it('mounts the world map and keeps the tutorial off it', () => {
    const stage = document.createElement('div');
    showMenu(stage, {
      base: '/',
      version: 'test',
      world,
      ledger: {},
      svg: SVG,
      tutorial: { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: false },
    });
    expect(stage.querySelector('.rl-world')).not.toBe(null);
    // The tutorial teaches the mouse, not the war, so it sits above the map.
    const tut = stage.querySelector('[data-kind="tutorial"]') as HTMLAnchorElement;
    expect(tut.getAttribute('href')).toBe('?mission=beit_sahwan_0_tutorial');
    expect(stage.querySelector('[data-town="beit_sahwan"]')).not.toBe(null);
  });

  it('drops the tutorial entry once it has been done', () => {
    const stage = document.createElement('div');
    showMenu(stage, {
      base: '/',
      version: 'test',
      world,
      ledger: {},
      svg: SVG,
      tutorial: { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true },
    });
    expect(stage.querySelector('[data-kind="tutorial"]')).toBe(null);
  });
});
```

Add `showMenu` to the file's imports: `import { showMenu } from './menu';`

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/app/src/ui/worldmap.test.ts -t showMenu`
Expected: FAIL — `MenuOptions` has no `world`.

- [ ] **Step 3: Rework the menu**

In `packages/app/src/ui/menu.ts`, replace `MissionEntry` and the `missions`/`campaign` fields of `MenuOptions`, and swap the mission loop for the map. Keep the banner, wordmark, sandbox and reset entries exactly as they are.

```ts
export interface MenuOptions {
  /** Deploy base ('/' locally, '/<repo>/' on Pages). */
  base: string;
  version: string;
  world: ParsedWorld;
  ledger: LedgerData;
  /** Campaign art source, inlined so its token fills resolve. '' if it failed to load. */
  svg: string;
  /** The tutorial is not on the map — it teaches the mouse, not the war. */
  tutorial: { id: string; name: string; done: boolean };
}
```

Replace the theatre line and the mission loop:

```ts
  const theatre = document.createElement('div');
  theatre.className = 'rl-menu__theatre';
  theatre.textContent = opts.world.name;
  wrap.appendChild(theatre);

  const nav = document.createElement('nav');
  nav.className = 'rl-menu__nav';
  const add = (label: string, href: string, kind = ''): void => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.className = 'rl-btn rl-menu__item';
    if (kind) a.dataset.kind = kind;
    nav.appendChild(a);
  };
  if (!opts.tutorial.done) add(opts.tutorial.name, `?mission=${opts.tutorial.id}`, 'tutorial');
  wrap.appendChild(nav);

  wrap.appendChild(
    worldMap({
      base: opts.base,
      world: opts.world,
      ledger: opts.ledger,
      svg: opts.svg,
      href: (id) => `?mission=${id}`,
    })
  );

  const aside = document.createElement('nav');
  aside.className = 'rl-menu__nav';
  const addAside = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.className = 'rl-btn rl-menu__item';
    a.dataset.kind = 'aside';
    aside.appendChild(a);
  };
  addAside('M0 sandbox (no mission)', '?sandbox=1');
  addAside('reset campaign ledger', '?fresh=1');
  wrap.appendChild(aside);
```

Add the imports: `import { worldMap } from './worldmap';`, `import type { ParsedWorld } from '../campaign';`, `import type { LedgerData } from '@lions/sim';`. Remove the now-unused `MissionEntry` export — and grep for it first (`grep -rn MissionEntry packages/`) so nothing is left referencing it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/app/src/ui/worldmap.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the shell**

In `packages/app/src/main.ts`, the menu branch (around line 155) currently maps `Object.entries(missions)`. Replace with:

```ts
    const tutorialDone = window.localStorage.getItem(TUTORIAL_DONE_KEY) !== null;
    showMenu(stage, {
      base: BASE,
      version: __GAME_VERSION__,
      world: worldData,
      ledger: loadLedger(),
      svg,
      tutorial: {
        id: 'beit_sahwan_0_tutorial',
        name: missions.beit_sahwan_0_tutorial.name ?? 'Tutorial',
        done: tutorialDone,
      },
    });
    return;
```

Import the raw `world` JSON from `@lions/data` and `parseWorld` from `./campaign`.

**The SVG must be fetched, not imported.** `packages/app/vite.config.ts:28` sets
`publicDir` to the repo-root `assets/` directory, so `assets/campaign/sahar_basin.svg` is
served at `${BASE}campaign/sahar_basin.svg` — and Vite deliberately does not bundle imports
out of `publicDir`, so `?raw` is not available. That is also why the banner in `menu.ts` is
referenced as `${opts.base}ui/menu_banner.jpg` rather than imported: follow that pattern.

So fetch it before showing the menu:

```ts
    // publicDir is the repo-root assets/ dir (vite.config.ts), so the map is served
    // rather than bundled. Inlined rather than used as an <img> because its fills name
    // palette tokens, and an <img>-loaded SVG cannot see the page's custom properties.
    const worldData = parseWorld(world);
    const svg = await fetch(`${BASE}${worldData.art}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .catch((err: unknown) => {
        console.error(`campaign map ${worldData.art} failed to load:`, err);
        return '';
      });
```

Check whether the enclosing function is already `async`; if it is not, make it so, or
attach the `.then` chain and call `showMenu` inside it. A failed fetch yields an empty
string, which renders the cards and town list without the map rather than a blank screen —
degrade, do not disappear.

- [ ] **Step 6: Take the end screen's "next mission" from the world, not from key order**

Around line 761, `const order = Object.keys(missions)` uses import order as campaign order, which is now wrong: `world.json` owns the order. Replace that lookup with a search across the world for the town owning the finished mission, then its next unfinished mission:

```ts
          // Campaign order lives in world.json, not in the order data/missions files
          // happen to be imported.
          const w = parseWorld(world);
          const town = w.regions.flatMap((r) => r.towns).find((t) => t.missions.includes(me.missionId));
          const nextMissionId = town ? (nextMissionOf(town, saved) ?? undefined) : undefined;
```

Read the surrounding code first and match its variable names — `me` and the saved-ledger variable may be named differently. Import `nextMissionOf` and `parseWorld` from `./campaign`.

- [ ] **Step 7: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. A `typecheck` failure here is most likely a leftover `missions`/`campaign` reference in `main.ts` — vitest does not typecheck, so `pnpm test` passing is not sufficient.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/ui/menu.ts packages/app/src/ui/worldmap.test.ts packages/app/src/main.ts
git commit -m "feat(app): the campaign menu is a map, not a list

showMenu mounts the world map; the tutorial stays a single entry above it,
shown until it has been done, because it teaches the mouse rather than the war.

The end screen's 'next mission' came from Object.keys(missions) -- import order
standing in for campaign order. It now comes from world.json, which actually
owns the order."
```

---

### Task 8: Verify in play, then the ten gates

The whole feature is a screen, so the only honest verification is driving it. Console shortcuts skip the code that breaks, which has already produced two false "it works" claims on this project.

**Files:** none created. Fixes land in the file that is wrong.

- [ ] **Step 1: Start the preview**

Use `preview_start` with the dev server from `.claude/launch.json` (create the entry if absent, using `pnpm dev` and its port). Do **not** run the dev server through Bash.

- [ ] **Step 2: A fresh campaign**

Navigate to `?fresh=1` to clear the ledger, then to the menu. Confirm with `read_page` and a screenshot:

- the Marj is full colour, its three towns named, Beit Sahwan linking to `beit_sahwan_1_recon`
- Sur and Naharin are visibly dimmer and each names its condition
- the tutorial entry is above the map
- `read_console_messages` is clean — in particular no warning about a missing `#region-*` id

- [ ] **Step 3: Complete a mission and re-read the map**

Play or force a victory in `beit_sahwan_1_recon`, return to the menu, and confirm Beit Sahwan reads `1/3`, the Marj is still live, and the town now links to `beit_sahwan_2_foothold`.

- [ ] **Step 4: Complete the region**

With all three Beit Sahwan missions done, confirm the Marj flattens and desaturates while staying legible, its towns strike through, and Sur becomes live and loses its lock text. Screenshot.

- [ ] **Step 5: Check a replay improves rather than inflates**

Note the ROE figure. Replay a mission and score worse: the figure must not fall. Replay and score better: it must rise, and the "worst" mission named in the ledger line must update. This is #22's acceptance criterion and the reason Task 3 exists.

- [ ] **Step 6: Responsive and dark**

`resize_window` to mobile and to desktop. Confirm the map scales, the town markers stay on their towns — they are positioned in percentages, so a mismatch means the SVG's `viewBox` does not match `VIEW_W`/`VIEW_H` in `worldmap.ts` — and nothing overflows horizontally.

- [ ] **Step 7: Run all ten gates**

```bash
for g in typecheck lint test test:determinism validate:data validate:assets validate:ui validate:audio build balance; do
  if pnpm $g >/dev/null 2>&1; then echo "PASS  $g"; else echo "FAIL  $g"; fi
done
```

Expected: ten PASS. Investigate any failure rather than re-running. `test:determinism` must still match the pinned hash.

- [ ] **Step 8: Commit any fixes and open the PR**

```bash
git add <only the files you changed>
git commit -m "fix(app): <what driving the UI actually revealed>"
git push -u origin feat/campaign-world
gh pr create --title "The campaign world: a map of the Sahar Basin" --body "$(cat <<'EOF'
Closes #22. Closes #36.

The menu was a flat list, and GDD §2 could not fix it because §2 had no world in
it — only a table of three regions. §2 now carries the basin's layout and the
ordering principle that makes the campaign order inevitable rather than
arbitrary: proximity, then standoff, then source.

- `data/campaign/world.json` owns regions, towns, positions, mission order and
  unlocks; `assets/campaign/sahar_basin.svg` owns shape only. Adding a town is a
  content change.
- Region state is derived from `campaign.completed_missions`. No new save state,
  so the map cannot disagree with what was played.
- ROE now keeps the best rating per mission. The old cumulative was
  `(previous + this) / 2`, which could be farmed by replaying a good mission and
  never let a replay replace a bad score — making #22's replay requirement
  impossible to deliver honestly. The sim stores the bests and does not divide;
  the average is computed for display in `campaignRoe`, and unlock gating
  compares `sum >= floor * count`, which is exact where a truncated mean was not.
- `unlockReason` lifted out of `MissionRuntime` so the shell can render the same
  sentence without constructing a Sim.
- `validate_ui_palette.mjs` now scans `assets/campaign`, so the map art is
  actually inside the palette gate instead of beside it.

Verified by driving the UI through a fresh campaign, one mission, a completed
region and a replay. All ten gates pass; the determinism hash did not move.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage.** Geography canon → Task 1 Step 3. `world.json` + schema → Task 1. Region outlines as an SVG asset with ids → Task 5. Inlining and token fills → Tasks 5 and 6. `assets/campaign` in the palette gate → Task 5 Step 3, watched failing at Step 4. Three region states with texture/saturation dimming → Task 6 Steps 3 and 5. Status panel with doctrine, progress, lock reason → Task 6. Ledger visible, low rating explainable → Task 6's `ledgerLine`. Selecting a town starts its next mission → Task 6 Steps 3, verified Task 8. State derived not stored → Task 4, asserted by the localStorage test in Task 6. Unlocks reuse the existing predicate → Task 2. `roe.mission_ratings` → Task 3. Four data-gate checks → Task 1 Step 5, each watched failing at Step 6. Tutorial off the map → Task 1's `OFF_MAP` and Task 7. Verification by driving the UI → Task 8. Ten gates → Task 8 Step 7.

**Two spec items deliberately not tasked.** The GDD §8 mission-count revision and #65's missing phase are named in the spec as *not settled here*; adding tasks for them would exceed the branch's scope.

**Type consistency.** `UnlockGate`/`unlockReason` defined in Task 2, consumed by name in Tasks 2 and 4. `ParsedWorld`, `WorldRegion`, `WorldTown`, `RegionStatus`, `RegionProgress`, `parseWorld`, `regionProgress`, `townProgress`, `nextMissionOf` and `campaignRoe` all defined in `packages/app/src/campaign.ts` in Task 4, imported as `../campaign` from `ui/worldmap.ts` and `./campaign` from `main.ts`. `WorldMapOptions`/`worldMap` defined in Task 6, consumed in Task 7. `MenuOptions` rewritten in Task 7 and matched by Task 7 Step 1's test. `'roe.mission_ratings'` spelled identically in Tasks 2, 3, 4 and 6; `'roe.cumulative_rating'` is read as a legacy fallback in Tasks 2 and 4 and written by nobody. `VIEW_W`/`VIEW_H` in Task 6 tied to the `viewBox` required in Task 5 Step 2, and Task 8 Step 6 checks they agree. `world.json`'s `art` (`campaign/sahar_basin.svg`) is resolved as `assets/<art>` by Task 1's gate and as `${BASE}<art>` by Task 7's fetch — consistent, because `publicDir` *is* `assets/`.

**Three things the plan originally mandated that a reviewer would rightly have flagged, changed before execution.**

*A duplicated type.* An earlier draft split the campaign module so the parser could live in `@lions/data`, which forced the unlock type to be declared once per package as a verbatim copy. Trading a layering nicety for duplicated types is not a trade worth making. `@lions/data` now exports only the raw `world` JSON — exactly as it already does for `missions` — and the whole module is one file in `app` with one definition of everything. Task 4 Step 6 greps to prove `data` stayed a leaf.

*Division inside `@lions/sim`.* An earlier draft computed the ROE mean as `(total / values.length) | 0` in the mission runtime, matching a line already in that file. Matching existing code is not the same as being right, and "just this one calculation" is the exact phrasing CLAUDE.md tells you to refuse. The sim now stores per-mission bests and performs no arithmetic; `campaignRoe` averages for display in `app`, and `unlockReason` gates with `sum >= floor * count`. That comparison is not merely invariant-safe, it is *more* correct: a truncated mean rejects a campaign averaging exactly the floor.

*`innerHTML` for the map.* The asset is our own build-time file, so assigning it was not a live vulnerability — but `innerHTML` on a string that arrived over the network is indistinguishable, at a glance and to a scanner, from the version of that line that would be a hole. Task 6 parses with `DOMParser` and adopts the node, which cannot execute script, so the safe reading is the only reading.

**The other flagged risk was resolved before writing.**

`packages/app/vite.config.ts:28` sets `publicDir` to the repo-root `assets/`, so the map is
*served*, not bundled, and `?raw` is unavailable. Task 7 Step 5 fetches it instead, matching
how `menu.ts` already references its banner, and degrades to a mapless-but-usable screen if
the fetch fails.
