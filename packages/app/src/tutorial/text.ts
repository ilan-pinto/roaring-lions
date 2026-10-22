/**
 * A tutorial step's words, resolved through t() at the moment they are read.
 *
 * The step JSON carries no text: its title, teach and nudge are catalogue keys
 * derived from the tutorial id and the step id (`tutorial.<id>.<step>.title`,
 * `.teach`, `.nudge`), so `?pseudo=1` brackets them and
 * `__lionsI18n.missingKeys()` sees them. Derived rather than stored because the
 * step ids are already pinned by telemetry, a stored key could drift from them,
 * and `validate:data` checks that every derived key exists.
 *
 * An accessor, never a table: resolving at module load would freeze whatever
 * locale was active before main.ts's boot called `setCatalogue`.
 */
import { t } from '../i18n/t';

export type StepTextField = 'title' | 'teach' | 'nudge';

export function stepTextKey(tutorialId: string, stepId: string, field: StepTextField): string {
  return `tutorial.${tutorialId}.${stepId}.${field}`;
}

export interface StepText {
  title: string;
  teach: string;
  /** Present only when the step declares `nudge_after_s`. */
  nudge?: string;
}

export function stepText(tutorialId: string, step: { id: string; nudge_after_s?: number }): StepText {
  const out: StepText = {
    title: t(stepTextKey(tutorialId, step.id, 'title')),
    teach: t(stepTextKey(tutorialId, step.id, 'teach')),
  };
  if (step.nudge_after_s !== undefined) out.nudge = t(stepTextKey(tutorialId, step.id, 'nudge'));
  return out;
}
