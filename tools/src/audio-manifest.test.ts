// A data file and the code that reads it cannot drift -- the shape
// `credits-data.test.ts` and `unit_icons.test.ts` established. This one pins
// the two UI cue sets `BattleAudio.playUi` (packages/render/src/audio.ts)
// expects to find in the shipped manifest: both declared on the `ui` event,
// and both shipping no clips yet, so the mixer's procedural synth is the
// sound a player actually hears until a real recording lands.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

const manifest = JSON.parse(readFileSync(`${REPO}data/audio.json`, 'utf8')) as {
  sets: Record<string, { event: string; gain?: number; variants: unknown[] }>;
};

describe('the UI cue sets', () => {
  it('declares ui_alert and ui_objective on the ui event', () => {
    expect(manifest.sets.ui_alert?.event).toBe('ui');
    expect(manifest.sets.ui_objective?.event).toBe('ui');
  });
  it('ships no files yet, so both fall back to the synth', () => {
    expect(manifest.sets.ui_alert.variants).toEqual([]);
    expect(manifest.sets.ui_objective.variants).toEqual([]);
  });
});
