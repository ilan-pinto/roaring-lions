// The precondition gate for retiring the sprite sheets (WP-A3.3, GH-189,
// plan `docs/superpowers/plans/2026-10-04-retire-pixi.md`, Tasks 5-8).
//
// Once the billboard path is gone, a unit type with no GLB, or a GLB with no
// death/wreck clip, has nothing to fall back to. This spec says, from the
// FILES ON DISK alone, that every unit and every structure has the mesh it
// will need -- it imports nothing from the code under test (not
// `mesh-catalogue.ts`, not `main.ts`), so a table that drifts with the code
// cannot vouch for itself here. The oracle is the directory layout plus the
// data files, and the expected clip names are literals.
//
// Layout it relies on, which `mesh-catalogue.ts` also follows:
//   art/meshes/<unit id>.glb            a rigged team
//   art/meshes/vehicles/<unit id>.glb   a rigid vehicle (wreck by wreck:meshes)
//   art/meshes/civilians/*.glb          the one type drawn as four variants
//   art/meshes/buildings/<type>.glb + <type>_wreck.glb
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const MESHES = path.join(REPO, 'art', 'meshes');

/** The four civilian variants, as literals: `civilians` is the one type with
 *  no `<id>.glb` of its own. */
const CIVILIAN_VARIANTS = ['civilian_child', 'civilian_woman', 'farm_worker', 'office_worker'];

function walkJson(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJson(p));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function unitIds(): string[] {
  return walkJson(path.join(REPO, 'data', 'units'))
    .map((f) => (JSON.parse(readFileSync(f, 'utf8')) as { id: string }).id)
    .sort();
}

function structureTypes(): string[] {
  const s = JSON.parse(readFileSync(path.join(REPO, 'data', 'structures.json'), 'utf8')) as {
    types: Record<string, unknown>;
  };
  return Object.keys(s.types).sort();
}

/** The glTF JSON chunk of a binary GLB: 12-byte header, then chunk 0 (JSON). */
function glbJson(file: string): { animations?: { name?: string }[] } {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB (bad magic)`);
  const len = buf.readUInt32LE(12);
  const type = buf.readUInt32LE(16);
  if (type !== 0x4e4f534a) throw new Error(`${file}: first chunk is not JSON`);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

function clipNames(file: string): string[] {
  return (glbJson(file).animations ?? []).map((a) => a.name ?? '');
}

const rel = (p: string): string => path.relative(REPO, p);

/** Where a unit type's mesh lives, or null. */
function unitMeshFiles(id: string): { kind: 'rigged' | 'vehicle' | 'civilian'; files: string[] } | null {
  if (id === 'civilians') {
    return { kind: 'civilian', files: CIVILIAN_VARIANTS.map((v) => path.join(MESHES, 'civilians', `${v}.glb`)) };
  }
  const rigged = path.join(MESHES, `${id}.glb`);
  if (existsSync(rigged)) return { kind: 'rigged', files: [rigged] };
  const vehicle = path.join(MESHES, 'vehicles', `${id}.glb`);
  if (existsSync(vehicle)) return { kind: 'vehicle', files: [vehicle] };
  return null;
}

describe('mesh roster precondition (every unit and structure has its mesh on disk)', () => {
  const ids = unitIds();
  const structures = structureTypes();

  it('reads a real roster (vacuity guard)', () => {
    expect(ids.length).toBeGreaterThan(30);
    expect(structures.length).toBeGreaterThan(5);
  });

  it('every data/units id has a GLB', () => {
    const missing = ids.filter((id) => unitMeshFiles(id) === null);
    expect(missing, `unit types with no art/meshes/<id>.glb or vehicles/<id>.glb`).toEqual([]);
    const missingFiles = ids
      .flatMap((id) => unitMeshFiles(id)?.files ?? [])
      .filter((f) => !existsSync(f))
      .map(rel);
    expect(missingFiles, 'variant GLBs missing on disk').toEqual([]);
  });

  it('every vehicle GLB carries idle and wreck', () => {
    const dir = path.join(MESHES, 'vehicles');
    const files = readdirSync(dir).filter((f) => f.endsWith('.glb'));
    expect(files.length).toBeGreaterThan(10);
    const bad = files
      .map((f) => path.join(dir, f))
      .filter((f) => {
        const clips = clipNames(f);
        return !clips.includes('idle') || !clips.includes('wreck');
      })
      .map((f) => `${rel(f)} [${clipNames(f).join(', ')}]`);
    expect(bad, 'vehicle GLBs missing idle/wreck').toEqual([]);
  });

  it('every unit vehicle GLB is one of those (no unit type escapes the vehicle check)', () => {
    const vehicleIds = ids.filter((id) => unitMeshFiles(id)?.kind === 'vehicle');
    expect(vehicleIds.length).toBeGreaterThan(10);
  });

  it('every rigged team GLB carries down or wreck', () => {
    const files = ids
      .map((id) => unitMeshFiles(id))
      .filter((m): m is NonNullable<typeof m> => m !== null && m.kind !== 'vehicle')
      .flatMap((m) => m.files)
      .filter((f) => existsSync(f));
    expect(files.length).toBeGreaterThan(15);
    const bad = files
      .filter((f) => {
        const clips = clipNames(f);
        return !clips.includes('down') && !clips.includes('wreck');
      })
      .map((f) => `${rel(f)} [${clipNames(f).join(', ')}]`);
    expect(bad, 'rigged GLBs with neither down nor wreck').toEqual([]);
  });

  it('every structure type has a building GLB and a _wreck GLB', () => {
    const missing = structures.flatMap((t) =>
      [`${t}.glb`, `${t}_wreck.glb`]
        .map((f) => path.join(MESHES, 'buildings', f))
        .filter((f) => !existsSync(f))
        .map(rel)
    );
    expect(missing, 'structure meshes missing').toEqual([]);
  });
});
