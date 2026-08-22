/**
 * Turning a run into something a person can look at.
 *
 * This exists because "the tests pass" and "the house is worth watching" are
 * different claims, and only one of them is checkable by reading a green tick.
 * A time-allocation table is the cheapest honest way to see whether two
 * characters actually live differently or merely differ in the eighth decimal.
 */

import { round2, type BlockedReason } from './events';
import type { MemoryCause } from './memory';
import { MOTIVE_IDS, mapMotives, type MotiveId, type MotiveVector } from './motives';
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
  readonly roomId: string | null;
  /**
   * Times this character walked somewhere and found it taken, or gone.
   *
   * The house's contention, counted per person. A run where this is zero for
   * everybody is a run in which nothing was ever scarce, and a house in which
   * nothing is scarce cannot show you who anybody is — everyone gets their first
   * choice, so nobody's first choice is ever visible.
   */
  readonly blockedPlans: number;
  /**
   * What they ended the run thinking of the others, strongest opinion first.
   *
   * Reported per character rather than as a matrix because the relationship is
   * not symmetric: `mara -> dez` and `dez -> mara` are separate numbers and a
   * matrix presentation invites reading one cell as both.
   */
  readonly bonds: readonly (readonly [string, number])[];
  /** What they ended the run thinking of the objects, strongest first. */
  readonly impressions: readonly (readonly [string, number])[];
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

function summariseCharacter(character: CharacterState, blockedPlans: number): CharacterSummary {
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
    roomId: character.roomId ?? null,
    blockedPlans,
    bonds: (character.memory?.bondList() ?? []).map(
      (entry) => [entry.id, round2(entry.value)] as const,
    ),
    impressions: (character.memory?.impressionList() ?? []).map(
      (entry) => [entry.id, round2(entry.value)] as const,
    ),
    usage,
  };
}

export function summariseRun(result: SimulationResult): RunSummary {
  const blocked = new Map<string, number>();
  for (const event of result.events) {
    if (event.kind !== 'plan_blocked') continue;
    blocked.set(event.characterId, (blocked.get(event.characterId) ?? 0) + 1);
  }

  return {
    seed: result.seed,
    ticks: result.ticks,
    simulatedDays: result.simulatedDays,
    eventCount: result.events.length,
    characters: result.characters.map((character) =>
      summariseCharacter(character, blocked.get(character.id) ?? 0),
    ),
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

    lines.push(
      `  ends in ${character.roomId ?? 'nowhere in particular'}` +
        `, ${character.blockedPlans} wasted trip${character.blockedPlans === 1 ? '' : 's'}`,
    );

    // Where the run left them with each other. Printed as one line per person
    // rather than a grid, because a grid reads as symmetric and this is not:
    // what Mara thinks of Dez is on Mara's card and nowhere else.
    if (character.bonds.length > 0) {
      lines.push(
        `  thinks of  ${character.bonds
          .map(([id, value]) => `${id} ${value >= 0 ? '+' : ''}${value.toFixed(2)}`)
          .join('  ')}`,
      );
    }
    if (character.impressions.length > 0) {
      const strongest = character.impressions.slice(0, 5);
      lines.push(
        `  opinions   ${strongest
          .map(([id, value]) => `${id} ${value >= 0 ? '+' : ''}${value.toFixed(2)}`)
          .join('  ')}` + (character.impressions.length > 5 ? '  ...' : ''),
      );
    }
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

export interface LabelComparison {
  readonly label: string;
  /** Share of life on this label, per character, in the summaries' order. */
  readonly shares: readonly number[];
  /**
   * Largest share divided by smallest. Infinite when somebody never does it at
   * all, which is the strongest personality signal there is.
   */
  readonly ratio: number;
}

export interface MotiveComparison {
  readonly motive: MotiveId;
  readonly means: readonly number[];
  readonly spread: number;
}

/** One source of one motive, as a share of the time that character spent on it. */
export interface SourceShare {
  readonly label: string;
  /**
   * Which objects answer to this label, sorted. Usually one; two beds are two.
   *
   * A run records labels, not objects — see `CharacterState.hoursByLabel` — so
   * two identical beds are one row here whatever the house says. Naming the
   * objects is how a reader tells "one source" from "two objects that do the
   * same thing", which is exactly the question the duplicated `sleep` rows left
   * open: identical label, identical numbers, and nothing to say whether the
   * table was double-counting or the house had two beds.
   */
  readonly advertiserIds: readonly string[];
  readonly fractions: readonly number[];
}

/**
 * What the caller says pays which motive.
 *
 * `advertiserId` is optional and is for the reader, not the arithmetic — the
 * arithmetic is keyed on `label` either way, because that is the only key a run
 * records.
 */
export interface MotiveSourceRef {
  readonly label: string;
  readonly motive: MotiveId;
  readonly advertiserId?: string;
}

export interface MotiveMix {
  readonly motive: MotiveId;
  readonly sources: readonly SourceShare[];
  /**
   * Widest gap between any two characters on any one source, in percentage
   * points. This is the differentiation number that means something.
   */
  readonly spread: number;
}

export interface Comparison {
  readonly characterIds: readonly string[];
  readonly runs: number;
  /** Descending by ratio: the things that separate people most, first. */
  readonly labels: readonly LabelComparison[];
  readonly motives: readonly MotiveComparison[];
  /**
   * Which source each character reached for, per motive.
   *
   * The one to read. Total *time* on a motive is not a personality signal and
   * treating it as one is how a house nobody could live in came to look like a
   * success: at steady state, hours spent on a motive are decay over supply for
   * everybody, with no weight anywhere in it, so two characters who are both
   * keeping up will wash for the same number of hours however differently they
   * feel about washing. Equal time is the *correct* answer.
   *
   * Time on a motive only diverges when somebody has stopped keeping up — which
   * is to say, a wide spread here is as likely to be evidence that the house is
   * failing as evidence that it is working.
   *
   * What a weight actually buys is the level a motive is held at, and which of
   * its sources gets picked. Those are `motives` and this.
   */
  readonly mix: readonly MotiveMix[];
  /** Labels nothing in the house ever used. Dead content, and a design smell. */
  readonly unused: readonly string[];
}

/**
 * Do these characters actually live differently?
 *
 * The question a green test suite cannot answer, and the one the whole issue
 * turns on. #4's house passed every assertion in the repo while producing four
 * people who spent 5.1 to 5.2 per cent of their time in the shower across an
 * eightfold spread in how much they cared about being clean.
 *
 * Averaged over several seeds on purpose. A single run is one sample of a noisy
 * process, and two characters can look different for a week for no reason at
 * all; what survives six seeds is the personality.
 *
 * Reads the *ratio* between the extremes rather than the difference, because the
 * interesting claim is "she showers four times as often as he does", and a
 * difference of three percentage points means nothing without knowing three
 * points of what.
 */
export function compareRuns(
  runs: readonly RunSummary[],
  /**
   * Every label the world offers, whether anybody took it or not.
   *
   * Needed because a run only records what people actually did: an object
   * nobody ever touched leaves no trace at all, so without being told what was
   * on offer this cannot tell "unused" from "does not exist". Dead content is
   * worth reporting — an object nobody reaches for is a choice that was not
   * really being offered — and it is invisible from the runs alone.
   */
  offered: readonly string[] = [],
  /**
   * Which labels pay which motive, so the mix can be worked out.
   *
   * A run records labels and hours; it has no idea that "wash at the basin" and
   * "take a shower" are two answers to the same question. The world knows, so
   * the world has to say.
   */
  sources: readonly MotiveSourceRef[] = [],
): Comparison {
  const first = runs[0];
  if (!first) return { characterIds: [], runs: 0, labels: [], motives: [], mix: [], unused: [] };

  const characterIds = first.characters.map((character) => character.id);
  const shares = new Map<string, number[]>();
  const means = new Map<MotiveId, number[]>();

  for (const label of offered) shares.set(label, characterIds.map(() => 0));
  for (const motive of MOTIVE_IDS) means.set(motive, characterIds.map(() => 0));

  for (const run of runs) {
    for (let index = 0; index < run.characters.length; index += 1) {
      const character = run.characters[index]!;
      for (const entry of character.usage) {
        const row = shares.get(entry.label) ?? characterIds.map(() => 0);
        row[index] = (row[index] ?? 0) + entry.share / runs.length;
        shares.set(entry.label, row);
      }
      for (const motive of MOTIVE_IDS) {
        const row = means.get(motive)!;
        row[index] = (row[index] ?? 0) + character.meanMotives[motive] / runs.length;
      }
    }
  }

  const labels: LabelComparison[] = [];
  const unused: string[] = [];
  for (const [label, row] of shares) {
    const high = Math.max(...row);
    const low = Math.min(...row);
    if (high <= 0) {
      unused.push(label);
      continue;
    }
    labels.push({ label, shares: row, ratio: low > 0 ? high / low : Infinity });
  }
  labels.sort((left, right) =>
    right.ratio !== left.ratio
      ? right.ratio - left.ratio
      : left.label < right.label
        ? -1
        : left.label > right.label
          ? 1
          : 0,
  );
  unused.sort();

  const motives = MOTIVE_IDS.map((motive) => {
    const row = means.get(motive)!;
    return { motive, means: row, spread: Math.max(...row) - Math.min(...row) };
  });

  const mix: MotiveMix[] = [];
  for (const motive of MOTIVE_IDS) {
    // Collapsed by label before anything is divided, and this is load-bearing
    // arithmetic rather than tidying.
    //
    // `shares` is keyed on label, so two beds both labelled `sleep` return the
    // *same* number twice. Summing the list as given put that number into the
    // denominator twice and then printed it twice, so the column still added up
    // to 100% while every percentage in it was wrong — sleep understated by
    // half, and everything else deflated by a denominator that counted a motive
    // source it did not have. It read as a cosmetic duplicate. It was not.
    const forMotive = collapseByLabel(sources.filter((entry) => entry.motive === motive));
    if (forMotive.length < 2) continue;

    const totals = characterIds.map((_, index) =>
      forMotive.reduce((sum, entry) => sum + (shares.get(entry.label)?.[index] ?? 0), 0),
    );
    const rows: SourceShare[] = forMotive.map((entry) => ({
      label: entry.label,
      advertiserIds: entry.advertiserIds,
      fractions: characterIds.map((_, index) => {
        const total = totals[index] ?? 0;
        return total > 0 ? (shares.get(entry.label)?.[index] ?? 0) / total : 0;
      }),
    }));

    let spread = 0;
    for (const row of rows) {
      spread = Math.max(spread, Math.max(...row.fractions) - Math.min(...row.fractions));
    }
    rows.sort((left, right) =>
      left.label < right.label ? -1 : left.label > right.label ? 1 : 0,
    );
    mix.push({ motive, sources: rows, spread });
  }

  return { characterIds, runs: runs.length, labels, motives, mix, unused };
}

/**
 * One row per label, carrying the ids of every object that offers it.
 *
 * Order is first appearance, which the caller controls and the formatter sorts
 * anyway; the ids are sorted here so the row reads the same however the world
 * file happened to list its objects.
 */
function collapseByLabel(
  entries: readonly MotiveSourceRef[],
): { label: string; advertiserIds: readonly string[] }[] {
  const byLabel = new Map<string, string[]>();
  for (const entry of entries) {
    const ids = byLabel.get(entry.label) ?? [];
    if (entry.advertiserId !== undefined && !ids.includes(entry.advertiserId)) {
      ids.push(entry.advertiserId);
    }
    byLabel.set(entry.label, ids);
  }

  const rows: { label: string; advertiserIds: readonly string[] }[] = [];
  for (const [label, ids] of byLabel) {
    const sorted = [...ids];
    sorted.sort();
    rows.push({ label, advertiserIds: sorted });
  }
  return rows;
}

export function formatComparison(comparison: Comparison): string {
  const lines: string[] = [];
  const columns = comparison.characterIds.map((id) => padStart(id.slice(0, 7), 8));

  lines.push(`averaged over ${comparison.runs} seed${comparison.runs === 1 ? '' : 's'}`);
  lines.push('');
  lines.push(`${pad('time-averaged motive', 22)}${columns.join('')}   spread`);
  for (const entry of comparison.motives) {
    lines.push(
      `${pad(entry.motive, 22)}` +
        entry.means.map((value) => padStart(value.toFixed(0), 8)).join('') +
        `${padStart(entry.spread.toFixed(0), 9)}`,
    );
  }

  if (comparison.mix.length > 0) {
    lines.push('');
    lines.push('which source, as a share of the time that character spent on that motive');
    lines.push('(the differentiation number that means something — see `Comparison.mix`)');
    for (const entry of comparison.mix) {
      lines.push('');
      lines.push(
        // 2 + 32 lines up with the rows' 4 + 30. Labels here run to "pick at the
        // fruit bowl" and, qualified, to "sleep (bed-north, bed-south)", both of
        // which overflowed the old 18-wide column and pushed that row's numbers
        // out of line with every other row.
        `  ${pad(entry.motive, 32)}${columns.join('')}   widest gap ` +
          `${(entry.spread * 100).toFixed(0)}pp`,
      );
      for (const source of entry.sources) {
        // Qualified with the objects behind it whenever there is more than one,
        // so a reader is never left wondering whether a row is double-counting.
        // Two beds are one label and one row; the row says it is two beds.
        const label =
          source.advertiserIds.length > 1
            ? `${source.label} (${source.advertiserIds.join(', ')})`
            : source.label;
        lines.push(
          `    ${pad(label, 30)}` +
            source.fractions.map((f) => padStart(`${(f * 100).toFixed(0)}%`, 8)).join(''),
        );
      }
    }
  }

  lines.push('');
  lines.push(`${pad('share of life', 22)}${columns.join('')}      ratio`);
  lines.push('(time on a motive converges on decay over supply for everybody; read the mix above)');
  for (const entry of comparison.labels) {
    lines.push(
      `${pad(entry.label, 22)}` +
        entry.shares.map((share) => padStart(`${(share * 100).toFixed(1)}%`, 8)).join('') +
        `${padStart(Number.isFinite(entry.ratio) ? `${entry.ratio.toFixed(1)}x` : 'never/does', 11)}`,
    );
  }

  if (comparison.unused.length > 0) {
    lines.push('');
    lines.push(`never used by anybody: ${comparison.unused.join(', ')}`);
  }

  return lines.join('\n');
}

export interface TimelineOptions {
  /** Only these characters. Empty means all. */
  readonly characterIds?: readonly string[];
  readonly includeMotiveEvents?: boolean;
  /**
   * Every room change, which in a nine-room house is most of the log.
   *
   * Off by default. A blocked plan already tells you somebody walked somewhere
   * for nothing, which is the part of movement worth reading; the rest is
   * "Mara went to the kitchen" four hundred times.
   */
  readonly includeMovement?: boolean;
  /**
   * Every memory written, including the pleasant ones and the opinions about
   * furniture.
   *
   * Off by default, but *unlike* the two options above, the default is not
   * silence. A grudge against a person is always narrated, because it is rare —
   * a handful a day across five characters — and because it is the part of
   * memory anybody watching is watching for. What this switches on is the rest:
   * every conversation that went well, and every mild opinion about an armchair,
   * which together outnumber the interesting lines about twenty to one.
   */
  readonly includeMemory?: boolean;
}

const BLOCKED_PHRASE: Record<BlockedReason, string> = {
  occupied: 'somebody else was already there',
  unavailable: 'there was none left',
};

/**
 * How a memory reads as a sentence.
 *
 * The `{}` is the thing or the person it is about. Written from the
 * rememberer's side, because that is whose head the number is in — nobody else
 * in the house knows it happened.
 */
const MEMORY_PHRASE: Record<MemoryCause, string> = {
  occupied: 'is getting tired of {}',
  unavailable: 'is getting tired of {}',
  worked: 'got on well with {}',
  talked: 'enjoyed {}',
  walked_out: 'minds that {} walked off',
  snubbed: 'blames {}',
};

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
      case 'moved':
        if (!options.includeMovement || !include(event.characterId)) break;
        lines.push(
          `${event.clock}  ${pad(nameOf(event.characterId), 10)} is now in ${event.toRoomId}`,
        );
        break;
      case 'plan_blocked':
        if (!include(event.characterId)) break;
        lines.push(
          `${event.clock}  ${pad(nameOf(event.characterId), 10)} got there and could not ` +
            `${event.label} — ${BLOCKED_PHRASE[event.reason]}`,
        );
        break;
      case 'resource_depleted':
        lines.push(`${event.clock}  ${pad('the house', 10)} has run out of ${event.label}`);
        break;
      case 'resource_restocked':
        lines.push(`${event.clock}  ${pad('the house', 10)} has ${event.label} again`);
        break;
      case 'remembered': {
        if (!include(event.characterId)) break;
        // A grudge against a person is news whatever the options say. Everything
        // else waits to be asked for.
        const dramatic = event.about === 'person' && event.delta < 0;
        if (!options.includeMemory && !dramatic) break;
        const about = event.about === 'person' ? nameOf(event.targetId) : event.targetId;
        // Both numbers, because either alone misleads. The delta on its own
        // hides that Orla started out fond of Juno; the running total on its own
        // reads as though a snub were worth +0.02.
        const signed = (value: number): string =>
          `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
        lines.push(
          `${event.clock}  ${pad(nameOf(event.characterId), 10)} ` +
            `${MEMORY_PHRASE[event.cause].replace('{}', about)} ` +
            `(${signed(event.delta)}, now ${signed(event.value)})`,
        );
        break;
      }
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
