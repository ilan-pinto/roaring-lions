# Net · Per-Seat Kit ("bring your brigade") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a friends' versus room each seat can field its OWN kit. The host
turns on "bring your brigade". Each KDF seat then plays with the tiers it owns.
The sim, the 3D hulls, the HUD card and the unit icons all show that seat's
kit, and both machines build byte-identical worlds from the shared
`MatchConfig`. A `matched` room, and single-player, stay exactly as they are
today.

**Architecture:** No sim code (ruling L2, confirmed by N2-P5,
`packages/app/src/net/per-seat-types.test.ts`). Five layers change:
- **The world.** `buildMatchWorld` registers the roster patched with side 0's
  tiers, as today. Then, ONLY for a KDF type whose effective side-1 tiers
  differ from side 0's, it appends a second copy patched with side 1's tiers.
  The copy keeps the base id. Each side spawns through its own id → type-index
  map.
- **Kit tables.** `unitKitTiers`, `kitByType` and `unitKit` come from one
  `upgradePrepass` per side. The HUD reads the viewer's own side; the renderer
  gets both.
- **Render.** Vehicle templates are keyed by `(id, side)`. A side whose tiers
  match side 0's shares side 0's template, so a matched room loads nothing new.
- **Config.** `SeatConfig.tiers` becomes the account's own nested shape.
- **Worker.** The room stores each seat's claim at create and join. It cleans
  the claim against a pinned table of tracks and tier counts, and mints the
  claim into the config only for a `brigade` room and a KDF seat.

**Spec:** `docs/superpowers/specs/2026-10-10-network-game-design.md`. Read
decisions 5 and 22, §2.1, §7.1 (the per-seat types note and its three
follow-ups), §11b.2 ("Per-seat unit types"), and the "Bring your brigade
trusts the client" risk. Also read the N2-prereqs plan,
`docs/superpowers/plans/2026-10-15-net-n2-prereqs.md`, rows L2 and P5.
Stacks on `feat/net-n2-prereqs` (PR #644).

## Global Constraints

- **No file under `packages/sim/` changes.** `pnpm test:determinism` stays
  green with every pin unmoved.
- **These pins must not move.**
  - `versus-force.test.ts`: 580559085 (beit), 1260439781 (tel).
  - `match-world.test.ts`: beit 3043363756, tel 1260439781.
  - `per-seat-types.test.ts`: its control, 580559085.
  - A `kit: 'matched'` room, and a `brigade` room whose seats hold equal (or
    empty) tiers, must register exactly today's type list and hash exactly
    today's bytes.
- **The world comes from the config alone.** No room path reads
  `accountState()` or `bootTiers` to build the world or the kit tables. The
  local account goes into the create/join body and nowhere else. A tier one
  machine read locally is a desync at the first shot.
- **Single-player is unchanged.** `bootTiers`, `&kit` and the mission path
  keep the one prepass they use today.
- **Dependency direction.** `render` never imports `net`. The renderer gets
  plain tables. The Worker imports `@lions/net`, never `@lions/data` at
  runtime. Its tier table is a plain list pinned to the data by a test, the
  same way `map-ids.ts` works.
- **Every new check ships with its falsification** in the commit message
  (CLAUDE.md, "Every check gets an input that makes it fail").
- **Git hygiene.** Commit with `git commit -- <paths>`. Never kill a dev
  server. Do not run `pnpm ui:routes` locally; CI runs it.

## Lead decisions (recommendation first)

1. **Lead decision needed: how the board prices a kitted unit.**
   **Recommendation: at base cost, for this version.** The spike proves that
   `forcesOf` and `scoreOf` price a patched copy at its base id's cost with no
   mapping. Decision 24 settles a stalemate, and the 25-minute cap, by
   surviving value. So a brigade seat fields stronger units that are worth the
   same on that count. The alternative needs a second price table, kit cost
   per tier, kept equal on both machines. The toggle is friends-only and
   labelled, so take the simple rule now and revisit with N3's economy.
2. **Lead decision needed: the wire shape of `SeatConfig.tiers`.**
   **Recommendation: change it to nested,
   `Record<typeId, Record<track, number>>`.** That is the account's
   `ownedTiers` shape and the shape `upgradePrepass` takes. Today it is
   declared flat (`Record<string, number>`) and always minted `{}`, so nothing
   on the wire changes for a matched room. The build check already refuses a
   mixed-version pair. The alternative is flat `"typeId.track"` keys: it leaves
   the type alone, but it is a format every reader has to split.
3. **Trust posture: structural checks only (decision 22).** The room cannot
   check a claim against an account, because there is no server ledger until
   ST6. It refuses what is malformed or impossible: an unknown type, a
   non-KDF type, an unknown track, a tier outside 0..max, oversize input. It
   records the claim as stated. The lobby shows "friends only", and the toggle
   defaults off. **Recommendation: accept this as ruled**, since the spec risk
   already names it. No further lead call is needed unless the lead wants
   `brigade` held back until ST6.
4. **`unlocks` stays `[]`.** A versus force is a fixed set of placements with
   no production until N3, so an unlock cannot field anything yet. Carrying it
   now would be a claim nothing reads. *Not a lead call. Recorded so N3 picks
   it up.*

## Tasks

### Task 1: `SeatConfig.tiers` nested, validated, and one resolver

**Files:**
- Modify: `packages/net/src/config.ts`
- Test: `packages/net/src/config.test.ts`

**Interfaces:**
- `SeatConfig.tiers: Record<string, Record<string, number>>`.
- `isSeatConfig` checks the nested shape. Every leaf must be a non-negative
  integer.

- [ ] Failing tests:
  - `validateConfig` accepts a seat with `tiers: { mbt_lavi: { armour: 2 } }`.
  - It returns `null` for `tiers: { mbt_lavi: 2 }`.
  - It returns `null` for `{ mbt_lavi: { armour: 1.5 } }`.
  - It returns `null` for `{ mbt_lavi: { armour: -1 } }`.
  - It still accepts `tiers: {}`. Every existing config fixture must stay
    green unchanged.
- [ ] **Falsify:** drop the inner `isInt` check, and the `1.5` case goes green
  (it should not). Put it back.
- [ ] Commit: `net: SeatConfig.tiers takes the account's per-type shape`.

### Task 2: The Worker cleans and mints each seat's claim

**Files:**
- Create: `packages/worker/src/match/kit-tracks.ts`, a plain table
  `KIT_TRACKS: Record<typeId, Record<track, maxTier>>` for every KDF type (19
  at HEAD).
- Create: `packages/worker/src/match/kit-tracks.test.ts`, which pins the table
  to `@lions/data`'s `units`/`maxTiers` both ways, like `map-ids.test.ts`.
- Modify: `room-fields.ts`, which gains `kitField` and `seatTiersField`.
- Modify: `routes.ts`. The create body takes `kit` and `tiers`; the join body
  takes `tiers`.
- Modify: `match-room.ts`. The room stores `kit` in its meta and
  `claims[seat]`. `mintConfig` fills the claims in.
- Tests: `room-fields.test.ts` (new), `routes.test.ts`, `match-room.test.ts`.

**Interfaces:**
- `kitField(v): 'matched' | 'brigade'` returns `'brigade'` only for exactly
  that string.
- `seatTiersField(v)` builds its result with `Object.create(null)` and reads
  own keys only. It drops any id that is not in `KIT_TRACKS` and any track that
  id does not declare. It truncates each tier and clamps it to
  `[0, KIT_TRACKS[id][track]]`. It drops any entry that ends up 0. It reads at
  most `Object.keys(KIT_TRACKS).length` ids, so its output is bounded by
  construction.
- `mintConfig` gives every seat `kit: meta.kit`. A seat's `tiers` are
  `claims[seat]` only when `meta.kit === 'brigade'` AND the seat's faction is
  `'kdf'`. Otherwise they are `{}`. A sandbox room is always `matched`.

- [ ] Failing tests (literal expectations):
  - `seatTiersField({ mbt_lavi: { armour: 99, warp: 1 }, __proto__: { x: 1 }, sarim_rifles: { armour: 1 } })`
    returns `{ mbt_lavi: { armour: <KIT_TRACKS.mbt_lavi.armour as a literal> } }`.
  - `seatTiersField('x')` returns `{}`.
  - A room created `kit: 'matched'` with tiers in both bodies mints
    `tiers: {}` on both seats.
  - A room created `kit: 'brigade'` mints each seat's own cleaned claim.
  - A Sarim seat in a `brigade` room mints `{}`.
  - `validateConfig(minted)` is non-null in every case.
- [ ] **Falsify:** two separate mutations, each run red:
  - remove the clamp, and `armour: 99` is minted;
  - mint `claims[seat]` without checking `kit`, and the matched room carries
    tiers.
- [ ] Commit: `worker: a room records each seat's kit claim, cleaned against the shipped tracks`.

### Task 3: `buildMatchWorld` registers per-seat types

**Files:**
- Modify: `packages/app/src/net/match-world.ts`
- Modify: `packages/app/src/net/versus-force.ts`. `versusSpawns` takes
  `typeOf: Map | readonly [Map, Map]`; a single map serves both sides, as
  today, so `tools/src/backtest/versus-probe.ts` keeps compiling.
- Test: `packages/app/src/net/match-world.test.ts`

**Interfaces:**
```ts
export interface MatchWorld {
  /* ...as today, plus: */
  typeOfBySide: readonly [Map<string, number>, Map<string, number>]; // typeOf === typeOfBySide[0]
  kitBySide: readonly [UpgradePrepass<RosterUnit>, UpgradePrepass<RosterUnit>];
}
```
- Side 0 registers `upgradePrepass(roster, seats[side0].tiers).registered`,
  as today.
- Side 1's prepass is computed over the same roster. A KDF type is appended
  only when `effectiveKitTiers` differs between the two sides for that id,
  compared on key-sorted entries. The append order is the roster's.
- Seats are looked up by `side`, never by seat index.

- [ ] Failing tests:
  - A config with side 1 `{ mbt_lavi: { armour: 1 } }` and side 0 `{}`:
    - `sim.unitTypes.length` equals the matched length plus 1 (record both as
      literals).
    - Side 1's Lavis' `hp` equals the base Lavi's `hull.hp` plus the tier-1
      delta, as literal numbers.
    - Side 0's Lavis read the base.
    - Two builds hash equal after 200 ticks.
  - Swap the tiers to side 0: the world hashes differently from the original
    and builds deterministically.
- [ ] **Falsify:** spawn side 1 through `typeOfBySide[0]`, and the hp
  assertion goes red.
- [ ] Commit: `app(net): each side of a versus room registers and spawns its own kit`.

### Task 4: Matched kit, empty tiers — byte-identical world and pins

**Files:**
- Test only: `packages/app/src/net/match-world.test.ts` and
  `packages/app/src/net/per-seat-types.test.ts`.

- [ ] Tests (literals, no imports from the code under test):
  - **`kit: 'matched'`, `tiers: {}`.** After 200 ticks the world hashes
    `3043363756` (beit) and `1260439781` (tel).
  - **The same config with `kit: 'brigade'`.**
    - With empty tiers on both seats: the same two hashes.
    - With EQUAL non-empty tiers on both seats: `sim.unitTypes.length` equals
      the matched literal, and both sides spawn the same type indices.
  - **`sim.unitTypes.length`** equals the matched literal in all three cases.
    This catches registered-but-unused copies, which move no hash (the spike's
    note).
  - **`per-seat-types.test.ts`:** add a case that builds through
    `buildMatchWorld` with side 1's kit. It must show the spike's result on the
    real builder: fate differs from the matched run, and `scoreOf` values stay
    at base cost (6664 per side at tick 0).
- [ ] **Falsify:** two separate mutations, each run red:
  - always append side 1's copies: the length literal goes red, while the
    hash stays green, which is exactly why the length assertion exists;
  - always spawn side 1 through its copies: the hash goes red.
- [ ] Run `pnpm test:determinism`; it must stay green with no pin edited.
- [ ] Commit: `app(net): pin that a matched room builds today's bytes`.

### Task 5: `main.ts` reads the room's kit from the world, per viewer

**Files:**
- Modify: `packages/app/src/main.ts`, the versus branch and the HUD/renderer
  wiring only.
- Create: `packages/app/src/net/room-kit.ts`
- Test: `packages/app/src/net/room-kit.test.ts`

**Interfaces:**
```ts
/** The tables a seat's screen draws, from the world alone. */
export function roomKitTables(world: MatchWorld, me: 0 | 1): {
  kitByType: Map<string, KitSummary>;            // the viewer's side
  unitKit: Readonly<Record<string, KitLevel>>;   // the viewer's side
  unitKitTiersBySide: readonly [KitTiers, KitTiers];
};
```
- In a versus room, `kitOf`, `kitLevelOf` and the renderer options come from
  `roomKitTables(versusWorld, me)`. The account-read `prepass` stays the
  source for single-player and the sandbox room, which is unchanged. A HUD
  card is drawn only for an own unit (`hud.ts` ~L2340), so the viewer's side
  is the correct source.

- [ ] Failing tests:
  - With side 1 kitted `{ mbt_lavi: { armour: 2 } }`:
    - `roomKitTables(w, 1).unitKit.mbt_lavi` equals `2`.
    - `roomKitTables(w, 0).unitKit.mbt_lavi` equals `0`.
    - `unitKitTiersBySide[1].mbt_lavi` deep-equals `{ armour: 2 }`.
  - A matched world gives `{}` for every KDF id on both sides.
- [ ] **Falsify:** return side 0's tables for `me = 1`, and the first
  assertion goes red.
- [ ] Commit: `app: a versus seat draws its own kit, read from the room's world`.

### Task 6: Render — vehicle templates per side

**Files:**
- Modify: `packages/render/src/api.ts`. Add
  `unitKitTiersBySide?: readonly [KitTiers, KitTiers]`. `unitKitTiers` stays
  for single-player and is read as side 0's.
- Modify: `packages/render/src/three/ThreeRenderer.ts`:
  - `loadVehicleMesh` (~L6104) builds a second template only for an id whose
    side-1 tiers differ;
  - the template lookups at ~L5325, ~L6281, ~L7590 and ~L7949, and
    `vehicleScars`, go through `templateKey`.
- Create: `packages/render/src/three/units/kit-template-key.ts`, pure and
  three-free, with a test.

**Interfaces:**
`templateKey(id, side, bySide)` returns `id` when side 0, or when side 1's
tiers for `id` equal side 0's. Otherwise it returns `` `${id}#s1` ``.

- [ ] Failing tests:
  - `templateKey('mbt_lavi', 1, [{}, { mbt_lavi: { armour: 1 } }])` returns
    `'mbt_lavi#s1'`.
  - With equal tables, it returns `'mbt_lavi'`.
  - Absent `bySide` returns `'mbt_lavi'`.
- [ ] **Falsify:** ignore `side`, and the first case reads `'mbt_lavi'`.
- [ ] Rendering needs no further test (CLAUDE.md). Two checks instead:
  - **Golden gate:** `kitted` and the other scenarios are single-player, so
    they must not move. CI's `visual` job confirms it.
  - **Picture:** photograph a kitted side-1 Lavi beside a plain side-0 Lavi in
    a two-browser local room for the PR.
- [ ] Commit: `render: a vehicle template per side when the two seats' kit differs`.

### Task 7: The lobby toggle, the claim on the wire, and the docs as built

**Files:**
- Modify: `packages/app/src/net/connect.ts`. The create body sends `kit`; the
  create and join bodies send `tiers` from `accountState().ownedTiers`, its
  only read in a room.
- Modify: `packages/app/src/ui/versus.ts`. Add a host-only "Bring your
  brigade" toggle, default off, labelled friends-only through `t()`. The room
  screen shows the kit mode. Add the keys to `en.json`.
- Modify the docs: §7.1 and §11b.2 of the spec, and the L2/P5 rows of the
  N2-prereqs plan, record what was built.

- [ ] Failing tests: `connect.test.ts`:
  - the create body carries `kit: 'brigade'` and the account's tiers when the
    toggle is on;
  - it carries `kit: 'matched'` when the toggle is off;
  - the join body carries the guest's tiers.

  `versus.test.ts`: the toggle exists only on the host's create form.
- [ ] Run `pnpm validate:ui` (catalogue).
- [ ] **Falsify:** drop `kit` from the create body, and the brigade assertion
  goes red.
- [ ] Commit: `app(versus): bring your brigade, a host toggle for friends' rooms`.

## Risks

- **Unused copies move no hash.** Only the type-count literal (Task 4) catches
  a world that registers more than it needs. Keep that assertion.
- **Two templates for one GLB double the parse cost** of each differing
  vehicle on a brigade room's boot. That is bounded to KDF vehicles with
  differing tiers (at most 8). Measure with `pnpm perf:load` if it shows.
- **Base-cost pricing** (decision 1) lets a brigade seat win a decision-24
  value tiebreak with stronger units at equal value. Recorded, not fixed.
- **Client-trusted claims** (decision 22). The Worker refuses the impossible,
  not the unowned. Never offer `brigade` outside a friends' room.
