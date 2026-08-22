/**
 * Reading a hand-edited JSON document without letting a typo through.
 *
 * This is #5's parsing discipline, lifted out of `src/world/config.ts` unchanged
 * so that #6's cast file gets it too. Nothing new is decided here; the reasoning
 * is #5's and is worth restating because it is the whole point of the module:
 *
 * **A hand-edited data file's nastiest failure is a typo in an *optional* key.**
 * `"capacty": 2` on a sofa is not a parse error — it is a sofa that silently
 * seats one. `"neet": 0.95` on a character is not a parse error either — it is a
 * fastidious character who is quietly average, and a cast that reads as one
 * person in five hats for a reason nobody can see. So parsing rejects keys it
 * does not recognise.
 *
 * **And it finds them without `Object.keys`.** `JSON.parse`'s reviver is handed
 * every key as the document is internalised, with `this` bound to the node that
 * held it, and the nodes it is handed are the very ones that end up in the
 * result — so they can be looked up by identity afterwards. The keys are sorted
 * before they are reported and used for nothing but throwing. Document order
 * cannot reach a number the simulation reads. There is a test in
 * `determinism.test.ts` that greps the engine for object enumeration; this is
 * how a config parser lives inside that rule.
 *
 * `note` is accepted on every node and ignored. The reasoning behind a number
 * belongs next to the number.
 */

/** Where in the document, and what was wrong with it. */
export class ConfigError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ConfigError';
  }
}

/** Accepted anywhere and ignored. */
export const COMMENT_KEY = 'note';

/**
 * Keys seen on each object node of a parsed document.
 *
 * Threaded through parsing so that a caller who already has a plain object — a
 * test, or a house built in memory — can still parse it, just without the
 * unknown-key check.
 */
export interface Keyed {
  keysOf(node: object): readonly string[] | undefined;
}

export const NO_KEYS: Keyed = { keysOf: () => undefined };

/** `JSON.parse`, recording every key against the object it appeared on. */
export function parseJsonWithKeys(text: string): { value: unknown; keyed: Keyed } {
  const keys = new Map<object, string[]>();

  const value: unknown = JSON.parse(text, function (this: unknown, key: string, held: unknown) {
    if (key !== '' && typeof this === 'object' && this !== null && !Array.isArray(this)) {
      const existing = keys.get(this);
      if (existing) existing.push(key);
      else keys.set(this, [key]);
    }
    return held;
  });

  return { value, keyed: { keysOf: (node) => keys.get(node) } };
}

export function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

export function fail(path: string, message: string): never {
  throw new ConfigError(path, message);
}

export function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

export function checkKeys(
  node: object,
  allowed: readonly string[],
  path: string,
  keyed: Keyed,
): void {
  const seen = keyed.keysOf(node);
  if (seen === undefined) return;
  const unknown: string[] = [];
  for (const key of seen) {
    if (key === COMMENT_KEY) continue;
    if (!allowed.includes(key)) unknown.push(key);
  }
  if (unknown.length > 0) {
    // Sorted, so the message does not depend on the order the document happened
    // to be written in.
    unknown.sort();
    fail(path, `unknown key${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  }
}

export function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path}.${key}`, `expected a non-empty string, got ${describe(value)}`);
  }
  return value;
}

export function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  if (record[key] === undefined) return undefined;
  return requiredString(record, key, path);
}

export function requiredNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path}.${key}`, `expected a finite number, got ${describe(value)}`);
  }
  return value;
}

export function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  if (record[key] === undefined) return undefined;
  return requiredNumber(record, key, path);
}

export function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    fail(`${path}.${key}`, `expected a boolean, got ${describe(value)}`);
  }
  return value;
}

export function requiredArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) fail(`${path}.${key}`, `expected an array, got ${describe(value)}`);
  return value;
}

export function optionalArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): unknown[] {
  if (record[key] === undefined) return [];
  return requiredArray(record, key, path);
}

export function stringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string[] {
  const raw = optionalArray(record, key, path);
  return raw.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      fail(`${path}.${key}[${index}]`, `expected a non-empty string, got ${describe(entry)}`);
    }
    return entry;
  });
}

/**
 * A number that must sit inside a range, named in the error rather than left to
 * be inferred from a bare "invalid".
 */
export function inRange(
  value: number,
  low: number,
  high: number,
  path: string,
): number {
  if (value < low || value > high) fail(path, `must be between ${low} and ${high}, got ${value}`);
  return value;
}
