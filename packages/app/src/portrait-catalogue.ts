/**
 * Portrait art for the commander bar's two named voices (GDD §11).
 *
 * `commander.json` names a portrait by its plain FILE NAME under
 * `assets/ui/portraits/` -- data, not a URL. Splitting it this way is
 * `mesh-catalogue.ts`'s own "paths are data, URLs are a function" rule,
 * repeated for the same reason: `campaign.ts` has no browser to resolve a
 * URL with (`campaign.test.ts` runs `parseCommander` under plain node), so
 * this file is the one place a file name becomes something an `<img>` can
 * load, called only from `main.ts`.
 *
 * `import.meta.glob`, eager, rather than a runtime `${base}ui/portraits/
 * <file>` string the way `menu.ts` resolves the menu banner. The menu
 * banner always exists; a portrait does not -- Shai and Idit's figures are
 * still being produced as of this file, `idit_zohar.png` may never land at
 * all, and `render_portrait.py` writing a new PNG must need a JSON line and
 * no code. A runtime string would build a URL for a file that is not there
 * and let the browser find that out with a 404 against a live `<img>`; the
 * glob is a build-time LISTING of what actually exists on disk, so a file
 * `commander.json` names but this glob never captured resolves to
 * `undefined` before any request is made at all, and the caller never has
 * to tell "no portrait authored" apart from "portrait authored, file
 * missing" -- both read as "no portrait", and both fall back to the
 * `.rl-cmd__face` hatch. `eager` costs nothing here: there are at most two
 * portraits to hold in memory for the life of the page.
 *
 * What this cannot see is a file the glob DID capture that still fails to
 * load at runtime (a corrupt PNG, a build that shipped the reference but not
 * the bytes) -- `hud.ts` and `loading.ts` each wire their own `<img>`'s
 * `onerror` back to the same hatch for that case, since resolving a URL here
 * is not the same claim as the browser being able to decode what is behind
 * it.
 */
const PORTRAITS: Record<string, string> = {};
for (const [path, url] of Object.entries(
  import.meta.glob('../../../assets/ui/portraits/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>
)) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  PORTRAITS[name] = url;
}

/**
 * `file` is a `CommanderPerson.portrait` value, e.g. `"shai_hammai.png"` --
 * `undefined` when the person has none authored, or when the name given
 * does not match anything this glob found on disk.
 *
 * Named `commanderPortraitUrl` and not the shorter `portraitUrl` because
 * `main.ts` already imports one of those, from `./ui/portrait` -- a per
 * unit-TYPE sprite-sheet frame, an unrelated concept that happens to share
 * the obvious name. Colliding with it silently would have been a duplicate
 * identifier `tsc` catches; the point of writing it out here is that the
 * reader does not have to find that out from the error.
 */
export function commanderPortraitUrl(file: string | undefined): string | undefined {
  return file === undefined ? undefined : PORTRAITS[file];
}
