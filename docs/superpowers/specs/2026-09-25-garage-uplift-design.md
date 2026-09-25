# The garage uplift — design (WP-S3g, #238)

**Date:** 2026-09-25 · **Status:** approved (merged as #239); plan 1 (the app half) is built on
`feat/garage-uplift-app`. **Builds with:** S3a #180 (the plates are re-rendered once, not twice). **Out of
scope:** the filter bug #237, which is being fixed separately and is only noted here.

## 1. Status and problem

The lead: *"overall the Garage needs another deeper uplift, bring it to next level."*

**Audit conditions.** Playwright on the real `/brigade` route, its own dev server (:5192),
ANGLE/Metal (M3 Pro), 1400×900, 1920×1080 and 2560×1440 at DPR 1. The brigade was seeded
through the two keys `LedgerStore` reads: 11 stars, Conduct 83, 2400 credits against a 5000
grant, `mbt_lavi` bought, and tiers on `inf_squad` (armour 2, sensors 1), `at_team` (firepower 1)
and `mbt_lavi` (3/3/3). Every control was walked: select, hover, buy a rung, buy a unit, filter,
and 40 Tab presses. Captures, the driver and `drive-log.txt` are in
`.superpowers/garage-spec/audit/` (git-ignored, 49 MB, not committed); references read
`<res>/<file>`.

| # | Finding | Capture |
|---|---|---|
| F1 | **An upgrade changes nothing you can see.** The maxed Lavi's plate is the base file; its card reads "Owned" like every available unit. | `1920x1080/03-mbt_lavi-maxed`, `02b` vs `02c` |
| F2 | **Nor in the game.** On `?sandbox=beit_sahwan_outskirts` the sim registers the patched type (Lavi HP 3000 → 3750); the only visible difference is the HUD card's numbers (`3750 hp`, `pen 1625mm` vs `1300mm`). No mark at any zoom. | `game/up-*` vs `game/base-*` |
| F3 | **A purchase blanks the screen, then moves you.** The route remounts: blank from 7–9 ms to 210–217 ms (5 buys, warm). The wallet flash runs on the removed node. Selection jumps to the first card (an `at_team` buy lands on the Lavi), focus drops to `<body>`, scroll resets. No sound. | `*/05-buy-upgrade-120ms` (one flat colour, 1 distinct value), `05b`, `08`, `08b` |
| F4 | **The preview is off-screen.** The stat panel scrolls with the board (1883 px of content in 865 px at 1920; one of three tracks visible), so hovering firepower previews into a panel scrolled away. | `1920x1080/04-at_team-rung-preview` |
| F5 | **An owned rung previews as if bought again**: Lavi armour tier 1 (owned) reads `3750 → 3960` HP. `showPreview` adds the delta to a figure already including it. | `1920x1080/11-owned-rung-hover` |
| F6 | Zero-change benefit lines are printed: `inf_squad` armour tier 3 reads `Front armour 12 → 12` (×3). | `1920x1080/02-inf_squad-upgraded` |
| F7 | A locked unit shows an empty right column: no tracks, so no hint of what it could become. | `1920x1080/07-locked-ifv_namer`, `09` |
| F8 | **Keyboard**: 25 Tab stops (8 tabs, 17 cards) before the bay; arrows move focus but do not select; a buy loses focus. | `drive-log.txt`, `10-keyboard-focus` |
| F9 | Layout: ~100–140 px empty under the blurb while the board scrolls 2.2× (1920) / 2.0× (2560); the box is 14 px taller than a 1080 viewport, 12 px at 1440. | `01-open` at all three sizes |
| F10 | #237, noted only: "Armour" hides 14 cards in the DOM; all 17 still draw. | `1920x1080/06-filter-armour` |

**Kept:** the lit plate, benefit lines in the unit's own numbers, the preview, every economy
rule (`gateSentence`, `applyUpgrades`, `nextTierPrice`, the two-click reset), and a screen that
only asks.

## 2. Design goals: what "next level" means here

The yardstick is the shell's register (lit renderer, chevron mark, display face, numbers at
reading size) and the lead's taste (many units plus upgrades, a mid-weight economy):

1. **Kit is visible wherever the unit is**: card, bay, HUD card and map.
2. **A purchase is an event**: it stamps, counts and sounds, and leaves you where you were.
3. **All three tracks at once, preview always in view.** 17 × 3 × 3 = 34,965 credits, about
   6× the ★★ ladder: the player returns here often and plans across tracks.
4. **Two registers stay apart.** Veterancy (earned, per named unit) is stars and gold chevrons
   (`ChevronBatch`, `--commend`); kit (bought, per type) is a steel plate. No shared shape or
   colour.

## 3. The lead's five items

### 3.1 The upgraded look in the garage

- **Kit level** `L = ceil(3 × owned ÷ available)`: tiers bought across all tracks over the sum of
  track lengths (9, or 6 for `dozer_d9` and `recon_drone`); 0 when nothing is bought. The seed
  reads `inf_squad` 3/9 → L1, `at_team` 1/9 → L1, `mbt_lavi` 9/9 → L3. A pure function in
  `@lions/data` beside `applyUpgrades`, shared by garage, HUD and renderer option.
- **Rail card:** three pip columns (armour, sensors, firepower), 0–3 filled each; the chip
  separates **Earned**, **Bought** and **Maxed**, since "Owned" is untrue of a unit Conduct opened.
- **Plate:** at L ≥ 1 the frame takes the kit colour (§6) and carries the kit mark (§3.2) at
  48 px top-left with `KIT II`; a kitted plate (§3.3), where one exists, replaces the base at L ≥ 2.
- **Stat delta:** each bar draws base (ink), bought kit (kit colour) and hovered preview
  (`--good`); the figure reads `3750` over a small `+750 kit`. The panel moves into the bay
  under the plate and stays in view (F4).

### 3.2 The sign of an upgrade

A **kit mark** joins the S3e symbol family: a plate with its upper corners bevelled at the
chevron's sweep (`mark.ts`, 14 across over 24 up), holding 1–3 bars for L, at the family's
weight and viewBox and tested the same way (10 px over lit sand). Three **track glyphs** join
it (armour plate, sensor lens, firepower round) for track headers and the card's pip columns.
Four glyphs for the G1 addendum (#165), which already weighs 12 against 18. Neither chevron nor
star, so neither register reads as the other. Until G1 approves the sheet they live in a
garage-local module under the family's property tests, and move into `ui/symbol.ts` when it
lands.

### 3.3 The upgrade section's images

- **Now:** each track header shows its glyph at 40 px over the bay's "reserved, not broken"
  hatch. No asset.
- **Later, Blender:** one close-up per type and track, 49 (17 × 3 less the two types without
  firepower), 480×320 JPEG from the kitted GLB under `lighting.ts`'s sun: the added plates, the
  mast or optic, the gun.
- **Meshy** only for a kit part that is genuinely new geometry (a slat panel with no Blender
  source), announced with a credit estimate first and disclosed in the PR per `CONTRIBUTING.md`'s
  AI policy. Everything else is Blender on the shipped base.
- **Kitted plates:** `pnpm plates:units --kit` photographs the kitted GLB, one JPEG per kitted
  type (~405 KB, today's mean).

### 3.4 The upgraded unit in the game

Tiers are type-wide and fixed for a mission (brigade D3), so the app hands the renderer one
number per type, `RendererOptions.unitKit?: Record<typeId, 0|1|2|3>`. The sim is untouched
(invariant 4); Pixi ignores it. Screen sizes below are read off `game/*` (±20%).

| Option | Draw calls | Legibility at zoom 0.35 / 1 / 2.5 | Verdict |
|---|---|---|---|
| **A. Overlay kit mark**: 3 cells added to `ChevronBatch`'s atlas | **+0 per unit** (one mesh rebuilt per frame; +4 vertices per kitted unit; a second colour is a vertex attribute, at most +1 per frame in total) | 3.5 / 10 / 25 px: presence only / level reads / crisp | **recommended now** (small lane B plan) |
| **B. Kitted GLB variant**, picked at load | **+0** if kit parts merge into existing role primitives (inf squad 7, Lavi 4, read from the GLBs); a new `kit` node would be +1 per unit (+14% squad, +25% Lavi) | Lavi 42 / 120 / 300 px wide, a skirt band ~4 / 12 / 30 px: reads at ≥ 1. Infantry 8 / 22 / 55 px tall: invisible at 0.35 | **recommended for vehicles**, art phase; +1 GLB fetch (0.4–1.5 MiB) per kitted type fielded |
| C. Livery tint per type | +0 | does not read on an 8 px figure; confusable with team colour | rejected |
| D. Projected decal per unit | **+1 per unit**: at a submission-bound 420–460 ceiling a 7-call squad becomes 8, est. ~370–400 | reads at ≥ 1 | rejected |
| E. Instanced ground emblem per type | +1 per kitted type in view (≤ 17) | reads, but sits in the selection ring's register | rejected |

**A's placement:** centred (0, r+16) px above the anchor (r = 7 soft, 11 hard), just over the HP
bar (r+7…r+10), clear of the group badge (top-left) and veterancy (top-right) at both radii.
Side 0 only. **The HUD card** (lane A, DOM) gains kit pips and the delta (`3750 hp · +750 kit`);
it holds its size at every zoom, so it is the legible read at 0.35.

### 3.5 Purchase feedback

**Visual.** F3 is fixed first: the screen re-renders in place, keeping selection, tab, both
scroll offsets and focus. A rung buy sweeps the rung and its pip into the kit colour (240 ms),
stamps the mark 130% → 100%, grows the stat bars old → new (300 ms), counts the wallet down
(400 ms, mono) and moves focus to the next Buy. A unit buy lifts the plate's hatch, stamps
`ENLISTED` and turns the chip to Bought. Reduced motion: colour changes and figures step.

**Sound.** `BattleAudio.playUi(set)` plays any manifest set by name, a clip if it has one and
the synth otherwise; but an unknown name falls to the *alert's* falling tone, the wrong meaning.
Two sets: `ui_purchase` (low clunk, rising two-note) and `ui_upgrade` (ratchet, higher note),
each ≤ 250 ms. Recommended source: **`tools/gen_audio.py`**, which the project owns outright and
which made all eleven shipped battle sets; the alternative is a CC0 recording (Kenney.nl,
Freesound filtered to CC0) with its manifest entry. A use-only library (Zapsplat and the like)
cannot be committed. Either way `audio.ts` gets a rising synth branch for the two names
(~4 lines) so a missing clip never sounds like an alert. The mixer is the existing
`battleAudio()`; a Buy click is itself the first gesture.

## 4. The deeper uplift

- **Hierarchy.** Bay: plate, name and role, the stat panel with kit segments (moved from the
  board), blurb. Board: three compact tracks, each a header (glyph, name, three pips, "tier 2 of
  3"), the **next** rung expanded (price, benefits, Buy), owned and future rungs one line each.
  Estimated ~254 px a track, ~762 px for three: all visible in 1920's 865 px column.
- **What you are buying.** Track headers show spent and to-max (`spent 360 · 1315 to max`); the
  bay shows the unit's kit total. Zero-change lines are dropped (F6); an owned rung previews
  nothing (F5).
- **Comparison.** Shift over a card ghosts that type's bars against the unit in the bay; the rail
  can sort by kit level beside role.
- **Locked and empty.** A locked unit shows its tracks read-only with tier-1 prices and "unlock
  first" (F7). At 0 credits one line says credits come from winning missions. A maxed unit shows
  `MAXED` on card and plate. No account: as today.
- **Keyboard.** Roving tabindex (tabs one stop, cards one stop, F8); arrows select with listbox
  semantics; `1`–`3` jump to a track; Enter buys the focused next tier; focus survives a buy.
- **1920 and 2560.** Same three columns; at ≥ 2200 px the board widens to 34rem and future rungs
  take two lines; the garage's height is fixed inside the viewport (F9).

## 5. Asset manifest

| Asset | State | Path or gate |
|---|---|---|
| Base engine plates, 17 | PRESENT | `assets/ui/plates/units/*.jpg` + `manifest.json` (S3a re-renders) |
| Rail icons | PRESENT | `assets/ui/icons/units/` |
| Kitted plates, one per kitted type | MISSING | kitted GLBs + `plates:units --kit`; with S3a |
| Symbol sheet (12 or 18) | MISSING | `ui/symbol.ts`, G1 #165 |
| Kit mark + 3 track glyphs | MISSING | this spec → G1 addendum |
| Track header placeholders | not an asset | CSS hatch + glyph |
| Per-track close-ups, 49 | MISSING | kitted GLBs + a Blender close-up rig |
| Kitted vehicle GLBs | MISSING | D1 + §6 numbers approved; Blender; Meshy only for new parts |
| Kit overlay atlas cells | MISSING (code-generated) | plan 2; built like `buildChevronTexture` |
| `ui_purchase`, `ui_upgrade` clips | MISSING | D4; `validate:audio` |
| UI synth fallback | PRESENT | `packages/render/src/audio.ts` `playUi` |
| Kit colour | PRESENT as `--rl-gunmetal-0`; semantic `--kit` MISSING | `theme.css` |

## 6. Numbers to approve before anything is rendered

| Item | Number | Reason |
|---|---|---|
| Kit colour | `gunmetal-0` #C3C7C4, 1 px `shadow-0` outline | steel reads as plate; clear of gold (veterancy, credits), team blue, lime selection, the nine group hues |
| Overlay mark | 10×10 px at zoom 1; bars 2 px, 1 px gaps; centre (0, r+16) | clear of badge and chevron at r = 7 and 11 |
| Mark on screen | 3.5 / 10 / 25 px at 0.35 / 1 / 2.5 | overlays scale with zoom (CLAUDE.md) |
| Kit level | `ceil(3·owned/available)`, 0–3 | one rule for 9- and 6-tier types |
| Card pips | 3 × 3, 0.375rem squares, 0.125rem gaps | ~7 px at 1920's UI scale beside a 16 px chip |
| Plate mark | 48 px glyph + `KIT II` at `--t-h3` | reads at 1400; quieter than the name |
| Stamp | 240 ms, scale 1.3 → 1, `--ease` | inside the wallet's 600 ms beat |
| Bars · wallet | 300 ms · 400 ms | the count lands after the bars |
| Sounds | ≤ 250 ms, mono, peak −6 dBFS, gain 0.45 | under `ui_alert`'s 0.5: a shop, not an alarm |
| Vehicle kit geometry | ≥ 10% of hull plan area; ≤ 1 new primitive, target 0 | a 12 px band on the Lavi at zoom 1; +0 draw calls |
| Kitted plate · close-up | 1800×1200 ~405 KB · 480×320 ~40 KB | today's plate mean; ~2 MB for 49 |

## 7. Decisions for the lead

| # | Question | Recommended default |
|---|---|---|
| D1 | In-game tier mark | overlay mark (A) now; kitted vehicle GLBs (B) in the art phase; C–E rejected |
| D2 | One level or three tracks on the map | the summary L on the map; all three on the HUD card and in the garage |
| D3 | Kit colour | steel `gunmetal-0` |
| D4 | Sound source | `tools/gen_audio.py`; a CC0 swap later if wanted |
| D5 | Section images: Blender or Meshy | Blender close-ups of the kitted mesh; Meshy only for new parts, announced |
| D6 | Screen-constant minimum size for the mark | no; keep zoom scaling, the HUD card is the low-zoom read |
| D7 | G1 Q5 (deploy veterancy as "tier pips") | answer "stars"; pips mean kit from now on |
| D8 | Four glyphs added to the G1 sheet | yes |
| D9 | Confirm or undo on an upgrade | none: one click, no refund, economy unchanged |

## 8. Phasing

Three plans. `ThreeRenderer.ts` admits one lane at a time, so plan 2 is scheduled when no other
lane holds it (after the scene host lands, outside A3.x's window).

- **Plan 1, lane A (app), 11 tasks:** in-place re-render with retained state (F3); owned-rung
  preview and zero-delta lines (F5, F6); `kitLevel` in `@lions/data`; card pips and
  Earned/Bought/Maxed; bay stat panel with kit segments; the compact three-track board; locked
  and empty states; keyboard; stamp and count; sound wiring plus the synth branch (`audio.ts`,
  not a `three/` file); HUD card kit pips and a seeded `ui:shots` state `03b-brigade-kitted`.
- **Plan 2, lane B (renderer), 8 tasks:** `RendererOptions.unitKit` and the app feed; atlas
  cells; overlay draw and placement; colour through `resolveColor`; a `kit` debug layer with a
  visible-toggle check; draw calls measured unchanged (`renderer.info`); captures at 0.35/1/2.5;
  docs.
- **Plan 3, lane B (art), 10 tasks, with S3a #180:** kit numbers per vehicle approved; Blender
  kits for the 8 vehicle types; variant picked at load; `validate:meshes` on variants;
  `plates:units --kit`; kitted plates; close-up rig; 49 close-ups; `gen_audio.py` clips;
  provenance and disclosure.

## 9. Risks

- **The golden gate cannot see the mark**: every gated scenario boots a fresh account. Plan 2's
  toggle check and a seeded scenario close that; the scenario moves the baseline once (bless
  from CI numbers).
- **Textured vehicles.** Four of the eight KDF vehicle types (`mbt_lavi`, `ifv_namer`,
  `heli_peten`, `jeep_shoded`) ship Meshy bakes "as is"; a kit part there is palette geometry
  inside a textured GLB (the warehouse roof cap is the precedent) and needs the lead's word.
- **Infantry kit cannot read on the model** at 8 px; only the overlay mark and HUD card carry
  it.
- **Downloads.** Kitted GLBs add to 25.3 MiB already loaded unconditionally, which strengthens
  the case for the lazy per-roster load CLAUDE.md records.
- **First gesture.** If the audio context resumes asynchronously, a session's first Buy can be
  silent; plan 1 tests it by driving the UI.
- **Register drift** if G1 answers Q5 "tier pips" (D7).
