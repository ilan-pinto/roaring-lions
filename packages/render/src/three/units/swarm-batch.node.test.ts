/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T11) gates for `swarm-batch.node.ts`: the drone swarm's rotor blur. Maths on numbers against literals; wiring on the
 * generated program text; the clock and the flicker gates on the REAL `SwarmBatch` (a box body and two rotor hubs: the batch's draw
 * path does not read the GLB's geometry).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import { censusUnported } from '../backend/unported';
import { adoptMaterials, createTwinCache } from '../node-material-adoption';
import { buildRotorDiscGeometry, createRotorBlurMaterial, rotorBlurOps, rotorSpinOps, SwarmBatch, type SwarmEntityInput, type SwarmFrameEnv } from './swarm-batch';
import { adoptFx, compileFx, fxKit } from './fx-twin-test-kit';

const blur = (x: number, y: number, spin: number) => rotorBlurOps(NUMBER_OPS, { discX: x, discY: y, spin });

describe('the rotor blur on numbers (literals)', () => {
  it('two blades: the streak peaks AT the blade angle and every half turn, and vanishes a quarter blade away', () => {
    // r 0.5: the fade-in smoothstep(0.2, 0.75, 0.5) is t = 0.5454.. -> 0.5454^2 (3 - 2 * 0.5454).
    const fade = (() => {
      const t = (0.5 - 0.2) / (0.75 - 0.2);
      return t * t * (3 - 2 * t);
    })();
    expect(blur(0.5, 0, 0).streak).toBeCloseTo(fade, 12);
    expect(blur(-0.5, 0, 0).streak).toBeCloseTo(fade, 12);
    expect(blur(0.5, 0, 0.3).streak).toBeCloseTo(fade * Math.pow(Math.abs(Math.cos(2 * -0.3)), 18), 12);
    // Between the blades (an eighth of a turn on: |cos(2 * pi/4)| = 0): no streak.
    const diag = 0.5 * Math.SQRT1_2;
    expect(blur(diag, diag, 0).streak).toBeCloseTo(0, 9);
    expect(blur(0.5, 0, 0).streak).toBeGreaterThan(blur(0.5 * Math.cos(0.2), 0.5 * Math.sin(0.2), 0).streak);
  });
  it('the alpha is mix(0.15, 0.45, smoothstep(0, 1, r)) plus 0.25 of the streak, capped at 1', () => {
    // Between the blades r 0.5: no streak, so the base alone: smoothstep(0, 1, 0.5) = 0.5.
    expect(blur(0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2, 0).alpha).toBeCloseTo(0.3, 9);
    expect(blur(0.5, 0, 0).alpha).toBeCloseTo(0.3 + 0.25 * blur(0.5, 0, 0).streak, 12);
    expect(blur(0.99999, 0, 0).alpha).toBeCloseTo(Math.min(1, 0.45 + 0.25), 4);
    expect(blur(0, 0, 0).alpha).toBeCloseTo(0.15, 12);
  });
  it('the hub guard: inside r < 1e-4 the angle is pinned to 0, not atan2 of a vanishing vector', () => {
    // (5e-5, 5e-5) has r 7.07e-5 < 1e-4, where atan2 would read pi / 4.
    expect(blur(5e-5, 5e-5, 0).ang).toBe(0);
    expect(blur(0, 0, 0).ang).toBe(0);
    // Just outside the guard the true angle is read.
    expect(blur(1.5e-4, 1.5e-4, 0).ang).toBeCloseTo(Math.PI / 4, 12);
    expect(Number.isNaN(blur(0, 0, 1.3).streak)).toBe(false);
  });
  it('the spin: neighbouring hubs turn opposite ways and each is offset by 1.7 rad per hub index', () => {
    const spin = (phase: number, hub: number) => rotorSpinOps(NUMBER_OPS, phase, hub);
    expect(spin(0.9, 0)).toBeCloseTo(0.9, 12);
    expect(spin(0.9, 1)).toBeCloseTo(-0.9 + 1.7, 12);
    expect(spin(0.9, 2)).toBeCloseTo(0.9 + 3.4, 12);
    expect(spin(0.9, 3)).toBeCloseTo(-0.9 + 5.1, 12);
  });
});

function rotorMesh(hubs = 2): { mesh: THREE.InstancedMesh; legacy: THREE.ShaderMaterial } {
  const geometry = buildRotorDiscGeometry(Array.from({ length: hubs }, (_, i) => ({ x: i, y: 0, z: 0, r: 1 })));
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(4), 1));
  const legacy = createRotorBlurMaterial();
  return { mesh: new THREE.InstancedMesh(geometry, legacy, 4), legacy };
}

describe('the rotor twin graph', () => {
  it('wires aDisc, aHub and aPhase (the spin in the vertex stage), uColor, and discards outside the disc', async () => {
    const { mesh } = rotorMesh();
    const twin = await adoptFx(mesh);
    const c = await compileFx(mesh);
    for (const a of ['aDisc', 'aHub', 'aPhase']) expect(c.vertex, a).toContain(a);
    expect(c.vertex).toMatch(/\( aHub - \( floor\( \( aHub \/ 2\.0 \) \) \* 2\.0 \) \) < 0\.5 \)/);
    expect(c.vertex).toMatch(/\( aHub \* 1\.7 \)/);
    expect(c.uniforms.has((twin.userData.rlFxBound as Record<string, unknown>).uColor)).toBe(true);
    expect(c.fragment).toMatch(/<= 1\.0 \) \) \) \{\s*discard;/);
    // The hub guard, the blade power and the fade-in reach the shader.
    expect(c.fragment).toMatch(/< 0\.0001 \) \) \{\s*nodeVar\d+ = 0\.0;\s*\} else \{\s*nodeVar\d+ = atan\(/);
    expect(c.fragment).toContain('pow( abs( cos(');
    expect(c.fragment).toContain('18.0');
    expect(c.fragment).toContain('smoothstep( 0.2, 0.75');
    expect(c.fragment).toContain('mix( 0.15, 0.45');
  });

  it('G4: the phase is the batch\'s SIM-clock attribute; the twin has no clock, so a zero-time repaint moves nothing', async () => {
    const { mesh } = rotorMesh();
    await adoptFx(mesh);
    expect((await compileFx(mesh)).frameClocked).toEqual([]);
  });
});

function built(): { batch: SwarmBatch; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const body = new THREE.BoxGeometry(0.4, 0.1, 0.4);
  body.setAttribute('color', new THREE.BufferAttribute(new Float32Array(body.getAttribute('position').count * 3).fill(0.5), 3));
  const rotors = [{ x: 0.2, y: 0.05, z: 0.2, r: 0.15 }, { x: -0.2, y: 0.05, z: 0.2, r: 0.15 }];
  return { batch: new SwarmBatch(scene, { body, wreck: null, rotors }), scene };
}

const env = (simSec: number): SwarmFrameEnv => ({ simTick: 0, simSec, groundAt: () => 0, drawnAt: () => true, exploredAt: () => true, bodiesHidden: false, quiet: false });
const entity = (live: number): SwarmEntityInput => ({ id: 7, side: 1, count: 12, spreadTiles: 1.5, live, x: 10, z: 12, groundY: 0, liftY: 0.357, yaw: 0, drawn: true });

function frame(batch: SwarmBatch, simSec: number, live: number): void {
  batch.beginFrame(env(simSec));
  batch.updateEntity(entity(live), undefined, []);
  batch.stepExits(0.016);
  batch.finish();
}

describe('the real swarm batch through the twin', () => {
  it('G4: the phase attribute follows the SIM clock: the same sim time writes the same bytes, a later one moves them', async () => {
    const { batch } = built();
    const phase = batch.rotors.geometry.getAttribute('aPhase') as THREE.BufferAttribute;
    frame(batch, 1.5, 12);
    const first = Array.from(phase.array);
    frame(batch, 1.5, 12);
    expect(Array.from(phase.array)).toEqual(first);
    frame(batch, 1.6, 12);
    expect(Array.from(phase.array)).not.toEqual(first);
  });

  it('G5: rotors.visible is re-derived every frame, and the node census never hides a ported blur', async () => {
    const { batch, scene } = built();
    expect(adoptMaterials(scene, await fxKit(), createTwinCache())).toBe(1);
    expect(batch.rotors.material).not.toBe((batch as unknown as { rotorMaterial: THREE.Material }).rotorMaterial);
    // An empty frame (nothing drawn: not visible), then live frames (visible), with the census between every one.
    for (let i = 0; i < 6; i++) {
      if (i === 0) {
        batch.beginFrame(env(1));
        batch.finish();
      } else {
        frame(batch, 1 + i * 0.05, 12);
      }
      expect(censusUnported(scene), `frame ${i}`).toEqual([]);
      expect(batch.rotors.visible, `frame ${i}`).toBe(i > 0);
    }
  });

  it('G5 control: with the rotor slot empty the census hides the blur', async () => {
    const { batch, scene } = built();
    adoptMaterials(scene, { ...(await fxKit()), rotor: null }, createTwinCache());
    frame(batch, 1, 12);
    expect(batch.rotors.visible).toBe(true);
    censusUnported(scene);
    expect(batch.rotors.visible).toBe(false);
  });
});
