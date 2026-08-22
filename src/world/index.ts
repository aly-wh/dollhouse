/**
 * The world: rooms, smart objects, and what runs out.
 *
 * `src/advertisement.ts` is the socket; this is the plug. Nothing in the engine
 * imports anything from here — the engine only ever holds a `WorldAdapter` — so
 * a different house, or a house generated rather than authored, drops in without
 * the simulation noticing.
 */

export {
  WorldConfigError,
  adjacency,
  parseJsonWithKeys,
  parseWorldConfig,
  parseWorldJson,
  toPartialMotiveVector,
  type InteractionConfig,
  type Keyed,
  type MotiveAmount,
  type ObjectConfig,
  type ResourceAmount,
  type ResourceConfig,
  type RoomConfig,
  type TravelConfig,
  type WorldConfig,
} from './config';

export { DEFAULT_WORLD_PATH, loadWorldFile } from './load';

export { RoomGraph } from './rooms';

export { ResourcePool, type ResourceSnapshot } from './resources';

export { House } from './house';

export {
  STRONG_SOURCE_PER_HOUR,
  auditMotiveSources,
  formatAudit,
  generalists,
  type AuditableOffer,
  type MotiveAudit,
  type MotiveSource,
} from './audit';
