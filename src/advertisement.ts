/**
 * Advertisement — the socket the world plugs into.
 *
 * In the Sims model, objects do not tell characters what to do. They *advertise*
 * what they would do for you, and every character values that offer differently.
 * A fridge advertises hunger; a shower advertises hygiene; a television
 * advertises fun and quietly costs energy.
 *
 * The house itself — rooms, placement, which objects exist — is #5. This file is
 * the contract #5 implements, and nothing here knows what a room is beyond an
 * opaque `roomId` and a travel cost.
 */

import type { ActionEndReason, WorldDescription, WorldEventBody } from './events';
import type { PartialMotiveVector } from './motives';

export interface Interaction {
  /** Stable and unique within its advertiser. Sorted on, so it affects tie-breaks. */
  readonly id: string;
  /** Human-readable, and the key the run summary groups by: "cook a meal". */
  readonly label: string;
  readonly durationHours: number;
  /**
   * Motive change per simulated *hour* while this runs.
   *
   * Per-hour rather than per-completion so that the value of a half-finished
   * action is well defined — which is what makes interruption and early
   * abandonment work without a second set of numbers to keep in sync.
   */
  readonly effects: PartialMotiveVector;
  /**
   * Multiplies natural decay while this runs. 1 is normal, 0 suspends it.
   * Sleep uses this: you do not get hungry in your sleep at the rate you do
   * awake, and without it every character wakes up starving every morning.
   */
  readonly decayMultipliers?: PartialMotiveVector;
  /** How many characters can be doing this at once. Default 1. */
  readonly capacity?: number;
  /** May a more urgent motive pull a character off this? Default true. */
  readonly interruptible?: boolean;
  /**
   * Once begun, this runs at least this long before it can be abandoned as no
   * longer worth finishing. Default 0.
   *
   * This is what gives a night its shape. Sleep tops energy up faster than it
   * drains, so within an hour or two finishing it is worth almost nothing and a
   * character bounces straight out of bed — which produces five one-hour naps a
   * day and a house that never settles. A minimum commitment says: you do not
   * get up because you are rested enough.
   *
   * It does not block *interruption*. A motive in distress still overrides, so a
   * starving character gets out of bed; they just do not get out of bed for a
   * marginally better idea.
   */
  readonly minimumHours?: number;
  /** Ignored by the engine. Carried through for #7's log and #10's renderer. */
  readonly tags?: readonly string[];
}

export interface Advertiser {
  readonly id: string;
  /** Characters advertise too — that is how the social motive gets satisfied. */
  readonly kind: 'object' | 'character';
  readonly roomId?: string;
  readonly interactions: readonly Interaction[];
}

export interface CharacterView {
  readonly id: string;
  readonly roomId?: string;
}

export interface WorldActionStart {
  readonly characterId: string;
  readonly advertiserId: string;
  readonly interactionId: string;
}

export interface WorldActionEnd extends WorldActionStart {
  readonly reason: ActionEndReason;
}

/**
 * How the engine asks the world what is on offer.
 *
 * The two required methods are #4's, unchanged. Everything below them is
 * optional and defaulted-off, so `staticWorld` and every adapter written before
 * #5 still satisfies this interface and behaves exactly as it did.
 *
 * The optional half exists because a world with *resources* cannot be a pure
 * function of nothing. Food that runs out has to be told that somebody ate; a
 * tank that refills has to be told that time passed. #4 wrote the socket
 * assuming the world was a static list, which is the right assumption to start
 * from and the wrong one to keep: the whole of "a world with infinite everything
 * produces no drama" lives in these four methods.
 *
 * The engine calls them and knows nothing else. It never learns what a room is,
 * what a resource is, or why the fridge stopped advertising — only that the list
 * it was handed this tick is shorter than the one it was handed last tick.
 */
export interface WorldAdapter {
  listAdvertisers(): readonly Advertiser[];
  /**
   * Hours it would cost this character to reach this advertiser. Attenuates the
   * score, which is what stops a character crossing the house for a marginally
   * better sandwich. Return 0 if the world has no geometry yet.
   *
   * Since #5 this is charged twice over, deliberately: once as a discount on the
   * score, and once as real simulated time, because the engine turns a non-zero
   * answer into an actual walk that occupies actual ticks. The discount is the
   * preference — "not worth crossing the house for" — and the time is the price.
   */
  travelHours(character: CharacterView, advertiser: Advertiser): number;

  /** Simulated hours have passed. Where tanks refill and stock replenishes. */
  advance?(hours: number): void;

  /**
   * A character has begun something. Resources are spent here, in full, at the
   * start — you take the food out of the fridge before you eat it, and being
   * interrupted halfway through does not put it back.
   */
  onActionStarted?(event: WorldActionStart): void;

  /**
   * A character has stopped. `reason` matters: only `finished` should pay out
   * whatever the interaction produces. Walking away from a half-cooked meal
   * makes nothing, which is the difference between a chore and a formality.
   */
  onActionEnded?(event: WorldActionEnd): void;

  /**
   * Anything the world wants in the run log since it was last asked.
   *
   * Pull rather than push, and untimed: the world is never handed a clock, an
   * emitter, or a reference to the simulation, so there is no route by which it
   * could observe anything but the hours it is told about. The engine stamps the
   * timing on as it drains.
   */
  drainEvents?(): readonly WorldEventBody[];

  /** The house, for the log. Emitted once, so a recorded run can be read alone. */
  describe?(): WorldDescription;
}

/** A world with no geometry: everything is reachable, instantly. Fine until #5. */
export function staticWorld(advertisers: readonly Advertiser[]): WorldAdapter {
  const frozen = [...advertisers];
  return {
    listAdvertisers: () => frozen,
    travelHours: () => 0,
  };
}

export function toWorldAdapter(world: WorldAdapter | readonly Advertiser[]): WorldAdapter {
  return Array.isArray(world) ? staticWorld(world) : (world as WorldAdapter);
}

export function interactionCapacity(interaction: Interaction): number {
  return interaction.capacity ?? 1;
}

export function isInterruptible(interaction: Interaction): boolean {
  return interaction.interruptible ?? true;
}

/**
 * What the interaction advertises for one motive, over some number of hours.
 *
 * The advertised value is derived from the per-hour effect rather than declared
 * separately. One source of truth: an object cannot promise more than it pays
 * out, because the promise *is* the payout. (Objects that lie — a broken
 * television still advertising fun — would need a second field, and are not
 * something this issue needs.)
 */
export function advertisedGain(
  interaction: Interaction,
  motive: keyof PartialMotiveVector,
  hours: number = interaction.durationHours,
): number {
  return (interaction.effects[motive] ?? 0) * hours;
}
