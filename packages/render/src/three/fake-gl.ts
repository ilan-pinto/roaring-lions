/**
 * A WebGL2 context that draws nothing and answers everything, so three's REAL `WebGLRenderer` can run
 * under plain node and its REAL render lists decide what is submitted.
 *
 * Why this exists: the draw-call cost of an instanced batch is a property of three's own list
 * building (`projectObject` -> `renderBufferDirect`, once per visible object per pass), not of any
 * GPU. `docs/PERFORMANCE.md` measured the decal pools by wrapping `renderBufferDirect` in a browser; a
 * browser was not available to chunk B, and the question does not need a rasteriser, only the
 * renderer's own bookkeeping. This answers every GL call with a plausible value (a link that
 * succeeded, a framebuffer that is complete, limits that are generous) and records nothing; the
 * caller counts `renderBufferDirect` itself.
 *
 * It is NOT a rasteriser and proves nothing about pixels. It also cannot say whether a shader
 * COMPILES - a program that fails to link on a real GPU links here - so a shader edit still wants one
 * look in a browser.
 */

/** A stand-in class so `gl instanceof WebGL2RenderingContext` holds for three's capability probe. */
export class FakeWebGL2RenderingContext {}

const LIMITS: Record<string, number> = {
  MAX_TEXTURE_SIZE: 8192,
  MAX_CUBE_MAP_TEXTURE_SIZE: 8192,
  MAX_3D_TEXTURE_SIZE: 2048,
  MAX_ARRAY_TEXTURE_LAYERS: 256,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  MAX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
  MAX_VERTEX_ATTRIBS: 16,
  MAX_VERTEX_UNIFORM_VECTORS: 1024,
  MAX_VERTEX_UNIFORM_COMPONENTS: 4096,
  MAX_VARYING_VECTORS: 30,
  MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
  MAX_FRAGMENT_UNIFORM_COMPONENTS: 4096,
  MAX_SAMPLES: 4,
  MAX_RENDERBUFFER_SIZE: 8192,
  MAX_COLOR_ATTACHMENTS: 8,
  MAX_DRAW_BUFFERS: 8,
  MAX_UNIFORM_BUFFER_BINDINGS: 24,
  MAX_UNIFORM_BLOCK_SIZE: 65536,
  UNIFORM_BUFFER_OFFSET_ALIGNMENT: 256,
  MAX_VERTEX_UNIFORM_BLOCKS: 12,
  MAX_FRAGMENT_UNIFORM_BLOCKS: 12,
  MAX_COMBINED_UNIFORM_BLOCKS: 24,
  MAX_VIEWPORT_DIMS: 8192,
  SAMPLES: 4,
  SUBPIXEL_BITS: 8,
  ALIASED_LINE_WIDTH_RANGE: 1,
};

/** The few constants whose VALUE matters to three's own comparisons (`getError() !== gl.NO_ERROR`). */
const LITERAL: Record<string, number> = { NO_ERROR: 0, NONE: 0, ZERO: 0, ONE: 1, FALSE: 0, TRUE: 1 };

const CONSTANT = /^[A-Z][A-Z0-9_]*$/;

export interface FakeGl {
  readonly gl: WebGL2RenderingContext;
  /** Every distinct GL entry point called, for diagnosing a probe that returned the wrong shape. */
  readonly calls: Map<string, number>;
}

export function makeFakeGl(width = 1400, height = 900): FakeGl {
  const names = new Map<string, number>(); // constant name -> unique value
  const values = new Map<number, string>(); // and back
  let next = 0x10000;
  const constant = (name: string): number => {
    const known = names.get(name);
    if (known !== undefined) return known;
    const v = LITERAL[name] ?? next++;
    names.set(name, v);
    if (!values.has(v)) values.set(v, name);
    return v;
  };
  const calls = new Map<string, number>();
  const target = new FakeWebGL2RenderingContext() as unknown as Record<string, unknown>;
  const canvas = {
    width,
    height,
    style: {},
    addEventListener(): void {},
    removeEventListener(): void {},
    getContext: (): null => null,
    clientWidth: width,
    clientHeight: height,
  };

  const call = (prop: string, args: unknown[]): unknown => {
    calls.set(prop, (calls.get(prop) ?? 0) + 1);
    switch (prop) {
      case 'getParameter': {
        const name = values.get(args[0] as number) ?? '';
        if (name === 'VERSION') return 'WebGL 2.0 (fake)';
        if (name === 'SHADING_LANGUAGE_VERSION') return 'WebGL GLSL ES 3.00 (fake)';
        if (name === 'VENDOR' || name === 'RENDERER') return 'fake';
        if (name === 'VIEWPORT' || name === 'SCISSOR_BOX') return new Int32Array([0, 0, width, height]);
        if (name === 'COLOR_CLEAR_VALUE') return new Float32Array([0, 0, 0, 0]);
        if (name === 'COLOR_WRITEMASK') return [true, true, true, true];
        if (name === 'ALIASED_LINE_WIDTH_RANGE') return new Float32Array([1, 1]);
        if (name === 'MAX_VIEWPORT_DIMS') return new Int32Array([8192, 8192]);
        if (name in LIMITS) return LIMITS[name];
        return 0;
      }
      case 'getShaderPrecisionFormat':
        return { precision: 23, rangeMin: 127, rangeMax: 127 };
      case 'getContextAttributes':
        return { alpha: true, antialias: false, depth: true, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false };
      case 'getExtension':
      case 'getSupportedExtensions':
        return prop === 'getExtension' ? null : [];
      case 'getProgramParameter':
      case 'getShaderParameter': {
        const name = values.get(args[1] as number) ?? '';
        if (name === 'ACTIVE_UNIFORMS' || name === 'ACTIVE_ATTRIBUTES' || name === 'ACTIVE_UNIFORM_BLOCKS') return 0;
        return true; // LINK_STATUS / COMPILE_STATUS / DELETE_STATUS ...
      }
      case 'getProgramInfoLog':
      case 'getShaderInfoLog':
      case 'getShaderSource':
        return '';
      case 'checkFramebufferStatus':
        return constant('FRAMEBUFFER_COMPLETE');
      case 'getError':
        return 0;
      case 'isContextLost':
        return false;
      case 'getUniformLocation':
      case 'getAttribLocation':
        return 0;
      case 'getUniformBlockIndex':
        return 0;
      case 'fenceSync':
      case 'clientWaitSync':
        return constant('ALREADY_SIGNALED');
      default:
        if (prop.startsWith('create')) return {};
        return undefined;
    }
  };

  const gl = new Proxy(target, {
    get(t, prop): unknown {
      if (prop === 'canvas' || prop === 'drawingBufferWidth' || prop === 'drawingBufferHeight') {
        return prop === 'canvas' ? canvas : prop === 'drawingBufferWidth' ? width : height;
      }
      if (typeof prop === 'symbol' || prop in t) return Reflect.get(t, prop);
      if (CONSTANT.test(prop)) return constant(prop);
      return (...args: unknown[]): unknown => call(prop, args);
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

/** What `new THREE.WebGLRenderer({ canvas, context })` needs beside the context. */
export function fakeCanvas(width = 1400, height = 900): HTMLCanvasElement {
  return {
    width,
    height,
    style: {},
    addEventListener(): void {},
    removeEventListener(): void {},
    getContext: () => null,
    clientWidth: width,
    clientHeight: height,
  } as unknown as HTMLCanvasElement;
}
