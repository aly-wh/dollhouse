/**
 * `npm run demo -- --seed alpha --days 3`
 *
 * Runs the demo house and prints what happened. This is the only way to check
 * the thing the tests cannot check: whether the house is worth watching.
 *
 * `--format json` writes the raw event log to stdout and nothing else. That
 * output is byte-stable for a given seed — no timestamps, no durations, no
 * version strings — so two invocations can be diffed. Wall-clock timing goes to
 * stderr precisely so it stays out of the diff.
 */

import { formatSummary, formatTimeline, summariseRun } from '../summary';
import { runSimulation, type SimulationResult } from '../simulation';
import { DEMO_CAST } from './cast';
import { DEMO_HOUSE } from './house';

interface Options {
  seed: string;
  days: number;
  tickMinutes: number;
  format: 'text' | 'summary' | 'timeline' | 'json';
  characterIds: string[];
  motiveEvents: boolean;
}

const USAGE = `dollhouse demo

  --seed <string>        seed for the run (default "dollhouse")
  --days <number>        simulated days (default 3)
  --tick-minutes <n>     minutes per tick (default 15)
  --format <f>           text | summary | timeline | json (default text)
  --characters a,b       restrict the timeline to these character ids
  --motive-events        include motive-critical lines in the timeline
  --help
`;

function parseArgs(argv: readonly string[]): Options | null {
  const options: Options = {
    seed: 'dollhouse',
    days: 3,
    tickMinutes: 15,
    format: 'text',
    characterIds: [],
    motiveEvents: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };

    switch (arg) {
      case '--help':
      case '-h':
        return null;
      case '--seed':
        options.seed = value();
        break;
      case '--days':
        options.days = Number(value());
        break;
      case '--tick-minutes':
        options.tickMinutes = Number(value());
        break;
      case '--format': {
        const format = value();
        if (format !== 'text' && format !== 'summary' && format !== 'timeline' && format !== 'json') {
          throw new Error(`unknown format: ${format}`);
        }
        options.format = format;
        break;
      }
      case '--characters':
        options.characterIds = value()
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        break;
      case '--motive-events':
        options.motiveEvents = true;
        break;
      default:
        throw new Error(`unknown argument: ${String(arg)}`);
    }
  }

  if (!Number.isFinite(options.days) || options.days <= 0) {
    throw new Error('--days must be a positive number');
  }
  if (!Number.isFinite(options.tickMinutes) || options.tickMinutes <= 0) {
    throw new Error('--tick-minutes must be a positive number');
  }

  return options;
}

function render(result: SimulationResult, options: Options): string {
  switch (options.format) {
    case 'json':
      return JSON.stringify(result.events, null, 2);
    case 'summary':
      return formatSummary(summariseRun(result));
    case 'timeline':
      return formatTimeline(result, {
        characterIds: options.characterIds,
        includeMotiveEvents: options.motiveEvents,
      });
    case 'text':
      return [
        formatTimeline(result, {
          characterIds: options.characterIds,
          includeMotiveEvents: options.motiveEvents,
        }),
        '',
        formatSummary(summariseRun(result)),
      ].join('\n');
  }
}

function main(): void {
  let options: Options | null;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (options === null) {
    process.stdout.write(USAGE);
    return;
  }

  const startedAt = Date.now();
  const result = runSimulation({
    seed: options.seed,
    world: DEMO_HOUSE,
    characters: DEMO_CAST,
    days: options.days,
    tickMinutes: options.tickMinutes,
  });
  const elapsedMs = Date.now() - startedAt;

  process.stdout.write(`${render(result, options)}\n`);

  // stderr, not stdout: wall-clock timing must never enter a diffable log.
  process.stderr.write(
    `\n${result.simulatedDays} simulated days over ${result.ticks} ticks ` +
      `in ${elapsedMs}ms (${result.events.length} events)\n`,
  );
}

main();
