# Mounted delivery — design

**Date:** 2026-08-10
**Status:** approved, not built
**Follows:** `2026-08-10-enemy-technical-design.md`, which declared
`transport_slots: 3` on the enemy technical and recorded that the seats are inert.

## The problem

`transport_slots` on any AI-driven unit does nothing. Established on evidence:

- `placement` in `mission.schema.json` accepts `unit, count, at, marker,
  facing_deg, group, tag, stance, from_ledger` — no passengers.
- `stance.kind` is only `hold_position | ambush | patrol | garrison`.
- trigger actions are only `commit | withdraw_to | spawn | reinforce`.
- the sole path that increments `passengers[]` (`sim.ts:2339`) sits inside the
  player's `load` command.

So the enemy technical currently *looks* like a troop carrier and is not one.

## What already exists

Almost all of it. The sim implements transport in full — `carriedBy`,
`passengers`, `boardGoal`, `stepTransport`, `disembark`, `unloadAll`. Passengers
ride the hull, are untouchable aboard, and bail out damaged and suppressed if the
carrier dies. Thirteen tests in `carriers.test.ts` cover it, including *"refuses
more passengers than it has seats"* and *"refuses to load a tank into a personnel
carrier"*.

Nothing in the combat model needs building. What is missing is only a way for a
*mission* to reach it: every existing route is a player command.

This also means the interesting behaviour is free. Killing the truck bails the
squad out shaken rather than deleting them, so a delivery is a real risk the
player can pre-empt — which is what makes a technical frightening rather than a
taxi.

## Design

### 1. `placement.passengers`

```json
{
  "unit": "technical", "count": 1, "marker": "rp_east", "group": "flankers",
  "passengers": [
    { "unit": "rpg_team", "count": 1, "group": "flank_rpg" },
    { "unit": "militia_cell", "count": 1 }
  ]
}
```

An array of `PlacementJson`, spawned at the carrier's position and embarked
immediately — no walking, no boarding delay. Each entry keeps the full placement
vocabulary, so a passenger can declare its own `group` or `tag` and be addressed by
later triggers once it is on the ground.

Nested rather than a `mounted_in: "<group>"` field on a separate placement: the
carrier and its load are one authored fact, and splitting them across two places
invites a mission where one exists without the other.

Rules:

- passengers take the carrier's side; a placement cannot load the other team's
  infantry.
- `count` on the carrier multiplies nothing — a `count: 2` carrier placement gives
  *each* carrier the declared load, because that is what "these two technicals each
  bring an RPG team" means. Over-capacity is then per carrier, not in aggregate.
- passengers of passengers are rejected. Nesting depth one; a truck inside a truck
  is not a thing this game models.

### 2. `dismount` trigger action

```json
{ "on": { "kind": "zone_entered", "zone": "z_market" },
  "do": { "kind": "dismount", "group": "flankers" } }
```

Unloads everyone carried by any unit in `group`, via the existing `unloadAll`.
Silent no-op when the group is empty, all dead, or nobody is aboard — a trigger
that fires twice must not be an error, and neither must one whose carrier was
killed on the way in.

Chosen over a new `mounted` stance because it composes with all four existing
conditions for nothing: dismount on `zone_entered`, `first_contact`, `timer_s` or
`casualties_pct`. A stance could only ever dismount on arrival, and would add a
parallel control path duplicating `patrol` plus a trigger.

### 3. One new sim entry point

`mission.ts` lives inside `@lions/sim` and already calls `this.sim.spawn(...)`, so
it gains a sibling for embarking at spawn.

**It must route through the same capacity and `can_embark` guards as the player's
`load`.** A second, laxer path is how a tank ends up inside a pickup. If the guards
refuse, that is a mission authoring error and should surface as one, not as a
silently half-loaded truck.

## Validation, in two places because one cannot do it

JSON Schema checks the shape: `passengers` is an array of placements, depth one,
and `dismount` requires `group`.

It **cannot** check capacity — that needs the carrier's `transport_slots` from unit
data, which the schema cannot see. So the semantic checks go in
`validate_data.mjs`:

- the carrier's type has `transport_slots > 0`
- passenger count per carrier does not exceed it
- every passenger type can embark (`can_embark`, defaulting from role)
- `dismount` names a group some placement actually declares

A bad mission then fails `pnpm validate:data` rather than throwing mid-mission.

## Determinism

Ordered iteration, no RNG, and no existing mission gains passengers — so the golden
hash in `determinism.test.ts` should not move. That will be asserted rather than
assumed: if it moves, the fault is in my spawn ordering, not in the hash, and the
fix is the ordering.

## Wired into one mission, or it is dead schema

A feature nothing uses cannot be verified. **Beit Sahwan II — Foothold** is the
host: it already fields 2 technicals and has *zero* triggers, so a delivery reads
cleanly without disturbing existing pacing.

The delivery to author: a technical carrying an RPG team, dismounting on
`first_contact`, so the player who rushes the objective meets infantry that arrived
by vehicle rather than walked. Then `pnpm balance` and a play-through to check it
has not turned the mission into a wall.

## Tests

Extending `carriers.test.ts`, colocated as always:

- a placement with `passengers` spawns them aboard, not beside
- over-capacity at spawn is refused, and says which mission and carrier
- a passenger type that cannot embark is refused
- the `dismount` action puts them on the ground near the carrier
- `dismount` on an empty, dead, or already-unloaded group is a no-op
- passengers stay passengers until the trigger fires

Already covered and deliberately not duplicated: riding with the hull, immunity
while aboard, and the bail-out when the carrier brews up.

## Not in scope

- Infantry choosing to board on their own initiative. Boarding remains either a
  player command or an authored fact.
- Re-boarding after dismount. A delivered squad fights on foot.
- The player's own missions gaining `passengers`; nothing needs it yet, and the
  field is faction-neutral if they later do.
