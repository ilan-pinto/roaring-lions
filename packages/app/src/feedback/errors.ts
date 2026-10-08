/**
 * The last few errors this session logged (GH-464, spec §4.1): the single most
 * useful fact a bug report can carry. Installed once at boot, on `window`'s
 * `error` and `unhandledrejection`; kept in memory only, never sent on its
 * own, and read only when a note is.
 */
import { ERROR_CHARS, ERROR_LINES } from './context';

const ring: string[] = [];

/** One line: the message and the first stack frame, nothing more. */
export function errorLine(reason: unknown): string {
  let msg: string;
  let frame = '';
  if (reason instanceof Error) {
    msg = `${reason.name}: ${reason.message}`;
    const lines = (reason.stack ?? '').split('\n').map((l) => l.trim());
    frame = lines.find((l) => l.startsWith('at ') || l.includes('@')) ?? '';
  } else {
    msg = typeof reason === 'string' ? reason : String(reason);
  }
  const line = frame === '' ? msg : `${msg} ${frame}`;
  return line.replace(/\s+/g, ' ').slice(0, ERROR_CHARS);
}

export function pushError(reason: unknown): void {
  ring.push(errorLine(reason));
  if (ring.length > ERROR_LINES) ring.splice(0, ring.length - ERROR_LINES);
}

export function recentErrors(): string[] {
  return [...ring];
}

/** Tests only. */
export function clearErrorsForTest(): void {
  ring.length = 0;
}

/** Listen for the rest of the page's life (it is installed once, from `main()`). */
export function installErrorRing(win: Pick<Window, 'addEventListener'>): void {
  win.addEventListener('error', (e) => pushError((e as ErrorEvent).error ?? (e as ErrorEvent).message));
  win.addEventListener('unhandledrejection', (e) => pushError((e as PromiseRejectionEvent).reason));
}
