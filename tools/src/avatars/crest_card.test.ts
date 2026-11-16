// GH-1367 S4: the header card on the account page is washed in the member's crest. Its twelve (ground, rim) pairs live
// in theme.css as `:has([data-avatar='crest-…'])` rules; this pins them to the crest generator's table, so recolouring a
// crest cannot leave its card behind. The pairs come from the generator at run time and the CSS is parsed from disk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRESTS, chargeOf, paletteHex } from '../../avatars/crest_geometry.mjs';

const ROOT = join(__dirname, '..', '..', '..');
const css = readFileSync(join(ROOT, 'packages', 'app', 'src', 'ui', 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Palette keys the card takes INSTEAD of the generator's. Each is a deliberate, named departure, with its reason. */
export const GROUND_SUBSTITUTE: Record<string, string> = {
  'crest-chevrons': 'dust.5', // shadow.1 would wash the card black
  'crest-sprig': 'scrub.1', // limestone.1 would wash it white; the charge colour is used
  'crest-track': 'gunmetal.3', // shadow.0 is black
  'crest-wave': 'water.1', // shadow.1 is black; the crest's own rim ring colour
};
export const RIM_SUBSTITUTE: Record<string, string> = {
  'crest-sprig': 'limestone.1', // the charge (scrub.1) is the darker tone and became the ground, so the crest's own ground is the rim
  'crest-claw': 'terracotta.0', // the mock's tone-on-tone rule; the charge itself is limestone.0
};

const luminance = (key: string): number => {
  const hex = paletteHex(key);
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

/** The crest's brightest charge tone (the lion draws its silhouette in `paint`). */
function brightestCharge(crest: (typeof CRESTS)[number]): string {
  const keys = crest.lion ? [crest.paint as string] : chargeOf(crest).map((p) => p.fill);
  return keys.reduce((a, b) => (luminance(b) >= luminance(a) ? b : a));
}

const toKey = (v: string): string => v.replace(/^var\(--rl-/, '').replace(/\)$/, '').replace(/-(\d+)$/, '.$1');

function cardPair(id: string): { ground: string; rim: string } {
  const m = new RegExp(`\\.rl-profile__card--head:has\\(\\[data-avatar='${id}'\\]\\)\\s*\\{([^}]*)\\}`).exec(css);
  expect(m, `no card rule for ${id}`).not.toBeNull();
  const get = (name: string): string => {
    const v = new RegExp(`--crest-${name}:\\s*([^;]+);`).exec((m as RegExpExecArray)[1]);
    expect(v, `${id} has no --crest-${name}`).not.toBeNull();
    return toKey((v as RegExpExecArray)[1].trim());
  };
  return { ground: get('ground'), rim: get('rim') };
}

describe('the header card echoes the crest (GH-1367 S4)', () => {
  it('there are twelve crests and twelve card rules', () => {
    expect(CRESTS).toHaveLength(12);
    expect(css.match(/\.rl-profile__card--head:has\(\[data-avatar='crest-[a-z]+'\]\)/g)).toHaveLength(12);
  });

  it.each(CRESTS.map((c) => [c.id, c] as const))('%s: ground and rim follow the generator', (id, crest) => {
    const pair = cardPair(id);
    expect(pair.ground).toBe(GROUND_SUBSTITUTE[id] ?? crest.ground);
    expect(pair.rim).toBe(RIM_SUBSTITUTE[id] ?? brightestCharge(crest));
  });

  it('every substitute is still needed and still different (a stale exemption fails)', () => {
    for (const [id, key] of Object.entries(GROUND_SUBSTITUTE)) expect(CRESTS.find((c) => c.id === id)?.ground).not.toBe(key);
    for (const [id, key] of Object.entries(RIM_SUBSTITUTE)) expect(brightestCharge(CRESTS.find((c) => c.id === id) as never)).not.toBe(key);
  });

  it('--ink stays AA (4.5:1) on the wash at its strongest, for every ground', () => {
    // 85% of the ground over the panel's solid (shadow.1) is the lightest the wash gets; ink and the crest ramps do not
    // move under any data-cvd set (only --bad, --bad-text, --friendly and the side colours do), so the four sets agree.
    const rgb = (k: string): number[] => [1, 3, 5].map((i) => parseInt(paletteHex(k).slice(i, i + 2), 16));
    const lum = (c: number[]): number => {
      const l = c.map((x) => x / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    };
    const ink = lum(rgb('limestone.0'));
    for (const id of CRESTS.map((c) => c.id)) {
      const g = rgb(cardPair(id).ground);
      const base = rgb('shadow.1');
      const wash = g.map((x, i) => Math.round(x * 0.85 + base[i] * 0.15));
      const ratio = (ink + 0.05) / (lum(wash) + 0.05);
      expect(ratio, `${id} ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
