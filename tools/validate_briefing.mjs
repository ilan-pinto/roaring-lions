// The data gate's briefing-section and briefing-image checks (GH-119,
// docs/superpowers/specs/2026-10-04-briefing-sections.md). Pure: the caller
// hands in the mission and a file-exists probe, so the spec can drive it with
// fixtures. The schema already pins the id enum and the path pattern; these
// are the rules a schema cannot state, plus an explicit unknown-id message so
// the failure names the section rather than an enum index.

/** The closed set, in order. Mirrors mission.schema.json's enum and
 *  packages/app/src/ui/briefing-sections.ts's SECTION_IDS. */
export const SECTION_IDS = ['situation', 'mission', 'execution', 'notes'];

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * @param {string} id mission id, for the message
 * @param {any} mission the parsed mission JSON
 * @param {(assetPath: string) => boolean} exists whether `assets/<path>` is on disk
 * @returns {string[]} failures, empty when clean
 */
export function briefingFailures(id, mission, exists) {
  const failures = [];
  const where = `data/missions/${id}.json`;
  const sections = mission?.briefing_sections;
  const images = [];
  if (Array.isArray(sections)) {
    let last = -1;
    const seen = new Set();
    for (const s of sections) {
      const at = SECTION_IDS.indexOf(s?.id);
      if (at < 0) {
        failures.push(`${where}: briefing section "${s?.id}" is not one of ${SECTION_IDS.join(', ')}`);
        continue;
      }
      if (seen.has(s.id)) failures.push(`${where}: briefing section "${s.id}" appears twice`);
      else if (at < last) failures.push(`${where}: briefing section "${s.id}" is out of order (${SECTION_IDS.join(' > ')})`);
      seen.add(s.id);
      last = Math.max(last, at);
      if (typeof s.image === 'string') images.push(s.image);
    }
    const joined = norm(sections.map((s) => (typeof s?.text === 'string' ? s.text : '')).join(' '));
    if (typeof mission.briefing !== 'string' || joined !== norm(mission.briefing)) {
      failures.push(`${where}: briefing_sections do not spell briefing -- their texts joined with one space must equal it exactly`);
    }
  }
  const pool = mission?.briefing_image;
  if (typeof pool === 'string') images.push(pool);
  else if (Array.isArray(pool)) images.push(...pool.filter((p) => typeof p === 'string'));
  for (const img of images) {
    if (!exists(img)) failures.push(`${where}: briefing image "${img}" not found at assets/${img}`);
  }
  return failures;
}
