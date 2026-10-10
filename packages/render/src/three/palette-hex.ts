/**
 * The one way render code names a palette colour it needs BEFORE a caller's
 * `resolveColor` exists: a fallback, a default, a module-load constant.
 *
 * It reads `data/palette.json` directly, the way `terrain/tones.ts` does, since
 * `@lions/render` must not import `@lions/data` (eslint's bundle rule). Same
 * file, no second parser, no transcribed copy: before this, about twenty hex
 * literals in `lighting.ts`, `time-of-day.ts`, `fog-pass.ts`, `smoke-mesh.ts`,
 * `buildings.ts`, `silhouette.ts` and `units/overlays.ts` each restated one
 * palette entry "as of" some date, and a palette revision reached none of them
 * (visual register VR-08).
 *
 * An unknown key THROWS. A fallback that quietly resolves to magenta is an
 * invented colour wearing a palette key's name, which is exactly what this
 * module exists to stop, and throwing at module load turns a typo or a renamed
 * entry into a failing import rather than a wrong pixel.
 */
import paletteJson from '../../../../data/palette.json';

const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;
const reserved = paletteJson.reserved as Record<string, { colors: Record<string, string> }>;

/** `'limestone.0'`, `'vfx.fire'`, `'team.hostile'` -> the palette's own hex
 *  string, exactly as `data/palette.json` spells it. */
export function paletteHex(key: string): string {
  const dot = key.indexOf('.');
  const band = key.slice(0, dot);
  const name = key.slice(dot + 1);
  const hex = band in ramps ? ramps[band].colors[Number(name)] : band in reserved ? reserved[band].colors[name] : undefined;
  if (hex === undefined) throw new Error(`palette-hex: no palette entry "${key}" in data/palette.json`);
  return hex;
}
