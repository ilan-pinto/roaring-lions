# Beit Sahwan IV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author `beit_sahwan_4_subterranean` — the first mission to use the `subterranean` phase — so the shipped tunnel subsystem is reachable from content, and close #91.

**Architecture:** Pure content. Three `pre_dug` tunnel routes join the shared `beit_sahwan_outskirts` map; a new mission digs a fourth live, stocks the three, and asks the player to collapse every mouth in the `town` zone. Because a `collapse` snapshots every mouth in its zone and route geometry is map data, Beit Sahwan II's existing secondary must be re-scoped to a tight zone first or it silently grows from one route to four.

**Tech Stack:** JSON content validated by `tools/validate_data.mjs`; TypeScript registration in `@lions/data`; `tools/src/walk_mission.ts` and `tools/src/backtest/playtest.ts` as the instruments. No `@lions/sim` or `@lions/render` change.

**Spec:** `docs/superpowers/specs/2026-08-20-beit-sahwan-iv-design.md`

## Global Constraints

- **No `packages/sim` or `packages/render` change.** If one turns out to be required, stop and raise it — it means the spec was wrong, not that the task grew.
- **`pnpm test:determinism` must stay pinned.** Nothing here is sim code, so any movement in the hash is a bug in this work.
- **`pnpm typecheck` is a required gate.** CI runs it and `CLAUDE.md` omits it; literal-union fields in mission JSON break JSON-module call sites and nothing but `tsc` catches it.
- **`yahalom_squad` arrives in `starting_force`, never as something the player must build.** It is gated at `roe_rating_min: 55` and `starting_force` does not consult `unlock`, but `requestBuild` does.
- **A primary `collapse` must declare `seconds`.** `validate_data.mjs:427` refuses it otherwise, and as built (`mission.ts:1355`) the deadline is the *only* failure branch.
- **Never `git add -A` in this working tree.** Other sessions share it; `packages/data/src/index.ts` currently carries another session's uncommitted `tunnel_demo` `// DEMO` lines and `data/{maps,missions}/tunnel_demo.json` are untracked. Add named paths only, and leave those lines alone.
- **Coordinates are tiles.** Placements use `x.5` centres; markers, zones and tunnel points use integers. A `count > 1` placement spreads over ~1.25 tiles per body, so neighbouring tiles must be unblocked too.

---

### Task 1: Route the district, and keep Beit Sahwan II whole

Adds the three new routes **and** the guard that stops them corrupting a shipped mission, in one commit — because the two are the same change. The middle steps demonstrate the regression before fixing it, so the guard is proven necessary rather than asserted.

**Files:**
- Modify: `data/maps/beit_sahwan_outskirts.json` (`tunnels` array, `zones` object)
- Modify: `data/missions/beit_sahwan_2_foothold.json` (objective `collapse_tunnel`, `target`)

**Interfaces:**
- Consumes: nothing.
- Produces: route ids `bs_tn_north`, `bs_tn_souk`, `bs_tn_clinic` (all `pre_dug: true`); map zone `tunnel_mouth_west` = `[29, 21, 3, 3]`. Task 3's mission stocks those three routes by id and collapses over `town`.

- [ ] **Step 1: Record what Beit Sahwan II's collapse currently resolves to**

This is the "before" number. Run:

```bash
node -e '
const map = require("./data/maps/beit_sahwan_outskirts.json");
const m = require("./data/missions/beit_sahwan_2_foothold.json");
const o = m.objectives.find(o => o.type === "collapse");
const [zx, zy, zw, zh] = map.zones[o.target];
const inZone = (map.tunnels ?? []).filter(t =>
  t.mouth[0] >= zx && t.mouth[0] < zx + zw && t.mouth[1] >= zy && t.mouth[1] < zy + zh);
console.log(`collapse "${o.id}" over zone "${o.target}" -> ${inZone.length} route(s): ${inZone.map(t => t.id).join(", ")}`);
'
```

Expected: `collapse "collapse_tunnel" over zone "town" -> 1 route(s): bs_tn_west`

- [ ] **Step 2: Add the three routes to the map**

In `data/maps/beit_sahwan_outskirts.json`, append these three objects to the existing `tunnels` array (which already holds `bs_tn_west`; leave it untouched — it must NOT become `pre_dug`, because Beit Sahwan II digs it and `validate_data.mjs:228` refuses a `digs` placement naming a pre_dug route):

```json
{
  "id": "bs_tn_north",
  "mouth": [27, 13],
  "waypoints": [[29, 15]],
  "vent": [32, 17],
  "pre_dug": true
},
{
  "id": "bs_tn_souk",
  "mouth": [22, 29],
  "waypoints": [[24, 27]],
  "vent": [26, 24],
  "pre_dug": true
},
{
  "id": "bs_tn_clinic",
  "mouth": [35, 26],
  "waypoints": [[33, 23]],
  "vent": [31, 21],
  "pre_dug": true
}
```

Every mouth is on unblocked ground and inside the `town` zone (`[19, 9, 22, 31]` — x 19–40, y 9–39). No polyline runs under a building footprint: the north block is x 28–31 y 10–12, the apartments x 34–38 y 16–19, the warehouse x 30–33 y 24–27, the shanty x 22–24 y 30–32. That matters because a trail tile under a footprint can park a charge team just out of range, where it latches without ever completing.

- [ ] **Step 3: Re-run Step 1's command and watch Beit Sahwan II break**

Run the exact command from Step 1 again.

Expected: `collapse "collapse_tunnel" over zone "town" -> 4 route(s): bs_tn_west, bs_tn_north, bs_tn_souk, bs_tn_clinic`

This is the regression. Beit Sahwan II's secondary now demands four collapses from one Yahalom in twelve minutes, and `pnpm validate:data` reports nothing, because it checks that mouths exist in the zone and never how many the author meant.

- [ ] **Step 4: Add the tight zone and retarget Beit Sahwan II**

In `data/maps/beit_sahwan_outskirts.json`, add to the `zones` object:

```json
"tunnel_mouth_west": [29, 21, 3, 3]
```

That rect covers x 29–31, y 21–23 and contains exactly `bs_tn_west`'s mouth `[30, 22]`.

In `data/missions/beit_sahwan_2_foothold.json`, change the `collapse_tunnel` objective's `target` from `"town"` to `"tunnel_mouth_west"`. Change nothing else about it — it stays `"primary": false` and keeps its text, which already says "the tunnel", singular.

- [ ] **Step 5: Re-run Step 1's command and watch it go green**

Run the exact command from Step 1 again.

Expected: `collapse "collapse_tunnel" over zone "tunnel_mouth_west" -> 1 route(s): bs_tn_west`

Back to what it meant before, and now immune to every future route added to the district.

- [ ] **Step 6: Run the data and type gates**

```bash
pnpm validate:data && pnpm typecheck
```

Expected: both pass. If `validate:data` complains that a `collapse` zone contains no tunnel mouths, the `tunnel_mouth_west` rect is wrong — check it against `bs_tn_west`'s mouth `[30, 22]`.

- [ ] **Step 7: Walk the three missions that share this map**

```bash
npx tsx tools/src/walk_mission.ts beit_sahwan_1_recon 0 60 120
npx tsx tools/src/walk_mission.ts beit_sahwan_2_foothold 0 60 120
npx tsx tools/src/walk_mission.ts beit_sahwan_3_clearance 0 60 120
```

Expected in all three: the run completes without throwing, and the `tunnels:` block lists four routes. `bs_tn_north`, `bs_tn_souk` and `bs_tn_clinic` show `progress=100% vent=open occupants=0` — pre_dug, unstocked, inert. In Beit Sahwan II only, `bs_tn_west` shows progress climbing from 0% as its authored digger works.

`occupants=0` on the three new routes is the thing to confirm. Anything else means a route id collided with a placement somewhere.

- [ ] **Step 8: Run the full test suite and the determinism pin**

```bash
pnpm test && pnpm test:determinism
```

Expected: all pass, determinism hash unmoved. These are content files; if the pin moves, stop — something is reading map tunnels into sim state in a way the spec did not account for.

- [ ] **Step 9: Commit**

```bash
git add data/maps/beit_sahwan_outskirts.json data/missions/beit_sahwan_2_foothold.json
git commit -m "feat(data): three routes under Beit Sahwan, and a zone that keeps II honest

The district gets the network its doctrine has always claimed: bs_tn_north
out of the house block, bs_tn_souk out of the shanty, bs_tn_clinic out of
the warehouse, all pre_dug because Ashwar dug them before the KDF arrived.

pre_dug is map state, so all three exist in Beit Sahwan I, II and III as
well -- inert there, and visible only as the faint identified line a recon
drone draws over a route it can read. bs_tn_west stays undug: II digs it,
and a digs placement naming a pre_dug route is refused.

The catch is that a collapse objective snapshots every mouth in its zone
and all map routes register unconditionally, so II's secondary silently
grew from one route to four -- with the same single Yahalom and the same
twelve minutes, and nothing in validate:data to say so. Retargeted to a
tight tunnel_mouth_west zone, which is what its own text always said:
the tunnel, singular.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The mission

**Files:**
- Create: `data/missions/beit_sahwan_4_subterranean.json`
- Modify: `packages/data/src/index.ts` (two imports, two registry entries)
- Modify: `data/campaign/world.json` (Beit Sahwan town mission list)

**Interfaces:**
- Consumes: route ids `bs_tn_north`, `bs_tn_souk`, `bs_tn_clinic` and zone `tunnel_mouth_west` from Task 1; existing map zones `town` and `clinic`; existing markers `town_center`, `mortar_line`, `civ_refuge`.
- Produces: mission id `beit_sahwan_4_subterranean`, registered as `missions.beit_sahwan_4_subterranean`. Task 3's playtest runs address it by that key, and address player units by type id through the harness's `ids(t)` helper.

- [ ] **Step 1: Write the mission file**

Create `data/missions/beit_sahwan_4_subterranean.json` with exactly this content. The `seconds: 300` deadline and the two wave times are first guesses; Task 4 replaces them with measured numbers.

```json
{
  "id": "beit_sahwan_4_subterranean",
  "name": "Beit Sahwan IV — Subterranean",
  "town": "beit_sahwan",
  "phase": "subterranean",
  "target_minutes": 6,
  "briefing": "The town is ours and the fighting has not stopped. Rounds come from empty ground, the shooters are gone before the echo, and the reason is under your feet: Ashwar mined this district long before we reached it. Four routes run beneath it. One they are digging again right now — you will see the spoil creeping west along the main road, and disturbed earth is something any soldier can read. The other three were finished years ago and left no dirt at all; only the drone or the engineers themselves can tell you where they run, and only while somebody is looking. Bring all four down. Yahalom must stand still in the open beside a route to set the charge, so whether they live is a decision you make with everything else you have.",
  "map": {
    "file": "beit_sahwan_outskirts",
    "player_start": [26, 34]
  },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": [
      "roster.surviving_units",
      "roe.mission_ratings",
      "campaign.completed_missions",
      "intel.marked_positions"
    ]
  },
  "starting_force": [
    { "unit": "yahalom_squad", "count": 1, "at": [25, 35] },
    { "unit": "yahalom_squad", "count": 1, "at": [27, 35] },
    { "unit": "recon_drone", "count": 1, "at": [24, 36] },
    { "unit": "inf_squad", "count": 3, "at": [24, 34], "from_ledger": true },
    { "unit": "ifv_namer", "count": 1, "at": [28, 34], "from_ledger": true },
    { "unit": "apc_eitan", "count": 1, "at": [26, 35] }
  ],
  "resources": {
    "logistics_start": 500,
    "logistics_rate_per_min": 90
  },
  "objectives": [
    {
      "id": "bring_it_down",
      "type": "collapse",
      "primary": true,
      "target": "town",
      "seconds": 300,
      "text": "Collapse every route under the district"
    },
    {
      "id": "read_the_ground",
      "type": "locate",
      "primary": false,
      "count": 3,
      "text": "Identify three positions holding the network open"
    }
  ],
  "roe": {
    "enabled": true,
    "flagged_zones": ["clinic"],
    "fail_below": 40,
    "structure_penalty_mult": 1
  },
  "enemy": {
    "faction": "ashwar",
    "doctrine_profile": "the network beneath",
    "garrison": [
      {
        "unit": "militia_cell",
        "count": 1,
        "at": [23.5, 31.5],
        "facing_deg": 180,
        "stance": { "kind": "garrison", "building": [23, 31] },
        "tag": "bs4_cell_souk"
      },
      {
        "unit": "militia_cell",
        "count": 1,
        "at": [29.5, 11.5],
        "facing_deg": 180,
        "stance": { "kind": "garrison", "building": [29, 11] },
        "tag": "bs4_cell_north"
      },
      {
        "unit": "rpg_team",
        "count": 1,
        "at": [28.5, 20.5],
        "facing_deg": 180,
        "stance": { "kind": "ambush", "tiles": 4 },
        "tag": "bs4_ambush_road"
      },
      {
        "unit": "charge_squad",
        "count": 1,
        "at": [25.5, 25.5],
        "facing_deg": 180,
        "stance": { "kind": "ambush", "tiles": 4 },
        "tag": "bs4_charge_crossroads"
      },
      {
        "unit": "digger_crew",
        "count": 1,
        "at": [26.5, 12.5],
        "digs": "bs_tn_west",
        "tag": "bs4_digger"
      },
      { "unit": "rpg_team", "count": 2, "at": [27.5, 13.5], "in_tunnel": "bs_tn_north" },
      { "unit": "militia_cell", "count": 2, "at": [22.5, 29.5], "in_tunnel": "bs_tn_souk" },
      { "unit": "rpg_team", "count": 1, "at": [35.5, 26.5], "in_tunnel": "bs_tn_clinic" },
      { "unit": "militia_cell", "count": 1, "at": [35.5, 26.5], "in_tunnel": "bs_tn_clinic" }
    ],
    "waves": [
      {
        "at_seconds": 150,
        "to": "town_center",
        "units": [{ "unit": "militia_cell", "count": 2, "from": "mortar_line" }]
      },
      {
        "at_seconds": 240,
        "to": "town_center",
        "units": [
          { "unit": "rpg_team", "count": 1, "from": "mortar_line" },
          { "unit": "technical", "count": 1, "from": "mortar_line" }
        ]
      }
    ]
  },
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [
      { "unit": "civilians", "count": 2, "at": [28.5, 14.5] },
      { "unit": "civilians", "count": 2, "at": [24.5, 33.5] }
    ]
  }
}
```

Things in there that are load-bearing rather than taste:

- **Two `yahalom_squad` placements of `count: 1`, not one of `count: 2`.** A `count > 1` placement spreads its bodies ~1.25 tiles apart from the `at` point, and putting the two charge teams on opposite sides of the start line is the point.
- **The buried placements carry no `tag`.** `in_tunnel` is mutually exclusive with `tag`, and the runtime exempts buried bodies from the `locate` book anyway — identifying a body through three metres of earth would complete an objective against a unit nobody can see or reach.
- **`bs_tn_west` is dug but not stocked.** Its vent is at `[7, 22]`, far out in the west approach where the player never goes, so a garrison below it would surface at nothing. Its job is the spoil: the one route in this mission that any unit can find by looking at the ground.
- **The digger stands at `[26.5, 12.5]`, not at the mouth.** `stepDigging` (`sim.ts:1993`) checks only that the assigned digger is alive, never where it stands, so it sits deep in the north block behind `bs4_cell_north`. Killing it stops the dig; it does not collapse the route, and the charge is still owed.
- **`locate` with `count: 3` against five tagged surface placements.** Enough slack that a dead tag does not strand the secondary.

- [ ] **Step 2: Run the data gate and watch it pass**

```bash
pnpm validate:data
```

Expected: pass. If it fails, the message names the rule. The likely ones:
- *"declares digs ... but that route is pre_dug"* — Task 1 wrongly set `pre_dug` on `bs_tn_west`.
- *"in_tunnel ... not pre_dug and no placement digs it"* — a route id is misspelled.
- *"collapse ... is primary but declares no seconds deadline"* — the `seconds` field was dropped.
- *"no building at (x,y) for militia_cell to garrison"* — a `stance.building` tile is not a structure tile.

- [ ] **Step 3: Register the mission in `@lions/data`**

In `packages/data/src/index.ts`, add one import beside the other Beit Sahwan mission imports:

```ts
import beitSahwan4 from '../../../data/missions/beit_sahwan_4_subterranean.json';
```

and one entry in the `missions` object:

```ts
  beit_sahwan_4_subterranean: beitSahwan4,
```

**Leave the two `// DEMO` `tunnel_demo` lines exactly as they are.** They are another session's uncommitted work in this shared tree.

- [ ] **Step 4: Add the mission to the campaign world**

In `data/campaign/world.json`, append `"beit_sahwan_4_subterranean"` to the end of the Beit Sahwan town's `missions` array, after `"beit_sahwan_3_clearance"`.

- [ ] **Step 5: Run the type and data gates together**

```bash
pnpm validate:data && pnpm typecheck && pnpm test
```

Expected: all pass. `typecheck` is the one that matters here — a literal-union field in the new JSON that `tsc` widens to `string` breaks the `MissionJson` call sites and nothing else catches it.

- [ ] **Step 6: Walk the mission and read the world**

```bash
npx tsx tools/src/walk_mission.ts beit_sahwan_4_subterranean 0 30 60 120 180 240 300 360
```

This is a passive walk — the player gives no orders — so it proves the enemy half of the chain, not the collapse. Expected at `t=0`:

- four routes listed; `bs_tn_north`, `bs_tn_souk`, `bs_tn_clinic` at `progress=100% vent=open`
- `occupants=2` on `bs_tn_north` and `bs_tn_souk`, `occupants=2` on `bs_tn_clinic`
- `bs_tn_west` at `progress=0% vent=shut occupants=0`

and over time:

- `bs_tn_west` progress climbing (23 tiles at 0.16 tiles/s ≈ 144s to `vent=open`)
- occupants dropping on a stocked route only if its garrison surfaced and was killed — with no player orders they should mostly stay below
- no route reaching `contact=identified` for long, since the player's detectors are sitting at the start line

If `bs_tn_west` progress stays at 0%, the `digs` placement did not resolve — check the route id and that the digger is alive in the unit dump.

- [ ] **Step 7: Commit**

```bash
git add data/missions/beit_sahwan_4_subterranean.json data/campaign/world.json packages/data/src/index.ts
git commit -m "feat(data): Beit Sahwan IV, the first mission under the ground

The phase enum has carried \`subterranean\` since the map format was
written and no mission has ever used it. This one does: four routes under
the district, one being re-dug and laying spoil any soldier can read,
three finished years ago and leaving no dirt at all, so only the drone or
the engineers can say where they run -- and only while somebody is
looking.

The player comes up from the south because every other start line hands
away a route for free: from the west bs_tn_west passes within a tile of
the spawn, and from the east two routes fall inside a Yahalom's sight at
tick zero. The shanty block breaks the line from the south, so finding is
work.

Two Yahalom, both in starting_force. The unit is gated at ROE 55 and
starting_force does not consult unlock while requestBuild does, so a
player whose rating has slipped cannot replace the one unit the primary
depends on -- the trap Wadi Halam V sets with its demolishers.

Deadline and wave times are placeholders pending measurement.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Prove it winnable, and prove doing nothing is not

**Files:**
- Modify: `tools/src/backtest/playtest.ts` (append two `run(...)` calls at the end of the file)

**Interfaces:**
- Consumes: mission id `beit_sahwan_4_subterranean` from Task 2. The harness's `run(id, plan, ledger, expect, label)` signature and its `plan(sim, rt, ids, at)` callback, both already defined at the top of the file. `ids(t)` returns living player entity ids of unit type `t`; `at(seconds, fn)` schedules; `M(x, y)` builds a fixed-point move target.
- Produces: two console lines and a non-zero exit code on mismatch. Task 4 reads the reported minutes and objective statuses.

- [ ] **Step 1: Write the failing pair**

Append to the end of `tools/src/backtest/playtest.ts`:

```ts
// IV — Subterranean: tour the district with both charge teams, and let the
// drone walk ahead of them.
//
// A route can only be charged while it is identified, and identification is
// live: a mark_tunnel carrier has to hold a sight line to it. Both Yahalom
// carry the ability themselves at sight 8, so a team that walks onto a route
// finds it and holds it for its own charge; the drone's job is to shorten the
// walk by finding the next one while the current charge runs.
//
// The two teams split. South-west takes bs_tn_souk then bs_tn_west; north-east
// takes bs_tn_clinic then bs_tn_north. Serialising them on one team is what
// blows the budget.
run('beit_sahwan_4_subterranean', () => {}, {}, 'defeat', 'beit_sahwan_4_subterranean (no orders)');

run('beit_sahwan_4_subterranean', (sim, _rt, ids, at) => {
  const teams = ids('yahalom_squad');
  const west = teams.slice(0, 1);
  const east = teams.slice(1, 2);
  const drone = ids('recon_drone');
  const escort = [...ids('inf_squad'), ...ids('ifv_namer'), ...ids('apc_eitan')];

  // The drone runs the district ahead of the charges.
  at(2, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(26, 24) }));
  at(50, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(31, 21) }));
  at(120, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(32, 17) }));

  // West team: bs_tn_souk's vent, then onto bs_tn_west's line on the main road.
  at(2, () => sim.queueCommand({ kind: 'move', ids: west, ...M(26, 24) }));
  at(70, () => sim.queueCommand({ kind: 'move', ids: west, ...M(27, 22) }));

  // East team: bs_tn_clinic's vent on the main road, then north to bs_tn_north.
  at(2, () => sim.queueCommand({ kind: 'move', ids: east, ...M(31, 21) }));
  at(90, () => sim.queueCommand({ kind: 'move', ids: east, ...M(32, 17) }));

  // The escort moves with them and stays between the teams and the vents.
  at(2, () => sim.queueCommand({ kind: 'move', ids: escort, ...M(27, 25) }));
  at(80, () => sim.queueCommand({ kind: 'move', ids: escort, ...M(30, 21) }));
});
```

- [ ] **Step 2: Run it and expect the scripted run to fail**

```bash
npx tsx tools/src/backtest/playtest.ts 2>&1 | tail -20
```

Expected: the `(no orders)` control reports `DEFEAT` (the primary fails at its deadline with nothing collapsed) and passes. The scripted run almost certainly reports `DEFEAT` or `ONGOING` on the first attempt and prints `FAILED — expected VICTORY`. That is the starting point, not a problem: the move targets are guesses at where a charge team must stand.

- [ ] **Step 3: Diagnose with the walker, not by guessing**

For each route the scripted run failed to collapse, find out which link broke:

```bash
npx tsx tools/src/walk_mission.ts beit_sahwan_4_subterranean 0 60 120 180 240 300
```

Read the `tunnels:` block per route:
- `contact=unknown` — nobody with `mark_tunnel` held a sight line. Move the team closer or onto the route's line, or send the drone first.
- `contact=identified` but never `COLLAPSED` — the team is identifying but not charging. It must be stationary, unpinned, undisplaced, and within charge range (2 tiles) of a route tile. Move the target onto a tile the polyline actually passes under.
- occupants killing the team — the vent is venting onto it. Put the escort between them, or take the route from a tile the vent has no line to.

- [ ] **Step 4: Adjust the plan's move targets and re-run until VICTORY**

Change only the `M(x, y)` targets and the `at(...)` times in the scripted run. Do **not** change the mission file to make the plan work — a plan that needs the mission softened is telling you the mission is too hard, and that is Task 4's question, decided by measurement.

```bash
npx tsx tools/src/backtest/playtest.ts 2>&1 | tail -20
```

Expected, eventually: `beit_sahwan_4_subterranean: VICTORY in N.N min, ROE ..., objectives bring_it_down=c read_the_ground=... , roster out ...`

- [ ] **Step 5: Confirm the control still fails for the right reason**

The `(no orders)` line must still say `DEFEAT`. If it says `ONGOING`, the primary is not failing at its deadline — check that `seconds` is still on the objective. If it says `VICTORY`, something is collapsing routes with no orders given, which would be a sim bug worth stopping for.

- [ ] **Step 6: Commit**

```bash
git add tools/src/backtest/playtest.ts
git commit -m "test(tools): Beit Sahwan IV is winnable, and doing nothing is not

The pair c5e91dd established for the Wadi Halam arc, applied to the first
subterranean mission: a scripted plan that splits both charge teams across
the district and finishes inside the budget, and a no-orders control that
must lose.

The control is the one that matters here. A collapse primary fails only on
its deadline -- the design's 'fails when no living unit can carry a charge'
was never implemented -- so a passive force has to run the clock out and
lose. If it ever reports ONGOING, the deadline has gone missing and the
mission is unwinnable and unlosable at once.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Measure it to six minutes

The other four Beit Sahwan missions are 10–12 minutes against a 5–7 target (#84) precisely because `target_minutes` was a claim nobody checked. This task is the check.

**Files:**
- Modify: `data/missions/beit_sahwan_4_subterranean.json` (objective `seconds`, wave `at_seconds`, garrison and wave sizes)
- Modify: `tools/src/backtest/playtest.ts` if the plan needs re-timing after a mission change

**Interfaces:**
- Consumes: the passing pair from Task 3.
- Produces: a measured completion time and a `seconds` deadline set from it. Nothing downstream depends on the numbers.

- [ ] **Step 1: Read the measured completion time**

```bash
npx tsx tools/src/backtest/playtest.ts 2>&1 | grep beit_sahwan_4
```

The scripted run's `VICTORY in N.N min` is the number. Target is 6.0, band is 5–7.

- [ ] **Step 2: Sample the fight for dead air**

```bash
npx tsx tools/src/walk_mission.ts beit_sahwan_4_subterranean 0 30 60 90 120 150 180 210 240 270 300 330 360
```

Count player HP across the samples. #90 measured Wadi Halam's holds running two thirds of their length with no contact at all; the same reading applied here means checking there is no window longer than ~45s where player HP is flat and no route is changing state.

- [ ] **Step 3: Adjust, in this order**

If the run finishes well under 5 minutes, it is too easy: add a body to a stocked route or bring a wave forward. If it runs past 7, it is too long: the dominant cost is Yahalom walking at 0.85 tiles/s between four routes, so shorten that before touching enemy volume — the routes' vent positions are the lever.

If a window of dead air shows up, move a wave rather than enlarging it. #90's finding was that the gaps hurt more than the wave sizes.

Re-run the playtest after every change. Change one thing at a time.

- [ ] **Step 4: Set the deadline from the measurement**

Set `bring_it_down`'s `seconds` to roughly the measured completion time plus 20%, rounded to a round number. It must be tight enough that a passive or badly-handled run fails on it, and loose enough that a competent run is not racing the clock — the deadline exists to make the mission losable, not to be the mission.

- [ ] **Step 5: Re-run every gate**

```bash
pnpm validate:data && pnpm typecheck && pnpm test && pnpm test:determinism
npx tsx tools/src/backtest/playtest.ts 2>&1 | tail -20
```

Expected: all green, both Beit Sahwan IV lines reporting their expected results, and the whole Beit Sahwan and Wadi Halam chain above them unchanged.

- [ ] **Step 6: Run the balance backtest**

```bash
pnpm balance
```

Expected: all five §5.7 targets unmoved. Nothing here touches the combat model or the unit catalogue, so any movement is a bug in this work.

- [ ] **Step 7: Commit**

```bash
git add data/missions/beit_sahwan_4_subterranean.json tools/src/backtest/playtest.ts
git commit -m "balance(data): Beit Sahwan IV measured to its six-minute target

Deadline and wave times set from what the playtest and the walker actually
report, not from what the design guessed. The four missions before it are
10-12 against a 5-7 target because target_minutes was a claim nobody
checked; this one was authored to target and then measured against it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Close the loop on what the issue promised

#91's rationale rests on a carry-over mechanic the engine does not have, and the schema still advertises tunnel-sourced waves that `mission.ts` does not resolve. Both were found while designing this and neither is fixed by it. Leaving that undocumented is how the next author walks into the same wall.

**Files:**
- Modify: `CLAUDE.md` (**Known scaling debts** section)
- No code change

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Record the wave gap in CLAUDE.md**

In the **Known scaling debts** section of `CLAUDE.md`, add a bullet:

```markdown
- `mission.schema.json`'s wave `from` promises "Spawn point or tunnel id. Tunnels
  keep producing until located and collapsed", but `mission.ts:1307` resolves `from`
  through `markerPos` only — a tunnel id there is an unknown marker. Tunnel-sourced
  reinforcement waves do not exist. Beit Sahwan IV works around it with `in_tunnel`
  garrisons that vent, which is the loop the subsystem was built around; the schema
  text should either be corrected or the feature built.
```

- [ ] **Step 2: Record the ledger gap in CLAUDE.md**

Add a second bullet in the same section:

```markdown
- `intel.marked_positions` cannot pre-reveal a tunnel route, and after the
  subsystem's playtest it should not: it reveals units by tag (`mission.ts:942`),
  exempts buried placements deliberately, and tunnel visibility is live — a route is
  identified only while a `mark_tunnel` carrier holds a sight line, so anything
  revealed at t=0 decays to unknown unwatched. GDD §4's "thorough recon → tunnel
  mouths pre-marked" is therefore not literal, and Beit Sahwan IV honours the
  contract through the surface ambushers instead.
```

- [ ] **Step 3: Run the gates one last time**

```bash
pnpm validate:data && pnpm typecheck && pnpm lint && pnpm test && pnpm test:determinism
npx tsx tools/src/backtest/playtest.ts 2>&1 | tail -20
pnpm balance
```

Expected: everything green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: two tunnel promises the schema makes and the runtime does not keep

Found while authoring Beit Sahwan IV. Wave \`from\` advertises tunnel ids
and resolves markers only, so tunnel-sourced reinforcement does not exist.
And intel.marked_positions cannot pre-reveal a route -- it reveals units by
tag, exempts buried placements, and tunnel contact is live, so anything
revealed at tick zero fades unwatched. GDD §4's headline carry-over example
is not literal today, and the issue that assumed it was is #91.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Report what #91's checklist still does not cover**

#91's definition of done has five boxes. Four are closed by Tasks 1–4: the spec, the mission passing `validate:data`, the winnable/no-orders harness pair, and the measurement against the target. The fifth — *"`walk_mission` shows the tunnels dug, found and collapsed across a full run"* — is only half closed, because `walk_mission` gives no orders and a collapse needs a player command. The dig, the spoil and the contact ladder are visible there; the charge and the collapse are proven in `playtest.ts` instead.

Say so plainly when reporting the work, and note that the issue text's carry-over rationale needs amending to match what was built.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: geography and the three routes → Task 1; the `pre_dug`-is-map-state consequence → Task 1 Step 7, which walks all three sibling missions; the Beit Sahwan II collision → Task 1 Steps 1–5; the mission, its start position, force, objectives and enemy → Task 2; the two-Yahalom rule and the deadline-as-only-failure-branch → Global Constraints and Task 2 Step 1; verification → Tasks 3 and 4; the two engine gaps the spec documents → Task 5.

**Not covered, deliberately.** The spec's "Out of scope" list (ledger pre-reveal, tunnel waves, #84's retuning of the other four missions, ROE for collapsing under civilian structures, the missing sprites in #92) has no tasks, which is correct.

**Type consistency.** Route ids `bs_tn_north` / `bs_tn_souk` / `bs_tn_clinic`, zone `tunnel_mouth_west`, mission id `beit_sahwan_4_subterranean` and the registry key of the same name are used identically in every task that names them. The harness helpers `ids`, `at`, `M` match their definitions at `playtest.ts:64`, `:70` and `:94`.
