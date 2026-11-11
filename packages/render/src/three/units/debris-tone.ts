/**
 * GH-1197 P2: what colour shell debris is (the coordinator's ruling Q2, 9 Nov).
 *
 * Debris takes the colour of the GROUND it lands on, through the theme's own
 * palette ramp: the ground under the landing is a palette entry (the terrain
 * builder quantises every tile tone to one, `terrain/tones.ts`), so its key is
 * found in `data/palette.json` and stepped along its own ramp. Ramps DESCEND in
 * brightness (a higher index is darker): a clod is one step LIGHTER than the
 * ground (dry soil thrown up, the dust), a chunk one or two steps DARKER (the
 * broken surface), and a charred chunk `gunmetal.2`. A basalt map therefore
 * throws near-black debris and a limestone map pale debris, with no theme
 * table (the levant-terrain skill). A tone with no palette key falls back to
 * the map's `open` tone, and that to `dust.2`.
 *
 * Keys only here; the pool resolves them through `hexToLinear`.
 */
import paletteJson from '../../../../../data/palette.json';

const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;

/** The fallback when neither the ground nor the theme's open tone is a palette entry. */
export const DEBRIS_FALLBACK_KEY = 'dust.2';
/** A charred chunk (the design's §3). */
export const DEBRIS_CHARRED_KEY = 'gunmetal.2';

let reverse: Map<string, string> | null = null;

/** The palette key of a ramp hex (`'#C8B494'` -> `'limestone.3'`), case-insensitive; the first ramp in
 *  `data/palette.json`'s order wins a tie. Null for a hex no ramp holds. */
export function paletteKeyOfHex(hex: string): string | null {
  if (reverse === null) {
    reverse = new Map();
    for (const [name, ramp] of Object.entries(ramps)) {
      ramp.colors.forEach((c, i) => {
        const k = c.toUpperCase();
        if (!reverse!.has(k)) reverse!.set(k, `${name}.${i}`);
      });
    }
  }
  return reverse.get(hex.toUpperCase()) ?? null;
}

/** `key` moved `steps` along its own ramp (+ darker), clamped to the ramp. */
export function rampStep(key: string, steps: number): string {
  const dot = key.indexOf('.');
  const name = key.slice(0, dot);
  const ramp = ramps[name];
  if (ramp === undefined) return key;
  const i = Math.min(ramp.colors.length - 1, Math.max(0, Number(key.slice(dot + 1)) + steps));
  return `${name}.${i}`;
}

/** The debris palette of a landing on ground `groundHex`: one clod key and two chunk keys. */
export interface DebrisKeys {
  readonly clod: string;
  readonly chunks: readonly [string, string];
  readonly charred: string;
}

export function debrisKeysFor(groundHex: string, openHex: string): DebrisKeys {
  const ground = paletteKeyOfHex(groundHex) ?? paletteKeyOfHex(openHex) ?? DEBRIS_FALLBACK_KEY;
  return { clod: rampStep(ground, -1), chunks: [rampStep(ground, 1), rampStep(ground, 2)], charred: DEBRIS_CHARRED_KEY };
}
