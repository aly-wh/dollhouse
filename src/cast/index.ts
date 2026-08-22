/**
 * The cast: who lives in the house.
 *
 * `src/personality.ts` and `src/memory.ts` are the mechanisms — the dials. This
 * directory turns them, from a file. Nothing in the engine imports anything from
 * here; the engine only ever holds a `CharacterSpec`, so a different cast, or a
 * cast generated rather than authored, drops in without the simulation noticing.
 */

export {
  CastConfigError,
  checkCastAgainstWorld,
  parseCastConfig,
  parseCastJson,
  toCharacterSpecs,
  type BondAmount,
  type CastConfig,
  type CharacterConfig,
  type MotiveAmount,
  type TraitAmount,
} from './config';

export { DEFAULT_CAST_PATH, loadCastFile } from './load';
