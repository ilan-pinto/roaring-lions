# Battle audio clips

Drop recorded clips here, in a folder per set: `small_arms/`, `tank_gun/`,
`destroyed/`, and so on. Then declare each file in `data/audio.json` with its
license and source URL — `pnpm validate:audio` fails the build otherwise, and
an undeclared file on disk is also an error.

Rules, for the same reason the art pipeline has them:

- **License must permit redistribution in a public repo.** CC0 is the safe bar.
  CC-BY is allowed but the manifest entry then needs a `credit` line. Most
  commercial SFX libraries permit *use* but not redistribution of the source
  file — committing those is the trap.
- **Ship two formats** where you can: `.ogg` for everything, `.m4a` (or `.mp3`)
  for Safari. The loader skips what it cannot decode.
- **Mono, short, under 512 KB.** These are battlefield one-shots, not music.
- **3–4 variants per set** so repeated fire does not sound like a loop.

Nothing here is required. Every set with no clips falls back to the procedural
synth in `packages/render/src/audio.ts`, so the game always has sound.
