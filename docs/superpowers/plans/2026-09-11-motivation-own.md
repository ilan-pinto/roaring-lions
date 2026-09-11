# Motivation Layer, Step 2 "Own" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player a company they own: every surviving unit carries a name and a service record across missions, an unfielded survivor is never silently dropped, a stripe is earned by contributing to a completed objective rather than by a kill alone, and the stripes are drawn on the unit.

**Architecture:** Identity is an app concern and the sim is its courier. The sim carries an opaque `name` and two integer counters (`missions`, `kills`) on `LedgerRosterEntry` through a mission and back out, exposes which roster entry an entity was drawn from, and credits objective contribution with a `contributed` set that the veterancy rule reads. The app assigns names deterministically from a screened table by a per-kind issue counter on the ledger, never from any RNG. The renderer draws stripes from `sim.state.veterancy` as its own atlas quad at band 1.5, three.js only.

**Tech Stack:** TypeScript strict, vitest, JSON Schema via ajv in `tools/validate_data.mjs`, three.js (render only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-motivation-layer-design.md` §4.7 (named units and the service record) and §4.8 (the veterancy earn rule). Step 1 landed as `f383d31` on main; this plan builds on it.

## Global Constraints

- `@lions/sim` bans floating point, `Math.*` and division; every number it writes is an integer. **A name must never be drawn from the sim's RNG**: `Rng.state` is folded into the state hash and `Sim.spawn` consumes zero draws today, so one draw would move the golden hash and every later combat roll (spec §4.7). Names are assigned in `packages/app`.
- Dependency direction `app → render → sim`, `data` a leaf. `three` is imported only under `packages/render/src/three/**`. `packages/render/src/renderer.ts` (Pixi) is frozen: the chevron is three-only, and that is the intended end state.
- The golden determinism hash `3160666129` in `packages/sim/src/determinism.test.ts:381` must not move. The golden replay spawns with veterancy 0, lays no mission runtime and reads no roster; a change that moves it is a defect, not a re-bless.
- `pnpm playtest` must exit 0 after every sim task. The earn rule and the pool carry change rosters, so plan lines' `roster out` and stars may move; record each change in the task report and do not alter any plan's orders.
- The naming rule (`docs/campaign/storyline.md` §2.4): KDF names sit in the materiel register (Lavi, Namer, Eitan, Yahalom, Peten, Shoded, Ari'im, Kedem, Sahar); single common nouns, never given-name plus surname, no toponym, no real force's platform or unit name, no religious term; every entry screened and dated; no generator crossing two lists. Squads get callsigns; vehicles a hull number and a painted name; drones and the Peten a task number; civilians never.
- UI colour comes only from `theme.css` semantic tokens; the stripe colour is `--commend` in the DOM and the palette key it maps to in the renderer.
- Player-facing strings say Conduct, never the acronym.
- Run commands from the repository root. In an EnterWorktree session call git as `/usr/bin/git`, one plain command per call. Never `git add -A`. Never kill or restart a dev server. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| file | responsibility |
|---|---|
| `packages/sim/src/mission.ts` | `LedgerRosterEntry.name/missions/kills`; `entityRoster` map and `rosterEntryOf(id)`; unfielded pool carry; `contributed` set and the earn rule; route-mark credit. |
| `packages/sim/src/sim.ts` | `contact` event gains `observer`; `stepDetection` tracks the best observer per (side, target) per tick; the route-identified event names the carrier. |
| `packages/sim/src/index.ts` | nothing new to export (types travel through `LedgerRosterEntry`). |
| `data/campaign/names.json`, `data/schemas/names.schema.json`, `tools/validate_data.mjs` | the screened name table, its schema, its gate. |
| `packages/app/src/names.ts` (new) + test | `nameKind`, `assignNames`, the `campaign.names_issued` counter. |
| `packages/app/src/main.ts` | assign names before saving the ledger; pass `rosterEntryOf` to the HUD; pass names to the deploy panel. |
| `packages/app/src/ui/hud.ts` | the single-unit card shows the name and the service record. |
| `packages/app/src/ui/loading.ts` | the brought panel lists names per type. |
| `packages/render/src/three/units/overlays.ts` | `ChevronBatch`, a 3-cell atlas quad at band 1.5. |
| `packages/render/src/three/ThreeRenderer.ts` | construct, push per living side-0 entity with stripes, dispose. |

---

### Task 1: The roster carries identity, and unfielded survivors carry forward

**Files:**
- Modify: `packages/sim/src/mission.ts` (`LedgerRosterEntry` ~86, class fields ~465, the ledger draw ~1126–1140, `checkEnd`'s survivor loop ~1685–1700)
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Produces: `interface LedgerRosterEntry { type: string; veterancy: number; name?: string; missions?: number; kills?: number }`; `MissionRuntime.rosterEntryOf(id: number): LedgerRosterEntry | undefined` (the entry an entity was drawn from, or undefined for a fresh spawn); produced `roster.surviving_units` = survivors (drawn entries keep `name`, `missions + 1`, `kills + this mission's`; fresh survivors get `missions: 1`, `kills: this mission's`, no `name`) followed by every pool entry that was never drawn, unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sim/src/mission.test.ts` inside the file's existing `describe('campaign ledger', ...)` (the describe that holds `'victory produces the declared keys: updated roster and per-mission ROE'`), using its `makeWorld`, `baseMission`, `LEDGER_MISSION` and `TICKS_PER_SECOND`:

```ts
  it('carries a drawn unit\'s name and record through, and counts the mission served', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_tank', count: 1, at: [4, 5], from_ledger: true }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [11, 5], facing_deg: 180 }] },
        ledger: { requires: ['roster.surviving_units'], produces: ['roster.surviving_units'] },
      }),
      { ledger: { 'roster.surviving_units': [{ type: 'm_tank', veterancy: 1, name: '2-1 Gachelet', missions: 2, kills: 3 }] } }
    );
    const tank = w.playerIds()[0];
    expect(w.runtime.rosterEntryOf(tank)?.name).toBe('2-1 Gachelet');
    const { mission } = w.step(90 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    const roster = end.ledger['roster.surviving_units'] as LedgerRosterEntry[];
    expect(roster).toEqual([{ type: 'm_tank', veterancy: 2, name: '2-1 Gachelet', missions: 3, kills: 4 }]);
  });

  it('a fresh survivor gets a record and no name; the app names it later', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 2 }],
        ledger: { requires: [], produces: ['roster.surviving_units'] },
      })
    );
    const { mission } = w.step(4 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    const roster = end.ledger['roster.surviving_units'] as LedgerRosterEntry[];
    expect(roster).toEqual([{ type: 'm_squad', veterancy: 0, missions: 1, kills: 0 }]);
    expect(w.runtime.rosterEntryOf(w.playerIds()[0])).toBeUndefined();
  });

  it('an unfielded pool entry carries forward unchanged, after the survivors', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5], from_ledger: true }],
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 2 }],
        ledger: { requires: ['roster.surviving_units'], produces: ['roster.surviving_units'] },
      }),
      {
        ledger: {
          'roster.surviving_units': [
            { type: 'm_squad', veterancy: 2, name: 'Sela', missions: 1, kills: 1 },
            { type: 'm_tank', veterancy: 3, name: '1-2 Ayil', missions: 4, kills: 9 },
          ],
        },
      }
    );
    const { mission } = w.step(4 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    expect(end.ledger['roster.surviving_units']).toEqual([
      { type: 'm_squad', veterancy: 2, name: 'Sela', missions: 2, kills: 1 },
      { type: 'm_tank', veterancy: 3, name: '1-2 Ayil', missions: 4, kills: 9 },
    ]);
  });
```

If the file's world helper exposes player ids under a different name than `playerIds()`, use that (grep `side[i] === 0` in the file for how other tests list them) and say so in the report. Import `LedgerRosterEntry` from `./mission` if the file does not already.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sim/src/mission.test.ts -t "carries a drawn|fresh survivor|unfielded pool"`
Expected: FAIL — `rosterEntryOf` is not a function; the roster lacks `missions`/`kills`; the unfielded tank is absent.

- [ ] **Step 3: Implement**

`LedgerRosterEntry`:

```ts
export interface LedgerRosterEntry {
  type: string;
  veterancy: number;
  /** The unit's name, assigned by the app from a screened table and carried here
   *  opaquely (spec §4.7). The sim never reads or invents one. */
  name?: string;
  /** Missions this unit has come back from. */
  missions?: number;
  /** Kills across the campaign. */
  kills?: number;
}
```

Class field beside `rosterPool`:

```ts
  /** Which pool entry each fielded entity was drawn from, so its name and record can
   *  travel through this mission and back out. Fresh spawns have no entry. */
  private readonly entityRoster = new Map<number, LedgerRosterEntry>();
```

In the ledger draw, keep the drawn entries rather than only their veterancy. Replace the `veterancies` block with:

```ts
    const hasRoster = this.ctx.ledger?.['roster.surviving_units'] !== undefined;
    let drawn: (LedgerRosterEntry | null)[];
    if (side === 0 && p.from_ledger === true && hasRoster) {
      drawn = [];
      for (let k = 0; k < p.count; k++) {
        const idx = this.rosterPool.findIndex((r) => r.type === p.unit);
        if (idx < 0) break;
        drawn.push(this.rosterPool[idx]);
        this.rosterPool.splice(idx, 1);
      }
      if (drawn.length === 0) drawn = [null];
    } else {
      drawn = new Array<LedgerRosterEntry | null>(p.count).fill(null);
    }
```

and where each body is spawned with `veterancies[k]`, spawn with `drawn[k]?.veterancy ?? 0` and, when `drawn[k]` is not null, `this.entityRoster.set(id, drawn[k])` right after the spawn's entity id is known (the same place `playerIds`/`enemyIds` get pushed). Keep everything else about the placement loop unchanged.

Public getter after `objectiveStatus`:

```ts
  /** The ledger entry a fielded entity was drawn from, if any. The HUD's single-unit
   *  card reads the name and record off it; a fresh spawn returns undefined. */
  rosterEntryOf(id: number): LedgerRosterEntry | undefined {
    return this.entityRoster.get(id);
  }
```

In `checkEnd`'s survivor loop, build each entry from its origin:

```ts
    for (const id of this.playerIds) {
      if (this.sim.state.alive[id] !== 1) continue;
      const typeId = this.sim.unitTypes[this.sim.state.typeIdx[id]].id;
      survivors.push(typeId);
      let vet = this.sim.state.veterancy[id];
      if ((this.kills.get(id) ?? 0) > 0 && vet < 3) {
        vet++;
        this.promotedValue++;
      }
      const origin = this.entityRoster.get(id);
      const entry: LedgerRosterEntry = {
        type: typeId,
        veterancy: vet,
        missions: (origin?.missions ?? 0) + 1,
        kills: (origin?.kills ?? 0) + (this.kills.get(id) ?? 0),
      };
      if (origin?.name !== undefined) entry.name = origin.name;
      roster.push(entry);
    }
    // Survivors first, then whoever was never fielded: a unit that stayed in the pool
    // neither served nor changed, and dropping it because this mission's placements did
    // not call for its type was the silent deletion spec §4.7 names.
    for (const left of this.rosterPool) roster.push({ ...left });
```

(The `vet++` condition is replaced by the earn rule in Task 3; leave it as the kill rule here so this task stays one change.)

- [ ] **Step 4: Run the sim suite, determinism and the harness**

Run: `npx vitest run packages/sim && pnpm test:determinism && pnpm playtest 2>&1 | grep -E "FAILED|roster out" | head -40`
Expected: tests pass; hash unmoved; harness exit 0. Chained plans (`led1`…`led3` and the town chains) may now report larger `roster out` because unfielded entries carry: record every line whose `roster out` changed, before and after, in the report.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts
/usr/bin/git commit -m "feat(sim): the roster carries a name and a record, and an unfielded survivor carries forward" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The sim names the observer that identified a contact, and the carrier that found a route

**Files:**
- Modify: `packages/sim/src/sim.ts` (`SimEvent` `contact` ~576, `seenThisTick` ~932/1139, `stepDetection` ~2645–2700, the route-identified emit near `markerSeesRoute` ~2719)
- Test: `packages/sim/src/sim.test.ts` (or `tunnels.test.ts` for the route half)

**Interfaces:**
- Produces: the `contact` event gains `observer: number` (the entity whose detection contributed most this tick to the target's contact on that side; `-1` when the transition came from decay or a pre-mark); the route-identified event (find it: `grep -n "tnContact\|route" packages/sim/src/sim.ts | grep pendingEvents`) gains `observer: number` (the `canMarkTunnel` carrier that sees the route, `-1` when identified by spoil alone).

- [ ] **Step 1: Write the failing tests**

In `packages/sim/src/sim.test.ts`, next to the existing detection tests (grep `'identified'`):

```ts
  it('names the observer that identified a contact', () => {
    const sim = new Sim({ seed: 7, width: 24, height: 8, capacity: 8 });
    const squad = sim.addUnitType(SQUAD);
    const runner = sim.addUnitType(RUNNER);
    const eye = sim.spawn(squad, 0, fx.from(3.5), fx.from(4.5));
    sim.spawn(runner, 1, fx.from(7.5), fx.from(4.5));
    let observer = -2;
    for (let t = 0; t < 10 * TICKS_PER_SECOND && observer === -2; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'contact' && e.level === 'identified' && e.side === 0) observer = e.observer;
      }
    }
    expect(observer).toBe(eye);
  });
```

Use the file's own `SQUAD`/`RUNNER` type literals (they exist for the veterancy tests). For the route half, in `packages/sim/src/tunnels.test.ts` find the test that proves a `mark_tunnel` carrier identifies a route and add an assertion that the identifying event's `observer` is that carrier's id; if no such event exists yet (identification is read from state), add the event's `observer` where the state transition is made and assert it there.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/sim/src/sim.test.ts -t "names the observer"`
Expected: FAIL — `e.observer` is undefined (typecheck error on the field, or `-2` never replaced).

- [ ] **Step 3: Implement**

Declare beside `seenThisTick`:

```ts
  /** Per (side, target) this tick: the observer whose detection probability was highest,
   *  so an `identified` transition can say who saw it. Scratch, rebuilt every tick,
   *  never hashed -- it is a label on an event, not state. -1 = nobody this tick. */
  private readonly bestObserver: Int32Array;
  private readonly bestObserverP: Int32Array;
```

Allocate in the constructor beside `seenThisTick`: `this.bestObserver = new Int32Array(2 * n); this.bestObserverP = new Int32Array(2 * n);`. In `stepDetection`, after `this.seenThisTick.fill(0)`, add `this.bestObserver.fill(-1); this.bestObserverP.fill(0);`. Inside the observer loop where `this.seenThisTick[k] = 1` is set:

```ts
        if (d.p > this.bestObserverP[k]) {
          this.bestObserverP[k] = d.p;
          this.bestObserver[k] = obs;
        }
```

(`d.p` is `Fx`, an integer; comparison only.) In the transition loop, add `observer: this.bestObserver[k]` to the three `contact` pushes. Extend the union member: `{ kind: 'contact'; tick: number; side: number; target: number; level: ContactLevel; confidence: Fx; observer: number }`. Any other `contact` emit sites (`grep -n "kind: 'contact'" packages/sim/src/sim.ts`, for example `identifyTo`) pass `observer: -1`.

For the route: in the block around line 2719 where `this.markerSeesRoute(s, r)` decides the route contact holds at identified, change `markerSeesRoute` to return the carrier's entity id or `-1` (rename to `markerSeeingRoute`, keep the boolean call sites as `>= 0`), and add `observer` to the route-identified event it emits.

- [ ] **Step 4: Run tests and the canary**

Run: `npx vitest run packages/sim && pnpm test:determinism && pnpm typecheck`
Expected: pass; hash unmoved (the new arrays are never hashed and no roll is consumed).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/sim/src/sim.ts packages/sim/src/sim.test.ts packages/sim/src/tunnels.test.ts
/usr/bin/git commit -m "feat(sim): a contact says who saw it, and a found route says which carrier" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The veterancy earn rule

**Files:**
- Modify: `packages/sim/src/mission.ts` (the event digest ~880–900, objective completion ~1560–1640, the survivor loop from Task 1)
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Consumes: `contact.observer` and the route event's `observer` (Task 2).
- Produces: a stripe is earned by a survivor that **contributed** to a completed objective: it holds kill credit, or it was a living player unit inside the zone when a `hold_for` or `capture` completed, or it was alive when a `survive_until` completed, or it was the observer that identified a unit a `locate` needed (or any identified enemy for a count-based `locate`), or it was the carrier that found a route a `collapse` objective later brought down. `MissionRuntime.contributedCount: number` for the report.

- [ ] **Step 1: Write the failing tests**

Append to the `'the grade and the debrief figures'` describe:

```ts
  it('a survivor with no kill and no part in any objective earns no stripe', () => {
    // Two squads; the enemy is out of reach, so nobody kills; a survive primary completes.
    // Alive at a survive_until completion counts as contributing, so BOTH earn. Then the
    // negative: a hold_for zone one squad never enters.
    const w = makeWorld(
      baseMission({
        starting_force: [
          { unit: 'm_squad', count: 1, at: [3, 5] },
          { unit: 'm_squad', count: 1, at: [3, 6] },
        ],
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 2 }],
        ledger: { requires: [], produces: ['roster.surviving_units'] },
      })
    );
    const { mission } = w.step(4 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    const roster = end.ledger['roster.surviving_units'] as LedgerRosterEntry[];
    expect(roster.map((r) => r.veterancy)).toEqual([1, 1]);
  });

  it('holding the zone earns the stripe; standing elsewhere does not', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [
          { unit: 'm_squad', count: 1, at: [ZONE_X, ZONE_Y] },
          { unit: 'm_squad', count: 1, at: [3, 6] },
        ],
        objectives: [{ id: 'take', type: 'hold_for', primary: true, target: 'hold_zone', seconds: 2 }],
        ledger: { requires: [], produces: ['roster.surviving_units'] },
      }),
      { zones: { hold_zone: [ZONE_X, ZONE_Y, 2, 2] } }
    );
    const { mission } = w.step(6 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    const roster = end.ledger['roster.surviving_units'] as LedgerRosterEntry[];
    expect(roster.map((r) => r.veterancy)).toEqual([1, 0]);
  });

  it('the observer that identified the located unit earns the stripe', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [7, 5], tag: 'post' }] },
        objectives: [{ id: 'see', type: 'locate', primary: true, target: 'post' }],
        ledger: { requires: [], produces: ['roster.surviving_units'] },
      })
    );
    const { mission } = w.step(20 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    const roster = end.ledger['roster.surviving_units'] as LedgerRosterEntry[];
    expect(roster[0]?.veterancy).toBe(1);
  });
```

Pick `ZONE_X`/`ZONE_Y` as constants on an open tile of `baseMission`'s map (read the helper; the file's other `hold_for` tests show a zone that works — reuse their zone and coordinates and say so). If `makeWorld` takes zones through a different option name, adapt.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/sim/src/mission.test.ts -t "earns no stripe|holding the zone|observer that identified"`
Expected: the first fails (`[0, 0]`: nobody killed), the second fails (`[0, 0]`), the third fails (`0`).

- [ ] **Step 3: Implement**

Class field beside `kills`:

```ts
  /** Player entities that contributed to a completed objective this mission (spec §4.8):
   *  kill credit, held a zone at a hold/capture completion, alive at a survive completion,
   *  identified a unit a locate needed, or found a route a collapse brought down. The
   *  stripe reads this, not the kill map alone. */
  private readonly contributed = new Set<number>();
  /** Which player entity identified each enemy entity, from `contact.observer`. */
  private readonly identifiedBy = new Map<number, number>();
  /** Which player entity found each route, from the route event's observer. */
  private readonly routeFoundBy = new Map<number, number>();
```

In the event digest: where `this.identified.add(e.target)` runs, also `if (e.observer >= 0) this.identifiedBy.set(e.target, e.observer);`. Where kills are counted, also `this.contributed.add(e.by)` when `this.sim.state.side[e.by] === 0`. Where the route-identified event is digested (or, if the runtime reads route state rather than an event, where it first sees a route identified), record `this.routeFoundBy.set(routeIndex, observer)` when `observer >= 0`.

Add a helper beside `livingIn`:

```ts
  /** Living player entities standing in `zone` (same rule as livingIn: buried units hold no ground). */
  private playerIdsIn(zone: readonly number[]): number[] {
    const out: number[] = [];
    const st = this.sim.state;
    for (const id of this.playerIds) {
      if (st.alive[id] === 0 || st.tunnelIn[id] >= 0) continue;
      const tx = st.posX[id] >> 16;
      const ty = st.posY[id] >> 16;
      if (tx >= zone[0] && tx < zone[0] + zone[2] && ty >= zone[1] && ty < zone[1] + zone[3]) out.push(id);
    }
    return out;
  }
```

In the objective loop, at the point `if (complete) { o.status = 'complete'; ...` add, before the status write:

```ts
      if (complete) {
        this.creditContribution(o.def);
```

and the method:

```ts
  private creditContribution(d: ObjectiveJson): void {
    const st = this.sim.state;
    if (d.type === 'hold_for' || d.type === 'capture') {
      const z = this.zone(d.target);
      if (z) for (const id of this.playerIdsIn(z)) this.contributed.add(id);
    } else if (d.type === 'survive_until') {
      for (const id of this.playerIds) if (st.alive[id] === 1) this.contributed.add(id);
    } else if (d.type === 'locate') {
      const targets = d.target ? (this.tags.get(d.target) ?? []) : [...this.identified];
      for (const t of targets) {
        const by = this.identifiedBy.get(t);
        if (by !== undefined) this.contributed.add(by);
      }
    } else if (d.type === 'collapse') {
      for (const [, by] of this.routeFoundBy) this.contributed.add(by);
    }
  }
```

(`collapse` credits every carrier that found any route — a collapse objective is about the routes under its zone, and the runtime snapshots those; if the snapshot set is available as a field, restrict to routes in it.)

In the survivor loop, replace the kill condition with the contribution rule:

```ts
      if (this.contributed.has(id) && vet < 3) {
        vet++;
        this.promotedValue++;
      }
```

and add `get contributedCount(): number { return this.contributed.size; }` beside `promotedCount`.

- [ ] **Step 4: Run the sim suite, the canary and the harness**

Run: `npx vitest run packages/sim && pnpm test:determinism && pnpm playtest 2>&1 | grep -E "FAILED|stars" | head -60`
Expected: pass; hash unmoved; harness exit 0. Stripe totals in chained rosters change; stars must not (the grade never reads veterancy). Record any plan whose `roster out` or stars moved.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts
/usr/bin/git commit -m "feat(sim): a stripe is earned by contributing to a completed objective, not by a kill alone" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The name table and its gate

**Files:**
- Create: `data/campaign/names.json`
- Create: `data/schemas/names.schema.json`
- Modify: `tools/validate_data.mjs` (the `data/campaign` block ~128–136 and the schema loading above it)
- Modify: `docs/campaign/README.md` (one bullet under "Rules that apply to every document")

**Interfaces:**
- Produces: `names.json` = `{ kinds: { task_roles: string[]; vehicle_roles: string[]; vehicle_ids: string[] }, squads: { name, screened }[], vehicles: { hull, name, screened }[], tasks: { name, screened }[] }`. `kinds` decides a unit's name kind from its JSON: role in `task_roles` → task; role in `vehicle_roles` or id in `vehicle_ids` → vehicle; otherwise squad.

- [ ] **Step 1: Write the table**

```json
{
  "kinds": {
    "task_roles": ["drone", "gunship"],
    "vehicle_roles": ["apc", "ifv", "mbt"],
    "vehicle_ids": ["dozer_d9"]
  },
  "squads": [
    { "name": "Sela", "screened": "2026-09-11" },
    { "name": "Barzel", "screened": "2026-09-11" },
    { "name": "Tzur", "screened": "2026-09-11" },
    { "name": "Marom", "screened": "2026-09-11" },
    { "name": "Keshet", "screened": "2026-09-11" },
    { "name": "Migdal", "screened": "2026-09-11" }
  ],
  "vehicles": [
    { "hull": "1-2", "name": "Ayil", "screened": "2026-09-11" },
    { "hull": "2-1", "name": "Gachelet", "screened": "2026-09-11" },
    { "hull": "2-4", "name": "Yated", "screened": "2026-09-11" }
  ],
  "tasks": [
    { "name": "Eye Two", "screened": "2026-09-11" },
    { "name": "Kite One", "screened": "2026-09-11" }
  ]
}
```

These are the names the narrative-designer screened on 2026-09-10 (single common nouns in the materiel register: rock, iron, cliff, height, bow, tower; ram, ember, peg). Do not add names; the table wraps with a numeral suffix (Task 5).

- [ ] **Step 2: Write the schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://roaringlions.dev/schemas/names.schema.json",
  "title": "Unit name table",
  "description": "The screened names the app assigns to surviving units (spec 2026-09-10 §4.7; storyline §2.4 rule 4). Squads get a callsign, vehicles a hull number and a painted name, drones and the Peten a task number. Single common nouns in the materiel register, each screened and dated; never a given-name plus surname, a toponym, a real force's platform or unit, or a religious term. Names are issued in table order by a per-kind counter on the ledger, never drawn at random.",
  "type": "object",
  "required": ["kinds", "squads", "vehicles", "tasks"],
  "additionalProperties": false,
  "properties": {
    "kinds": {
      "type": "object",
      "required": ["task_roles", "vehicle_roles", "vehicle_ids"],
      "additionalProperties": false,
      "properties": {
        "task_roles": { "type": "array", "items": { "type": "string" } },
        "vehicle_roles": { "type": "array", "items": { "type": "string" } },
        "vehicle_ids": { "type": "array", "items": { "type": "string" } }
      }
    },
    "squads": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/named" } },
    "vehicles": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["hull", "name", "screened"],
        "additionalProperties": false,
        "properties": {
          "hull": { "type": "string", "pattern": "^[1-9]-[1-9]$" },
          "name": { "$ref": "#/$defs/noun" },
          "screened": { "$ref": "#/$defs/date" }
        }
      }
    },
    "tasks": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/named" } }
  },
  "$defs": {
    "noun": { "type": "string", "pattern": "^[A-Z][a-z']+( [A-Z][a-z]+)?$" },
    "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "named": {
      "type": "object",
      "required": ["name", "screened"],
      "additionalProperties": false,
      "properties": {
        "name": { "$ref": "#/$defs/noun" },
        "screened": { "$ref": "#/$defs/date" }
      }
    }
  }
}
```

- [ ] **Step 3: Wire the gate**

In `tools/validate_data.mjs`, load `data/schemas/names.schema.json` beside the `commander` schema, compile it into `validators.names`, and add after the commander line:

```js
  checked += validateFile(join(ROOT, 'data/campaign/names.json'), validators.names, 'names.schema');
```

Then a cross-check in the campaign section: every `kinds.task_roles`/`vehicle_roles` entry must be a role some unit in `data/units/kdf` declares, and every `vehicle_ids` entry must be a unit id there — a typo in the kind table would silently name a bulldozer "Sela". Push a failure naming the offender otherwise.

Run: `pnpm validate:data` — expected: `112 file(s) validated`. Then prove the gate can fail: temporarily add `"vehicle_ids": ["dozer_d99"]`, run, expect a failure naming it, revert.

- [ ] **Step 4: Record the rule**

In `docs/campaign/README.md`, under "Rules that apply to every document", add:

```markdown
9. Unit names come from `data/campaign/names.json` only (storyline §2.4 rule 4): single
   common nouns in the materiel register, screened and dated, issued in table order by a
   counter on the ledger. Never write a name into a mission, a line or a briefing; the
   player's units are named by the app, and a name the table does not hold does not exist.
```

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add data/campaign/names.json data/schemas/names.schema.json tools/validate_data.mjs docs/campaign/README.md
/usr/bin/git commit -m "content(campaign): the screened unit name table and its gate" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Names are issued in the app, deterministically

**Files:**
- Create: `packages/app/src/names.ts`
- Create: `packages/app/src/names.test.ts`
- Modify: `packages/app/src/main.ts` (the `missionEnd` handler where `updatedLedger` is built and saved, ~1905)
- Modify: `packages/data/src/index.ts` if `names.json` is not already exported the way `commander`/`world` are (check with `grep -n "commander" packages/data/src/index.ts`)

**Interfaces:**
- Consumes: `LedgerRosterEntry` (Task 1), `names.json` (Task 4).
- Produces:
  - `type NameKind = 'squad' | 'vehicle' | 'task'`; `nameKind(unit: { id: string; role: string }, table: NamesJson): NameKind`.
  - `assignNames(roster: LedgerRosterEntry[], issued: Record<NameKind, number>, kindOf: (typeId: string) => NameKind, table: NamesJson): { roster: LedgerRosterEntry[]; issued: Record<NameKind, number> }` — pure; entries that already have a `name` are untouched; entries without one receive the next name of their kind in table order; past the table's end the name repeats with a Roman numeral (`Sela II`, `Sela III`); vehicles read `"<hull> <name>"`.
  - `LedgerData['campaign.names_issued']?: Record<NameKind, number>` (app-written; the sim ignores it).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/names.test.ts
import { describe, expect, it } from 'vitest';
import namesJson from '../../../data/campaign/names.json';
import { assignNames, nameKind, type NamesJson } from './names';

const table = namesJson as NamesJson;
const kindOf = (typeId: string): ReturnType<typeof nameKind> => {
  const roles: Record<string, string> = { inf_squad: 'infantry', mbt_lavi: 'mbt', recon_drone: 'drone', dozer_d9: 'engineer', heli_peten: 'gunship' };
  return nameKind({ id: typeId, role: roles[typeId] ?? 'infantry' }, table);
};

describe('nameKind', () => {
  it('reads the kind from the table, with the id override for the D9', () => {
    expect(kindOf('inf_squad')).toBe('squad');
    expect(kindOf('mbt_lavi')).toBe('vehicle');
    expect(kindOf('recon_drone')).toBe('task');
    expect(kindOf('heli_peten')).toBe('task');
    expect(kindOf('dozer_d9')).toBe('vehicle');
  });
});

describe('assignNames', () => {
  it('names the unnamed in table order and leaves the named alone', () => {
    const { roster, issued } = assignNames(
      [
        { type: 'inf_squad', veterancy: 0 },
        { type: 'mbt_lavi', veterancy: 1, name: '2-1 Gachelet' },
        { type: 'inf_squad', veterancy: 2 },
        { type: 'recon_drone', veterancy: 0 },
      ],
      { squad: 0, vehicle: 0, task: 0 },
      kindOf,
      table
    );
    expect(roster.map((r) => r.name)).toEqual(['Sela', '2-1 Gachelet', 'Barzel', 'Eye Two']);
    expect(issued).toEqual({ squad: 2, vehicle: 0, task: 1 });
  });

  it('continues from the issued counter and wraps with a numeral', () => {
    const { roster, issued } = assignNames(
      [{ type: 'inf_squad', veterancy: 0 }, { type: 'inf_squad', veterancy: 0 }],
      { squad: 5, vehicle: 0, task: 0 },
      kindOf,
      table
    );
    expect(roster.map((r) => r.name)).toEqual(['Migdal', 'Sela II']);
    expect(issued.squad).toBe(7);
  });

  it('is pure: the input roster is not mutated', () => {
    const input = [{ type: 'inf_squad', veterancy: 0 }];
    assignNames(input, { squad: 0, vehicle: 0, task: 0 }, kindOf, table);
    expect(input[0]).toEqual({ type: 'inf_squad', veterancy: 0 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/app/src/names.test.ts`
Expected: FAIL — `./names` does not exist.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/names.ts
/**
 * Unit names (spec 2026-09-10 §4.7). Assigned HERE, in the app, never in the sim: the
 * sim's per-entity RNG is folded into the state hash, and a draw for a name would move
 * every later combat roll. Determinism comes from table order and a counter on the
 * ledger instead, so the same campaign always names the same units the same way.
 */
import type { LedgerRosterEntry } from '@lions/sim';

export type NameKind = 'squad' | 'vehicle' | 'task';

export interface NamesJson {
  kinds: { task_roles: string[]; vehicle_roles: string[]; vehicle_ids: string[] };
  squads: { name: string; screened: string }[];
  vehicles: { hull: string; name: string; screened: string }[];
  tasks: { name: string; screened: string }[];
}

export function nameKind(unit: { id: string; role: string }, table: NamesJson): NameKind {
  if (table.kinds.task_roles.includes(unit.role)) return 'task';
  if (table.kinds.vehicle_ids.includes(unit.id) || table.kinds.vehicle_roles.includes(unit.role)) return 'vehicle';
  return 'squad';
}

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const suffix = (round: number): string => (round < 2 ? '' : ` ${ROMAN[round] ?? String(round)}`);

function nthName(kind: NameKind, n: number, table: NamesJson): string {
  if (kind === 'vehicle') {
    const v = table.vehicles[n % table.vehicles.length];
    return `${v.hull} ${v.name}${suffix(1 + Math.floor(n / table.vehicles.length))}`;
  }
  const list = kind === 'squad' ? table.squads : table.tasks;
  const e = list[n % list.length];
  return `${e.name}${suffix(1 + Math.floor(n / list.length))}`;
}

export function assignNames(
  roster: readonly LedgerRosterEntry[],
  issued: Record<NameKind, number>,
  kindOf: (typeId: string) => NameKind,
  table: NamesJson
): { roster: LedgerRosterEntry[]; issued: Record<NameKind, number> } {
  const next = { ...issued };
  const out = roster.map((entry) => {
    if (entry.name !== undefined) return { ...entry };
    const kind = kindOf(entry.type);
    const name = nthName(kind, next[kind], table);
    next[kind] += 1;
    return { ...entry, name };
  });
  return { roster: out, issued: next };
}
```

Check `ROMAN[round]` for `round` 1: `suffix(1)` returns `''` (the first pass has no numeral); the table above gives `Sela II` for the seventh squad (round 2). Export `names` JSON from `@lions/data` the way `commander` is exported if it is not already.

In `main.ts`, at the `missionEnd` handler, between `const updatedLedger = { ...ledger, ...me.ledger };` and `saveLedger(updatedLedger)` (victory only, since defeats write nothing):

```ts
          if (me.result === 'victory') {
            const rosterIn = updatedLedger['roster.surviving_units'];
            if (Array.isArray(rosterIn)) {
              const issuedIn = (updatedLedger['campaign.names_issued'] as Record<NameKind, number> | undefined) ?? { squad: 0, vehicle: 0, task: 0 };
              const named = assignNames(rosterIn, issuedIn, (typeId) => nameKind(unitFor(typeId), names as NamesJson), names as NamesJson);
              updatedLedger['roster.surviving_units'] = named.roster;
              updatedLedger['campaign.names_issued'] = named.issued;
            }
            saveLedger(updatedLedger);
```

where `unitFor(typeId)` returns `{ id, role }` from the `units` JSON (`units[typeId as keyof typeof units]`; fall back to `{ id: typeId, role: 'infantry' }` for an unknown id). Import `assignNames`, `nameKind`, `type NameKind`, `type NamesJson` from `./names` and `names` from `@lions/data`.

- [ ] **Step 4: Run the tests and gates**

Run: `npx vitest run packages/app && pnpm typecheck && pnpm lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/names.ts packages/app/src/names.test.ts packages/app/src/main.ts packages/data/src/index.ts
/usr/bin/git commit -m "feat(app): survivors are named from the screened table, in order, by a counter on the ledger" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The name and the service record on the card and the deploy panel

**Files:**
- Modify: `packages/app/src/ui/hud.ts` (`HudDeps` ~124, `cardHtml` ~1072–1150)
- Modify: `packages/app/src/ui/loading.ts` (`BroughtPanel`, `broughtFor`, the panel render ~261–271)
- Modify: `packages/app/src/main.ts` (HUD deps; the `broughtFor` call)
- Test: `packages/app/src/ui/hud.test.ts`, `packages/app/src/ui/loading.test.ts`

**Interfaces:**
- Consumes: `rosterEntryOf` (Task 1), names on roster entries (Task 5).
- Produces: `HudDeps.rosterEntryOf?: (id: number) => LedgerRosterEntry | undefined`; the card shows `<span class="rl-card__callsign">Sela</span>` before the type name and a record line `<div class="rl-card__record rl-dim">3 missions · 4 kills</div>` when the entry has a record; `BroughtPanel.roster[i].names: string[]` rendered as ` (Sela, Barzel)` after the stripes.

- [ ] **Step 1: Write the failing tests**

In `hud.test.ts`, near the card tests (grep `cardHtml` or `.rl-card__name`):

```ts
  it('names a unit drawn from the roster and shows its service record on the card', () => {
    const r = rig(mission(), {
      rosterEntryOf: (id) => (id === r.ids[0] ? { type: 'inf_squad', veterancy: 2, name: 'Sela', missions: 3, kills: 4 } : undefined),
    });
    r.select([r.ids[0]]);
    const card = r.host.querySelector('.rl-card')!;
    expect(card.querySelector('.rl-card__callsign')?.textContent).toBe('Sela');
    expect(card.querySelector('.rl-card__record')?.textContent).toBe('3 missions · 4 kills');
  });

  it('a fresh unit has no callsign and no record line', () => {
    const r = rig(mission(), { rosterEntryOf: () => undefined });
    r.select([r.ids[0]]);
    const card = r.host.querySelector('.rl-card')!;
    expect(card.querySelector('.rl-card__callsign')).toBeNull();
    expect(card.querySelector('.rl-card__record')).toBeNull();
  });
```

Adapt to the rig's real selection helper (grep how existing card tests select a single unit; `r.select` may be `r.setSelection` or a `deps.getSelection` override). In `loading.test.ts`, extend the `'groups the roster by type…'` test's ledger with names and assert `b.roster[0].names` equals `['Sela', 'Barzel']` and the rendered panel text contains `Rifle Squad ×2 ★★ (Sela, Barzel)`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/app/src/ui/hud.test.ts packages/app/src/ui/loading.test.ts`
Expected: FAIL — no `.rl-card__callsign`, no `names`.

- [ ] **Step 3: Implement**

`HudDeps`: add `rosterEntryOf?: (id: number) => LedgerRosterEntry | undefined;` (import the type from `@lions/sim`). In `cardHtml`, after `const vet = st.veterancy[id];`:

```ts
    const entry = this.deps.rosterEntryOf?.(id);
    const callsign = entry?.name ? `<span class="rl-card__callsign">${escapeHtml(entry.name)}</span> ` : '';
    const record =
      entry && (entry.missions !== undefined || entry.kills !== undefined)
        ? `<div class="rl-card__record rl-dim">${entry.missions ?? 0} mission${(entry.missions ?? 0) === 1 ? '' : 's'} · ${entry.kills ?? 0} kill${(entry.kills ?? 0) === 1 ? '' : 's'}</div>`
        : '';
```

and in the template put `callsign` immediately before `<span class="rl-card__name">` and `record` right after the `rl-card__top` div closes. Use the file's existing HTML escaper (grep `escapeHtml`/`escapeAttr`; add a text escaper beside `escapeAttr` if only the attribute one exists — a name is authored data but goes through the same path as every other string here).

`theme.css`, beside `.rl-card__name`: `.rl-card__callsign { color: var(--commend); font-weight: 600; }` and `.rl-card__record { font-size: var(--t-xs); }`.

`loading.ts`: `BroughtPanel.roster` items gain `names: string[]`; in `broughtFor`'s grouping push `e.name` when present; in the render, after the stripes span, append a text node ` (${r.names.join(', ')})` when `r.names.length > 0`.

`main.ts`: in the `Hud` construction add `rosterEntryOf: (id) => runtime?.rosterEntryOf(id)` (guarded on `runtime` being set; the deps object is built before the runtime in some paths — use a closure).

- [ ] **Step 4: Run the tests and gates**

Run: `npx vitest run packages/app && pnpm validate:ui && pnpm typecheck && pnpm lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/loading.ts packages/app/src/ui/loading.test.ts packages/app/src/ui/theme.css packages/app/src/main.ts
/usr/bin/git commit -m "feat(ui): the card carries the callsign and the service record; the deploy panel names who came" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The chevron

**Files:**
- Modify: `packages/render/src/three/units/overlays.ts` (a `ChevronBatch` after `NumeralBatch`, ~609–700; a `STRIPE_COLOR_KEY` beside `BADGE_TEXT_COLOR_KEY` ~121)
- Modify: `packages/render/src/three/ThreeRenderer.ts` (construct beside `numeralBatch` ~1593; add to the scene ~1652; dispose ~1889; `beginFrame`/`endFrame` beside the numeral's ~5111/5643; push in the per-entity overlay loop beside the badge ~5264)
- Test: `packages/render/src/three/ThreeRenderer.test.ts` (construction under node must still pass)

**Interfaces:**
- Consumes: `sim.state.veterancy[i]`, `billboardPoint`, `BADGE_NUMERAL_RENDER_ORDER`.
- Produces: `class ChevronBatch { constructor(entityCapacity: number, fillColorHex: string); beginFrame(); push(anchor, centerRightPx, centerUpPx, widthPx, heightPx, stripes: 1|2|3); endFrame(); dispose(); readonly mesh }` — one quad per living, visible, side-0 entity with `veterancy > 0`, UV-addressed into a 3-cell canvas atlas of one, two and three chevrons, at the top-RIGHT of the unit (the group badge is top-left), band 1.5, colour from the palette key `--commend` maps to.

- [ ] **Step 1: Find the palette key**

`grep -n "commend" packages/app/src/ui/theme.css` gives `--commend: var(--rl-dust-0)`; the palette key is therefore `dust.0` (confirm the spelling against `BADGE_TEXT_COLOR_KEY`'s `shadow.1` and `data/palette.json`). Add:

```ts
/** Palette key for the veterancy chevron -- the same swatch `theme.css`'s `--commend`
 *  maps to, so a stripe is one colour on the card, the board and the unit. */
export const STRIPE_COLOR_KEY = 'dust.0';
```

- [ ] **Step 2: Write the batch**

Copy `NumeralBatch`'s shape exactly (deferred canvas in `ensureTexture`, `DynamicDrawUsage` attributes, `depthTest: false`, `renderOrder = BADGE_NUMERAL_RENDER_ORDER`, `frustumCulled = false`) with a 3-cell atlas built by:

```ts
const CHEVRON_CELL_PX = 64;
const CHEVRON_CELLS = 3;

function buildChevronTexture(fillColorHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CHEVRON_CELL_PX * CHEVRON_CELLS;
  canvas.height = CHEVRON_CELL_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('overlays: 2D canvas context unavailable for chevrons');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = fillColorHex;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Cell n holds n chevrons stacked vertically, each a "^" 36 px wide and 14 px tall.
  for (let n = 1; n <= CHEVRON_CELLS; n++) {
    const cx = (n - 1) * CHEVRON_CELL_PX + CHEVRON_CELL_PX / 2;
    const total = n * 16;
    const top = CHEVRON_CELL_PX / 2 - total / 2;
    for (let k = 0; k < n; k++) {
      const y = top + k * 16 + 14;
      ctx.beginPath();
      ctx.moveTo(cx - 18, y);
      ctx.lineTo(cx, y - 14);
      ctx.lineTo(cx + 18, y);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
```

`push(anchor, centerRightPx, centerUpPx, widthPx, heightPx, stripes)` mirrors `NumeralBatch.push` with `stripes` outside `1..3` skipped and the UV `u` range `[(stripes - 1) / 3, stripes / 3]`.

- [ ] **Step 3: Draw it**

In `ThreeRenderer`: `this.chevronBatch = new ChevronBatch(sim.capacity, opts.resolveColor ? opts.resolveColor(STRIPE_COLOR_KEY) : '#E8C33A')` beside the numeral batch; add its mesh to the scene with the others; `beginFrame`/`endFrame`/`dispose` beside the numeral's. In the per-entity overlay loop, right after the control-group badge block:

```ts
      // Veterancy chevron (spec §4.7): top-right, opposite the group badge, one quad
      // from a three-cell atlas. Reads the sim's own stripe count; the card and the
      // board show the same number in the same colour.
      const stripes = st.veterancy[i];
      if (st.side[i] === 0 && stripes > 0) {
        this.chevronBatch.push(billboardPoint(anchor, r + 4, r + 4), 0, 0, 12, 12, stripes);
      }
```

(`st`, `anchor`, `r` are the loop's own; check the visibility/fog guard the badge push sits under and keep the chevron under the same one.)

- [ ] **Step 4: Run the render suite, the whole suite and look at it**

Run: `npx vitest run packages/render && pnpm test && pnpm typecheck && pnpm lint`
Expected: pass; `ThreeRenderer.test.ts` constructs under node without touching `document` (the canvas is deferred). Then build this worktree (`vite build` into a temp outDir) and, with a ledger holding a two-stripe squad (seed it in the console: `localStorage.setItem('lions.campaign.ledger', JSON.stringify({ 'roster.surviving_units': [{ type: 'inf_squad', veterancy: 2, name: 'Sela', missions: 1, kills: 1 }] }))`), load `?mission=beit_sahwan_2_foothold`, deploy, and confirm the squad drawn from the ledger shows two chevrons top-right in the commend colour and its card reads `Sela` with `1 mission · 1 kill`. Screenshot for the PR. The visual gate's scenarios spawn no veterans, so no capture moves; say so.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three/units/overlays.ts packages/render/src/three/ThreeRenderer.ts
/usr/bin/git commit -m "feat(render): the veterancy chevron, band 1.5, three only" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
pnpm test && pnpm lint && pnpm typecheck && pnpm validate:data && pnpm validate:ui && pnpm playtest && pnpm test:determinism
```

Expected: every gate green; the golden hash unmoved; the harness exit 0 with its roster deltas already recorded in Tasks 1 and 3.

---

## After the plan

- Step 3 ("Earn": `unlock.stars_min`, the brigade screen, `upgrades_to`, the three special units) is the next plan; it fits its star gates to the totals `pnpm playtest` now prints.
- Two content findings from step 1 still stand for `playtest`/`mission-author`: Beit Sahwan IV's plan collapses when III's intel carries into it, and five recon plans do not complete their carrying secondaries.
