#!/usr/bin/env python3
"""Which shipped assets would a commercial build leave out? REPORT ONLY.

    python3 tools/commercial_asset_cut.py [--json OUT] [--dist DIR]
    pnpm commercial:cut

GH-1415, part (c), first step. This lists the files under `assets/` (Vite's
`publicDir`, copied whole into every build) that fail the commercial gate, by
the repository's own licence and provenance records. It removes nothing, writes
nothing but the optional `--json` report, and always exits 0 on a readable
input: the shipped build is unchanged. A later step turns this list into the
strip and makes a remaining file fatal; that step is the lead's call.

A file fails the gate when any ONE of these says so:

  * the register (`docs/ASSET_PROVENANCE.md`, between the register markers):
    the Rights cell of a row covering the file records an uncleared licence
    (`UNCLEARED_RIGHTS`: "not confirmed", "unrecorded", "pending", "open
    question"). A row whose Rights cell reads "Same as its source row" (the
    Draco twins under `assets/meshes/`) takes the `art/meshes/` twin's rows.
    A shipped file that no row covers fails too: no provenance, no sale.
    Rows are read with `check_provenance_register.py`'s own glob rules.
  * `data/audio.json`: `validate_audio.py`'s `commercial_manifest`, the very
    function `--commercial-manifest` uses (a variant whose `source` records an
    unconfirmed licence).
  * `data/video.json`: an entry whose `commercial` is not "confirmed", the
    rule `tools/validate_video.mjs` applies under `validate:data --commercial`
    (restated here: one field compared with one literal).

It also reports where the register and `data/audio.json` disagree about an
audio file. They are two records of the same fact; a file only one of them
flags is a record to fix, and the audio gate's known blind spot (the theme and
its beds, item 3: their `source` records no unconfirmed licence) shows here.

`--dist DIR` reads a built app (`pnpm build` writes `packages/app/dist`) and
says which of the files are in it, at the path the publicDir copy puts them
(`assets/x` ships as `DIR/x`): the bytes a strip would remove.
"""
import argparse
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# The register's Rights-cell markers of a licence not cleared for sale.
UNCLEARED_RIGHTS = re.compile(r"\bnot (yet )?confirmed\b|\bunrecorded\b|\bpending\b|\bopen question\b", re.IGNORECASE)
SAME_AS_SOURCE = "same as its source row"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


register_mod = _load("check_provenance_register")
audio_mod = _load("validate_audio")


def register_rows(text):
    """[(doc_line, [pattern], rights)] for every register row. The Rights
    column is found by name in each table's header, so a reordered table
    still reads right; a row with no Rights cell reads as ""."""
    start, end = register_mod.START, register_mod.END
    if start not in text or end not in text:
        raise ValueError(f"register markers {start} / {end} not found")
    head, rest = text.split(start, 1)
    body = rest.split(end, 1)[0]
    base = head.count("\n") + 1
    rows, rights_at = [], None
    for off, line in enumerate(body.splitlines()):
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and cells[0] == "Files":
            rights_at = cells.index("Rights") if "Rights" in cells else None
            continue
        pats = []
        for span in re.findall(r"`([^`]+)`", cells[0] if cells else ""):
            if re.fullmatch(r"(art|assets)/\S+", span):
                pats += register_mod.expand_braces(span)
        if not pats:
            continue
        rights = cells[rights_at] if rights_at is not None and rights_at < len(cells) else ""
        rows.append((base + off, pats, rights))
    return rows


def commercial_cut(register_text, files, audio_manifest, video_manifest):
    """The pure core. `files` are repository paths (`git ls-files art assets`).
    Returns a dict:
      excluded:  {assets/... path: [reason, ...]}, the shipped files that fail
      sources:   {art/... path: [reason, ...]}, flagged files that do not ship
      disagree:  [(path, flagged_by)] audio files only one record flags
    """
    rows = [(line, [register_mod.glob_re(p) for p in pats], rights) for line, pats, rights in register_rows(register_text)]
    covering = {f: [(line, rights) for line, rxs, rights in rows if any(rx.match(f) for rx in rxs)] for f in files}

    def register_reasons(f, seen=()):
        cells = covering.get(f, [])
        if not cells:
            return [f"register: no row covers {f}"]
        out = []
        for line, rights in cells:
            if rights.strip().lower() == SAME_AS_SOURCE and f.startswith("assets/meshes/") and f not in seen:
                out += register_reasons("art/meshes/" + f[len("assets/meshes/"):], seen + (f,))
            elif UNCLEARED_RIGHTS.search(rights):
                out.append(f"register line {line}: {rights}")
        return out

    flagged = {}
    for f in files:
        for r in register_reasons(f):
            flagged.setdefault(f, []).append(r)

    by_register = {f for f in flagged if f.startswith("assets/audio/")}
    _, audio_out = audio_mod.commercial_manifest(audio_manifest)
    by_audio = {"assets/audio/" + a for a in audio_out}
    for f in sorted(by_audio):
        flagged.setdefault(f, []).append("data/audio.json: licence not confirmed (validate_audio.py commercial_manifest)")

    entries = (video_manifest or {}).get("files") or {}
    for path, e in entries.items():
        state = e.get("commercial") if isinstance(e, dict) else None
        if state != "confirmed":
            flagged.setdefault("assets/" + path, []).append(f"data/video.json: commercial is {json.dumps(state)}, not \"confirmed\"")

    disagree = [(f, "register only") for f in sorted(by_register - by_audio)] + \
               [(f, "data/audio.json only") for f in sorted(by_audio - by_register)]
    return {
        "excluded": {f: r for f, r in sorted(flagged.items()) if f.startswith("assets/")},
        "sources": {f: r for f, r in sorted(flagged.items()) if not f.startswith("assets/")},
        "disagree": disagree,
    }


def in_dist(excluded, dist):
    """{path: bytes or None}: where each `assets/x` lands in a build (`dist/x`)."""
    out = {}
    for f in excluded:
        p = os.path.join(dist, f[len("assets/"):])
        out[f] = os.path.getsize(p) if os.path.isfile(p) else None
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--json", help="also write the report as JSON here")
    ap.add_argument("--dist", help="a built app directory, to say which files a strip would remove from it")
    args = ap.parse_args(argv)

    root = register_mod.repo_root()
    try:
        text = open(os.path.join(root, "docs/ASSET_PROVENANCE.md"), encoding="utf-8").read()
        audio = json.load(open(os.path.join(root, "data/audio.json"), encoding="utf-8"))
        video = json.load(open(os.path.join(root, "data/video.json"), encoding="utf-8"))
        cut = commercial_cut(text, register_mod.tracked(root, ["art", "assets"]), audio, video)
    except (OSError, ValueError) as err:
        print(f"commercial cut: cannot read the records: {err}", file=sys.stderr)
        return 2

    print("commercial asset cut -- REPORT ONLY: nothing is removed, the shipped build is unchanged (GH-1415)")
    dist = in_dist(cut["excluded"], args.dist) if args.dist else None
    print(f"{len(cut['excluded'])} shipped file(s) under assets/ would be left out of a commercial build:")
    for f, reasons in cut["excluded"].items():
        where = "" if dist is None else ("  [not in the build]" if dist[f] is None else f"  [in the build, {dist[f]} bytes]")
        print(f"  {f}{where}")
        for r in reasons:
            print(f"      {r}")
    if dist is not None:
        present = [b for b in dist.values() if b is not None]
        print(f"{len(present)} of them are in {args.dist}, {sum(present)} bytes")
    print(f"{len(cut['sources'])} source file(s) under art/ carry the same flag (not shipped; listed for the record):")
    for f in cut["sources"]:
        print(f"  {f}")
    print(f"{len(cut['disagree'])} audio file(s) where the register and data/audio.json disagree:")
    for f, who in cut["disagree"]:
        print(f"  {f}  ({who})")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({**cut, "dist": dist}, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
