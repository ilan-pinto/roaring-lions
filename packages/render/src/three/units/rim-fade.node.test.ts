/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T11) gates for `rim-fade.node.ts`: the smoke plume and the collapse shroud, one recipe with three options. Maths on numbers
 * against literals; wiring on the generated program text of meshes built the way the real managers build them.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import { COLLAPSE_SHROUD_DENSITY, COLLAPSE_SHROUD_EDGE_SOFTNESS, COLLAPSE_SHROUD_SHADE_BREAKS, CollapseShroudManager } from './collapse-shroud';
import { createSmokePlumeMaterial, rimFadeOps, SmokePlumeManager, SMOKE_PLUME_DENSITY, SMOKE_PLUME_EDGE_SOFTNESS, SMOKE_PLUME_TOP_DENSITY } from './smoke-plume';
import { createNodeRimFadeMaterial, rimFadeOptionsFor } from './rim-fade.node';
import { FX_BOUND_KEY, type FxTwinBound } from './fx.node';
import { adoptFx, compileFx, maths, webgpuModules, type Updatable } from './fx-twin-test-kit';

const boundOf = (m: THREE.Material): FxTwinBound => m.userData[FX_BOUND_KEY] as FxTwinBound;

describe('the rim fade on numbers (literals)', () => {
  const plume = (facing: number, opacity: number, height: number) =>
    rimFadeOps(NUMBER_OPS, { facing, opacity, softness: 0.55, density: 0.62, height, topDensity: 0.4 });
  const shroud = (facing: number, opacity: number) => rimFadeOps(NUMBER_OPS, { facing, opacity, softness: 0.85, density: 0.82 });

  it('the rim is 0 edge-on and 1 face-on, and the plume\'s constants are the shipped ones', () => {
    expect(plume(0, 1, 0).rim).toBe(0);
    expect(plume(1, 1, 0).rim).toBe(1);
    expect(plume(0.55, 1, 0).rim).toBe(1);
    // Halfway up the ramp [0, 0.55] the smoothstep is 0.5.
    expect(plume(0.275, 1, 0).rim).toBeCloseTo(0.5, 12);
    expect(SMOKE_PLUME_EDGE_SOFTNESS).toBe(0.55);
    expect(SMOKE_PLUME_DENSITY).toBe(0.62);
    expect(SMOKE_PLUME_TOP_DENSITY).toBe(0.4);
  });
  it('the plume thins with height: 1 at the base, 0.4 at the top, and alpha is density * opacity * rim * thin', () => {
    expect(plume(1, 1, 0).thin).toBe(1);
    expect(plume(1, 1, 1).thin).toBeCloseTo(0.4, 12);
    expect(plume(1, 1, 0.5).thin).toBeCloseTo(0.7, 12);
    expect(plume(1, 1, 0).alpha).toBeCloseTo(0.62, 12);
    expect(plume(1, 0.5, 1).alpha).toBeCloseTo(0.62 * 0.5 * 0.4, 12);
    expect(plume(0, 1, 0).alpha).toBe(0);
  });
  it('the shroud has no top fade and its own softness 0.85 and density 0.82', () => {
    expect(shroud(1, 1).thin).toBe(1);
    expect(shroud(1, 1).alpha).toBeCloseTo(0.82, 12);
    expect(shroud(0.425, 1).rim).toBeCloseTo(0.5, 12);
    expect(shroud(0.425, 1).alpha).toBeCloseTo(0.41, 12);
    expect(shroud(1, 0).alpha).toBe(0);
    expect(COLLAPSE_SHROUD_EDGE_SOFTNESS).toBe(0.85);
    expect(COLLAPSE_SHROUD_DENSITY).toBe(0.82);
    expect(COLLAPSE_SHROUD_SHADE_BREAKS).toEqual([0.5, 1.5]);
  });
  it('the handed-in constants are the shipped ones', () => {
    expect(maths.rimFade.plume).toEqual({ softness: 0.55, density: 0.62, topDensity: 0.4 });
    expect(maths.rimFade.shroud).toEqual({ softness: 0.85, density: 0.82, shadeBreaks: [0.5, 1.5] });
  });
});

/** A plume zone mesh as `SmokePlumeManager.load` builds it: the manager's own material, an `aOpacity` instance attribute, a height. */
function plumeZone(mgr: SmokePlumeManager, role: 'base' | 'mid' | 'top' = 'base', height = 3): { mesh: THREE.InstancedMesh; legacy: THREE.ShaderMaterial } {
  const legacy = (mgr as unknown as { materials: Record<string, THREE.ShaderMaterial> }).materials[role] as THREE.ShaderMaterial;
  const g = new THREE.SphereGeometry(1, 8, 6);
  g.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(new Float32Array(4), 1));
  legacy.uniforms.uHeight!.value = height;
  const mesh = new THREE.InstancedMesh(g, legacy, 4);
  return { mesh, legacy };
}

describe('the plume twin graph', () => {
  it('wires aOpacity, uColor, uHeight (the vertex-stage height) and the instance-transformed normal', async () => {
    const { mesh } = plumeZone(new SmokePlumeManager());
    const twin = await adoptFx(mesh);
    const c = await compileFx(mesh);
    expect(c.vertex).toContain('aOpacity');
    // |N.V| is the view-space z of the normal AFTER three's own instance step (the inverse-transpose: the plume's exact correction).
    expect(c.vertex).toMatch(/normalLocal = normalize\( \( transpose\( inverse\( mat3\(/);
    expect(c.vertex).toMatch(/= abs\( normalize\( \( mat3\( modelViewMatrix\[ 0 \]\.xyz, modelViewMatrix\[ 1 \]\.xyz, modelViewMatrix\[ 2 \]\.xyz \) \* normalLocal \) \)\.z \);/);
    expect(c.vertex).toMatch(/= clamp\( \( position\.y \/ nodeUniform\d+ \), 0\.0, 1\.0 \);/);
    expect(c.uniforms.has(boundOf(twin).uHeight)).toBe(true);
    expect(c.uniforms.has(boundOf(twin).uColor)).toBe(true);
    // The recipe, in the fragment: 0.62 * opacity * smoothstep(0, 0.55, facing) * mix(1, 0.4, height); discarded at <= 0.
    expect(c.fragment).toMatch(/\( 0\.62 \* nodeVarying\d+ \) \* smoothstep\( 0\.0, 0\.55, nodeVarying\d+ \) \) \* mix\( 1\.0, 0\.4, nodeVarying\d+ \)/);
    expect(c.fragment).toMatch(/> 0\.0 \) \) \) \{\s*discard;/);
  });

  it('uHeight is re-read from the legacy record every render, and the colour is shared by reference', async () => {
    const mgr = new SmokePlumeManager();
    const { mesh, legacy } = plumeZone(mgr);
    const twin = await adoptFx(mesh);
    const h = boundOf(twin).uHeight as unknown as Updatable;
    h.update();
    expect(h.value).toBe(3);
    legacy.uniforms.uHeight!.value = 5.5;
    h.update();
    expect(h.value).toBe(5.5);
    // The manager's writer holds its legacy material apart: `setColors` reaches the twin although `mesh.material` is the twin now.
    expect(mesh.material).not.toBe(legacy);
    mgr.setColors(() => '#336699');
    const node = boundOf(twin).uColor as unknown as { value: THREE.Color };
    expect(node.value).toBe(legacy.uniforms.uColor!.value);
    expect(node.value.getHex()).toBe(new THREE.Color('#336699').getHex());
  });

  it('is front-sided and thins; the shroud is back-sided and does not', async () => {
    const { W } = await webgpuModules();
    expect(rimFadeOptionsFor(W, 'rl-smoke-plume')).toEqual({ side: THREE.FrontSide, thin: true, colourBy: 'uniform' });
    expect(rimFadeOptionsFor(W, 'rl-collapse-shroud')).toEqual({ side: THREE.BackSide, thin: false, colourBy: 'shade' });
    const { mesh, legacy } = plumeZone(new SmokePlumeManager());
    const twin = await adoptFx(mesh);
    expect(twin.side).toBe(legacy.side);
    expect(twin.side).toBe(THREE.FrontSide);
  });

  it('G4: no clock of its own', async () => {
    const { mesh } = plumeZone(new SmokePlumeManager());
    await adoptFx(mesh);
    expect((await compileFx(mesh)).frameClocked).toEqual([]);
  });

  it('the rim-fade material the factory makes for the plume is not the shroud\'s: the plume has no uDeep', async () => {
    const { mesh } = plumeZone(new SmokePlumeManager());
    const twin = await adoptFx(mesh);
    expect(Object.keys(boundOf(twin)).sort()).toEqual(['uColor', 'uHeight']);
    expect(createSmokePlumeMaterial().name).toBe('rl-smoke-plume');
  });
});

describe('the shroud twin graph', () => {
  it('wires aOpacity, aShade and the three-entry table, picked in the vertex stage at the legacy thresholds', async () => {
    const mgr = new CollapseShroudManager();
    const twin = await adoptFx(mgr.mesh);
    const c = await compileFx(mgr.mesh);
    for (const a of ['aOpacity', 'aShade']) expect(c.vertex, a).toContain(a);
    expect(c.vertex).toMatch(/if \( \( aShade < 0\.5 \) \) \{\s*nodeVar\d+ = nodeUniform\d+;\s*\} else \{\s*if \( \( aShade < 1\.5 \) \) \{/);
    const b = boundOf(twin);
    for (const k of ['uDeep', 'uBody', 'uCrown']) expect(c.uniforms.has(b[k]), k).toBe(true);
    // No height, no top fade.
    expect(b.uHeight).toBeUndefined();
    expect(c.fragment).not.toContain('mix( 1.0, 0.4');
    expect(c.fragment).toMatch(/\( 0\.82 \* nodeVarying\d+ \) \* smoothstep\( 0\.0, 0\.85, nodeVarying\d+ \) \) \* 1\.0 \)/);
    expect(c.fragment).toMatch(/> 0\.0 \) \) \) \{\s*discard;/);
    expect(twin.side).toBe(THREE.BackSide);
    expect(c.frameClocked).toEqual([]);
  });

  it('the manager\'s setColors reaches each table entry of the twin by reference', async () => {
    const mgr = new CollapseShroudManager();
    const legacy = mgr.mesh.material as THREE.ShaderMaterial;
    const twin = await adoptFx(mgr.mesh);
    // `setColors` resolves deep, body, crown in that order.
    const hexes = ['#112233', '#445566', '#778899'];
    let n = 0;
    mgr.setColors(() => hexes[n++] as string);
    const b = boundOf(twin);
    const seen = (['uDeep', 'uBody', 'uCrown'] as const).map((k) => {
      const node = b[k] as unknown as { value: THREE.Color };
      expect(node.value, k).toBe(legacy.uniforms[k]!.value);
      return node.value.getHex();
    });
    expect(seen).toEqual(hexes.map((h) => new THREE.Color(h).getHex()));
  });
});

describe('createNodeRimFadeMaterial options are all read', () => {
  it('thin false on a plume mesh drops the height fade; colourBy shade needs the table', async () => {
    const { W, TSL } = await webgpuModules();
    const { mesh, legacy } = plumeZone(new SmokePlumeManager());
    const twin = createNodeRimFadeMaterial({ W, TSL, maths: maths.rimFade }, legacy, { side: THREE.FrontSide, thin: false, colourBy: 'uniform' });
    twin.transparent = true;
    mesh.material = twin as never;
    const c = await compileFx(mesh);
    expect(c.fragment).not.toContain('mix( 1.0, 0.4');
    expect(boundOf(twin).uHeight).toBeUndefined();
    expect(() => createNodeRimFadeMaterial({ W, TSL, maths: maths.rimFade }, legacy, { side: THREE.FrontSide, thin: false, colourBy: 'shade' })).toThrow(/uDeep/);
  });
});
