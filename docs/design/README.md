# Design artifacts

Source-of-truth wireframes and specs for UI work, exported from Claude Design.
Self-contained HTML — open in a browser, no server and no dependencies.

| file | what it is |
|---|---|
| `hud-spec.html` | The HUD target: 4 states × 2 resolutions (1440×900, 1920×1080). What GH-153 builds. |
| `hud-wireframes.html` | The explorations behind it, including the multi-select and dock states. |
| `RTS Game Screen Wireframes.zip` | The original export the two files above came from. |

These are **design intent, not a contract with the code**. Where a spec and CLAUDE.md
disagree about a constraint — the palette gate, invariant 4, the render-order bands — the
constraint wins and the spec is the thing that needs revising. A wireframe cannot authorise
a raw hex literal in UI source: `pnpm validate:ui` rejects one anywhere, with no allowlist,
so every colour a spec names has to arrive as a semantic token from `data/palette.json`.
