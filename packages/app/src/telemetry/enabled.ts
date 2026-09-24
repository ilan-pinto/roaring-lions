export interface SwitchEnv {
  prod: boolean;
  hostname: string;
  query: URLSearchParams;
  /** `navigator.globalPrivacyControl === true` */
  gpc: boolean;
  /** `navigator.doNotTrack === '1'` */
  dnt: boolean;
  optedOut: boolean;
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local)$/;

/** The off switch (spec §2). Airtight on purpose: `pnpm ui:routes` fails on any
 *  console error, and a request to a missing /api/events on the Vite dev server
 *  is one. A privacy signal beats even `?telemetry`. */
export function telemetryEnabled(env: SwitchEnv): boolean {
  if (env.optedOut || env.gpc || env.dnt) return false;
  if (env.query.has('telemetry')) return true;
  return env.prod && !LOCAL.test(env.hostname);
}
