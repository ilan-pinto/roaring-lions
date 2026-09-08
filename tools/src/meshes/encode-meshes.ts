/**
 * Encode the meshes that ship: `art/meshes/**.glb` -> `assets/meshes/**.glb`,
 * with Draco geometry compression.
 *
 *     pnpm encode:meshes            # write anything whose source changed
 *     pnpm encode:meshes -- --check # write nothing; fail if anything is stale
 *
 * Level load time, step 4 (`docs/superpowers/specs/2026-09-07-level-load-time-
 * design.md`). Measured over all 79 shipped meshes: **75.47 MiB -> 25.98 MiB,
 * 34%**, and not one file grows. The heaviest are the rigged infantry, whose
 * bytes are almost entirely vertex data -- `meshy_mortar_team` 5.51 -> 0.81
 * MiB. A textured vehicle compresses less because what is left is its JPEG
 * bake, which Draco does not touch: `technical` 2.90 -> 1.34.
 *
 * ## The shape, and why it is this one
 *
 * The same split the ground tiles use (`tools/textures/encode_ground_tiles.py`,
 * step 2): **`art/meshes/` is the source of record and `assets/meshes/` is
 * what ships**, reproducible from it by this script. That matters more here
 * than it does for a texture, because Draco quantisation is LOSSY -- 14 bits
 * per position by default -- and three things in this repository read mesh
 * geometry as though it were exact:
 *
 *  - `pnpm validate:meshes` renders every GLB through Blender and runs the
 *    palette/silhouette/fill gates on the result.
 *  - `tools/building_facing.py` rasterises each building from four cardinal
 *    directions and counts `glass`-role pixels.
 *  - the mesh contract itself (`extras.rl_role`, `rl_part`, the `turret_pivot`
 *    / `rotor_pivot` empties).
 *
 * All three keep reading `art/meshes/`, so the gates judge the geometry the
 * artist exported rather than a quantised copy of it. The extras and the node
 * graph are in the glTF JSON chunk, which Draco does not touch at all -- only
 * accessor payloads are compressed -- so the shipped file carries the same
 * contract; it is the vertex POSITIONS that are approximated.
 *
 * ## Determinism
 *
 * Same input, same bytes out: asserted by `encode-meshes.test.ts`, which
 * encodes a fixture twice and compares. That is the same standard the vehicle
 * exporters were held to when their boundary-loop tracing turned out to be
 * iterating a Python set (`tools/vehicles/export_meshy_apache.py`).
 *
 * ## Staleness
 *
 * A shipped mesh whose source has changed, or a source with no shipped file at
 * all, is a mesh that silently draws the wrong thing or 404s. `--check` is the
 * CI half: it walks both directories and exits 1 on any mismatch, keyed on a
 * hash of the SOURCE recorded in `assets/meshes/manifest.json`. That is the
 * `SPRITE_MAP` failure mode this repository already has a scar from, closed
 * by a gate rather than by remembering.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = path.join(REPO, 'art', 'meshes');
const OUT = path.join(REPO, 'assets', 'meshes');
const MANIFEST = path.join(OUT, 'manifest.json');

/** Every `.glb` under `art/meshes/`, as paths relative to it, sorted -- so the
 *  manifest and the log are stable whatever order the filesystem hands back. */
function sources(dir = SRC, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...sources(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.glb')) out.push(rel);
  }
  return out;
}

const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

interface Manifest {
  /** Relative path -> sha256 of the SOURCE it was encoded from. */
  readonly sources: Record<string, string>;
}

function readManifest(): Manifest {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  } catch {
    return { sources: {} };
  }
}

async function main(): Promise<number> {
  const check = process.argv.includes('--check');
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  const rels = sources();
  if (rels.length === 0) {
    console.error(`no GLBs under ${SRC}`);
    return 1;
  }
  const manifest = readManifest();
  const next: Record<string, string> = {};
  const stale: string[] = [];
  let wrote = 0;
  let srcBytes = 0;
  let outBytes = 0;

  for (const rel of rels) {
    const srcPath = path.join(SRC, rel);
    const outPath = path.join(OUT, rel);
    const srcBuf = readFileSync(srcPath);
    const hash = sha(srcBuf);
    next[rel] = hash;
    srcBytes += srcBuf.length;

    const current = manifest.sources[rel] === hash && existsSync(outPath);
    if (current) {
      outBytes += statSync(outPath).size;
      continue;
    }
    stale.push(rel);
    if (check) continue;

    const document = await io.read(srcPath);
    // `KHR_draco_mesh_compression` on every primitive. `EDGEBREAKER` is the
    // default and the smaller of the two encodings; the quantisation numbers
    // are gltf-transform's own defaults, which is what the 34% above was
    // measured with.
    document.createExtension(KHRDracoMeshCompression).setRequired(true);
    await document.transform(draco());
    mkdirSync(path.dirname(outPath), { recursive: true });
    await io.write(outPath, document);
    outBytes += statSync(outPath).size;
    wrote++;
    const before = srcBuf.length;
    const after = statSync(outPath).size;
    console.log(
      `${rel.padEnd(38)} ${(before / 1048576).toFixed(2).padStart(6)} -> ${(after / 1048576)
        .toFixed(2)
        .padStart(6)} MiB  (${Math.round((100 * after) / before)}%)`
    );
  }

  // A shipped mesh whose source is gone would 404 nothing and waste bytes, but
  // it would also make `assets/meshes/` stop being a mirror -- and the whole
  // point of the manifest is that the two directories agree.
  const orphans: string[] = [];
  if (existsSync(OUT)) {
    for (const rel of sources(OUT)) {
      if (!existsSync(path.join(SRC, rel))) orphans.push(rel);
    }
  }
  if (orphans.length && !check) {
    for (const rel of orphans) rmSync(path.join(OUT, rel));
    console.log(`removed ${orphans.length} shipped mesh(es) whose source is gone: ${orphans.join(', ')}`);
  }

  if (check) {
    if (stale.length === 0 && orphans.length === 0) {
      console.log(`mesh encode gate passed: ${rels.length} mesh(es), assets/meshes is current`);
      return 0;
    }
    if (stale.length) {
      console.error(`assets/meshes is STALE for ${stale.length} mesh(es): ${stale.join(', ')}`);
    }
    if (orphans.length) {
      console.error(`assets/meshes has ${orphans.length} orphan(s) with no source: ${orphans.join(', ')}`);
    }
    console.error('run `pnpm encode:meshes` and commit the result');
    return 1;
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify({ sources: next }, null, 2)}\n`);
  console.log(
    `\n${rels.length} mesh(es), ${wrote} re-encoded: ` +
      `${(srcBytes / 1048576).toFixed(2)} MiB source -> ${(outBytes / 1048576).toFixed(2)} MiB shipped ` +
      `(${Math.round((100 * outBytes) / srcBytes)}%)`
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
