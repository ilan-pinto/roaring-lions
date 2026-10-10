# Garage upgrade images: numbers (GH-238, item 3)

Status: NUMBERS ONLY, awaiting the lead's approval. Nothing rendered, no code, no Meshy call.

## 1. Census (read from `data/units/kdf/*.json` `upgrades`, 4 Oct 2026)

- 19 KDF units carry `upgrades`; 54 tracks; 162 tiers (every track has exactly 3 tiers).
- Only **three track names exist**: `armour` (19 units), `sensors` (19), `firepower` (16). The three without a firepower track are `dozer_d9`, `recon_drone` and `recon_zikit`.
- So the distinct things to picture are **3 tracks x 3 tiers = 9**, not 162. Tier N is a cumulative patch over base, priced per unit.
- What a tier changes (paths whitelisted in `packages/data/src/upgrades.ts`):
  - armour: `hull.hp`, `hull.armor.front/side/rear` (and `hull.suppression_resistance` on 3 tiers).
  - sensors: `sensors.optics`, `sensors.sight_tiles`.
  - firepower: `weapons[i].accuracy`, `weapons[i].penetration`.
- Every change is a number. None adds, removes or reshapes a part, so no mesh differs between tier 1 and tier 3.

## 2. What an image can honestly show

The mesh does not change with tier, so any render of "the upgraded part" would invent geometry the unit does not have. The images must say **what kind of improvement, and how far up the ladder**, not what the tank looks like.

| Option | Verdict |
|---|---|
| A. Portrait + close-up inset | Dishonest: a close-up of the Lavi's armour at tier 3 is the same pixels as tier 1. 162 tiles that differ only by caption. Each is a Blender render (~minutes). Reject. |
| B. SVG emblems per track and tier | Honest: depicts the improvement category and rung. 9 files, 0 credits, crisp at 24 px, themeable. |
| C. Meshy kit parts | Would need new geometry the game never draws. Credits: preview 30 each (per `tools/src/meshy/args.ts`), remesh 5; even one part per emblem = 9 x 35 = about 315 credits, needs the lead's go-ahead, and the result is unusable below 48 px. Not estimated live: the worktree has no `node_modules`, so `pnpm meshy -- estimate` was not run; figures are from source. Reject. |

## 3. Recommendation: Option B (agree with the brief)

9 tier emblems plus 3 track heads. This extends the S3e placeholder glyphs already in `packages/app/src/ui/kit-sign.ts` (`KIT_SYMBOLS.track`: armour slab, sensors lens, firepower round, G1/GH-165 addendum). Each emblem adds a tier-specific detail so a rung is told apart by shape, not by hue (the file's own rule):

- armour: T1 slab with one panel, T2 two panels, T3 3x3 reactive tile grid.
- sensors: T1 lens, T2 + dashed outer ring, T3 + four reticle ticks.
- firepower: T1 one round, T2 two, T3 three.

Kit stays steel (`--kit` = gunmetal.0): never the gold of veterancy.

## 4. Numbers (Option B)

| Item | Value |
|---|---|
| Emblems | 9 tier + 3 track head = **12 SVG files** |
| viewBox | `0 0 24 24`, `currentColor`, one path group, no gradients, no text |
| Draw sizes | 96 px (rung expanded), 24 px (collapsed rung / track head), 16 px floor |
| Fill | `currentColor` resolved from `--kit` (`gunmetal` ramp idx 0, `#C3C7C4`) |
| Edge | `--kit-edge` (`shadow` ramp idx 0, `#23241F`), outline, never hue alone |
| Locked rung | gunmetal idx 2 (`#5C625F`); owned rung idx 0 on a gunmetal idx 3 chip (`#363B39`) |
| Ramp direction | verified against `data/palette.json`: index 0 is the lightest |
| Colour source | CSS tokens only; no hex in UI source (`validate:ui`) |
| Camera | none: not rendered |
| Gate | 64 px silhouettes: all 9 distinct; read as pure black at 24 px (mock) |
| Paths | `assets/ui/kit/<track>-t<1-3>.svg` (9), `assets/ui/kit/<track>.svg` (3) |
| Source | hand-authored SVG, no `.blend`, no generative tools, no licensing issue |
| Credits | 0 |

Not covered by `validate:assets` (not a sprite). Wiring into the garage is a separate code task; this document touches no UI code.

## 5. Mocks

MOCK, not final art. `docs/art/mocks/garage-upgrade-emblems-MOCK.png`: the nine emblems at 96 px, then at 24 px and in pure black. Generator and SVG: scratchpad `garage-art/emblems_mock.svg`.

## 6. Decisions for the lead

1. Approve Option B and the 12 files, or ask for a different tier detail.
2. Confirm emblems replace the `KIT_SYMBOLS.track` placeholders rather than sit beside them.
