# Look uplift: environment light, grade, unit materials, crowds

Status: **design, not started.** Every number in §7 waits on the lead
(approve art numbers before any render). Written 2026-11-01 after the lead
asked whether three.js can reach the visual level of a Unity title.

## 0. Why this exists

The answer to the lead's question is yes, and the gap is not the engine. What
ships today (`packages/render/src/three/`) is already a modern pipeline:
`MeshStandardMaterial` everywhere, ACES at exposure 1.0, a side sun with a
camera-fitted 4096² shadow map, GTAO, quarter-resolution HDR bloom, SMAA,
ground decals, haze and three time-of-day presets. The Defilade look
(GH-705) covers sun, shadow, AO, bloom and VFX and is not repeated here.

Four things a commercial engine gives by default are still missing. This spec
orders them by visual return per unit of work:

| Phase | What | Visible change | Cost |
|---|---|---|---|
| L1 | Image-based (environment) lighting | metal, glass and wet surfaces read as materials; shade gets sky colour | days |
| L2 | Colour grading LUT | a filmic, per-map, per-time-of-day mood | days |
| L3 | Textured unit materials | unit detail at close zoom: panel lines, wear, normals | weeks, Meshy credits |
| L4 | Vertex animation textures for infantry | lifts the ~1,150-figure draw-call ceiling | weeks |
| L5 | WebGPU renderer spike | decides whether compute VFX and better shadows are worth a migration | a spike |

Nothing here touches `@lions/sim`. Every phase is presentation only.

## 1. What does not change

- The four invariants. No sim code, no tuning, no determinism pin moves.
- The palette stays the source of every AUTHORED colour. An environment and a
  grade are built FROM palette keys, never from a raw hex.
- The sun stays the side light `SUN_DIRECTION`. L1 adds ambient, not a sun.
- No world status marks (the lead's rule) and no kit overlay.
- `high` is the reference preset, and the golden baselines move once per
  phase, blessed from CI numbers only.

## 2. L1: environment lighting

**Today.** Every world material is forced to `envMapIntensity = 0`
(`world-materials.ts` `texturedMaterial`, `units/unit-surface.ts`). With no
environment, a metal surface keeps only the sun's specular lobe and no diffuse
term, so metalness is capped at 0.45 (`gunmetal`) and a painted-metallic patch
once drew near-black (`docs/agent-notes/mesh-units.md`). Ambient comes from
one `HemisphereLight` (`lighting.ts`, intensity 0.9).

**Change.**
1. Build a small sky environment at BOOT, not from an HDRI file: a gradient
   sphere coloured from the time-of-day preset's palette keys (sky `water.0`,
   horizon, ground bounce `dust.4`, plus a soft sun disc on `SUN_DIRECTION`),
   rendered once through `PMREMGenerator` into `scene.environment`. No
   downloaded asset, so no licence question, and a palette revision reaches it.
   It rebuilds only when the time-of-day preset changes (never per frame).
2. Replace the blanket `envMapIntensity = 0` with a per-class value in ONE
   table beside `unit-surface.ts`'s roles (ground, building, unit dielectric,
   unit metal, glass). Ground albedo stays `NoColorSpace` and keeps its ratio
   meaning: the ground's value starts at 0 and is raised only if a capture
   shows it helps.
3. Lower `HEMISPHERE_INTENSITY` to hold the frame's exposure, measured by the
   luminance census rather than set by eye, then lift the metal cap from 0.45
   to the value in §7.
4. Add an `environment` debug layer (`three/debug-layers.ts`) with a
   visible-toggle floor in `BaselineSpec.layerChecks` (a third of the smallest
   of three runs, as for every layer).

**Risks.** The textured buildings (`TEXTURED_BUILDING_TYPES`) ship a bake that
already contains ambient, so they may brighten twice. Measure them separately.
The fog pass and haze read the lit frame, so check fogged tiles in the capture.
The bloom census (`tools/src/perf/bloom-census.ts`) must still hold every quiet
frame under the 1.0 threshold, or bloom starts firing on sunlit metal.

**Done when.** Lead approves the mock sheet, the CI bless lands, the
`environment` layer check is red with the layer hidden, and `pnpm perf:load`
plus the frame-time readings show no regression past the preset budgets.

## 3. L2: colour grading

**Change.** A grade is DATA: `data/grades/<id>.json`, a schema in
`data/schemas/`, holding lift/gamma/gain, saturation, warmth and a split tone,
each built from palette keys. The renderer bakes it into a 32³ 3D LUT at boot
and applies it in one pass after `OutputPass` (display-referred), before the
vignette and SMAA. A map or mission names its grade, defaulting to one per
time-of-day preset. `&grade=` joins the sandbox flags in `sandbox-help.ts` and
never changes how a real mission scores.

**Identity rule.** A neutral grade builds NO pass, so a map without a grade
draws the frame it draws today, bit for bit. A test pins that.

**Quality.** The pass is cheap, so it runs on all three presets, gated by a
GPU-timer reading before `low` gets it.

**Risks.** A grade can undo the readability work (team colours, CVD variants).
Run each grade through the four team-colour sets and the CVD modes before
approval; team colours that collapse under a grade are a refusal, not a tune.

## 4. L3: textured unit materials

**Today.** A unit GLB ships zero materials and is coloured at runtime from the
role ramp. Only `house`, `apartment`, `warehouse` and their wrecks ship a bake.

**Change.** Units ship base colour, normal and occlusion-roughness-metal maps,
with team colour taken from a mask channel so the four team-colour sets and
`variantAwareResolver` keep working. This reverses a standing rule ("a GLB
carries zero materials"), so it needs a lead ruling before any work. It is the
same direction as GH-155 (Meshy for every unit) and the art uplift's Phase 3.

**Pilot.** One vehicle and one infantry team, chosen by the lead, at max
detail (the lead's standing art rule), with a garage close-up approval render.
Measure the texture memory with `pnpm perf:load` against the memory gate before
a second unit is started.

**Pipeline impact.** `validate:meshes` gains a texture-budget check per class.
`TEXTURED_MESH_EXEMPT` becomes a rule by class, not a list of six. The vehicle
pipeline order (export, rescale, running gear, kit, wreck, damage, encode) is
unchanged; the wreck char needs `extras.rl_bake_luma` on every textured unit.

## 5. L4: vertex animation textures

**Today.** Rigged infantry is draw-call bound because `SkinnedMesh` does not
instance; the render budget is crossed at about 1,150 figures
(`docs/agent-notes/scaling-debts.md`).

**Change.** Bake each infantry clip into a position and normal texture at
export time (a new pass after `gait:meshes`, before `encode:meshes`), and draw
each team as an `InstancedMesh` with per-instance clip, phase and time scale.
Crossfades become a two-sample blend in the vertex shader. The skinned path
stays for the garage and close-ups.

**Note on the old open question.** `scaling-debts.md` says the "no band crawl"
result needs re-verifying because the toon ramp was indexed by normal. The toon
ramp was retired at the lit renderer (2026-09-15), so the question is now
whether baked, lerped normals shade the same as live skinning under PBR. The
gate is a side-by-side capture at zoom 1 and 2.5, plus `mesh_gait.test.ts`
passing on the baked output.

**Done when.** `tools/src/perf/three-units.ts` shows the new ceiling, and the
gait and facing gates pass per figure.

## 6. L5: WebGPU spike

three.js ships `WebGPURenderer` with a node shader language (TSL). It would
enable GPU compute particles, better shadow filtering and more lights. This
phase is a time-boxed spike only: port the post chain on one map in a
`dist-*/` build, measure frame time against WebGL2 on the same machine, list
which custom shaders (fog pass, ground, decals, GTAO filter) need rewriting in
TSL, and check browser support at that time. The output is a decision sheet
for the lead, not a migration. WebGL2 stays the shipping path regardless.

## 7. Numbers for the lead

Proposals to measure, not to ship. Each is approved on a mock sheet first.

| Knob | Today | Proposed start | How it is checked |
|---|---|---|---|
| Unit metal `envMapIntensity` | 0 | 0.6 | gunmetal stops reading black at zoom 1 |
| Unit dielectric `envMapIntensity` | 0 | 0.3 | shade side picks up sky colour |
| Building / ground `envMapIntensity` | 0 | 0.2 / 0 | textured bakes measured on their own |
| `HEMISPHERE_INTENSITY` | 0.9 | about 0.6, solved by census | quiet-frame mean luminance held within 2% |
| Metal cap (`gunmetal`) | 0.45 | 0.7 | no surface under 5% luminance in the sun |
| LUT size | none | 32³ | GPU timer on `low` |
| Default grades | none | dawn / day / dusk | team-colour and CVD sweep passes |

## 8. Order and gates

L1, then L2, then L3 and L4 in parallel lanes (different files), then L5.
Each phase lands on its own branch and PR, with its own CI bless and its
falsification in the commit message: the new layer check hidden, watched red.
No local `ui:routes`, `golden-baseline` or `ui:shots`; CI runs them. At most
one Metal browser check, on a port other than 5177, with music off.
