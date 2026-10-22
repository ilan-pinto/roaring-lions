# Versus tunnels: the Sarim seat goes underground (GH-681)

Docs only. This is the design. The plan follows once the lead has answered §9.

**Read against:** `origin/main` `5e5980c3` (22 Oct). Line numbers are hints; locate code by symbol.

**Inputs:**
- GH-681 (the lead, 15 Oct): "the Sarim player should have the advantage of using tunnels".
- `plans/2026-10-16-net-n3-prep.md` §6, which sketched this package and recorded the lead's four
  rulings of 15 Oct (T-R1 to T-R4 below).
- Spec `2026-10-10-network-game-design.md`: §6, §7.1, §11b.4 and §11c.8.
- The single-player tunnel design, `2026-08-18-tunnel-subsystem-design.md`.
- PR GH-684 (`yahalom_squad` on the KDF doctrine menu, not in the placed force) and PR GH-725
  (measured versus seats).

**Rulings already made (15 Oct, the lead).** This spec builds on them and does not reopen them.
- **T-R1.** Travel takes time, scaled by route length.
- **T-R2.** Fighters vent only on the player's order. "Stay down" is the default.
- **T-R3.** `yahalom_squad` joins the versus KDF menu. That landed in GH-684, on the menu only.
- **T-R4.** `enterTunnel` is Sarim-seat only. The KDF seat's tunnel verb stays `chargeTunnel`.

## 1. Where things stand

- **The sim's tunnel subsystem is complete for scripted play.** It has:
  - authored routes (`Sim.addTunnel`: mouth first, vent last, optionally `pre_dug`);
  - live digging (`assignDigger`, `stepDigging`) that leaves spoil;
  - burial (`putInTunnel`), automatic surfacing at the vent (`stepSurfacing`, only when
    `hasTargetFrom` finds a target), a guaranteed exposure window (`SURFACE_SECONDS` 3, `SURFACE_VOLLEY`
    2) and `submerge` back down;
  - per-side route contact (`tunnelContactLevel`: 0 none, 1 suspected, 2 identified, driven by spoil
    and `mark_tunnel` sight);
  - the Yahalom collapse (`chargeTunnel`, `collapseTunnel`), which kills everyone below.
- **What a player cannot do.** No `Command` puts a unit into a route.
  - Every way in is authored: an `in_tunnel` placement, a `digs` placement, or `submerge`.
  - `applyCommands` strips buried ids from every command (the containment rule, ~L3382).
  - Travel from mouth to vent costs no time. `tunnel_travel` is unit data that nothing reads.
- **Versus already registers map routes.** `buildMatchWorld` adds `map.tunnels`
  (`match-world.ts` ~L62).
  - Of the four open maps, only `beit_sahwan_outskirts` carries routes (four, a mirror-only map). They
    are inert, because nothing enters or digs in a room.
  - `tel_marum` and `wadi_tarfan`, the two KDF-v-Sarim maps (`FACTION_MATCHUP_MAPS`), carry none.
- **The KDF answer is partly fielded.**
  - `VERSUS_KDF` places one `recon_drone`, which carries `mark_tunnel`.
  - `yahalom_squad` (`mark_tunnel` + `tunnel_charge`) is on the doctrine menu but **not placed**.
    GH-684 measured that placing one breaks the mirror's 60/40 bar on three open maps. So until N3's
    production lands, the KDF seat can find a route but cannot close one.
- **No Sarim versus unit carries `tunnel_travel`.** The flag sits on single-player enemy units
  (`militia_cell`, `rpg_team`, `mortar_crew`, `digger_crew`).
- **N3 is not built.** A room still runs no `MissionRuntime`, has no rules file, and drops `build` in
  `validateCommand`. This matters for sequencing (§8).

## 2. The Sarim seat's orders

Three things the player does: send foot units into a route, wait while they travel, and bring them up.

### 2.1 Enter (`enterTunnel`)

- **Who may enter:** a living, unrouted, ground unit that is not `mobility.wheeled`.
  - That is the existing vehicle predicate (the boulder rule's), so no new list is added.
  - From the Sarim doctrine menu, that admits `sarim_rifles`, `atgm_cell`, `manpad_team` and
    `recoilless_team`. It refuses `gun_truck` and `rocket_battery`.
  - A garrisoned unit leaves its building first, as `chargeTunnel` does. A carried unit is refused.
- **Which route:** only a route **owned by the unit's side** (§4.1), alive, with its vent open.
  - A map-file route has no owner, so nobody enters it. This is what keeps Beit Sahwan's four routes
    inert in the mirror.
- **Which end:** the mouth, or the vent.
  - At the **mouth**, the unit starts the trip (§2.2).
  - At the **vent**, it goes straight to ground, with no trip. This is how a unit that came up on
    `exit` (§2.3) goes back down.
  - The unit walks to whichever end is nearer. The order is latched like `garrisonGoal`: one new
    per-unit column, `tunnelGoal` (route index, -1 none). It also stores which end, as the sign:
    `r` for the mouth, `-(r + 2)` for the vent.
- **Reach:** within one tile of the end's tile centre, the same snap `garrison` uses at a door.
  - If the end is blocked, the goal moves to the nearest open tile (`nearestOpenTile`, as
    `chargeTunnel` does).
  - On arrival, `putInTunnel` runs, which already clears the whole order bundle.
- **A later order cancels it.** Any surface order naming the unit clears `tunnelGoal`.

### 2.2 Travel (T-R1)

- **One per-unit countdown column, `tunnelEta`** (ticks until the unit reaches the vent; 0 means it
  is at the vent).
  - Set on entry at the mouth: `ceil(tnLength / (TUNNEL_TILES_PER_S * DT))`, computed in Q16.16.
  - Set to 0 on entry at the vent.
  - Decremented in `stepSurfacing`'s loop for every buried unit with `tunnelEta > 0`.
- **One crawl speed for everyone, `TUNNEL_TILES_PER_S`, in `tuning.ts`.** Proposed: **0.5 tiles/s.**
  - A shaft is a crawl, so the unit's own surface speed does not apply. A fixed speed also lets the
    HUD print one honest time per route.
  - At 0.5, the §5 strawman routes take 26 to 41 s. A rifleman (0.9 tiles/s) walks the same ground
    in 15 to 23 s. The tunnel is **slower but unseen**, which is the trade.
- **Travel is one way, mouth to vent.** No order sends a buried unit back toward the mouth (Q5).
- **Capacity.** `tnOccupants` already counts who is below. Proposed: a route holds at most
  `capacity` units, authored per route, default **4** (Q4). An `enterTunnel` past capacity is
  refused at arrival: the unit stops at the mouth and the HUD says why.

### 2.3 Vent (`vent`) (T-R2)

- **Nothing on a human-held side surfaces by itself.** `stepSurfacing`'s automatic path
  (`hasTargetFrom`) is skipped when `isHumanHeld(side[i])`.
  - The table already exists (`Sim.isHumanHeld`, fed by `seatRules`). A versus room holds both
    sides; single-player holds side 0 only, so the authored enemy surfaces exactly as today.
- **`vent{ids, mode}`** brings arrived units up at the vent, whether or not a target is in sight.
  It has two modes:
  - **`raid`**: today's pop-up. The unit gets the exposure window and the volley, then `submerge`
    takes it back down. One rule changes: an ordered raid with **no target** ends when the window
    ends. Today the window holds until the volley is spent, and with no target that would strand
    the unit on the surface forever.
  - **`exit`**: the unit comes up for good. `homeTunnel` is cleared, so it is an ordinary surface
    unit. It can go back down later with `enterTunnel` at the vent (§2.1).
- **A unit still travelling cannot vent.** The order is refused for it (Q6 asks whether to latch it
  instead). The HUD shows its arrival time.
- **A raid ends when the player gives an order.** Any surface order naming a raiding unit
  (`homeTunnel >= 0`) converts it to `exit`.
  - Today, a surfaced fighter takes orders, and `submerge` then teleports it back below from
    wherever it walked. In single-player nobody gives that order. In versus it would be a teleport.
  - This is the same rule as N3's patrol rule (V6): a later order from the seat drops the automatic
    behaviour.
- **The containment rule gains one named exception.** `applyCommands` strips buried ids from every
  command before any branch sees them. `vent` is the one command that addresses buried units, so it
  is exempted by kind, in the same block, with the reason in a comment. Every other kind stays
  contained.

### 2.4 Digging: out

- **Versus works on authored, `pre_dug` routes only.** This follows the prep note (§6.2) and keeps
  the balance surface to "where the routes are".
- A player-chosen `dig` stays in the insurgent toolkit (network spec §6.3) (Q7).

## 3. Command shapes, whitelist and ownership

### 3.1 The two new kinds

```ts
| { kind: 'enterTunnel'; ids: number[]; tunnel: number }
| { kind: 'vent'; ids: number[]; mode: 'raid' | 'exit' }
```

- `vent` names no route, because each buried unit is already in exactly one.
- Both are additive. A `Sim` that never receives them behaves byte-for-byte as today.

### 3.2 The GH-644 whitelist (`packages/net/src/protocol.ts`)

- **`COMMAND_KINDS`** gains both names. GH-644's two-way compile pin then forces the rest:
  - **`cleanCommand`:**
    - `enterTunnel` → `ids` (`cleanIds`) and an integer `tunnel`;
    - `vent` → `ids` and `mode` exactly `'raid'` or `'exit'`;
    - anything else is null, and unknown keys are stripped.
  - The `never` default makes `tsc` name a kind the switch forgot.
- **`describeCommand`** gains a line for each, with `en.json` keys.
- **`ORDER_VERBS`** gains `enterTunnel` and `vent` for an MCP seat, under the existing scope rules,
  with an `unknown verb` test. The model verb itself is an N4 follow-up (§11c.8 lists both names as
  reserved).

### 3.3 Ownership (`packages/net/src/ownership.ts`, `validateCommand`)

`SeatWorld` gains two reads, both answered from data both machines share:
- `factionOfSeat(seat)`, from the match config;
- `tunnelOwner(r)`, from the sim's load-time route owner (§4.1). It is -1 for a map-file route.

The rules:
- **`enterTunnel`:** all `ids` are the seat's own, and `world.tunnelExists(tunnel)`, and
  `factionOfSeat(seat) === 'sarim'` (T-R4), and `tunnelOwner(tunnel) === sideOfSeat(seat)`.
- **`vent`:** all `ids` are the seat's own, and the seat is Sarim.
  - Strictly, a KDF seat can never have a buried unit. The faction check keeps the rule symmetrical,
    so a reader does not have to prove that.
- **Not gated on `versus`.** These are not runtime-priced orders, unlike `build` and `support`.
  - The sim refuses them on its own terms as well (ownership, wheeled, capacity, vent open), so a
    single-player or sandbox path cannot misuse them either.
  - The net check exists so that a tampered order vanishes identically on both machines **before**
    it reaches the queue (spec §3.3).

### 3.4 Determinism and the hash

- **New hashed state:**
  - `tunnelGoal` and `tunnelEta`: two per-unit `Int32Array` columns;
  - `tnOwner`: load-time and immutable, so it is not hashed, like `tnLength`.
- **Recommended: fold the two columns behind a live flag, `tnOrderLive`.** It is set the first time
  an `enterTunnel` is accepted. This is the `mobLive` / `fwLive` pattern (GH-706, D1).
  - A world that never receives the order keeps its digest, so **no sim pin moves**: not
    determinism, the versus mirror, match-world or per-seat-types.
  - The prep note expected "a named hash-layout pin move". This live gate avoids that move (Q8).
- **The humanHeld gate on surfacing moves no pin.** Single-player sides are not human-held, and no
  versus world today has a buried unit.
- **`net:engines`** runs once on a map with a route (Chromium, Firefox and WebKit).
- **The witness is a two-client test** (`tools/src/net/two-client.test.ts`'s shape). Two clients
  replay an `enterTunnel` → arrive → `vent raid` → `vent exit` → `enterTunnel` (vent end) frame
  stream on a route, and the hashes must be equal at every tick.

## 4. What the two seats see

### 4.1 Route ownership

- **`TunnelRouteJson` gains an optional `side`, and the sim stores it as `tnOwner[r]`.** It is -1
  when absent, which is every map-file route.
- The owner is a sim fact because the sim refuses `enterTunnel` on a route that is not the unit's
  side's. It is never derived from where the mouth happens to sit.

### 4.2 The Sarim client

- **It sees its own routes in full, always.** The renderer and minimap read
  `tunnelContactLevel(viewer, r)`. For a route whose owner is the viewer, they read 2 instead: the
  bore, the mouth and the vent are all drawn. This is a presentation read in one helper
  (`routeLevelFor(viewer, r)`), used by every caller.
- **Its buried units show as chips**, in a "Below ground" strip. Each chip shows the route's name
  and the arrival time, and selecting it offers `Vent: raid` and `Vent: exit`.
- **Entering:**
  - Right-clicking an own mouth or vent with foot units selected issues `enterTunnel`.
  - The cursor (`cursorKey`) reads `tunnel-enter`, or `blocked` when nobody selected can enter.
  - A wheeled unit in a mixed selection attack-moves to the tile instead, as the `attack` order
    already does for a unit that cannot focus.
- **Text:** every new string goes through `t()`.

### 4.3 The KDF client: a buried enemy gives nothing away

- **The fog audit**, under `viewerSide`, before anything ships:
  - unit draw: `engines.ts` already skips `tunnelIn >= 0`;
  - picking: `pick.ts`, the same;
  - the minimap's unit dots, already skipped;
  - **the x-ray occupant draw (`xrayFrame`)**. It collects every buried unit on every route, so it
    must keep only the routes the viewer has identified (level 2). It is the one read found so far
    that is not filtered per viewer;
  - HUD target reads, `intel-moments`, `hold-outside`;
  - the `surfaced` / `submerged` events, which must reach the KDF presentation only when the vent
    tile is in its sight.
- **The witness:** a test boots a KDF-viewer renderer over a world with a Sarim unit buried on an
  unidentified route, and requires zero draws, zero x-ray occupants and zero minimap marks. It is
  falsified by deleting the x-ray filter.

## 5. The KDF's counters

All three exist. None of them is new mechanics.

- **Find the route.** `mark_tunnel` sight identifies a route: the placed `recon_drone`, and the
  `yahalom_squad` once it can be built. There is no spoil, because the routes are `pre_dug` (§2.4),
  so finding them is reconnaissance work. That is the asymmetry the lead asked for.
- **Close it.** `chargeTunnel` by a `yahalom_squad` on an identified route collapses it, and
  everyone below dies.
  - T-R3 put the squad on the menu. It reaches the field only through N3's production.
  - **So this package lands after N3's production, or the KDF seat has no way to close a route.**
- **Punish the vent.** A raid gives a guaranteed window, and the vent never moves. Once a vent has
  been seen, it can be covered by fire. This is how single-player answers a vent.
- **What the KDF seat may not do:** enter Sarim routes (T-R4, and the sim's owner check), or see a
  buried unit on a route it has not identified (§4.3).

## 6. Which maps get routes

### 6.1 Where routes live

- **Not in `data/maps/*.json`.** `tel_marum` carries three single-player missions and the golden
  `relief` scenario. A route in its map file would move every mission and capture that reads it.
- **In N3's versus rules file** (LD2). Proposed shape: a `tunnels` block, one list per seat end.

  ```json
  "tunnels": {
    "friendly": [ { "id": "tm_s_west", "points": [[22,44],[14,38],[12,30]], "capacity": 4 } ],
    "hostile":  [ { "id": "tm_n_west", "points": [[26,10],[16,12],[14,22]], "capacity": 4 } ]
  }
  ```

  - `friendly` and `hostile` name the two anchors `versusAnchors` already returns (seat 0's and
    seat 1's start).
  - Routes are always `pre_dug`.
- **Only the Sarim seat's end is registered**, with `side` set to that seat's side. Both machines
  derive this from the shared config, so they agree.
  - A mirror room registers none.
  - A KDF-v-Sarim room registers the routes of whichever end Sarim starts on. The versus seats
    measured both spawn orders (GH-725), so both ends are authored.
- **They are registered after the map's own routes**, so a map-file route keeps its index.
- **`contentDigest` folds the rules file**, so two builds that disagree on a route are refused at
  the build check, not at a desync.

### 6.2 `validate:data` checks

Each check arrives with its falsification run.
- Each point is on the map. The mouth and vent are on passable, non-building tiles.
- The vent is at least **18 tiles** from the opposing anchor. That is a rule against venting onto a
  start, and the number is a proposal (Q3).
- At most `MAX_TUNNELS` (16) routes in total, map routes included.
- Every route has `capacity` 1 to 8.

### 6.3 The strawman routes

These are for the lead to approve, move or strike (Q2). Every point has been checked against the
map rows: the vents are on open ground. Lengths are in tiles.

| Map | End | Route | Points | Length | Vent to opposing anchor |
|---|---|---|---|---|---|
| `wadi_tarfan` | `versus_0` (10,10) | north | (12,12) → (18,14) → (24,17) | 13.0 | 23.9 |
| `wadi_tarfan` | `versus_0` | west | (12,12) → (15,19) → (19,26) | 15.7 | 21.1 |
| `wadi_tarfan` | `versus_1` (37,37) | south | (35,35) → (29,33) → (23,30) | 13.0 | 23.9 |
| `wadi_tarfan` | `versus_1` | east | (35,35) → (32,28) → (28,21) | 15.7 | 21.1 |
| `tel_marum` | north (28,16) | west | (26,10) → (16,12) → (14,22) | 20.4 | 26.0 |
| `tel_marum` | north | east | (30,10) → (36,14) → (36,24) | 17.2 | 25.1 |
| `tel_marum` | south (24,46) | west | (22,44) → (14,38) → (12,30) | 18.2 | 21.3 |
| `tel_marum` | south | east | (26,44) → (34,40) → (38,34) | 16.2 | 20.6 |

- **Wadi Tarfan** is point-symmetric, so each `versus_1` route is its `versus_0` twin rotated 180°.
  The two routes come out on either side of the centre ford: one by the near farm, one by the near
  bluff.
- **Tel Marum is not symmetric.** From the north, both routes pass **under the ridge wall** and come
  out in the basin either side of the saddle. That is the strongest use of a tunnel on this map:
  the saddle is the choke the KDF must take. From the south, the routes run up the open basin's two
  flanks.
  - The probe has to say whether that asymmetry is fair.
  - Q2 offers dropping Tel Marum's under-wall pair if it is not.

## 7. Fairness: the probe

**`pnpm versus:probe` gains a tunnel arm. It stays report-only, at the GH-561 bar: 48 seeds per
spawn order, both matchup maps, 60/40.**

### 7.1 Plans

The probe is attack-move only today. It needs:
- **Sarim "tunnel":**
  - at tick 0, the Sarim foot units (up to capacity) enter the nearer route; the rest attack-move as
    today;
  - each arrived unit waits for contact: a KDF unit within its weapon's range of the vent and in
    sight from it. Then it raids, and repeats;
  - an `exit` variant comes up for good once the KDF centroid passes the vent.
- **KDF "no answer":** today's attack-move.
- **KDF "answer":** the drone sweeps the midfield, and one `yahalom_squad`, added for the probe
  only, charges any route it identifies. This is the post-N3 picture; until N3 the squad is the
  probe's own addition, never the room's (GH-684).

### 7.2 Cells

Per map and spawn order:
1. tunnels off (today's table);
2. tunnels on, KDF without an answer;
3. tunnels on, KDF with the answer;
4. a **turtle** control: every Sarim foot unit stays below to the 25-minute cap. It measures Q9's
   exploit.

### 7.3 The bar (proposed, Q1)

- Cell 3 sits inside 60/40 in both spawn orders.
- Cell 2 shows a Sarim edge over cell 1, which means the advantage is real.
- Cell 4 must not win for Sarim.

### 7.4 Self-check

Exit 2, like the probe's existing controls. The tunnel arm must actually put units below and bring
them up: the probe counts `surfaced` events and refuses a table where cell 2 read zero.
- **Mutation:** make `enterTunnel` a no-op in the sim. Cell 2 then equals cell 1, and the
  self-check goes red.

### 7.5 Containment, per route

A test walks each authored route, with a unit buried on it. It requires that nothing reaches the
unit (fire, smoke, the field works' AO, a `move`) except the collapse. This mirrors the
single-player tunnel tests.

## 8. Sequencing

The work splits along N3's dependency.

| Step | What | Needs N3? | Reviewer |
|---|---|---|---|
| T1 | Sim: `tnOwner`, `enterTunnel`, `tunnelGoal` and `tunnelEta`, `vent` (raid and exit), the humanHeld surfacing gate, raid-ends-on-order, the containment exception, `TUNNEL_TILES_PER_S`, capacity, `tnOrderLive` | no | sim-guard |
| T2 | Net: `COMMAND_KINDS`, `cleanCommand`, `validateCommand` (faction, owner), `SeatWorld` reads, `describeCommand`, the two-client test | no | one |
| T3 | Data: the rules file's `tunnels` block, its schema, `validate:data`, registration in `buildMatchWorld`, `contentDigest` | **yes** (LD2's rules file) | one |
| T4 | App and render: own-route visibility, the "Below ground" strip, the enter cursor, the vent buttons, the fog audit and its witness | T3 | one |
| T5 | The probe's tunnel arm and the per-route containment tests | T3, and N3's production for the yahalom squad to be real | balance-analyst |
| T6 | `net:engines` on a route map | T3 | none |

- **Recommended:** land T1 and T2 straight away, as their own PR. They are additive, no pin moves
  (with the live gate), and nothing is reachable from a room until T3 registers an owned route.
- **Recommended:** T3 to T6 follow N3's production, as ruled (prep §6.3). Then the KDF seat has its
  collapse on the day the Sarim seat has its tunnels.
- **What would stop the work and come back to the lead:**
  - a versus fairness result that moves;
  - any sim pin that moves;
  - a playtest outcome that moves. None is expected: single-player sides are not human-held.

## 9. Questions for the lead

1. **The fairness bar.** Proposed: with the KDF answer fielded, both spawn orders sit inside 60/40.
   Tunnels must give Sarim a measurable edge over the no-tunnel table, and the turtle control must
   not win. **Recommend: yes, as written.**
2. **The routes in §6.3.** Approve the eight strawman routes, move them, or strike Tel Marum's
   under-wall pair (the north end's routes bypass the saddle).
   **Recommend: approve all eight for the first probe run.** Tel Marum's pair is the best test of
   whether the advantage is too strong. If the probe says so, the answer is to shorten them or move
   their vents back, not to drop the map.
3. **The vent's minimum distance from the opposing start.** **Recommend 18 tiles.** Every strawman
   vent clears it (20.6 to 26.0).
4. **Route capacity.** **Recommend 4 units a route, authored per route.** It bounds what one
   collapse can kill and what can turtle below (Q9). Without a cap, two routes could hold the whole
   Sarim foot force.
5. **Travel back toward the mouth.** **Recommend no, in this package.** A buried unit reaches the
   vent and comes up there. A "withdraw underground" order is a second end-state per unit, and the
   probe should first show whether one-way is enough.
6. **Vent while still travelling.** Should the order be refused, or latched so the unit surfaces on
   arrival ("go through and come out firing")?
   **Recommend: refused in T1, with the arrival time on the HUD.** A latch is one more hashed
   column. Add it if playtesting asks for it.
7. **Digging.** **Recommend: out**, confirming prep §6.2. Versus uses authored `pre_dug` routes
   only, and `dig` stays in the §6.3 insurgent toolkit.
8. **The hash layout.** The prep note expected a named pin move for the new countdown column.
   **Recommend the live gate instead** (`tnOrderLive`, the GH-706 pattern): the columns fold only
   once an `enterTunnel` is accepted, so no pin moves.
9. **Buried units and the end rule.** Today a buried armed unit keeps its side "standing", and it
   counts in the force value at the 25-minute cap (`outcome.ts`). A Sarim player who has lost the
   surface could hide below and win on value.
   **Recommend: leave `outcomeOf` unchanged, and rely on capacity (Q4) plus the probe's turtle
   control.** If the control wins for Sarim, the fix is that buried units do not count at the cap.
   That is a one-line app rule, not a sim change.
10. **Who may enter.** **Recommend: any non-wheeled ground unit** (`mobility.wheeled`, the existing
    predicate). That is four of the six Sarim menu types.
    *Alternative:* gate on the `tunnel_travel` ability. That flag sits today on single-player units
    only, so it would have to be added to the four Sarim types' JSON, and their content digest
    would move.
11. **Crawl speed.** **Recommend one speed for everyone, 0.5 tiles/s,** in `tuning.ts`, with the
    probe free to retune it.
12. **Sequencing.** **Recommend landing T1 and T2 (sim and net) now**, ahead of N3, as one PR with
    no pin moves. T3 to T6 follow N3's production, so the KDF's collapse ships with the tunnels.
