/**
 * The module graph `pnpm audio:mix` serves to its stub page (audio plan AU-4).
 *
 * The mix check type-strips `packages/render/src/audio.ts` and serves it at
 * `http://mix.test/audio.js`, where a browser resolves its imports as URLs: a
 * bare `@lions/sim` or an extensionless `./radio` fails the whole module with
 * `Failed to fetch dynamically imported module`. This file is the one place
 * that maps each import specifier to the URL the harness routes, and it
 * THROWS on any specifier it does not know -- so a new import in audio.ts is
 * a red unit test in node, not a browser failure found by CI's `gates` job.
 */

/** Every specifier audio.ts may import, and the served path it becomes. */
export const AUDIO_IMPORT_MAP: Readonly<Record<string, string>> = {
  '@lions/sim': './sim.js',
  './radio': './radio.js',
  './relation': './relation.js',
  // GH-35: the engine voices. Imports only a TYPE from @lions/sim, which the
  // type-strip removes; the mix scenes play no engines (no `updateEngines`).
  './engines': './engines.js',
};

// `from '<spec>'` (import / re-export) and a bare side-effect `import '<spec>'`.
const SPECIFIER = /(\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\2/g;

/**
 * Rewrites the import specifiers of type-stripped JavaScript to the served
 * paths in {@link AUDIO_IMPORT_MAP}. Throws naming every specifier not in the
 * map (a relative or bare import the browser could not resolve).
 */
export function rewriteAudioImports(js: string, map: Readonly<Record<string, string>> = AUDIO_IMPORT_MAP): string {
  const unmapped: string[] = [];
  const out = js.replace(SPECIFIER, (whole, lead: string, quote: string, spec: string) => {
    const served = map[spec];
    if (served === undefined) {
      unmapped.push(spec);
      return whole;
    }
    return `${lead}${quote}${served}${quote}`;
  });
  if (unmapped.length > 0) {
    const names = [...new Set(unmapped)].map((s) => `'${s}'`).join(', ');
    throw new Error(
      `audio.ts imports ${names}, which the mix check does not serve: add it to AUDIO_IMPORT_MAP in tools/src/audio/mix-modules.ts ` +
        'and route its path in mix-check.ts, or the page fails with "Failed to fetch dynamically imported module".',
    );
  }
  return out;
}
