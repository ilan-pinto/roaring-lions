/**
 * The short commit the Settings footer prints beside the build number.
 *
 * `commit` is `__APP_COMMIT__`, which `packages/app/vite.config.ts` fixes at
 * BUILD time: `WORKERS_CI_COMMIT_SHA` (Cloudflare Workers Builds), then
 * `GITHUB_SHA` (GitHub Actions), then `git rev-parse HEAD`, and '' when none
 * of them gave a hex commit (no git, a source tarball). A dev server runs the
 * same config, so it prints a real commit when git is there and 'dev' when
 * not. The first 7 digits are what `git rev-parse --short` prints, and what a
 * checkout is matched against when `pnpm bot` joins a room: the room's build
 * is `${version}+${full commit}` (`tools/src/net/build-id.ts`).
 *
 * Display only. It is never put in a URL.
 */
export const SHORT_COMMIT_LENGTH = 7;
export const NO_COMMIT_LABEL = 'dev';

export function shortCommit(commit: string): string {
  return /^[0-9a-f]{7,40}$/.test(commit) ? commit.slice(0, SHORT_COMMIT_LENGTH) : NO_COMMIT_LABEL;
}
