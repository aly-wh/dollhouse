/**
 * The house: a `WorldAdapter` backed by rooms, objects and things that run out.
 *
 * This is the whole of #5's answer to `src/advertisement.ts`. The engine asks
 * two questions — what is on offer, and how far away is it — and this answers
 * them from a floor plan and a set of resource levels rather than from a frozen
 * list.
 *
 * The one design decision worth arguing with:
 *
 * **An unaffordable interaction is removed from the offer, not refused at the
 * point of use.** The fridge with nothing in it does not advertise; it is simply
 * not in the house this tick. That keeps every "no" in one place instead of
 * scattering availability checks through the scoring path, and it means the
 * engine's existing machinery for an occupied object — score the rest, take the
 * best of what is left — handles an empty one for free, with no new code and no
 * new failure mode.
 *
 * It costs one thing, and it is worth naming because it is visible when you
 * watch a run: a character walking to the kitchen for the last portion can
 * arrive to find it gone, because the offer was true when they set off. The
 * engine handles that as a blocked plan. Reserving the portion at the moment
 * they decided would remove the wasted walk, and with it the only moment in the
 * run where somebody is worse off for having been further away.
 *
 * **A House is stateful and belongs to one run.** It holds live resource levels,
 * so handing the same instance to two `runSimulation` calls starts the second
 * one with whatever the first ate. Build a new one per run. This is not
 * defensive advice — it was found by writing a test that reused one and could
 * not work out why the fridge was empty before anybody had opened it.
 */

import type {
  Advertiser,
  CharacterView,
  Interaction,
  WorldActionEnd,
  WorldActionStart,
  WorldAdapter,
} from '../advertisement';
import type { WorldDescription, WorldEventBody } from '../events';
import {
  parseWorldConfig,
  toPartialMotiveVector,
  type InteractionConfig,
  type ObjectConfig,
  type WorldConfig,
} from './config';
import { RoomGraph } from './rooms';
import { ResourcePool } from './resources';

interface Offer {
  readonly object: ObjectConfig;
  readonly config: InteractionConfig;
  readonly interaction: Interaction;
}

function toInteraction(config: InteractionConfig): Interaction {
  return {
    id: config.id,
    label: config.label,
    durationHours: config.durationHours,
    effects: toPartialMotiveVector(config.effects),
    decayMultipliers:
      config.decayMultipliers && config.decayMultipliers.length > 0
        ? toPartialMotiveVector(config.decayMultipliers)
        : undefined,
    capacity: config.capacity,
    interruptible: config.interruptible,
    minimumHours: config.minimumHours,
    tags: config.tags,
  };
}

export class House implements WorldAdapter {
  readonly config: WorldConfig;
  readonly rooms: RoomGraph;
  readonly resources: ResourcePool;

  /** Every interaction in the house, keyed `objectId#interactionId`. */
  private readonly offers: Map<string, Offer>;
  private readonly objectRooms: Map<string, string>;
  private readonly interactions: Map<string, readonly Offer[]>;

  private cachedAdvertisers: readonly Advertiser[] = [];
  private cachedAtVersion = -1;

  constructor(config: WorldConfig) {
    this.config = config;
    this.rooms = RoomGraph.from(config);
    this.resources = new ResourcePool(config.resources);

    this.offers = new Map();
    this.objectRooms = new Map();
    const byObject = new Map<string, Offer[]>();

    for (const object of config.objects) {
      this.objectRooms.set(object.id, object.room);
      const list: Offer[] = [];
      for (const interaction of object.interactions) {
        const offer: Offer = { object, config: interaction, interaction: toInteraction(interaction) };
        list.push(offer);
        this.offers.set(offerKey(object.id, interaction.id), offer);
      }
      byObject.set(object.id, list);
    }
    this.interactions = byObject;
  }

  /** Convenience for the CLI and for tests: parse a decoded document and build. */
  static fromConfig(value: unknown): House {
    return new House(parseWorldConfig(value));
  }

  // ---- WorldAdapter --------------------------------------------------------

  listAdvertisers(): readonly Advertiser[] {
    if (this.cachedAtVersion === this.resources.version) return this.cachedAdvertisers;

    const advertisers: Advertiser[] = [];
    for (const object of this.config.objects) {
      const available: Interaction[] = [];
      for (const offer of this.interactions.get(object.id) ?? []) {
        if (!this.resources.canAfford(offer.config.consumes)) continue;
        available.push(offer.interaction);
      }
      if (available.length === 0) continue;
      advertisers.push({
        id: object.id,
        kind: 'object',
        roomId: object.room,
        interactions: available,
      });
    }

    this.cachedAdvertisers = advertisers;
    this.cachedAtVersion = this.resources.version;
    return advertisers;
  }

  travelHours(character: CharacterView, advertiser: Advertiser): number {
    // Characters advertise conversation to each other, and the engine hands them
    // over with whatever room they are standing in. Walking to a person works
    // exactly like walking to a piano.
    return this.rooms.hoursBetween(character.roomId, advertiser.roomId);
  }

  advance(hours: number): void {
    this.resources.regenerate(hours);
  }

  onActionStarted(event: WorldActionStart): void {
    const offer = this.offers.get(offerKey(event.advertiserId, event.interactionId));
    // Conversations, walks, and anything else the engine invented are not this
    // world's business. Ignoring them is deliberate, not defensive.
    if (!offer) return;
    this.resources.spend(offer.config.consumes, event.characterId);
  }

  onActionEnded(event: WorldActionEnd): void {
    if (event.reason !== 'finished') return;
    const offer = this.offers.get(offerKey(event.advertiserId, event.interactionId));
    if (!offer) return;
    this.resources.gain(offer.config.produces, event.characterId);
  }

  drainEvents(): readonly WorldEventBody[] {
    return this.resources.drainEvents();
  }

  describe(): WorldDescription {
    return {
      worldId: this.config.id,
      name: this.config.name,
      entryRoom: this.config.entryRoom,
      rooms: this.config.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        // The doors as the graph sees them: symmetric and sorted, not as one
        // side of the file happened to write them down.
        exits: neighboursOf(this.rooms, room.id),
      })),
      objects: this.config.objects.map((object) => ({
        id: object.id,
        name: object.name,
        roomId: object.room,
        interactions: object.interactions.map((interaction) => ({
          id: interaction.id,
          label: interaction.label,
        })),
      })),
      resources: this.resources.snapshot().map((resource) => ({
        id: resource.id,
        label: resource.label,
        capacity: resource.capacity,
        value: resource.value,
      })),
    };
  }

  /**
   * Scoring the engine should use for this house, where the house has an opinion.
   *
   * Exactly one knob, and only because it is a statement about the building
   * rather than about the simulation: how much a character minds walking depends
   * entirely on how far apart things are, and that is the world's business. A
   * world that says nothing gets the engine's defaults.
   */
  scoringOverrides(): { readonly travelDiscountPerHour?: number } {
    const discount = this.config.travel.discountPerHour;
    return discount === undefined ? {} : { travelDiscountPerHour: discount };
  }

  // ---- for tests, audits and #10 ------------------------------------------

  roomOf(objectId: string): string | undefined {
    return this.objectRooms.get(objectId);
  }

  /** Every interaction the house declares, available or not. Sorted by key. */
  allOffers(): readonly { objectId: string; interaction: Interaction; config: InteractionConfig }[] {
    const rows: { objectId: string; interaction: Interaction; config: InteractionConfig }[] = [];
    for (const object of this.config.objects) {
      for (const offer of this.interactions.get(object.id) ?? []) {
        rows.push({ objectId: object.id, interaction: offer.interaction, config: offer.config });
      }
    }
    return rows;
  }
}

function offerKey(objectId: string, interactionId: string): string {
  return `${objectId}#${interactionId}`;
}

function neighboursOf(graph: RoomGraph, roomId: string): string[] {
  const exits: string[] = [];
  for (const other of graph.roomIds) {
    if (other !== roomId && graph.hopsBetween(roomId, other) === 1) exits.push(other);
  }
  exits.sort();
  return exits;
}
