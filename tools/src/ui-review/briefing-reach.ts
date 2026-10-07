// The briefing's reachability, measured on a real layout (GH-417 B-01..B-03).
//
// jsdom has no layout, so `theme.test.ts` can only pin the three CSS
// declarations. This is the half that asks the page: opened, is the screen at
// its top with the mission's name on screen, is Deploy wholly inside the
// viewport, and is every line of the orders in the page rather than hidden in a
// nested scroll box? Reference-free: it compares the page with itself and the
// viewport, never with a picture.
//
// Falsified on a real browser before it was wired into `pnpm ui:routes`
// (one headless Chromium, ANGLE/Metal, music off, read 2.5 s after mount):
// against origin/main 62a7f3d3's CSS, wadi_halam_5_depot with a 125-entry
// roster reads nameTop -106 / -164 / -136 px, Deploy bottom 992 / 1228 / 1557
// against viewports of 900 / 1080 / 1440, and 575 / 572 / 644 px of orders
// hidden, at 1400x900 / 1920x1080 / 2560x1440 -- red at every size; and
// `ui:routes`' own beit_sahwan_1_recon at 1400x900 reads opened scrolled by
// 110 px, nameTop -196 px and 95 px hidden -- so the CI leg is not vacuous.
// Against this branch all four read green (nameTop 24-34 px, Deploy inside
// the viewport, nothing hidden).

/** What `BRIEFING_REACH_SCRIPT` reads off the page. */
export interface BriefingReach {
  /** `.rl-loading`'s own scroll offset on open. */
  scrollTop: number;
  /** The mission name's top edge, viewport px. */
  nameTop: number;
  deployTop: number;
  deployBottom: number;
  viewportHeight: number;
  /** Pixels of the orders block hidden inside its own scroll box. */
  ordersHiddenPx: number;
}

/** A self-contained expression for `page.evaluate`: no closures, no helpers,
 *  so tsx's `keepNames` rewrite can never reach it (garage-seed.ts's note). */
export const BRIEFING_REACH_SCRIPT = `(() => {
  const wrap = document.querySelector('.rl-loading');
  const name = document.querySelector('.rl-loading__name');
  const deploy = document.querySelector('.rl-loading__deploy');
  const brief = document.querySelector('.rl-loading__brief');
  if (!wrap || !name || !deploy) return null;
  const n = name.getBoundingClientRect();
  const d = deploy.getBoundingClientRect();
  return {
    scrollTop: wrap.scrollTop,
    nameTop: n.top,
    deployTop: d.top,
    deployBottom: d.bottom,
    viewportHeight: window.innerHeight,
    ordersHiddenPx: brief ? Math.max(0, brief.scrollHeight - brief.clientHeight) : 0,
  };
})()`;

/** Every way the measured screen fails, as one line each; empty means it passes. */
export function briefingReachProblems(m: BriefingReach): string[] {
  const out: string[] = [];
  if (m.scrollTop > 0) out.push(`opened scrolled by ${Math.round(m.scrollTop)} px`);
  if (m.nameTop < 0) out.push(`mission name starts ${Math.round(-m.nameTop)} px above the top edge`);
  if (m.deployTop < 0 || m.deployBottom > m.viewportHeight) {
    out.push(`Deploy is not wholly on screen (top ${Math.round(m.deployTop)}, bottom ${Math.round(m.deployBottom)}, viewport ${m.viewportHeight})`);
  }
  // One pixel of slack: scrollHeight and clientHeight round independently.
  if (m.ordersHiddenPx > 1) out.push(`${Math.round(m.ordersHiddenPx)} px of the orders hidden in a nested scroll box`);
  return out;
}
