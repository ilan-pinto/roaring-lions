/**
 * GH-1096 S1: the Roaring Lion insignia's maths, its colour and its texture (spec section 9, gates 3 and 9).
 *
 * Gate 3, the maths, on `NUMBER_OPS` with a CPU bilinear sample of the COMMITTED distance field
 * (`assets/textures/insignia/roaring_lion_sdf.png`, decoded here by a twenty-line reader: the bake writes filter 0 on every row
 * and this refuses anything else). The points are LITERALS in emblem coordinates, read off the texture once:
 *  - (0.50, 0.66), above the centre: the brow, silhouette and no cut-out (R 255, G 0);
 *  - (0.50, 0.34), below the centre: the open jaw, a cut-out (R 255, G 255);
 *  - (0.20, 0.02): outside the roundel (R 0).
 * The emblem is left-right symmetric, so nothing else would catch an upside-down lion: the brow-above / jaw-below pair is the pin.
 * The spec's "the disc centre at 30 px gets 0.85" is not used: the centre (0.5, 0.5) is the nose cut-out (G 175), so at 30 px it
 * reads 0, correctly. The brow point stands in for it.
 *
 * Gate 9, the colour: the key exists in `data/palette.json`, in a RAMP, never a `reserved` band, and the shader receives it linear.
 *
 * Each has a one-line falsification, run by hand and listed in the commit message.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import {
  INSIGNIA_BANDS_PX,
  INSIGNIA_COLOR_KEY,
  INSIGNIA_FRAGMENT,
  INSIGNIA_FRAGMENT_HEAD,
  INSIGNIA_GRIME,
  INSIGNIA_LUMA_WEIGHTS,
  INSIGNIA_NORMAL_SOFT,
  INSIGNIA_SDF_EDGE,
  INSIGNIA_STRENGTH,
  InsigniaShared,
  insigniaCoordOps,
  insigniaOps,
  setInsigniaStrength,
  type InsigniaInput,
} from './insignia';
import { hexToLinear } from '../terrain/shared';

afterEach(() => setInsigniaStrength(true));

const PNG_URL = new URL('../../../../../assets/textures/insignia/roaring_lion_sdf.png', import.meta.url);
const PALETTE_URL = new URL('../../../../../data/palette.json', import.meta.url);

/** The committed PNG's RGBA bytes (8-bit RGBA, no interlace, filter 0 on every row: what `bake_sdf.py` writes). */
function readSdf(): { w: number; h: number; rgba: Uint8Array } {
  const buf = readFileSync(PNG_URL);
  let off = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('spec: not 8-bit RGBA, non-interlaced');
    } else if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (raw[y * (w * 4 + 1)] !== 0) throw new Error(`spec: row ${y} is not filter 0`);
    rgba.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return { w, h, rgba };
}

const SDF = readSdf();

/** A bilinear sample at `st`, as WebGL samples a `flipY` texture: v = 1 is the image's TOP row. 0..1 per channel. */
function sample(st: readonly [number, number]): [number, number] {
  const { w, h, rgba } = SDF;
  const fx = st[0] * w - 0.5;
  const fy = (1 - st[1]) * h - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number, c: number): number =>
    rgba[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c]!;
  const ch = (c: number): number => {
    const a = at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx;
    const b = at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx;
    return (a * (1 - ty) + b * ty) / 255;
  };
  return [ch(0), ch(1)];
}

/** The Lavi's frame, as literals (cx, cy, D, min_n; slab). */
const FRAME: [number, number, number, number] = [0.95, 1.0, 0.6, 0.6];
const SLAB: [number, number] = [1.6, 1.95];
const COLOR: [number, number, number] = [0.79, 0.69, 0.51];

/** A fragment at emblem coordinate `e` on the +z flank (|z| 1.70), seen at `px` CSS px across the emblem. */
function at(e: readonly [number, number], px: number, over: Partial<InsigniaInput<number>> = {}): InsigniaInput<number> {
  const p: [number, number, number] = [FRAME[0] + (e[0] - 0.5) * FRAME[2], FRAME[1] + (e[1] - 0.5) * FRAME[2], 1.7];
  const pos = over.p ?? p;
  const c = insigniaCoordOps(NUMBER_OPS, pos, FRAME);
  const pixelRatio = over.pixelRatio ?? 1;
  return {
    p: pos,
    n: [0, 0, 1],
    e: c.e,
    rateE: [1 / (px * pixelRatio), 1 / (px * pixelRatio)],
    rateZ: 1e-4,
    sample: sample(c.st),
    rateS: [0.004, 0.004],
    frame: FRAME,
    slab: SLAB,
    bands: INSIGNIA_BANDS_PX,
    pixelRatio,
    strength: INSIGNIA_STRENGTH,
    luma: 0.12277,
    color: COLOR,
    diffuse: [0.12, 0.12, 0.12],
    ...over,
  };
}

const BROW: [number, number] = [0.5, 0.66];
const JAW: [number, number] = [0.5, 0.34];
const mask = (i: InsigniaInput<number>): number => insigniaOps(NUMBER_OPS, i).mask;

describe('gate 3: the insignia maths on numbers (NUMBER_OPS, the committed texture)', () => {
  it('reads the literals the points were chosen by: the brow is silhouette, the jaw a cut-out, the corner outside', () => {
    const c = (e: readonly [number, number]): [number, number] => sample(insigniaCoordOps(NUMBER_OPS, [FRAME[0] + (e[0] - 0.5) * 0.6, FRAME[1] + (e[1] - 0.5) * 0.6, 1.7], FRAME).st);
    expect(c(BROW)[0]).toBeGreaterThan(0.95);
    expect(c(BROW)[1]).toBeLessThan(0.05);
    expect(c(JAW)[0]).toBeGreaterThan(0.95);
    expect(c(JAW)[1]).toBeGreaterThan(0.95);
    expect(c([0.2, 0.02])[0]).toBeLessThan(0.05);
  });

  it('a silhouette fragment at 30 px reads the full strength 0.85; at 4 px, under the roundel band, nothing', () => {
    expect(mask(at(BROW, 30))).toBe(0.85);
    expect(mask(at(BROW, 4))).toBe(0);
    // inside the roundel's fade (5..7.5): partway
    const fading = mask(at(BROW, 6.25));
    expect(fading).toBeGreaterThan(0.2);
    expect(fading).toBeLessThan(0.65);
  });

  it('the lion stands upright: at 30 px the brow ABOVE the centre is painted and the jaw BELOW it is not', () => {
    expect(mask(at(BROW, 30))).toBe(0.85);
    expect(mask(at(JAW, 30))).toBe(0);
  });

  it('a cut-out fragment keeps the silhouette under the detail band (9 px, and 14 px: the band is 15-20, not 11-15)', () => {
    expect(mask(at(JAW, 9))).toBe(0.85);
    expect(mask(at(JAW, 14))).toBe(0.85);
    const forming = mask(at(JAW, 17.5));
    expect(forming).toBeGreaterThan(0.2);
    expect(forming).toBeLessThan(0.65);
    expect(mask(at(JAW, 20))).toBe(0);
  });

  it('the band reads CSS px: at pixel ratio 2 the same emblem changes band at the same CSS size', () => {
    expect(mask(at(JAW, 9, { pixelRatio: 2 }))).toBe(0.85);
    expect(mask(at(JAW, 20, { pixelRatio: 2 }))).toBe(0);
    expect(insigniaOps(NUMBER_OPS, at(BROW, 12, { pixelRatio: 2 })).px).toBeCloseTo(12, 9);
  });

  it('the -z flank equals the +z flank, whichever way its normal points (the Lavi\'s mirrored -z skirt points +z)', () => {
    const plus = mask(at(BROW, 30));
    const pos = at(BROW, 30).p;
    const minus: [number, number, number] = [pos[0], pos[1], -pos[2]];
    expect(mask(at(BROW, 30, { p: minus, n: [0, 0, -1] }))).toBe(plus);
    expect(mask(at(BROW, 30, { p: minus, n: [0, 0, 1] }))).toBe(plus);
  });

  it('a fragment that is not on a flank face, not in the slab or not in the disc reads 0', () => {
    expect(mask(at(BROW, 30, { n: [0, 1, 0] }))).toBe(0); // the roof
    expect(mask(at(BROW, 30, { n: [1, 0, 0] }))).toBe(0); // the glacis
    const pos = at(BROW, 30).p;
    expect(mask(at(BROW, 30, { p: [pos[0], pos[1], 1.2] }))).toBe(0); // inside the hull
    expect(mask(at(BROW, 30, { p: [pos[0], pos[1], 2.1] }))).toBe(0); // beyond the outer plate
    expect(mask(at([0.2, 0.02], 30))).toBe(0); // the corner of the frame, outside the roundel
    expect(mask(at([1.4, 0.5], 30))).toBe(0); // beside the disc, where the clamped texture's border would read
  });

  it('the paint: at luma(diffuse) = the frame\'s luma and strength 1 it is the colour exactly; at strength 0 the diffuse', () => {
    const g = 0.12277;
    const r = insigniaOps(NUMBER_OPS, at(BROW, 30, { strength: 1, diffuse: [g, g, g] }));
    expect(r.mask).toBe(1);
    for (let c = 0; c < 3; c++) expect(r.rgb[c]).toBeCloseTo(COLOR[c]!, 12);
    expect(insigniaOps(NUMBER_OPS, at(BROW, 30, { strength: 0, diffuse: [0.3, 0.2, 0.1] })).rgb).toEqual([0.3, 0.2, 0.1]);
  });

  it('is the chunk the legacy material runs: its constants and its uniforms, literal by literal', () => {
    expect(INSIGNIA_BANDS_PX).toEqual([5, 7.5, 15, 20]);
    expect(INSIGNIA_STRENGTH).toBe(0.85);
    expect(INSIGNIA_FRAGMENT).toContain(`vec3( ${INSIGNIA_LUMA_WEIGHTS.join(', ')} )`);
    expect(INSIGNIA_FRAGMENT).toContain(`mix( 1.0, rlInsY / uInsLuma, ${INSIGNIA_GRIME} )`);
    expect(INSIGNIA_FRAGMENT).toContain(`smoothstep( uInsFrame.w - ${INSIGNIA_NORMAL_SOFT}, uInsFrame.w + ${INSIGNIA_NORMAL_SOFT}, abs( rlIN.z ) )`);
    expect(INSIGNIA_FRAGMENT).toContain('smoothstep( uInsBands.x, uInsBands.y, rlInsPx )');
    expect(INSIGNIA_FRAGMENT).toContain('( 1.0 - smoothstep( uInsBands.z, uInsBands.w, rlInsPx ) * rlInsEdge( rlIS.g, rlIRS.y ) )');
    expect(INSIGNIA_FRAGMENT).toContain('texture2D( uInsSdf, 0.03125 + 0.9375 * rlIE )');
    expect(INSIGNIA_FRAGMENT).toContain('/ uInsPixelRatio');
    expect(INSIGNIA_FRAGMENT_HEAD).toContain(`( s - ${INSIGNIA_SDF_EDGE} )`);
    expect(INSIGNIA_SDF_EDGE).toBeCloseTo(128 / 255, 12);
    // Every statement of the legacy chunk, as LITERALS, so a dropped `abs`, a wrong axis or a lost coverage term is red. The chunk
    // is a hand-written twin of `insigniaOps`; these are the lines the numbers above cannot reach (the derivatives, the fetch).
    const body = INSIGNIA_FRAGMENT.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('//'));
    expect(body).toEqual([
      '{',
      'vec3 rlIP = vMarkPos;',
      'vec3 rlIN = normalize( vMarkNrm );',
      'vec2 rlIE = ( rlIP.xy - uInsFrame.xy ) / uInsFrame.z + 0.5;',
      'vec4 rlIS = texture2D( uInsSdf, 0.03125 + 0.9375 * rlIE );',
      'vec2 rlIRE = vec2( fwidth( rlIE.x ), fwidth( rlIE.y ) );',
      'vec2 rlIRS = vec2( fwidth( rlIS.r ), fwidth( rlIS.g ) );',
      'float rlIRZ = fwidth( abs( rlIP.z ) );',
      'float rlInside = rlInsCov( abs( rlIP.z ), uInsSlab.x, uInsSlab.y, rlIRZ )',
      '* smoothstep( uInsFrame.w - 0.04, uInsFrame.w + 0.04, abs( rlIN.z ) )',
      '* rlInsCov( rlIE.x, 0.0, 1.0, rlIRE.x ) * rlInsCov( rlIE.y, 0.0, 1.0, rlIRE.y );',
      'float rlInsPx = 1.0 / max( max( rlIRE.x, rlIRE.y ), 1e-5 ) / uInsPixelRatio;',
      'float rlInsMask = uInsStrength * rlInside * smoothstep( uInsBands.x, uInsBands.y, rlInsPx ) * rlInsEdge( rlIS.r, rlIRS.x )',
      '* ( 1.0 - smoothstep( uInsBands.z, uInsBands.w, rlInsPx ) * rlInsEdge( rlIS.g, rlIRS.y ) );',
      'float rlInsY = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );',
      'vec3 rlInsPaint = min( uInsColor * mix( 1.0, rlInsY / uInsLuma, 0.3 ), vec3( 1.0 ) );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, rlInsPaint, rlInsMask );',
      '}',
    ]);
    // ...and its two helpers.
    expect(INSIGNIA_FRAGMENT_HEAD).toContain('return clamp( ( v - lo ) / w + 0.5, 0.0, 1.0 ) * clamp( ( hi - v ) / w + 0.5, 0.0, 1.0 );');
    expect(INSIGNIA_FRAGMENT_HEAD).toContain('float w = max( rate, 1e-5 );');
    expect(INSIGNIA_FRAGMENT_HEAD).toContain('return clamp( ( s - 0.5019607843137255 ) / max( rate, 1e-5 ) + 0.5, 0.0, 1.0 );');
    // No branch: the fetch and every derivative are unconditional.
    expect(INSIGNIA_FRAGMENT).not.toMatch(/\bif\s*\(/);
  });
});

describe('gate 9: the colour is a palette key, never a team slot', () => {
  const palette = JSON.parse(readFileSync(PALETTE_URL, 'utf8')) as {
    ramps: Record<string, { colors: string[] }>;
    reserved: Record<string, unknown>;
  };

  it('the key is the lead\'s decision 5: limestone.1', () => {
    expect(INSIGNIA_COLOR_KEY).toBe('limestone.1');
  });

  it('the key exists in a RAMP of data/palette.json and its band is not reserved', () => {
    const [band, index] = INSIGNIA_COLOR_KEY.split('.');
    expect(Object.keys(palette.reserved)).not.toContain(band);
    expect(palette.ramps[band!]?.colors[Number(index)]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('the shader receives it LINEAR, and a colour-vision switch (which writes team slots) cannot reach it', () => {
    const [band, index] = INSIGNIA_COLOR_KEY.split('.');
    const hex = palette.ramps[band!]!.colors[Number(index)]!;
    const shared = new InsigniaShared();
    expect(shared.color.value.toArray()).toEqual(hexToLinear(hex));
    shared.dispose();
  });
});

describe('the texture: a placeholder until it lands, fail-soft', () => {
  it('binds a 1 x 1 "outside" placeholder (R 0), swaps the uniform VALUE on load, and prepares it as data', () => {
    const shared = new InsigniaShared();
    const placeholder = shared.sdf.value as THREE.DataTexture;
    expect(placeholder.image.width).toBe(1);
    expect((placeholder.image.data as Uint8Array)[0]).toBe(0);
    // filtered, or WGSL builds an unfiltered textureLoad the real field would inherit
    expect(placeholder.magFilter).toBe(THREE.LinearFilter);
    expect(placeholder.minFilter).toBe(THREE.LinearFilter);
    expect(shared.hasTexture).toBe(false);
    const uniform = shared.sdf;
    const real = new THREE.Texture();
    shared.setTexture(real);
    expect(shared.sdf).toBe(uniform); // the same uniform object: no recompile
    expect(shared.sdf.value).toBe(real);
    expect(real.colorSpace).toBe(THREE.NoColorSpace);
    expect(real.premultiplyAlpha).toBe(false);
    expect(real.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(real.wrapS).toBe(THREE.ClampToEdgeWrapping);
    shared.dispose();
  });

  it('a failed load names the file and keeps the placeholder', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, _ok, _progress, fail) => {
      fail?.(new Error('404') as unknown as ErrorEvent);
      return new THREE.Texture();
    });
    const shared = new InsigniaShared();
    const placeholder = shared.sdf.value;
    await shared.load('/x/textures/insignia/roaring_lion_sdf.png');
    expect(shared.sdf.value).toBe(placeholder);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('/x/textures/insignia/roaring_lion_sdf.png'));
    load.mockRestore();
    err.mockRestore();
    shared.dispose();
  });
});
