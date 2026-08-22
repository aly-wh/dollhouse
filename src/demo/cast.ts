/**
 * A demonstration cast.
 *
 * PLACEHOLDER. Who lives in the house — names, trait values, memory, backstory —
 * is #6. These four exist to exercise the mechanism and to make the claim
 * "personality changes behaviour" checkable by looking rather than by reading an
 * assertion.
 *
 * They are deliberately near the corners of the trait space. A cast clustered
 * around neutral would still pass every assertion in this repo while producing
 * four characters who behave identically, which is the failure mode #6 should
 * design against.
 *
 * Replacing them costs one import in `cli.ts`. The unit tests use
 * `src/testing/fixtures.ts` and do not read this file — see the note on
 * `house.ts` for what deleting `src/demo/` wholesale would still break.
 *
 * All four start on identical motives. Every difference in how their days go is
 * therefore attributable to trait weights and to their own random streams, and
 * to nothing else.
 */

import type { CharacterSpec } from '../simulation';

const IDENTICAL_START = { hunger: 50, energy: 50, social: 50, fun: 50, hygiene: 50, comfort: 50 };

export const DEMO_CAST: readonly CharacterSpec[] = [
  {
    id: 'mara',
    name: 'Mara',
    // Fastidious and restless. Showers on schedule, never sits down, finds the
    // piano a waste of an afternoon.
    traits: { neat: 0.95, outgoing: 0.7, active: 0.8, playful: 0.15, nice: 0.8 },
    motives: IDENTICAL_START,
  },
  {
    id: 'dez',
    name: 'Dez',
    // The opposite corner. Plays until there is nothing left to enjoy, and only
    // then notices the state of himself.
    traits: { neat: 0.05, outgoing: 0.35, active: 0.4, playful: 0.95, nice: 0.5 },
    motives: IDENTICAL_START,
  },
  {
    id: 'juno',
    name: 'Juno',
    // Sociable above all. Will start a conversation with whoever is free.
    traits: { neat: 0.5, outgoing: 0.95, active: 0.5, playful: 0.5, nice: 0.9 },
    motives: IDENTICAL_START,
  },
  {
    id: 'wick',
    name: 'Wick',
    // Solitary and sedentary. Reads, sits, and is poor company by construction.
    traits: { neat: 0.6, outgoing: 0.05, active: 0.15, playful: 0.3, nice: 0.3 },
    motives: IDENTICAL_START,
  },
];
