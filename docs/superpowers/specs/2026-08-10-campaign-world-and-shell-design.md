# The campaign world and shell — design

**Date:** 2026-08-10
**Status:** approved, not built
**Part of:** campaign structure, piece 3 of 4
**Closes:** [#22](https://github.com/ilan-pinto/roaring-lions/issues/22),
[#36](https://github.com/ilan-pinto/roaring-lions/issues/36)
**Mockup:** [`assets/2026-08-10-sahar-basin-mockup.svg`](assets/2026-08-10-sahar-basin-mockup.svg)

## The problem

The campaign is a flat list. `packages/app/src/ui/menu.ts` announces itself as "pure
navigation — no sim, no state", and that is exactly what the player gets: missions in a
column, most recent first, tutorial pinned to the top until it is done.

GDD §2 describes a region with three borders, three doctrines and six named towns. None of
it is visible, so as #36 puts it, the campaign reads as a playlist rather than a war.

Worse, §2 does not actually contain a world. It contains a *table*. Nothing says where the
Marj is relative to Kedem, what separates Sur from anything, or why a brigade would fight
these three fronts in any particular order. A progression only feels earned if the map
makes it inevitable, and there is no map to make it so.

## The geography, which is new canon

This is the substantive half of the spec. **GDD §2 gains a layout**, because a world map
drawn against an unwritten geography will drift from the GDD within a month.

Kedem sits in the centre of the basin with all three fronts on its borders. The order of
the campaign is then not a menu choice but the shape of the threat:

**1 · The Marj Strip — west, coastal.** A dense enclave pressed between the sea and
Kedem's most populous coastal plain, with no mountain, no river and no depth between them.
An attack out of the Marj is inside Kedem's cities in minutes. That is why the war opens
here, and why [#65](https://github.com/ilan-pinto/roaring-lions/issues/65)'s first mission
is a perimeter being *lost* rather than a push: the Ashwar Front struck the nearest thing.
It is also the right teacher — dense urban is where detection, suppression and civilian ROE
all bite at short range, which is the combat model's core.

**2 · Sur — north, mountains.** Its threat is standoff: rockets ranging onto Kedem's north
from behind a mountain wall. Sur is second by sequencing rather than by choice, because you
cannot climb into the mountains while something is at your throat on the coast. Mechanically
it needs a player who already reads cover and detection, since the engagements are now long.

**3 · Naharin — east, river desert.** The smuggling corridor that has been supplying the
Marj's tunnels and Sur's rocket stocks. Last, because cutting supply is only decisive once
the fronts it feeds are contained, and because open-desert mobility demands the combined
arms the first two campaigns teach.

**Proximity, then standoff, then source.** The knife at your throat, the gun over the wall,
then the hand behind both.

Every region stays defined by terrain and doctrine, never by a people, which is
`CONTRIBUTING.md`'s rule and not negotiable.

## The screen

Three region states, and the difference has to survive being glanced at:

| state | drawn as |
|---|---|
| **live** | full colour, gold border, towns named in white |
| **complete** | flattened to one muted tone, texture dropped, towns struck through |
| **locked** | its own texture at low contrast, plus a padlock and the condition that opens it |

**Dim by dropping texture and saturation, not brightness.** The first mockup greyed
complete and locked regions by laying shadow over them at 40–60%, which turned both nearly
black and cost every label inside them. Collapsing a finished region to a single flat tone
reads as *retired* far better, and keeps its towns legible — which matters, because a
completed region is still enterable (see *Replay*).

Below the map, one panel per region: doctrine, missions completed over total, cumulative
ROE, and for a locked region the specific thing that opens it. This is #36's "ledger state
visible on the map", and #22's "what the ledger currently holds".

Selecting a town starts the first mission in its list that is not yet complete.

## Data, and what is not data

**`data/campaign/world.json`**, validated against a new `data/schemas/world.schema.json`
(schemas live in `data/schemas/`, not the path CLAUDE.md gives):

```json
{
  "id": "sahar_basin",
  "art": "assets/campaign/sahar_basin.svg",
  "regions": [
    { "id": "marj", "name": "The Marj Strip", "faction": "Ashwar Front",
      "doctrine": "tunnels, IEDs, ambush, human terrain",
      "towns": [
        { "id": "beit_sahwan", "name": "Beit Sahwan", "at": [150, 372],
          "missions": ["beit_sahwan_1_recon", "beit_sahwan_2_foothold", "beit_sahwan_3_clearance"] }
      ] },
    { "id": "sur", "name": "Sur", "faction": "Sarim Brigades",
      "doctrine": "rockets, ATGMs, standoff",
      "unlock": { "after_mission": "deir_amun_3_subterranean" },
      "towns": [
        { "id": "tel_marum", "name": "Tel Marum", "at": [410, 168], "missions": [] }
      ] }
  ]
}
```

The mission id in that `unlock` is illustrative — Deir Amun's missions are piece 2's to
author. Note the authoring keys are **`after_mission` and `roe_rating_min`**, matching
`data/schemas/unit.schema.json`; the runtime's own interface spells them `afterMission` and
`roeMin`, and the loader already maps between the two.

**Region outlines live in an SVG asset, not in the JSON.** `assets/campaign/sahar_basin.svg`
carries one element per region, `id="region-marj"` and so on, plus terrain decoration. Hand
authoring polygon paths into JSON is miserable, and this way the map's look can be replaced
by someone with cartographic taste without touching code.

The split is deliberate and the boundary matters:

- **`world.json` owns logic and text** — regions, factions, doctrines, towns, town
  positions, mission order, unlocks. Nothing in the SVG carries a label, so names cannot
  drift between the two files and stay translatable.
- **The SVG owns shape only.** Town dots are positioned by `at` from the JSON, in the
  SVG's `viewBox` coordinate space. That coupling is the one thing to document loudly.

So **adding a town is a content change**, which is #36's acceptance criterion. Adding a
whole new *region* needs a JSON entry and a new outline in the SVG — a rarer event, and one
that wants cartography anyway.

**The SVG must be inlined, and its fills must be tokens.** `validate_ui_palette.mjs` scans
`ROOTS = ['packages/app/src']`, so an SVG sitting in `assets/` would ship raw hex entirely
outside the palette gate — the one rule this project enforces with no allowlist. Two things
follow, and both constrain the implementation rather than decorate it:

- fills name semantic tokens (`var(--band-mission)`, `var(--ink)`), never hex, exactly as
  `theme.css` requires of everything else
- the map is therefore **inlined into the DOM**, not loaded through `<img>`, because an
  `<img>`-loaded SVG cannot see the page's custom properties

Then add `assets/campaign` to `ROOTS` so the gate actually covers the file. Without that
step the rule is advisory, and an advisory palette rule is how off-palette art ships.

## Region state is derived, never stored

A region is **complete** when every mission of every one of its towns appears in
`campaign.completed_missions`, which the ledger already writes. It is **locked** when its
`unlock` predicate fails, and **live** otherwise.

So the world map adds no save state and cannot disagree with what you actually played.
#22 asks for "progression state persisted alongside the existing ledger"; the honest
answer is that no new persisted state is needed, because the ledger already holds it.

**Unlocks reuse the existing vocabulary.** `mission.ts:157` already parses
`unlock: { roeMin, afterMission }` and the runtime already renders both as prose —
`requires campaign ROE 45 (currently 31)`, `requires clearing <mission>`. A region unlock is
the same predicate applied to a region instead of a unit, so the map's "locked because" text
comes from code that exists and is already exercised by unit gating.

Worth knowing before implementing: the predicate is `MissionRuntime.buildBlockedReason`, a
method on a *sim* class, and the shell must not instantiate a sim to draw a menu. It reads
nothing but the unlock record and the ledger, so it lifts cleanly into a pure
`unlockReason(unlock, ledger)` that the shell and the runtime both call — a refactor, not new
logic, and the only engine work this screen requires.

## Replay, and the ROE bug it uncovers

#22 requires that "replaying a mission for a better ROE is possible and its effect on the
campaign is clear". It is currently impossible to satisfy honestly, and finding out why is
the most valuable thing in this spec.

`mission.ts:994` computes the campaign rating as

```ts
const cumulative = typeof prev === 'number' ? ((prev + roeRating) / 2) | 0 : roeRating;
```

That is an exponential moving average with α = 0.5, and it has two faults:

1. **It can be farmed.** Replaying your best mission repeatedly walks the campaign rating
   up towards that mission's score, without playing anything new.
2. **A replay never replaces the thing it was meant to fix.** Replaying a mission you did
   badly adds a fresh sample; the bad one is already baked in and cannot be removed.

It is also order-dependent — the same missions played in a different order give a different
number — which makes "what a low rating has locked" unexplainable to the player.

**The fix:** the ledger gains `roe.mission_ratings`, a map from mission id to the **best**
rating that mission has earned, and `roe.cumulative_rating` becomes the integer mean of its
values.

| property | consequence |
|---|---|
| best-per-mission | a replay can only improve its own entry, so replaying is always worth trying |
| one entry per mission | farming is impossible; replaying X moves only X |
| order-independent | the same played campaign always reads the same number |
| itemised | the panel can name the missions dragging the mean down, which is #22's "clear" |

This is a `@lions/sim` change to the produce block, so `pnpm test:determinism` applies and
the golden hash must be asserted rather than assumed. It is in scope because the shell
cannot deliver #22's acceptance criterion without it.

## Where the tutorial goes

Nowhere on the map. It is not a region mission and it teaches the mouse, not the war, so it
stays a single item above the map, shown until `lions.tutorial.done` is set — which is
already how the shell treats it and already survives a ledger reset.

## Scope

**In:** the GDD §2 geography amendment; `world.json` and its schema; the Sahar Basin SVG;
the world map screen with three region states and the status panel; region state derived
from the ledger; region unlocks via the existing predicate; the `roe.mission_ratings` fix;
`validate_data.mjs` checks; tests; and replacing the flat list in `menu.ts`.

**Out:** any per-front state, deteriorating fronts, or resource allocation between regions
— the *progress board* was chosen over a strategic layer deliberately, because a meta-game
beside the combat model competes with the thing the GDD calls the product. Also out: audio,
a painted illustration pass, and animated troop movements on the map.

## Validation

`validate_data.mjs` gains checks that JSON Schema cannot express:

- every mission id in `world.json` exists in `data/missions/`
- every mission file is referenced by **exactly one** town — no orphans, no duplicates.
  This is the check that stops the world map and the mission folder drifting apart, which
  is the failure mode a flat list hides
- a region's `unlock.after_mission` names a mission in an *earlier* region, so the
  progression cannot contain a cycle that locks the whole campaign
- every region id in `world.json` has a matching element id in the SVG. A missing id is an
  invisible region, and nothing else would catch it

## Verification

**By driving the UI**, not by console shortcuts — they skip the code that breaks, which has
already cost two false "it works" claims on this project:

- a fresh save shows the Marj live, Sur and Naharin locked, each naming its condition
- completing one mission moves its town's count and leaves the region live
- completing a region flattens it, strikes its towns through, and opens the next
- replaying a mission with a better ROE raises that mission's entry and the campaign mean;
  replaying it worse leaves both alone
- a region locked by ROE says so, and says by how much

Screenshots at the end, since the whole feature is a screen.

**Gates:** the full ten-command CI list.

## Two things this spec does not settle

**Mission count against GDD §8.** M2 says "three towns, one per doctrine — roughly 10–14
missions". The Marj arc alone is eight missions across three towns, so the basin as drawn
is nearer seventeen. Piece 2 already superseded the one-town-per-doctrine shape; §8's
number needs revisiting with it, and not here.

**#65's opening mission still has no phase.** All five GDD §4 phases assume the player is
advancing, and the campaign now opens with a perimeter being lost. That decision was
flagged in the carry-over spine spec and is still open; the world map does not depend on
the answer, but the Marj's first town does.
