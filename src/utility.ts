/**
 * The motive curve — why a starving character eats and a full one does not.
 *
 * The naive design scores an action by how many motive points it delivers. That
 * design produces a character who eats a fourth dinner because dinner is worth
 * 90 points regardless of how full they are. The fix, and the whole trick of the
 * Sims scoring model, is that the *value* of a motive point depends on where the
 * motive already is.
 *
 * So a motive has a satisfaction curve:
 *
 *     n = (value - MIN) / (MAX - MIN)        normalised to 0..1
 *     U(n) = 1 - (1 - n)^k                   concave, k = urgency exponent
 *
 * U is increasing and concave, so its slope — the worth of one more point — is
 * steepest at the bottom and flat at the top. With the default k = 3, a point of
 * hunger relief at -80 is worth roughly fifteen times the same point at +40. An
 * action is then scored on the *difference* in utility it would cause, not on
 * its raw magnitude.
 */

import { MOTIVE_MAX, MOTIVE_MIN, clampMotive } from './motives';

export const DEFAULT_URGENCY_EXPONENT = 3;

/**
 * Integer exponentiation by repeated multiplication.
 *
 * Deliberately not `Math.pow`. Multiplication is exactly specified by IEEE-754
 * and therefore bit-identical everywhere; `Math.pow` is implementation-defined
 * to within an ulp and has historically differed between JS engines. One ulp is
 * enough to change a tie-break, and a changed tie-break is a different run.
 */
export function integerPow(base: number, exponent: number): number {
  if (!Number.isInteger(exponent) || exponent < 1) {
    throw new RangeError(`urgency exponent must be a positive integer, got ${exponent}`);
  }
  let result = 1;
  for (let index = 0; index < exponent; index += 1) {
    result *= base;
  }
  return result;
}

/** Position of a motive on 0..1, where 0 is desperate and 1 is sated. */
export function normaliseMotive(value: number): number {
  return (clampMotive(value) - MOTIVE_MIN) / (MOTIVE_MAX - MOTIVE_MIN);
}

/** U(value) on 0..1. Concave: the first points off the floor are worth the most. */
export function motiveUtility(value: number, exponent = DEFAULT_URGENCY_EXPONENT): number {
  const deficit = 1 - normaliseMotive(value);
  return 1 - integerPow(deficit, exponent);
}

/**
 * How much better off a character would be if this motive moved by `gain`.
 *
 * Clamping happens inside, so an action promising +200 hunger to a character at
 * +90 is correctly valued at almost nothing — the promise is real but there is
 * no room left to bank it. A negative gain returns negative utility, which is
 * how "watching television when exhausted" ends up scoring below doing nothing.
 */
export function satisfactionUtility(
  current: number,
  gain: number,
  exponent = DEFAULT_URGENCY_EXPONENT,
): number {
  return motiveUtility(current + gain, exponent) - motiveUtility(current, exponent);
}
