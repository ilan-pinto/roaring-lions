/**
 * GH-943 P3 (T14b, GH-1152): a node material's DECLARED per-object inputs, for the parked refresh policy (`refresh-policy.ts`).
 *
 * The policy may turn a FULL refresh into SHARED only when it can see that nothing the render object's own uniform groups read has
 * changed. Three's own nodes (the model matrices, material references, texture transforms) it reads itself. A twin's own
 * `onObjectUpdate` / `onRenderUpdate` uniforms it cannot see into, so the twin DECLARES them here: the uniform names, and a reader
 * that writes the very values those uniforms will take for one drawn object. An update node the classifier meets that is neither
 * three's nor declared makes the program NEVER downgrade (G2c).
 *
 * A WeakMap, not `userData`: `Material.copy` JSON-clones `userData`, which would drop the reader and keep a stale name list.
 *
 * Imports nothing. Presentation only.
 */
export interface ObjectInputs {
  /**
   * Every declared uniform NODE, by identity. Not by name: three's GLSL builder renames a buffer uniform (`NodeBuffer_<id>`) when it
   * builds the program, so a name match fails for every uniform array (found by `refresh-policy.node.test.ts`).
   */
  readonly nodes: ReadonlySet<unknown>;
  /** The material's `OnBeforeMaterialUpdate` events are covered by `read` (it reads what they mirror). */
  readonly events: boolean;
  /** Pushes the declared inputs' current values for `object` (the drawn mesh) onto `out`, through `pushValue`. */
  read(object: unknown, out: number[]): void;
}

const registry = new WeakMap<object, ObjectInputs>();

export function declareObjectInputs(material: object, inputs: ObjectInputs): void {
  registry.set(material, inputs);
}

export function objectInputsOf(material: unknown): ObjectInputs | undefined {
  return material !== null && typeof material === 'object' ? registry.get(material) : undefined;
}

/** A value's sentinel for "absent", so `null` and `undefined` are compared as a value (NaN would never compare equal). */
export const ABSENT = -1.2345e300;

interface ArrayLikeValue {
  readonly length: number;
  readonly [i: number]: unknown;
}

/**
 * Flattens a uniform value onto `out`: a number, a boolean, a colour / vector / matrix (`toArray` or `elements`), a texture (its id
 * and version: a late image bumps the version), an array of those. Anything else pushes `ABSENT` and its type tag, so a change of
 * KIND still shows.
 */
export function pushValue(v: unknown, out: number[]): void {
  if (typeof v === 'number') {
    out.push(v);
    return;
  }
  if (typeof v === 'boolean') {
    out.push(v ? 1 : 0);
    return;
  }
  if (v === null || v === undefined) {
    out.push(ABSENT);
    return;
  }
  if (typeof v !== 'object') {
    out.push(ABSENT, 1);
    return;
  }
  const o = v as { isTexture?: boolean; id?: number; version?: number; elements?: ArrayLikeValue; isColor?: boolean; r?: number; g?: number; b?: number; x?: number; y?: number; z?: number; w?: number };
  if (o.isTexture === true) {
    out.push(o.id ?? ABSENT, o.version ?? ABSENT);
    return;
  }
  if (o.isColor === true) {
    out.push(o.r ?? ABSENT, o.g ?? ABSENT, o.b ?? ABSENT);
    return;
  }
  if (o.elements !== undefined) {
    for (let i = 0; i < o.elements.length; i++) out.push(o.elements[i] as number);
    return;
  }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = v as unknown as ArrayLikeValue;
    out.push(a.length);
    for (let i = 0; i < a.length; i++) pushValue(a[i], out);
    return;
  }
  if (typeof o.x === 'number') {
    out.push(o.x, o.y ?? ABSENT, o.z ?? ABSENT, o.w ?? ABSENT);
    return;
  }
  out.push(ABSENT, 2);
}
