// tools/src/support-rings-cvd.test.ts
//
// S-F Task 1: the fire-support aim rings stay separable under simulated
// colour-vision deficiency.
//
//   * the barrage's two ring tones (`vfx.fire` outer, `vfx.ember` inner);
//   * the smoke screen's ring (`limestone.0`) against the strike's (`vfx.fire`).
//
// The ring keys are NOT restated here: they are read off `aimRingSpecs`, the
// function the renderer draws from, so repainting a ring turns this red. The
// new marks' main-vs-accent pairs are Task 2's, wired to the marks they judge.
//
// FLOOR is the just-noticeable difference the repo already uses (D-22, 2.3
// CIE76) -- the same floor as `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md`
// quotes. It is a floor, not a target: the measured numbers are pinned beside
// it so a regression that stays above 2.3 but halves the margin is still visible.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labDistance, simulate, type CvdKind } from './cvd';
import { aimRingSpecs } from '../../packages/render/src/three/units/overlays';

const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8')) as {
  ramps: Record<string, { colors: string[] }>;
  reserved: Record<string, { colors: Record<string, string> }>;
};
const KINDS: readonly CvdKind[] = ['deuteranopia', 'protanopia', 'tritanopia'];
const FLOOR = 2.3;

function hex(key: string): string {
  const [band, name] = key.split('.');
  if (band in palette.ramps) return palette.ramps[band].colors[Number(name)];
  const r = palette.reserved[band];
  return r.colors[name];
}
const dE = (a: string, b: string, k: CvdKind): number => labDistance(simulate(a, k), simulate(b, k));
const r2 = (n: number): number => Math.round(n * 100) / 100;

const outerKey = aimRingSpecs('barrage', 2.5, 1.5)[0].colorKey;
const innerKey = aimRingSpecs('barrage', 2.5, 1.5)[1].colorKey;
const smokeKey = aimRingSpecs('smoke', 4.5, undefined)[0].colorKey;
const strikeKey = aimRingSpecs('strike', 2, undefined)[0].colorKey;

/** Measured 2026-10-15 (CIE76, Machado severity 1.0) and pinned to the cent. */
const PINNED = {
  barrageOuterVsInner: { deuteranopia: 21.9, protanopia: 33.87, tritanopia: 50.84 },
  smokeVsStrike: { deuteranopia: 58.57, protanopia: 61.6, tritanopia: 35.83 },
};

describe('the aim rings read the keys the mock approved', () => {
  it('barrage outer vfx.fire, inner vfx.ember; smoke limestone.0; strike vfx.fire', () => {
    expect([outerKey, innerKey, smokeKey, strikeKey]).toEqual(['vfx.fire', 'vfx.ember', 'limestone.0', 'vfx.fire']);
  });
});

describe('support rings under simulated colour-vision deficiency', () => {
  const measured: Record<string, Record<string, number>> = {
    barrageOuterVsInner: {}, smokeVsStrike: {},
  };
  for (const k of KINDS) {
    measured.barrageOuterVsInner[k] = r2(dE(hex(outerKey), hex(innerKey), k));
    measured.smokeVsStrike[k] = r2(dE(hex(smokeKey), hex(strikeKey), k));
  }

  for (const [name, row] of Object.entries(measured)) {
    for (const k of KINDS) {
      it(`${name} stays apart under ${k}: ΔE ≥ ${FLOOR}`, () => {
        expect(row[k], `${name}/${k}`).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }

  it('the measured values are pinned', () => {
    expect(measured).toEqual(PINNED);
  });
});
