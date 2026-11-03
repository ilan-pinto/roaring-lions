/**
 * Test fixtures for the match-scoring specs (GH-973): a valid `ScoreSet`, and
 * helpers that break ONE field of a deep copy without a type escape hatch.
 * Not a spec; only specs import it.
 */
import { CRITERION_IDS, type PlayerScore, type ScoreSet } from './match-score';

/** A valid player score: every criterion `n`, a one-line reason each that cites a number. */
export function playerScore(n: number, tag = ''): PlayerScore {
  const criteria = {} as PlayerScore['criteria'];
  for (const id of CRITERION_IDS) criteria[id] = { score: n, reason: `${id}: 3 lost against 5${tag === '' ? '' : ` (${tag})`}` };
  return { criteria, overall: { score: n, reason: `overall: decided by the 5 to 3 trade${tag === '' ? '' : ` (${tag})`}` } };
}

export const validScores = (a = 7, b = 4): ScoreSet => ({ seat0: playerScore(a, 'seat 0'), seat1: playerScore(b, 'seat 1') });

type Loose = { [key: string]: unknown };

/** A deep copy as loose JSON, which a spec may break one field of with `setPath` / `delPath`. */
export function loose(v: unknown): Loose {
  return JSON.parse(JSON.stringify(v)) as Loose;
}

function parent(o: Loose, path: string): { holder: Loose; key: string } {
  const keys = path.split('.');
  let holder: Loose = o;
  for (const k of keys.slice(0, -1)) {
    const next = holder[k];
    if (typeof next !== 'object' || next === null) throw new Error(`no ${k} on the way to ${path}`);
    holder = next as Loose;
  }
  return { holder, key: keys[keys.length - 1] };
}

/** Sets `path` ("seat0.criteria.adaptation.score") to `value`; returns the object. */
export function setPath(o: Loose, path: string, value: unknown): Loose {
  const { holder, key } = parent(o, path);
  holder[key] = value;
  return o;
}

/** Deletes `path`; returns the object. */
export function delPath(o: Loose, path: string): Loose {
  const { holder, key } = parent(o, path);
  delete holder[key];
  return o;
}

/** Reads `path`. */
export function getPath(o: Loose, path: string): unknown {
  const { holder, key } = parent(o, path);
  return holder[key];
}
