---
name: explosion-physics
description: >-
  Use this skill for ANY question or change about how an explosion, impact or destruction looks in
  Roaring Lions: blast or fireball size, crater, scorch, dust, smoke column, debris or chunks, shock
  ring, blast light, camera shake, hit-stop, or a building being hit, holed or collapsing (including
  D9 or charge demolition). Trigger on files like data/vfx/*.json, shell_impact, blast-spec.ts,
  blast-shake.ts, shells.ts, hdr-gains for blasts, and on requests such as "the blast looks too
  small", "make the howitzer bigger", "how should the collapse look", "is this shake right", or any
  weapon's splash vs its visual. It gives sourced blast physics (cube-root scaling, fireball,
  overpressure, ejecta, craters, dust, building response) converted to tiles, plus the game's
  presentation-only rules. Not for gameplay damage tuning alone.
---

# Explosion physics for Roaring Lions

You are making explosions look physically right at RTS scale. The physics tells you **how big** things are and in **what order** they happen. Game craft tells you **how long** to show them so a player can see them. Keep that split, and most decisions answer themselves.

The research behind this skill, with every formula and source, is in `references/`:
- `references/physics.md`: scaling laws, the shock wave, fireball, fragments and ejecta, craters, dust, building response (P-I diagrams, breaching, progressive collapse). Read the section you need; it has a table of contents.
- `references/munitions-table.md`: a calibration table for real munitions (grenade to Mk 84), the tile scale, and the GH-1197 155 mm design checked against physics.
- `references/perception-and-vfx.md`: the real 155 mm timeline, what reads at RTS distance, game-VFX craft heuristics, and where physics and craft disagree.

Every number there is tagged sourced, derived or estimate. Carry that tag forward when you quote one.

## Scale facts you need first

- **One tile is 3 m.** `MESH_UNITS_PER_TILE = 3.0`; one GLB unit is 1 m. A 48-tile map is 144 m across.
- At zoom 1 a tile is **45 px** along the ground (about 15 px per metre). The tile diamond's width is 64 px; do not confuse the two (an earlier design was out by √2 because of that).
- The sim runs at 20 Hz and the frame at 60 fps. Most real blast events are faster than one frame.

## The one law: cube-root scaling

Everything visible scales with the cube root of the charge, `W^(1/3)`, where W is kg of TNT equivalent:

- **Scaled distance:** `Z = R / W^(1/3)` (m/kg^(1/3)). The same Z gives the same overpressure for any charge, and times and impulses scale by `W^(1/3)` too.
- **What it means:** a thousand times the explosive reaches only ten times farther. A 155 mm shell has 17x the charge of an 82 mm mortar bomb, but its radii are only **2.6x** larger.
- **TNT equivalent:** Comp B ×1.33 (sources 1.10-1.36), tritonal ×1.05.
- **A burst on the ground** acts like a free-air charge 1.8x heavier, which reaches about 22% farther. Most game impacts are ground bursts.

## Quick formulas (ground burst, W in kg TNT, metres)

| Quantity | Formula | 155 mm M107 (W = 6.86) |
|---|---|---|
| Fireball diameter | `3.2–3.4 · W^(1/3)` | 6.1–6.5 m (radius ≈ 1 tile) |
| Fireball visible life | about 25–60% of `0.20 · W^0.35` s | 0.1–0.25 s |
| 10 psi radius (heavy damage) | ≈ `4.0 · W^(1/3)` | 7.5 m (2.5 tiles) |
| 5 psi radius | ≈ `5.6 · W^(1/3)` | 10.6 m (3.5 tiles) |
| 1 psi radius (windows) | ≈ `16.4 · W^(1/3)` | 31 m |
| Crater diameter, dry soil | `0.8 · W^(1/3)` (±30%); depth ≈ ¼ of that | 1.5 m across, 0.4–0.55 m deep |
| Dense dust column (first seconds) | ≈ `10 · W^(1/3)` (estimate) | ≈ 19 m |
| Bulk ejecta lands within | ≈ 2 crater radii, a fast few to `5–10 · W^(1/3)` | 1.5 m bulk; clods to tens of m |
| Shock reaches 5 psi line | (derived) | 18 ms, about one frame |

For other munitions use the calibration table in `references/munitions-table.md` §2 rather than re-deriving: grenade 0.24, 82 mm 0.40, 81 mm 0.93, RPG-7 1.17, tank HE ~1.5 (estimate), 105 mm 2.18, 120 mm mortar ~4.0, Grad ~6.4, 155 mm 6.86–10.8, Mk 82 91, Mk 84 450 (kg TNT).

## The order of events (physics), and how long to show each (craft)

| Event | Real time | Show it for (60 fps) | Size rule |
|---|---|---|---|
| Flash | < 1 ms | 2–3 frames, white-hot core at 0.3–0.5 of the fireball radius | physics |
| Fireball | 0–5 ms to full size, visible 0.1–0.4 s | grow over 3–5 frames with strong ease-out, yellow-orange darkening under soot | physics |
| Shock | crosses the damage radius in ~10 ms, invisible | a ring over 4–5+ frames (GH-1197 uses 260 ms), shown as lifted dust | **radius physical, time readable** |
| Ejecta | 0.1–2 s up, 1–3 s to land | real time is fine | physics: mostly steep, bulk lands close |
| Dust | dense seconds to a minute, haze for minutes | 5–10 s in game, drifting downwind | height physical, life compressed |
| Leftovers | permanent | crater, scorch about the fireball footprint, scattered clods | prefer contrast to size |

The fire-and-pressure part of any explosion is over in about a third of a second. What lingers is soil and smoke.

## Rules that decide most questions

1. **The drawn damage ring equals the sim's `splash_tiles`.** The sim decides who gets hurt; the picture must not lie about it. Anything drawn beyond it (an outer pressure wave, a dust skirt) must read as clearly fainter and must not look like danger. For a 155 the outer wave at about 1.6 × splash sits on the real 5 psi line, so it is honest too.
2. **Sizes from physics, durations from craft.** Never slow a fireball's growth to seconds or grow it past physics to make it "big"; make it read with brightness, debris and dust instead.
3. **Size things with the cube root.** If one weapon must look "much bigger" than another, check the charge ratio first. A 17x charge only earns 2.6x radii; the rest of the impression comes from a taller dust column, more debris, a longer light pulse and a heavier shake.
4. **The danger reach of real weapons is set by fragments, not blast.** Fragments fly at about 1 km/s for a 155, too fast to draw. The game compresses this to the splash. Do not draw fragments as visible streaks for shells; draw ejecta (soil, stones) instead.
5. **Craters are small in reality.** A 155 makes a crater about 1.5 m across. If it must read, add contrast (a dark rim and a scorch) before you add size. Note when a design exaggerates it (GH-1197 draws it at about 3.5–4x).
6. **Dust is not cover.** Unless the sim treats it as cover, keep blast dust visibly thinner than the smoke screen (GH-1197 caps it at 0.45 density after 0.6 s, against the smoke screen's 0.72), or players will read it as concealment.
7. **Keep the fight visible.** The lead's standing rule: effects must not hide the action. Cap chunk size, settled rubble height and dust density, and say what the cap is.

## Buildings

From `references/physics.md` §7:
- **Damage thresholds** in the classic tables (windows at about 0.5–1 psi; light structural damage at a few psi; masonry walls failing at about 5–10 psi; reinforced concrete much higher) come from large, long blasts. A shell's pressure pulse lasts only a few milliseconds, so walls respond to **impulse**, not peak pressure. The tables overstate a shell's reach against buildings. Use pressure-impulse (P-I) reasoning, and say so.
- **Local breach vs global collapse.** A direct hit or contact charge punches a hole: the near wall spalls and fails. A whole building comes down only when supports fail and the collapse progresses. Draw holes for hits and collapse for destruction, not a collapse for every big hit.
- **Walls fail away from the blast.** Masonry breaks mostly into whole bricks, moving at a few to about 12 m/s, and landing a few to tens of metres from the wall on the far side. Bias debris away from the hit side.
- **Collapse dust:** a plume about 25% above the roof and twice the building's width, dense for seconds to a minute, haze for about 15 minutes. Game shrouds are much shorter, by the lead's ruling, for readability.

## How to use this skill on a task

1. **Identify the munition** and its W (kg TNT) from the calibration table, plus the weapon's `splash_tiles` from `data/units/**.json`.
2. **Compute the physical sizes** with the formulas above. Convert to tiles (÷3) and to pixels at zoom 1 (×15 per metre).
3. **Put the sim's splash beside the physics.** Where they disagree, the drawn damage ring follows the sim (rule 1). Note the gap for the lead rather than silently "fixing" either.
4. **Choose display times** from the timeline table.
5. **Write the numbers as a table** with a physics column, a proposed column and a verdict (realistic / exaggerated by Nx / understated). The lead approves art numbers before any render. The 155 comparison in `references/munitions-table.md` §5 is the model to follow.
6. **Respect the project's rules:**
   - presentation only, nothing read back by the sim;
   - no physics library (hand-written ballistics on the frame clock);
   - palette keys only, with HDR gains in `units/hdr-gains.ts`;
   - render orders from `units/render-order.ts`;
   - every new check shown failing once;
   - blesses only from CI.

## Scope

This skill is about the visible effects of explosions: size, light, timing, debris, dust, craters and structural response. It does not cover making, placing or initiating explosives, or optimising harm, and the references deliberately leave those out.
