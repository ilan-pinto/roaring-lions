# Roaring Lions — Art Pipeline Specification

**Status:** draft v1 · feeds `CLAUDE.md` · scope: visual production only

---

## 0. The governing idea

An open-source RTS has two art problems that look unrelated but share one solution:

1. Claude Code cannot draw.
2. Contributed art from many hands drifts into visual mush.

The solution to both is that **nobody hand-authors a sprite.** Contributors submit a `.blend`; CI renders it against a rig nobody can modify and quantizes it to a palette nobody can extend. Consistency stops being a matter of talent or taste and becomes a build step. This is how the original Command & Conquer and Red Alert were made, and it is the only approach that survives contact with strangers on the internet.

The corollary, which is the single most important thing in this document: **at 40–80 px on screen, model quality is nearly irrelevant.** What players read as "good art" is lighting, palette, VFX, animation, and terrain density. Four of those five are code or data. Budget accordingly — the money goes to hero assets and the effort goes to effects.

---

## 1. Visual identity

**Projection:** 2:1 dimetric, orthographic, camera elevation **26.565°** (`atan(0.5)`).

Not 30°. 30° is the value people eyeball and it produces a 1.73:1 tile, which will not seat on a 2:1 grid. Every sprite in the game will be subtly wrong and it is extremely annoying to diagnose after the fact.

**Light:** hard near-noon sun, azimuth 135° / altitude 55°. Long enough shadows to read volume, short enough that adjacent units don't shadow each other on the grid.

**Mood:** sun-bleached limestone, dust ochre, olive drab. Deliberately desaturated — the desaturation is what makes VFX pop, so it is a mechanical decision, not only an aesthetic one.

**Alternate palettes:** thermal and night-vision variants for night missions. Applied as a runtime remap over the same sprites, so they cost no extra art. They are also mechanically meaningful, since they change what the player can detect — which ties the game's best-looking moments to its best systems.

---

## 2. Palette — `data/palette.json`

32 colors. Locked. Adding a color is a version bump and a project-lead decision, not a PR.

| Band | Slots | Role |
|---|---|---|
| limestone | 5 | terrain, masonry, concrete |
| dust | 4 | sand, roads, rubble, particulate |
| olive | 4 | KDF hulls, uniforms |
| gunmetal | 4 | weapons, tracks, industrial |
| shadow | 3 | cast shadow, occlusion, night base |
| scrub | 2 | sparse vegetation |
| water | 2 | sky, sea, cisterns |
| **vfx (reserved)** | 5 | **runtime only** |
| **team (reserved)** | 3 | **runtime only** |

The two reserved bands are the load-bearing part. Saturated color appears **only** in explosions, tracers, interceptor trails, and team markers. A contributor who bakes fire-orange into a hull has quietly destroyed the contrast rule for the whole game, so CI rejects it by name.

Team-color regions are authored as pure magenta `#FF00FF` in the source material and remapped at runtime.

---

## 3. Render rig — `tools/render_rig.py`

Headless Blender. Builds camera, sun, fill, and world **in code**, so the rig cannot drift between contributions.

```bash
blender -b -P tools/render_rig.py -- \
    --input art/src/mbt_lavi.blend \
    --out   assets/sprites/mbt_lavi \
    --facings 16 --size 256
```

Invariants worth stating explicitly because breaking them is subtle:

- **The object rotates; the camera and sun do not.** Rotating the camera instead is the most common sprite-pipeline mistake and it makes cast shadows swing around as a unit turns. The roster looks broken and it is hard to see why.
- **View transform is `Standard`, not Filmic.** Quantizing to 32 colors needs a linear response or the ramps smear across bands.
- **Film transparent, RGBA, binary alpha.** Soft edges fight quantization and buy nothing at gameplay zoom.
- 16 facings at 22.5° increments. Output plus `manifest.json` per unit.

---

## 4. CI gate — `tools/validate_assets.py`

Runs on every PR touching `assets/sprites/`. All four checks fail the build.

| Check | Rule | Why |
|---|---|---|
| Palette | every opaque pixel is exactly a palette entry | cohesion is mechanical |
| Reserved | no vfx/team band in static art | protects VFX contrast + team remap |
| Alpha | binary only (0 or 255) | quantization + fill rate |
| **Silhouette** | pairwise IoU < 0.88 at 64 px, black | **readability in a busy fight** |

The silhouette check is the one that matters most and the one no other project bothers with. Every unit must be identifiable as a pure black shape at gameplay zoom. If two units collide above the threshold, one of them needs a distinguishing profile — a different turret, a radar mast, a raised cab. It is the check that keeps the game readable when forty units are on screen and everything is on fire.

---

## 5. VFX — `data/schemas/vfx_emitter.schema.json`

**This is where the game will actually be won visually, and it is pure data.** A mediocre sprite with muzzle flash, tracer travel, impact dust, scorch decals, and a burning wreck reads better than a beautiful sprite with none of it.

Emitters are JSON, triggered by sim events, driven by a seeded **presentation** PRNG that is entirely separate from the sim PRNG. VFX must never feed back into the simulation — determinism and replays depend on it.

Priority list, roughly in order of payoff:

1. Muzzle flash + transient light + tracers with real travel time
2. Impact dust, spall, penetration spark
3. **Persistent ground decals** — scorch, craters, rubble, wrecks that last the whole mission. This single feature is the difference between "a map" and "a battlefield."
4. Tracked-vehicle dust trails, rotor wash
5. Iron Dome interceptor arcs — the game's signature silhouette against the sky
6. Tunnel collapse dust column
7. Screen shake, hit-stop on penetration, heat shimmer on burning wrecks
8. Damage-state sprite swaps: clean → scarred → burning

See `data/vfx/catastrophic_kill.json` for the canonical ramp: `white_hot → fire → ember → dust`, stepped rather than interpolated so intermediate frames stay on-palette.

---

## 6. Terrain — the 60% nobody budgets for

Most projects polish units and ship ugly ground, then wonder why it looks amateur. Ground is the majority of every screenshot.

- Multi-material tilesets with **edge blending**, not hard tile boundaries
- Heavy scatter props: jersey barriers, water tanks, satellite dishes, laundry lines, rebar, tire piles, wrecked civilian cars, olive trees
- Scatter density is the whole difference between "a place" and "a grid"
- Decal layer for tire tracks, oil stains, patched asphalt

Scatter props are the ideal first contribution — small, low-risk, high visual return, and they exercise the full pipeline.

---

## 7. Asset sourcing

**Licensing trap, stated plainly:** Synty POLYGON packs are visually ideal for this game and **cannot be used.** Their license forbids redistributing source assets in a public repo, as do most paid packs. Anything entering this repository needs explicit redistribution rights. Check before, not after.

Safe: **Kenney.nl** (CC0), Quaternius, Poly Pizza, OpenGameArt filtered to CC0.

**Recommended path — hero assets plus kitbash.** Commission 6–10 source models from a single artist (~$600–1,500) together with a written style bible. Then kitbash the rest from those parts in Blender: one tank chassis yields six variants, one building shell yields a district. Consistency comes free because everything descends from the same hand. This is by a wide margin the best quality-per-dollar available to a project this size.

**AI-generated art:** workable for concept art, terrain textures, and UI backgrounds. Poor for unit sprites — you cannot get 16 consistent facings of the same vehicle. Note also that a meaningful part of the open-source game community will decline to contribute to a project that uses it. Take an explicit position in `CONTRIBUTING.md` either way; ambiguity here causes more friction than either answer.

---

## 8. Licensing

- Code: **MIT**
- Art and data: **CC BY-SA 4.0**
- All contributions under **DCO sign-off**
- Source `.blend` files required alongside rendered output — no binary-only art. Without source, the asset cannot be re-rendered when the rig or palette version bumps, and it becomes dead weight.

---

## 9. Repository layout

```
art/src/            *.blend sources (required, never optional)
assets/sprites/     rendered output + manifest.json, CI-generated
data/palette.json   locked 32-colour palette
data/vfx/           emitter definitions
data/schemas/       JSON Schema for all data-driven content
tools/render_rig.py
tools/validate_assets.py
docs/ART_PIPELINE.md
```

---

## 10. Definition of done for a unit contribution

1. `.blend` in `art/src/`, single object named `UNIT`, team regions in `#FF00FF`
2. Renders cleanly through `render_rig.py` at 16 facings
3. Passes all four CI checks, silhouette included
4. Damage states authored: clean / scarred / burning
5. Stats JSON passes the cost-curve validator (see balance spec)
6. DCO sign-off present
