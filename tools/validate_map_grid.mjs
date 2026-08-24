// Elevation-grid checks for the data gate.
//
// The gate deliberately does not import `parseMap` -- it stays a standalone
// Node script with no build step, and re-implements the `rows` checks inline
// for that reason. Elevation had no such re-implementation, so `parseMap` was
// the only thing that ever checked it and the gate never calls `parseMap`.
// Extracted rather than inlined so a test can call it directly: a validation
// check that has never rejected anything is not a validation check.
export function elevationFailures(m, label) {
  const out = [];
  if (!Array.isArray(m.elevation)) return out;
  if (m.elevation.length !== m.height) {
    out.push(`${label}: ${m.elevation.length} elevation rows but declared height ${m.height}`);
  }
  m.elevation.forEach((row, y) => {
    if (typeof row !== 'string') {
      out.push(`${label}: elevation row ${y} is not a string`);
      return;
    }
    if (row.length !== m.width) {
      out.push(`${label}: elevation row ${y} has ${row.length} tiles but declared width ${m.width}`);
      return;
    }
    for (let x = 0; x < row.length; x++) {
      if (row[x] < '0' || row[x] > '9') {
        out.push(`${label}: elevation "${row[x]}" at (${x},${y}) is not a digit 0-9`);
        return;
      }
    }
  });
  return out;
}
