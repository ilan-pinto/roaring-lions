# Combat formations P1a: the three MVP shapes (GH-859). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Design:** `docs/superpowers/specs/2026-10-28-combat-formations-design.md` (merged in PR 860). Read §0, §2.1,
§2.2 F1–F3, §3, §4.1–4.3, §4.5, §4.7, §4.8, §7 and §8 first. The old group formation is
`docs/superpowers/specs/2026-09-15-group-formation-design.md` and `packages/sim/src/formation.ts`.

**Rulings this plan builds on.**
- **Coordinator, 27 Oct (PR 860 comment, under the lead's 12-hour grant, reversible by the lead):** decisions
  1–19 are taken as the spec recommends. For P1a that means:
  - a one-shot armed order;
  - an optional `formation` id on `move`/`attackMove`;
  - a persistent group, built in two steps;
  - the full ring, with the 10% friendly-damage fallback to U/L shapes in P2;
  - the ring fires together;
  - no ratio step from a formation;
  - versus gets the three MVP formations, with the formation seat's edge capped at 65%;
  - the preview is the tooltip schematic only;
  - keys R/T/Y;
  - vehicles face front on arrival, and that is measured;
  - axis-squared approaches.

  No world overlay (slot ghost, drag-to-face) is built without a lead-approved mock.
- **The lead, 28 Oct (GH-859):** the P0 HUD mock is approved as drawn, and the label stays "Attack". The mock is
  at `/Users/ilpinto/dev/roaring-lions-ep/_coord/formations-mock/`: five HTML pages, their PNGs, and
  `scripts/build-mock.mts`, which holds the glyphs, the schematic marks and the CSS. It records these choices:
  - a FORMATION tag leads the row;
  - glyph colours follow the order families: Column manoeuvre (lime), Attack offensive (red), Ambush control
    (yellow);
  - the armed state reuses Patrol's, with a feed note and a small formation badge on the cursor;
  - the tooltip schematic is drawn from the selection's own class counts, with shape-coded classes;
  - the card line reads "In column — checkpoint N of M", with the pace-setter line beneath it;
  - the chip status reads "N in column · cp 3/5";
  - the row is absent for one unit, and inert with a reason otherwise.

**Base:** `origin/main` `25e3b3ca7`. The spec read `6448d111c`. Since then `packages/sim` has taken GH-560 (HP alone
ends a vehicle, `57f4dfc9`) and GH-867 (`ec543ef8`). Neither touches `formation.ts`, `applyMove`, the ambush or the
versus whitelist, but every pin below was re-read on `25e3b3ca7`. Re-check at pre-flight. Find code by symbol,
never by line: `applyMove`, `reservedTilesFor`, `finishLeg`, `checkAmbushSpring`, `setAmbush`,
`applySuppression`, `stepCombat`, `turnToward`, `hash()`, `cleanCommand`, `validateCommand`, `SeatWorld`,
`orderRow`, `chipStatus`, `patrolCountOf`.

**History checked (28 Oct).**
- `gh pr list --state all --search formation` finds PR 860 (this design, merged), PR 798 (vehicle ranks 3 deep),
  PR 765 (a patrol group never shares a goal tile) and PR 760 (the Patrol verb). PR 760 is the pattern for every
  UI file below.
- There is no implementation branch and no other open formation work. The one open PR is PR 873 (rain terrain
  design, docs only).

**Goal.** Two or more selected units can be ordered into Column, Attack or Ambush by a button or by R/T/Y, then
a click.
- They land in the formation's shape, by class.
- They face its front, or inward for the ring.
- An ambush ring takes cover and opens fire together.
- Every order without a formation is byte-identical to today. No existing pin, playtest, §5.7 reading or versus
  cell moves.

**Architecture.**
- **Data.** `formation.schema.json`, plus three files in `data/formations/`. They are written in full, P1b fields
  included, so P1b changes no schema.
- **Classes.** A pure `formationClassOf` is read once in `addUnitType` and stored as `UnitType.fmClass`. Four unit
  files gain a `formation_class` override.
- **Placement.** A new pure module, `packages/sim/src/formation-template.ts`, compiles a formation file, generates
  its slots (`files`, `rank`, `ring`, `point`) and fits them to the ground (`assignTemplate`). The HUD's
  schematic draws the same generator's open-ground output (`templateOffsets`), so the tooltip cannot disagree
  with the order.
- **The order.** `applyMove` branches before anything else reads `formation`: absent means today's code path.
- **The group table.** 2 × 16 rows, struct-of-arrays, plus three per-unit columns. All of it folds into `hash()`
  behind an `fmLive` latch.
- **Arrival.** `finishLeg` applies the arrival stance. A rest facing is turned to after arrival, and a target
  always wins.
- **The spring.** A pending flag, set where an ambusher springs or a member is fired on, springs the whole ring in
  a new `stepFormations` right after `stepCombat`.
- **Versus.** `cleanCommand` copies the field, and `validateCommand` asks `SeatWorld.formationAllowed`.
- **UI.** A formation row above the order row, R/T/Y, an armed state, a tooltip schematic, card and chip lines,
  and i18n.

**Tech stack:** TypeScript strict, vitest, Ajv (validate:data). No new dependencies.

---

## Scope

**In P1a** (spec §10): the schema and the three files; `formationClassOf` and the four overrides; the `formation`
field (sim, `cleanCommand`, `validateCommand`, advisor, agent harness); `assignTemplate` with `files`, `rank`,
`ring` and `point`; cover preference for the ring; arrival facing and stance; the group table with membership and
exits; the `spring` drill; the UI (row, keys, armed state, cursor badge, tooltip schematic, card and chip lines,
the "Ambush sprung" alert, inert states, i18n). Measured: §8.1, §8.2, §8.3 (urban in F2, the ambush probe),
§8.7, §8.8, plus the D14 facing reading.

**Not in P1a, but P1a leaves room for it (P1b):**

| P1b piece | The room P1a leaves |
|---|---|
| Route checkpoints, dress, speed matching | The schema's `march` block is validated and compiled into `CompiledFormation`, and the sim does not read it. The template branch of `applyMove` writes one goal per member. P1b inserts the route walk and the per-checkpoint waypoints there. `finishLeg`'s arrival hook is where P1b's dress gate goes. |
| `halt` and `press` drills, contact hooks | `contact.drill` compiles to an enum. `fmPend` is the single place a contact is noted, and in P1a it acts only on `spring`. `stepFormations` processes pending rows. |
| Aircraft and medic calls | `on_call` compiles per element and is unused. Aircraft and medics already stand at standoff slots. |
| The final-checkpoint reservation | `reservedTilesFor` is untouched in P1a. |
| Card lines "checkpoint N of M", pace; chip "· cp 3/5"; "In formation (no march)" | `formation-model.ts`'s line functions take a view object that P1b widens. The keys are added in P1b, when they can be true. |
| `FORMATION_WORLD_PIN` covering march and calls | It is born here. P1b re-pins it ("Was <n>."). |
| New columns (`fgLegs`, `fgRelease`, `fgDress`, `fgQuiet`, `fgPace`, `fgCallX/Y`, `fmLeg`, `fmSortie`, `fmHome*`) | Not allocated in P1a (Ruling 10). P1b appends them behind `fmLive`, and re-pins the snapshot format pin and `FORMATION_WORLD_PIN`. |

P2 (the other eight formations, `vee`, `echelon`, `slots`, `bound`, manual calls, the ground ghost) and P3 (enemy
use) are out of scope.

---

## Global Constraints (bind every task and every child)

- **G-1. The four invariants.**
  - Integers, Q16.16 `Fx` and u16 angles only in `packages/sim`. No `Math.*`, no `Date.*`, no float literal. The
    ring is the integer midpoint circle. A facing is an eighth-turn constant (multiples of 8192, 0 = +x,
    16384 = +y) chosen by integer comparisons. The centroid uses the existing remainder-first divide.
  - **No random draw anywhere.** Every tie breaks by id or tile index, and no stream is touched.
  - Nothing outside the sim writes the group table. Commands go in, state and events (`formationSprung`) come
    out.
  - Everything runs in the 20 Hz tick.
- **G-2. Byte identity without a formation.** An order without `formation` takes today's code path, untouched,
  through `applyMove` and everything after it. A registered formation table changes nothing until a formation is
  ordered. No pin, playtest plan, §5.7 reading or versus cell moves (§8.1). The only pins allowed to move are the
  snapshot format pin, because new `state` rows are encoded even when empty, and the newborn
  `FORMATION_WORLD_PIN`.
- **G-3. Cost.** No per-tick allocation.
  - The pending flag costs O(1) per suppression or spring.
  - `stepFormations` is O(rows), plus one compare per unit for the rest-facing turn, behind `fmLive` (the
    `stepPatrolStance` shape).
  - The spring itself is one O(count) scan per group, once in its life (it is guarded by state).
  - Everything else is order-time: a reachability walk of at most `FORMATION_WALK_CAP` 24 steps per distinct
    (mask, origin).
- **G-4. Pins move only as the pin table says, each in its own commit** carrying "Was <n>." and the reason. That
  commit comes straight after the commit that moved it, and the branch is never pushed between the two. A move this
  plan did not predict is a finding: STOP (S1).
- **G-5. Every new check is seen red** by a one-line mutation of the implementation. The commit message names the
  mutation and quotes its red line, and the mutation is undone by an edit. **Oracles take literals**, never
  values imported from the code under test. The class table, the ring lists and the facing constants are written
  out by hand (casebook: "the oracle imported its arguments").
- **G-6. No loosened test.** No existing assertion changes. A test that reds because of this work is a STOP, not a
  re-derive, since nothing existing should move (G-2).
- **G-7. Gates before every commit touching the sim:** `pnpm test:determinism && pnpm lint && pnpm typecheck &&
  pnpm test`. Before the task reports, also run `pnpm validate:data` and `pnpm validate:ui`, and, on sim and
  measurement tasks, `pnpm balance` and `pnpm playtest`. Record the outputs in
  `/Users/ilpinto/dev/roaring-lions-ep/_coord/formations-p1a-progress.md` (not committed).
- **G-8. House rules, in every brief.**
  - Never pkill or killall, and never kill a dev server. Port 5177 is off-limits.
  - **No browser in this plan.** No local `ui:routes`, `golden-baseline` or `ui:shots`: CI runs them. The UI is
    proved in jsdom/node tests, and its pseudo-locale check is a test (Task 8).
  - Test harnesses start with music off (`tools/src/ui-review/music-off.ts`). Never write `lions.settings` by
    hand.
  - Git: `/usr/bin/git`, one plain command per call. Commit with `git commit -F <msg> -- <paths>`. Never `-A`,
    `git checkout <file>`, `git stash`, rebase or force-push.
  - Issue refs are written GH-NNN, never with a hash mark (the UI palette gate reads one as a hex colour).
  - No deploys, secrets or production. The repo is public: no exploit details in commits or PR text.
  - Commits end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. The PR body ends with the Claude
    Code line. The lead merges.
- **G-9. Children.**
  - Every child runs in the FOREGROUND, with `model` passed explicitly. Sonnet implements and reviews routine
    work. Opus is for judgement only: the `sim-guard` review of every sim diff, STOP-gate readings, and the final
    review.
  - One reviewer per task, plus `sim-guard` (Opus) over every diff under `packages/sim`.
- **G-10. Shared files.** `sim.ts`, `en.json`, `hud.ts`, `main.ts`, `keymap.ts`, `theme.css` and
  `snapshot-schema.ts` are high-churn. Edit only the named sites, rebase on conflict, and never take another
  lane's hunk.
- **G-11. Data discipline (CLAUDE.md).**
  - Content is JSON validated by schema.
  - The formation JSON carries i18n **keys**, never text.
  - JSON-typed interfaces in the sim use `string` fields, not literal unions. `compileFormation` and
    `formationClassOf` check the values and throw, naming the id. A literal union in a JSON type breaks
    JSON-module call sites, and only `tsc` catches it (memory: "CI runs typecheck").
  - Labels are read through accessors at render time, never resolved at module load.

---

## Rulings on ambiguity (made in this plan; the lead may overturn any)

1. **The new code lives in a sibling file, `formation-template.ts`, not inside `formation.ts`** (spec §4.2 says
   "the same file"). `formation.ts` gains exactly two exports: `walk` with an optional `depth` (default
   `WALK_DEPTH`), and the behind-first overflow pass as a function. Both are refactors, and `formation.test.ts`
   plus the golden hash prove them byte-identical. That way `assignFormation` provably does not change (spec §5).
2. **Element stacking.** Elements fill in file order.
   - The first populated element's front row is the click row (forward 0); the ring's centre is the click.
   - Each later populated element's front row is `prevRear − gap − 1`, then pushed back to `−standoff` if that is
     deeper. `gap` and `standoff` default to 0.
   - `prevRear` is the deepest row the previous populated element **actually used**, so a street that stretches
     a file stretches what follows.
   - An element with no members takes no depth, and its gap is not applied.
   - A `point` element (recon) sits at `forward = +ahead` and does not move the stack.
   - `standoff` is a new optional element field. It is the spec's "standoff" (§2.1, §2.2 F2: medics and aircraft
     about 12 behind the click whatever is in front of them).
3. **Vehicle anchoring (the spec's carry-over of Deviation 4).** An element whose members are all ground vehicles
   anchors at the vehicle-snapped click when that differs from the foot click. The element after it then starts at
   row 0, as the old grid's infantry does. Aircraft take slots on the foot mask (Deviation 8). Every other element
   anchors at the foot click.
4. **`files` puts file 0 on the click line (lateral 0) and file f at `+f·file_gap`,** not symmetric about the
   click.
   - Spec F1 says "in a one-tile street the right file loses every slot": a file centred on the click is what
     makes that true. Symmetric files at ±1 would both lose every slot in a one-tile street.
   - Vehicles are staggered: slot k is file `k % files`, row `⌊k / files⌋`, at
     `forward = −(row·depth + file·stagger)`.
   - The schematic centres on its bounding box, so it reads as the approved mock does.
5. **Fill order is depth first, then lateral** (spec §4.2). Each generator emits its candidates sorted by row, and
   within a row in its lateral order:
   - `rank`: `0, +s, −s, +2s, −2s …` up to `max_lateral`;
   - `files`: file order.

   An unusable candidate is skipped and the element runs on. Members left over go to the existing behind-first
   overflow.
6. **The ring.**
   - **Radius:** the smallest R in `[radius[0], radius[1]]` whose midpoint-circle tile count is at least the
     ring's member count. The counts are 16, 24, 28 and 32 at R = 3, 4, 5 and 6.
   - **Order:** members are ordered by their class's position in the element's `classes` list, then by id.
   - **Spread:** the T ring tiles are in angular order (`ringTiles`), and the n base positions are `⌊k·T/n⌋`. Member j takes base position `σ(j)`, where σ lists
     `0..n−1` sorted by bit-reversed value (van der Corput order). The first-listed classes (armour, support
     weapons) are therefore spread round the ring, and later ones fill the gaps. This is integer-only.
   - **Cover preference:** each position tries the ring tile, the tile one step inward and the tile one step
     outward, the step being the sign vector of its (forward, lateral). It takes the usable candidate with the
     highest `cover`. Ties go to the ring tile first, then by tile index.
   - **Fallback:** a position with no usable candidate takes the next free ring tile in ring order, and only then
     the overflow.
   - **No `turn` field.** `arrival.face` is the one place a facing is said.
7. **Facing.** `restFacing` is written for every ground member at order time and **acted on only once the unit has
   stopped** (`moving === 0`), and only with no target, no aimed turn this tick, not mobility-killed and not
   contained.
   - `front`/`travel` give the frame's forward (identical in P1a; P1b gives `travel` its route meaning).
   - `inward`/`outward` give `eighthToward` from the slot to the click, or from the click to the slot.
   - A slot on the click itself takes forward.
   - Aircraft and `none` give `0xFFFF`.
   - It persists until an order or an exit clears it, so a hull that turned to shoot returns to its rest facing.
8. **Arrival stance** is a per-unit `fmArrive` code applied in `finishLeg`'s final-arrival branch. It is not tied
   to membership, so a degraded order (a full table) still gets shape, facing and stance (spec §4.3). The codes:
   - 0 none;
   - 1 hold, which is `haltUnit`'s writes (no shipped file uses it);
   - `FM_ARRIVE_AMBUSH` (16) + R, ambush with radius R.

   An ambush arrival after its group has sprung sets no stance.
9. **The spring.**
   - `fmPend(id)` sets the group's pending flag when the unit is a member, its group's drill is `spring`, and its
     state is `MARCH`. It is called at `stepCombat`'s existing spring site, after the stance clear and the
     `ambushSprung` push, and in `applySuppression`'s hostile-source branch.
   - So a ring that is discovered while still forming springs too: a trap the enemy has found is not a trap.
   - `stepFormations` (right after `stepCombat`) clears `stance` on every member still at ambush (1), sets
     `SPRUNG`, and pushes one `formationSprung`. The rest of the ring fires from the next tick, within 50 ms of the
     first springer. This is deterministic, and no member is favoured by its id.
   - A degraded ring (no row) springs member by member, as today.
10. **Columns are minimal.**
    - Per unit: `fmGroup` (`Int16Array`, −1), `restFacing` (`Uint16Array`, `0xFFFF`), `fmArrive` (`Uint8Array`).
    - Per row (`{ fixed: FORMATION_ROWS }` = 32): `fgLive`, `fgSide`, `fgType`, `fgState`, `fgPending`
      (`Uint8Array`) and `fgMembers` (`Uint16Array`).
    - P1b appends its own columns rather than P1a carrying dead state.
    - `fgState` uses `FM_MARCH` 1 and `FM_SPRUNG` 4. 2 (`ARRIVED`) and 3 (`CONTACT`) are reserved in a comment
      and are P1b's to define.
11. **Exits go through one funnel, `fmForget(id)`.** It clears membership, `restFacing` and `fmArrive`, and frees
    a row when its `fgMembers` reaches 0.
    - It is called for every id of every command except `attack` and `rescue`, beside the `tnOrderLive` clear in
      `applyCommands`' per-id pre-pass.
    - The `attack` and `rescue` branches call it only for the ids they accept (GH-420: a refused order changes
      nothing).
    - It is also called at death, rout, boarding (`carriedBy` set), garrisoning (`garrisonedIn` set), going below
      ground (`tunnelIn` set), and a wounded downing in place (behind `woundLive`).
    - The implementer greps every write that sets those fields and lists the sites in the ledger.
12. **Who is placed.**
    - Members are the existing `applyMove` members (alive, not routed, not carried, not landing) whose `fmClass`
      is not none.
    - A class-none id in a formation order gets no slot and no write (it ignores the order). A test pins this.
    - Fewer than `min_members` members, a verb mismatch (an `attackMove` naming a `move` formation, or the reverse),
      an unknown id, side > 1, or `exact: true` all give today's plain order: the template branch is not entered.
    - **The sim does not check factions.** It knows sides, not factions. All three files ship
      `["kdf", "sarim"]`, and the faction rule is `validateCommand`'s. A faction-gated formation (P2/P3) needs
      sim side-to-faction data first.
13. **The formation id on the wire** must match `FORMATION_ID` = `^[a-z][a-z0-9_]{0,31}$`. That is at most 32
    characters, the spec's bound, and the house pattern. It lives in `@lions/net` and is mirrored by the schema's
    `id` pattern. `tools/src/formation-id-pattern.test.ts` pins the two against every shipped id, as
    `unit-id-pattern.test.ts` does for units.
14. **The "places N units for N = 2…24" check is a vitest test,** `tools/src/formations_place.test.ts`, and not
    part of `validate_formations.mjs`. The `.mjs` validators run in node with no build step and cannot import the
    sim's generator. The `.mjs` keeps the static checks (spec §3.1). Both run in CI.
15. **Rule 1 of the class function reads `faction === "civilian"`,** not "side 2": unit JSON has no side.
    `civilians.json` declares `faction: "civilian"`. The resolved `wheeled` boolean is passed in from
    `addUnitType`, so the function never re-derives `FOOT_ROLES`.
16. **The tooltip copy says only what P1a does** (Q2). Lines are composed from facts:
    `hud.formation.face.<face>`, `hud.formation.drill.<drill>` and `hud.formation.shape.ring`. P1a ships no
    `drill.halt` line ("Halts if it meets the enemy") and no pace or "until called" clause. P1b adds them with the
    behaviour.

---

## The three files (exact, Task 1)

```jsonc
// data/formations/column.json
{ "id": "column", "label": "formation.column.name", "blurb": "formation.column.blurb",
  "factions": ["kdf", "sarim"], "verb": "move", "min_members": 2,
  "elements": [
    { "classes": ["recon"],          "shape": { "kind": "point", "ahead": 3 } },
    { "classes": ["armour"],         "shape": { "kind": "files", "files": 2, "file_gap": 2, "depth": 3, "stagger": 1 } },
    { "classes": ["light_vehicle"],  "shape": { "kind": "files", "files": 2, "file_gap": 2, "depth": 3, "stagger": 1 }, "gap": 2 },
    { "classes": ["infantry"],       "shape": { "kind": "files", "files": 2, "file_gap": 2, "depth": 1 }, "gap": 1 },
    { "classes": ["support_weapon"], "shape": { "kind": "files", "files": 2, "file_gap": 2, "depth": 1 } },
    { "classes": ["medic"],          "shape": { "kind": "files", "files": 1, "depth": 2 }, "gap": 1, "on_call": "casualty" },
    { "classes": ["aircraft"],       "shape": { "kind": "rank", "spacing": 2, "max_lateral": 2, "rank_depth": 2 }, "gap": 2, "on_call": "contact" }
  ],
  "march": { "legs": true, "leg_tiles": 8, "pace": "slowest_ground", "dress_s": 3 },
  "arrival": { "face": "travel", "stance": "none" },
  "contact": { "drill": "halt", "call_radius_tiles": 12, "quiet_s": 10 } }

// data/formations/attack.json
{ "id": "attack", "label": "formation.attack.name", "blurb": "formation.attack.blurb",
  "factions": ["kdf", "sarim"], "verb": "attackMove", "min_members": 2,
  "elements": [
    { "classes": ["armour"],                  "shape": { "kind": "rank", "spacing": 2, "max_lateral": 6, "rank_depth": 3 } },
    { "classes": ["light_vehicle", "recon"],  "shape": { "kind": "rank", "spacing": 2, "max_lateral": 6, "rank_depth": 3 }, "gap": 2 },
    { "classes": ["infantry"],                "shape": { "kind": "rank", "spacing": 1, "max_lateral": 3, "rank_depth": 1 }, "gap": 1 },
    { "classes": ["support_weapon"],          "shape": { "kind": "rank", "spacing": 2, "max_lateral": 2, "rank_depth": 1 }, "gap": 3 },
    { "classes": ["medic"],                   "shape": { "kind": "rank", "spacing": 2, "max_lateral": 2, "rank_depth": 2 }, "gap": 1, "standoff": 11, "on_call": "casualty" },
    { "classes": ["aircraft"],                "shape": { "kind": "rank", "spacing": 2, "max_lateral": 2, "rank_depth": 2 }, "gap": 1, "standoff": 13, "on_call": "contact" }
  ],
  "march": { "legs": true, "leg_tiles": 8, "pace": "slowest_ground", "dress_s": 3 },
  "arrival": { "face": "front", "stance": "none" },
  "contact": { "drill": "press", "call_radius_tiles": 12, "quiet_s": 10 } }

// data/formations/ambush.json
{ "id": "ambush", "label": "formation.ambush.name", "blurb": "formation.ambush.blurb",
  "factions": ["kdf", "sarim"], "verb": "move", "min_members": 2,
  "elements": [
    { "classes": ["armour", "support_weapon", "light_vehicle", "recon", "infantry"],
      "shape": { "kind": "ring", "radius": [3, 6], "cover_pref": true } },
    { "classes": ["medic"],    "shape": { "kind": "rank", "spacing": 2, "max_lateral": 2, "rank_depth": 2 }, "gap": 2, "on_call": "casualty" },
    { "classes": ["aircraft"], "shape": { "kind": "rank", "spacing": 2, "max_lateral": 2, "rank_depth": 2 }, "gap": 1, "on_call": "contact" }
  ],
  "march": { "legs": true, "leg_tiles": 8, "pace": "slowest_ground", "dress_s": 3 },
  "arrival": { "face": "inward", "stance": "ambush" },
  "contact": { "drill": "spring", "call_radius_tiles": 12, "quiet_s": 10 } }
```

**Why these numbers.**
- **Vehicle spacing.** Vehicle-to-vehicle elements use `gap` 2, so consecutive vehicle rows stay 3 apart in a file
  (`VEHICLE_RANK_DEPTH` 3, measured by `formation_rank_depth.test.ts`). Vehicle-to-infantry uses 1
  (`VEHICLE_TO_INFANTRY_GAP`).
- **Medics.** The medic element holds the ambulance and medevac too, so its files and rank use depth 2.
- **Attack's standoffs.** Medics stand 11 behind the click and aircraft 13: the spec's "about 12".
- **Ambush.** The medics and aircraft stack behind the ring's rear (−R), on the side the group came from.

The placement test checks the spacing claims rather than trusting this paragraph (Task 2).

---

## Pin table

Values read on `25e3b3ca7`. Re-read every one at pre-flight.

| Pin | File | Task 3 (state, no behaviour) | Task 4 (behaviour) | Task 5 (versus) |
|---|---|---|---|---|
| golden flat `1258746094`, relief `1483138559`, orders `2559269335` | `packages/sim/src/determinism.test.ts` | unchanged | unchanged (no command carries `formation`) | — |
| `ECONOMY_PIN` `904873885` / `_RELIEF` `2771311510`, `RUNTIME_DIGEST_PIN` `2037118941` / `_RELIEF` `1884258391`, `WOUNDED_WORLD_PIN` `3748305113` | same file | unchanged | unchanged | — |
| `fire-support.test.ts` `HASH` `3036459314` | `packages/sim/src/` | unchanged | unchanged | — |
| **snapshot format pin `2452666963`** | `packages/sim/src/snapshot-witness.test.ts` | **moves**: the new `state` rows are encoded at their empty values. Proof: with the new rows cut from the table it reads `2452666963` again (the GH-421 method) | unchanged from Task 3's value (the world orders no formation) | — |
| **`FORMATION_WORLD_PIN`** (new) | `determinism.test.ts` | — | **born**, read from the first run | — |
| versus: `match-world.test.ts` `PINS` beit `1075203618` / tel_marum `4263437644`; `VERSUS_ECONOMY_PINS` tel_marum `-87577684` / wadi_tarfan `955375532`; `per-seat-types.test.ts` `1311563748`; `versus-breach.test.ts` `4158212441` / `1075203618` / `4263437644` | app, tools | unchanged | unchanged | unchanged (registration is config) |
| `shippedContentDigest()` | no literal | — | — | moves (formations join `Content`); no literal pins it |
| `pnpm playtest`: every plan 30/30, `LADDER_CREDITS` = `CAMPAIGN_CREDITS` `5961`, `ROSTER_MAX` `30` | `tools/src/backtest/playtest.ts`, `stores-model.ts` | byte-identical, timing aside | byte-identical | byte-identical |
| `pnpm balance` §5.7 | `tools/src/balance` | byte-identical | byte-identical; Task 6 adds lines, the old lines identical | — |
| versus offered cells (`pnpm versus:probe`, 96 seeds) | report-only | identical | identical (no-formation arm) | identical |
| golden visual | `tools/golden-baselines/` | unchanged (captures assert no selection, so the row never draws) | unchanged | — |

---

## Pre-flight conflict table

| Pair / task | Produces → consumes | Finding | Ruling |
|---|---|---|---|
| T1 → T2 | the schema, the three files, `formation_class` | T2's compile must accept exactly the schema's shapes | T2's tests compile the shipped files as well as fixtures |
| T2 → T3/T4 | `compileFormation`, `assignTemplate`, `templateOffsets`, `formationClassOf`, `eighthToward` | consistent | T2 lands first, unwired and hash-neutral |
| T3 → T4 | columns, latch, hash fold, snapshot rows, `addFormationType`, the `formation` field | T3 changes no behaviour; T4 is all behaviour | T3's byte identity, the snapshot pin aside, is its proof |
| T4 → T5 | the `formation` field honoured by the sim | versus copies it only after the sim honours it | sequential |
| T4 → T6 | probes need the behaviour | — | sequential; T6 runs no two heavy instruments at once |
| T2/T4 → T7/T8 | `templateOffsets`, `formationClassOf`, the read APIs, `formationSprung` | the UI reads, never re-derives | T7 may start after T2 against the pure API; T8 after T4 |
| T4 vs other sim lanes | `sim.ts` (`applyMove`, `finishLeg`, `stepCombat`, `applySuppression`, `hash`, `applyCommands`), `snapshot-schema.ts` | high churn: GH-560 and GH-867 landed this week | pre-flight runs `gh pr list --state open` and reads `_coord/*-progress.md`; rebase, never take another lane's hunk; re-read every pin after a rebase |
| T5 vs the net lanes (net-n3 Sarim seat, versus tunnels) | `protocol.ts`, `ownership.ts`, `frame-step.ts`, `content-digest.ts` | possible overlap | minimal hunks; a new required `SeatWorld` member makes `tsc` list every implementer, which is the point |
| T8 vs the HUD and polish lanes | `hud.ts`, `theme.css`, `main.ts`, `cursor.ts`, `vite-plugin-cursors.ts` | possible overlap | named sites only; rebase |
| T9 vs `CLAUDE.md`, `docs/HANDOVER.md`, `docs/agent-notes/` | shared docs | other lanes append | one bullet per file; rebase |

---

## Task 0: pre-flight (record in `_coord/formations-p1a-progress.md`)

**Model:** Sonnet. No commit.

- [ ] **1. Worktree.** `git -C /Users/ilpinto/dev/roaring-lions fetch origin main`, then
  `git -C /Users/ilpinto/dev/roaring-lions worktree add /Users/ilpinto/dev/roaring-lions-ep/formations-p1a -b
  feat/formations-p1a origin/main`, then `pnpm install` once.
  - Run `git log 25e3b3ca7..origin/main --oneline -- packages/sim packages/net packages/app/src/ui
    packages/app/src/input data/schemas` and record what moved. A change to `applyMove`, `finishLeg`,
    `checkAmbushSpring`, `cleanCommand` or `validateCommand` means re-reading this plan's named sites before Task 3.
- [ ] **2. Pins.** Re-read every literal in the pin table:
  `grep -rnE "toBe\([0-9]{8,}\)|_PIN = |PINS = |LADDER_CREDITS =|CAMPAIGN_CREDITS =|ROSTER_MAX =|const HASH" packages tools`.
  Note any value that differs.
- [ ] **3. Baselines** to `_coord/formations-p1a/baseline/`:
  - `pnpm test:determinism`, the full `pnpm test`, `pnpm balance` (both tiers), `pnpm playtest`;
  - `pnpm versus:probe` on the offered cells (`docs/agent-notes/sim-and-orders.md`, "Which versus:probe invocation
    is the bar"): the mirror on the four fair maps, KDF v Sarim placed force, `--economy` and `--tunnels`, all at
    `--seeds=96`.

  These are the byte-identity references for Tasks 3, 4 and 6. Never run two heavy instruments at once.
- [ ] **4. The class census.** Run the §3.2 rule over every file under `data/units/**` (a scratch script outside
  the repo). Confirm that it disagrees with the spec's §2.1 table in exactly four places: `dozer_d9`,
  `ugv_recon_dog`, `recon_zikit` and `at_nlos_team`. That was measured on `25e3b3ca7`, 50 files. A fifth
  disagreement is Q-level: report it and do not invent an override.
- [ ] **5. Keys.** Confirm r, t and y are unbound in `packages/app/src/input/keymap.ts`, and that no other module
  binds them (`grep -rn "'r'\|'t'\|'y'\|KeyR\|KeyT\|KeyY" packages/app/src --include='*.ts'`).
- [ ] **6. Other streams.** Run `gh pr list --state open` and list `_coord/*-progress.md`. Fill in the conflict
  table's overlap rows.

---

## Task 1: data — schema, the three files, the class override, the registry, the static validator

**Model:** Sonnet implementer; Sonnet reviewer.

**Files:**
- `data/schemas/formation.schema.json` (new);
- `data/formations/column.json`, `attack.json`, `ambush.json` (new; exactly as above);
- `data/schemas/unit.schema.json`: an optional `formation_class`, enum of the seven classes plus `"none"`;
- `data/units/kdf/dozer_d9.json` (`"armour"`), `ugv_recon_dog.json` (`"recon"`), `recon_zikit.json`
  (`"recon"`), `at_nlos_team.json` (`"support_weapon"`);
- `packages/data/src/index.ts`: `export const formations = [...]`, in sorted directory order;
- `packages/data/src/index.test.ts`: `formations` pinned to the directory, as `vfxEmitters` is;
- `tools/validate_formations.mjs` (new), called from `tools/validate_data.mjs` (header comment updated);
- `tools/validate_formations.test.ts` (new; fixture tests, the `validate_narrative` pattern);
- `packages/app/src/i18n/en.json`: the label and blurb keys, and the `hud.formation.face.*`,
  `hud.formation.drill.spring|press` and `hud.formation.shape.ring` lines the validator checks (copy below).

**Schema.**
- **Top level.** `id` matches `^[a-z][a-z0-9_]{0,31}$`. `label` and `blurb` match `^formation\.`. `factions` is
  `["kdf"|"sarim"]`, at least one. `verb` is `move`, `attackMove` or `either`. `min_members` is ≥ 2. `elements` has
  at least one entry.
- **Elements.** Each holds `classes` (the seven classes or `"rest"`), `shape` (a `oneOf` on `kind`, for `files`,
  `rank`, `ring` and `point` only), optional `gap` (≥ 0), optional `standoff` (≥ 0) and optional `on_call`
  (`contact`, `casualty` or `none`).
- **Shapes.**
  - `files`: `files` 1–3, `file_gap` ≥ 1, `depth` ≥ 1, `stagger` ≥ 0 (default 0).
  - `rank`: `spacing` ≥ 1, `max_lateral` 0–8, `rank_depth` ≥ 1.
  - `ring`: `radius` is `[min, max]` within 2–8, and `cover_pref` is a boolean.
  - `point`: `ahead` 1–6.
- **Blocks.** `march` is `legs`, `leg_tiles` 4–16, `pace` (`slowest_ground` or `none`) and `dress_s` 0–10.
  `arrival` is `face` (`front`, `travel`, `outward`, `inward` or `none`) and `stance` (`none`, `hold` or
  `ambush`). `contact` is `drill` (`halt`, `press`, `spring` or `none`), `call_radius_tiles` 4–24 and `quiet_s`
  2–30.
- `additionalProperties: false` everywhere. Every number is an integer.

**Static checks in `validate_formations.mjs`** (spec §3.1, less the placement run, Ruling 14):
- ids are unique, and each matches its filename;
- `label` and `blurb` keys exist in `en.json`;
- `hud.formation.face.<face>` exists, and so does `hud.formation.drill.<drill>` for every drill except `halt` and
  `none` (Ruling 16);
- a file with a ring has `hud.formation.shape.ring`;
- `factions` are `kdf` or `sarim`;
- `ring.radius[0] ≤ radius[1]`;
- `(files − 1) · file_gap` is even (an integer centre for the schematic);
- `"rest"` appears at most once, and only in the last element;
- `arrival.stance` is `ambush` only with a ring element and `contact.drill` `spring`;
- at most one ring element.

**en.json copy (P1a-true, Ruling 16):**
- `formation.column.name` "Column", `formation.column.blurb` "March in two files, heavy vehicles leading."
- `formation.attack.name` "Attack", `formation.attack.blurb` "Armour on the click, infantry close behind. Medics and
  aircraft hold back."
- `formation.ambush.name` "Ambush", `formation.ambush.blurb` "Ring the clicked ground and hold. Every unit opens
  fire together."
- `hud.formation.face.travel` "Faces the way you march.", `hud.formation.face.front` "Faces the approach.",
  `hud.formation.face.inward` "Faces inward."
- `hud.formation.drill.press` "Then press on, fighting.", `hud.formation.drill.spring` "Springs together."
- `hud.formation.shape.ring` "Ring radius grows with the force."

- [ ] **Step 1: failing tests.**
  - `index.test.ts`: `formations` ids equal the sorted directory listing.
  - `validate_formations.test.ts`: each static check gets one passing and one failing fixture (a duplicate id, a
    missing key, `"rest"` not last, an odd centre, ambush without a ring, two rings).
  - Run them: red.
- [ ] **Step 2: implement.** Schema, files, registry, validator, overrides and copy.
- [ ] **Step 3: gates.** `pnpm validate:data` and `pnpm test`. Then `pnpm test:determinism`, `pnpm balance` and
  `pnpm playtest`, all byte-identical: the unit overrides are fields nothing reads yet.
- [ ] **Step 4: mutations** (G-5), each red and quoted:
  - M-1a: drop `ambush.json` from `formations` (the directory pin reds);
  - M-1b: the validator skips the key check (the missing-key fixture passes when it must fail);
  - M-1c: `formation_class` enum without `"recon"` (`validate:data` reds on two units).
- [ ] **Step 5: commit** `data: formation schema, Column/Attack/Ambush, unit formation classes (GH-859 P1a)`.

---

## Task 2: the pure template — compile, classes, generators, fit (unwired, hash-neutral)

**Model:** Sonnet implementer; Sonnet reviewer. `sim-guard` (Opus) reviews Tasks 2–4 as one diff, after Task 4.

**Files:**
- `packages/sim/src/formation-template.ts` (new; imports only `./formation`);
- `packages/sim/src/formation-template.test.ts` (new);
- `packages/sim/src/formation.ts`: export `walk(mask, w, h, origin, depth = WALK_DEPTH)` and the overflow pass
  `overflowPlace(...)`, a refactor only (Ruling 1);
- `packages/sim/src/tuning.ts`: `MAX_FORMATION_GROUPS_PER_SIDE = 16`, `FORMATION_WALK_CAP = 24`;
- `packages/sim/src/index.ts`: export the pure API the app needs (`formationClassOf`, `templateOffsets`,
  `compileFormation`, `FORMATION_CLASSES`, the types);
- `tools/src/formations_place.test.ts` (new; Ruling 14).

**Interfaces.**

```ts
export const FORMATION_CLASSES = ['armour', 'light_vehicle', 'recon', 'infantry', 'support_weapon', 'medic', 'aircraft'] as const;
export const FM_CLASS_NONE = 255;
export const FM_FACING_NONE = 0xffff;
export const FM_ARRIVE_HOLD = 1;
export const FM_ARRIVE_AMBUSH = 16; // + R

/** The JSON shape, string-typed on purpose (G-11); compileFormation checks every value. */
export interface FormationJson { id: string; label: string; blurb: string; factions: string[]; verb: string;
  min_members: number; elements: FormationElementJson[]; march?: FormationMarchJson; arrival: { face: string; stance: string };
  contact: { drill: string; call_radius_tiles?: number; quiet_s?: number } }

export interface CompiledFormation {
  readonly id: string;
  readonly verb: number;          // FM_VERB_MOVE 0 | FM_VERB_ATTACK 1 | FM_VERB_EITHER 2
  readonly minMembers: number;
  readonly elements: readonly CompiledElement[];   // classMask (bit per class), shape (kind + ints), gap, standoff, onCall
  readonly face: number;          // FM_FACE_*
  readonly arriveStance: number;  // 0 | FM_ARRIVE_HOLD | FM_ARRIVE_AMBUSH (R added per order)
  readonly drill: number;         // FM_DRILL_NONE | HALT | PRESS | SPRING
  readonly extent: number;        // the walk depth, capped at FORMATION_WALK_CAP
  // P1b reads these; P1a compiles and stores them, and reads nothing:
  readonly legTiles: number; readonly dressTicks: number; readonly pace: number; readonly callRadius: number; readonly quietTicks: number;
}
/** Throws `formation <id>: <field> <value>` on anything the schema would refuse. Seconds become ticks (x20). */
export function compileFormation(json: FormationJson): CompiledFormation;

/** §3.2, first match wins: wounded role or civilian faction -> none; a rescue block or hull.can_carry exactly
 *  ["wounded"] -> medic; air domain -> aircraft; artillery|sniper -> support_weapon; mbt|ifv -> armour;
 *  recon -> recon; wheeled -> light_vehicle; else infantry. `formation_class` overrides (an unknown string throws). */
export function formationClassOf(json: UnitClassJson, wheeled: boolean): number;

/** One eighth-turn (0, 8192 ... 57344; 0 = +x, 16384 = +y) toward (dx, dy), by integer comparison:
 *  |dx| >= 2|dy| is an axis, |dy| >= 2|dx| is an axis, otherwise the diagonal. (0, 0) -> FM_FACING_NONE. */
export function eighthToward(dx: number, dy: number): number;

/** The integer midpoint circle at radius r, as (forward, lateral), in ANGULAR order: the first octant's steps from
 *  (r, 0), then each next octant counter-clockwise, every odd octant's steps reversed so the walk is continuous,
 *  and a tile repeated at an octant boundary dropped. Angular order is what makes Ruling 6's spread a spread. */
export function ringTiles(r: number): readonly (readonly [number, number])[];

export interface TemplateUnit { id: number; domain: number; cls: number; vehicle: boolean; air: boolean }
export interface TemplateInput { width: number; height: number; masks: readonly Uint8Array[];
  origins: readonly (readonly [number, number])[]; clickX: number; clickY: number; fromX: number; fromY: number;
  units: readonly TemplateUnit[]; reserved: Uint8Array; cover: Uint8Array }
export interface TemplateSlot { id: number; x: number; y: number; face: number }
/** Fit `tpl` to the ground (Rulings 2-7). ringRadius is 0 with no ring element. */
export function assignTemplate(input: TemplateInput, tpl: CompiledFormation): { slots: TemplateSlot[]; ringRadius: number };
/** The same fill on ground where every tile is usable: frame coordinates, one entry per class in `classes`
 *  (sorted as assignTemplate sorts members). The HUD schematic's only source. */
export function templateOffsets(tpl: CompiledFormation, classes: readonly number[]): { cls: number; forward: number; lateral: number }[];
```

`assignTemplate` and `templateOffsets` share one fill routine, which takes a `usable(member, x, y)` predicate.
`templateOffsets` passes "always", in an identity frame. That is the "cannot disagree" property, and a test pins it
(Step 1).

- [ ] **Step 1: failing tests** in `formation-template.test.ts`. Every expected value is a literal.
  - **The class table.** All 50 shipped units against the spec §2.1 table, written out as `id → class` literals,
    the four overrides included. Read the JSON from `../../../data/units/**` by relative path (the
    `separation-geometry.test.ts` pattern). Civilians and both wounded types read `none`.
  - **Ring lists.**
    - The counts are R = 2 → 12, 3 → 16, 4 → 24, 5 → 28, 6 → 32, 7 → 40 and 8 → 44.
    - The full R = 3 list, in order, as 16 literal pairs: (3,0) (3,1) (2,2) (1,3) (0,3) (−1,3) (−2,2) (−3,1)
      (−3,0) (−3,−1) (−2,−2) (−1,−3) (0,−3) (1,−3) (2,−2) (3,−1).
    - For R = 3…6, a test-local integer check that the list is angularly monotone, by quadrant and then by
      cross-product sign. It is written in the test, not imported.
  - **Radius choice.** n = 2 → 3, n = 16 → 3, n = 17 → 4, n = 32 → 6, and n = 33 → 6 with one member in overflow.
  - **Facings.** `eighthToward` for the eight unit vectors, (3, 1) → 0, (2, 1) → 8192, (1, 2) → 8192,
    (1, 3) → 16384, and (0, 0) → `FM_FACING_NONE`.
  - **Shapes on open ground** (a 48 × 48 open map, the approach from the south):
    - Column with 3 armour and 4 infantry: armour at (0, 0), (−1, +2), (−3, 0), infantry starting at row −5,
      as literal (forward, lateral) pairs.
    - Attack with 2 armour, 5 infantry and 1 medic: the medic at forward −11.
    - Ambush with 6 ring members: R 3; the bit-reversed spread puts the two armour on opposite halves; the medics
      sit at forward ≤ −4.
  - **A one-tile street** (a corridor along the approach): Column's file 1 is empty and file 0 holds every member
    in class order. Literal tiles.
  - **The boulder corridor:** armour anchors at the vehicle-snapped click (Ruling 3).
  - **All four approaches:** the same formation rotated is the same set of offsets.
  - **Shuffle invariance:** ids given in reverse give the same slots.
  - **Cover preference:** a hand-built cover grid with a cover-3 tile one step inward of one ring point, and a
    cover-2 tile one step outward of another. Each is taken; a tie takes the ring tile.
  - **The class-none rule:** a `none` unit gets no slot.
  - **`templateOffsets` equals `assignTemplate`'s output** on the open map in the identity frame, for every
    shipped formation and three class mixes.
  - **Compile:** every shipped file compiles. Fixtures for an unknown face, drill, kind and class each throw,
    naming the id. Seconds become ticks.
- [ ] **Step 2: failing tests** in `tools/src/formations_place.test.ts` (Ruling 14). Every shipped formation, on an
  open 48 × 48 map, for N = 2…24 over a fixed table of five mixes:
  - all infantry;
  - all armour;
  - a KDF company: 3 armour, 2 light, 1 recon, 12 infantry, 2 support, 2 medic, 2 aircraft;
  - an air-heavy mix: 4 aircraft and 4 infantry;
  - an enemy mix: 2 light, 8 infantry, 2 support.

  Each mix's units are ordered by a fixed roster list, so N takes the first N. Assert:
  - no tile is used twice;
  - every member gets a slot;
  - the realistic mixes (all but air-heavy) place every member inside the walk, with no overflow;
  - **vehicle spacing:** two ground-vehicle slots never share a lateral less than 3 apart in forward, and never
    sit at lateral distance 1. This is the `VEHICLE_RANK_DEPTH`/`VEHICLE_SPACING` claim the file numbers make;
  - every slot is within `extent` of the click.
  - **A sample floor:** the test counts the placements it checked and asserts the literal 3 × 23 × 5 = 345.
    An empty roster must fail (casebook: the empty array).
- [ ] **Step 3: implement.** `formation.ts`'s two exports change nothing it computes: `formation.test.ts`
  unchanged and green. Nothing in `sim.ts` changes in this task.
- [ ] **Step 4: gates (G-7).** `test:determinism` must pass unchanged. `balance` and `playtest` byte-identical.
- [ ] **Step 5: mutations** (G-5), each red and quoted:
  - M-2a: swap class rules 2 and 3 (`air_medevac_heli` reads aircraft, and the class table reds). **Not the
    spec's "swap rules 4 and 5":** those two conditions are disjoint (no role is both artillery and mbt), so that
    swap cannot fail. That is the casebook's "a check unable to fail", caught before it ships. A second
    mutation, M-2a′, swaps rules 6 and 7 (`scout_shachaf` reads light_vehicle);
  - M-2b: `place()` without `taken[t] = 1` (the "no tile twice" assertion in `formations_place.test.ts` reds);
  - M-2c: the column's light-vehicle `gap` 2 → 0 in a fixture copy (the spacing assertion reds);
  - M-2d: the ring spread by plain stride, not bit reversal (the armour-on-opposite-halves case reds);
  - M-2e: the cover preference takes the lowest cover (the cover case reds);
  - M-2f: `eighthToward` with a 3:1 test in place of 2:1 (`(2, 1)` reds);
  - M-2g: `templateOffsets` skips the stacking gap (the equality case reds).
- [ ] **Step 6: commit** `sim: formation templates, pure — classes, files/rank/ring/point, ring cover (GH-859 P1a)`.

---

## Task 3: the state — command field, registration, columns, latch, hash fold, snapshot rows (no behaviour)

**Model:** Sonnet implementer (`sim-guard` agent type, `model: sonnet`). The review is in Task 4.

**Files:** `packages/sim/src/sim.ts`, `packages/sim/src/snapshot-schema.ts`, `packages/sim/src/tuning.ts`
(`FORMATION_ROWS`), `packages/sim/src/snapshot-witness.test.ts` (the format pin, in its own commit).

**Interfaces.**

```ts
// Command: one optional field on each of the two kinds, documented beside `exact` and `sweep`.
| { kind: 'move'; ids: number[]; x: Fx; y: Fx; append?: boolean; exact?: boolean; formation?: string }
| { kind: 'attackMove'; ids: number[]; x: Fx; y: Fx; append?: boolean; exact?: boolean; sweep?: boolean; formation?: string }

// UnitType gains `fmClass: number`, set by formationClassOf(json, wheeled) in the type builder.

addFormationType(json: FormationJson): number;  // config; compiles; throws on a duplicate id; returns the index
formationTypeCount(): number;
formationIdOf(type: number): string;
```

- **Columns.** Ruling 10's columns, declared after `sepHitStationary`. `fmLive` is a private scalar.
  `formationTypes` is a `CompiledFormation[]`.
- **Snapshot rows,** appended at the table's end, as GH-421 did:
  - every column is `state`, the per-unit ones `'capacity'` and the per-row ones `{ fixed: FORMATION_ROWS }`;
  - `fmLive` is `state`, SCALAR;
  - `formationTypes` is `config`, `obj('array')`.
- **The `hash()` block,** appended after `sepLast`:
  `if (this.fmLive) { h = hashWord(h, 0x464d0001); /* 'FM' GH-859 P1a */ h = hashArray(h, …) }`, over the nine
  arrays in declaration order.

- [ ] **Step 1: the completeness gate goes red first.** Add the columns without schema rows, run
  `snapshot-schema.test.ts`, and quote the red. That is the free falsification. Then add the rows.
- [ ] **Step 2: tests.**
  - Registering the three shipped files leaves `hash()` equal to an unregistered twin over a 600-tick run with
    multi-unit moves.
  - `fmClass` reads the class table for three units.
  - `addFormationType` throws on a duplicate.
- [ ] **Step 3: gates (G-7).** Every determinism pin is unchanged, and so are `balance` and `playtest`. The snapshot
  format pin reds. Prove the move is only the new rows: remove the new rows from the table in a scratch edit, read
  `2452666963`, and undo the edit. Record both numbers in the ledger.
- [ ] **Step 4: mutation** (G-5). M-3a: the hash block without its `fmLive` guard. The golden flat pin reds (zeros
  folded), which proves the latch is what keeps the pins still. Undo.
- [ ] **Step 5: commits.**
  - `sim: formation state, latched and unhashed until ordered (GH-859 P1a)`;
  - then, alone, `test(sim): snapshot format pin, the formation rows (GH-859 P1a)`, carrying "Was 2452666963."
    and the cut-rows proof.

---

## Task 4: the behaviour — the template order, the group, arrival, rest facing, the ring springing together

**Model:** Sonnet implementer (`sim-guard` agent type, `model: sonnet`); **`sim-guard` (Opus) reviews Tasks 2–4**
for the invariants, the latch, byte identity, the exit funnel and the snapshot classes.

**Files:** `packages/sim/src/sim.ts`; `packages/sim/src/formation-group.test.ts` (new);
`packages/sim/src/determinism.test.ts` (`FORMATION_WORLD_PIN`);
`packages/sim/src/snapshot-witness-worlds.test-helper.ts` and `snapshot-witness.test.ts` (a formation world).

**Sites, by symbol.**
1. **`applyMove`.** Before the members are gathered, `const tpl = this.templateFor(cmd)`. It is `null` when
   `formation` is absent, unknown, `exact` is set, the verb mismatches, or the side is above 1 (Ruling 12). **With
   `null`, the code below runs exactly as today.**
   - With a template: gather `TemplateUnit`s (class ≠ none), take their centroid, and fall back to the plain path
     when they number fewer than `minMembers`. Otherwise set `fmLive = true` and call
     `assignTemplate({ …, cover: this.cover, reserved: this.reservedTilesFor(...) }, tpl)`, filling the same
     `slots` map the write loop reads.
   - After the write loop, for each id actually written: `restFacing` from the slot, `fmArrive` from the
     template plus the ring radius, then the row (lowest free row of the side; none means degraded, no row) and
     `fmGroup`.
   - The append fast-path writes the waypoint as today and still joins the group.
2. **`applyCommands`' per-id pre-pass.** `if (this.fmLive)`, `fmForget(id)` for every named id of every kind except
   `attack` and `rescue`. Their branches call it for the ids they accept (Ruling 11).
3. **Exit sites.** `fmForget` at `destroy`, at rout, and wherever `carriedBy`, `garrisonedIn` or `tunnelIn` is set
   ≥ 0. The wounded in-place downing gets it behind `woundLive`. List each site in the ledger.
4. **`finishLeg`.** In the final-arrival `else` branch:
   `if (this.fmLive && this.fmArrive[i] !== 0) this.fmArrived(i)` (Ruling 8).
5. **`stepCombat`.** At the existing spring (`this.stance[i] = 0; … 'ambushSprung'`):
   `if (this.fmLive) this.fmPend(i)`.
6. **`applySuppression`.** In the hostile-source branch: `if (this.fmLive) this.fmPend(target)`.
7. **`stepFormations()`.** New, called right after `stepCombat()` in `tick()`, behind `if (this.fmLive)`:
   - (a) every live row in index order with `fgPending`, which springs and then clears (Ruling 9);
   - (b) the rest-facing turn over `0..count−1` (Ruling 7), through `turnToward`.
8. **The event.** `| { kind: 'formationSprung'; tick: number; side: number; group: number; entity: number }`, where
   `entity` is the first springer. Add it to `SimEvent` and let `tsc` list every exhaustive consumer.
9. **Read APIs for the HUD,** scalar and allocation-free: `formationGroupOf(id)`, `formationTypeOfGroup(g)`,
   `formationStateOfGroup(g)`, `formationMembersOfGroup(g)`. The HUD already has `ambushRadiusSqOf` and `stance`.

- [ ] **Step 1: failing tests** in `formation-group.test.ts`. Each world is hand-built, and each expectation is a
  literal.
  - **Byte identity.** A world with the three formations REGISTERED, issuing multi-unit moves and attack-moves
    with no `formation`, hashes over 600 ticks to the same value as its twin with none registered. A move with
    `formation: 'nosuch'` hashes identically to one without the field. The registration matters: the golden
    replays register no formation, so on them alone M-4a could not go red.
  - **Shape.** A 6-unit Column, Attack and Ambush each land on Task 2's literal tiles in a sim. The goal tiles are
    read back.
  - **Plain fallbacks:** fewer than `min_members` (one unit plus one passenger); `exact: true`; an `attackMove`
    naming `column`; side 2. Each reads `formationGroupOf === −1`, and the goals equal the no-formation order's.
  - **Class none:** a `wounded_kdf`-class id in a formation order keeps its goal.
  - **Facing.**
    - A Lavi in Attack, approaching from the west, ends with facing 0 (+x) within `ceil(65536 / turnPerTick)`
      ticks after arrival.
    - An Ambush ring Lavi ends facing inward (the literal eighth).
    - With a target in range it turns to the target. When the target is dead it returns to the rest facing.
    - A new order clears `restFacing`.
  - **Arrival stance.** An Ambush member reads `ambushRadiusSqOf = R²` (R literal) after arrival and 0 while
    walking. Its group springs before it arrives: no stance on arrival.
  - **Springing together.** Six ring members; one enemy walks into one member's radius. On the spring tick + 1,
    every ring member's stance is 0. Exactly one `formationSprung` is emitted.
    - Fired upon: hostile suppression on a member springs the ring. Friendly splash suppression does not.
    - A degraded ring (17 groups ordered on side 0, the 17th is the ring) springs member by member.
  - **Membership and exits.** One test per exit, each a literal count of `formationMembersOfGroup` before and
    after:
    - a later order;
    - a refused `attack` (the member stays);
    - death;
    - rout;
    - boarding;
    - garrisoning;
    - going below ground.
    - A row whose members all leave is free: the next order takes row 0 again.
  - **The table.** 16 groups fill side 0. The 17th degrades with shape, facing and stance, and no row. Side 1 is
    unaffected.
- [ ] **Step 2: `FORMATION_WORLD_PIN`** in `determinism.test.ts`, the WOUNDED_WORLD_PIN pattern. Use the shipped
  `data/formations/*.json` by relative import, and test-local unit types.
  - The 600-tick world: side 0 orders a Column, then an Attack attack-move, then an Ambush ring across a road.
    A side 1 column walks into the ring. Side 0 re-orders one member mid-march.
  - The test asserts that each happened: three groups allocated, one exit by order, one `formationSprung`, and a
    ring hull at its inward facing.
  - "Born <date> (GH-859 P1a), read from the first run. It moves when a formation rule, column or fold changes,
    and with the three files' JSON. P1b re-pins it."
- [ ] **Step 3: the snapshot fork witness.** Add a formation world to `snapshot-witness-worlds.test-helper.ts`.
  Cut it at three points: mid-approach, after arrival before the spring, and after the spring. Each restored world
  must agree with the uninterrupted one's hash at +200 ticks. The poison check applies to any column classed
  `scratch`, and none is.
- [ ] **Step 4: gates (G-7).**
  - Every existing pin is unchanged. The format pin keeps its Task 3 value, because the witness world orders no
    formation.
  - `balance` and `playtest` are byte-identical to Task 0's baseline. Any difference is **S1**.
- [ ] **Step 5: mutations** (G-5), each red and quoted:
  - M-4a: `applyMove` treats an absent `formation` as `"column"`. The registered-twin byte-identity test reds, and
    Task 6.1 shows the versus probe moving (`match-world.ts` registers formations). This is spec §8.1's
    falsification;
  - M-4b: `fmPend` without the hostility test (friendly splash springs the ring);
  - M-4c: `stepFormations` skipped (the ring springs member by member);
  - M-4d: `fmForget` not called at boarding (the boarding exit test reds);
  - M-4e: the rest-facing loop ignores `curTarget` (the "target wins" test reds);
  - M-4f: `fmArrived` ignores `SPRUNG` (the late-arrival test reds).
- [ ] **Step 6: commits.**
  - `sim: the formation order — template slots, group, arrival facing and stance, ring springs together (GH-859 P1a)`;
  - then, alone, `test(sim): FORMATION_WORLD_PIN born (GH-859 P1a)`.
- [ ] **Step 7: `sim-guard` (Opus) review of Tasks 2–4.** Fix its findings, then re-run G-7.

---

## Task 5: the versus surface — whitelist, ownership, content digest, advisor, agent harness

**Model:** Sonnet implementer; Sonnet reviewer.

**Files:**
- `packages/net/src/protocol.ts`: `FORMATION_ID`; in the `cleanCommand` `move`/`attackMove` branch,
  `formation` must be absent or a string matching `FORMATION_ID`, else `null`; copied when present;
- `packages/net/src/ownership.ts`: `SeatWorld.formationAllowed(seat, id): boolean` (required); the `move` /
  `attackMove` case adds `(cmd.formation === undefined || world.formationAllowed(seat, cmd.formation))`. `smoke`
  shares the case and has no such field: split the case so `smoke` is untouched;
- `packages/net/src/protocol.test.ts`, `ownership.test.ts` (and every `SeatWorld` table `tsc` names);
- `packages/app/src/net/frame-step.ts`: the implementation, an id in `@lions/data`'s `formations` whose
  `factions` includes `factionOfSeat(seat)`;
- `packages/app/src/net/match-world.ts`: `for (const f of formations) sim.addFormationType(f)` after the unit
  types;
- `packages/app/src/net/content-digest.ts` and its test: `formations` joins `Content`;
- `packages/app/src/ui/advisor.ts` and en.json: `net.advisor.cmd.move.formation` "Move {n, plural, one {# unit}
  other {# units}} to ({x}, {y}) in {formation}", and the same for `attackMove`. `{formation}` is the formation's
  label through `t()`;
- `tools/src/net/mcp-tools.ts`: the `move`/`attack_move` tools accept an optional `formation`, validated against
  the shipped ids, and documented in the tool text;
- `tools/src/formation-id-pattern.test.ts` (new; Ruling 13);
- `tools/src/net/two-client.test.ts`: two cases.

- [ ] **Step 1: failing tests.**
  - `cleanCommand`: a formation move round-trips. `formation: 7`, `''` and a 33-character id each null the command.
    A move without the field is unchanged (`toEqual` the input).
  - `validateCommand`: `attack` passes for a KDF seat; `nosuch` is dropped; a `smoke` command is unchanged.
  - `two-client.test.ts`: a formation move is stamped and agreed on by both clients and moves the hash. A forged
    id vanishes on both.
  - Content digest: changing a formation's `min_members` changes the digest.
  - Advisor: the formation line through `t()`.
  - The id pattern pin.
- [ ] **Step 2: implement.**
- [ ] **Step 3: gates.** G-7, plus `pnpm validate:ui`. Every versus literal in the pin table is unchanged:
  registering formations in `match-world.ts` is config.
- [ ] **Step 4: mutations.**
  - M-5a: `cleanCommand` drops `formation` (the round-trip reds, and so does two-client's hash move);
  - M-5b: `validateCommand` without the formation clause (the forged-id case reds);
  - M-5c: `Content` without formations (the digest case reds).
- [ ] **Step 5: commit** `net: the formation field on move and attack-move, whitelisted and owned (GH-859 P1a)`.

---

## Task 6: measurement — byte identity, urban in Attack, the ambush probe, the facing reading, versus

**Model:** Sonnet (`balance-analyst` agent type, `model: sonnet`) builds and runs. **Opus** (`balance-analyst`,
`model: opus`) reads every STOP-gate number before anything is reported as passing.

**Files:**
- `tools/src/backtest/targets.ts`: `urbanAttackFormation(seeds = 60)`;
- `tools/src/balance/cli.ts`: the list gains it after `urbanSmokeStep`;
- `tools/src/backtest/formation-probes.ts` (new; report-only) and `formation-probes.test.ts` (non-vacuity only);
- `tools/package.json`: `"formations:probe": "tsx src/backtest/formation-probes.ts"`;
- `tools/src/backtest/versus-probe.ts`: `--formation=<id>` (every attack-move both ends send carries it) and
  `--formation-end=<friendly|hostile>` (one end only).

Every harness that orders a formation registers `formations` after its unit types.

- [ ] **1. Byte identity (§8.1, S1).** On the branch head, re-run Task 0's baselines and diff them:
  `test:determinism`, `pnpm test`, `balance` (old lines), `playtest`, and the versus probe's no-formation arm at 96
  seeds on every offered cell. Then apply M-4a in a scratch edit. Re-run `versus:probe` on the Beit mirror at 12
  seeds, and `formation-group.test.ts`'s registered-twin case, and quote both moving. Undo the edit. The golden
  replays register no formation, so they cannot show it.
- [ ] **2. Urban in Attack (§8.3, D10; gated with the existing band).** `urbanAttackFormation` uses the
  `urbanRatio` setup, paired seed for seed, with the attackers' attack-move carrying `formation: 'attack'`.
  - It is held to `urbanRatio`'s band: 1:1 ≤ 25%, 2:1 ≤ 85% and ≥ 15 pp below 3:1, 3:1 ≥ 65%, 4:1 ≥ 3:1 − 10 pp.
    Both tiers.
  - The urban groups are rifle squads only, so this checks that rank placement, facing and the group change
    nothing that matters.
  - Falsification: run the band check once against a fabricated reading with 2:1 equal to 3:1. It reds; quote it.
  - A failing reading is **S2**: stopped for the lead, never retuned.
- [ ] **3. The ambush probe (§8.3; report-only).** Six ring members (2 Lavi, 3 rifle squads, 1 mortar team)
  against a four-vehicle-plus-infantry column on a road, 60 seeds. Three paired arms:
  - **A**: the Ambush formation;
  - **B**: the same order, then once every member has arrived and turned, a per-unit `setStance{ambush}` at the
    same R. B has the same slots and facing, and each member springs alone;
  - **C**: each member sent by `exact: true` moves to A's tiles, then `setStance{ambush}`. C has the same slots,
    travel facing, and each member springs alone.

  Report for each arm:
  - the share of ring members firing within 20 ticks of the first spring (A's claim is ≥ 90%);
  - **friendly splash damage per engagement, and its ratio to the damage the ring dealt.** This is attributed by
    a probe-only wrapper on `applyDamage` that reads the shooter's side, and no sim change. The probe's test runs a
    constructed own-mortar-on-own-squad case and requires a reading > 0 (non-vacuity);
  - the share of impacts on ring vehicles by arc (`impact.arc`) — **the D14 facing reading:** C against B isolates
    facing;
  - the ring's win and loss counts.

  **S3** reports these to the lead. A friendly ratio above 10% triggers D7's P2 fallback (U and L shapes). It does
  not stop P1a.
- [ ] **4. Versus (§8.7; S4).** At 96 seeds on every offered cell:
  - (b) `--formation=attack`, both ends: every cell stays inside 60/40;
  - (c) `--formation=attack --formation-end=friendly` and `=hostile`: report the formation end's edge against the
    cap of 65%.

  Run sequentially, never two at once. A cell outside 60/40 in (b), or an edge above 65% in (c), is **S4**.
- [ ] **5. Commit** `tools: formation measurements — urban in Attack, the ambush probe, versus formation arms
  (GH-859 P1a)`. Put the readings in the ledger, and quote the falsifications in the message.

---

## Task 7: the UI model (pure) — row, inert reasons, arming, intents, keys, glyphs, card and chip lines

**Model:** Sonnet (`render-vfx` agent type, `model: sonnet`); Sonnet reviewer.

**Files:**
- `packages/app/src/ui/formation-model.ts` (new, pure, with `.test.ts`):
  - `formationRow(facts, armed)` → views of `{ id, labelKey, key, family, armed, inert, reasonKey }`;
  - `classCounts(units)`;
  - `schematicSlots(id, counts)`, which is `templateOffsets` over the compiled shipped formation;
  - `formationCardLines(view)` and `formationChip(counts)`.
- `packages/app/src/input/formation.ts` (new, pure, with `.test.ts`, the `patrol.ts` pattern):
  - `formationIds(ids, garrisoned, carried, buried)`;
  - `resolveFormationOrder(world, ctx)`, which returns a `Resolution` whose `order` intent carries `formation`
    and the formation's verb. It refuses blocked ground as `resolveMoveOrder` does, and it degrades to a plain
    order with a `hud.formation.refused.tooFew` note below `min_members`.
- `packages/app/src/input/intents.ts`: the `order` intent gains `formation?: string`, and `applyIntent` passes it
  through `clampToMap` as today;
- `packages/app/src/input/keymap.ts`: `formationColumn` r, `formationAttack` t, `formationAmbush` y, all
  rebindable, with labels `keymap.formationColumn|Attack|Ambush`. Update the "what is bound" comments;
- `packages/app/src/ui/symbol.ts`: three glyphs `formation-column|attack|ambush`, ported from `build-mock.mts`'s
  `formationGlyphBody`;
- `packages/app/src/i18n/en.json`: the keys below.

**Facts the row reads** (the approved mock, Q3):
- The row draws when the selection holds ≥ 2 own living units of a class other than none.
- Every button is inert with `hud.formation.inert.needsTwo` ("Needs two free units") when fewer than `min_members`
  of them are free (not garrisoned, aboard or below ground).
- Ambush is also inert with `hud.formation.inert.ambushNoGround` ("Needs ground units to ring the zone") when no
  free unit belongs to a ring class.
- Families: Column manoeuvre, Attack offensive, Ambush control (`ORDER_FAMILY_COLOR_KEY`).

**Card and chip lines that P1a can make true** (Q1). Mock strings, cut to what P1a has:
- a Column member: `hud.card.formation.column` "In column";
- an Attack member: `hud.card.formation.attack` "In attack formation";
- an Ambush member walking: `hud.card.formation.ambush.moving` "Moving to the ambush";
- an Ambush member set: `hud.card.formation.ambush.set` "Ambush set — springs together", with a dim
  `hud.card.formation.ambush.radius` "Ring radius {r}";
- after the spring: `hud.card.formation.sprung` "Ambush sprung";
- chips: `selection.chip.formation.column` "{n} in column", `…attack` "{n} in attack formation", `…ambush`
  "{n} in ambush".

The chip's formation status sits after `aps` and before `moving` in `chipStatus`'s precedence. The combat states
still win.

**Other keys:**
- `hud.formation.tag` "Formation";
- `hud.formation.arm.column` "column — click open ground (Esc cancels)", `…arm.attack` "attack formation — click
  the objective (Esc cancels)", `…arm.ambush` "ambush — click the kill zone (Esc cancels)";
- `formation.class.<cls>` for the legend, plus `formation.class.ccp` "Ambulance";
- `hud.formation.legend.click` "Your click", `…legend.killZone` "Kill zone";
- the alert `hud.alert.ambushSprung` "Ambush sprung — all units firing". The implementer matches the alert
  family's existing key prefix.

- [ ] **Step 1: failing tests.**
  - The row: absent for one unit, inert `needsTwo` for two with one garrisoned, `ambushNoGround` for two
    helicopters, active for the mock's mixed selection, and armed state.
  - `schematicSlots` equals `templateOffsets` for the mock's selection (3 armour, 5 infantry, 1 support, 1 medic,
    1 aircraft).
  - `resolveFormationOrder`: verbs (attack → `attackMove`; column, ambush → `move`), Shift appends, blocked ground
    refused, the too-few fallback.
  - `applyIntent` copies `formation`.
  - keymap: r/t/y bound and rebindable, no collision.
  - Card and chip lines for each state, and the chip precedence.
  - **Labels are accessors:** switching `t()`'s catalogue between two calls changes the row's labels (the
    `ROLE_LABEL` lesson).
- [ ] **Step 2: implement.**
- [ ] **Step 3: gates.** G-7 and `pnpm validate:ui`. The palette gate sees no literal; the i18n gate sees no bare
  string.
- [ ] **Step 4: mutations.**
  - M-7a: inert reasons ignore `garrisoned` (the needsTwo case reds);
  - M-7b: `applyIntent` drops `formation` (reds);
  - M-7c: a label resolved at module load (the accessor test reds).
- [ ] **Step 5: commit** `app: formation row model, keys R/T/Y, arming and intents, pure (GH-859 P1a)`.

---

## Task 8: the UI wiring — the row, tooltip, armed state, cursor badge, card, chips, alert, boot

**Model:** Sonnet (`render-vfx` agent type, `model: sonnet`); Sonnet reviewer.

**Files:**
- `packages/app/src/ui/hud.ts` and `hud.test.ts`:
  - the formation row above the order row (`rl-orders rl-orders--formation`, led by the tag);
  - the tooltip (`rl-tip rl-tip--formation`): name, blurb, the SVG schematic from `schematicSlots`, the legend
    with counts, and the composed face, drill and shape lines (Ruling 16);
  - a medic-class vehicle draws the mock's CCP mark;
  - the card lines and the chip status from Task 7.
- `packages/app/src/ui/theme.css`: the mock's `.rl-orders__tag`, `.rl-formtip*` and `.rl-tip--formation` rules
  (`build-mock.mts`, the style block), on semantic tokens only (`--ink-mute`, `--well`, `--panel-rule`, `--good`,
  `--info`, `--warn`, `--order-offensive`, `--ink-dim`). No `--rl-*` name, no hex.
- `packages/app/src/main.ts`:
  - `armedFormation: string | null`, mutually exclusive with `armedOrder`;
  - the R/T/Y handlers;
  - the left click spends it through `resolveFormationOrder`, then disarms;
  - right-click and Escape disarm;
  - the arm note in the feed, and the deny cue on the too-few fallback;
  - `for (const f of formations) sim.addFormationType(f)` at boot, after the unit types.
- `packages/app/src/input/keymap.ts`: `anyArmed` gains `armedFormation` as its sixth source, with its own test.
- `packages/app/src/input/pointer.ts`: the armed formation in the pointer context.
- `packages/app/src/input/cursor.ts`, `packages/app/vite-plugin-cursors.ts` and their tests: three cursor names,
  `formationColumn|Attack|Ambush`. Each is the verb's sight (move or attackMove) plus the formation glyph as a
  badge in its family's colour on the halo (the mock's `cursorBadge`).
- `packages/app/src/ui/alerts.ts` and its test: an own-side `formationSprung` → the "Ambush sprung" line. An
  enemy's raises nothing new, because the existing per-unit `ambushSprung` "ambushed" line already covers it, and
  it carries no position.

- [ ] **Step 1: failing tests** (jsdom).
  - The row renders for the mock's selection with the tag and three buttons. Glyph spans carry `data-family`.
  - A hover shows the tooltip, whose schematic has one mark per unit and a legend that reads the counts.
  - T arms: the button reads `data-armed="1"`, the feed note shows, and the cursor name is `formationAttack`.
  - A map click queues exactly one `attackMove` with `formation: 'attack'` and disarms. Escape disarms with
    nothing queued.
  - An Ambush member's card reads "Ambush set — springs together" after arrival (a stepped sim).
  - The chip status reads "6 in ambush".
  - An own `formationSprung` raises the alert once.
  - **The pseudo check:** with the pseudo catalogue (`?pseudo=1`'s transform), every text node in the row,
    tooltip, card line and chip is bracketed.
- [ ] **Step 2: implement.**
- [ ] **Step 3: gates.** G-7 and `pnpm validate:ui`. No local browser. CI's `visual` job (`ui:routes`,
  `golden-baseline`) runs on the PR. The gated captures assert no selection, so no baseline should move. A red is
  **S5**.
- [ ] **Step 4: mutations.**
  - M-8a: the click handler ignores `armedFormation` (the click test reds);
  - M-8b: a literal "Formation" in `hud.ts` (`validate:ui`'s i18n gate reds, or else the pseudo test reds);
  - M-8c: `anyArmed` without its sixth source (its test reds).
- [ ] **Step 5: commit** `app: the formation row, tooltip schematic, armed state, card and chip lines (GH-859 P1a)`.

---

## Task 9: docs

**Model:** Sonnet.

- [ ] `CLAUDE.md`, "Adding content": one bullet for **A formation**. It is JSON in `data/formations/` against
  `formation.schema.json`, registered in `@lions/data`'s `formations` (pinned to the directory), with keys not
  text. Its placement is checked by `tools/src/formations_place.test.ts`. A new shape, drill or call is a schema
  and engine change, made once.
- [ ] `CLAUDE.md`, "Sim rules worth knowing from outside the sim": one bullet. An order with `formation` is the only
  thing that touches the group table, and it is folded behind `fmLive`. The ring springs together through
  `stepFormations`. `restFacing` is where a hull rests, and a target always wins.
- [ ] `docs/agent-notes/sim-and-orders.md`: a "Formations (GH-859 P1a)" section with the as-built facts:
  - the exit funnel and its call sites;
  - the degraded table;
  - the plain-order fallbacks;
  - why the faction check is versus-only;
  - the measured readings from Task 6.
- [ ] `docs/HANDOVER.md`: one ledger row.
- [ ] Commit `docs: formations P1a as built (GH-859)`.

## Task 10: final gate and the PR

**Model:** Sonnet runs the gates. **Opus** does the final review: the whole diff against this plan's rulings, the
pin table, the casebook shapes, and P1b's room.

- [ ] **Gates on the branch head,** with exit codes recorded: `pnpm test:determinism`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`, `pnpm validate:data`, `pnpm validate:ui`, `pnpm balance` (both tiers),
  `pnpm playtest`, and the versus arms (the no-formation arm, plus (b) and (c)).
- [ ] **Every pin** at its pin-table value, with each move in its own commit carrying "Was <n>."
  (`git log --format=%s origin/main..HEAD`).
- [ ] **Open the PR to main,** not a draft: `Formations P1a: Column, Attack and Ambush shapes (GH-859)`. The body
  includes:
  - the rulings used;
  - the pin table, was → now;
  - the byte-identity proof;
  - urban in Attack at both tiers;
  - the ambush probe's three arms (fire-together, friendly ratio, arcs);
  - the versus (b)/(c) tables;
  - every falsification (M-1a…M-8c);
  - what P1a does not do (the P1b list);
  - the questions Q1–Q6.

  It refs GH-859 and does not close it. It ends with the Claude Code line.
- [ ] **CI.** `gh run list` after the push. `visual` falls under S5. The lead merges.

---

## STOP gates (where the lead sees numbers)

| Gate | Where | Trips when | Report |
|---|---|---|---|
| **S1** | Tasks 1–5, 6.1 | any existing pin, playtest line, `balance` line or no-formation versus cell differs from the Task 0 baseline (timing aside); or the snapshot format pin's move is not exactly the new rows | the diff, and which edit caused it (bisect by undoing one edit at a time) |
| **S2** | Task 6.2 | urban in Attack outside `urbanRatio`'s band at either tier, or 2:1 within 15 pp of 3:1 (a formation bought a ratio step, D10) | both arms seed-paired, per ratio, both tiers. Never retune |
| **S3** | Task 6.3 | always (report-only), before the PR | the three arms' fire-together share, friendly ratio and arc table. A friendly ratio > 10% is flagged as D7's P2 trigger |
| **S4** | Task 6.4 | (b) any offered cell outside 60/40, or (c) the formation end above 65% | the cell table at 96 seeds, all arms |
| **S5** | Tasks 8, 10 | CI `visual` red on a gated scenario | the log's scenario and band reading. Bless only through the CI workflow, and only if the lead agrees |

## Task order and batches

T0 → T1 → T2. Then T3 → T4, and T7 may run in parallel with T3–T4 (disjoint files: T7 touches only `packages/app`
and en.json, against T2's pure API). After T4: `sim-guard` (Opus) over T2–T4. Then T5 and T6. T6 needs T5 only
for the versus arm, so run T5 first. Then T8 (needs T4's read APIs and event, and T7). Then T9 → T10.

The heavy runs are `pnpm playtest` and the versus arms (the tunnel arm is about 14 min). Never run two heavy
instruments at once on the lead's machine.

## Review focus

1. **Byte identity.** Does anything outside the `tpl !== null` branch read `formation`, or a new column outside
   `fmLive`? M-3a and M-4a are the proofs. Read the `applyMove` diff line by line.
2. **The exit funnel.** Is every write of `alive = 0`, `routed = 1`, `carriedBy`, `garrisonedIn` or `tunnelIn`
   followed by `fmForget`? A missed site leaves a phantom member. That cannot desync, but it keeps a row alive
   and miscounts the chip.
3. **Vacuous checks.** The placement test asserts its 345 placements. The probe's friendly wrapper must see > 0 on
   its constructed case. The class table is 50 literal rows.
4. **The oracle imports nothing.** The ring lists, the class table and the facing constants are literals.
5. **The tooltip cannot disagree.** `schematicSlots` must call `templateOffsets`, never a copy of the mock's
   `slots*` functions.
6. **The P1a copy is honest.** No string promises a halt, a pace or a call.

---

## For the lead (the PR body repeats these)

1. **Q1. P1a card and chip lines.** The approved strings name checkpoints and pace, which P1a does not have.
   - **Recommendation:** ship the mock's lines cut to what P1a does: "In column", "In attack formation",
     "Ambush set — springs together · Ring radius 3", and chip "N in column". P1b restores "— checkpoint N of M",
     the pace line and "· cp 3/5" with the behaviour. No new mock is needed, but "In attack formation" and "N in
     ambush" were not drawn.
2. **Q2. Tooltip copy.** "Pace follows the slowest unit", "Halts if it meets the enemy" and "until called" are
   P1b behaviour.
   - **Recommendation:** leave them out of P1a (Ruling 16), and add them in P1b.
3. **Q3. When the row shows.** The coordinator's brief says "≥ 2 free own units". The approved mock draws the row
   for two selected with one garrisoned, and makes it inert ("Needs two free units").
   - **Recommendation:** the mock.
4. **Q4. A full table (17+ live groups on a side) in P1a.** The order keeps shape, facing and stance, but no group,
   so a degraded ring springs member by member and the card shows no formation line.
   - **Recommendation:** accept it. "In formation (no march)" comes with P1b.
5. **Q5. Two-file Column, one file on the click line** (Ruling 4), so a one-tile street keeps a whole file, as the
   spec promises.
   - **Recommendation:** accept. The schematic centres itself, so the look is the mock's.
6. **Q6. Urban in Attack is gated with the existing band,** not report-only, because D10 is already ruled.
   - **Recommendation:** gate it. A failure stops for you (S2) and is never retuned.

---

## Ledger (filled in by the executor)

- Pre-flight (Task 0): base, moved sites, pins, baselines, class census (4 disagreements expected), keys free:
  _pending_.
- Task 3: the snapshot format pin, new value and cut-rows proof: _pending_.
- Task 4: the exit sites found (file:symbol), `FORMATION_WORLD_PIN`, `sim-guard` findings and fixes: _pending_.
- Task 6: byte-identity diff, M-4a reading, urban in Attack (both tiers), ambush probe arms A/B/C, versus (b)/(c):
  _pending_.
- Task 8: CI `visual` result: _pending_.
- Task 10: gates with exit codes, PR URL: _pending_.
