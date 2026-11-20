/**
 * "A real host", split in two (GH-1418; the lead's ruling of 20 Nov 2026).
 *
 * (b) A NETWORKED real host: a production build on a host that is not this machine. Telemetry
 *     (`telemetry/enabled.ts`'s `telemetryEnabled`), accounts (`account/enabled.ts`'s `accountsEnabled`) and feedback
 *     (`feedback/gate.ts`'s `feedbackSends`) send only there, and they stay as they were: the desktop build serves the page
 *     from `app://roaring-lions.local`, and `*.local` reads as this machine, so none of the three is on in it.
 *
 * (a) A PLAYER's host (`playerHost`): (b), or the desktop build. The three player-facing helpers ask this one: the
 *     no-graphics and software-rendering notices (`ui/no-gpu.ts`, and `ui/software-hint.ts` through `ui/quality-hint.ts`'s
 *     gate), the slow-frames Low suggestion (`ui/quality-hint.ts`) and What's new opening by itself (`ui/whats-new.ts`).
 *     They were off on desktop only because they shared (b); a desktop player is as real a player as a web one. `pnpm dev`,
 *     every test, CI, every harness and `vite preview` still fail it (all SwiftShader; a card over their frames would
 *     swallow their keys), and each helper keeps its own dev opt-in (`?gpunotice`, `?qualityhint`, `?whatsnew`).
 *
 * The desktop page is recognised by its ORIGIN, not by a build flag: the custom scheme `app:` and the host
 * `roaring-lions.local` (`tools/desktop/policy.mjs`'s `SCHEME` and `HOST`; `tools/src/desktop_policy.test.ts` pins these
 * two against them). No web page can have the `app:` scheme, so the web build is unchanged.
 */
import { feedbackSends } from '../feedback/gate';

/** The desktop build's page origin, as `location` reads it. */
export const DESKTOP_PROTOCOL = 'app:';
export const DESKTOP_HOSTNAME = 'roaring-lions.local';

export interface HostEnv {
  prod: boolean;
  hostname: string;
  /** `location.protocol` (with its colon). Absent: not the desktop build. */
  protocol?: string;
}

/** The packaged desktop build: a production bundle served from its own scheme and host. */
export function isDesktopPage(env: HostEnv): boolean {
  return env.prod && env.protocol === DESKTOP_PROTOCOL && env.hostname === DESKTOP_HOSTNAME;
}

/** (b): a production build on a networked real host. The telemetry, accounts and feedback rule; off on desktop. */
export function networkedRealHost(env: HostEnv): boolean {
  return feedbackSends(env);
}

/** (a): a host a player plays on, the deployed site or the desktop build. The three helpers' gate. */
export function playerHost(env: HostEnv): boolean {
  return networkedRealHost(env) || isDesktopPage(env);
}
