/**
 * The A4 readability numbers (GH-186, spec 2026-09-28 sec 3). Numbers only:
 * every later task imports from here and retypes nothing. Approved at gate
 * G-NUM on 29 Sep.
 *
 * `radiusTiles` is the OUTER edge of the ring core. The rule is
 * `max(class value, 1.15 x measured half-diagonal of the class's largest
 * GLB footprint)`; `tools/src/perf/unit-footprints.ts` measures, and a row here
 * is raised (never lowered) when the measurement demands it.
 */

export type RingClass = 'foot' | 'light' | 'armour' | 'air';

/** isAir first, then wheeled && isSoft -> light, wheeled -> armour, else foot. */
export function ringClassOf(t: { isAir: boolean; wheeled: boolean; isSoft: boolean }): RingClass {
  if (t.isAir) return 'air';
  if (t.wheeled) return t.isSoft ? 'light' : 'armour';
  return 'foot';
}

export const SELECTION_RING = {
  // Raised from the spec's 0.45 / 0.55 / 0.70 / 0.35 by the measured rule
  // (tools/src/perf/unit-footprints.ts, 1.15 x largest half-diagonal, rounded UP
  // to 0.01): foot <- sniper_team, light <- rocket_battery, armour <- ifv_namer,
  // air <- heli_peten. dozer_d9 (a tracked hull the sim classes foot) is excluded
  // from the foot maximum and reported instead.
  radiusTiles: { foot: 0.58, light: 1.16, armour: 1.6, air: 1.21 },
  thicknessTiles: 0.06,
  /** Screen-pixel floor on the thickness (holds at the 0.35 zoom clamp). */
  minThicknessPx: 1.5,
  featherTiles: 0.015,
  coreAlpha: 0.9,
  /** Outside the core only. */
  haloTiles: 0.03,
  /** 0 means off (Q4). */
  haloAlpha: 0.35,
  capacity: 256,
} as const satisfies {
  radiusTiles: Readonly<Record<RingClass, number>>;
  thicknessTiles: number;
  minThicknessPx: number;
  featherTiles: number;
  coreAlpha: number;
  haloTiles: number;
  haloAlpha: number;
  capacity: number;
};

export const HP_BAR = { widthPx: 24, heightPx: 3, framePx: 1, frameAlpha: 0.8 } as const;
