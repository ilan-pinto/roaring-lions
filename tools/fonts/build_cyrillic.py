#!/usr/bin/env python3
"""Build the Cyrillic font subsets under assets/fonts/ (GH-1407, lead ruling D6).

    python3 tools/fonts/build_cyrillic.py --src <dir> [--check]

`--src` is a directory holding the upstream OFL source files named in
SUBSETS below, downloaded by hand (this tool touches no network):

    curl -sSLO https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf
    curl -sSLO https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf

Needs fontTools and brotli (`pip install fonttools brotli`; built with
fonttools 4.68.0, brotli 1.2.1). The output is byte-for-byte reproducible.

What it does, per subset, and what it refuses:

  * refuses a source whose sha256 is not the one recorded here, so a newer
    upstream build cannot slip in under the same name;
  * refuses a source whose outlines and advances differ from the SHIPPED
    Latin file of the same face on any code point the Latin file maps. The
    Latin files' download was never recorded (docs/ASSET_PROVENANCE.md), so
    this is how we know the Cyrillic glyphs come from the very build the
    Latin ones did, with the same metrics. (Measured: Plex Mono 2.3 from
    google/fonts matches all 229 Latin code points of both weights; IBM's own
    2.005 build differs on 4, and would be refused.)
  * subsets with the options the shipped Latin files carry: no hinting, the
    default layout features, name IDs 0-6 and 14 (the OFL URL), woff2;
  * `--check` builds into memory and compares with the committed file
    instead of writing it.

The Latin files are not rebuilt: their bytes stay exactly as shipped, and the
Cyrillic file is a separate `@font-face` with a `unicode-range`
(packages/app/src/ui/theme.css), so a Latin glyph can never come from it.

Barlow (body) and Big Shoulders Display (display) are NOT here, because no
OFL source of either has a Cyrillic glyph: Barlow 1.408 (google/fonts) and
1.422 (github.com/jpt/barlow, master) map 0 of U+0400-04FF, and Big
Shoulders Display 2.002 (google/fonts; the upstream README's latest is 2.002)
maps 0. Substituting another face is a lead decision, not a build step; see
docs/superpowers/specs/2026-11-16-cjk-font-proposal.md, section 1.
"""
import argparse
import hashlib
import io
import os
import sys

from fontTools import subset
from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = os.path.join(REPO, "assets", "fonts")

# Google Fonts' `cyrillic` slice, less U+0301 (the combining acute): the
# Latin files map it too, and a combining mark routed to a second file is a
# Latin rendering change. Keep this in step with the `unicode-range` of the
# Cyrillic faces in theme.css (font-faces.test.ts reads both back).
CYRILLIC = "U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"

SUBSETS = [
    {
        "out": "ibm-plex-mono-cyrillic-400.woff2",
        "latin": "ibm-plex-mono-latin-400.woff2",
        "src": "IBMPlexMono-Regular.ttf",
        "url": "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf",
        "sha256": "6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46",
        "unicodes": CYRILLIC,
    },
    {
        "out": "ibm-plex-mono-cyrillic-600.woff2",
        "latin": "ibm-plex-mono-latin-600.woff2",
        "src": "IBMPlexMono-SemiBold.ttf",
        "url": "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf",
        "sha256": "d3c38e55c78f5b0f28009fddba4834ec503278936a5986032424c9bd2d23aa46",
        "unicodes": CYRILLIC,
    },
]


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def latin_mismatches(latin_path, src_path):
    """Code points the shipped Latin file maps whose outline or advance differs in the source."""
    a, b = TTFont(latin_path), TTFont(src_path)
    ca, cb = a.getBestCmap(), b.getBestCmap()
    ga, gb = a.getGlyphSet(), b.getGlyphSet()
    bad = []
    for cp, name in sorted(ca.items()):
        if cp not in cb:
            bad.append(cp)
            continue
        pa, pb = RecordingPen(), RecordingPen()
        ga[name].draw(pa)
        gb[cb[cp]].draw(pb)
        if pa.value != pb.value or a["hmtx"][name][0] != b["hmtx"][cb[cp]][0]:
            bad.append(cp)
    return bad


def build(src_path, unicodes):
    opts = subset.Options()
    opts.hinting = False
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 14]
    opts.flavor = "woff2"
    font = subset.load_font(src_path, opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(unicodes))
    sub.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, opts)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", required=True, help="directory holding the upstream source files")
    ap.add_argument("--check", action="store_true", help="compare with the committed files; write nothing")
    args = ap.parse_args()
    failed = False
    for s in SUBSETS:
        src = os.path.join(args.src, s["src"])
        if not os.path.exists(src):
            sys.exit(f"{s['src']}: not in {args.src}; download it from {s['url']}")
        got = sha256(src)
        if got != s["sha256"]:
            sys.exit(f"{s['src']}: sha256 {got} is not the recorded {s['sha256']}; refusing a different upstream build")
        bad = latin_mismatches(os.path.join(FONTS, s["latin"]), src)
        if bad:
            sys.exit(f"{s['src']}: {len(bad)} code points differ from the shipped {s['latin']} "
                     f"(first U+{bad[0]:04X}); not the build the Latin file came from")
        data = build(src, s["unicodes"])
        out = os.path.join(FONTS, s["out"])
        if args.check:
            have = open(out, "rb").read() if os.path.exists(out) else b""
            same = have == data
            failed |= not same
            print(f"{s['out']}: {'same' if same else 'DIFFERS'} ({len(data)} bytes built, {len(have)} committed)")
        else:
            with open(out, "wb") as f:
                f.write(data)
            print(f"{s['out']}: {len(data)} bytes from {s['src']} ({s['unicodes']})")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
