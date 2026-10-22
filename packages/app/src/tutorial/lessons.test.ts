/**
 * PA-12: beats 6 and 9 of the shipped tutorial end on the LESSON, never on a
 * timer.
 *
 * Both used to carry an `elapsed_s` backstop (60 s and 120 s) that cleared the
 * beat whatever the player did, and in the first-session walk both lessons
 * were missed and both beats ended on that clock: beat 6 asked for a stillness
 * an attack-moving squad could not give, and beat 12's mortar walked into its
 * own minimum range and never fired. This walks the REAL step data through the
 * real reducer: a player who does the lesson clears the beat, and a player who
 * does nothing does not, however long they wait. The mission's own 720 s
 * `survive_until` is the backstop now, as it is for every other beat.
 *
 * GH-420 T4: beat 6 teaches the right-click on an identified enemy (the
 * `attack` intent). H still clears it, so a player who halts and lets the
 * squad pick its own shot is not stranded, and beat 12 accepts the right-click
 * as the order it gives the mortar.
 *
 * The world half -- that a halted or ordered squad really does fire with odds
 * on the panel, and that a halted or ordered mortar really does bill a round
 * into the flagged zone -- is `tools/src/tutorial_lessons_world.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { tutorials } from '@lions/data';
import type { MissionEvent, SimEvent } from '@lions/sim';
import { advance, initTutorial, type StepJson, type TutorialInput, type TutorialState } from './runtime';

const tutorial = (tutorials as Record<string, { steps: StepJson[] } | undefined>).beit_sahwan_0;
if (tutorial === undefined) throw new Error('beit_sahwan_0 tutorial missing');
const steps = tutorial.steps;

/** Open the named beat at `nowMs`, as `advance` does when the previous one clears. */
function openAt(id: string, nowMs: number): TutorialState {
  const index = steps.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`no step ${id}`);
  return { ...initTutorial(steps, nowMs), index };
}

/** Side lookup for the fake world: entity 1 is the player's, 2 the enemy's. */
const sideOf = (e: number): number => (e === 2 ? 1 : 0);

const fireAtEnemy: SimEvent = {
  kind: 'fire',
  tick: 1,
  shooter: 1,
  target: 2,
  weaponId: 'rifle',
  pHit: 0,
  roll: 0,
  willHit: false,
  breakdown: { accuracy: 0, rangeFalloff: 0, coverMod: 0, motionMod: 0, stanceMod: 0, suppressionMod: 0 },
};
const conductLine: MissionEvent = { kind: 'roe', tick: 1, penalty: 5, reason: 'fire into protected structure (z_clinic)', score: 95 };

/** Twelve minutes of nothing but frames, four a second -- longer than the
 *  mission's own 720 s backstop. */
function idle(s: TutorialState, fromMs: number): TutorialState {
  for (let t = fromMs; t <= fromMs + 720_000; t += 250) s = advance(s, { kind: 'tick' }, t);
  return s;
}

function feed(s: TutorialState, inputs: [number, TutorialInput][]): TutorialState {
  for (const [t, input] of inputs) s = advance(s, input, t);
  return s;
}

describe('beat 6, identify then shoot (PA-12, GH-420)', () => {
  const id = 'identify_then_shoot';
  const attackEnemy: TutorialInput = { kind: 'intent', intent: { kind: 'attack', ids: [1], target: 2 } };
  const haltSquad: TutorialInput = { kind: 'intent', intent: { kind: 'halt', ids: [1] } };
  const oddsOnEnemy = (projection: 'shot' | 'cover' | 'moving' | 'unidentified'): TutorialInput => ({
    kind: 'hover',
    entity: 2,
    structure: -1,
    sideOf,
    projection,
  });
  const shotTaken: TutorialInput = { kind: 'sim', event: fireAtEnemy, sideOf };
  const stillOpen = (s: TutorialState): boolean => s.steps[s.index].id === id;

  it('does not end on a timer when the player does nothing', () => {
    const s = idle(openAt(id, 0), 0);
    expect(stillOpen(s)).toBe(true);
  });

  it('does not end on the squad firing by itself, without the player ordering the shot or standing it still', () => {
    // The old failure: an attack-moving squad fires on its own. That alone is
    // not the lesson -- ordering the shot, or standing still for it, is.
    let s = openAt(id, 0);
    s = feed(s, [
      [1000, shotTaken],
      [2000, oddsOnEnemy('shot')],
    ]);
    s = idle(s, 3000);
    expect(stillOpen(s)).toBe(true);
  });

  it('ends when the player right-clicks an identified enemy, the panel gave odds, and the squad takes the shot', () => {
    let s = openAt(id, 0);
    s = feed(s, [
      [1000, oddsOnEnemy('unidentified')],
      [4000, oddsOnEnemy('cover')],
      [4500, attackEnemy],
    ]);
    expect(stillOpen(s)).toBe(true);
    s = feed(s, [[9500, shotTaken]]);
    expect(stillOpen(s)).toBe(false);
  });

  it('still ends when the player halts, the panel gives odds, and the squad takes the shot', () => {
    let s = openAt(id, 0);
    s = feed(s, [
      [1000, haltSquad],
      [4000, oddsOnEnemy('unidentified')],
    ]);
    expect(stillOpen(s)).toBe(true);
    s = feed(s, [
      [9000, oddsOnEnemy('cover')],
      [9500, shotTaken],
    ]);
    expect(stillOpen(s)).toBe(false);
  });

  it('needs all three legs: the order, the readable odds, and the shot', () => {
    const legs: Record<string, TutorialInput> = { order: attackEnemy, odds: oddsOnEnemy('shot'), shot: shotTaken };
    for (const missing of Object.keys(legs)) {
      let s = openAt(id, 0);
      let t = 1000;
      for (const [leg, input] of Object.entries(legs)) if (leg !== missing) s = advance(s, input, (t += 1000));
      s = idle(s, t);
      expect(stillOpen(s), `cleared without the ${missing} leg`).toBe(true);
    }
  });

  it('is not cleared by an ordinary move order: only the right-click on an enemy, or H, is the lesson', () => {
    let s = openAt(id, 0);
    s = feed(s, [
      [1000, { kind: 'intent', intent: { kind: 'order', verb: 'move', ids: [1], x: 20, y: 20, append: false } }],
      [2000, { kind: 'intent', intent: { kind: 'order', verb: 'attackMove', ids: [1], x: 20, y: 20, append: false } }],
      [3000, oddsOnEnemy('shot')],
      [4000, shotTaken],
    ]);
    s = idle(s, 5000);
    expect(stillOpen(s)).toBe(true);
  });

  it('teaches the right-click in its text, and keeps H for the squad that is halted instead', () => {
    const beat = steps.find((x) => x.id === id) as StepJson;
    for (const [what, text] of [['teach', beat.teach], ['nudge', beat.nudge ?? '']] as const) {
      expect(text, `beat 6 ${what} no longer names the right-click it awaits`).toMatch(/right-click/i);
      expect(text, `beat 6 ${what} dropped H, which still clears the beat`).toMatch(/\bH\b/);
    }
  });
});

describe('beat 12, what a shot costs (PA-12)', () => {
  const id = 'what_a_shot_costs';

  it('does not end on a timer when the player does nothing', () => {
    const s = idle(openAt(id, 0), 0);
    expect(s.index).toBe(steps.findIndex((x) => x.id === id));
    expect(s.done).toBe(false);
  });

  it('does not end on a Conduct line the player never ordered', () => {
    let s = openAt(id, 0);
    s = feed(s, [[20_000, { kind: 'mission', event: conductLine }]]);
    s = idle(s, 21_000);
    expect(s.done).toBe(false);
  });

  it('ends when the player holds the mortar and a round is billed', () => {
    let s = openAt(id, 0);
    s = feed(s, [
      [3000, { kind: 'intent', intent: { kind: 'halt', ids: [5] } }],
      [40_000, { kind: 'mission', event: conductLine }],
    ]);
    expect(s.done).toBe(true);
  });

  it('ends when the player right-clicks an enemy for the mortar and a round is billed (GH-420)', () => {
    let s = openAt(id, 0);
    s = feed(s, [
      [3000, { kind: 'intent', intent: { kind: 'attack', ids: [5], target: 2 } }],
      [40_000, { kind: 'mission', event: conductLine }],
    ]);
    expect(s.done).toBe(true);
  });

  it('is not cleared by selecting the mortar and nothing else', () => {
    let s = openAt(id, 0);
    s = feed(s, [
      [1000, { kind: 'intent', intent: { kind: 'select', ids: [5], via: 'click' } }],
      [40_000, { kind: 'mission', event: conductLine }],
    ]);
    s = idle(s, 41_000);
    expect(s.done).toBe(false);
  });

  it('holds the invoice beat open for its twelve seconds even when the bill comes at once', () => {
    let s = openAt(id, 0);
    s = feed(s, [
      [1000, { kind: 'intent', intent: { kind: 'halt', ids: [5] } }],
      [2000, { kind: 'mission', event: conductLine }],
    ]);
    expect(s.done).toBe(false);
    s = advance(s, { kind: 'tick' }, 12_500);
    expect(s.done).toBe(true);
  });
});
