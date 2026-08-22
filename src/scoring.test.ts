import { describe, expect, it } from 'vitest';

import { advertisedGain, type Interaction } from './advertisement';
import { motiveVector } from './motives';
import { motiveWeightsFromTraits, traitVector } from './personality';
import { DEFAULT_SCORING, applyJitter, resolveScoringConfig, scoreInteraction } from './scoring';

const meal: Interaction = {
  id: 'meal',
  label: 'eat',
  durationHours: 1,
  effects: { hunger: 60 },
};

const telly: Interaction = {
  id: 'telly',
  label: 'watch television',
  durationHours: 1,
  effects: { fun: 40, energy: -10 },
};

const scrub: Interaction = {
  id: 'scrub',
  label: 'shower',
  durationHours: 1,
  effects: { hygiene: 80 },
};

const score = (
  interaction: Interaction,
  motives: Parameters<typeof scoreInteraction>[0]['motives'],
  weights: Parameters<typeof scoreInteraction>[0]['weights'],
  extra: Partial<Parameters<typeof scoreInteraction>[0]> = {},
): number =>
  scoreInteraction({ motives, weights, interaction, config: DEFAULT_SCORING, ...extra }).score;

describe('advertisedGain', () => {
  it('is the per-hour effect over the duration', () => {
    expect(advertisedGain(meal, 'hunger')).toBe(60);
    expect(advertisedGain(meal, 'hunger', 0.5)).toBe(30);
    expect(advertisedGain(meal, 'fun')).toBe(0);
  });
});

describe('scoreInteraction', () => {
  const neutral = motiveWeightsFromTraits(traitVector());

  it('scores an offer higher the more the character needs it', () => {
    const starving = score(meal, motiveVector(50, { hunger: -80 }), neutral);
    const peckish = score(meal, motiveVector(50, { hunger: 20 }), neutral);
    const full = score(meal, motiveVector(50, { hunger: 95 }), neutral);

    expect(starving).toBeGreaterThan(peckish);
    expect(peckish).toBeGreaterThan(full);
    expect(full).toBeLessThan(0.01);
  });

  it('breaks the total down by motive', () => {
    const breakdown = scoreInteraction({
      motives: motiveVector(0),
      weights: neutral,
      interaction: telly,
      config: DEFAULT_SCORING,
    });

    expect(breakdown.contributions.map((entry) => entry.motive)).toEqual(['energy', 'fun']);
    const summed = breakdown.contributions.reduce((total, entry) => total + entry.weighted, 0);
    expect(summed).toBeCloseTo(breakdown.raw, 12);
    expect(breakdown.raw * breakdown.discount).toBeCloseTo(breakdown.score, 12);
  });

  it('counts costs against the total', () => {
    // Television costs energy. To an exhausted character that cost outweighs the
    // fun, and the whole offer goes negative — below the do-nothing floor.
    const exhausted = score(telly, motiveVector(50, { energy: -85, fun: 50 }), neutral);
    expect(exhausted).toBeLessThan(0);
  });

  it('lets personality weights pick a different winner from identical motives', () => {
    // The load-bearing claim of the whole issue, at its smallest scale.
    const motives = motiveVector(10);
    const fastidious = motiveWeightsFromTraits(traitVector({ neat: 1, playful: 0 }));
    const playful = motiveWeightsFromTraits(traitVector({ neat: 0, playful: 1 }));

    expect(score(scrub, motives, fastidious)).toBeGreaterThan(score(telly, motives, fastidious));
    expect(score(telly, motives, playful)).toBeGreaterThan(score(scrub, motives, playful));
  });

  it('attenuates an offer by how far away it is', () => {
    const motives = motiveVector(0);
    const near = score(meal, motives, neutral, { travelHours: 0 });
    const far = score(meal, motives, neutral, { travelHours: 1 });
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);
  });

  describe('horizon', () => {
    const marathon: Interaction = {
      id: 'marathon',
      label: 'sleep',
      durationHours: 8,
      effects: { energy: 20 },
    };

    it('scores only the next few hours of a long action', () => {
      const config = resolveScoringConfig({ horizonHours: 2 });
      const breakdown = scoreInteraction({
        motives: motiveVector(0),
        weights: motiveWeightsFromTraits(traitVector()),
        interaction: marathon,
        config,
      });
      expect(breakdown.hours).toBe(2);
      expect(breakdown.contributions[0]?.gain).toBe(40);
    });

    it('stops a long action being beaten by a short one that is strictly worse', () => {
      // Without a horizon this is exactly backwards: the eight-hour sleep pours
      // most of its energy into a full motive and pays the time discount for
      // every hour of it, so the feebler nap wins and nobody goes to bed.
      const nap: Interaction = {
        id: 'nap',
        label: 'nap',
        durationHours: 1.5,
        effects: { energy: 12 },
      };
      const weights = motiveWeightsFromTraits(traitVector());
      const tired = motiveVector(50, { energy: -60 });
      expect(score(marathon, tired, weights)).toBeGreaterThan(score(nap, tired, weights));
    });
  });

  describe('commitment cost', () => {
    it('charges for the hours a character is locked into, not just the ones scored', () => {
      const brief: Interaction = { id: 'b', label: 'b', durationHours: 6, effects: { energy: 20 } };
      const committed: Interaction = { ...brief, id: 'c', minimumHours: 6 };
      const motives = motiveVector(50, { energy: -30 });
      const weights = motiveWeightsFromTraits(traitVector());
      // Same payoff over the horizon; one of them costs you the evening.
      expect(score(committed, motives, weights)).toBeLessThan(score(brief, motives, weights));
    });
  });
});

describe('applyJitter', () => {
  const config = resolveScoringConfig({ jitter: 0.2 });

  it('spans the configured fraction either way', () => {
    expect(applyJitter(1, config, 0)).toBeCloseTo(0.8, 12);
    expect(applyJitter(1, config, 1)).toBeCloseTo(1.2, 12);
    expect(applyJitter(1, config, 0.5)).toBeCloseTo(1, 12);
  });

  it('cannot manufacture value out of a worthless option', () => {
    // The bug this shape exists to prevent: with additive noise, a character
    // whose motives are all satisfied scores everything near zero, the noise
    // outvotes the lot, and they shower thirty times a day on the strength of a
    // dice roll.
    expect(applyJitter(0, config, 0)).toBe(0);
    expect(applyJitter(0, config, 1)).toBe(0);
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(applyJitter(0.0001, config, roll)).toBeLessThan(0.001);
    }
  });

  it('cannot flip a bad idea into a good one', () => {
    for (const roll of [0, 0.5, 0.999]) {
      expect(applyJitter(-0.5, config, roll)).toBeLessThan(0);
    }
  });
});

describe('resolveScoringConfig', () => {
  it('fills every field from the defaults', () => {
    expect(resolveScoringConfig()).toEqual(DEFAULT_SCORING);
    expect(resolveScoringConfig({ jitter: 0 }).urgencyExponent).toBe(
      DEFAULT_SCORING.urgencyExponent,
    );
  });
});
