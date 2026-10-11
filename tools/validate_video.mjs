// The data gate's video checks: provenance and size for every file under
// assets/video/ (docs/research/2026-10-11-generative-video.md, decision 4;
// docs/cinematics/README.md, "Delivery").
//
// Pure: the caller hands in the parsed manifest (data/video.json), the files
// on disk with their sizes, and the briefing_video paths missions name, so
// tools/src/validate_video.test.ts drives it with fixtures.
//
// Before this, the only thing any gate knew about a video was that a
// mission's briefing_video file existed. Two shipped with no recorded
// generator (ASSET_PROVENANCE.md item 4) and nothing could notice a third.
//
// What it refuses:
//   - a file under assets/video/ with no manifest entry, or an entry with no file;
//   - a mission naming a video the manifest does not describe;
//   - an entry missing a field, or one that claims `commercial: "confirmed"`
//     while any of generator, terms_read, license or audio is unrecorded;
//   - a file over MAX_FILE_BYTES, or the directory over MAX_TOTAL_BYTES;
//   - in commercial mode (`pnpm validate:data -- --commercial`), any entry
//     that is not confirmed: that file cannot ship in a sold build.

/** 5 MiB a file: a 24 s 720p intro at ~1.2 Mbit/s is ~3.6 MB, with headroom. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 15 MiB for the directory: the report's ~15 MB budget (nine 8 s backdrops
 *  and the intro at ~1.2 Mbit/s come to ~14 MB). A constant in code, not a
 *  manifest field, so raising it is a reviewed change, not a JSON edit. */
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

const FIELDS = ['what', 'generator', 'source', 'license', 'terms_read', 'audio', 'commercial', 'record'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const mib = (b) => `${(b / 1048576).toFixed(2)} MiB`;

/**
 * @param {{ files?: Record<string, any> } | null} manifest data/video.json
 * @param {{ path: string, bytes: number }[]} onDisk every file under assets/video/, path as `video/<name>`
 * @param {string[]} referenced every mission's briefing_video
 * @param {{ commercial?: boolean }} [opts]
 * @returns {string[]} failures, empty when clean
 */
export function videoFailures(manifest, onDisk, referenced, opts = {}) {
  const failures = [];
  const where = 'data/video.json';
  const entries = manifest && typeof manifest.files === 'object' && manifest.files !== null ? manifest.files : null;
  if (entries === null) return [`${where}: "files" must be an object keyed by "video/<name>"`];

  const disk = new Map(onDisk.map((f) => [f.path, f.bytes]));
  for (const f of onDisk) {
    if (!/\.(mp4|webm)$/.test(f.path)) failures.push(`assets/${f.path}: only .mp4 and .webm belong in assets/video/`);
    if (!(f.path in entries)) failures.push(`assets/${f.path}: no provenance entry in ${where}`);
    if (f.bytes > MAX_FILE_BYTES) failures.push(`assets/${f.path}: ${mib(f.bytes)} is over the ${mib(MAX_FILE_BYTES)} per-file budget`);
  }
  const total = onDisk.reduce((s, f) => s + f.bytes, 0);
  if (total > MAX_TOTAL_BYTES) failures.push(`assets/video/: ${mib(total)} in all is over the ${mib(MAX_TOTAL_BYTES)} budget`);

  for (const ref of referenced) {
    if (!(ref in entries)) failures.push(`briefing_video "${ref}": no provenance entry in ${where}`);
  }

  for (const [path, e] of Object.entries(entries)) {
    const at = `${where} "${path}"`;
    if (!disk.has(path)) failures.push(`${at}: no such file at assets/${path}`);
    if (e === null || typeof e !== 'object') {
      failures.push(`${at}: must be an object`);
      continue;
    }
    for (const k of FIELDS) {
      if (!(k in e)) failures.push(`${at}: missing "${k}"`);
    }
    const g = e.generator;
    const generatorKnown =
      g !== null && typeof g === 'object' && ['tool', 'model_id', 'plan'].every((k) => typeof g[k] === 'string' && g[k].length > 0);
    if (g !== 'unrecorded' && !generatorKnown) {
      failures.push(`${at}: generator must be "unrecorded" or { tool, model_id, plan }`);
    }
    if (e.terms_read !== null && !(typeof e.terms_read === 'string' && DATE.test(e.terms_read))) {
      failures.push(`${at}: terms_read must be a YYYY-MM-DD date or null`);
    }
    if (!['none', 'generated', 'unrecorded'].includes(e.audio)) {
      failures.push(`${at}: audio must be "none", "generated" or "unrecorded"`);
    }
    if (!['confirmed', 'unconfirmed'].includes(e.commercial)) {
      failures.push(`${at}: commercial must be "confirmed" or "unconfirmed"`);
    }
    if (e.commercial === 'confirmed') {
      const gaps = [];
      if (!generatorKnown) gaps.push('generator');
      if (e.terms_read === null || e.terms_read === undefined) gaps.push('terms_read');
      if (typeof e.license !== 'string' || e.license === 'unrecorded' || e.license.length === 0) gaps.push('license');
      if (e.audio === 'unrecorded') gaps.push('audio');
      if (typeof e.source !== 'string' || e.source === 'unrecorded' || e.source.length === 0) gaps.push('source');
      if (gaps.length > 0) failures.push(`${at}: commercial "confirmed" with ${gaps.join(', ')} unrecorded`);
    } else if (opts.commercial) {
      failures.push(`${at}: commercial "${e.commercial}" -- cannot ship in a commercial build (ASSET_PROVENANCE.md)`);
    }
  }
  return failures;
}
