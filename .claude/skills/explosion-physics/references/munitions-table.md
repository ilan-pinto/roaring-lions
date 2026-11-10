# Real munitions for calibration, and the Roaring Lions 155 mm comparison

Public, encyclopedic figures only (fill mass, TNT equivalent, commonly cited danger radii), then each
item's fireball, overpressure radii, crater and dust column from the formulas in `physics.md`, then a
comparison with the GH-1197 explosion design. Tags: `[Sn]` sources at the end; **[derived]** computed
here from sourced formulas; **[estimate]** my judgement, unsourced.

## Contents

1. [Inputs: fills and TNT equivalents](#1-inputs-fills-and-tnt-equivalents)
2. [The calibration table](#2-the-calibration-table)
3. [How to read the table](#3-how-to-read-the-table)
4. [Game scale: one tile in metres](#4-game-scale-one-tile-in-metres)
5. [The 155 mm in the design against physics](#5-the-155-mm-in-the-design-against-physics)
6. [Other classes, briefly](#6-other-classes-briefly)
7. [Sources](#sources)

---

## 1. Inputs: fills and TNT equivalents

TNT-equivalent factors are the RE values in `physics.md` §1.2 (Comp B 1.33, tritonal 1.05, HMX-based
OKFOL taken as 1.6) [S5]. Pressure-versus-impulse equivalence differs by ±15%, which moves radii by ±5%.

| Item | Filling (as published) | W, kg TNT eq [derived] | Commonly cited radius | Source and confidence |
|---|---|---|---|---|
| M67 hand grenade | 180 g Comp B (400 g total) | 0.24 | fatality 5 m, injury 15 m; some fragments to 230 m | [S18a] Wikipedia |
| 60 mm mortar, M888 | 0.36 kg Comp B | 0.48 | none found | [S18b] Wikipedia (M224) |
| 81 mm mortar, M252 HE (generic) | "0.7 kg of explosive filler", 4.5 kg round | 0.93 (Comp B assumed) | "effective kill radius" 35 m | [S18c] Wikipedia (M252) |
| 82 mm mortar, O-832DU | ~0.40 kg TD-42 (a TNT form), 3.1 kg bomb | 0.40 | none found | [S21] vendor page + Metis; **single secondary source** |
| 120 mm mortar, M933/M934 class | Comp B, fill not published there; comparable 120 mm HE bombs 2.5 kg (KNDS) and 3.4 kg (Nammo) Comp B | ~4.0 (3.0 kg Comp B assumed; 3.3-4.5) | M120 "lethality radius" 69 m | [S18d] Wikipedia (M120); [S19] FAS; [S20] KNDS, Nammo |
| 105 mm howitzer, M1 HE | 2.18 kg TNT or 50/50 amatol | 2.18 | none found | [S18e] Wikipedia (M101) |
| 155 mm howitzer, M107 HE | 6.86 kg TNT (or Comp B), 43.2 kg shell, ~1,950 fragments | 6.86 | none in Wikipedia; "50 m lethal" appears only in forums | [S18f] Wikipedia; forum figure **not used** |
| 155 mm, M795 HE | 10.8 kg TNT, 46.7 kg | 10.8 | "30% higher lethality" than M107 (weakly cited) | [S18g] Wikipedia |
| 120 mm tank HE (M908 HE-OR / M830A1 MPAT class) | Comp A-3; "2-pound HE warhead" lineage; a game database lists 1.99 kg TNT-eq | **~1.5 (estimate, 1-2)** | none found | [S23] GlobalSecurity, Wikipedia; **no official fill weight found** |
| RPG-7, PG-7VL (HEAT) | 730 g OKFOL (95% HMX); OG-7V frag: 210 g A-IX-1 | 1.17 (PG-7VL) | OG-7V 7 m (vs body armour) | [S18h] Wikipedia; shaped-charge energy goes partly into the jet |
| 122 mm Grad, 9M22U | 18.4 kg warhead, 66.6 kg rocket; ~6.4 kg HE (M-21OF); 3,920 fragments | ~6.4 | none found | [S22] Wikipedia (masses); HE mass **secondary source** |
| Mk 82 (500 lb) | 87 kg tritonal (241 kg total) | 91 | none in Wikipedia | [S18i] Wikipedia |
| Mk 84 (2,000 lb) | 429 kg tritonal (925 kg total) | 450 | lethal fragmentation 120 m; crater 15 m wide, 11 m deep | [S18j] Wikipedia |

US doctrine treats artillery and mortar fire within **600 m** of friendly troops as "danger close", a
planning distance, not an effects radius [S24].

---

## 2. The calibration table

All derived from `physics.md`. Formulas:

- **Fireball diameter**: `3.2 W^(1/3)` (Cooper) / `3.39 W^0.341` (HSE) [S1].
- **Fireball duration**: `0.20 W^0.35` s, a theoretical upper bound; measured small-charge fireballs ran
  about 25-60% of it [S1].
- **Overpressure radii**: Kinney-Graham, surface burst (W × 1.8) [S2, S3]. Airbursts (proximity fuzes)
  are 18% smaller (free-air, ÷ 1.8^(1/3)) [derived].
- **Crater diameter in dry soil**: `0.8 W^(1/3)` (Kinney-Graham accident statistics, ±30%) and
  `0.51 W^(1/3)` (charge lying on the ground) [S7]. Penetrating rounds are larger (section 3).
- **Dust**: dense early column `≈ 10 W^(1/3)` m [estimate], and Church's stabilised cloud top
  `92.6 W^0.25` m as an **upper bound**, over-predicting below 50 kg [S8, S9].
- **Shock arrival** at the 5 psi radius [derived].

| Item | W (kg TNT) | Fireball D (m) | Fireball t, upper (s) | 10 psi r (m) | 5 psi r (m) | 1 psi r (m) | Crater D, dry (m) | Dense column (m) [est.] | Church top, upper (m) | Shock to 5 psi (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| M67 grenade | 0.24 | 2.0 / 2.1 | 0.12 | 2.5 | 3.5 | 10 | 0.50 / 0.32 | 6 | 65 | 6 |
| 60 mm mortar | 0.48 | 2.5 / 2.6 | 0.15 | 3.1 | 4.4 | 13 | 0.63 / 0.40 | 8 | 77 | 7 |
| 81 mm mortar | 0.93 | 3.1 / 3.3 | 0.20 | 3.9 | 5.4 | 16 | 0.78 / 0.50 | 10 | 91 | 9 |
| 82 mm mortar | 0.40 | 2.4 / 2.5 | 0.15 | 2.9 | 4.1 | 12 | 0.59 / 0.38 | 7 | 74 | 7 |
| 120 mm mortar | ~4.0 | 5.1 / 5.4 | 0.32 | 6.3 | 8.8 | 26 | 1.27 / 0.81 | 16 | 131 | 15 |
| 105 mm M1 | 2.18 | 4.1 / 4.4 | 0.26 | 5.1 | 7.2 | 21 | 1.04 / 0.66 | 13 | 113 | 12 |
| **155 mm M107** | **6.86** | **6.1 / 6.5** | **0.39** | **7.5** | **10.6** | **31** | **1.52 / 0.97** | **19** | **150** | **18** |
| 155 mm M795 | 10.8 | 7.1 / 7.6 | 0.46 | 8.8 | 12.3 | 36 | 1.77 / 1.13 | 22 | 168 | 21 |
| 120 mm tank HE [est. W] | ~1.5 | 3.7 / 3.9 | 0.23 | 4.5 | 6.4 | 19 | 0.92 / 0.58 | 11 | 102 | 11 |
| RPG-7 PG-7VL | 1.17 | 3.4 / 3.6 | 0.21 | 4.2 | 5.9 | 17 | 0.84 / 0.54 | 11 | 96 | 10 |
| 122 mm Grad 9M22U | ~6.4 | 5.9 / 6.4 | 0.38 | 7.4 | 10.3 | 30 | 1.49 / 0.95 | 19 | 147 | 18 |
| Mk 82 | 91 | 14.4 / 15.8 | 0.97 | 18 | 25 | 74 | 3.6 / 2.3 (much larger if it penetrates) | 45 | 286 | 43 |
| Mk 84 | 450 | 24.5 / 27.2 | 1.70 | 30 | 43 | 125 | 6.1 / 3.9 (published: 15 wide × 11 deep, penetrating) | 77 | 427 | 73 |

**Fragment speeds (Gurney, upper bound)** [derived, case masses estimated]: 155 M107 about 1.0 km/s,
Mk 82 about 1.7 km/s, Mk 84 about 2.0 km/s, M67 grenade up to about 2.3 km/s (`physics.md` §4.1).

---

## 3. How to read the table

1. **Everything visible scales with `W^(1/3)`.** A Mk 84 has 66 times the charge of a 155 but only about
   four times its fireball and overpressure radii [derived]. A 155 has 17 times the charge of an 82 mm
   mortar bomb, but its radii are 2.6 times larger [derived].
2. **The fireball is small.** Its radius (about 1.6 W^(1/3) m) is about 40% of the ground-burst 10 psi
   radius (about 4.0 W^(1/3) m) and about 30% of the 5 psi radius (about 5.6 W^(1/3) m) [derived]. The
   blast reaches well beyond anything that glows.
3. **The danger area is set by fragments, not blast.** The M67's 5 m fatality and 15 m injury radii
   [S18a] lie where the side-on blast is only about 2.6 psi and 0.6 psi [derived]; the 81 mm's 35 m kill
   radius [S18c] is where the blast is about 0.4 psi, twice its 1 psi radius [derived]. The cited radii
   come from the casing, not the air.
4. **Craters from impact-fuzed shells are close to the surface formula** (155 mm DIRT live fire: 1.4-1.7 m
   diameter, 0.4-0.55 m deep [S15]); **delay-fuzed bombs are much bigger** (Mk 84 published 15 m against a
   6 m surface prediction [S18j]).
5. **Church overshoots for small charges.** For a grenade it predicts 65 m, which no grenade does. Below
   about 50 kg the Green Field experiments sit lower [S9]; use the dense-column estimate for what a player
   sees in the first seconds.

---

## 4. Game scale: one tile in metres

**One tile is 3 m.** The repository states it repeatedly: "real metres (a tile is 3 m)"
(`docs/art/style-bible.md`, `docs/art/meshy-prompts-ramp.md`); "One tile is 3 m (`MESH_UNITS_PER_TILE`, and
1 GLB unit is 1 m)" (`packages/render/src/three/units/running-gear.ts`). The constant is
`MESH_UNITS_PER_TILE = 3.0` in `packages/render/src/three/units/mesh-anim.ts`, documented as
`tools/dimetric.py`'s `UNITS_PER_TILE`: Blender builds at real metres, three.js draws one world unit per
tile. A 48-tile map is 144 m across.

On screen, per the GH-1197 design (§5, "Word pictures"): at zoom 1, one tile of ground distance spans
**45 px** and one tile of height **39 px**. So **1 m ≈ 15 px across the ground and 13 px up** at zoom 1.

Ranges are compressed far more than sizes: `spg_long_range` (`howitzer_155`) fires to 28 tiles, which is
84 m (`data/units/kdf/spg_long_range.json`). Real 155 mm howitzers reach tens of kilometres [estimate: not
sourced here]. Sizes of single objects (tanks, houses, people) are near real; distances between them are
not. Explosions sit between the two.

---

## 5. The 155 mm in the design against physics

The anchor is `howitzer_155`: `splash_tiles` 2.4, `damage` 280 (`data/units/kdf/spg_long_range.json`).
Design numbers are from `docs/superpowers/specs/2026-11-09-explosion-scale-and-building-physics-design.md`
on `origin/docs/gh1197-explosion-design` (revision 2; it is not on `origin/main` yet). Physics is the M107
row (6.86 kg TNT, surface burst).

| Element | Design (tiles → m) | Physics | Verdict |
|---|---|---|---|
| Sim damage reach `S` | 2.4 t = 7.2 m | 10 psi radius 7.5 m; at 7.2 m the side-on peak is about 11 psi (76 kPa) [derived] | **Realistic as a blast radius**, by coincidence. Far smaller than the real fragment hazard (tens of metres or more [S18c, S18a]): a gameplay compression consistent with the map scale |
| Inner shock ring, 0 → S in 260 ms | 7.2 m in 260 ms (avg 28 m/s) | the shock reaches 7.2 m in **9.7 ms** (440 m/s there) [derived] | **About 27x slowed.** Correct craft: 9.7 ms is under one 60 fps frame |
| Outer pressure wave to 1.6 S | 3.84 t = 11.5 m, from 260 to 520 ms | 11.5 m is where the peak is 4.3 psi; the 5 psi radius is 10.6 m; the shock gets there in 20 ms [derived] | **The outer ring sits on the real 5 psi line.** Slowed 25x. As a ground dust skirt it is physically defensible (lifted dust spreads over a few hundred ms, `physics.md` §2.6) |
| Fireball radius | 1.2 t = 3.6 m (D 7.2 m) | D 6.1-6.5 m, r 3.0-3.3 m [S1, derived] | **Realistic** (+10-20%) |
| Fireball duration | not stated; light decays over 450 ms | 0.39 s upper bound; measured small charges 25-60% of it, so about 0.1-0.25 s [S1] | Realistic if the visible ball is gone by about 0.3-0.4 s |
| Crater radius | 0.96 t = 2.9 m (D 5.8 m) | D 1.5 m by `0.8 W^1/3` (±30%) [S7]; DIRT live 155: D 1.44-1.73 m, depth 0.37-0.55 m; static up to 2.4 m [S15] | **Exaggerated about 3.5-4x in diameter** (12-15x in area). Today's 0.45 t (D 2.7 m) is already 1.6-1.9x |
| Scorch radius | 1.44 t = 4.3 m | blackening is roughly the fireball footprint, r about 3 m [estimate] | Mildly exaggerated (about 1.4x) |
| Debris, 36 clods + 18 chunks, thrown 2.4 t, apex 3.0 t | lands within 7.2 m, apex 9 m (implies about 79°, about 13 m/s launch) [derived] | bulk soil lands within about 2 crater radii (about 1.5 m); a fast few launch at 10-30 m/s from the crater centre, apex up to about 20 m, clods out to tens of metres [S16, derived] | **Plausible as the visible fast fraction.** Real bulk ejecta stays much closer; steel fragments (about 1 km/s) are invisible and go far beyond |
| Dust column | 4.0 t = 12 m tall, 6-9 s | dense column 10-30 m in the first 1-2 s [estimate]; buoyant cloud to tens of m (Church upper bound 150 m) over 30-60 s [S8, S9]; fine dust drifts for minutes [derived] | **Height realistic for the first seconds; lifetime compressed 5-10x** for readability |
| Dust skirt to 3.84 t, 3-4 s | 11.5 m | the dust skirt of a 155 reaches a few metres to about 10 m [estimate] | Realistic to mildly generous |
| Light, 3.2 over 6 t | 18 m radius | real HE fireballs light the ground well past their own size for about 0.1-0.4 s [estimate] | Not a physics quantity; fine |
| Roof hole r 0.5 t | 1.5 m radius (3 m across) | a 6.86 kg TNT shell on a light roof slab or masonry: holes of order 1-3 m across [estimate: no sourced breach data opened] | Plausible; unverified |
| Building debris (chunks ≤ 0.35 t) | ≤ 1.05 m, thrown 1.5-3.0 t (4.5-9 m) on collapse | masonry debris mostly whole bricks (0.24 m, 2.83 kg), 1-12 m/s in shock-tube tests [S11]; landing a few to tens of metres from the wall [derived] | Chunks are about 4x a brick (slabs, not bricks); throw distances realistic |
| Collapse shroud | dense 0.84 s, 2.4 s total | real collapse dust: dense for seconds to a minute, haze for about 15 min, plume 25% above roof and twice the width [S26] | **Shortened about 10-100x**, by ruling, for readability |

**Summary for the 155.** Physically right: the fireball size, the inner ring as a blast radius (≈10 psi),
the outer ring placed at the 5 psi line, the dust column height in its first seconds, and the debris
throw distances. Exaggerated for readability: **the crater (3.5-4x in diameter)**, the ring speed (≈25x
slower, unavoidable), the dust and shroud lifetimes (5-100x shorter), and the size of building chunks.
Understated: the real fragment hazard reach (about an order of magnitude beyond the 7.2 m sim splash).

---

## 6. Other classes, briefly

- **82 mm against 155 mm.** Physics says the 155's radii are 2.6x the 82 mm's (cube root of the mass
  ratio 17) [derived]. The sim splash gives 1.2x (2.4 against 2.0 tiles), and the design fireball gives
  2.1x (1.2 against 0.56 t). So **the mortar's rings are generous relative to the 155**: an 82 mm's real 10
  psi radius is about 2.9 m (about 1 tile), against its 2.0-tile ring. The design's fireball ratio is the
  most physical of the three. The design note already flags the sim's 1.2x as a caveat for the lead.
- **Mortar fireball.** The design gives 0.56 t (1.7 m) radius for the 82 mm; physics gives 1.2-1.25 m
  [derived]: about 1.4x generous.
- **Air strike (S 2.0, fireball 1.6 t = 4.8 m).** If read as a Mk 82, the real fireball radius is about
  7-8 m (2.4-2.6 t) and the 5 psi radius 25 m (8 t) [derived]. The strike is drawn smaller than a real
  500 lb bomb; its 1.4 t crater (if that is a radius, 4.2 m, D 8.4 m) is in line with a penetrating Mk 82
  [estimate: no published Mk 82 crater found].
- **Grad 122 (S 3.0)** has about the 155's charge (6.4 against 6.86 kg) [S22, S18f]. Physics gives near
  identical radii, so putting both in `heavy_artillery` is right; the Grad's larger sim splash (3.0 t) is a
  gameplay choice.
- **Tank HE, RPG (`direct_he`, nominal fireball 0.5 t = 1.5 m radius).** Physics for 1.2-1.5 kg TNT
  gives a fireball radius of about 1.7-1.9 m [derived]: the design is slightly small, which is fine.

---

## Sources

- [S1] Price, M. A. (2005). LA-14209-T. https://www.osti.gov/servlets/purl/841586 (fireball fits,
  duration, Table 11).
- [S2] Catovic & Kljuno (2021). *ASTESJ* 6(1). https://astesj.com/publications/ASTESJ_060182.pdf
  (Kinney-Graham).
- [S3] Díaz & Rigby (2022). arXiv:2110.09488. https://arxiv.org/pdf/2110.09488 (surface factor 1.8).
- [S5] Wikipedia, "TNT equivalent". https://en.wikipedia.org/wiki/TNT_equivalent
- [S7] Ambrosini, Luccioni & Danesi (2004). https://amcaonline.org.ar/ojs/index.php/mc/article/download/271/260
- [S8] Goldstein (2020). LLNL-TR-815803. https://www.osti.gov/servlets/purl/1688581 (Church formula).
- [S9] Nasstrom et al. (2011). LLNL. https://narac.llnl.gov/sites/narac/files/2024-02/LLNL-PRES-523194.pdf
- [S11] Schneider et al. (2019). *CET* 77. http://www.aidic.it/cet/19/77/037.pdf
- [S15] DIRT crater data, DTIC ADA111994 (via search). https://apps.dtic.mil/sti/tr/pdf/ADA111994.pdf
- [S16] Luther et al. (2018). EPSC2018-139. https://meetingorganizer.copernicus.org/EPSC2018/EPSC2018-139.pdf
- [S18a] Wikipedia, "M67 grenade". https://en.wikipedia.org/wiki/M67_grenade
- [S18b] Wikipedia, "M224 mortar". https://en.wikipedia.org/wiki/M224_mortar
- [S18c] Wikipedia, "M252 mortar". https://en.wikipedia.org/wiki/M252_mortar
- [S18d] Wikipedia, "M120 mortar". https://en.wikipedia.org/wiki/M120_mortar
- [S18e] Wikipedia, "M101 howitzer". https://en.wikipedia.org/wiki/M101_howitzer
- [S18f] Wikipedia, "M107 projectile". https://en.wikipedia.org/wiki/M107_projectile
- [S18g] Wikipedia, "M795 projectile". https://en.wikipedia.org/wiki/M795_projectile
- [S18h] Wikipedia, "RPG-7". https://en.wikipedia.org/wiki/RPG-7
- [S18i] Wikipedia, "Mark 82 bomb". https://en.wikipedia.org/wiki/Mark_82_bomb
- [S18j] Wikipedia, "Mark 84 bomb". https://en.wikipedia.org/wiki/Mark_84_bomb
- [S19] FAS, M933/M934 120 mm. https://man.fas.org/dod-101/sys/land/m933.htm
- [S20] KNDS 120 mm HE mortar bomb https://knds.com/en/products/ammunition/120mm-he-mortar ; Nammo 120 mm
  HE-ER https://www.nammo.com/products/ammunition/large-caliber-ammunition/mortar-rounds/120-mm-high-explosive-extended-range/
  (fill masses via search).
- [S21] 82 mm VO-832DU (Bulcomers) https://bulcomersks.com/military-products/ammunition/mortar-rounds/82mm-mortar-round-vo-832du/ ;
  Metis O-832DU https://metis.fenixinsight.com/munition/mortarBomb/53-o-832du (via search).
- [S22] Wikipedia, "BM-21 Grad" (9M22U masses) https://en.wikipedia.org/wiki/BM-21_Grad ; HE mass and
  fragment counts via search: https://inertproducts.com/product/122mm-9m22-m-21-of-he-rocket-warhead-deluxe-inert-replica/ ,
  https://www.bulletpicker.com/rocket_-122mm-he-frag_-9m22u.html
- [S23] GlobalSecurity, M830A1 https://www.globalsecurity.org/military/systems/munitions/m830a1.htm ;
  Wikipedia "M830" https://en.wikipedia.org/wiki/M830 (via search; 1.99 kg TNT-eq figure from
  https://old-wiki.warthunder.com/M256_(120_mm)/Ammunition , a game database, not authoritative).
- [S24] FM 3-21.71 ch. 8 (danger close 600 m), via search:
  https://www.globalsecurity.org/military/library/policy/army/fm/3-21-71/ch8.htm
- [S26] Collapse dust, see `physics.md` [S26].
- Game files (read-only): `data/units/kdf/spg_long_range.json`;
  `packages/render/src/three/units/mesh-anim.ts` (`MESH_UNITS_PER_TILE = 3.0`);
  `packages/render/src/three/units/running-gear.ts`; `docs/art/style-bible.md`;
  `docs/superpowers/specs/2026-11-09-explosion-scale-and-building-physics-design.md` on
  `origin/docs/gh1197-explosion-design`.
