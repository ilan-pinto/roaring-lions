// Debug overlay — the primary development instrument (CLAUDE.md). Every roll
// the model makes is shown with its full factor breakdown: detection
// probabilities, hit chances, penetration curves, facing, component results,
// suppression. DOM rather than canvas: crisp text, free scrolling.

import { fx, type Sim, type SimEvent } from '@lions/sim';

export interface MissionView {
  name: string;
  objectives: { id: string; text: string; primary: boolean; status: string }[];
  result: 'ongoing' | 'victory' | 'defeat';
  /** One-line campaign summary (roster size, cumulative ROE). */
  campaign?: string;
}

const PANEL_CSS =
  'position:absolute;top:8px;max-height:calc(100vh - 16px);overflow-y:auto;' +
  'background:rgba(20,21,15,0.88);color:#F2E8D5;font:11px ui-monospace,Menlo,monospace;' +
  'padding:8px 10px;border:1px solid #5C625F;border-radius:4px;line-height:1.5;';

function pct(v: number): string {
  return (fx.toNumber(v) * 100).toFixed(0) + '%';
}

function fmt(v: number, digits = 1): string {
  return fx.toNumber(v).toFixed(digits);
}

export class DebugOverlay {
  private readonly left: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private visible = true;
  private feedCount = 0;

  private readonly banner: HTMLDivElement;
  private bannerShown = false;

  constructor(
    host: HTMLElement,
    private readonly sim: Sim,
    private readonly getSelection: () => number[],
    private readonly getMission?: () => MissionView | null
  ) {
    this.banner = document.createElement('div');
    this.banner.style.cssText =
      'position:absolute;top:38%;left:50%;transform:translate(-50%,-50%);display:none;' +
      'font:bold 34px ui-monospace,Menlo,monospace;color:#F2E8D5;background:rgba(20,21,15,0.92);' +
      'padding:18px 42px;border:2px solid #5C625F;border-radius:6px;letter-spacing:2px;';
    host.appendChild(this.banner);
    this.left = document.createElement('div');
    this.left.style.cssText = PANEL_CSS + 'left:8px;width:300px;';
    this.right = document.createElement('div');
    this.right.style.cssText = PANEL_CSS + 'right:8px;width:380px;';
    this.status = document.createElement('div');
    this.feed = document.createElement('div');
    const feedTitle = document.createElement('div');
    feedTitle.textContent = '── roll feed (newest first) ──';
    feedTitle.style.cssText = 'color:#8E9491;margin-bottom:4px;';
    this.right.appendChild(feedTitle);
    this.right.appendChild(this.feed);
    this.left.appendChild(this.status);
    host.appendChild(this.left);
    host.appendChild(this.right);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.left.style.display = this.visible ? 'block' : 'none';
    this.right.style.display = this.visible ? 'block' : 'none';
  }

  onTick(events: SimEvent[]): void {
    this.updateBanner();
    if (!this.visible) return;
    for (const e of events) this.pushEvent(e);
    this.renderSelected();
  }

  /** Mission-level narration (objectives, triggers, waves) into the feed. */
  note(html: string, color = '#B8FF5A'): void {
    this.line(html, color);
  }

  private updateBanner(): void {
    const m = this.getMission?.();
    if (!m || m.result === 'ongoing' || this.bannerShown) return;
    this.bannerShown = true;
    this.banner.textContent = m.result === 'victory' ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED';
    this.banner.style.borderColor = m.result === 'victory' ? '#6B8A4A' : '#D93A2B';
    this.banner.style.display = 'block';
  }

  private line(html: string, color = '#F2E8D5'): void {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.style.color = color;
    this.feed.prepend(div);
    this.feedCount++;
    while (this.feedCount > 90 && this.feed.lastChild) {
      this.feed.removeChild(this.feed.lastChild);
      this.feedCount--;
    }
  }

  private name(id: number): string {
    const t = this.sim.unitTypes[this.sim.state.typeIdx[id]];
    return `#${id} ${t.id}`;
  }

  private pushEvent(e: SimEvent): void {
    const t = `<span style="color:#8E9491">t${e.tick}</span> `;
    switch (e.kind) {
      case 'fire': {
        const b = e.breakdown;
        this.line(
          t +
            `${this.name(e.shooter)} → ${this.name(e.target)} <b>${e.weaponId}</b> ` +
            `P(hit)=${pct(e.pHit)} roll=${pct(e.roll)} ${e.willHit ? '<b>HIT</b>' : 'miss'}<br>` +
            `&nbsp;&nbsp;<span style="color:#8E9491">acc ${pct(b.accuracy)} · rng ${pct(b.rangeFalloff)} · cov ${pct(
              b.coverMod
            )} · mot ${pct(b.motionMod)} · stance ${pct(b.stanceMod)} · supp ${pct(b.suppressionMod)}</span>`,
          e.willHit ? '#F2E8D5' : '#B8A182'
        );
        break;
      }
      case 'impact':
        this.line(
          t +
            `${this.name(e.target)} <b>${e.arc}</b> armor eff=${fmt(e.effectiveArmor, 0)}mm vs pen=${fmt(
              e.penetration,
              0
            )}mm P(pen)=${pct(e.pPen)} roll=${pct(e.roll)} ${e.penetrated ? '<b>PENETRATION</b>' : 'no pen'}`,
          e.penetrated ? '#FFB43C' : '#A9C4D1'
        );
        break;
      case 'component':
        this.line(t + `${this.name(e.target)} <b>${e.result.toUpperCase()}</b> (overmatch z=${fmt(e.overmatch, 2)})`, '#E8541E');
        break;
      case 'aps':
        this.line(
          t + `${this.name(e.target)} APS vs ${this.name(e.shooter)}: P=${pct(e.pIntercept)} roll=${pct(e.roll)} ${
            e.intercepted ? '<b>INTERCEPT</b>' : 'LEAKER'
          }`,
          '#6FE0FF'
        );
        break;
      case 'contact':
        this.line(t + `side${e.side} ${e.level.toUpperCase()} ${this.name(e.target)} (conf ${pct(e.confidence)})`, '#B8FF5A');
        break;
      case 'pinned':
        this.line(t + `${this.name(e.entity)} <b>PINNED</b> — gone to ground`, '#FFB43C');
        break;
      case 'unpinned':
        this.line(t + `${this.name(e.entity)} back up`, '#8F9464');
        break;
      case 'destroyed':
        this.line(t + `${this.name(e.entity)} <b>DESTROYED</b>${e.by >= 0 ? ' by ' + this.name(e.by) : ''}`, '#D93A2B');
        break;
      case 'nearMiss':
        break; // too chatty for the feed; rendered as puffs instead
      case 'spawn':
        this.line(t + `spawn ${this.name(e.entity)} side${e.side}`, '#8E9491');
        break;
    }
  }

  private missionHtml(): string {
    const m = this.getMission?.();
    if (!m) return '';
    const rows = [`<b>${m.name}</b>`];
    if (m.campaign) rows.push(`<span style="color:#8E9491">${m.campaign}</span>`);
    for (const o of m.objectives) {
      const glyph = o.status === 'complete' ? '☑' : o.status === 'failed' ? '☒' : '☐';
      const color = o.status === 'complete' ? '#6B8A4A' : o.status === 'failed' ? '#D93A2B' : '#F2E8D5';
      rows.push(
        `<span style="color:${color}">${glyph} ${o.text}${o.primary ? '' : ' <span style="color:#8E9491">(secondary)</span>'}</span>`
      );
    }
    return rows.join('<br>') + '<br><br>';
  }

  private renderSelected(): void {
    const sel = this.getSelection();
    if (sel.length === 0) {
      this.status.innerHTML =
        this.missionHtml() +
        '<b>controls</b><br>click: select · right-click: attack-move<br>' +
        'h: halt · a: select all KDF · o: overlay · wasd/arrows: pan · wheel: zoom<br><br>' +
        '<span style="color:#8E9491">select a unit to inspect its detection maths</span>';
      return;
    }
    const st = this.sim.state;
    const rows: string[] = [this.missionHtml()];
    const id = sel[0];
    const type = this.sim.unitTypes[st.typeIdx[id]];
    rows.push(`<b>${this.name(id)}</b> side${st.side[id]}${sel.length > 1 ? ` (+${sel.length - 1} more)` : ''}`);
    rows.push(
      `hp ${fmt(st.hp[id], 0)}/${fmt(type.hp, 0)} · supp ${fmt(st.suppression[id], 2)}${st.pinned[id] ? ' <b>PINNED</b>' : ''}`
    );
    const flags: string[] = [];
    if (st.veterancy[id] > 0) flags.push('vet ' + '★'.repeat(st.veterancy[id]));
    if (st.moving[id]) flags.push('moving');
    if (st.mobilityKilled[id]) flags.push('M-kill');
    if (st.firepowerKilled[id]) flags.push('F-kill');
    if (type.hasAps) flags.push(`APS ${st.apsAmmo[id]}/${type.apsMagazine}`);
    rows.push(flags.length ? flags.join(' · ') : 'stationary');
    rows.push(`facing ${(fx.toNumber(st.facing[id]) * 360).toFixed(0)}°`);
    rows.push('<br><b>detection vs hostiles</b> <span style="color:#8E9491">(P per tick / confidence)</span>');
    const mySide = st.side[id];
    let shown = 0;
    for (let e = 0; e < this.sim.entityCount && shown < 14; e++) {
      if (st.alive[e] === 0 || st.side[e] === mySide) continue;
      const d = this.sim.debugDetection(id, e);
      if (d === null) continue;
      const lvl = this.sim.contactLevel(mySide, e);
      const glyph = lvl === 2 ? '<b>ID</b>' : lvl === 1 ? '?' : '·';
      const conf = this.sim.contactConfidence(mySide, e);
      rows.push(
        `${glyph} ${this.name(e)} — ${
          d.visible
            ? `P=${(fx.toNumber(d.p) * 100).toFixed(1)}%/tick sig=${fmt(d.signature, 2)} occl=${fmt(d.occlusion, 2)}`
            : 'no LOS'
        } conf=${pct(conf)}`
      );
      shown++;
    }
    this.status.innerHTML = rows.join('<br>');
  }
}
