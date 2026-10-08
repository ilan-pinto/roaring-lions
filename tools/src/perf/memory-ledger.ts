// The GPU half of `pnpm perf:memory`: a ledger of every byte the page ASKS
// WebGL to hold, kept by wrapping the allocation calls themselves.
//
// Why wrap the GL calls rather than read `renderer.info.memory`: three's
// `info.memory` is two COUNTS (geometries, textures) and nothing else -- no
// bytes, no render targets, no shadow map, and nothing for the menu's scene
// host or the campaign board, which are separate renderers. A ledger at the GL
// boundary sees every context the page opens (menu diorama, campaign board,
// mission), sees render targets and renderbuffers three's counters never
// list, and needs no change to the game: it is installed by Playwright's
// `addInitScript`, before any page script runs.
//
// What it counts is LOGICAL bytes -- width x height x bytes-per-texel per mip
// level, `bufferData` sizes, renderbuffer storage x samples -- not what a
// driver actually reserves (alignment, padding, tiling, the compositor's own
// copies). Read it as "what the game asked for", which is the part the game
// can change. Two estimates are labelled as such: RGB formats are counted at
// four bytes a texel (drivers pad them), and the default framebuffer is
// estimated from the canvas size and its context attributes.
//
// Three more ledgers ride along, because the GPU copy is not the only copy:
//   * pixel SOURCES handed to texImage2D (ImageBitmap, <img>, <canvas>,
//     ImageData) that are still reachable -- three keeps `texture.image`
//     after upload, so a decoded texture can cost its size twice;
//   * decoded AUDIO buffers still reachable (`decodeAudioData`/`createBuffer`);
//   * every context ever created, and whether it is lost, so a context a
//     screen forgot to release shows up as one.
//
// Nothing here holds a strong reference to a context, a canvas, a source or
// an audio buffer from a GLOBAL root: per-context state lives in a WeakMap
// keyed by the context, and the enumeration lists are WeakRefs. An instrument
// that kept the left mission's canvas alive would manufacture the very leak
// the leave check looks for.
//
// The script is a plain string, not a stringified function: tsx/esbuild can
// inject helper calls (`__name`) into a function body, which then do not
// exist in the page. `memory-ledger.test.ts` runs this exact string against a
// fake WebGL prototype in a node `vm`, so the arithmetic is tested as shipped.

/** The page-side readout, as `window.__rlMem.read()` returns it. */
export interface LedgerContext {
  id: number;
  kind: 'webgl2' | 'webgl';
  lost: boolean;
  inDom: boolean;
  canvas: [number, number];
  texture: { bytes: number; count: number };
  buffer: { bytes: number; count: number };
  renderbuffer: { bytes: number; count: number };
  /** Estimated default framebuffer: colour + depth/stencil (+ MSAA) + one
   *  presentation copy. An ESTIMATE, from the canvas size and attributes. */
  drawingBufferEst: number;
  /** The largest live textures, for attribution: `[w, h, depth, bytes, label]`. */
  topTextures: [number, number, number, number, string][];
  /** Every live renderbuffer, same shape; the label is its format and samples. */
  renderbuffers: [number, number, number, number, string][];
}

export interface LedgerReadout {
  contexts: LedgerContext[];
  sources: { bytes: number; count: number; byKind: Record<string, { bytes: number; count: number }> };
  /** Every ImageBitmap decoded and still reachable (not closed), uploaded or
   *  not -- at 4 bytes a pixel, the decoded size. */
  bitmaps: { bytes: number; count: number };
  audio: { bytes: number; count: number };
  unknownFormats: string[];
}

export const GL_LEDGER_INIT_SCRIPT = String.raw`(() => {
  if (typeof window === 'undefined' || window.__rlMem) return;
  var SIZED = {
    0x8058: 4, 0x8C43: 4, 0x8051: 4, 0x8C41: 4, 0x8229: 1, 0x822B: 2, 0x881A: 8, 0x8814: 16,
    0x881B: 8, 0x8815: 16, 0x822D: 2, 0x822E: 4, 0x822F: 4, 0x8230: 8, 0x88F0: 4, 0x81A6: 4,
    0x8CAC: 4, 0x81A5: 2, 0x8CAD: 8, 0x8D48: 1, 0x8C3A: 4, 0x8C3D: 4, 0x8059: 4, 0x8D62: 2,
    0x8056: 2, 0x8057: 2, 0x8232: 1, 0x8231: 1, 0x8234: 2, 0x8233: 2, 0x8236: 4, 0x8235: 4,
    0x8238: 2, 0x8237: 2, 0x823A: 4, 0x8239: 4, 0x823C: 8, 0x823B: 8, 0x8D7C: 4, 0x8D8E: 4,
    0x8D76: 8, 0x8D88: 8, 0x8D70: 16, 0x8D82: 16, 0x8F94: 1, 0x8F95: 2, 0x8F96: 4, 0x8F97: 4
  };
  var CHANNELS = { 0x1908: 4, 0x1907: 4, 0x1906: 1, 0x1909: 1, 0x190A: 2, 0x1903: 1, 0x8227: 2, 0x1902: 1, 0x84F9: 1 };
  var TYPE_BYTES = { 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2 };
  var PACKED = { 0x8363: 2, 0x8033: 2, 0x8034: 2, 0x84FA: 4, 0x8C3B: 4, 0x8C3E: 4, 0x8368: 4, 0x8DAD: 8 };
  var CUBE_FACE_MIN = 0x8515, CUBE_FACE_MAX = 0x851A, TEXTURE_CUBE_MAP = 0x8513, TEXTURE_3D = 0x806F;
  var TEXTURE0 = 0x84C0;
  var unknown = {};
  function bpp(ifmt, format, type) {
    if (SIZED[ifmt] !== undefined) return SIZED[ifmt];
    if (PACKED[type] !== undefined) return PACKED[type];
    var ch = CHANNELS[ifmt] !== undefined ? CHANNELS[ifmt] : CHANNELS[format];
    var tb = TYPE_BYTES[type];
    if (ch === undefined || tb === undefined) {
      unknown['0x' + Number(ifmt).toString(16) + '/0x' + Number(format).toString(16) + '/0x' + Number(type).toString(16)] = 1;
      return 4;
    }
    return ch * tb;
  }
  function srcDims(s) {
    if (!s || typeof s !== 'object') return null;
    var w = s.videoWidth || s.naturalWidth || s.displayWidth || s.width;
    var h = s.videoHeight || s.naturalHeight || s.displayHeight || s.height;
    return typeof w === 'number' && typeof h === 'number' ? [w, h] : null;
  }
  function srcKind(s) {
    var n = s && s.constructor && s.constructor.name;
    return typeof n === 'string' ? n : 'unknown';
  }
  var contexts = [];
  var states = new WeakMap();
  var objs = new WeakMap();
  var seenSources = new WeakSet();
  var sources = [];
  var audio = [];
  var nextId = 1;
  function st(gl) {
    var s = states.get(gl);
    if (s) return s;
    s = {
      id: nextId++,
      kind: (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? 'webgl2' : 'webgl',
      unit: 0, tex: new Map(), buf: new Map(), rb: null,
      liveTex: new Set(), liveBuf: new Set(), liveRb: new Set(),
      texBytes: 0, bufBytes: 0, rbBytes: 0
    };
    states.set(gl, s);
    contexts.push(new WeakRef(gl));
    return s;
  }
  function rec(o) {
    var r = objs.get(o);
    if (!r) { r = { levels: new Map(), total: 0, w: 0, h: 0, d: 1, label: '' }; objs.set(o, r); }
    return r;
  }
  function boundTex(s, target) {
    var t = (target >= CUBE_FACE_MIN && target <= CUBE_FACE_MAX) ? TEXTURE_CUBE_MAP : target;
    var u = s.tex.get(s.unit);
    return u ? u.get(t) || null : null;
  }
  function setLevel(s, tex, key, bytes, w, h, d, label) {
    if (!tex) return;
    var r = rec(tex);
    var old = r.levels.get(key) || 0;
    r.levels.set(key, bytes);
    r.total += bytes - old;
    s.texBytes += bytes - old;
    if (key === 'l0' || key.indexOf(':0') === key.length - 2) { r.w = w; r.h = h; r.d = d; if (label) r.label = label; }
    s.liveTex.add(tex);
  }
  function noteSource(src) {
    if (!src || typeof src !== 'object' || ArrayBuffer.isView(src)) return '';
    var dims = srcDims(src);
    if (!dims) return '';
    var kind = srcKind(src);
    if (!seenSources.has(src)) {
      seenSources.add(src);
      sources.push({ ref: new WeakRef(src), kind: kind });
    }
    var url = typeof src.currentSrc === 'string' && src.currentSrc ? src.currentSrc : (typeof src.src === 'string' ? src.src : '');
    return kind + (url ? ' ' + url.replace(/^.*\/(?=[^/]+$)/, '') : '');
  }
  function wrap(proto, name, after) {
    var orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function () {
      var out = orig.apply(this, arguments);
      try { after.call(this, st(this), arguments, out); } catch (e) { /* the ledger never breaks the game */ }
      return out;
    };
  }
  function install(proto) {
    if (!proto) return;
    wrap(proto, 'activeTexture', function (s, a) { s.unit = a[0] - TEXTURE0; });
    wrap(proto, 'bindTexture', function (s, a) {
      var u = s.tex.get(s.unit);
      if (!u) { u = new Map(); s.tex.set(s.unit, u); }
      u.set(a[0], a[1]);
    });
    wrap(proto, 'texImage2D', function (s, a) {
      var target = a[0], level = a[1], ifmt = a[2], w, h, format, type, src;
      if (a.length >= 9) { w = a[3]; h = a[4]; format = a[6]; type = a[7]; src = a[8]; }
      else { format = a[3]; type = a[4]; src = a[5]; var d = srcDims(src); if (!d) return; w = d[0]; h = d[1]; }
      var label = noteSource(src);
      setLevel(s, boundTex(s, target), target + ':' + level, w * h * bpp(ifmt, format, type), w, h, 1, label);
    });
    // No allocation -- but three uploads most images through texStorage2D +
    // texSubImage2D, so this is where the pixel SOURCE (and its file name, for
    // an <img>) is seen.
    wrap(proto, 'texSubImage2D', function (s, a) {
      var src = a[a.length - 1];
      var label = noteSource(src);
      var tex = boundTex(s, a[0]);
      if (tex && label) { var r = rec(tex); if (!r.label) r.label = label; }
    });
    wrap(proto, 'copyTexImage2D', function (s, a) {
      setLevel(s, boundTex(s, a[0]), a[0] + ':' + a[1], a[5] * a[6] * bpp(a[2], 0, 0x1401), a[5], a[6], 1, 'copy');
    });
    wrap(proto, 'texImage3D', function (s, a) {
      var target = a[0], level = a[1];
      setLevel(s, boundTex(s, target), target + ':' + level, a[3] * a[4] * a[5] * bpp(a[2], a[7], a[8]), a[3], a[4], a[5], '');
    });
    wrap(proto, 'compressedTexImage2D', function (s, a) {
      var data = a[6];
      var bytes = typeof data === 'number' ? data : (data && data.byteLength) || 0;
      setLevel(s, boundTex(s, a[0]), a[0] + ':' + a[1], bytes, a[3], a[4], 1, 'compressed');
    });
    wrap(proto, 'texStorage2D', function (s, a) {
      var target = a[0], levels = a[1], ifmt = a[2], w = a[3], h = a[4], b = 0;
      for (var l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(ifmt, 0, 0);
      if (target === TEXTURE_CUBE_MAP) b *= 6;
      setLevel(s, boundTex(s, target), 'l0', b, w, h, 1, '');
    });
    wrap(proto, 'texStorage3D', function (s, a) {
      var target = a[0], levels = a[1], ifmt = a[2], w = a[3], h = a[4], d = a[5], b = 0;
      for (var l = 0; l < levels; l++) {
        var dl = target === TEXTURE_3D ? Math.max(1, d >> l) : d;
        b += Math.max(1, w >> l) * Math.max(1, h >> l) * dl * bpp(ifmt, 0, 0);
      }
      setLevel(s, boundTex(s, target), 'l0', b, w, h, d, '');
    });
    wrap(proto, 'generateMipmap', function (s, a) {
      var tex = boundTex(s, a[0]);
      if (!tex) return;
      var r = rec(tex);
      if (r.levels.has('l0')) return;
      var base = 0;
      r.levels.forEach(function (v, k) { if (/:0$/.test(k)) base += v; });
      setLevel(s, tex, 'mips', Math.round(base / 3), r.w, r.h, r.d, '');
    });
    wrap(proto, 'deleteTexture', function (s, a) {
      var tex = a[0];
      if (!tex || !s.liveTex.has(tex)) return;
      s.texBytes -= rec(tex).total;
      s.liveTex.delete(tex);
      objs.delete(tex);
    });
    wrap(proto, 'bindBuffer', function (s, a) { s.buf.set(a[0], a[1]); });
    wrap(proto, 'bufferData', function (s, a) {
      var buf = s.buf.get(a[0]);
      if (!buf) return;
      var src = a[1], bytes;
      if (typeof src === 'number') bytes = src;
      else if (src && ArrayBuffer.isView(src) && a.length >= 4) {
        var bpe = src.BYTES_PER_ELEMENT || 1;
        bytes = a.length >= 5 && a[4] ? a[4] * bpe : src.byteLength - (a[3] || 0) * bpe;
      } else bytes = (src && src.byteLength) || 0;
      var r = rec(buf);
      s.bufBytes += bytes - r.total;
      r.total = bytes;
      s.liveBuf.add(buf);
    });
    wrap(proto, 'deleteBuffer', function (s, a) {
      var buf = a[0];
      if (!buf || !s.liveBuf.has(buf)) return;
      s.bufBytes -= rec(buf).total;
      s.liveBuf.delete(buf);
      objs.delete(buf);
    });
    wrap(proto, 'bindRenderbuffer', function (s, a) { s.rb = a[1]; });
    function rbStore(s, samples, ifmt, w, h) {
      if (!s.rb) return;
      var bytes = w * h * bpp(ifmt, 0, 0) * Math.max(1, samples);
      var r = rec(s.rb);
      s.rbBytes += bytes - r.total;
      r.total = bytes;
      r.w = w; r.h = h; r.label = 'fmt 0x' + Number(ifmt).toString(16) + ' x' + Math.max(1, samples);
      s.liveRb.add(s.rb);
    }
    wrap(proto, 'renderbufferStorage', function (s, a) { rbStore(s, 1, a[1], a[2], a[3]); });
    wrap(proto, 'renderbufferStorageMultisample', function (s, a) { rbStore(s, a[1], a[2], a[3], a[4]); });
    wrap(proto, 'deleteRenderbuffer', function (s, a) {
      var rb = a[0];
      if (!rb || !s.liveRb.has(rb)) return;
      s.rbBytes -= rec(rb).total;
      s.liveRb.delete(rb);
      objs.delete(rb);
    });
  }
  if (typeof WebGL2RenderingContext !== 'undefined') install(WebGL2RenderingContext.prototype);
  if (typeof WebGLRenderingContext !== 'undefined') install(WebGLRenderingContext.prototype);
  function noteAudio(buf) {
    if (buf && typeof buf.length === 'number') audio.push({ ref: new WeakRef(buf), bytes: buf.length * buf.numberOfChannels * 4 });
    return buf;
  }
  var AC = typeof BaseAudioContext !== 'undefined' ? BaseAudioContext : (typeof AudioContext !== 'undefined' ? AudioContext : null);
  if (AC) {
    var dec = AC.prototype.decodeAudioData;
    if (typeof dec === 'function') {
      AC.prototype.decodeAudioData = function () {
        var p = dec.apply(this, arguments);
        if (p && typeof p.then === 'function') p.then(noteAudio, function () {});
        return p;
      };
    }
    var cb = AC.prototype.createBuffer;
    if (typeof cb === 'function') AC.prototype.createBuffer = function () { return noteAudio(cb.apply(this, arguments)); };
  }
  // Every ImageBitmap the page decodes, uploaded or not: GLTFLoader decodes
  // every texture in a GLB into one, including those of a template that is
  // never drawn (a wreck, a buildable not yet bought), which the GL hooks
  // above never see.
  var bitmaps = [];
  if (typeof createImageBitmap === 'function') {
    var cib = createImageBitmap;
    window.createImageBitmap = function () {
      var p = cib.apply(this, arguments);
      if (p && typeof p.then === 'function') p.then(function (b) { if (b) bitmaps.push(new WeakRef(b)); }, function () {});
      return p;
    };
  }
  function drawingBuffer(gl) {
    var w = gl.drawingBufferWidth || 0, h = gl.drawingBufferHeight || 0;
    var at = gl.getContextAttributes ? gl.getContextAttributes() : null;
    if (!at) return 0;
    var samples = at.antialias ? 4 : 1;
    var per = 4 * samples + (at.depth || at.stencil ? 4 * samples : 0) + (at.antialias ? 4 : 0) + 4;
    return w * h * per;
  }
  window.__rlMem = {
    read: function () {
      var out = [];
      for (var i = 0; i < contexts.length; i++) {
        var gl = contexts[i].deref();
        if (!gl) continue;
        var s = states.get(gl);
        if (!s) continue;
        var lost = gl.isContextLost();
        var canvas = gl.canvas;
        var top = [];
        if (!lost) s.liveTex.forEach(function (t) { var r = objs.get(t); if (r) top.push([r.w, r.h, r.d, r.total, r.label]); });
        top.sort(function (x, y) { return y[3] - x[3]; });
        var rbs = [];
        if (!lost) s.liveRb.forEach(function (b) { var r = objs.get(b); if (r) rbs.push([r.w, r.h, 1, r.total, r.label]); });
        out.push({
          id: s.id, kind: s.kind, lost: lost,
          inDom: !!(canvas && canvas.isConnected),
          canvas: canvas ? [canvas.width, canvas.height] : [0, 0],
          texture: { bytes: lost ? 0 : s.texBytes, count: lost ? 0 : s.liveTex.size },
          buffer: { bytes: lost ? 0 : s.bufBytes, count: lost ? 0 : s.liveBuf.size },
          renderbuffer: { bytes: lost ? 0 : s.rbBytes, count: lost ? 0 : s.liveRb.size },
          drawingBufferEst: lost ? 0 : drawingBuffer(gl),
          topTextures: top.slice(0, 40),
          renderbuffers: rbs
        });
      }
      var src = { bytes: 0, count: 0, byKind: {} };
      for (var j = 0; j < sources.length; j++) {
        var o = sources[j].ref.deref();
        if (!o) continue;
        var d = srcDims(o);
        if (!d || d[0] === 0) continue;
        var b = d[0] * d[1] * 4, k = sources[j].kind;
        src.bytes += b; src.count++;
        var bk = src.byKind[k] || (src.byKind[k] = { bytes: 0, count: 0 });
        bk.bytes += b; bk.count++;
      }
      var au = { bytes: 0, count: 0 };
      for (var m = 0; m < audio.length; m++) if (audio[m].ref.deref()) { au.bytes += audio[m].bytes; au.count++; }
      var bm = { bytes: 0, count: 0 };
      for (var q = 0; q < bitmaps.length; q++) {
        var bb = bitmaps[q].deref();
        if (bb && bb.width > 0) { bm.bytes += bb.width * bb.height * 4; bm.count++; }
      }
      return { contexts: out, sources: src, bitmaps: bm, audio: au, unknownFormats: Object.keys(unknown) };
    }
  };
})();`;

/** Live GPU bytes over every context that is not lost: textures, buffers,
 *  renderbuffers and the estimated default framebuffer. */
export function liveGpuBytes(r: LedgerReadout): number {
  let n = 0;
  for (const c of r.contexts) {
    if (c.lost) continue;
    n += c.texture.bytes + c.buffer.bytes + c.renderbuffer.bytes + c.drawingBufferEst;
  }
  return n;
}

/** Contexts still alive (not lost). A screen that leaves without releasing
 *  its renderer shows up here, whether or not its canvas is still in the DOM. */
export function liveContexts(r: LedgerReadout): number {
  return r.contexts.filter((c) => !c.lost).length;
}
