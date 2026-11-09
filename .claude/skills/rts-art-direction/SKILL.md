---
name: rts-art-direction
description: >-
  Use this skill for ANY art, material, lighting or look question in Roaring Lions: designing,
  modelling, texturing or judging a unit, vehicle, building, prop, terrain material or effect;
  matching a new asset (Blender build or Meshy-generated) to the existing world; PBR albedo,
  roughness and metalness values; team colour placement; readability, silhouette and value at RTS
  zoom; sun, sky, environment light, shadows, exposure and tone mapping (ACES, Neutral, AgX); time
  of day and dusk; de-lighting baked Meshy textures; look-dev turntables; Blender colour management
  and glTF export; and three.js WebGL2 or WebGPU/TSL techniques (node materials, compute
  particles, GTAO, TRAA, decals, instancing, LODs). Trigger on requests like "make it look like a
  top RTS", "this unit does not match", "the lighting looks off", "units disappear into the
  ground", "best practice from Command & Conquer / StarCraft / Company of Heroes / Age of Empires",
  and before any art brief or Meshy prompt. It gives readability principles from leading RTS
  games, sourced PBR and lighting values, a 22-step matching checklist, WebGPU and Blender
  technique notes with costs, and the game's ranked art gaps.
---

# RTS art direction, materials and lighting for Roaring Lions

You are the art director and technical artist. The goal is the best-looking RTS in its genre, where every asset and effect **sits in the same world** and every unit **reads at play zoom**. The look draws on what leading RTS games taught: readability first, team colour as a budget, effects that rank above everything else, and a ground that serves the units. The art is built with modern three.js/WebGPU and Blender techniques. The art stays **original**: learn principles from other games, never copy their assets, names, factions or specific looks.

The sourced research (URL per claim; estimates and search-summary-only claims flagged) is in `references/`:
- `references/leading-rts-best-practices.md`: twelve leading RTS games across eight dimensions (art direction, materials and lighting, effects, unit feedback, camera, terrain, UI, technique), then **twelve ranked principles** applied to Roaring Lions (§13). Primary sources are strongest for StarCraft II and Company of Heroes 2, and empty dimensions are marked as such, not filled.
- `references/readability-and-direction.md`: shape, then value, hue, motion and detail; five forms of the squint test; selective exaggeration; team colour placement; a quiet ground; the effects hierarchy; UI versus world.
- `references/materials-and-lighting.md`:
  - PBR rules, and an albedo table in linear and sRGB values;
  - roughness by wear, and the metal cap;
  - AO and texel density;
  - sun and sky ratios, tone mappers and shadows;
  - de-lighting Meshy bakes and the look-dev rig;
  - **the 22-step matching checklist** (§15).
- `references/webgpu-and-blender.md`:
  - each WebGPU and three.js technique with its cost and browser caveat (compute is WebGPU-only, so a WebGL2 fallback is needed);
  - Blender modelling, baking and colour management;
  - glTF export and headless runs;
  - a look-dev scene matched to the game's light.
- `references/game-mapping.md`: what the game already does right (about 20 practices), the ranked gaps, the best WebGPU bets, and which of the 12 principles are followed, partial or missing.

## The twelve principles (ranked; details in references §13)

1. **Silhouette and value first, for the camera you ship.** Units read at 30–80 px, so the silhouette is gated (IoU at 64 px). The **value step** between a unit and the ground is not gated yet. That is the top gap: `olive.1` (0.163 linear luminance) sits within 30% of scrub and mid-dust, and both team colours (about 0.17) are darker than desert ground.
2. **The ground serves the units:** lower contrast, lower chroma, and noise that means something.
3. **What the player sees must equal what the sim does.** Blast rings equal splash, the turret points where it fires, the damage state matches HP.
4. **Team colour is a tuned budget on top surfaces:** about 2–6% of a vehicle (an estimate) and one element on infantry, backed by non-diegetic channels (icons, rings). Only the Lavi has a team mark today.
5. **The ground records the battle:** craters, scorch, tracks, wrecks. There are no vehicle tracks yet.
6. **Brightness and saturated hue are reserved for effects and threats.** Only effects exceed 1.0, with gains in `units/hdr-gains.ts`.
7. **Zoom is a design axis,** with an icon handoff at strategic zoom. That does not apply yet.
8. **Grime and damage grow from play,** not from baked textures. This one is a gap.
9. **Weight and believable motion sell scale.** See the `vehicle-movement` and `infantry-movement` skills.
10. **Lighting stays legible at every time of day.** Dusk must not cost readability.
11. **Effects cost is capped,** not proportional to the size of the fight.
12. **The UI shares the world's material language** and stays out of the way.

## Values to start from

**Albedo** (linear, matte dielectric 0.04–0.6; Filament's 30–240 sRGB band):
- charcoal 0.02, not the often-quoted 0.04;
- olive drab paint ≈ 0.11;
- desert sand ≈ 0.4;
- the rest (limestone, concrete, rust, rubber, glass) is in references §2.

**Light:**
- Real sun-to-sky runs 4:1 to 9:1; the game's day is about 4:1.
- Keep metal for bare metal only, capped at the project's limit: 0.7 with an environment, 0.45 without.

**Tone mapping:**
- The game is ACES at exposure 1.0.
- ACES shifts saturated hues. Khronos PBR Neutral keeps base colours exact between 0.08 and 0.8, so consider it when team colours or palette fidelity drift. Changing it is a lead decision and moves every baseline.

**Blender look-dev matched to the game:**
- the Blender sun strength equals the game's sun intensity;
- the world strength is the hemisphere value ÷ π;
- render with the same view transform as the game before judging.

## How to work

1. **Read the project's rules first** (CLAUDE.md, "The three.js backend"):
   - output SRGBColorSpace, ACES at 1.0, linear vertex and uniform colours (`hexToLinear`);
   - every world material is a MeshStandardMaterial;
   - the side-light `SUN_DIRECTION`;
   - environment per material class, never `scene.environment`;
   - bloom only above 1.0, with gains in one table;
   - render orders from `render-order.ts`;
   - zero materials in a GLB unless the type is a textured exemption;
   - the team mark is a shader box, never a texture;
   - palette keys for every authored colour, enforced by `validate:ui` and `validate:meshes`.
2. **Follow the matching checklist** in `references/materials-and-lighting.md` §15. In short:
   - **A, numbers for the lead first:** the class and its neighbours, their reference values, albedo bands from palette keys, roughness and metal, the team-colour placement, and the budget. **Get the lead's approval before any render or Meshy call.**
   - **B, build:** real metres, bevels that catch the sun, no baked lighting (de-light Meshy textures), and roles split into named nodes.
   - **C, test under the game's light:** the look-dev rig, the grey ball and chart check, role luminance within one ramp step of the neighbours, and a 360° turn.
   - **D, test in the game:** sandbox each theme at min, default and max zoom, at dawn, day and dusk, and in rain. Do one Metal browser check on your own port with music off. Do the squint test, the busiest-frame test, team colour for every colour-vision variant, and the effect rules.
   - **E, gate:** `validate:meshes`, `validate:data`, then the visual gate, blessed from CI numbers only after looking at the picture.
3. **Choose techniques by visible gain for the cost:**
   - **Best bets** (references `game-mapping.md`):
     - shared TSL material layers: about 0 ms, and they give team marks and theme dust for every asset;
     - compute particles for explosions, with a WebGL2 fallback;
     - vehicle tracks through the existing decal pool;
     - TRAA.
   - **Not now:** SSGI, SSR, impostors.
   - **No new libraries without the lead.**
4. **Pair with the domain skills:**
   - `levant-terrain` for ground, plants, rocks and buildings;
   - `explosion-physics` for effects;
   - `vehicle-movement` and `infantry-movement` for motion.
5. **Present every proposal as a table:** reference value, today's value, proposed value and the reason, with images at play zoom and at a close-up. The lead judges zoomed in.

## Lead preferences that bind (from project memory)

- **Every model at maximum detail,** simplified only to a measured budget.
- **Kit and gear must look real** at real sizes. He called boxy, exaggerated kit "robots".
- **No status marks in the world.** Unit status goes on icons and the HUD.
- **Maps keep the fight visible.**
- **Desert maps need desert foliage.**
- **AI-generated art is permitted,** but it must be disclosed in the PR and pass the same gates.
