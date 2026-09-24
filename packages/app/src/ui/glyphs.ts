// packages/app/src/ui/glyphs.ts
//
// A handful of single-character HUD glyphs, each shown in more than one
// screen, kept here so the two never drift out of sync by being retyped.
//
// GH-229 fix round 2: the top strip's Logistics field (`hud.ts`) and the
// reinforcements dock's own tile cost badge (`production.ts`) both name a
// LOGISTICS figure, and a player reading "520" on a tile with no icon and a
// credit balance next to it (the dock's own header, since fix round 1) read
// it as credits. Retyping "▣" a second time in `production.ts` would still
// look right today and say nothing about WHY the two must match if either
// ever changes -- importing the one constant is what keeps that true by
// construction rather than by two authors remembering the same character.
export const LOGISTICS_GLYPH = '▣';
