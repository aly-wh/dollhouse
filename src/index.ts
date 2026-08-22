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
  type WorldAdapter,
} from './advertisement';

export {
  MINUTES_PER_DAY,
  formatClock,
  round2,
  roundMotives,
  type ActionEndReason,
  type ActionEndedEvent,
  type ActionStartedEvent,
  type ConversationStartedEvent,
  type MotiveCriticalEvent,
  type MotiveRelievedEvent,
  type RunFinishedEvent,
  type RunStartedEvent,
  type SimEvent,
  type SnapshotEvent,
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
  IDLE_LABEL,
  Simulation,
  runSimulation,
  type CharacterSpec,
  type CharacterState,
  type RunningAction,
  type SimulationConfig,
  type SimulationResult,
} from './simulation';

export {
  formatSummary,
  formatTimeline,
  hoursOn,
  summariseRun,
  type CharacterSummary,
  type LabelUsage,
  type RunSummary,
  type TimelineOptions,
} from './summary';

export {
  DEFAULT_URGENCY_EXPONENT,
  integerPow,
  motiveUtility,
  normaliseMotive,
  satisfactionUtility,
} from './utility';
