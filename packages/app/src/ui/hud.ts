// The player's HUD: the top strip, the hold clock, the commander, the event
// feed, and the unit card.
//
// This used to live inside DebugOverlay, in @lions/render, which put the face
// of the game inside the development instrument and inside the rendering
// package. Both were wrong. The HUD is shell (CLAUDE.md: app owns "shell,
// input, UI"), and it is what a player looks at continuously; the roll feed and
// the detection maths that stayed behind in the overlay are what a developer
// looks at while tuning the model.
//
// The layout is map-first as of GH-153. Three stacked `rl-panel` sections in
// the corners covered about a third of a 1440x900 viewport and hid the corner
// a player pans toward most; everything a player reads continuously is now
// edge-anchored, unpanelled, and 8px off the frame. The one panel left on the
// mission screen is projected fire, and it earns its box by being dense,
// transient, and read against whatever the cursor is over.
//
// What this slice does NOT own, and what still draws the way it did: the
// selection card (`this.card`), which the multi-select chip row and the 460px
// single-unit card replace in a later slice, and the production panel in
// production.ts, which the reinforcements dock replaces.
//
// Nothing here reads or writes sim state — it renders what the sim reports
// (invariant 4). The arithmetic is in hud-model.ts so that the strip's inline
// clock and the big centred clock cannot derive the same number twice.

import { fx, type Sim } from '@lions/sim';
import { panel, type Panel } from './panel';
import { flash, leave, titleCard } from './motion';
import { markSvg } from './mark';
import { ROLE_GLYPH, roleBucket } from './role';
import {
  beatDwellMs,
  countSuppressed,
  holdClock,
  objectiveGlyph,
  roeTone,
  stepBeat,
  stripObjectives,
  worstPenalties,
  type MissionView,
  type Tone,
} from './hud-model';

export type { MissionView, ObjectiveView, Tone } from './hud-model';

/**
 * Who delivers the orders.
 *
 * A constant and not mission data, because there is no data to read: the
 * mission schema carries `briefing` prose and no `speaker`. Naming him here is
 * honest about that; inventing a `commander` field and filling it with the
 * same string in thirteen files would not be. Extending the schema is the
 * right fix and it is not this slice's.
 */
const COMMANDER = { rank: 'Lt Col Dagan', plate: 'Dagan' };

/** The feed is punctuation, not a log. Four lines is what fits above the dock
 *  without the stack reaching the reinforcements tiles. */
const FEED_LINES = 4;

/** How far the projected-fire panel sits from the target it describes. Right
 *  and slightly up, so it never covers the unit the player is aiming at. */
const FIRE_OFFSET = { x: 36, y: -8 };

export interface HudDeps {
  sim: Sim;
  getSelection: () => number[];
  getMission: () => MissionView | null;
  hoverStructure: () => number;
  hoverEntity: () => number;
  gameVersion: string;
  /** Game speed as a multiplier: 0 paused, 1 normal, 2 double. The strip owns
   *  the buttons; the frame loop owns the number. */
  getSpeed?: () => number;
  setSpeed?: (speed: number) => void;
  /** Audio state, mirrored by the `m` key. Returns the new muted state. */
  isMuted?: () => boolean;
  toggleMute?: () => void;
}

export class Hud {
  private readonly strip: HTMLDivElement;
  private readonly stripBody: HTMLDivElement;
  private readonly stripInfo: HTMLDivElement;
  private readonly speedChips: { el: HTMLButtonElement; speed: number }[] = [];
  private readonly muteChip: HTMLButtonElement;
  private readonly card: Panel;
  private readonly clock: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly fire: HTMLDivElement;
  private readonly cmd: HTMLDivElement;
  private readonly cmdQuote: HTMLDivElement;
  private readonly cmdWho: HTMLSpanElement;
  private readonly cmdFill: HTMLElement;
  private readonly cmdPrev: HTMLButtonElement;
  private readonly cmdNext: HTMLButtonElement;
  private readonly banner: HTMLDivElement;
  private bannerShown = false;
  private tickN = 0;

  /** The mission's briefing, split into the beats it is delivered in. */
  private beats: string[] = [];
  private beatIdx = 0;
  private beatTimer = 0;

  /** Objective status and ROE from the previous refresh, so a change can be
   *  punctuated. Without this the HUD can only show state, never report that
   *  state just changed — and a completed objective is exactly the thing a
   *  player misses while looking somewhere else on the map. */
  private lastStatus = new Map<string, string>();
  private lastRoe: number | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly deps: HudDeps
  ) {
    this.strip = document.createElement('div');
    this.strip.className = 'rl-strip';

    // Three runs, for two different reasons.
    //
    // Left and right, because the strip's two halves report different things:
    // what the mission wants (name, ROE, the objective in hand) and what the
    // force has (resources, suppression, the controls). The right half is
    // pushed over by `rl-strip__gap`.
    //
    // Rebuilt and persistent, because the mission fields are innerHTML'd
    // wholesale four times a second while the speed chips, the campaign link
    // and the mute toggle carry listeners. One innerHTML over both would drop
    // those listeners 4 Hz and break the very first click on any of them.
    //
    // `display: contents` on the rebuilt runs so the strip's own flex gap
    // falls between the fields rather than around a wrapper holding them all.
    this.stripBody = document.createElement('div');
    this.stripBody.style.display = 'contents';
    this.stripInfo = document.createElement('div');
    this.stripInfo.style.display = 'contents';

    const mark = document.createElement('span');
    mark.className = 'rl-strip__mark';
    mark.innerHTML = markSvg(15, 12);
    mark.title = `Roaring Lions${deps.gameVersion ? ` v${deps.gameVersion}` : ''}`;

    const right = document.createElement('div');
    right.className = 'rl-strip__right rl-strip__gap';
    right.appendChild(this.stripInfo);
    this.strip.append(mark, this.stripBody, right);

    // Speed. Rendered even where the frame loop has not wired it, because a
    // strip that grows a control the moment a dependency appears is a strip
    // whose layout nobody has actually looked at.
    const chips = document.createElement('div');
    chips.className = 'rl-strip__chips';
    for (const spec of [
      { speed: 0, label: '▮▮', title: 'pause' },
      { speed: 1, label: '1×', title: 'normal speed' },
      { speed: 2, label: '2×', title: 'double speed' },
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-strip__chip';
      b.textContent = spec.label;
      b.title = spec.title;
      b.addEventListener('click', () => {
        deps.setSpeed?.(spec.speed);
        // Repainted here and not on the next tick, deliberately: at speed 0 no
        // tick ever comes, so a pause button that waits for one never lights.
        this.paintSpeed();
        b.blur(); // keep the keyboard on the battlefield, not the button
      });
      this.speedChips.push({ el: b, speed: spec.speed });
      chips.appendChild(b);
    }

    // The map page is always one click away, mid-mission included. A plain
    // navigation, so leaving a fight costs the attempt -- deliberately.
    const campaign = document.createElement('a');
    campaign.className = 'rl-strip__link';
    campaign.href = '?campaign';
    campaign.textContent = '⌂';
    campaign.title = 'campaign map';

    this.muteChip = document.createElement('button');
    this.muteChip.type = 'button';
    this.muteChip.className = 'rl-strip__chip';
    this.muteChip.addEventListener('click', () => {
      deps.toggleMute?.();
      this.paintMute();
      this.muteChip.blur();
    });

    right.append(chips, campaign, this.muteChip);
    this.paintSpeed();
    this.paintMute();

    this.card = panel({
      rank: 'inspect',
      title: 'Selection',
      place: 'right:var(--s2);bottom:var(--s2);width:var(--rail-right);max-height:46vh',
    });
    this.card.hide();

    this.clock = document.createElement('div');
    this.clock.className = 'rl-clock';
    this.clock.style.display = 'none';

    this.feed = document.createElement('div');
    this.feed.className = 'rl-feed';

    this.hint = document.createElement('div');
    this.hint.className = 'rl-hint rl-onmap';

    this.fire = document.createElement('div');
    this.fire.className = 'rl-fire';
    this.fire.style.display = 'none';

    // --- commander ---------------------------------------------------------
    this.cmd = document.createElement('div');
    this.cmd.className = 'rl-cmd';
    this.cmd.dataset.open = '0';
    this.cmd.style.display = 'none';

    const face = document.createElement('div');
    face.className = 'rl-cmd__face';
    face.title = COMMANDER.rank;
    // The collapsed frame is the way back in. A briefing the player dismissed
    // by looking away is otherwise unreadable for the rest of the mission.
    face.addEventListener('click', () => this.openCommander());
    const plate = document.createElement('span');
    plate.className = 'rl-cmd__plate';
    plate.textContent = COMMANDER.plate;
    face.appendChild(plate);

    const bar = document.createElement('div');
    bar.className = 'rl-cmd__bar';
    const head = document.createElement('div');
    head.className = 'rl-cmd__head';
    this.cmdWho = document.createElement('span');
    this.cmdWho.className = 'rl-cmd__who';
    const paging = document.createElement('div');
    paging.className = 'rl-cmd__page';
    this.cmdPrev = document.createElement('button');
    this.cmdPrev.type = 'button';
    this.cmdPrev.textContent = '◂';
    this.cmdPrev.title = 'previous';
    this.cmdNext = document.createElement('button');
    this.cmdNext.type = 'button';
    this.cmdNext.textContent = '▸';
    this.cmdNext.title = 'next';
    this.cmdPrev.addEventListener('click', () => this.pageCommander(-1));
    this.cmdNext.addEventListener('click', () => this.pageCommander(1));
    paging.append(this.cmdPrev, this.cmdNext);
    head.append(this.cmdWho, paging);

    this.cmdQuote = document.createElement('div');
    const track = document.createElement('div');
    track.className = 'rl-cmd__track';
    this.cmdFill = document.createElement('i');
    track.appendChild(this.cmdFill);
    bar.append(head, this.cmdQuote, track);
    this.cmd.append(face, bar);

    this.banner = document.createElement('div');
    this.banner.className = 'rl-bigbanner';
    this.banner.style.display = 'none';

    host.append(
      this.strip,
      this.cmd,
      this.clock,
      this.card.el,
      this.feed,
      this.hint,
      this.fire,
      this.banner
    );
  }

  /** Mission start punctuation. */
  announce(name: string, subtitle: string, holdMs?: number): void {
    titleCard(this.host, name, subtitle, holdMs);
  }

  /**
   * Hand the commander his orders.
   *
   * Beats come from `briefingBeats()` in loading.ts, which is the same split
   * the deployment screen reads the briefing out in — so the bar continues a
   * conversation the player has already started rather than opening a second,
   * differently-punctuated one.
   */
  brief(beats: string[]): void {
    this.beats = beats;
    this.beatIdx = 0;
    if (beats.length === 0) {
      this.cmd.style.display = 'none';
      return;
    }
    this.cmd.style.display = '';
    this.openCommander();
  }

  onTick(): void {
    this.updateBanner();
    // A full innerHTML rebuild at 20 Hz stalls the page exactly when combat
    // floods events. 4 Hz reads identically.
    if (this.tickN++ % 5 !== 0) return;
    this.renderStrip();
    this.renderCard();
    this.renderClock();
    this.renderHint();
    this.renderFire();
  }

  /**
   * Put the projected-fire panel beside the thing it describes.
   *
   * Called from the frame loop rather than from `onTick`, because at 4 Hz a
   * panel anchored to a moving target visibly steps along behind it. Only the
   * position moves here; the rows are rebuilt on the tick with everything
   * else, which is the cadence the content actually changes at.
   */
  placeFire(x: number, y: number): void {
    this.fire.style.left = `${Math.round(x + FIRE_OFFSET.x)}px`;
    this.fire.style.top = `${Math.round(y + FIRE_OFFSET.y)}px`;
  }

  /** Mirror the audio state the `m` key just changed. */
  paintMute(): void {
    const muted = this.deps.isMuted?.() ?? false;
    this.muteChip.textContent = muted ? '🔇' : '🔊';
    this.muteChip.title = muted ? 'audio muted' : 'audio on';
    this.muteChip.dataset.on = muted ? '0' : '1';
  }

  private paintSpeed(): void {
    const now = this.deps.getSpeed?.() ?? 1;
    for (const { el, speed } of this.speedChips) el.dataset.on = speed === now ? '1' : '0';
  }

  /** Mission-level narration — objectives, triggers, waves, refusals. */
  note(html: string, tone: Tone = 'live'): void {
    const el = document.createElement('div');
    el.className = `rl-notice rl-enter rl-onmap rl-${tone}`;
    el.innerHTML = html;
    this.feed.prepend(el);
    while (this.feed.childElementCount > FEED_LINES) {
      this.feed.lastElementChild?.remove();
    }
    // Notices are punctuation, not a log — the roll feed in the debug overlay
    // is where history lives. These clear themselves so the map stays visible.
    window.setTimeout(() => leave(el), 9000);
  }

  private updateBanner(): void {
    const m = this.deps.getMission();
    if (!m || m.result === 'ongoing' || this.bannerShown) return;
    this.bannerShown = true;
    this.banner.textContent = m.result === 'victory' ? 'Mission accomplished' : 'Mission failed';
    this.banner.dataset.result = m.result;
    this.banner.style.display = 'block';
    this.banner.classList.add('rl-banner-in');
  }

  // ------------------------------------------------------------------
  // Commander: the briefing, delivered a beat at a time.
  // ------------------------------------------------------------------

  private openCommander(): void {
    if (this.beats.length === 0) return;
    this.cmd.dataset.open = '1';
    this.renderCommander();
  }

  private pageCommander(dir: number): void {
    this.beatIdx = stepBeat(this.beatIdx, this.beats.length, dir);
    this.renderCommander();
  }

  private renderCommander(): void {
    const total = this.beats.length;
    const text = this.beats[this.beatIdx] ?? '';
    this.cmdWho.textContent = `${COMMANDER.rank} · ${this.beatIdx + 1} / ${total}`;
    this.cmdQuote.textContent = `“${text}”`;
    this.cmdFill.style.width = `${(((this.beatIdx + 1) / total) * 100).toFixed(0)}%`;
    this.cmdPrev.disabled = this.beatIdx === 0;
    this.cmdNext.disabled = this.beatIdx === total - 1;
    // Each beat gets its own dwell, restarted by paging. The bar folds back to
    // the portrait rather than vanishing: the orders stay one click away.
    window.clearTimeout(this.beatTimer);
    this.beatTimer = window.setTimeout(() => {
      this.cmd.dataset.open = '0';
    }, beatDwellMs(text));
  }

  // ------------------------------------------------------------------
  // Top strip: the mission, in one line, always.
  // ------------------------------------------------------------------

  private renderStrip(): void {
    const m = this.deps.getMission();
    const rows: string[] = [];
    if (m) {
      // The campaign summary has no field of its own in a 30px strip. It rides
      // the mission name's tooltip rather than being dropped: it is a
      // between-missions fact, not something read mid-fight.
      rows.push(
        `<span class="rl-strip__name"${m.campaign ? ` title="${escapeAttr(m.campaign)}"` : ''}>${m.name}</span>`
      );
      if (m.roe !== undefined) {
        rows.push(
          `<span><b class="rl-${roeTone(m.roe)}" data-roe>${m.roe}</b> <span class="rl-dim">ROE</span></span>`
        );
      }
      const { primary, secondaryOpen } = stripObjectives(m);
      const hold = holdClock(m);
      if (primary) {
        // The clock is stamped inline ONLY when it belongs to this objective.
        // A hold running on a secondary while the strip shows a primary would
        // otherwise read as the primary's own timer.
        const inline =
          hold && hold.id === primary.id
            ? ` <b class="${hold.tone ? `rl-${hold.tone}` : ''}">${hold.text}</b>`
            : '';
        const tone =
          primary.status === 'complete' ? 'rl-good' : primary.status === 'failed' ? 'rl-bad' : '';
        rows.push(
          `<span class="rl-strip__obj ${tone}" data-obj="${escapeAttr(primary.id)}">` +
            `${objectiveGlyph(primary.status)} ${primary.text}${inline}</span>`
        );
      }
      if (secondaryOpen > 0) {
        rows.push(`<span class="rl-dim">+${secondaryOpen} secondary</span>`);
      }
    } else {
      rows.push('<span class="rl-strip__name">Roaring Lions</span>');
    }

    const info: string[] = [];
    if (m?.logistics !== undefined) {
      const rate =
        m.logisticsRate !== undefined && m.logisticsRate > 0
          ? ` <span class="rl-dim">+${m.logisticsRate}/min</span>`
          : '';
      info.push(`<span class="rl-info" title="logistics">▣ <b>${m.logistics}</b>${rate}</span>`);
    }
    if (m?.intel !== undefined) {
      info.push(`<span class="rl-info" title="intel">◎ <b>${m.intel}</b></span>`);
    }
    // Suppression: shown only when there is some. A permanent "0 pinned" is
    // the kind of field a player learns to stop reading.
    const { pinned, broken } = countSuppressed(this.deps.sim.state, this.deps.sim.entityCount);
    if (pinned > 0) info.push(`<span class="rl-hot"><b>▼ ${pinned} pinned</b></span>`);
    if (broken > 0) info.push(`<span class="rl-bad"><b>⚑ ${broken} broken</b></span>`);

    this.stripBody.innerHTML = rows.join('');
    this.stripInfo.innerHTML = info.join('');
    this.punctuate(m);
  }

  /** Flash what just changed. Runs after the rebuild, on the fresh nodes. */
  private punctuate(m: MissionView | null): void {
    if (!m) return;
    for (const o of m.objectives) {
      const prev = this.lastStatus.get(o.id);
      this.lastStatus.set(o.id, o.status);
      if (prev === undefined || prev === o.status) continue;
      const row = this.stripBody.querySelector<HTMLElement>(`[data-obj="${CSS.escape(o.id)}"]`);
      if (row) flash(row, o.status === 'complete' ? 'rl-flash-good' : 'rl-flash-bad', 400);
    }
    if (m.roe !== undefined) {
      const dropped = this.lastRoe !== null && m.roe < this.lastRoe;
      this.lastRoe = m.roe;
      const el = this.stripBody.querySelector<HTMLElement>('[data-roe]');
      if (dropped && el) flash(el, 'rl-flash-bad', 300);
    }
  }

  // ------------------------------------------------------------------
  // Bottom centre: what the controls are, while nothing is selected.
  // ------------------------------------------------------------------

  private renderHint(): void {
    if (this.deps.getSelection().length > 0) {
      this.hint.style.display = 'none';
      return;
    }
    this.hint.style.display = '';
    // One line, not the three-line block this replaces. That block was a panel
    // section with room to spare; on bare map it is a wall, and measured at
    // 1440 the full key list wrapped to two lines and read as a paragraph
    // sitting on the battlefield. The verb keys (h/f/g/u) are deliberately not
    // here: the order row a later slice puts in this same place names them as
    // buttons, and the unit card's Capabilities section already does.
    this.hint.textContent =
      'click/drag select · right-click attack-move · shift adds a waypoint · ' +
      'ctrl+1–9 group · 1–9 recall';
  }

  // ------------------------------------------------------------------
  // Projected fire: what a shot costs, before it is taken.
  // ------------------------------------------------------------------

  /**
   * Projected P(hit) for each selected unit against the hovered enemy.
   *
   * GDD 5.8: the player should know what a shot costs before taking it. Rows
   * are capped because selecting the whole force must not bury the map, and
   * units that cannot engage are counted rather than listed — "3 cannot reach"
   * is information, three empty rows are not.
   */
  private renderFire(): void {
    const html = this.projectedFireHtml();
    this.fire.style.display = html === '' ? 'none' : '';
    if (html !== '') this.fire.innerHTML = html;
  }

  private projectedFireHtml(): string {
    const sim = this.deps.sim;
    const t = this.deps.hoverEntity();
    if (t < 0 || sim.state.alive[t] === 0) return '';
    const sel = this.deps.getSelection().filter((i) => sim.state.alive[i] === 1);
    if (sel.length === 0) return '';

    const MAX_ROWS = 6;
    const rows: string[] = [];
    let cannot = 0;
    let unidentified = 0;
    let holdingFire = 0;
    for (const s of sel) {
      const p = sim.projectHit(s, t);
      if (p.kind === 'unidentified') {
        unidentified++;
        continue;
      }
      if (p.kind === 'noSolution') {
        cannot++;
        continue;
      }
      if (p.kind === 'holdingFire') {
        holdingFire++;
        continue;
      }
      if (rows.length >= MAX_ROWS) continue;
      const name = sim.unitTypes[sim.state.typeIdx[s]].name;
      const chance = Math.round(fx.toNumber(p.pHit) * 100);
      // Name only the factors actually degrading the shot, worst first.
      // accuracy is the weapon's baseline, not a penalty the player can act on.
      const worst = worstPenalties([
        ['range', fx.toNumber(p.factors.rangeFalloff)],
        ['cover', fx.toNumber(p.factors.coverMod)],
        ['target moving', fx.toNumber(p.factors.motionMod)],
        ['firing on the move', fx.toNumber(p.factors.stanceMod)],
        ['suppressed', fx.toNumber(p.factors.suppressionMod)],
      ]);
      const why = worst.length > 0 ? ` · ${worst.join(' · ')}` : '';
      const bounce = p.hurts ? '' : ' · <span class="rl-bad">cannot penetrate</span>';
      rows.push(
        `<div>${name} <b>${chance}%</b> <span class="rl-dim">${p.weaponId}${why}</span>${bounce}</div>`
      );
    }

    const target = sim.unitTypes[sim.state.typeIdx[t]].name;
    const head = `<div class="rl-label">Projected fire · ${target}</div>`;
    if (rows.length === 0 && unidentified > 0 && cannot === 0 && holdingFire === 0) {
      return head + '<div class="rl-dim">contact not identified — no firing solution</div>';
    }
    // Pinned or lying in ambush is a different fact from "cannot reach" —
    // the shot exists, the unit is choosing (or forced) not to take it.
    if (rows.length === 0 && holdingFire > 0 && cannot === 0 && unidentified === 0) {
      return head + '<div class="rl-dim">pinned — holding fire</div>';
    }
    if (rows.length === 0) return head + '<div class="rl-dim">no unit can engage</div>';

    const extra = sel.length - rows.length - cannot - unidentified - holdingFire;
    const tail: string[] = [];
    if (extra > 0) tail.push(`and ${extra} more`);
    if (cannot > 0) tail.push(`${cannot} cannot reach`);
    if (holdingFire > 0) tail.push(`${holdingFire} holding fire`);
    if (unidentified > 0) tail.push(`${unidentified} unidentified`);
    const foot = tail.length > 0 ? `<div class="rl-dim">${tail.join(' · ')}</div>` : '';
    return head + rows.join('') + foot;
  }

  // ------------------------------------------------------------------
  // Unit card: what it is, how it is doing, what it can do.
  //
  // Unchanged by GH-153's foundation slice on purpose. The 150px chip row and
  // the 460px card that replace it are a later slice; leaving this working
  // means the mission screen never goes through a state with no inspector.
  // ------------------------------------------------------------------

  private renderCard(): void {
    const sim = this.deps.sim;
    const sel = this.deps.getSelection();
    if (sel.length === 0) {
      this.card.hide();
      return;
    }
    const wasHidden = !this.card.visible;
    this.card.show();

    const st = sim.state;
    const id = sel[0];
    const type = sim.unitTypes[st.typeIdx[id]];
    const hpNow = fx.toNumber(st.hp[id]);
    const hpMax = fx.toNumber(type.hp);
    const hpPct = hpMax > 0 ? Math.max(0, hpNow / hpMax) : 0;
    const hpTone = hpPct > 0.5 ? 'good' : hpPct > 0.25 ? 'warn' : 'bad';
    const vet = st.veterancy[id];
    const glyph = ROLE_GLYPH[roleBucket(type)];

    this.card.setTitle(type.name);
    this.card.setTag(sel.length > 1 ? `+${sel.length - 1} more` : (type.role ?? 'unit'));

    const rows: string[] = [];
    // Placeholder frame: real portraits drop in here when the art pipeline
    // produces them (ART_PIPELINE §10), without moving anything else.
    rows.push(
      `<div class="rl-card__head"><div class="rl-card__icon" title="${type.id}">${glyph}</div>` +
        `<div class="rl-card__vitals">` +
        (vet > 0 ? `<div class="rl-warn">${'★'.repeat(vet)}</div>` : '') +
        `<div class="rl-track"><i class="rl-fill-${hpTone}" style="width:${(hpPct * 100).toFixed(0)}%"></i></div>` +
        `<div class="rl-dim">${hpNow.toFixed(0)} / ${hpMax.toFixed(0)} hp</div>` +
        `</div></div>`
    );

    // Condition: only what is actually true right now.
    const flags: string[] = [];
    if (st.routed[id] === 1) flags.push('<span class="rl-bad">BROKEN</span>');
    else if (st.pinned[id] === 1) flags.push('<span class="rl-hot">PINNED</span>');
    if (st.garrisonedIn[id] >= 0) flags.push('<span class="rl-live">in a building</span>');
    if (st.mobilityKilled[id] === 1) flags.push('<span class="rl-dim">immobilised</span>');
    if (st.firepowerKilled[id] === 1) flags.push('<span class="rl-bad">guns out</span>');
    if (st.moving[id] === 1) flags.push('moving');
    const supp = fx.toNumber(st.suppression[id]);
    if (supp > 0.05) flags.push(`suppression ${(supp * 100).toFixed(0)}%`);
    if (type.hasAps) flags.push(`APS ${st.apsAmmo[id]}/${type.apsMagazine}`);
    const wp = sim.waypointCount(id);
    if (wp > 0) flags.push(`${wp} waypoint${wp === 1 ? '' : 's'}`);
    rows.push(`<div>${flags.length > 0 ? flags.join(' · ') : 'holding position'}</div>`);

    // Armament, so the player can tell what this unit is for.
    if (type.weapons.length > 0) {
      rows.push('<div class="rl-label">Armament</div>');
      for (const w of type.weapons) {
        const pen = fx.toNumber(w.penetration);
        rows.push(
          `<div>${w.id} — ${fx.toNumber(w.effectiveRange).toFixed(1)}/${fx.toNumber(w.range).toFixed(0)} tiles` +
            (pen > 0 ? ` · ${pen.toFixed(0)}mm pen` : '') +
            (fx.toNumber(w.collateralRisk) >= 0.5 ? ' <span class="rl-warn">⚠ heavy</span>' : '') +
            `</div>`
        );
      }
    } else {
      rows.push('<div class="rl-label">Armament</div><div class="rl-dim">unarmed</div>');
    }

    // Special controls: what this unit can do beyond move and shoot.
    const caps: string[] = [];
    if (type.canSmoke) caps.push('<b>f</b> smoke screen');
    if (st.carriedBy[id] >= 0) caps.push('<b>aboard a transport</b> — <b>u</b> to dismount');
    if (type.canGarrison) caps.push('right-click a building to garrison');
    // Two sentences because there are now two rules: charges go in wherever the
    // unit halts, except at a protected site, which takes an order by name.
    // Saying only the first left the player with a dozer that silently refused
    // to touch a mosque and no hint that right-clicking it would work.
    if (type.canDemolish) caps.push('hold beside a building to demolish it · right-click a protected site to order it');
    if (type.isKamikaze) {
      caps.push('<span class="rl-hot">one-use: dives on what your side has identified</span>');
    }
    if (type.transportSlots > 0) {
      caps.push(`carries ${type.transportSlots} — <b>g</b> load · <b>u</b> unload`);
    }
    if (type.canMarkTarget) caps.push('earns intel while stationary');
    rows.push('<div class="rl-label">Capabilities</div>');
    for (const c of caps) rows.push(`<div>${c}</div>`);

    this.card.body.innerHTML = rows.join('');
    if (wasHidden) this.card.el.classList.add('rl-enter');
  }

  // ------------------------------------------------------------------
  // Clock: in a timed hold you watch this more than anything else.
  // ------------------------------------------------------------------

  private renderClock(): void {
    const hold = holdClock(this.deps.getMission());
    if (!hold) {
      this.clock.style.display = 'none';
      return;
    }
    this.clock.textContent = hold.text;
    this.clock.dataset.tone = hold.tone;
    this.clock.classList.toggle('rl-pulse', hold.contested);
    this.clock.style.display = 'block';
  }
}

/** Mission and objective text reaches the strip inside an attribute. Escaped
 *  rather than trusted: it is authored JSON, but an apostrophe in a mission
 *  name would otherwise end the attribute and eat the rest of the strip. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
