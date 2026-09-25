/**
 * The visual gate's toggle seam, pinned where it is implemented.
 *
 * `tools/src/golden-diff/baseline.test.ts` checks the other end -- that every
 * layer the gate declares is a name this module knows. This file checks that a
 * name the gate uses actually reaches a scene object, which is the half a
 * string-matching test cannot see. Both halves matter: a check that toggles
 * nothing reads as a layer that draws nothing, and would fail the gate on a
 * healthy tree; a check that toggles the wrong thing passes on a broken one.
 *
 * `new THREE.WebGLRenderer(...)` cannot construct under this suite's headless
 * `environment: 'node'`, so the same `vi.mock` stand-in `ThreeRenderer.test.ts`
 * established is used here, for the same reason and with the same scope.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { DEBUG_LAYERS, isDebugLayer, unknownDebugLayerMessage } from './debug-layers';
import type { GroundMaterial } from './terrain/mesh';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    // `ThreeRenderer.dispose` loses the context last (`context-release.ts`).
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

function makeRenderer(): ThreeRenderer {
  return new ThreeRenderer(new Sim({ seed: 1, width: 4, height: 4, capacity: 1 }), makeOpts());
}

/** Reaches the private fields the same way `ThreeRenderer.test.ts` reaches
 *  `shroud`: there is no public accessor, and adding one purely for a test
 *  would widen `Renderer`'s surface for no runtime reason. (It said `fogMesh`
 *  until 2026-09-14; fog of war is a depth-reading post pass over a
 *  `ShroudTexture` now, not a mesh.) */
function internals(r: ThreeRenderer): {
  scatterMesh: THREE.Mesh | null;
  terrainMesh: THREE.Mesh | null;
  groveMesh: THREE.Mesh | null;
  residualMesh: THREE.Mesh | null;
  decorGroup: THREE.Object3D | null;
  texturedDecorGroup: THREE.Object3D | null;
  structureBoxes: Map<number, THREE.Mesh>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  groundMat: GroundMaterial;
  skirtMesh: THREE.Mesh;
  vignettePass: { enabled: boolean } | null;
  fogPass: { enabled: boolean; uniforms: { uRevealAll: { value: number } } } | null;
  overlayBatch: { mesh: THREE.Mesh };
  numeralBatch: { mesh: THREE.Mesh };
  chevronBatch: { mesh: THREE.Mesh };
  silhouetteMeshMaterials: THREE.MeshBasicMaterial[];
  rebuildTerrain(): void;
} {
  return r as unknown as ReturnType<typeof internals>;
}

/** The blast package's own private fields, reached the same way `internals`
 *  above reaches the terrain's -- kept separate so `internals`' own list
 *  stays the terrain/post-chain one it has always been. */
function blastInternals(r: ThreeRenderer): {
  scorchDecals: { mesh: THREE.Mesh };
} {
  return r as unknown as ReturnType<typeof blastInternals>;
}

describe('DEBUG_LAYERS', () => {
  it('rejects a name it does not know, loudly and by name', () => {
    // The distinction this preserves: an unknown name must NOT return 0
    // objects, because 0 is also what a real layer with nothing on screen
    // returns, and the gate would read a typo as "this layer draws nothing".
    const r = makeRenderer();
    expect(() => r.setDebugLayerVisible('scater', false)).toThrow(/unknown layer "scater"/);
    expect(unknownDebugLayerMessage('x')).toContain(DEBUG_LAYERS.join(', '));
    expect(isDebugLayer('scatter')).toBe(true);
    // `units` became a real layer on 2026-09-10 -- see `unitsDebugHidden`.
    // `unitz` stands in as the not-a-layer, so this keeps asserting what it
    // was written to assert rather than quietly passing on a stale name.
    expect(isDebugLayer('units')).toBe(true);
    expect(isDebugLayer('unitz')).toBe(false);
    r.dispose();
  });

  it('hides every overlay mesh -- HP bars, badges, chevrons, all three batches -- and back, with a plain visible flag', () => {
    // Unlike `units`, this one is built unconditionally in the constructor
    // (`OverlayBatch`/`NumeralBatch`/`ChevronBatch`, `ThreeRenderer`'s own
    // ctor) and nothing in the per-frame beginFrame/push/endFrame cycle
    // touches `.visible` -- see `debug-layers.ts`'s own comment for the check
    // that makes a bare `setObjectsVisible` correct here rather than assumed.
    const r = makeRenderer();
    expect(r.setDebugLayerVisible('overlays', false)).toBe(6);
    const i = internals(r);
    expect(i.overlayBatch.mesh.visible).toBe(false);
    expect(i.numeralBatch.mesh.visible).toBe(false);
    expect(i.chevronBatch.mesh.visible).toBe(false);
    expect(r.setDebugLayerVisible('overlays', true)).toBe(6);
    expect(i.overlayBatch.mesh.visible).toBe(true);
    expect(i.numeralBatch.mesh.visible).toBe(true);
    expect(i.chevronBatch.mesh.visible).toBe(true);
    r.dispose();
  });

  it('also hides the occlusion silhouette -- a different subsystem folded into the same name', () => {
    // Found while framing the key-art plate near a civic structure: a
    // hostile unit standing behind it showed as a thin red occlusion
    // outline (`units/silhouette.ts`, render-order band 6) -- NOT one of the
    // three overlay batches above, and not a HUD element, but just as
    // unwelcome in key art. Three shared `MeshBasicMaterial`s (one per side)
    // cover every mesh unit's silhouette with no per-entity traversal.
    const r = makeRenderer();
    const i = internals(r);
    expect(i.silhouetteMeshMaterials).toHaveLength(3);
    expect(r.setDebugLayerVisible('overlays', false)).toBe(6);
    for (const m of i.silhouetteMeshMaterials) expect(m.visible).toBe(false);
    expect(r.setDebugLayerVisible('overlays', true)).toBe(6);
    for (const m of i.silhouetteMeshMaterials) expect(m.visible).toBe(true);
    r.dispose();
  });

  it('flips the skirt beyond the map, and back', () => {
    // Built in the CONSTRUCTOR rather than in `rebuildTerrain` (it is a
    // function of the map's dimensions alone), so unlike every other layer
    // here this one is togglable before any terrain build.
    const r = makeRenderer();
    const i = internals(r);
    expect(r.setDebugLayerVisible('skirt', false)).toBe(1);
    expect(i.skirtMesh.visible).toBe(false);
    expect(r.setDebugLayerVisible('skirt', true)).toBe(1);
    expect(i.skirtMesh.visible).toBe(true);
    r.dispose();
  });

  it('the vignette toggle reports 0 when the pass does not exist, and flips it when it does', () => {
    // The first layer here that is not a scene object: it is a post pass,
    // built in `init()`, which these fakes never reach. Reporting 0 rather
    // than 1 in that state is what stops a gate run against a renderer with
    // no post chain reading as a real (passing) toggle -- the gate's floor
    // then fails on a zero delta, which is the honest answer.
    const r = makeRenderer();
    const i = internals(r);
    expect(i.vignettePass).toBeNull();
    expect(r.setDebugLayerVisible('vignette', false)).toBe(0);

    // With a pass in place it is a real toggle, and it reports a change only
    // when there was one -- `enabled` is already true, so switching it off
    // counts and switching it off again does not.
    i.vignettePass = { enabled: true };
    expect(r.setDebugLayerVisible('vignette', false)).toBe(1);
    expect(i.vignettePass.enabled).toBe(false);
    expect(r.setDebugLayerVisible('vignette', false)).toBe(0);
    expect(r.setDebugLayerVisible('vignette', true)).toBe(1);
    expect(i.vignettePass.enabled).toBe(true);
    i.vignettePass = null;
    r.dispose();
  });

  it('the fog toggle reports 0 when the pass does not exist, and otherwise drives uRevealAll rather than enabled (C2)', () => {
    // task-10 follow-up 2: the plate's large dark diagonal, first read as a
    // shadow, was the fog-of-war boundary (`FogOfWarPass`) -- never-seen
    // ground pulled to 85% shroud beside explored ground at 40%. With no
    // pass in place these fakes never reach `init()`, so 0 rather than 1 is
    // the honest reading.
    const r = makeRenderer();
    const i = internals(r);
    expect(i.fogPass).toBeNull();
    expect(r.setDebugLayerVisible('fog', false)).toBe(0);

    // C2: disabling the WHOLE pass also disabled its off-map fade, which
    // reinstated the pale wedge the fade exists to remove -- so this layer
    // now leaves `enabled` alone and drives `uRevealAll` on the pass's own
    // uniforms instead. visible=false reveals every on-map sample
    // (uRevealAll=1); visible=true restores real fog-of-war (uRevealAll=0).
    // `enabled` never moves.
    i.fogPass = { enabled: true, uniforms: { uRevealAll: { value: 0 } } };
    expect(r.setDebugLayerVisible('fog', false)).toBe(1);
    expect(i.fogPass.uniforms.uRevealAll.value).toBe(1);
    expect(i.fogPass.enabled).toBe(true);
    expect(r.setDebugLayerVisible('fog', false)).toBe(0);
    expect(r.setDebugLayerVisible('fog', true)).toBe(1);
    expect(i.fogPass.uniforms.uRevealAll.value).toBe(0);
    expect(i.fogPass.enabled).toBe(true);
    i.fogPass = null;
    r.dispose();
  });

  it('flips visibility on the real scatter mesh, and back', () => {
    const r = makeRenderer();
    const i = internals(r);
    i.scatterMesh = new THREE.Mesh();
    expect(r.setDebugLayerVisible('scatter', false)).toBe(1);
    expect(i.scatterMesh.visible).toBe(false);
    expect(r.setDebugLayerVisible('scatter', true)).toBe(1);
    expect(i.scatterMesh.visible).toBe(true);
    r.dispose();
  });

  it('covers BOTH decor batches under one name, because one authoring fault empties both', () => {
    // `decor-place.ts`'s `familyFor` feeds the palette batch and the textured
    // batch alike. A toggle that hid only one would leave a real erasure
    // half-visible and the delta above the floor.
    const r = makeRenderer();
    const i = internals(r);
    i.decorGroup = new THREE.Group();
    i.texturedDecorGroup = new THREE.Group();
    expect(r.setDebugLayerVisible('decor', false)).toBe(2);
    expect(i.decorGroup.visible).toBe(false);
    expect(i.texturedDecorGroup.visible).toBe(false);
    r.dispose();
  });

  it('reaches every building collection, palette boxes and mesh clones alike', () => {
    const r = makeRenderer();
    const i = internals(r);
    i.structureBoxes.set(0, new THREE.Mesh());
    i.buildingMeshIdleEntities.set(1, new THREE.Object3D());
    expect(r.setDebugLayerVisible('buildings', false)).toBe(2);
    expect(i.structureBoxes.get(0)?.visible).toBe(false);
    expect(i.buildingMeshIdleEntities.get(1)?.visible).toBe(false);
    r.dispose();
  });

  it('counts zero, without throwing, for a layer nothing has built yet', () => {
    // A scenario that frames no building must be able to run the toggle and
    // read a zero PIXEL delta -- the honest reading -- rather than crash the
    // capture. (Which is also why no scenario declares `buildings` where the
    // measured delta is 0.)
    const r = makeRenderer();
    expect(r.setDebugLayerVisible('scatter', false)).toBe(0);
    expect(r.setDebugLayerVisible('buildings', false)).toBe(0);
    r.dispose();
  });

  it('drives the ground albedo to the material\'s own fail-soft path, and restores the loaded gains', () => {
    // Not a visibility flag: strength 0 is exactly what a 404 leaves behind
    // (`loadGroundTexture`), so this measures the shipped tiles' whole
    // contribution over the flat palette tone. Restoring must put back the
    // image's OWN gain, never 1 -- getting that wrong would leave the ground
    // permanently over- or under-driven for every later scenario in the run.
    const r = makeRenderer();
    const i = internals(r);
    i.groundMat.uniforms.uSandStrength.value = 0.7;
    i.groundMat.uniforms.uRockStrength.value = 0.4;
    expect(r.setDebugLayerVisible('ground-albedo', false)).toBe(5);
    expect(i.groundMat.uniforms.uSandStrength.value).toBe(0);
    expect(i.groundMat.uniforms.uRockStrength.value).toBe(0);
    // A 404 leaves the macro field on, so the "texture never arrived" hide
    // must too -- otherwise the macro's contribution is credited to the tiles.
    expect(i.groundMat.uniforms.uMacroAmp.value).toBe(1);
    r.setDebugLayerVisible('ground-albedo', true);
    expect(i.groundMat.uniforms.uSandStrength.value).toBe(0.7);
    expect(i.groundMat.uniforms.uRockStrength.value).toBe(0.4);
    r.dispose();
  });

  it('drives the macro field to amplitude 0 and back, and touches no albedo slot', () => {
    // `macro` + `ground-albedo` together are the flat palette tone the scatter
    // tone check flattens to (`ToneCollapseSpec.over`).
    const r = makeRenderer();
    const i = internals(r);
    i.groundMat.uniforms.uSandStrength.value = 0.7;
    expect(r.setDebugLayerVisible('macro', false)).toBe(1);
    expect(i.groundMat.uniforms.uMacroAmp.value).toBe(0);
    expect(i.groundMat.uniforms.uSandStrength.value).toBe(0.7);
    r.setDebugLayerVisible('macro', true);
    expect(i.groundMat.uniforms.uMacroAmp.value).toBe(1);
    r.dispose();
  });

  it('names the ground\'s two new contributions', () => {
    expect(DEBUG_LAYERS).toContain('macro');
    expect(DEBUG_LAYERS).toContain('roads');
  });

  it.each([
    ['macro', 'uMacroAmp'],
    ['roads', 'uRoadOn'],
  ])('%s drives %s to 0 and back, and a second hide reports nothing changed', (layer, uniform) => {
    // `was === want ? 0 : 1`, the vignette/fog contract: the count is what
    // the gate prints, and a second hide that claimed to change something
    // would hide a caller that toggles twice.
    const r = makeRenderer();
    const u = internals(r).groundMat.uniforms[uniform];
    expect(u.value).toBe(1);
    expect(r.setDebugLayerVisible(layer, false)).toBe(1);
    expect(u.value).toBe(0);
    expect(r.setDebugLayerVisible(layer, false)).toBe(0);
    expect(r.setDebugLayerVisible(layer, true)).toBe(1);
    expect(u.value).toBe(1);
    expect(r.setDebugLayerVisible(layer, true)).toBe(0);
    r.dispose();
  });

  it('hides the road alone: no slot strength, grain gain or macro moves', () => {
    // The roads check must measure the road itself (Task 6 advisory C), so
    // the hide must not reach into the texture half the ground-albedo check
    // already owns.
    const r = makeRenderer();
    const g = internals(r).groundMat.uniforms;
    g.uSandStrength.value = 0.7;
    g.uRoadGrainGain.value = 0.5;
    r.setDebugLayerVisible('roads', false);
    expect(g.uSandStrength.value).toBe(0.7);
    expect(g.uRoadGrainGain.value).toBe(0.5);
    expect(g.uMacroAmp.value).toBe(1);
    r.dispose();
  });

  it('sets the terrain layers\' shadow flags the way rebuildTerrain claims', () => {
    // The asymmetry is deliberate and is argued in `rebuildTerrain`'s own
    // comment -- receiving is universal (every terrain layer is ground or
    // lies on it and must darken under a building or a tank), casting is
    // not. Nothing pinned it, so a stray `castShadow = true` on the ground
    // heightfield (acne along every slope) or a lost `false` on the grove
    // canopy (a flat card edge-on to the sun casting a sliver) would only
    // show up as a re-blessed golden baseline.
    const sim = new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
    const hut = sim.addStructureType({ id: 'hut', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
    sim.addStructure(hut, [5]);
    const r = new ThreeRenderer(sim, makeOpts());
    const i = internals(r);
    i.rebuildTerrain();

    for (const [name, mesh] of [
      ['ground', i.terrainMesh],
      ['scatter', i.scatterMesh],
      ['residual', i.residualMesh],
      ['grove', i.groveMesh],
    ] as const) {
      expect(mesh, `${name} mesh was not built`).not.toBeNull();
      expect(mesh!.receiveShadow, `${name} must receive`).toBe(true);
      expect(mesh!.castShadow, `${name} must not cast`).toBe(false);
    }

    // The one terrain layer with real height, and the only one that casts.
    expect(i.structureBoxes.size).toBe(1);
    const box = [...i.structureBoxes.values()][0];
    expect(box.castShadow).toBe(true);
    expect(box.receiveShadow).toBe(true);
    r.dispose();
  });

  it('does not stash a set of zeroes when hidden twice', () => {
    // The idempotence that matters: a second hide must not overwrite the
    // stashed gains with the zeroes it just wrote, or restoring would leave the
    // ground flat for the rest of the run and every later ground-albedo check
    // would read a delta of nothing -- a red gate with no defect behind it.
    const r = makeRenderer();
    const i = internals(r);
    i.groundMat.uniforms.uSandStrength.value = 0.7;
    r.setDebugLayerVisible('ground-albedo', false);
    r.setDebugLayerVisible('ground-albedo', false);
    r.setDebugLayerVisible('ground-albedo', true);
    expect(i.groundMat.uniforms.uSandStrength.value).toBe(0.7);
    r.dispose();
  });

  it('names the two blast layers, so a typo throws instead of reading as a layer that draws nothing', () => {
    // Both subjects only exist once Task 7 wires them, which is why the
    // names land in the same commit as the things they hide -- a
    // `DEBUG_LAYERS` entry whose `switch` arm draws nothing is exactly the
    // false green this module's own header is about.
    expect(DEBUG_LAYERS).toContain('scorch');
    expect(DEBUG_LAYERS).toContain('blast-light');
    expect(isDebugLayer('scorch')).toBe(true);
    expect(isDebugLayer('blast-light')).toBe(true);
    expect(unknownDebugLayerMessage('scorchh')).toContain('scorch');
  });

  it('hides the scorch decal mesh with a plain visible flag', () => {
    // `overlays`/`skirt`'s rule: nothing in `frame()` ever writes
    // `scorchDecals.mesh.visible` -- a mark is written once at `stamp()` and
    // never touched again -- so a plain toggle holds across the gate's
    // repaint. Its sibling `blast-light` follows the OTHER rule and is
    // pinned in `ThreeRenderer.blast.test.ts` instead, because proving that
    // one needs a live flash in the pool: with an empty pool
    // `FlashLightManager.step` writes 0 to every slot anyway, so a toggle
    // test on a quiet scene passes whether the flag is consulted or not.
    // (Measured -- deleting the `frame()` consult left an earlier version of
    // this test green.)
    const r = makeRenderer();
    const b = blastInternals(r);
    expect(r.setDebugLayerVisible('scorch', false)).toBe(1);
    expect(b.scorchDecals.mesh.visible).toBe(false);
    expect(r.setDebugLayerVisible('scorch', true)).toBe(1);
    expect(b.scorchDecals.mesh.visible).toBe(true);
    r.dispose();
  });
});
