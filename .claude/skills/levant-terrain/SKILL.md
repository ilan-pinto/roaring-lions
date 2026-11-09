---
name: levant-terrain
description: Expert knowledge of the terrains of the Levant and its neighbours: Israel, Gaza, the West Bank, Jordan, Lebanon, Syria, Sinai and the Nile edges, and southern Turkey. Covers climate and rain gradients, landforms (wadis, terraces, tells, makhteshim, escarpments, basalt fields, dunes, sabkha), rock and soil colours with palette matches, native and planted vegetation by region and season, water, vernacular buildings and rooftops, light and dust haze, and how each terrain shapes movement and sight. Mapped to Roaring Lions' maps, themes, palette, scatter, map symbols and backdrop. Use this whenever you create, retheme, colour, texture, populate or judge a map, ground, terrain shader, vegetation or scatter, rocks, buildings, backdrop, haze or time of day, in three.js/WebGL or WebGPU, or write Meshy prompts for environment art, even when the request just says "make this map look more real" or names a place like Golan, Negev, Gaza, Galilee, Wadi Rum or Beqaa.
---

# Levant terrain for Roaring Lions

You are making the game's ground, plants, rocks, buildings and light read as the Levant at a glance. The world is a fictional Kedem layer over real-feeling geography, so aim for **authentic regional character, not replicas of real places**.

The sourced research (about 85 sources; colours mostly estimated from Munsell values or colour words, matched to palette keys by CIEDE2000) is in `references/`:
- `references/regions.md`: §0 the frame (three gradients, four floras); twelve region profiles (coastal plain, Shephelah, central hills, Jordan Rift, Golan and Hauran, Negev, Sinai, Jordanian plateau and Wadi Rum and the Harra, Syria, Lebanon, southern Turkey, the Nile edges); §13 what makes the Levant recognisable; §14 common mistakes; §15 light and atmosphere.
- `references/materials-and-palette.md`: rock, soil, vegetation, building and light colours as tables, each matched to its nearest `data/palette.json` key with the ΔE.
- `references/game-mapping.md`: each game theme and map matched to a real region, what is already right, and the **ranked accuracy gaps** G1–G12 with concrete fixes in the game's terms.

## The frame: three gradients

Almost every look in the region falls out of these three. Get them right and a map reads as Levantine even with generic assets.

1. **Rain falls from north to south and from west to east.**
   - Northern Israel gets more than 900 mm a year, Jerusalem 525, Beersheba 193 and Eilat 24.
   - Rain comes from November to March; June to September are dry.
   - Every eastern slope is a rain shadow: the Judean Desert, the Beqaa, the Syrian steppe.
2. **Rock is pale limestone in the west, black basalt in the north-east, and red sandstone and pink granite in the far south.**
   - The west is limestone, dolomite, chalk and marl: Israel, Lebanon, western Jordan.
   - The north-east is basalt: the Golan, the Hauran, the Harrat al-Sham.
   - The far south is red sandstone and pink granite: Eilat, south Sinai, Wadi Rum.
3. **Ground is green only in winter, outside irrigation.**
   - The flush of green runs from December to April, then everything turns straw-gold.
   - Only evergreens and irrigated land stay green: olive, oak maquis, planted pine, citrus, bananas.

**Four floras by rainfall:**
- **Mediterranean**, above about 350 mm: oak, pine, maquis.
- **Irano-Turanian steppe**, about 150–350 mm: dwarf shrubs, *Artemisia*.
- **Saharo-Arabian desert**, below about 150 mm: very sparse shrubs, acacia in the wadis.
- **Sudanian rift oases**, at the Dead Sea and the Arava: *Ziziphus*, acacia, date palm.

## What makes it recognisable (ranked)

1. Pale limestone pavement with **red terra rossa** in the joints.
2. **Terraces and dry-stone walls** contouring hill slopes, many abandoned and overgrown.
3. **Olive groves:** grey-green, rounded, 4–8 m, in loose grids on terraces.
4. **Flat-roofed cubic buildings** with water tanks, solar heaters (Israel), satellite dishes and rebar stubs.
5. **Seasonal colour:** a green flush in winter, straw-gold from May to November, with evergreens dark against the straw.
6. **Specific planted trees:**
   - dark Aleppo pine in rows on hills;
   - eucalyptus rows on the plains;
   - date palms in hot valleys and on the south coast;
   - prickly-pear (sabra) hedges at old villages;
   - cypress spires.
7. **Black basalt** in the north-east: boulder-strewn pasture, black villages.
8. **Desert that is mostly stone, not sand:** hamada with desert varnish, loess, cliffs and makhteshim. Dunes only in the north Sinai and western Negev erg, the coastal belts and Wadi Rum.
9. **The rift:** a flat, hot floor below sea level between huge escarpments, with salt and oasis green.
10. **Tells:** flat-topped mounds above valley floors, of which the southern Levant has more than 5,000.

## Common mistakes to refuse

1. **Sand everywhere.** Most desert here is gravel, loess, limestone ledges and chalk.
2. **Wrong trees.**
   - No conifers in the low desert.
   - Cedars only above about 1,200 m on Mount Lebanon; never in the coastal hills, so no cedar on 300–900 m Galilee or south Lebanon hills.
   - Acacia and tamarisk belong in desert wadis and the rift, not the coastal plain.
   - No European broadleaf forest, and no columnar poplar.
3. **Over-saturated green.** Evergreens are dark, dusty and grey-green. Winter grass is a sward of annuals over stony ground, never a lawn.
4. **Wrong rock colour.**
   - Hills are grey-white, not orange.
   - The north-east is near-black basalt.
   - Only the far south is red sandstone and pink granite.
   - The Dead Sea is white salt over pale grey marl.
5. **Bare slopes with no terraces or walls.** They read as generic Mediterranean scrub.
6. **Pitched roofs.** Allowed only for Lebanese red-tile houses, kibbutz and suburban red tiles, and the Harran's beehive cones.
7. **One stone for all buildings.** Jerusalem is stone-faced. Gaza, the camps and most new building is grey concrete block or red brick with concrete.
8. **Uniform haze.** Real days swing between razor-clear blue after a winter front and a yellow-brown dust pall on sharav or hamsin days.

## Light

At 29.5–37°N the noon sun stands at 76–84° in summer and 30–37° in winter. The game's 55° day sun equals equinox noon at 35°N; keep it for readability. Desert light is harsher and whiter than coastal light. Dust days flatten contrast and warm the sky toward yellow-brown. The details are in `references/regions.md` §15.

## How the game maps today, and the top fixes

From `references/game-mapping.md`:
- **Themes to regions:**
  - the Marj maps (Beit Sahwan, Khan Rafid, Deir Amun) ≈ the Gaza coastal plain;
  - Sur (Tel Marum, Qarn Hadid, Umm Zeitoun) ≈ Upper Galilee and south Lebanon;
  - Wadi Halam ≈ south Golan or Yarmouk pasture in winter;
  - Ein Qasab and Jebel Matar ≈ the Hula valley;
  - Milh Flats ≈ a loess plain or salt flat;
  - Rujm Sawda ≈ the Jordanian basalt "Black Desert";
  - Wadi Tarfan ≈ a Negev or Arava wadi.
- **G1. Rujm Sawda is "black cairn" but draws cream limestone and sand** (ΔE 16.4 from weathered basalt). Its boulder fields are exactly the real basalt mechanic, so give it a basalt desert look from existing keys.
- **G2. The Marj maps use the `arid` desert bundle,** but a coastal plain has citrus, olive, date palm, eucalyptus, sabra hedges and greenhouses. Note that `grove: olive` would reverse the lead's 7 Sep no-olives ruling, so it is his call.
- **G3. Replace the cedar stand-ins on Sur's low hills with Palestine oak and pine.** One oak model fixes both themes.
- **G4. Add terrace risers and dry-stone walls** along open one-level elevation steps. Presentation only.
- **G5–G6. Palette-only fixes:**
  - arid haze `dust.0` → `limestone.1`;
  - arid scrub tufts → `limestone.5`–`.7`;
  - highland earth `dust.5` → `terracotta.1` (terra rossa);
  - the green theme's grass is lawn-green, so move it to `fen.0`.
- **G7–G12:** a salt crust on Milh Flats; seasons; sharav dust weather; solar heaters and greenhouses; regional backdrops. The light presets can stay.
- **Already right:** the boulder, ditch and marsh symbols; highland karst over red earth; the wetland look; Umm Zeitoun's olives; desert foliage on true desert; the street props.

## How to use this skill on a task

1. **Name the real region** the map or theme stands for, and read its profile in `references/regions.md`: climate, relief, rock and soil, vegetation by season, water, buildings, light, military terrain.
2. **Pick colours from `references/materials-and-palette.md`,** which already gives the nearest palette key for each material. Colour comes only from `data/palette.json`. A new key is a palette change and needs the lead.
3. **Check the recognisability list and the mistakes list** against your proposal before anything else.
4. **Express fixes in the game's terms:**
   - palette keys and theme bundles;
   - scatter species and density (`SCATTER_DENSITY` 0.75 is settled);
   - map symbols, from the 11-symbol legend in CLAUDE.md;
   - elevation;
   - `time_of_day`;
   - weather, keyed on `RendererOptions.weather`;
   - the backdrop kit.
5. **Respect the rules:**
   - Terrain is presentation only; the sim reads only the integer grid.
   - Maps must keep the fight visible.
   - Desert maps need desert foliage.
   - The lead approves art numbers and a close-up before any render or Meshy call.
   - Every palette change moves the visual gate, so bless it from CI after looking at the pictures.
6. **Order the work cheapest first:** palette-only, then data overrides, then code using existing assets, then new art.

## Scope

Geography and environment art only. The military-terrain notes describe how ground affects movement and line of sight for game design. They are not targeting or operational guidance about real places.
