/** Plain copies of reactive state objects (class instances with `$state` fields) for debug reports. */

export function plainState(obj: object, skip: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = new Set<string>(Object.keys(obj));
  // `$state` class fields are accessors on the prototype.
  for (let proto = Object.getPrototypeOf(obj); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) if (d.get) keys.add(key);
  }
  for (const key of keys) {
    if (skip.includes(key)) continue;
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value !== 'function') out[key] = $state.snapshot(value);
  }
  return out;
}
