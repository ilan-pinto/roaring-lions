// Types for resolve.mjs, so tools/src/desktop_serve.test.ts typechecks.
export type Resolved = { status: 404; reason: 'host' | 'encoding' | 'api' | 'escape' | 'missing' } | { status: 200; file: string };
export declare function resolveRequest(
  requestUrl: string,
  opts: { host: string; webRoot: string; isFile: (file: string) => boolean },
): Resolved;
