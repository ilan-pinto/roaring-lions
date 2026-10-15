// tools/src/support-rings-cvd.test.ts
//
// S-F Task 1: the fire-support rings and marks stay separable under simulated
// colour-vision deficiency.
//
//   * the barrage's two ring tones (`vfx.fire` outer, `vfx.ember` inner);
//   * the smoke screen's ring (`limestone.0`) against the strike's (`vfx.fire`);
//   * each new mark's accent against its main: the barrage's `vfx.ember` on
//     `team.hostile_text`, the smoke screen's `gunmetal.1` on `limestone.0`.
//
// The ring keys are NOT restated here: they are read off `aimRingSpecs`, the
// function the renderer draws from, so repainting a ring turns this red. The
// marks' families are the approved mock's (`support-marks-mock/proposal.md`);
// the smoke order sight's own accent is read off `ORDER_SIGHT`.
//
// FLOOR is the just-noticeable difference the repo already uses (D-22, 2.3
// CIE76) -- the same floor as `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md`
// quotes. It is a floor, not a target: the measured numbers are pinned beside
// it so a regression that stays above 2.3 but halves the margin is still visible.
// `team.hostile_text` follows the accessibility variant (`data-cvd`), so each
// deficiency is checked against the variant colour that setting selects, and
// the default colour too.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labDistance, simulate, type CvdKind } from './cvd';
import { aimRingSpecs } from '../../packages/render/src/three/units/overlays';
import { ORDER_SIGHT } from '../../packages/app/src/ui/order-sight';

const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8')) as {
  ramps: Record<string, { colors: string[] }>;
  reserved: Record<string, { colors: Record<string, string>; variants?: Record<string, Record<string, string>> }>;
};
const KINDS: readonly CvdKind[] = ['deuteranopia', 'protanopia', 'tritanopia'];
const FLOOR = 2.3;

function hex(key: string, variant?: CvdKind): string {
  const [band, name] = key.split('.');
  if (band in palette.ramps) return palette.ramps[band].colors[Number(name)];
  const r = palette.reserved[band];
  return (variant && r.variants?.[variant]?.[name]) || r.colors[name];
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
  barrageMarkAccent: { deuteranopia: 19.19, protanopia: 22, tritanopia: 14.73 },
  smokeMarkAccent: { deuteranopia: 33.59, protanopia: 32.1, tritanopia: 32.88 },
};

describe('the aim rings read the keys the mock approved', () => {
  it('barrage outer vfx.fire, inner vfx.ember; smoke limestone.0; strike vfx.fire', () => {
    expect([outerKey, innerKey, smokeKey, strikeKey]).toEqual(['vfx.fire', 'vfx.ember', 'limestone.0', 'vfx.fire']);
  });
});

describe('support rings and marks under simulated colour-vision deficiency', () => {
  const measured: Record<string, Record<string, number>> = {
    barrageOuterVsInner: {}, smokeVsStrike: {}, barrageMarkAccent: {}, smokeMarkAccent: {},
  };
  for (const k of KINDS) {
    measured.barrageOuterVsInner[k] = r2(dE(hex(outerKey), hex(innerKey), k));
    measured.smokeVsStrike[k] = r2(dE(hex(smokeKey), hex(strikeKey), k));
    // The barrage's main is team.hostile_text, which follows the variant `data-cvd` picks.
    measured.barrageMarkAccent[k] = r2(dE(hex('team.hostile_text', k), hex('vfx.ember'), k));
    measured.smokeMarkAccent[k] = r2(dE(hex(ORDER_SIGHT.smoke.main), hex(ORDER_SIGHT.smoke.accent), k));
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

  it('the default hostile_text is also apart from vfx.ember under every deficiency (a player on the default set)', () => {
    for (const k of KINDS) expect(dE(hex('team.hostile_text'), hex('vfx.ember'), k), k).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the smoke mark reads the family keys the mock named (limestone.0 over gunmetal.1)', () => {
    expect([ORDER_SIGHT.smoke.main, ORDER_SIGHT.smoke.accent]).toEqual(['limestone.0', 'gunmetal.1']);
  });
});
