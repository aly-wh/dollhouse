/**
 * Determinism is the load-bearing property. A replay of a run that cannot be
 * reproduced is a work of fiction, and everything downstream — the event log
 * (#7), the replayer (#10) — rests on this holding.
 *
 * So it is checked three ways, because the three fail differently:
 *
 * 1. Same seed twice in one process. Catches ordinary state leaks.
 * 2. Same seed in two *separate processes*, via the CLI. Catches the ones that
 *    survive the first check — anything seeded from the clock, from module load
 *    order, or from a hash whose iteration order happens to be stable within a
 *    process.
 * 3. Reading the source. Catches the ones that have not fired yet: a
 *    `Math.random()` on a branch no test has taken is a time bomb, not a bug.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TEST_CAST, TEST_HOUSE } from './testing/fixtures';
import { runSimulation, type SimulationConfig } from './simulation';
import { summariseRun } from './summary';

const ROOT = process.cwd();

const baseConfig: Omit<SimulationConfig, 'seed'> = {
  world: TEST_HOUSE,
  characters: TEST_CAST,
  days: 4,
};

const runWith = (seed: string): string =>
  JSON.stringify(runSimulation({ ...baseConfig, seed }).events);

describe('same seed, same run', () => {
  it('is byte-identical in one process', () => {
    expect(runWith('alpha')).toBe(runWith('alpha'));
  });

  it('is byte-identical for the summary too', () => {
    const first = summariseRun(runSimulation({ ...baseConfig, seed: 'alpha' }));
    const second = summariseRun(runSimulation({ ...baseConfig, seed: 'alpha' }));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('does not drift when other runs happen in between', () => {
    const first = runWith('alpha');
    runWith('beta');
    runWith('gamma');
    expect(runWith('alpha')).toBe(first);
  });
});

describe('different seed, different run', () => {
  it('produces a visibly different run, not a cosmetically different one', () => {
    const alpha = runSimulation({ ...baseConfig, seed: 'alpha' });
    const beta = runSimulation({ ...baseConfig, seed: 'beta' });

    expect(JSON.stringify(alpha.events)).not.toBe(JSON.stringify(beta.events));

    // "Different" has to mean more than one tick landing elsewhere. Compare
    // what each character actually did with their week.
    const alphaSummary = summariseRun(alpha);
    const betaSummary = summariseRun(beta);

    let changed = 0;
    for (let index = 0; index < alphaSummary.characters.length; index += 1) {
      const left = alphaSummary.characters[index]!;
      const right = betaSummary.characters[index]!;
      for (const motive of ['hunger', 'energy', 'social', 'fun', 'hygiene', 'comfort'] as const) {
        if (Math.abs(left.meanMotives[motive] - right.meanMotives[motive]) > 1) changed += 1;
      }
    }
    expect(changed).toBeGreaterThan(4);
  });

  it('gives every seed its own run', () => {
    const seeds = ['a', 'b', 'c', 'd', 'e'];
    const runs = new Set(seeds.map(runWith));
    expect(runs.size).toBe(seeds.length);
  });
});

describe('across separate processes', () => {
  // The check that actually matters, and the one an in-process assertion cannot
  // make: generate the same run twice from two cold starts and diff the bytes.
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  const cli = join(ROOT, 'src', 'demo', 'cli.ts');

  const generate = (seed: string): string =>
    execFileSync(process.execPath, [tsx, cli, '--seed', seed, '--days', '3', '--format', 'json'], {
      cwd: ROOT,
      encoding: 'utf8',
      // stdout only. Wall-clock timing goes to stderr precisely so it cannot
      // enter this comparison.
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });

  it('produces byte-identical output from two cold starts', () => {
    const first = generate('cross-process');
    const second = generate('cross-process');
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(1000);
  }, 120_000);

  it('produces different output from a different seed', () => {
    expect(generate('cross-process-two')).not.toBe(generate('cross-process'));
  }, 120_000);
});

describe('the source itself', () => {
  function engineFiles(): string[] {
    const found: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory).sort()) {
        const full = join(directory, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
          found.push(full);
        }
      }
    };
    walk(join(ROOT, 'src'));
    return found;
  }

  /**
   * Comments discuss the very things this scan forbids — the note in `rng.ts`
   * explaining why `Math.random` is banned would otherwise fail the test that
   * bans it. Only executable code is scanned.
   */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  }

  const files = engineFiles().map((path) => ({
    name: relative(ROOT, path),
    code: stripComments(readFileSync(path, 'utf8')),
  }));

  it('finds the engine to scan', () => {
    expect(files.length).toBeGreaterThan(8);
    // A stripper that ate the code would pass every check below without
    // checking anything, so confirm there is still code left to scan.
    for (const file of files) {
      expect(file.code.trim().length, file.name).toBeGreaterThan(200);
    }
    // And confirm it strips: this line lives inside a comment in rng.ts.
    const rng = files.find((file) => file.name.endsWith('rng.ts'));
    expect(rng?.code).not.toContain('mulberry32:');
    expect(rng?.code).toContain('Math.imul');
  });

  it('never reaches for Math.random', () => {
    for (const file of files) {
      expect(file.code, file.name).not.toMatch(/Math\s*\.\s*random/);
    }
  });

  it('never reads the clock outside the CLI', () => {
    // The CLI prints how long generation took, to stderr. Nothing that can
    // influence a motive is allowed to know what time it is.
    for (const file of files) {
      if (file.name === join('src', 'demo', 'cli.ts')) continue;
      expect(file.code, file.name).not.toMatch(/Date\s*\.\s*now/);
      expect(file.code, file.name).not.toMatch(/new\s+Date\s*\(/);
      expect(file.code, file.name).not.toMatch(/performance\s*\.\s*now/);
    }
  });

  it('never uses Math.pow or **, whose last bit is not portable', () => {
    for (const file of files) {
      expect(file.code, file.name).not.toMatch(/Math\s*\.\s*pow/);
      expect(file.code, file.name).not.toMatch(/\*\*/);
    }
  });

  it('never enumerates an object where the key order could reach a score', () => {
    // V8's key order is stable, but a replay should not rest on that. Motive
    // vectors are built key by key in a fixed order; the engine never walks one.
    for (const file of files) {
      if (file.name.startsWith(join('src', 'demo'))) continue;
      if (file.name === join('src', 'summary.ts')) continue;
      expect(file.code, file.name).not.toMatch(/Object\s*\.\s*(keys|values|entries)/);
    }
  });

  it('makes no model calls, and has nowhere to make one from', () => {
    // The cost model of the product stated as a test. Dialogue (#8) is the only
    // place inference is ever spent, and it is not here.
    const forbidden = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /from\s+['"]node:https?['"]/,
      /require\s*\(\s*['"]https?['"]\s*\)/,
      /\banthropic\b/i,
      /\bopenai\b/i,
      /\bapi[_-]?key\b/i,
    ];
    for (const file of files) {
      for (const pattern of forbidden) {
        expect(file.code, `${file.name} matched ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });
});
