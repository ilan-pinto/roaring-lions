# Golden baselines for the visual gate

Committed PNG captures of the **three.js** renderer at a fixed scenario, tick
and camera. `pnpm golden-baseline` re-captures and compares against them; the
whole mechanism is documented in `tools/src/golden-diff/baseline.ts`, which is
worth reading before changing anything here.

## Why the directory name is an environment, not a commit

`<platform>-<arch>-<glFamily>` — `darwin-arm64-swiftshader`,
`linux-x64-swiftshader`. A baseline is only valid for the environment that
captured it, because the same commit rendered through different GL backends is
measurably different: on one machine, SwiftShader against ANGLE/Metal read 230
differing pixels / 0.0320 meanAbsChannelDelta on the `quiet` scenario alone —
roughly 100× that scenario's run-to-run noise, and enough to hide the defect the
gate exists to catch. A capture environment with no directory here is **exit 3**
from the gate, loudly, never a silent pass.

**Read what exit 3 does and does not check.** The run still captures every
scenario and still votes on the reference-free `groundTextureCheck` — but only
`open-ground` declares one, so on an unblessed runner a single 450×400 ground
crop is the whole verdict and the other four scenarios are captured and compared
to nothing. This sentence used to say "a real defect exits 1 even here", and a
measurement falsified it: erasing every decor object (`decor-place.ts`'s
`familyFor` → `return null` — no boulder, rock, tree, bush, slab, grass or sand
on any map) fails all four gated scenarios *with* a baseline — quiet 4306 px /
0.5064, open-ground 952 / 0.4753, vehicle 19313 / 2.0243, relief 37183 / 2.7229,
exit 1 — and exits **3** with none, which `ci.yml` turns into a green tick. In
that same run `open-ground`'s self-check read `fraction 0.9408 (budget <0.95) →
PASS`, the number a clean tree reads, while the same crop's baseline diff was 952
pixels. Exit 3 means "one crop of one scenario was checked and nothing was
COMPARED". The fix is to bless a baseline here, not to trust the code.

**Cross-OS portability is unmeasured.** Linux SwiftShader and macOS SwiftShader
may or may not agree; nobody has checked. Do not assume the macOS set covers CI.

## The bytes

**464.3 KiB per environment**: four PNGs plus a manifest — `quiet` 107.5 KiB,
`open-ground` 111.6 KiB, `vehicle` 169.1 KiB, `relief` 74.4 KiB. Only *gated*
scenarios are stored — `combat` is captured on every run and reported, but it
never votes (its own same-commit noise is wider than the signal), so storing a
baseline for it would have cost another 362 KiB for a number that cannot decide
anything. Its frame is uploaded as a CI artifact instead.

`relief` is the newest and the cheapest, and it is what gives the gate any
coverage of `tel_marum` — the only shipped map with elevation and the only one
with `b` boulder tiles. Deleting every boulder decor object used to leave the
whole gate green; it now reads 36001 px / 2.6292 there. 74.4 KiB was judged
worth that.

## Changing a baseline

Never by hand. `manifest.json` carries a sha256 of every PNG and the gate
refuses to compare against a file that does not match it.

```bash
pnpm golden-baseline:bless -- --reason="what changed and why the new picture is correct"
```

`--reason` is required and is printed on every future mismatch. On CI the same
thing happens through the `visual-baseline-bless` workflow, which opens a pull
request so somebody looks at the picture — GitHub renders each PNG before/after
in Files changed — before it becomes what every later run is judged against.

**Do not widen a threshold in `baseline.ts` to clear a red run.** Each one is
calibrated against a real repeated-capture noise measurement of its own
scenario, and the margins are small on purpose.
