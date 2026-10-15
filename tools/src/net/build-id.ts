/**
 * The build string a room checks on every hello: `${version}+${commit}`, as
 * the browser sends it (`main.ts`: `${__APP_BUILD__}+${__APP_COMMIT__}`).
 * The commit is `packages/app/vite.config.ts`'s `appCommit()` rule repeated
 * statement for statement -- `WORKERS_CI_COMMIT_SHA`, then `GITHUB_SHA`
 * (`??`, so a variable set to '' stops there and git is asked), then
 * `git rev-parse HEAD`; lowercased, and kept only if it is 7-40 hex digits.
 * A harness that composed the build any other way would be refused by a room
 * a browser on the same checkout can join.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../../', import.meta.url);

function appCommit(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.WORKERS_CI_COMMIT_SHA ?? env.GITHUB_SHA;
  let sha = fromEnv ?? '';
  if (sha === '') {
    try {
      sha = execSync('git rev-parse HEAD', { cwd: fileURLToPath(ROOT), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = '';
    }
  }
  sha = sha.toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : '';
}

export function buildId(env: NodeJS.ProcessEnv = process.env): string {
  const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as { version: string };
  return `${pkg.version}+${appCommit(env)}`;
}
