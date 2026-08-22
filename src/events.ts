/**
 * Events — what the engine says happened.
 *
 * This is an *internal* stream, not a file format. #7 owns the on-disk event log
 * schema and is free to project, rename or drop any of this. The engine's
 * obligation is only that the stream is complete enough to reconstruct a run and
 * deterministic enough to diff, so the two stay separable: nothing in the
 * simulation reads an event back.
 *
 * Every numeric field is rounded on the way out. Rounding at the boundary keeps
 * the log readable and stable while leaving the simulation's own state at full
 * precision — rounding the state instead would quietly change the simulation.
 */

import type { MotiveId, MotiveVector } from './motives';
import type { TraitVector } from './personality';

export const MINUTES_PER_DAY = 1440;

/** Two decimal places, with -0 normalised to 0 so logs never disagree over sign. */
export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

export function roundMotives(motives: MotiveVector): MotiveVector {
  return {
    hunger: round2(motives.hunger),
    energy: round2(motives.energy),
    social: round2(motives.social),
    fun: round2(motives.fun),
    hygiene: round2(motives.hygiene),
    comfort: round2(motives.comfort),
  };
}

/** "D2 14:30" — day number from the start of the run, then wall clock. */
export function formatClock(absoluteMinutes: number): string {
  const day = Math.floor(absoluteMinutes / MINUTES_PER_DAY) + 1;
  const withinDay = absoluteMinutes - (day - 1) * MINUTES_PER_DAY;
  const hour = Math.floor(withinDay / 60);
  const minute = Math.floor(withinDay - hour * 60);
  const pad = (value: number): string => (value < 10 ? `0${value}` : `${value}`);
  return `D${day} ${pad(hour)}:${pad(minute)}`;
}

export interface EventTiming {
  readonly tick: number;
  readonly minutes: number;
  readonly clock: string;
}

export type ActionEndReason =
  /** Ran to its advertised duration. */
  | 'finished'
  /** Stopped early because finishing it was no longer worth anything — waking up rested. */
  | 'satisfied'
  /** Abandoned because something else scored far higher. */
  | 'interrupted'
  /** The other half of a conversation left. */
  | 'partner_left';

export interface RunStartedEvent extends EventTiming {
  readonly kind: 'run_started';
  readonly seed: string;
  readonly tickMinutes: number;
  readonly totalTicks: number;
  readonly characters: readonly {
    readonly id: string;
    readonly name: string;
    readonly traits: TraitVector;
    readonly weights: MotiveVector;
    readonly motives: MotiveVector;
    readonly roomId: string | null;
  }[];
}

export interface ActionStartedEvent extends EventTiming {
  readonly kind: 'action_started';
  readonly characterId: string;
  readonly advertiserId: string;
  readonly interactionId: string;
  readonly label: string;
  readonly durationHours: number;
  readonly score: number;
  readonly partnerId: string | null;
  readonly conversationId: string | null;
}

export interface ActionEndedEvent extends EventTiming {
  readonly kind: 'action_ended';
  readonly characterId: string;
  readonly advertiserId: string;
  readonly interactionId: string;
  readonly label: string;
  readonly reason: ActionEndReason;
  readonly hoursSpent: number;
  readonly motives: MotiveVector;
}

export interface ConversationStartedEvent extends EventTiming {
  readonly kind: 'conversation_started';
  readonly conversationId: string;
  readonly initiatorId: string;
  readonly partnerId: string;
  readonly durationHours: number;
}

export interface MotiveCriticalEvent extends EventTiming {
  readonly kind: 'motive_critical';
  readonly characterId: string;
  readonly motive: MotiveId;
  readonly value: number;
}

export interface MotiveRelievedEvent extends EventTiming {
  readonly kind: 'motive_relieved';
  readonly characterId: string;
  readonly motive: MotiveId;
  readonly value: number;
}

export interface SnapshotEvent extends EventTiming {
  readonly kind: 'snapshot';
  readonly characters: readonly {
    readonly id: string;
    readonly action: string | null;
    readonly roomId: string | null;
    readonly motives: MotiveVector;
  }[];
}

/**
 * The house, stated once at the top of the run.
 *
 * Everything downstream of the engine names rooms, objects and resources by id —
 * `moved` says `bedroom-north`, `resource_changed` says `hot-water` — and a log
 * that names things it never introduces cannot be read on its own. #10 has to
 * draw this house from a recorded run, not from the config file that happened to
 * be on disk at the time, or a replay silently re-renders against whatever the
 * world was edited into afterwards.
 */
export interface WorldDescription {
  readonly worldId: string;
  readonly name: string;
  readonly entryRoom: string;
  readonly rooms: readonly {
    readonly id: string;
    readonly name: string;
    /** Symmetric and sorted: every doorway appears from both sides. */
    readonly exits: readonly string[];
  }[];
  readonly objects: readonly {
    readonly id: string;
    readonly name: string;
    readonly roomId: string;
    readonly interactions: readonly { readonly id: string; readonly label: string }[];
  }[];
  readonly resources: readonly {
    readonly id: string;
    readonly label: string;
    readonly capacity: number;
    readonly value: number;
  }[];
}

export interface WorldDescribedEvent extends EventTiming {
  readonly kind: 'world_described';
  readonly world: WorldDescription;
}

export interface MovedEvent extends EventTiming {
  readonly kind: 'moved';
  readonly characterId: string;
  readonly fromRoomId: string | null;
  readonly toRoomId: string;
  readonly hours: number;
}

/**
 * Somebody walked across the house for something that was gone when they got
 * there.
 *
 * This is the cost of *not* reserving an object while a character is on their
 * way to it. Reserving would be tidier and would waste no trips; it would also
 * delete the only moment in the run where a character is visibly worse off for
 * having been slower than somebody else. The wasted walk is the point.
 */
export interface PlanBlockedEvent extends EventTiming {
  readonly kind: 'plan_blocked';
  readonly characterId: string;
  readonly advertiserId: string;
  readonly interactionId: string;
  readonly label: string;
  readonly reason: BlockedReason;
}

export type BlockedReason =
  /** Somebody else was using it, and it seats fewer people than wanted it. */
  | 'occupied'
  /** It is no longer on offer at all: the resource it needs has run out. */
  | 'unavailable';

export type ResourceChangeReason = 'consumed' | 'produced';

/**
 * Events the world raises rather than the engine.
 *
 * They are declared without timing, because a world has no clock — it is told
 * how many hours passed and never what time it is, which is one fewer place a
 * run could pick up a dependency on anything but its seed. The engine stamps
 * them as it drains them.
 */
export type WorldEventBody =
  | {
      readonly kind: 'resource_changed';
      readonly resourceId: string;
      readonly label: string;
      readonly delta: number;
      readonly value: number;
      readonly characterId: string | null;
      readonly reason: ResourceChangeReason;
    }
  | {
      readonly kind: 'resource_depleted';
      readonly resourceId: string;
      readonly label: string;
    }
  | {
      readonly kind: 'resource_restocked';
      readonly resourceId: string;
      readonly label: string;
      readonly value: number;
    };

export type WorldEvent = WorldEventBody & EventTiming;

export interface RunFinishedEvent extends EventTiming {
  readonly kind: 'run_finished';
  readonly ticks: number;
  readonly simulatedDays: number;
}

export type SimEvent =
  | RunStartedEvent
  | WorldDescribedEvent
  | ActionStartedEvent
  | ActionEndedEvent
  | ConversationStartedEvent
  | MovedEvent
  | PlanBlockedEvent
  | MotiveCriticalEvent
  | MotiveRelievedEvent
  | WorldEvent
  | SnapshotEvent
  | RunFinishedEvent;
