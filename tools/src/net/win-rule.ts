/**
 * How a match is won, in the words the standing prompt tells a model (GH-976 P2). `arena-prompt.md` describes
 * annihilation (lines 6 and 7); a room that plays a win mode swaps those two lines for the mode's rule and adds one line
 * on what to defend. The swap is by EXACT text, and throws when the prompt no longer holds the two lines it expects, so
 * an edit to the prompt cannot silently leave a points race described as an annihilation.
 *
 * Pure: strings in, strings out. Nothing here reads a room.
 */
import { WIN_MODES, type WinMode } from '@lions/net';

/** Lines 6 and 7 of `arena-prompt.md`, verbatim. */
export const ANNIHILATION_RULE = [
  '6. A side wins when the other has no combat unit left (annihilation).',
  '7. If every unit on both sides can no longer move, or the 25-minute limit comes, the side with the larger surviving force value wins; equal values draw.',
] as const;

/** The start of lines 8-10 of the prompt, which a mode's three lines push down by one. */
const SHIFTED = ['The arena may', 'Losing units costs', 'Positions are TILES'] as const;

/** Each mode's rule: how it is won, the fallback at the limit, and what to defend. */
const RULES: Readonly<Record<WinMode, { won: string; fallback: string; defend: string }>> = {
  points: {
    won: '6. This match is a POINTS RACE: the first side to bank the target of points wins at once, whatever force it has left. `observe` shows `points`: both sides\' points, the target, and every zone with what it pays a minute and who holds it. A zone pays its holder each second it holds it and pays nobody while an enemy unit contests it or while it stands empty. Destroying enemy units pays too: 1 point for every 100 of their value. A side with no combat unit left still loses (annihilation).',
    fallback: '7. If nobody reaches the target by the 25-minute limit, or every unit on both sides can no longer move, the side with the larger surviving force value wins; equal values draw.',
    defend: '8. Defend the ground you hold and your lead: a zone you leave empty or let an enemy contest stops paying you and may start paying them, and units sent chasing kills away from the zones lose the race to the side that holds them. Both sides\' points and every zone\'s holder are public; your enemy\'s units are not, so a held zone with nobody in sight near it may be contested soon.',
  },
  camp: {
    won: '6. This match is won by DESTROYING THE ENEMY CAMP: the first side to raze the other\'s camp wins at once, whatever force it has left. `observe` gives `enemyCamp`, the tile to attack. A side with no combat unit left still loses (annihilation).',
    fallback: '7. If neither camp falls by the 25-minute limit, or every unit on both sides can no longer move, the side with the larger surviving force value wins; equal values draw.',
    defend: '8. Defend your own camp (`camp` in `observe`): losing it loses the match, however many units you have left.',
  },
};

/** The standing prompt for a room that plays `mode` (null: annihilation, the prompt as it stands). */
export function applyWinRule(prompt: string, mode: WinMode | null): string {
  if (mode === null) return prompt;
  const rule = RULES[mode];
  const old = ANNIHILATION_RULE.join('\n');
  if (!prompt.includes(old)) throw new Error('arena-prompt.md no longer holds the annihilation lines this swap expects (lines 6 and 7)');
  // Lines 8-10 shift to 9-11 for the one added line (last first, so a renumbered line is never matched again).
  let out = prompt;
  for (let k = SHIFTED.length - 1; k >= 0; k--) {
    const at = `\n${8 + k}. ${SHIFTED[k]}`;
    if (!out.includes(at)) throw new Error(`arena-prompt.md has no line "${8 + k}. ${SHIFTED[k]}..." to renumber`);
    out = out.replace(at, `\n${9 + k}. ${SHIFTED[k]}`);
  }
  out = out.replace(old, `${rule.won}\n${rule.fallback}\n${rule.defend}`);
  return out.replace('## The game, in ten lines', '## The game, in eleven lines');
}

/** The mode a `--mode` value names: a known win mode, `annihilation` (null), or undefined for anything else. */
export function modeFlag(v: string): WinMode | null | undefined {
  if (v === 'annihilation') return null;
  return (WIN_MODES as readonly string[]).includes(v) ? (v as WinMode) : undefined;
}

/** The accepted `--mode` values, for a usage line. */
export const MODE_FLAG_VALUES = ['annihilation', ...WIN_MODES].join('|');
