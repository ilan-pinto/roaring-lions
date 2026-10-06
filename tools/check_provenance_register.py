#!/usr/bin/env python3
"""Does every tracked asset have a row in the provenance register?

    python3 tools/check_provenance_register.py [--doc docs/ASSET_PROVENANCE.md]
                                               [--roots art assets]

The register is the set of tables between `<!-- register:start -->` and
`<!-- register:end -->` in docs/ASSET_PROVENANCE.md. The first cell of each
row names the files it covers, every one in backticks, as a path or a glob:
`*` and `?` stay inside one directory, `**` crosses directories, and
`{a,b}` expands. This script reads THOSE cells -- the document, not a copy of
its rows -- and compares them with `git ls-files <roots>`.

It fails (exit 1) on any of:

  * a tracked file no row covers          (a shipped asset with no provenance)
  * a tracked file two rows both cover    (two answers for one file)
  * a pattern that covers nothing         (a row left behind by a deletion)
  * `art/meshy/**/task.json` and `art/meshy/ledger.jsonl` disagreeing about
    which Meshy tasks exist, in either direction
  * `art/meshes/**/*.glb` and `assets/meshes/**/*.glb` not being one to one
    (the register says the second is the Draco twin of the first)

It checks that a row EXISTS, not that what the row says is true: the
columns are claims a person has to have checked. It is not wired into CI or
`pnpm test` -- doing that would make every art PR add a row, which is a
policy for the project lead to set, not a side effect of a docs pass.
"""
import argparse
import collections
import json
import os
import re
import subprocess
import sys

START, END = "<!-- register:start -->", "<!-- register:end -->"


def expand_braces(p):
    m = re.search(r"\{([^{}]*)\}", p)
    if not m:
        return [p]
    out = []
    for alt in m.group(1).split(","):
        out += expand_braces(p[:m.start()] + alt + p[m.end():])
    return out


def glob_re(g):
    """`**/` crosses directories (and may match none), `*` and `?` do not."""
    i, out = 0, ""
    while i < len(g):
        if g[i:i + 3] == "**/":
            out += "(?:.*/)?"
            i += 3
        elif g[i:i + 2] == "**":
            out += ".*"
            i += 2
        elif g[i] == "*":
            out += "[^/]*"
            i += 1
        elif g[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(g[i])
            i += 1
    return re.compile("^" + out + "$")


def register_patterns(text):
    """[(row_line_number, pattern)] from the first cell of every register row."""
    if START not in text or END not in text:
        raise SystemExit(f"register markers {START} / {END} not found")
    head, rest = text.split(START, 1)
    body = rest.split(END, 1)[0]
    base = head.count("\n") + 1
    pats = []
    for off, line in enumerate(body.splitlines()):
        if not line.startswith("|"):
            continue
        first = line.split("|")[1] if line.count("|") > 1 else ""
        for span in re.findall(r"`([^`]+)`", first):
            if re.fullmatch(r"(art|assets)/\S+", span):
                for e in expand_braces(span):
                    pats.append((base + off, e))
    return pats


def repo_root():
    return subprocess.check_output(["/usr/bin/git", "rev-parse", "--show-toplevel"], text=True).strip()


def tracked(root, roots):
    out = subprocess.check_output(["/usr/bin/git", "-C", root, "ls-files", *roots], text=True)
    return out.splitlines()


def meshy_ledger_gaps(root, files):
    """Meshy tasks the ledger and the committed task.json files disagree on."""
    ledger = os.path.join(root, "art/meshy/ledger.jsonl")
    if not os.path.exists(ledger):
        return ["art/meshy/ledger.jsonl is missing"]
    ids = {json.loads(l)["id"] for l in open(ledger) if l.strip()}
    seen = set()
    gaps = []
    for f in files:
        if f.startswith("art/meshy/") and f.endswith("/task.json"):
            d = json.load(open(os.path.join(root, f)))
            tid = d.get("id") or d.get("task_id") or (d.get("response") or {}).get("id") \
                or (d.get("final") or {}).get("id")
            seen.add(tid)
            if tid not in ids:
                gaps.append(f"{f}: task id {tid} is not in the ledger")
    for tid in sorted(ids - seen):
        gaps.append(f"ledger task {tid} has no committed task.json")
    return gaps


def mirror_gaps(files):
    a = {f[len("art/meshes/"):] for f in files if f.startswith("art/meshes/") and f.endswith(".glb")}
    b = {f[len("assets/meshes/"):] for f in files if f.startswith("assets/meshes/") and f.endswith(".glb")}
    return [f"art/meshes/{x} has no assets/meshes twin" for x in sorted(a - b)] + \
           [f"assets/meshes/{x} has no art/meshes source" for x in sorted(b - a)]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--doc", default="docs/ASSET_PROVENANCE.md")
    ap.add_argument("--roots", nargs="+", default=["art", "assets"])
    args = ap.parse_args(argv)

    root = repo_root()
    text = open(os.path.join(root, args.doc), encoding="utf-8").read()
    pats = register_patterns(text)
    if not pats:
        print("the register names no files at all", file=sys.stderr)
        return 1
    files = tracked(root, args.roots)

    owners = collections.defaultdict(set)
    dead = []
    for line, pat in pats:
        rx = glob_re(pat)
        hit = [f for f in files if rx.match(f)]
        if not hit:
            dead.append((line, pat))
        for f in hit:
            owners[f].add(line)

    uncovered = [f for f in files if f not in owners]
    doubled = {f: sorted(v) for f, v in owners.items() if len(v) > 1}
    ledger = meshy_ledger_gaps(root, files) if "art" in args.roots else []
    mirror = mirror_gaps(files) if "art" in args.roots and "assets" in args.roots else []

    print(f"{len(files)} tracked files under {', '.join(args.roots)}; "
          f"{len(pats)} register patterns across {len({l for l, _ in pats})} rows")
    for f in uncovered:
        print(f"NO ROW        {f}")
    for f, v in doubled.items():
        print(f"TWO ROWS      {f}  (doc lines {v})")
    for line, pat in dead:
        print(f"COVERS NOTHING  doc line {line}: {pat}")
    for g in ledger:
        print(f"LEDGER        {g}")
    for g in mirror:
        print(f"MIRROR        {g}")
    bad = len(uncovered) + len(doubled) + len(dead) + len(ledger) + len(mirror)
    print("register complete" if not bad else f"{bad} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
