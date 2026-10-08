/**
 * "File as GitHub issue" (GH-464, spec §5.4, D11): a prefilled
 * `issues/new?title=…&body=…&labels=…` URL the lead opens, reads, edits and
 * submits. No token exists anywhere; nothing is posted by the Worker.
 *
 * The repository is public, so this function is the privacy boundary and is
 * kept pure so every rule below is a unit test:
 * - the tester label, contact, player id and session id are never written,
 *   and if a player typed any of them into a field that IS written (the note,
 *   a context string), the occurrence is replaced by `[redacted]`; e-mail
 *   addresses are replaced too;
 * - the note sits in a fenced `text` block whose fence is longer than any
 *   backtick run inside it, so it cannot @-mention, auto-link, close the fence
 *   or load a remote image when GitHub renders it;
 * - every other client-supplied value outside the fence is reduced to a plain
 *   character set (no `@`, `<`, `[`, `!`, `|`, backtick), so it cannot either;
 * - the whole URL stays under ISSUE_URL_MAX characters: the note is cut, with
 *   a pointer to the private /stats detail page, never the URL.
 */
import { feedbackRef } from './feedback-meta';

export const ISSUE_NEW_URL = 'https://github.com/ilan-pinto/roaring-lions/issues/new';
/** GitHub answers 414 somewhere past 8 KB of URL; stay well inside it. */
export const ISSUE_URL_MAX = 7000;
const TITLE_SNIPPET = 60;
const TICKS_PER_SECOND = 20;

export interface IssueInput {
  id: number;
  category: string;
  rating: number | null;
  text: string;
  mission: string | null;
  tick: number | null;
  build: string;
  commit: string | null;
  context: Record<string, unknown>;
  hasReplay: boolean;
  /** Never written. Passed in only so a copy typed into the note can be redacted. */
  tester: string | null;
  contact: string | null;
  player: string | null;
  session: string | null;
}

export interface IssueLink {
  url: string;
  title: string;
  body: string;
  /** True when the note was cut to fit the URL. */
  truncated: boolean;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]+/g;

/** Removes the private values (and e-mail addresses) from free text. Values
 *  under three characters are not matched -- they would shred ordinary words
 *  -- and are protected by never being written instead. */
export function redact(s: string, secrets: (string | null)[]): string {
  let out = s.replace(EMAIL, '[redacted]');
  for (const v of secrets) {
    if (v === null || v.trim().length < 3) continue;
    out = out.replace(new RegExp(escapeRe(v.trim()), 'gi'), '[redacted]');
  }
  return out;
}

/** A context value reduced to characters with no meaning in GitHub markdown. */
function plain(x: unknown, max = 160): string {
  const s = typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : '';
  const cleaned = s.replace(/[^A-Za-z0-9 _.,:;()/+=-]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...cleaned].slice(0, max).join('');
}

const clock = (tick: number): string => {
  const s = Math.floor(tick / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function fence(note: string): string {
  const longest = Math.max(0, ...[...note.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(Math.max(3, longest + 1));
  return `${f}text\n${note}\n${f}`;
}

function title(id: number, note: string, category: string, rating: number | null, mission: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const line = note.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (line === '') return `Feedback ${feedbackRef(id)}: rated ${rating ?? '?'}/5 on ${mission}`;
  const cps = [...line];
  const snippet = cps.length > TITLE_SNIPPET ? `${cps.slice(0, TITLE_SNIPPET).join('').trimEnd()}…` : line;
  return `Feedback ${feedbackRef(id)}: ${category === 'rating' ? `rated ${rating ?? '?'}/5, ` : ''}${snippet}`;
}

/** Builds the prefilled issue. `origin` is the deployed site's own origin,
 *  for the link back to the private detail page. */
export function buildIssueLink(r: IssueInput, origin: string): IssueLink {
  const secrets = [r.tester, r.contact, r.player, r.session];
  const clean = (x: unknown, max?: number): string => redact(plain(x, max), secrets);
  const ref = feedbackRef(r.id);
  const detail = `${origin.replace(/\/+$/, '')}/stats/feedback/${r.id}`;
  const mission = r.mission === null ? '(menu)' : clean(r.mission, 64);
  const kind = r.category === 'rating' ? `rating ${r.rating ?? '?'}/5` : clean(r.category, 16);
  const c = r.context;
  const viewport = Array.isArray(c.viewport) ? c.viewport.slice(0, 2).map((n) => clean(n, 6)).join('x') : '';
  const rows: [string, string][] = [
    ['Kind', kind],
    ['Mission', r.mission === null ? mission : r.tick === null ? mission : `${mission}, ${clock(r.tick)} on the clock (tick ${r.tick})`],
    ['Build', `${clean(r.build, 20)}${r.commit ? ` (${clean(r.commit, 40)})` : ''}`],
    ['Renderer', [clean(c.renderer, 16), clean(c.quality, 16), clean(c.gpu)].filter(Boolean).join(', ') || 'not sent'],
    ['Screen', [viewport, c.dpr !== undefined ? `DPR ${clean(c.dpr, 6)}` : '', clean(c.locale, 16)].filter(Boolean).join(', ') || 'not sent'],
    ['Replay', r.hasReplay ? `attached - \`pnpm replay:feedback -- --id=${r.id}\`` : 'none'],
  ];
  const table = ['| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
  const head = `**From in-game feedback** ${ref} (${kind}). Private detail: ${detail}`;
  const note = redact(r.text, secrets).replace(/\r\n?/g, '\n');
  const issueTitle = title(r.id, note, r.category, r.rating, mission);

  const assemble = (n: string, cut: boolean): string => {
    const quoted = n === '' ? '_No note: a rating only._' : fence(n);
    const tail = cut ? `\n\n_The note is cut here to fit a link. The full note is on the private detail page above._` : '';
    return `${head}\n\n${quoted}${tail}\n\n${table}\n`;
  };
  const urlFor = (body: string): string => {
    const q = new URLSearchParams({ title: issueTitle, body, labels: `feedback,${r.category}` });
    return `${ISSUE_NEW_URL}?${q.toString()}`;
  };

  let body = assemble(note, false);
  let url = urlFor(body);
  let truncated = false;
  if (url.length > ISSUE_URL_MAX) {
    // Largest prefix of the note (in code points) that fits, by bisection.
    const cps = [...note];
    let lo = 0;
    let hi = cps.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (urlFor(assemble(`${cps.slice(0, mid).join('')}…`, true)).length <= ISSUE_URL_MAX) lo = mid;
      else hi = mid - 1;
    }
    body = assemble(`${cps.slice(0, lo).join('')}…`, true);
    url = urlFor(body);
    truncated = true;
  }
  return { url, title: issueTitle, body, truncated };
}
