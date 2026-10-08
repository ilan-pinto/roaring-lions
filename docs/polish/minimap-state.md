# Minimap: state and urgency (VR-36, VR-37) — mock for approval

Status: **mock only, nothing built.** The sheet is `docs/polish/minimap-state/sheet.png`,
its source `docs/polish/minimap-state/mock.html`, and the colour-vision strip is
`docs/polish/minimap-state/cvd-strip.png`.

The lead's ask (2026-10-08) had three parts:

- Objective colour follows held, not held and contested, as the world tints them.
- The alert ring follows the alert's tier and its tone, so a lost tank no longer looks
  like reinforcements arriving.
- A suspected contact is hollow, like the world's hollow diamond, and an identified one
  is solid.

## How the sheet was made

- **Ground.** This is the renderer's own photograph of `beit_sahwan_outskirts`
  (`captureGroundAlbedo(210)`, flipped by row as `main.ts` does). It was taken in one
  Metal browser against a dev server on its own port (5191), with music off. The mock
  draws it through the minimap's own `saturate(0.4)`.
- **Live capture.** `today-live.png` is the live minimap canvas from the same session.
  The mock's "today" column redraws the same marks and matches it.
- **Colours.** Every colour is a `theme.css` semantic token. `tokens.js` is generated
  from `theme.css` plus `data/palette.json`, including the three `[data-cvd]` blocks.
  The mock names no hex values.
- **Pixel size.** Frames are drawn at DPR 1, the smallest pixel budget a mark has to
  survive. The 3x columns are those same pixels, magnified nearest-neighbour.
- **Zones.** The zones are the map's own: `shaft_head` held, `clinic` not held and
  `collection_point` contested.

- **Scripts.** The capture script and the `tokens.js` generator were throwaway and are
  not committed. Re-running them needs no game change.

## The mapping

### Objectives (`minimap.ts` `objectivePoints`, drawn in `draw()`)

Today every active objective is an 8 px, 1 px-stroked diamond in `--warn`, whatever its
state.

**Proposed:** draw the zone's own rectangle, the ground the world tints, instead of a
diamond at its centre. The state comes from `objectiveZonesFor`, the same function that
feeds the renderer, so the minimap and the world cannot disagree.

| State | Token (palette key) | World key (`objectiveZoneColorKey`) | Stroke | Motion |
|---|---|---|---|---|
| held | `--live` (`vfx.tracer`) | `vfx.tracer` | solid | steady |
| not held | `--warn` (`team.neutral`, follows the CVD variant) | `team.neutral` | **dashed 3/2** | pulses |
| contested | `--bad` (`team.hostile`, follows the CVD variant) | `team.hostile` | **dashed 3/2** | pulses |
| target (raze/collapse) | `--bad` | `team.hostile` | solid | steady |

Numbers for approval:

- Stroke 2 px over a 4 px `--mark-edge` keyline (1 px of dark on each side).
- Fill is the state colour at 0.12, the world's `OBJECTIVE_ZONE_FILL_ALPHA`.
- The pulse takes stroke alpha from 0.55 to 1.0 at the world's period (about 1.16 s). The
  minimap redraws at 4 Hz, so that is about 4.6 samples per cycle.
- An objective that names a marker rather than a zone has no rectangle. It keeps a
  10 px square at the marker, with the same stroke rules.

Why a rectangle and not a recoloured diamond: a contested diamond in red would be the
same shape and colour as the new suspected contact, which is a red hollow diamond. The
rectangle also separates an objective from story markers (1 px lime diamonds) and from
the viewport outline (a 1 px lime quad), by shape and stroke weight.

### Alert rings (`minimap.ts` `drawFlashes`; `Minimap.flash` gains `tier` and `tone`)

Today every alert draws one `--warn` ring, 2 px wide, growing from 5 to 16 px over
1400 ms. The ring's colour now comes from the alert's **tone**, and its geometry from its
**tier**:

| Tier | Radius | Width | Life | Shape |
|---|---|---|---|---|
| major | 6 → 22 px | 2 | 2000 ms | **double ring** (second ring 4 px inside) |
| important | 5 → 16 px | 2 | 1400 ms | single (today's geometry) |
| minor | 4 → 11 px | 1.5 | 1000 ms | single |

| Tone | Token (palette key) | Motion |
|---|---|---|
| bad | `--bad` (`team.hostile`, CVD) | spreads outward |
| warn | `--warn` (`team.neutral`, CVD) | spreads outward |
| good | `--good` (`scrub.0`) | **settles inward** |
| info | `--info` (`water.0`) | **settles inward** |

Every ring draws over a `--mark-edge` keyline 2 px wider than the ring, at the same
alpha.

Where each alert's tone comes from:

- An alert with a line uses `line.tone`.
- An `objective` alert has no line, so its tone follows its status: complete is good,
  failed is bad, a new tasking is info.
- A sound-only alert uses its tone from the VR-37 resolutions below.
- A civilian flight (`sayFlight`) is important, and warn or info as its line already
  says.

`kill` alerts still flash nothing: their `marks` stay empty on purpose (PA-19).

### Contacts (`minimap.ts` `unitDots` and `dot`)

- **Identified** (`sim.contactLevel(0, i) === 2`): today's solid triangle, unchanged.
- **Suspected** (`contactLevel < 2`, but observed): a hollow diamond, 8 px tall. It is a
  1.5 px stroke in `teamColors[1]` over a 3.5 px `--mark-edge` keyline, which is the
  world's `contactShapeOf` → `'unknown'` in miniature.

The fog rule is unchanged (`unitIsObserved`). The shape only says what the player knows
about a contact the minimap already draws, so it reveals nothing new.

## Colour-vision check

**Method.** I used the repo's own instrument, `tools/src/cvd.ts`: the Machado 2009
matrices at severity 1.0 and CIE76 ΔE. The floor is 25, the same "different at a glance"
line `cvd.test.ts` gates the team colours with. Each set was measured two ways:

- each CVD variant's own tokens, under its own deficiency;
- the default tokens, under each deficiency, for a player who never changes the setting.

The strip in the sheet applies the same matrices to every pixel, ground included.

| Pair | Normal | Deut. default / variant | Prot. default / variant | Trit. default / variant |
|---|---|---|---|---|
| held / not held (`--live` / `--warn`) | 47.7 | **11.0 / 8.5** | **17.0 / 8.2** | 49.8 / 68.2 |
| held / contested | 117.6 | 40.1 / 33.9 | 70.2 / 52.4 | 113.4 / 113.4 |
| not held / contested | 72.0 | 32.1 / 33.6 | 55.5 / 49.8 | 64.8 / 52.4 |
| good / bad | 84.5 | **21.7** / 34.0 | **14.1 / 20.1** | 96.0 / 96.0 |
| good / warn | 51.6 | 47.8 / 57.1 | 45.7 / 58.7 | 46.0 / 50.3 |
| good / info | 49.5 | 45.9 / 45.9 | 49.5 / 49.5 | 25.4 / 25.4 |
| bad / info | 91.1 | 65.1 / 75.5 | 56.3 / 69.4 | 105.2 / 105.2 |

Two pairs fail the floor on colour alone, so each gets a second channel that is not
colour:

- **Held vs not held** collapses under deuteranopia and protanopia, and the CVD variants
  make it worse (8.2–8.5): their brighter yellow lands on lime. So not held is
  **dashed**. Contested is dashed too, and it is still separated from not held by colour
  (≥ 32 everywhere). **This collapse exists in the world as well**: the world zone uses
  the same two keys. That is out of scope here and listed for the lead.
- **Good vs bad** collapses under protanopia (14–20). So good rings **settle inward**
  and bad rings spread outward. The major tier's double ring stays the same for both.
  Tone is read from motion, tier from size and shape.

Legibility against the ground (the photographed median after `saturate(0.4)`, `#b1ab9e`):

| Token | ΔE |
|---|---|
| `--live` | 34–80 |
| `--warn` | 26–78 |
| `--bad` | 39–85 |
| `--good` | 22–36 |
| `--info` | **18–20** |

`--info` is weak on sand by colour alone. It holds because of the `--mark-edge` keyline,
the same reason the refuge cross has one. Suspected vs identified is shape only, in one
colour, so it holds under any deficiency.

## VR-37: tier and tone disagreements, with a proposed resolution for each

The ring colours depend on these resolutions, so they are part of the approval.

1. **Civilian "taken" is minor but bad.** `missionEventTier` in `alerts.ts` gives
   `removed` with side 2 the tier `minor`. `removedNotice` (`mission-notice.ts:49`) gives
   it the tone `bad`.
   - **Resolve:** make it `important` and bad, and give it a ring at the removal point.
     A taken player unit is already important, and on an `evacuate_before` mission
     (Khan Rafid) an abduction is a scored loss.
   - Afterwards no shipped alert is minor and bad. The sheet still shows that ring so the
     ladder is complete.
2. **The two arrival kinds disagree.** Both are friendly arrivals; a `reinforce` trigger
   spawns player units (`mission.schema.json`). But `built` (the dock) is
   important + `info`, and a labelled `reinforce` trigger is important + `warn`.
   - **Resolve:** make both `minor` + `info`. Both are already silent (`cue: null`,
     because the dock and the announcer carry them), so `minor` makes the tier match what
     the player hears.
   - Warn was wrong: amber says caution.
   - Trade-off: a minor alert only takes the jump key when nothing heavier holds it. The
     alternative is important + info: same ring colour, bigger ring.
3. **"Broken" is in the HUD only, with no world counterpart.**
   - **Resolve:** keep it that way on purpose. The lead's rule is no status marks in the
     world.
   - Its counterparts are the minimap ring (important, bad: it already carries `marks`)
     plus the unit card and chip flag. This is recorded as intended, not a gap.
4. **Pinned and ambush are sound-only.**
   - **Pinned resolve:** `minor` + `warn`, the under-fire ring at the pinned unit. Its
     marks already flash today, as amber with no tone. The chip's pinned mark (GH-262)
     stays the wording, so no feed line is added.
   - **Ambush resolve:** `important` + `bad`, with a feed line, and a ring on **our first
     unit hit** that tick. It does not go on the ambusher. Pointing at the hidden
     ambusher would be x-ray, which is why `at` is null today.
   - The victim comes from the same tick's `fire`/`impact` events, which `alertsForTick`
     already walks. This is app-only, with no sim change.
   - Ambush is the one new catalogue string (`alert.ambush`), and it goes through `t()`.

## What a build would touch (for scoping, not done)

- `packages/app/src/ui/minimap.ts`:
  - `CHROME` gains `--bad`, `--good` and `--info` (all existing tokens).
  - `MinimapObjective` gains `state` and its rectangle (or a `objectiveZonesFor` thunk).
  - `flash()` takes `{tier, tone}` per call.
  - `unitDots` reads `contactLevel`.
  - The `drawFlashes` and `diamond` comments that call amber "the same look here" are
    rewritten.
- `packages/app/src/ui/alerts.ts`: the VR-37 tier and tone changes, and `Alert.tone` for
  lineless alerts.
- `packages/app/src/main.ts`: pass tier and tone at the two `minimap.flash` call sites.
- No sim, renderer or palette change, and no new colour.

## Out of scope, for the lead

- **World held vs not held** collapses under deuteranopia and protanopia, the same pair
  measured above. The world zone could take the same dash. That is a world-mark change,
  so it is the lead's call.
- **VR-36's fourth point:** the feed's bearings are in screen frame and the minimap is
  in map frame. This is unchanged and is by design (`alert-place.ts`).
- **VR-33 "lime everywhere":** a held zone adds one more lime mark to the minimap. It is
  told apart by shape and weight.
