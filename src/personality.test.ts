/**
 * The claim this whole issue rests on: personality weights change behaviour.
 *
 * "Two characters made different choices" is trivially true of any system with
 * a random number in it and proves nothing at all. So the tests here are built
 * around a control. Two characters who differ *only* in their traits are
 * compared against two characters who are identical in every respect except
 * their id — same traits, same motives, same world, different random stream.
 *
 * If personality did nothing, both pairs would diverge by about the same
 * amount, and the difference between them is what has to be large.
 */

import { describe, expect, it } from 'vitest';

import type { Advertiser } from './advertisement';
import { MOTIVE_IDS, motiveVector } from './motives';
import { motiveWeightsFromTraits, resolveMotiveWeights, traitVector } from './personality';
import { runSimulation, type CharacterSpec } from './simulation';
import { hoursOn, summariseRun, type CharacterSummary } from './summary';

/**
 * Everything here has room for both characters at once. Contention would be a
 * second explanation for any divergence found, and the point is to leave only
 * one.
 */
const SHARED_HOUSE: readonly Advertiser[] = [
  {
    id: 'fridge',
    kind: 'object',
    interactions: [
      { id: 'eat', label: 'eat', durationHours: 0.5, effects: { hunger: 110 }, capacity: 4 },
    ],
  },
  {
    id: 'bed',
    kind: 'object',
    interactions: [
      {
        id: 'sleep',
        label: 'sleep',
        durationHours: 7,
        minimumHours: 6,
        effects: { energy: 36, comfort: 5 },
        decayMultipliers: { hunger: 0.35, social: 0, fun: 0, hygiene: 0.4, comfort: 0 },
        capacity: 4,
      },
    ],
  },
  {
    id: 'shower',
    kind: 'object',
    interactions: [
      {
        id: 'wash',
        label: 'take a shower',
        durationHours: 0.5,
        effects: { hygiene: 120, comfort: 6 },
        capacity: 4,
      },
    ],
  },
  {
    id: 'piano',
    kind: 'object',
    interactions: [
      {
        id: 'play',
        label: 'play the piano',
        durationHours: 0.75,
        effects: { fun: 48, energy: -14, comfort: -10 },
        capacity: 4,
      },
    ],
  },
  {
    id: 'armchair',
    kind: 'object',
    interactions: [
      {
        id: 'sit',
        label: 'sit in the armchair',
        durationHours: 1,
        effects: { comfort: 30, energy: 10 },
        capacity: 4,
      },
    ],
  },
];

const IDENTICAL_START = motiveVector(50);

function live(characters: readonly CharacterSpec[]): readonly CharacterSummary[] {
  return summariseRun(
    runSimulation({
      seed: 'divergence',
      world: SHARED_HOUSE,
      // Conversations would couple the two characters to each other. Off, so
      // each one's week is entirely their own doing.
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters,
      days: 20,
    }),
  ).characters;
}

const FASTIDIOUS = { neat: 1, playful: 0, active: 0.9, outgoing: 0.5, nice: 0.5 };
const SLOVENLY = { neat: 0, playful: 1, active: 0.1, outgoing: 0.5, nice: 0.5 };

function byId(summaries: readonly CharacterSummary[], id: string): CharacterSummary {
  const found = summaries.find((summary) => summary.id === id);
  if (!found) throw new Error(`no character ${id}`);
  return found;
}

describe('personality weights', () => {
  it('spread widely across the trait range', () => {
    // A mapping that produced weights within a few percent of each other would
    // satisfy every behavioural test below by accident and mean nothing.
    const low = motiveWeightsFromTraits(traitVector(SLOVENLY));
    const high = motiveWeightsFromTraits(traitVector(FASTIDIOUS));
    expect(high.hygiene / low.hygiene).toBeGreaterThan(5);
    expect(low.fun / high.fun).toBeGreaterThan(5);
  });

  it('leaves hunger alone', () => {
    // Nobody starves on account of their temperament.
    for (const traits of [FASTIDIOUS, SLOVENLY, {}]) {
      expect(motiveWeightsFromTraits(traitVector(traits)).hunger).toBe(1);
    }
  });

  it('can be overridden outright', () => {
    const weights = resolveMotiveWeights(traitVector(FASTIDIOUS), { hygiene: 0.01 });
    expect(weights.hygiene).toBe(0.01);
    expect(weights.fun).toBe(motiveWeightsFromTraits(traitVector(FASTIDIOUS)).fun);
  });
});

describe('two characters, identical circumstances, different personalities', () => {
  const pair = live([
    { id: 'a-neat', traits: FASTIDIOUS, motives: IDENTICAL_START },
    { id: 'b-messy', traits: SLOVENLY, motives: IDENTICAL_START },
  ]);
  const neat = byId(pair, 'a-neat');
  const messy = byId(pair, 'b-messy');

  it('starts them in genuinely identical circumstances', () => {
    expect(neat.weights.hunger).toBe(messy.weights.hunger);
    for (const motive of MOTIVE_IDS) {
      expect(IDENTICAL_START[motive]).toBe(50);
    }
  });

  it('leaves one of them visibly filthy and the other visibly clean', () => {
    // Not a decimal place. Over twenty days these two live at hygiene levels
    // far enough apart that a viewer would not need it explained.
    expect(neat.meanMotives.hygiene - messy.meanMotives.hygiene).toBeGreaterThan(40);
  });

  it('leaves one of them entertained and the other bored', () => {
    expect(messy.meanMotives.fun - neat.meanMotives.fun).toBeGreaterThan(30);
  });

  it('does not, on its own, change the hours — and that is not a bug', () => {
    // Worth stating plainly, because it is the part of this model that surprises
    // people. At steady state the hours a motive costs are decay divided by
    // supply, and neither depends on a weight. Both characters shower about as
    // often; the messy one just lives seventy points lower between showers.
    //
    // Hours diverge only when a motive has more than one source to choose
    // between, or when the day is too short to serve them all. Both cases have
    // their own scenario below.
    expect(hoursOn(neat, 'take a shower')).toBeGreaterThan(0);
    expect(hoursOn(messy, 'take a shower')).toBeGreaterThan(0);
    expect(
      Math.abs(hoursOn(neat, 'take a shower') - hoursOn(messy, 'take a shower')),
    ).toBeLessThan(hoursOn(neat, 'take a shower'));
  });

  it('still has both of them eating and sleeping', () => {
    // Personality changes what is neglected, never whether the basics happen.
    for (const character of [neat, messy]) {
      expect(hoursOn(character, 'eat')).toBeGreaterThan(0);
      expect(hoursOn(character, 'sleep')).toBeGreaterThan(24);
      expect(character.meanMotives.hunger).toBeGreaterThan(0);
    }
  });
});

describe('the control: same personality, different random stream', () => {
  const pair = live([
    { id: 'a-twin', traits: FASTIDIOUS, motives: IDENTICAL_START },
    { id: 'b-twin', traits: FASTIDIOUS, motives: IDENTICAL_START },
  ]);
  const first = byId(pair, 'a-twin');
  const second = byId(pair, 'b-twin');

  const spread = (left: CharacterSummary, right: CharacterSummary): number => {
    let worst = 0;
    for (const motive of MOTIVE_IDS) {
      worst = Math.max(worst, Math.abs(left.meanMotives[motive] - right.meanMotives[motive]));
    }
    return worst;
  };

  it('produces two characters who live essentially the same week', () => {
    expect(spread(first, second)).toBeLessThan(10);
  });

  it('is dwarfed by the divergence personality produces', () => {
    // The comparison the whole file exists to make. If this ratio were near 1,
    // the divergence above would be noise wearing a personality's clothes.
    const noiseOnly = spread(first, second);

    const different = live([
      { id: 'a-neat', traits: FASTIDIOUS, motives: IDENTICAL_START },
      { id: 'b-messy', traits: SLOVENLY, motives: IDENTICAL_START },
    ]);
    const fromPersonality = spread(byId(different, 'a-neat'), byId(different, 'b-messy'));

    expect(fromPersonality).toBeGreaterThan(noiseOnly * 5);
  });

  it('is not merely two identical runs — the streams really do differ', () => {
    // Guards against the control passing because the two characters were
    // secretly the same object, or shared one random stream.
    expect(spread(first, second)).toBeGreaterThan(0);
  });
});

describe('when the day is too short for everything', () => {
  /**
   * The same objects, but motives now drain fast enough that keeping all six
   * topped up would take more than twenty-four hours. Something has to be given
   * up — and *what* gets given up is the loudest signal a personality has.
   */
  const SCARCE_DECAY = {
    hunger: 14,
    energy: 9,
    fun: 14,
    comfort: 14,
    hygiene: 7,
    // Nothing here satisfies social. Freeze it rather than leave an
    // unsatisfiable motive parked on the floor.
    social: 0,
  };

  const generousArmchair: Advertiser = {
    id: 'armchair',
    kind: 'object',
    interactions: [
      {
        id: 'sit',
        label: 'sit in the armchair',
        durationHours: 1,
        effects: { comfort: 60, energy: 10 },
        capacity: 4,
      },
    ],
  };

  /**
   * A second way to have fun, with the opposite cost profile to the piano.
   *
   * This is what actually makes hours diverge. One source per motive cannot: the
   * hours it takes are decay over supply for everybody. Two sources, one of
   * which is bought with energy and comfort, turns "how much do you care about
   * being comfortable" into a visible difference in how the afternoon is spent.
   */
  const crossword: Advertiser = {
    id: 'crossword',
    kind: 'object',
    interactions: [
      {
        id: 'solve',
        label: 'do the crossword',
        durationHours: 1,
        effects: { fun: 18, comfort: 14 },
        capacity: 4,
      },
    ],
  };

  const pressured = summariseRun(
    runSimulation({
      seed: 'scarcity',
      world: [
        ...SHARED_HOUSE.filter((advertiser) => advertiser.id !== 'armchair'),
        generousArmchair,
        crossword,
      ],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [
        { id: 'a-neat', traits: FASTIDIOUS, motives: IDENTICAL_START, decayRates: SCARCE_DECAY },
        { id: 'b-messy', traits: SLOVENLY, motives: IDENTICAL_START, decayRates: SCARCE_DECAY },
      ],
      days: 20,
    }),
  ).characters;

  const neat = byId(pressured, 'a-neat');
  const messy = byId(pressured, 'b-messy');

  it('leaves them short of time, which is what makes the choice real', () => {
    // If this is not true, the scenario is not testing what it claims to.
    for (const character of [neat, messy]) {
      expect(hoursOn(character, 'idle') / character.totalHours).toBeLessThan(0.15);
    }
  });

  it('makes them spend their days differently, not merely at different levels', () => {
    // Two ways to enjoy yourself, and they pick different ones. The languid,
    // playful one does the crossword all afternoon — gentle fun that is also
    // comfortable, which is what he cares about. The restless one, who minds
    // discomfort far less and boredom far less, ignores it until she is
    // genuinely bored and then gets it over with at the piano.
    expect(hoursOn(messy, 'do the crossword')).toBeGreaterThan(
      hoursOn(neat, 'do the crossword') * 1.4,
    );
    expect(hoursOn(neat, 'play the piano')).toBeGreaterThan(hoursOn(messy, 'play the piano') * 1.3);
  });

  it('still leaves one of them filthy and the other bored', () => {
    expect(neat.meanMotives.hygiene - messy.meanMotives.hygiene).toBeGreaterThan(50);
    expect(messy.meanMotives.fun - neat.meanMotives.fun).toBeGreaterThan(50);
  });

  it('still keeps both of them fed and rested', () => {
    for (const character of [neat, messy]) {
      expect(character.meanMotives.hunger).toBeGreaterThan(-20);
      expect(character.meanMotives.energy).toBeGreaterThan(-20);
    }
  });
});
