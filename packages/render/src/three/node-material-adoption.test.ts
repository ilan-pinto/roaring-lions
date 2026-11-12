/**
 * GH-943 P3 (T1): the adoption table and the shared unit twin.
 *
 * - G5: every P3 legacy `ShaderMaterial` is built for REAL (its own constructor, never a fixture), and its `name` maps to the slot
 *   the brief gives. The expected table is LITERAL here, never imported from `material-names.ts`.
 *   Falsify: drop one `name:` line (e.g. `units/beam-batch.ts`'s `name: 'rl-beam'`): that row reads null.
 * - The recognisers: a hooked material whose segments are all unit hooks is `unit`; the outline, banner and backdrop keys; a
 *   mixed key is nothing. `UNIT_HOOK_SEGMENTS` is pinned against the five legacy hook constants.
 * - The shared unit twin: one twin per (base, segments, pipeline state), refcounted, freed by the last legacy user.
 *   Falsify: key the memo on the legacy clone (`legacyBaseOf(m)` -> `m` in `sharedTwin`): the memo spec reads two twins.
 * - The `visible` mirror (ruling P3-R4), both ways. Falsify: mirror only false -> true.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MaterialKit } from './backend/backend';
import { adoptMaterials, createTwinCache, legacyTwinSlot, mirrorTwinVisibility, NULL_P3_SLOTS } from './node-material-adoption';
import { legacyOf, recordLegacyBase, TWIN_LEGACY_KEY } from './twin-identity';
import { UNIT_HOOK_SEGMENTS } from './material-names';
import { createDecalMaterial } from './decal-pool';
import { OverlayBatch } from './units/overlays';
import { createZoneBandMaterial } from './units/zone-band';
import { createSupplyRouteMaterial } from './supply-route';
import { TrailMesh } from './trail-mesh';
import { TunnelXray } from './tunnel-xray';
import { createParticleMaterial, createTracerMaterial } from './units/fx';
import { createVfxMeshMaterial } from './units/vfx-mesh-material';
import { FlipbookFx } from './units/flipbook-fx';
import { SmokeMesh } from './smoke-mesh';
import { createSmokePlumeMaterial } from './units/smoke-plume';
import { createCollapseShroudMaterial } from './units/collapse-shroud';
import { BeamBatch } from './units/beam-batch';
import { createRotorBlurMaterial } from './units/swarm-batch';
import { TEAM_MASK_PROGRAM_KEY } from './units/team-mask';
import { RG_PROGRAM_KEY } from './units/running-gear-material';
import { RAIN_RIM_PROGRAM_KEY } from './units/rain-rim';
import { WOUNDED_FLOOR_PROGRAM_KEY } from './units/wounded-read';
import { SOOT_PROGRAM_KEY } from './world-materials';

const DECAL_PALETTE = {
  craterBowl: '#23241F',
  craterLip: '#E6D8BE',
  scorch: '#23241F',
  oil: '#14150F',
  rubbleA: '#A28C6E',
  rubbleB: '#75624A',
  tread: '#806032',
  tyre: '#8C7659',
};
const XRAY_COLORS = { rim: '#6FE0FF', core: '#14150F', hot: '#FFF6D0', figure: '#D93A2B' };

const mat = (o: { material: THREE.Material | THREE.Material[] }): THREE.Material => o.material as THREE.Material;
const xrayMat = (x: TunnelXray, field: 'tubeMat' | 'collarMat' | 'figureMat' | 'beamMat'): THREE.Material =>
  (x as unknown as Record<string, THREE.Material>)[field] as THREE.Material;

/** Every P3 legacy ShaderMaterial, from its own constructor. The expected name and slot are literals. */
function realLegacyMaterials(): Array<{ name: string; slot: string; build: () => THREE.Material }> {
  return [
    { name: 'rl-decal', slot: 'decal', build: () => createDecalMaterial(DECAL_PALETTE) },
    { name: 'rl-overlay', slot: 'overlay', build: () => mat(new OverlayBatch(64).mesh) },
    { name: 'rl-zone-band', slot: 'zoneBand', build: () => createZoneBandMaterial() },
    { name: 'rl-supply-route', slot: 'supplyRoute', build: () => createSupplyRouteMaterial() },
    { name: 'rl-trail', slot: 'trail', build: () => mat(new TrailMesh(4, 4, '#6E7449').mesh) },
    { name: 'rl-xray-tube', slot: 'xray', build: () => xrayMat(new TunnelXray(XRAY_COLORS), 'tubeMat') },
    { name: 'rl-xray-collar', slot: 'xray', build: () => xrayMat(new TunnelXray(XRAY_COLORS), 'collarMat') },
    { name: 'rl-xray-figure', slot: 'xray', build: () => xrayMat(new TunnelXray(XRAY_COLORS), 'figureMat') },
    { name: 'rl-xray-beam', slot: 'xray', build: () => xrayMat(new TunnelXray(XRAY_COLORS), 'beamMat') },
    { name: 'rl-fx-particle', slot: 'particle', build: () => createParticleMaterial(true, false) },
    { name: 'rl-fx-particle-hot', slot: 'particle', build: () => createParticleMaterial(true, true) },
    { name: 'rl-fx-tracer', slot: 'tracer', build: () => createTracerMaterial() },
    { name: 'rl-fx-mesh', slot: 'vfxMesh', build: () => createVfxMeshMaterial() },
    { name: 'rl-flipbook-smoke', slot: 'flipbook', build: () => mat(new FlipbookFx(8).mesh) },
    { name: 'rl-flipbook-fire', slot: 'flipbook', build: () => mat(new FlipbookFx(8).fireMesh) },
    { name: 'rl-smoke-screen', slot: 'smokeScreen', build: () => mat(new SmokeMesh(4, 4).mesh) },
    { name: 'rl-smoke-plume', slot: 'rimFade', build: () => createSmokePlumeMaterial() },
    { name: 'rl-collapse-shroud', slot: 'rimFade', build: () => createCollapseShroudMaterial() },
    { name: 'rl-beam', slot: 'beam', build: () => mat(new BeamBatch(new THREE.Group()).mesh) },
    { name: 'rl-swarm-rotors', slot: 'rotor', build: () => createRotorBlurMaterial() },
  ];
}

describe('G5: each P3 legacy name matches its slot, on the REAL legacy material', () => {
  it.each(realLegacyMaterials().map((r) => [r.name, r] as const))('%s', (_name, row) => {
    const m = row.build();
    expect((m as THREE.ShaderMaterial).isShaderMaterial).toBe(true);
    expect(m.name).toBe(row.name);
    expect(legacyTwinSlot(m)).toBe(row.slot);
  });
  it('covers twenty names, the brief\'s list', () => {
    expect(realLegacyMaterials()).toHaveLength(20);
  });
  it('an unnamed ShaderMaterial, and the stock text, have no slot', () => {
    expect(legacyTwinSlot(new THREE.ShaderMaterial())).toBeNull();
    expect(legacyTwinSlot(new THREE.MeshStandardMaterial())).toBeNull();
  });
});

/** A material whose program key is the stock text plus `segments`, with a non-stock hook. */
function hooked(segments: readonly string[], ctor: new () => THREE.Material = THREE.MeshStandardMaterial): THREE.Material {
  const m = new ctor();
  const base = m.customProgramCacheKey();
  m.onBeforeCompile = () => {};
  m.customProgramCacheKey = () => [base, ...segments].join('|');
  return m;
}

describe('the unit, outline, banner and backdrop recognisers', () => {
  it('UNIT_HOOK_SEGMENTS is exactly the five legacy hook constants', () => {
    expect([...UNIT_HOOK_SEGMENTS].sort()).toEqual(
      [TEAM_MASK_PROGRAM_KEY, RG_PROGRAM_KEY, RAIN_RIM_PROGRAM_KEY, WOUNDED_FLOOR_PROGRAM_KEY, SOOT_PROGRAM_KEY].sort()
    );
  });
  it('a hook chain of unit segments is unit; a mixed chain, or no segment, is nothing', () => {
    expect(legacyTwinSlot(hooked(['rl-unit-mark-3']))).toBe('unit');
    expect(legacyTwinSlot(hooked(['rl-unit-mark-3', 'rl-running-gear-1']))).toBe('unit');
    expect(legacyTwinSlot(hooked(['rl-unit-rain-rim', 'rl-wounded-floor']))).toBe('unit');
    expect(legacyTwinSlot(hooked(['rl-soot']))).toBe('unit');
    expect(legacyTwinSlot(hooked(['rl-unit-mark-3', 'rl-garrison-banner']))).toBeNull();
    expect(legacyTwinSlot(hooked([]))).toBeNull();
  });
  it('the one-segment keys', () => {
    expect(legacyTwinSlot(hooked(['rl-silhouette-outline'], THREE.MeshBasicMaterial))).toBe('outline');
    expect(legacyTwinSlot(hooked(['rl-garrison-banner']))).toBe('banner');
    expect(legacyTwinSlot(hooked(['rl-backdrop-fade']))).toBe('backdrop');
  });
});

interface CountingKit extends MaterialKit {
  made: THREE.Material[];
}

/** A kit whose `unit`, `decal` and `ring` factories each return a fresh twin and count it. */
function countingKit(): CountingKit {
  const made: THREE.Material[] = [];
  const make = (name: string) => (): THREE.Material => {
    const t = new THREE.MeshBasicMaterial({ name });
    made.push(t);
    return t;
  };
  return { ...NULL_P3_SLOTS, ground: null, foliage: null, ring: make('twin-ring'), unit: make('twin-unit'), decal: make('twin-decal'), made };
}

const meshOf = (m: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BufferGeometry(), m);

describe('the shared unit twin', () => {
  it('two clones of one base with the same segments and state share one twin; a different state or base does not', () => {
    const kit = countingKit();
    const cache = createTwinCache();
    const base = hooked(['rl-unit-mark-3']);
    const a = hooked(['rl-unit-mark-3', 'rl-running-gear-1']);
    const b = hooked(['rl-unit-mark-3', 'rl-running-gear-1']);
    recordLegacyBase(a, base);
    recordLegacyBase(b, base);
    const root = new THREE.Group();
    const ma = meshOf(a);
    const mb = meshOf(b);
    root.add(meshOf(base), ma, mb);
    adoptMaterials(root, kit, cache);
    // base (its own segments) and one running-gear twin for both clones.
    expect(kit.made).toHaveLength(2);
    expect(ma.material).toBe(mb.material);
    // The shared twin records its memo BASE; each mesh records its OWN legacy material (ruling P3-R2).
    expect((ma.material as THREE.Material).userData[TWIN_LEGACY_KEY]).toBe(base);
    expect(legacyOf(ma.material as THREE.Material, ma)).toBe(a);
    expect(legacyOf(mb.material as THREE.Material, mb)).toBe(b);
    expect(legacyOf(ma.material as THREE.Material)).toBe(base);
    // A transparent clone (a death fade) keys apart; so does another base.
    const fade = hooked(['rl-unit-mark-3']);
    fade.transparent = true;
    recordLegacyBase(fade, base);
    const other = hooked(['rl-unit-mark-3']);
    const root2 = new THREE.Group();
    root2.add(meshOf(fade), meshOf(other));
    adoptMaterials(root2, kit, cache);
    expect(kit.made).toHaveLength(4);
    expect(kit.made[2]?.transparent).toBe(true);
  });

  it('is freed by its LAST legacy user, not its first', () => {
    const kit = countingKit();
    const cache = createTwinCache();
    const base = hooked(['rl-unit-mark-3']);
    const a = hooked(['rl-unit-mark-3', 'rl-running-gear-1']);
    const b = hooked(['rl-unit-mark-3', 'rl-running-gear-1']);
    recordLegacyBase(a, base);
    recordLegacyBase(b, base);
    const root = new THREE.Group();
    root.add(meshOf(a), meshOf(b));
    adoptMaterials(root, kit, cache);
    const twin = kit.made[0] as THREE.Material;
    let freed = 0;
    twin.addEventListener('dispose', () => freed++);
    a.dispose();
    a.dispose();
    expect(freed).toBe(0);
    b.dispose();
    expect(freed).toBe(1);
    // A third clone after the last user went makes a fresh twin.
    const c = hooked(['rl-unit-mark-3', 'rl-running-gear-1']);
    recordLegacyBase(c, base);
    const root2 = new THREE.Group();
    root2.add(meshOf(c));
    adoptMaterials(root2, kit, cache);
    expect(kit.made).toHaveLength(2);
  });

  it('a P3 twin takes the legacy render state; a P2 twin (the ring) is left exactly as its factory made it', () => {
    const kit = countingKit();
    const decal = new THREE.ShaderMaterial({ name: 'rl-decal', depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const ring = new THREE.ShaderMaterial({ name: 'rl-selection-ring', depthWrite: false });
    const root = new THREE.Group();
    const md = meshOf(decal);
    const mr = meshOf(ring);
    root.add(md, mr);
    adoptMaterials(root, kit, createTwinCache());
    expect((md.material as THREE.Material).polygonOffset).toBe(true);
    expect((md.material as THREE.Material).polygonOffsetFactor).toBe(-1);
    expect((md.material as THREE.Material).depthWrite).toBe(false);
    expect((mr.material as THREE.Material).depthWrite).toBe(true);
    expect((mr.material as THREE.Material).userData[TWIN_LEGACY_KEY]).toBe(ring);
  });
});

describe('ruling P3-R4: visible follows the legacy material, both ways', () => {
  it('hide then show the legacy material: the twin follows each time', () => {
    const kit = countingKit();
    const cache = createTwinCache();
    const decal = new THREE.ShaderMaterial({ name: 'rl-decal' });
    const unitBase = hooked(['rl-unit-mark-3']);
    const root = new THREE.Group();
    const md = meshOf(decal);
    const mu = meshOf(unitBase);
    root.add(md, mu);
    adoptMaterials(root, kit, cache);
    const twins = [md.material as THREE.Material, mu.material as THREE.Material];
    expect(mirrorTwinVisibility(cache)).toBe(0);
    decal.visible = false;
    unitBase.visible = false;
    expect(mirrorTwinVisibility(cache)).toBe(2);
    for (const t of twins) expect(t.visible).toBe(false);
    decal.visible = true;
    unitBase.visible = true;
    expect(mirrorTwinVisibility(cache)).toBe(2);
    for (const t of twins) expect(t.visible).toBe(true);
  });
  it('a disposed twin leaves the mirror', () => {
    const kit = countingKit();
    const cache = createTwinCache();
    const decal = new THREE.ShaderMaterial({ name: 'rl-decal' });
    const root = new THREE.Group();
    root.add(meshOf(decal));
    adoptMaterials(root, kit, cache);
    expect(cache.live.size).toBe(1);
    decal.dispose();
    expect(cache.live.size).toBe(0);
  });
});
