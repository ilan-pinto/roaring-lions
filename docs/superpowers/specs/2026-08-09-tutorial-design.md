# The tutorial — Beit Sahwan 0

**Date:** 2026-08-09
**Status:** approved, ready for implementation
**Scope:** One mission, one teaching runtime, one new map. Twelve lessons covering
all eleven KDF unit types. No new unit types, no new art, no contextual-hint
system outside the tutorial.

The game currently has no tutorial and no place to put one. This spec adds the
teaching layer and the mission that uses it.

## What is actually missing, measured

**There is no tutorial anywhere.** A case-insensitive search for `tutorial`
across every `.ts`, `.json` and `.md` in the repository returns nothing.

**Beit Sahwan I claims to be one and is not.** Its briefing reads *"The
battalion has attached one of everything it owns … so use this approach to learn
your tools."* It delivers on the first half — eight unit types in the starting
force — and not at all on the second. There is no instruction of any kind, and
the player meets ten defenders including two ambushing RPG teams.

**The player has fourteen verbs.** Click-select, box-select, right-click
attack-move, shift-queue, right-click-a-building garrison, `h` halt, `o`
overlay, `g` mount, `u` dismount, `f` smoke, `m` mute, ctrl+digit group assign,
digit recall, wheel zoom — plus armed strike and sweep through the production
panel. None of them is explained in the running game.

**Four of the eleven KDF units' signature abilities do not exist in the sim.**
`hidden_setup` (`at_team`, `sniper_team`), `breach` (`demo_squad`),
`mark_tunnel` (`recon_drone`) and `tunnel_travel` have **zero** references in
`packages/sim/src/` outside unit data. `smoke`, `garrison`, `demolish`,
`kamikaze` and `mark_target` are all genuinely wired through to behaviour. This
is load-bearing for the curriculum: a lesson gated on an ability that is a no-op
is a step the player cannot finish and cannot diagnose.

**`do: spawn` cannot deliver player units.** `mission.ts:763` reads
`this.spawnPlacement(p, 1)` — side 1, hardcoded. Player-side staged arrival
needs a new verb.

## Why the teaching layer cannot be mission-schema vocabulary

Objectives and triggers live in `mission.ts` because everything they test is
sim-observable: positions, casualties, elapsed ticks, zone occupancy.

Teaching steps mostly are not. *"The player selected a unit"*, *"the player
right-clicked to order a move"*, *"the player pressed `o` to read the overlay"*
are facts about input and UI state that the sim deliberately does not know.
Teaching them through the mission runtime would mean pushing selection and
camera state into `@lions/sim`, which breaks invariant 4 in the most direct way
available.

So the split is: **the mission is data the sim reads; the steps are data the app
reads.** Two files, two schemas, one mission.

## The contract — an observer that cannot touch the sim

```
DOM events → PlayerIntent ──┬──→ applyIntent → sim.queueCommand
                            │
                            └──→ TutorialRuntime (read-only) → UI
```

`packages/app/src/tutorial/`. The runtime is constructed **without a `Sim`
handle**. It receives a read-only state view and the event streams, and nothing
else. It cannot queue a command because it holds no object that accepts one.

This is structural rather than a convention, and that is the point: no step
data, however written, can move the determinism hash. The alternative — passing
the sim in and relying on the runtime not to use it — would make invariant 4 a
matter of review discipline in a file that will be edited by whoever adds the
next lesson.

**The tutorial never blocks input.** An unsatisfied step does not advance; it
does not prevent anything. Gating input is the usual RTS technique and it is
rejected here on purpose: suppressing an intent would make tutorial *data*
decide which commands reach the sim, which is the coupling the diagram above
exists to prevent. It is also unpleasant to play against.

## The intent layer

`packages/app/src/input/intents.ts`. A union naming what the player did, and
`applyIntent()` as the single place a command is issued:

```ts
export type PlayerIntent =
  | { kind: 'select'; ids: number[]; via: 'click' | 'box' | 'group' }
  | { kind: 'order'; verb: 'move' | 'attackMove'; ids: number[]; x: number; y: number; append: boolean }
  | { kind: 'garrison'; ids: number[]; structure: number }
  | { kind: 'mount'; riders: number[]; carrier: number }
  | { kind: 'dismount'; carriers: number[] }
  | { kind: 'smoke'; ids: number[]; x: number; y: number }
  | { kind: 'halt'; ids: number[] }
  | { kind: 'group'; slot: number; action: 'assign' | 'recall' }
  | { kind: 'overlay'; on: boolean }
  | { kind: 'support'; call: 'strike' | 'sweep'; x: number; y: number; accepted: boolean };
```

A behaviour-preserving extraction of the `main.ts` handlers that issue commands.
Camera pan, wheel zoom and mute stay where they are — they produce no command
and no lesson gates on them.

This is the riskiest change in the spec. `main.ts` is 771 lines with listeners
wired straight to `sim.queueCommand`, and every input path in the game runs
through it. The mitigation is that the extraction lands and is verified as its
own step, before any tutorial code exists to confuse a regression with a new
feature.

It also has a benefit worth naming: the input verbs become unit-testable for the
first time. `g` mount already carries a comment recording a shipped bug — a
box-select over an armoured force loaded Merkavas into the APC — that a test at
this layer would have caught.

## Steps are data; the runtime is a pure reducer

`data/tutorial/beit_sahwan_0.json`, validated against a new
`data/schemas/tutorial.schema.json`.

```json
{
  "id": "suppression",
  "title": "Fire does not kill. It pins.",
  "teach": "One squad fires from cover to hold them down. The other moves while they cannot answer.",
  "await": { "kind": "sim", "event": "pinned", "side": 1 },
  "focus": { "kind": "zone", "zone": "courtyard" },
  "nudge_after_s": 20,
  "nudge": "Keep one squad shooting. Suppression only lasts while fire lands."
}
```

`await` predicate kinds: `intent` (with per-kind narrowing), `sim`, `mission`,
`elapsed_s`, and the compositions `all_of` and `any_of`.

The advance logic is a pure function — `advance(state, event, nowMs) → state` —
with no DOM and no PixiJS. This is the direct lesson from the cigarette-ember
work: `requestAnimationFrame` is throttled while the browser pane is hidden, so
a runtime whose only verification is watching it run cannot be verified at all.
The fragile logic gets unit tests; the part that needs a browser stays thin
enough to confirm by eye.

## Staged reinforcement — `reinforce`, keyed on zones

Units arrive from the mission, never from the tutorial. `do.kind` gains
`reinforce`, spawning on side 0. GDD §6's behaviour vocabulary already lists
`reinforce(group)` as an available do-verb; it was never implemented, and
player-side staging is what it is for. `spawn` stays side-1-only, so no existing
mission changes behaviour.

Deliveries fire on `zone_entered`, not `timer_s`. The trigger already tests side
0 occupancy (`mission.ts`: `this.livingIn(z, 0) > 0`), so walking into a
lesson's ground both *is* that lesson's action and calls its delivery in.
Staging then tracks the player's progress instead of racing it — a timer would
drop a tank on someone still learning to right-click.

## The curriculum

Twelve lessons, every one of the eleven KDF unit types, ~12–18 minutes — inside
the GDD's 12–20 minute band.

| # | Lesson | Delivered | Gate |
|---|--------|-----------|------|
| 1 | Take command | `inf_squad` (starting force) | `select` intent |
| 2 | Move by bounds | — | `order` intent |
| 3 | Cover is terrain | — | `contact` + `overlay` intent |
| 4 | Fire pins, it doesn't kill | `inf_squad` | `pinned` on side 1 |
| 5 | Get inside | — | `garrison` event |
| 6 | Reach and patience | `sniper_team` | `destroyed` where `by` is the sniper |
| 7 | Mount up | `apc_eitan`, `ifv_namer`, `jeep_shoded` | `transport` loaded, then unloaded |
| 8 | Armour has a back | `mbt_lavi` | `smoke` intent + `component` |
| 9 | And armour dies | `at_team` | `destroyed` where `by` is the AT team |
| 10 | Eyes before guns | `recon_drone`, `attack_drone` | `contact` at range, then `destroyed` where `by` is the attack drone |
| 11 | What a shot costs | `mortar_team`, `demo_squad` | `roe` event |
| 12 | Command groups | — | `group` assign intent |

Every gate in that column is a predicate the `await` vocabulary can express
against an event the sim already emits. `destroyed` carries `by`, so "the sniper
made this kill" is checkable; "a kill at long range" would not have been, and an
unexpressible gate is a step nobody can finish.

Opposition is `militia_cell`, `rpg_team`, `technical` and one `atgm_cell` — all
existing units, no new art.

Lesson 11 provokes a real ROE deduction as instruction. `roe.fail_below` is
**omitted** — the schema documents omission as "no hard fail", so the tutorial
cannot be lost on the lesson that teaches ROE, and a literal `0` would say the
same thing less clearly. The `demo_squad`
half demolishes a shanty (`roe_penalty` 2), so demolition and collateral are
taught as separate ideas rather than one confused one.

Lessons 6 and 9 teach `sniper_team` and `at_team` **as weapons only**. Their
`hidden_setup` is not in the sim, and per the measurement above a step gated on
a no-op cannot be completed.

### Which of the fourteen verbs each lesson covers

Stated explicitly, because "teach the controls" is otherwise a claim nobody can
check against the table above.

**Gated** — the player must perform it to advance: click-select and box-select
(1), attack-move (2), overlay (3), garrison (5), mount and dismount (7), smoke
(8), group assign (12).

**Taught in prose, not gated** — shown in the step text where it is useful, but
the lesson advances without it: shift-queue and `h` halt in lesson 2, group
recall in lesson 12. Gating a route-queue would mean asserting the player drew a
path of a particular shape, which is brittle instruction for a convenience key.

**Deliberately untaught** — `m` mute and wheel zoom, which are discoverable and
cost nothing to get wrong; and the armed **strike and sweep** calls, which
require accumulated intel and the production panel. The tutorial runs no economy,
so there is no honest way to teach a support call in it. That is a real gap and
it lands on Beit Sahwan I, whose production panel is where a player first has
intel to spend.

## The map

`data/maps/tutorial_ground.json`, 32×32, text-authored like every other map.
Zones are the lesson boundaries, so terrain and curriculum get designed
together rather than one bent to fit the other. Using the existing
`beit_sahwan_outskirts` west approach was considered and rejected: it is largely
open ground, so the cover, garrison and demolition lessons have nothing to point
at without editing that map anyway.

Required ground, in the order the lessons walk it:

- open field for lessons 1–2
- a `2` heavy-cover wall line for lesson 3
- a courtyard with a covered flanking approach for lesson 4
- an `h` house, 2 garrison slots, for lesson 5
- long sightlines over `o` olive grove for lesson 6
- an `r` road for lessons 7–8
- an `s` shanty as the lesson 11 demolition target
- one `h` house inside a flagged zone, with civilians, as the lesson 11
  collateral target

## Presentation

The existing `panel()` at rank `inspect`. Not `mission` — that rank belongs to
the briefing, and `panel.ts` documents the three ranks precisely so that nothing
on screen outranks the thing it should not.

`renderer.setTutorialFocus(x, y, r)` draws a pulsing ring at a world point,
presentation-only. Nudges go through the existing `hud.note()`.

Colour comes from `data/palette.json` through the semantic tokens in
`theme.css`, as everywhere else in the UI — `pnpm validate:ui` rejects a literal
with no allowlist.

## Persistence and menu placement

Completion is a `localStorage` flag, **not** a ledger key. Whether a human has
seen the tutorial is a fact about the human, not about the campaign — resetting
your ledger should not re-teach you right-click. `ledger.produces` therefore
stays empty, and the tutorial is structurally incapable of touching roster or
cumulative ROE.

The menu lists it first and marks it primary until it has been completed. It
does not auto-launch; a returning player who clears their ledger should not be
force-fed the tutorial. A "skip tutorial" control on the step panel ends the
teaching and leaves the mission playable.

## Verification

- `packages/app/src/tutorial/runtime.test.ts` — the reducer against scripted
  event sequences: correct advance, **no** advance on a wrong intent of the
  right kind, nudge timing, and terminal state.
- A test cross-checking every `await.intent` kind in the shipped step JSON
  against the `PlayerIntent` union, so a typo fails the suite rather than
  shipping a step nobody can complete.
- `packages/app/src/input/intents.test.ts` — the extracted verbs, including the
  mount case whose bug is recorded in the current comment.
- `mission.test.ts` — `reinforce` spawns on side 0, and `spawn` still spawns on
  side 1.
- `pnpm validate:data` — the new `tutorial.schema.json` and
  `tutorial_ground.json`.
- `pnpm test:determinism` — 4/4, hash unmoved. The tutorial holds no sim handle,
  so movement here means something unintended happened.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm validate:ui`.
- **Play the tutorial end to end in the browser and screenshot it.** All twelve
  lessons, in order, driving the actual UI rather than the console — the
  console-shortcut route has produced two false "it works" claims in this
  repository already.

## Risk

**The `main.ts` extraction can break input that works today.** It lands and is
verified as its own step before any tutorial code exists, so a regression cannot
be mistaken for a new feature. If it proves worse than expected the fallback is
gating on sim and mission events only — which costs the tutorial the ability to
confirm select, move and groups, and is a real loss rather than a free retreat.

**Twelve lessons is a lot to author and tune.** It follows from covering all
eleven unit types, which is the requirement. If it plays long, lessons 7 and 10
merge — the vehicle block and the drone pair — reaching eight lessons while
still touching every unit.

**A step can be authored that the player cannot satisfy.** The cross-check test
catches misspelled intent kinds; it cannot catch a gate that is merely very
hard. The end-to-end playthrough is the check for that, which is why it is a
listed deliverable and not a formality.

## Out of scope

- **Contextual hints outside the tutorial.** First-encounter tips across the
  campaign are a separate spec; the fixed sequence is what this one buys.
- **`hidden_setup`, `breach`, `mark_tunnel`, `tunnel_travel`.** Implementing
  them is sim work with its own balance implications. The tutorial teaches only
  behaviour that exists.
- **New unit types and new art.** The eleven KDF and five enemy types already
  shipped are the whole cast.
- **Rewriting Beit Sahwan I's briefing.** Its claim to teach becomes false once
  a real tutorial exists, but editing it is a one-line change better made when
  the tutorial is playable.
- **Audio and VFX for the tutorial.** M1 excludes both.
