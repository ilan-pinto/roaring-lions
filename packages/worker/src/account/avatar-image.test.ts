import { describe, it, expect } from 'vitest';
import { AVATAR_BYTES_MAX, avatarFormatOf, validateAvatarImage, type AvatarProblem } from './avatar-image';

// GH-1075 U1. The three "real" fixtures were written by Pillow (libwebp 256x256 solid colour, lossy and lossless;
// libjpeg 4:2:0, JFIF), standing in for a browser canvas: same container, same chunk and segment set. Every other
// fixture is built from these bytes in the test. Spec section 5.2 / 10 (U1).
const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const REAL_WEBP_LOSSY = hex('524946460e010000574542505650382002010000301b009d012a000100013f399ccb5f2f2b2925202801e02709696edff02f40bc01f80125ea1240080f28a1a86cfee1d5a6b3e5a39aa266e8e6ac9683b37f3a0ecd9a03c62d1cd5133799144cdd1cd592d0766cd01f3fb34078c5a39aa266e8e6b020766cd01e3168e6a899ba452266e8e6ac9683b36680f1b0ffa899ba39ab25a0ecd9a0b6cdc9aa266e8e6ac9683b37f3a0ecd9a03c62d1cd5133799144cdd1cd592d0766cd01f3fb34078c5a39aa266e8e6b020766cd01e3168e6a899ba452266e8e6ac9683b36680f1b0ffa899ba39ab25a0ecd9a0b6cdc9aa266e8e6ac9682e000fedfeefe90e5abf7ffb53f2b3ddf797b9d473a06cd7d29024ed96800028000');
const REAL_WEBP_LOSSLESS = hex('5249464624000000574542505650384c180000002fffc03f000750942217a5ff010045faff9f22fa9ffadf7f');
const REAL_JPEG = hex(
  'ffd8ffe000104a46494600010100000100010000ffdb004300ffffffffffffffffffffffffffffffffffffffffffffffffff'
  + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdb004301ffffffffffff'
  + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  + 'ffffffffffffffffffc00011080100010003012200021101031101ffc4001500010100000000000000000000000000000001'
  + 'ffc40014100100000000000000000000000000000000ffc400160101010100000000000000000000000000000102ffc40014'
  + '110100000000000000000000000000000000ffda000c03010002110311003f00802360000000000000000000000000000000'
  + '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  + '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  + '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  + '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  + '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  + '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  + '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  + '0000000000000000000000000000000000ffd9',
);

const cat = (...p: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(p.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of p) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const le32 = (n: number): Uint8Array => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
const be16 = (n: number): Uint8Array => Uint8Array.of((n >> 8) & 255, n & 255);

// ---- WebP builders ----
type Chunk = [string, Uint8Array];
function riff(chunks: Chunk[], sizeDelta = 0): Uint8Array {
  const body = chunks.map(([id, p]) => cat(ascii(id), le32(p.length), p, p.length & 1 ? Uint8Array.of(0) : new Uint8Array(0)));
  const rest = cat(ascii('WEBP'), ...body);
  return cat(ascii('RIFF'), le32(rest.length + sizeDelta), rest);
}
function chunksOf(w: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  let at = 12;
  while (at < w.length) {
    const size = (w[at + 4] ?? 0) | ((w[at + 5] ?? 0) << 8) | ((w[at + 6] ?? 0) << 16);
    out.push([String.fromCharCode(...w.slice(at, at + 4)), w.slice(at + 8, at + 8 + size)]);
    at += 8 + size + (size & 1);
  }
  return out;
}
const vp8x = (flags: number, w = 256, h = 256): Chunk => [
  'VP8X',
  Uint8Array.of(flags, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255, (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255),
];
const LOSSY = chunksOf(REAL_WEBP_LOSSY)[0] as Chunk; // ['VP8 ', payload]
const LOSSLESS = chunksOf(REAL_WEBP_LOSSLESS)[0] as Chunk; // ['VP8L', payload]
const patched = (c: Chunk, at: number, ...v: number[]): Chunk => {
  const p = c[1].slice();
  p.set(v, at);
  return [c[0], p];
};
const vp8Dim = (w: number, h: number): Chunk => patched(LOSSY, 6, w & 255, w >> 8, h & 255, h >> 8);
const vp8lDim = (w: number, h: number): Chunk => {
  const bits = (((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)) >>> 0;
  return patched(LOSSLESS, 1, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255);
};

// ---- JPEG builders ----
const seg = (m: number, body: Uint8Array): Uint8Array => cat(Uint8Array.of(0xff, m), be16(body.length + 2), body);
const AFTER_JFIF = 20; // SOI (2) + APP0 marker (2) + length (2) + 14 body bytes
const jpegWith = (extra: Uint8Array): Uint8Array => cat(REAL_JPEG.slice(0, AFTER_JFIF), extra, REAL_JPEG.slice(AFTER_JFIF));
const SOF_AT = (() => {
  for (let i = 0; i < REAL_JPEG.length - 1; i++) if (REAL_JPEG[i] === 0xff && REAL_JPEG[i + 1] === 0xc0) return i;
  throw new Error('fixture has no SOF0');
})();
const jpegPatched = (at: number, ...v: number[]): Uint8Array => {
  const j = REAL_JPEG.slice();
  j.set(v, SOF_AT + at);
  return j;
};
const SOS_AT = (() => {
  for (let i = 0; i < REAL_JPEG.length - 1; i++) if (REAL_JPEG[i] === 0xff && REAL_JPEG[i + 1] === 0xda) return i;
  throw new Error('fixture has no SOS');
})();

const verdict = (fmt: string, b: Uint8Array): string => {
  const v = validateAvatarImage(fmt, b);
  return v.ok ? 'ok' : v.problem;
};

describe('the fixtures are what they say', () => {
  it('real encoder output has the shape the builders assume', () => {
    expect(chunksOf(REAL_WEBP_LOSSY).map((c) => c[0])).toEqual(['VP8 ']);
    expect(chunksOf(REAL_WEBP_LOSSLESS).map((c) => c[0])).toEqual(['VP8L']);
    expect(riff([LOSSY])).toEqual(REAL_WEBP_LOSSY); // the builder reproduces the encoder's bytes exactly
    expect(riff([LOSSLESS])).toEqual(REAL_WEBP_LOSSLESS);
    expect(REAL_JPEG.slice(AFTER_JFIF - 2, AFTER_JFIF + 2)).toEqual(Uint8Array.of(0x00, 0x00, 0xff, 0xdb));
    expect(SOF_AT).toBeGreaterThan(AFTER_JFIF);
    expect(SOS_AT).toBeGreaterThan(SOF_AT);
  });
});

describe('accepted', () => {
  it.each([
    ['lossy WebP', 'webp', REAL_WEBP_LOSSY],
    ['lossless WebP', 'webp', REAL_WEBP_LOSSLESS],
    ['extended WebP, no flags', 'webp', riff([vp8x(0), LOSSY])],
    ['extended WebP, alpha flag, lossless', 'webp', riff([vp8x(0x10), LOSSLESS])],
    ['extended WebP with ALPH', 'webp', riff([vp8x(0x10), ['ALPH', Uint8Array.of(0, 1, 2)], LOSSY])],
    ['JPEG', 'jpeg', REAL_JPEG],
    ['JPEG with a restart interval', 'jpeg', jpegWith(seg(0xdd, be16(8)))],
    ['JPEG with a progressive SOF2', 'jpeg', jpegPatched(1, 0xc2)],
  ] as const)('%s', (_n, fmt, bytes) => {
    expect(verdict(fmt, bytes)).toBe('ok');
  });

  it('a stuffed byte and a restart marker inside entropy data do not end the scan', () => {
    const j = cat(REAL_JPEG.slice(0, REAL_JPEG.length - 2), Uint8Array.of(0xff, 0x00, 0x12, 0xff, 0xd0, 0x34), Uint8Array.of(0xff, 0xd9));
    expect(verdict('jpeg', j)).toBe('ok');
  });

  it('sniffs the format from the magic bytes', () => {
    expect(avatarFormatOf(REAL_WEBP_LOSSY)).toBe('webp');
    expect(avatarFormatOf(REAL_JPEG)).toBe('jpeg');
    expect(avatarFormatOf(Uint8Array.of(0x89, 0x50, 0x4e, 0x47))).toBeNull();
  });
});

const REFUSED_WEBP: [string, Uint8Array, AvatarProblem][] = [
  ['an EXIF chunk', riff([vp8x(0), ['EXIF', Uint8Array.of(1, 2)], LOSSY]), 'chunk_unknown'],
  ['an XMP chunk', riff([vp8x(0), ['XMP ', ascii('<x/>')], LOSSY]), 'chunk_unknown'],
  ['an ICCP chunk', riff([vp8x(0), ['ICCP', Uint8Array.of(1, 2)], LOSSY]), 'chunk_unknown'],
  ['an ANIM chunk', riff([vp8x(0), ['ANIM', new Uint8Array(6)], LOSSY]), 'chunk_unknown'],
  ['an ANMF chunk', riff([vp8x(0), ['ANMF', new Uint8Array(16)]]), 'chunk_unknown'],
  ['an unknown chunk after the image', riff([LOSSY, ['JUNK', Uint8Array.of(1, 2)]]), 'chunk_unknown'],
  ['an ICC flag in VP8X', riff([vp8x(0x20), LOSSY]), 'vp8x_flags'],
  ['an EXIF flag in VP8X', riff([vp8x(0x08), LOSSY]), 'vp8x_flags'],
  ['an XMP flag in VP8X', riff([vp8x(0x04), LOSSY]), 'vp8x_flags'],
  ['an ANIM flag in VP8X', riff([vp8x(0x02), LOSSY]), 'vp8x_flags'],
  ['a reserved flag in VP8X', riff([vp8x(0x01), LOSSY]), 'vp8x_flags'],
  ['a VP8X of the wrong size', riff([['VP8X', new Uint8Array(12)], LOSSY]), 'vp8x_size'],
  ['a VP8X canvas of 257 px', riff([vp8x(0, 257, 256), LOSSY]), 'dimensions'],
  ['a lossy image 257 px wide', riff([vp8Dim(257, 256)]), 'dimensions'],
  ['a lossy image 257 px tall', riff([vp8Dim(256, 257)]), 'dimensions'],
  ['a lossy image 255 px', riff([vp8Dim(255, 255)]), 'dimensions'],
  ['a lossless image 257 px wide', riff([vp8lDim(257, 256)]), 'dimensions'],
  ['a lossless image 257 px tall', riff([vp8lDim(256, 257)]), 'dimensions'],
  ['a RIFF size one too large', riff([LOSSY], 1), 'riff_size'],
  ['a RIFF size one too small', riff([LOSSY], -1), 'riff_size'],
  ['a trailing byte after the last chunk', cat(REAL_WEBP_LOSSY, Uint8Array.of(0)), 'riff_size'],
  ['a trailing byte the RIFF size admits', (() => { const w = cat(REAL_WEBP_LOSSY, Uint8Array.of(0)); w.set(le32(w.length - 8), 4); return w; })(), 'truncated'],
  ['a chunk that overruns the file', (() => { const w = REAL_WEBP_LOSSY.slice(); w.set(le32(10000), 16); return w; })(), 'chunk_size'],
  ['an odd chunk that overruns the file', (() => { const w = REAL_WEBP_LOSSY.slice(); w.set(le32(9999), 16); return w; })(), 'chunk_size'],
  ['ALPH before a lossless image', riff([vp8x(0x10), ['ALPH', Uint8Array.of(0)], LOSSLESS]), 'chunk_order'],
  ['VP8X with no image', riff([vp8x(0)]), 'chunk_order'],
  ['two images', riff([LOSSY, LOSSY]), 'chunk_order'],
  ['the image before VP8X', riff([LOSSY, vp8x(0)]), 'chunk_order'],
  ['a lossy bitstream with no start code', riff([patched(LOSSY, 3, 0, 0, 0)]), 'bitstream'],
  ['a lossless bitstream with no signature', riff([patched(LOSSLESS, 0, 0)]), 'bitstream'],
  ['a non-zero padding byte', (() => { const w = riff([vp8x(0), ['ALPH', Uint8Array.of(1)], LOSSY]); const at = w.length - (LOSSY[1].length + 8) - 1; w[at] = 7; return w; })(), 'chunk_padding'],
  ['an odd last chunk missing its pad byte', (() => { const w = cat(REAL_WEBP_LOSSLESS, Uint8Array.of(0)); w.set(le32(25), 16); w.set(le32(w.length - 8), 4); return w; })(), 'chunk_size'],
  ['a file cut short', REAL_WEBP_LOSSY.slice(0, 15), 'truncated'],
];

describe('WebP refusals', () => {
  it.each(REFUSED_WEBP)('%s', (_n, bytes, problem) => {
    expect(verdict('webp', bytes)).toBe(problem);
  });
});

const REFUSED_JPEG: [string, Uint8Array, AvatarProblem][] = [
  ['an APP1 (EXIF) segment', jpegWith(seg(0xe1, ascii('Exif\0\0II*\0'))), 'segment_forbidden'],
  ['an APP1 (XMP) segment', jpegWith(seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0'))), 'segment_forbidden'],
  ['an APP2 (ICC) segment', jpegWith(seg(0xe2, ascii('ICC_PROFILE\x00\x01\x01'))), 'segment_forbidden'],
  ['an APP13 (Photoshop) segment', jpegWith(seg(0xed, ascii('Photoshop 3.0\0'))), 'segment_forbidden'],
  ['an APP15 segment', jpegWith(seg(0xef, Uint8Array.of(1))), 'segment_forbidden'],
  ['a COM segment', jpegWith(seg(0xfe, ascii('hello'))), 'segment_forbidden'],
  ['a COM segment after the scan header', cat(REAL_JPEG.slice(0, SOS_AT), seg(0xfe, ascii('x')), REAL_JPEG.slice(SOS_AT)), 'segment_forbidden'],
  ['an APP0 that is not JFIF', (() => { const j = REAL_JPEG.slice(); j.set(ascii('JFXX'), 6); return j; })(), 'jfif'],
  ['a second APP0', jpegWith(seg(0xe0, ascii('JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'))), 'segment_order'],
  ['a baseline-extended SOF1', jpegPatched(1, 0xc1), 'segment_forbidden'],
  ['a lossless SOF3', jpegPatched(1, 0xc3), 'segment_forbidden'],
  ['an arithmetic SOF9', jpegPatched(1, 0xc9), 'segment_forbidden'],
  ['a DNL segment', jpegWith(seg(0xdc, be16(256))), 'segment_forbidden'],
  ['a trailing byte after EOI', cat(REAL_JPEG, Uint8Array.of(0)), 'trailer'],
  ['a second image after EOI', cat(REAL_JPEG, REAL_JPEG), 'trailer'],
  ['a missing EOI', REAL_JPEG.slice(0, REAL_JPEG.length - 2), 'truncated'],
  ['a width of 257', jpegPatched(7, 0x01, 0x01), 'dimensions'],
  ['a height of 257', jpegPatched(5, 0x01, 0x01), 'dimensions'],
  ['a width of 255', jpegPatched(7, 0x00, 0xff), 'dimensions'],
  ['one component', jpegPatched(9, 1), 'components'],
  ['four components', jpegPatched(9, 4), 'components'],
  ['12-bit precision', jpegPatched(4, 12), 'precision'],
  ['two SOF segments', cat(REAL_JPEG.slice(0, SOS_AT), REAL_JPEG.slice(SOF_AT, SOS_AT), REAL_JPEG.slice(SOS_AT)), 'segment_order'],
  ['a scan before any frame header', cat(REAL_JPEG.slice(0, AFTER_JFIF), REAL_JPEG.slice(SOS_AT)), 'segment_order'],
  ['a segment length that overruns the file', jpegPatched(2, 0xff, 0xff), 'segment_size'],
  ['a segment length under 2', jpegWith(Uint8Array.of(0xff, 0xdd, 0, 1)), 'segment_size'],
  ['a fill byte before a marker', cat(REAL_JPEG.slice(0, 2), Uint8Array.of(0xff), REAL_JPEG.slice(2)), 'segment_forbidden'],
  ['a file cut short', REAL_JPEG.slice(0, 3), 'truncated'],
  ['EOI straight after JFIF, no frame', cat(REAL_JPEG.slice(0, AFTER_JFIF), Uint8Array.of(0xff, 0xd9)), 'segment_order'],
  ['EOI after the frame header, no scan', cat(REAL_JPEG.slice(0, SOS_AT), Uint8Array.of(0xff, 0xd9)), 'segment_order'],
];

describe('JPEG refusals', () => {
  it.each(REFUSED_JPEG)('%s', (_n, bytes, problem) => {
    expect(verdict('jpeg', bytes)).toBe(problem);
  });
});

describe('format and size', () => {
  it('refuses a WebP claimed as JPEG and a JPEG claimed as WebP', () => {
    expect(verdict('jpeg', REAL_WEBP_LOSSY)).toBe('format_mismatch');
    expect(verdict('webp', REAL_JPEG)).toBe('format_mismatch');
  });
  it('refuses a claim of any other name, whatever the bytes', () => {
    expect(verdict('png', REAL_WEBP_LOSSY)).toBe('format_mismatch');
    expect(verdict('', REAL_JPEG)).toBe('format_mismatch');
  });
  it('refuses a PNG and noise as unknown formats', () => {
    expect(verdict('webp', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBe('unknown_format');
    expect(verdict('jpeg', new Uint8Array(40))).toBe('unknown_format');
    expect(verdict('webp', new Uint8Array(0))).toBe('unknown_format');
  });
  it('refuses a RIFF that is not WebP', () => {
    const w = REAL_WEBP_LOSSY.slice();
    w.set(ascii('WAVE'), 8);
    expect(verdict('webp', w)).toBe('unknown_format');
  });
  it('holds the cap at 48 KiB: the limit passes the size check, one more byte is too_big', () => {
    const base = riff([vp8x(0), ['ALPH', new Uint8Array(0)], LOSSY]).length;
    const pad = (n: number): Uint8Array => riff([vp8x(0), ['ALPH', new Uint8Array(n - base)], LOSSY]);
    const atCap = pad(AVATAR_BYTES_MAX);
    expect(atCap.length).toBe(AVATAR_BYTES_MAX);
    expect(verdict('webp', atCap)).toBe('ok');
    const over = cat(REAL_JPEG, new Uint8Array(AVATAR_BYTES_MAX));
    expect(verdict('jpeg', over)).toBe('too_big');
    expect(verdict('webp', riff([vp8x(0), ['ALPH', new Uint8Array(AVATAR_BYTES_MAX)], LOSSY]))).toBe('too_big');
  });
});
