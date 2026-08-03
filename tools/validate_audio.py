#!/usr/bin/env python3
"""
Roaring Lions -- audio CI gate.

The audio equivalent of validate_assets.py, and it exists for the same reason:
the failure mode of accepting sound from many hands is not bad taste, it is a
contributor committing a file nobody is allowed to redistribute. Six months
later the project has a licensing problem it cannot untangle.

    python tools/validate_audio.py

Checks (all fail the build):
  1. LICENSE   -- every variant declares a redistribution-safe license and a
                  source URL. This is the load-bearing check.
  2. RESOLVES  -- every declared file exists; every set has a known event.
  3. FORMAT    -- .ogg or .m4a/.mp3 only, under the size ceiling. Browsers
                  differ: OGG everywhere except Safari, M4A/MP3 for Safari.
  4. SANITY    -- pitch jitter and gains inside sane bounds, so one bad number
                  cannot blow out a player's ears.

Empty variant lists are legal and expected: BattleAudio falls back to its
procedural synth, so the game ships with sound from day one and real
recordings can land one file at a time.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "data", "audio.json")
AUDIO_DIR = os.path.join(ROOT, "assets", "audio")

# Licenses that permit redistribution of the source file in a public repo.
# CC-BY is allowed but obliges attribution -- the credit line is mandatory.
ALLOWED_LICENSES = {
    "CC0-1.0": False,
    "public-domain": False,
    "CC-BY-3.0": True,
    "CC-BY-4.0": True,
}

KNOWN_EVENTS = {
    "fire", "penetration", "ricochet", "near_miss", "aps_intercept", "destroyed",
}
KNOWN_WEAPON_CLASSES = {
    "apfsds", "heat", "he", "atgm", "rpg", "small_arms", "hmg", "autocannon",
    "mortar", "rocket", "interceptor", "demolition",
}
ALLOWED_EXT = {".ogg", ".m4a", ".mp3"}
MAX_BYTES = 512 * 1024      # a battlefield one-shot has no business being bigger
MAX_GAIN = 1.5
MAX_JITTER = 0.5


def main():
    failures = []

    if not os.path.exists(MANIFEST):
        print(f"no manifest at {MANIFEST} -- nothing to validate")
        return 0

    with open(MANIFEST) as fh:
        man = json.load(fh)

    master = man.get("master_gain", 1.0)
    if not 0 <= master <= MAX_GAIN:
        failures.append(f"master_gain {master} outside 0..{MAX_GAIN}")

    total_variants = 0
    for name, spec in man.get("sets", {}).items():
        event = spec.get("event")
        if event not in KNOWN_EVENTS:
            failures.append(f"set '{name}': unknown event '{event}'")
        for cls in spec.get("weapon_classes", []):
            if cls not in KNOWN_WEAPON_CLASSES:
                failures.append(f"set '{name}': unknown weapon class '{cls}'")

        gain = spec.get("gain", 1.0)
        if not 0 <= gain <= MAX_GAIN:
            failures.append(f"set '{name}': gain {gain} outside 0..{MAX_GAIN}")
        jitter = spec.get("pitch_jitter", 0.0)
        if not 0 <= jitter <= MAX_JITTER:
            failures.append(f"set '{name}': pitch_jitter {jitter} outside 0..{MAX_JITTER}")

        for v in spec.get("variants", []):
            total_variants += 1
            f = v.get("file")
            if not f:
                failures.append(f"set '{name}': variant with no file")
                continue

            lic = v.get("license")
            if lic not in ALLOWED_LICENSES:
                failures.append(
                    f"{f}: license '{lic}' is not redistribution-safe "
                    f"(allowed: {', '.join(sorted(ALLOWED_LICENSES))})"
                )
            elif ALLOWED_LICENSES[lic] and not v.get("credit"):
                failures.append(f"{f}: license {lic} requires a 'credit' line")
            if not v.get("source"):
                failures.append(f"{f}: no 'source' URL -- provenance must be checkable")

            # `file` is the primary encoding, `alt` the Safari fallback of the
            # same sound — both must exist and both must be playable formats.
            for role, rel in (("file", f), ("alt", v.get("alt"))):
                if rel is None:
                    continue
                ext = os.path.splitext(rel)[1].lower()
                if ext not in ALLOWED_EXT:
                    failures.append(f"{rel}: extension {ext} not one of {sorted(ALLOWED_EXT)} ({role})")
                path = os.path.join(AUDIO_DIR, rel)
                if not os.path.exists(path):
                    failures.append(f"{rel}: declared in the manifest but missing from assets/audio/")
                elif os.path.getsize(path) > MAX_BYTES:
                    kb = os.path.getsize(path) // 1024
                    failures.append(f"{rel}: {kb} KB exceeds the {MAX_BYTES // 1024} KB ceiling")

    # Files on disk that nothing references are dead weight nobody will notice.
    if os.path.isdir(AUDIO_DIR):
        declared = {
            rel
            for spec in man.get("sets", {}).values()
            for v in spec.get("variants", [])
            for rel in (v.get("file"), v.get("alt"))
            if rel
        }
        for dirpath, _, files in os.walk(AUDIO_DIR):
            for fn in files:
                if os.path.splitext(fn)[1].lower() not in ALLOWED_EXT:
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), AUDIO_DIR)
                if rel not in declared:
                    failures.append(f"{rel}: on disk but not declared in data/audio.json")

    if failures:
        print(f"\nAUDIO GATE FAILED -- {len(failures)} issue(s):\n")
        for f in failures:
            print(f"  - {f}")
        return 1

    if total_variants == 0:
        print("audio gate passed: manifest valid, no recordings yet (procedural synth in use)")
    else:
        print(f"audio gate passed: {total_variants} clip(s), all licensed for redistribution")
    return 0


if __name__ == "__main__":
    sys.exit(main())
