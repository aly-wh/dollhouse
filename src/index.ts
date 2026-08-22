/**
 * DollHouse simulation engine.
 *
 * A need-driven utility AI in the Sims/Maxis tradition: motives decay, objects
 * advertise what they would do about that, and each character scores the offers
 * through their own personality weights and takes the best one.
 *
 * It makes no model calls. There is no client, no key, no network path, and no
 * seam where one could be added without it being obvious in review. That is the
 * cost model of the product, not an implementation detail — dialogue (#8) is the
 * only place inference is ever spent.
 */

export {
  advertisedGain,
  interactionCapacity,
  isInterruptible,
  staticWorld,
  toWorldAdapter,
  type Advertiser,
  type CharacterView,
  type Interaction,
  type WorldActionEnd,
  type WorldActionStart,
  type WorldAdapter,
} from './advertisement';

export {
  CastConfigError,
  DEFAULT_CAST_PATH,
  checkCastAgainstWorld,
  loadCastFile,
  parseCastConfig,
  parseCastJson,
  toCharacterSpecs,
  type BondAmount,
  type CastConfig,
  type CharacterConfig,
} from './cast';

export {
  ConfigError,
  parseJsonWithKeys as parseJsonRecordingKeys,
  type Keyed as KeyedDocument,
} from './config/document';

export {
  DEFAULT_MEMORY,
  MEMORY_LOG_STEP,
  Memory,
  OPINION_MAX,
  charmScale,
  clampOpinion,
  forgivenessScale,
  grievanceScale,
  resolveMemoryConfig,
  type MemoryAbout,
  type MemoryCause,
  type MemoryConfig,
  type MemoryEntry,
} from './memory';

export {
  MINUTES_PER_DAY,
  formatClock,
  round2,
  roundMotives,
  type ActionEndReason,
  type ActionEndedEvent,
  type ActionStartedEvent,
  type BlockedReason,
  type ConversationStartedEvent,
  type MotiveCriticalEvent,
  type MotiveRelievedEvent,
  type MovedEvent,
  type PlanBlockedEvent,
  type RememberedEvent,
  type ResourceChangeReason,
  type RunFinishedEvent,
  type RunStartedEvent,
  type SimEvent,
  type SnapshotEvent,
  type WorldDescribedEvent,
  type WorldDescription,
  type WorldEvent,
  type WorldEventBody,
} from './events';

export {
  DEFAULT_DECAY_PER_HOUR,
  MOTIVE_IDS,
  MOTIVE_MAX,
  MOTIVE_MIN,
  clampMotive,
  clampMotives,
  cloneMotives,
  mapMotives,
  mergeMotives,
  motiveVector,
  type MotiveId,
  type MotiveVector,
  type PartialMotiveVector,
} from './motives';

export {
  NEUTRAL_TRAIT,
  TRAIT_IDS,
  clampTrait,
  motiveWeightsFromTraits,
  resolveMotiveWeights,
  traitVector,
  type TraitId,
  type TraitVector,
} from './personality';

export { createRng, hashString, type Rng } from './rng';

export {
  DEFAULT_SCORING,
  applyJitter,
  resolveScoringConfig,
  scoreInteraction,
  type MotiveContribution,
  type ScoreBreakdown,
  type ScoreInput,
  type ScoringConfig,
} from './scoring';

export {
  DEFAULT_SOCIAL_INTERACTION,
  DEFAULT_TRAVEL_EFFECTS,
  IDLE_LABEL,
  Simulation,
  TRAVEL_LABEL,
  runSimulation,
  type CharacterSpec,
  type CharacterState,
  type RunningAction,
  type SimulationConfig,
  type SimulationResult,
  type TravelPlan,
} from './simulation';

export {
  DEFAULT_WORLD_PATH,
  House,
  ResourcePool,
  RoomGraph,
  STRONG_SOURCE_PER_HOUR,
  WorldConfigError,
  adjacency,
  auditMotiveSources,
  formatAudit,
  generalists,
  loadWorldFile,
  parseWorldConfig,
  parseWorldJson,
  toPartialMotiveVector,
  type AuditableOffer,
  type InteractionConfig,
  type MotiveAudit,
  type MotiveSource,
  type ObjectConfig,
  type ResourceConfig,
  type ResourceSnapshot,
  type RoomConfig,
  type WorldConfig,
} from './world';

export {
  formatSummary,
  formatTimeline,
  hoursOn,
  summariseRun,
  type CharacterSummary,
  type Comparison,
  type LabelUsage,
  type MotiveSourceRef,
  type RunSummary,
  type SourceShare,
  type TimelineOptions,
} from './summary';

export {
  DEFAULT_URGENCY_EXPONENT,
  integerPow,
  motiveUtility,
  normaliseMotive,
  satisfactionUtility,
} from './utility';
