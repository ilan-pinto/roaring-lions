"""Mock up the campaign world map for Roaring Lions.

    python3 draw_world.py out.svg

A design mockup, not shipped code. Colours come from data/palette.json so the screen is
argued about in the game's own palette rather than in whatever looked nice here.

The geography carries the campaign order: the Marj is pressed against Kedem's coastal
plain with no depth between them, Sur stands behind a mountain wall to the north, and
Naharin lies across the river to the east, feeding both. Proximity, standoff, source.

Three region states, and the difference between them has to survive being glanced at:

  live      full colour, gold border, its towns named in white
  complete  flattened to one muted tone, texture dropped, towns struck through
  locked    its own texture at low contrast, plus a padlock and the unlock condition

The first draft dimmed complete and locked by laying shadow over them at 40-60%, which
turned both nearly black and cost the labels. Dropping *texture* and *saturation* reads
as retired far better than dropping brightness does.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path("/Users/ilpinto/dev/roaring-lions")
PAL = json.loads((ROOT / "data" / "palette.json").read_text())["ramps"]
ramp = lambda n, i: PAL[n]["colors"][min(i, len(PAL[n]["colors"]) - 1)]

W, H = 1140, 790
INK, PAPER = ramp("shadow", 1), ramp("limestone", 0)
SEA, SEA_D = ramp("water", 5), ramp("water", 7)
KEDEM_F = ramp("limestone", 1)
GREEN, GOLD = ramp("scrub", 2), ramp("dust", 1)
SPENT = ramp("limestone", 4)          # the one tone a finished region flattens to

MARJ = "M 104,296 L 156,264 L 200,298 L 212,372 L 200,470 L 172,558 L 124,592 L 88,540 L 78,434 Z"
KEDEM_P = ("M 212,372 L 200,298 L 156,264 L 182,204 L 272,168 L 404,148 L 564,156 "
           "L 704,194 L 790,266 L 816,368 L 796,470 L 724,556 L 600,606 L 444,614 "
           "L 304,590 L 200,470 Z")
SUR = ("M 182,204 L 238,116 L 356,66 L 524,56 L 668,86 L 764,148 L 790,266 L 704,194 "
       "L 564,156 L 404,148 L 272,168 Z")
NAHARIN = "M 816,368 L 904,298 L 1016,298 L 1058,382 L 1044,504 L 976,588 L 860,604 L 724,556 L 796,470 Z"
COAST = "M 0,0 L 104,0 L 92,120 L 104,296 L 78,434 L 88,540 L 124,592 L 108,700 L 96,790 L 0,790 Z"


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "world.svg")
    s = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'font-family="ui-sans-serif,system-ui,sans-serif">',
        "<defs>",
        f'<marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">'
        f'<path d="M 0,1 L 9,5 L 0,9 z" fill="{INK}"/></marker>',
        f'<marker id="g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">'
        f'<path d="M 0,1 L 9,5 L 0,9 z" fill="{ramp("dust", 3)}"/></marker>',
        # Built-up hatch: density is the whole point of the Marj.
        f'<pattern id="urban" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">'
        f'<rect width="6" height="6" fill="{ramp("terracotta", 2)}"/>'
        f'<line x1="0" y1="0" x2="0" y2="6" stroke="{ramp("terracotta", 4)}" stroke-width="2.5"/></pattern>',
        f'<pattern id="dunes" width="15" height="9" patternUnits="userSpaceOnUse">'
        f'<rect width="15" height="9" fill="{ramp("dust", 3)}"/>'
        f'<path d="M0,7 q3.75,-4.5 7.5,0 q3.75,4.5 7.5,0" fill="none" stroke="{ramp("dust", 5)}" '
        f'stroke-width="1.1" opacity="0.55"/></pattern>',
        f'<linearGradient id="seag" x1="0" y1="0" x2="1" y2="0">'
        f'<stop offset="0" stop-color="{SEA_D}"/><stop offset="1" stop-color="{SEA}"/></linearGradient>',
        "</defs>",
        f'<rect width="{W}" height="{H}" fill="{PAPER}"/>',
        # The coast follows the Marj's western edge, so the sea is a shoreline rather
        # than a rectangle ending mid-region.
        f'<path d="{COAST}" fill="url(#seag)"/>',
        f'<path d="{COAST}" fill="none" stroke="{ramp("water", 7)}" stroke-width="1.5" opacity="0.5"/>',
    ]

    # ---------------------------------------------------------------------------- Kedem
    s.append(f'<path d="{KEDEM_P}" fill="{KEDEM_F}" stroke="{INK}" stroke-width="2"/>')
    for cx, cy in ((334, 302), (304, 332), (364, 342), (474, 252), (524, 302), (624, 382),
                   (424, 432), (524, 472), (354, 472), (624, 252), (704, 332), (564, 552)):
        s.append(f'<ellipse cx="{cx}" cy="{cy}" rx="17" ry="11" fill="{GREEN}" opacity="0.28"/>')
    s.append(f'<text x="452" y="392" font-size="27" font-weight="700" fill="{INK}" opacity="0.42" '
             f'letter-spacing="8" text-anchor="middle">KEDEM</text>')
    s.append(f'<text x="452" y="413" font-size="10.5" fill="{INK}" opacity="0.4" letter-spacing="2.5" '
             f'text-anchor="middle">401st &quot;ARI\'IM&quot; BRIGADE</text>')
    s.append(f'<path d="M 438,438 l 9,-14 l 9,14 z" fill="{INK}" opacity="0.5"/>')
    s.append(f'<text x="462" y="448" font-size="10.5" fill="{INK}" opacity="0.5">Brigade garrison</text>')

    # ------------------------------------------ 1. the Marj Strip: taken, so flattened
    # Texture dropped and colour collapsed to one tone. It still reads as the dense
    # coastal strip by shape; it no longer competes for the eye.
    s.append(f'<path d="{MARJ}" fill="{SPENT}" stroke="{INK}" stroke-width="1.6" opacity="0.85"/>')
    for x, y, n in ((150, 372, "Beit Sahwan"), (142, 452, "Khan Rafid"), (148, 528, "Deir Amun")):
        s.append(f'<circle cx="{x}" cy="{y}" r="4.5" fill="{ramp("limestone", 6)}" stroke="{INK}" stroke-width="1.3" opacity="0.7"/>')
        s.append(f'<text x="{x - 9}" y="{y + 4}" font-size="11" fill="{PAPER}" opacity="0.9" '
                 f'text-anchor="end">{esc(n)}</text>')
        s.append(f'<line x1="{x - 9 - len(n) * 5.7}" y1="{y - 3.5}" x2="{x - 9}" y2="{y - 3.5}" '
                 f'stroke="{PAPER}" stroke-width="1" opacity="0.55"/>')
    s.append(f'<text x="146" y="252" font-size="13.5" font-weight="700" fill="{INK}" opacity="0.6" '
             f'text-anchor="middle" letter-spacing="0.5">THE MARJ STRIP</text>')

    # ------------------------------------------------------------ 2. Sur: the live front
    s.append(f'<path d="{SUR}" fill="{ramp("limestone", 2)}" stroke="{GOLD}" stroke-width="4"/>')
    for bx, by, sc in ((286, 160, 0.95), (348, 138, 1.3), (470, 124, 1.4),
                       (600, 132, 1.15), (664, 152, 1.2), (716, 172, 0.9), (240, 182, 0.8)):
        h = 30 * sc
        s.append(f'<path d="M {bx - h * 0.85},{by + h} L {bx},{by} L {bx + h * 0.85},{by + h} Z" '
                 f'fill="{ramp("gunmetal", 5)}" stroke="{INK}" stroke-width="1.2"/>')
        s.append(f'<path d="M {bx - h * 0.3},{by + h * 0.36} L {bx},{by} '
                 f'L {bx + h * 0.3},{by + h * 0.36} Z" fill="{PAPER}" opacity="0.8"/>')
    for x, y, n in ((410, 168, "Tel Marum"), (540, 172, "Umm Zeitoun")):
        s.append(f'<circle cx="{x}" cy="{y}" r="5.5" fill="{PAPER}" stroke="{INK}" stroke-width="2"/>')
        s.append(f'<text x="{x + 10}" y="{y + 4.5}" font-size="12" font-weight="600" fill="{INK}">{esc(n)}</text>')
    s.append(f'<text x="474" y="90" font-size="17.5" font-weight="700" fill="{INK}" '
             f'text-anchor="middle" letter-spacing="2">SUR</text>')
    s.append(f'<text x="474" y="107" font-size="10.5" fill="{INK}" opacity="0.7" text-anchor="middle">'
             f'rockets range onto Kedem&#8217;s north from behind the wall</text>')

    # --------------------------------------------- 3. Naharin: locked, across the river
    s.append(f'<g opacity="0.45">')
    s.append(f'<path d="{NAHARIN}" fill="url(#dunes)" stroke="{INK}" stroke-width="1.6"/>')
    s.append("</g>")
    s.append(f'<path d="M 816,368 C 842,414 838,462 796,470 C 826,522 800,548 724,556" '
             f'fill="none" stroke="{SEA}" stroke-width="6" opacity="0.55"/>')
    s.append(f'<circle cx="956" cy="440" r="4.5" fill="{ramp("limestone", 5)}" stroke="{INK}" stroke-width="1.3" opacity="0.55"/>')
    s.append(f'<text x="966" y="444" font-size="11" fill="{INK}" opacity="0.5">Wadi Halam</text>')
    s.append(f'<text x="940" y="344" font-size="16" font-weight="700" fill="{INK}" opacity="0.5" '
             f'text-anchor="middle" letter-spacing="1.5">NAHARIN</text>')
    # Padlock, so "locked" is not carried by dimness alone.
    lx, ly = 940, 372
    s.append(f'<rect x="{lx - 7}" y="{ly}" width="14" height="11" rx="2" fill="{INK}" opacity="0.5"/>')
    s.append(f'<path d="M {lx - 4},{ly} v -4 a 4,4 0 0 1 8,0 v 4" fill="none" stroke="{INK}" stroke-width="2" opacity="0.5"/>')
    s.append(f'<text x="{lx + 14}" y="{ly + 10}" font-size="10" fill="{INK}" opacity="0.5">'
             f'clear Umm Zeitoun</text>')

    # ------------------------------------------------- the order, drawn along the border
    s.append(f'<path d="M 176,236 C 196,180 238,142 292,116" fill="none" stroke="{ramp("dust", 3)}" '
             f'stroke-width="2.5" stroke-dasharray="8 6" opacity="0.85" marker-end="url(#g)"/>')
    s.append(f'<path d="M 776,196 C 830,242 850,278 878,300" fill="none" stroke="{INK}" '
             f'stroke-width="2" stroke-dasharray="7 6" opacity="0.3" marker-end="url(#a)"/>')

    for cx, cy, n, state in ((104, 196, "1", "done"), (474, 40, "2", "live"), (1010, 286, "3", "locked")):
        fill = {"done": SPENT, "live": GOLD, "locked": PAPER}[state]
        op = {"done": 0.8, "live": 1.0, "locked": 0.7}[state]
        s.append(f'<circle cx="{cx}" cy="{cy}" r="15" fill="{fill}" stroke="{INK}" stroke-width="2" opacity="{op}"/>')
        s.append(f'<text x="{cx}" y="{cy + 5.5}" font-size="15" font-weight="700" fill="{INK}" '
                 f'text-anchor="middle" opacity="{op}">{n}</text>')

    # --------------------------------------------------------------- the status panel
    px_, py_ = 40, 644
    s.append(f'<rect x="{px_}" y="{py_}" width="{W - 80}" height="110" rx="6" fill="{PAPER}" '
             f'stroke="{INK}" stroke-width="1.5"/>')
    cols = [
        ("THE MARJ STRIP", "Ashwar Front · tunnels, IEDs, ambush", "8 / 8 missions · ROE 82", "complete", SPENT, 0.55),
        ("SUR", "Sarim Brigades · rockets, ATGMs, standoff", "0 / 5 missions · open now", "in progress", GOLD, 1.0),
        ("NAHARIN", "Rif Cells · technicals, raids, smuggling", "locked — clear Umm Zeitoun", "locked", ramp("limestone", 5), 0.5),
    ]
    cw = (W - 80) / 3
    for i, (name, doct, prog, badge, colour, dim) in enumerate(cols):
        x = px_ + i * cw + 20
        s.append(f'<rect x="{px_ + i * cw + 1}" y="{py_ + 1}" width="5" height="108" fill="{colour}" opacity="{dim}"/>')
        if i:
            s.append(f'<line x1="{px_ + i * cw}" y1="{py_ + 12}" x2="{px_ + i * cw}" y2="{py_ + 98}" stroke="{INK}" stroke-width="1" opacity="0.18"/>')
        s.append(f'<text x="{x}" y="{py_ + 27}" font-size="13" font-weight="700" fill="{INK}" '
                 f'opacity="{dim}" letter-spacing="1">{esc(name)}</text>')
        s.append(f'<text x="{x}" y="{py_ + 47}" font-size="10.5" fill="{INK}" opacity="{dim * 0.75}">{esc(doct)}</text>')
        s.append(f'<text x="{x}" y="{py_ + 69}" font-size="11" fill="{INK}" opacity="{dim * 0.92}">{esc(prog)}</text>')
        bw = 12 + len(badge) * 6.7
        s.append(f'<rect x="{x}" y="{py_ + 80}" width="{bw}" height="19" rx="9.5" fill="{colour}" opacity="{dim * 0.95}"/>')
        s.append(f'<text x="{x + bw / 2}" y="{py_ + 93.5}" font-size="9.5" font-weight="700" fill="{INK}" '
                 f'text-anchor="middle" opacity="0.9">{esc(badge.upper())}</text>')

    s.append(f'<text x="{px_}" y="30" font-size="19" font-weight="700" fill="{INK}">The Sahar Basin</text>')
    s.append(f'<text x="{px_}" y="49" font-size="11" fill="{INK}" opacity="0.6">'
             f'campaign world · mockup · proximity, then standoff, then source</text>')
    s.append("</svg>")

    out.write_text("\n".join(s))
    print(f"{out} written")


if __name__ == "__main__":
    main()
