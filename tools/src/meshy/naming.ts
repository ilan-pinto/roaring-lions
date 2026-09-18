/**
 * Pure naming/encoding helpers: the download directory name
 * (`art/meshy/<slug>-<yyyymmdd>-<task id prefix>/`) and the base64 data-URI
 * encoding `image` uses for a local file. No network, no task-submission
 * logic -- that lives in `cli.ts`, which is what actually writes files.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Lower-case, ASCII, hyphen-separated, capped so a long prompt does not
 *  produce an unusable directory name. Falls back to "untitled" for input
 *  that slugifies to nothing (pure punctuation, pure whitespace, empty). */
export function slugify(input: string, maxLength = 40): string {
  const normalized = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, ''); // strip combining diacritics
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const trimmed = slug.slice(0, maxLength).replace(/-+$/g, '');
  return trimmed.length > 0 ? trimmed : 'untitled';
}

export function formatYyyymmdd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** `art/meshy/<slug>-<yyyymmdd>-<task id prefix>` (the leaf directory name
 *  only -- callers join it under `art/meshy/`). `taskId` is used verbatim,
 *  sliced to 8 chars: Meshy ids are UUIDs, so 8 chars is enough to tell two
 *  generations of the same name apart without a directory name as long as
 *  the id itself. */
export function taskDirName(nameOrPrompt: string, taskId: string, date: Date = new Date()): string {
  return `${slugify(nameOrPrompt)}-${formatYyyymmdd(date)}-${taskId.slice(0, 8)}`;
}

const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** A local `.png`/`.jpg`/`.jpeg` path -> a base64 data URI, per the
 *  image-to-3D contract's "a base64 data URI of a .png/.jpg". Throws on any
 *  other extension rather than guessing a MIME type. */
export function fileToDataUri(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(`unsupported image extension "${ext}" for ${filePath} -- expected .png, .jpg or .jpeg`);
  }
  const bytes = readFileSync(filePath);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** `image`'s positional argument -> what `image_url` should carry: an https
 *  URL passed straight through, or a local file base64-encoded. */
export function resolveImageUrl(pathOrUrl: string): string {
  return isHttpUrl(pathOrUrl) ? pathOrUrl : fileToDataUri(pathOrUrl);
}
