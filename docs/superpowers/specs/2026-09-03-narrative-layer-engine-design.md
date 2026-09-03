# The narrative layer — engine slice

**Date:** 2026-09-03
**Follows:** `docs/campaign/storyline.md` §7 and `docs/campaign/beit_sahwan/design.md` §6, §9,
which specify every gap below with a fallback; this spec turns the proposals into
one implementable slice. GDD §11; the surface contract in `docs/campaign/README.md`.
**Status:** approved by the lead ("Engine slice for the narrative layer", 2026-09-03), not yet built.

## The problem

Act I is authored and measured (`4a1aeaf`), and three of its beats cannot happen:
the two takings at First Light have no verb, nothing can speak after the deploy
screen, and the story voice (`dispatch`, `aftermath`, `debrief`) has no field. The
HUD names one hard-coded commander at one rank across fourteen missions where he
holds three. Every piece of content that needs these is already written and marked
`engine` in `docs/campaign/beit_sahwan/narrative.md` and `script.md`.

## Decisions

1. **Missions stay data.** Every new behaviour is a schema field with a small,
   local runtime reader. No mission logic in TypeScript.
2. **Invariant 4 holds.** New events flow *out* of the sim; nothing in the app
   writes back. A `remove` is a command resolved on a tick boundary with no RNG,
   so `pnpm test:determinism` cannot move (the golden replay runs no mission).
3. **An abduction is the enemy's act.** It must not touch the ROE score and must
   not draw as a death.
4. **The radio's first surface is the HUD it already has.** No overlay art in
   this slice: a `say` line lands in the notice feed and on the commander bar with
   its speaker's name. The overlay (`render-vfx`, GH-114) comes later and reads the
   same event.
5. **The commander is data**, per the 2026-08-21 commander-brief spec, with a rank
   per mission.

## Schema (`data/schemas/mission.schema.json`)

| where | addition | notes |
|---|---|---|
| `triggers[].do.kind` | `remove` | with `group` (required) and optional `zone`; `to`/`units` refused |
| `starting_force[]` | `group?: string` | one key; `additionalProperties: false` stays |
| `triggers[]` | `say?: { speaker, text }` | fires with the trigger |
| `objectives[]` | `say?: { speaker, text }`, `say_on_fail?: { speaker, text }` | on complete / on fail |
| top level | `dispatch?`, `aftermath?`, `debrief?: string` | story voice; ≤ 240 chars each |

`speaker` is an enum: `shai | idit | net | enemy`. `text` ≤ 240 chars. New
`data/schemas/commander.schema.json` for `data/campaign/commander.json`:

```json
{
  "people": {
    "shai": { "name": "Shai Hammai", "plate": "Hammai" },
    "idit": { "name": "Idit Zohar", "plate": "Zohar" }
  },
  "ranks": [
    { "rank": "Captain", "stars": 2, "until_mission": "beit_sahwan_4_subterranean" },
    { "rank": "Major", "stars": 3, "until_mission": "tel_marum_3_clearance" },
    { "rank": "Lieutenant Colonel", "stars": 4, "until_mission": "wadi_halam_5_depot" },
    { "rank": "Colonel", "stars": 5 }
  ]
}
```

The rank for a mission is the first entry whose `until_mission` is that mission or
later in campaign order (`world.json`'s town arrays, regions in order); the last
entry has no `until_mission` and is the default. `tools/validate_data.mjs` gains
the file (it names `data/campaign` files individually).

### Validation guards (`tools/validate_data.mjs`)

- A `remove` must name a `group` declared on some placement of that mission
  (`enemy.garrison`, `civilians.groups`, waves, `spawn`/`reinforce` units, or
  `starting_force`).
- A `remove` whose group covers every `starting_force` entry is refused: removing
  the last living player unit would read as a wipe.
- `say.text`, `dispatch`, `aftermath`, `debrief` ≤ 240 characters.
- `commander.json` ranks reference mission ids that exist, in campaign order.

## Runtime (`packages/sim/src/mission.ts`, `packages/sim/src/sim.ts`)

- **`starting_force.group`** — `spawnPlacement` already registers `p.group` for
  every side; the field only has to be passed through. Zero new logic.
- **`remove`** — for every living entity registered under `group` (filtered to
  those whose tile is inside `zone` when given): `sim.removeFromPlay(id)`. That
  method sets `alive = 0` and marks the entity `removed`, emits
  `SimEvent { kind: 'removed', id, side }`, and does **not** call `destroy()`, so
  `stepRoe` sees no `destroyed` and the score is untouched. A removed player unit
  is absent from `roster.surviving_units` (that is the point) and does not count
  as a casualty for `casualties_pct`. A removed civilian is not evacuated and not
  a casualty. `checkEnd`'s wipe test is unchanged; the validator guard above is
  what keeps it from firing.
- **`say`** — when a trigger fires, or an objective completes/fails, emit
  `MissionEvent { kind: 'say', speaker, text }` after the event it belongs to.
  Pure translation of data; no state.
- **`dispatch` / `aftermath` / `debrief`** — carried on the mission object; the
  sim does not read them.

## App (`packages/app`, `packages/render`)

- **`describeMissionEvent`** (`main.ts`): `say` → `<b>IDIT</b> — text` (speaker
  name from `commander.json`, `NET` for the net, `ENEMY` never named); `removed`
  → `taken (<n>)` for civilians, `<unit> taken` for a player unit, level `bad`.
- **Commander bar** (`ui/hud.ts` `renderCommander`, `ui/loading.ts`): the
  `COMMANDER` constant goes; rank and plate come from `commander.json` for the
  current mission. A `say` line replaces the bar's current beat with the
  speaker's plate until the next line or beat.
- **Title card** (`ui/motion.ts` `titleCard`): when `dispatch` is present, show it
  under the name and hold ~5 s; any input still skips.
- **Victory banner** (`ui/hud.ts`): append `aftermath`. **End screen**
  (`ui/menu.ts` `showEndScreen`): `debrief` above the rating.
- **Renderer**: a `removed` entity is pruned without the death clip or a wreck,
  on both backends (billboard and mesh); `ThreeRenderer.addWreck` and
  `mesh-death.ts` must check the flag before playing anything.
- `pnpm validate:ui`: no colour literals; the speaker plate uses existing tokens.

## Sequencing

1. **sim-guard** — schema, `validate_data.mjs` guards, `mission.ts`/`sim.ts`,
   `commander.schema.json`, tests. Lands first because the app compiles against
   the new event kinds.
2. **render-vfx** — `describeMissionEvent`, commander data in the HUD and the
   deploy screen, title card hold, banner, end screen, renderer pruning, tests.
3. **mission-author** — apply the engine-gated fragments from
   `docs/campaign/beit_sahwan/script.md` §1.7(b) (the two `remove` triggers,
   `group` on the section), the `say` lines, `dispatch` and `aftermath` from
   `narrative.md`, and `data/campaign/commander.json`; `pnpm playtest` must keep
   the passive control on DEFEAT and both plans on VICTORY.

## Tests

- `mission.test.ts`: `remove` of a civilian group leaves ROE at 100; `remove` with
  a zone removes only those inside; a removed player unit is absent from
  `roster.surviving_units`; `casualties_pct` ignores removed units; `say` events
  are emitted on trigger fire, objective complete and objective fail, in that
  order relative to the event they annotate; `starting_force.group` is addressable
  by `commit`-style lookups (`groups`).
- `validate_data` fixtures: unknown group refused; whole-force remove refused;
  240-char limits.
- `packages/app`: `describeMissionEvent` for `say` and `removed`; the commander
  rank resolver over `world.json` order (Captain through IV, Major at Tel Marum I,
  Colonel with no `until_mission`); `titleCard` hold with and without `dispatch`
  (jsdom, `prefers-reduced-motion` respected).
- `packages/render`: a removed entity draws no wreck and plays no `down` clip.
- `pnpm test:determinism` unmoved; `pnpm balance` unmoved; `pnpm playtest` exit 0.

## Out of scope, deliberately

The radio overlay's art and portraits; voice audio and the `validate:audio`
set kind (GH-110); `capture` requiring its target alive (G4); `evacuate_before`
naming a group (G5); a friendly-tagged prisoner (G6); trigger conditions over
objectives or `SimEvent`s (G8); a `planned` town flag (G5 in the storyline).
Each is recorded with its smallest proposal in the two campaign documents.
