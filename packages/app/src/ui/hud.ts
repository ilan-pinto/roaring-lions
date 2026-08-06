// The player's HUD: briefing, unit card, clock, notices, mission punctuation.
//
// This used to live inside DebugOverlay, in @lions/render, which put the face
// of the game inside the development instrument and inside the rendering
// package. Both were wrong. The HUD is shell (CLAUDE.md: app owns "shell,
// input, UI"), and it is what a player looks at continuously; the roll feed and
// the detection maths that stayed behind in the overlay are what a developer
// looks at while tuning the model.
//
// Nothing here reads or writes sim state — it renders what the sim reports
// (invariant 4).

import { fx, TICKS_PER_SECOND, type Sim } from '@lions/sim';
import { panel, type Panel } from './panel';
import { flash, leave, titleCard } from './motion';

export interface ObjectiveView {
  id: string;
  text: string;
  primary: boolean;
  status: string;
  ticksLeft?: number;
  paused?: 'contested' | 'unheld';
}

export interface MissionView {
  name: string;
  objectives: ObjectiveView[];
  result: 'ongoing' | 'victory' | 'defeat';
  /** One-line campaign summary (roster size, cumulative ROE). */
  campaign?: string;
  /** Live mission ROE score 0-100 — always visible (GDD §6). */
  roe?: number;
  /** Resource line, e.g. "logistics 560 · intel 40". */
  resources?: string;
}

/** Semantic tone for a notice or a value. Never a colour — the mapping from
 *  meaning to colour belongs to theme.css, in one place. */
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'live' | 'mute';

export interface HudDeps {
  sim: Sim;
  getSelection: () => number[];
  getMission: () => MissionView | null;
  hoverStructure: () => number;
  hoverEntity: () => number;
  gameVersion: string;
}

function clockText(ticksLeft: number): string {
  const secs = Math.ceil(ticksLeft / TICKS_PER_SECOND);
  const mm = Math.floor(secs / 60);
  const ss = (secs % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export class Hud {
  private readonly brief: Panel;
  private readonly card: Panel;
  private readonly clock: HTMLDivElement;
  private readonly notices: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private bannerShown = false;
  private tickN = 0;

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
    this.brief = panel({
      rank: 'mission',
      title: 'Roaring Lions',
      tag: deps.gameVersion ? `V ${deps.gameVersion}` : '',
      mark: true,
      place: 'top:var(--s2);left:var(--s2);width:300px;max-height:calc(100vh - var(--s4))',
    });
    this.card = panel({
      rank: 'inspect',
      title: 'Selection',
      place: 'right:var(--s2);bottom:var(--s2);width:var(--rail-right);max-height:46vh',
    });
    this.card.hide();

    this.clock = document.createElement('div');
    this.clock.className = 'rl-clock';
    this.clock.style.display = 'none';

    this.notices = document.createElement('div');
    this.notices.className = 'rl-notices';

    this.banner = document.createElement('div');
    this.banner.className = 'rl-bigbanner';
    this.banner.style.display = 'none';

    host.append(this.brief.el, this.card.el, this.clock, this.notices, this.banner);
  }

  /** Mission start punctuation. */
  announce(name: string, subtitle: string, holdMs?: number): void {
    titleCard(this.host, name, subtitle, holdMs);
  }

  onTick(): void {
    this.updateBanner();
    // A full innerHTML rebuild at 20 Hz stalls the page exactly when combat
    // floods events. 4 Hz reads identically.
    if (this.tickN++ % 5 !== 0) return;
    this.renderBrief();
    this.renderCard();
    this.renderClock();
  }

  /** Mission-level narration — objectives, triggers, waves, refusals. */
  note(html: string, tone: Tone = 'live'): void {
    const el = document.createElement('div');
    el.className = `rl-notice rl-enter rl-${tone}`;
    el.innerHTML = html;
    this.notices.prepend(el);
    while (this.notices.childElementCount > 5) {
      this.notices.lastElementChild?.remove();
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
  // Briefing: what the mission wants, how the force is holding up, and
  // what the cursor is over.
  // ------------------------------------------------------------------

  private renderBrief(): void {
    const m = this.deps.getMission();
    this.brief.setTitle(m ? m.name : 'Roaring Lions');
    this.brief.body.innerHTML =
      this.missionHtml(m) +
      this.suppressionHtml() +
      this.structureHtml() +
      this.projectedFireHtml() +
      this.controlsHtml();
    this.punctuate(m);
  }

  /** Flash what just changed. Runs after the rebuild, on the fresh nodes. */
  private punctuate(m: MissionView | null): void {
    if (!m) return;
    for (const o of m.objectives) {
      const prev = this.lastStatus.get(o.id);
      this.lastStatus.set(o.id, o.status);
      if (prev === undefined || prev === o.status) continue;
      const row = this.brief.body.querySelector<HTMLElement>(`[data-obj="${CSS.escape(o.id)}"]`);
      if (row) flash(row, o.status === 'complete' ? 'rl-flash-good' : 'rl-flash-bad', 400);
    }
    if (m.roe !== undefined) {
      const dropped = this.lastRoe !== null && m.roe < this.lastRoe;
      this.lastRoe = m.roe;
      const el = this.brief.body.querySelector<HTMLElement>('[data-roe]');
      if (dropped && el) flash(el, 'rl-flash-bad', 300);
    }
  }

  private missionHtml(m: MissionView | null): string {
    if (!m) return '';
    const rows: string[] = [];
    if (m.roe !== undefined) {
      const tone = m.roe >= 80 ? 'good' : m.roe >= 50 ? 'warn' : 'bad';
      rows.push(
        `<div class="rl-score"><span class="rl-score__n rl-${tone}" data-roe>${m.roe}</span>` +
          `<span class="rl-score__k">ROE</span>` +
          (m.resources ? `<span class="rl-score__r rl-info">${m.resources}</span>` : '') +
          `</div>`
      );
    } else if (m.resources) {
      rows.push(`<div class="rl-info">${m.resources}</div>`);
    }
    if (m.campaign) rows.push(`<div class="rl-dim">${m.campaign}</div>`);

    rows.push('<div class="rl-label">Objectives</div>');
    for (const o of m.objectives) {
      const glyph = o.status === 'complete' ? '☑' : o.status === 'failed' ? '☒' : '☐';
      const tone = o.status === 'complete' ? 'good' : o.status === 'failed' ? 'bad' : '';
      let clock = '';
      if (o.ticksLeft !== undefined) {
        const secs = Math.ceil(o.ticksLeft / TICKS_PER_SECOND);
        // Runs amber under a minute: the last stretch of a hold is the part
        // worth watching.
        const urgent = secs <= 60 ? 'rl-warn' : 'rl-info';
        clock = ` <b class="${urgent}">${clockText(o.ticksLeft)}</b>`;
        if (o.paused === 'contested') clock += ' <span class="rl-bad">CONTESTED</span>';
        else if (o.paused === 'unheld') clock += ' <span class="rl-warn">NOBODY HOLDING</span>';
      }
      const secondary = o.primary ? '' : ' <span class="rl-dim">(secondary)</span>';
      rows.push(
        `<div class="rl-obj ${tone ? 'rl-' + tone : ''}" data-obj="${o.id}">` +
          `<span class="rl-obj__g">${glyph}</span><span>${o.text}${clock}${secondary}</span></div>`
      );
    }
    return rows.join('');
  }

  /** Force-wide suppression warning — visible even when the units are not. */
  private suppressionHtml(): string {
    const st = this.deps.sim.state;
    let pinnedN = 0;
    let brokenN = 0;
    for (let i = 0; i < this.deps.sim.entityCount; i++) {
      if (st.alive[i] === 0 || st.side[i] !== 0) continue;
      if (st.routed[i] === 1) brokenN++;
      else if (st.pinned[i] === 1) pinnedN++;
    }
    if (pinnedN === 0 && brokenN === 0) return '';
    const parts: string[] = [];
    if (pinnedN > 0) parts.push(`<span class="rl-hot"><b>▼ ${pinnedN} pinned</b></span>`);
    if (brokenN > 0) parts.push(`<span class="rl-bad"><b>⚑ ${brokenN} broken</b></span>`);
    return `<div class="rl-label">Force</div><div>${parts.join(' · ')}</div>`;
  }

  /** Building under the cursor, reported the way a unit is when selected. */
  private structureHtml(): string {
    const sim = this.deps.sim;
    const s = this.deps.hoverStructure();
    if (s < 0) return '';
    const str = sim.structures;
    if (str.alive[s] === 0) return '';
    const type = sim.structureTypes[str.typeIdx[s]];
    const integrity = str.maxHp[s] > 0 ? str.hp[s] / str.maxHp[s] : 1;
    const st = sim.state;
    // Count only what side 0 can actually see: friendlies always, hostiles
    // once identified. A building does not report its garrison to the enemy.
    let known = 0;
    let hostile = false;
    for (let i = 0; i < sim.entityCount; i++) {
      if (st.alive[i] === 0 || st.garrisonedIn[i] !== s) continue;
      if (st.side[i] === 0) known++;
      else if (sim.contactLevel(0, i) === 2) {
        known++;
        hostile = true;
      }
    }
    const rows = [
      `<div class="rl-label">${type.name}</div>`,
      `<div>integrity ${(integrity * 100).toFixed(0)}%</div>`,
      known > 0
        ? `<div class="${hostile ? 'rl-bad' : 'rl-live'}">held: ${known}/${type.garrisonSlots} inside</div>`
        : type.garrisonSlots > 0
          ? `<div class="rl-dim">empty · ${type.garrisonSlots} garrison slots</div>`
          : '<div class="rl-dim">not garrisonable</div>',
    ];
    if (type.roePenalty > 0) {
      rows.push(`<div class="rl-warn">⚠ levelling this costs ROE ${type.roePenalty}</div>`);
    }
    return rows.join('');
  }

  /**
   * Projected P(hit) for each selected unit against the hovered enemy.
   *
   * GDD 5.8: the player should know what a shot costs before taking it. Rows
   * are capped because selecting the whole force must not bury the map, and
   * units that cannot engage are counted rather than listed — "3 cannot reach"
   * is information, three empty rows are not.
   */
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
      const penalties: [string, number][] = [
        ['range', fx.toNumber(p.factors.rangeFalloff)],
        ['cover', fx.toNumber(p.factors.coverMod)],
        ['target moving', fx.toNumber(p.factors.motionMod)],
        ['firing on the move', fx.toNumber(p.factors.stanceMod)],
        ['suppressed', fx.toNumber(p.factors.suppressionMod)],
      ];
      const worst = penalties
        .filter(([, v]) => v < 0.995)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2)
        .map(([label, v]) => `${label} ${Math.round(v * 100)}%`);
      const why = worst.length > 0 ? ` · ${worst.join(' · ')}` : '';
      const bounce = p.hurts ? '' : ' · <span class="rl-bad">cannot penetrate</span>';
      rows.push(
        `<div>${name} <b>${chance}%</b> <span class="rl-dim">${p.weaponId}${why}</span>${bounce}</div>`
      );
    }

    const head = '<div class="rl-label">Projected fire</div>';
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

  private controlsHtml(): string {
    if (this.deps.getSelection().length > 0) return '';
    return (
      '<div class="rl-label">Controls</div>' +
      '<div class="rl-dim">click/drag select · right-click attack-move · shift adds a waypoint<br>' +
      'h halt · f smoke · g load · u unload · m mute · o overlay<br>' +
      'wasd/arrows pan · wheel zoom · ctrl+1–9 assign group · 1–9 recall</div>'
    );
  }

  // ------------------------------------------------------------------
  // Unit card: what it is, how it is doing, what it can do.
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
    const glyph = type.isKamikaze
      ? '✹'
      : type.role === 'drone'
        ? '⬡'
        : type.role === 'sniper'
          ? '✛'
          : type.transportSlots > 0
            ? '▤'
            : type.isSoft
              ? '▲'
              : '■';

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
    if (type.canDemolish) caps.push('hold beside a building to demolish it');
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
    const m = this.deps.getMission();
    const timed = m?.objectives.find((o) => o.status === 'active' && o.ticksLeft !== undefined);
    if (!timed || timed.ticksLeft === undefined) {
      this.clock.style.display = 'none';
      return;
    }
    const secs = Math.ceil(timed.ticksLeft / TICKS_PER_SECOND);
    // A paused clock must say why, or it reads as a broken game.
    const why =
      timed.paused === 'contested'
        ? 'CONTESTED'
        : timed.paused === 'unheld'
          ? 'NOBODY HOLDING'
          : '';
    this.clock.textContent = why ? `${clockText(timed.ticksLeft)}  ${why}` : clockText(timed.ticksLeft);
    const tone =
      timed.paused === 'contested' ? 'bad' : timed.paused === 'unheld' || secs <= 60 ? 'warn' : '';
    this.clock.dataset.tone = tone;
    this.clock.classList.toggle('rl-pulse', timed.paused === 'contested');
    this.clock.style.display = 'block';
  }
}
