/**
 * GH-1394 slice 2: the campaign posture where the player chooses it, and the one line that suggests it.
 *
 * - The PICKER (ruling D10): the campaign board's chip and the deploy screen's line, the only two writers of the
 *   `campaign.difficulty` ledger key. A disclosure whose summary names the posture and what it does to the grade and the pay
 *   (Easier: two stars at most and no carry credits, ruling 3), opening three rows, one per posture. Buttons, not radios: an
 *   arrow key walking a radio group would fire a change per step, and on the deploy line a change starts the briefing again.
 * - The SUGGESTION (ruling D11): one defeat-screen line naming Easier, never a change. It writes nothing; the player chooses.
 *
 * The tutorial gets none of it (ruling D12): `postureApplies` is false there, keyed on the ledger contract, never a name list.
 *
 * Loaded lazily (the board through `importWithRetry`, the battlefield through `./posture`, which re-exports this), so none of it
 * is on the entry chunk (`webgpu:bundle`); `posture-ui-wiring.test.ts` holds the boundary.
 *
 * Disposer contract: the picker owns what it makes. Its listeners are on its own elements and die with them; a click after
 * `dispose` writes nothing (`disposed`). On the deploy line, `freeze` closes it once Deploy is answered: a change there
 * restarts the mission, and after Deploy the mission has started.
 *
 * The deps each caller hands the picker are built HERE, by `boardPostureDeps` and `deployPostureDeps`, so the guards that keep
 * a `?fresh` run off the player's real ledger are unit-tested rather than held by a regex over `main.ts`.
 */
import { DIFFICULTY_LEDGER_KEY, POSTURE_IDS, postureApplies, postureOf, type OverlayMission, type PostureId } from '@lions/data';
import type { CampaignLedger } from '../ledger-store';
import { t } from '../i18n/t';
import { postureBlurb, postureLabel, postureNote } from './posture-copy';

/** `ledger` with its posture set to `id`. Standard is the ABSENT key (absent means Standard, D2), so choosing Standard after a
 *  look at Easier puts the ledger back byte for byte, and a mid-mission save made under Standard resumes again. A new object;
 *  `ledger` is not touched. */
export function withPosture(ledger: CampaignLedger, id: PostureId): CampaignLedger {
  const out: CampaignLedger = { ...ledger };
  if (id === 'standard') delete out[DIFFICULTY_LEDGER_KEY];
  else out[DIFFICULTY_LEDGER_KEY] = id;
  return out;
}

export interface PosturePickerDeps {
  /** `board`: the change applies from the next deploy. `deploy`: the change starts this briefing again (`onChanged`). */
  where: 'board' | 'deploy';
  /** The campaign ledger as it stands now. */
  read(): CampaignLedger;
  /** Writes the whole ledger; may throw (a refused write, a claim in progress), which the picker reports and survives. */
  write(ledger: CampaignLedger): void;
  /** False when nothing durable can be written (blocked storage, a `?fresh` run): the rows are shown, disabled. */
  canWrite: boolean;
  /** After a change was written. */
  onChanged?(id: PostureId): void;
}

export interface PosturePicker {
  el: HTMLElement;
  /** Disables every row for good, and a click after it writes nothing. The deploy line is frozen the moment Deploy is
   *  answered (GH-1394 slice 2 review, finding 2), so a late click cannot restart a mission that has started. Idempotent. */
  freeze(): void;
  dispose(): void;
}

/** The three members of the campaign `LedgerStore` the picker's deps use. */
export interface PostureLedgerStore {
  readonly available: boolean;
  readLedger(): CampaignLedger;
  writeLedger(l: CampaignLedger): void;
}

/** The board chip's deps: the store as it stands; a change applies from the next deploy. `?fresh` is not a sticky router key,
 *  so the board holds the real (purged) store and writes it. */
export function boardPostureDeps(store: PostureLedgerStore): PosturePickerDeps {
  return {
    where: 'board',
    read: () => store.readLedger(),
    write: (l) => store.writeLedger(l),
    canWrite: store.available,
  };
}

/**
 * The deploy line's deps. A change writes the ledger and starts this briefing again (`restart`).
 *
 * Under `?fresh` (`fresh`) the run booted on `ledger`, the empty ledger the boot read, and NOT on the store: a `?fresh`
 * landing on `/mission/<id>` does not purge it, so the store still holds the player's real campaign. The line then reads the
 * boot's ledger (it names the posture this run is on) and cannot write: a write would put `{ posture }` over every result,
 * roster and credit the player has.
 */
export function deployPostureDeps(o: { fresh: boolean; ledger: CampaignLedger; store: PostureLedgerStore; restart(): void }): PosturePickerDeps {
  const { fresh, ledger, store, restart } = o;
  return {
    where: 'deploy',
    read: () => (fresh ? ledger : store.readLedger()),
    write: (l) => store.writeLedger(l),
    canWrite: store.available && !fresh,
    onChanged: () => restart(),
  };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function posturePicker(deps: PosturePickerDeps): PosturePicker {
  let disposed = false;
  let frozen = false;
  const root = el('details', 'rl-posture');
  root.dataset.where = deps.where;
  const summary = el('summary', 'rl-posture__chip');
  const name = el('span', 'rl-posture__name');
  const note = el('span', 'rl-posture__note');
  summary.append(name, note);
  const rows = el('div', 'rl-posture__rows');
  rows.setAttribute('role', 'group');
  rows.setAttribute('aria-label', t('difficulty.group'));
  const buttons = POSTURE_IDS.map((id) => {
    const b = el('button', 'rl-posture__row');
    b.type = 'button';
    b.dataset.posture = id;
    b.append(el('span', 'rl-posture__row-name', postureLabel(id)), el('span', 'rl-posture__row-blurb', postureBlurb(id)));
    b.disabled = !deps.canWrite;
    b.addEventListener('click', () => choose(id));
    rows.append(b);
    return b;
  });
  const pays = el('p', 'rl-posture__pays', t('difficulty.pays'));
  const when = el('p', 'rl-posture__when', deps.canWrite ? t(deps.where === 'board' ? 'difficulty.when.board' : 'difficulty.when.deploy') : t('difficulty.locked'));
  const msg = el('p', 'rl-posture__msg');
  msg.setAttribute('role', 'status');
  msg.setAttribute('aria-live', 'polite');
  root.append(summary, rows, pays, when, msg);

  const paint = (): PostureId => {
    const now = postureOf(deps.read());
    root.dataset.posture = now;
    name.textContent = t('difficulty.chip', { name: postureLabel(now) });
    note.textContent = postureNote(now);
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.posture === now));
    return now;
  };

  function choose(id: PostureId): void {
    if (disposed || frozen || !deps.canWrite) return;
    const ledger = deps.read();
    if (postureOf(ledger) === id) return;
    try {
      deps.write(withPosture(ledger, id));
    } catch (err) {
      console.error('the posture write was refused:', err);
      msg.dataset.tone = 'bad';
      msg.textContent = t('difficulty.writeFailed', { name: postureLabel(paint()) });
      return;
    }
    delete msg.dataset.tone;
    msg.textContent = '';
    paint();
    deps.onChanged?.(id);
  }

  paint();
  return {
    el: root,
    freeze: () => {
      frozen = true;
      for (const b of buttons) b.disabled = true;
    },
    dispose: () => {
      disposed = true;
      root.remove();
    },
  };
}

/** Whether a mission shows the posture at all: a campaign mission, never the tutorial (ruling D12). */
export function showsPosture(mission: OverlayMission | undefined): mission is OverlayMission {
  return mission !== undefined && postureApplies(mission);
}

/**
 * The defeat screen's one line suggesting Easier (ruling D11), or null. Shown on a lost CAMPAIGN mission (never the tutorial,
 * never a sandbox) whose posture is not already Easier. Words only: nothing here or on the screen changes the posture.
 */
export function defeatSuggestion(
  result: 'victory' | 'defeat',
  mission: OverlayMission | undefined,
  ledger: Readonly<Record<string, unknown>> | null | undefined
): string | null {
  if (result !== 'defeat' || !showsPosture(mission) || postureOf(ledger) === 'easier') return null;
  return t('difficulty.suggest.easier');
}
