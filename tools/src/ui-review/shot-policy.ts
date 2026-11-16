/**
 * What `shoot.ts` does when software rendering cannot keep up (GH-1409). The first CI run of `pnpm ui:shots` died on its very first
 * frame: `page.screenshot: Timeout 30000ms exceeded` on `01-menu` at 1400x900, SwiftShader. The live menu scene host cannot paint a frame
 * inside the default timeout there, and the tool wrote nothing, so the artifact step found no files. Three rules, in a module of their own
 * because `shoot.ts` runs its whole walk at import and cannot be tested:
 *   1. on SwiftShader the menu is shot on the reduced-motion plate path, as `01b-menu-plate` already is, so the live host never has to paint;
 *   2. a screenshot gets a long backstop timeout, not the 30 s page default;
 *   3. a shot that still fails is recorded and the walk goes on, so one stall costs one picture, not the run; the run still exits non-zero.
 */
import type { GpuBackend } from './gpu';

/** Generous on purpose: SwiftShader reads back a complex scene in seconds. A hang is bounded by the step's own `timeout-minutes`. */
export const SHOT_TIMEOUT_MS = 120_000;

/** Whether `01-menu` must be shot on the plate path rather than the live scene host. */
export function menuUsesPlate(gpu: GpuBackend): boolean {
  return gpu === 'swiftshader';
}

export interface FailedShot {
  name: string;
  reason: string;
}

/** The shots that did not come out, in order, and the lines that say so. */
export class ShotLog {
  readonly failed: FailedShot[] = [];

  record(name: string, err: unknown): void {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    this.failed.push({ name, reason: first });
  }

  /** One line per failed shot, then the count; a clean run says so too (a silent log reads the same as a tool that never checked). */
  summary(): string[] {
    if (this.failed.length === 0) return ['screenshots: every shot above was taken'];
    return [...this.failed.map((f) => `  FAILED ${f.name}: ${f.reason}`), `screenshots: ${this.failed.length} shot(s) FAILED and are missing from the output`];
  }
}
