// packages/app/src/ui/group-bar.ts
/**
 * The control-group bar (Task 11, R-2): a surface over the groups
 * `main.ts` already keeps in its own `Map<number, number[]>` -- this module
 * adds no state of its own. One chip per OCCUPIED slot: a slot nobody has
 * assigned draws nothing, and a slot whose every member has since died draws
 * nothing either, never an empty placeholder for either case. Each chip shows
 * the slot number, the living member count, and a `.rl-track` health bar
 * tinted with that slot's own colour (`GroupBarDeps.groupColor`, which
 * `main.ts` answers with `opts.groupColors[slot - 1]` -- the same nine
 * palette entries `renderer.unitGroup` already draws the badge over a unit's
 * head with, so the chip and the badge cannot drift apart).
 *
 * Chips are rebuilt wholesale on every `refresh()`, driven from the tick loop
 * beside `hud.onTick()` rather than from an event -- exactly like the HUD's
 * own selection-chip row. That is why the click is DELEGATED on the
 * container (`el`) instead of bound to each button: a listener bound
 * directly to a button `refresh()` is about to discard is discarded with it,
 * and only re-binding on every refresh would save it. One listener, bound
 * once at construction, needs no such bookkeeping and cannot go stale.
 */
import type { Disposer } from '../shell/router';

export interface GroupChip {
  slot: number;
  count: number;
  hpPct: number;
}

/**
 * `facts` mirrors `main.ts`'s own reading of `sim.state` plus the unit
 * type's max HP, and answers `null` for an id that no longer names a live
 * entity at all. `groupChips` treats `null` exactly like `alive: false`: a
 * dead or gone member is dropped from the count and from the average, it
 * does not zero the whole slot out. Slots are read out in ascending order
 * regardless of the map's own insertion order, so a chip row reads left to
 * right the way a player expects group numbers to.
 */
export function groupChips(
  groups: ReadonlyMap<number, readonly number[]>,
  facts: (id: number) => { alive: boolean; hp: number; hpMax: number } | null
): GroupChip[] {
  const chips: GroupChip[] = [];
  const slots = [...groups.keys()].sort((a, b) => a - b);
  for (const slot of slots) {
    const members = groups.get(slot) ?? [];
    let count = 0;
    let hpSum = 0;
    for (const id of members) {
      const f = facts(id);
      if (f === null || !f.alive) continue;
      count += 1;
      hpSum += f.hpMax > 0 ? f.hp / f.hpMax : 0;
    }
    // A slot every member of which has died shows nothing -- not a
    // zero-count chip nobody asked for and nothing anyone could click into.
    if (count > 0) chips.push({ slot, count, hpPct: hpSum / count });
  }
  return chips;
}

export interface GroupBarDeps {
  /** Read fresh on every `refresh()`, not closed over as a snapshot -- the
   *  same "thunk, not a value" shape `main.ts`'s other HUD deps use for
   *  anything that changes over a mission (`getMission`, `objectives`). */
  chips(): readonly GroupChip[];
  /** The SAME recall path the digit key runs (`main.ts`'s `recallGroup`) --
   *  not a second mechanism, per R-2. A single call recalls; two calls for
   *  the same slot inside the shared 400ms window centre the camera, because
   *  `recallGroup` keeps that state itself and does not care which input
   *  reached it. */
  onRecall(slot: number): void;
  /** A colour string straight off the palette (`main.ts`'s
   *  `opts.groupColors[slot - 1]`), set as an inline style on the track fill
   *  -- never a class and never written into this module's own CSS, so
   *  `pnpm validate:ui`'s literal scan has nothing here to find. */
  groupColor(slot: number): string;
}

function buildChip(chip: GroupChip, color: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rl-group';
  btn.dataset.slot = String(chip.slot);

  const slotEl = document.createElement('span');
  slotEl.className = 'rl-group__slot';
  slotEl.textContent = String(chip.slot);
  btn.appendChild(slotEl);

  const countEl = document.createElement('span');
  countEl.className = 'rl-group__count';
  countEl.textContent = String(chip.count);
  btn.appendChild(countEl);

  const track = document.createElement('div');
  track.className = 'rl-track';
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(chip.hpPct * 100)}%`;
  fill.style.background = color;
  track.appendChild(fill);
  btn.appendChild(track);

  return btn;
}

export function groupBar(
  host: HTMLElement,
  deps: GroupBarDeps
): { el: HTMLElement; refresh(): void; dispose: Disposer } {
  const el = document.createElement('div');
  el.className = 'rl-group-bar';

  // Delegated -- see the header. `refresh()` below throws every chip away
  // and rebuilds fresh ones; this listener, bound once on the stable
  // container, survives every one of those rebuilds untouched.
  const onClick = (ev: MouseEvent): void => {
    const chip = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.rl-group');
    if (!chip) return;
    const slot = Number(chip.dataset.slot);
    if (Number.isFinite(slot)) deps.onRecall(slot);
  };
  el.addEventListener('click', onClick);

  const refresh = (): void => {
    el.replaceChildren(...deps.chips().map((c) => buildChip(c, deps.groupColor(c.slot))));
  };
  refresh();

  host.appendChild(el);

  return {
    el,
    refresh,
    dispose: () => {
      el.removeEventListener('click', onClick);
      el.remove();
    },
  };
}
