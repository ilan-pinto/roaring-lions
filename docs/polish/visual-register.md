# Roaring Lions: visual register (pass D1)

**Date:** 7 Oct 2026 · **Build:** `62a7f3d3` (`main`, after WP-P1–P5 and pass F) · **Plan:** [`commercial-polish-plan.md`](commercial-polish-plan.md) §7, D1.

This page records the visual language the game **already speaks**. It does not propose a new style. Each section states the rule as it is built, names the file that owns it, and ends with the places where the code disagrees with itself. Those disagreements are listed as defects (**VR-xx**) with their files, for the lead to rule on. Where two existing rules compete, the defect names both and does not pick one.

Sources:

- `data/palette.json`, the one source of every authored colour.
- `packages/app/src/ui/theme.css`, the only file allowed to name a `--rl-*` palette variable. It maps them to semantic tokens.
- `docs/art/style-bible.md` §1, "The register".
- The lighting and render-order rules in `CLAUDE.md` ("The three.js backend").
- The approved HUD language: the commander HUD mock #364 (lead ruling B, 4 Oct). Its spec is `docs/superpowers/specs/2026-10-04-field-commanders-mock.html`.
- The rings and contact marks of #354 (GH-346), in `docs/superpowers/specs/2026-10-02-readability-design.md`.
- Kit on icons: G-P3, in `docs/superpowers/plans/2026-09-27-garage-kit-on-icons.md` and `ui/kit-sign.ts`.
- The alert tiers of #428 (WP-P5): `ui/alerts.ts`, `ui/feed-model.ts` and the `.rl-notice[data-tier]` rules in `theme.css`.

Paths are relative to the repository root. `TR` means `packages/render/src/three/ThreeRenderer.ts` and `OV` means `packages/render/src/three/units/overlays.ts`. Line numbers are at `62a7f3d3`.

---

## 1. Colour philosophy

**The rule.** The world is desaturated and the signals are saturated.

- **Desaturated world.** Hulls, uniforms, masonry and ground stay in the warm, desaturated ramps: `limestone`, `dust`, `olive`, `gunmetal`, `scrub`, `terracotta`, `skin`, `water`, `grass`, `shadow`, and the theme-only `karst`.
- **Reserved signal colours.** Three bands are **runtime only**:
  - `reserved.vfx`: `white_hot`, `fire`, `ember`, `interceptor`, `tracer`
  - `reserved.team`: `kedem`, `hostile`, `hostile_text`, `neutral`
  - `reserved.group`: `g1`–`g9`

  CI rejects them in static art (palette.json `reserved.*.role`). The style bible puts it as "saturated colour is reserved for VFX and team markers … that is what makes VFX pop".
- **The palette is input to lighting.** Since the lit renderer (2026-09-14) the per-pixel palette guarantee is retired. A palette entry is the *albedo* the sun lights, not the colour that lands on screen (`lighting.ts`: "tune by eye, against the lit frame, not against a swatch").
- **Ramps descend in brightness.** Index 0 is the lightest entry in every ramp.
- **The HUD reuses the world's meanings.** `theme.css` "state" block: "these are exactly the colours the battlefield uses to say the same things, so a red on a panel and a red on the map mean one thing." UI source may not contain a colour literal (`pnpm validate:ui`, no allowlist). Translucency is `color-mix()`.
- **Colour is never the only channel.** Units are told apart by silhouette (posture, weapon angle, mass), not by colour (style bible §1). Contact marks code type by shape, and kit is told from veterancy by shape as well as by hue. Each of the four team colours has deuteranopia, protanopia and tritanopia variants, held ≥ ΔE 25 apart (`tools/src/cvd.test.ts`).

---

## 2. Friend, enemy and neutral

| Side | Palette key | Hex (default) | HUD token | World | Minimap |
|---|---|---|---|---|---|
| Player (KDF, side 0) | `team.kedem` | `#2F6FD9` | `--friendly` | ring, outline, pulse | square dot |
| Enemy (side 1) | `team.hostile` | `#D93A2B` | `--bad` (fill), `--bad-text` (`team.hostile_text` `#F26A55`, ≥ 4.5:1 as text) | ring, outline, contact mark, hit flash | triangle |
| Neutral / civilian (side 2) | `team.neutral` | `#E8C33A` | `--warn` | ring, outline | circle |

- **CVD variants.** The HUD tokens follow a colour-vision change live: `:root[data-cvd=…]` re-points four tokens (`theme.css:317-333`). The world and the minimap read `paletteTeamColors(cvd)` and `variantAwareResolver(cvd)` once, at mission boot (`packages/app/src/renderer-options.ts:43,77`, `main.ts` around 1658).
- **Unit bodies carry no team colour.** KDF reads olive. The Sarim irregulars read dust and limestone, with keffiyeh heads (style bible §1). A unit's side is told by its ring, its outline and its contact mark.

**Inconsistencies**

- **VR-01. A mid-mission colour-vision change splits the screen.** The HUD tokens change at once, but the world, the minimap dots and the minimap chrome keep the boot colours until the next mission. The settings hint says so. Until then, a `--warn` feed line and a neutral ring can be two different yellows. Files: `theme.css:303-333`, `renderer-options.ts:43`, `ui/minimap.ts:669`.
  - **Resolved (8 Oct, lead: re-resolve on change):** a colour-vision change now re-colours the world and the minimap in the same instant as the HUD. `Renderer.setTeamColors` (`api.ts`) swaps the backend's `teamColors`/`resolveColor` and re-colours what baked a team colour (the three silhouette materials, the hit-flash outline, the proxy boxes); `Minimap.setTeamColors` re-colours the dots and re-reads the chrome; `bindLiveTeamColors` (`packages/app/src/live-team-colors.ts`) drives both from the settings bus and is unsubscribed by the battlefield disposer. The settings hint no longer says "from the next mission". Evidence: `docs/polish/colour-meaning/02-*`.
- **VR-02. A side above 2 has no single colour.** The silhouette maps it to hostile (`units/silhouette.ts:351`). The minimap gives it `teamColors[2]` with a circle (`minimap.ts:1030`). Contact marks skip it (TR:8103). Rings read `teamColors[side]`, which is undefined there (TR:7624). No shipped mission fields side 3 today.
- **VR-03. Hostile red also means "low health" on a friendly unit.** The world HP bar fills `team.hostile` below 25% on every side (OV:126), as does the structure integrity bar (OV:323). A dying KDF squad wears enemy red over its head. The HUD does the same (`hpTone`, `ui/selection-model.ts:220`, then `--bad`).
  - **Resolved (8 Oct, lead: friendly low health is amber):** `hpBarColorKey`, `buildingIntegrityColorKey` and `hpTone` take whose unit it is. The player's own unit (and a building side 0 holds or produces from) stays on the warn key however low; hostile and neutral keep the red tier. The card's "critical" word follows. The HUD chip/card track fill had never shown its tone -- `.rl-track > i` (`--live`) outranked `.rl-fill-*` on specificity -- and was ruled a bug: the tone rules are now `.rl-track > i.rl-fill-*`, `good` keeps the lime default (`track-tone.test.ts`). Evidence: `docs/polish/colour-meaning/01-*`.
- **VR-04. Neutral yellow carries at least nine meanings:**
  - civilians (ring, outline, minimap)
  - HP mid and integrity mid
  - an unheld objective zone
  - `--warn` feed lines (under fire, reinforced)
  - the minimap objective diamond
  - every minimap alert flash
  - the `halt` order family
  - the hold-clock warning

  Files: OV:122-155, `theme.css:148,208`, `ui/minimap.ts:1018,1104`, `ui/order-sight.ts:137`.

---

## 3. Terrain palette

Owned by `packages/app/src/terrain-themes.ts` (three themes) and `packages/render/src/three/terrain/*`.

| Role | `arid` (default) | `green` | `highland` |
|---|---|---|---|
| open ground | `limestone.3` | `grass.2` | `dust.5` |
| cover 1–3 | `limestone.2`, `dust.1`, `dust.0` | `grass.4`, `scrub.0`, `scrub.1` | `olive.1`, `olive.2`, `olive.3` |
| blocked / rock | `limestone.4` / `limestone.6` (lit `limestone.3`) | same as arid | `karst.3` (lit `karst.1`) |
| road / rut | `limestone.4` / `dust.5` | `dust.3` / `dust.6` | `karst.3` / `dust.5` |
| foliage dark–lit | `olive.2`–`olive.0` | `scrub.1`–`grass.2` | `olive.3`, `scrub.1`, `olive.1` |
| haze | `dust.0` | `limestone.1` | `karst.0` |

- **Albedo is a ratio to its own mean.** Open ground and `^` rock carry a supplied albedo texture, `NoColorSpace`, never mirror-tiled. Terrain is the one named palette exemption, and only its albedo half (`terrain/surface.ts`, `SURFACE_SHADING_EXEMPTION`).
- **Ground decals are albedo ratios** multiplied onto lit ground (`decal-pool.ts`). Tread is `dust.5` on every theme.
- `grass.2` was chosen to sit within 5 of `limestone.3`'s luminance, so unit figure-ground is a change of hue, not of value (palette.json `grass.note`).

**Inconsistencies**

- **VR-05. Olive is two things at once.** palette.json gives the `olive` ramp the role "KDF vehicle hulls, uniforms, tarps". Arid foliage (`leafDark`, `leafMid`, `leafLit`, `low`), highland cover and highland foliage are olive too (`terrain-themes.ts:47-52,129,138-143`). This is the "olive on olive" the lead flagged in GH-346, built into the palette roles.
- **VR-06. `grass` is uncurated.** Its role says "not curated for sprite art … nothing currently stops it appearing there", yet the `load`/`unload` order graphics take `grass.0` as their accent (`ui/order-sight.ts:138-139`). **Resolved:** the transport accent is `limestone.1`, pinned by `order-sight.test.ts`.

---

## 4. Lighting

Owned by `packages/render/src/three/lighting.ts` and `time-of-day.ts`. Pinned in CLAUDE.md.

- **One sun, a side light.** Day is azimuth 135° at altitude 55°, `SUN_DIRECTION (-0.406, 0.819, 0.406)`, so the light comes from the camera's left. A box shows a lit screen-left face and a hemisphere-only screen-right face, and it casts its shadow beside itself. One hemisphere bounce, `dust.4` ground. A 4096² map-wide shadow box. GTAO at half resolution. ACES at exposure 1.0 in `OutputPass`, then SMAA.
- **Three presets, all from palette keys:**

  | preset | sun | sun key | sky key | hemi | `hazeFar` | haze key |
  |---|---|---|---|---|---|---|
  | `dawn` | 2.0, el 22°, az −35° | `limestone.1` | `water.0` | 0.75 | 0.16 | — |
  | `day` | 2.6, 135°/55° | `limestone.0` | `water.0` | 0.9 | 0.12 | — |
  | `dusk` | 1.8, el 18°, az +35° | `dust.0` | `gunmetal.1` | 0.7 | 0.18 | `dust.1` |

  `night` resolves to `dusk`. A mission's `time_of_day` wins over `&tod=`.
- **No asset bakes light.** There are no painted highlights or AO, and no shadow in a texture (style bible §1). The three supplied textured buildings are the lead's named exception for their albedo, not for light.
- **Haze is scene-referred.** It lives inside the fog pass, before the shroud mix, with a far term and a low-lying term.

**Inconsistencies**

- **VR-07. The campaign board is not on this pipeline.** `world-view.ts` writes `LinearSRGBColorSpace` by hand and tags its bake `NoColorSpace`, so the diorama is pass-through where a mission is sRGB plus ACES. This is a recorded scope call (CLAUDE.md, "The campaign board"), and it still means the same assets read differently on two screens.
- **VR-08. Palette hexes are duplicated as fallbacks in render code.** `lighting.ts:97-99`, `time-of-day.ts` (`sunFallback`, `skyFallback`), `buildings.ts:104-106`, `fog-pass.ts:49` (`FOG_TINT_HEX`), `smoke-mesh.ts:245`, and about 30 resolver fallbacks in TR. **Partly resolved:** every non-TR instance now reads `data/palette.json` through `three/palette-hex.ts` (`palette-hex.test.ts` swaps the palette and checks each constant follows). The `ThreeRenderer.ts` resolver fallbacks stay literal, deferred until #444 lands. `buildings.ts`'s `WALL_SOUTH_HEX` and `WALL_EAST_HEX` are not palette entries and are untouched. The TR ones agree with the palette today, but a palette revision would not reach them.
- **VR-09. Two off-palette colours are drawn in the world:**
  - the muzzle smoke `#6B6355` (TR:4442)
  - `CHARRED_TINT_HEX 0x6a5f55`, the wreck char (`units/world-materials.ts:96`)

  **Resolved** (fx ladder): both are `limestone.7` (`#75624A`), the nearest palette entry a world colour may use, read through `paletteHex`. CIEDE2000: smoke 5.81, char 6.24 (char luminance 0.130 against 0.1335, so the lead's detail-over-darkness call still holds). `karst.3` is nearer (3.32 / 4.66) but `karst` is `theme_only`, terrain and decor tint only. `palette-hex.test.ts` now requires `ThreeRenderer.ts` to carry no hex literal at all and swaps the palette to prove the char tint follows.

---

## 5. Materials

- **One flat albedo per part.** Every unit, vehicle and decor GLB ships **zero materials**. Colour is applied at runtime from the role ramp as one albedo per part, `liftTone(ramp)` on a `MeshStandardMaterial`, and the sun, shadows and AO do the shading (`units/world-materials.ts`). `render_team.py`'s `ROLE_PALETTE`/`LIT_GAIN` is not to be ported.
- **Textured exceptions are a named list** on both sides: `house`, `apartment`, `warehouse` and their wrecks (`TEXTURED_BUILDING_TYPES` beside `TEXTURED_MESH_EXEMPT`). They ship their Meshy `base_color` bake in `SRGBColorSpace`, plus metallic-roughness and normal maps. Any other GLB that ships a texture throws.
- **Props** bake vertex colour at load from `prop-role.ts`'s ramp table, never at export.
- **Wrecks** are the same parts, slumped and charred at runtime: one shared charred ramp slice, or a tinted clone per textured material.
- **Faction looks.** KDF takes `olive` and `gunmetal`. The Sarim take `dust` and `limestone`. Skin is the two-entry `skin` ramp. No real army's insignia appear anywhere.

**Inconsistencies**

- **VR-10. The char tint is the one material colour outside the palette** (`CHARRED_TINT_HEX`; see VR-09). **Resolved** with VR-09: `CHARRED_TINT_KEY` `limestone.7`.
- **VR-11. Billboards and meshes can disagree.** `kit.py` changed and the sprite sheets were not re-rendered (CLAUDE.md, Mesh units). The sheets are retired for units, but `&nomesh` and the civilians still reach the billboard path.

---

## 6. Outline usage

- **One outline, team colour.** The occlusion silhouette is an inverted hull **2.5 screen px** wide at every zoom, drawn only where a unit is hidden behind a building or terrain (band 6, `units/silhouette.ts:230`). Its colour is the unit's team colour through the CVD-aware resolver.
- **No outline on open ground.** The "team band" outline variant was measured and **not shipped** (#354, §3.1).
- **The hit flash** reuses the same outline at 1.8× width, with no depth test, for 0.15 s (TR:7731).

**Inconsistencies**

- **VR-12. The hit flash is always hostile-coloured.** It draws `teamColors[1]` (TR:7731), while the pulse it accompanies uses the *target's* side (TR:7719). A friendly unit hit by enemy fire flashes enemy red. **Resolved** (fx ladder): one flash material per side, the target's, with the pulse's own fallback; `ThreeRenderer.fire-link-flash.test.ts`.

---

## 7. Icons

- **Unit pictures are Blender portraits.** A 192 px PNG per unit, rendered by `tools/render_unit_portraits.py` and read through `unitIcon` (`ui/portrait.ts`). The lead-figure variant is used at chip size (≤ 48 px), the whole team above that.
- **Garage plates** are live-game captures (`unitPlate`, `pnpm plates:units`).
- **Role and order marks** are the G1 approved symbol sheet as code (`ui/symbol.ts`): filled shapes only, one weight `W = 2.5` on a 24×24 box, `currentColor`, APP-6-derived frames. The order graphics are in `ui/order-sight.ts`.
- **Kit sits on icons only.** It is 1–3 steel six-pointed stars, drawn as SVG in `--kit` (`gunmetal.0`) with a `--kit-edge` halo (`kitIconSignHtml`, `ui/kit-sign.ts`). It is never a world mark (the lead rejected the world kit plate). Veterancy is gold (`--commend`); kit is steel and never borrows gold.
- **The brand mark** is three chevrons sweeping darker (`--mark-1..3` = `dust.0/.2/.4`, `ui/mark.ts`).

**Inconsistencies**

- **VR-13. The kit glyphs are still placeholders.** **Resolved (9 Oct):** the lead confirmed the 1–3 steel Stars of David on unit icons are FINAL. The unused built-in track glyphs and the PLACEHOLDER wording are deleted from `kit-sign.ts` (the track heads are the approved `assets/ui/kit/` emblems); what remains is the garage bay's plate-with-bars mark (`kitPlateSvg`, `brigade.ts`), which still ships and has no separate ruling. Original finding: `ui/kit-sign.ts` says the S3e symbol family "is not drawn yet" and that its four glyphs are placeholders. `ui/symbol.ts` says the G1 sheet is approved and ported. Either the kit glyphs never joined the approved family, or the comment is stale. The four SVGs in `assets/ui/kit/` are outside the `symbol.ts` geometry rules.
- **VR-14. CLAUDE.md still describes the retired icon pipeline**, `assets/ui/icons/units/<SHEET>.png` via `pnpm icons:units`. That directory and that script no longer exist (`ui/portrait.ts:11-15` records the change). **Already resolved on main:** CLAUDE.md "A unit" and the sprite-renderers bullet name the Blender portrait pipeline, and nothing in it refers to `pnpm icons:units` except to say it is gone.
- **VR-15. The audio toggle uses a lightning glyph** on the menu and the strip (PA-30), which reads as power or charge, not sound.
  - **Resolved (8 Oct):** a speaker with two waves, in the G1 sheet's rules (`symbol.ts`, filled, one weight, 24-box); muted is the silent speaker struck through, its body cut either side of the slash. Evidence: `docs/polish/colour-meaning/03-audio-toggle-before-after.png`.

---

## 8. Typography

Owned by `theme.css:14-55` (faces) and `:260-288` (scale). Every face is self-hosted.

| Face | Token | Job, as documented |
|---|---|---|
| Big Shoulders Display (variable 400–900) | `--font-display` | titles, bands, menu tiles, strip names |
| Barlow 400 / 600 | `--font-body` | all prose (GH-153 replaced mono for prose) |
| IBM Plex Mono 400 / 600 | `--font-mono` | "stays in use by the debug overlay, where columns of numbers ARE the point" (`theme.css:265-270`) |

- **Scale:** `--t-xs` 0.625, `--t-s` 0.6875, `--t-body` 0.75, `--t-m` 0.8125, `--t-band` 0.9375, `--t-strip` 1.0625, `--t-card`/`--t-strip-name` 1.1875, `--t-read`/`--t-l` 1.25, `--t-xl` 1.75, `--t-clock` 2.125 and `--t-hero` clamp(2.125, 7vw, 3.25), all in rem.
- **How it scales.** Everything is in rem, so `--ui-scale` (1, 1.15 at ≥ 1900 px wide, 1.4 at ≥ 2400 px) and the player's `--text-size` scale the whole shell.
- **Tracking:** labels `0.18em`, titles `0.06em`.

**Inconsistencies**

- **VR-16. Mono carries prose** (PA-22). The comment says mono is for the debug overlay. In fact, all 31 `--font-mono` uses are interface text, and about 15 of them are sentences:
  - the whole `.rl-menu` container (`theme.css:3010`), and therefore the campaign cards and the Free Play blurbs
  - the whole `.rl-loading` briefing container (3666)
  - outcome aftermath, reason and radio (1087, 1095, 1109)
  - `.rl-bigbanner__aftermath` (2567), `.rl-titlecard__sub` (2616)
  - `.rl-endaftermath`, `.rl-endwithdrew` (3426, 3434)
  - `.rl-saves__msg`/`__sub` (6012, 5969)
  - the debrief headers (3478, 3485)

  The numeric uses (clocks, prices, key caps) fit the documented job.
- **VR-17. The display face is used for prose in one place:** the tutorial lesson body (`.rl-tutorial .rl-panel__body`, 3633). The comment at 3627 calls it "0.6875rem mono", which is stale twice over.
- **VR-18. Bold is synthesised.** Weight 700 is asked of Barlow and Plex, which ship only 400 and 600, at `theme.css:1097, 1191, 1285, 1937, 1949, 2433, 4799, 4872`. That includes the major-tier feed line.
- **VR-19. The garage has a second type scale.** `--t-title`, `--t-h2`, `--t-h3` and `--t-small` are declared inside the garage, which also re-points `--t-body` to 1rem (`theme.css:4329-4333`, 44 uses). `--t-h2` and `--t-h3` do not exist in `:root`. Nine more font sizes are raw literals, among them a second hero clamp at 2557 and 1.625rem at 1467.
- **VR-20. Button case has no rule** (PA-22):

  | Buttons | Face | Case |
  |---|---|---|
  | menu tiles, Deploy, garage buy/tabs/view, stores shelf | display | uppercase |
  | end screen, debrief, pause, confirm, saves, keymap, the base `.rl-btn` | body | sentence case |

  The end screen's "next mission" leads back to menu tiles in the other register.

  **Resolved** (chrome register): case follows face, face follows the job. Display face in capitals for a menu *tile*, a *tab* or view toggle (now including the pause menu's tabs) and a *stamp* (Deploy, the garage's Buy, the stores' Buy, the debrief's primary); body face, sentence case for every other button, which is an *action* (`.rl-btn`). The debrief's plain buttons were body face in capitals and are sentence case now. Rule stated above `.rl-btn` in `theme.css`; held by `chrome-register.test.ts`.
- **VR-21. Back buttons disagree.**
  - Settings, saves and credits use `rl-btn rl-menu__item data-kind='back'`, so they render display face, uppercase, `--t-l` (no `[data-kind='back']` rule exists).
  - The briefing's back is a plain `.rl-btn` in body face at `--t-body`.

  The comment at `theme.css:5917` says the two look alike. Files: `ui/settings-panel.ts:440`, `ui/saves.ts:273`, `ui/credits.ts:166`, `ui/loading.ts`.
  - **Footer rows (GH-498, 9 Oct, the lead's direction A):** every screen that ends in actions now builds ONE footer row, `ui/foot.ts`'s `screenFoot` with `.rl-foot` in `theme.css`. This covers the garage, the debrief, the campaign board, Saves, Settings, Credits and Free Play. The way back comes first, and forward actions sit at the far edge. Every control in the row is the same height, with its label centred. The column-nav `align-self: flex-start` is gone. The action labels are sentence case in `en.json` ("Campaign map", "Main menu", "Reset brigade account"), and `chrome-register.test.ts` now reads the catalogue as well as the sheet. The garage reset is a dashed `.rl-btn--danger` that sits alone at the far edge, with a "Keep the brigade" escape while it is armed. Settings, Saves, Credits and Free Play keep the row sticky. Evidence: `docs/polish/footers/before-after.jpg`.

---

## 9. Effects intensity

The ladder as authored. Light, shake amplitude and hit-stop are multiplied by the event's `power` (`blast-spec.ts:25-37`).

| Event | Light | Shake | Hit-stop | Power | Source |
|---|---|---|---|---|---|
| mortar landing | 2.0 `vfx.fire`, r 4 | 5 px / 300 ms | 40 ms | 0.3 → 0.6 light, 1.5 px, 12 ms | `data/vfx/shell_impact.json`, `units/shells.ts:269` |
| Grad landing | same | same | same | 0.45 | `shells.ts:274` |
| missile (HEAT) impact | 2.6 | 2 px | — | 1 for a hit, 0.5 for an APS intercept | `missile_impact.json` |
| vehicle kill | 3.5, r 7 | 9 px / 420 ms | 70 ms | `maxHp/3000` | `catastrophic_kill.json`, `explosion-burst.ts:237` |
| building collapse | — | — | — | — | `structure_collapse.json` (shroud cloud and rubble only) |
| muzzle (APFSDS) | 3.8 `white_hot` | 8 px (authored) | — | — | `fire_apfsds.json` |

**After the fx ladder (VR-22/23, 2026-10-08)**, each level at its strongest as spawned (authored value × the event's power):

| Event | Light | Shake | Hit-stop |
|---|---|---|---|
| building collapse (3x3+ footprint, power 1) | 7.0, r 9, on the street outside the camera-facing corner, plus the `collapse_flash` burst drawn through the shroud | 12 px / 520 ms | 90 ms |
| vehicle kill (3000 hp, power 1) | 3.5 (unchanged) | 9 px (unchanged) | 70 ms (unchanged) |
| shell landing (Grad, 0.45) | 4.2 × 0.45 = 1.89 (mortar 1.26) | 2.25 px | 18 ms |
| muzzle flash (one shot) | 1.8: APFSDS 1.8, or a tube's 1.0 + backblast 0.8 | none | none |

The order is held by `three/fx-ladder.test.ts`, through the renderer's own scaling functions. Missile impact (2.6, unscaled for a hit) sits between the shell and the kill and is not one of the four ruled levels.

**Restraint rules already in force:**

- Shake moves a *copy* of the camera.
- Decals are dated on the sim clock.
- The reduced-motion setting collapses the shell's transitions.
- There is no world kit mark and no status mark in the world (the lead's rule).

**Inconsistencies**

- **VR-22. The ladder is inverted at both ends.**
  - A building collapse, a "major event" by the plan's tiers, authors no light, shake or hit-stop, so it ranks below a mortar round.
  - The APFSDS muzzle authors more light (3.8) than a vehicle kill (3.5).

  **Resolved** (fx ladder, lead ruling 2026-10-08: collapse > vehicle kill > shell landing > muzzle flash, for light, shake and hit-stop): see the table above. The collapse reads its new blocks through the kill's own three calls. Measured in `docs/polish/fx-ladder/` (`pnpm blast:capture`, Metal): the collapse holds a 90 ms freeze and peaks at 9.8 px of shake against the kill's 8.0, and the mortar's blast-light toggle went 13684 → 30319 px. Lead ruling on #460 ("make the flash read"): the collapse light moved from the roof to street level outside the +X/+Z corner, rose 4.5 → 7.0, and a brief `collapse_flash` burst (palette keys only, the pooled burst mesh) draws at `COLLAPSE_FLASH_RENDER_ORDER` 5.5, through the band-5 shroud. On the blast-light toggle at 200 ms, same zoom-1 framing: collapse 13244 px / 4.2412 against the Lavi kill's 7259 px / 2.8071 (`mbt_lavi_z1`). On the roof it read 737 px, and on the pad 593.
- **VR-23. Shake on every firing emitter is dead data.** `fire_apfsds` authors 8 px, `fire_heat` 3, `fire_mortar` 2 and `fire_autocannon` 1.5. The fire path reads only their light (TR:4374-4383). Only three call sites push shake: kill, shell and missile. `screen_shake` in `vfx_emitter.schema.json` reads as a feature that every emitter has. **Resolved** (fx ladder): the four values are deleted, the schema describes `screen_shake` as a blast-only block read on four events, and `fx-ladder.test.ts` fails any `weapon_fire` emitter that authors one.

---

## 10. UI chrome

**Direction** (`theme.css:6-11`): a field command post.

- Limestone ink on shadow ground, with hairline gunmetal frames.
- Accent colour is spent only where it reports state.
- Panels are briefing documents. A stamped header band carries the title, and **the band colour ranks the panel**:
  - `--band-mission`, olive: "the briefing, the panel you read"
  - `--band-inspect`, gunmetal: machinery you inspect
  - `--band-alert`, dust: transient, interrupts you
- Square corners.

**Tokens:**

- Surfaces: `--panel-bg` (shadow.1 at 92%), `--panel-frame` (gunmetal.3), `--well`, `--tile-bg`, `--scrim`, `--type-shadow`.
- Ink: `--ink`, `--ink-mute`, `--ink-dim`, `--ink-label`.
- Space: `--s1..--s6` (0.25–2 rem).
- Motion: `--dur-fast` 120, `--dur` 160, `--dur-slow` 250, `--dur-route` 200, `--ease`.

**Layout:**

- The floating HUD is edge-anchored, 0.5 rem off the frame, with the middle of the screen left as map (GH-153).
- The feed, the hint and the order row share the centre column.
- The minimap sits bottom right.
- The interface scales by `--ui-scale` breakpoints.

**Inconsistencies**

- **VR-24. Band ranks are not followed.**
  - The briefing (`.rl-loading`) is not a `panel()` and has no band.
  - The only olive panel is the post-mission debrief (`ui/debrief.ts:77`).
  - The end screen, a persistent decision screen, wears the transient `alert` band (`ui/menu.ts:515`).
  - The tutorial lesson, which the player must read, is `inspect` (`tutorial/panel.ts:22`).
  - The garage, the menu column, the unit card and the tooltip carry no band.
  - `--band-mission` is also used as a plain accent outside bands (`theme.css:1815, 1841, 1895, 3181, 3699, 3938, 4032`).
  - **Resolved** (chrome register): the debrief wears `mission` after a defeat too and the tutorial lesson is `mission`; the rank table is written in `ui/panel.ts`. Full screens (menu, campaign, briefing, garage) and HUD furniture (unit card, tooltip) are not panels and carry no band, by rule. `--band-mission` now colours only a band, the mission stamp and the briefing's own voice (the radio, the briefing's loading bar): the deploy row and bench row moved to the selected register and the wordmark rule to its own `--wordmark-rule`. (The end screen this item names was absorbed into the debrief by GH-417.)
- **VR-25. Credits wear three colours.**
  - `--commend`, which the token comment names as credits: garage, stores (4400, 4786, 5323, 5702, 5725)
  - `--good`: dock, outcome, debrief (2694, 1131, 1141, 3459, 3469)
  - `--accent`: dock tile cost, tooltip cost (2778, 2952)
  - **Resolved** (chrome register): credits are `--commend` everywhere (the dock's balance and the outcome moment were `--good`). The `--accent` costs were not credits but this mission's logistics; they now wear `--info`, the colour the top strip has always given logistics and intel.
- **VR-26. "Selected / on" has six treatments:**
  - `--live`: pause tab, strip chip
  - `--accent` with a 14% fill: garage tab
  - `--accent`/`--well` at 12%: garage card
  - `--roar` at 16%: stores
  - `--kit` at 14%: sort
  - `--band-mission` at 35%: deploy row

  `--friendly` marks owned garage rungs, which borrows a team colour for "owned".

  **Resolved** (chrome register), as a justified two: `--selected` + `--selected-fill` (the garage tab's own accent edge and 14% tint) for every pick-one-of-a-set control, and `--on` (lime) only for a live mission state (the strip's speed chip, an armed button). Copper, steel and both olive treatments are gone; the pause tabs moved from lime to selected. The owned garage rung keeps `--friendly` (not a selection; noted for the lead).
- **VR-27. Disabled has four opacities** (0.35, 0.45, 0.55, 0.6), plus a colour swap with no opacity on the stores (`theme.css:962, 1879, 4038, 809, 4628`). The cursor is `not-allowed` in most places but `default` at 1880 and 4039. **Resolved** (chrome register): one `--disabled-opacity` (0.45, the base button's) and `not-allowed` on every disabled state, including the stores' two colour-swap buttons, the paused speed chips and the inert order.
- **VR-28. Focus is mostly one rule, with gaps.** The global `:focus-visible` is 2 px `--accent`, offset 2 px (987). Four controls swap it for a border colour. `.rl-chip` (2225) and `.rl-deploy__row` (4027) have hover and no focus state. **Resolved** (chrome register): the four `outline: none` swaps are gone, so every focusable control shows the one global ring (the garage rail's cards and rungs draw it inset, like the model plate, because their scroll region clips an outset ring); two duplicate ring rules deleted. `.rl-chip` and `.rl-deploy__row` get it from the global rule.
- **VR-29. The tokens are applied loosely.**
  - 63 of 334 padding, margin and gap values are raw lengths. 25 of them equal a scale step, and the base `.rl-btn` padding is one of them (942).
  - About 19 literal durations sit beside about 15 token uses (220, 240, 300, 320, 400, 600 and 900 ms; 1 s).
  - Progress fills disagree on easing (linear at 929 and 2801, `--ease` elsewhere).
  - Six non-zero `border-radius` values sit in a square-cornered system (744, 922, 1451, 1530, 2440, 5077).
  - **Resolved** (chrome register): every duration and stagger names a rung (new rungs `--dur-stamp` 240, `--dur-long` 300, `--dur-linger` 400, `--dur-spend` 600, `--dur-lift` 900, `--dur-pulse` 1s, `--stagger` 60, `--stagger-beat` 140, each because no rung sat within 7%, or, for `--dur-stamp`, because the garage spec's JS timer runs on it; 320 snapped to 300, 220 to 200). Progress fills and the spinner use `--ease-steady`, everything else `--ease`. Corners are square: radius is 0 or 50%. Three half-rungs `--s0`/`--s1h`/`--s2h` and 36 raw spaces routed; what stays raw is at least 7% off every rung.
- **VR-30. Halos are ad hoc.**
  - The title card's text shadow uses `--scrim`, which the token comment calls the wrong token for exactly that job (`theme.css:78-82` vs 2613-2633).
  - Dock tile labels use `--well`.
  - Blur radii vary (3/8, 12/2, 18/3).
  - **Resolved** (chrome register): one `--halo` token (the `--type-shadow` tone, an em-relative glow capped at the title card's old 3/18), on all 11 text halos, including the title card (was `--scrim`) and the dock tile labels (were `--well`).
- **VR-31. One palette entry carries unrelated tokens:**
  - `--accent` = `--commend` = `--mark-1` (dust.0)
  - `--kit` = `--ink-label` = `--band-ink-dim` (gunmetal.0)
  - `--roar` = `--map-urban` (terracotta.0)

  A retune of one silently moves the others' meaning on screen. `--intercept` has no CSS use.

  **Resolved where it matters** (chrome register): `--accent` is now the interactive colour only (hover, focus, selected); the prices left it (VR-25) and the two decorative labels took `--title-accent`. `--commend`, `--kit` and `--roar` never dress an interactive state. The shared entries themselves are unchanged (no new colours); `--intercept` is kept, its reader is the debug overlay (`render/src/overlay.ts`).

---

## 11. Selection, damage and alert language

### Selection

Numbers from #354 (`units/readability.ts`, `units/selection-ring.ts`):

- **Selected ring:**
  - team colour, core α 0.95
  - 0.10 tile thick, 2.5 px floor
  - `shadow.1` halo at 0.03 tile, α 0.5
  - radius ×1.25 the per-type `RADIUS_BY_TYPE`, or a hull ellipse `ELLIPSE_BY_TYPE` for a ground vehicle (both tables generated)
  - conformed to the ground on 4², 6², 7² or 9² grids
- **Team ring under every unselected unit:** same shape at ×1, 0.05 tile, 1.5 px floor, α 0.55, halo α 0.3.
- **Primary of a multi-selection:** the team hex lightened by 0.45 (`group-overlays.ts:50`, WP-P3). A group order draws **one envelope and one route**, not one per unit (PA-09).
- **Hover:** no ring. A hostile shows its HP bar. A friendly shows its HP bar and a range-envelope preview at 0.6.
- **Officer orders** (#364, ruling B): recipients' rings *lift* to the selected weight. A ring that cannot act keeps its faint weight or takes the amber no-sight tint. No radius is ever drawn, and the officer gets nothing but his own ring. This is a design, not yet built.
- **Group badge:**
  - a 7 px disc in `group.gN`
  - the numeral drawn on the disc in `shadow.1` (PA-18 fix)
  - a 1.5 px `shadow.1` halo at α 0.85
- **Contact marks**, over observed hostiles only, in `teamColors[1]` with a 1.5 px `shadow.1` halo, 22 px above the overlay radius, never smaller on screen than at zoom 1:
  - foot: down chevron
  - vehicle: bar
  - air: up wedge
  - suspected (contact level < 2): hollow diamond

### Damage

| State | World | HUD |
|---|---|---|
| healthy | no bar unless selected or hovered | `--good` |
| damaged | 24×3 px HP bar, 1 px `shadow.1` frame: `scrub.0` > 50%, `team.neutral` > 25%, `team.hostile` below | same thresholds, `--good`/`--warn`/`--bad` |
| suppressed / pinned | `vfx.fire` suppression bar | `--hot` (pinned mark on chip and card, GH-262) |
| mobility / firepower lost | kill pips: mobility `gunmetal.1`, firepower `terracotta.2` | card flags |
| broken (routed) | gait only | `--bad-text` "BROKEN" plus glyph |
| destroyed | procedural wreck, charred, plus scorch and oil decals; blast for a vehicle | `unitLost` feed line, tone `bad` |

### Alerts (#428)

- **Three tiers**, named after the audio cue tiers (`alerts.ts:68`, `cues.ts:41-45`):
  - **minor**: smaller (`--t-band`), opacity 0.88, 7 s dwell
  - **important**: the plain feed line, 9 s
  - **major**: bold, inset bars in the line's own colour, uppercase bold words, 12 s

  Tone, not tier, picks the colour.
- **Repeats merge.** An identical line within 8 s merges as "×N". Lines name the unit and give a bearing ("in view" or a compass word in screen frame). Space jumps to the latest important or major alert.
- **What each kind gets:**

  | Kind | Tier | Tone |
  |---|---|---|
  | under fire | minor | `warn` |
  | foot loss | important | `bad` |
  | vehicle, aircraft or named-veteran loss | major | `bad` |
  | wave | important | `bad` |
  | arrival | important | `info` |
  | reinforce trigger | important | `warn` |
  | objective complete or failed, mission end | major | from the event |

- **Sound-only signals:** pinned, ambush and ROE.

### Inconsistencies

- **VR-32. Tracer lime (`vfx.tracer` `#B8FF5A`) means about twelve things:**
  - the player's tracers
  - control group 1
  - `--live` (armed, toggle-on, progress, minimap viewport and pings)
  - the transport order family and its cursors
  - every route line, node, destination ring and order marker
  - the fallback selection ring
  - the shepherd, tutorial and garrison-hover rings
  - the *held* objective zone

  `OVERLAY_ACCENT_COLOR_KEY` (OV:135) still documents it as the selection ring's default, which A4 retired.
- **VR-33. A move order changes colour on the way to the ground.** The move cursor is the manoeuvre family, `vfx.interceptor` cyan (`order-sight.ts:135`). The route and marker it leaves are tracer lime (TR:8402, 8452). Cyan is also group 2, and `white_hot` is also group 9: palette.json says group hues avoid the colours that mean state, but they share the order families' hues. **Lead question** (chrome register): not unified. It is not a pure token choice: the renderer draws one route and marker for every order and does not know the order family, so routes in the family colour need the order kind on the route (an interface change), and a lime move cursor would collide with the transport family. The lead overrode the cyan proposal. **Resolved** (route colour; the lead's "lime everywhere" ruling on #457): cursor and ground now agree on lime. Cyan and the attack-move red were tried on the ground first (the PM's first ruling) and read too faint on sand (`docs/polish/route-colour/side-by-side.jpg`). Now every order's route and marker draws in one ground key, `ORDER_GROUND_COLOR_KEY` (`render/src/order-ground.ts`, `vfx.tracer`). The manoeuvre family's cursor colour moved to that key (`ORDER_FAMILY_COLOR_KEY.manoeuvre`, `order-sight.ts`), so the move cursor is lime, and so is sweep, which shares the family. The order-row glyph token `--order-manoeuvre` follows. Attack-move keeps its own `team.hostile_text` cursor over a lime route. No new colour. Move now shares lime with the transport family's cursor, and cyan stays group 2's hue only. The group-hue overlap above is otherwise untouched.
- **VR-34. Selected colour depends on garrison.** On open ground the ring is team colour. A garrisoned or overflow unit gets the flat billboard ring in its group colour or lime (TR:8111-8114). **Resolved** (chrome register): the flat fallback ring wears the same team colour (primary-lightened) as the ground ring; the group is still told by the badge.
- **VR-35. Three different "legibility halos":**
  - `shadow.1` for rings, marks, badges and the HP frame. The badge comment calls it "every ring in the world vocabulary" (TR:8122).
  - `shadow.2` for objective zones (OV:210).
  - `shadow.0` for the refuge ping edge (OV:382).

  Route lines, order markers, range envelopes and the tutorial and shepherd rings have no halo at all.

  **Resolved** (chrome register) for the halos that exist: one `WORLD_HALO_COLOR_KEY` (`shadow.1`) in `units/overlays.ts`, read by the objective zone (was `shadow.2`), the refuge ring (was `shadow.0`), the HP frame and every ring, mark, badge and fire-link halo in `ThreeRenderer`. Giving routes, markers, envelopes and the tutorial/shepherd rings a halo would be a new look and is not done.
- **VR-36. The minimap ignores state and tier.**
  - Objectives are always `--warn` there, while the world tints held, unheld and contested (`minimap.ts:1018` vs OV:150-155).
  - Every alert flashes the same amber ring, whatever its tier or tone, so a lost tank and "reinforcements arrived" look alike (`minimap.ts:1104`).
  - Hostiles are triangles with no suspected/identified distinction, while the world draws a hollow diamond for a suspected contact.
  - Bearings in the feed are in screen frame; the minimap is map frame (`alert-place.ts:5-11`).
  - **Resolved** (lead approved the mock, 2026-10-08; `docs/polish/minimap-state.md`):
    - Each objective draws its zone's own rectangle in the world's state colour: held `--live` solid, not held `--warn` dashed and pulsing, contested `--bad` dashed and pulsing, target `--bad` solid. The state comes from `zoneStateOf`, the same rule as the world's outline.
    - The alert ring takes its colour from the alert's tone and its size, width, life and double ring from its tier. Good and info rings settle inward; bad and warn rings spread outward.
    - A suspected contact (`contactLevel` < 2) is a hollow diamond; an identified one stays the solid triangle.
    - By the lead's second ruling, the world's not-held and contested zone outlines are dashed too (`objectiveZoneDashed`), with the colour unchanged. That fixes the deutan/protan held-vs-unheld collapse there as well (ΔE 8–17).
    - The bearing frame is unchanged, by design.
- **VR-37. Tier and tone disagree in places.**
  - A civilian "taken" is tier minor (smaller, 7 s) but tone bad (`alerts.ts:446` vs `mission-notice.ts:49`).
  - The two arrival kinds are both important, but one is `info` and the other `warn`.
  - "Broken" exists in the HUD only, with no world counterpart.
  - Pinned and ambush have a sound and no line.
  - **Resolved** (lead approved, 2026-10-08):
    - A civilian taken is `important`, bad, and gets a ring where they were taken. It is still silent.
    - Both arrival kinds are `minor` + `info`.
    - Broken stays HUD and minimap only, an important bad ring, because of the no-status-marks-in-the-world rule.
    - Pinned is `minor` + `warn`.
    - Ambush is `important` + `bad`, with an `alert.ambush` line and a ring on the first of ours hit that tick, never on the ambusher.
    - Every `Alert` now carries a `tone`.
- **VR-38. Two marks are dead or stale.**
  - `WRECK_MARKER_COLOR_KEY` (`gunmetal.2`, OV:229) is used only by tests.
  - The "min-range ring" is still named as a `resolveColor` consumer (`renderer-options.ts:73`, `packages/data/src/index.ts:509`), but the ring was deleted (TR:8281).
  - **Resolved:** `WRECK_MARKER_COLOR_KEY` and both stale mentions are removed; `overlays.test.ts` now fails if a `*_COLOR_KEY` export has no production reader. That guard found a third, `FIREPOWER_KILL_COLOR_KEY` (three draws no firepower-kill pip); it was a named exemption and is now deleted too, with its fallback constant and the nearest-palette-entry test that existed only for it (Pixi keeps its own off-palette `#8B1E12` literal and never read the key).

---

## 12. The defect list in one place

| ID | Area | Files | Needs |
|---|---|---|---|
| VR-01 | CVD live vs boot | `theme.css`, `renderer-options.ts`, `minimap.ts` | **resolved** (re-resolve on change) |
| VR-02 | side > 2 colour | `silhouette.ts`, `minimap.ts`, TR | latent; no shipped content |
| VR-03 | hostile red as low HP | OV, `selection-model.ts` | **resolved** (friendly = warn; HUD track tone now applies) |
| VR-04 | neutral yellow ×9 | OV, `theme.css`, `minimap.ts`, `order-sight.ts` | lead |
| VR-05 | olive hulls and olive foliage | `palette.json`, `terrain-themes.ts` | lead (GH-346 lineage) |
| VR-06 | uncurated `grass.0` in UI | `order-sight.ts` | **resolved** (#449) |
| VR-07 | campaign board off the lit pipeline | `world-view.ts` | recorded follow-up (CLAUDE.md says the board has been lit since S3a, #332: re-check and close) |
| VR-08 | palette hex fallbacks in render | `lighting.ts`, `fog-pass.ts`, TR … | **resolved** (#449, #452) |
| VR-09 / VR-10 | off-palette smoke and char | TR, `world-materials.ts` | **resolved** (fx ladder) |
| VR-11 | billboard vs mesh drift | `kit.py`, sprites | recorded debt (billboards retired in A3.3: re-check and close) |
| VR-12 | hit flash always hostile | TR | **resolved** (fx ladder) |
| VR-13 | kit glyph placeholders vs G1 | `kit-sign.ts`, `assets/ui/kit` | **resolved** (9 Oct: stars final; placeholder track glyphs deleted; the bay plate mark has no separate ruling, see VR-13) |
| VR-14 | stale icon pipeline in CLAUDE.md | `CLAUDE.md` | **resolved** (already fixed on main, #449) |
| VR-15 | lightning audio glyph | menu, strip | **resolved** (speaker) |
| VR-16–21 | type: mono prose, display prose, faux bold, garage scale, button case, back buttons | `theme.css`, settings/saves/credits/loading | **resolved** (#448; VR-20 case rule in #454) |
| VR-22–23 | effects ladder inverted; dead shake | `data/vfx/*.json`, TR | **resolved** (fx ladder) |
| VR-24–31 | chrome: bands, credits colour, selected, disabled, focus, raw spacing and timing, halos, shared tokens | `theme.css`, `panel()` callers | **resolved** (chrome register, with VR-20) |
| VR-32–38 | world language: lime overload, move colour, garrison ring, halos, minimap, tier/tone, dead marks | OV, TR, `minimap.ts`, `alerts.ts` | VR-32 lead for meaning (stays); VR-33 to VR-38 resolved (VR-33 #457, VR-34/35 #454, VR-36/37 #461, VR-38 #449) |

Nothing here was changed by this pass: the register only records what exists. The fixes belong to D2 (units), B2 (HUD consistency) and C3 (event tiers) once the lead has picked a side for each split rule.
