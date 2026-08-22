/**
 * `npm run demo -- --seed alpha --days 3`
 *
 * Runs a house and prints what happened. This is the only way to check the thing
 * the tests cannot check: whether the house is worth watching. On #4 it caught
 * three modelling bugs no assertion had a hope of catching, and on #5 it caught
 * two more — see the note at the foot of this file.
 *
 * `--format json` writes the raw event log to stdout and nothing else. That
 * output is byte-stable for a given seed — no timestamps, no durations, no
 * version strings — so two invocations can be diffed. Wall-clock timing goes to
 * stderr precisely so it stays out of the diff.
 *
 * **What this file owes the test suite.** `determinism.test.ts` runs this CLI as
 * a *subprocess* for its cross-process determinism check, which is the check an
 * in-process assertion cannot make. That coupling is deliberate: the check is
 * worth having only if it exercises a real entry point. So `src/demo/` cannot
 * simply be deleted — doing so means giving that test another entry point
 * first. (The previous version of this note said the directory was free-standing
 * and could be deleted. It was wrong, the PR review caught it by following the
 * instruction literally, and it is recorded rather than quietly corrected
 * because a confident sentence pointing the wrong way is worse than no sentence.)
 *
 * The house itself is no longer in this directory. It is `worlds/dollhouse.json`
 * and any other file `--world` is pointed at.
 */

import {
  compareRuns,
  formatComparison,
  formatSummary,
  formatTimeline,
  summariseRun,
} from '../summary';
import { runSimulation, type SimulationResult } from '../simulation';
import { DEFAULT_SOCIAL_INTERACTION } from '../simulation';
import { House } from '../world/house';
import { DEFAULT_WORLD_PATH, loadWorldFile } from '../world/load';
import { formatAudit, type AuditableOffer } from '../world/audit';
import { MOTIVE_IDS, type MotiveId, type PartialMotiveVector } from '../motives';
import { WorldConfigError } from '../world/config';
import { DEMO_CAST } from './cast';

interface Options {
  seed: string;
  days: number;
  tickMinutes: number;
  world: string;
  format: 'text' | 'summary' | 'timeline' | 'json' | 'audit' | 'behaviour';
  seeds: string[];
  characterIds: string[];
  motiveEvents: boolean;
  movement: boolean;
}

const USAGE = `dollhouse demo

  --seed <string>        seed for the run (default "dollhouse")
  --days <number>        simulated days (default 3)
  --tick-minutes <n>     minutes per tick (default 15)
  --world <path>         world file to run (default worlds/dollhouse.json)
  --format <f>           text | summary | timeline | json | audit | behaviour
  --seeds a,b,c          seeds for --format behaviour (default six)
  --characters a,b       restrict the timeline to these character ids
  --motive-events        include motive-critical lines in the timeline
  --movement             include every room change in the timeline
  --help

  --format audit reads the house on its own and checks it against the criterion
  the whole thing turns on: every motive needs at least two sources with
  different side-effects, or personality is invisible in what characters do.

  --format behaviour runs the house over several seeds and asks whether the
  characters actually lived differently. A flat table there is the failure the
  audit is meant to prevent, seen from the other end.
`;

function parseArgs(argv: readonly string[]): Options | null {
  const options: Options = {
    seed: 'dollhouse',
    days: 3,
    tickMinutes: 15,
    world: DEFAULT_WORLD_PATH,
    format: 'text',
    seeds: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
    characterIds: [],
    motiveEvents: false,
    movement: false,
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
      case '--world':
        options.world = value();
        break;
      case '--format': {
        const format = value();
        if (
          format !== 'text' &&
          format !== 'summary' &&
          format !== 'timeline' &&
          format !== 'json' &&
          format !== 'audit' &&
          format !== 'behaviour'
        ) {
          throw new Error(`unknown format: ${format}`);
        }
        options.format = format;
        break;
      }
      case '--seeds':
        options.seeds = value()
          .split(',')
          .map((seed) => seed.trim())
          .filter((seed) => seed.length > 0);
        if (options.seeds.length === 0) throw new Error('--seeds needs at least one seed');
        break;
      case '--characters':
        options.characterIds = value()
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        break;
      case '--motive-events':
        options.motiveEvents = true;
        break;
      case '--movement':
        options.movement = true;
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

/**
 * Everything a character can be offered, house and housemates alike.
 *
 * The audit has to include the conversation the engine supplies, or it reports
 * that `social` has fewer sources than it has: talking to each other is a real
 * source with a real side-effect profile, it just does not live in the world
 * file because it is not an object.
 */
function auditableOffers(house: House): AuditableOffer[] {
  const offers: AuditableOffer[] = house
    .allOffers()
    .map((offer) => ({
      advertiserId: offer.objectId,
      interaction: offer.interaction,
      consumes: offer.config.consumes,
      produces: offer.config.produces,
    }));
  offers.push({ advertiserId: '(each other)', interaction: DEFAULT_SOCIAL_INTERACTION });
  return offers;
}

/**
 * Which labels answer which motive, for the mix table.
 *
 * Only positive effects count: the television costs energy, which does not make
 * it one of the ways a character rests.
 */
function motiveSources(house: House): { label: string; motive: MotiveId }[] {
  const rows: { label: string; motive: MotiveId }[] = [];
  const add = (interaction: { label: string; effects: PartialMotiveVector }): void => {
    for (const motive of MOTIVE_IDS) {
      if ((interaction.effects[motive] ?? 0) > 0) rows.push({ label: interaction.label, motive });
    }
  };
  for (const offer of house.allOffers()) add(offer.interaction);
  add(DEFAULT_SOCIAL_INTERACTION);
  return rows;
}

function render(result: SimulationResult, options: Options): string {
  const timeline = (): string =>
    formatTimeline(result, {
      characterIds: options.characterIds,
      includeMotiveEvents: options.motiveEvents,
      includeMovement: options.movement,
    });

  switch (options.format) {
    case 'json':
      return JSON.stringify(result.events, null, 2);
    case 'summary':
      return formatSummary(summariseRun(result));
    case 'timeline':
      return timeline();
    case 'audit':
    case 'behaviour':
      // Both are handled before a run is scored; nothing reaches here.
      return '';
    case 'text':
      return [timeline(), '', formatSummary(summariseRun(result))].join('\n');
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

  let house: House;
  try {
    house = new House(loadWorldFile(options.world));
  } catch (error) {
    if (error instanceof WorldConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (options.format === 'audit') {
    process.stdout.write(`${formatAudit(auditableOffers(house))}\n`);
    return;
  }

  if (options.format === 'behaviour') {
    // A fresh house per seed: it holds live resource levels, so reusing one
    // would start the second seed with whatever the first one ate.
    const runs = options.seeds.map((seed) => {
      const world = new House(loadWorldFile(options!.world));
      return summariseRun(
        runSimulation({
          seed,
          world,
          characters: DEMO_CAST,
          days: options!.days,
          tickMinutes: options!.tickMinutes,
          scoring: world.scoringOverrides(),
        }),
      );
    });
    const offered = house.allOffers().map((offer) => offer.interaction.label);
    offered.push(DEFAULT_SOCIAL_INTERACTION.label);
    process.stdout.write(`${formatComparison(compareRuns(runs, offered, motiveSources(house)))}\n`);
    return;
  }

  const startedAt = Date.now();
  const result = runSimulation({
    seed: options.seed,
    world: house,
    characters: DEMO_CAST,
    days: options.days,
    tickMinutes: options.tickMinutes,
    scoring: house.scoringOverrides(),
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
