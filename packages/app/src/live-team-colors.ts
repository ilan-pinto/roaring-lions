/**
 * VR-01 (lead, 8 Oct): the colour-vision setting reaches the WORLD and the
 * minimap mid-mission, in the same instant it reaches the HUD.
 *
 * The HUD already followed live -- `applySettings` writes `data-cvd` on the
 * root and `theme.css` re-points `--friendly`/`--bad`/`--warn`/`--bad-text`
 * -- while the renderer and the minimap kept the colours `rendererOptionsFor`
 * resolved at boot until the next mission, so a `--warn` feed line and a
 * neutral ring could be two different yellows on one screen.
 *
 * This is the one subscription that closes the split. It resolves a variant
 * through exactly the two `@lions/data` functions `rendererOptionsFor` uses
 * (`paletteTeamColors`, `variantAwareResolver`), so a switched mission and a
 * mission booted in that variant draw the same colours, and hands the SAME
 * `teamColors` array to both sinks, so a minimap dot and the ring on the field
 * cannot disagree.
 *
 * Returns the unsubscribe, which the battlefield registers with `onDispose`
 * (CLAUDE.md, "the disposer contract"): a listener left on the shell's
 * settings bus after the mission ends would hold the dead renderer and keep
 * re-colouring it on every later settings change.
 */
import { paletteTeamColors, variantAwareResolver } from '@lions/data';
import type { Renderer } from '@lions/render';
import type { ColorVision, Settings } from './settings';
import type { Disposer } from './shell/router';

export interface LiveTeamColorSinks {
  readonly renderer: Pick<Renderer, 'setTeamColors'>;
  readonly minimap: { setTeamColors(teamColors: readonly [string, string, string]): void };
}

export function bindLiveTeamColors(
  onChange: (fn: (s: Settings) => void) => Disposer,
  bootVariant: ColorVision,
  sinks: LiveTeamColorSinks
): Disposer {
  let current = bootVariant;
  return onChange((next) => {
    const variant = next.accessibility.colorVision;
    // Every settings change notifies (volume, keys, text size...): only a
    // colour-vision change re-colours anything.
    if (variant === current) return;
    current = variant;
    const teamColors = paletteTeamColors(variant);
    sinks.renderer.setTeamColors(teamColors, variantAwareResolver(variant));
    sinks.minimap.setTeamColors(teamColors);
  });
}
