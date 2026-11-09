/**
 * GH-943 WebGPU P2 (T3): a text check over a generated shader (GLSL or WGSL) for the one sampling pattern WebGPU refuses: an
 * IMPLICIT-gradient texture sample (GLSL `texture`, WGSL `textureSample`, ...) inside non-uniform control flow. WGSL rejects that at
 * pipeline creation; GLSL leaves the gradient undefined. The node twins write their samples branch-free, or with explicit gradients
 * (`textureGrad` / `textureSampleGrad`, `textureLod` / `textureSampleLevel`); this is the vitest-side guard (`mesh.node.test.ts`),
 * the GPU-side one is the content vote's GPU validation error on the CI wgpu arm.
 *
 * CONSERVATIVE by design: every `if`, `else`, `for`, `while`, `switch`, `loop` and `continuing` body counts as conditional, whether
 * or not its condition is uniform (three's own per-texture flip is a uniform `if` around a uv assignment, never around a sample, so
 * the shipped graphs pass). A braceless body counts up to its `;`. Comments are stripped first.
 *
 * Test support only: nothing in the shipped renderer imports it. Presentation only.
 */

/** Implicit-gradient sample calls (GLSL ES 3.0, legacy GLSL, WGSL). */
const IMPLICIT = new Set([
  'texture',
  'texture2D',
  'textureCube',
  'textureProj',
  'textureOffset',
  'textureProjOffset',
  'texture2DProj',
  'textureSample',
  'textureSampleBias',
  'textureSampleCompare',
]);
const CONDITIONAL = new Set(['if', 'for', 'while', 'switch']);
const BLOCK_ONLY = new Set(['loop', 'continuing']);

export interface ImplicitSampleInConditional {
  /** The call, as written (`texture`, `textureSample`, ...). */
  readonly call: string;
  /** 1-based line of the call in the comment-stripped source. */
  readonly line: number;
}

function stripComments(src: string): string {
  // Keep newlines so line numbers survive.
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

/** Every implicit-gradient sample inside a conditional body, in source order. */
export function implicitSamplesInConditionals(source: string): ImplicitSampleInConditional[] {
  const src = stripComments(source);
  const tokens: Array<{ t: string; at: number }> = [];
  for (const m of src.matchAll(/[A-Za-z_]\w*|[{}();]/g)) tokens.push({ t: m[0], at: m.index });
  const lineOf = (at: number): number => src.slice(0, at).split('\n').length;
  /** The block stack: `cond` (a conditional body), `plain` (any other brace), `stmt` (a braceless conditional body, until `;`). */
  const stack: Array<{ kind: 'cond' | 'plain' | 'stmt'; paren: number }> = [];
  const found: ImplicitSampleInConditional[] = [];
  let paren = 0;
  /** Set after a conditional head: what the next token opens. */
  let pendingBody = false;
  /** The paren depth at which a conditional head's `(...)` closes. */
  let headParen: number | null = null;
  /** A WGSL head with no parentheses (`if x {`, `while x {`): its body is the next `{`. */
  let awaitBrace = false;
  const inConditional = (): boolean => stack.some((b) => b.kind !== 'plain');
  for (let i = 0; i < tokens.length; i++) {
    const { t, at } = tokens[i] as { t: string; at: number };
    if (pendingBody) {
      pendingBody = false;
      if (t === '{') {
        stack.push({ kind: 'cond', paren });
        continue;
      }
      if (t !== 'if') stack.push({ kind: 'stmt', paren });
    }
    if (CONDITIONAL.has(t)) {
      if (tokens[i + 1]?.t === '(') headParen = paren;
      else awaitBrace = true;
      continue;
    }
    if (t === 'else' || BLOCK_ONLY.has(t)) {
      pendingBody = true;
      continue;
    }
    if (t === '(') {
      paren++;
      continue;
    }
    if (t === ')') {
      paren--;
      if (headParen !== null && paren === headParen) {
        headParen = null;
        pendingBody = true;
      }
      continue;
    }
    if (t === '{') {
      stack.push({ kind: awaitBrace ? 'cond' : 'plain', paren });
      awaitBrace = false;
      continue;
    }
    if (t === '}') {
      stack.pop();
      // A braceless body that ended with a nested block closes with it.
      while (stack.length > 0 && (stack[stack.length - 1] as { kind: string }).kind === 'stmt') stack.pop();
      continue;
    }
    if (t === ';') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1] as { kind: string; paren: number };
        if (top.kind !== 'stmt' || top.paren !== paren) break;
        stack.pop();
      }
      continue;
    }
    if (IMPLICIT.has(t) && tokens[i + 1]?.t === '(' && inConditional()) found.push({ call: t, line: lineOf(at) });
  }
  return found;
}

/** Throws, naming every offending call, when `source` samples with an implicit gradient inside a conditional body. */
export function assertNoImplicitSampleInConditional(source: string): void {
  const found = implicitSamplesInConditionals(source);
  if (found.length > 0) {
    throw new Error(
      `implicit-gradient sample inside a conditional (WGSL rejects it): ${found.map((f) => `${f.call} at line ${f.line}`).join(', ')}`
    );
  }
}
