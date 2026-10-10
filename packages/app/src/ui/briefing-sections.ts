// Named briefing sections and the briefing image slot (GH-119,
// docs/superpowers/specs/2026-10-04-briefing-sections.md). Pure: no DOM, so
// the rules that decide what the deploy screen draws are proved without one.
//
// `briefing` stays the source of truth. Sections are a presentation of it and
// are trusted only while their texts still spell it -- which is what makes a
// locale overlay that translates `briefing` (and has no section overlay) fall
// back to the plain beats instead of drawing English headings over English
// prose under a translated commander bar.

import { briefingBeats } from './loading';

/** The closed set, in order. Mirrors mission.schema.json's enum and
 *  tools/validate_briefing.mjs's SECTION_IDS. */
export const SECTION_IDS = ['situation', 'mission', 'execution', 'notes'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** As authored. `id` is a plain string here because a JSON module types it
 *  that way; `briefingSections` is what narrows it. */
export interface AuthoredSection {
  id: string;
  text: string;
  image?: string;
}

export interface BriefingSection {
  id: SectionId;
  beats: string[];
  /** Path under assets/, unresolved -- the caller prefixes BASE. */
  image?: string;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

const isSectionId = (id: string): id is SectionId => (SECTION_IDS as readonly string[]).includes(id);

/**
 * The sections the deploy screen should draw, or null for the plain beats.
 *
 * Null when there are none, when any id is unknown, and when the texts joined
 * with one space no longer spell `briefing` (whitespace-normalised). The data
 * gate refuses the last two for shipped content; this is the runtime half, for
 * the overlay case the gate cannot see.
 */
export function briefingSections(
  briefing: string | undefined,
  sections: readonly AuthoredSection[] | undefined
): BriefingSection[] | null {
  if (briefing === undefined || sections === undefined || sections.length === 0) return null;
  if (norm(sections.map((s) => s.text).join(' ')) !== norm(briefing)) return null;
  const out: BriefingSection[] = [];
  for (const s of sections) {
    if (!isSectionId(s.id)) return null;
    const beats = briefingBeats(s.text);
    if (beats.length === 0) continue;
    out.push(s.image !== undefined ? { id: s.id, beats, image: s.image } : { id: s.id, beats });
  }
  return out.length > 0 ? out : null;
}

/**
 * One image out of `briefing_image`: the string itself, or one entry of a
 * pool. `random` is the source in [0, 1) -- `Math.random` in the app (this is
 * presentation, outside the sim), injected by tests.
 */
export function pickBriefingImage(
  image: string | readonly string[] | undefined,
  random: () => number = Math.random
): string | undefined {
  if (image === undefined) return undefined;
  if (typeof image === 'string') return image;
  if (image.length === 0) return undefined;
  const i = Math.min(image.length - 1, Math.max(0, Math.floor(random() * image.length)));
  return image[i];
}
