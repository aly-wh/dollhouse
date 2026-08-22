import { describe, expect, it } from 'vitest';

import { MOTIVE_MAX, MOTIVE_MIN } from './motives';
import {
  DEFAULT_URGENCY_EXPONENT,
  integerPow,
  motiveUtility,
  normaliseMotive,
  satisfactionUtility,
} from './utility';

describe('integerPow', () => {
  it('matches Math.pow for integer exponents', () => {
    for (const base of [0, 0.25, 0.5, 0.75, 1, 2, 3.5]) {
      for (const exponent of [1, 2, 3, 4, 5]) {
        expect(integerPow(base, exponent)).toBeCloseTo(Math.pow(base, exponent), 12);
      }
    }
  });

  it('refuses non-integer and non-positive exponents', () => {
    // Not pedantry. Falling back to Math.pow for a fractional exponent would
    // reintroduce the cross-engine variance the function exists to avoid.
    expect(() => integerPow(2, 2.5)).toThrow(RangeError);
    expect(() => integerPow(2, 0)).toThrow(RangeError);
    expect(() => integerPow(2, -1)).toThrow(RangeError);
  });
});

describe('normaliseMotive', () => {
  it('maps the motive range onto 0..1', () => {
    expect(normaliseMotive(MOTIVE_MIN)).toBe(0);
    expect(normaliseMotive(MOTIVE_MAX)).toBe(1);
    expect(normaliseMotive(0)).toBe(0.5);
  });

  it('clamps out-of-range input', () => {
    expect(normaliseMotive(-500)).toBe(0);
    expect(normaliseMotive(500)).toBe(1);
  });
});

describe('motiveUtility', () => {
  it('runs from 0 at the floor to 1 at the ceiling', () => {
    expect(motiveUtility(MOTIVE_MIN)).toBe(0);
    expect(motiveUtility(MOTIVE_MAX)).toBe(1);
  });

  it('increases monotonically', () => {
    let previous = -Infinity;
    for (let value = MOTIVE_MIN; value <= MOTIVE_MAX; value += 5) {
      const utility = motiveUtility(value);
      expect(utility).toBeGreaterThan(previous);
      previous = utility;
    }
  });

  it('is concave — each further point is worth less than the last', () => {
    const step = 10;
    let previousGain = Infinity;
    for (let value = MOTIVE_MIN; value + step <= MOTIVE_MAX; value += step) {
      const gain = motiveUtility(value + step) - motiveUtility(value);
      expect(gain).toBeLessThan(previousGain);
      previousGain = gain;
    }
  });
});

describe('satisfactionUtility', () => {
  it('values the same gain far more when the motive is low', () => {
    const desperate = satisfactionUtility(-80, 20);
    const comfortable = satisfactionUtility(40, 20);
    expect(desperate).toBeGreaterThan(comfortable);
    // The whole reason a character eats when hungry rather than at random. At
    // the default exponent the ratio is about fifteen; anything under five and
    // urgency stops being legible in behaviour.
    expect(desperate / comfortable).toBeGreaterThan(5);
  });

  it('gives almost nothing for topping up a full motive', () => {
    expect(satisfactionUtility(MOTIVE_MAX, 50)).toBe(0);
    expect(satisfactionUtility(95, 50)).toBeLessThan(0.01);
  });

  it('ignores the part of an offer that overflows the ceiling', () => {
    // An object promising +500 to a nearly-full motive is worth exactly what
    // fits, which is why a character does not queue for a second dinner.
    expect(satisfactionUtility(90, 500)).toBe(satisfactionUtility(90, 10));
  });

  it('returns negative utility for a cost', () => {
    // How "play the piano while exhausted" ends up below doing nothing at all.
    expect(satisfactionUtility(-40, -20)).toBeLessThan(0);
  });

  it('costs more when the motive is already low', () => {
    const whenLow = satisfactionUtility(-60, -20);
    const whenHigh = satisfactionUtility(60, -20);
    expect(whenLow).toBeLessThan(whenHigh);
  });

  it('sharpens with a higher urgency exponent', () => {
    const gentle = satisfactionUtility(-80, 20, 2) / satisfactionUtility(40, 20, 2);
    const fierce = satisfactionUtility(-80, 20, 5) / satisfactionUtility(40, 20, 5);
    expect(fierce).toBeGreaterThan(gentle);
  });

  it('uses a positive integer default exponent', () => {
    expect(Number.isInteger(DEFAULT_URGENCY_EXPONENT)).toBe(true);
    expect(DEFAULT_URGENCY_EXPONENT).toBeGreaterThan(0);
  });
});
