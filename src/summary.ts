/**
 * Turning a run into something a person can look at.
 *
 * This exists because "the tests pass" and "the house is worth watching" are
 * different claims, and only one of them is checkable by reading a green tick.
 * A time-allocation table is the cheapest honest way to see whether two
 * characters actually live differently or merely differ in the eighth decimal.
 */

import { round2 } from './events';
import { MOTIVE_IDS, mapMotives, type MotiveVector } from './motives';
import type { TraitVector } from './personality';
import { IDLE_LABEL, type CharacterState, type SimulationResult } from './simulation';

export interface LabelUsage {
  readonly label: string;
  readonly hours: number;
  readonly starts: number;
  /** Share of the whole run, 0..1. */
  readonly share: number;
}

export interface CharacterSummary {
  readonly id: string;
  readonly name: string;
  readonly traits: TraitVector;
  readonly weights: MotiveVector;
  readonly finalMotives: MotiveVector;
  /**
   * Time-averaged motive levels. The headline evidence that personality weights
   * do something: a low weight buys a permanently lower level, which endpoint
   * motives are far too noisy to show.
   */
  readonly meanMotives: MotiveVector;
  readonly totalHours: number;
  readonly idleHours: number;
  /** Descending by hours, ties broken by label. Stable across runs. */
  readonly usage: readonly LabelUsage[];
}

export interface RunSummary {
  readonly seed: string;
  readonly ticks: number;
  readonly simulatedDays: number;
  readonly eventCount: number;
  readonly characters: readonly CharacterSummary[];
}

function summariseCharacter(character: CharacterState): CharacterSummary {
  let totalHours = 0;
  for (const hours of character.hoursByLabel.values()) totalHours += hours;

  const usage: LabelUsage[] = [...character.hoursByLabel.entries()]
    .map(([label, hours]) => ({
      label,
      hours: round2(hours),
      starts: character.startsByLabel.get(label) ?? 0,
      share: totalHours > 0 ? hours / totalHours : 0,
    }))
    .sort((left, right) =>
      right.hours !== left.hours
        ? right.hours - left.hours
        : left.label < right.label
          ? -1
          : left.label > right.label
            ? 1
            : 0,
    );

  return {
    id: character.id,
    name: character.name,
    traits: character.traits,
    weights: character.weights,
    finalMotives: character.motives,
    meanMotives: mapMotives(character.motiveHourSums, (sum) =>
      character.accumulatedHours > 0 ? round2(sum / character.accumulatedHours) : 0,
    ),
    totalHours: round2(totalHours),
    idleHours: round2(character.hoursByLabel.get(IDLE_LABEL) ?? 0),
    usage,
  };
}

export function summariseRun(result: SimulationResult): RunSummary {
  return {
    seed: result.seed,
    ticks: result.ticks,
    simulatedDays: result.simulatedDays,
    eventCount: result.events.length,
    characters: result.characters.map(summariseCharacter),
  };
}

/** Hours a character spent on one action label. 0 if they never did it. */
export function hoursOn(summary: CharacterSummary, label: string): number {
  for (const entry of summary.usage) {
    if (entry.label === label) return entry.hours;
  }
  return 0;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

export function formatSummary(summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(
    `seed "${summary.seed}" — ${summary.simulatedDays} simulated days, ` +
      `${summary.ticks} ticks, ${summary.eventCount} events`,
  );

  for (const character of summary.characters) {
    lines.push('');
    lines.push(`${character.name} (${character.id})`);

    const traits = (Object.keys(character.traits) as (keyof TraitVector)[])
      .map((trait) => `${trait} ${character.traits[trait].toFixed(2)}`)
      .join('  ');
    lines.push(`  traits   ${traits}`);

    const weights = MOTIVE_IDS.map(
      (motive) => `${motive} ${character.weights[motive].toFixed(2)}`,
    ).join('  ');
    lines.push(`  weights  ${weights}`);

    const means = MOTIVE_IDS.map(
      (motive) => `${motive} ${padStart(character.meanMotives[motive].toFixed(0), 4)}`,
    ).join('  ');
    lines.push(`  mean     ${means}`);

    lines.push('  time spent');
    for (const entry of character.usage) {
      const percent = `${(entry.share * 100).toFixed(1)}%`;
      lines.push(
        `    ${pad(entry.label, 22)} ${padStart(entry.hours.toFixed(1), 7)}h  ` +
          `${padStart(percent, 6)}  ${padStart(String(entry.starts), 4)}x`,
      );
    }
  }

  return lines.join('\n');
}

export interface TimelineOptions {
  /** Only these characters. Empty means all. */
  readonly characterIds?: readonly string[];
  readonly includeMotiveEvents?: boolean;
}

/** A human-readable narration of what happened, in order. */
export function formatTimeline(
  result: SimulationResult,
  options: TimelineOptions = {},
): string {
  const wanted = new Set(options.characterIds ?? []);
  const include = (id: string): boolean => wanted.size === 0 || wanted.has(id);
  const names = new Map(result.characters.map((character) => [character.id, character.name]));
  const nameOf = (id: string): string => names.get(id) ?? id;

  const lines: string[] = [];
  for (const event of result.events) {
    switch (event.kind) {
      case 'action_started':
        if (!include(event.characterId)) break;
        lines.push(
          `${event.clock}  ${pad(nameOf(event.characterId), 10)} ${event.label}` +
            (event.partnerId ? ` with ${nameOf(event.partnerId)}` : '') +
            `  (score ${event.score.toFixed(2)})`,
        );
        break;
      case 'action_ended':
        if (!include(event.characterId)) break;
        if (event.reason === 'finished') break;
        lines.push(
          `${event.clock}  ${pad(nameOf(event.characterId), 10)} stopped ${event.label} — ${event.reason}`,
        );
        break;
      case 'motive_critical':
        if (!options.includeMotiveEvents || !include(event.characterId)) break;
        lines.push(
          `${event.clock}  ${pad(nameOf(event.characterId), 10)} ${event.motive} is critical (${event.value})`,
        );
        break;
      default:
        break;
    }
  }
  return lines.join('\n');
}
