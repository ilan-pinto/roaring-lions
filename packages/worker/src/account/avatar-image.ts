// GH-1075 U1: strict STRUCTURAL validation of an uploaded avatar. Pure functions over bytes: no pixel
// decoding (a Worker binds nothing that decodes images), no routes, no storage. Spec section 5.2.
//
// The browser re-encodes to a 256 px canvas WebP (or JPEG), which carries pixels only. The server cannot prove
// that, so it refuses every container that could carry anything else: EXIF, XMP, ICC, animation, comments,
// trailing bytes, and any chunk or segment outside the small set a canvas encoder writes.

export const AVATAR_SIDE = 256;
export const AVATAR_BYTES_MAX = 48 * 1024;

export type AvatarFormat = 'webp' | 'jpeg';

export type AvatarProblem =
  | 'too_big'
  | 'unknown_format'
  | 'format_mismatch'
  | 'truncated'
  | 'riff_size'
  | 'chunk_unknown'
  | 'chunk_order'
  | 'chunk_size'
  | 'chunk_padding'
  | 'vp8x_flags'
  | 'vp8x_size'
  | 'bitstream'
  | 'dimensions'
  | 'segment_forbidden'
  | 'segment_order'
  | 'segment_size'
  | 'jfif'
  | 'components'
  | 'precision'
  | 'trailer';

export type AvatarVerdict = { ok: true; format: AvatarFormat } | { ok: false; problem: AvatarProblem };

const ok = (format: AvatarFormat): AvatarVerdict => ({ ok: true, format });
const no = (problem: AvatarProblem): AvatarVerdict => ({ ok: false, problem });

/** The format the magic bytes say, never what the client claims. */
export function avatarFormatOf(b: Uint8Array): AvatarFormat | null {
  if (b.length >= 12 && tag(b, 0) === 'RIFF' && tag(b, 8) === 'WEBP') return 'webp';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}

/** `claimed` is the request's `format` field; it has to agree with the magic bytes. */
export function validateAvatarImage(claimed: string, b: Uint8Array): AvatarVerdict {
  if (b.length > AVATAR_BYTES_MAX) return no('too_big');
  const sniffed = avatarFormatOf(b);
  if (sniffed === null) return no('unknown_format');
  if (claimed !== sniffed) return no('format_mismatch');
  return sniffed === 'webp' ? validateWebp(b) : validateJpeg(b);
}

function tag(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
}
const u16le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number): number => u16le(b, at) | ((b[at + 2] ?? 0) << 16);
const u32le = (b: Uint8Array, at: number): number => (u24le(b, at) | ((b[at + 3] ?? 0) << 24)) >>> 0;
const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);

// ---- WebP ---------------------------------------------------------------------------------------------------

// VP8X flags byte: ICC 0x20, alpha 0x10, EXIF 0x08, XMP 0x04, animation 0x02, one reserved bit. A canvas encoder
// may set alpha and nothing else, so every other bit (the four metadata and animation flags included) is refused.
const VP8X_FLAG_ALPHA = 0x10;

const WEBP_CHUNKS = new Set(['VP8X', 'ALPH', 'VP8 ', 'VP8L']);

interface Chunk {
  id: string;
  start: number; // payload start
  size: number;
}

export function validateWebp(b: Uint8Array): AvatarVerdict {
  if (b.length < 20) return no('truncated');
  if (u32le(b, 4) !== b.length - 8) return no('riff_size');

  const chunks: Chunk[] = [];
  let at = 12;
  while (at < b.length) {
    if (at + 8 > b.length) return no('truncated');
    const id = tag(b, at);
    const size = u32le(b, at + 4);
    const start = at + 8;
    if (!WEBP_CHUNKS.has(id)) return no('chunk_unknown');
    const end = start + size;
    if (end > b.length) return no('chunk_size');
    const pad = size & 1;
    if (pad === 1) {
      if (end + 1 > b.length) return no('chunk_size');
      if (b[end] !== 0) return no('chunk_padding');
    }
    chunks.push({ id, start, size });
    at = end + pad;
  }

  // Legal orders: [VP8 ] | [VP8L] | [VP8X, VP8 ] | [VP8X, VP8L] | [VP8X, ALPH, VP8 ].
  const ids = chunks.map((c) => c.id).join(',');
  const LEGAL = ['VP8 ', 'VP8L', 'VP8X,VP8 ', 'VP8X,VP8L', 'VP8X,ALPH,VP8 '];
  if (!LEGAL.includes(ids)) return no('chunk_order');

  let canvas: { w: number; h: number } | null = null;
  const first = chunks[0];
  if (first && first.id === 'VP8X') {
    if (first.size !== 10) return no('vp8x_size');
    const flags = b[first.start] ?? 0;
    if (flags & ~VP8X_FLAG_ALPHA) return no('vp8x_flags');
    canvas = { w: u24le(b, first.start + 4) + 1, h: u24le(b, first.start + 7) + 1 };
  }

  const image = chunks[chunks.length - 1];
  if (!image) return no('truncated');
  const dims = image.id === 'VP8L' ? vp8lSize(b, image) : vp8Size(b, image);
  if (dims === null) return no('bitstream');
  if (dims.w !== AVATAR_SIDE || dims.h !== AVATAR_SIDE) return no('dimensions');
  if (canvas !== null && (canvas.w !== AVATAR_SIDE || canvas.h !== AVATAR_SIDE)) return no('dimensions');
  return ok('webp');
}

/** Key frame: tag bit 0 clear, start code 9d 01 2a, then 14-bit width and height (scale bits ignored). */
function vp8Size(b: Uint8Array, c: Chunk): { w: number; h: number } | null {
  if (c.size < 10) return null;
  const s = c.start;
  if (((b[s] ?? 1) & 1) !== 0) return null;
  if (b[s + 3] !== 0x9d || b[s + 4] !== 0x01 || b[s + 5] !== 0x2a) return null;
  return { w: u16le(b, s + 6) & 0x3fff, h: u16le(b, s + 8) & 0x3fff };
}

/** Signature 0x2f, then width-1 (14 bits) and height-1 (14 bits) packed little-endian. */
function vp8lSize(b: Uint8Array, c: Chunk): { w: number; h: number } | null {
  if (c.size < 5) return null;
  const s = c.start;
  if (b[s] !== 0x2f) return null;
  const bits = u32le(b, s + 1);
  return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
}

// ---- JPEG ---------------------------------------------------------------------------------------------------

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DHT = 0xc4;
const DRI = 0xdd;
const SOF0 = 0xc0;
const SOF2 = 0xc2;
const APP0 = 0xe0;

export function validateJpeg(b: Uint8Array): AvatarVerdict {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return no('truncated');
  let at = 2;
  let sawSof = false;
  let sawApp0 = false;
  let scans = 0;

  for (;;) {
    // A marker: 0xFF then a non-0, non-0xFF code. A fill byte or anything else is refused.
    if (at + 2 > b.length) return no('truncated');
    if (b[at] !== 0xff) return no('segment_order');
    const m = b[at + 1] ?? 0;
    at += 2;

    if (m === EOI) {
      if (!sawSof || scans === 0) return no('segment_order');
      return at === b.length ? ok('jpeg') : no('trailer');
    }
    const allowed = m === APP0 || m === DQT || m === DHT || m === DRI || m === SOF0 || m === SOF2 || m === SOS;
    if (!allowed) return no('segment_forbidden');

    if (at + 2 > b.length) return no('truncated');
    const len = u16be(b, at);
    if (len < 2 || at + len > b.length) return no('segment_size');
    const body = at + 2;
    const bodyLen = len - 2;

    if (m === APP0) {
      // JFIF only, and only first.
      if (sawApp0 || sawSof || scans > 0 || at !== 4) return no('segment_order');
      if (bodyLen < 14 || tag(b, body) !== 'JFIF' || b[body + 4] !== 0) return no('jfif');
      sawApp0 = true;
    } else if (m === SOF0 || m === SOF2) {
      if (sawSof || scans > 0) return no('segment_order');
      if (bodyLen < 6) return no('segment_size');
      if (b[body] !== 8) return no('precision');
      const h = u16be(b, body + 1);
      const w = u16be(b, body + 3);
      const nf = b[body + 5] ?? 0;
      if (nf !== 3) return no('components');
      if (bodyLen !== 6 + 3 * nf) return no('segment_size');
      if (w !== AVATAR_SIDE || h !== AVATAR_SIDE) return no('dimensions');
      sawSof = true;
    } else if (m === SOS) {
      if (!sawSof) return no('segment_order');
      scans += 1;
      at += len;
      // Entropy-coded data: runs to the next real marker. FF00 is a stuffed byte, FFD0-FFD7 a restart.
      for (;;) {
        if (at >= b.length) return no('truncated');
        if (b[at] !== 0xff) {
          at += 1;
          continue;
        }
        const n = b[at + 1];
        if (n === undefined) return no('truncated');
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
          at += 2;
          continue;
        }
        break; // a real marker: the outer loop judges it
      }
      continue;
    }
    // DQT / DHT / DRI: tables, skipped by their length.
    at += len;
  }
}
