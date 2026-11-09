/**
 * Look uplift L2 (GH-943): the readability gate for a colour grade -- the instrument, not a test.
 *
 * Spec `docs/superpowers/specs/2026-11-01-look-uplift-design.md` section 3 ("Risks") and section 8:
 * a grade can undo the readability work (team colours, CVD variants). This is a TOOL gate, not an
 * approval step: team colours must stay inside a colour-difference floor under each grade, and one
 * that collapses is REFUSED, not tuned.
 *
 * What it measures. For each team-colour set the game can draw (the default and the three CVD variants
 * of `data/palette.json`'s `reserved.team`), each pair of {kedem, hostile, neutral} is run through the
 * grade (the very `gradeColor` the renderer bakes into its LUT: `packages/render/src/three/grade-maths.ts`),
 * at three brightnesses (a team band is lit and shaded: 0.5, 0.75 and 1.0 of its swatch), and the CIE76
 * delta E between the two graded colours is taken -- under the Machado simulation of the set's OWN kind
 * for a CVD variant (what that player sees), and plainly for the default (normal vision). That worst
 * pair per (set, level) is `worstPair`.
 *
 * The rule (`teamColourFailures`):
 *  - if the UNGRADED worst pair cleared `FLOOR` (25, the floor `cvd.test.ts` holds the palette to), the
 *    graded one must still clear it: a grade may not take a pair that read as different colours under
 *    the line;
 *  - if the ungraded pair was already under `FLOOR` (a shaded deuteranopia pair is 18.7 at 0.5), the
 *    graded one must keep `KEEP` (90%) of what it had: a grade may not make a weak pair weaker.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { labDistance, simulate, type CvdKind } from './cvd';
import { gradeColor, resolveGrade, type GradeJson, type Rgb } from '../../packages/render/src/three/grade-maths';

export const FLOOR = 25;
export const KEEP = 0.9;
export const LEVELS = [0.5, 0.75, 1] as const;

const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8')) as {
  reserved: { team: { colors: Record<string, string>; variants: Record<CvdKind, Record<string, string>> } };
};

export interface TeamSet {
  readonly name: string;
  readonly colors: Record<string, string>;
  /** The CVD kind a player on this set would be simulated under, or null for normal vision. */
  readonly kind: CvdKind | null;
}

export const TEAM_SETS: readonly TeamSet[] = [
  { name: 'default', colors: palette.reserved.team.colors, kind: null },
  { name: 'deuteranopia', colors: palette.reserved.team.variants.deuteranopia, kind: 'deuteranopia' },
  { name: 'protanopia', colors: palette.reserved.team.variants.protanopia, kind: 'protanopia' },
  { name: 'tritanopia', colors: palette.reserved.team.variants.tritanopia, kind: 'tritanopia' },
];

const PAIRS: readonly (readonly [string, string])[] = [
  ['kedem', 'hostile'],
  ['kedem', 'neutral'],
  ['hostile', 'neutral'],
];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;
const toHex = (c: Rgb): string =>
  '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** CIE76 delta E between two hex colours as `kind` (or normal vision) sees them. */
function seen(a: string, b: string, kind: CvdKind | null): number {
  return kind === null
    ? labDistance(toRgb(a).map(srgbToLinear) as unknown as Rgb, toRgb(b).map(srgbToLinear) as unknown as Rgb)
    : labDistance(simulate(a, kind), simulate(b, kind));
}

/** The closest of the three team pairs in `set` at brightness `level`, through `map` (identity for "ungraded"). */
export function worstPair(set: TeamSet, level: number, map: (c: Rgb) => Rgb): { delta: number; pair: string } {
  const shown: Record<string, string> = {};
  for (const [name, hex] of Object.entries(set.colors)) {
    if (name === 'hostile_text') continue;
    shown[name] = toHex(map(toRgb(hex).map((v) => v * level) as unknown as Rgb));
  }
  let worst = { delta: Infinity, pair: '' };
  for (const [a, b] of PAIRS) {
    const delta = seen(shown[a], shown[b], set.kind);
    if (delta < worst.delta) worst = { delta, pair: `${a}/${b}` };
  }
  return worst;
}

/** Every way `grade` at `strength` breaks the rule above. Empty is a pass. */
export function teamColourFailures(grade: GradeJson, strength = 1): string[] {
  const resolved = resolveGrade(grade, strength);
  const failures: string[] = [];
  for (const set of TEAM_SETS) {
    for (const level of LEVELS) {
      const before = worstPair(set, level, (c) => c);
      const after = worstPair(set, level, (c) => gradeColor(c, resolved));
      const need = before.delta >= FLOOR ? FLOOR : before.delta * KEEP;
      if (after.delta < need) {
        failures.push(
          `${grade.id}@${strength} ${set.name} level ${level}: ${after.pair} falls to delta E ${after.delta.toFixed(1)} ` +
            `(ungraded ${before.delta.toFixed(1)} at ${before.pair}); needs ${need.toFixed(1)}`
        );
      }
    }
  }
  return failures;
}

/** Every grade file on disk, read from the DIRECTORY (not the registry): a file that ships unregistered is still gated. */
export function gradesOnDisk(): GradeJson[] {
  const dir = new URL('../../data/grades/', import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as GradeJson);
}
