# Roaring Lions against the real Levant: mapping and accuracy gaps

This file compares the game with `regions.md` and `materials-and-palette.md`, for context
only. Nothing here changes the game.

**What I read** (origin/main at 49bb60cfe, 9 Nov 2026):
- `CLAUDE.md`;
- `docs/agent-notes/maps-and-terrain-design.md` and `terrain-rendering.md`;
- `data/palette.json`;
- every `data/maps/*.json` (theme, size, symbol census);
- `packages/app/src/terrain-themes.ts`;
- `packages/render/src/three/time-of-day.ts`;
- `packages/render/src/three/terrain/{mesh,decor-place,prop-place,control-map}.ts`;
- `data/campaign/world.json` and `countries.json`;
- the memory notes `desert-maps-need-desert-foliage.md` and `maps-keep-fight-visible.md`.

**The game's rules this file respects:**
1. The palette is the source of every authored colour. Every fix below names a palette
   key, or says plainly that a new key would be a palette change.
2. Terrain is presentation only. The sim reads the integer grid; no fix touches a mechanic
   or a symbol's meaning.
3. Art numbers go to the lead before any render or Meshy call. Every fix that needs new
   art is marked **[art: lead approval]**.
4. A map's look must keep the fight visible.

ΔE values are CIEDE2000, computed on 9 Nov 2026. Source keys [Sx] resolve in `regions.md`.

---

## 1. What the game has today

| Lever | What exists |
|---|---|
| Themes (`TerrainTheme`) | `arid` (the schema default), `green`, `highland`, `wetland` |
| Grove species override (map) | `grove: olive \| desert \| cedar`. Only the Umm Zeitoun family sets it (olive) |
| Decor families | grass, sand, bush, wet_grass, shrub, reed, tree (olive), desert_tree, cedar, oak, willow, rock, slab, boulder, ditch. GLBs exist for tree, desert_tree, cedar, bush, grass, wet_grass, reed, rock, slab, boulder, sand and ditch. There is **no `oak_*` or `willow_*` GLB** in `assets/meshes/decor/`, so those families still draw their stand-ins (cedar and desert tree) |
| Props | water_tank, satellite_dish, laundry_line, tyre_pile, rebar, jersey_barrier, wrecked_car, round_bale, culvert_pipe, tunnel parts. Roof clutter (a tank or vent) on healthy roofs |
| Structures | shanty `s`, house `h`, apartment `a`, warehouse `w`, concrete `#`, wall `=`, civic hall `m`, camp, clinic, fence, relay, pump house, HESCO, T-wall, sandbags, KDF and militia buildings |
| Ground images | desert_sand_tile (mean `#CBA76F`), green_basin, highland_v2 (terra rossa between grey chips), wetland_open, plus slot tiles for rock, scrub, grove and knoll |
| Light | `day` with the sun at 54.97° elevation; `dawn` at 22°; `dusk` at 18°; `night` is drawn as dusk. Sun keys: limestone.0 (day), limestone.1 (dawn), dust.0 (dusk). Sky key water.0 (gunmetal.1 at dusk). Ground bounce dust.4. Rain weather on wetland only |
| Haze (theme) | arid dust.0 · green limestone.1 · highland karst.0 · wetland overcast.1 |
| Backdrop | one kit, `wadi_halam_kit`, with olive and house batches. Used by Wadi Halam IV, Ein Qasab III and Jebel Matar |

**Campaign geography** (`world.json`):
- **the Marj Strip:** "a dense enclave between the sea and Kedem's coastal plain. No
  mountain, no river, no depth";
- **Sur:** "rockets ... from behind a mountain wall";
- **Naharin:** "a green river basin of terraced pasture and cultivation";
- **map-less countries:** Amar Steppe, Rimon Hills, Kharat Badlands, Zol Erg, Milh Flats.

---

## 2. Themes mapped to real regions

| Theme | Where the game uses it | Closest real region | Fit |
|---|---|---|---|
| `arid` | Marj (Beit Sahwan, Khan Rafid, Deir Amun, Marj Perimeter), Milh Flats, Rujm Sawda, Wadi Tarfan, tutorial and tile studies | **Four different real landscapes**: the southern coastal plain (Gaza), loess and salt flats (northern Negev, Arava), basalt harra (eastern Jordan), and desert wadis (Negev, Sinai) | **Weak.** One bundle (sand image, acacia-like grove, cream limestone rock, orange haze) cannot be all four. See gaps G1, G2 and G8 |
| `highland` | Sur (Tel Marum, Qarn Hadid, Umm Zeitoun) | Upper Galilee and south Lebanon (Jabal Amel), with Hermon foothills for the high massif | **Good rock** (grey karst over terra rossa is exactly right [S10]). **Wrong tree** (cedar, G3). Earth is too ochre (G6) |
| `green` | Naharin, Wadi Halam I-V | Lower Galilee, Jezreel and Beit She'an side valleys, the Yarmouk and south Golan pasture, in the **winter-spring flush** | **Fair.** The idea is right. The green is too saturated and lawn-like (G7). The poplar crown is European (G7) |
| `wetland` | Ein Qasab, Ein Qasab III, Jebel Matar | **Hula valley in winter**: marsh, basalt boulders, oak copses on the Naftali and Golan foot, rain [S18][S25] | **Good.** fen.0 is ΔE 3.8 from a Levantine winter sward. Basalt boulders. The oak and willow GLBs are still stand-ins |

---

## 3. Maps mapped to real places

Tile counts are from the shipped grids. "Analogue" means the closest real character, not a
replica.

| Map(s) | Theme | Campaign region | Closest real analogue | Character notes and mismatches |
|---|---|---|---|---|
| `beit_sahwan_outskirts`, `_2` (Western Terraces), `_3` (Old Town), `_4` (Rubble Quarter) | arid | Marj | **Northern Gaza: Beit Hanoun, Beit Lahia, Gaza City** on the kurkar coastal plain [S5] | The real ground is pale sand, red hamra fields and grey concrete dust, not desert sand. `_2` has 48 `^` tiles and elevation; Gaza's only relief is kurkar ridges below 105 m [S5], so draw `^` as **kurkar** (buff calcarenite), not limestone cliff. Real "terraces" here would be field bunds, not stone hill terraces. Old Town and Rubble Quarter fit the camp density (95,000/km² [S75]). Keep them open per `maps-keep-fight-visible` |
| `khan_rafid`, `_2` (Ward on the Tell), `_3` (Garden Souk) | arid | Marj | **Khan Yunis and Rafah**: a khan (caravanserai) town; al-Mawasi dunes and greenhouses to the west | A tell ward fits: tells are flat-topped mounds [S81]. **Garden Souk** should carry citrus, date palm and greenhouse rows (1,305 ha of greenhouses in Gaza before the war [S76]). Warehouses (`w`, 151 tiles on `khan_rafid`) fit an agricultural depot town |
| `deir_amun`, `_2` (The Bend), `_3` (The Lip) | arid | Marj | **Deir al-Balah**, the "monastery of the date palm", with vast date groves [S89], and the **Wadi Gaza** bend | `_2` has 265 `^` tiles and `_3` has 279 on a region whose blurb says "no mountain". Read them as the Wadi Gaza's incised banks and kurkar bluffs: low, buff and gullied. The single most identifying fix for this town is **date-palm groves** (G2) |
| `marj_perimeter` | arid | Marj | **The Gaza perimeter zone and its Israeli border farmland**: open fields, eucalyptus windbreaks [S66], a kibbutz-like compound | 2,080 of 2,304 tiles are open. It should read as fields (straw in summer, green in winter), not desert. Red-tile roofs inside the KDF compound would be authentic [S78] |
| `tel_marum`, `_1` (Long Valley), `_2` (Terraces), `_3` (Massif) | highland | Sur | **Upper Galilee and the south Lebanon border massif** (Meron 1,208 m, 900-1,200 mm [S14]); `_3` reads as Hermon foothills [S16] | Karst and terra rossa are right. Cedars are wrong below about 1,200 m [S17]. `_2` "Terraces" has no visible terrace risers (G4). If `_3` is framed as high Hermon or Mount Lebanon, cedar and winter snow become correct (G3) |
| `qarn_hadid`, `_2` (Shoulder and Notch), `_3` (Village Fields) | highland | Sur | **The Litani gorge and the Beaufort ridge** (gorge up to about 275 m [S55]); `_3` is a Jabal Amel terraced village | The rock wall with two gates matches the Litani's role as a barrier. Village Fields wants olive and tobacco terraces and stone field walls; today it draws cedar groves (140 `o` tiles) |
| `umm_zeitoun`, `_2` (South Rim), `_3` (Between the Horns), `_4` (Shelf and Summit) | highland, grove olive | Sur | **Olive-terrace basins of Upper Galilee and south Lebanon**; also Samaria [S1] | **The best-matched map family in the game.** "Umm Zeitoun" means "mother of olives", and the override puts olives there. Missing: terrace risers, and cypress or pine accents |
| `wadi_halam_basin` (Fords), `_2` (Bunded Pasture), `_3` (Cattle Track), `_4` (Terraced Village), `_5` (Depot on the Embankment) | green | Naharin | **Yarmouk and south Golan pasture, or the Beit She'an and Harod side valleys, in February-April** | Cattle on open pasture is authentically Golan [S25]. Fords and gallery suit a perennial stream. The gallery tree should be Euphrates poplar, tamarisk or plane, not a Lombardy poplar (G7). Wadi Halam IV's kit terraces and olives are right |
| `ein_qasab` (Reed Spring), `ein_qasab_3` (Lower Causeway) | wetland | Naharin | **Hula valley and Agamon** [S18][S19]: marsh with causeways, a basalt ridge to the west, cultivated downs to the east | Strong match. Real Hula colour notes: papyrus is bright green; *Phragmites* is tan in winter (`dust.5` for reeds is right in winter) |
| `jebel_matar` (The Hill Farm) | wetland | Naharin | **Naftali ridge or western Golan hill farm in winter rain** | Rain and overcast are correct for December-February. Stone field walls and basalt boulders fit |
| `milh_flats`, `milh_flats_l` (Bir Milh) | arid | Milh | **Tel Malhata / Arad basin** (Tell el-Milh, a loess plain [S32]) or an **Arava and Dead Sea sabkha** [S20][S21] | The name says salt ("milh"). The map draws sand. A salt crust, a sabkha damp halo and loess gullies would carry it (G8). Its `b` boulder fields read as a gravel and boulder fan |
| `rujm_sawda` (Black Cairn, 80x80, mesas) | arid | (Amar or Kharat) | **Harrat al-Sham, the Jordanian "Black Desert"** [S46]: basalt boulder fields, qa' mudflats, cairns, cones | **The biggest single mismatch.** "Sawda" means black, yet the map draws cream limestone and orange sand. 360 `b` tiles are exactly the harra mechanic: dense basalt stops vehicles, which use cleared tracks and qa' flats [S46] |
| `wadi_tarfan`, `wadi_tarfan_l` (Three Fords) | arid | n/a | **A Negev or Arava desert wadi** with gravel bars, acacia and tamarisk [S37] | "Tarfa" is Arabic for tamarisk (general knowledge, not confirmed by search). Tamarisk lines along the ford braids would be the signature. The `d` ditches read as loess gullies [S32], which is authentic |
| `tutorial_ground`, `tile_*` | arid, green | n/a | Generic | No mapping needed |

**Map-less countries, for future maps** (suggestions):
- **Zol Erg** → the north Sinai and NW Negev linear-dune erg [S41]: the one place where
  "sand everywhere" is correct.
- **Kharat Badlands** → Lisan marl and Zin loess badlands of the rift and Negev
  [S32][S20].
- **Amar Steppe** → the Syrian Badia: *Artemisia* steppe under 200 mm [S47].
- **Rimon Hills** → "rimon" is pomegranate. Lower Galilee and Shephelah chalk hills
  [S8][S14], or the Makhtesh Ramon rim [S30].

---

## 4. Accuracy gaps, ranked by visual impact

How the ranking was made: (screen area affected) × (maps affected) × (how wrong it is
against the sources). Cost: **palette-only** means changing keys in `terrain-themes.ts`;
**code** means a renderer or schema change (still presentation only); **art** means new
assets.

### G1. Rujm Sawda and every "basalt" place draws in cream limestone and sand

- **What is wrong.** On `arid`, boulders and rock draw limestone.6 `#8C7659`. Weathered
  basalt is `#5C5650` (ΔE 16.4). The ground draws the sand image.
- **Real reference.** Harra basalt is black-brown over buff silt with pale qa' floors
  [S46]. Basalt is the Golan and Hauran signature [S24][S27].
- **Fix.**
  1. Give the map its own look. The cheapest route is a new theme, for example `harra`.
     That is a renderer change: per `map.ts`, "adding a theme is a renderer change; adding
     a MAP is not". It would be built from existing keys:
     - `open`: limestone.5 (a buff silt tone);
     - `rock`: karst.4 and `rockLit` karst.3 (karst would join `paletteRamps`);
     - `decorColors` `boulder:rock` → basalt.0, used as a tint key only, exactly as the
       wetland already does;
     - slot textures: the wetland's `basalt_rock_tile` and `basalt_scree_tile` (they
       exist);
     - `macroHue`: [limestone.4, karst.4];
     - `haze`: limestone.2;
     - `groveFamily`: desert_tree (acacia, which is correct for harra [S46]).
  2. Alternative: a per-map `rock_tint` override, like `grove`. That is a schema field
     plus a renderer read.
- **Cost.** Code plus existing assets. Needs lead approval of the look before render.
  Visual gate: new captures only if a gated scenario uses the map.

### G2. Marj maps (11 of them) draw a desert, but the Marj is a coastal plain

- **What is wrong.** The `arid` bundle gives the Marj an acacia-like `desert_tree` grove,
  a sand image and orange haze.
- **Real reference.** The Gaza coastal plain is BSh at 225-400 mm, with citrus, olives
  [S5], date palms [S89], eucalyptus [S66] and sabra hedges [S65]. Greenhouses are its
  aerial signature [S76]. Its ground is pale dune sand, red hamra fields and grey
  built-up dust [S5][S7].
- **Context.** The lead's 7 Sep ruling took olives off "desert" maps. The ruling was right
  for a true desert, and it hit the Marj because the Marj defaulted to `arid`. This is
  the lead's call to revisit.
- **Fix, staged.**
  - **(a) Now, data only.** Set `grove: olive` on the Marj villages' maps
    (`beit_sahwan_outskirts`, `khan_rafid_3`). It is an existing override, needs no
    code, and is authentic [S5]. Lead decision.
  - **(b) Code.** A `coastal` theme:
    - `open`: limestone.2, the dune and hamra mean (coastal sand `#DCCBA3` is ΔE 2.8 from
      limestone.2);
    - `cover`: [limestone.5, limestone.6, limestone.7];
    - `earth` and `spoil`: terracotta.1 (hamra);
    - `rock`: dust.1 and `rockLit` limestone.2 (kurkar `#C9A97A` is ΔE 4.0 from dust.1);
    - `haze`: limestone.1;
    - grove: olive.
  - **(c) [art: lead approval]** New grove and decor families, in this order of identity:
    1. **date palm** (Deir Amun: one silhouette makes the town);
    2. citrus row (dark, dense, low);
    3. eucalyptus (tall, pale trunk);
    4. prickly-pear hedge (along `=` walls and field edges);
    5. a greenhouse prop for field and yard zones (white, low and long; see G10).

### G3. Cedars on Sur's 300-900 m hills

- **What is wrong.** `highland.groveFamily: cedar` plus `openScatter.tree: cedar`.
- **Real reference.** *Cedrus libani*'s natural range in Lebanon is about 1,200-2,000 m
  [S17], and it survives only as relict groves on high slopes [S15]. The Galilee and
  south Lebanon hills carry Palestine-oak maquis, lentisk, carob, planted Aleppo and stone
  pine, olive terraces and cypress [S63][S64][S54].
- **Fix.**
  - **(a) Data.** `grove: olive` on `qarn_hadid_3` (Village Fields) and the Tel Marum
    valley maps. Keep cedar only on a map framed as high mountain: `tel_marum_3`
    "Massif", and only if the story puts it above about 1,500 m.
  - **(b) [art: lead approval]**
    - The `oak` GLB (*Q. calliprinos*: dark, dense, rounded, 2-5 m). The wetland already
      names the `oak` family and draws a cedar stand-in, so one asset fixes both themes.
    - An Aleppo pine variant for hilltop plantations (dark, in rows [S64]).
  - **(c) Palette.** Foliage stays scrub.1 (VR-05). The research supports dark foliage:
    calliprinos `#3F4A2B` is ΔE 4.3 from olive.2, and pine is ΔE 3.5 from olive.2. The
    VR-05 uniform-separation rule still wins; scrub.1 is an acceptable compromise.

### G4. No terrace risers or dry-stone walls on hill slopes

- **What is wrong.** Open elevation steps draw as smooth Catmull-Rom slopes. Only blocked
  tiles are terraces, and only the Wadi Halam backdrop kit shows real terraces.
- **Real reference.** Terraces and dry walls are the hill-country signature. They are
  dry-laid, dominant since classical times, and up to 60% of the land by a weakly sourced
  survey [S80]. In Lebanon many are abandoned under garrigue [S54].
- **Fix [art: lead approval, code].** A presentation-only riser decor:
  - On `highland` and `green` maps, place a low dry-stone face (karst.2 / karst.3 on
    highland; limestone.4 / limestone.6 on green) along every **open** tile edge where the
    elevation steps by 1 level.
  - Optionally add field-wall lines along `1`/`2` hedge runs.
  - This is derived from the elevation grid the map already has, so the sim and the
    symbols are untouched. The drawn surface must still be what units stand on: sample
    `ground-height.ts`, and keep the riser within the burial bound.
  - The highest-value maps: Tel Marum II "The Terraces", Umm Zeitoun I-IV,
    Qarn Hadid III, Beit Sahwan II.

### G5. Arid haze is a saturated orange

- **What is wrong.** `arid.haze = dust.0` (`#E0B87A`, 46% saturation). It is ΔE 9.3 from a
  real dust-day horizon (`#C9B99A`) and ΔE 28.5 from a clear-day horizon.
- **Real reference.** Ordinary desert and coastal days have a beige-grey or blue-grey
  horizon. Only sharav days go yellow-brown [S68][S69]. A saturated orange haze reads as
  Sahara or Mars (`materials-and-palette.md`, section 7).
- **Fix, palette only.** `arid.haze` → limestone.1 (`#E6D8BE`, 17% saturation), or
  limestone.2. The dusk preset already overrides with `hazeKey: dust.1`, which is right
  for a low sun through dust.
- **Cost.** One key. It moves every arid capture, so it needs a CI bless. Lead approval.

### G6. Arid tufts and highland earth sit on the wrong hue and value

- **Arid tufts.**
  - `arid.cover` = [limestone.2, dust.1, dust.0]: bright orange-yellow tufts on buff
    ground.
  - Real batha and steppe shrubs are darker grey-brown in summer (`#8C826A`, ΔE 21.5 from
    dust.0) or grey-green in winter [S63][S34].
  - **Fix (palette only):** [limestone.5, limestone.6, limestone.7]. These are tufts
    darker than the limestone.3 ground, a value ladder rather than a hue jump. That
    satisfies the `control-map.ts` note that the tuft triple must contrast with the
    ground, and it avoids olive.1, the uniform.
- **Highland earth.**
  - `highland.open = dust.5` (`#806032`, hue 35°, 61% saturation) reads khaki or ochre.
  - Terra rossa is a red-to-yellow-red hue, 2.5YR-5YR [S10][S11]; the dry estimate is
    `#9C5A3C`, ΔE 12.7 from dust.5.
  - The nearest existing key is **terracotta.1** (ΔE 3.6).
  - **Fix:** raise the terra rossa share without making a red field. Keep `open` grey-led
    and push `macroHue` to [karst.1, terracotta.1], or add a theme-only `terra_rossa`
    ramp. A new ramp is a palette change.
  - The real look is grey rock slabs with red seams, about 20-60% rock (est.)
    (`materials-and-palette.md`, section 2).
  - GH-322's approved numbers are the lead's. This is a proposal against them.

### G7. The green basin is lawn-green and its gallery is European

- **What is wrong.** `green.open = grass.2` (`#A6BC66`). That is ΔE 12.3 from a Levantine
  winter sward (`#7E9450`); fen.0 is ΔE 3.8 from it. The wetland's revision 4 already
  moved this way "toward the mood board's Levantine sward" (palette note).
- **Fix 1, palette.** Add `fen` to `green.paletteRamps` (the theme_only mechanism allows
  it) and set `open: fen.0`, with `bladeLit` grass.3. Lead decision; it moves the Wadi
  Halam captures.
- **The gallery tree.**
  - `crownRatio 1.5` was chosen to draw a poplar gallery. A columnar poplar is a
    Lombardy-style European tree.
  - Levant riparian trees are *Populus euphratica* (irregular, spreading, grey-green),
    tamarisk, willow and plane [S49], plus oleander (general knowledge).
  - **Fix 2 (data):** crownRatio about 1.0-1.2. **[art: lead approval]** later: a
    Euphrates poplar or tamarisk family.
- **Season.** Real Naharin pasture is green only from December to April [S2][S67]. That is
  fine if the act is set in winter-spring. A summer variant would be straw, with ground
  limestone.3 and dry grass `#C6B184`, ΔE 3.9 from limestone.3.

### G8. Milh Flats has no salt, and the wadi map has no tamarisk

- **Milh Flats** should read as a sabkha or loess plain:
  - a white halite crust (`#EEEBE2`, limestone.0, ΔE 4.5);
  - a dark damp halo (`#8E877B`, karst.2, ΔE 1.3);
  - grey-cream marl;
  - loess gullies [S20][S32].
  - **Fix (code):** a per-map `macroHue` override, or a `sabkha` look on the arid bundle
    with `macroHue` [limestone.0, limestone.5] and wider macro patches.
    **[art: lead approval]** later: a salt-crust ground tile, polygon-cracked.
- **Wadi Tarfan:** tamarisk (`#7D8A75`, no palette match: olive.0 is ΔE 9.4) along the
  ford braids. A blue-grey feathery shrub family would need a palette entry.
  **[art + palette: lead approval]**

### G9. One season and one weather everywhere but the wetland

- **Real reference.** The defining Levant contrast is winter green against summer straw
  [S2][S67], plus the sharav day [S68].
- **Fix (code, presentation only, read by the app like `time_of_day`).**
  - **A `season` field** (`winter` | `summer`) that swaps the theme's `open`, `cover` and
    `low` tones and grass density.
  - **A `sharav` weather** for arid maps:
    - `hazeKey` limestone.4 (the hamsin horizon `#B8A07A` is ΔE 2.2 from it);
    - `hazeFar` raised from 0.12 to about 0.35-0.45 (est.);
    - sun intensity down about 30% with shadows softened, using the existing `map.light`
      `shadow` lift (PA-24).
  - Both are mood multipliers that cost no new art. Whatever the haze, the fight must stay
    readable (`maps-keep-fight-visible`).

### G10. Roof and field signatures

- **What exists.** Flat roofs, roof clutter, and water tanks, dishes and rebar as yard
  props.
- **Real reference:**
  - **several** black tanks per Palestinian roof [S74];
  - solar water heaters on 85-90% of Israeli roofs [S73] (dark angled panel plus a white
    cylinder): the one rooftop that says "Kedem side";
  - rebar stubs at roof corners.
- **Fix.**
  - **(a)** Check the building GLBs by looking: flat roof and parapet, tank count, rebar.
  - **(b) [art: lead approval]**
    - a `solar_heater` roof-clutter kind for KDF and Kedem buildings and villages;
    - roof-corner rebar on `house`/`apartment` roofs;
    - a greenhouse prop (G2) for the Marj and the Wadi Halam fields;
    - red-tile roofs only for a kibbutz or moshav compound (Marj Perimeter) and for
      Lebanese-style Sur villages [S53][S78].

### G11. Backdrops that name the region

- **What exists.** Only the Wadi Halam kit.
- **The signature skylines in reality:**
  - **Marj:** a flat horizon with the sea to the west.
  - **Sur:** the "mountain wall", with Hermon and Mount Lebanon snow in winter and spring
    [S2][S15].
  - **Milh and Kharat:** a rift escarpment rising 1,000 m or more [S44].
  - **Rujm Sawda:** low volcanic cones [S46].
- **Fix [art: lead approval].** One kit per region, built the way the Wadi Halam kit was
  (`tools/backdrop/`). The backdrop is presentation only and never covers the lozenge.

### G12. Light: keep it, tune per theme

- **Assessment.** The fixed day sun (about 55°) equals equinox noon at 35°N or about 09:30
  in summer (`regions.md`, section 15). Real summer noon is 80-82° with almost no shadow,
  which would hurt readability, so **55° is the right compromise. Keep it.**
- Dawn (22°) and dusk (18°) are realistic low-sun elevations.
- `limestone.0` as noon sun is ΔE 3.3 from a 5,500 K white (`#FFF4E5`). Fine.
- **Optional (per theme, lead approval):**
  - on `arid`, raise `hemiIntensity` slightly: high-albedo desert ground fills shadows;
  - on the coastal and Marj look, raise `hazeFar` a touch for the summer marine haze;
  - on `highland` winter maps, use a crisper, lower haze for the "deep blue after a
    front" day.

---

## 5. What the game already gets right

These are worth keeping and citing.
- **`b` boulder fields as a vehicle wall that infantry can cross.** This is literally the
  Golan and harra reality: basalt boulders "chewed through tank treads" [S26], and dense
  basalt is "extremely difficult, even for modern vehicles" [S46].
- **`d` ditches** read as loess gullies (anti-tank obstacles) [S32].
- **`~` marsh** matches the Hula, which had papyrus and malaria before drainage
  [S18][S19].
- **Highland grey karst with red earth** is the Judea, Galilee and Lebanon mosaic [S10].
- **The wetland's basalt boulders, fen sward and winter rain** are the Hula and Golan foot
  in December-February [S18][S25].
- **Umm Zeitoun's olive override.** An olive basin named "mother of olives".
- **Desert foliage instead of olive on true desert** (the 7 Sep ruling) is right for Milh,
  Wadi Tarfan and Rujm Sawda. Acacia is the desert tree [S37][S46].
- **Props: tanks, dishes, laundry, rebar, tyres, jersey barriers.** All are authentic
  street furniture.
- **Ground grammar.** Roads are lighter than the ground (the arid road is limestone.4);
  this is correct.
- **Elevation rules.** Two levels hide a man, and slope reorders a route only over a
  crest. Both are consistent with the real terrace and wadi tactics in `regions.md`.

---

## 6. A suggested order

Lead approval is needed at each step; nothing here is scheduled.

1. **Palette-only, one bless each:** G5 (arid haze → limestone.1); G6a (arid tufts →
   limestone.5/6/7). These are small diffs with a large mood shift.
2. **Data-only:** G2a and G3a, the `grove: olive` overrides on Marj village maps and Sur
   village maps. G7 crownRatio.
3. **Code with existing assets:** G1, a `harra` look for Rujm Sawda; G2b, a `coastal` look
   for the Marj; G9, `sharav` weather and `season`.
4. **Art, lead-approved numbers first:**
   - date palm (Deir Amun);
   - oak (Sur and wetland);
   - terrace riser (G4);
   - greenhouse;
   - solar heater;
   - eucalyptus, prickly-pear hedge and tamarisk;
   - one backdrop kit per region.

---

## Sources

Keys resolve in `regions.md`. These are the keys used here:

- [S1] https://en.wikipedia.org/wiki/Geography_of_Israel
- [S2] https://en.wikipedia.org/wiki/Climate_of_Israel
- [S5] https://en.wikipedia.org/wiki/Gaza_Strip
- [S7] https://www.levantineceramics.org/petrofabrics/40-israel-central-coastal-plain-red-loamy-soil-hamra
- [S8] https://en.wikipedia.org/wiki/Shephelah
- [S10] https://tour-yehuda.org.il/soils-of-the-judean-hills-and-foothills/
- [S11] https://rgn.hr/images/Projekti/Lowermost_Kimmeridgian/Doc/Field_campaign_10.pdf
- [S14] https://en.wikipedia.org/wiki/Upper_Galilee · https://en.wikipedia.org/wiki/Lower_Galilee
- [S15] https://en.wikipedia.org/wiki/Mount_Lebanon
- [S16] https://en.wikipedia.org/wiki/Anti-Lebanon_Mountains
- [S17] https://datadryad.org/dataset/doi:10.5061/dryad.k0p2ngfdf · https://earthpedia.earth.com/plant-encyclopedia/gymnosperms/pinaceae/cedrus-libani · https://middle-east-online.com/en/node/697252
- [S18] https://en.wikipedia.org/wiki/Hula_Valley
- [S19] https://www.ynetnews.com/environment/article/byoh6t82zx
- [S20] https://en.wikipedia.org/wiki/Dead_Sea
- [S21] https://en.wikipedia.org/wiki/Arabah
- [S24] https://en.wikipedia.org/wiki/Golan_Heights
- [S25] https://www.jewishvirtuallibrary.org/geography-and-geology-of-the-golan-heights
- [S26] https://www.historynet.com/yom-kippur-war-sacrificial-stand-in-the-golan-heights/ · https://warfarehistorynetwork.com/article/israels-survival-at-stake/
- [S27] https://en.wikipedia.org/wiki/Hauran
- [S30] https://en.wikipedia.org/wiki/Makhtesh_Ramon
- [S32] https://meetingorganizer.copernicus.org/EGU21/EGU21-3386.html · https://meetingorganizer.copernicus.org/EGU25/EGU25-5055.html
- [S34] https://springerlink.bibliotecabuap.elogim.com/content/pdf/10.1007/BF00047104.pdf
- [S37] https://arava.org/arava-research-centers/center-for-hyper-arid-socio-ecology/acacia-monitoring/
- [S41] https://cris.bgu.ac.il/en/publications/desert-dunes-morphology-and-dynamics-el-arish-northern-sinai/
- [S44] https://en.wikipedia.org/wiki/Jordanian_Highlands
- [S46] https://en.wikipedia.org/wiki/Harrat_al-Sham · https://ifporient.org/?p=6055
- [S47] https://journals.uair.arizona.edu/index.php/rangelands/article/viewFile/18961/18732
- [S49] https://datazone.birdlife.org/site/factsheet/euphrates-valley-iba-syria/text
- [S53] https://www.hotelibanais.com/travel/traditional-lebanese-house/
- [S54] https://mountainsmagleb.com/2021/03/30/the-most-planted-tree-in-lebanon-the-stone-pine/ · https://lebanontraveler.com/?p=2275
- [S55] https://www.aa.com.tr/en/middle-east/factbox-litani-river-at-the-heart-of-conflict-between-israel-hezbollah/3339901
- [S63] https://www.plantarium.ru/lang/en/page/landscapes/location/1132-1500-1495.html · https://zendy.io/title/10.2307/3236054
- [S64] https://marketingsections.kkl-jnf.org/forestry/wp-content/uploads/sites/11/2025/03/Forestry-Facts-and-Figures-updated-2025-designed.pdf
- [S65] https://averyreview.com/issues/69/patience-as-resistance
- [S66] https://ramat-hanadiv.org.il/en/magazine/the-myth-of-the-eucalyptus
- [S67] https://www.schweizerbart.de/papers/pfg/detail/2015/84784/Multi_temporal_Analysis_of_RapidEye_Data_to_Detect
- [S68] https://www.tau.ac.il/~pinhas/papers/2010/Ganor_et_al_JGR_2010.pdf
- [S69] https://www.mdpi.com/2072-4292/16/14/2651
- [S73] https://en.wikipedia.org/wiki/Solar_power_in_Israel
- [S74] https://jstreet.org/hard-truths-trip-ramallah/
- [S75] https://www.al-monitor.com/originals/2023/11/gaza-refugee-camps-born-during-first-arab-israeli-war · https://www.zochrot.org/camps/camp_details/64/en
- [S76] https://www.un.org/unispal/wp-content/uploads/2024/10/Agricultural-Damage-Assessment-in-the-Gaza-Strip-FAO-report.pdf
- [S78] https://en.wikipedia.org/wiki/Nahalal · https://en.wikipedia.org/wiki/Richard_Kauffmann
- [S80] https://antiquity.ac.uk/projgall/gadot346 · https://tour-yehuda.org.il/agricultural-terraces-in-the-judean-hills/
- [S81] https://britannica.com/EBchecked/topic/586316/tell
- [S89] https://en.wikipedia.org/wiki/Deir_al-Balah
- Game files (origin/main at 49bb60cfe, 9 Nov 2026): `data/palette.json`, `data/maps/*.json`, `packages/app/src/terrain-themes.ts`, `packages/render/src/three/time-of-day.ts`, `packages/render/src/three/terrain/{mesh,decor-place,prop-place,control-map}.ts`, `packages/data/src/map.ts`, `data/campaign/world.json`, `docs/agent-notes/maps-and-terrain-design.md`, `docs/agent-notes/terrain-rendering.md`.
