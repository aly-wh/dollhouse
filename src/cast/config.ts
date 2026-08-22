/**
 * The cast, as data.
 *
 * Who lives in the house is a JSON document, for the same reason the house is:
 * adding a sixth person, or deciding that Wick is not as sour as all that, must
 * be an edit to a file and nothing else. No code change, no recompile, no new
 * export. `casts/dollhouse.json` is the one this repo ships; `--cast <path>`
 * runs any other.
 *
 * A character is four things and no more:
 *
 *   - **traits**, which `src/personality.ts` turns into the weights that
 *     multiply every score;
 *   - **starting motives**, which decide what the first morning looks like and
 *     stop mattering by the second day;
 *   - **a room to wake up in**, which biases the first hour and, in a house with
 *     two beds, quietly biases the first night;
 *   - **relationships**, which are opinions about the *other* characters and are
 *     the only field here that one person's entry says about somebody else.
 *
 * Relationships are asymmetric on purpose. `mara -> dez` and `dez -> mara` are
 * separate numbers, so the file can say that she cannot stand him and he has not
 * noticed. A model where a relationship is one shared number cannot express
 * being wrong about somebody, and being wrong about somebody is where most of
 * the drama in a house comes from.
 *
 * The `memory` block is the dynamics — how fast a grudge forms, how long it
 * lasts, how far it is allowed to move a decision. It sits in the cast file
 * rather than the world file because it is a property of the people, not of the
 * building, and it sits in a file at all because "changing a personality
 * requires editing config only" has to include the parts of a personality that
 * are about what happens to them.
 *
 * Amounts are `[id, value]` pairs rather than objects, matching
 * `worlds/*.json` — see the top of `src/world/config.ts` for why. Unknown keys
 * are rejected; see `src/config/document.ts` for how.
 */

import {
  ConfigError,
  NO_KEYS,
  asRecord,
  checkKeys,
  describe,
  inRange,
  optionalArray,
  optionalNumber,
  optionalString,
  parseJsonWithKeys,
  requiredArray,
  requiredString,
  type Keyed,
} from '../config/document';
import { DEFAULT_MEMORY, OPINION_MAX, type MemoryConfig } from '../memory';
import { MOTIVE_IDS, MOTIVE_MAX, MOTIVE_MIN, type MotiveId } from '../motives';
import { TRAIT_IDS, type TraitId } from '../personality';
import type { CharacterSpec } from '../simulation';

export type TraitAmount = readonly [TraitId, number];
export type MotiveAmount = readonly [MotiveId, number];
/** Another character's id, and how this one feels about them on -1..+1. */
export type BondAmount = readonly [string, number];

export interface CharacterConfig {
  readonly id: string;
  readonly name: string;
  /** Where they wake up. Checked against the house by `checkCastAgainstWorld`. */
  readonly room?: string;
  readonly traits: readonly TraitAmount[];
  readonly motives: readonly MotiveAmount[];
  /** Per-character decay overrides. Almost always absent; see `motives.ts`. */
  readonly decayRates: readonly MotiveAmount[];
  readonly relationships: readonly BondAmount[];
}

export interface CastConfig {
  readonly id: string;
  readonly name: string;
  /** `null` in the file means these people form no impressions at all. */
  readonly memory: MemoryConfig | null;
  readonly characters: readonly CharacterConfig[];
}

/** A `ConfigError` from a cast file, so a caller can tell it from a bad house. */
export class CastConfigError extends ConfigError {
  constructor(path: string, message: string) {
    super(path, message);
    this.name = 'CastConfigError';
  }
}

const CAST_KEYS = ['id', 'name', 'memory', 'characters'];
const CHARACTER_KEYS = ['id', 'name', 'room', 'traits', 'motives', 'decayRates', 'relationships'];
const MEMORY_KEYS = [
  'impressionInfluence',
  'impressionFadeHours',
  'bondInfluence',
  'bondFadeHours',
  'occupied',
  'unavailable',
  'worked',
  'talked',
  'walkedOut',
  'snubbed',
];

function fail(path: string, message: string): never {
  throw new CastConfigError(path, message);
}

/** See `asWorldError` in `src/world/config.ts`; the same argument applies here. */
function asCastError<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof CastConfigError) throw error;
    if (error instanceof ConfigError) {
      throw new CastConfigError(error.path, error.message.slice(error.path.length + 2));
    }
    throw error;
  }
}

function isTraitId(value: unknown): value is TraitId {
  for (const trait of TRAIT_IDS) {
    if (trait === value) return true;
  }
  return false;
}

function isMotiveId(value: unknown): value is MotiveId {
  for (const motive of MOTIVE_IDS) {
    if (motive === value) return true;
  }
  return false;
}

/**
 * `[[id, amount], ...]`, with the id checked against a closed list.
 *
 * A misspelt id is an error rather than a value that quietly does nothing, which
 * is the entire argument for the pair form. `"neet": 0.95` in an object would be
 * a fastidious character who is silently average.
 */
function pairs(
  raw: readonly unknown[],
  path: string,
  isId: (value: unknown) => boolean,
  expected: string,
  low: number,
  high: number,
): readonly (readonly [string, number])[] {
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const where = `${path}[${index}]`;
    if (!Array.isArray(entry) || entry.length !== 2) fail(where, `expected an [${expected}, amount] pair`);
    const id: unknown = entry[0];
    const amount: unknown = entry[1];
    if (!isId(id)) fail(where, `unknown ${expected} ${JSON.stringify(id)}`);
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      fail(where, `expected a finite amount, got ${describe(amount)}`);
    }
    const key = id as string;
    if (seen.has(key)) fail(where, `${key} appears twice`);
    seen.add(key);
    inRange(amount, low, high, where);
    return [key, amount] as const;
  });
}

function parseMemory(value: unknown, keyed: Keyed): MemoryConfig | null {
  // Absent means the engine's defaults; an explicit null means these people form
  // no impressions and hold no grudges. The two are different worlds and the
  // file has to be able to say which.
  if (value === null) return null;
  if (value === undefined) return DEFAULT_MEMORY;

  const record = asRecord(value, 'cast.memory');
  checkKeys(record, MEMORY_KEYS, 'cast.memory', keyed);

  const influence = (key: 'impressionInfluence' | 'bondInfluence'): number => {
    const raw = optionalNumber(record, key, 'cast.memory') ?? DEFAULT_MEMORY[key];
    // Above 1 an opinion could invert a score's sign, and an object somebody
    // dislikes would become one they are repelled by hard enough to prefer doing
    // nothing at all — which is a veto, not a preference. Memory is a thumb on
    // the scale by construction, and this is where that is enforced.
    return inRange(raw, 0, 1, `cast.memory.${key}`);
  };

  const fade = (key: 'impressionFadeHours' | 'bondFadeHours'): number => {
    const raw = optionalNumber(record, key, 'cast.memory') ?? DEFAULT_MEMORY[key];
    if (raw <= 0) fail(`cast.memory.${key}`, 'must be greater than zero; use influence 0 to switch memory off');
    return raw;
  };

  const size = (
    key: 'occupied' | 'unavailable' | 'worked' | 'talked' | 'walkedOut' | 'snubbed',
  ): number =>
    inRange(
      optionalNumber(record, key, 'cast.memory') ?? DEFAULT_MEMORY[key],
      -OPINION_MAX,
      OPINION_MAX,
      `cast.memory.${key}`,
    );

  return {
    impressionInfluence: influence('impressionInfluence'),
    impressionFadeHours: fade('impressionFadeHours'),
    bondInfluence: influence('bondInfluence'),
    bondFadeHours: fade('bondFadeHours'),
    occupied: size('occupied'),
    unavailable: size('unavailable'),
    worked: size('worked'),
    talked: size('talked'),
    walkedOut: size('walkedOut'),
    snubbed: size('snubbed'),
  };
}

function parseCharacter(value: unknown, path: string, keyed: Keyed): CharacterConfig {
  const record = asRecord(value, path);
  checkKeys(record, CHARACTER_KEYS, path, keyed);

  const traits = pairs(
    requiredArray(record, 'traits', path),
    `${path}.traits`,
    isTraitId,
    'trait',
    0,
    1,
  ) as readonly TraitAmount[];

  return {
    id: requiredString(record, 'id', path),
    name: requiredString(record, 'name', path),
    room: optionalString(record, 'room', path),
    traits,
    motives: pairs(
      optionalArray(record, 'motives', path),
      `${path}.motives`,
      isMotiveId,
      'motive',
      MOTIVE_MIN,
      MOTIVE_MAX,
    ) as readonly MotiveAmount[],
    decayRates: pairs(
      optionalArray(record, 'decayRates', path),
      `${path}.decayRates`,
      isMotiveId,
      'motive',
      0,
      1000,
    ) as readonly MotiveAmount[],
    // Ids are checked against the cast in `validate`, once every character is
    // known; a forward reference to somebody further down the file is fine.
    relationships: pairs(
      optionalArray(record, 'relationships', path),
      `${path}.relationships`,
      (id) => typeof id === 'string' && id.length > 0,
      'character id',
      -OPINION_MAX,
      OPINION_MAX,
    ) as readonly BondAmount[],
  };
}

function validate(cast: CastConfig): void {
  if (cast.characters.length === 0) fail('cast.characters', 'a cast needs at least one character');

  const ids = new Set<string>();
  for (const character of cast.characters) {
    if (ids.has(character.id)) fail('cast.characters', `duplicate character id: ${character.id}`);
    ids.add(character.id);
  }

  for (const character of cast.characters) {
    for (const [other] of character.relationships) {
      if (other === character.id) {
        fail(`cast.characters.${character.id}.relationships`, 'a character cannot have a relationship with themselves');
      }
      if (!ids.has(other)) {
        fail(`cast.characters.${character.id}.relationships`, `no such character: ${other}`);
      }
    }
  }
}

/** Parse and validate an already-decoded document. */
export function parseCastConfig(value: unknown, keyed: Keyed = NO_KEYS): CastConfig {
  return asCastError(() => readCastConfig(value, keyed));
}

function readCastConfig(value: unknown, keyed: Keyed): CastConfig {
  const record = asRecord(value, 'cast');
  checkKeys(record, CAST_KEYS, 'cast', keyed);

  const cast: CastConfig = {
    id: requiredString(record, 'id', 'cast'),
    name: requiredString(record, 'name', 'cast'),
    memory: parseMemory(record['memory'], keyed),
    characters: requiredArray(record, 'characters', 'cast').map((entry, index) =>
      parseCharacter(entry, `cast.characters[${index}]`, keyed),
    ),
  };

  validate(cast);
  return cast;
}

/** Parse a cast from JSON text, unknown-key check included. */
export function parseCastJson(text: string): CastConfig {
  const { value, keyed } = parseJsonWithKeys(text);
  return parseCastConfig(value, keyed);
}

/** Pairs to the partial record the engine wants, built in a fixed id order. */
function toTraitOverrides(amounts: readonly TraitAmount[]): Partial<Record<TraitId, number>> {
  const vector: Partial<Record<TraitId, number>> = {};
  for (const trait of TRAIT_IDS) {
    for (const [id, amount] of amounts) {
      if (id === trait) vector[trait] = amount;
    }
  }
  return vector;
}

function toMotiveOverrides(amounts: readonly MotiveAmount[]): Partial<Record<MotiveId, number>> {
  const vector: Partial<Record<MotiveId, number>> = {};
  for (const motive of MOTIVE_IDS) {
    for (const [id, amount] of amounts) {
      if (id === motive) vector[motive] = amount;
    }
  }
  return vector;
}

/** The cast as the engine takes it. Order is the file's; the engine sorts. */
export function toCharacterSpecs(cast: CastConfig): readonly CharacterSpec[] {
  return cast.characters.map((character) => ({
    id: character.id,
    name: character.name,
    roomId: character.room,
    traits: toTraitOverrides(character.traits),
    motives: toMotiveOverrides(character.motives),
    decayRates:
      character.decayRates.length > 0 ? toMotiveOverrides(character.decayRates) : undefined,
    relationships: character.relationships,
  }));
}

/**
 * The one thing a cast file cannot check on its own: that the rooms it names
 * exist in the house it will be run in.
 *
 * A room that is not in the house is not a crash. `RoomGraph.hoursBetween`
 * treats an unknown origin as the entry room, so a typo puts somebody in the
 * hall and nothing anywhere says so — they simply have a different morning from
 * the one the file describes, forever. Cheap to refuse at the point the two
 * documents first meet, which is the only place either of them knows about the
 * other.
 */
export function checkCastAgainstWorld(cast: CastConfig, roomIds: readonly string[]): void {
  const rooms = new Set(roomIds);
  for (const character of cast.characters) {
    if (character.room === undefined) continue;
    if (!rooms.has(character.room)) {
      fail(`cast.characters.${character.id}.room`, `no such room in this world: ${character.room}`);
    }
  }
}
