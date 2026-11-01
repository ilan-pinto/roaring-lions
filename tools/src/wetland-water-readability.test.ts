/**
 * GH-871 P4 T3: the water the wetland draws must read against the KDF uniform,
 * and must read as water against the mud beside it.
 *
 * The proxy is the spec's section 4.2 / 4.3 formula in LINEAR light:
 * `water = (1 - R) x 0.55 x floor + R x overcast.0`, where `floor` is the mud
 * the water lies over and `R` the authored reflectance (R-5). It is an albedo
 * proxy, not the shader: the shader mixes toward the sky SCENE-REFERRED
 * (Task 4), and the lit figure differs. What this pins is the A/B's frame.
 *
 * Two floors, because there are two waters: `mud.1` under the road puddles,
 * `mud.2` (the marsh floor since the S-6 round) under the marsh. Three
 * reflectances, because the reflectance is the lead's to choose at S-L1
 * (0.20 and 0.25 against 0.35).
 *
 * Every number below is a LITERAL, recomputed here from the repo's own
 * CIEDE2000 (`delta-e2000.ts`) when this file was written, never imported
 * from the code under test. The floor is the one `wetland-readability.test.ts`
 * holds the open ground to: 15.6 against `olive.1`.
 *
 * The luminance ratio is water over its bare floor, Rec. 709 on linear RGB.
 * On `mud.1` it is 1.47 / 1.70 / 2.16 (the spec's figures, from track
 * puddles). On the lifted marsh floor `mud.2` it is 2.18 / 2.59 / 3.40: above
 * the spec's 1.5-2x band at EVERY reflectance, which is why the puddles and
 * the marsh get one reflectance uniform each.
 */
import { describe, expect, it } from 'vitest';
import { deltaE2000, linearHex } from './delta-e2000';

/** `olive.1`, the KDF rifleman's lit albedo. */
const KDF_UNIFORM_HEX = '#6E7449';
/** `overcast.0`, the sky the water mirrors. */
const OVERCAST_0_HEX = '#C4C8C9';
const MIN_WATER_VS_KDF_DE2000 = 15.6;
/** The wet tone's albedo factor (spec 4.3). */
const WET_ALBEDO = 0.55;

type Rgb = readonly [number, number, number];
const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The water proxy over `floorHex` at reflectance `R`, in linear RGB. */
function water(floorHex: string, reflectance: number, wetAlbedo: number = WET_ALBEDO): Rgb {
  const floor = linearHex(floorHex);
  const sky = linearHex(OVERCAST_0_HEX);
  return [0, 1, 2].map((k) => (1 - reflectance) * wetAlbedo * floor[k] + reflectance * sky[k]) as unknown as Rgb;
}

const CASES: ReadonlyArray<{
  readonly floor: string;
  readonly name: string;
  readonly rows: ReadonlyArray<{ readonly r: number; readonly dE: number; readonly lum: number }>;
}> = [
  {
    floor: '#725944',
    name: 'mud.1 (road puddles)',
    rows: [
      { r: 0.2, dE: 16.61, lum: 1.47 },
      { r: 0.25, dE: 16.79, lum: 1.7 },
      { r: 0.35, dE: 18.47, lum: 2.16 },
    ],
  },
  {
    floor: '#584535',
    name: 'mud.2 (the marsh floor)',
    rows: [
      { r: 0.2, dE: 16.55, lum: 2.18 },
      { r: 0.25, dE: 16.32, lum: 2.59 },
      { r: 0.35, dE: 17.71, lum: 3.4 },
    ],
  },
];

describe('the water proxy against the KDF uniform and the mud beside it (GH-871 P4 T3)', () => {
  for (const c of CASES) {
    for (const row of c.rows) {
      it(`${c.name} at R ${row.r}: dE2000 ${row.dE} from olive.1 (floor ${MIN_WATER_VS_KDF_DE2000}), ${row.lum}x its bare floor`, () => {
        const w = water(c.floor, row.r);
        const d = deltaE2000(linearHex(KDF_UNIFORM_HEX), w);
        expect(d, `water over ${c.floor} at R ${row.r}: dE2000 ${d.toFixed(2)}`).toBeGreaterThanOrEqual(
          MIN_WATER_VS_KDF_DE2000
        );
        expect(d).toBeCloseTo(row.dE, 1);
        const ratio = luminance(w) / luminance(linearHex(c.floor));
        expect(ratio).toBeCloseTo(row.lum, 2);
      });
    }
  }

  it('reads water as brighter than its floor at every reflectance, on both floors', () => {
    for (const c of CASES) for (const row of c.rows) expect(row.lum).toBeGreaterThan(1.4);
  });

  it('the instrument is live: it reads wet mud with no sky at 0.55 of its luminance, and refuses scrub.0', () => {
    // R = 0 is a wet mud, not water: 0.55 x floor is 0.55 of its luminance.
    const wet = water('#725944', 0);
    expect(luminance(wet) / luminance(linearHex('#725944'))).toBeCloseTo(0.55, 2);
    // The ruler's far end, as a literal (the open-ground guard's figure): scrub.0 reads 9.81, under the floor.
    expect(deltaE2000(linearHex(KDF_UNIFORM_HEX), linearHex('#6B8A4A'))).toBeCloseTo(9.81, 1);
    expect(deltaE2000(linearHex(KDF_UNIFORM_HEX), linearHex('#6B8A4A'))).toBeLessThan(MIN_WATER_VS_KDF_DE2000);
  });
});
