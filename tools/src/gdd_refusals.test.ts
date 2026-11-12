// GH-115: the three Command & Conquer refusals are written down in GDD section 10 ("Deferred"), so they stop being
// re-litigated. This pins that they stay there, as the design decisions they are; it reads the document, not the code.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GDD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'GDD.md'), 'utf8');

/** The text of section 10, up to the next top-level heading. */
function section10(): string {
  const start = GDD.indexOf('\n## 10. Deferred');
  expect(start, 'GDD has no "## 10. Deferred"').toBeGreaterThan(-1);
  const rest = GDD.slice(start + 1);
  const next = rest.indexOf('\n## ', 4);
  return next < 0 ? rest : rest.slice(0, next);
}

describe('GDD section 10 records the Command & Conquer refusals (GH-115)', () => {
  const s10 = section10();

  it('refuses the harvester loop, permanently', () => {
    expect(s10).toContain('The harvester loop is refused, permanently.');
  });

  it('adopts base building only as field works, and names what stays refused', () => {
    expect(s10).toContain('Base building is adopted as field works and field fortification, and nothing more');
    for (const refused of ['a construction yard', 'a power grid', 'selling', 'a build radius', 'tech prerequisites']) {
      expect(s10, refused).toContain(refused);
    }
  });

  it('refuses mirrored tech trees and a two-sided faction campaign', () => {
    expect(s10).toContain('Mirrored tech trees and a two-sided faction campaign are refused.');
  });

  it('keeps the claim it answers: section 1 still says the game is in the tradition', () => {
    expect(GDD).toContain('in the Command & Conquer tradition');
  });
});
