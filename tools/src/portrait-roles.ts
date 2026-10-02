// Dumps the game's own role -> flat-albedo hex table (liftTone of rampFor*Role)
// as JSON for tools/render_unit_portraits.py, so the Blender pass reads the
// game's colours and never carries a copy. Usage: tsx portrait-roles.ts <out.json>
import { writeFileSync } from 'node:fs';
import { liftTone } from '../../packages/render/src/three/world-materials';
import { rampForRole, MESH_ROLES } from '../../packages/render/src/three/units/mesh-role';
import {
  rampForVehicleRole,
  VEHICLE_MESH_ROLES,
} from '../../packages/render/src/three/units/vehicle-mesh-role';

const out: Record<string, Record<string, string>> = { figure: {}, figure_enemy: {} };
for (const r of MESH_ROLES) {
  try {
    out.figure[r] = liftTone(rampForRole(r, 'kdf'));
    out.figure_enemy[r] = liftTone(rampForRole(r, 'enemy'));
  } catch {
    /* role with no ramp */
  }
}
for (const id of process.argv.slice(3)) {
  out[id] = {};
  for (const r of VEHICLE_MESH_ROLES) {
    try {
      out[id][r] = liftTone(rampForVehicleRole(id, r));
    } catch {
      /* not declared */
    }
  }
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
