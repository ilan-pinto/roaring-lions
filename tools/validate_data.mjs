#!/usr/bin/env node
// Roaring Lions — content gate: JSON Schema check on all data-driven content.
//
//     pnpm validate:data
//
// Validates:
//   data/units/**    against data/schemas/unit.schema.json
//   data/missions/** against data/schemas/mission.schema.json
//   data/vfx/**      against data/schemas/vfx_emitter.schema.json
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
};

let checked = 0;
if (schemas.unit && schemas.mission && schemas.vfx) {
  const validators = {
    unit: ajv.compile(schemas.unit),
    mission: ajv.compile(schemas.mission),
    vfx: ajv.compile(schemas.vfx),
  };
  checked += validateDir(join(ROOT, 'data/units'), validators.unit, 'unit.schema');
  checked += validateDir(join(ROOT, 'data/missions'), validators.mission, 'mission.schema');
  checked += validateDir(join(ROOT, 'data/vfx'), validators.vfx, 'vfx_emitter.schema');
  checked += validateDir(join(ROOT, 'tools/fixtures/units'), validators.unit, 'unit.schema');
} else {
  failures.push('schema files missing or unparseable — cannot validate content');
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
