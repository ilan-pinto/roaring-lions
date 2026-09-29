# Bought-only special forces (WP-G-E5, #181). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three units that only a purchase with **earned brigade credits** opens. They are never
fielded by a mission and never reachable through Roar coins.

| unit | id | price | lands with |
|---|---|---|---|
| deep recon team | `recon_zikit` | 4,250 | this plan, sim-free |
| Peten gunship | `heli_peten_gunship` | 8,000 | this plan, sim-free |
| armoured demolition carrier (GH-156) | `demo_tzav` | 6,500 | staged data and art here; lands in E6 |

**E5 is sim-free (the lead, 29 Sep: "Split into E6").** This plan covers the Zikit, the Gunship,
and the Tzav's staged data and art. The Tzav's placed charge (G1), the drone swarm and the
directed-energy beam are E6: see "E6 — moved out" at the end.

**Architecture:**
- **Data is staged, not shipped, until its art lands.** The three JSONs live in
  `docs/campaign/special_units/e5/`. That folder sits outside `data/units/`, so `@lions/data`,
  the garage, the dock, the debrief and the sandbox never see them. Tooling keeps the staging
  honest:
  - `tools/src/e5_staged.test.ts` checks the schema and the bought-only shape, and pins that no
    staged unit is half-landed.
  - `validate_balance.py --also` fits the curve with the staged units included.
  - The probes read the files straight off disk.
- **The bought-only gate shape already exists end to end, and no gate code changes:**
  - `isBoughtOnly` in `packages/sim/src/unlock.ts`;
  - `gateSentence`'s price rank;
  - `brigade.ts`'s sort (bought-only rows sort after the earned gates);
  - `dock-model.ts`'s `dock.lock.price`.
- **One PR lands the Zikit and the Gunship**, with art and data together (Task 9).

**Tech Stack:** JSON Schema (ajv 2020), Python (`tools/validate_balance.py`), TypeScript strict,
vitest, headless Blender and the Meshy CLI (Task 8 only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-e5-special-forces-design.md`. Its §1 holds the
numbers, §4 the gaps (G1–G6), §5 the staging, §6 the prompts, and §7 the decisions.

**Base:**
- Branch `feat/e5-special-forces`, cut from `main` `ce80b767`.
- Worktree `/Users/ilpinto/dev/roaring-lions-ep/e5`.
- It has **no `node_modules`**. Run `pnpm install` once before the first vitest task.

**Order and the gates:**
1. **Task 1**, gate **G-E5-N: PASSED, approved 29 Sep.** The lead approved all five units'
   numbers.
2. **Tasks 2–7** may start now. Tasks 3 and 6 are independent of the others.
3. **Task 8** is gate **G-E5-A**. It waits for the October Meshy credits and for the lead's go on
   the announced estimate.
4. **Task 9** lands the Zikit and the Gunship after Task 8.

---

## Decisions (spec §7), all 29 Sep

- **By the lead:** Q1 numbers approved (all five); Q10 swarm fielded by the enemy only, Sarim and
  Rif; Q11 split into E6.
- **Taken defaults:** Q2 station time dropped; Q4 Tzav auto-withdraws 4 tiles, charge only on
  order, blast hurts own troops and civilians; Q5 pods keep 0.55; Q6 data staged; Q7 working names
  until the rule-3 screen; Q8 KDF vehicle line adopted; Q9 G4 folded into #247, G6 accepted; Q12
  the beam intercepts no shells in v1.
- **Consequential:** Q3, build G1, goes to E6 with Q11.

---

## Global Constraints

- **The sim is untouched.** At landing, `git diff --stat ce80b767..HEAD -- packages/sim` is empty
  for every task, and `pnpm test:determinism` has not moved. The Tzav's sim half is E6's work
  (Q11).
- **The ladder must not move.** The following all stay as printed on `main`:
  - `LADDER_CREDITS` 5849;
  - the three `GATES` lines;
  - the `CONDUCT_GATES` probes;
  - every plain `label === id` line.

  No mission fields a bought-only unit, and none gains a placement.
- **Credits only.** Nothing in this plan names Roar coins or a paid path. `unlock` carries `price`
  and nothing else (ST8 §7).
- **No art-less unit ships.**
  - A file enters `data/units/kdf/` only in the same PR as its GLB, its sheet, its `SPRITE_MAP`
    entry and its `mesh-catalogue` entry.
  - `tools/src/e5_staged.test.ts` fails if a staged id appears in `units`.
- **Balance is measured, never fitted afterwards.**
  - The acceptance bands are set by `balance-analyst` in Task 4, from the measured baselines.
  - A red probe is content to retune. It is never a band to widen.
- **No status marks in the world** (the lead, 27 Sep). Nothing in this plan draws an on-map
  marker.
- **Meshy:**
  - Every call is announced with `pnpm meshy -- estimate …` first, and runs only on the lead's go.
  - One preview per concept.
  - The key stays at `~/.config/roaring-lions/meshy.env`, never in the repo.
- **Strict TypeScript.**
  - No `any`, and no non-null assertions outside tests.
  - Tests are colocated as `*.test.ts`.
- **Every check is seen red.** Each task names the mutations that must turn a named test red, and
  the commit message quotes the red line.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data`,
  plus both `validate_balance.py` passes. Run `pnpm playtest` when a task touches it, and
  `pnpm validate:meshes` from Task 8 on.
- **Git.**
  - Stage explicit paths only: `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, and never
    `git checkout -- <file>`.
  - Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Do not push. The lead merges.
  - Never `pkill` vite.

---

## File structure

| File | Role | Task |
|---|---|---|
| `docs/campaign/special_units/e5/{recon_zikit,heli_peten_gunship,demo_tzav}.json` | **New.** The staged drafts | 1, 2 |
| `docs/campaign/special_units/e5/numbers.md` | **New.** The numbers table, the measured curve output, the 29 Sep ruling and the Task 4 bands | 1, 4 |
| `tools/src/e5_staged.test.ts` | **New.** Schema, bought-only shape, price band, not half-landed | 2 |
| `tools/validate_balance.py`, `.github/workflows/ci.yml` | `--also <dir>` (repeatable), and a staged-roster CI line at base and max tier | 2 |
| `packages/render/src/three/units/shells.ts` (+test) | `he` routes to the `missile` streak (G5) | 3 |
| `tools/src/backtest/e5-probes.ts`, `tools/package.json` | **New.** `pnpm e5:probes` | 4 |
| `tools/src/backtest/playtest.ts` | `extraUnits` on `run`, and the `(bought)` probes | 5 |
| `packages/app/src/i18n/en.json`, `packages/app/src/ui/brigade.ts` (+test) | The "special forces" tag on bought-only rows | 6, 7 |
| `docs/art/style-bible.md` | The KDF vehicle faction line (Q8) | 8 |
| `art/meshy/…`, `art/meshes/**`, `assets/sprites/**`, `docs/ASSET_PROVENANCE.md` | Art (for the Tzav, `art/meshy/` and its `.blend` only; Task 8) | 8 |
| `data/units/kdf/*.json`, `packages/data/src/index.ts`, `packages/app/src/main.ts` (`SPRITE_MAP`), `packages/app/src/mesh-catalogue.ts`, `packages/render/src/three/units/vehicle-mesh-role.ts` | Landing | 9 |
| `docs/campaign/economy/prices.md` §8, `docs/HANDOVER.md` | The prices, and the ledger entry | 9 |

---

## Task 1: The numbers (gate G-E5-N) — PASSED, approved 29 Sep

**Model:** opus. This is balance judgement, and it produces the lead's decision material.
**Agent:** `balance-analyst`.

**Files:**
- Create `docs/campaign/special_units/e5/*.json`: the three drafts from spec §1.
  - **`demo_tzav` omits `demolition_method: "placed"` and `placed_charge`.** The shipped schema
    rejects both until E6 lands G1.
  - Its numbers stay in the spec, and E6 adds them.
- Create `docs/campaign/special_units/e5/numbers.md`.

- [ ] **Step 1: Copy the three drafts** from the spec's tables into JSON. Each carries its
  `upgrades` tracks: Zikit sensors and armour, Tzav armour and firepower, Gunship all three. The
  tier prices sum to 1,100, 2,360 and 3,185. Each blurb is ≤ 96 characters.
- [ ] **Step 2: Re-measure.** Make a scratch copy of `data/units` plus the three drafts, then run:

```bash
python3 tools/validate_balance.py --units <scratch> --report
python3 tools/validate_balance.py --units <scratch> --report --max-tier --upgrade-cost-factor 0.02
```

Expected, as measured 2026-09-29 with n=35:

| unit | base | max tier |
|---|---|---|
| Zikit | 286, +1.3% | +2.5% |
| Tzav | 682, −0.3% | −6.0% |
| Gunship | 442, +1.9% | +10.6% |
| `attack_drone` | +16.5% | +12.3% |

A different number means the roster moved since then. Record the new one; do not re-tune to the
old one.

- [ ] **Step 3: Schema-validate the three** with the same ajv 2020 that `validate_data.mjs` uses.
  Expect PASS ×3.
- [ ] **Step 4: Write `numbers.md`.** It holds:
  - the three stats tables;
  - the two curve outputs, verbatim;
  - the price table: ladders, the multiple of the peak line, and the total tier cost;
  - Q1–Q12, each with its 29 Sep decision.
- [x] **Step 5: Gate G-E5-N — passed, approved 29 Sep.** The lead approved all five units'
  numbers unchanged. Steps 1–4 still write the files; record the ruling at the top of
  `numbers.md` with its date, and commit.

---

## Task 2: Stage the data honestly

**Model:** sonnet.

**Files:**
- Create `tools/src/e5_staged.test.ts`.
- Modify `tools/validate_balance.py` and `.github/workflows/ci.yml`.

**Interfaces (produced):**

```py
# validate_balance.py
ap.add_argument("--also", action="append", default=[], metavar="DIR",
                help="extra unit directories fitted WITH --units (staged content)")
# paths = glob(--units) + glob(each --also), civilians skipped as today
```

```yaml
# ci.yml gates job, beside the two existing lines
- run: python tools/validate_balance.py --units data/units --also docs/campaign/special_units/e5
- run: python tools/validate_balance.py --units data/units --also docs/campaign/special_units/e5 --max-tier --upgrade-cost-factor 0.02
```

- [ ] **Step 1: Write the failing spec.** `e5_staged.test.ts` reads every `*.json` in the staged
  directory and asserts:
  - each validates against `data/schemas/unit.schema.json` (ajv 2020, as `validate_data.mjs` does);
  - `faction === 'kdf'`;
  - `unlock` has exactly one key, `price`, so `isBoughtOnly` is true;
  - `4000 <= price <= 8000` (prices.md §8);
  - **no staged id is a key of `units` from `@lions/data`.** This is the not-half-landed pin.
  Task 9 deletes a file from staging in the same commit that adds it to `data/units/kdf/`; the
  Tzav stays staged until E6 lands it.
- [ ] **Step 2: Add `--also`,** and the two CI lines.
- [ ] **Step 3: See each check red:**
  - Copy `recon_zikit.json` into `data/units/kdf/` and import it in `index.ts`. Expect
    `staged id recon_zikit is already in units`.
  - Set the Gunship's price to 9000. Expect the band assertion to fail.
  - Add `"roe_rating_min": 80` to the Zikit's `unlock`. Expect `unlock must be price-only`.
  - Drop the Gunship's logistics to 300. Expect `validate_balance.py --also` to print
    `UNDERPRICED`.

---

## Task 3: `he` flies as a streak (G5)

**Model:** haiku. This is a mechanical change with a test.

**Files:** modify `packages/render/src/three/units/shells.ts` and its test. Nothing in Pixi
changes: VFX owe it no parity.

- [ ] **Step 1: Write the failing test:** `shellKindFor(WEAPON_CLASS.he) === 'missile'`.
- [ ] **Step 2: Make it pass.** Add `he` to the `atgm | rpg | heat` branch, and update the doc
  comment. No shipped unit fires `he` today, so the golden baseline cannot move.
- [ ] **Step 3: See it red.** Revert the branch, and expect the test to fail.

---

## Task 4: The balance probes

**Model:** opus. The probes set the bands the lead approved in principle at G-E5-N.
**Agent:** `balance-analyst`.

**Files:**
- Create `tools/src/backtest/e5-probes.ts`.
- Add `"e5:probes": "tsx src/backtest/e5-probes.ts"` to `tools/package.json`.
- Append the bands to `numbers.md`.

Each probe loads the staged JSON with `readFileSync` and registers it with `sim.addUnitType`. The
probes are printed, and their seeds are fixed.

- [ ] **Step 1: Gunship.** Reuse `targets.ts`'s `gunshipRun` shape, with the unit type as a
  parameter. Run 1, 2 and 3 `gun_truck`s × 30 seeds, for the Peten and for the Gunship. Assert:
  - the Gunship's survival falls with each added truck;
  - its survival against 3 trucks is at most the Peten's against 2;
  - it clears the position against 1 truck at least as often as the Peten does.
- [ ] **Step 2: Zikit.** A `militia_cell` faces the probe unit at 4, 6 and 8 tiles on open ground,
  with 20 seeds each. Record the first tick at which the militia side holds the probe unit
  `IDENTIFIED_AT`. Run it for the Zikit, `sniper_team` and `inf_squad`, both holding fire and
  firing. The design claim is that the Zikit is found later than `inf_squad` at every range, and
  later than the sniper once both fire. Record the numbers either way.
- [ ] **Step 3: Bands.** `balance-analyst` writes each band into `numbers.md` from the measured
  baselines. The file header states that the bands are frozen from this commit on.
- [ ] **Step 4: See each check red.** Set the Gunship's hp to 2000: the "falls with AA" or "≤ the
  Peten at 2" assertion must fail. Set the Zikit's signature to 0.6: its detection claim must fail.
- [ ] **Step 5: Run `pnpm balance`** and confirm it is byte-identical to `main`: `targets.ts` names
  six ids.

---

## Task 5: The `(bought)` playtest probes

**Model:** sonnet. **Agent:** `playtest`.

**Files:** modify `tools/src/backtest/playtest.ts`.

**Interfaces (produced):**

```ts
// run(): one more optional parameter, after `measured`
extraUnits?: readonly UnitTypeJson[]   // registered like any KDF type, max-tier pre-pass included
```

- [ ] **Step 1: Write two probes,** each labelled `'<id> (bought)'` so the `label === id` guard
  keeps them off the ladder:
  - `beit_sahwan_4_subterranean`: the winning plan, plus build one `recon_zikit` at its first
    affordable tick and walk it to hold the route in sight;
  - `umm_zeitoun_4_clearance`: the plan, plus one `heli_peten_gunship` on the `raze` approach.

  Both pass `bought: new Set([id])`. Print the result, stars, Conduct, clock and credits against
  the mission's own line.
- [ ] **Step 2: Assert.** Each probe asserts VICTORY and a grade no lower than its plan's.
  `LADDER_CREDITS` and `GATES` are unchanged.
- [ ] **Step 3: See each check red:**
  - Drop `bought`: the build must be refused (`buildBlockedReason`) and the probe must say so.
  - Feed a probe's credits into the ladder sum: the pinned 5849 must fail.

---

## Task 6: Names, blurbs and strings

**Model:** opus. This task is voice. **Agent:** `narrative-designer`.

**Files:**
- The three staged JSONs (`name` and `blurb` only).
- `packages/app/src/i18n/en.json`.

- [ ] **Step 1: Rule-3 screen** for *Zikit*, *Tzav* and *Peten Gunship* (storyline §2.4).
  - Search each name as a real platform or unit name.
  - Replace any that collides, and record the search in `numbers.md`.
  - `heli_peten`'s own "AH-64" collision is out of scope (special_units design §9.3).
- [ ] **Step 2: Final blurbs.** Each is ≤ 96 characters, and says a role, a restriction or the
  one thing the unit is for. None is lore, and none restates an on-screen stat (schema
  `blurb`). The drafts:
  - "Walks where nothing else can see from, and holds a tunnel in sight without being found."
  - "Sets a fused charge against a wall and backs off. What stands too close goes with the house."
  - "Rocket pods for men in the open beside the cannon and missiles. Every salvo is danger close."
- [ ] **Step 3: Strings.** Add `garage.tag.special` ("Special forces") and
  `garage.tag.special.aria` ("Special forces: opened only by buying with earned credits"). A
  bought thing never looks earned (ST8 T6): no star, no `--commend` gold.
- [ ] **Step 4: Run `pnpm validate:ui`** (it runs the i18n gate too).

---

## Task 7: The garage rows

**Model:** sonnet.

**Files:** modify `packages/app/src/ui/brigade.ts` and `brigade.test.ts` (jsdom).

- [ ] **Step 1: Write the failing test.** Feed `showBrigade` the three staged units, read with
  `readFileSync` in the test, beside two shipped units. Assert:
  - the three sort after every earned gate, cheapest first (4250, 6500, 8000);
  - each locked row shows the price sentence alone (`gate.buy`) and the `garage.tag.special` tag;
  - Buy is disabled at a balance of 4249, and enabled at 4250 for the Zikit only;
  - a bought row reads `bought`, keeps the tag, and never shows a star.
- [ ] **Step 2: Implement the tag** off `isBoughtOnly(unlock)`. This is the one predicate, never
  an id list.
- [ ] **Step 3: See it red.** Key the tag on `id.startsWith('recon_')`, and the Gunship assertion
  must fail. Make it `isBoughtOnly(u) || true`, and the shipped-unit assertion must fail.
- [ ] **Step 4: Screenshot.** Drive the real garage with `pnpm ui:shots` against a scratch build
  that has the staged units copied into a temp roster. That build is never committed. It is the
  mock the lead sees at Task 9.

---

## Task 8: The art (gate G-E5-A, October credits)

**Model:** opus for the Blender judgement, haiku for the gate runs. **Agent:** `blender-art`.

**Files:** `art/meshy/<slug>-<date>-<id>/`, `art/meshes/**`, `assets/sprites/**`,
`docs/ASSET_PROVENANCE.md`, `docs/art/style-bible.md`.

- [ ] **Step 0: Numbers table per unit** (bible §4 step 0): height or length, footprint,
  polycount, roles and faction. The lead approves it before anything renders (memory: approve art
  numbers before rendering).
- [ ] **Step 1: Estimate and announce.** Run `pnpm meshy -- estimate text` and `estimate remesh`.
  - The planned spend is Zikit 40 + Tzav 25 = **65 credits**.
  - The ceiling is 140, adding the Tzav bake (+10), the pod part (+25) and one re-roll (40).
  - Wait for the lead's go.
- [ ] **Step 2: Gunship first, at zero credits.** Build it in Blender from `heli_peten`'s supplied
  source (census the MAIN checkout's `art/blend/`: the worktree's copy is stale). Add stub wings,
  four pods, two tanks and a mast dome. Render its silhouette through `render_mesh_gate.py` against
  `heli_peten`.
  - At IoU < 0.88, it ships with no Meshy spend.
  - Otherwise, announce one pod part:

```
A single low-poly game-ready helicopter rocket pod, a vehicle part of a fictional army in plain
worn olive-drab paint. At rest, level. A short fat cylinder whose front face is a honeycomb of
tube openings, with a mounting pylon on top. Real-world scale, 1.6 metres long. Worn olive
paint, gunmetal. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred,
one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

- [ ] **Step 3: Zikit.** Generate one preview from spec §6's prompt, then texture, remesh at
  2,000, rig, and download at once. In Blender, make three figures from the one: a standing radio
  operator with the whip at ~80°, a kneeling spotter with a tripod scope, and a rifleman.
  - Clips `idle, move, fire, down, wreck`; falls 0.9–1.2 s.
  - It goes into `RIGGED_UNIT_MESHES` in Task 9.
  - The named IoU risk is against `sniper_team` and `inf_squad`.
- [ ] **Step 4: Tzav (art only; it lands in E6).** Commit the Meshy download under `art/meshy/`
  and the Blender source, but **not** `art/meshes/vehicles/demo_tzav.glb`: an unclaimed GLB fails
  `mesh-catalogue.test.ts`'s orphan check, and the Tzav cannot be claimed until E6 lands G1. E6
  exports it. Generate one preview from spec §6's prompt, then remesh at 5,000. Make it
  contract v2 with no `turret_pivot`, and run `pnpm wreck:meshes`. The named IoU risk is against
  `apc_kipod`, `ifv_namer` and `dozer_d9`: the boom and crate must separate it.
- [ ] **Step 5: Sheets** for the portrait, `&nomesh` and Pixi: `INF_ZIKIT/` and `PETEN_GS_HULL/`
  (the Tzav's `TZAV_HULL/` is rendered by E6 with its GLB). Render each from the same source as its GLB, as `render_scout_shachaf.py`
  does, with `down`/`wreck` clips. Then crop the unit icons.
- [ ] **Step 6: Gates:**
  - `pnpm validate:meshes`, first checking `git status art/meshes/` for strangers;
  - `pnpm validate:assets`;
  - `pnpm encode:meshes -- --check`;
  - `pnpm perf:load`;
  - a look at zoom 1.0 in `?sandbox`.
- [ ] **Step 7: Provenance.** Record the preview and remesh task ids in `ASSET_PROVENANCE.md`,
  and write the AI-art disclosure text for the Task 9 PR. Add the KDF vehicle faction line (Q8)
  to the style bible.

---

## Task 9: Land the Zikit and the Gunship

**Model:** sonnet, then a whole-branch review on opus.

**Files:**
- Move `recon_zikit.json` and `heli_peten_gunship.json` to `data/units/kdf/`, deleting them from
  staging in the same commit.
- `packages/data/src/index.ts` imports.
- `SPRITE_MAP`: `recon_zikit` and `heli_peten_gunship`.
- `mesh-catalogue.ts`: `RIGGED_UNIT_MESHES.recon_zikit`, `VEHICLE_UNIT_MESHES.heli_peten_gunship`.
- `vehicle-mesh-role.ts` (the gunship's ramp).
- `prices.md` §8 (the two prices, as landed).
- `docs/HANDOVER.md`.

- [ ] **Step 1: Wire every seam in one commit.**
  - `data/src/index.test.ts` ("carries every unit file on disk") and `e5_staged.test.ts` must both
    pass.
  - `mesh-catalogue.test.ts` must pass.
- [ ] **Step 2: Walk the real UI** (memory: drive the UI, never console shortcuts):
  - Buy the Zikit in the garage with a seeded account balance.
  - Open `beit_sahwan_4_subterranean`, build it from the dock, and walk it into a boulder field.
  - Repeat for the Gunship on `umm_zeitoun_4_clearance`.
  - Photograph the card, the dock tile and the unit at zoom 1.0.
- [ ] **Step 3: Every gate:**
  - `lint`, `typecheck`, `test`, `validate:data`, `validate:assets`, `validate:meshes`;
  - both `validate_balance.py` passes, with and without `--also` (staging now holds only the
    Tzav);
  - `pnpm balance`;
  - `pnpm playtest`: the ladder unmoved, the `(bought)` probes green;
  - `pnpm test:determinism` unmoved.
- [ ] **Step 4: Visual gate.** The garage and dock are not in the golden captures, and no mission
  fields these units, so no bless is expected. If CI moves anyway, bless from CI numbers only.
- [ ] **Step 5: HANDOVER.** Record the landing, the G-E5-N ruling and the defaults taken. Then open
  the PR, which carries the AI-art disclosure and the ST8 §1.1 store-item checklist marked "n/a:
  credits only, not a store item".

---

---

## E6 — moved out

Split by the lead on 29 Sep. Tracked by WP-G-E6, #274, which takes over #273. None of it is E5 work, and E5 lands without it. Stage 4 or later, because each item moves sim
code and may move the determinism hash.

- **G1, the Tzav's placed charge** (spec §4): `demolition_method: "placed"` and `placed_charge`,
  the per-structure fuse, `splashDirect` blast, auto-withdraw, `chargeSet`/`chargeDetonated`.
  Then the Tzav's probe row (against the D9 and `demo_squad` on a defended house), its `(bought)`
  probe on `wadi_halam_5_depot`, its GLB export and `TZAV_HULL/` sheet, and its landing with
  `names.json` `kinds.vehicle_ids += demo_tzav`. That closes #156.
- **The drone swarm** (spec §8.1): the `swarm` block and its damage model; enemy-only.
- **The `directed_energy` class and the beam carrier** (spec §8.2), with a three-only beam VFX.
- **Missions that field swarms**, which re-pin the playtest ladder, and a §5.7 swarm target.
- **Art:** two palette meshes, 50 credits, prompts in spec §8.4.
