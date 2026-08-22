/**
 * The floor plan, and what crossing it costs.
 *
 * Distance is doorways, not metres. A house has nine rooms and there is nothing
 * a coordinate system would buy that a hop count does not, while a hop count is
 * exact in integers and therefore cannot introduce a floating-point tie-break
 * that differs between machines.
 *
 * All pairs are computed once at load — nine rooms is eighty-one numbers — so
 * `hours()` is a map lookup. It has to be: the engine asks for the distance to
 * every advertiser, for every character, on every tick, and a breadth-first
 * search per question would be the most expensive thing in the simulation by an
 * order of magnitude.
 *
 * Why geometry earns its place at all: with travel free, the nearest sofa and
 * the furthest sofa are the same sofa, and a house is just a list. With travel
 * costing both score (the engine discounts by distance) and *time* (the walk is
 * a real action occupying real ticks), where a character already stands becomes
 * a genuine input to what they do next. Somebody in the living room watches
 * television because they are in the living room. That is most of what makes a
 * cutaway house read as a house.
 */

import { adjacency, type WorldConfig } from './config';

export class RoomGraph {
  /** Room ids in the order the config declared them. */
  readonly roomIds: readonly string[];

  private readonly hops: Map<string, Map<string, number>>;
  private readonly hoursPerHop: number;
  private readonly entryRoom: string;

  private constructor(
    roomIds: readonly string[],
    hops: Map<string, Map<string, number>>,
    hoursPerHop: number,
    entryRoom: string,
  ) {
    this.roomIds = roomIds;
    this.hops = hops;
    this.hoursPerHop = hoursPerHop;
    this.entryRoom = entryRoom;
  }

  static from(config: WorldConfig): RoomGraph {
    const links = adjacency(config);
    const roomIds = config.rooms.map((room) => room.id);
    const hops = new Map<string, Map<string, number>>();

    for (const start of roomIds) {
      const distances = new Map<string, number>([[start, 0]]);
      const queue: string[] = [start];
      for (let index = 0; index < queue.length; index += 1) {
        const here = queue[index] ?? start;
        const distance = distances.get(here) ?? 0;
        for (const next of links.get(here) ?? []) {
          if (distances.has(next)) continue;
          distances.set(next, distance + 1);
          queue.push(next);
        }
      }
      hops.set(start, distances);
    }

    return new RoomGraph(roomIds, hops, config.travel.hoursPerHop, config.entryRoom);
  }

  has(roomId: string): boolean {
    return this.hops.has(roomId);
  }

  /**
   * Doorways between two rooms, or -1 if either is not a room in this house.
   *
   * There is no "unreachable but real" case: the config refuses to load a house
   * whose rooms are not all connected.
   */
  hopsBetween(from: string, to: string): number {
    return this.hops.get(from)?.get(to) ?? -1;
  }

  /**
   * Hours to walk from one room to another.
   *
   * An unknown origin is treated as the entry room rather than as an error. A
   * character can legitimately have no room yet — nobody has said where they
   * start — and answering "you are at the front door" is both a better answer
   * than throwing and a better one than zero, which would let them reach the far
   * end of the house for nothing exactly once.
   */
  hoursBetween(from: string | undefined, to: string | undefined): number {
    if (to === undefined) return 0;
    const origin = from !== undefined && this.has(from) ? from : this.entryRoom;
    const hops = this.hopsBetween(origin, to);
    if (hops <= 0) return 0;
    return hops * this.hoursPerHop;
  }
}
