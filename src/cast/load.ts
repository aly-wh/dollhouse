/**
 * Getting a cast off disk.
 *
 * Separated from `config.ts` for the same reason `src/world/load.ts` is: parsing
 * and validating a cast stays testable without a filesystem, and the one place
 * that touches `node:fs` is four lines long.
 *
 * The default path is resolved from this module's own location rather than from
 * the working directory, because `npm run demo` and a test spawning the CLI as a
 * subprocess do not agree about what the working directory is.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CastConfigError, parseCastJson, type CastConfig } from './config';

/** The cast this repo ships. `--cast <path>` runs any other. */
export const DEFAULT_CAST_PATH = fileURLToPath(
  new URL('../../casts/dollhouse.json', import.meta.url),
);

export function loadCastFile(path: string = DEFAULT_CAST_PATH): CastConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new CastConfigError(path, `could not be read: ${(error as Error).message}`);
  }

  try {
    return parseCastJson(text);
  } catch (error) {
    if (error instanceof CastConfigError) {
      throw new CastConfigError(`${path} ${error.path}`, error.message.slice(error.path.length + 2));
    }
    throw new CastConfigError(path, `is not valid JSON: ${(error as Error).message}`);
  }
}
