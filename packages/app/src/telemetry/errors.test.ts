import { describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGE_PATTERN, ERROR_NAME_PATTERN, STACK_HASH_PATTERN } from '@lions/data/telemetry';
import { MESSAGE_MAX, describeError, fnv1a, installErrorHandlers, scrubMessage, stackShape } from './errors';

describe('scrubMessage: nothing personal survives', () => {
  it.each([
    ['a URL', 'Failed to fetch https://roaring-lions.pint12.workers.dev/api/account/me?x=1', 'Failed to fetch <url>'],
    ['an email', 'Bad input from dana.cohen@example.com today', 'Bad input from <email> today'],
    ['a POSIX path with a user name', 'ENOENT /Users/dana/Projects/lions/a.json', 'ENOENT <path>'],
    ['a Windows path', 'Cannot open C:\\Users\\Dana\\lions\\a.json now', 'Cannot open <path> now'],
    ['a long number (an id, a phone)', 'player 0541234567 failed', 'player <n> failed'],
    ['a long token', 'bad token AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'bad token <id>'],
    ['a player uuid', 'no player 0f8fad5b-d9cb-469f-a165-70867728950e here', 'no player <id> here'],
  ])('%s', (_what, raw, want) => {
    expect(scrubMessage(raw)).toBe(want);
  });

  it('keeps the first line only, collapses whitespace and replaces non-ASCII', () => {
    expect(scrubMessage('first  line\nsecond line with /etc/passwd/x')).toBe('first line');
    expect(scrubMessage('caf\u00e9 \u0000 ok')).toBe('caf? ? ok');
  });

  it('truncates to 120 characters and the result always satisfies the wire pattern', () => {
    const long = scrubMessage('word '.repeat(100));
    expect(long.length).toBe(MESSAGE_MAX);
    for (const raw of ['', 'x'.repeat(500), '\u{1F600}'.repeat(10), 'a\r\nb', 'tab\there']) {
      expect(ERROR_MESSAGE_PATTERN.test(scrubMessage(raw)), JSON.stringify(raw)).toBe(true);
    }
  });
});

describe('fnv1a and stackShape', () => {
  it('fnv1a is 8 lower-case hex digits and stable', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('TypeError:fn')).toMatch(STACK_HASH_PATTERN);
  });

  it('reads function names from a V8 stack and drops every file, line and column', () => {
    const stack = ['TypeError: x', '    at stepMovement (https://host/assets/main-AbC123.js:10:20)', '    at async loop (https://host/assets/main-AbC123.js:30:4)', '    at https://host/anon.js:1:1'].join('\n');
    expect(stackShape(stack)).toBe('stepMovement|loop');
  });

  it('reads function names from a Firefox or Safari stack', () => {
    expect(stackShape('stepMovement@https://host/a.js:10:20\nloop@https://host/a.js:30:4\n@https://host/anon.js:1:1')).toBe('stepMovement|loop');
  });

  it('a frame whose "name" is really a URL or a path is skipped, never hashed', () => {
    expect(stackShape('https://host/main-AbC.js:3:4@https://host/x.js:1:1\nC:\\Users\\Dana\\a.js:1:1@x\nreal@https://host/a.js:2:2')).toBe('real');
  });

  it('takes at most 8 frames, and an empty or missing stack gives the empty shape', () => {
    const many = Array.from({ length: 20 }, (_, i) => `    at f${i} (a.js:1:1)`).join('\n');
    expect(stackShape(many).split('|')).toHaveLength(8);
    expect(stackShape(undefined)).toBe('');
    expect(stackShape('')).toBe('');
  });
});

describe('describeError', () => {
  it('describes an Error by name, scrubbed message and a hash of the stack shape', () => {
    const e = new TypeError('Cannot read /Users/dana/x/y');
    e.stack = 'TypeError: Cannot read\n    at stepMovement (https://host/a.js:10:20)';
    const d = describeError(e);
    expect(d.name).toBe('TypeError');
    expect(d.message).toBe('Cannot read <path>');
    expect(d.hash).toBe(fnv1a('TypeError:stepMovement'));
    expect(ERROR_NAME_PATTERN.test(d.name) && STACK_HASH_PATTERN.test(d.hash)).toBe(true);
  });

  it('the same crash in a different build or position hashes the same; a different function does not', () => {
    const a = new Error('m');
    a.stack = 'Error: m\n    at stepMovement (https://host/main-111.js:10:20)';
    const b = new Error('m');
    b.stack = 'Error: m\n    at stepMovement (https://host/main-222.js:99:1)';
    const c = new Error('m');
    c.stack = 'Error: m\n    at stepCombat (https://host/main-111.js:10:20)';
    expect(describeError(a).hash).toBe(describeError(b).hash);
    expect(describeError(a).hash).not.toBe(describeError(c).hash);
  });

  it('a stack with no usable frames falls back to the name and the scrubbed message', () => {
    const e = new Error('Script error.');
    e.stack = '';
    expect(describeError(e).hash).toBe(fnv1a('Error:Script error.'));
  });

  it('a name that is not a plain identifier is replaced, and a non-Error value is described by its type', () => {
    const odd = new Error('m');
    odd.name = 'Evil Name <script>';
    expect(describeError(odd).name).toBe('Error');
    expect(describeError('rejected with a string')).toMatchObject({ name: 'NonError', message: 'rejected with a string' });
    expect(describeError(42)).toMatchObject({ name: 'NonError', message: '' });
    expect(describeError(null)).toMatchObject({ name: 'NonError' });
  });

  it('no personal string a message or stack held is in the output', () => {
    const e = new Error('open /Users/dana/secret.txt for dana@example.com at https://x.test/u/dana');
    e.stack = 'Error\n    at fn (/Users/dana/secret.txt:1:1)';
    const out = JSON.stringify(describeError(e));
    for (const needle of ['dana', 'secret', 'example.com', 'x.test', '/Users']) expect(out, needle).not.toContain(needle);
  });
});

describe('installErrorHandlers', () => {
  function target() {
    const handlers: Record<string, (ev: unknown) => void> = {};
    return {
      handlers,
      addEventListener: vi.fn((t: string, f: (ev: unknown) => void) => {
        handlers[t] = f;
      }),
      removeEventListener: vi.fn((t: string) => {
        delete handlers[t];
      }),
    };
  }

  it('reports an uncaught error and an unhandled rejection, described, and observes only', () => {
    const t = target();
    const seen: unknown[] = [];
    installErrorHandlers(t as never, (e) => seen.push(e));
    const preventDefault = vi.fn();
    t.handlers.error?.({ error: new RangeError('r'), message: 'r', preventDefault });
    t.handlers.unhandledrejection?.({ reason: new Error('boom'), preventDefault });
    t.handlers.error?.({ message: 'Script error.', preventDefault });
    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatchObject({ name: 'RangeError', message: 'r' });
    expect(seen[1]).toMatchObject({ name: 'Error', message: 'boom' });
    expect(seen[2]).toMatchObject({ name: 'NonError', message: 'Script error.' });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('the returned function takes both listeners off', () => {
    const t = target();
    const off = installErrorHandlers(t as never, () => undefined);
    expect(Object.keys(t.handlers).sort()).toEqual(['error', 'unhandledrejection']);
    off();
    expect(Object.keys(t.handlers)).toEqual([]);
  });

  it('a reporter that throws does not escape into the page', () => {
    const t = target();
    installErrorHandlers(t as never, () => {
      throw new Error('reporter bug');
    });
    expect(() => t.handlers.error?.({ error: new Error('x'), message: 'x' })).not.toThrow();
    expect(() => t.handlers.unhandledrejection?.({ reason: 'x' })).not.toThrow();
  });
});
