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
    readonly motives: MotiveVector;
  }[];
}

export interface RunFinishedEvent extends EventTiming {
  readonly kind: 'run_finished';
  readonly ticks: number;
  readonly simulatedDays: number;
}

export type SimEvent =
  | RunStartedEvent
  | ActionStartedEvent
  | ActionEndedEvent
  | ConversationStartedEvent
  | MotiveCriticalEvent
  | MotiveRelievedEvent
  | SnapshotEvent
  | RunFinishedEvent;
