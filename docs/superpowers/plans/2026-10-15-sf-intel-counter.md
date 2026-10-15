# S-F: the intel counter answers an earn (GH-77 remainder) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When intel is earned, the strip's intel figure pulses once, so an earn with no feed line of its
own (an objective's +30, F-Q7) still registers where the player reads intel.

**Architecture:** GH-77's size half shipped and was closed on 4 Oct (the strip's logistics and intel
figures are bold, glyphed, worded and set at `--t-strip`, 17 px, against the old 11 px; verified again
below). What F1 left open is F-Q7's "the strip's counter pulses". The HUD strip is rebuilt as markup at
4 Hz whenever any readout changes (logistics changes every ~0.6 s at +100/min), so a plain CSS animation
on the figure would restart on every rebuild. The pulse is therefore a one-shot CSS animation whose
`animation-delay` is the negative of the time since the earn was first seen: a rebuild resumes it at the
right offset instead of restarting it. Reduced motion gets a static `--info` emphasis for the same window.

**Tech Stack:** TypeScript, vitest + jsdom, `packages/app/src/ui/theme.css` tokens.

**Spec:** `docs/superpowers/plans/2026-10-04-gf1-fire-support-intel.md` F-Q7 ("An objective's +25 gets no
line of its own: the objective alert already says it, and the strip's counter pulses"); stage4 order,
Lane A row "F1": "the intel counter (GH-77)"; issue #77 (closed 2026-10-04 with the size fix).

## Global Constraints

- App only: `packages/app/src/ui/{hud.ts,hud-model.ts,theme.css}`, `packages/app/src/main.ts`, tests. Never
  `packages/sim`, never `data/missions`.
- Colour only through tokens (`--info`); `pnpm validate:ui` must pass. No new chrome string.
- No world mark (standing ruling): the pulse is on the HUD strip only.
- Reduced motion (`prefers-reduced-motion` and `:root[data-motion='reduce']`): no movement; the figure
  holds `color: var(--info)` for the pulse window instead.
- Every new check is seen red by a one-line mutation of the implementation.

## Review Focus

1. **The strip rebuilds mid-pulse** (logistics ticking). Expect the pulse to continue, not restart: the
   rebuilt markup carries a more negative `animation-delay`. Task 1 pins it.
2. **Two earns inside one window.** Expect the pulse to restart from 0 on the second earn. Task 1 pins it.
3. **A mission with no earns, and a sandbox (no intel figure).** Expect no pulse class anywhere. Task 1
   pins the first; the second is structural (no intel span).
4. **Pause.** The window runs on the frame clock (`performance.now()`), so a paused game lets the pulse
   finish; nothing waits on the sim. Accepted: it is presentation.

---

### Task 1: The intel figure pulses once per earn

**Files:**
- Modify: `packages/app/src/ui/hud-model.ts` (~L59 `intelLastEarn` gains `tick: number`),
  `packages/app/src/main.ts` (~L2691: pass the `LastEarn` through, tick included),
  `packages/app/src/ui/hud.ts` (~L1620-1632, the intel span), `packages/app/src/ui/theme.css` (beside
  `.rl-pulse` ~L4565 and both reduced-motion blocks ~L4596-4626), `packages/app/src/ui/hud.test.ts`.

**Interfaces:**
- Consumes: `IntelMoments.lastEarn(tick): LastEarn | null` (`ui/intel-moments.ts`; `LastEarn` already
  carries `tick`), shown for `LAST_EARN_SHOW_TICKS`.
- Produces:

```ts
// hud.ts
/** How long the intel figure pulses after an earn, ms on the frame clock. */
export const EARN_PULSE_MS = 900;
// Hud private state: the earn identity last seen and when it was first seen.
private earnSeen: { tick: number; atMs: number } | null = null;
```

Behaviour: in the strip render, when `m.intelLastEarn` is set and its `tick` differs from
`earnSeen?.tick`, record `{ tick, atMs: performance.now() }`. While `now - atMs < EARN_PULSE_MS`, the
intel `<b>` is written as
`<b class="rl-earn-pulse" style="animation-delay:-${Math.round(now - atMs)}ms">${m.intel}</b>`;
otherwise plain `<b>`. An absent `intelLastEarn` clears nothing (the window simply runs out).

```css
/* GH-77 / F-Q7: an earn registers on the figure itself, once. The negative
   delay written by hud.ts resumes it across the strip's 4 Hz rebuilds. */
@keyframes rl-earn-pulse {
  0% { color: var(--info); scale: 1; }
  30% { color: var(--info); scale: 1.3; }
  100% { scale: 1; }
}
.rl-earn-pulse {
  display: inline-block;
  animation: rl-earn-pulse 900ms var(--ease) both;
}
/* reduced motion (both blocks): no movement, the colour holds for the window */
.rl-earn-pulse { animation: none; color: var(--info); }
```

(The reduced-motion line goes inside the existing `@media (prefers-reduced-motion: reduce)` block and as
`:root[data-motion='reduce'] .rl-earn-pulse { … }`, the same two places `.rl-pulse` is exempted. Keep the
900 in CSS equal to `EARN_PULSE_MS`; a test reads `theme.css` as text and pins it.)

- [ ] **Step 1: Write the failing tests** (`hud.test.ts`, with the existing strip harness; stub
  `performance.now` via `vi.spyOn(performance, 'now')`):
  - "an earn pulses the intel figure once": render with `intelLastEarn: { amount: 30, cause: 'objective',
    tick: 100 }` at now 1000 → the intel span's `<b>` has class `rl-earn-pulse` and
    `animation-delay:-0ms` (or `0ms`); re-render (change `logistics` so the markup rebuilds) at now 1300 →
    still the class, delay `-300ms` (Review Focus 1); at now 1000 + `EARN_PULSE_MS` → no class.
  - "a second earn restarts it": tick 100 at now 1000, then tick 140 at now 1500 → delay `-0ms` again.
  - "no earn, no pulse": `intelLastEarn` absent → no `rl-earn-pulse` in the strip.
  - "the CSS window matches EARN_PULSE_MS, and reduced motion holds still": read `theme.css` as text;
    the `.rl-earn-pulse` animation duration equals `EARN_PULSE_MS`, and both the
    `@media (prefers-reduced-motion: reduce)` block and a `:root[data-motion='reduce'] .rl-earn-pulse`
    rule set `animation: none`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/app/src/ui/hud.test.ts` from the worktree root —
  FAIL.
- [ ] **Step 3: Implement** as above; `main.ts` passes `{ amount, cause, tick }`.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:ui && pnpm build` —
  PASS.
- [ ] **Step 5: See it red:** drop the `earnSeen` tick comparison (restart on every render) — the
  rebuild test fails; change the CSS to 800ms — the CSS pin fails. Put both back.
- [ ] **Step 6: Commit** `app: the intel figure pulses once per earn (GH-77, F-Q7, S-F)`.

## Controller close-out (not a subagent task)

1. Verify the size half on the running game: the intel `<b>`'s computed `font-size` is `--t-strip`
   (17 px at the default UI scale) and its `font-weight` bold.
2. Golden: list which scenarios draw the intel figure (only resources missions; the gated scenarios are
   all `sandbox=`, whose strip has no intel span); `combat` is the one report-only frame that can show it.
3. UI proof on a free port, music off, one browser: an objective or identification earn pulses the
   figure; `data-motion='reduce'` holds it still in `--info`.
4. Ready PR stacked on #628 (base `feat/sf-fire-support`), not merged; merge `main` once #628 lands.
