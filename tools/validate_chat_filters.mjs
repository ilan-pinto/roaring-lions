// GH-1417 S2: the cross-file rules for data/chat/filter.<lang>.json that chat_filter.schema.json cannot see. Its own module for the
// reason every validate_*.mjs is one: validate_data.mjs runs its whole sweep at import time and exits, so a test cannot import it.
//
//   - a file is named for its `lang` (`filter.<lang>.json`);
//   - no Chinese file: the lead's ruling holds Chinese out until segmentation is decided (proposal W4), because whole-word
//     matching does not exist in a script without spaces and a substring match hides ordinary lines;
//   - `source.file` exists under data/chat/, its sha256 is `source.sha256` (a silent edit to the "pristine" upstream copy is red), and
//     its folder is named in data/chat/LICENSES.md (nothing ships without its rights recorded, D3);
//   - PROVENANCE: hide + mask + dropped, minus in_house, is EXACTLY the upstream file's entries (one per non-empty line). So every
//     upstream entry is accounted for, and every entry that is not upstream is declared as our own;
//   - in_house entries are not upstream, and each is in hide or mask;
//   - an entry sits in at most one of hide, mask and dropped;
//   - `review: none` means `hide` is empty (the lead's ruling: the launch languages' hide tier waits for a native reader); such a
//     language is REPORTED as a warning, so the gate never pretends to full coverage;
//   - each `allow` entry contains a `hide` entry (case-folded): an allow entry that excuses nothing is dead data.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * @param {{ file: string, doc: any }[]} files every parsed data/chat/filter.*.json, `file` repo-relative
 * @param {string} chatDir absolute path of data/chat
 * @returns {{ failures: string[], warnings: string[] }}
 */
export function chatFilterFailures(files, chatDir) {
  const failures = [];
  const warnings = [];
  const licences = existsSync(join(chatDir, 'LICENSES.md')) ? readFileSync(join(chatDir, 'LICENSES.md'), 'utf8') : '';
  if (licences === '') failures.push('data/chat/LICENSES.md: missing, and the chat word lists need their licence record');
  for (const { file, doc } of files) {
    if (doc === null || typeof doc !== 'object') continue;
    const lang = String(doc.lang);
    if (basename(file) !== `filter.${lang}.json`) failures.push(`${file}: lang "${lang}" but the file is not named filter.${lang}.json`);
    if (lang === 'zh' || lang.startsWith('zh-')) {
      failures.push(`${file}: Chinese is held out of the chat filter until segmentation is decided (GH-1417, proposal W4)`);
    }
    const hide = doc.hide ?? [];
    const mask = doc.mask ?? [];
    const dropped = doc.dropped ?? [];
    const inHouse = new Set(doc.in_house ?? []);
    const allow = doc.allow ?? [];

    const seen = new Map();
    for (const [tier, list] of [['hide', hide], ['mask', mask], ['dropped', dropped]]) {
      for (const e of list) {
        const prev = seen.get(e);
        if (prev !== undefined) failures.push(`${file}: "${e}" is in both ${prev} and ${tier}`);
        else seen.set(e, tier);
      }
    }

    const src = doc.source ?? {};
    const srcPath = typeof src.file === 'string' ? join(chatDir, src.file) : null;
    if (srcPath === null || !existsSync(srcPath)) {
      failures.push(`${file}: source.file ${src.file} does not exist under data/chat/`);
    } else {
      const bytes = readFileSync(srcPath);
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== src.sha256) failures.push(`${file}: data/chat/${src.file} has sha256 ${sha}, not the pinned ${src.sha256}`);
      const folder = src.file.split('/').slice(0, 2).join('/');
      if (!licences.includes(folder)) failures.push(`${file}: data/chat/${folder} is not named in data/chat/LICENSES.md`);
      const upstream = new Set(bytes.toString('utf8').split('\n').filter((l) => l !== ''));
      for (const e of inHouse) {
        if (upstream.has(e)) failures.push(`${file}: in_house "${e}" is an upstream entry`);
        if (!hide.includes(e) && !mask.includes(e)) failures.push(`${file}: in_house "${e}" is in neither hide nor mask`);
      }
      const accounted = new Set([...hide, ...mask, ...dropped].filter((e) => !inHouse.has(e)));
      for (const e of upstream) if (!accounted.has(e)) failures.push(`${file}: upstream entry "${e}" is in none of hide, mask and dropped`);
      for (const e of accounted) if (!upstream.has(e)) failures.push(`${file}: "${e}" is not in the upstream list and not declared in_house`);
    }

    if (doc.review === 'none') {
      if (hide.length > 0) failures.push(`${file}: review is "none", so hide must be empty until a native reader has reviewed the list`);
      warnings.push(`${file}: the hide tier is empty until a native reader reviews the list; only masking applies in ${lang}`);
    }

    const hideFolded = hide.map((h) => h.toLowerCase());
    for (const a of allow) {
      const fa = a.toLowerCase();
      if (!hideFolded.some((h) => fa.includes(h))) failures.push(`${file}: allow "${a}" contains no hide entry, so it excuses nothing`);
    }
  }
  return { failures, warnings };
}
