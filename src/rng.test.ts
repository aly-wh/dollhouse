import { describe, expect, it } from 'vitest';

import { createRng, hashString } from './rng';

function take(count: number, rng: { next(): number }): number[] {
  return Array.from({ length: count }, () => rng.next());
}

describe('hashString', () => {
  it('is stable for a given input', () => {
    expect(hashString('dollhouse')).toBe(hashString('dollhouse'));
  });

  it('separates similar inputs', () => {
    expect(hashString('mara')).not.toBe(hashString('marb'));
    expect(hashString('')).not.toBe(hashString('a'));
  });
});

describe('createRng', () => {
  it('produces the same stream from the same seed', () => {
    expect(take(50, createRng('alpha'))).toEqual(take(50, createRng('alpha')));
  });

  it('produces a different stream from a different seed', () => {
    expect(take(50, createRng('alpha'))).not.toEqual(take(50, createRng('beta')));
  });

  it('stays inside [0, 1)', () => {
    for (const value of take(5000, createRng('range-check'))) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const buckets = new Array<number>(10).fill(0);
    const rng = createRng('uniformity');
    for (let index = 0; index < 100_000; index += 1) {
      const bucket = Math.floor(rng.next() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11000);
    }
  });

  it('derives forks by name, not by draw order', () => {
    // This is the property that lets the cast change without rewriting
    // everyone's future. A fork must depend only on its own channel name — not
    // on how many other forks were taken first, nor on how much the parent
    // stream has been drawn from.
    const early = createRng('seed').fork('mara');

    const parent = createRng('seed');
    take(1000, parent);
    parent.fork('dez');
    parent.fork('juno');
    const late = parent.fork('mara');

    expect(take(20, late)).toEqual(take(20, early));
  });

  it('gives different channels different streams', () => {
    const root = createRng('seed');
    expect(take(20, root.fork('mara'))).not.toEqual(take(20, root.fork('dez')));
  });

  it('maps nextInRange onto the requested interval', () => {
    const rng = createRng('range');
    for (let index = 0; index < 1000; index += 1) {
      const value = rng.nextInRange(-5, 5);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(5);
    }
  });
});
