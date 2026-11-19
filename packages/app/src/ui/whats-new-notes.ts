/**
 * The player-facing release notes for one game version (GH-1622), for the menu's "What's new" panel (`whats-new.ts`).
 *
 * THE FILES. `data/release-notes/v<X.Y.Z>.json` is `{ version, units, rules, fixes }`, three lists of short English
 * lines (data, like mission text: never passed through `t()`). The release step on `main` renames `next.json` to the new
 * version's file in the bump commit, so the notes for a build ship WITH that build. `next.json` is the draft for the
 * next promotion and is never shown: the glob below only matches `v*.json`.
 *
 * LAZY, ON PURPOSE. `import.meta.glob` WITHOUT `eager` gives a map from path to a thunk, and each JSON file becomes its
 * own chunk: the entry chunk carries the paths and nothing of the text, and the one file for this build is fetched only
 * when the panel needs it (an auto-open, or the menu button). `whats-new.test.ts` reads this source and fails on an
 * eager glob or a static import of the directory; `pnpm --filter @lions/tools webgpu:bundle` is the bundle-side check.
 *
 * TOLERANT. No directory, no file for this version, a file that will not parse, or one whose three lists are all
 * empty: every one of them reads as "no notes" (`null`), never a throw. A chunk that will not load even after
 * `importWithRetry`'s one retry rejects, and the panel says so.
 */
import { importWithRetry } from '../shell/chunk';

export interface ReleaseNotes {
  version: string;
  units: string[];
  rules: string[];
  fixes: string[];
}

/** The three lists, in the order the panel draws them. */
export const NOTE_SECTIONS = ['units', 'rules', 'fixes'] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];

/** A path into `data/release-notes/`, as this module's glob keys it. */
export const RELEASE_NOTES_DIR = '../../../../data/release-notes/';

/** What `import.meta.glob` hands back for one file: a loader of its module. */
export type NotesFiles = Readonly<Record<string, () => Promise<unknown>>>;

/** Every shipped version's file, LAZY (see the header). Empty while the directory does not exist. */
const NOTES_FILES: NotesFiles = import.meta.glob('../../../../data/release-notes/v*.json');

const VERSION = /^\d+\.\d+\.\d+$/;

/** The glob key of a version's file, or null for anything that is not `X.Y.Z` (so `next` can never be asked for). */
export function notesFileFor(version: string): string | null {
  return VERSION.test(version) ? `${RELEASE_NOTES_DIR}v${version}.json` : null;
}

const lines = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : null;

/** The notes in a loaded module (its `default` export, or the object itself), or null when they are not the pinned
 *  shape or not for `version`. */
export function parseReleaseNotes(mod: unknown, version: string): ReleaseNotes | null {
  const raw = typeof mod === 'object' && mod !== null && 'default' in mod ? (mod as { default: unknown }).default : mod;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== version) return null;
  const units = lines(r.units);
  const rules = lines(r.rules);
  const fixes = lines(r.fixes);
  if (units === null || rules === null || fixes === null) return null;
  return { version, units, rules, fixes };
}

/** True when at least one list has a line: a version released with "no player-facing changes" has none. */
export function hasNotes(n: ReleaseNotes): boolean {
  return n.units.length + n.rules.length + n.fixes.length > 0;
}

/** This version's notes, loaded lazily; null when there are none to show. Rejects only when the chunk failed twice. */
export async function loadReleaseNotes(
  version: string,
  files: NotesFiles = NOTES_FILES,
  load: <T>(f: () => Promise<T>) => Promise<T> = importWithRetry
): Promise<ReleaseNotes | null> {
  const key = notesFileFor(version);
  const file = key === null ? undefined : files[key];
  if (file === undefined) return null;
  const notes = parseReleaseNotes(await load(file), version);
  return notes !== null && hasNotes(notes) ? notes : null;
}
