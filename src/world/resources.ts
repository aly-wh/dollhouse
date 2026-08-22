/**
 * Things that run out.
 *
 * A house where every object works forever produces characters who never have to
 * take second best, and a character who never takes second best has no visible
 * preferences: everyone gets their first choice every time, so nobody's first
 * choice ever shows. Scarcity is not flavour here, it is the mechanism that
 * turns a weight into an observable event.
 *
 * Three rules, and they are all about *when* the arithmetic happens:
 *
 *   - **Spent at the start, in full.** You take the portion out of the fridge
 *     before you eat it. Being dragged away mid-meal does not put it back. Any
 *     other rule needs the world to track partial consumption per character and
 *     reconcile it on four different exit paths.
 *   - **Paid out only on completion.** Cooking makes leftovers when the cooking
 *     is done, not while it is happening, or a character starts a meal, is
 *     interrupted, and has still somehow restocked the fridge.
 *   - **Unaffordable means unadvertised.** The engine is never offered something
 *     it cannot have, so it never has to handle being refused. An empty tank
 *     removes the shower from the house until it refills, and characters route
 *     around it the same way they route around an occupied one.
 *
 * Depletion and restocking are edge-triggered, like the motive-crisis events in
 * the engine: the interesting moment is the *crossing*, and a level event every
 * tick would bury it under two thousand lines of "still empty".
 */

import type { WorldEventBody } from '../events';
import type { ResourceAmount, ResourceConfig } from './config';

/** Below this a resource counts as gone, absorbing the usual float drift. */
const EMPTY_EPSILON = 1e-9;

interface Pool {
  readonly id: string;
  readonly label: string;
  readonly capacity: number;
  readonly regenPerHour: number;
  value: number;
  empty: boolean;
}

export interface ResourceSnapshot {
  readonly id: string;
  readonly label: string;
  readonly capacity: number;
  readonly value: number;
}

export class ResourcePool {
  /** Declaration order. Iterated for snapshots and regeneration; never for a score. */
  private readonly order: readonly string[];
  private readonly pools: Map<string, Pool>;
  private pending: WorldEventBody[] = [];
  /**
   * Bumped on every change. The house caches its advertiser list against this
   * rather than rebuilding fifteen objects per character per tick.
   */
  private revision = 0;

  constructor(configs: readonly ResourceConfig[]) {
    this.pools = new Map(
      configs.map((config) => [
        config.id,
        {
          id: config.id,
          label: config.label,
          capacity: config.capacity,
          regenPerHour: config.regenPerHour,
          value: config.initial,
          empty: config.initial <= EMPTY_EPSILON,
        },
      ]),
    );
    this.order = configs.map((config) => config.id);
  }

  get version(): number {
    return this.revision;
  }

  has(id: string): boolean {
    return this.pools.has(id);
  }

  /** Current level. An unknown resource reads as 0, and is therefore unaffordable. */
  value(id: string): number {
    return this.pools.get(id)?.value ?? 0;
  }

  isEmpty(id: string): boolean {
    return this.value(id) <= EMPTY_EPSILON;
  }

  /** Can every one of these be paid right now? An empty list always can. */
  canAfford(amounts: readonly ResourceAmount[] | undefined): boolean {
    if (amounts === undefined) return true;
    for (const [id, amount] of amounts) {
      if (this.value(id) + EMPTY_EPSILON < amount) return false;
    }
    return true;
  }

  /**
   * Spend. Callers are expected to have checked `canAfford` — an overdraw is
   * clamped at zero rather than throwing, because the alternative is a house
   * that crashes at 03:00 on day nineteen over a rounding error.
   */
  spend(amounts: readonly ResourceAmount[] | undefined, characterId: string | null): void {
    if (amounts === undefined) return;
    for (const [id, amount] of amounts) this.change(id, -amount, characterId, 'consumed');
  }

  gain(amounts: readonly ResourceAmount[] | undefined, characterId: string | null): void {
    if (amounts === undefined) return;
    for (const [id, amount] of amounts) this.change(id, amount, characterId, 'produced');
  }

  /**
   * Time passing. Regeneration is silent — a tank filling by four units is not
   * an event — but crossing back above empty is, because that is the moment the
   * shower reappears in the house.
   */
  regenerate(hours: number): void {
    for (const id of this.order) {
      const pool = this.pools.get(id);
      if (!pool || pool.regenPerHour === 0) continue;
      const before = pool.value;
      const after = Math.min(pool.capacity, before + pool.regenPerHour * hours);
      if (after === before) continue;
      pool.value = after;
      this.revision += 1;
      this.checkEdges(pool);
    }
  }

  private change(
    id: string,
    delta: number,
    characterId: string | null,
    reason: 'consumed' | 'produced',
  ): void {
    const pool = this.pools.get(id);
    if (!pool) return;
    const before = pool.value;
    pool.value = Math.max(0, Math.min(pool.capacity, before + delta));
    const applied = pool.value - before;
    if (applied === 0) return;

    this.revision += 1;
    this.pending.push({
      kind: 'resource_changed',
      resourceId: pool.id,
      label: pool.label,
      delta: round2(applied),
      value: round2(pool.value),
      characterId,
      reason,
    });
    this.checkEdges(pool);
  }

  private checkEdges(pool: Pool): void {
    const empty = pool.value <= EMPTY_EPSILON;
    if (empty === pool.empty) return;
    pool.empty = empty;
    this.pending.push(
      empty
        ? { kind: 'resource_depleted', resourceId: pool.id, label: pool.label }
        : {
            kind: 'resource_restocked',
            resourceId: pool.id,
            label: pool.label,
            value: round2(pool.value),
          },
    );
  }

  drainEvents(): readonly WorldEventBody[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  snapshot(): readonly ResourceSnapshot[] {
    const rows: ResourceSnapshot[] = [];
    for (const id of this.order) {
      const pool = this.pools.get(id);
      if (!pool) continue;
      rows.push({ id: pool.id, label: pool.label, capacity: pool.capacity, value: round2(pool.value) });
    }
    return rows;
  }
}

/** Local copy rather than an import from `events`: this module owns no clock. */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}
