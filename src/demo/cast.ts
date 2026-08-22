/**
 * A demonstration cast.
 *
 * PLACEHOLDER, still. Who lives in the house — names, trait values, memory,
 * backstory — is #6. These five exist to exercise the house and to make the
 * claim "personality changes behaviour" checkable by looking rather than by
 * reading an assertion.
 *
 * They sit near the corners of the trait space on purpose. A cast clustered
 * around neutral would pass every assertion in this repo while producing five
 * people who behave identically, which is the failure mode #6 should design
 * against.
 *
 * Everyone starts on identical motives, so every difference in how their days go
 * is attributable to trait weights, to where they woke up, and to their own
 * random stream — and to nothing else.
 *
 * **Starting rooms matter now.** Travel is real time in a real floor plan, so
 * where somebody wakes up biases their first hour. The two beds are given to
 * the two characters most likely to fight over them later; the rest start
 * downstairs, which is also what makes the first morning's bathroom queue
 * happen at all.
 *
 * The unit tests use `src/testing/fixtures.ts` and do not read this file. See
 * the header of `cli.ts` for what `src/demo/` still owes the test suite.
 */

import type { CharacterSpec } from '../simulation';

const IDENTICAL_START = { hunger: 50, energy: 50, social: 50, fun: 50, hygiene: 50, comfort: 50 };

export const DEMO_CAST: readonly CharacterSpec[] = [
  {
    id: 'mara',
    name: 'Mara',
    // Fastidious and restless. Showers on schedule, never sits down, finds the
    // piano a waste of an afternoon. The first person the hot water runs out on.
    traits: { neat: 0.95, outgoing: 0.7, active: 0.8, playful: 0.15, nice: 0.8 },
    motives: IDENTICAL_START,
    roomId: 'bedroom-north',
  },
  {
    id: 'dez',
    name: 'Dez',
    // The opposite corner. Plays until there is nothing left to enjoy and only
    // then notices the state of himself. Will happily wash at the basin.
    traits: { neat: 0.05, outgoing: 0.35, active: 0.4, playful: 0.95, nice: 0.5 },
    motives: IDENTICAL_START,
    roomId: 'bedroom-south',
  },
  {
    id: 'juno',
    name: 'Juno',
    // Sociable above all. Eats at the table when there is anyone to eat with and
    // reaches for the telephone when there is not.
    traits: { neat: 0.5, outgoing: 0.95, active: 0.5, playful: 0.5, nice: 0.9 },
    motives: IDENTICAL_START,
    roomId: 'living-room',
  },
  {
    id: 'wick',
    name: 'Wick',
    // Solitary and sedentary. Reads, sits, and is poor company by construction —
    // and starts in the study, three doorways from anywhere anybody else goes.
    traits: { neat: 0.6, outgoing: 0.05, active: 0.15, playful: 0.3, nice: 0.3 },
    motives: IDENTICAL_START,
    roomId: 'study',
  },
  {
    id: 'orla',
    name: 'Orla',
    // Middling on everything except restlessness. Exists to be the fifth person
    // in a house with two beds, which is the number that makes the beds matter.
    traits: { neat: 0.4, outgoing: 0.5, active: 0.9, playful: 0.6, nice: 0.6 },
    motives: IDENTICAL_START,
    roomId: 'kitchen',
  },
];
