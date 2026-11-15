/**
 * GH-1410: what a client error may say about itself on the wire, and nothing more.
 *
 * An error carries three things that can hold personal data: its message (a path, a URL, an id, text the player typed), its stack
 * (file paths with a user name, query strings) and its source. `describeError` keeps the class name, a SCRUBBED and truncated
 * message, and a 32-bit hash of the stack's FUNCTION NAMES alone. The wire contract (`@lions/data/telemetry`: `ERROR_NAME_PATTERN`,
 * `ERROR_MESSAGE_PATTERN`, `STACK_HASH_PATTERN`) is the second lock: printable ASCII, 120 characters, no stack.
 *
 * The scrub is deliberately blunt. It replaces what looks like a URL, an email, a quoted literal, a query string, an IP address, a path, a
 * dotted or long token, or a phone-like or long number with a placeholder, drops every non-printable-ASCII character, and takes the first line only. A false positive costs a less readable
 * message; a false negative would ship a path, so the rules err toward removing.
 */

/** The message's longest length on the wire (`ERROR_MESSAGE_PATTERN`). */
export const MESSAGE_MAX = 120;

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
/** A quoted literal of two or more characters: V8's `JSON.parse` and `Unexpected token` messages quote the INPUT (a save-slot name, storage contents). */
const DOUBLE_QUOTED_RE = /"[^"]{2,}"/g;
const SINGLE_QUOTED_RE = /'[^']{3,}'/g;
const BACKTICKED_RE = /`[^`]{2,}`/g;
/** Any query run (`?tester=dana_k`, `&x=1`, a bare `?token`): the label and every other parameter ride in it. */
const QUERY_RE = /[?&][^\s]+/g;
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
/** IPv6 and its forms (`fe80::1`, `2001:db8::ff00:42`, `::1`): a run of hex groups with at least two colons, not part of a longer word. */
const IPV6_RE = /(?<![\w:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi;
/** A Windows path with a drive letter or a UNC share, or a POSIX path of at least two segments. */
const PATH_RE = /(?:[A-Za-z]:\\[^\s]*|\\\\[^\s]+|(?:\/[^\s/]+){2,})/g;
/** A Windows path with NO drive letter (`Users\Dana\x`): word segments joined by backslashes. */
const BACKSLASH_PATH_RE = /[\w.-]+(?:\\[\w.-]+)+/g;
/** A dotted token whose segments are each short but long together (a JWT: `header.payload.signature`). */
const DOTTED_TOKEN_RE = /[\w-]{8,}(?:\.[\w-]{8,})+/g;
/** A phone number or id in groups: `054-123-4567`, `+972 54 123 4567`. */
const GROUPED_NUMBER_RE = /\+?\d{1,4}(?:[-\s.]\d{2,4}){2,}\b/g;
const LONG_NUMBER_RE = /\d{5,}/g;
const LONG_TOKEN_RE = /[A-Za-z0-9_-]{24,}/g;

export function scrubMessage(raw: string): string {
  const firstLine = String(raw).split(/\r?\n/, 1)[0] ?? '';
  const scrubbed = firstLine
    .replace(URL_RE, '<url>')
    .replace(EMAIL_RE, '<email>')
    .replace(DOUBLE_QUOTED_RE, '<str>')
    .replace(SINGLE_QUOTED_RE, '<str>')
    .replace(BACKTICKED_RE, '<str>')
    .replace(QUERY_RE, '<q>')
    .replace(IPV4_RE, '<ip>')
    .replace(IPV6_RE, '<ip>')
    .replace(PATH_RE, '<path>')
    .replace(BACKSLASH_PATH_RE, '<path>')
    .replace(DOTTED_TOKEN_RE, '<id>')
    .replace(LONG_TOKEN_RE, '<id>')
    .replace(GROUPED_NUMBER_RE, '<n>')
    .replace(LONG_NUMBER_RE, '<n>')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > MESSAGE_MAX ? scrubbed.slice(0, MESSAGE_MAX) : scrubbed;
}

/** FNV-1a, 32 bits, as 8 hex digits. Not cryptographic: a bucket key for "the same crash". */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** `at fnName (file:1:2)` (V8), `fnName@file:1:2` (Firefox, Safari): the function name alone, no file, line or column. */
const V8_FN = /^\s*at\s+(?:async\s+)?([^\s(]+)\s*\(/;
const GECKO_FN = /^\s*([^@\s]*)@/;
const FRAMES = 8;

/** The function names of the first frames, joined: the stack with every path, query and position taken out. */
export function stackShape(stack: string | undefined): string {
  if (!stack) return '';
  const names: string[] = [];
  for (const line of stack.split('\n')) {
    const m = V8_FN.exec(line) ?? GECKO_FN.exec(line);
    // `at https://host/a.js:1:2` (an anonymous V8 frame) has no name: skip it rather than hash a URL.
    if (m?.[1] !== undefined && m[1] !== '' && !/[/:\\]/.test(m[1])) names.push(m[1]);
    if (names.length === FRAMES) break;
  }
  return names.join('|');
}

export interface DescribedError {
  readonly name: string;
  readonly message: string;
  readonly hash: string;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** What any thrown or rejected value says about itself, safe to send. A non-Error value (a string, a number, an object) is described by its type. */
export function describeError(value: unknown): DescribedError {
  const isErr = typeof value === 'object' && value !== null && 'message' in value;
  const e = value as { name?: unknown; message?: unknown; stack?: unknown };
  const name = isErr && typeof e.name === 'string' && NAME_RE.test(e.name) ? e.name : isErr ? 'Error' : 'NonError';
  const rawMessage = isErr ? (typeof e.message === 'string' ? e.message : '') : typeof value === 'string' ? value : '';
  const message = scrubMessage(rawMessage);
  const shape = isErr && typeof e.stack === 'string' ? stackShape(e.stack) : '';
  // No usable stack (a cross-origin "Script error.", a rejected string): the name and the scrubbed message identify the crash.
  return { name, message, hash: fnv1a(shape !== '' ? `${name}:${shape}` : `${name}:${message}`) };
}

export interface ErrorTarget {
  addEventListener(type: 'error', fn: (ev: ErrorEvent) => void): void;
  addEventListener(type: 'unhandledrejection', fn: (ev: PromiseRejectionEvent) => void): void;
  removeEventListener(type: 'error', fn: (ev: ErrorEvent) => void): void;
  removeEventListener(type: 'unhandledrejection', fn: (ev: PromiseRejectionEvent) => void): void;
}

/**
 * Listens for uncaught errors and unhandled rejections and hands each, described, to `report`. Observes only: it never calls
 * `preventDefault`, never logs (`pnpm ui:routes` fails on a console error, and the browser's own report is untouched). Returns the
 * function that takes both listeners off.
 */
export function installErrorHandlers(target: ErrorTarget, report: (e: DescribedError) => void): () => void {
  const onError = (ev: ErrorEvent): void => {
    try {
      report(describeError(ev.error ?? ev.message));
    } catch {
      /* telemetry never breaks the game */
    }
  };
  const onRejection = (ev: PromiseRejectionEvent): void => {
    try {
      report(describeError(ev.reason));
    } catch {
      /* telemetry never breaks the game */
    }
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
