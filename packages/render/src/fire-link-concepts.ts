/**
 * The fire-link concept names and their parser -- pure, three-free, so the
 * app can parse `&firelink=` without reaching into the three entry point.
 * The concepts themselves are described in `three/units/fire-link.ts`.
 */

export type FireLinkConcept = 'ring' | 'ticks' | 'owned' | 'flash' | 'pulse' | 'legacy' | 'none';

export const FIRE_LINK_CONCEPTS: readonly FireLinkConcept[] = [
  'ring',
  'ticks',
  'owned',
  'flash',
  'pulse',
  'legacy',
  'none',
];

/** What a mission (and a sandbox with no flag) gets on this branch. */
export const DEFAULT_FIRE_LINK: readonly FireLinkConcept[] = ['ring'];

/**
 * Parses `ring,owned` into a concept list. Unknown names are returned
 * separately so the caller can warn by name rather than silently ignore a
 * typo. An empty or absent value is the default.
 */
export function parseFireLink(value: string | null | undefined): {
  concepts: readonly FireLinkConcept[];
  unknown: readonly string[];
} {
  if (value === null || value === undefined || value.trim() === '') return { concepts: DEFAULT_FIRE_LINK, unknown: [] };
  const concepts: FireLinkConcept[] = [];
  const unknown: string[] = [];
  for (const raw of value.split(',')) {
    const name = raw.trim();
    if (name === '') continue;
    if ((FIRE_LINK_CONCEPTS as readonly string[]).includes(name)) {
      if (!concepts.includes(name as FireLinkConcept)) concepts.push(name as FireLinkConcept);
    } else unknown.push(name);
  }
  return { concepts: concepts.length > 0 ? concepts : DEFAULT_FIRE_LINK, unknown };
}

/** True when the unit card should name the target. */
export function fireLinkShowsCard(concepts: readonly FireLinkConcept[]): boolean {
  return !concepts.includes('legacy') && !concepts.includes('none');
}

