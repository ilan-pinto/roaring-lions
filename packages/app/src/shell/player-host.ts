/**
 * "A real host", split in two (GH-1418; the lead's ruling of 20 Nov 2026).
 *
 * (b) The NETWORKED rule: telemetry (`telemetry/enabled.ts`'s `telemetryEnabled`), accounts (`account/enabled.ts`'s
 *     `accountsEnabled`) and feedback (`feedback/gate.ts`'s `feedbackSends`, read by `feedback/session.ts` too) are
 *     UNTOUCHED by this module and keep their own gates. Those gates are not one function: feedback's local-host pattern
 *     also counts `*.localhost` and `*.test` as this machine, telemetry's and accounts' do not, and unifying them would be
 *     a behaviour change outside the ruling. All three read `*.local` as this machine, so all three stay off on desktop
 *     (`app://roaring-lions.local`); `player-host.test.ts` and `tools/src/desktop_policy.test.ts` prove it.
 *
 * (a) A PLAYER's host (`playerHost`): a production build on a real host (`feedbackSends`'s rule), or the desktop build.
 *     Exactly four call sites read it, the three player-facing helpers: the no-graphics notice (`ui/no-gpu.ts`'s
 *     `noGpuNoticeAllowed`), the software-rendering line and the slow-frames Low suggestion (`ui/quality-hint.ts`'s
 *     `qualityHintAllowed`, and its inline twin in `main.ts`, which decides before loading that lazy chunk), and What's new
 *     opening by itself (`ui/whats-new.ts`'s `whatsNewAutoOpenAllowed`). They were off on desktop only because they shared
 *     the networked rule; a desktop player is as real a player as a web one. `pnpm dev`, every test, CI, every harness
 *     and `vite preview` still fail it (all SwiftShader; a card over their frames would swallow their keys), and each
 *     helper keeps its own dev opt-in (`?gpunotice`, `?qualityhint`, `?whatsnew`).
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

/** (a): a host a player plays on, the deployed site or the desktop build. The three helpers' gate (four call sites). */
export function playerHost(env: HostEnv): boolean {
  return feedbackSends(env) || isDesktopPage(env);
}
