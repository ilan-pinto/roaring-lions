/**
 * The tutorial-step funnel across GH-345's cut from fourteen beats to nine.
 *
 * Before the cut a `tutorial_step` event carried only an index and the length
 * of the list (`steps: 14`). Since it, the app also sends the beat's `id`, so
 * the funnel reads labels off the event itself and never needs a list that can
 * drift from `data/tutorial/beit_sahwan_0.json`. Rows with no `id` are the old
 * fourteen-step funnel: they stay readable, labelled from the list below (the
 * ids the file carried at `8fc0cf54e^`) and flagged `legacy`, never merged
 * into the nine beats -- index 3 meant `cover_is_terrain` then and means
 * something else now.
 */
export const LEGACY_TUTORIAL_STEP_IDS: readonly string[] = [
  'take_command',
  'move_by_bounds',
  'move_as_one',
  'cover_is_terrain',
  'fire_pins',
  'get_inside',
  'reach_and_patience',
  'mount_up',
  'armour_has_a_back',
  'and_armour_dies',
  'eyes_before_guns',
  'read_before_you_fire',
  'what_a_shot_costs',
  'command_groups',
];

export interface TutorialFunnelRow {
  step: number;
  steps: number;
  /** The beat id; null only for a legacy row whose list length is not the known fourteen. */
  id: string | null;
  legacy: boolean;
  players: number;
}

export interface RawTutorialRow {
  id: string | null;
  step: number;
  steps: number;
  players: number;
}

/** Current beats first in step order, then the legacy funnel in step order. */
export function labelTutorialRows(rows: readonly RawTutorialRow[]): TutorialFunnelRow[] {
  const out = rows.map((r): TutorialFunnelRow => {
    if (r.id !== null) return { step: r.step, steps: r.steps, id: r.id, legacy: false, players: r.players };
    const known = r.steps === LEGACY_TUTORIAL_STEP_IDS.length ? (LEGACY_TUTORIAL_STEP_IDS[r.step] ?? null) : null;
    return { step: r.step, steps: r.steps, id: known, legacy: true, players: r.players };
  });
  return out.sort((a, b) => Number(a.legacy) - Number(b.legacy) || a.step - b.step);
}
