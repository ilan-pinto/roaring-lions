# Levant materials and palette reference

These are the colour tables behind `regions.md`. They cover rock, soil, vegetation,
buildings, water and sky, plus light by time of day and region.

## How to read these tables

**Every hex is an ESTIMATE unless a row says otherwise.**
- Published sources give colour as words or Munsell notation (a soil-colour code of hue,
  value and chroma). I converted those by eye to approximate sRGB.
- Where a source gives no colour at all, the hex is my estimate from typical field
  appearance.
- Treat the hex as ±10 per channel, as the centre of a range, never as a single truth.
- A **(src)** tag means the colour *word* or Munsell value is sourced.
- Source keys such as [S10] resolve in the Sources list at the end. They use the same
  numbering as `regions.md`.

**"Nearest key" is the closest entry in the game's `data/palette.json`.**
- It was computed with CIEDE2000 against every ramp entry (my script, 9 Nov 2026). In the
  brackets, ΔE below 3 is a near match, 3 to 6 is close, and above 10 means the palette
  has no colour for it.
- `karst`, `fen`, `mud`, `overcast` and `basalt` are `theme_only`: a map can use them only
  if its theme names them.
- `skin` is a unit ramp and should not carry terrain.

**Wet against dry.** Moist soil and rock read about one to two Munsell value steps darker,
with slightly higher chroma, than dry. In sRGB that is roughly 25-40% darker (est.; the
standard soil practice of recording separate dry and moist colours reflects this [S88]).
Pale porous chalk and loess darken most. Dense basalt goes near-black and glossy.

---

## 1. Rock

| Material | Where | Dry (est.) | Wet (est.) | Nearest key (dry) | Notes |
|---|---|---|---|---|---|
| Chalk (kirton) | Shephelah, Judean Desert, Rosh HaNikra | `#E3DCCB` | `#B9B1A0` | limestone.0 (3.1) | Near-white to cream. Soft, gullied. [S8] |
| Nari crust | Shephelah slopes | `#D6CDBA` | `#A9A08E` | karst.0 (3.2) | "Whitish caliche" (src) [S72]. Patchy white-grey ledges |
| Hard limestone, fresh | Judea, Galilee, Lebanon | `#E9E1D0` | `#BDB4A2` | limestone.0 (1.9) | Cream-white quarry faces |
| Limestone, weathered outcrop | the same | `#B4AFA4` | `#7F7A70` | karst.1 (3.0) | **The usual hill colour**: grey, not cream |
| Limestone, lichen and shade | the same | `#8E8A80` | `#5E5A52` | karst.2 (1.8) | Dark grey streaks and pitting |
| Dolomite, grey | Cenomanian, Judea and Carmel | `#9D978B` | `#6C665C` | karst.1 (4.7) | Mizzi yahudi is "dark grey or yellow" (src) [S72] |
| Jerusalem stone, meleke, fresh | building facing | `#EDE4D1` | n/a | limestone.0 (1.0) | "White" (src) [S72] |
| Meleke, aged | old façades | `#D9C49C` | n/a | limestone.2 (2.4) | "Develops a pleasant yellow hue" (src) [S72]; gold at sunset [S72] |
| Mizzi ahmar | trim, ablaq banding | `#D6B9A2` | n/a | limestone.3 (6.5) | "Light-coloured with reddish bands" (src) [S72] |
| Kurkar (aeolianite) | coastal ridges, Gaza | `#C9A97A` | `#9C7E57` | dust.1 (4.0) | Buff-ochre calcarenite with honeycomb weathering [S4][S6] |
| Basalt, fresh | Golan, Hauran, Harra | `#4A4844` | `#2E2C29` | karst.4 (2.8) | Charcoal. Theme-only basalt.0 `#625A4D` is one step lighter |
| Basalt, weathered and varnished | same | `#5C5650` | `#33302C` | karst.4 (3.3) / basalt.0 (3.8) | Brown-grey. The palette note gives a mood-board reading of `#3C3628`-`#59564D` lit |
| Basalt, lichen-spotted | Golan boulders | `#7A7A70` | `#4E4E47` | karst.2 (5.3) | Pale grey-green lichen patches on the boulder crowns |
| Nubian sandstone, red | Timna, Eilat, Wadi Rum | `#A85A3A` | `#7A3E27` | terracotta.1 (3.8) | "Predominantly red" (src) [S36]; iron-rich [S45] |
| Nubian sandstone, orange | the same | `#C47F4E` | `#8F5634` | terracotta.0 (8.7) | No good palette match |
| Nubian sandstone, yellow and white bands | makhteshim, Timna | `#D8B27A` | `#A6844F` | dust.0 (2.1) | Yellow, orange, grey and black also occur (src) [S36] |
| Granite, pink-red | Eilat, south Sinai | `#B98672` | `#86584A` | skin.0 (3.4) | Do NOT use skin for terrain. A palette gap |
| Granite, grey | the same | `#9A8F86` | `#6A6159` | karst.2 (5.5) | |
| Dike rock, dark | Eilat, Sinai granite | `#3F3A35` | `#27231F` | mud.3 (5.9) | Dikes are about 10% of exposed rock, more than 50% locally (src) [S35]. Dark stripes across pink granite |
| Desert varnish on hamada | Negev, Sinai, Jordan | `#4B3B2E` | n/a | mud.3 (2.9) | "Dark brown to black" (src) [S39] |
| Hamada (gravel pavement), mixed | stony plains | `#8C7A64` | `#62533F` | limestone.6 (2.9) | Varnished chips on a paler matrix [S39] |
| Reg (fine gravel plain) | Sinai, Negev | `#A8977C` | `#7A6B55` | limestone.5 (3.9) | |
| Halite crust | Dead Sea, Sedom | `#EEEBE2` | `#C9C6BE` | limestone.0 (4.5) | Pure white with grey dirt. Halite-cemented pebbles [S20] |
| Lisan marl | rift badlands | `#CFC7B4` | `#9C9483` | karst.0 (3.1) | Pale grey-cream laminated badlands |
| Sabkha, damp patch | Arava, Badia | `#8E877B` | n/a | karst.2 (1.3) | Dark damp halo around a white crust |
| Gypsum | Badia, Euphrates bluffs | `#E6E1D3` | `#BDB7A8` | limestone.0 (3.0) | |

---

## 2. Soil

| Soil | Where | Munsell (src where marked) | Dry (est.) | Moist (est.) | Nearest key (dry) |
|---|---|---|---|---|---|
| Terra rossa | Judea, Galilee, Lebanon, Carmel | Red to brown nuances (src) [S10]. Hue 2.5YR-5YR, e.g. 2.5YR 3/3 moist (src, Croatia) [S11] | `#9C5A3C` | `#6E3B28` | terracotta.1 (3.6) |
| Hamra | coastal plain, Ashdod to Carmel | "Red to reddish-brown" (src) [S7]; about 5YR (est.) | `#A86F4C` | `#7A4A31` | skin.1 (6.9). A palette gap: terracotta.0 is 7.0 |
| Rendzina | chalk and marl foothills | Grey-brown, 10YR (est.) [S10] | `#A79E8C` | `#6E665A` | karst.1 (3.2) |
| Loess | northern Negev | 10YR hue (src) [S33]; 10YR 6/4 "light yellowish brown" (src, related dataset) [S33] | `#BFA684` | `#8A7559` | limestone.4 (1.8) |
| Basaltic grumusol (vertisol) | Golan, eastern Galilee, Hauran | "Dark, fertile, deep" (src) [S25]; about 10YR 3/2-4/2 (est.) | `#6A5A4B` | `#3F342B` | mud.1 (4.0) |
| Coastal dune sand | Gaza, Nitzanim, Ashdod | n/a | `#DCCBA3` | `#B4A27C` | limestone.2 (2.8) |
| Erg sand | north Sinai, NW Negev | n/a | `#D9C08A` | `#B09868` | dust.0 (4.7) |
| Wadi Rum sand | Hisma | Iron-oxide red (src) [S86] | `#C77A4A` | `#97573A` | terracotta.0 (6.8). A gap |
| Valley alluvium | Jezreel, Beqaa, Ghab | n/a | `#6E5E4A` | `#4A3E30` | limestone.7 (2.3) |
| Nile silt | delta and valley | "Black land", Kemet (src) [S60] | `#5A4A38` | `#3E3326` | mud.3 (2.1, moist) |
| Hula peat | drained Hula | Peat that ignited spontaneously (src) [S18] | `#3A332B` | `#2F2A24` | mud.4 (3.3) |

**The terra rossa mosaic.** On hard limestone, soil fills only the joints and solution
pockets, leaving bare rock between. Rock exposure is about 20-60% (est.). Read it at about
1-3 m scale: grey rock slabs with red-brown seams, never a red field.

---

## 3. Vegetation

### Colours

| Plant | Region | Canopy dry season (est.) | Canopy wet season (est.) | Nearest key | Notes |
|---|---|---|---|---|---|
| Olive (*Olea europaea*), shaded | hills, Shephelah, Galilee, Lebanon, Gaza | `#7B8063` | same (evergreen) | olive.1 (6.7) | Grey-green. The underside of the leaf is silver |
| Olive, lit | same | `#9EA287` | same | karst.1 (7.4) | Lit olive is GREY, a 17.8 ΔE value step above olive.1 (the KDF uniform) |
| Aleppo pine | planted forests, northern Jordan | `#46552F` | same | olive.2 (3.5) | Dark, slightly yellow-green |
| Stone pine | Lebanon (planted) | `#3F5230` | same | scrub.1 (4.7) | Umbrella crown |
| Palestine oak (*Q. calliprinos*) | maquis | `#3F4A2B` | same | olive.2 (4.3) | Dark, dull, holly-like |
| Tabor oak (*Q. ithaburensis*) | Lower Galilee, Golan | `#5E6340` | `#6B7A45` | olive.2 / olive.1 | Semi-deciduous, open parkland (general knowledge) |
| Cedar of Lebanon | high Mount Lebanon | `#34483A` | same | olive.3 (8.7) | Blue-green, dark. A palette gap |
| Mediterranean cypress | everywhere planted | `#2E3A2A` | same | olive.3 (4.5) | Black-green spire |
| Carob | hills | `#3D4A2C` | same | olive.2 (4.9) | Glossy, dense, rounded |
| Lentisk (*Pistacia lentiscus*) | maquis and garrigue | `#4E5A35` | same | olive.2 (2.9) | Shrub up to 5 m (src) [S63] |
| Batha (*Sarcopoterium*) | every hill slope | `#8C826A` | `#6E7A4A` | karst.2 (5.4) / olive.1 (2.8) | Up to about 50 cm (src) [S63]. Grey-brown in summer |
| Dry annual grass | everywhere May-Nov | `#C6B184` | n/a | limestone.3 (3.9) | The dominant summer ground colour on soil |
| Winter sward, Levant | Dec-Apr | n/a | `#7E9450` | fen.0 (3.8) | Olive-ward, never lawn-green |
| Spring flush, peak | Feb-Mar, wet years | n/a | `#8DA457` | fen.0 (3.3) | |
| *Artemisia herba-alba* | Badia, Negev steppe | `#9A9A82` | `#8E957A` | karst.1 (6.7) | Silvery grey-green dwarf shrub [S47] |
| *Zygophyllum dumosum* | Negev Highlands | `#6F7158` | same | olive.1 (5.7) | Succulent dwarf shrub [S34] |
| Acacia (*raddiana*, *tortilis*) | Arava, Sinai, Wadi Rum | `#6E7550` | same | olive.1 (1.8) | Sparse, flat-topped [S37] |
| Tamarisk | wadis, the Jordan, Euphrates | `#7D8A75` | same | olive.0 (9.4) | Feathery, blue-grey. A gap [S49] |
| Date palm, frond | rift, south coast, Nile | `#6A7748` | same | olive.1 (2.5) | [S89][S21] |
| Date palm, trunk | same | `#7D6A52` | same | limestone.7 (3.0) | |
| Eucalyptus, leaf | coastal plain, Nile canals | `#6F7E66` | same | olive.1 (8.0) | Grey-blue-green [S66] |
| Eucalyptus, bark | same | `#C9BFAE` | same | karst.0 (4.1) | Pale, peeling |
| Citrus grove | coastal plain, Çukurova | `#2F4A27` | same | scrub.1 (6.3) | Very dark glossy rows, the darkest green in the region |
| Banana | Jordan valley, Kinneret | `#7EA04A` | same | fen.0 (2.5) | Bright yellow-green, under nets |
| Prickly pear (sabra) | old village edges | `#6D8A5A` | same | scrub.0 (3.7) | Blue-green pads in hedges 2-3 m (est.) [S65] |
| *Phragmites* reed | Hula, the Jordan, drains | `#B3A27A` (winter, dead) | `#6E8040` (summer, live) | limestone.4 / scrub.0 | Reeds are tan in WINTER, green in summer. The opposite of the hills |
| Papyrus | Hula | `#6C8F3A` | same | scrub.0 (4.0) | [S18] |
| Irrigated field, Nile | delta, valley | `#5E8A32` | same | scrub.0 (4.5) | |
| Berseem clover | Nile winter | n/a | `#4F7F2A` | scrub.0 (7.0) | The most saturated green in the study |
| Cotton | Çukurova, Harran, Euphrates | `#6F8A45` (Jun-Sep) | n/a | scrub.0 (1.6) | |
| Wheat, green | Hauran, Beqaa, Negev loess | n/a | `#789A4A` | fen.0 (2.4) | |
| Wheat, ripe | May-Jun | `#CDB273` | n/a | dust.0 (4.7) | |

### Height and cover

All values are estimates except where a source is marked.

| Formation | Height | Cover | Rainfall |
|---|---|---|---|
| Oak maquis | 2-5 m | 60-100% | 500 mm+ |
| Garrigue | 0.5-2 m | 30-60% | 400 mm+ |
| Batha | up to 0.5 m (src) [S63] | 20-50% | 300-600 mm |
| Olive grove | 4-8 m, trees 6-10 m apart | 25-45% canopy | |
| Aleppo pine forest | 8-15 m | 50-80% | (Yatir at the desert edge [S64]) |
| Steppe shrub | 0.2-0.6 m | 10-30% (src, Sede Boker rocky slopes) [S34] | 100-300 mm |
| Desert | | below 10% (src, Sede Boker colluvium) [S34] | below 100 mm |
| Acacia wadi | trees 3-8 m | under 5% overall | (a Sudanese study gives 5 trees/ha, which is not a Levant figure) |
| Riparian thicket | 3-10 m | 80-100% in a ribbon 10-200 m wide | |

---

## 4. Buildings

| Element | Region | Colour (est.) | Nearest key | Notes |
|---|---|---|---|---|
| Concrete, new | everywhere modern | `#ABA79F` | karst.1 (2.7) | The DOMINANT building colour in Gaza, the camps and new towns |
| Concrete, weathered | same | `#8F8A80` | karst.2 (1.9) | With rust streaks below the rebar |
| Cinder block (unrendered) | camps, Bedouin, Egypt | `#9C978D` | karst.1 (4.9) | Visible coursing, grey |
| Whitewash or white render | Tel Aviv, older villages | `#E7E3D8` | limestone.0 (3.8) | |
| Ochre render | Lebanese and Syrian towns | `#D8C3A0` | limestone.2 (1.5) | |
| Jerusalem stone | Jerusalem, Israeli hill towns | see Rock, section 1 | limestone.0 to limestone.2 | Required by the 1918 bylaw in Jerusalem [S72] |
| Basalt masonry | Golan, Hauran, Umm el-Jimal | `#4A4844`-`#5C5650` | karst.4 | Corbelled slab roofs [S28] |
| Red roof tile | Lebanese central-hall house, kibbutz, suburbs | `#B5583A` | terracotta.0 (5.4) | [S53][S78] |
| Fired red brick, Egypt | Nile villages | `#9E513A` | terracotta.1 (2.7) | "Unpainted red brick and concrete" (src) [S61] |
| Mud brick | Nile, Euphrates, Harran | `#9C8262` | limestone.5 (3.6) | [S61][S59] |
| Mud plaster, Harran domes | Harran | `#C6A880` | limestone.4 (3.8) | [S59] |
| Black polyethylene water tank | every Palestinian roof | `#232323` | shadow.0 (3.7) | Several per roof (src) [S74] |
| Solar water heater | every Israeli roof | panel `#2E3742`, tank `#E4E3DE` | gunmetal.3 / limestone.0 | 85-90% of homes (src) [S73]. Angled dark panel plus a white horizontal cylinder |
| Rebar stubs | roof edges | `#7A4A30` | terracotta.2 (5.4) | Rust streaks run down the walls |
| Corrugated tin | shanties, Bedouin, sheds | `#9A9C98` | gunmetal.1 (3.4) | [S77] |
| Greenhouse plastic | Gaza, western Negev, Arava, Jordan valley | `#E9ECE6` | limestone.0 (7.1) | Blinding white from above. 1,305 ha in Gaza before the war (src) [S76] |
| Goat-hair tent | Bedouin | `#2B2622` | mud.4 (3.5) | Black-brown, low and long. Rare today [S77] |
| Asphalt | main roads | `#4E4D4A` | karst.4 (2.6) | Bleaches to `#6E6C66` (est.) |
| Dirt track | everywhere | `#B9A27E` | limestone.4 (1.7) | Paler than the ground beside it: compacted, dusty |

**Building silhouette rules** (sources in `regions.md`, sections 1, 3, 10, 11, 12):
- Flat roofs with a parapet everywhere, apart from these exceptions:
  - Lebanese red-tile pyramid roofs [S53];
  - kibbutz, moshav and suburban red-tile houses [S78];
  - Harran beehive cones [S59];
  - Hauran corbelled slab roofs, which are flat [S28].
- Roof clutter on every flat roof: tanks [S74], heaters [S73], dishes [S74] and rebar.
- Ottoman and British-era landmarks:
  - Tegart forts: 55-62 concrete police fortresses with a central tower block, built
    mainly in 1940-41 [S79];
  - khans (caravanserais) with a courtyard (general knowledge).

---

## 5. Water

| Water | Colour (est.) | Nearest key | Notes |
|---|---|---|---|
| Mediterranean, near shore over sand | `#3E8FA8` | water.1 (12.2) | Turquoise over sand, then deep blue. A palette gap |
| Mediterranean, offshore | `#2F6B8A` | water.1 (5.0) | |
| Sea of Galilee | `#4F7E8C` | water.1 (6.8) | Steel-blue, with a basalt shore |
| Dead Sea, shallow over salt | `#5FAFAA` | water.0 (16.9) | Milky turquoise with a white salt rim. A palette gap |
| Dead Sea, deep | `#3D7F8E` | water.1 (8.7) | |
| Nile and canals | `#4E6E6A` | gunmetal.2 (9.9) | Green-brown and opaque |
| Flash flood | `#8A6E4E` | limestone.6 (est.) | A coffee-brown sheet. It lasts hours [S2] |

---

## 6. Sky and light

### Sky and sun colours

| Condition | Zenith | Horizon | Sun | Notes |
|---|---|---|---|---|
| Clear winter, after a front | `#3F6FB0` | `#BFD2DC` | `#FFF4E5` | Deep blue and crisp. Hermon's snow visible far away. Nearest: water.1 (9.1) / water.0 (4.5) |
| Clear summer, inland | `#6A92C2` | `#C9D6DA` | `#FFF7EC` | Paler; glare |
| Summer coastal haze | `#7C9DC2` | `#D3D8D6` | `#FFF2E0` | A milky veil. Nearest gunmetal.0 / overcast.0 (4.1) |
| Ordinary dust day | `#9FB0BE` | `#C9B99A` | `#F7EAD2` | Nearest limestone.3 (2.0) |
| Sharav / hamsin | `#B8A88A` | `#B8A07A` | `#F0D8A8`, a disc | Nearest limestone.4 (2.2). A yellow-grey dome with no blue [S68] |
| Low sun through dust | n/a | n/a | `#F2A85C` | dust.1 (7.8) |

### Light parameters by time of day

Sun elevations are calculated for about 31-33°N (see `regions.md`, section 15). Colour
temperatures are from [S71].

| Time | Sun elevation | Direct sun (CCT) | Shadow fill | Shadow/height ratio |
|---|---|---|---|---|
| Summer noon | 80-82° | about 5,500 K, near-white | strong ground bounce, warm | 0.14-0.17 |
| Equinox noon | 57-59° | about 5,500 K | | 0.6-0.65 |
| Winter noon | 34-36° | about 5,000-5,500 K (est.) | sky-blue fill | 1.4-1.5 |
| Summer 09:00 | about 49.5° | about 4,500-5,000 K (est.) | | about 0.85 |
| Dawn and dusk, sun at 15-20° | 15-20° | 3,000-4,000 K (est.); about 2,800 K at the horizon [S71] | | 2.7-3.7 |

### Atmosphere by region (est. unless sourced)

| Region | Usual visibility | Haze tint | Contrast |
|---|---|---|---|
| Coastal plain, summer | 10-25 km | blue-grey milky | low in the distance; foreground is warm |
| Coastal plain, winter clear | 50 km or more | blue | high |
| Central hills, winter | 50 km or more | blue | very high, with long shadows |
| Rift / Dead Sea | 10-30 km | milky pale; the far shore a pale silhouette | low |
| Negev / Sinai, ordinary day | 30-60 km | pale beige-grey | very high, with bright bounce in the shadows |
| Any region on a dust day | 1-5 km | yellow-beige [S68][S69] | very low |
| Golan / Hauran | 30-80 km | blue | high, with black rock against pale grass |

Mean AOD at Sede Boker is about 0.21 at 440 nm [S69]. Spring and summer peak; winter is
cleanest [S69].

---

## 7. Craft notes for the renderer

These are general craft notes [S82], adapted to this region (est.).

- **Aerial perspective.** Saturation and contrast fall with distance and lightness rises.
  Apply haze more strongly over land than over open sky or water [S82].
- **The haze hue carries the identity.**
  - blue-grey for the hills and coast in winter;
  - beige for the desert;
  - milky for the rift;
  - yellow-brown only for sharav.
  A saturated orange haze reads as Sahara or Mars, not the Levant.
- **Value structure, from darkest to lightest:**
  1. evergreen trees;
  2. basalt;
  3. shadow;
  4. soil;
  5. limestone outcrop;
  6. chalk, salt, dust-coated roads and greenhouse plastic.
  Paths and roads are almost always LIGHTER than the ground beside them.
- **Vegetation and soil separate by value, not hue.** Dark grey-green canopies sit on pale
  grey-buff ground. If foliage needs separating from olive uniforms, push the canopy
  lighter and greyer, as a lit olive does: lit olive `#9EA287` against KDF olive.1
  `#6E7449` is ΔE 17.8. Do not push it bluer.

---

## Sources

Same keys as `regions.md`. The full list is there; these are the keys used in this file.

- [S2] https://en.wikipedia.org/wiki/Climate_of_Israel
- [S4] https://cris.biu.ac.il/en/publications/mode-and-timing-of-kurkar-and-hamra-formation-central-coastal-pla/
- [S6] https://www.wikiwand.com/en/articles/Sharon_Escarpment · https://wikipedia.com/wiki/Kurkar
- [S7] https://www.levantineceramics.org/petrofabrics/40-israel-central-coastal-plain-red-loamy-soil-hamra
- [S8] https://en.wikipedia.org/wiki/Shephelah
- [S10] https://tour-yehuda.org.il/soils-of-the-judean-hills-and-foothills/
- [S11] https://rgn.hr/images/Projekti/Lowermost_Kimmeridgian/Doc/Field_campaign_10.pdf
- [S18] https://en.wikipedia.org/wiki/Hula_Valley
- [S20] https://en.wikipedia.org/wiki/Dead_Sea
- [S21] https://en.wikipedia.org/wiki/Arabah
- [S25] https://www.jewishvirtuallibrary.org/geography-and-geology-of-the-golan-heights
- [S28] https://www.pathsofjordan.net/the-christian-hauran · https://heritagesciencejournal.springeropen.com/articles/10.1186/s40494-022-00727-0
- [S33] https://meetingorganizer.copernicus.org/EGU2019/EGU2019-10658.pdf
- [S34] https://springerlink.bibliotecabuap.elogim.com/content/pdf/10.1007/BF00047104.pdf · https://arxiv.org/pdf/2301.12696
- [S35] https://en.wikipedia.org/wiki/Eilat_Mountains · https://in.bgu.ac.il:443/teva/geological/eng/ykatzir/Documents/2006%20Katzir%20et%20al%20IJES.pdf
- [S36] https://en.wikipedia.org/wiki/Timna_Valley · https://www.internationalparks.org/israel/Timna%20Valley
- [S37] https://arava.org/arava-research-centers/center-for-hyper-arid-socio-ecology/acacia-monitoring/
- [S39] https://en.wikipedia.org/wiki/Desert_pavement · https://ismanual.voices.wooster.edu/wp-content/uploads/sites/44/2012/12/Meredith.pdf
- [S45] https://en.wikipedia.org/wiki/Wadi_Rum
- [S47] https://journals.uair.arizona.edu/index.php/rangelands/article/viewFile/18961/18732
- [S49] https://datazone.birdlife.org/site/factsheet/euphrates-valley-iba-syria/text
- [S53] https://www.hotelibanais.com/travel/traditional-lebanese-house/
- [S59] https://avesis.ktu.edu.tr/yayin/35ad84fd-d3f4-474d-b133-8a0a8024e82f/vernacular-domed-houses-of-harran-turkey
- [S60] https://st-takla.org/General-Knowledge-Articles/01-a-Egyptian-Info/Egypt-Info-02-Land-and-Resources.html
- [S61] https://www.britannica.com/place/Egypt/Rural-settlement
- [S63] https://www.plantarium.ru/lang/en/page/landscapes/location/1132-1500-1495.html · https://wildflowers.co.il/english/plant.asp?id=268
- [S64] https://marketingsections.kkl-jnf.org/forestry/wp-content/uploads/sites/11/2025/03/Forestry-Facts-and-Figures-updated-2025-designed.pdf
- [S65] https://averyreview.com/issues/69/patience-as-resistance
- [S66] https://ramat-hanadiv.org.il/en/magazine/the-myth-of-the-eucalyptus
- [S68] https://www.tau.ac.il/~pinhas/papers/2010/Ganor_et_al_JGR_2010.pdf · https://arabist.net/blog/2007/4/17/the-khamseen.html
- [S69] https://www.mdpi.com/2072-4292/16/14/2651 · https://acp.copernicus.org/articles/14/7213/2014/acp-14-7213-2014-supplement.pdf
- [S71] https://www.artistsnetwork.com/art-techniques/correlated-color-temperatures/amp · https://research.dial.uclouvain.be/bitstreams/35fa3fba-6ab2-4009-aa20-636238dacab3/download
- [S72] https://en.wikipedia.org/wiki/Jerusalem_stone
- [S73] https://en.wikipedia.org/wiki/Solar_power_in_Israel · https://trellis.net/article/1980s-solar-water-heaters-took-israel-stalled-us-its-simple-fix/
- [S74] https://jstreet.org/hard-truths-trip-ramallah/ · https://scalar.usc.edu/nehvectors/how-to-see-palestine/r-is-for-roofscape.2
- [S76] https://www.un.org/unispal/wp-content/uploads/2024/10/Agricultural-Damage-Assessment-in-the-Gaza-Strip-FAO-report.pdf
- [S77] https://law.acri.org.il/en/wp-content/uploads/2014/02/Bedouin-Facts-and-Figures.pdf
- [S78] https://en.wikipedia.org/wiki/Nahalal · https://en.wikipedia.org/wiki/Richard_Kauffmann
- [S79] https://en.wikipedia.org/wiki/Tegart_fort
- [S82] https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds · https://www.worldofleveldesign.com/categories/ue4/breakdown-desert-dunes-pyramids.php
- [S86] https://www.nationalgeographic.com/travel/world-heritage/article/wadi-rum-jordan
- [S88] https://soils.uga.edu/soils-hydrology/munsell-color-system/
- [S89] https://en.wikipedia.org/wiki/Deir_al-Balah
- Palette comparison: `data/palette.json` (Roaring Lions, origin/main at 49bb60cfe, read 9 Nov 2026); CIEDE2000 computed locally.
