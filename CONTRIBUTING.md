# Contributing to Roaring Lions

Thanks for considering it. This project accepts contributions of units, buildings, missions, VFX, art, and code. The gates below exist so that contributions from many hands still produce one coherent game — they are not a judgement on anyone's work.

Read `docs/GDD.md` before proposing design changes, and `CLAUDE.md` before writing code.

---

## Licensing and sign-off

- Code: **MIT**
- Art and data: **CC BY-SA 4.0**
- All commits require a **DCO sign-off** (`git commit -s`)

By contributing you confirm you have the right to license the work under these terms. **Do not submit assets from paid packs.** Most commercial packs — Synty POLYGON among them — forbid redistributing source assets in a public repository, regardless of whether you own a license. If you cannot point to explicit redistribution rights, it cannot go in.

**This applies to sound exactly as it does to art.** Audio clips go in `assets/audio/` and must be declared in `data/audio.json` with a `license` and a `source` URL; `pnpm validate:audio` fails the build otherwise. CC0 is the safe bar (Freesound filtered to CC0, Kenney.nl, OpenGameArt filtered to CC0); CC-BY is accepted with a `credit` line. Libraries that permit *use* but not redistribution — Zapsplat, most commercial SFX bundles — cannot be committed here even though the game may legally play them.

Safe sources: Kenney.nl (CC0), Quaternius, Poly Pizza, OpenGameArt filtered to CC0.

---

## AI-generated content policy

**Permitted**, including for assets that ship in the game.

**Disclosure is required** in the PR description wherever generative tools were used.

**The gates do not care where art came from.** Every sprite faces the same four CI
checks — exact palette match, binary alpha, minimum silhouette fill, and pairwise
silhouette distinctness — plus the redistribution-rights requirement that applies to
any asset entering this repository (`docs/ART_PIPELINE.md` §7). Generated art that
passes is as welcome as rendered art that passes; generated art that fails is
rejected for the same reasons anything else would be.

### What to expect in practice

Unit sprites are the hard case, and it is worth knowing before you spend an evening
on it: a unit needs 16 consistent facings of the same object plus damage states,
all under one locked lighting rig. Generative tools tend to lose object identity
between views — the output looks right in isolation and falls apart the moment the
unit rotates. `tools/render_rig.py` exists because rendering a model solves that
problem by construction. Concept art, terrain textures, and UI backgrounds have no
such constraint.

Disclosure is not a warning label. It is so reviewers know which questions to ask,
and so the licence trail stays legible.

---

## Contributing a unit

1. Stats JSON in `data/units/`, valid against `data/schemas/unit.schema.json`
2. `pnpm validate:data` passes
3. `python tools/validate_balance.py` passes — your unit must sit within the cost-curve tolerance band
4. Source `.blend` in `art/src/`, single object named `UNIT`, team-colour regions in pure magenta `#FF00FF`
5. Renders cleanly through `tools/render_rig.py` at 16 facings
6. `pnpm validate:assets` passes, **including the silhouette check** — your unit must be distinguishable from every existing unit as a pure black shape at gameplay zoom
7. Damage states authored: clean / scarred / burning

The balance gate is a heuristic and you are allowed to argue with it. If you think your unit is correctly priced and the curve is wrong, say so in the PR and make the case.

---

## Contributing a mission

1. JSON in `data/missions/`, valid against `data/schemas/mission.schema.json`
2. Declares its **ledger contract** — which campaign keys it requires and produces
3. Degrades gracefully: a mission that requires `intel.tunnel_mouths_marked` must still be playable, just harder, when that list is empty
4. Targets **12–20 minutes**
5. Led by one phase — layer objectives rather than defaulting to `destroy_all`

Missions are declarative data. If yours needs behaviour the schema cannot express, propose a schema extension rather than adding TypeScript. That constraint is what keeps missions authorable by people who do not know the codebase.

---

## Contributing code

Read the four invariants in `CLAUDE.md` first. In short: 20 Hz fixed tick, Q16.16 fixed-point in the sim with no floats, seeded per-entity PRNG, and strictly one-way data flow from sim to renderer.

`pnpm test:determinism` must pass on any change touching `@lions/sim`. It replays 1000 ticks from a fixed seed and asserts the state hash — it is the canary for the invariants above, and a failure there is never cosmetic.

---

## Setting and content standards

The Sahar Basin and every faction in it are **fictional**, and stay that way. Enemy forces are defined by **military doctrine only** — tunnels, standoff fires, mobile raiding. Never by ethnicity, nationality, or religion.

This is a design constraint as much as an editorial one: doctrine is what the player actually reads and counters, and it is what makes three enemy factions feel different to fight. Contributions that attach real-world identities to factions will be declined.
