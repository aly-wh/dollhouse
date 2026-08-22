/**
 * The world, as data.
 *
 * A house is a JSON document: rooms and the doors between them, resources that
 * run out, and objects that advertise what they would do for you. Adding a room
 * or an object is an edit to that document and nothing else — no code change, no
 * recompile, no new export. `worlds/dollhouse.json` is the one this repo ships;
 * `--world <path>` runs any other.
 *
 * Two things about the shape of the format are deliberate and would otherwise
 * look like clumsiness.
 *
 * ## Why per-motive amounts are pairs, not an object
 *
 *     "effects": [["hunger", 110], ["comfort", -6]]
 *
 * rather than `{ "hunger": 110, "comfort": -6 }`. The engine forbids walking an
 * object's keys anywhere a run could feel it — there is a test that greps for it
 * — because a replay must not rest on an engine's key-order guarantees. Pairs
 * are read positionally, validated against a closed list of motive ids, and a
 * misspelt motive is an error rather than a silent zero. The object form would
 * need either enumeration or a silent-failure mode, and the silent-failure mode
 * is the worse of the two: `"hygene": 120` in an object is a shower that quietly
 * does nothing.
 *
 * ## Why unknown keys are rejected, and how
 *
 * A hand-edited data file's nastiest failure is a typo in an *optional* key.
 * `"capacty": 2` on the sofa is not a parse error — it is a sofa that silently
 * seats one, and a house that queues for no reason anybody can see. So parsing
 * rejects keys it does not recognise.
 *
 * Finding those keys without `Object.keys` is done with `JSON.parse`'s reviver,
 * which is handed every key in the document as it is internalised. The keys are
 * collected per node, sorted before they are reported, and used for nothing but
 * throwing. Document order cannot reach a motive.
 *
 * `note` is accepted on every node and ignored. The reasoning behind a number
 * belongs next to the number.
 */

import { MOTIVE_IDS, type MotiveId, type PartialMotiveVector } from '../motives';

/** A motive id paired with an amount. See the note above on why this is a pair. */
export type MotiveAmount = readonly [MotiveId, number];

/** A resource id paired with an amount. Amounts are always positive here. */
export type ResourceAmount = readonly [string, number];

export interface RoomConfig {
  readonly id: string;
  readonly name: string;
  /**
   * Rooms this one opens onto. Doors are made symmetric on load, so each one
   * only needs writing down once, from whichever side reads more naturally.
   */
  readonly exits: readonly string[];
}

export interface ResourceConfig {
  readonly id: string;
  /** How it reads in the log: "food in the fridge", not "fridge-food". */
  readonly label: string;
  readonly capacity: number;
  readonly initial: number;
  /** Refill per simulated hour. 0 means the house has to make more itself. */
  readonly regenPerHour: number;
}

export interface InteractionConfig {
  readonly id: string;
  readonly label: string;
  readonly durationHours: number;
  readonly effects: readonly MotiveAmount[];
  readonly decayMultipliers?: readonly MotiveAmount[];
  readonly capacity?: number;
  readonly interruptible?: boolean;
  readonly minimumHours?: number;
  /** Paid in full when the interaction begins. An unaffordable one is not advertised. */
  readonly consumes?: readonly ResourceAmount[];
  /** Paid out only when the interaction runs to completion. Walking off mid-cook makes nothing. */
  readonly produces?: readonly ResourceAmount[];
  readonly tags?: readonly string[];
}

export interface ObjectConfig {
  readonly id: string;
  readonly name: string;
  readonly room: string;
  readonly interactions: readonly InteractionConfig[];
}

export interface TravelConfig {
  /** Hours per doorway crossed. Distances are whole doorways; there is no geometry. */
  readonly hoursPerHop: number;
  /**
   * How steeply distance puts a character off, per hour of it.
   *
   * Separate from `hoursPerHop`, and much larger than it looks, because in a
   * house the two things distance does are wildly different sizes. Crossing a
   * room takes seconds; *preferring* the nearer of two sofas is most of what
   * makes a floor plan visible in behaviour.
   *
   * The engine's default of 0.5 per hour was written for a world with no
   * geometry at all, and at house scale it is worth about three per cent — which
   * is to say nothing. Setting it here rather than in the engine is deliberate:
   * it is a statement about *this house's scale*, and a warehouse or a village
   * would want a different one. Omitted, the engine's default stands.
   */
  readonly discountPerHour?: number;
}

export interface WorldConfig {
  readonly id: string;
  readonly name: string;
  /** Where a character with no room of their own is taken to be standing. */
  readonly entryRoom: string;
  readonly travel: TravelConfig;
  readonly rooms: readonly RoomConfig[];
  readonly resources: readonly ResourceConfig[];
  readonly objects: readonly ObjectConfig[];
}

export class WorldConfigError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'WorldConfigError';
  }
}

const WORLD_KEYS = ['id', 'name', 'entryRoom', 'travel', 'rooms', 'resources', 'objects'];
const ROOM_KEYS = ['id', 'name', 'exits'];
const RESOURCE_KEYS = ['id', 'label', 'capacity', 'initial', 'regenPerHour'];
const OBJECT_KEYS = ['id', 'name', 'room', 'interactions'];
const TRAVEL_KEYS = ['hoursPerHop', 'discountPerHour'];
const INTERACTION_KEYS = [
  'id',
  'label',
  'durationHours',
  'effects',
  'decayMultipliers',
  'capacity',
  'interruptible',
  'minimumHours',
  'consumes',
  'produces',
  'tags',
];

/** Accepted anywhere and ignored. Reasoning belongs beside the number it explains. */
const COMMENT_KEY = 'note';

/**
 * Keys seen on each object node of a parsed document.
 *
 * Collected by the reviver rather than by enumerating the result, for the reason
 * given at the top of this file. `Keyed` is threaded through parsing so that a
 * caller who already has a plain object — a test, or #6 building a house in
 * memory — can still parse it, just without the unknown-key check.
 */
export interface Keyed {
  keysOf(node: object): readonly string[] | undefined;
}

const NO_KEYS: Keyed = { keysOf: () => undefined };

/**
 * `JSON.parse`, recording every key against the object it appeared on.
 *
 * The reviver is called with `this` bound to the node holding the key, and the
 * nodes it is handed are the very ones that end up in the result, so the map can
 * be looked up by identity afterwards.
 */
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

function fail(path: string, message: string): never {
  throw new WorldConfigError(path, message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function checkKeys(node: object, allowed: readonly string[], path: string, keyed: Keyed): void {
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

function requiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path}.${key}`, `expected a non-empty string, got ${describe(value)}`);
  }
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path}.${key}`, `expected a finite number, got ${describe(value)}`);
  }
  return value;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  if (record[key] === undefined) return undefined;
  return requiredNumber(record, key, path);
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(`${path}.${key}`, `expected a boolean, got ${describe(value)}`);
  return value;
}

function requiredArray(record: Record<string, unknown>, key: string, path: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) fail(`${path}.${key}`, `expected an array, got ${describe(value)}`);
  return value;
}

function optionalArray(record: Record<string, unknown>, key: string, path: string): unknown[] {
  if (record[key] === undefined) return [];
  return requiredArray(record, key, path);
}

function stringArray(record: Record<string, unknown>, key: string, path: string): string[] {
  const raw = optionalArray(record, key, path);
  return raw.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      fail(`${path}.${key}[${index}]`, `expected a non-empty string, got ${describe(entry)}`);
    }
    return entry;
  });
}

function isMotiveId(value: unknown): value is MotiveId {
  for (const motive of MOTIVE_IDS) {
    if (motive === value) return true;
  }
  return false;
}

function motiveAmounts(
  record: Record<string, unknown>,
  key: string,
  path: string,
  required: boolean,
): MotiveAmount[] {
  const raw = required ? requiredArray(record, key, path) : optionalArray(record, key, path);
  const seen = new Set<MotiveId>();
  return raw.map((entry, index) => {
    const where = `${path}.${key}[${index}]`;
    if (!Array.isArray(entry) || entry.length !== 2) {
      fail(where, 'expected a [motive, amount] pair');
    }
    const motive: unknown = entry[0];
    const amount: unknown = entry[1];
    if (!isMotiveId(motive)) {
      fail(where, `unknown motive ${JSON.stringify(motive)}; expected one of ${MOTIVE_IDS.join(', ')}`);
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      fail(where, `expected a finite amount, got ${describe(amount)}`);
    }
    if (seen.has(motive)) fail(where, `${motive} appears twice`);
    seen.add(motive);
    return [motive, amount] as const;
  });
}

function resourceAmounts(
  record: Record<string, unknown>,
  key: string,
  path: string,
): ResourceAmount[] {
  const raw = optionalArray(record, key, path);
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const where = `${path}.${key}[${index}]`;
    if (!Array.isArray(entry) || entry.length !== 2) {
      fail(where, 'expected a [resource, amount] pair');
    }
    const resource: unknown = entry[0];
    const amount: unknown = entry[1];
    if (typeof resource !== 'string' || resource.length === 0) {
      fail(where, `expected a resource id, got ${describe(resource)}`);
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      fail(where, `expected a positive amount, got ${describe(amount)}`);
    }
    if (seen.has(resource)) fail(where, `${resource} appears twice`);
    seen.add(resource);
    return [resource, amount] as const;
  });
}

/** Pairs to the partial vector the engine wants, built in the fixed motive order. */
export function toPartialMotiveVector(amounts: readonly MotiveAmount[]): PartialMotiveVector {
  const vector: PartialMotiveVector = {};
  for (const motive of MOTIVE_IDS) {
    for (const [id, amount] of amounts) {
      if (id === motive) vector[motive] = amount;
    }
  }
  return vector;
}

function parseInteraction(
  value: unknown,
  path: string,
  keyed: Keyed,
): InteractionConfig {
  const record = asRecord(value, path);
  checkKeys(record, INTERACTION_KEYS, path, keyed);

  const durationHours = requiredNumber(record, 'durationHours', path);
  if (durationHours <= 0) fail(`${path}.durationHours`, 'must be greater than zero');

  const capacity = optionalNumber(record, 'capacity', path);
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
    fail(`${path}.capacity`, 'must be a whole number of at least 1');
  }

  const minimumHours = optionalNumber(record, 'minimumHours', path);
  if (minimumHours !== undefined && (minimumHours < 0 || minimumHours > durationHours)) {
    fail(`${path}.minimumHours`, 'must be between zero and durationHours');
  }

  const effects = motiveAmounts(record, 'effects', path, true);
  if (effects.length === 0) fail(`${path}.effects`, 'an interaction that changes nothing is not an interaction');

  return {
    id: requiredString(record, 'id', path),
    label: requiredString(record, 'label', path),
    durationHours,
    effects,
    decayMultipliers: motiveAmounts(record, 'decayMultipliers', path, false),
    capacity,
    interruptible: optionalBoolean(record, 'interruptible', path),
    minimumHours,
    consumes: resourceAmounts(record, 'consumes', path),
    produces: resourceAmounts(record, 'produces', path),
    tags: stringArray(record, 'tags', path),
  };
}

function parseObject(value: unknown, path: string, keyed: Keyed): ObjectConfig {
  const record = asRecord(value, path);
  checkKeys(record, OBJECT_KEYS, path, keyed);

  const interactions = requiredArray(record, 'interactions', path).map((entry, index) =>
    parseInteraction(entry, `${path}.interactions[${index}]`, keyed),
  );
  if (interactions.length === 0) {
    fail(`${path}.interactions`, 'an object that advertises nothing is furniture, not a smart object');
  }

  return {
    id: requiredString(record, 'id', path),
    name: requiredString(record, 'name', path),
    room: requiredString(record, 'room', path),
    interactions,
  };
}

function parseRoom(value: unknown, path: string, keyed: Keyed): RoomConfig {
  const record = asRecord(value, path);
  checkKeys(record, ROOM_KEYS, path, keyed);
  return {
    id: requiredString(record, 'id', path),
    name: requiredString(record, 'name', path),
    exits: stringArray(record, 'exits', path),
  };
}

function parseResource(value: unknown, path: string, keyed: Keyed): ResourceConfig {
  const record = asRecord(value, path);
  checkKeys(record, RESOURCE_KEYS, path, keyed);

  const capacity = requiredNumber(record, 'capacity', path);
  if (capacity <= 0) fail(`${path}.capacity`, 'must be greater than zero');
  const initial = requiredNumber(record, 'initial', path);
  if (initial < 0 || initial > capacity) fail(`${path}.initial`, 'must be between zero and capacity');
  const regenPerHour = requiredNumber(record, 'regenPerHour', path);
  if (regenPerHour < 0) fail(`${path}.regenPerHour`, 'must not be negative');

  return {
    id: requiredString(record, 'id', path),
    label: requiredString(record, 'label', path),
    capacity,
    initial,
    regenPerHour,
  };
}

/**
 * Everything that has to hold for the house to be a house rather than a bag of
 * nouns: no duplicate ids, every door leads somewhere, every object stands in a
 * room, every resource an interaction spends or makes actually exists, and the
 * whole floor plan is one connected building.
 *
 * The connectivity check is the one worth spelling out. An unreachable room is
 * not a runtime error — `travelHours` would simply return a distance nobody can
 * pay — so it presents as furniture that no character ever uses, which is a bug
 * that costs an afternoon to find by watching. It costs one BFS to refuse.
 */
function validate(config: WorldConfig): void {
  const roomIds = new Set<string>();
  for (const room of config.rooms) {
    if (roomIds.has(room.id)) fail(`rooms`, `duplicate room id: ${room.id}`);
    roomIds.add(room.id);
  }
  if (roomIds.size === 0) fail('rooms', 'a house needs at least one room');

  for (const room of config.rooms) {
    for (const exit of room.exits) {
      if (!roomIds.has(exit)) fail(`rooms.${room.id}.exits`, `no such room: ${exit}`);
      if (exit === room.id) fail(`rooms.${room.id}.exits`, 'a room cannot open onto itself');
    }
  }

  if (!roomIds.has(config.entryRoom)) fail('entryRoom', `no such room: ${config.entryRoom}`);
  if (config.travel.hoursPerHop < 0) fail('travel.hoursPerHop', 'must not be negative');
  if (config.travel.discountPerHour !== undefined && config.travel.discountPerHour < 0) {
    fail('travel.discountPerHour', 'must not be negative');
  }

  const resourceIds = new Set<string>();
  for (const resource of config.resources) {
    if (resourceIds.has(resource.id)) fail('resources', `duplicate resource id: ${resource.id}`);
    resourceIds.add(resource.id);
  }

  const objectIds = new Set<string>();
  for (const object of config.objects) {
    if (objectIds.has(object.id)) fail('objects', `duplicate object id: ${object.id}`);
    objectIds.add(object.id);
    if (!roomIds.has(object.room)) fail(`objects.${object.id}.room`, `no such room: ${object.room}`);

    const interactionIds = new Set<string>();
    for (const interaction of object.interactions) {
      if (interactionIds.has(interaction.id)) {
        fail(`objects.${object.id}`, `duplicate interaction id: ${interaction.id}`);
      }
      interactionIds.add(interaction.id);

      for (const [resource] of interaction.consumes ?? []) {
        if (!resourceIds.has(resource)) {
          fail(`objects.${object.id}.${interaction.id}.consumes`, `no such resource: ${resource}`);
        }
      }
      for (const [resource] of interaction.produces ?? []) {
        if (!resourceIds.has(resource)) {
          fail(`objects.${object.id}.${interaction.id}.produces`, `no such resource: ${resource}`);
        }
      }
    }
  }

  const reachable = reachableFrom(config, config.entryRoom);
  for (const room of config.rooms) {
    if (!reachable.has(room.id)) {
      fail('rooms', `${room.id} cannot be reached from ${config.entryRoom}; the house is in two pieces`);
    }
  }
}

/** Doors are two-way. Written once in the file, symmetric everywhere after this. */
export function adjacency(config: WorldConfig): Map<string, string[]> {
  const links = new Map<string, Set<string>>();
  for (const room of config.rooms) links.set(room.id, new Set<string>());
  for (const room of config.rooms) {
    for (const exit of room.exits) {
      links.get(room.id)?.add(exit);
      links.get(exit)?.add(room.id);
    }
  }

  const sorted = new Map<string, string[]>();
  for (const room of config.rooms) {
    const neighbours = [...(links.get(room.id) ?? new Set<string>())];
    neighbours.sort();
    sorted.set(room.id, neighbours);
  }
  return sorted;
}

function reachableFrom(config: WorldConfig, start: string): Set<string> {
  const links = adjacency(config);
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of links.get(queue[index] ?? '') ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Parse and validate an already-decoded document. Used by tests and by #6. */
export function parseWorldConfig(value: unknown, keyed: Keyed = NO_KEYS): WorldConfig {
  const record = asRecord(value, 'world');
  checkKeys(record, WORLD_KEYS, 'world', keyed);

  const travelRecord = asRecord(record['travel'], 'world.travel');
  checkKeys(travelRecord, TRAVEL_KEYS, 'world.travel', keyed);

  const config: WorldConfig = {
    id: requiredString(record, 'id', 'world'),
    name: requiredString(record, 'name', 'world'),
    entryRoom: requiredString(record, 'entryRoom', 'world'),
    travel: {
      hoursPerHop: requiredNumber(travelRecord, 'hoursPerHop', 'world.travel'),
      discountPerHour: optionalNumber(travelRecord, 'discountPerHour', 'world.travel'),
    },
    rooms: requiredArray(record, 'rooms', 'world').map((entry, index) =>
      parseRoom(entry, `world.rooms[${index}]`, keyed),
    ),
    resources: optionalArray(record, 'resources', 'world').map((entry, index) =>
      parseResource(entry, `world.resources[${index}]`, keyed),
    ),
    objects: requiredArray(record, 'objects', 'world').map((entry, index) =>
      parseObject(entry, `world.objects[${index}]`, keyed),
    ),
  };

  validate(config);
  return config;
}

/** Parse a world from JSON text, unknown-key check included. */
export function parseWorldJson(text: string): WorldConfig {
  const { value, keyed } = parseJsonWithKeys(text);
  return parseWorldConfig(value, keyed);
}
