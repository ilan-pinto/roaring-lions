/**
 * E6 (GH-274) chunk C: the beam batch's geometry, through the real dimetric camera.
 *
 * The widths are the claim that matters (a world-unit width vanishes zoomed out and becomes a
 * pipe zoomed in), so they are measured the way a player would: project the quad's corners to
 * pixels with `camera.ts`'s own `dimetricCamera` and measure the gap. Draw calls are
 * `beam-drawcalls.test.ts`. Every assertion was verified by mutating the line it pins and watching
 * it go red; the list is in the commit message.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dimetricCamera } from '../camera';
import { hexToLinear } from '../terrain/shared';
import { paletteHex } from '../palette-hex';
import { BEAM_CAPACITY, BEAM_QUADS_PER_BEAM, BeamBatch, vehicleMuzzleOf, type BeamDraw } from './beam-batch';
import { newBeamLook, newBeamLookState, stepBeamLook, type BeamLook } from './beam-look';

const VP = { width: 1400, height: 900 };

function look(over: Partial<BeamLook> = {}): BeamLook {
  const l = stepBeamLook(newBeamLookState(), {
    target: 3, dwell: 31, locked: false, dwellTicks: 30, alpha: 0, nowMs: 5000, struckAtMs: null, lockout: false,
  }, newBeamLook());
  return Object.assign(l, over);
}

function draw(over: Partial<BeamDraw> = {}): BeamDraw {
  return { ox: 10, oy: 1.5, oz: 10, ex: 14, ey: 0.4, ez: 12, look: look(), ...over };
}

function batch(): BeamBatch {
  const b = new BeamBatch(new THREE.Scene());
  b.setColors(paletteHex('vfx.white_hot'), paletteHex('vfx.ember'));
  return b;
}

const attr = (b: BeamBatch, name: string): THREE.BufferAttribute => b.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;

/** The two corners of a ribbon's ORIGIN edge (vertices 0 and 1 of quad `q`), in screen pixels. */
function originEdgePx(b: BeamBatch, q: number, zoom: number): number {
  const cam = dimetricCamera({ x: 12, y: 11, zoom }, VP);
  const pos = attr(b, 'position');
  const px = (v: number): THREE.Vector2 => {
    const p = new THREE.Vector3().fromBufferAttribute(pos, q * 4 + v).project(cam);
    return new THREE.Vector2(((p.x + 1) / 2) * VP.width, ((1 - p.y) / 2) * VP.height);
  };
  return px(0).distanceTo(px(1));
}

const SHEATH = 0;
const LENS = 1;
const TARGET = 2;
const CENTRE = 3;
const CORE = 4;

describe('widths are constant in SCREEN pixels at any zoom', () => {
  it.each([0.35, 0.7, 1, 1.8, 2.5])('zoom %f: the focused sheath is 3 px wide and the core 1.2 px', (zoom) => {
    const b = batch();
    b.beginFrame(zoom);
    expect(b.add(draw())).toBe(true);
    b.finish();
    // dwell 31 of 30 is full focus: 3 px. The perpendicular is exact; the projected gap of the
    // strip's two origin corners is its width because the strip faces the camera.
    expect(originEdgePx(b, SHEATH, zoom)).toBeCloseTo(3, 3);
    expect(originEdgePx(b, CORE, zoom)).toBeCloseTo(1.2, 3);
  });

  it('an unfocused sheath is 6 px, and a pulsed core 2.4 px', () => {
    const b = batch();
    b.beginFrame(1);
    b.add(draw({ look: look({ sheathPx: 6, corePx: 2.4 }) }));
    b.finish();
    expect(originEdgePx(b, SHEATH, 1)).toBeCloseTo(6, 3);
    expect(originEdgePx(b, CORE, 1)).toBeCloseTo(2.4, 3);
  });

  it('holds for a beam pointing straight along the view (the degenerate cross product)', () => {
    const b = batch();
    b.beginFrame(1);
    // VIEW_DIRECTION is (1, ~1.4, 1)-ish toward the camera: a beam along it has no screen length.
    b.add(draw({ ox: 10, oy: 0, oz: 10, ex: 10.5, ey: 0.7, ez: 10.5 }));
    b.finish();
    const pos = attr(b, 'position');
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
    }
  });
});

describe('endpoints', () => {
  it('the ribbons run from the origin to the end, the glows sit on them', () => {
    const b = batch();
    b.beginFrame(1);
    b.add(draw());
    b.finish();
    const pos = attr(b, 'position');
    const mid = (q: number, a: number, c: number): THREE.Vector3 =>
      new THREE.Vector3()
        .fromBufferAttribute(pos, q * 4 + a)
        .add(new THREE.Vector3().fromBufferAttribute(pos, q * 4 + c))
        .multiplyScalar(0.5);
    for (const q of [SHEATH, CORE]) {
      expect(mid(q, 0, 1).distanceTo(new THREE.Vector3(10, 1.5, 10))).toBeLessThan(1e-5);
      expect(mid(q, 2, 3).distanceTo(new THREE.Vector3(14, 0.4, 12))).toBeLessThan(1e-5);
    }
    // A disc's centre is the mean of its corners (the diagonals of a billboard square).
    expect(mid(LENS, 0, 2).distanceTo(new THREE.Vector3(10, 1.5, 10))).toBeLessThan(1e-5);
    expect(mid(TARGET, 0, 2).distanceTo(new THREE.Vector3(14, 0.4, 12))).toBeLessThan(1e-5);
    expect(mid(CENTRE, 0, 2).distanceTo(new THREE.Vector3(14, 0.4, 12))).toBeLessThan(1e-5);
  });

  it('the glows are world-sized (tiles) and the target centre is half its glow', () => {
    const b = batch();
    b.beginFrame(1);
    b.add(draw({ look: look({ lensGlowTiles: 0.18, targetGlowTiles: 0.12 }) }));
    b.finish();
    const pos = attr(b, 'position');
    const span = (q: number): number =>
      new THREE.Vector3().fromBufferAttribute(pos, q * 4 + 0).distanceTo(new THREE.Vector3().fromBufferAttribute(pos, q * 4 + 2));
    // The diagonal of a (2r x 2r) square is 2r * sqrt 2.
    expect(span(LENS)).toBeCloseTo(2 * 0.18 * Math.SQRT2, 5);
    expect(span(TARGET)).toBeCloseTo(2 * 0.12 * Math.SQRT2, 5);
    expect(span(CENTRE)).toBeCloseTo(0.12 * Math.SQRT2, 5);
  });
});

describe('colour', () => {
  it('writes LINEAR palette colours times the bloom gains: white_hot core, ember sheath', () => {
    const b = batch();
    b.beginFrame(1);
    b.add(draw());
    b.finish();
    const col = attr(b, 'aColor');
    const hot = hexToLinear(paletteHex('vfx.white_hot'));
    const ember = hexToLinear(paletteHex('vfx.ember'));
    const at = (q: number): number[] => [col.getX(q * 4), col.getY(q * 4), col.getZ(q * 4)];
    // Literals from the HDR table (beamCore 4, beamSheath 1.6, beamGlow 2.4).
    expect(at(CORE)).toEqual(hot.map((c) => Math.fround(c * 4)));
    expect(at(SHEATH)).toEqual(ember.map((c) => Math.fround(c * 1.6)));
    expect(at(TARGET)).toEqual(ember.map((c) => Math.fround(c * 2.4)));
    expect(at(CENTRE)).toEqual(hot.map((c) => Math.fround(c * 2.4)));
    expect(at(LENS)).toEqual(ember.map((c) => Math.fround(c * 2.4)));
  });

  it('carries each part\'s alpha from the look', () => {
    const b = batch();
    b.beginFrame(1);
    b.add(draw({ look: look({ sheathAlpha: 0.6, coreAlpha: 0.9, lensGlowAlpha: 0.3, targetGlowAlpha: 0.8 }) }));
    b.finish();
    const a = attr(b, 'aAlpha');
    expect(a.getX(SHEATH * 4)).toBeCloseTo(0.6, 6);
    expect(a.getX(CORE * 4)).toBeCloseTo(0.9, 6);
    expect(a.getX(LENS * 4)).toBeCloseTo(0.3, 6);
    expect(a.getX(TARGET * 4)).toBeCloseTo(0.8, 6);
  });
});

describe('a lens glow on its own (the beam has broken, the glow fades)', () => {
  it('draws the lens and nothing else', () => {
    const b = batch();
    b.beginFrame(1);
    b.add(draw({ look: look({ ribbon: false, lens: true, lensGlowAlpha: 0.5 }) }));
    b.finish();
    const a = attr(b, 'aAlpha');
    expect(a.getX(LENS * 4)).toBeCloseTo(0.5, 6);
    for (const q of [SHEATH, TARGET, CENTRE, CORE]) expect(a.getX(q * 4)).toBe(0);
  });
});

describe('capacity, visibility and the debug flag', () => {
  it('carries 16 beams and refuses the 17th', () => {
    const b = batch();
    b.beginFrame(1);
    for (let i = 0; i < BEAM_CAPACITY; i++) expect(b.add(draw({ ox: i }))).toBe(true);
    expect(b.add(draw())).toBe(false);
    b.finish();
    expect(b.count).toBe(16);
    expect(b.mesh.geometry.drawRange.count).toBe(16 * BEAM_QUADS_PER_BEAM * 6);
  });

  it('is invisible (0 draws) when empty, visible with a beam, and invisible again next frame', () => {
    const b = batch();
    b.beginFrame(1);
    b.finish();
    expect(b.mesh.visible).toBe(false);
    b.beginFrame(1);
    b.add(draw());
    b.finish();
    expect(b.mesh.visible).toBe(true);
    b.beginFrame(1);
    b.finish();
    expect(b.mesh.visible).toBe(false);
    expect(b.mesh.geometry.drawRange.count).toBe(0);
  });

  it('the debug flag holds across later frames (finish re-derives visible every frame)', () => {
    const b = batch();
    b.setDebugHidden(true);
    for (let i = 0; i < 3; i++) {
      b.beginFrame(1);
      b.add(draw());
      b.finish();
      expect(b.mesh.visible).toBe(false);
    }
    b.setDebugHidden(false);
    b.beginFrame(1);
    b.add(draw());
    b.finish();
    expect(b.mesh.visible).toBe(true);
  });
});

describe('the material', () => {
  it('is the bolt\'s look: transparent, depth-tested, not depth-writing, normal blending, band 2', () => {
    const b = batch();
    const m = b.mesh.material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.NormalBlending);
    expect(b.mesh.renderOrder).toBe(2);
    expect(b.mesh.castShadow).toBe(false);
    expect(b.mesh.frustumCulled).toBe(false);
  });
});

describe('vehicleMuzzleOf', () => {
  it('reads rl_fire.muzzle off the template extras, and null when there is none', () => {
    expect(vehicleMuzzleOf({ rl_fire: { muzzle: [0.83, 0.575, 0] } }, 'x.glb')).toEqual([0.83, 0.575, 0]);
    expect(vehicleMuzzleOf({}, 'x.glb')).toBeNull();
    expect(vehicleMuzzleOf({ rl_fire: { backblast: [0, 0, 0] } }, 'x.glb')).toBeNull();
  });
});
