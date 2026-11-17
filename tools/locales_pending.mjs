// GH-1406: "keep the staged locales current". When main adds a chrome key or edits an English line, every staged language (data/locales/<id>/ and
// packages/app/src/i18n/<id>.json) falls behind. This lists, per language, exactly what a translator has to do, with the English text beside each
// item:
//
//   node tools/locales_pending.mjs <lang>        one language, e.g. `de`, `es-ES`          (pnpm locales:pending -- de)
//   node tools/locales_pending.mjs --all         every staged language                     (the weekly CI job)
//   options: --json (machine-readable)  --max-chars=N (cut the Markdown, saying how much is left)  --root=<dir> (another tree, for tests)
//
// REPORT ONLY. It reads files, prints, and changes nothing, and it exits 0 whatever it finds (2 only for a bad command line), so a CI job that
// runs it can never be red because a translation is behind. `pnpm validate:data` is the gate; this is the worklist.
//
// What counts as pending, per language:
//   chrome  : a key the English has and the catalogue lacks (missing); a key the catalogue has and the English lacks (extra); a translated key whose
//             source hash (data/locales/<id>/chrome.src.json) differs from the English now (stale) or is absent (unhashed); a key whose {placeholders}
//             or ICU shape differ from the English (shape; Russian's extra plural forms are allowed, as in validate:data).
//   missions: a mission with no entry; a string the English has and the overlay lacks (missing) or the overlay has and the English lacks (extra);
//             a translated string whose `src` hash differs from the English catalogue's (stale) or is absent (unhashed).
//   units   : the same, for `name` and `blurb`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromeCatalogueFailures } from './validate_chrome_catalogue.mjs';
import { entryPaths, sourceHash } from './validate_narrative.mjs';

const isHash = (h) => typeof h === 'string' && /^[0-9a-f]{8}$/.test(h);

/** Chrome: what is behind in one catalogue. `tr`/`src` may be null (no file yet): then every English key is missing. */
export function pendingChrome(en, tr, src, locale) {
  const out = { missing: [], extra: [], stale: [], unhashed: [], shape: [] };
  const have = tr ?? {};
  const hashes = src ?? {};
  for (const key of Object.keys(en)) {
    if (!(key in have)) {
      out.missing.push(key);
      continue;
    }
    if (chromeCatalogueFailures('x', { [key]: en[key] }, { [key]: have[key] }, { locale }).length > 0) out.shape.push(key);
    if (hashes[key] === undefined || !isHash(hashes[key])) out.unhashed.push(key);
    else if (hashes[key] !== sourceHash(en[key])) out.stale.push(key);
  }
  for (const key of Object.keys(have)) if (!(key in en)) out.extra.push(key);
  return out;
}

/** The text paths of one catalogue entry: a mission's (`entryPaths`) or a unit's (`name`, `blurb`). */
const unitPaths = (entry) => new Map(['name', 'blurb'].filter((k) => typeof entry?.[k] === 'string').map((k) => [k, entry[k]]));

/** Mission or unit overlay against the generated English catalogue. Items are `{ id, path }`; a mission with no entry is `{ id, path: null }`. */
export function pendingEntries(enCat, trCat, pathsOf = entryPaths) {
  const out = { missing: [], extra: [], stale: [], unhashed: [] };
  const have = trCat ?? {};
  for (const [id, enEntry] of Object.entries(enCat)) {
    const enPaths = pathsOf(enEntry);
    const trEntry = have[id];
    if (trEntry === undefined) {
      out.missing.push({ id, path: null });
      continue;
    }
    const trPaths = pathsOf(trEntry);
    const trSrc = trEntry.src ?? {};
    for (const [path, text] of enPaths) {
      if (!trPaths.has(path)) out.missing.push({ id, path });
      else if (trSrc[path] === undefined || !isHash(trSrc[path])) out.unhashed.push({ id, path });
      else if (trSrc[path] !== (enEntry.src?.[path] ?? sourceHash(text))) out.stale.push({ id, path });
    }
    for (const path of trPaths.keys()) if (!enPaths.has(path)) out.extra.push({ id, path });
  }
  for (const id of Object.keys(have)) if (!(id in enCat)) out.extra.push({ id, path: null });
  return out;
}
export const pendingMissions = (enCat, trCat) => pendingEntries(enCat, trCat, entryPaths);
export const pendingUnits = (enCat, trCat) => pendingEntries(enCat, trCat, unitPaths);

const count = (o) => Object.values(o).reduce((n, list) => n + list.length, 0);

/** Every staged language under `root`: a directory in data/locales other than `en`, or a catalogue beside en.json. */
export function stagedLocales(root) {
  const ids = new Set();
  const locales = join(root, 'data/locales');
  if (existsSync(locales)) for (const e of readdirSync(locales, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'en') ids.add(e.name);
  const i18n = join(root, 'packages/app/src/i18n');
  if (existsSync(i18n)) for (const f of readdirSync(i18n)) if (f.endsWith('.json') && f !== 'en.json') ids.add(f.slice(0, -'.json'.length));
  return [...ids].sort();
}

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

/** Everything one language is behind on, read from `root`. */
export function pendingFor(root, id) {
  const en = readJson(join(root, 'packages/app/src/i18n/en.json')) ?? {};
  const chrome = pendingChrome(en, readJson(join(root, `packages/app/src/i18n/${id}.json`)), readJson(join(root, `data/locales/${id}/chrome.src.json`)), id);
  const missions = pendingMissions(readJson(join(root, 'data/locales/en/missions.json')) ?? {}, readJson(join(root, `data/locales/${id}/missions.json`)));
  const units = pendingUnits(readJson(join(root, 'data/locales/en/units.json')) ?? {}, readJson(join(root, `data/locales/${id}/units.json`)));
  return { id, chrome, missions, units, total: count(chrome) + count(missions) + count(units) };
}

/** English text for a worklist line, one line of inline code, cut short. */
const code = (s, max = 220) => {
  const flat = String(s).replace(/\s+/g, ' ').replace(/`/g, "'");
  return `\`${flat.length > max ? `${flat.slice(0, max)}…` : flat}\``;
};

/** The Markdown worklist for the results of `pendingFor`, with the English beside each item. `root` supplies the English text. */
export function renderMarkdown(results, root, maxChars = Infinity) {
  const en = readJson(join(root, 'packages/app/src/i18n/en.json')) ?? {};
  const enMissions = readJson(join(root, 'data/locales/en/missions.json')) ?? {};
  const enUnits = readJson(join(root, 'data/locales/en/units.json')) ?? {};
  const lines = [];
  const total = results.reduce((n, r) => n + r.total, 0);
  lines.push(`<!-- locales-pending: ${total > 0 ? 'yes' : 'no'} -->`);
  lines.push('## Staged locales: translation worklist (GH-1406)');
  lines.push('');
  lines.push(
    results.length === 0
      ? 'No staged locale on this tree.'
      : total === 0
        ? `${results.length === 1 ? 'The staged language' : `All ${results.length} staged languages`} (${results.map((r) => r.id).join(', ')}) ${results.length === 1 ? 'is' : 'are'} up to date.`
        : `${total} item${total === 1 ? '' : 's'} pending across ${results.filter((r) => r.total > 0).length} of ${results.length} staged languages. Report only: nothing was changed. \`pnpm locales:pending -- <lang>\` prints one language's list.`,
  );
  for (const r of results) {
    lines.push('', `### ${r.id}`);
    if (r.total === 0) {
      lines.push('Up to date.');
      continue;
    }
    const c = r.chrome;
    lines.push(
      `chrome: ${c.missing.length} missing, ${c.stale.length} stale, ${c.unhashed.length} without a hash, ${c.shape.length} with a wrong shape, ${c.extra.length} extra · ` +
        `missions: ${r.missions.missing.length} missing, ${r.missions.stale.length} stale, ${r.missions.unhashed.length} without a hash, ${r.missions.extra.length} extra · ` +
        `units: ${r.units.missing.length} missing, ${r.units.stale.length} stale, ${r.units.unhashed.length} without a hash, ${r.units.extra.length} extra`,
    );
    const chromeList = (title, keys, withEnglish) => {
      if (keys.length === 0) return;
      lines.push('', `**Chrome, ${title} (${keys.length})**`);
      for (const k of keys) lines.push(withEnglish && en[k] !== undefined ? `- \`${k}\`: ${code(en[k])}` : `- \`${k}\``);
    };
    chromeList('missing', c.missing, true);
    chromeList('stale (the English changed after translation)', c.stale, true);
    chromeList('wrong placeholders or plural shape', c.shape, true);
    chromeList('translated but without a source hash', c.unhashed, false);
    chromeList('extra (no longer in the English)', c.extra, false);
    const entryList = (kind, title, items, cat) => {
      if (items.length === 0) return;
      lines.push('', `**${kind}, ${title} (${items.length})**`);
      for (const { id: eid, path } of items) {
        const text = path === null ? null : (kind === 'Units' ? unitPaths(cat[eid]) : entryPaths(cat[eid])).get(path);
        lines.push(path === null ? `- \`${eid}\`: the whole entry` : text === undefined ? `- \`${eid}\` \`${path}\`` : `- \`${eid}\` \`${path}\`: ${code(text)}`);
      }
    };
    for (const [kind, res, cat] of [['Missions', r.missions, enMissions], ['Units', r.units, enUnits]]) {
      entryList(kind, 'missing', res.missing, cat);
      entryList(kind, 'stale (the English changed after translation)', res.stale, cat);
      entryList(kind, 'translated but without a source hash', res.unhashed, cat);
      entryList(kind, 'extra (no longer in the English)', res.extra, cat);
    }
  }
  let text = lines.join('\n');
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars).replace(/\n[^\n]*$/, '');
    const left = text.slice(cut.length).split('\n').filter((l) => l.startsWith('- ')).length;
    text = `${cut}\n\n_…cut to fit the comment size; about ${left} more items. \`pnpm locales:pending -- <lang>\` prints the rest._`;
  }
  return `${text}\n`;
}

function main(argv) {
  const root = (argv.find((a) => a.startsWith('--root=')) ?? '').slice('--root='.length) || join(dirname(fileURLToPath(import.meta.url)), '..');
  const all = argv.includes('--all');
  const langs = argv.filter((a) => !a.startsWith('--'));
  const staged = stagedLocales(root);
  const usage = 'usage: node tools/locales_pending.mjs (<lang> | --all) [--json] [--max-chars=N] [--root=<dir>]';
  if ((!all && langs.length === 0) || (all && langs.length > 0)) {
    console.error(usage);
    return 2;
  }
  const unknown = langs.filter((l) => l === 'en' || !staged.includes(l));
  if (unknown.length > 0) {
    console.error(`not a staged locale: ${unknown.join(', ')} (staged: ${staged.join(', ') || 'none'})`);
    return 2;
  }
  const results = (all ? staged : langs).map((id) => pendingFor(root, id));
  const maxArg = argv.find((a) => a.startsWith('--max-chars='));
  const max = maxArg === undefined ? Infinity : Number(maxArg.slice('--max-chars='.length));
  console.log(argv.includes('--json') ? JSON.stringify(results, null, 2) : renderMarkdown(results, root, Number.isFinite(max) && max > 0 ? max : Infinity));
  return 0;
}

// process.exitCode, not process.exit(): exit() cuts a large write to a PIPE short (a 64 KiB JSON list arrived truncated), while a file is synchronous.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
