# The Scene Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the lit world behind the menu. A stock `ThreeRenderer`, pointed at `beit_sahwan_outskirts` with four KDF units standing in a static `Sim`, draws at 30 fps behind the menu column; a photograph of that same frame is the poster while it loads and the plate whenever it cannot draw; the picture slides a few pixels against the column as the mouse moves; leaving the menu destroys the context outright. Every fallback says what it did in the DOM, and the visual gate learns to tell the three paths apart.

**Architecture:** A new render-side door, `@lions/render/three-front` (`packages/render/src/three/front/`), that drives a stock `ThreeRenderer` through its public surface and returns a four-member view; one additive `ThreeRenderer` method (`groundTexturesSettled`); and an app-side host (`ui/scene-host.ts`) built the repository's way — **a pure model module with its own `*.test.ts` (`ui/scene-host-model.ts`: the fallback decision, the lifecycle state machine, the parallax maths) and a thin DOM layer over it.** The diorama itself is data (`data/front/menu_diorama.json` against a new schema). What the host shares with a mission is extracted from `bootBattlefield` rather than copied: `rendererOptionsFor`, `meshPlanFor`/`meshManifestFor`, `standMapStructures`.

**Tech Stack:** TypeScript strict, three.js r170 (under `packages/render/src/three/**` only), vitest (node for pure modules, jsdom for DOM ones), Vite, Playwright (tools only), ajv (`validate:data`). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-24-scene-host-design.md` — its §2 measurements, §3 decisions, §5 state machine, §8 open questions, §9 rulings and §10 numbers. The parent is `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md` §5, §6 Phase 3, §7, §10 and D-1…D-51. The spec is the binding authority; this plan argues from it. Package: **WP-S3e (#178), scene-host half.** One branch, one landing.

**Execution timing.** Two entry conditions, both checked rather than assumed. (1) **`fix/renderer-reseed` has landed on `main`.** That branch adds `reseed()` to the `Renderer` interface and edits `packages/render/src/three/ThreeRenderer.ts` and `packages/app/src/mission-start.ts` while this plan is written; Task 0 merges `origin/main` after it lands and re-reads what it changed, and **nothing below assumes those files' current shape** — every `file:line` citation was taken at `2d92cbad` (v0.78.0) and must be re-grepped. (2) **The lead has approved spec §10's numbers** before Task 7 photographs anything (the repository's "numbers before rendering" rule). Tasks 0–6 run on the proposed values.

## Global Constraints

Copied from the specs and CLAUDE.md, binding on every task:

- **The sim is untouched.** `git diff --stat <base>..HEAD -- packages/sim` is EMPTY at landing; every task's gate line says so. The diorama builds a `Sim` and spawns into it through its own API at construction, exactly as `bootBattlefield` does, and **never ticks it** — no tick, no RNG draw, no event. `pnpm test:determinism` is in the gate of Tasks 2 and 3 anyway: the claim "cannot move the hash" is worth the measurement.
- **One lane on `ThreeRenderer.ts`.** Task 4 is this plan's only edit to that file, additive, after Task 0's merge. If another branch holds the file when Task 4 is reached, stop and wait; do not edit around it.
- **Three only under `packages/render/src/three/**`.** The app reaches the door by a dynamic `import('@lions/render/three-front')` only; Task 5 adds the specifier to eslint's `no-restricted-imports` list. `@lions/render/project` may be imported by **test files** only (precedent: `terrain-parity.test.ts:91`).
- **Two WebGL contexts never coexist.** The host's disposer runs synchronously in `Router.unmount()` before the next screen mounts, and it ends with an explicit `WEBGL_lose_context.loseContext()` — spec M14/M15: `ThreeRenderer.dispose()` alone keeps ~440 MB of GPU memory. No task may remove that line; Task 8 makes `ui:routes` fail if it goes.
- **Colour comes from the palette.** `theme.css` stays the only file naming an `--rl-*` variable; `pnpm validate:ui` stays at an empty allowlist; no hex, `rgb()` or `rgba()` literal in UI source. Every new length is a `rem` (`--host-bleed: 0.75rem`); a `px` ≥ 4 in UI CSS fails `validate:ui` unless tagged `/* px-ok */`, and nothing here needs one.
- **Screens are pure functions.** `showMenu(stage, opts)` still returns a disposer; the host is mounted through an injected `backdrop` option and is torn down by that disposer. Nothing reads `window.location` inside a screen.
- **No `any`. No non-null assertion in new code, tests included.** Strict TypeScript; tests colocated as `*.test.ts`; every DOM test opens with `// @vitest-environment jsdom`; `window.localStorage` differs between local Node 25 (a bare `{}`) and CI's Node 22 (a real `Storage`), so any storage read takes an injected storage and is tested with a fake.
- **The tool contracts stay whole.** `window.__lions` stays undefined on the menu (`ui:routes` asserts it). Every frame loop added here calls the bare global `requestAnimationFrame` **at call time** — never a reference captured at module load — so `FREEZE_FRAME_LOOP_STATEMENTS` (`tools/src/golden-diff/capture-protocol.ts:624`) freezes it. `.rl-menu`, `.rl-menu__nav`, `.rl-world`, `.rl-loading` keep their names. No URL or sandbox flag is added.
- **Every check gets an input that makes it fail — constructed, and run.** Each task's last step names the mutation and the commit says it was seen red.
- **Ports.** Port **5177 is the lead's**; never start, reuse or stop anything on it. `ensureDevServer` *reuses* whatever answers on a tool's port (`tools/src/golden-diff/browser.ts:56-64`), and during planning both 5176 and 5177 were held by other sessions — a run would have measured their trees. **From Task 1 on, every browser instrument is run with an explicit `--port` in 5190–5199.** Never `pkill`; stop a server you started by its process group.
- **The visual gate is blessed, never widened — and nothing here should move it.** Its four gated scenarios are sandbox URLs and `combat` a mission URL (`tools/src/golden-diff/baseline.ts`); none mounts the menu. Task 2's refactors change the mission's code path and not its values, so **`pnpm golden-baseline` GREEN with no bless is their evidence.** **No bless is budgeted.** A red `visual` run is a regression to find.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, plus what each task names. `git diff --stat -- packages/sim` empty.
- **Git hygiene:** `/usr/bin/git` by absolute path, one command per call; `git add <paths>` then `git commit -s -F <msgfile> -- <paths>`; never `-A`, never `git checkout -- <file>`, never amend; the attribution trailer the session's reminder gives, verbatim.

## Rulings taken while planning

The spec's §9, restated as the plan's rulings; each becomes `D-(n+51)` in the parent spec's Deviations at landing (Task 9).

- **R-1 — `ThreeRenderer.ts` gets one additive read, `groundTexturesSettled()`, and no menu mode.** The host is a consumer of `ThreeRenderer`'s public surface (loaders, `init`, `frame`, `camera`, `setDebugLayerVisible`, `canvas`, `dispose`). The one new read exists because spec M7 measured the ground textures landing *after* the first frame on a 20 Mbit/s link; revealing then would pop the sand in a moment later.
- **R-2 — `?renderer=pixi` gets the plate, not nothing.** The campaign board's argument: the Pixi choice persists per origin, so loading three behind it for the menu would ignore the player; the plate costs no second backend.
- **R-3 — reduced motion gets the plate, not a held live frame.** The plate is photographed from the host (Task 7), so it IS the held frame, without ~10 MiB and a ~0.5 GB context.
- **R-4 — `data-host` has a fourth, transient value, `pending`.** Without it `plate` means both "the poster, while loading" and "the plate, for good".
- **R-5 — the host lives on `/` only.** A host outliving its screen would live outside the stage the router clears (D-10's problem). Whether the other column screens sit on the plate is spec Q3.
- **R-6 — parallax moves the picture, not the camera.** An orthographic pan is a uniform translation that costs a 15–18 ms render (spec M10) per mouse move; a compositor transform costs nothing and works on the plate and on a held frame alike.
- **R-7 — no WebGL context exists while the slice is on the network.** The door prefetches every GLB and the Draco decoder into the HTTP cache under the host's `AbortSignal` and constructs the renderer only after.
- **R-8 — the camera target is (27, 22)**, one tile west of the (28, 22) measured in the spec's captures, because the frame's corner came within 0.17 tiles of the map edge there (spec M19). Task 3's test pins ≥ 1 tile at seven viewports.
- **R-9 — `ui:routes` and `ui:shots` take `--port`, and `plate:host` defaults to 5183** (free: the tools claim 5173–5179, 5181, 5182).
- **R-10 — the colour-register acceptance is camera-for-camera and is a vote in the screens check.** Spec M17: the same renderer at another zoom reads 17% apart, another camera with fog on 31%; at the same camera every variation measured stayed within 2%.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `tools/src/ui-review/routes-check.ts`, `tools/src/ui-review/shoot.ts` | `--port`; later the host legs and shots | 1, 8 |
| `packages/app/src/renderer-options.ts` (+test) | `rendererOptionsFor` — the mission's `RendererOptions`, now one copy | 2 |
| `packages/app/src/mesh-catalogue.ts` (+test) | `meshPlanFor`, `meshManifestFor` | 2 |
| `packages/app/src/map-sim.ts` (+test) | `standMapStructures` — buildings into a `Sim`, one copy | 2 |
| `packages/app/src/main.ts` | `bootBattlefield` calls the three extractions; `mountMenu` builds the host | 2, 6 |
| `data/front/menu_diorama.json`, `data/schemas/diorama.schema.json` | The diorama as data | 3 |
| `packages/data/src/index.ts` | `menuDiorama`, `DioramaJson` | 3 |
| `tools/validate_data.mjs` | Schema coverage; then the plate must exist | 3, 7 |
| `packages/app/src/front/diorama.ts` (+test) | `buildDioramaWorld`, `facingFromDeg`; then `dioramaSceneOptions` | 3, 6 |
| `packages/app/src/front/framing.ts` (+test) | `REF_LAYER`, `hostZoom` — the cover law | 3 |
| `packages/render/src/three/ThreeRenderer.ts` (+ `ThreeRenderer.ground-albedo.test.ts`) | `groundTexturesSettled()` | 4 |
| `packages/render/src/three/front/cadence.ts` (+test) | `drawDue`, `motionVerdict`, the three constants | 5 |
| `packages/render/src/three/front/scene-host.ts` | The door: `mountSceneHost` | 5 |
| `packages/render/package.json`, `eslint.config.mjs` | The `./three-front` export and its bundle-rule entry | 5 |
| `packages/app/src/ui/scene-host-model.ts` (+test) | `hostPath`, `hostStep`, `parallaxTarget`, `easeToward`, constants | 6 |
| `packages/app/src/ui/scene-host.ts` (+test) | The DOM layer: `sceneHost(stage, column, deps)` | 6 |
| `packages/app/src/renderer-choice.ts` (+test) | `readStoredRenderer`, `rememberRenderer` moved here from `menu.ts` | 6 |
| `packages/app/src/ui/webgl-probe.ts`, `packages/app/src/ui/worldmap3d.ts` | The throwaway-canvas WebGL2 probe, moved out of `worldmap3d.ts` so the host and the board share one | 6 |
| `packages/app/src/ui/menu.ts` (+test) | `backdrop` option; the banner leaves the column | 6 |
| `packages/app/src/ui/theme.css` | `.rl-scene-host`, `--host-bleed`, `--dur-host-reveal`, `.rl-menu` z-index | 6 |
| `tools/src/perf/host-plate-capture.ts`, `tools/package.json`, `package.json` | `pnpm plate:host`; `plate:capture` retired | 7 |
| `assets/ui/menu_host_plate.jpg` (new), `assets/ui/menu_plate.jpg` and `tools/src/perf/plate-capture.ts` (deleted) | The plate | 7 |
| `tools/src/golden-diff/register.ts` (+test) | `colourRegister`, `registerDelta`, `withinRegister` | 8 |
| `tools/src/golden-diff/screens-check.ts`, `tools/src/ci/three-baseline-gate.ts` | `checkMenuSceneHost`, wired before the scenarios | 8 |
| `CLAUDE.md` ("The scene host" subsection), the two specs | The record | 9 |

---

### Task 0: Entry — `main` after the reseed, and a baseline

Not a code task. **Coordinator, no model spend.**

- [ ] **Step 1:** `gh pr list --state merged --search "renderer-reseed"` or `git log origin/main --oneline -- packages/render/src/api.ts` — confirm `Renderer.reseed()` is on `main`. If it is not, **stop**; Tasks 1–3 may proceed on a branch cut from `main`, Task 4 may not.
- [ ] **Step 2:** In the implementation worktree (branch `feat/scene-host`, cut from `main` after this plan's docs PR merges): `/usr/bin/git fetch origin`, then `/usr/bin/git merge origin/main`.
- [ ] **Step 3:** Re-read before any code: `ThreeRenderer.init`, `snapshot`, `dispose` and whatever `reseed` became; `packages/app/src/mission-start.ts`; `bootBattlefield`'s renderer-options block (`main.ts:1566-1643` at `2d92cbad`), mesh plan (`:1694-1701`), loader calls (`:1780-1822`) and structure loop (`:1431-1439`). Update this plan's citations in the task you are about to run if they moved.
- [ ] **Step 4: Baseline gates**, recorded in the ledger so a later red is attributable: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:ui`, and `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/scene-host/baseline-0` (GREEN expected; if not, stop and report — it is not this branch's red).

---

### Task 1: The instruments take a port

R-9. `ui:routes` (`routes-check.ts:43`, `PORT = 5177`) and `ui:shots` (`shoot.ts:61`, `PORT = 5176`) hard-code ports other sessions were holding while this plan was measured, and `ensureDevServer` reuses a server it finds instead of starting one — so a run can silently photograph another worktree. Every later task runs these two, so this goes first.

**Files:**
- Modify: `tools/src/ui-review/routes-check.ts`, `tools/src/ui-review/shoot.ts`

- [ ] **Step 1: Implement.** In each file replace the constant with a parsed flag, default unchanged so CI (`ci.yml:236`) is unaffected:

```ts
// routes-check.ts has no arg() helper yet; shoot.ts's (`:66-69`) is reused there.
const portArg = process.argv.slice(2).find((a) => a.startsWith('--port='));
/** Its own port by default (5177 here, 5176 for ui:shots), overridable because
 *  `ensureDevServer` REUSES whatever already answers on it -- a worktree run on
 *  a port another session's server holds measures that session's tree. */
const PORT = portArg ? Number(portArg.slice('--port='.length)) : 5177;
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error(`bad --port "${portArg}"`);
```

Update both files' usage comments (`routes-check.ts:3`, `shoot.ts:10`) to show `--port`.

- [ ] **Step 2: Gates, falsify, commit.** Run `pnpm ui:routes -- --port=5196` and `pnpm ui:shots -- --port=5197 --res=1400x900 --out=.superpowers/scene-host/t1` and confirm each log line says it STARTED a server on that port (`[ui-routes] starting dev server on :5196`, not "reusing"). Falsify: `pnpm ui:routes -- --port=abc` must throw `bad --port`. Gates line. Message: `fix(tools): ui:routes and ui:shots take --port`, body naming the reuse hazard and the two ports seen held.

---

### Task 2: One copy of what a map needs to draw

The host must draw with the mission's options, the mission's meshes and the mission's buildings, or it is a second art style (spec §3.2). Today each of those is inline in `bootBattlefield`. This task extracts three pure functions and makes `bootBattlefield` call them, **changing no value** — which the visual gate proves.

**Files:**
- Create: `packages/app/src/renderer-options.ts`, `packages/app/src/renderer-options.test.ts`, `packages/app/src/map-sim.ts`, `packages/app/src/map-sim.test.ts`
- Modify: `packages/app/src/mesh-catalogue.ts`, `packages/app/src/mesh-catalogue.test.ts`, `packages/app/src/main.ts`

**Interfaces (Tasks 3 and 6 consume these names):**
- `interface RendererSettings { readonly colorVision: ColorVision; readonly quality: Quality }` (types from `settings.ts`)
- `function rendererOptionsFor(map: ParsedMap, s: RendererSettings, base: string): RendererOptions`
- `interface MeshPlan { readonly rigged: ReadonlySet<string>; readonly vehicles: ReadonlySet<string>; readonly buildings: ReadonlySet<string>; readonly decor: ReadonlySet<DecorFamilyName> }`
- `function meshPlanFor(map: ParsedMap, roster: ReadonlySet<string>, extraStructures?: readonly string[]): MeshPlan`
- `interface MeshManifest { readonly rigged: readonly { id: string; urls: readonly string[]; faction: MeshFactionName }[]; readonly vehicles: readonly { id: string; url: string }[]; readonly buildings: readonly { id: string; url: string }[]; readonly decor: ReadonlyMap<string, string> }`
- `function meshManifestFor(plan: MeshPlan): MeshManifest`
- `function standMapStructures(sim: Sim, map: ParsedMap): ReadonlyMap<string, number>`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/renderer-options.test.ts
import { describe, expect, it } from 'vitest';
import { maps, paletteColor, paletteTeamColors, parseMap } from '@lions/data';
import { QUALITY_PRESETS } from '@lions/render';
import { dracoDecoderPath } from './mesh-catalogue';
import { rendererOptionsFor } from './renderer-options';
import { TERRAIN_THEMES } from './terrain-themes';

const arid = parseMap(maps.beit_sahwan_outskirts);
const green = parseMap(maps.wadi_halam_basin);
const HIGH = { colorVision: 'default', quality: 'high' } as const;

describe('rendererOptionsFor', () => {
  // The two reads bootBattlefield made off `map.terrain` (main.ts:1583, :1623
  // at 2d92cbad). A theme that drew the wrong ground is a map in the wrong biome.
  it('chooses the tones and the open-ground albedo by the map theme', () => {
    const a = rendererOptionsFor(arid, HIGH, '/');
    const g = rendererOptionsFor(green, HIGH, '/');
    expect(a.terrainTones).toBe(TERRAIN_THEMES.arid);
    expect(g.terrainTones).toBe(TERRAIN_THEMES.green);
    expect(a.groundTextureUrl).toBe('/textures/desert_sand_tile.jpg');
    expect(g.groundTextureUrl).toBe('/textures/green_basin_tile.jpg');
  });

  it('serves every ground texture from the deploy base', () => {
    const o = rendererOptionsFor(arid, HIGH, '/roaring-lions/');
    const urls = [o.groundTextureUrl, o.rockTextureUrl, o.roadTextureUrl, o.scrubTextureUrl, o.groveTextureUrl, o.knollTextureUrl];
    for (const url of urls) expect(url?.startsWith('/roaring-lions/textures/'), String(url)).toBe(true);
  });

  it('carries the player quality preset by identity', () => {
    expect(rendererOptionsFor(arid, { colorVision: 'default', quality: 'low' }, '/').quality).toBe(QUALITY_PRESETS.low);
  });

  // Task 12 of Phase 1: the tuple AND the string-keyed resolver must agree, or
  // the silhouette, HP bars and zone tints stay on the default palette.
  it('routes the team colours through the chosen variant, tuple and resolver alike', () => {
    const o = rendererOptionsFor(arid, { colorVision: 'deuteranopia', quality: 'high' }, '/');
    const v = paletteTeamColors('deuteranopia');
    expect(o.teamColors).toEqual(v);
    expect(o.resolveColor?.('team.hostile')).toBe(v[1]);
    expect(o.resolveColor?.('dust.0')).toBe(paletteColor('dust.0'));
  });

  it('asks for the Draco decoder at the catalogue’s one spelling', () => {
    expect(rendererOptionsFor(arid, HIGH, '/').dracoDecoderPath).toBe(dracoDecoderPath());
  });

  it('keeps the palette entries bootBattlefield always used', () => {
    const o = rendererOptionsFor(arid, HIGH, '/');
    expect(o.background).toBe(paletteColor('shadow.1'));
    expect(o.hullColors).toEqual([paletteColor('olive.1'), paletteColor('dust.2'), paletteColor('limestone.1')]);
    expect(o.infantryColors).toEqual([paletteColor('olive.0'), paletteColor('dust.0'), paletteColor('limestone.1')]);
    expect(o.shellColors).toEqual([paletteColor('vfx.fire'), paletteColor('vfx.ember')]);
    expect(o.groupColors).toHaveLength(9);
    expect(o.groupColors[8]).toBe(paletteColor('group.g9'));
  });
});
```

```ts
// packages/app/src/map-sim.test.ts
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, structures } from '@lions/data';
import { standMapStructures } from './map-sim';

const map = parseMap(maps.beit_sahwan_outskirts);
const fresh = (): Sim => new Sim({ seed: 1, width: map.width, height: map.height, capacity: 8 });

describe('standMapStructures', () => {
  it('registers every catalogue type and stands one structure per run the map declares', () => {
    const sim = fresh();
    const idx = standMapStructures(sim, map);
    expect([...idx.keys()].sort()).toEqual(Object.keys(structures).sort());
    expect(sim.structureCount).toBe(map.structures.length);
  });

  it('names an unknown structure type rather than standing nothing', () => {
    const first = map.structures[0];
    if (first === undefined) throw new Error('fixture: the map stands buildings');
    const bad: typeof map = { ...map, structures: [{ ...first, type: 'bunker_x' }] };
    expect(() => standMapStructures(fresh(), bad)).toThrow(/bunker_x/);
  });
});
```

Append to `packages/app/src/mesh-catalogue.test.ts` (import `meshPlanFor`, `meshManifestFor`, `meshUrl`, `RIGGED_UNIT_MESHES`, `decorFamiliesFor` from `./mesh-catalogue` beside the file's existing imports):

```ts
describe('meshPlanFor', () => {
  const map = parseMap(maps.beit_sahwan_outskirts);

  it('splits a roster by mesh kind and drops a type with no mesh', () => {
    const plan = meshPlanFor(map, new Set(['mbt_lavi', 'inf_squad', 'apc_eitan', 'recon_drone']));
    expect([...plan.rigged]).toEqual(['inf_squad']);
    expect([...plan.vehicles].sort()).toEqual(['apc_eitan', 'mbt_lavi']);
  });

  it('stands the buildings the map stands, plus the ones a mission places', () => {
    expect([...meshPlanFor(map, new Set()).buildings].sort()).toEqual(['apartment', 'clinic', 'hall', 'house', 'shanty']);
    expect(meshPlanFor(map, new Set(), ['camp']).buildings.has('camp')).toBe(true);
  });

  it('takes its decor from decorFamiliesFor, never from a second rule', () => {
    expect(meshPlanFor(map, new Set()).decor).toEqual(decorFamiliesFor(map));
  });
});

describe('meshManifestFor', () => {
  it('resolves every planned id to served URLs, variants in catalogue order', () => {
    const m = meshManifestFor({
      rigged: new Set(['civilians']),
      vehicles: new Set(['mbt_lavi']),
      buildings: new Set(['house']),
      decor: new Set(['rock'] as const),
    });
    expect(m.rigged).toEqual([{ id: 'civilians', urls: RIGGED_UNIT_MESHES.civilians.files.map(meshUrl), faction: 'civilian' }]);
    expect(m.vehicles).toEqual([{ id: 'mbt_lavi', url: meshUrl('vehicles/mbt_lavi.glb') }]);
    expect(m.buildings).toEqual([{ id: 'house', url: meshUrl('buildings/house.glb') }]);
    expect([...m.decor.entries()]).toEqual([
      ['rock_0', meshUrl('decor/rock_0.glb')],
      ['rock_1', meshUrl('decor/rock_1.glb')],
      ['rock_2', meshUrl('decor/rock_2.glb')],
    ]);
  });
});
```

- [ ] **Step 2: Implement, and make `bootBattlefield` the extractions' first caller.**

`renderer-options.ts` is the `opts` object literal of `main.ts:1567-1643` (at `2d92cbad`), moved with its comments, parameterised on `map`, `s` and `base` (`BASE` in `main.ts`); `dracoDecoderPath()` stays the catalogue's call. `map-sim.ts` is `main.ts:1431-1439` returning the index map. `meshPlanFor` is `main.ts:1694-1701`'s `meshStructures`/`meshPlan` pair; `meshManifestFor` is the id → URL mapping `main.ts:1780-1822` spells inline for each loader. Then in `bootBattlefield`: the literal becomes `const opts = rendererOptionsFor(map, { colorVision: cvdVariant, quality: req.settings.get().video.quality }, BASE)`; the loop becomes `standMapStructures(sim, map)`; `meshPlan` becomes `meshPlanFor(map, meshRoster, (mission?.structures ?? []).map((s) => s.type))`; and the three `.map` blocks inside `Promise.all` iterate `meshManifestFor(meshPlan)`'s arrays. **The late-arrival loader (`ensureUnitMesh`) and the wreck loader keep reading the tables directly** — they load one id on demand and a manifest would add nothing.

- [ ] **Step 3: Gates, falsify, commit.**

Falsify three times, each seen red: (a) make `rendererOptionsFor` read `TERRAIN_THEMES.arid` unconditionally — the theme test fails; (b) drop `quality` from the returned object — the identity test fails; (c) make `meshPlanFor` ignore `extraStructures` — the `camp` test fails.

The gate that matters here is not a unit test: `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/scene-host/t2` **GREEN, every gated scenario 0 px / 0.0000 against the Phase 2 baseline**, and `pnpm ui:routes -- --port=5196` green. Plus the gates line and `pnpm test:determinism`. Message: `refactor(app): one copy of what a map needs to draw`, body naming the three extractions, that no value changed and the visual gate numbers that prove it, and the three mutations seen red.

---

### Task 3: The diorama is data, and its frame stays on the map

Spec §3.2 and R-8. The diorama is content — which map, where the camera looks, who stands where, which photograph is its plate — so it is JSON against a schema, and the rules a bad edit could break are tests, not comments.

**Files:**
- Create: `data/front/menu_diorama.json`, `data/schemas/diorama.schema.json`, `packages/app/src/front/diorama.ts`, `packages/app/src/front/diorama.test.ts`, `packages/app/src/front/framing.ts`, `packages/app/src/front/framing.test.ts`
- Modify: `packages/data/src/index.ts`, `tools/validate_data.mjs`

**Interfaces:**
- `@lions/data`: `interface DioramaJson { id: string; map: string; camera: { at: [number, number]; zoom_at_1080p: number }; units: { unit: string; at: [number, number]; facing_deg?: number }[]; plate: string }`, `const menuDiorama: DioramaJson`
- `front/framing.ts`: `const REF_LAYER: { readonly width: 1920; readonly height: 1080 }`, `function hostZoom(layerW: number, layerH: number, zoomAtRef: number): number`
- `front/diorama.ts`: `function facingFromDeg(deg: number): number`, `interface DioramaWorld { readonly sim: Sim; readonly map: ParsedMap; readonly plan: MeshPlan; readonly camera: { readonly x: number; readonly y: number }; readonly zoomAtRef: number }`, `function buildDioramaWorld(d: DioramaJson): DioramaWorld`

- [ ] **Step 1: The data.** `data/front/menu_diorama.json` carries spec §10's proposed numbers; the lead approves them before Task 7:

```json
{
  "id": "menu",
  "map": "beit_sahwan_outskirts",
  "camera": { "at": [27, 22], "zoom_at_1080p": 1.6 },
  "units": [
    { "unit": "mbt_lavi", "at": [17, 21], "facing_deg": 144 },
    { "unit": "apc_eitan", "at": [14, 22], "facing_deg": 144 },
    { "unit": "inf_squad", "at": [18, 23], "facing_deg": 144 },
    { "unit": "inf_squad", "at": [16, 24], "facing_deg": 144 }
  ],
  "plate": "ui/menu_host_plate.jpg"
}
```

`data/schemas/diorama.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "diorama.schema.json",
  "title": "A scene-host diorama: a real map, a camera and a few idle units",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "map", "camera", "units", "plate"],
  "$defs": {
    "tile": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 255 }, "minItems": 2, "maxItems": 2 }
  },
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "map": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$", "description": "A data/maps id; the app test proves it exists." },
    "camera": {
      "type": "object",
      "additionalProperties": false,
      "required": ["at", "zoom_at_1080p"],
      "properties": {
        "at": { "$ref": "#/$defs/tile" },
        "zoom_at_1080p": {
          "type": "number",
          "minimum": 0.35,
          "maximum": 2.5,
          "description": "Zoom at a 1920x1080 host layer; other sizes follow hostZoom's cover law. Bounds are main.ts's player zoom clamp."
        }
      }
    },
    "units": {
      "type": "array",
      "minItems": 1,
      "maxItems": 12,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["unit", "at"],
        "properties": {
          "unit": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
          "at": { "$ref": "#/$defs/tile" },
          "facing_deg": { "type": "number", "minimum": 0, "maximum": 360, "description": "The mission placement's own field and conversion (mission.ts)." }
        }
      }
    },
    "plate": { "type": "string", "pattern": "^ui/[a-z0-9_]+\\.jpg$", "description": "Path under assets/, photographed from the host by pnpm plate:host." }
  }
}
```

`packages/data/src/index.ts`: `import menuDioramaJson from '../../../data/front/menu_diorama.json';`, the `DioramaJson` interface above with a doc comment naming the schema, and `export const menuDiorama: DioramaJson = menuDioramaJson as DioramaJson;` (the assertion narrows `number[]` to the tuple; `tsc` still rejects a missing field). `tools/validate_data.mjs`: load `diorama.schema.json` beside the others (`:149-160`), add it to the "schema files missing" guard, compile it, and `checked += validateFile(join(ROOT, 'data/front/menu_diorama.json'), validators.diorama, 'diorama.schema');`.

- [ ] **Step 2: Write the failing tests**

```ts
// packages/app/src/front/framing.test.ts
import { describe, expect, it } from 'vitest';
import { REF_LAYER, hostZoom } from './framing';

describe('hostZoom -- the cover law', () => {
  it('is the reference zoom on the reference layer', () => {
    expect(hostZoom(REF_LAYER.width, REF_LAYER.height, 1.6)).toBeCloseTo(1.6, 10);
  });
  it('scales with a 16:9 layer, so every 16:9 screen frames the same world', () => {
    expect(hostZoom(2560, 1440, 1.6)).toBeCloseTo(2.1333333, 6);
  });
  it('lets width bind on a wide layer and crops the height, like object-fit: cover', () => {
    expect(hostZoom(2560, 1080, 1.6)).toBeCloseTo(2.1333333, 6);
  });
  it('lets height bind on a tall layer and crops the width', () => {
    expect(hostZoom(1600, 1200, 1.6)).toBeCloseTo(1.7777778, 6);
  });
  it('a zero-sized layer gives a finite positive zoom, never NaN or 0', () => {
    const z = hostZoom(0, 0, 1.6);
    expect(Number.isFinite(z) && z > 0).toBe(true);
  });
});
```

```ts
// packages/app/src/front/diorama.test.ts
import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import { maps, menuDiorama, parseMap, units, type DioramaJson } from '@lions/data';
// Test-only, like terrain-parity.test.ts:91: production app code asks the
// renderer for projection, but a test may hold data to project.ts's own maths.
import { screenToWorldFlat, worldToScreen } from '@lions/render/project';
import { hasUnitMesh } from '../mesh-catalogue';
import { buildDioramaWorld, facingFromDeg } from './diorama';
import { REF_LAYER, hostZoom } from './framing';

const tiny: DioramaJson = {
  id: 't',
  map: 'beit_sahwan_outskirts',
  camera: { at: [27, 22], zoom_at_1080p: 1.6 },
  units: [{ unit: 'mbt_lavi', at: [17, 21], facing_deg: 180 }],
  plate: 'ui/x.jpg',
};

describe('facingFromDeg', () => {
  // mission.ts's placement conversion: a turn is 1.0 in Q16.16, masked to it.
  it('is the mission placement conversion', () => {
    expect(facingFromDeg(0)).toBe(0);
    expect(facingFromDeg(90)).toBe(16384);
    expect(facingFromDeg(180)).toBe(32768);
    expect(facingFromDeg(360)).toBe(0);
  });
});

describe('buildDioramaWorld', () => {
  it('stands the map and spawns each unit on side 0 at its tile centre, facing as authored', () => {
    const w = buildDioramaWorld(tiny);
    expect(w.sim.structureCount).toBe(w.map.structures.length);
    const living = [...w.sim.state.alive.keys()].filter((i) => w.sim.state.alive[i] === 1);
    expect(living).toHaveLength(1);
    const id = living[0];
    expect(w.sim.state.side[id]).toBe(0);
    expect(w.sim.state.posX[id]).toBe(fx.from(17.5));
    expect(w.sim.state.posY[id]).toBe(fx.from(21.5));
    expect(w.sim.state.facing[id]).toBe(32768);
  });

  it('plans meshes for its own units and the buildings its map stands', () => {
    const w = buildDioramaWorld(tiny);
    expect([...w.plan.vehicles]).toEqual(['mbt_lavi']);
    expect([...w.plan.buildings].sort()).toEqual(['apartment', 'clinic', 'hall', 'house', 'shanty']);
  });

  // Invariant 1 has nothing to say about a sim that never runs, and that is
  // the point: no tick, no RNG draw, no event, no determinism surface.
  it('is never ticked', () => {
    expect(buildDioramaWorld(tiny).sim.tickCount).toBe(0);
  });

  it('throws by name for a map or a unit the data does not have', () => {
    expect(() => buildDioramaWorld({ ...tiny, map: 'nowhere' })).toThrow(/nowhere/);
    expect(() => buildDioramaWorld({ ...tiny, units: [{ unit: 'tank_x', at: [17, 21] }] })).toThrow(/tank_x/);
  });
});

describe('the shipped menu diorama', () => {
  const mapJson = (maps as Record<string, Parameters<typeof parseMap>[0] | undefined>)[menuDiorama.map];
  if (mapJson === undefined) throw new Error(`menu diorama names map "${menuDiorama.map}", which data/maps does not have`);
  const map = parseMap(mapJson);

  it('names shipped units, each with a mesh to draw', () => {
    for (const u of menuDiorama.units) {
      expect(u.unit in units, `${u.unit} is not a unit`).toBe(true);
      expect(hasUnitMesh(u.unit), `${u.unit} has no mesh -- the host would draw a billboard`).toBe(true);
    }
  });

  // "Placements spread across tiles" is a count>1 trap; every placement here
  // is one body on one tile, so a blocked tile is the whole of the check.
  it('stands every unit on an open tile', () => {
    for (const u of menuDiorama.units) {
      expect(map.blocked[u.at[1] * map.width + u.at[0]], `${u.unit} at ${u.at.join(',')}`).toBe(0);
    }
  });

  // Spec M19: (28,22) left 0.17 tiles here, and the off-map fade (D-1) would
  // have shown in a corner. 20 px is more than --host-bleed at any UI scale.
  const BLEED = 20;
  const VIEWPORTS: readonly (readonly [number, number])[] = [
    [1280, 800], [1366, 768], [1920, 1080], [2560, 1440], [3440, 1440], [1600, 1200], [2560, 1600],
  ];
  it.each(VIEWPORTS)('keeps the frame a whole tile inside the map at %ix%i', (w, h) => {
    const W = w + 2 * BLEED;
    const H = h + 2 * BLEED;
    const cam = { x: menuDiorama.camera.at[0], y: menuDiorama.camera.at[1], zoom: hostZoom(W, H, menuDiorama.camera.zoom_at_1080p) };
    for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
      const p = screenToWorldFlat(px, py, cam, { width: W, height: H });
      expect(Math.min(p.x, p.y, map.width - p.x, map.height - p.y), `corner ${px},${py}`).toBeGreaterThanOrEqual(1);
    }
  });

  // D-46: --menu-col-wide is 34rem at --ui-scale 1.15, 625.6 px of 1920,
  // centred. If spec Q2 moves the column, this number moves with it.
  it('puts every unit on screen and clear of the column at the 1920x1080 reference', () => {
    const W = REF_LAYER.width;
    const H = REF_LAYER.height;
    const cam = { x: menuDiorama.camera.at[0], y: menuDiorama.camera.at[1], zoom: hostZoom(W, H, menuDiorama.camera.zoom_at_1080p) };
    const colL = (W - 625.6) / 2;
    const colR = colL + 625.6;
    for (const u of menuDiorama.units) {
      const s = worldToScreen(u.at[0] + 0.5, u.at[1] + 0.5, cam, { width: W, height: H });
      expect(s.x > 0.05 * W && s.x < 0.95 * W && s.y > 0.05 * H && s.y < 0.95 * H, `${u.unit} off frame at ${s.x},${s.y}`).toBe(true);
      expect(s.x < colL || s.x > colR, `${u.unit} under the column at x=${s.x.toFixed(0)}`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Implement.** `framing.ts`: `REF_LAYER = { width: 1920, height: 1080 } as const`; `hostZoom` returns `zoomAtRef * Math.max(Math.max(1, layerW) / REF_LAYER.width, Math.max(1, layerH) / REF_LAYER.height)`, with a header that states the cover law and why it matches the plate's `object-fit: cover` (spec §3.2). `diorama.ts`: `facingFromDeg(deg) = fx.div(fx.from(deg), fx.fromInt(360)) & 0xffff`, its header quoting `mission.ts`'s line (re-grep; `:1247` at `2d92cbad`) as the rule it mirrors; `buildDioramaWorld` looks the map up in `maps` and each unit in `units` (throwing by name), `parseMap`, `new Sim({ seed: 20260727, width, height, capacity: Math.max(8, d.units.length) })` (the seed is `bootBattlefield`'s; nothing consumes it since nothing ticks), `applyTerrain(map, sim)`, `standMapStructures(sim, map)`, `sim.addUnitType(u)` for every unit (as `bootBattlefield` does; the menu shows base units, so no `applyUpgrades`), `sim.spawn(type, 0, fx.from(x + 0.5), fx.from(y + 0.5), facingFromDeg(facing_deg ?? 0))` per placement, and `meshPlanFor(map, new Set(d.units.map((u) => u.unit)))`.

- [ ] **Step 4: Gates, falsify, commit.** Falsify three, each seen red: (a) `"at": [28, 22]` in the JSON — the corner test fails at 1366×768, 1920×1080 and 2560×1440; (b) a unit at a blocked tile (`[30, 10]`, inside a house) — the open-tile test fails; (c) delete `"plate"` from the JSON — `pnpm validate:data` fails with `must have required property 'plate' [diorama.schema]`. Gates line and `pnpm test:determinism`. Message: `feat(data): the menu diorama as data, and a frame that stays on its map`.

---

### Task 4: `ThreeRenderer.groundTexturesSettled()`

**Opus.** R-1. The only edit to `ThreeRenderer.ts` in this plan: additive, one field and one method, inside `loadGroundTexture` (`:1055` at `2d92cbad`, re-grep). Spec M7: at 20 Mbit/s the ground textures landed 0.10–0.24 s after the first frame; the host must not reveal a flat-palette ground and pop the sand in.

**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/ThreeRenderer.ground-albedo.test.ts`

**Interfaces:** `groundTexturesSettled(): Promise<void>` — resolves when every ground-texture load `init()` started has been applied or has failed; before `init()` it is already resolved; it never rejects.

- [ ] **Step 1: Write the failing tests.** Extend the file's existing fake (`FakeTextureLoader`, `:192-198`) to record a failure closure beside the success one, and reset it in the existing `beforeEach` (`:315-322`):

```ts
/** The failure half of each recorded load, index-aligned with
 *  `pendingTextures`: a test lands a load OR fails it, never both. */
let failTextures: (() => void)[] = [];

class FakeTextureLoader {
  load(
    _url: string,
    onLoad: (t: THREE.Texture) => void,
    _onProgress?: unknown,
    onError?: (e: unknown) => void
  ): THREE.Texture {
    const tex = new actual.Texture();
    pendingTextures.push(() => onLoad(tex));
    failTextures.push(() => onError?.(new Error('404 (fake)')));
    return tex;
  }
}
// ...and in beforeEach: failTextures = [];
```

```ts
describe('groundTexturesSettled', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('is already settled when no ground texture was asked for', async () => {
    const r = makeRenderer();
    let done = false;
    void r.groundTexturesSettled().then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(true);
    r.dispose();
  });

  it('waits for a load init() started, and settles once it has been applied', async () => {
    const r = makeTexturedRenderer();
    let done = false;
    void r.groundTexturesSettled().then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(false);
    expect(pendingTextures).toHaveLength(1);
    for (const land of pendingTextures) land();
    await flush();
    expect(done).toBe(true);
    r.dispose();
  });

  // A failed tile is already fail-soft in loadGroundTexture (flat palette tone,
  // a warning). The scene host must not hang on it, and must not see a throw.
  it('a failed load settles too, and the promise never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = makeTexturedRenderer();
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    r.groundTexturesSettled().then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      }
    );
    for (const fail of failTextures) fail();
    await flush();
    expect(outcome).toBe('resolved');
    warn.mockRestore();
    r.dispose();
  });
});
```

- [ ] **Step 2: Implement.** A private `groundTexturesPending: Promise<void> = Promise.resolve()`. In `loadGroundTexture`, collect one `Promise<void>` per `TextureLoader.load` actually started (after the slot and `GROUND_ALBEDOS` guards): resolve it at the END of the success callback (after the uniforms, the skirt and `invalidateGroundPhoto()`) and at the end of the error callback (after its warning). After the six `load(...)` calls, `this.groundTexturesPending = Promise.all(settles).then(() => undefined)`. The public method returns the field, with a doc comment naming the scene host as its first reader and spec M7 as the reason. Nothing else in the file changes; no existing test changes.

- [ ] **Step 3: Gates, falsify, commit.** Falsify twice, each seen red: (a) resolve each per-load promise immediately after calling `load(...)` instead of inside its callback — the "waits" test fails; (b) drop the resolve from the error callback — the "failed load settles" test reads `pending`. Gates line; `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/scene-host/t4` GREEN (nothing drawn changed). Message: `feat(render): a promise for the ground textures init() started`.

---

### Task 5: The door — `@lions/render/three-front`

**Opus.** Spec §3.1, §3.3, §4. The render-side glue: prefetch with no context, construct, load, reveal a complete frame, a capped loop that holds when the machine cannot afford it, a redraw on resize, and a disposal that destroys the context. The frame cadence is pure and tested; the rest is rendering, verified by Task 6's drive and Task 8's instruments.

**Files:**
- Create: `packages/render/src/three/front/cadence.ts`, `packages/render/src/three/front/cadence.test.ts`, `packages/render/src/three/front/scene-host.ts`
- Modify: `packages/render/package.json` (`"./three-front": "./src/three/front/scene-host.ts"`), `eslint.config.mjs` (a sixth entry in the app's `no-restricted-imports` `paths`, `:204-244`)

**Interfaces (Task 6 restates these exactly):** spec §4's `SceneHostMeshes`, `SceneHostOptions` (with `fpsCap` optional, default `HOST_FPS_CAP`), `SceneHostMotion`, `SceneHostView`, `mountSceneHost`. `cadence.ts`: `HOST_FPS_CAP = 30`, `HOLD_SAMPLES = 3`, `HOLD_FACTOR = 2.5`, `drawDue(nowMs, lastDrawMs, capFps): boolean`, `motionVerdict(intervalsMs, capFps): 'animate' | 'hold' | 'undecided'`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/three/front/cadence.test.ts
import { describe, expect, it } from 'vitest';
import { HOLD_FACTOR, HOLD_SAMPLES, HOST_FPS_CAP, drawDue, motionVerdict } from './cadence';

describe('drawDue', () => {
  it('draws the first frame whatever the clock says', () => {
    expect(drawDue(0, Number.NEGATIVE_INFINITY, 30)).toBe(true);
  });
  // rAF ticks land a hair either side of the period; 1 ms of slack keeps a
  // 60 Hz display on every second tick instead of every third.
  it('waits one period at the cap, less 1 ms of rAF jitter', () => {
    expect(drawDue(1031, 1000, 30)).toBe(false);
    expect(drawDue(1032.4, 1000, 30)).toBe(true);
  });
  it('a cap of 0 draws on every call', () => {
    expect(drawDue(1000.1, 1000, 0)).toBe(true);
  });
});

describe('motionVerdict', () => {
  const period = 1000 / 30;
  it('is undecided until it has HOLD_SAMPLES intervals', () => {
    expect(motionVerdict([33, 34], 30)).toBe('undecided');
  });
  // Spec M11: Metal at cap 30 draws every 33 ms.
  it('animates at the cadence Metal measured', () => {
    expect(motionVerdict([33.3, 33.4, 50], 30)).toBe('animate');
  });
  // Spec M12: SwiftShader, CI's rasteriser, takes ~920 ms a frame.
  it('holds at the cadence SwiftShader measured', () => {
    expect(motionVerdict([920, 880, 950], 30)).toBe('hold');
  });
  it('decides on the median, so one long frame does not hold', () => {
    expect(motionVerdict([33, 900, 34], 30)).toBe('animate');
  });
  it('the threshold is HOLD_FACTOR periods', () => {
    const under = period * HOLD_FACTOR - 1;
    const over = period * HOLD_FACTOR + 1;
    expect(motionVerdict([under, under, under], 30)).toBe('animate');
    expect(motionVerdict([over, over, over], 30)).toBe('hold');
  });
  it('reads only the first HOLD_SAMPLES intervals', () => {
    expect(motionVerdict([33, 33, 33, 900, 900, 900], 30)).toBe('animate');
  });
});

it('the constants are spec §10’s numbers', () => {
  expect(HOST_FPS_CAP).toBe(30);
  expect(HOLD_SAMPLES).toBe(3);
  expect(HOLD_FACTOR).toBe(2.5);
});
```

- [ ] **Step 2: Implement `cadence.ts`** (`drawDue`: `capFps <= 0 || nowMs - lastDrawMs >= 1000 / capFps - 1`; `motionVerdict`: fewer than `HOLD_SAMPLES` intervals → `'undecided'`, else the median of the first `HOLD_SAMPLES` against `HOLD_FACTOR * 1000 / capFps`). No three import in this file, so its test runs without one.

- [ ] **Step 3: Implement the door.** Its header states spec §3.1's argument in brief and the three counter-intuitive rules below. The shape, in order — the executor writes it, and every line marked *must* is one a review checks:

```ts
export async function mountSceneHost(host: HTMLElement, opts: SceneHostOptions): Promise<SceneHostView> {
  const { signal } = opts;
  const stop = (): never => {
    throw new DOMException('scene host left', 'AbortError');
  };
  // 1. Bytes first, NO context (R-7). Every GLB and the Draco decoder into the
  //    HTTP cache; the GLTFLoader's own requests below then hit it. Must
  //    consume each body -- an unread response is not cached.
  await Promise.all(prefetchUrls(opts).map(async (url) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`scene host: ${url} answered HTTP ${res.status}`);
    await res.arrayBuffer();
  }));
  if (signal.aborted) stop();

  // 2. The context. From here an abort must release it AT ONCE, not at the
  //    next await: the router mounts the next screen right after.
  const renderer = new ThreeRenderer(opts.sim, opts.renderer);
  let released = false;
  let raf = 0;
  let observer: ResizeObserver | null = null;
  const release = (): void => {
    if (released) return;
    released = true;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    renderer.dispose();
    // MUST: dispose() alone keeps ~440 MB (spec M14/M15).
    renderer.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    renderer.canvas.remove();
  };
  signal.addEventListener('abort', release, { once: true });

  const frameCamera = (): void => { /* x/y from opts.camera; zoom = opts.zoomFor(host.clientWidth, host.clientHeight); opts.onCamera?.(...) */ };
  try {
    await Promise.all([/* loadMeshUnit / loadVehicleMesh / loadBuildingMesh(id, url, null) / loadDecorMeshes, from opts.meshes */]);
    if (signal.aborted) stop();
    renderer.setDecor(opts.decor);
    renderer.setElevation(opts.elevation);
    await renderer.init(host);
    if (signal.aborted) stop();
    renderer.useEmitters(opts.emitters.list, opts.emitters.resolve);
    renderer.setDebugLayerVisible('overlays', false);
    renderer.setDebugLayerVisible('fog', false); // uRevealAll: D-1's off-map fade keeps running
    frameCamera();
    renderer.frame(1, 0);
    await renderer.groundTexturesSettled();
    if (signal.aborted) stop();
    renderer.frame(1, 0);
  } catch (err) {
    release();
    throw err;
  }
  // 3. The loop (drawDue / motionVerdict), the hold, and the resize redraw.
  // MUST: call the global requestAnimationFrame at call time (the freeze).
  // MUST: redraw once on every resize, held or not -- fitToHost's setSize
  //       clears the canvas, and ThreeRenderer's own observer (registered in
  //       init, so it fires first) is what resized it.
  // ...
  return { canvas: renderer.canvas, get camera() { /* last applied */ }, get motion() { /* ... */ }, dispose: () => { signal.removeEventListener('abort', release); release(); } };
}
```

`prefetchUrls` is every URL in `opts.meshes` plus `${dracoDecoderPath}draco_wasm_wrapper.js` and `${dracoDecoderPath}draco_decoder.wasm` (the two files `assets/draco/` ships). The loop draws with `dt = now − lastDraw` (the renderer clamps its own clocks at 100 ms), records draw intervals after the first loop draw, and on a `'hold'` verdict cancels the loop, sets `motion = 'held'` and calls `onMotion('held')`. Units need no `snapshot()` and no `reseed`: they were spawned before construction, so `init()`'s own double snapshot seeds them.

- [ ] **Step 4: Package, lint rule, bundle.** Add the export and the eslint entry (message: *"The scene host is three.js. It must reach packages/app via a dynamic import() (see ui/scene-host.ts) -- a static one puts three.js in the main chunk for every player, including one on ?renderer=pixi who is shown the plate instead."*). Then `pnpm --filter @lions/app exec vite build --outDir ../../.superpowers/scene-host/dist-t5` (outside `dist/`, and `.superpowers/**` is lint-ignored) and read the chunk list: **the door is its own small chunk (< 15 kB), it shares the three core and `ThreeRenderer` chunks with `@lions/render/three` (spec M3's two files, one copy each), and the main chunk's size is unchanged ±1 kB against Task 0's build.** Paste the lines into the commit body.

- [ ] **Step 5: Gates, falsify, commit.** Falsify twice, each seen red: (a) `motionVerdict` comparing the MEAN instead of the median — "one long frame does not hold" fails; (b) add `import { mountSceneHost } from '@lions/render/three-front';` to any `packages/app/src` production file — `pnpm lint` fails with the new message (then remove it). Gates line. Message: `feat(render): the scene host's door, over a stock ThreeRenderer`, body: the three MUST lines and why each exists, the bundle numbers, the mutations seen red.

---

### Task 6: The host behind the menu

**Opus.** Spec §3.3–§3.6, §5; R-2…R-7. The pure model first, then the DOM layer over it, then the menu, the shell and the CSS. After this task the host runs; its plate 404s until Task 7 photographs it, which the DOM layer already survives.

**Files:**
- Create: `packages/app/src/ui/scene-host-model.ts`, `packages/app/src/ui/scene-host-model.test.ts`, `packages/app/src/ui/scene-host.ts`, `packages/app/src/ui/scene-host.test.ts`
- Create: `packages/app/src/ui/webgl-probe.ts` (the probe `worldmap3d.ts:185-192` holds today, moved, not copied)
- Modify: `packages/app/src/front/diorama.ts` (+test), `packages/app/src/renderer-choice.ts` (+test), `packages/app/src/ui/menu.ts` (+test), `packages/app/src/ui/worldmap3d.ts`, `packages/app/src/main.ts`, `packages/app/src/ui/theme.css`

**Interfaces:**
- `scene-host-model.ts`: `HostInputs`, `HostPath`, `PlateReason`, `hostPath(i)`, `HostState`, `HostEvent`, `HostEffect`, `HostStep`, `hostStep(state, event)`, `parallaxTarget(px, py, vw, vh)`, `easeToward(cur, tgt, dtMs, tauMs)`, and `HOST_DEADLINE_MS = 15000`, `CROSSFADE_MS = 400`, `PARALLAX_TAU_MS = 700`, `NARROW_COLUMN_SHARE = 0.7`, `IDLE_START_TIMEOUT_MS = 500`, `PARALLAX_SETTLE_EPS = 0.001`.
- `scene-host.ts`: `MountSceneHostView` (the door's signature restated; `loadDoor()` assigns the real `mountSceneHost` into it so `tsc` compares the two — `worldmap3d.ts:194-199`'s pattern), `SceneHostWorld` (the door's options minus `signal`/`onMotion`/`onCamera`), `SceneHostDeps`, `sceneHost(stage: HTMLElement, column: HTMLElement, deps: SceneHostDeps): Disposer`.
- `SceneHostDeps`, exactly (every optional member is a test seam with a production default, Step 3):

```ts
export interface SceneHostDeps {
  readonly plateUrl: string;                               // `${BASE}${menuDiorama.plate}`
  readonly renderer: RendererChoice;                       // renderer-choice.ts
  readonly world: () => SceneHostWorld;                    // built lazily, on the live path only
  readonly reducedMotion?: () => boolean;
  readonly saveData?: () => boolean;
  readonly webgl2?: () => boolean;
  readonly mount?: MountSceneHostView;                     // default: the dynamic import
  readonly schedule?: (fn: () => void) => () => void;      // returns a cancel
  readonly frame?: (cb: FrameRequestCallback) => number;   // the parallax easing loop
  readonly deadlineMs?: number;                            // default HOST_DEADLINE_MS
  readonly now?: () => number;                             // default performance.now
}
```
- `front/diorama.ts` gains `dioramaSceneOptions(d: DioramaJson, s: RendererSettings, base: string): SceneHostWorld`.
- `renderer-choice.ts` gains `readStoredRenderer(storage?: () => Partial<Pick<Storage, 'getItem'>> | undefined): string | null` and `rememberRenderer(choice: string, storage?: () => Partial<Pick<Storage, 'setItem'>> | undefined): void`, defaults `() => window.localStorage`, both wrapped in `try`.
- `MenuOptions` gains `backdrop?: (stage: HTMLElement, column: HTMLElement) => Disposer`.

- [ ] **Step 1: Write the failing model tests**

```ts
// packages/app/src/ui/scene-host-model.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  CROSSFADE_MS, HOST_DEADLINE_MS, NARROW_COLUMN_SHARE, PARALLAX_TAU_MS,
  easeToward, hostPath, hostStep, parallaxTarget, type HostInputs,
} from './scene-host-model';

const base = (over: Partial<HostInputs> = {}): HostInputs => ({
  renderer: 'three',
  reducedMotion: false,
  saveData: false,
  viewportWidth: 1920,
  columnWidth: 625.6,
  webgl2: () => true,
  ...over,
});

describe('hostPath', () => {
  it('is live on three, with WebGL2 and room either side of the column', () => {
    expect(hostPath(base())).toEqual({ path: 'live' });
  });
  it('is off when the column takes more than 70% of the width -- nothing to show', () => {
    expect(hostPath(base({ viewportWidth: 390, columnWidth: 358.8 }))).toEqual({ path: 'off', reason: 'narrow' });
    expect(hostPath(base({ viewportWidth: 1000, columnWidth: 700 })).path).toBe('live'); // exactly 70% still has flanks
  });
  // The campaign board's rule: a Pixi player never creates even a throwaway
  // WebGL context on this screen, and never downloads three.
  it('Pixi gets the plate and never probes WebGL2', () => {
    const probe = vi.fn(() => true);
    expect(hostPath(base({ renderer: 'pixi', webgl2: probe }))).toEqual({ path: 'plate', reason: 'pixi' });
    expect(probe).not.toHaveBeenCalled();
  });
  it('reduced motion gets the plate and never probes WebGL2', () => {
    const probe = vi.fn(() => true);
    expect(hostPath(base({ reducedMotion: true, webgl2: probe }))).toEqual({ path: 'plate', reason: 'reduced-motion' });
    expect(probe).not.toHaveBeenCalled();
  });
  it('save-data gets the plate', () => {
    expect(hostPath(base({ saveData: true }))).toEqual({ path: 'plate', reason: 'save-data' });
  });
  it('no WebGL2 gets the plate', () => {
    expect(hostPath(base({ webgl2: () => false }))).toEqual({ path: 'plate', reason: 'no-webgl2' });
  });
  it('narrow wins over every other reason: there is no picture to choose', () => {
    expect(hostPath(base({ renderer: 'pixi', viewportWidth: 390, columnWidth: 358.8 })).path).toBe('off');
  });
  it('a zero-width viewport is narrow, never NaN', () => {
    expect(hostPath(base({ viewportWidth: 0 })).path).toBe('off');
  });
});

describe('hostStep -- spec §5, row by row', () => {
  it('pending + ready → live, reveal', () => {
    expect(hostStep('pending', { type: 'ready' })).toEqual({ state: 'live', effects: ['reveal'] });
  });
  it('pending + failed → plate, kept and named', () => {
    expect(hostStep('pending', { type: 'failed' })).toEqual({ state: 'plate', effects: ['keep-plate', 'warn'], reason: 'load-failed' });
  });
  it('pending + deadline → plate, and the load is aborted', () => {
    expect(hostStep('pending', { type: 'deadline' })).toEqual({ state: 'plate', effects: ['keep-plate', 'abort', 'warn'], reason: 'deadline' });
  });
  // The two leak rows: a view that arrives after nobody wants it must be
  // destroyed the moment it arrives, or it holds ~0.5 GB (spec M14).
  it('plate + a late ready → the view is disposed at once', () => {
    expect(hostStep('plate', { type: 'ready' })).toEqual({ state: 'plate', effects: ['dispose-view'] });
  });
  it('disposed + a late ready → the view is disposed at once', () => {
    expect(hostStep('disposed', { type: 'ready' })).toEqual({ state: 'disposed', effects: ['dispose-view'] });
  });
  it('live ignores a deadline', () => {
    expect(hostStep('live', { type: 'deadline' })).toEqual({ state: 'live', effects: [] });
  });
  it.each(['pending', 'live', 'plate', 'off'] as const)('%s + dispose → disposed, aborting and disposing', (s) => {
    expect(hostStep(s, { type: 'dispose' })).toEqual({ state: 'disposed', effects: ['abort', 'dispose-view'] });
  });
  it('disposed ignores everything but a late view', () => {
    expect(hostStep('disposed', { type: 'deadline' })).toEqual({ state: 'disposed', effects: [] });
    expect(hostStep('disposed', { type: 'failed' })).toEqual({ state: 'disposed', effects: [] });
    expect(hostStep('disposed', { type: 'dispose' })).toEqual({ state: 'disposed', effects: [] });
  });
  // An abort WE caused surfaces from the door as a rejection; after a
  // deadline it must not warn a second time.
  it('plate ignores a late failure', () => {
    expect(hostStep('plate', { type: 'failed' })).toEqual({ state: 'plate', effects: [] });
  });
});

describe('parallaxTarget', () => {
  it('is centred when the pointer is', () => {
    const t = parallaxTarget(960, 540, 1920, 1080);
    expect(t.x).toBeCloseTo(0, 10);
    expect(t.y).toBeCloseTo(0, 10);
  });
  it('moves against the pointer: the scene is seen through the column like a window', () => {
    expect(parallaxTarget(1920, 540, 1920, 1080).x).toBeCloseTo(-1, 10);
    expect(parallaxTarget(0, 540, 1920, 1080).x).toBeCloseTo(1, 10);
    expect(parallaxTarget(960, 1080, 1920, 1080).y).toBeCloseTo(-1, 10);
  });
  it('clamps a pointer outside the viewport', () => {
    expect(parallaxTarget(5000, -300, 1920, 1080)).toEqual({ x: -1, y: 1 });
  });
  it('a zero-sized viewport reads centre, never NaN', () => {
    const t = parallaxTarget(10, 10, 0, 0);
    expect(Number.isNaN(t.x) || Number.isNaN(t.y)).toBe(false);
  });
});

describe('easeToward', () => {
  it('no time, no movement', () => {
    expect(easeToward(0, 1, 0, PARALLAX_TAU_MS)).toBe(0);
  });
  it('one time constant, in 100 ms steps, closes 1 - 1/e of the gap', () => {
    let v = 0;
    for (let i = 0; i < PARALLAX_TAU_MS / 100; i++) v = easeToward(v, 1, 100, PARALLAX_TAU_MS);
    expect(v).toBeCloseTo(1 - Math.exp(-1), 6);
  });
  // The same 100 ms clamp every other clock here uses: a tab that slept must
  // not jump the picture across the bleed in one frame.
  it('clamps a long frame to 100 ms', () => {
    expect(easeToward(0, 1, 5000, PARALLAX_TAU_MS)).toBeCloseTo(1 - Math.exp(-100 / PARALLAX_TAU_MS), 10);
  });
  it('never overshoots and treats negative time as none', () => {
    expect(easeToward(0.9, 1, 100, 1)).toBeLessThanOrEqual(1);
    expect(easeToward(0.5, 1, -50, PARALLAX_TAU_MS)).toBe(0.5);
  });
});

it('the constants are spec §10’s numbers', () => {
  expect(HOST_DEADLINE_MS).toBe(15000);
  expect(CROSSFADE_MS).toBe(400);
  expect(PARALLAX_TAU_MS).toBe(700);
  expect(NARROW_COLUMN_SHARE).toBe(0.7);
});
```

- [ ] **Step 2: Write the failing DOM-layer tests**

```ts
// packages/app/src/ui/scene-host.test.ts
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { menuDiorama } from '@lions/data';
import { dioramaSceneOptions } from '../front/diorama';
import { CROSSFADE_MS } from './scene-host-model';
import { sceneHost, type MountSceneHostView, type SceneHostDeps } from './scene-host';

type View = Awaited<ReturnType<MountSceneHostView>>;
type MountOpts = Parameters<MountSceneHostView>[1];

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fakeMount(): { mount: MountSceneHostView; calls: { host: HTMLElement; opts: MountOpts }[]; d: ReturnType<typeof deferred<View>> } {
  const calls: { host: HTMLElement; opts: MountOpts }[] = [];
  const d = deferred<View>();
  const mount: MountSceneHostView = (into, opts) => {
    calls.push({ host: into, opts });
    return d.promise;
  };
  return { mount, calls, d };
}
function setup(): { stage: HTMLElement; column: HTMLElement } {
  const stage = document.createElement('div');
  const column = document.createElement('div');
  column.className = 'rl-menu';
  stage.appendChild(column);
  document.body.appendChild(stage);
  return { stage, column };
}
const deps = (over: Partial<SceneHostDeps> = {}): SceneHostDeps => ({
  plateUrl: '/ui/menu_host_plate.jpg',
  renderer: 'three',
  world: () => dioramaSceneOptions(menuDiorama, { colorVision: 'default', quality: 'high' }, '/'),
  reducedMotion: () => false,
  saveData: () => false,
  webgl2: () => true,
  schedule: (fn) => {
    fn();
    return () => {};
  },
  now: () => 0,
  ...over,
});
const hostEl = (stage: HTMLElement): HTMLElement => {
  const el = stage.querySelector<HTMLElement>('.rl-scene-host');
  if (el === null) throw new Error('no .rl-scene-host in the stage');
  return el;
};
const fakeView = (): View & { dispose: ReturnType<typeof vi.fn> } => ({ canvas: document.createElement('canvas'), dispose: vi.fn() });

/** Every host a test mounts is disposed after it: a live host holds a 15 s
 *  deadline timer that would otherwise fire into a later test's console spy.
 *  The disposer is idempotent, so a test that disposes its own host is fine. */
const cleanups: (() => void)[] = [];
const host = (stage: HTMLElement, column: HTMLElement, d: SceneHostDeps): (() => void) => {
  const dispose = sceneHost(stage, column, d);
  cleanups.push(dispose);
  return dispose;
};

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('sceneHost', () => {
  it('sits under the column, hidden from assistive tech', () => {
    const { stage, column } = setup();
    host(stage, column, deps({ mount: fakeMount().mount }));
    const el = hostEl(stage);
    expect(el.nextElementSibling).toBe(column);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('is off, with no image and no mount, when the column fills the width', () => {
    const { stage, column } = setup();
    column.getBoundingClientRect = () => ({ width: window.innerWidth * 0.9 }) as DOMRect;
    const f = fakeMount();
    host(stage, column, deps({ mount: f.mount }));
    const el = hostEl(stage);
    expect(el.dataset.host).toBe('off');
    expect(el.dataset.hostReason).toBe('narrow');
    expect(el.querySelector('img')).toBeNull();
    expect(f.calls).toHaveLength(0);
  });

  it('Pixi shows the plate, never probes WebGL2, never mounts, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const probe = vi.fn(() => true);
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ renderer: 'pixi', webgl2: probe, mount: f.mount }));
    await flush();
    const el = hostEl(stage);
    expect(el.dataset.host).toBe('plate');
    expect(el.dataset.hostReason).toBe('pixi');
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/ui/menu_host_plate.jpg');
    expect(probe).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/pixi/);
  });

  it('is pending under the poster, then live; the poster leaves after the crossfade', async () => {
    vi.useFakeTimers();
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ mount: f.mount, now: vi.fn().mockReturnValueOnce(0).mockReturnValue(1234) }));
    const el = hostEl(stage);
    expect(el.dataset.host).toBe('pending');
    expect(el.querySelector('img')).not.toBeNull();
    await flush();
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0];
    if (call === undefined) throw new Error('mount was not called');
    const view = fakeView();
    call.host.appendChild(view.canvas);
    call.opts.onCamera?.({ x: 27, y: 22, zoom: 1.6591 });
    f.d.resolve(view);
    await flush();
    expect(el.dataset.host).toBe('live');
    expect(el.dataset.hostCamera).toBe('27,22');
    expect(el.dataset.hostZoom).toBe('1.659');
    expect(el.dataset.hostMs).toBe('1234');
    expect(el.querySelector('img')).not.toBeNull();
    vi.advanceTimersByTime(CROSSFADE_MS);
    expect(el.querySelector('img')).toBeNull();
  });

  it('a door that rejects keeps the plate, named', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ mount: f.mount }));
    await flush();
    f.d.reject(new Error('GLB 404'));
    await flush();
    expect(hostEl(stage).dataset.host).toBe('plate');
    expect(hostEl(stage).dataset.hostReason).toBe('load-failed');
    expect(warn).toHaveBeenCalled();
  });

  it('the deadline keeps the plate and aborts; a late view is disposed at once', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ mount: f.mount, deadlineMs: 15000 }));
    await flush();
    vi.advanceTimersByTime(15000);
    expect(hostEl(stage).dataset.host).toBe('plate');
    expect(hostEl(stage).dataset.hostReason).toBe('deadline');
    expect(f.calls[0]?.opts.signal.aborted).toBe(true);
    const view = fakeView();
    f.d.resolve(view);
    await flush();
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(hostEl(stage).dataset.host).toBe('plate');
  });

  it('leaving while pending aborts, removes the host, and disposes a late view', async () => {
    const f = fakeMount();
    const { stage, column } = setup();
    const dispose = host(stage, column, deps({ mount: f.mount }));
    await flush();
    dispose();
    expect(stage.querySelector('.rl-scene-host')).toBeNull();
    expect(f.calls[0]?.opts.signal.aborted).toBe(true);
    const view = fakeView();
    f.d.resolve(view);
    await flush();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it('leaving while live disposes the view exactly once, however often it is called', async () => {
    const f = fakeMount();
    const { stage, column } = setup();
    const dispose = host(stage, column, deps({ mount: f.mount }));
    await flush();
    const view = fakeView();
    f.d.resolve(view);
    await flush();
    dispose();
    dispose();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it('writes a hold to the DOM', async () => {
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ mount: f.mount }));
    await flush();
    f.d.resolve(fakeView());
    await flush();
    f.calls[0]?.opts.onMotion?.('held');
    expect(hostEl(stage).dataset.hostMotion).toBe('held');
  });

  it('a plate that fails to load is removed, never shown broken', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { stage, column } = setup();
    host(stage, column, deps({ renderer: 'pixi' }));
    const img = hostEl(stage).querySelector('img');
    img?.dispatchEvent(new Event('error'));
    expect(hostEl(stage).querySelector('img')).toBeNull();
  });

  describe('parallax', () => {
    const run = (queue: FrameRequestCallback[], ms: number): void => {
      for (let t = 0; t <= ms; t += 100) for (const cb of queue.splice(0)) cb(t);
    };
    const move = (x: number, y: number, pointerType: string): void => {
      window.dispatchEvent(Object.assign(new MouseEvent('pointermove', { clientX: x, clientY: y }), { pointerType }));
    };

    it('a mouse moves the picture against the pointer', () => {
      const queue: FrameRequestCallback[] = [];
      const { stage, column } = setup();
      host(stage, column, deps({ mount: fakeMount().mount, frame: (cb) => queue.push(cb) }));
      move(window.innerWidth, window.innerHeight / 2, 'mouse');
      run(queue, 5000);
      expect(Number(hostEl(stage).style.getPropertyValue('--host-dx'))).toBeLessThan(-0.95);
      expect(Math.abs(Number(hostEl(stage).style.getPropertyValue('--host-dy')))).toBeLessThan(0.01);
    });

    it('touch never moves it', () => {
      const queue: FrameRequestCallback[] = [];
      const { stage, column } = setup();
      host(stage, column, deps({ mount: fakeMount().mount, frame: (cb) => queue.push(cb) }));
      move(window.innerWidth, 0, 'touch');
      expect(queue).toHaveLength(0);
    });

    it('reduced motion shows the plate and never moves it', () => {
      const queue: FrameRequestCallback[] = [];
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { stage, column } = setup();
      host(stage, column, deps({ reducedMotion: () => true, frame: (cb) => queue.push(cb) }));
      expect(hostEl(stage).dataset.hostReason).toBe('reduced-motion');
      move(window.innerWidth, 0, 'mouse');
      expect(queue).toHaveLength(0);
    });

    it('leaving removes the pointer listener', () => {
      const queue: FrameRequestCallback[] = [];
      const { stage, column } = setup();
      const dispose = host(stage, column, deps({ mount: fakeMount().mount, frame: (cb) => queue.push(cb) }));
      dispose();
      move(window.innerWidth, 0, 'mouse');
      expect(queue).toHaveLength(0);
    });
  });

  // The CSS transition and the JS timer that removes the poster are one
  // duration written twice; this is what keeps them one.
  it('theme.css’s --dur-host-reveal is CROSSFADE_MS', () => {
    const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
    expect(css).toMatch(new RegExp(`--dur-host-reveal:\\s*${CROSSFADE_MS}ms`));
  });
});
```

Extend `packages/app/src/renderer-choice.test.ts`:

```ts
describe('readStoredRenderer / rememberRenderer', () => {
  it('read and write through the storage they are handed', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    rememberRenderer('pixi', () => s);
    expect(readStoredRenderer(() => s)).toBe('pixi');
  });
  it('a storage that throws reads as nothing and writes as nothing', () => {
    const blocked = (): never => {
      throw new Error('site data blocked');
    };
    expect(readStoredRenderer(blocked)).toBeNull();
    expect(() => rememberRenderer('pixi', blocked)).not.toThrow();
  });
  it('a storage with no API (jsdom under Node 25) reads as nothing', () => {
    expect(readStoredRenderer(() => ({}))).toBeNull();
  });
});
```

Extend `packages/app/src/ui/menu.test.ts`:

```ts
describe('showMenu backdrop (the scene host)', () => {
  it('mounts the backdrop after the column is in the stage, handing it the column', () => {
    const stage = document.createElement('div');
    // A holder rather than two `let`s: tsc narrows a `let` assigned only in a
    // callback to its initialiser at the read below.
    const seen: { column: HTMLElement | null; inStage: boolean } = { column: null, inStage: false };
    showMenu(stage, {
      base: '/', version: '0.0.0', world, tutorial,
      backdrop: (s, column) => {
        seen.column = column;
        seen.inStage = column.parentElement === s;
        return () => {};
      },
    });
    expect(seen.inStage).toBe(true);
    expect(seen.column?.classList.contains('rl-menu')).toBe(true);
  });
  it('its disposer runs the backdrop’s disposer and removes the column', () => {
    const stage = document.createElement('div');
    let disposed = 0;
    const off = showMenu(stage, { base: '/', version: '0.0.0', world, tutorial, backdrop: () => () => void disposed++ });
    off();
    expect(disposed).toBe(1);
    expect(stage.querySelector('.rl-menu')).toBeNull();
  });
  // Spec Q1's default: with the world behind the column, a second photograph
  // of it inside the column is the same picture twice.
  it('no longer carries the key-art banner inside the column', () => {
    const stage = document.createElement('div');
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial });
    expect(stage.querySelector('img.rl-menu__banner')).toBeNull();
  });
});
```

Add to `front/diorama.test.ts`:

```ts
describe('dioramaSceneOptions', () => {
  it('hands the door the mission’s own options and a zoom that follows the cover law', () => {
    const o = dioramaSceneOptions(menuDiorama, { colorVision: 'default', quality: 'high' }, '/');
    expect(o.renderer.groundTextureUrl).toBe('/textures/desert_sand_tile.jpg');
    expect(o.camera).toEqual({ x: 27, y: 22 });
    expect(o.zoomFor(1920, 1080)).toBeCloseTo(1.6, 10);
    expect(o.meshes.vehicles.map((v) => v.id).sort()).toEqual(['apc_eitan', 'mbt_lavi']);
  });
});
```

- [ ] **Step 3: Implement.**

`scene-host-model.ts`: the decision in spec §3.4's order, the table of spec §5 as a `switch`, the two parallax functions (normalise `-0` with `+ 0` so a centred pointer reads `0`), the constants. No DOM.

`scene-host.ts`, the thin executor. At mount: build `.rl-scene-host[aria-hidden=true]` → `.rl-scene-host__layer` → (`img.rl-scene-host__plate` `alt=""` `decoding=async`, `.rl-scene-host__stage`), `stage.insertBefore(el, column)`, decide with `hostPath({ renderer, reducedMotion: reducedMotion(), saveData: saveData(), viewportWidth: window.innerWidth, columnWidth: column.getBoundingClientRect().width, webgl2 })`. `off`: no image. `plate`: warn once `[lions] scene host: keeping the plate (${reason})`. `live`: `data-host=pending`, the deadline timer, then `schedule(start)`; `start` resolves `deps.mount ?? await loadDoor()`, calls it with `{ ...deps.world(), signal, onMotion, onCamera }` into `.rl-scene-host__stage`, and feeds `ready`/`failed` to `hostStep`; every effect is one small function (`reveal` sets `live`, `data-host-ms` and a `CROSSFADE_MS` timer that removes the image). Defaults: `reducedMotion` = `document.documentElement.dataset.motion === 'reduce' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true` (settings.ts already writes `data-motion` on `:root`); `saveData` = a guarded read of `navigator.connection.saveData`; `webgl2` = `worldmap3d.ts`'s throwaway-canvas probe (move it to a shared `ui/webgl-probe.ts` rather than copy it, and have `worldmap3d.ts` import it); `schedule` = `requestIdleCallback(fn, { timeout: IDLE_START_TIMEOUT_MS })` where it exists, else `setTimeout(fn, 0)`; `frame` = `(cb) => requestAnimationFrame(cb)` (the global, read at call time). Parallax on every path but `off` and `reduced-motion`: a `window` `pointermove` listener that ignores anything but `pointerType === 'mouse'`, a `document.documentElement` `mouseleave` that eases back to centre, and an easing loop through `frame` that writes `--host-dx`/`--host-dy` (4 decimals) on the host element and stops when both are within `PARALLAX_SETTLE_EPS`. The image's `error` event removes it. The disposer is idempotent and removes the listeners, the timers, the element, and feeds `dispose` to `hostStep`.

`front/diorama.ts`'s `dioramaSceneOptions`: `buildDioramaWorld`, then `{ sim, renderer: rendererOptionsFor(map, s, base), meshes: meshManifestFor(plan), decor: map.decor, elevation: map.elevation, emitters: { list: vfxEmitters as EmitterSpec[], resolve: paletteColor }, camera, zoomFor: (w, h) => hostZoom(w, h, zoomAtRef) }`.

`renderer-choice.ts`: move `storedRenderer`/`rememberRenderer` out of `menu.ts` (`:249-264` at `2d92cbad`) with their comments, parameterised as above; `showCampaign` calls them.

`menu.ts`: delete the banner block (`:84-104`); after `stage.appendChild(wrap)`, `const disposeBackdrop = opts.backdrop?.(stage, wrap)`, and the disposer becomes `() => { disposeBackdrop?.(); wrap.remove(); }`.

`main.ts`: the menu route passes `req` (`mount: (host, req) => mountMenu(host, req)`); `mountMenu` resolves `resolveRendererChoice(req.query.get('renderer'), readStoredRenderer())`, persists through `rememberRenderer` as `showCampaign` does, and passes `backdrop: (stage, column) => sceneHost(stage, column, { plateUrl: `${BASE}${menuDiorama.plate}`, renderer: decision.choice, world: () => dioramaSceneOptions(menuDiorama, { colorVision: settings.accessibility.colorVision, quality: settings.video.quality }, BASE) })`, reading `settings` through `settingsDeps.get()` at call time.

`theme.css`, in the Menu section, with a comment naming spec §3.5:

```css
:root { --dur-host-reveal: 400ms; }
.rl-menu { z-index: 1; }
.rl-scene-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  --host-bleed: 0.75rem;
  --host-dx: 0;
  --host-dy: 0;
}
.rl-scene-host__layer {
  position: absolute;
  inset: calc(-1 * var(--host-bleed));
  transform: translate3d(calc(var(--host-dx) * var(--host-bleed)), calc(var(--host-dy) * var(--host-bleed)), 0);
  will-change: transform;
}
.rl-scene-host__plate,
.rl-scene-host__stage { position: absolute; inset: 0; width: 100%; height: 100%; }
.rl-scene-host__plate { display: block; object-fit: cover; }
.rl-scene-host__stage { opacity: 0; transition: opacity var(--dur-host-reveal) var(--ease); }
.rl-scene-host[data-host='live'] .rl-scene-host__stage { opacity: 1; }
```

(Put `--dur-host-reveal` beside the existing duration tokens rather than in a second `:root` block; take `.rl-menu__banner` out of the grouped selector at `:2571` — the wordmark, theatre and nav keep that rule — and delete its own rule at `:2578-2582`.)

- [ ] **Step 4: Drive it.** Start your own server: `PORT=5196 pnpm --filter @lions/app exec vite --port 5196 --strictPort` in its own process group (never 5177). Open `http://localhost:5196/` in the Browser pane and, in order: read `.rl-scene-host`'s attributes until `data-host` leaves `pending` (expect `live` in ~1–2 s, `data-host-camera="27,22"`); move the mouse to each corner and see the picture slide against it; click Campaign within one second of a fresh load and read the console (no error, no warning); navigate `/` → `/settings` → `/` and see the host re-mount; load `/?renderer=pixi` and read `data-host="plate"`, `data-host-reason="pixi"`, and no `three` chunk in the network panel; set Settings → Reduced motion and reload (`plate`, `reduced-motion`). The plate 404s until Task 7 and must leave no broken image. Record each result in the ledger. Stop the server by its process group.

- [ ] **Step 5: Gates, falsify, commit.** Falsify four, each seen red: (a) `hostPath` probing WebGL2 before the Pixi check — the probe spy test fails; (b) `hostStep('plate', ready)` returning no effects — the late-view test fails, and the DOM deadline test reads `dispose` called 0 times; (c) the disposer not aborting — "leaving while pending" fails; (d) `--dur-host-reveal: 300ms` — the CSS pin fails. Gates line; `pnpm ui:routes -- --port=5196` green (the walk now passes through a live host; its canvas and body counts must not change). Message: `feat(shell): the scene host behind the menu`, body with the drive's results and the mutations seen red.

---

### Task 7: The plate, photographed from the host

**Gated on the lead's approval of spec §10.** Sonnet. Spec §3.6; R-3, R-9, spec Q1. The poster and the fallback plate become a photograph of the live frame, so the three paths cannot disagree about composition.

**Files:**
- Create: `tools/src/perf/host-plate-capture.ts`, `assets/ui/menu_host_plate.jpg`
- Modify: `tools/package.json` and `package.json` (`plate:host` added, `plate:capture` removed), `tools/validate_data.mjs`
- Delete: `tools/src/perf/plate-capture.ts`, `assets/ui/menu_plate.jpg`

- [ ] **Step 1: The capture.** `pnpm plate:host [-- --port=5183]`: `ensureDevServer(port)` (default 5183), `launchCaptureBrowser()` (`golden-diff/browser.ts:300`, SwiftShader — reproducible, and spec M16 measured it 0.1% from Metal), a 2560×1440 page at device scale 1, `goto('/')`, wait up to 60 s for `.rl-scene-host[data-host]` to leave `pending` and **throw naming `data-host-reason` unless it is `live`**; set `--host-bleed: 0rem` on the host element and wait for `data-host-zoom` to change (the door redraws on the resize it causes); hide `.rl-menu`; freeze with `FREEZE_FRAME_LOOP_STATEMENTS` inside the script's own async IIFE — **not `FREEZE_FRAME_LOOP_SCRIPT`, whose return value reads `window.__lions.sim.tickCount` and throws on the menu**; `page.screenshot({ type: 'jpeg', quality: 80, fullPage: false })` to `assets/ui/menu_host_plate.jpg`. Print the file's size (spec M18 predicts ~430 KiB) and the host's `data-host-ms`. Header comment: what it replaced and why (spec Q1), and that re-staging the diorama is one command.
- [ ] **Step 2: Retire the old plate.** Delete `plate-capture.ts`, `menu_plate.jpg` and the `plate:capture` script from both `package.json`s. `git grep -n menu_plate -- ':!docs'` must return nothing; the docs that name it (`docs/campaign/beit_sahwan/design.md:821,828`, `docs/campaign/storyline.md:545`, `docs/campaign/research-2026-09-03.md:139`) are updated to the new file and command in the same commit.
- [ ] **Step 3: The plate must exist.** `tools/validate_data.mjs`: after the schema pass, fail with `data/front/menu_diorama.json: plate "<path>" not found at assets/<path>` when it is missing — `world.json`'s `art` check (`:1044`) is the precedent.
- [ ] **Step 4: Look at it.** Open the JPEG. Check the four corners carry ground (no off-map shroud), the muster sits in the upper-left flank, an apartment in each flank. Then run `pnpm ui:shots -- --port=5197 --res=1920x1080,2560x1440 --out=.superpowers/scene-host/t7` and compare `01-menu` against the plate: the swap at reveal must be motion starting, not a picture changing.
- [ ] **Step 5: Gates, falsify, commit.** Falsify: move the plate aside — `pnpm validate:data` fails naming it. Gates line. `git add` the new JPEG, the tool, both `package.json`s, `validate_data.mjs` and the four docs, and `git rm` the two retired files. Message: `feat(tools): the menu's plate is photographed from the scene host`, body: size, `data-host-ms`, the lead's approval reference, and that AI-generated art is not involved (every pixel is the engine's).

---

### Task 8: The instruments learn the host

Sonnet. Spec §3.6, §3.7; R-10; parent spec §7 ("the screens check gains the menu route").

**Files:**
- Create: `tools/src/golden-diff/register.ts`, `tools/src/golden-diff/register.test.ts`
- Modify: `tools/src/golden-diff/screens-check.ts`, `tools/src/ci/three-baseline-gate.ts`, `tools/src/ui-review/routes-check.ts`, `tools/src/ui-review/shoot.ts`

**Interfaces:** `interface Register { readonly meanY: number; readonly meanS: number; readonly samples: number }`, `colourRegister(rgba: Uint8Array | Uint8ClampedArray | Buffer, width: number, height: number, box?: { x: number; y: number; width: number; height: number }): Register`, `registerDelta(a: Register, mission: Register): { dY: number; dS: number }`, `withinRegister(a: Register, mission: Register, tolerance: number): boolean`; `checkMenuSceneHost(browser: Browser, baseUrl: string): Promise<MenuHostCheckResult>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tools/src/golden-diff/register.test.ts
import { describe, expect, it } from 'vitest';
import { colourRegister, registerDelta, withinRegister } from './register';

const solid = (w: number, h: number, r: number, g: number, b: number): Uint8Array => {
  const a = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([r, g, b, 255], i * 4);
  return a;
};

describe('colourRegister -- spec §3.7’s metric', () => {
  it('black: Y 0, and no pixel is bright enough to carry a saturation', () => {
    expect(colourRegister(solid(2, 2, 0, 0, 0), 2, 2)).toEqual({ meanY: 0, meanS: 0, samples: 0 });
  });
  it('white: Y 1, S 0', () => {
    const r = colourRegister(solid(2, 2, 255, 255, 255), 2, 2);
    expect(r.meanY).toBeCloseTo(1, 10);
    expect(r.meanS).toBe(0);
    expect(r.samples).toBe(4);
  });
  it('pure red: Y is the Rec. 709 red weight, S is 1', () => {
    const r = colourRegister(solid(1, 1, 255, 0, 0), 1, 1);
    expect(r.meanY).toBeCloseTo(0.2126, 6);
    expect(r.meanS).toBe(1);
  });
  // A mean of sRGB codes would read 0.502 here. Luminance is linear light.
  it('linearises before weighting: sRGB 128 grey is Y 0.2159', () => {
    expect(colourRegister(solid(1, 1, 128, 128, 128), 1, 1).meanY).toBeCloseTo(0.21586, 4);
  });
  it('a box samples only inside itself', () => {
    const a = new Uint8Array(2 * 4);
    a.set([255, 255, 255, 255], 0);
    a.set([0, 0, 0, 255], 4);
    expect(colourRegister(a, 2, 1, { x: 0, y: 0, width: 1, height: 1 }).meanY).toBeCloseTo(1, 10);
  });
});

describe('registerDelta / withinRegister', () => {
  const mission = { meanY: 0.2423, meanS: 0.2985, samples: 1 };
  it('is relative to the mission', () => {
    const d = registerDelta({ meanY: 0.2382, meanS: 0.3, samples: 1 }, mission);
    expect(d.dY).toBeCloseTo(-0.0169, 3);
    expect(d.dS).toBeCloseTo(0.005, 3);
  });
  // Spec M16 and M17, as the two ends of the bar.
  it('holds for the measured host and fails for the shipped Phase 0 plate', () => {
    expect(withinRegister({ meanY: 0.2382, meanS: 0.3, samples: 1 }, mission, 0.1)).toBe(true);
    expect(withinRegister({ meanY: 0.3153, meanS: 0.269, samples: 1 }, mission, 0.1)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `register.ts`** (sRGB decode `c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4`; `Y = 0.2126R + 0.7152G + 0.0722B`; `S = (max − min) / max` on sRGB-encoded channels, skipping `max < 0.02`; `meanS` 0 when no sample).

- [ ] **Step 3: `checkMenuSceneHost`**, in `screens-check.ts` beside `checkCampaignBoard` and in its style (console captured, a `detail` line that names the cause). A fresh 1920×1080 page from the gate's browser; three votes:
  1. **Path:** `goto(base)`, wait ≤ 60 s for `data-host` to leave `pending`; `live` passes; anything else fails with `data-host`, `data-host-reason` and the first five console lines. Print `data-host-ms` and `data-host-motion`.
  2. **Contribution:** freeze (`FREEZE_FRAME_LOOP_STATEMENTS` in its own IIFE), screenshot, set `.rl-scene-host__stage canvas` to `visibility: hidden`, screenshot; the mean absolute channel delta over the two flanks (left of and right of `.rl-menu`'s bounding box) must exceed `MENU_HOST_CONTRIBUTION_FLOOR`. **Set the floor by measurement:** run the check three times on this machine's SwiftShader, take the smallest delta, and set the floor to one third of it (the gate's convention, `baseline.ts`'s floors); record the three readings beside the constant.
  3. **Register:** a new page; `goto(base)`, `live`, hide `.rl-menu`, freeze, screenshot → `colourRegister`; read `data-host-camera` and `data-host-zoom`; `goto('/free-play/beit_sahwan_outskirts')`, wait for `window.__lions.renderer`, `setDebugLayerVisible('overlays', false)`, `setDebugLayerVisible('fog', false)`, set `camera.x/y/zoom` to the host's, `hideHudExceptCanvas`, `REPAINT_SCRIPT`, screenshot → `colourRegister`; `withinRegister(host, mission, 0.10)` passes. Print both registers and the deltas every run.

  Wire it in `three-baseline-gate.ts` right after `checkCampaignBoard` (`:513-535`), folded into `screensOk` exactly as that one is, so the success path cannot overwrite a failure.

- [ ] **Step 4: `ui:routes`' two legs.** (a) At the first menu visit, before clicking Campaign: wait ≤ 60 s for a terminal `data-host`; `expect(live)`; stash `window.__rlHostCanvas = document.querySelector('.rl-scene-host canvas')`. After the board is up: `expect(document.querySelector('.rl-scene-host') === null)` and `expect(window.__rlHostCanvas.getContext('webgl2')?.isContextLost() === true, 'the scene host left its WebGL context alive')`. (b) At the end of the walk, a fast leave: `goto('/')`, `click('a[href="/campaign"]')` within 100 ms, wait for `.rl-world`; `expect` no `.rl-scene-host`, and the run's existing "no console error" rule covers the abort path. Print `data-host-ms` at (a).
- [ ] **Step 5: `ui:shots`.** Before `01-menu`, wait for a terminal `data-host` (not the fixed 2.5 s settle). Add `01b-menu-plate`: a new context with `reducedMotion: 'reduce'`, `goto('/')`, wait for `data-host="plate"`, shoot.
- [ ] **Step 6: Gates, falsify, commit.** Falsify four, each seen red, each by a one-line mutation in product code reverted afterwards: (a) delete the `loseContext()` line in the door — `ui:routes` fails "left its WebGL context alive"; (b) remove `setDebugLayerVisible('fog', false)` from the door — the register vote fails (predicted, not measured: the never-ticked sim has seen nothing, so the whole map reads as never-seen shroud; spec M17's −30.6% was fog plus a different camera); (c) make `hostPath` return `plate` unconditionally — the path vote fails naming the reason; (d) keep the poster (skip its removal) — the contribution vote fails. Run `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/scene-host/t8` GREEN with the three new votes printed, and record the wall-clock change against Task 0's run (the spec's §3.6 estimate was not measured; this is where it is). `pnpm ui:routes -- --port=5196`, `pnpm ui:shots -- --port=5197`. Message: `feat(tools): the gate sees the scene host -- path, contribution and one colour register`.

---

### Task 9: The record

Haiku; opus reviews it with the final review.

**Files:** `CLAUDE.md` (a new `### The scene host` subsection under "The three.js backend", edited as a section and never wholesale), `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md` (§6 Phase 3's first bullet marked landed with the commit; D-52…D-61 from R-1…R-10 with what was measured on the way), `docs/superpowers/specs/2026-09-24-scene-host-design.md` (status line).

- [ ] **Step 1:** The CLAUDE.md subsection carries only what a later agent would get wrong: the door is a stock `ThreeRenderer`, never a menu mode; `ThreeRenderer.dispose()` does not release the context (spec M14/M15) and the host's explicit `loseContext()` is load-bearing; the host lives on `/` only; `data-host` and its five sibling attributes, and that `window.__lions` is not defined there; `pnpm plate:host` re-photographs the plate after any diorama edit; `ui:routes`/`ui:shots` take `--port` and why. Numbers go with their conditions.
- [ ] **Step 2:** Gates line. Message: `docs: the scene host, recorded`. `HANDOVER.md` is updated at landing from a main worktree, per its §7 protocol, not from this branch.

---

## Out of scope

- **A host behind settings, saves, credits and free play** — spec Q3; recommended as a small lane-A follow-up putting the plate behind those column screens.
- **Moving the menu column** — spec Q2; a `theme.css` decision taken from `ui:shots` of both layouts after this lands.
- **Spreading the first frame's upload over idle frames** — spec Q4; a second `ThreeRenderer` change that would also shorten every mission's first frame.
- **`ThreeRenderer.dispose()` and `mountWorldView`'s dispose releasing their own contexts** — spec Q5; a one-line render-lane follow-up each, with `ui:routes` gaining the same lost-context assertion Task 8 adds for the host.
- **The campaign board on the lit pipeline, its basin re-author, portraits, key art beyond the menu's plate, the garage's art pass** — art lane (G1 items 2, 4, 6).
- **The motion capture and the observed first-player session** owed before Phase 3's acceptance (parent §7(b), (c)) — not code; they are where spec §10's parallax numbers are confirmed.
- **`packages/sim/**`** — untouched.

## Open questions for the lead

Spec §8, with the plan's defaults. None blocks Tasks 0–6.

1. Retire the in-column banner, `menu_plate.jpg` and `plate:capture` (Task 6 Step 3 and Task 7 Step 2)? **Default: yes.**
2. The column's position. **Default: centred for this landing.**
3. The plate behind the other column screens. **Default: a follow-up, not this branch.**
4. The first-frame stall. **Default: accept; re-measure at landing.**
5. Fix `ThreeRenderer.dispose()`. **Default: a separate render-lane follow-up.**
6. **Approve spec §10's numbers before Task 7.** This one gates a task.

## Self-review

**Spec coverage.**

| Spec item | Task |
|---|---|
| §3.1 a thin door over a stock `ThreeRenderer`; one additive method | 4, 5 |
| §3.2 the map, the units, the camera law, the same options; the diorama as data | 2, 3 |
| §3.3 (1) paint first; (2) no context while fetching; (3) reveal a complete frame; (5) cap and hold; (6) dispose and lose the context; (7) `/` only; (8) deadline | 5, 6 |
| §3.3 (4) the first-frame stall | accepted; Q4 |
| §3.4 fallbacks, in order, each named | 6 |
| §3.5 parallax as a transform, mouse only, rem amplitude | 6 |
| §3.6 `data-host` and siblings; the plate from the host; gate unaffected; screens check; `ui:routes`; `ui:shots`; ports | 1, 6, 7, 8 |
| §3.7 the register acceptance, camera-for-camera | 8 |
| §5 the state machine | 6 |
| §10 numbers | 3 (data), 5 and 6 (constants), 7 (after approval) |
| Parent §7 "the screens check gains the menu route: `data-host=live` on a WebGL2 runner" | 8 |
| Pure-function tests: framing (`hostZoom`), parallax (`parallaxTarget`, `easeToward`), fallback (`hostPath`), lifecycle (`hostStep`), cadence (`drawDue`, `motionVerdict`), register | 3, 5, 6, 8 |

**Every check has an input that makes it fail**, named in its task: Task 1 (a bad `--port`), 2 (three mutations), 3 (three), 4 (two), 5 (two), 6 (four), 7 (one), 8 (four product mutations against three new instruments).

**Placeholder scan.** One number is deliberately left to measurement and says how it is set: `MENU_HOST_CONTRIBUTION_FLOOR` (Task 8, one third of the smallest of three readings). Two bodies are specified by their steps rather than written out, and say so: the door (Task 5 Step 3 — its order, its three MUST lines and the reason for each; rendering needs no unit tests, and its behaviour is voted on by Task 8's four falsifications) and `checkMenuSceneHost` (Task 8 Step 3 — harness code, falsified by the same four). Every pure function carries its tests in full.

**Type consistency.** `RendererSettings`, `MeshPlan`, `MeshManifest` (Task 2) are consumed by name in Tasks 3 and 6. The door's `SceneHostOptions`/`SceneHostView` (Task 5) are restated once in `scene-host.ts` as `MountSceneHostView` and checked by assignment. `DioramaJson` is `@lions/data`'s everywhere. `Disposer` is `shell/router.ts`'s. `MeshFactionName` (app) and `MeshFaction` (render) are the same union, compared by that assignment.

**Model tiering.** **Opus** for Task 4 (the shared renderer file), Task 5 (the door — context lifetime and abort ordering) and Task 6 (the state machine and the DOM executor, where a leak hides) and for the final whole-branch review. **Sonnet** for Tasks 2, 3, 7 and 8 — extractions, data, a capture and harness code, each with its tests written out. **Haiku** for Tasks 1 and 9 and for scoped re-reviews of a fix round. Nothing inherits opus by default.

**R-n → D-n at landing.** R-1 → D-52 … R-10 → D-61, in order.

**Execution order.** 0 → 1 → {2, 3, 4 in any order; 4 only after Task 0 confirms the reseed merge} → 5 → 6 → **the lead approves §10** → 7 → 8 → 9. Tasks 0–6 are a working host with a missing poster; 7 completes it; 8 makes it gated.

**No bless is budgeted.** Nothing here draws in a gated scenario. A red `visual` job is a regression.
