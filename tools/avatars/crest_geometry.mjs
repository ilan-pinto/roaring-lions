// The twelve avatar crests (GH-1075 P2): geometry, palette resolution, SVG writer and the legibility measure.
//
// Authored by an agent as code (AI-generated art; disclosed in the PR, CONTRIBUTING.md). Plain Node, no build step,
// so build_crests.mjs and tools/src/avatars/crests.test.ts both run it as it stands.
//
// Frame (spec 3.2): viewBox 0 0 256 256, a roundel of radius 120 in the GROUND, an 8-unit rim ring on its edge, and
// one CHARGE inside radius 96. No stroke or gap in a charge under 18 units (2 px at the 28 px chip), except the
// two named exemptions below. Colours are palette keys ('olive.2' = ramps.olive.colors[2]) and nothing else.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
const PALETTE = JSON.parse(readFileSync(join(ROOT, 'data', 'palette.json'), 'utf8'));

export const VIEWBOX = 256;
export const CX = 128;
export const CY = 128;
export const ROUNDEL_R = 120;
export const RIM_WIDTH = 8;
export const CHARGE_R = 96;
/** The floor, in viewBox units: 2 px at the 28 px chip (1 unit = 0.11 px). */
export const MIN_FEATURE = 18;
/** Named exemptions from the floor. A third name is a change to this list, which the test pins by literal. */
export const FLOOR_EXEMPT_CRESTS = ['crest-lion'];
export const FLOOR_EXEMPT_PARTS = ['rim'];
export const SIZE_LIMIT = 3 * 1024;
export const SIZE_LIMIT_LION = 8 * 1024;
export const LION_SOURCE = 'art/src/insignia/roaring_lion.svg';

/** A palette key to its hex. Only `ramps.*` keys: a reserved band (team, vfx, group) is refused here. */
export function paletteHex(key) {
  const m = /^([a-z]+)\.(\d+)$/.exec(key);
  const ramp = m && PALETTE.ramps[m[1]];
  const hex = ramp && ramp.colors[Number(m[2])];
  if (!hex) throw new Error(`palette key "${key}" is not a ramps.<name>.<index> key in data/palette.json`);
  return hex;
}

// ---------------------------------------------------------------- number and path helpers

const n1 = (v) => {
  const s = (Math.round(v * 10) / 10).toString();
  return s === '-0' ? '0' : s;
};
const pt = (p) => `${n1(p[0])},${n1(p[1])}`;
/** One closed polygon (or several, for holes under evenodd) as an absolute M/L/Z path. */
export const polyD = (...rings) => rings.map((r) => `M${r.map(pt).join('L')}Z`).join('');
const rot = (p, deg, c = [CX, CY]) => {
  const a = (deg * Math.PI) / 180;
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)];
};
const circle = (cx, cy, r, n = 48) =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

/** Parse the M/L/Z subset the crests use into rings of [x, y]. */
export function parsePath(d) {
  const out = [];
  for (const ringStr of d.split(/[Zz]/)) {
    const nums = ringStr.match(/-?\d*\.?\d+/g);
    if (!nums || nums.length < 6) continue;
    const ring = [];
    for (let i = 0; i + 1 < nums.length; i += 2) ring.push([Number(nums[i]), Number(nums[i + 1])]);
    out.push(ring);
  }
  return out;
}

// ---------------------------------------------------------------- the eleven authored charges

function chevronsCharge() {
  const chevron = (x) => [[x, 2], [x + 12, 2], [x + 26, 26], [x + 12, 50], [x, 50], [x + 14, 26]];
  const place = (p) => [CX + (p[0] - 44) * 2.2, CY + (p[1] - 26) * 2.2]; // ui/mark.ts geometry, scaled 2.2
  return [8, 31, 54].map((x, i) => ({ fill: ['dust.0', 'dust.2', 'dust.4'][i], d: polyD(chevron(x).map(place)) }));
}

function clawCharge() {
  const blade = [[-13, -74], [13, -74], [9, 74], [-9, 74]];
  return [-46, 0, 46].map((u) => ({
    fill: 'limestone.0',
    d: polyD(blade.map(([x, y]) => rot([CX + u + x, CY + y], 30))),
  }));
}

function towerCharge() {
  const ring = [[78, 48], [98, 48], [98, 76], [118, 76], [118, 48], [138, 48], [138, 76], [158, 76], [158, 48], [178, 48],
    [178, 204], [142, 204], [142, 160], [114, 160], [114, 204], [78, 204]];
  return [{ fill: 'limestone.1', d: polyD(ring) }];
}

function starCharge() {
  const R = 90;
  const ri = 44;
  const c = [CX, 134];
  const at = (r, deg) => [c[0] + r * Math.sin((deg * Math.PI) / 180), c[1] - r * Math.cos((deg * Math.PI) / 180)];
  const t = 20 / (2 * ri * Math.sin((36 * Math.PI) / 180)); // cut each tip where the arm is 20 wide
  const ring = [];
  for (let k = 0; k < 5; k++) {
    const tip = at(R, k * 72);
    const v1 = at(ri, k * 72 - 36);
    const v2 = at(ri, k * 72 + 36);
    ring.push(v1, [tip[0] + t * (v1[0] - tip[0]), tip[1] + t * (v1[1] - tip[1])], [tip[0] + t * (v2[0] - tip[0]), tip[1] + t * (v2[1] - tip[1])]);
  }
  return [{ fill: 'dust.0', d: polyD(ring) }];
}

function wingCharge() {
  // Three swept feathers rising to the right, stepped in length: a wing, not a blade.
  const root = [48, 134];
  const lean = (28 * Math.PI) / 180;
  const d = [Math.cos(lean), -Math.sin(lean)];
  const n = [Math.sin(lean), Math.cos(lean)];
  const at = (u, v) => [root[0] + d[0] * u + n[0] * v, root[1] + d[1] * u + n[1] * v];
  return [152, 126, 100].map((len, k) => ({
    fill: 'limestone.0',
    d: polyD([at(0, 40 * k - 10), at(len, 40 * k - 10), at(len - 16, 40 * k + 10), at(0, 40 * k + 10)]),
  }));
}

function trackCharge() {
  const run = [[60, 74], [196, 74], [212, 94], [196, 114], [60, 114], [44, 94]];
  const wheels = [70, 128, 186].map((x) => ({ fill: 'limestone.2', d: polyD(circle(x, 160, 19)) }));
  return [{ fill: 'limestone.2', d: polyD(run) }, ...wheels];
}

function sprigCharge() {
  const leaf = [[-9, 0], [-15, -14], [-15, -42], [-9, -60], [9, -60], [15, -42], [15, -14], [9, 0]];
  const at = (base, deg) => leaf.map(([x, y]) => rot([base[0] + x, base[1] + y], deg, base));
  const parts = [
    [[119, 92], [137, 92], [137, 206], [119, 206]],
    at([128, 96], 0),
    at([128, 118], 58),
    at([128, 146], -58),
    at([128, 174], 58),
    at([128, 202], -58),
  ];
  return parts.map((ring) => ({ fill: 'scrub.1', d: polyD(ring) }));
}

function ridgeCharge() {
  return [{ fill: 'limestone.0', d: polyD([[56, 168], [88, 92], [108, 92], [124, 140], [142, 56], [166, 56], [200, 168]]) }];
}

/** A horizontal band whose top edge is `top(x)` and which is `thick` tall, cut at the widest x inside radius 95. */
function band(top, thick, step, xmax) {
  let w = xmax;
  const inside = (x) => [top(x), top(x) + thick].every((y) => Math.hypot(x, y - CY) <= 95);
  while (w > 0 && !(inside(w) && inside(-w))) w -= step;
  const xs = [];
  for (let x = -w; x <= w + 1e-9; x += step) xs.push(x);
  return [...xs.map((x) => [CX + x, top(x)]), ...xs.reverse().map((x) => [CX + x, top(x) + thick])];
}

function waveCharge() {
  const A = 8;
  const lambda = 96;
  return [82, 128, 174].map((y0) => ({
    fill: 'water.0',
    d: polyD(band((x) => y0 - 12 + A * Math.sin((2 * Math.PI * x) / lambda), 24, lambda / 12, 100)),
  }));
}

function duneCharge() {
  const arch = (yc, rise) => (x) => yc - rise * (1 - (x / 80) ** 2);
  return [
    { fill: 'dust.0', d: polyD(circle(CX, 64, 22)) },
    { fill: 'dust.0', d: polyD(band(arch(138, 30), 24, 8, 80)) },
    { fill: 'dust.0', d: polyD(band(arch(186, 30), 24, 8, 80)) },
  ];
}

function reticleCharge() {
  const ring = { fill: 'dust.0', d: polyD(circle(CX, CY, 54), circle(CX, CY, 34)), evenodd: true };
  const dot = { fill: 'dust.0', d: polyD(circle(CX, CY, 12, 24)) };
  const ticks = [0, 90, 180, 270].map((a) => ({
    fill: 'dust.0',
    d: polyD([[CX - 9, CY - 94], [CX + 9, CY - 94], [CX + 9, CY - 74], [CX - 9, CY - 74]].map((p) => rot(p, a))),
  }));
  return [ring, dot, ...ticks];
}

// ---------------------------------------------------------------- the lion, read from the approved stencil

/** The right-half polygons of the GH-1096 stencil, read from the source file and never redrawn. */
export function readLion(root = ROOT) {
  const svg = readFileSync(join(root, LION_SOURCE), 'utf8');
  const grab = (group) => {
    const g = new RegExp(`<g id="${group}">([\\s\\S]*?)</g>`).exec(svg);
    if (!g) throw new Error(`${LION_SOURCE}: no <g id="${group}">`);
    return [...g[1].matchAll(/<path id="([^"]+)" d="([^"]+)"/g)].map((m) => ({ id: m[1], d: m[2] }));
  };
  return { silhouette: grab('silhouette'), cutouts: grab('cutouts') };
}

/** "M 100.00,2.00 L 108.54,2.37 Z" to "M100,2L108.54,2.37Z": the same numbers, fewer bytes. */
export function compactD(d) {
  return d
    .replace(/\s+/g, ' ')
    .replace(/(\d+\.\d*?)0+(?=\D|$)/g, '$1')
    .replace(/(\d)\.(?=\D|$)/g, '$1')
    .replace(/ ?([MLZ]) ?/g, '$1');
}

const LION_SCALE = 0.9795; // the stencil's roundel is 98 units in a 200 box: 98 x 0.9795 = 95.99 <= 96
const LION_SHIFT = (CX - 100 * LION_SCALE).toFixed(2).replace(/0+$/, '');

function lionSvgBody(ground, paint) {
  const { silhouette, cutouts } = readLion();
  const half =
    silhouette.map((p) => `<path fill="${paint}" d="${compactD(p.d)}"/>`).join('') +
    cutouts.map((p) => `<path fill="${ground}" d="${compactD(p.d)}"/>`).join('');
  return (
    `<defs><g id="half">${half}</g></defs>` +
    `<g id="charge"><g transform="matrix(${LION_SCALE} 0 0 ${LION_SCALE} ${LION_SHIFT} ${LION_SHIFT})">` +
    `<use href="#half"/><use href="#half" transform="matrix(-1 0 0 1 200 0)"/></g></g>`
  );
}

// ---------------------------------------------------------------- the table (spec 3.2)

export const CRESTS = [
  { id: 'crest-chevrons', ground: 'shadow.1', rim: 'dust.4', charge: chevronsCharge },
  { id: 'crest-claw', ground: 'terracotta.1', rim: 'terracotta.2', charge: clawCharge },
  { id: 'crest-lion', ground: 'olive.2', rim: 'olive.3', paint: 'dust.0', lion: true },
  { id: 'crest-tower', ground: 'gunmetal.3', rim: 'shadow.0', charge: towerCharge },
  { id: 'crest-star', ground: 'olive.3', rim: 'olive.1', charge: starCharge },
  { id: 'crest-wing', ground: 'water.1', rim: 'gunmetal.3', charge: wingCharge },
  { id: 'crest-track', ground: 'shadow.0', rim: 'gunmetal.2', charge: trackCharge },
  { id: 'crest-sprig', ground: 'limestone.1', rim: 'limestone.5', charge: sprigCharge },
  { id: 'crest-ridge', ground: 'gunmetal.2', rim: 'gunmetal.3', charge: ridgeCharge },
  { id: 'crest-wave', ground: 'shadow.1', rim: 'water.1', charge: waveCharge },
  { id: 'crest-dune', ground: 'dust.5', rim: 'dust.6', charge: duneCharge },
  { id: 'crest-reticle', ground: 'terracotta.2', rim: 'shadow.0', charge: reticleCharge },
];

/** The charge as drawn paths: [{ fill: 'dust.0', d, evenodd? }], for every crest but the lion. */
export function chargeOf(crest) {
  return crest.lion ? [] : crest.charge();
}

export function renderCrest(crest) {
  const ground = paletteHex(crest.ground);
  const rim = paletteHex(crest.rim);
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" width="${VIEWBOX}" height="${VIEWBOX}">` +
    `<circle id="ground" cx="${CX}" cy="${CY}" r="${ROUNDEL_R}" fill="${ground}"/>` +
    `<circle id="rim" cx="${CX}" cy="${CY}" r="${ROUNDEL_R}" fill="none" stroke="${rim}" stroke-width="${RIM_WIDTH}"/>`;
  const body = crest.lion
    ? lionSvgBody(ground, paletteHex(crest.paint))
    : `<g id="charge">${chargeOf(crest)
        .map((p) => `<path fill="${paletteHex(p.fill)}"${p.evenodd ? ' fill-rule="evenodd"' : ''} d="${p.d}"/>`)
        .join('')}</g>`;
  return `${head}${body}</svg>\n`;
}

// ---------------------------------------------------------------- legibility: rasterise, then open and close

const R2 = 8.5 * 8.5; // a feature 18 wide passes: its centre pixel has background 9 away

/** Even-odd scanline fill of rings into a Uint8Array(size*size) at pixel centres. */
export function rasterise(rings, size = VIEWBOX) {
  const m = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.ceil(xs[i] - 0.5)); x < Math.min(size, xs[i + 1] + 0.5) && x + 0.5 < xs[i + 1]; x++) m[y * size + x] = 1;
    }
  }
  return m;
}

function edt1d(f, n, out, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k]) { k--; continue; }
      break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/** Squared distance from every pixel to the nearest pixel where `isFeature` is 1. */
export function distSq(isFeature, size = VIEWBOX) {
  const INF = 1e12;
  const g = new Float64Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = isFeature[i] ? 0 : INF;
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  const f = new Float64Array(size);
  const o = new Float64Array(size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) f[y] = g[y * size + x];
    edt1d(f, size, o, v, z);
    for (let y = 0; y < size; y++) g[y * size + x] = o[y];
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) f[x] = g[y * size + x];
    edt1d(f, size, o, v, z);
    for (let x = 0; x < size; x++) g[y * size + x] = o[x];
  }
  return g;
}

const erode = (mask, size) => {
  const bg = mask.map((b) => (b ? 0 : 1));
  const d = distSq(bg, size);
  return Uint8Array.from(d, (v) => (v > R2 ? 1 : 0));
};
const dilate = (mask, size) => {
  const d = distSq(mask, size);
  return Uint8Array.from(d, (v) => (v <= R2 ? 1 : 0));
};
const area = (m) => m.reduce((s, b) => s + b, 0);

/**
 * Measure a charge. `retention[i]` is the share of path i that survives an opening by a disc 17 units across (1 =
 * nothing thinner than 18; a stroke 10 wide reads ~0). `closingGain` is the share of the union that a closing
 * adds (a gap narrower than 18 fills). Sharp tips and concave corners cost a little of each; the thresholds in the
 * test are calibrated against what the twelve authored charges measure, and the 10-unit mutation sits far past them.
 */
export function measureCharge(paths, size = VIEWBOX) {
  const masks = paths.map((p) => rasterise(parsePath(p.d), size));
  const retention = masks.map((m) => area(dilate(erode(m, size), size)) / Math.max(1, area(m)));
  const union = new Uint8Array(size * size);
  for (const m of masks) for (let i = 0; i < union.length; i++) if (m[i]) union[i] = 1;
  const closed = erode(dilate(union, size), size);
  let added = 0;
  for (let i = 0; i < union.length; i++) if (closed[i] && !union[i]) added++;
  return { retention, closingGain: added / Math.max(1, area(union)) };
}

/** Thresholds, set from the measured values (see crests.test.ts, which prints them). */
export const MIN_RETENTION = 0.75;
export const MAX_CLOSING_GAIN = 0.06;

export function assertLegible(crest) {
  if (FLOOR_EXEMPT_CRESTS.includes(crest.id)) return;
  const { retention, closingGain } = measureCharge(chargeOf(crest));
  const bad = retention.findIndex((r) => r < MIN_RETENTION);
  if (bad >= 0) throw new Error(`${crest.id}: charge path ${bad} keeps ${retention[bad].toFixed(3)} after an 18-unit opening (floor ${MIN_RETENTION}): a stroke is thinner than ${MIN_FEATURE} units`);
  if (closingGain > MAX_CLOSING_GAIN) throw new Error(`${crest.id}: a closing adds ${closingGain.toFixed(3)} of the charge (cap ${MAX_CLOSING_GAIN}): a gap is narrower than ${MIN_FEATURE} units`);
}

/** Every crest as { id, svg }, refusing a charge that breaks the floor. */
export function buildAll() {
  return CRESTS.map((c) => {
    assertLegible(c);
    return { id: c.id, svg: renderCrest(c) };
  });
}
