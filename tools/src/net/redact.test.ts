// GH-954 W2: the private token is redacted from everything the arena prints or writes. Pure strings; no key is read.
import { describe, expect, it } from 'vitest';
import { createRedactor, describeCommand, describeEnv, redactText, REDACTED } from './redact';

const SECRET = 'tok-0123456789abcdef';

describe('redactText', () => {
  it('replaces every occurrence of every secret, the longest first, and leaves text without one alone', () => {
    expect(redactText(`a ${SECRET} b ${SECRET}`, [SECRET])).toBe(`a ${REDACTED} b ${REDACTED}`);
    expect(redactText('nothing here', [SECRET])).toBe('nothing here');
    // A secret that contains another goes whole, not as a half-redacted remainder.
    expect(redactText('xx-abcdef-yy', ['abcdef', 'x-abcdef-y'])).toBe(`x${REDACTED}y`);
    // The empty string is no secret: it would match between every character.
    expect(redactText('abc', [''])).toBe('abc');
    expect(redactText('abc', [])).toBe('abc');
  });
});

describe('createRedactor (a stream)', () => {
  const run = (chunks: string[], secrets: string[] = [SECRET]): string => {
    const r = createRedactor(secrets);
    return chunks.map((c) => r.push(c)).join('') + r.flush();
  };
  it('redacts a secret split at EVERY position across two chunks, and one split across three', () => {
    const text = `before ${SECRET} after`;
    for (let i = 1; i < text.length; i++) {
      const out = run([text.slice(0, i), text.slice(i)]);
      expect(out, `split at ${i}`).toBe(`before ${REDACTED} after`);
    }
    expect(run([`x ${SECRET.slice(0, 4)}`, SECRET.slice(4, 9), `${SECRET.slice(9)} y`])).toBe(`x ${REDACTED} y`);
    // One character at a time: nothing leaks, nothing is lost.
    expect(run([...`a ${SECRET} b`])).toBe(`a ${REDACTED} b`);
  });
  it('holds back only a tail that could still become a secret: ordinary text passes at once, and flush releases the rest', () => {
    const r = createRedactor([SECRET]);
    expect(r.push('hello world, this is a long line\n')).toBe('hello world, this is a long line\n');
    // A tail that is a prefix of the secret waits; the next chunk decides.
    expect(r.push(`ok ${SECRET.slice(0, 5)}`)).toBe('ok ');
    expect(r.push('zzz')).toBe(`${SECRET.slice(0, 5)}zzz`);
    expect(r.push(SECRET.slice(0, 3))).toBe('');
    expect(r.flush()).toBe(SECRET.slice(0, 3));
    expect(r.flush()).toBe('');
  });
  it('is the identity with no secret', () => {
    const r = createRedactor([]);
    expect(r.push('abc')).toBe('abc');
    expect(r.flush()).toBe('');
  });
});

describe('what a spawn prints', () => {
  it('names an injected variable and never shows its value; the argv is redacted too', () => {
    expect(describeEnv({ ANTHROPIC_API_KEY: SECRET, B: 'x' })).toBe(`ANTHROPIC_API_KEY=${REDACTED} B=${REDACTED}`);
    const printed = describeCommand(['node', 'run.mjs', `--key=${SECRET}`], { ANTHROPIC_API_KEY: SECRET }, [SECRET]);
    expect(printed).not.toContain(SECRET);
    expect(printed).toBe(`node run.mjs --key=${REDACTED} [env ANTHROPIC_API_KEY=${REDACTED}]`);
    expect(describeCommand(['node', 'a'], {}, [])).toBe('node a');
  });
});
