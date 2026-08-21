# Campaign Storyline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the campaign a story — an opening, a spine and an ending — delivered on surfaces the player already looks at, and repair the three progression defects that stop a fixed sequence from being walkable.

**Architecture:** Two optional string fields on a mission (`dispatch`, `aftermath`) rendered on the existing title card and victory banner; a `planned` flag on unauthored towns so they stop counting as real; and a fall-through in `nextMissionAfter` so finishing a town carries the player to the next front instead of stranding them. No sim change, no render change, no new screens.

**Tech Stack:** JSON content validated by `tools/validate_data.mjs`; TypeScript in `packages/app`; vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-campaign-storyline-design.md`

**Prerequisite:** briefings are not rendered anywhere today — `grep -rn "\.briefing" packages/ tools/` returns nothing. Giving them a surface (the deploying screen, #82) is being done first as its own fix. Do not start this plan until that has landed; Task 3's title-card work assumes the deploying screen already carries the briefing, so the two do not fight over the same moment.

## Global Constraints

- **No `packages/sim` or `packages/render` change.** If one seems required, stop and raise it.
- **`pnpm test:determinism` must stay pinned.** Nothing here is sim code.
- **`pnpm typecheck` and `pnpm lint` are required gates.**
- **Missions are declarative data.** Story text is authored JSON, never TypeScript.
- **Briefings are not edited.** `dispatch` carries the story voice; `briefing` stays the orders voice. Changing briefing prose is out of scope for every task in this plan.
- **Never `git add -A`, `git add .`, or `git stash`** — this worktree's stash stack is shared with other checkouts. Stage named paths only.
- **TDD.** Every behaviour change in `packages/app/src/campaign.ts` gets a failing test first.

---

### Task 1: Finishing a town must not strand the player

A defect on `main` today, independent of the story: complete Beit Sahwan IV and `nextMissionAfter` returns `undefined`, from a function whose own comment says it exists *"rather than stranding them on an end screen offering only replay and menu"*.

**Files:**
- Modify: `packages/app/src/campaign.ts` (`nextMissionAfter`, around line 182)
- Test: `packages/app/src/campaign.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `nextMissionAfter(world, missionId, ledger)` returns the next front's first mission when the owning town is exhausted. Task 4's walk depends on this.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/campaign.test.ts`, inside the existing top-level `describe` if there is one, otherwise at file scope:

```ts
describe('nextMissionAfter across a town boundary', () => {
  it('carries the player to the next front when the town is finished', () => {
    const world = parseWorld(worldJson);
    const ledger = {
      'campaign.completed_missions': [
        'beit_sahwan_breach',
        'beit_sahwan_1_recon',
        'beit_sahwan_2_foothold',
        'beit_sahwan_3_clearance',
        'beit_sahwan_4_subterranean',
      ],
    };
    expect(nextMissionAfter(world, 'beit_sahwan_4_subterranean', ledger)).toBe('wadi_halam_1_fords');
  });

  it('still returns the next mission inside a town that has one', () => {
    const world = parseWorld(worldJson);
    const ledger = { 'campaign.completed_missions': ['beit_sahwan_breach'] };
    expect(nextMissionAfter(world, 'beit_sahwan_breach', ledger)).toBe('beit_sahwan_1_recon');
  });
});
```

Check the file's existing imports first — it already imports from `./campaign`. Add `nextMissionAfter` and `parseWorld` to that import if absent, and `import { world as worldJson } from '@lions/data';` if absent.

- [ ] **Step 2: Run it and watch the first test fail**

```bash
npx vitest run packages/app/src/campaign.test.ts
```

Expected: *"carries the player to the next front"* FAILS with `expected undefined to be 'wadi_halam_1_fords'`. The second test passes already — it is the guard that the fix does not break the within-town path.

If the first test errors rather than fails, fix the error (usually a missing import) and re-run until it fails on the assertion.

- [ ] **Step 3: Write the fix**

Replace the body of `nextMissionAfter` in `packages/app/src/campaign.ts` with:

```ts
export function nextMissionAfter(
  world: ParsedWorld,
  missionId: string,
  ledger: LedgerData | undefined
): string | undefined {
  const owner = world.regions.flatMap((r) => r.towns).find((t) => t.missions.includes(missionId));
  const withinTown = owner ? nextMissionOf(owner, ledger) : null;
  if (withinTown !== null) return withinTown;
  // The owning town is finished — or the mission belongs to no town at all.
  // Either way the player has somewhere to go, and the whole point of this
  // function is that they are told where. A live front with nothing playable
  // in it is not somewhere: Sur is unlocked and empty today, and picking it
  // would strand the player just as surely as returning undefined did.
  const front = world.regions.find(
    (r) =>
      regionProgress(r, ledger).status === 'live' &&
      r.towns.some((t) => nextMissionOf(t, ledger) !== null)
  );
  const nextTown = front?.towns.find((t) => nextMissionOf(t, ledger) !== null);
  return nextTown ? (nextMissionOf(nextTown, ledger) ?? undefined) : undefined;
}
```

The `r.towns.some(...)` clause is load-bearing and must not be simplified away: without it the search finds Sur, which is `live` with zero missions, and returns `undefined` again.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run packages/app/src/campaign.test.ts
```

Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 5: Run the gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/campaign.ts packages/app/src/campaign.test.ts
git commit -m "fix(app): finishing a town no longer strands the player

nextMissionAfter ran its live-front fallback only when a mission belonged
to no town at all. When the owning town was merely exhausted it returned
undefined -- so completing Beit Sahwan IV dropped the player on an end
screen offering replay and menu, which is the exact outcome the function's
own comment says it exists to prevent.

The fallback now also runs when the town is finished, and it skips a front
that is live but has nothing playable in it. That second clause is not
defensive tidiness: Sur is unlocked and empty today, so without it the
search picks Sur and strands the player anyway.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Unauthored towns stop counting as real

Closes two defects with one concept. The Marj currently reads as conquered on one town of three, and Sur goes live containing nothing.

**Files:**
- Modify: `data/schemas/world.schema.json` (town properties)
- Modify: `data/campaign/world.json` (five towns; Naharin's unlock)
- Modify: `packages/app/src/campaign.ts` (`TownJson`, `WorldTown`, `parseWorld`, `townProgress`, `regionProgress`)
- Test: `packages/app/src/campaign.test.ts`

**Interfaces:**
- Consumes: Task 1's `nextMissionAfter`.
- Produces: `WorldTown.planned?: boolean`; `regionProgress` returns `status: 'locked'` for a region whose towns are all planned, with `lockedBecause` set. Task 4's walk asserts both.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/campaign.test.ts`:

```ts
describe('planned towns', () => {
  it('completes the Marj on its authored town alone', () => {
    const world = parseWorld(worldJson);
    const marj = world.regions.find((r) => r.id === 'marj');
    const ledger = {
      'campaign.completed_missions': [
        'beit_sahwan_breach',
        'beit_sahwan_1_recon',
        'beit_sahwan_2_foothold',
        'beit_sahwan_3_clearance',
        'beit_sahwan_4_subterranean',
      ],
    };
    expect(regionProgress(marj!, ledger)).toMatchObject({ status: 'complete', done: 5, total: 5 });
  });

  it('keeps a front whose towns are all unwritten out of the war', () => {
    const world = parseWorld(worldJson);
    const sur = world.regions.find((r) => r.id === 'sur');
    const ledger = { 'campaign.completed_missions': ['beit_sahwan_3_clearance'] };
    const p = regionProgress(sur!, ledger);
    expect(p.status).toBe('locked');
    expect(p.lockedBecause).not.toBeNull();
  });

  it('opens Naharin only once the Marj is finished, not at its third mission', () => {
    const world = parseWorld(worldJson);
    const naharin = world.regions.find((r) => r.id === 'naharin');
    const midway = { 'campaign.completed_missions': ['beit_sahwan_3_clearance'] };
    expect(regionProgress(naharin!, midway).status).toBe('locked');
    const done = {
      'campaign.completed_missions': [
        'beit_sahwan_breach',
        'beit_sahwan_1_recon',
        'beit_sahwan_2_foothold',
        'beit_sahwan_3_clearance',
        'beit_sahwan_4_subterranean',
      ],
    };
    expect(regionProgress(naharin!, done).status).toBe('live');
  });
});
```

Add `regionProgress` to the import from `./campaign` if it is not already there.

- [ ] **Step 2: Run and watch all three fail**

```bash
npx vitest run packages/app/src/campaign.test.ts
```

Expected: the Marj test currently passes by accident (its total is already 5 because empty towns contribute 0) — if so, note that in your report and keep it as a regression guard. The Sur test fails with `expected 'live' to be 'locked'`. The Naharin test fails on the first assertion, because it unlocks at `beit_sahwan_3_clearance` today.

- [ ] **Step 3: Add `planned` to the world schema**

In `data/schemas/world.schema.json`, inside the town item's `properties` object (alongside `id`, `name`, `at`, `missions`), add:

```json
       "planned": {
         "type": "boolean",
         "default": false,
         "description": "This town is authored later. It is excluded from campaign progress, so an unwritten town neither completes a front it was never part of nor opens one that contains nothing. State it here rather than inferring it from an empty missions array: an empty array is also what a town looks like mid-authoring."
       }
```

- [ ] **Step 4: Mark the towns and move Naharin's unlock**

In `data/campaign/world.json`:

- add `"planned": true` to `khan_rafid`, `deir_amun`, `tel_marum`, `umm_zeitoun`
- change Naharin's `unlock.after_mission` from `"beit_sahwan_3_clearance"` to `"beit_sahwan_4_subterranean"`
- leave Sur's `unlock` exactly as it is; the all-planned rule is what keeps Sur out, not its gate

Do not reformat the rest of the file. Change only these values.

- [ ] **Step 5: Carry `planned` through the parse and the progress**

In `packages/app/src/campaign.ts`:

Add to `interface TownJson`:

```ts
  planned?: boolean;
```

Add to `export interface WorldTown`:

```ts
  /** Authored later. Excluded from progress — see world.schema.json. */
  planned?: boolean;
```

In `parseWorld`, the town mapper currently reads:

```ts
        towns: r.towns.map((t) => ({
          id: t.id,
          name: t.name,
          at: [t.at[0] ?? 0, t.at[1] ?? 0] as const,
          missions: [...t.missions],
        })),
```

Replace it with:

```ts
        towns: r.towns.map((t) => {
          const town: WorldTown = {
            id: t.id,
            name: t.name,
            at: [t.at[0] ?? 0, t.at[1] ?? 0] as const,
            missions: [...t.missions],
          };
          if (t.planned === true) town.planned = true;
          return town;
        }),
```

Then replace `regionProgress` with:

```ts
export function regionProgress(region: WorldRegion, ledger: LedgerData | undefined): RegionProgress {
  // A town nobody has written yet is not ground you failed to take. Counting
  // one would either complete a front on towns that do not exist, or open a
  // front that contains nothing -- and the campaign did both.
  const real = region.towns.filter((t) => t.planned !== true);
  let done = 0;
  let total = 0;
  for (const town of real) {
    const p = townProgress(town, ledger);
    done += p.done;
    total += p.total;
  }
  // A front with no written towns at all is not open. Sur is the case this
  // exists for, and the campaign's ending depends on it reading that way.
  if (real.length === 0) {
    return { status: 'locked', done, total, lockedBecause: 'This front is not open.' };
  }
  const lockedBecause = unlockReason(region.unlock, ledger);
  // A region with nothing authored yet is not "finished". Treating total 0 as complete
  // would grey out every region piece 2 has not written, which reads as a bug.
  const status: RegionStatus =
    lockedBecause !== null ? 'locked' : total > 0 && done === total ? 'complete' : 'live';
  return { status, done, total, lockedBecause };
}
```

- [ ] **Step 6: Run the tests and the gates**

```bash
npx vitest run packages/app/src/campaign.test.ts
pnpm validate:data && pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green. If `validate:data` rejects `planned`, the schema addition in Step 3 landed in the wrong object — it belongs on the town item, not the region.

- [ ] **Step 7: Commit**

```bash
git add data/schemas/world.schema.json data/campaign/world.json packages/app/src/campaign.ts packages/app/src/campaign.test.ts
git commit -m "fix(app,data): an unwritten town is not ground you failed to take

Two defects with one cause. The Marj Strip read as conquered when two of
its three towns had never been authored, because regionProgress sums only
what exists and 5 of 5 completes a region. And Sur went live the moment
Beit Sahwan III finished -- an open front containing nothing, which is
also what made nextMissionAfter's fallback useless.

A town now says planned: true rather than having it inferred from an empty
missions array, because mid-authoring looks identical from the outside. A
front whose towns are all planned reads as not open, which is what the
campaign's ending needs Sur to be.

Naharin's gate also moves from beit_sahwan_3_clearance to the town's last
mission, so the Marj is finished before the corridor is offered.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The two story fields

**Files:**
- Modify: `data/schemas/mission.schema.json`
- Modify: `packages/app/src/main.ts` (the `hud.announce` call, ~line 622)
- Modify: `packages/app/src/ui/hud.ts` (`updateBanner`)
- Modify: `packages/app/src/ui/motion.ts` only if the hold cannot be passed from `announce`

**Interfaces:**
- Consumes: nothing.
- Produces: mission fields `dispatch?: string` and `aftermath?: string`. Task 5 authors their values.

- [ ] **Step 1: Add both fields to the mission schema**

In `data/schemas/mission.schema.json`, in the top-level `properties` object beside `briefing`:

```json
    "dispatch": {
      "type": "string",
      "description": "One or two sentences of story, shown on the title card at mission start where the objective count otherwise goes. The campaign's narrative voice: what this mission means in the war. Distinct from `briefing`, which is the orders voice and stays tactical. Optional -- a mission without one shows the objective count as before."
    },
    "aftermath": {
      "type": "string",
      "description": "One line shown in the victory banner. Reserved for missions that close an act; most missions have none."
    }
```

- [ ] **Step 2: Show `dispatch` on the title card, and hold it long enough to read**

`packages/app/src/main.ts` currently has:

```ts
    const primaries = mission.objectives.filter((o) => o.primary !== false).length;
    hud.announce(mission.name ?? mission.id, `${primaries} primary objective(s)`);
```

Replace with:

```ts
    const primaries = mission.objectives.filter((o) => o.primary !== false).length;
    // A dispatch is prose and needs reading time; the objective count does not.
    // titleCard's 900 ms default is #82's complaint, and it is fatal here --
    // the player clicks to start playing and the story is gone. Click and key
    // still dismiss, so this is a floor on the unhurried case, not a wait.
    const dispatch = mission.dispatch;
    hud.announce(
      mission.name ?? mission.id,
      dispatch ?? `${primaries} primary objective(s)`,
      dispatch !== undefined ? 5000 : undefined
    );
```

`announce(name, subtitle, holdMs?)` already forwards `holdMs` to `titleCard`, whose signature is `titleCard(host, title, subtitle, holdMs = 900)`. If `announce`'s signature does not already accept a third argument, add it as `holdMs?: number` and forward it.

You will need `dispatch` on the `MissionJson` type. Check whether `MissionJson` in `packages/sim/src/mission.ts` declares the mission's optional string fields; if `briefing` is declared there, add `dispatch?: string` and `aftermath?: string` beside it. **That is a type-only addition to a sim file — no logic.** If it requires anything more than adding two optional properties, stop and report.

- [ ] **Step 3: Show `aftermath` in the victory banner**

In `packages/app/src/ui/hud.ts`, find `updateBanner()`. It renders the mission-end text. Append the aftermath on victory only, as a second line, when the mission declares one. Read the surrounding code and match its DOM idiom rather than copying a snippet blind — the method already builds the banner's content and you are adding to it.

The rule: victory and `mission.aftermath !== undefined` → the aftermath appears below the existing line. Defeat, or no aftermath → unchanged.

- [ ] **Step 4: Prove it renders, without a browser**

There is no test harness for the title card. Add a temporary `dispatch` to one mission and run the app:

```bash
pnpm dev
```

Open the mission and confirm the card shows the sentence and holds long enough to read it. Then remove the temporary text.

If a browser is unavailable, say so plainly in your report and do **not** claim the rendering works — the type checks and the fields resolve, and that is all you will have shown.

- [ ] **Step 5: Gates and commit**

```bash
pnpm validate:data && pnpm typecheck && pnpm lint && pnpm test
```

```bash
git add data/schemas/mission.schema.json packages/app/src/main.ts packages/app/src/ui/hud.ts
git commit -m "feat(app,data): a mission can carry a dispatch and an aftermath

The title card has been printing '3 primary objective(s)' -- a machine
count standing exactly where a story beat belongs -- and the victory
banner has been printing a roster tally. Both are surfaces the player
already looks at, which is why the campaign's story goes here rather than
into screens it would have to fight for attention.

dispatch is the narrative voice, aftermath closes an act. Both optional,
both plain strings in the mission file, so a mission stays one file and
the story stays declarative data. Briefings are untouched: they are the
orders voice and they are good at it.

A card carrying prose holds five seconds rather than 900 ms, which is #82
in the only form this feature needs. Click and key still dismiss it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Walk the whole campaign

No unit test sees a gate whose target stopped existing. This is the proof the sequence holds.

**Files:**
- Create: `tools/src/campaign_walk.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: nothing.

- [ ] **Step 1: Write the walk**

Create `tools/src/campaign_walk.test.ts`:

```ts
// The campaign as a player actually walks it, start to finish.
//
// Every other test here builds its own small world. None of them sees the
// authored one, and the failures that matter live exactly there: a gate whose
// target mission was renamed, a front that opens onto nothing, a town whose
// last mission leads nowhere. tools/ is where the walkers live, for this.
import { describe, expect, it } from 'vitest';
import { world as worldJson } from '@lions/data';
import { parseWorld, nextMissionAfter, regionProgress } from '../../packages/app/src/campaign';

const world = parseWorld(worldJson);

/** Every mission the authored world offers, in the order it offers them. */
function walk(): string[] {
  const done: string[] = [];
  let current: string | undefined = world.regions
    .flatMap((r) => r.towns)
    .find((t) => t.missions.length > 0)?.missions[0];
  // A cap, not an expectation: a cycle would otherwise hang the suite.
  for (let guard = 0; current !== undefined && guard < 50; guard++) {
    done.push(current);
    current = nextMissionAfter(world, current, { 'campaign.completed_missions': [...done] });
  }
  return done;
}

describe('the authored campaign', () => {
  it('walks every mission in both fronts without a dead end', () => {
    expect(walk()).toEqual([
      'beit_sahwan_breach',
      'beit_sahwan_1_recon',
      'beit_sahwan_2_foothold',
      'beit_sahwan_3_clearance',
      'beit_sahwan_4_subterranean',
      'wadi_halam_1_fords',
      'wadi_halam_2_laager',
      'wadi_halam_3_counterraid',
      'wadi_halam_4_village',
      'wadi_halam_5_depot',
    ]);
  });

  it('never offers a front that has nothing in it', () => {
    const done: string[] = [];
    for (const id of walk()) {
      done.push(id);
      const ledger = { 'campaign.completed_missions': [...done] };
      for (const region of world.regions) {
        const p = regionProgress(region, ledger);
        if (p.status !== 'live') continue;
        const playable = region.towns.some((t) => t.missions.some((m) => !done.includes(m)));
        expect(playable, `${region.id} is live with nothing playable after ${id}`).toBe(true);
      }
    }
  });

  it('ends after the last mission rather than looping', () => {
    const all = walk();
    const ledger = { 'campaign.completed_missions': all };
    expect(nextMissionAfter(world, all[all.length - 1] as string, ledger)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run tools/src/campaign_walk.test.ts
```

Expected: all three pass. If the first fails at `beit_sahwan_4_subterranean` → `undefined`, Task 1 did not land. If the second fails naming `sur`, Task 2 did not land.

- [ ] **Step 3: Prove the walk can fail**

A walk that has never failed proves nothing. Temporarily change Naharin's `unlock.after_mission` in `data/campaign/world.json` to `"no_such_mission"`, run the walk, and confirm the first test fails with the Wadi Halam missions missing from the list. Then restore it with `git checkout data/campaign/world.json` and confirm the walk passes again.

Record both outputs in your report.

- [ ] **Step 4: Gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

```bash
git add tools/src/campaign_walk.test.ts
git commit -m "test(tools): walk the authored campaign end to end

Every other test in this repository builds its own small world, so none of
them has ever seen the campaign a player actually walks. The failures that
matter live exactly there: a gate naming a mission that was renamed, a
front that opens onto nothing, a town whose last mission leads nowhere.
Two of those three were live on main until this branch.

Verified the walk can fail by pointing Naharin's gate at a mission that
does not exist and watching Wadi Halam drop out of the sequence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Author the story

The bulk of the work, and the only task that is writing rather than engineering.

**Files:**
- Modify: all ten mission JSONs in `data/missions/` named in the table below

**Interfaces:**
- Consumes: Task 3's `dispatch` and `aftermath` fields.
- Produces: nothing.

- [ ] **Step 1: Read the spec's spine and register**

Read `docs/superpowers/specs/2026-08-21-campaign-storyline-design.md`, sections *The spine* and *Two optional fields on a mission*. The three sample lines there fix the voice: second person, present tense, clipped, no exclamation, no adjectives doing work a noun could do. Match the existing briefings' register — read two of them before writing anything.

- [ ] **Step 2: Author the ten dispatches**

Add a `dispatch` to each, placed immediately after `briefing` in the file. One or two sentences. Each must say what this mission means in the war, not what the objectives are — the objectives are on screen already.

| mission | the beat it carries |
|---|---|
| `beit_sahwan_breach` | the war opens by being started against you; dawn, the wire, two years of Ashwar's preparation arriving at once |
| `beit_sahwan_1_recon` | you go back to look at what hit you |
| `beit_sahwan_2_foothold` | you take ground and hold it — and something is digging underneath it |
| `beit_sahwan_3_clearance` | the town itself, block by block, with people still living in it |
| `beit_sahwan_4_subterranean` | what was beneath everything you took, the whole time |
| `wadi_halam_1_fords` | eight hundred kilometres east, and for the first time you arrive before they do |
| `wadi_halam_2_laager` | holding open ground, which is nothing like holding a street |
| `wadi_halam_3_counterraid` | the war's only breathing room; the first time you get to build rather than react |
| `wadi_halam_4_village` | the corridor's own town, and the same choices the Marj asked of you |
| `wadi_halam_5_depot` | cut the corridor and the fronts it feeds starve |

The Beit Sahwan → Wadi Halam handoff is the campaign's hinge: `wadi_halam_1_fords` should make the change of posture explicit, because the phase drop from 6 back to 2 is otherwise invisible.

- [ ] **Step 3: Author the two aftermaths**

`beit_sahwan_4_subterranean` closes Act I — the Marj is finished, and what the brigade learned there is what it carries east.

`wadi_halam_5_depot` closes the campaign and is the single most important line in this task. It must land three things: the corridor is cut; it is not decisive; Sur is still there. GDD §2's reasoning is the load-bearing part — cutting supply only matters once the fronts it feeds are contained, and Sur never was.

- [ ] **Step 4: Validate**

```bash
pnpm validate:data && pnpm typecheck && pnpm test
```

Expected: green. `validate:data` will reject a typo in either field name, which is the main mechanical risk in this task.

- [ ] **Step 5: Read all ten in order**

```bash
node -e '
const ids = ["beit_sahwan_breach","beit_sahwan_1_recon","beit_sahwan_2_foothold","beit_sahwan_3_clearance","beit_sahwan_4_subterranean","wadi_halam_1_fords","wadi_halam_2_laager","wadi_halam_3_counterraid","wadi_halam_4_village","wadi_halam_5_depot"];
for (const id of ids) {
  const m = require(`./data/missions/${id}.json`);
  console.log(`\n[${m.name}]\n  ${m.dispatch ?? "(none)"}`);
  if (m.aftermath) console.log(`  -- ${m.aftermath}`);
}
'
```

This is the campaign read as one text, which is the only way to hear whether it is one. Paste the output into your report. Fix anything that repeats a construction, contradicts an earlier beat, or states an objective instead of a meaning.

- [ ] **Step 6: Commit**

```bash
git add data/missions/beit_sahwan_breach.json data/missions/beit_sahwan_1_recon.json data/missions/beit_sahwan_2_foothold.json data/missions/beit_sahwan_3_clearance.json data/missions/beit_sahwan_4_subterranean.json data/missions/wadi_halam_1_fords.json data/missions/wadi_halam_2_laager.json data/missions/wadi_halam_3_counterraid.json data/missions/wadi_halam_4_village.json data/missions/wadi_halam_5_depot.json
git commit -m "feat(data): the war gets a voice

Ten dispatches and two aftermaths. The shape was already in the data --
both towns run in ascending phase order, Beit Sahwan opening at breach
because you are surprised and Wadi Halam at recon because you are not --
and nothing had ever said it out loud.

The ending is the part that matters. You cut the corridor and it is not
decisive, because GDD §2 says supply only matters once the fronts it feeds
are contained, and Sur never was. The front nobody has authored stops
being a hole in the content and becomes the reason the war does not end.

Briefings are untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** The spine → Task 5; the two fields → Task 3; #82's hold → Task 3 Step 2; the three progression defects → Tasks 1 and 2; the `planned` flag → Task 2; the ordering move → Task 2 Step 4; the world-state walk the spec's Verification section demands → Task 4.

**Not covered, deliberately.** The spec's "Out" list — reactive briefings, town interstitials, campaign-map narrative, naming commanders, authoring Sur, a fuller #82 — has no tasks, which is correct.

**Type consistency.** `planned` is spelled the same in `world.schema.json`, `TownJson`, `WorldTown` and `parseWorld`. `dispatch` and `aftermath` are spelled the same in `mission.schema.json`, `main.ts`, `hud.ts` and Task 5's table. `nextMissionAfter`, `nextMissionOf`, `regionProgress` and `parseWorld` match their definitions in `campaign.ts`.

**Known softness.** Task 3 Step 3 describes the banner change in prose rather than code, because `updateBanner` builds its content in a way that must be read before it is extended; and Task 3 Step 4 cannot be automated. Both are called out in place rather than papered over.
