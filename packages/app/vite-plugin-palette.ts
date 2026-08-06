// Publishes data/palette.json to CSS as custom properties.
//
// The battlefield is gated on the palette — sprites are quantized to it in CI,
// VFX emitters may only name palette keys. The interface was the one part of
// the product with no such discipline. This plugin closes that: every colour
// the UI can reach is declared here, from the same file the renderer reads, so
// there is no second copy of the palette to drift out of sync.
//
// It writes into <head> rather than emitting a stylesheet because the page
// background is painted before any module runs. A stylesheet would arrive after
// first paint (in dev it is injected by JS), so index.html would still need one
// literal of its own — and one literal is all it takes for the gate in
// tools/validate_ui_palette.mjs to become a rule with an exception.

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

interface Palette {
  ramps: Record<string, { colors: string[] }>;
  reserved: Record<string, { colors: Record<string, string> }>;
}

/** `limestone` + index 2 → `--rl-limestone-2`; `vfx` + `white_hot` → `--rl-vfx-white-hot`. */
function varName(band: string, key: string): string {
  return `--rl-${band}-${key.replace(/_/g, '-')}`;
}

/** Every palette colour as a `--rl-*` declaration, ramps then reserved bands. */
export function paletteDeclarations(palette: Palette): string[] {
  const out: string[] = [];
  for (const [band, ramp] of Object.entries(palette.ramps)) {
    ramp.colors.forEach((hex, i) => out.push(`${varName(band, String(i))}: ${hex};`));
  }
  for (const [band, group] of Object.entries(palette.reserved)) {
    for (const [name, hex] of Object.entries(group.colors)) {
      out.push(`${varName(band, name)}: ${hex};`);
    }
  }
  return out;
}

export function palettePlugin(paletteUrl: URL): Plugin {
  const path = paletteUrl.pathname;
  const read = (): Palette => JSON.parse(readFileSync(paletteUrl, 'utf8')) as Palette;

  return {
    name: 'lions-palette',

    // Editing the palette should repaint the UI the same way it re-renders the
    // battlefield — without a manual restart.
    configureServer(server) {
      server.watcher.add(path);
      server.watcher.on('change', (file) => {
        if (file === path) server.ws.send({ type: 'full-reload' });
      });
    },

    transformIndexHtml() {
      const decls = paletteDeclarations(read());
      return [
        {
          tag: 'style',
          attrs: { 'data-palette': 'data/palette.json' },
          children: `:root{\n  ${decls.join('\n  ')}\n}`,
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
