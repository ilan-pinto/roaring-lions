# The campaign storyline — design

**Date:** 2026-08-21
**Issue:** [#94](https://github.com/ilan-pinto/roaring-lions/issues/94)
**Status:** approved, not yet built.

## The problem, restated

GDD §2 is a strong setting bible and none of it reaches the player as a story. There is no opening, no ending, and no mission that acknowledges any other. The campaign carries real continuity of *state* — survivors with veterancy, marked positions, ROE ratings — and none of *fiction*, so losing a company in First Light changes the next briefing not at all.

That much of #94 holds. Two of its findings do not, and correcting them makes this job substantially smaller.

### #94 is wrong that Beit Sahwan's order is self-contradictory

The issue argues that `beit_sahwan_breach` sits first in `world.json` while carrying `phase: breach`, "and breach sits late in the phase vocabulary".

It does not. GDD §4 makes **Breach phase 1**:

> **Breach** — the enemy attacks and the player is the one holding. Outnumbered and converged on from every approach… Any doctrine can open on the back foot.

So array position, phase and briefing all agree: First Light *is* the opening. The only oddity is that it alone carries no numeral, and that reads as correct — it is the attack that started the war, not an operation the brigade planned and numbered.

### #94 is wrong that the phase vocabulary is ad-hoc

Mapped against the GDD's six-phase spine, both authored towns run in **ascending phase order** and neither ever goes backwards:

| Beit Sahwan | phase | Wadi Halam | phase |
|---|---|---|---|
| First Light | 1 breach | The Fords | 2 recon |
| I — Recon | 2 recon | Grazing Ground | 3 foothold |
| II — Foothold | 3 foothold | The Cattle Track | 4 buildup |
| III — Clearance | 5 clearance | Wadi Halam | 5 clearance |
| IV — Subterranean | 6 subterranean | Break the Depot | 5 clearance |

The sequencing information #94 says is missing is already in the data. It is simply never used for ordering and never shown to anyone.

**And the difference between those two columns is the story.** Beit Sahwan opens at phase 1 because you are surprised. Wadi Halam opens at phase 2 because you are not. The war's shape is already authored; nobody has said it out loud.

## Decisions

Four, taken by the owner before this was written:

1. **The campaign is a fixed sequence**, not selectable fronts.
2. **The sequence ships as Marj → Naharin, and Sur is the unfinished war.** Rather than authoring Sur (#20, #15) or reordering against GDD §2's rationale, the missing front becomes the ending's meaning.
3. **The story lives in briefings and the title card** — surfaces the player already looks at. No new screens.
4. **Static continuity, not reactive.** Authored text only. The ledger-conditioned layer (#94 item 6) is out.

## The spine

**Act I — The Marj Strip.** Beit Sahwan runs the full ladder, 1 through 6. The war opens by being started against you: dawn, a walled compound, families outside the wire. Then you go back to look at what hit you, take ground and hold it while Ashwar digs underneath, take the town, and find what was beneath it the whole time.

**Act II — Naharin.** Wadi Halam opens at phase 2. You are never surprised again — you arrive on the offensive, and the kind of town that once ambushed you is now a corridor you interdict. It is also the first build-up phase in the war: *The Cattle Track* is the only breathing room the brigade ever gets.

**The ending.** You cut the corridor at Break the Depot and it is not decisive. GDD §2 says cutting supply only matters once the fronts it feeds are contained, and Sur was never contained. The war does not end; it changes shape.

**Through-line:** you begin holding a perimeter someone else chose and end demolishing a depot you chose, and it still is not finished.

### On Beit Sahwan's missing build-up

Beit Sahwan runs 1, 2, 3, 5, 6 — no phase 4. This is written as *true rather than absent*: the brigade got no breathing room in the Marj, which First Light earns, and which makes *The Cattle Track* land harder for being the first.

## What gets built

### Two optional fields on a mission

| field | where it shows | today's content |
|---|---|---|
| `dispatch` | the title card at mission start | `"3 primary objective(s)"` |
| `aftermath` | the victory banner | `"ROE 93, 6 units survive"` |

Both plain optional strings in the mission JSON, so a mission stays one file, every existing mission keeps working untouched, and the story stays declarative data per CLAUDE.md's rule that missions are never TypeScript.

The campaign's opening is First Light's `dispatch`. The campaign's ending is Break the Depot's `aftermath`, and that is where Sur is named.

Register, to fix the voice:

- *First Light* — "The war starts without you. Dawn, the wire, and two years of Ashwar's preparation arriving at once."
- *Wadi Halam I* — "Eight hundred kilometres east, and for the first time you arrive before they do."
- *Break the Depot*, `aftermath` — "The corridor is cut. In the north, Sur's rockets range on regardless. The war does not end here; it changes shape."

### Briefings are not touched

An earlier draft had them gaining continuity openers. They should not. The briefings are the strongest prose in the project precisely because they are clipped tactical orders, and mixing narrative into a fire plan weakens both. `dispatch` is the story voice; `briefing` stays the orders voice.

### #82 is a dependency, not a neighbour

`titleCard` (`ui/motion.ts:45`) holds for **900 ms** and dismisses on any `pointerdown` or `keydown`. That is adequate for a three-word objective count and useless for a sentence: the player clicks to start playing and the story is gone. A mission carrying a `dispatch` gets a real hold (~5 s), keeping click-to-skip as a deliberate escape.

Without this, the campaign is written into a screen nobody can read.

### Three progression defects, found by walking the world

Stepping the campaign with `nextMissionAfter` and `regionProgress` over an accumulating ledger:

```
after beit_sahwan_3_clearance      next=beit_sahwan_4_subterranean  marj=live     sur=live  naharin=live
after beit_sahwan_4_subterranean   next=undefined                   marj=complete sur=live  naharin=live
```

1. **Finishing a town strands the player.** `nextMissionAfter` runs its live-front fallback only when the mission belongs to no town at all; when the owning town is merely exhausted it returns `undefined`. Its own comment says it exists *"rather than stranding them on an end screen offering only replay and menu"*. A fixed sequence dies on this — it is the Marj → Naharin seam.

2. **The Marj reads as conquered on one town of three.** Khan Rafid and Deir Amun hold zero missions, and `regionProgress` sums only what is authored, so 5 of 5 completes the region.

3. **Sur goes live with nothing in it** the moment Beit Sahwan III is done.

**One mechanism closes 2 and 3.** A `planned: true` flag on a town, excluded from progress, states "written later" honestly in the data instead of lying in either direction. The Marj may then complete on Beit Sahwan alone; Sur, all of whose towns are planned, reads as a front not yet opened rather than a live one containing nothing — which is exactly what the ending requires of it.

**Ordering** moves Naharin's unlock from `beit_sahwan_3_clearance` to `beit_sahwan_4_subterranean`, so the Marj is finished before the corridor is offered.

## What this touches

| File | Change |
|---|---|
| `data/schemas/mission.schema.json` | `dispatch`, `aftermath` — optional strings |
| `data/schemas/world.schema.json` | `planned` on a town |
| `data/campaign/world.json` | five towns marked planned; Naharin's unlock moved |
| `data/missions/*.json` (10) | `dispatch` on each; `aftermath` on `beit_sahwan_4_subterranean` (closes Act I) and `wadi_halam_5_depot` (closes the campaign) |
| `packages/app/src/main.ts` | title card reads `dispatch`, with a longer hold |
| `packages/app/src/ui/hud.ts` | victory banner appends `aftermath` |
| `packages/app/src/campaign.ts` | fall-through in `nextMissionAfter`; `planned` towns excluded from progress |

No `packages/sim` change. No `packages/render` change. No new screens.

## Verification

- `pnpm validate:data`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- TDD on both `campaign.ts` changes — they are the load-bearing logic.
- **A world-state walk over the whole campaign.** No unit test sees a gate whose target stopped existing; the walkers exist for exactly this. Step all ten missions from First Light to the aftermath over an accumulating ledger and assert there is no dead end at any point, no region live with nothing in it, and that the Marj → Naharin handoff resolves. This is the proof the sequence holds; the unit tests only prove the functions.
- `pnpm test:determinism` unmoved — nothing here is sim code.
- The title-card hold checked by eye in the running app. It is a readability change; no test can judge it.

## Scope

**In:** the spine, the two fields and their text, the title-card hold for story missions, the `planned` flag, the ordering move, and the three progression fixes.

**Out, deliberately:**

- **Reactive briefings** (#94 item 6). Named as the next piece, not this one.
- **Town arrival and departure interstitials** (#94 item 5). New screens, excluded by decision 3.
- **Campaign-map narrative state.** The surface players dwell on least.
- **Naming the enemy commanders** (#94 item 7). Cheap and tempting, and a separate decision.
- **Authoring Sur** (#20, #15). The ending depends on its absence.
- **A fuller fix for #82.** Only the story-mission hold is in scope here.
