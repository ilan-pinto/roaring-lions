# GH-1407 fonts, ruling D6: Cyrillic shipped, one CJK face proposed, Latin-Extended measured

Status: **Cyrillic for IBM Plex Mono is SHIPPED with this note. The CJK face is a PROPOSAL for the lead; nothing CJK ships.** 16 Nov 2026.

The ruling (lead, PR 1474, 16 Nov 2026), D6: *fonts decided before translation starts: Cyrillic added to the shipped faces, an OFL CJK face chosen and its size measured, Latin-Extended for later.* The five launch languages are en + zh-Hans, ru, de, fr, es-ES (D1), AI-translated in-house (D3/D8). German, French and Spanish need nothing from this note: every letter they use is in Latin-1, which the shipped latin files already carry.

Every number below comes from one script, `tools/fonts/measure_fonts.py` (report only, fontTools 4.68.0, brotli 1.2.1), and the Cyrillic files from `tools/fonts/build_cyrillic.py`. Both name their inputs and take them as local files; neither touches the network.

---

## 1. Cyrillic (Russian)

### Where the shipped faces came from

The provenance register said "download source not recorded" for all three faces. Measured today: every code point each shipped latin file maps has the same outline and advance as Google Fonts' build of that face, at the same version: Barlow 1.408 (`google/fonts` `ofl/barlow`, 227 of 227), Big Shoulders Display 2.002 (`ofl/bigshouldersdisplay`, 229 of 229), IBM Plex Mono 2.3 (`ofl/ibmplexmono`, 229 of 229 for both weights). The comparison can fail: IBM's own newer build, Plex Mono 2.005 (`IBM/plex`, `packages/plex-mono`), differs on 4 of the 229, and the build tool refuses it.

So the face's own OFL source, for this purpose, is the Google Fonts build of each family, which those projects publish there (`METADATA.pb` names the upstream repository and commit: `jpt/barlow` b4726dd, `xotypeco/big_shoulders` 41153e6, `googlefonts/plex` 9ab3b5b).

### Which faces have Cyrillic at all

| Face (shipped role) | OFL source checked | Cyrillic code points in U+0400-04FF | Russian А-я Ёё |
|---|---|---|---|
| IBM Plex Mono 2.3 (mono: clocks, prices, counts) | google/fonts `ofl/ibmplexmono`; IBM/plex 2.005 | 168 of 256; 192 | all 66 |
| Barlow 1.408 (body: all prose) | google/fonts `ofl/barlow`; jpt/barlow master, 1.422 | **0**; **0** | none |
| Big Shoulders Display 2.002 (display: titles, bands, tiles) | google/fonts `ofl/bigshouldersdisplay`; the upstream README's latest release is 2.002 | **0** | none |

**Barlow and Big Shoulders Display have no Cyrillic in any OFL source.** Google Fonts lists their subsets as latin, latin-ext and vietnamese only, and Big Shoulders' README describes its coverage as "diacritics covering 80 languages", Latin only. So "Cyrillic added to the shipped faces" can be done for one face of three. I did **not** substitute another face; that changes the look of Russian text and is the lead's call (options below).

What ships: IBM Plex Mono's Cyrillic, both weights, as two separate files behind a `unicode-range`. What Russian looks like today on this branch:

- Mono text (figures, key caps, identifiers): Plex Mono, Latin and Cyrillic alike.
- Body prose: Latin letters in Barlow, Cyrillic letters from the next name in `--font-body`, `system-ui` (Segoe UI on Windows, San Francisco on macOS: both have Cyrillic). A mixed line mixes faces.
- Titles: Latin in Big Shoulders, Cyrillic from `--font-display`'s fallback, `'Oswald'` if the player happens to have it installed, else the system `sans-serif`. Condensed caps over a regular-width fallback will read worst here.

### How it loads, and why Latin cannot change

`packages/app/src/ui/theme.css` gains two `@font-face` rules for the existing family `'IBM Plex Mono'` (400 and 600), each with `unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`. That is Google Fonts' `cyrillic` slice less U+0301 (the combining acute, which the latin files also map). The latin rules are untouched: same text, no `unicode-range`, same bytes. The browser fetches a Cyrillic file only when a Cyrillic character is drawn in that family, and neither is preloaded, so an English session downloads exactly what it did before.

`packages/app/src/ui/font-faces.test.ts` reads the rules and decodes each woff2's character map (a small WOFF2 reader in the test) and holds: every woff2 is loaded by exactly one rule; a latin rule has no range and every other rule has one; a ranged file maps every code point in its range; **no code point the same face's latin file draws is in a ranged file's range** (so Latin text cannot be drawn from the new file: unchanged by construction); Russian is drawable in every weight of every family except the two named gaps, and a gap that gains Cyrillic fails the spec until its entry is deleted.

### Sizes (bytes, woff2)

| File | Before | After |
|---|---|---|
| `barlow-latin-400.woff2` | 15,656 | 15,656 (unchanged, sha256 7a686e76...) |
| `barlow-latin-600.woff2` | 15,832 | 15,832 (unchanged, 488b5809...) |
| `big-shoulders-display-latin.woff2` | 35,520 | 35,520 (unchanged, 203dd8ba...) |
| `ibm-plex-mono-latin-400.woff2` | 10,052 | 10,052 (unchanged, c36f509c...) |
| `ibm-plex-mono-latin-600.woff2` | 10,120 | 10,120 (unchanged, ad4580d8...) |
| `ibm-plex-mono-cyrillic-400.woff2` | none | **4,912** (101 code points) |
| `ibm-plex-mono-cyrillic-600.woff2` | none | **4,952** (101 code points) |
| **`assets/fonts/` total** | 87,180 | 97,044 |
| **Fetched by an English session** | 87,180 at most | 87,180 at most |
| **Fetched by a Russian session** | n/a | +4,912, +4,952 if a 600 figure is drawn |

For comparison, Google's own `cyrillic` slices of the same faces (via `@fontsource/ibm-plex-mono` 5.3.0) are 8,356 and 9,352: they keep TrueType hinting and U+0301; ours are unhinted like the shipped latin files.

### Options for the two faces with no Cyrillic (lead decision, not taken)

Sizes are Google Fonts' `cyrillic` slices as published in `@fontsource` 5.3.0 (hinted), so they are indicative, not what a subset built our way would weigh. Each would be served under the existing family name with a Cyrillic `unicode-range`, exactly as Plex Mono's is, so Latin stays in Barlow and Big Shoulders.

| Option | Body (for Barlow) | Display (for Big Shoulders) | Cost |
|---|---|---|---|
| A. Keep today's fallback | `system-ui` | Oswald if installed, else `sans-serif` | 0 bytes; looks inconsistent |
| B. An OFL companion with Cyrillic | Fira Sans 400 / 600: 10,788 / 11,600 | Oswald (variable, already the second name in `--font-display`): 15,688 | about 38 KB, fetched only by a Russian session |
| C. Have Cyrillic drawn for Barlow and Big Shoulders | the OFL allows a derivative (neither carries a Reserved Font Name) | same | a type designer's time; out of scope for an in-house translation |

The note recommends B as the cheapest way to make Russian look designed rather than accidental. The pairings (Fira Sans with Barlow, Oswald with Big Shoulders) are a judgement for the lead's eye, not a measurement.

---

## 2. CJK: one OFL face for Simplified Chinese

### The face: Noto Sans SC

| Candidate | Licence | What it is | Fetched and measured |
|---|---|---|---|
| **Noto Sans SC** 2.004 | SIL OFL 1.1 (copyright Adobe; the licence names Reserved Font Name 'Source', which does not constrain a font named Noto) | Google's distribution of the Source Han Sans design; 30,890 code points; static OTFs (`notofonts/noto-cjk`, `Sans/SubsetOTF/SC/`) and one variable TTF with a `wght` axis 100-900 (`google/fonts`, `ofl/notosanssc/NotoSansSC[wght].ttf`) | yes, every number below |
| Source Han Sans SC | SIL OFL 1.1 with Reserved Font Name 'Source' | Adobe's distribution of the same design | no: the `adobe-fonts/source-han-sans` raw paths tried (`release` branch, `SubsetOTF/SC/`) returned 404; not measured |

**Recommend Noto Sans SC.** It is the same design as Source Han Sans SC under a name the Reserved Font Name does not touch, so a subset can keep its name; it is the only one of the two with a variable build (which instances smaller, below); it is the one Google Fonts serves for `zh-Hans`, so it is the face a Chinese player is most used to seeing in games and on the web; and its sans, low-contrast drawing sits with Barlow. Not considered: decorative OFL faces (LXGW WenKai, a handwriting style; Smiley Sans, an oblique display face): wrong register for a HUD.

### How many characters a zh-Hans translation needs

The real set is unknowable before translation, so three measurements:

**(a) Fixed lists.** The 2013 Table of General Standard Chinese Characters (通用规范汉字表), level 1: 3,500 characters (from the npm package `togscc` 1.3.1, `data/characters.txt`, whose first 3,500 are level 1). GB2312 level 1: 3,755, derived from Python's `gb2312` codec (rows 0xB0-0xD7). They overlap in 3,381. GB2312 entire: 6,763.

**(b) A realistic estimate.** Method:

1. Count the English words a translation covers, on `main` today: `en.json` 2,027 strings, 12,495 words; `data/locales/en/missions.json` 249 strings, 7,440 words (briefing sections excluded, as the launch brief does, because they repeat the briefing); unit names and blurbs 83 strings, 650 words. **20,585 words.** The launch brief counted **26,700** real new words on the GH-1406 stack, whose mission catalogue is fuller than `main`'s; both are measured.
2. Take two open-source game translations into Simplified Chinese with their English sources: Warzone 2100 (an RTS; `po/zh_CN.po`, 3,823 translated pairs) and Mindustry (`bundle_zh_CN.properties` against `bundle.properties`, 3,465 pairs). Their own ratios are 1.86 and 1.72 hanzi per English word (1.79 pooled).
3. Draw translated pairs in a seeded random order until the drawn hanzi equal what our word count needs at that ratio; count the distinct hanzi; 20 seeds. Neither corpus alone reaches our size (34k and 30k hanzi against 37-50k needed), so their whole text is drawn and a Heaps' law fit of the draw's growth curve is extrapolated; the pooled corpus reaches it.

| English words | Warzone 2100 (whole corpus / Heaps fit) | Mindustry (whole corpus / Heaps fit) | Both pooled (draw, 20 seeds / Heaps fit) |
|---|---|---|---|
| 20,585 (main) | 1,265 / 1,352 | 1,275 / 1,382 | **1,436** (1,411-1,461) / 1,491 |
| 26,700 (brief) | 1,265 / 1,449 | 1,275 / 1,484 | **1,512** (1,495-1,529) / 1,563 |

**Estimate: about 1,500 distinct hanzi, plan for 2,000.** Of the pooled draw, 44 characters are outside the 3,500 of level 1, so a fixed common list alone would leave tofu in real text. Two cautions: both corpora are science-fiction or future-war games, and ours transliterates Levantine place and unit names (Beit Sahwan, Wadi Halam, Tel Marum), whose transliteration characters are mostly common but are not in either corpus; and a machine translation (D3) picks characters a little differently from a human's. Neither changes the order of magnitude.

### Sizes (bytes, woff2, the hanzi plus CJK punctuation U+3000-303F and U+FF01-FF5E, no hinting, every layout feature kept)

| Set | code points | Regular 400 (OTF) | Medium 500 (OTF) | Bold 700 (OTF) | VF instanced 400 | VF instanced 600 | VF instanced 700 | VF, axis cut to 400-600, one file |
|---|---|---|---|---|---|---|---|---|
| Realistic (pooled draw, 1,514 hanzi) | 1,677 | 280,712 | 281,576 | 281,828 | **248,488** | 252,808 | 254,352 | 428,840 |
| 通用规范汉字表 level 1 (3,500) | 3,663 | 603,292 | 605,640 | 609,476 | 528,188 | 538,384 | 541,456 | 915,204 |
| GB2312 level 1 (3,755) | 3,918 | 644,220 | 646,628 | 650,980 | 563,564 | 573,992 | 577,504 | 979,160 |
| Level 1 + realistic | 3,707 | 610,912 | 612,492 | 616,780 | 534,240 | 544,244 | 547,728 | 926,672 |
| GB2312 entire (6,763) | 6,926 | 1,134,032 | 1,142,088 | 1,153,396 | 996,036 | 1,016,240 | 1,021,376 | 1,740,464 |
| *Source font, whole* | 30,890 | 8,331,336 | 8,345,436 | 8,543,168 | 17,772,300 (VF) | | | |

Read: about **250 KB per weight for the text a translation needs**, about **530 KB per weight for the 3,500 common characters**. Instancing the variable font gives TrueType outlines about 12% smaller than the CFF static OTFs. Keeping the axis (one file for two weights) costs 429 KB against 501 KB for two instances, so it only pays when both weights are always drawn. Today's whole `assets/fonts/` is 97 KB.

### Load strategy (proposed)

1. **Only a zh session fetches it.** A separate family name (for example `'RL Noto Sans SC'`, a local alias; the font itself keeps its name) named ONLY in `:root:lang(zh-Hans)` overrides of `--font-body` and `--font-display`, after the Latin face: `'Barlow', 'RL Noto Sans SC', system-ui, ...`. Latin, digits and punctuation keep coming from Barlow and Big Shoulders; hanzi come from Noto. An English session never names the family, so a Chinese player name in a versus lobby under an English UI falls to the system font and costs nothing. Better still, register the faces from `loadLocale` with the `FontFace` API when the locale is zh-Hans, so the rules do not exist at all otherwise; `applyLocale` already sets `lang` on `<html>`.
2. **Two slices per weight, by `unicode-range`.** Slice A: exactly the hanzi the shipped zh-Hans catalogues use, generated at build time from the catalogues (about 250 KB per weight), so a missed character is impossible by construction; a spec in the style of `font-faces.test.ts` asserts every hanzi in the zh-Hans catalogues is in slice A. Slice B: the rest of level 1 (about 2,000 characters, roughly 300 KB per weight), fetched only when such a character appears, which in a zh session is player-typed text. Beyond level 1: the system font (every OS a zh player uses ships a CJK face). The range is the exact list of the slice's code points, which keeps the test's "maps every code point it declares" rule true.
3. **Two weights: 400 and 700**, instanced from the variable font. Body asks for 400 and 600; with faces at 400 and 700 the browser draws a 600 request from 700, and in Chinese the 600 cut carries little (figures inside prose come from Barlow). Display (Big Shoulders asks for 600-900) takes 700. That is about 500 KB for slice A, both weights, on the first zh-Hans boot; the service worker's stale-while-revalidate cache over `fonts/` keeps it after that. Not preloaded.
4. **Same build discipline as Cyrillic:** a tool in `tools/fonts/` with the source's sha256 recorded, no hinting, name IDs 0-6 and 14, woff2, reproducible bytes; a row in `docs/ASSET_PROVENANCE.md`; `OFL-NotoSansSC.txt` beside the files and an entry in `packages/app/src/credits-data.ts` (its spec already fails a woff2 family with no credit).

---

## 3. Latin-Extended, for later Polish and Turkish

Measured against the shipped latin files (Latin-1 already carries Ó ó, Ç ç, Ö ö, Ü ü, and every file maps ı U+0131):

| Language | Letters the shipped latin files lack (all five files alike) | In each face's source? |
|---|---|---|
| Polish | 16: Ą ą Ć ć Ę ę Ł ł Ń ń Ś ś Ź ź Ż ż | yes, all three faces |
| Turkish | 5: Ğ ğ İ Ş ş | yes, all three faces |

So, unlike Cyrillic, Latin-Extended is available for every shipped face. Google's whole `latin-ext` slice cut from the same sources weighs: Barlow 400 / 600 10,628 / 10,832 (167 code points); Big Shoulders Display 37,960 (316, variable); Plex Mono 400 / 600 8,088 / 8,116 (201). About 75.6 KB in all, behind a `unicode-range`, fetched only when such a letter is drawn. A slice of just the 21 letters these two languages need would be much smaller (not measured). Same pattern as the Cyrillic files, same test; no work until Polish or Turkish is ruled in.

---

## Reproducing

```bash
pip install fonttools==4.68.0 brotli==1.2.1
# Cyrillic files: download the two TTFs named in tools/fonts/build_cyrillic.py, then
python3 tools/fonts/build_cyrillic.py --src <dir>            # writes assets/fonts/ibm-plex-mono-cyrillic-*.woff2
python3 tools/fonts/build_cyrillic.py --src <dir> --check    # rebuilds in memory, compares bytes, exit 1 on a difference
# Every number in sections 2 and 3 (about 45 minutes; --only narrows the CJK sources):
python3 tools/fonts/measure_fonts.py --cjk <dir> --togscc <characters.txt> \
  --corpus-po <zh_CN.po> --corpus-props <bundle_zh_CN.properties> <bundle.properties> --latin-src <dir>
```

Inputs and their sha256 (first 16 hex):

| Input | URL | sha256 |
|---|---|---|
| IBMPlexMono-Regular.ttf 2.3 | https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf | 6a3412f058c7d8df |
| IBMPlexMono-SemiBold.ttf 2.3 | https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf | d3c38e55c78f5b0f |
| Barlow-Regular.ttf / -SemiBold.ttf 1.408 | https://raw.githubusercontent.com/google/fonts/main/ofl/barlow/ | 95aa02c7c43096e0 / 86577cb32f8abe36 |
| Barlow-Regular.ttf 1.422 (upstream) | https://raw.githubusercontent.com/jpt/barlow/main/fonts/ttf/Barlow-Regular.ttf | 1da0b65f2389aeaf |
| BigShouldersDisplay[wght].ttf 2.002 | https://raw.githubusercontent.com/google/fonts/main/ofl/bigshouldersdisplay/ | 60e208dc276a1c35 |
| NotoSansSC-Regular / Medium / Bold.otf 2.004 | https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/ | faa6c9df652116dd / 7633f5a016d4dd95 / c6cb5a93abaa9edc |
| NotoSansSC[wght].ttf 2.004 | https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/ | a3041811a78c361b |
| togscc 1.3.1 (MIT; character list only) | npm `togscc@1.3.1` | tarball 8507c668c0e3f643 |
| Warzone 2100 `po/zh_CN.po` (GPL-2.0; measured, not shipped) | https://raw.githubusercontent.com/Warzone2100/warzone2100/master/po/zh_CN.po | 9d338adc9ed91974 |
| Mindustry bundles (GPL-3.0; measured, not shipped) | https://raw.githubusercontent.com/Anuken/Mindustry/master/core/assets/bundles/ | zh_CN dc119562b2cffdcb, en 7ea690b26bb60453 |

The `main`-branch URLs are not pinned to a commit (this session's proxy refuses the GitHub API that would name one); the sha256 is the pin, and `build_cyrillic.py` refuses any other file.
