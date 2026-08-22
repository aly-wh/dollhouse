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

/**
 * How the engine asks the world what is on offer.
 *
 * Deliberately two methods and no more. #5 can back this with real rooms and
 * pathfinding without the engine learning a thing about either.
 */
export interface WorldAdapter {
  listAdvertisers(): readonly Advertiser[];
  /**
   * Hours it would cost this character to reach this advertiser. Attenuates the
   * score, which is what stops a character crossing the house for a marginally
   * better sandwich. Return 0 if the world has no geometry yet.
   */
  travelHours(character: CharacterView, advertiser: Advertiser): number;
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
