#!/usr/bin/env python3
"""Measure the font decisions of GH-1407 ruling D6 (report only; writes nothing in the repo).

    python3 tools/fonts/measure_fonts.py --cjk <dir> --togscc <characters.txt>
        --corpus-po <zh_CN.po> --corpus-props <bundle_zh_CN.properties> <bundle.properties>
        [--latin-src <dir>]

Every number in docs/superpowers/specs/2026-11-16-cjk-font-proposal.md comes
from one run of this script. It needs fontTools and brotli. Inputs, fetched
by hand (this tool touches no network):

  --cjk     NotoSansSC-Regular.otf, NotoSansSC-Medium.otf, NotoSansSC-Bold.otf
            (github.com/notofonts/noto-cjk, Sans/SubsetOTF/SC/) and
            NotoSansSC[wght].ttf (github.com/google/fonts, ofl/notosanssc/)
  --togscc  data/characters.txt of the npm package togscc 1.3.1: the 8,105
            characters of the 2013 Table of General Standard Chinese
            Characters in table order, whose first 3,500 are level 1
  --corpus-po     Warzone 2100's po/zh_CN.po (an open-source RTS, en -> zh-Hans)
  --corpus-props  Mindustry's bundle_zh_CN.properties and bundle.properties
  --latin-src     the google/fonts full TTFs of the three shipped faces
                  (Barlow-Regular/SemiBold, BigShouldersDisplay[wght],
                  IBMPlexMono-Regular/SemiBold), for the Latin-Extended note

Method for the realistic character estimate (section 3 of the proposal):
count the English words a zh-Hans translation covers (en.json chrome,
data/locales/en/missions.json, unit names and blurbs, briefing sections
excluded because they repeat the briefing), take the hanzi-per-English-word
ratio of each corpus from its own translated pairs, and draw corpus entries in
a seeded random order until that many hanzi are drawn; the distinct hanzi so
drawn is the estimate (mean and range over 20 seeds). Where a corpus is too
small to reach the target, its whole text is used and the shortfall is said.
"""
import argparse
import glob
import io
import json
import math
import os
import random
import re
import statistics

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
# CJK punctuation, fullwidth forms and the middle dot a zh-Hans UI uses; the
# Latin faces keep everything else (digits, Latin, the dash and ellipsis).
PUNCT = [*range(0x3000, 0x3040), *range(0xFF01, 0xFF5F), 0x00B7, 0x2018, 0x2019, 0x201C, 0x201D]


def english_words():
    """(words, strings) per catalogue, as the launch-languages brief counts them (whitespace split)."""
    out = {}
    en = json.load(open(os.path.join(REPO, "packages/app/src/i18n/en.json"), encoding="utf8"))
    out["chrome (en.json)"] = [v for v in en.values() if isinstance(v, str)]

    def strings(node, path=""):
        if isinstance(node, str):
            yield path, node
        elif isinstance(node, dict):
            for k, v in node.items():
                yield from strings(v, f"{path}/{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                yield from strings(v, f"{path}/{i}")

    missions = json.load(open(os.path.join(REPO, "data/locales/en/missions.json"), encoding="utf8"))
    out["missions (sections excluded)"] = [s for p, s in strings(missions) if "/sections/" not in p]
    units = []
    for f in sorted(glob.glob(os.path.join(REPO, "data/units/**/*.json"), recursive=True)):
        d = json.load(open(f, encoding="utf8"))
        for e in d if isinstance(d, list) else [d]:
            if isinstance(e, dict):
                units += [e[k] for k in ("name", "blurb") if isinstance(e.get(k), str)]
    out["units (name, blurb)"] = units
    return {k: (sum(len(s.split()) for s in v), len(v)) for k, v in out.items()}


def po_pairs(path):
    """[(english, chinese)] from a gettext .po file (multi-line strings joined, plurals: first form)."""
    pairs, cur, key = [], {}, None
    for line in open(path, encoding="utf8"):
        line = line.strip()
        m = re.match(r'^(msgid|msgstr(?:\[0\])?|msgid_plural|msgctxt|msgstr\[\d+\])\s+"(.*)"$', line)
        if m:
            key = m.group(1)
            if key == "msgid" and cur.get("msgid") is not None:
                pairs.append((cur.get("msgid", ""), cur.get("msgstr", "")))
                cur = {}
            if key == "msgstr[0]":
                key = "msgstr"
            if key in ("msgid", "msgstr"):
                cur[key] = cur.get(key, "") + m.group(2)
            else:
                key = None
        elif line.startswith('"') and key in ("msgid", "msgstr"):
            cur[key] += line[1:-1]
        elif not line:
            key = None
    if cur.get("msgid") is not None:
        pairs.append((cur.get("msgid", ""), cur.get("msgstr", "")))
    return [(e, z) for e, z in pairs if e and z]


def props(path):
    """key = value lines of a UTF-8 .properties bundle (Mindustry's are UTF-8, not escaped)."""
    out = {}
    for line in open(path, encoding="utf8"):
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def corpus_estimate(name, pairs, target_words, seeds=20):
    """Distinct hanzi in a seeded random draw of `pairs` reaching the hanzi a `target_words` text needs.

    The hanzi-per-word ratio is the corpus's own. Where the corpus is too
    small to reach the target, the whole corpus is drawn, and a Heaps' law fit
    (distinct = K * n^beta, least squares in log-log over the draw's growth
    curve from 1,000 hanzi on) is extrapolated to the target; both are printed.
    """
    pairs = [(e, z) for e, z in pairs if HAN.search(z) and len(e.split()) > 0]
    words = sum(len(e.split()) for e, _ in pairs)
    hanzi = sum(len(HAN.findall(z)) for _, z in pairs)
    ratio = hanzi / words
    target = round(ratio * target_words)
    counts, heaps, sets = [], [], []
    for seed in range(seeds):
        order = pairs[:]
        random.Random(seed).shuffle(order)
        seen, n, curve = set(), 0, []
        for _, z in order:
            hs = HAN.findall(z)
            seen.update(hs)
            n += len(hs)
            curve.append((n, len(seen)))
            if n >= target:
                break
        counts.append(len(seen))
        sets.append(set(seen))
        pts = [(math.log(x), math.log(y)) for x, y in curve if x >= 1000]
        mx, my = statistics.mean(q[0] for q in pts), statistics.mean(q[1] for q in pts)
        beta = sum((x - mx) * (y - my) for x, y in pts) / sum((x - mx) ** 2 for x, _ in pts)
        heaps.append(math.exp(my - beta * mx) * target ** beta)
    return {
        "name": name, "pairs": len(pairs), "en_words": words, "hanzi": hanzi, "ratio": ratio,
        "target_hanzi": target, "reached": hanzi >= target, "distinct_mean": statistics.mean(counts),
        "distinct_min": min(counts), "distinct_max": max(counts), "heaps": statistics.mean(heaps),
        "set": sets[0],
    }


def report(e, level1):
    print(f"  {e['name']}: {e['pairs']} translated pairs, {e['en_words']} English words -> {e['hanzi']} hanzi "
          f"(ratio {e['ratio']:.2f}/word); target {e['target_hanzi']} hanzi; "
          f"{'reached' if e['reached'] else 'NOT reached, whole corpus drawn'}; distinct hanzi drawn "
          f"{e['distinct_mean']:.0f} (range {e['distinct_min']}-{e['distinct_max']}); Heaps fit at target "
          f"{e['heaps']:.0f}; outside TOGSCC level 1: {len(e['set'] - level1)}")


_PRECUT = {}


def woff2_size(src, cps, instance=None, superset=None):
    """woff2 bytes of `src` cut to `cps`; a variable source is first cut to `superset` once
    (cutting before instancing is the same result and a fraction of the memory), then instanced."""
    if instance is None:
        font = TTFont(src)
    else:
        if src not in _PRECUT:
            pre = TTFont(src)
            o = subset.Options()
            o.layout_features = ["*"]
            o.name_IDs = ["*"]
            o.notdef_outline = True
            sub = subset.Subsetter(o)
            sub.populate(unicodes=sorted(superset))
            sub.subset(pre)
            buf = io.BytesIO()
            pre.save(buf)
            _PRECUT[src] = buf.getvalue()
        font = instancer.instantiateVariableFont(TTFont(io.BytesIO(_PRECUT[src])), instance)
        # Round-trip before subsetting: subsetting a partially instanced font
        # straight from the instancer raises in gvar (fontTools 4.68.0).
        buf = io.BytesIO()
        font.save(buf)
        font = TTFont(io.BytesIO(buf.getvalue()))
    opts = subset.Options()
    opts.hinting = False
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 14]
    opts.flavor = "woff2"
    opts.layout_features = ["*"]  # keep vert/vrt2, locl and the CJK punctuation features
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(cps))
    sub.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, opts)
    return len(buf.getvalue())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cjk", required=True)
    ap.add_argument("--togscc", required=True)
    ap.add_argument("--corpus-po", required=True)
    ap.add_argument("--corpus-props", nargs=2, required=True, metavar=("ZH", "EN"))
    ap.add_argument("--latin-src")
    ap.add_argument("--brief-words", type=int, default=26700)
    ap.add_argument("--only", help="measure only the CJK sources whose label contains this text (a full run takes ~45 min)")
    a = ap.parse_args()

    print("## English words a zh-Hans translation covers")
    cats = english_words()
    for k, (w, n) in cats.items():
        print(f"  {k}: {n} strings, {w} words")
    total_words = sum(w for w, _ in cats.values())
    print(f"  total: {total_words} words")

    print("\n## Character sets")
    togscc = [c for c in open(a.togscc, encoding="utf8").read().split() if c]
    level1 = set(togscc[:3500])
    gb1 = {bytes([hi, lo]).decode("gb2312") for hi in range(0xB0, 0xD8) for lo in range(0xA1, 0xFF)
           if not (hi == 0xD7 and lo > 0xF9)}
    gb_all = set()
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                gb_all.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    print(f"  TOGSCC level 1: {len(level1)}; GB2312 level 1: {len(gb1)}; GB2312 all hanzi: {len(gb_all)}; "
          f"overlap TOGSCC-1 & GB2312-1: {len(level1 & gb1)}")

    wz = po_pairs(a.corpus_po)
    zh, en = props(a.corpus_props[0]), props(a.corpus_props[1])
    md = [(en[k], zh[k]) for k in zh if k in en and zh[k] != en[k]]
    # 26,700 (--brief-words): the launch-languages brief's count of real new
    # words on the GH-1406 stack, whose mission catalogue is fuller than main's.
    targets = sorted({total_words, a.brief_words})
    realistic = set()
    for tw in targets:
        print(f"\n## Realistic estimate for {tw} English words (corpus draws, 20 seeds)")
        report(corpus_estimate("Warzone 2100 zh_CN.po", wz, tw), level1)
        report(corpus_estimate("Mindustry bundle_zh_CN", md, tw), level1)
        pooled = corpus_estimate("both corpora pooled", wz + md, tw)
        report(pooled, level1)
        if tw == max(targets):
            realistic = pooled["set"]
    print(f"  realistic set used below: the pooled seed-0 draw at {max(targets)} words, {len(realistic)} hanzi")

    sets = {
        "realistic (pooled draw)": realistic,
        "TOGSCC level 1 (3,500)": level1,
        "GB2312 level 1 (3,755)": gb1,
        "TOGSCC level 1 + realistic": level1 | realistic,
        "GB2312 all (6,763)": gb_all,
    }
    srcs = [("Noto Sans SC Regular (400)", "NotoSansSC-Regular.otf", None),
            ("Noto Sans SC Medium (500)", "NotoSansSC-Medium.otf", None),
            ("Noto Sans SC Bold (700)", "NotoSansSC-Bold.otf", None),
            ("Noto Sans SC VF at wght 400", "NotoSansSC[wght].ttf", {"wght": 400}),
            ("Noto Sans SC VF at wght 600", "NotoSansSC[wght].ttf", {"wght": 600}),
            ("Noto Sans SC VF at wght 700", "NotoSansSC[wght].ttf", {"wght": 700}),
            ("Noto Sans SC VF, wght axis cut to 400-600 (one file, both weights)", "NotoSansSC[wght].ttf",
             {"wght": (400, 600)})]
    everything = set(PUNCT) | {ord(c) for cs in sets.values() for c in cs}
    print("\n## woff2 subset sizes, bytes (hanzi + CJK punctuation, no hinting, all layout features)")
    for label, f, inst in srcs:
        if a.only is not None and a.only not in label:
            continue
        path = os.path.join(a.cjk, f)
        print(f"  {label} [{f}, {os.path.getsize(path)} bytes source]")
        for sname, cs in sets.items():
            cps = {ord(c) for c in cs} | set(PUNCT)
            print(f"    {sname}: {len(cps)} code points -> {woff2_size(path, cps, inst, everything)}")

    if a.latin_src:
        print("\n## Latin-Extended: what Polish and Turkish need that the shipped latin files lack")
        need = {"Polish": "ĄąĆćĘęŁłŃńÓóŚśŹźŻż", "Turkish": "ÇçĞğİıÖöŞşÜü"}
        shipped = {"barlow-latin-400.woff2": "Barlow-Regular.ttf", "barlow-latin-600.woff2": "Barlow-SemiBold.ttf",
                   "big-shoulders-display-latin.woff2": "BigShouldersDisplay[wght].ttf",
                   "ibm-plex-mono-latin-400.woff2": "IBMPlexMono-Regular.ttf",
                   "ibm-plex-mono-latin-600.woff2": "IBMPlexMono-SemiBold.ttf"}
        # Google Fonts' latin-ext slice, as its CSS API serves it.
        ext = set(subset.parse_unicodes(
            "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,"
            "U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"))
        for lat, src in shipped.items():
            have = TTFont(os.path.join(REPO, "assets/fonts", lat)).getBestCmap()
            full = TTFont(os.path.join(a.latin_src, src)).getBestCmap()
            for lang, chars in need.items():
                lack = [c for c in chars if ord(c) not in have]
                up = [c for c in lack if ord(c) not in full]
                print(f"  {lat} {lang}: lacks {len(lack)} ({''.join(lack)}); source lacks {len(up)} ({''.join(up) or '-'})")
            cps = {c for c in ext if c in full}
            print(f"    a Google-style latin-ext file from {src}: {len(cps)} code points -> {woff2_size(os.path.join(a.latin_src, src), cps)} bytes")


if __name__ == "__main__":
    main()
