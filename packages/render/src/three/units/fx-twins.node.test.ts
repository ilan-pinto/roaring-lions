/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T11): the wiring BETWEEN the FX twins and the rest of the seam: which slot makes which twin, the census keys, the L-matched
 * keys, the late-adoption sites in `ThreeRenderer`, the legacy shaders' text (the constants refactor must not move a program), and the
 * rule that no FX writer reaches its uniforms through `mesh.material`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { WEAPON_CLASS } from '@lions/sim';
import { describe, expect, it } from 'vitest';
import type { EmitterSpec } from '../../vfx';
import { censusUnported, PORTED_MATERIAL_KEYS } from '../backend/unported';
import { P3_MATERIAL_NAMES } from '../material-names';
import { adoptMaterials, createTwinCache, legacyTwinSlot } from '../node-material-adoption';
import { isTwin, legacyOf } from '../twin-identity';
import { BeamBatch } from './beam-batch';
import { CollapseShroudManager } from './collapse-shroud';
import { ParticleInstancer, TracerBatch, createTracerMaterial } from './fx';
import { MissileFx } from './missile-fx';
import type { MissileLaunch, TargetTrack } from './missiles';
import { createRotorBlurMaterial } from './swarm-batch';
import { createSmokePlumeMaterial } from './smoke-plume';
import { createVfxMeshMaterial } from './vfx-mesh-material';
import { fxKit } from './fx-twin-test-kit';

const SLOTS = ['particle', 'tracer', 'vfxMesh', 'rimFade', 'beam', 'rotor'] as const;
const NAMES = ['rl-fx-particle', 'rl-fx-particle-hot', 'rl-fx-tracer', 'rl-fx-mesh', 'rl-smoke-plume', 'rl-collapse-shroud', 'rl-beam', 'rl-swarm-rotors'] as const;
const SRC = resolve(process.cwd(), 'src/three');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8');
/** Source with comments removed, so a rule about code is not tripped by a sentence about it. */
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the kit: which slot makes which twin', () => {
  it('fills exactly the six FX slots of this task and leaves the flipbook and smoke screen (T12) empty', async () => {
    const kit = await fxKit();
    for (const s of SLOTS) expect(kit[s], s).not.toBeNull();
    for (const s of ['flipbook', 'smokeScreen', 'unit', 'decal', 'overlay', 'xray'] as const) expect(kit[s], s).toBeNull();
  });

  it('each legacy material name is recognised for the slot that owns it, and every one of them is a P3 name', () => {
    const slotOf: Record<string, (typeof SLOTS)[number]> = {
      'rl-fx-particle': 'particle', 'rl-fx-particle-hot': 'particle', 'rl-fx-tracer': 'tracer', 'rl-fx-mesh': 'vfxMesh',
      'rl-smoke-plume': 'rimFade', 'rl-collapse-shroud': 'rimFade', 'rl-beam': 'beam', 'rl-swarm-rotors': 'rotor',
    };
    for (const n of NAMES) {
      expect(P3_MATERIAL_NAMES[n], n).toBe(slotOf[n]);
      const m = new THREE.ShaderMaterial({ name: n });
      expect(legacyTwinSlot(m), n).toBe(slotOf[n]);
    }
  });

  it('every factory returns a twin that names its legacy material, and adoption keeps the legacy state', async () => {
    const kit = await fxKit();
    const legacies: Array<[(typeof SLOTS)[number], THREE.Material]> = [
      ['particle', new ParticleInstancer(2, 0, true, true).mesh.material as THREE.Material],
      ['tracer', createTracerMaterial(true)],
      ['vfxMesh', createVfxMeshMaterial()],
      ['rimFade', createSmokePlumeMaterial()],
      ['rotor', createRotorBlurMaterial()],
    ];
    for (const [slot, legacy] of legacies) {
      const twin = (kit[slot] as (m: THREE.Material) => THREE.Material)(legacy);
      expect(isTwin(twin), slot).toBe(true);
      expect(legacyOf(twin), slot).toBe(legacy);
    }
  });
});

describe('the census and the L-matched arm', () => {
  it('the eight legacy names are in PORTED_MATERIAL_KEYS, and the flipbook, fire and smoke screen (T12) are not', () => {
    for (const n of NAMES) expect(PORTED_MATERIAL_KEYS.has(n), n).toBe(true);
    for (const n of ['rl-flipbook-smoke', 'rl-flipbook-fire', 'rl-smoke-screen']) expect(PORTED_MATERIAL_KEYS.has(n), n).toBe(false);
  });

  it('adopted, none of them is hidden or named by the node census; un-adopted, each is hidden and named (so the check can fail)', async () => {
    const make = (): THREE.Group => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(), createTracerMaterial(true)));
      g.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), createVfxMeshMaterial(), 1));
      g.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), createRotorBlurMaterial(), 1));
      g.add(new ParticleInstancer(2, 0, true, false).mesh);
      return g;
    };
    const adopted = make();
    expect(adoptMaterials(adopted, await fxKit(), createTwinCache())).toBe(4);
    expect(censusUnported(adopted)).toEqual([]);
    for (const o of adopted.children) expect(o.visible).toBe(true);
    const bare = make();
    expect(censusUnported(bare)).toHaveLength(4);
    for (const o of bare.children) expect(o.visible).toBe(false);
    // L-matched: the same legacy scene, read with the ported keys, keeps all four visible and reports none.
    const lm = make();
    expect(censusUnported(lm, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    for (const o of lm.children) expect(o.visible).toBe(true);
  });
});

const TRAIL: EmitterSpec = {
  id: 'missile_trail', trigger: 'projectile_trail', layer: 'above_units',
  particles: [
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 2.5, color_over_life: ['vfx.white_hot'], additive: true },
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 6, color_over_life: ['vfx.fire'], alpha_over_life: [0.55] },
    { sprite: 'smoke_puff', count: 1, lifetime_ms: 1600, size_px: 2.5, size_over_life: [1, 3.2],
      color_over_life: ['limestone.1', 'limestone.3', 'gunmetal.1'], alpha_over_life: [0.7, 0] },
  ],
};
const resolveKey = (k: string): string => (k.startsWith('vfx') ? '#FFB43C' : '#E6D8BE');
const LAUNCH: MissileLaunch = {
  sx: 0, sy: 0, tx: 8, ty: 0, simDistTiles: 8, side: 0, cls: WEAPON_CLASS.atgm, weaponId: 'spike_atgm',
  target: 1, willHit: true, shooterAir: false, targetAir: false, tick: 5, shooter: 0,
};
const TRACK: TargetTrack = { x: [0, 8], y: [0, 0], alive: [1, 1] };

describe('G5: the batches that re-derive visible every frame draw through their twin on every frame', () => {
  it('the missile meshes (tracer body, halo and core particles) are all adopted, never census-hidden, across idle and flight frames', async () => {
    const fx = new MissileFx();
    fx.setLook(TRAIL, resolveKey);
    const scene = new THREE.Scene();
    scene.add(...fx.meshes);
    expect(adoptMaterials(scene, await fxKit(), createTwinCache())).toBe(3);
    const frames: Array<() => void> = [
      () => fx.step(1 / 60, TRACK, null, 0, 0),
      () => {
        fx.launch(LAUNCH);
        fx.step(0.5, TRACK, null, 0, 0);
      },
      () => fx.step(0.1, TRACK, null, 0, 0),
    ];
    const seen: number[] = [];
    for (const f of frames) {
      f();
      expect(censusUnported(scene)).toEqual([]);
      seen.push(fx.meshes.filter((m) => m.visible).length);
    }
    // Idle draws nothing, the flight frame draws all three, and the census never took one away.
    expect(seen[0]).toBe(0);
    expect(seen[1]).toBe(3);
    for (const m of fx.meshes) expect(isTwin((m as THREE.Mesh).material as THREE.Material)).toBe(true);
  });
});

describe('the writers hold their legacy material apart', () => {
  const FILES = [
    'units/fx.ts', 'units/missile-fx.ts', 'units/muzzle-flash.ts', 'units/explosion-burst.ts', 'units/smoke-plume.ts',
    'units/collapse-shroud.ts', 'units/beam-batch.ts', 'units/swarm-batch.ts', 'units/vfx-mesh-material.ts',
  ];
  it('no FX module writes a uniform through a mesh\'s material (it is the twin once adopted)', () => {
    for (const f of FILES) {
      const src = code(f);
      // `this.mesh.material.uniforms`, `(this.spriteMesh.material as X).uniforms`, `rotors.material...uniforms`: a write through a draw object.
      expect(src, f).not.toMatch(/(?:[mM]esh|rotors|bodies|wrecks)\.material\b[^;\n]{0,80}\.uniforms\b/);
    }
  });

  it('the shell batch writes its gain to the material it made, before the mesh can be adopted; the twin reads it afterwards', async () => {
    const batch = new TracerBatch(2);
    const legacy = batch.mesh.material;
    const root = new THREE.Group();
    root.add(batch.mesh);
    adoptMaterials(root, await fxKit(), createTwinCache());
    expect(batch.mesh.material).not.toBe(legacy);
    expect(legacy.uniforms.uHdr?.value).toBe(1);
  });
});

describe('the late-adoption sites: batches built after init', () => {
  const tr = code('ThreeRenderer.ts');
  it('the muzzle flash, burst and plume loaders and the swarm batch queue what they add (init adopted the scene before they existed)', () => {
    for (const [method, needle] of [
      ['loadMuzzleFlashMesh', 'queueNodeAdoption(m)'],
      ['loadExplosionBurstMesh', 'queueNodeAdoption(m)'],
      ['loadSmokePlumeMesh', 'queueNodeAdoption(m)'],
      ['syncSwarmBatch', 'queueNodeAdoption(batch.rotors)'],
    ] as const) {
      const start = tr.indexOf(`${method === 'syncSwarmBatch' ? 'private ' : 'async '}${method}(`);
      expect(start, method).toBeGreaterThan(0);
      // The body of the method: up to the next member at the same indent.
      const end = tr.indexOf('\n  }\n', start);
      expect(tr.slice(start, end), method).toContain(needle);
    }
  });
});

describe('the legacy shaders keep their text: the constants refactor moves no program', () => {
  it('the shroud\'s shade thresholds, the beam\'s disc feather and the rotor\'s hub guard, blade power, fade-in and phase step', () => {
    const shroud = new CollapseShroudManager().mesh.material as THREE.ShaderMaterial;
    expect(shroud.vertexShader).toContain('vColor = aShade < 0.5 ? uDeep : (aShade < 1.5 ? uBody : uCrown);');
    const rotor = createRotorBlurMaterial();
    expect(rotor.fragmentShader).toContain('float ang = r < 1e-4 ? 0.0 : atan(vDisc.y, vDisc.x);');
    expect(rotor.fragmentShader).toContain('pow(abs(cos(2.0 * (ang - vSpin))), 18.0) * smoothstep(0.2, 0.75, r)');
    expect(rotor.vertexShader).toContain('+ aHub * 1.7;');
    const beam = new BeamBatch(new THREE.Group()).mesh.material;
    expect(beam.fragmentShader).toContain('a *= 1.0 - smoothstep(0.35, 1.0, r);');
  });
});
