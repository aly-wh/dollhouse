/**
 * The loop.
 *
 * Each tick, in a fixed order:
 *
 *   1. Time passes — motives decay, whatever is running pays out its per-hour
 *      effects, and the clock on that action ticks down.
 *   2. Actions settle — anything that has run its course ends, and so does
 *      anything no longer worth finishing (this is how a rested character wakes
 *      up rather than lying in bed for the full seven hours).
 *   3. Threshold events fire for motives crossing into or out of crisis.
 *   4. Characters decide. Idle ones pick something; busy ones are re-examined
 *      only if a motive is in distress, because a character who re-decides every
 *      tick dithers in front of the fridge forever.
 *   5. A snapshot is emitted every N ticks.
 *
 * Characters are processed in sorted-id order in every phase. Not for tidiness:
 * two characters can want the same bed, and "whoever the iteration reached
 * first" has to be a stable answer or the run is not reproducible.
 *
 * There are no model calls here and there is no place to put one. Everything
 * below is arithmetic over six numbers per character, which is the entire cost
 * argument for the product.
 */

import {
  interactionCapacity,
  isInterruptible,
  toWorldAdapter,
  type Advertiser,
  type Interaction,
  type WorldAdapter,
} from './advertisement';
import {
  formatClock,
  round2,
  roundMotives,
  type ActionEndReason,
  type EventTiming,
  type SimEvent,
} from './events';
import {
  DEFAULT_DECAY_PER_HOUR,
  MOTIVE_IDS,
  clampMotive,
  mapMotives,
  mergeMotives,
  motiveVector,
  type MotiveId,
  type MotiveVector,
  type PartialMotiveVector,
} from './motives';
import { resolveMotiveWeights, traitVector, type TraitVector } from './personality';
import { createRng, type Rng } from './rng';
import {
  DEFAULT_SCORING,
  applyJitter,
  resolveScoringConfig,
  scoreInteraction,
  type ScoringConfig,
} from './scoring';

export const IDLE_LABEL = 'idle';

/** Hours below which a countdown counts as done, absorbing float drift. */
const HOURS_EPSILON = 1e-9;

/** How far a motive must climb back before "critical" is retracted. Stops flapping. */
const CRITICAL_HYSTERESIS = 10;

/**
 * The default way for characters to satisfy `social`: each other.
 *
 * Characters advertise this to one another exactly as a sofa advertises comfort,
 * so nothing in the scoring path is special-cased for it. Set
 * `socialInteraction: null` to switch it off — the engine then runs happily with
 * `social` as a motive nothing can satisfy, which is a legitimate world, just a
 * bleak one.
 *
 * What is said is #8's problem. This produces the occasion, not the words.
 */
export const DEFAULT_SOCIAL_INTERACTION: Interaction = {
  id: 'talk',
  label: 'talk together',
  durationHours: 0.75,
  effects: { social: 52, fun: 12, energy: -3 },
  capacity: 1,
  tags: ['social', 'conversation'],
};

export interface CharacterSpec {
  readonly id: string;
  readonly name?: string;
  readonly traits?: Partial<TraitVector>;
  /** Starting motives. Anything omitted starts at +50. */
  readonly motives?: PartialMotiveVector;
  /** Per-character decay overrides. Defaults to `DEFAULT_DECAY_PER_HOUR`. */
  readonly decayRates?: PartialMotiveVector;
  /** Escape hatch that bypasses the trait mapping. Traits are the intended dial. */
  readonly motiveWeights?: PartialMotiveVector;
  readonly roomId?: string;
}

export interface SimulationConfig {
  readonly seed: string;
  readonly world: WorldAdapter | readonly Advertiser[];
  readonly characters: readonly CharacterSpec[];
  /** Simulated days to run. Ignored if `ticks` is given. */
  readonly days?: number;
  readonly ticks?: number;
  readonly tickMinutes?: number;
  /** Wall-clock minute the run opens on. Default 480, i.e. 08:00. */
  readonly startMinutes?: number;
  readonly scoring?: Partial<ScoringConfig>;
  /** A motive at or below this counts as distress, and may interrupt an action. */
  readonly distressThreshold?: number;
  /** A rival must beat the current action by this factor to interrupt it. */
  readonly interruptMargin?: number;
  /** Crossing this fires `motive_critical`. */
  readonly criticalThreshold?: number;
  /**
   * The do-nothing floor: an action must be worth at least this before a
   * character will bother. Keep it above `abandonScore` — see below.
   */
  readonly minimumScore?: number;
  /** Continuation score at or below which an action is abandoned as pointless. */
  readonly abandonScore?: number;
  /** 0 disables snapshots. Default 4 (hourly at the default tick length). */
  readonly snapshotEveryTicks?: number;
  readonly socialInteraction?: Interaction | null;
}

interface ResolvedOptions {
  readonly startMinutes: number;
  readonly distressThreshold: number;
  readonly interruptMargin: number;
  readonly criticalThreshold: number;
  readonly minimumScore: number;
  readonly abandonScore: number;
  readonly snapshotEveryTicks: number;
}

export interface RunningAction {
  readonly advertiserId: string;
  readonly interaction: Interaction;
  readonly startedTick: number;
  readonly startedMinutes: number;
  readonly score: number;
  readonly partnerId: string | null;
  readonly conversationId: string | null;
  hoursRemaining: number;
}

export interface CharacterState {
  readonly id: string;
  readonly name: string;
  readonly traits: TraitVector;
  readonly weights: MotiveVector;
  readonly decayRates: MotiveVector;
  readonly roomId: string | undefined;
  readonly rng: Rng;
  motives: MotiveVector;
  current: RunningAction | null;
  /** Simulated hours spent per action label, `idle` included. */
  readonly hoursByLabel: Map<string, number>;
  /** How many times each action was begun. */
  readonly startsByLabel: Map<string, number>;
  /** Motives currently flagged critical, for edge-triggered events. */
  readonly critical: Set<MotiveId>;
  /**
   * Sum of each motive weighted by hours, for a time-averaged level.
   *
   * The average is the honest measure of what personality weights do. The
   * *endpoint* of a run is one sample of a value that oscillates all day, so two
   * characters can look wildly different at the final tick purely by where in
   * their cycle the clock stopped. What a low hygiene weight actually buys you
   * is a lower hygiene level all week, and that is what this measures.
   */
  motiveHourSums: MotiveVector;
  accumulatedHours: number;
}

export interface SimulationResult {
  readonly seed: string;
  readonly ticks: number;
  readonly tickMinutes: number;
  readonly simulatedDays: number;
  readonly events: readonly SimEvent[];
  readonly characters: readonly CharacterState[];
}

interface Candidate {
  readonly key: string;
  readonly advertiserId: string;
  readonly interaction: Interaction;
  readonly partnerId: string | null;
  readonly travelHours: number;
  readonly score: number;
}

function occupancyKey(advertiserId: string, interactionId: string): string {
  return `${advertiserId}#${interactionId}`;
}

function bump(counter: Map<string, number>, key: string, by: number): void {
  counter.set(key, (counter.get(key) ?? 0) + by);
}

export class Simulation {
  readonly seed: string;
  readonly tickMinutes: number;
  readonly tickHours: number;
  readonly totalTicks: number;
  readonly characters: readonly CharacterState[];
  readonly events: SimEvent[] = [];
  readonly scoring: ScoringConfig;

  private readonly world: WorldAdapter;
  private readonly byId: Map<string, CharacterState>;
  private readonly options: ResolvedOptions;
  private readonly socialInteraction: Interaction | null;

  private tickIndex = 0;
  private minutes: number;
  private finished = false;

  constructor(config: SimulationConfig) {
    if (config.characters.length === 0) {
      throw new Error('a simulation needs at least one character');
    }

    this.seed = config.seed;
    this.tickMinutes = config.tickMinutes ?? 15;
    if (this.tickMinutes <= 0) throw new RangeError('tickMinutes must be positive');
    this.tickHours = this.tickMinutes / 60;

    const days = config.days ?? 1;
    this.totalTicks = config.ticks ?? Math.round((days * 1440) / this.tickMinutes);

    this.world = toWorldAdapter(config.world);
    this.scoring = resolveScoringConfig(config.scoring);
    this.socialInteraction =
      config.socialInteraction === undefined
        ? DEFAULT_SOCIAL_INTERACTION
        : config.socialInteraction;

    this.options = {
      startMinutes: config.startMinutes ?? 8 * 60,
      distressThreshold: config.distressThreshold ?? -50,
      interruptMargin: config.interruptMargin ?? 1.35,
      criticalThreshold: config.criticalThreshold ?? -80,
      // The gap between these two is deliberate hysteresis. A character stops
      // an action once it is worth less than `abandonScore`, but will not start
      // anything again until something clears the higher `minimumScore`. Set
      // them equal and characters oscillate on the boundary, starting and
      // abandoning the same action every tick.
      minimumScore: config.minimumScore ?? 0.03,
      abandonScore: config.abandonScore ?? 0.004,
      snapshotEveryTicks: config.snapshotEveryTicks ?? 4,
    };
    this.minutes = this.options.startMinutes;

    const ids = new Set<string>();
    for (const spec of config.characters) {
      if (ids.has(spec.id)) throw new Error(`duplicate character id: ${spec.id}`);
      ids.add(spec.id);
    }

    // Sorted once, here. Every later phase relies on this order being stable.
    this.characters = [...config.characters]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((spec) => this.createCharacter(spec));

    this.byId = new Map(this.characters.map((character) => [character.id, character]));

    this.events.push({
      kind: 'run_started',
      ...this.timing(),
      seed: this.seed,
      tickMinutes: this.tickMinutes,
      totalTicks: this.totalTicks,
      characters: this.characters.map((character) => ({
        id: character.id,
        name: character.name,
        traits: character.traits,
        weights: roundMotives(character.weights),
        motives: roundMotives(character.motives),
      })),
    });
  }

  private createCharacter(spec: CharacterSpec): CharacterState {
    const traits = traitVector(spec.traits);
    return {
      id: spec.id,
      name: spec.name ?? spec.id,
      traits,
      weights: resolveMotiveWeights(traits, spec.motiveWeights),
      decayRates: mergeMotives(DEFAULT_DECAY_PER_HOUR, spec.decayRates),
      roomId: spec.roomId,
      // Derived from the seed and the character's id, never from draw order, so
      // adding a character to the house cannot change what the others do.
      rng: createRng(`${this.seed}::character::${spec.id}`),
      motives: mapMotives(motiveVector(50, spec.motives), clampMotive),
      current: null,
      hoursByLabel: new Map(),
      startsByLabel: new Map(),
      critical: new Set(),
      motiveHourSums: motiveVector(0),
      accumulatedHours: 0,
    };
  }

  private timing(): EventTiming {
    return { tick: this.tickIndex, minutes: this.minutes, clock: formatClock(this.minutes) };
  }

  step(): void {
    if (this.tickIndex >= this.totalTicks) return;

    this.tickIndex += 1;
    this.minutes += this.tickMinutes;

    for (const character of this.characters) this.advanceTime(character);
    for (const character of this.characters) this.settleAction(character);
    for (const character of this.characters) this.emitMotiveEdges(character);

    const occupancy = this.currentOccupancy();
    for (const character of this.characters) this.decide(character, occupancy);

    if (
      this.options.snapshotEveryTicks > 0 &&
      this.tickIndex % this.options.snapshotEveryTicks === 0
    ) {
      this.emitSnapshot();
    }
  }

  run(): SimulationResult {
    while (this.tickIndex < this.totalTicks) this.step();

    if (!this.finished) {
      this.finished = true;
      this.events.push({
        kind: 'run_finished',
        ...this.timing(),
        ticks: this.tickIndex,
        simulatedDays: round2((this.tickIndex * this.tickMinutes) / 1440),
      });
    }

    return {
      seed: this.seed,
      ticks: this.tickIndex,
      tickMinutes: this.tickMinutes,
      simulatedDays: round2((this.tickIndex * this.tickMinutes) / 1440),
      events: this.events,
      characters: this.characters,
    };
  }

  // ---- phase 1 -------------------------------------------------------------

  private advanceTime(character: CharacterState): void {
    const running = character.current;
    const effects = running?.interaction.effects;
    const decayMultipliers = running?.interaction.decayMultipliers;
    const hours = this.tickHours;

    character.motives = mapMotives(character.motives, (value, motive) => {
      const decay = character.decayRates[motive] * (decayMultipliers?.[motive] ?? 1);
      const gain = effects?.[motive] ?? 0;
      return clampMotive(value + (gain - decay) * hours);
    });

    const motives = character.motives;
    character.motiveHourSums = mapMotives(
      character.motiveHourSums,
      (total, motive) => total + motives[motive] * hours,
    );
    character.accumulatedHours += hours;

    bump(character.hoursByLabel, running ? running.interaction.label : IDLE_LABEL, hours);
    if (running) running.hoursRemaining -= hours;
  }

  // ---- phase 2 -------------------------------------------------------------

  private settleAction(character: CharacterState): void {
    const running = character.current;
    if (!running) return;

    if (running.hoursRemaining <= HOURS_EPSILON) {
      this.endAction(character, 'finished');
      return;
    }

    // An action whose remaining hours are worth nothing is over, whatever the
    // clock says. Without this, a character sleeps a full seven hours from an
    // energy of +90 and the house looks comatose.
    //
    // Unless it has not yet run its minimum commitment — see `minimumHours`.
    const elapsed = running.interaction.durationHours - running.hoursRemaining;
    if (elapsed + HOURS_EPSILON < (running.interaction.minimumHours ?? 0)) return;

    if (isInterruptible(running.interaction)) {
      if (this.continuationScore(character, running) <= this.options.abandonScore) {
        this.endAction(character, 'satisfied');
      }
    }
  }

  private continuationScore(character: CharacterState, running: RunningAction): number {
    return scoreInteraction({
      motives: character.motives,
      weights: character.weights,
      interaction: running.interaction,
      config: this.scoring,
      // No travel term: the character is already there. Which is precisely why
      // finishing something usually beats restarting it somewhere else.
      travelHours: 0,
      hours: Math.max(running.hoursRemaining, 0),
    }).score;
  }

  private endAction(character: CharacterState, reason: ActionEndReason): void {
    const running = character.current;
    if (!running) return;

    // Cleared before the cascade, so a conversation ending cannot recurse.
    character.current = null;

    this.events.push({
      kind: 'action_ended',
      ...this.timing(),
      characterId: character.id,
      advertiserId: running.advertiserId,
      interactionId: running.interaction.id,
      label: running.interaction.label,
      reason,
      hoursSpent: round2((this.minutes - running.startedMinutes) / 60),
      motives: roundMotives(character.motives),
    });

    if (running.partnerId !== null) {
      const partner = this.byId.get(running.partnerId);
      if (partner?.current && partner.current.conversationId === running.conversationId) {
        this.endAction(partner, 'partner_left');
      }
    }
  }

  // ---- phase 3 -------------------------------------------------------------

  private emitMotiveEdges(character: CharacterState): void {
    for (const motive of MOTIVE_IDS) {
      const value = character.motives[motive];
      const flagged = character.critical.has(motive);

      if (!flagged && value <= this.options.criticalThreshold) {
        character.critical.add(motive);
        this.events.push({
          kind: 'motive_critical',
          ...this.timing(),
          characterId: character.id,
          motive,
          value: round2(value),
        });
      } else if (flagged && value > this.options.criticalThreshold + CRITICAL_HYSTERESIS) {
        character.critical.delete(motive);
        this.events.push({
          kind: 'motive_relieved',
          ...this.timing(),
          characterId: character.id,
          motive,
          value: round2(value),
        });
      }
    }
  }

  // ---- phase 4 -------------------------------------------------------------

  private currentOccupancy(): Map<string, number> {
    const occupancy = new Map<string, number>();
    for (const character of this.characters) {
      const running = character.current;
      if (running) {
        bump(occupancy, occupancyKey(running.advertiserId, running.interaction.id), 1);
      }
    }
    return occupancy;
  }

  private isDistressed(character: CharacterState): boolean {
    for (const motive of MOTIVE_IDS) {
      if (character.motives[motive] <= this.options.distressThreshold) return true;
    }
    return false;
  }

  private decide(character: CharacterState, occupancy: Map<string, number>): void {
    const running = character.current;

    if (running) {
      if (!isInterruptible(running.interaction)) return;
      // Busy characters only reconsider under duress. Re-scoring every tick
      // produces a character who abandons dinner for the television and then
      // abandons the television for dinner, forever.
      if (!this.isDistressed(character)) return;

      const currentKey = occupancyKey(running.advertiserId, running.interaction.id);
      const best = this.bestCandidate(character, occupancy, currentKey);
      if (!best) return;
      if (best.score <= this.continuationScore(character, running) * this.options.interruptMargin) {
        return;
      }

      bump(occupancy, currentKey, -1);
      this.endAction(character, 'interrupted');
      this.commit(character, best, occupancy);
      return;
    }

    const best = this.bestCandidate(character, occupancy, null);
    // Doing nothing scores exactly zero and is always available. A character
    // only acts when something beats it, which is how "nothing worth doing"
    // stays representable instead of forcing a choice.
    if (!best || best.score <= 0) return;
    this.commit(character, best, occupancy);
  }

  private bestCandidate(
    character: CharacterState,
    occupancy: Map<string, number>,
    excludeKey: string | null,
  ): Candidate | null {
    let best: Candidate | null = null;

    for (const candidate of this.candidatesFor(character, occupancy, excludeKey)) {
      const breakdown = scoreInteraction({
        motives: character.motives,
        weights: character.weights,
        interaction: candidate.interaction,
        config: this.scoring,
        travelHours: candidate.travelHours,
      });
      // The gate is applied to the deterministic score, before any dice are
      // rolled. Anything not worth doing is not worth rolling for.
      if (breakdown.score < this.options.minimumScore) continue;

      // Drawn for every surviving candidate, in canonical key order, so the
      // stream advances identically on every replay.
      const score = applyJitter(breakdown.score, this.scoring, character.rng.next());
      // Strict `>` keeps the first candidate in key order on an exact tie.
      if (best === null || score > best.score) {
        best = { ...candidate, score };
      }
    }

    return best;
  }

  private candidatesFor(
    character: CharacterState,
    occupancy: Map<string, number>,
    excludeKey: string | null,
  ): Candidate[] {
    const candidates: Candidate[] = [];
    const view = { id: character.id, roomId: character.roomId };

    for (const advertiser of this.world.listAdvertisers()) {
      this.collect(candidates, advertiser, null, view, occupancy, excludeKey);
    }

    const social = this.socialInteraction;
    if (social) {
      for (const partner of this.characters) {
        if (partner.id === character.id) continue;
        // Only characters with nothing on are available. Someone mid-shower is
        // not a conversational opportunity.
        if (partner.current !== null) continue;
        // And they get a say: a partner for whom talking scores negative — worn
        // out, filthy, starving — is not offered up.
        if (!this.partnerWilling(partner, social)) continue;

        const advertiser: Advertiser = {
          id: partner.id,
          kind: 'character',
          roomId: partner.roomId,
          interactions: [social],
        };
        this.collect(candidates, advertiser, partner.id, view, occupancy, excludeKey);
      }
    }

    candidates.sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    );
    return candidates;
  }

  private collect(
    into: Candidate[],
    advertiser: Advertiser,
    partnerId: string | null,
    view: { id: string; roomId: string | undefined },
    occupancy: Map<string, number>,
    excludeKey: string | null,
  ): void {
    for (const interaction of advertiser.interactions) {
      const key = occupancyKey(advertiser.id, interaction.id);
      if (key === excludeKey) continue;
      if ((occupancy.get(key) ?? 0) >= interactionCapacity(interaction)) continue;

      into.push({
        key,
        advertiserId: advertiser.id,
        interaction,
        partnerId,
        travelHours: this.world.travelHours(view, advertiser),
        score: 0,
      });
    }
  }

  private partnerWilling(partner: CharacterState, social: Interaction): boolean {
    // The partner is held to exactly the bar they would hold themselves to. A
    // lower bar here produces a miserable loop: A offers, B accepts, B abandons
    // it on the next tick because it was never worth their while, A offers
    // again. Two characters can spend an entire evening starting the same
    // conversation every fifteen minutes.
    //
    // No jitter and no RNG draw: asking whether someone is up for a chat must
    // not disturb their random stream, or A's decisions would silently change
    // B's future.
    return (
      scoreInteraction({
        motives: partner.motives,
        weights: partner.weights,
        interaction: social,
        config: this.scoring,
        travelHours: 0,
      }).score >= this.options.minimumScore
    );
  }

  private commit(
    character: CharacterState,
    candidate: Candidate,
    occupancy: Map<string, number>,
  ): void {
    const { interaction } = candidate;
    const partner =
      candidate.partnerId !== null ? (this.byId.get(candidate.partnerId) ?? null) : null;
    const conversationId =
      partner !== null ? `conv-${this.tickIndex}-${character.id}-${partner.id}` : null;

    character.current = {
      advertiserId: candidate.advertiserId,
      interaction,
      startedTick: this.tickIndex,
      startedMinutes: this.minutes,
      score: candidate.score,
      partnerId: partner?.id ?? null,
      conversationId,
      hoursRemaining: interaction.durationHours,
    };
    bump(occupancy, candidate.key, 1);
    bump(character.startsByLabel, interaction.label, 1);
    this.emitActionStarted(character, character.current);

    if (partner && conversationId) {
      // A separate object: `hoursRemaining` is mutable and the two sides must
      // not share one countdown.
      partner.current = {
        advertiserId: character.id,
        interaction,
        startedTick: this.tickIndex,
        startedMinutes: this.minutes,
        score: candidate.score,
        partnerId: character.id,
        conversationId,
        hoursRemaining: interaction.durationHours,
      };
      bump(partner.startsByLabel, interaction.label, 1);

      this.events.push({
        kind: 'conversation_started',
        ...this.timing(),
        conversationId,
        initiatorId: character.id,
        partnerId: partner.id,
        durationHours: interaction.durationHours,
      });
      this.emitActionStarted(partner, partner.current);
    }
  }

  private emitActionStarted(character: CharacterState, action: RunningAction): void {
    this.events.push({
      kind: 'action_started',
      ...this.timing(),
      characterId: character.id,
      advertiserId: action.advertiserId,
      interactionId: action.interaction.id,
      label: action.interaction.label,
      durationHours: action.interaction.durationHours,
      score: round2(action.score),
      partnerId: action.partnerId,
      conversationId: action.conversationId,
    });
  }

  // ---- phase 5 -------------------------------------------------------------

  private emitSnapshot(): void {
    this.events.push({
      kind: 'snapshot',
      ...this.timing(),
      characters: this.characters.map((character) => ({
        id: character.id,
        action: character.current ? character.current.interaction.label : null,
        motives: roundMotives(character.motives),
      })),
    });
  }
}

export function runSimulation(config: SimulationConfig): SimulationResult {
  return new Simulation(config).run();
}

export { DEFAULT_SCORING };
