/**
 * Redaction for the one secret the arena ever holds (GH-954 W2): a private API token the user typed on the setup
 * screen, kept in memory for ONE run and handed to that run's children as an environment variable.
 *
 * The token must reach no file, no log line and no printed argv or env dump. Everything the arena prints or writes
 * for a run that has a token goes through here, with the token as a `secret`:
 *
 * - `redactText`: a string, once (a log line, an error message, a printed argv).
 * - `createRedactor`: a STREAM (a child's stdout or stderr on its way to its log file). A chunk boundary can fall
 *   inside the token, so the tail that could still be the start of one is held back until the next chunk (or
 *   `flush`) decides. Without that a token split across two reads would reach the file whole, one half at a time.
 * - `describeEnv` / `describeCommand`: what the arena prints about a spawn. The VALUE of an injected variable is
 *   never part of it.
 *
 * Pure: strings in, strings out. No secret is ever read from the environment here.
 */

export const REDACTED = '[redacted]';

/** The secrets worth matching: the empty string would match everywhere. */
const live = (secrets: readonly string[]): string[] => secrets.filter((s) => s.length > 0);

/** `text` with every occurrence of every secret replaced. Longest secret first, so one that contains another goes whole. */
export function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of live(secrets).sort((a, b) => b.length - a.length)) out = out.split(s).join(REDACTED);
  return out;
}

export interface Redactor {
  /** The part of `chunk` (and of what was held back) that can no longer become a secret, redacted. */
  push(chunk: string): string;
  /** Whatever is still held back, redacted. Call once at the end of the stream. */
  flush(): string;
}

/** The length of the longest suffix of `text` that is a proper prefix of some secret (0: none). */
function heldBack(text: string, secrets: readonly string[]): number {
  const longest = Math.min(text.length, Math.max(...secrets.map((s) => s.length)) - 1);
  for (let k = longest; k > 0; k--) {
    const tail = text.slice(text.length - k);
    if (secrets.some((s) => s.length > k && s.startsWith(tail))) return k;
  }
  return 0;
}

/** A redactor for a stream. With no secret it is the identity (and holds nothing back). Only a tail that could
 *  still grow into a secret is held back, so ordinary output is written as it arrives and two streams
 *  (stdout and stderr into one log) keep their order. */
export function createRedactor(secrets: readonly string[]): Redactor {
  const list = live(secrets);
  if (list.length === 0) return { push: (c) => c, flush: () => '' };
  let carry = '';
  return {
    push(chunk) {
      const all = redactText(carry + chunk, list);
      // A secret that begins in this tail could finish in the next chunk: keep exactly that back.
      const keep = heldBack(all, list);
      carry = all.slice(all.length - keep);
      return all.slice(0, all.length - keep);
    },
    flush() {
      const rest = redactText(carry, list);
      carry = '';
      return rest;
    },
  };
}

/** `KEY=[redacted]` for each injected variable: a name is shown, a value never. */
export function describeEnv(extra: Readonly<Record<string, string>>): string {
  return Object.keys(extra).sort().map((k) => `${k}=${REDACTED}`).join(' ');
}

/** What a spawn prints: the argv (through `redactText`) and the injected variables (names only). */
export function describeCommand(argv: readonly string[], extraEnv: Readonly<Record<string, string>>, secrets: readonly string[]): string {
  const env = describeEnv(extraEnv);
  return `${redactText(argv.join(' '), [...secrets, ...Object.values(extraEnv)])}${env === '' ? '' : ` [env ${env}]`}`;
}
