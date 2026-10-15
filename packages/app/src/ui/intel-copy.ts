/**
 * GH-113: the words for `intel-moments.ts`'s outputs. That module returns
 * catalogue keys and numbers; this is where they become text, at render
 * time, through `t()` -- so a locale set at boot is the one they read in.
 *
 * Unit names are catalogue DATA (`data/units/*.json`) with no schema rule
 * against `<` or `&`, and every line here is handed to `Hud.note` as markup,
 * so each name goes through the one escaper.
 */

import { t } from '../i18n/t';
import { escapeHtml } from './escape-html';
import type { IntelOutput } from './intel-moments';

/** The sweep's breakdown line: who it identified, by type, then the
 *  civilians standing in the circle. */
export function breakdownLine(out: Extract<IntelOutput, { kind: 'breakdown' }>): string {
  const parts = out.types.map((x) => (x.n === 1 ? escapeHtml(x.name) : t('intel.note.typeCount', { name: escapeHtml(x.name), n: x.n })));
  if (out.civilians > 0) parts.push(t('intel.note.civilians', { n: out.civilians }));
  return parts.join(' · ');
}

/** The strike's one line (decision 10): what it hit, never the Conduct
 *  number -- the ROE lines on the same tick already price it. */
export function strikeLine(out: Extract<IntelOutput, { kind: 'strikeResult' }>): string {
  const parts: string[] = [];
  if (out.down > 0) parts.push(t('intel.strike.down', { n: out.down }));
  if (out.hit > 0) parts.push(t('intel.strike.hit', { n: out.hit }));
  if (out.building) parts.push(t('intel.strike.building'));
  if (out.civiliansKilled > 0) parts.push(t('intel.strike.civilians', { n: out.civiliansKilled }));
  if (parts.length === 0) parts.push(t('intel.strike.none'));
  return t('intel.note.strikeResult', { effect: parts.join(' · ') });
}
