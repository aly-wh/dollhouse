/**
 * Getting a world off disk.
 *
 * Separated from `config.ts` so that everything about parsing and validating a
 * house is testable without a filesystem, and so the one place that touches
 * `node:fs` is four lines long and obvious.
 *
 * The default path is resolved from this module's own location rather than from
 * the working directory. `npm run demo` and a test spawning the CLI as a
 * subprocess do not agree about what the working directory is, and "the world
 * file was not found" is a miserable way to learn that.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseWorldJson, WorldConfigError, type WorldConfig } from './config';

/** The house this repo ships. `--world <path>` runs any other. */
export const DEFAULT_WORLD_PATH = fileURLToPath(
  new URL('../../worlds/dollhouse.json', import.meta.url),
);

export function loadWorldFile(path: string = DEFAULT_WORLD_PATH): WorldConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new WorldConfigError(path, `could not be read: ${(error as Error).message}`);
  }

  try {
    return parseWorldJson(text);
  } catch (error) {
    if (error instanceof WorldConfigError) {
      throw new WorldConfigError(`${path} ${error.path}`, error.message.slice(error.path.length + 2));
    }
    throw new WorldConfigError(path, `is not valid JSON: ${(error as Error).message}`);
  }
}
