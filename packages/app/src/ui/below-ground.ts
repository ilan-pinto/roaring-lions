/**
 * The "Below ground" strip (GH-681, versus tunnels spec §4.2): a seat that
 * owns tunnel routes sees one chip per own unit inside one -- its icon, the
 * route's name, and when it reaches the vent ("12 s") or that it is there.
 * Selecting chips offers the two `vent` orders, **Vent: raid** (come up, fire,
 * go back down) and **Vent: exit** (come up for good); both are disabled,
 * with the reason, while every selected unit is still crawling, because the
 * sim refuses a vent to a unit that has not arrived (Q6).
 *
 * Mounted only for a seat that owns a route (`main.ts`): single-player and
 * the KDF seat never build it. Mounted on `document.body` by the battlefield,
 * so the battlefield's own disposer takes it down (the disposer contract).
 *
 * The chip selection is the strip's own, never the world's `renderer.selection`:
 * a buried unit has no body on the surface to select, ring or box.
 *
 * Reads the sim, never writes it: the two buttons hand a `vent` intent to the
 * battlefield's `dispatch`, the same path a right-click takes (transport in
 * single-player, the room's order sink in versus). Every string goes through
 * `t()`; nothing here is resolved at module load.
 */
import { t } from '../i18n/t';

/** Ticks per second of the sim's fixed clock (invariant 1). */
const TICKS_PER_S = 20;

/** The slice of `Sim['state']` the strip reads. */
export interface BelowGroundState {
  readonly alive: ArrayLike<number>;
  readonly side: ArrayLike<number>;
  readonly tunnelIn: ArrayLike<number>;
  readonly tunnelEta: ArrayLike<number>;
}

/** One buried unit as the strip shows it. */
export interface BelowChip {
  readonly id: number;
  readonly route: number;
  /** Whole seconds to the vent, rounded up; 0 when it is at the vent. */
  readonly etaS: number;
}

/**
 * Every living unit of side `viewer` inside a route, by id. A pure read of
 * the sim state: the viewer's OWN units only, so the strip can never list an
 * enemy below ground, whatever the caller passes.
 */
export function belowGroundChips(state: BelowGroundState, entityCount: number, viewer: number): BelowChip[] {
  const out: BelowChip[] = [];
  for (let i = 0; i < entityCount; i++) {
    if (state.alive[i] === 0 || state.side[i] !== viewer || state.tunnelIn[i] < 0) continue;
    out.push({ id: i, route: state.tunnelIn[i], etaS: Math.ceil(state.tunnelEta[i] / TICKS_PER_S) });
  }
  return out;
}

/** What the two vent buttons offer for the chips selected now. */
export interface VentOffer {
  /** The selected units that have reached the vent: the ones a `vent` moves. */
  readonly ids: number[];
  /** Why both buttons are off, or null when they are on. */
  readonly reason: string | null;
}

/**
 * The vent offer for `selected` among `chips`: the arrived ones, or a reason
 * the buttons are disabled -- nothing selected, or every selected unit still
 * crawling (the soonest arrival named). A selection that mixes the two vents
 * the arrived ones only; the sim would refuse the others anyway.
 */
export function ventOffer(chips: readonly BelowChip[], selected: ReadonlySet<number>): VentOffer {
  const picked = chips.filter((c) => selected.has(c.id));
  if (picked.length === 0) return { ids: [], reason: t('below.reason.none') };
  const ids = picked.filter((c) => c.etaS === 0).map((c) => c.id);
  if (ids.length > 0) return { ids, reason: null };
  const soonest = Math.min(...picked.map((c) => c.etaS));
  return { ids, reason: t('below.reason.crawling', { s: soonest }) };
}

/** A route's name for the chip: the compass word its id ends in (`tm_s_west`
 *  is the west tunnel), else its number among the routes. */
export function routeLabel(routeId: string | undefined, r: number): string {
  const dir = routeId?.split('_').pop();
  switch (dir) {
    case 'north':
    case 'south':
    case 'east':
    case 'west':
      return t(`below.route.${dir}`);
    default:
      return t('below.route.n', { n: r + 1 });
  }
}

export interface BelowGroundDeps {
  /** The sim's state view and its entity count, read on every `update`. */
  state(): BelowGroundState;
  entityCount(): number;
  readonly viewer: number;
  /** The route's authored id (`map.tunnels[r].id`), for its name. */
  routeId(r: number): string | undefined;
  /** The unit type id of entity `id`, for its icon and name. */
  typeOf(id: number): string;
  /** The unit's display name. */
  nameOf(typeId: string): string;
  /** Its portrait URL, or null for a letter tile. */
  iconOf(typeId: string): string | null;
  /** The battlefield's `dispatch`: the vent goes out as this seat's order. */
  vent(ids: number[], mode: 'raid' | 'exit'): void;
}

export interface BelowGroundStrip {
  /** Re-read the sim and repaint what changed. Cheap when nothing did. */
  update(): void;
  /** The chips selected now (a test reads it). */
  readonly selected: ReadonlySet<number>;
  readonly root: HTMLElement;
  dispose(): void;
}

/** Build the strip under `host` (the battlefield mounts it on `document.body`). */
export function mountBelowGround(host: HTMLElement, deps: BelowGroundDeps): BelowGroundStrip {
  const root = document.createElement('section');
  root.className = 'rl-below';
  root.hidden = true;
  root.setAttribute('aria-label', t('below.title'));
  const head = document.createElement('h2');
  head.className = 'rl-below__title';
  head.textContent = t('below.title');
  const list = document.createElement('ul');
  list.className = 'rl-below__chips';
  const row = document.createElement('div');
  row.className = 'rl-below__row';
  const raid = document.createElement('button');
  raid.type = 'button';
  raid.className = 'rl-btn rl-below__raid';
  raid.textContent = t('below.ventRaid');
  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'rl-btn rl-below__exit';
  exit.textContent = t('below.ventExit');
  const why = document.createElement('p');
  why.className = 'rl-below__why';
  row.append(raid, exit);
  root.append(head, list, row, why);
  host.appendChild(root);

  const selected = new Set<number>();
  let chips: BelowChip[] = [];
  /** What the last paint drew, so an unchanged tick touches no DOM. */
  let painted = '';
  let disposed = false;

  const paint = (): void => {
    const offer = ventOffer(chips, selected);
    const sig = `${chips.map((c) => `${c.id}:${c.route}:${c.etaS}:${selected.has(c.id) ? 1 : 0}`).join(',')}|${offer.reason ?? ''}`;
    if (sig === painted) return;
    painted = sig;
    root.hidden = chips.length === 0;
    list.replaceChildren(
      ...chips.map((c) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rl-below__chip';
        b.dataset.id = String(c.id);
        b.setAttribute('aria-pressed', selected.has(c.id) ? 'true' : 'false');
        const typeId = deps.typeOf(c.id);
        const url = deps.iconOf(typeId);
        const icon = document.createElement(url === null ? 'span' : 'img');
        icon.className = 'rl-below__icon';
        if (icon instanceof HTMLImageElement && url !== null) {
          icon.src = url;
          icon.alt = '';
        } else {
          icon.textContent = deps.nameOf(typeId).slice(0, 1);
        }
        const name = document.createElement('span');
        name.className = 'rl-below__name';
        name.textContent = deps.nameOf(typeId);
        const route = document.createElement('span');
        route.className = 'rl-below__route';
        route.textContent = routeLabel(deps.routeId(c.route), c.route);
        const eta = document.createElement('span');
        eta.className = 'rl-below__eta';
        eta.textContent = c.etaS === 0 ? t('below.atVent') : t('below.eta', { s: c.etaS });
        b.append(icon, name, route, eta);
        li.appendChild(b);
        return li;
      })
    );
    raid.disabled = offer.reason !== null;
    exit.disabled = offer.reason !== null;
    why.textContent = offer.reason ?? '';
    why.hidden = offer.reason === null;
  };

  const update = (): void => {
    if (disposed) return;
    chips = belowGroundChips(deps.state(), deps.entityCount(), deps.viewer);
    // A unit that came up, died or was collapsed on leaves the selection.
    const live = new Set(chips.map((c) => c.id));
    for (const id of [...selected]) if (!live.has(id)) selected.delete(id);
    paint();
  };

  list.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.rl-below__chip');
    if (!b) return;
    const id = Number(b.dataset.id);
    // Shift adds to the selection; a plain click selects that one chip, or
    // clears it when it was the only one.
    if (ev instanceof MouseEvent && ev.shiftKey) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    } else if (selected.size === 1 && selected.has(id)) {
      selected.clear();
    } else {
      selected.clear();
      selected.add(id);
    }
    paint();
  });
  const fire = (mode: 'raid' | 'exit'): void => {
    const offer = ventOffer(chips, selected);
    if (offer.reason !== null || offer.ids.length === 0) return;
    deps.vent(offer.ids, mode);
    for (const id of offer.ids) selected.delete(id);
    paint();
  };
  raid.addEventListener('click', () => fire('raid'));
  exit.addEventListener('click', () => fire('exit'));

  update();
  return {
    update,
    get selected() {
      return selected;
    },
    root,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.remove();
    },
  };
}
