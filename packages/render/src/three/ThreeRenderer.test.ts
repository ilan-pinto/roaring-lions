/**
 * Final whole-branch review (Fix 2): `dispose()` never disposed the fog
 * layer -- the retired `FogMesh`'s own `dispose()` existed and was called
 * from nowhere, so `tools/src/perf/three-units.ts:757` (which calls
 * `renderer.dispose()` between backends to publish a peak-VRAM figure)
 * leaked a full-map `InstancedMesh` on every run. That fix is one line in
 * `dispose()`; this file exists to guard it, and it is deliberately narrow.
 * Task 10 replaced the mesh with a `ShroudTexture` + `FogOfWarPass` pair
 * and the guard moved with it -- the GPU object changed, the leak shape did
 * not.
 *
 * `ThreeRenderer` has no other headless coverage (recorded, deliberately
 * deferred, in `progress.md`'s "Deferred to Phase C" list -- proving the
 * phase's headline fog/visibility claim wants a real seam, not a
 * constructor-level workaround). This file does not attempt that. It
 * constructs exactly enough of a real `ThreeRenderer` to prove one thing:
 * that `dispose()` reaches the fog layer's own `dispose()`.
 *
 * The one real obstacle is `new THREE.WebGLRenderer(...)`, which cannot
 * construct under this suite's headless `environment: 'node'` (no `document`,
 * no WebGL). Every other object `ThreeRenderer`'s constructor builds --
 * `ShroudTexture`, `ParticleInstancer`, `TracerBatch`, `vertexColorMaterial()`
 * -- is plain `THREE.*` JS-side construction with no GPU context needed,
 * already proven headless-safe by `shroud-texture.test.ts`,
 * `units/fx.test.ts` and elsewhere. (`FogOfWarPass` is deliberately NOT in
 * that list: it is built in `init()`, which this file never calls.) So this file substitutes a minimal stand-in for
 * `THREE.WebGLRenderer` alone (via `vi.mock`, scoped to this one test file)
 * rather than a real one, keeping every other `three` export untouched.
 * Confirmed by reading the constructor directly: nothing runs between `new
 * THREE.WebGLRenderer(...)` and the end of the constructor that touches the
 * renderer beyond the colour-pipeline assignments (`outputColorSpace`,
 * `toneMapping`, `toneMappingExposure`, `setClearColor`) the "colour
 * pipeline" describe block below pins, all stubbed below.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import paletteJson from '../../../../data/palette.json';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { STRIPE_COLOR_KEY } from './units/overlays';
import { SKIRT_TONE } from './terrain/skirt';
import { albedoMean } from './terrain/mesh';

const disposeSpy = vi.fn();

// `vi.mock` is hoisted by vitest above every import in this file (static or
// not), so the `import { ThreeRenderer } from './ThreeRenderer'` above --
// which itself does `import * as THREE from 'three'` -- resolves against
// this stand-in, not the real module.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    // Deliberately the WRONG value (three.js's own default is
    // `SRGBColorSpace`, not this) -- `the colour pipeline`'s test below
    // proves the constructor's own `this.renderer.outputColorSpace =
    // THREE.SRGBColorSpace` assignment runs. Starting the fake already at
    // `SRGBColorSpace` would make that assertion pass whether or not the
    // constructor ever touched the property at all -- the identical trap
    // review caught here, fixed the same way.
    outputColorSpace = actual.LinearSRGBColorSpace;
    domElement: unknown = {};
    /** Every hex `setClearColor` was called with, via `Color#getHexString()`
     *  (lower-case, no `#`) -- what `the colour pipeline`'s test below reads
     *  back to prove the constructor's background hex reached the clear
     *  colour. */
    clearColorCalls: string[] = [];
    setClearColor(color: THREE.Color): void {
      this.clearColorCalls.push(color.getHexString());
    }
    dispose(): void {
      disposeSpy();
    }
  }
  /**
   * Shell upgrade Phase 0 Task 9: `loadGroundTexture` reaches the network
   * through `new THREE.TextureLoader().load(url, onLoad, ...)`, and the one
   * thing worth proving about it headless is that the OPEN-GROUND slot also
   * reaches `terrain/skirt.ts`. This stand-in calls `onLoad` synchronously
   * with a REAL `THREE.Texture` (`prepareGroundTexture` mutates what it is
   * handed, and a plain object would throw), so the whole callback runs.
   */
  class FakeTextureLoader {
    load(_url: string, onLoad: (t: THREE.Texture) => void): THREE.Texture {
      const tex = new actual.Texture();
      onLoad(tex);
      return tex;
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer, TextureLoader: FakeTextureLoader };
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

function makeSim(): Sim {
  return new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
}

describe('ThreeRenderer.dispose', () => {
  it('disposes the fog shroud texture -- the exact regression this test guards', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    // Reach into the private field the same way this suite already treats
    // `ShroudTexture` as testable (`shroud-texture.test.ts` constructs and
    // inspects one directly) -- there is no public accessor for it, and
    // adding one purely for a test would widen `Renderer`'s surface for no
    // runtime reason (`api.ts`'s own top comment: "The surface is small ...
    // and that smallness is the whole reason replacing the backend is
    // tractable").
    //
    // Task 10 moved this guard from `fogMesh` (a full-map `InstancedMesh`,
    // geometry + material) to the shroud (a `DataTexture`), because fog is
    // a post pass now and the mesh is gone. The LEAK is the same shape and
    // so is the fix: a `dispose()` the class owns and has to actually call.
    // The other half of fog, `FogOfWarPass`, is built in `init()` -- which
    // needs a live GL context and is therefore out of this file's reach;
    // its release is pinned by reading `dispose()`, not by a test here.
    const shroud = (renderer as unknown as { shroud: { texture: unknown } }).shroud;
    const texture = shroud.texture as { addEventListener: (type: string, cb: () => void) => void };
    let textureDisposed = false;
    // three.js's own disposal signal: `Texture.dispose()` dispatches a
    // `'dispose'` event (it extends `EventDispatcher`) -- asserting on that
    // is a stronger guard than spying on `.dispose` directly, since it
    // proves the REAL three.js method ran, not merely that something
    // callable named `dispose` was invoked.
    texture.addEventListener('dispose', () => {
      textureDisposed = true;
    });

    renderer.dispose();

    expect(textureDisposed).toBe(true);
    // And the renderer's own WebGLRenderer.dispose() still ran too -- fog
    // disposal was ADDED, not substituted for something else.
    expect(disposeSpy).toHaveBeenCalled();
  });

  it('disposes smokeMesh -- the identical shape of leak the fog layer once had, guarded against from the start', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const smokeMesh = (renderer as unknown as { smokeMesh: { mesh: { geometry: unknown; material: unknown } } })
      .smokeMesh;
    const geometry = smokeMesh.mesh.geometry as { addEventListener: (type: string, cb: () => void) => void };
    const material = smokeMesh.mesh.material as { addEventListener: (type: string, cb: () => void) => void };
    let geometryDisposed = false;
    let materialDisposed = false;
    geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    material.addEventListener('dispose', () => {
      materialDisposed = true;
    });

    renderer.dispose();

    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
  });
});

describe('ThreeRenderer.onEvents removed', () => {
  it('never enters the billboard death-fade queue for a "removed" entity -- only "destroyed" does', () => {
    // The billboard path's whole death sequence (`stepDeaths`, `addWreck`)
    // is driven exclusively by `this.dying`, which `onEvents` populates from
    // exactly one SimEvent kind: `destroyed`. `Sim.removeFromPlay` (GDD §11,
    // a mission `remove` trigger -- the enemy's act, never a death) sets
    // `alive` the same way `destroy()` does but never emits `destroyed`
    // (`removeFromPlay`'s own doc comment), so a removed entity's normal
    // per-tick frame loop (`updateUnits`'s own `if (st.alive[i] === 0)
    // continue`) simply stops drawing it -- no fork needed on this path at
    // all. This is a negative assertion on the exact mechanism, not a full
    // `updateUnits` rig (which needs a loaded sheet/atlas this file does not
    // otherwise build): no entity need ever be spawned for it.
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const priv = renderer as unknown as { dying: unknown[] };
    renderer.onEvents([{ kind: 'removed', tick: 0, entity: 0, side: 0 }]);
    expect(priv.dying).toHaveLength(0);
  });
});

describe('the chevron fallback colour', () => {
  // `makeOpts()` supplies no `resolveColor`, which is the one caller shape that
  // reaches the constructor's literal at all -- in the app `main.ts` always
  // passes one. A wrong literal is therefore invisible on screen and shows up
  // only as a test drawing a stripe in some other swatch's colour, so it is
  // pinned against `data/palette.json` itself rather than a second copy of the
  // hex. The chevron shipped with `team.neutral`'s `#E8C33A` while its own key
  // is `dust.0`.
  const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;
  const swatch = (key: string): string => {
    const [band, index] = key.split('.');
    return ramps[band].colors[Number(index)];
  };

  it('falls back to the swatch STRIPE_COLOR_KEY resolves to, not to team.neutral', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const fill = (renderer as unknown as { chevronBatch: { fillColorHex: string } }).chevronBatch.fillColorHex;
    expect(fill).toBe(swatch(STRIPE_COLOR_KEY));
    expect(fill).not.toBe('#E8C33A');
  });
});

describe('the colour pipeline', () => {
  // Replaces `palette-material.test.ts`'s own `applyPalettePipeline` test,
  // deleted with that module (Task 7): the pass-through colour space it
  // pinned is gone, folded into four plain assignments at the
  // `ThreeRenderer` constructor's own call site instead of one shared
  // function, so this is where that behaviour is proven now.
  it('configures the standard sRGB + ACES output and the palette background as clear colour', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const gl = (renderer as unknown as { renderer: { outputColorSpace: string; toneMapping: number; clearColorCalls: string[] } }).renderer;
    expect(gl.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(gl.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(gl.clearColorCalls).toEqual(['14150f']);
    // And the SCENE background, which is the one the composer actually
    // clears with: `setClearColor` alone leaves the GL clear colour holding
    // an sRGB-encoded triple whenever the previous `renderer.render` went to
    // the screen (SMAAPass does, every frame), and `RenderPass` then clears
    // the linear target with it -- measured off the map edge as #484b3b for
    // this #14150f. `Scene.background` is read with the target bound, so it
    // converts to linear. See the constructor's own comment.
    const scene = (renderer as unknown as { scene: THREE.Scene }).scene;
    expect((scene.background as THREE.Color).getHexString()).toBe('14150f');
    renderer.dispose();
  });
});

describe('the ground beyond the map', () => {
  /** Reaches the two private members this describe is about, the same way
   *  the fog-shroud guard above reaches `shroud`. */
  function internals(r: ThreeRenderer): {
    skirtMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    loadGroundTexture(): void;
  } {
    return r as unknown as ReturnType<typeof internals>;
  }

  it('binds the OPEN-GROUND albedo to the skirt, as a ratio to the image mean', () => {
    // The surviving mutant this test was written for: deleting the
    // `slot === 'sand'` branch in `loadGroundTexture` leaves the skirt
    // drawing flat `SKIRT_TONE` with no grain at all, and NOTHING else sees
    // it -- the visual gate's `skirt` toggle still moves tens of thousands
    // of pixels, because a flat quad is still a quad.
    const r = new ThreeRenderer(makeSim(), {
      ...makeOpts(),
      groundTextureUrl: 'http://example.invalid/desert_sand_tile.png',
    });
    const mesh = internals(r).skirtMesh;
    expect(mesh.material.map).toBeNull();
    internals(r).loadGroundTexture();
    expect(mesh.material.map).not.toBeNull();
    // The SAME texture object the ground material samples: one upload, and a
    // repeat that lines up with the ground's at the map edge.
    const ground = (r as unknown as { groundMat: { uniforms: Record<string, { value: unknown }> } })
      .groundMat;
    expect(mesh.material.map).toBe(ground.uniforms.uSand.value);
    // And applied as a ratio: `color * mean` is back at SKIRT_TONE.
    const mean = albedoMean('desert_sand_tile');
    expect(mesh.material.color.r * mean.x).toBeCloseTo(SKIRT_TONE.r, 5);
    expect(mesh.material.color.g * mean.y).toBeCloseTo(SKIRT_TONE.g, 5);
    expect(mesh.material.color.b * mean.z).toBeCloseTo(SKIRT_TONE.b, 5);
    r.dispose();
  });

  it('dispose() frees the skirt -- the same shape of leak the fog layer once had', () => {
    // It is added once in the CONSTRUCTOR and never rebuilt, so it is not
    // covered by `rebuildTerrain`'s own remove-and-dispose sweep; if
    // `dispose()` misses it, `tools/src/perf/three-units.ts` leaks one
    // geometry and one material per renderer it constructs.
    const r = new ThreeRenderer(makeSim(), makeOpts());
    const mesh = internals(r).skirtMesh;
    let geometryDisposed = 0;
    let materialDisposed = 0;
    mesh.geometry.addEventListener('dispose', () => {
      geometryDisposed += 1;
    });
    mesh.material.addEventListener('dispose', () => {
      materialDisposed += 1;
    });
    r.dispose();
    expect(geometryDisposed).toBe(1);
    expect(materialDisposed).toBe(1);
  });
});
