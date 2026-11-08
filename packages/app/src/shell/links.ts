// packages/app/src/shell/links.ts
/**
 * Every href the shell writes, in one place. Screens import `routes` and never
 * spell a path; the router (`shell/router.ts`) strips the base back off.
 *
 * `import.meta.env.BASE_URL` is `/` in dev and tests and `/<repo>/` on Pages,
 * always with a trailing slash -- so a `routes.*()` href works for a HARD
 * navigation (an anchor the player middle-clicks, or one the browser follows
 * because `interceptLinks` stood aside) as well as for a soft one.
 *
 * Two spellings are deliberate and neither is cosmetic. A mission's options
 * are ordinary `=1` query values, because `main.ts` reads them with
 * `params.get(...) !== null`. A sandbox's flags are BARE (`?tunnel&sur`),
 * because `readFlags` tests `params.has` and that is how they are typed by
 * hand -- `URLSearchParams.toString()` renders an appended empty value as
 * `tunnel=`, which parses the same but is not the spelling `sandbox-help.ts`
 * prints or the one a player copies out of the URL bar, so `flagQuery` joins
 * the names itself.
 */
import { SANDBOX_FLAGS, type SandboxFlagName } from '../sandbox-help';

const BASE: string = import.meta.env.BASE_URL;

function href(path: string, query?: URLSearchParams): string {
  const qs = query && [...query.keys()].length > 0 ? `?${query.toString()}` : '';
  return `${BASE}${path.startsWith('/') ? path.slice(1) : path}${qs}`;
}

/** Bare flags (`?tunnel&sur`), never `=1` -- `readFlags` tests presence.
 *  Iterates `SANDBOX_FLAGS` rather than the caller's object, so the order is
 *  the table's and one pick has exactly one URL. */
function flagQuery(on: Partial<Record<SandboxFlagName, boolean>> | undefined): string {
  if (!on) return '';
  const names = SANDBOX_FLAGS.filter((f) => on[f.name] === true).map((f) => f.name);
  return names.length > 0 ? `?${names.join('&')}` : '';
}

export const routes = {
  menu: (): string => href('/'),
  campaign: (): string => href('/campaign'),
  brigade: (): string => href('/brigade'),
  freePlay: (): string => href('/free-play'),
  sandbox: (map: string, on?: Partial<Record<SandboxFlagName, boolean>>): string =>
    `${href(`/free-play/${encodeURIComponent(map)}`)}${flagQuery(on)}`,
  mission: (id: string, opts: { tutorial?: boolean; fresh?: boolean } = {}): string => {
    const q = new URLSearchParams();
    if (opts.tutorial) q.set('tutorial', '1');
    if (opts.fresh) q.set('fresh', '1');
    return href(`/mission/${encodeURIComponent(id)}`, q);
  },
  // Not routed yet -- Phase 1's later tasks mount these. They are spelled here
  // now so that when they arrive there is nowhere else for the path to be
  // written down.
  profile: (): string => href('/profile'),
  // The privacy page is served by the Worker, not the SPA: a hard navigation.
  privacy: (): string => href('/privacy'),
  settings: (): string => href('/settings'),
  credits: (): string => href('/credits'),
  saves: (): string => href('/saves'),
  // Play with a friend (N1b): the host-or-join screen, and one room's lobby.
  versus: (): string => href('/versus'),
  versusRoom: (code: string): string => href(`/versus/${encodeURIComponent(code)}`),
  // GH-954 W1: the arena watch screen. DEV only: `main.ts` registers the route under `import.meta.env.DEV`, so in
  // a production build this returns the menu and the path is not in the bundle (`import.meta.env.DEV` is
  // `false` there, so the branch is dead code). `pnpm arena --watch` prints the same path with the run's key in
  // the fragment, which an href here never carries.
  arenaWatch: (): string => (import.meta.env.DEV ? href('/arena/watch') : href('/')),
  // GH-954 W2: the arena setup screen, DEV only on the same terms as `arenaWatch` (the menu in a production build).
  arenaSetup: (): string => (import.meta.env.DEV ? href('/arena') : href('/')),
  // GH-954 W3: the arena results list and the replay of one recorded game (`file` is a name from that list, which the
  // server checks again). DEV only, on the same terms: in a production build both are the menu.
  arenaResults: (): string => (import.meta.env.DEV ? href('/arena/results') : href('/')),
  arenaReplay: (file: string): string => (import.meta.env.DEV ? href('/arena/replay', new URLSearchParams({ game: file })) : href('/')),
} as const;
