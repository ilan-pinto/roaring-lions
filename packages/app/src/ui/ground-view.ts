// The ground as the briefing and the after-action report show it (GH-417,
// Field order): a picture of the map with marks drawn over it in tile units.
//
// Two pictures, one frame. The painted tiles (`map-preview.ts`) arrive
// instantly and are what Pixi and a no-WebGL browser keep. The photograph
// (`Renderer.captureGroundAlbedo`, the minimap's own call, rows already
// flipped) replaces them once the renderer can take it (ruling L-2). The marks
// sit on an SVG whose viewBox IS the map in tiles, so they land on the same
// tiles whichever picture is under them.
//
// Colour comes from CSS only: every shape carries a class, and theme.css maps
// the classes to tokens. No colour is named in this file.

import { t } from '../i18n/t';
import type { GroundMark } from './ground-marks';
import { paintMapTerrain, type PreviewMap, type PreviewTones } from './map-preview';

const SVG = 'http://www.w3.org/2000/svg';

/** A pin the after-action report adds: where a loss or a deduction happened. */
export interface GroundPin {
  kind: 'loss' | 'deduction';
  x: number;
  y: number;
  label: string;
}

export interface GroundView {
  el: HTMLElement;
  /** Swap the painted tiles for the renderer's photograph. Ignored once the
   *  view is gone, and ignored for a picture of the wrong aspect. */
  setPhoto(img: ImageData): void;
  /** Which picture is under the marks: `painted`, `photo`, or `none`. */
  readonly source: 'painted' | 'photo' | 'none';
}

let patternSeq = 0;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls) e.setAttribute('class', cls);
  return e;
}

function label(text: string, x: number, y: number, size: number, cls: string): SVGTextElement {
  const e = svgEl('text', { x, y, 'font-size': size }, `rl-ground__label ${cls}`);
  e.textContent = text;
  return e;
}

export function groundView(opts: {
  map: PreviewMap;
  tones: PreviewTones;
  marks: readonly GroundMark[];
  pins?: readonly GroundPin[];
  caption?: string;
}): GroundView {
  const { map } = opts;
  const fig = document.createElement('figure');
  fig.className = 'rl-ground';
  if (opts.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'rl-ground__caption';
    cap.textContent = opts.caption;
    fig.appendChild(cap);
  }
  const frame = document.createElement('div');
  frame.className = 'rl-ground__frame';
  frame.style.setProperty('--ground-aspect', `${map.width} / ${map.height}`);
  fig.appendChild(frame);

  let source: GroundView['source'] = 'none';
  let base: HTMLCanvasElement | null = paintMapTerrain(map, opts.tones);
  if (base) {
    base.className = 'rl-ground__base rl-ground__base--painted';
    frame.appendChild(base);
    source = 'painted';
  }

  // Marks, in tile units. Text is sized off the map, so a 48-tile map and a
  // 64-tile one read the same at the same frame size.
  const size = Math.max(map.width, map.height) * 0.028;
  const svg = svgEl('svg', { viewBox: `0 0 ${map.width} ${map.height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, 'rl-ground__svg');
  const hatchId = `rl-ground-hatch-${++patternSeq}`;
  const defs = svgEl('defs', {});
  const pattern = svgEl('pattern', { id: hatchId, width: 1, height: 1, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pattern.appendChild(svgEl('rect', { width: 1, height: 1 }, 'rl-ground__hatch-bg'));
  pattern.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 1 }, 'rl-ground__hatch-line'));
  defs.appendChild(pattern);
  svg.appendChild(defs);

  const legend = new Set<string>();
  for (const m of opts.marks) {
    if (m.kind === 'start') {
      const s = size * 1.2;
      svg.appendChild(svgEl('polygon', { points: `${m.x + 0.5},${m.y + 0.5 - s} ${m.x + 0.5 + s},${m.y + 0.5 + s * 0.7} ${m.x + 0.5 - s},${m.y + 0.5 + s * 0.7}` }, 'rl-ground__start'));
      svg.appendChild(label(t('ground.start'), m.x + 0.5 + s * 1.3, m.y + 0.5 + s * 0.5, size, 'rl-ground__label--start'));
      legend.add('start');
      continue;
    }
    const { x, y, w, h } = m.rect;
    if (m.kind === 'nofire') {
      const r = svgEl('rect', { x, y, width: w, height: h }, 'rl-ground__zone rl-ground__zone--nofire');
      r.setAttribute('fill', `url(#${hatchId})`);
      svg.appendChild(r);
      svg.appendChild(label(m.label ? t('ground.nofire.named', { place: m.label }) : t('ground.nofire'), x, y + h + size * 1.1, size, 'rl-ground__label--nofire'));
      legend.add('nofire');
    } else if (m.kind === 'refuge') {
      svg.appendChild(svgEl('rect', { x, y, width: w, height: h }, 'rl-ground__zone rl-ground__zone--refuge'));
      svg.appendChild(label(t('ground.refuge'), x, y - size * 0.4, size, 'rl-ground__label--refuge'));
      legend.add('refuge');
    } else {
      svg.appendChild(svgEl('rect', { x, y, width: w, height: h }, `rl-ground__zone rl-ground__zone--objective${m.primary ? '' : ' rl-ground__zone--optional'}`));
      const numbers = m.numbers.join(' · ');
      const text = m.clock ? t('ground.objective.clock', { numbers, clock: m.clock }) : t('ground.objective', { numbers });
      svg.appendChild(label(text, x, y - size * 0.4, size, 'rl-ground__label--objective'));
      legend.add('objective');
    }
  }
  for (const p of opts.pins ?? []) {
    svg.appendChild(svgEl('circle', { cx: p.x + 0.5, cy: p.y + 0.5, r: size * 0.7 }, `rl-ground__pin rl-ground__pin--${p.kind}`));
    svg.appendChild(label(p.label, p.x + 0.5 + size, p.y + 0.5 + size * 0.35, size, `rl-ground__label--${p.kind}`));
    legend.add(p.kind);
  }
  frame.appendChild(svg);

  if (legend.size > 0) {
    const ul = document.createElement('ul');
    ul.className = 'rl-ground__legend';
    for (const k of ['objective', 'refuge', 'nofire', 'start', 'loss', 'deduction']) {
      if (!legend.has(k)) continue;
      const li = document.createElement('li');
      li.className = `rl-ground__key rl-ground__key--${k}`;
      li.textContent = t(`ground.legend.${k}`);
      ul.appendChild(li);
    }
    fig.appendChild(ul);
  }

  return {
    el: fig,
    get source() {
      return source;
    },
    setPhoto(img: ImageData): void {
      // A photograph of some other map (a stale capture) must not land under
      // these marks: the aspect is the one thing both share.
      if (img.width * map.height !== img.height * map.width) return;
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      if (!g) return;
      g.putImageData(img, 0, 0);
      c.className = 'rl-ground__base rl-ground__base--photo';
      if (base) base.replaceWith(c);
      else frame.insertBefore(c, svg);
      base = c;
      source = 'photo';
    },
  };
}
