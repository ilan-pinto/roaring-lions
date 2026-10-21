// tools/src/support-rings-cvd.test.ts
//
// S-F Task 1: the fire-support aim rings stay separable under simulated
// colour-vision deficiency.
//
//   * the barrage's two ring tones (`vfx.fire` outer, `vfx.ember` inner);
//   * the smoke screen's ring (`limestone.0`) against the strike's (`vfx.fire`).
//
// The ring keys are NOT restated here: they are read off `aimRingSpecs`, the
// function the renderer draws from, so repainting a ring turns this red.
//
// S-F Task 2 adds the new marks' main-vs-accent pairs, read off `ORDER_SIGHT`
// (the table the HUD mark and the cursor plugin both draw from):
//
//   * the barrage's `team.hostile_text` main against its `vfx.ember` accent --
//     twice, because the main is a TEAM key and follows the player's
//     colour-vision setting: once at the default hex (a player who never
//     opened the setting) and once at the variant hex for that deficiency
//     (`reserved.team.variants`, what the plugin's per-variant rules draw);
//   * the smoke screen's `limestone.0` main against its `gunmetal.1` accent
//     (no team key, so one row).
//
// FLOOR is the just-noticeable difference the repo already uses (D-22, 2.3
// CIE76) -- the same floor as `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md`
// quotes. It is a floor, not a target: the measured numbers are pinned beside
// it so a regression that stays above 2.3 but halves the margin is still visible.
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

/** A key's hex, under `variant` when the band carries colour-vision
 *  variants for it (only `team` does), else its default. */
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
const barrage = ORDER_SIGHT.barrage;
const screen = ORDER_SIGHT.smokeScreen;

/** Measured 2026-10-15 (CIE76, Machado severity 1.0) and pinned to the cent. */
const PINNED = {
  barrageOuterVsInner: { deuteranopia: 21.9, protanopia: 33.87, tritanopia: 50.84 },
  smokeVsStrike: { deuteranopia: 58.57, protanopia: 61.6, tritanopia: 35.83 },
  // S-F Task 2, measured the same way. Tritanopia's team variant leaves
  // hostile_text at its default hex, so its two barrage rows agree.
  barrageMarkAccentVsMain: { deuteranopia: 19.41, protanopia: 22.82, tritanopia: 14.73 },
  barrageMarkAccentVsMainVariant: { deuteranopia: 19.19, protanopia: 22, tritanopia: 14.73 },
  smokeScreenMarkAccentVsMain: { deuteranopia: 33.59, protanopia: 32.1, tritanopia: 32.88 },
};

describe('the aim rings read the keys the mock approved', () => {
  it('barrage outer vfx.fire, inner vfx.ember; smoke limestone.0; strike vfx.fire', () => {
    expect([outerKey, innerKey, smokeKey, strikeKey]).toEqual(['vfx.fire', 'vfx.ember', 'limestone.0', 'vfx.fire']);
  });
});

describe('the new marks read the keys the mock approved (S-F Task 2)', () => {
  it('barrage team.hostile_text / vfx.ember; smoke screen limestone.0 / gunmetal.1', () => {
    expect([barrage.main, barrage.accent, screen.main, screen.accent]).toEqual([
      'team.hostile_text',
      'vfx.ember',
      'limestone.0',
      'gunmetal.1',
    ]);
  });
});

describe('support rings and marks under simulated colour-vision deficiency', () => {
  const measured: Record<string, Record<string, number>> = {
    barrageOuterVsInner: {},
    smokeVsStrike: {},
    barrageMarkAccentVsMain: {},
    barrageMarkAccentVsMainVariant: {},
    smokeScreenMarkAccentVsMain: {},
  };
  for (const k of KINDS) {
    measured.barrageOuterVsInner[k] = r2(dE(hex(outerKey), hex(innerKey), k));
    measured.smokeVsStrike[k] = r2(dE(hex(smokeKey), hex(strikeKey), k));
    measured.barrageMarkAccentVsMain[k] = r2(dE(hex(barrage.accent), hex(barrage.main), k));
    measured.barrageMarkAccentVsMainVariant[k] = r2(dE(hex(barrage.accent, k), hex(barrage.main, k), k));
    measured.smokeScreenMarkAccentVsMain[k] = r2(dE(hex(screen.accent), hex(screen.main), k));
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
