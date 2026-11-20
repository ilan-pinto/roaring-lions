// Type declaration for ui-shots-index.mjs, so tools/src/ci/ui-shots-index.test.ts (strict TypeScript) can import the plain Node module.
// Same arrangement as promotion-pr.d.mts: the module has no build step, a workflow step runs it with `node` alone.
export interface Shot { locale: string; res: string; state: string; rel: string }
export const DEFAULT_THUMB_WIDTH: number;
export const EN: string;
export function collectShots(dir: string): Shot[];
export function thumbnail(buf: Buffer, width?: number): Buffer;
export function esc(s: string): string;
export function summaryMarkdown(shots: readonly Shot[]): string;
export function renderIndex(shots: readonly Shot[], thumbOf: (s: Shot) => string | null): string;
export function buildIndex(dir: string, out: string, width?: number): Shot[];
