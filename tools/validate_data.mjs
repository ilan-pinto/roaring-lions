#!/usr/bin/env node
// Roaring Lions — content gate: JSON Schema check on all data-driven content.
//
//     pnpm validate:data
//
// Validates:
//   data/units/**    against data/schemas/unit.schema.json
//   data/missions/** against data/schemas/mission.schema.json
//   data/vfx/**      against data/schemas/vfx_emitter.schema.json
//   data/maps/**     against data/schemas/map.schema.json, plus grid
//                    dimensions and marker/zone bounds
//   tools/fixtures/units/** against the unit schema (synthetic, but must parse)
//   data/palette.json structural sanity (32 locked colours)
//   every vfx palette_ref resolves to a real palette key — raw hex is how
//   one contributor quietly breaks the contrast rule for the whole game.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';

const Ajv2020 = AjvModule.default ?? AjvModule;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ajv = new Ajv2020({ allErrors: true, strict: false });

const failures = [];

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    failures.push(`${rel(path)}: unparseable JSON — ${err.message}`);
    return null;
  }
}

function rel(p) {
  return relative(ROOT, p);
}

function jsonFilesIn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(join(entry.parentPath, entry.name));
    }
  }
  return out.sort();
}

function validateDir(dir, validate, schemaName) {
  const files = jsonFilesIn(dir);
  for (const file of files) {
    const doc = loadJson(file);
    if (doc === null) continue;
    if (!validate(doc)) {
      for (const err of validate.errors ?? []) {
        failures.push(`${rel(file)}: ${err.instancePath || '/'} ${err.message} [${schemaName}]`);
      }
    }
  }
  return files.length;
}

// --- schema validation ------------------------------------------------------
const schemas = {
  unit: loadJson(join(ROOT, 'data/schemas/unit.schema.json')),
  mission: loadJson(join(ROOT, 'data/schemas/mission.schema.json')),
  vfx: loadJson(join(ROOT, 'data/schemas/vfx_emitter.schema.json')),
  map: loadJson(join(ROOT, 'data/schemas/map.schema.json')),
};

let checked = 0;
if (schemas.unit && schemas.mission && schemas.vfx && schemas.map) {
  const validators = {
    unit: ajv.compile(schemas.unit),
    mission: ajv.compile(schemas.mission),
    vfx: ajv.compile(schemas.vfx),
    map: ajv.compile(schemas.map),
  };
  checked += validateDir(join(ROOT, 'data/units'), validators.unit, 'unit.schema');
  checked += validateDir(join(ROOT, 'data/missions'), validators.mission, 'mission.schema');
  checked += validateDir(join(ROOT, 'data/vfx'), validators.vfx, 'vfx_emitter.schema');
  checked += validateDir(join(ROOT, 'data/maps'), validators.map, 'map.schema');
  checked += validateDir(join(ROOT, 'tools/fixtures/units'), validators.unit, 'unit.schema');
} else {
  failures.push('schema files missing or unparseable — cannot validate content');
}

// --- mission cross-checks ----------------------------------------------------
// A mission's map.file must be a real map, and its markers/zones/units must
// resolve — a typo here is a broken mission a contributor ships blind.
{
  const mapsById = new Map();
  for (const file of jsonFilesIn(join(ROOT, 'data/maps'))) {
    const m = loadJson(file);
    if (m?.id) mapsById.set(m.id, m);
  }
  const unitIds = new Set();
  for (const file of jsonFilesIn(join(ROOT, 'data/units'))) {
    const u = loadJson(file);
    if (u?.id) unitIds.add(u.id);
  }
  for (const file of jsonFilesIn(join(ROOT, 'data/missions'))) {
    const mi = loadJson(file);
    if (!mi) continue;
    const map = mapsById.get(mi.map?.file);
    if (!map) {
      failures.push(`${rel(file)}: map.file "${mi.map?.file}" is not a map in data/maps`);
      continue;
    }
    const markerNames = new Set(Object.keys(map.markers ?? {}));
    const zoneNames = new Set(Object.keys(map.zones ?? {}));
    const wantMarker = (name, where) => {
      if (name && !markerNames.has(name)) failures.push(`${rel(file)}: ${where} references unknown marker "${name}"`);
    };
    const wantUnit = (name, where) => {
      if (name && !unitIds.has(name)) failures.push(`${rel(file)}: ${where} references unknown unit "${name}"`);
    };
    for (const p of mi.starting_force ?? []) wantUnit(p.unit, 'starting_force');
    for (const p of mi.enemy?.garrison ?? []) {
      wantUnit(p.unit, 'garrison');
      wantMarker(p.marker, 'garrison');
      // A garrison stance must point at an actual building on this map.
      if (p.stance?.kind === 'garrison') {
        const b = p.stance.building;
        const sym = b && map.rows?.[Math.floor(b[1])]?.[Math.floor(b[0])];
        if (!sym || !'#hawsm'.includes(sym)) {
          failures.push(
            `${rel(file)}: ${p.unit} garrison stance points at (${b?.join(',')}) which is not a building`
          );
        }
      }
    }
    for (const w of mi.enemy?.waves ?? []) {
      wantMarker(w.to, 'wave');
      for (const u of w.units ?? []) {
        wantUnit(u.unit, 'wave');
        wantMarker(u.from, 'wave');
      }
    }
    for (const t of mi.triggers ?? []) {
      wantMarker(t.do?.to, 'trigger');
      if (t.on?.zone && !zoneNames.has(t.on.zone)) {
        failures.push(`${rel(file)}: trigger references unknown zone "${t.on.zone}"`);
      }
      for (const u of t.do?.units ?? []) wantUnit(u.unit, 'trigger spawn');
    }
    for (const o of mi.objectives ?? []) {
      if ((o.type === 'capture' || o.type === 'hold_for') && o.target && !zoneNames.has(o.target)) {
        failures.push(`${rel(file)}: objective "${o.id}" references unknown zone "${o.target}"`);
      }
    }
    for (const p of mi.civilians?.groups ?? []) {
      wantUnit(p.unit, 'civilians');
      wantMarker(p.marker, 'civilians');
    }
    wantMarker(mi.civilians?.refuge, 'civilians.refuge');
    for (const z of mi.roe?.flagged_zones ?? []) {
      if (!zoneNames.has(z)) failures.push(`${rel(file)}: roe.flagged_zones references unknown zone "${z}"`);
    }
  }
}

// --- map grid + bounds checks (beyond what JSON Schema can express) ---------
for (const file of jsonFilesIn(join(ROOT, 'data/maps'))) {
  const m = loadJson(file);
  if (!m) continue;
  if (Array.isArray(m.rows)) {
    if (m.rows.length !== m.height) {
      failures.push(`${rel(file)}: ${m.rows.length} rows but declared height ${m.height}`);
    }
    m.rows.forEach((row, y) => {
      if (typeof row === 'string' && row.length !== m.width) {
        failures.push(`${rel(file)}: row ${y} has ${row.length} tiles but declared width ${m.width}`);
      }
    });
  }
  for (const [name, pt] of Object.entries(m.markers ?? {})) {
    if (pt[0] >= m.width || pt[1] >= m.height) {
      failures.push(`${rel(file)}: marker "${name}" (${pt[0]},${pt[1]}) out of bounds`);
    }
  }
  for (const [name, z] of Object.entries(m.zones ?? {})) {
    if (z[0] + z[2] > m.width || z[1] + z[3] > m.height || z[2] <= 0 || z[3] <= 0) {
      failures.push(`${rel(file)}: zone "${name}" [${z.join(',')}] out of bounds`);
    }
  }
}

// --- palette sanity ---------------------------------------------------------
const palettePath = join(ROOT, 'data/palette.json');
const palette = loadJson(palettePath);
const paletteKeys = new Set();
if (palette) {
  let count = 0;
  for (const [ramp, spec] of Object.entries(palette.ramps ?? {})) {
    (spec.colors ?? []).forEach((_, i) => paletteKeys.add(`${ramp}.${i}`));
    count += (spec.colors ?? []).length;
  }
  for (const [band, spec] of Object.entries(palette.reserved ?? {})) {
    Object.keys(spec.colors ?? {}).forEach((name) => paletteKeys.add(`${band}.${name}`));
    count += Object.keys(spec.colors ?? {}).length;
  }
  if (count !== palette.total_colors) {
    failures.push(
      `${rel(palettePath)}: declares total_colors=${palette.total_colors} but defines ${count}`
    );
  }
  checked += 1;
}

// --- vfx palette_ref cross-check -------------------------------------------
function collectPaletteRefs(node, path, out) {
  if (typeof node === 'string') {
    if (/^[a-z_]+\.[a-z0-9_]+$/.test(node)) out.push({ ref: node, path });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectPaletteRefs(v, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'color' || k === 'color_over_life') collectPaletteRefs(v, `${path}.${k}`, out);
      else if (typeof v === 'object') collectPaletteRefs(v, `${path}.${k}`, out);
    }
  }
}

if (palette) {
  for (const file of jsonFilesIn(join(ROOT, 'data/vfx'))) {
    const doc = loadJson(file);
    if (!doc) continue;
    const refs = [];
    collectPaletteRefs(doc, '', refs);
    for (const { ref, path } of refs) {
      if (!paletteKeys.has(ref)) {
        failures.push(`${rel(file)}: ${path} references unknown palette key "${ref}"`);
      }
    }
  }
}

// --- verdict ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\nDATA GATE FAILED — ${failures.length} issue(s):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`data gate passed: ${checked} file(s) validated, palette keys resolved`);
