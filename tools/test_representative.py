"""Canonical-sprite selection for the silhouette gate.

Run: python3 tools/test_representative.py
Exits non-zero on failure. Deliberately dependency-free -- the repo's test
runner is vitest, and adding pytest for one tool would be heavier than the
thing it tests.
"""
import importlib.util
import os
import sys

spec = importlib.util.spec_from_file_location(
    "va", os.path.join(os.path.dirname(__file__), "validate_assets.py")
)
va = importlib.util.module_from_spec(spec)
spec.loader.exec_module(va)

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")


# A clip-format sheet must resolve to its idle, not to whatever sorts first.
# 'down' sorts before 'idle' alphabetically, which is exactly the bug.
clipped = [
    "assets/sprites/EITAN_HULL/down_f00_000.png",
    "assets/sprites/EITAN_HULL/idle_f00_000.png",
    "assets/sprites/EITAN_HULL/idle_f03_000.png",
    "assets/sprites/EITAN_HULL/wreck_f00_000.png",
]
check(
    "clip sheet prefers idle facing 00",
    va.representative(clipped)["EITAN_HULL"],
    "assets/sprites/EITAN_HULL/idle_f00_000.png",
)

# A legacy flat sheet must still resolve to f00_000.
legacy = [
    "assets/sprites/TNK_HULL/f05_000.png",
    "assets/sprites/TNK_HULL/f00_000.png",
    "assets/sprites/TNK_HULL/f11_000.png",
]
check(
    "legacy sheet prefers f00_000",
    va.representative(legacy)["TNK_HULL"],
    "assets/sprites/TNK_HULL/f00_000.png",
)

# Mixed units in one list must not contaminate each other.
mixed = clipped + legacy
reps = va.representative(mixed)
check("mixed: clip unit", reps["EITAN_HULL"], "assets/sprites/EITAN_HULL/idle_f00_000.png")
check("mixed: legacy unit", reps["TNK_HULL"], "assets/sprites/TNK_HULL/f00_000.png")

# A clip sheet with no idle is an authoring error and must raise, not
# silently measure the wrong pose.
try:
    va.representative(["assets/sprites/BROKEN/wreck_f00_000.png"])
    failures.append("no-idle sheet: expected SystemExit, got none")
except SystemExit:
    pass

if failures:
    for f in failures:
        print("FAIL", f)
    sys.exit(1)
print(f"representative(): {4 + 1} checks passed")
