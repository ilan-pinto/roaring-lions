// The field-works rules (#277 Task 8) that validate_data.mjs checks and the runtime would
// otherwise swallow. Its own module because validate_data.mjs runs its whole sweep at import
// time and exits, so a test cannot import it. Rules 1-5 of the plan's Task 8, in order.

const isBuildable = (spec) => spec?.buildable !== undefined;
/** A work: a type that raises or carries an effect (buildable, or an aura). */
const isWork = (spec) => spec?.buildable !== undefined || spec?.aura !== undefined;

/** 1: `buildable` requires `owner` 0. An absent owner is -1 (neutral), which is not 0. */
export function buildableOwnerFailures(catalogue, file) {
  const out = [];
  for (const [id, spec] of Object.entries(catalogue?.types ?? {})) {
    if (isBuildable(spec) && spec.owner !== 0) {
      out.push(`${file}: "${id}" is buildable and has owner ${spec.owner ?? -1} -- the player raises only its own side's works (owner 0)`);
    }
  }
  return out;
}

/** 2: every `field_works` key names a type in the catalogue that is `buildable`. */
export function fieldWorksKeyFailures(mission, catalogue, file) {
  const out = [];
  for (const id of Object.keys(mission?.field_works ?? {})) {
    const spec = catalogue?.types?.[id];
    if (spec === undefined) out.push(`${file}: field_works names "${id}", which is not a structure type`);
    else if (!isBuildable(spec)) out.push(`${file}: field_works names "${id}", which is not buildable`);
  }
  return out;
}

/** 3: a mission with `field_works` fields a `construct` carrier in `starting_force`. When it has
 *  `resources` (production could field one later) the absence is a WARNING, not a failure
 *  (R8/L4). Returns `{ failures, warnings }`. */
export function fieldWorksCarrierReport(mission, unitsById, file) {
  const none = { failures: [], warnings: [] };
  if (Object.keys(mission?.field_works ?? {}).length === 0) return none;
  const carrier = (mission.starting_force ?? []).some((p) =>
    (unitsById.get(p.unit)?.abilities ?? []).includes('construct'),
  );
  if (carrier) return none;
  const msg = `${file}: lists field_works and its starting_force has no unit with the "construct" ability -- nobody can raise them`;
  return mission.resources !== undefined
    ? { failures: [], warnings: [`${msg} (production could field one: warning only)`] }
    : { failures: [msg], warnings: [] };
}

/** True when the mission authors a `digs` or `in_tunnel` placement anywhere. */
function authorsTunnels(node) {
  if (Array.isArray(node)) return node.some(authorsTunnels);
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'digs' || k === 'in_tunnel') && typeof v === 'string') return true;
      if (authorsTunnels(v)) return true;
    }
  }
  return false;
}

/** 4: no type with `aura.sensor.tunnel_radius > 0` in a mission that authors a `digs` or
 *  `in_tunnel` placement. Keyed on the field, not the id (the lead's rule). A type is "in" the
 *  mission when it is a `field_works` key or a `structures[]` placement. */
export function tunnelSensorFailures(mission, catalogue, file) {
  if (!authorsTunnels(mission)) return [];
  const named = new Set([
    ...Object.keys(mission?.field_works ?? {}),
    ...(mission?.structures ?? []).map((s) => s.type),
  ]);
  const out = [];
  for (const id of named) {
    if ((catalogue?.types?.[id]?.aura?.sensor?.tunnel_radius ?? 0) > 0) {
      out.push(
        `${file}: fields "${id}" (aura.sensor.tunnel_radius > 0) in a mission that authors a digs or in_tunnel placement -- ` +
          `a radius that reads routes without line of sight would solve its tunnels`,
      );
    }
  }
  return out;
}

/** 5: a work's symbol is neither a terrain symbol nor drawn in any shipped map row. A work is
 *  placed by a command or a mission, never by the grid. `maps` is `[{ file, rows }]`. */
export function worksSymbolFailures(catalogue, maps, terrainSymbols) {
  const out = [];
  for (const [id, spec] of Object.entries(catalogue?.types ?? {})) {
    if (!isWork(spec)) continue;
    if (terrainSymbols.has(spec.symbol)) out.push(`data/structures.json: work "${id}" claims symbol "${spec.symbol}", a terrain symbol`);
    for (const m of maps) {
      const y = (m.rows ?? []).findIndex((r) => typeof r === 'string' && r.includes(spec.symbol));
      if (y >= 0) out.push(`${m.file}: row ${y} uses "${spec.symbol}", the symbol of work "${id}" -- works are never drawn into a map grid`);
    }
  }
  return out;
}
