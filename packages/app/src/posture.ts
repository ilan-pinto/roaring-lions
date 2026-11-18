/**
 * GH-1394: the campaign difficulty posture, as the app and the playtest harness apply it. One module so the two
 * cannot drift (the harness imports it, as it imports `campaign-pay.ts`).
 *
 * The posture is read from the CAMPAIGN LEDGER and nowhere else (`postureOf`), so no URL flag can change how a
 * campaign mission scores: `?fresh` reads an empty ledger, which is Standard. The overlay is applied once, to the
 * mission JSON, before anything reads it (briefing, objectives, the runtime, the debrief, a mid-mission save), so
 * every reader sees the mission the run is actually played on. Versus rooms and the sandbox never come through
 * here: they have no campaign mission. The tutorial produces nothing, so every posture is the identity there
 * (`postureApplies`).
 */
import { applyOverlays, postureOf, postures, reliefTriggerIndices, type OverlayMission } from '@lions/data';
import { reinforceKey } from '@lions/sim';

// GH-1394 slice 2: the deploy line and the defeat suggestion, for the battlefield, which already holds this module (one lazy
// load, not two). The campaign board loads `./ui/posture-ui` itself.
export { defeatSuggestion, deployPostureDeps, posturePicker, showsPosture } from './ui/posture-ui';

/** `mission` as the campaign ledger's posture plays it. Standard (and the tutorial under any posture): `mission`
 *  itself, by reference. `label` resolves the relief trigger's `label_key` (the app passes `t`). */
export function campaignMission<T extends OverlayMission>(
  mission: T,
  ledger: Readonly<Record<string, unknown>> | null | undefined,
  label?: (key: string) => string
): T {
  return applyOverlays(mission, { posture: postureOf(ledger) }, postures, label === undefined ? {} : { label });
}

/**
 * `loaned` (the `reinforceKey`s `loanedReinforcements` found) plus every body a posture's relief trigger brings:
 * the relief is ALWAYS on loan, so a survivor goes back to the lender and never joins the brigade's roster, and a
 * relief type counts as lent for R-2. Without it an Easier run would carry a free rifle squad home, which is the
 * one way the relief could pay more than Standard (the credit formula already ignores a reinforced body). Same set
 * back when the mission has no relief.
 */
export function withReliefOnLoan(
  mission: { triggers?: readonly unknown[] },
  loaned: ReadonlySet<string>
): ReadonlySet<string> {
  const relief = reliefTriggerIndices(mission);
  if (relief.length === 0) return loaned;
  const out = new Set(loaned);
  for (const i of relief) {
    const units = ((mission.triggers?.[i] as { do?: { units?: readonly unknown[] } } | undefined)?.do?.units ?? []).length;
    for (let j = 0; j < units; j++) out.add(reinforceKey(i, j));
  }
  return out;
}

/** GH-1395: the challenge code rides this same lazy chunk (main.ts loads `./posture` once, through importWithRetry), so
 *  nothing campaign-only reaches the entry chunk. */
export { amended, settleVictory, victoryMark, withChallengeMark } from './challenge';
