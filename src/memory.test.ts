/**
 * The memory mechanism on its own, with no simulation around it.
 *
 * What a memory *does to a run* is `remembering.test.ts`. This file is about the
 * three properties everything downstream rests on: an opinion accumulates rather
 * than being recomputed, it cannot grow without bound, and it cannot turn a
 * score into its own opposite.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEMORY,
  MEMORY_LOG_STEP,
  Memory,
  OPINION_MAX,
  charmScale,
  forgivenessScale,
  grievanceScale,
  resolveMemoryConfig,
} from './memory';
import { traitVector } from './personality';

const neutral = traitVector();
const config = resolveMemoryConfig({ impressionFadeHours: 10, bondFadeHours: 10 });

const memoryFor = (traits = neutral, initial: readonly (readonly [string, number])[] = []): Memory =>
  new Memory(config, traits, initial);

describe('an opinion accumulates', () => {
  it('starts at nothing, so an unknown object is neither liked nor disliked', () => {
    const memory = memoryFor();
    expect(memory.impressionOf('shower')).toBe(0);
    expect(memory.objectMultiplier('shower')).toBe(1);
  });

  it('adds each experience to the one before, rather than replacing it', () => {
    const memory = memoryFor();
    memory.write('object', 'shower', -0.3);
    expect(memory.impressionOf('shower')).toBeCloseTo(-0.3, 10);
    memory.write('object', 'shower', -0.3);
    // The property the whole issue turns on: the second disappointment is worse
    // than the first *because the first is still there*.
    expect(memory.impressionOf('shower')).toBeCloseTo(-0.6, 10);
  });

  it('keeps objects and people apart, even under the same id', () => {
    const memory = memoryFor();
    memory.write('object', 'juno', -0.5);
    expect(memory.bondWith('juno')).toBe(0);
    memory.write('person', 'juno', 0.4);
    expect(memory.impressionOf('juno')).toBeCloseTo(-0.5, 10);
    expect(memory.bondWith('juno')).toBeCloseTo(0.4, 10);
  });

  it('starts from the relationships the cast file declared', () => {
    const memory = memoryFor(neutral, [['dez', -0.4]]);
    expect(memory.bondWith('dez')).toBeCloseTo(-0.4, 10);
  });

  it('cannot be pushed past the ends of the scale', () => {
    const memory = memoryFor();
    for (let index = 0; index < 20; index += 1) memory.write('object', 'shower', -0.3);
    expect(memory.impressionOf('shower')).toBe(-OPINION_MAX);
    for (let index = 0; index < 60; index += 1) memory.write('object', 'shower', 0.3);
    expect(memory.impressionOf('shower')).toBe(OPINION_MAX);
  });
});

describe('and then fades', () => {
  it('loses a fixed amount per hour rather than a fixed fraction', () => {
    // Linear, not exponential, and it matters that this is asserted: an
    // exponential half-life needs `Math.pow`, which is banned across the engine
    // for portability. See the note at the top of `memory.ts`.
    const memory = memoryFor();
    memory.write('object', 'shower', -1);
    const full = memory.impressionOf('shower');
    memory.fade(2.5);
    const afterOne = memory.impressionOf('shower');
    memory.fade(2.5);
    const afterTwo = memory.impressionOf('shower');

    // Equal hours cost equal *amounts*. Under a half-life the second step would
    // remove less than the first, because there is less left to remove.
    expect(afterOne - full).toBeCloseTo(afterTwo - afterOne, 10);
    expect(afterOne).toBeGreaterThan(full);

    // And two half-steps land exactly where one whole step does, which is what
    // makes the tick length a presentation choice rather than a tuning knob.
    const other = memoryFor();
    other.write('object', 'shower', -1);
    other.fade(5);
    expect(other.impressionOf('shower')).toBeCloseTo(afterTwo, 10);
  });

  it('stops at nothing rather than overshooting into the opposite opinion', () => {
    const memory = memoryFor();
    memory.write('object', 'shower', -0.2);
    memory.fade(100);
    expect(memory.impressionOf('shower')).toBe(0);
    expect(memory.impressionList()).toEqual([]);
  });

  it('lets an agreeable character get over things sooner than a sour one', () => {
    const sour = memoryFor(traitVector({ nice: 0 }));
    const sweet = memoryFor(traitVector({ nice: 1 }));
    sour.write('person', 'dez', -0.9);
    sweet.write('person', 'dez', -0.9);
    sour.fade(4);
    sweet.fade(4);
    expect(sweet.bondWith('dez')).toBeGreaterThan(sour.bondWith('dez'));
  });
});

describe('what an opinion is allowed to do to a score', () => {
  it('scales it, and the scale is bounded by the configured influence', () => {
    const memory = memoryFor();
    memory.write('object', 'shower', -1);
    expect(memory.objectMultiplier('shower')).toBeCloseTo(1 - config.impressionInfluence, 10);
    memory.write('object', 'bath', 1);
    expect(memory.objectMultiplier('bath')).toBeCloseTo(1 + config.impressionInfluence, 10);
  });

  it('never reaches zero, so a grudge is a preference and not a veto', () => {
    // The line between "I would rather not" and "I would rather starve". An
    // influence of 1 against a maximal grudge is the worst case the parser
    // permits, and even that only halves... no: it reaches exactly zero, which
    // is why the parser caps influence at 1 and the multiplier floors at 0.
    const hard = new Memory(resolveMemoryConfig({ impressionInfluence: 1 }), neutral);
    hard.write('object', 'shower', -1);
    expect(hard.objectMultiplier('shower')).toBe(0);
    expect(hard.objectMultiplier('shower')).toBeGreaterThanOrEqual(0);
  });
});

describe('what the log is told', () => {
  it('says nothing until the value has actually moved', () => {
    const memory = memoryFor();
    const small = MEMORY_LOG_STEP / 4;
    expect(memory.write('object', 'shower', small).report).toBe(false);
    expect(memory.write('object', 'shower', small).report).toBe(false);
    expect(memory.write('object', 'shower', small).report).toBe(false);
    // Four of them clears the step, and the log gets one line rather than four.
    expect(memory.write('object', 'shower', small).report).toBe(true);
  });

  it('reports movement in both directions, not only downwards', () => {
    const memory = memoryFor();
    expect(memory.write('person', 'dez', -0.4).report).toBe(true);
    expect(memory.write('person', 'dez', 0.4).report).toBe(true);
  });

  it('says so anyway when the caller marks the write as one that must be heard', () => {
    // The hole this closed. A bond reported at -0.21, faded back to nothing, and
    // then snubbed by exactly -0.21 again lands on the last reported value — so
    // under the step rule alone the log showed the wasted journey and said
    // nothing about who got blamed for it.
    const memory = memoryFor();
    expect(memory.write('person', 'dez', -0.21).report).toBe(true);
    memory.fade(1000);
    expect(memory.bondWith('dez')).toBe(0);
    expect(memory.write('person', 'dez', -0.21).report).toBe(false);

    const marked = memoryFor();
    expect(marked.write('person', 'dez', -0.21, true).report).toBe(true);
    marked.fade(1000);
    expect(marked.write('person', 'dez', -0.21, true).report).toBe(true);
  });

  it('measures against the declared starting bond, not against zero', () => {
    // A cast file that starts Mara at -0.40 on Dez should not produce a log line
    // announcing a grudge she began the run with.
    const memory = memoryFor(neutral, [['dez', -0.4]]);
    expect(memory.write('person', 'dez', -0.01).report).toBe(false);
  });
});

describe('temperament', () => {
  it('makes an agreeable character take less offence and a sour one more', () => {
    expect(grievanceScale(traitVector({ nice: 1 }))).toBeLessThan(1);
    expect(grievanceScale(traitVector({ nice: 0 }))).toBeGreaterThan(1);
    expect(grievanceScale(traitVector({ nice: 0 }))).toBeGreaterThan(
      grievanceScale(traitVector({ nice: 1 })) * 2,
    );
  });

  it('makes an agreeable character forgive faster', () => {
    expect(forgivenessScale(traitVector({ nice: 1 }))).toBeGreaterThan(
      forgivenessScale(traitVector({ nice: 0 })),
    );
  });

  it('makes an agreeable character better company, which is a fact about them', () => {
    // Read off the partner, not the rememberer. This is the only place a trait
    // acts on somebody else's model of the world.
    expect(charmScale(traitVector({ nice: 1 }))).toBeGreaterThan(
      charmScale(traitVector({ nice: 0 })) * 2,
    );
  });
});

describe('reporting', () => {
  it('lists opinions strongest first, with ties broken by id', () => {
    const memory = memoryFor();
    memory.write('object', 'shower', -0.6);
    memory.write('object', 'bath', 0.2);
    memory.write('object', 'armchair', 0.9);
    memory.write('object', 'basin', -0.2);
    expect(memory.impressionList().map((entry) => entry.id)).toEqual([
      'armchair',
      'shower',
      'basin',
      'bath',
    ]);
  });

  it('resolves a partial config against the engine defaults', () => {
    const partial = resolveMemoryConfig({ snubbed: -0.5 });
    expect(partial.snubbed).toBe(-0.5);
    expect(partial.talked).toBe(DEFAULT_MEMORY.talked);
  });
});
