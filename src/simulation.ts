/**
 * The loop.
 *
 * Each tick, in a fixed order:
 *
 *   0. The world advances — tanks refill, deliveries arrive. Before anybody
 *      looks at what is on offer, so that within a tick the house is one house.
 *   1. Time passes — motives decay, whatever is running pays out its per-hour
 *      effects, and the clock on that action ticks down.
 *   2. Actions settle — anything that has run its course ends, and so does
 *      anything no longer worth finishing (this is how a rested character wakes
 *      up rather than lying in bed for the full seven hours). A walk that has
 *      run its course *arrives*, which moves the character and starts whatever
 *      they set off for, if it is still there.
 *   3. Threshold events fire for motives crossing into or out of crisis.
 *   4. Characters decide. Idle ones pick something; busy ones are re-examined
 *      only if a motive is in distress, because a character who re-decides every
 *      tick dithers in front of the fridge forever.
 *   5. A snapshot is emitted every N ticks.
 *
 * Characters are held in sorted-id order, which is what makes the run
 * reproducible: two of them can want the same bed, and "whoever the iteration
 * reached first" has to be a stable answer or a replay is fiction.
 *
 * The two phases where they actually *compete* — arriving somewhere, and
 * choosing — instead run in a seeded order that is reshuffled every tick. Stable
 * order is reproducible but it is not fair, and the difference is not academic.
 * Measured on this house over four seeds: the alphabetically first character
 * lost 7 races in four days and the last lost 137, and walked half again as far
 * to compensate. Whether you get the shower was decided by your name. The
 * shuffle is a pure function of seed, tick and character id — nothing to do with
 * draw order or with the order the cast was listed in — so it is exactly as
 * reproducible as sorting was, and it costs one hash per character per tick.
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
  type BlockedReason,
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
import { createRng, hashString, type Rng } from './rng';
import {
  DEFAULT_SCORING,
  applyJitter,
  resolveScoringConfig,
  scoreInteraction,
  type ScoringConfig,
} from './scoring';

export const IDLE_LABEL = 'idle';

/**
 * One label for every walk in the house, rather than "walk to the kitchen".
 *
 * The destination is in the `moved` event, where a reader can see where somebody
 * went. Putting it in the label instead would scatter a character's travel
 * across nine rows of the time-spent table and make "how much of the day goes on
 * walking" — which is a real and tunable property of a floor plan — unanswerable
 * at a glance.
 */
export const TRAVEL_LABEL = 'walk';

/**
 * What crossing the house costs you, per hour of walking.
 *
 * Small on purpose. A walk in the shipped house is a tick or two, so this is
 * worth a point or two — enough that a house laid out badly is quietly
 * expensive, not enough to make anybody a prisoner of the room they are in. The
 * real cost of distance is the *time*: a scheduled walk occupies whole ticks,
 * during which every motive decays and nothing is being satisfied.
 */
export const DEFAULT_TRAVEL_EFFECTS: PartialMotiveVector = { energy: -6, comfort: -6 };

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
  /** Per-hour cost of walking. Defaults to `DEFAULT_TRAVEL_EFFECTS`. */
  readonly travelEffects?: PartialMotiveVector;
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

/**
 * What a character is walking towards, and what they mean to do when they get
 * there.
 *
 * The plan is not a reservation. Nothing is held for a character in transit, so
 * arriving to find it taken or gone is an ordinary outcome rather than an error
 * — and it is the only moment in a run where being further away than somebody
 * else has a visible consequence.
 */
export interface TravelPlan {
  readonly advertiserId: string;
  readonly interactionId: string;
  readonly label: string;
  readonly roomId: string | undefined;
  /** How long the walk was scheduled for, in hours. Reported on arrival. */
  readonly hours: number;
  /** The score they set off for. Stale by arrival, and reported as what it is. */
  readonly score: number;
  readonly key: string;
}

export interface RunningAction {
  readonly advertiserId: string;
  readonly interaction: Interaction;
  readonly startedTick: number;
  readonly startedMinutes: number;
  readonly score: number;
  readonly partnerId: string | null;
  readonly conversationId: string | null;
  /** Non-null exactly when this is a walk. See `TravelPlan`. */
  readonly travel: TravelPlan | null;
  hoursRemaining: number;
}

export interface CharacterState {
  readonly id: string;
  readonly name: string;
  readonly traits: TraitVector;
  readonly weights: MotiveVector;
  readonly decayRates: MotiveVector;
  /** Where they are standing. Changes only on arrival, never mid-walk. */
  roomId: string | undefined;
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
  /** Where the advertiser is, so a walk knows where it ends. */
  readonly roomId: string | undefined;
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
  private readonly travelEffects: PartialMotiveVector;

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
    this.travelEffects = config.travelEffects ?? DEFAULT_TRAVEL_EFFECTS;

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

    // Occupancy is keyed on advertiser id plus interaction id. Two advertisers
    // sharing an id would share a slot and quietly halve the house's capacity —
    // a bug that shows up as characters mysteriously queueing, with nothing in
    // the log to say why. Worth catching at construction, since #5 will be
    // generating these.
    const advertiserIds = new Set<string>();
    for (const advertiser of this.world.listAdvertisers()) {
      if (advertiserIds.has(advertiser.id)) {
        throw new Error(`duplicate advertiser id: ${advertiser.id}`);
      }
      advertiserIds.add(advertiser.id);

      const interactionIds = new Set<string>();
      for (const interaction of advertiser.interactions) {
        if (interactionIds.has(interaction.id)) {
          throw new Error(
            `duplicate interaction id on ${advertiser.id}: ${interaction.id}`,
          );
        }
        interactionIds.add(interaction.id);
      }
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
        roomId: character.roomId ?? null,
      })),
    });

    // Right after the run opens, so a recorded log names its own house before
    // anything in it moves. A world that cannot describe itself simply does not,
    // and the log is exactly as readable as it was before #5.
    const described = this.world.describe?.();
    if (described) {
      this.events.push({ kind: 'world_described', ...this.timing(), world: described });
    }
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

  /**
   * Who gets first refusal this tick.
   *
   * Derived from the seed, the tick and the character's id, and from nothing
   * else — not from the order the cast was listed in, not from any random
   * stream, not from how many decisions anybody has made. So it survives adding
   * a character, it survives reordering the config, and the same seed produces
   * the same queue for the shower on day nineteen every time.
   *
   * Sorted by the hash with the id as tie-break, so a hash collision is a stable
   * outcome rather than a coin toss decided by the sort implementation.
   */
  private priorityOrder(): readonly CharacterState[] {
    const keyed = this.characters.map((character) => ({
      character,
      key: hashString(`${this.seed}::order::${this.tickIndex}::${character.id}`),
    }));
    keyed.sort((left, right) =>
      left.key !== right.key
        ? left.key - right.key
        : left.character.id < right.character.id
          ? -1
          : left.character.id > right.character.id
            ? 1
            : 0,
    );
    return keyed.map((entry) => entry.character);
  }

  step(): void {
    if (this.tickIndex >= this.totalTicks) return;

    this.tickIndex += 1;
    this.minutes += this.tickMinutes;

    this.world.advance?.(this.tickHours);
    this.drainWorldEvents();

    // Phases 1 and 3 are per-character and cannot interfere, so they keep the
    // sorted order and give the log a stable shape. Phases 2 and 4 are races.
    const contenders = this.priorityOrder();

    for (const character of this.characters) this.advanceTime(character);
    for (const character of contenders) this.settleAction(character);
    for (const character of this.characters) this.emitMotiveEdges(character);

    const occupancy = this.currentOccupancy();
    for (const character of contenders) this.decide(character, occupancy);

    // Once, after every character has moved and chosen. Everything the world
    // wanted to say this tick was caused by something already in the log above.
    this.drainWorldEvents();

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
      const plan = running.travel;
      this.endAction(character, 'finished');
      if (plan) this.arrive(character, plan);
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

    // A walk is the engine's own invention and no business of the world's.
    if (running.travel === null) {
      this.world.onActionEnded?.({
        characterId: character.id,
        advertiserId: running.advertiserId,
        interactionId: running.interaction.id,
        reason,
      });
    }

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
      // Somebody on their way to the shower is not in the shower. Counting them
      // would be a reservation, and the wasted walk is the point — see
      // `TravelPlan`.
      if (running && running.travel === null) {
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
        // You cannot start a conversation with somebody who is not there.
        //
        // Before #5 nothing had a position, so this was vacuously true and the
        // rule did not need writing down. With a floor plan it stops being
        // free, and leaving it out produced the worst behaviour in the first
        // house that ran: characters set off across the building towards
        // somebody who had wandered off by the time they arrived, sixty-nine
        // times in four days, and the resulting wasted walks were the single
        // largest use of anybody's day.
        //
        // The engine still knows nothing about rooms — this compares two opaque
        // ids and treats "neither has one" as together, which is exactly the
        // geometry-free world #4 shipped.
        if (partner.roomId !== character.roomId) continue;
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
        roomId: advertiser.roomId,
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
    // A journey is scheduled as the *nearest* whole number of ticks, and one that
    // rounds to zero happens inside the tick it was decided in.
    //
    // Rounding rather than flooring or ceiling, and it is worth saying why,
    // because both of the obvious rules were tried on this house and both broke
    // it in opposite directions.
    //
    // Always scheduling at least one tick charges a seven-minute walk next door
    // fifteen minutes. Every character then spent between a quarter and a third
    // of their entire life walking — more than sleep — the day went so far past
    // overcommitted that every motive sat under the distress threshold
    // permanently, and a permanently distressed character re-decides every
    // single tick and walks even more.
    //
    // Never scheduling anything under a tick is worse, and less obviously so.
    // Travel fell to under three per cent, the day stopped being overcommitted
    // at all, and the run went green and lifeless: five characters with an
    // eightfold spread in hygiene weighting all showered between 3.6 and 5.0 per
    // cent of the time. Nobody has to give anything up in a house where
    // everything is next door, and what a character gives up is the only thing
    // that shows you who they are.
    //
    // Rounding is unbiased over a run, so neither happens. Distance is charged
    // twice regardless: as the score discount, which is what stops anybody
    // crossing the house for a marginally better sandwich, and as whatever whole
    // ticks the journey actually rounds to.
    //
    // A conversation is the exception and is never walked to at all. The engine
    // only offers you somebody already in your room, so there is nothing to walk
    // to — and the alternative, setting off across the house towards a person,
    // was the single worst behaviour in the first house that ran: sixty-nine
    // journeys in four days that ended in front of somebody who had wandered off.
    const travelTicks =
      candidate.partnerId === null ? Math.round(candidate.travelHours / this.tickHours) : 0;
    if (travelTicks >= 1) {
      this.beginTravel(character, candidate, travelTicks * this.tickHours);
      return;
    }
    this.placeIn(character, candidate.roomId, candidate.travelHours);

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
      travel: null,
      hoursRemaining: interaction.durationHours,
    };
    bump(occupancy, candidate.key, 1);
    bump(character.startsByLabel, interaction.label, 1);
    this.emitActionStarted(character, character.current);
    // After the event, so the log reads cause then consequence: somebody starts
    // eating, and then there is one fewer portion.
    this.world.onActionStarted?.({
      characterId: character.id,
      advertiserId: candidate.advertiserId,
      interactionId: interaction.id,
    });

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
        travel: null,
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

  // ---- movement ------------------------------------------------------------

  private beginTravel(character: CharacterState, candidate: Candidate, hours: number): void {
    const interaction: Interaction = {
      // Unique per destination so two walks are never confused, and distinct
      // from any real interaction id so a world asked about it finds nothing.
      id: `walk:${candidate.key}`,
      label: TRAVEL_LABEL,
      durationHours: hours,
      effects: this.travelEffects,
      // You do not stop halfway down the stairs to reconsider, and you do not
      // arrive early because you stopped being tired on the way.
      interruptible: false,
      minimumHours: hours,
      tags: ['travel'],
    };

    character.current = {
      advertiserId: candidate.advertiserId,
      interaction,
      startedTick: this.tickIndex,
      startedMinutes: this.minutes,
      score: candidate.score,
      partnerId: null,
      conversationId: null,
      travel: {
        advertiserId: candidate.advertiserId,
        interactionId: candidate.interaction.id,
        label: candidate.interaction.label,
        roomId: candidate.roomId,
        hours,
        score: candidate.score,
        key: candidate.key,
      },
      hoursRemaining: hours,
    };

    bump(character.startsByLabel, TRAVEL_LABEL, 1);
    this.emitActionStarted(character, character.current);
  }

  /**
   * A walk has finished. Move the character, then start what they came for — if
   * it is still there and still free.
   *
   * Both of those can have changed while they were walking, which is the whole
   * reason travel is time rather than only a discount.
   */
  private arrive(character: CharacterState, plan: TravelPlan): void {
    this.placeIn(character, plan.roomId, plan.hours);

    const offer = this.findOffer(plan.advertiserId, plan.interactionId);
    if (!offer) {
      this.emitBlocked(character, plan, 'unavailable');
      return;
    }

    const occupancy = this.currentOccupancy();
    if ((occupancy.get(plan.key) ?? 0) >= interactionCapacity(offer.interaction)) {
      this.emitBlocked(character, plan, 'occupied');
      return;
    }

    const candidate: Candidate = {
      key: plan.key,
      advertiserId: plan.advertiserId,
      interaction: offer.interaction,
      partnerId: null,
      roomId: offer.roomId,
      travelHours: 0,
      score: plan.score,
    };

    // Deliberately not re-scored on arrival. It looks like it ought to be —
    // "is this still worth doing?" — but it can only ever answer yes: nothing
    // satisfies a motive while somebody is walking, so every motive is lower
    // than it was when they set off, the satisfaction curve is concave, and the
    // travel discount has gone. The score can only have risen. A check that
    // cannot fail is worse than no check, because it reads as protection.
    this.commit(character, candidate, occupancy);
  }

  private placeIn(character: CharacterState, roomId: string | undefined, hours: number): void {
    if (roomId === undefined || roomId === character.roomId) return;
    const from = character.roomId ?? null;
    character.roomId = roomId;
    this.events.push({
      kind: 'moved',
      ...this.timing(),
      characterId: character.id,
      fromRoomId: from,
      toRoomId: roomId,
      hours: round2(hours),
    });
  }

  private emitBlocked(
    character: CharacterState,
    plan: TravelPlan,
    reason: BlockedReason,
  ): void {
    this.events.push({
      kind: 'plan_blocked',
      ...this.timing(),
      characterId: character.id,
      advertiserId: plan.advertiserId,
      interactionId: plan.interactionId,
      label: plan.label,
      reason,
    });
  }

  /**
   * The interaction as the world offers it *now*, or null if it has gone.
   *
   * "Gone" is the ordinary case, not an error: the world stops advertising
   * anything it can no longer pay for, so an empty fridge is simply not in the
   * list any more.
   */
  private findOffer(
    advertiserId: string,
    interactionId: string,
  ): { interaction: Interaction; roomId: string | undefined } | null {
    for (const advertiser of this.world.listAdvertisers()) {
      if (advertiser.id !== advertiserId) continue;
      for (const interaction of advertiser.interactions) {
        if (interaction.id === interactionId) return { interaction, roomId: advertiser.roomId };
      }
      return null;
    }
    return null;
  }

  private drainWorldEvents(): void {
    const drained = this.world.drainEvents?.();
    if (!drained) return;
    for (const body of drained) this.events.push({ ...body, ...this.timing() });
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
        roomId: character.roomId ?? null,
        motives: roundMotives(character.motives),
      })),
    });
  }
}

export function runSimulation(config: SimulationConfig): SimulationResult {
  return new Simulation(config).run();
}

export { DEFAULT_SCORING };
