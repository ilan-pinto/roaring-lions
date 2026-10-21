/**
 * Field works (#277): the fixed eyes that are not entities, as a pure
 * function over plain arrays so the rules are provable without a renderer.
 *
 *  - A COMPLETE (`progress >= ONE`), living sensor structure the viewer owns
 *    sees from its centroid at its sensor sight.
 *  - A viewer's garrisoned unit in a COMPLETE, living structure of the
 *    viewer's whose aura carries a garrison sight bonus sees from the
 *    centroid at its own sight plus the bonus -- the sim's `garrisonAura`
 *    returns null while `progress !== ONE`, so an unfinished site gives none.
 *
 * Fog note (accepted): these reveal with line of sight in fog
 * (`computeFog`'s `revealFrom`), while the sim's sensor detection has no
 * line-of-sight test. The fog can therefore show slightly LESS than the
 * sensor detects behind a wall. Presentation only; nothing here reaches the
 * sim.
 */
export interface WorksAura {
  /** Sensor sight in tiles, or null when the aura has no sensor. */
  readonly sensorSight: number | null;
  /** Garrison sight bonus in tiles (0 = none). */
  readonly sightBonus: number;
}

export interface WorksObserverInput {
  readonly viewer: number;
  readonly structureCount: number;
  readonly alive: ArrayLike<number>;
  readonly owner: ArrayLike<number>;
  /** Structure progress, in the SAME unit as `complete`. */
  readonly progress: ArrayLike<number>;
  readonly complete: number;
  /** Centroid of structure `s`, in tiles. */
  readonly cx: (s: number) => number;
  readonly cy: (s: number) => number;
  /** The aura of structure `s`'s type, null when it has none. */
  readonly auraOf: (s: number) => WorksAura | null;
  /** The viewer's living garrisoned units: the structure each sits in and
   *  its own sight in tiles. */
  readonly garrisoned: readonly { readonly structure: number; readonly sight: number }[];
}

export function collectWorksObservers(
  input: WorksObserverInput
): { x: number; y: number; sight: number }[] | undefined {
  let out: { x: number; y: number; sight: number }[] | undefined;
  for (let s = 0; s < input.structureCount; s++) {
    if (input.alive[s] === 0 || input.owner[s] !== input.viewer) continue;
    if (input.progress[s] < input.complete) continue;
    const aura = input.auraOf(s);
    if (aura === null) continue;
    const x = input.cx(s);
    const y = input.cy(s);
    if (aura.sensorSight !== null) (out ??= []).push({ x, y, sight: aura.sensorSight });
    if (aura.sightBonus > 0) {
      for (const g of input.garrisoned) {
        if (g.structure === s) (out ??= []).push({ x, y, sight: g.sight + aura.sightBonus });
      }
    }
  }
  return out;
}
