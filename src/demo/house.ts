/**
 * A demonstration house.
 *
 * PLACEHOLDER. The real world — rooms, placement, which objects exist, how far
 * apart they are — is #5. This file exists so the engine has something to be
 * watched running, which is the only way the three modelling bugs recorded below
 * were ever going to be found.
 *
 * **What replacing it costs, precisely.** Unit tests do not touch this file;
 * they use `src/testing/fixtures.ts`, which exists so that renaming a character
 * or rebalancing a sofa cannot turn the suite red. But `src/demo/` is not
 * free-standing:
 *
 *   - `cli.ts` imports this and `cast.ts`. Swap the imports and it keeps working.
 *   - `determinism.test.ts` runs `cli.ts` as a *subprocess* for its
 *     cross-process determinism check. That is deliberate — the check is worth
 *     having only if it exercises a real entry point — so deleting `src/demo/`
 *     outright means giving that test another one. Verified by doing it:
 *     typecheck stays clean and exactly those two tests fail.
 *
 * Earlier this comment said the directory could simply be deleted because
 * nothing outside it imported it. That was wrong, and the PR review caught it by
 * following the instruction literally: four TS2307s and two failed test files.
 * Recorded rather than quietly corrected, because a confident sentence pointing
 * the wrong way is worse than no sentence at all.
 *
 * The design rule these numbers follow, which is worth carrying into #5:
 *
 *   **No object may be good at everything.**
 *
 * A single object that pays out fun *and* comfort *and* social will beat every
 * specialist for every character, because the scores add up. One such object
 * quietly erases personality from the whole house: everyone watches television,
 * and the piano gathers dust no matter who is in the room. So the television
 * here is comfortable and sociable but only mildly fun; the piano is the best
 * fun in the house and costs energy and comfort to get; the armchair does one
 * thing well. Which of them a character reaches for is then a real statement
 * about who they are.
 */

import type { Advertiser } from '../advertisement';

export const DEMO_HOUSE: readonly Advertiser[] = [
  {
    id: 'fridge',
    kind: 'object',
    roomId: 'kitchen',
    interactions: [
      {
        id: 'raid',
        label: 'raid the fridge',
        durationHours: 0.5,
        // Fast and about half a meal. Cheap in time, poor value per point.
        effects: { hunger: 110, comfort: -6 },
        tags: ['food'],
      },
    ],
  },
  {
    id: 'stove',
    kind: 'object',
    roomId: 'kitchen',
    interactions: [
      {
        id: 'cook',
        label: 'cook a proper meal',
        durationHours: 1.25,
        // Slower, messier, and worth twice the fridge. Someone merely peckish
        // takes the snack; someone starving cooks.
        effects: { hunger: 100, fun: 10, hygiene: -10, comfort: -6 },
        tags: ['food'],
      },
    ],
  },
  {
    id: 'bed-north',
    kind: 'object',
    roomId: 'bedroom-north',
    interactions: [
      {
        id: 'sleep',
        label: 'sleep',
        durationHours: 7,
        // Six hours before "I am rested enough" can end it, which is what turns
        // a scattering of naps into a night. Six because that is where this
        // house's energy budget balances: 9 points lost per waking hour against
        // 27 net per sleeping hour puts the fixed point at six hours a day.
        minimumHours: 6,
        effects: { energy: 36, comfort: 5 },
        // You do get hungry in your sleep, but not at waking rates. Without
        // this every character wakes up starving every single morning.
        decayMultipliers: { hunger: 0.35, social: 0, fun: 0, hygiene: 0.4, comfort: 0 },
        tags: ['sleep'],
      },
    ],
  },
  {
    id: 'bed-south',
    kind: 'object',
    roomId: 'bedroom-south',
    interactions: [
      {
        id: 'sleep',
        label: 'sleep',
        durationHours: 7,
        // Six hours before "I am rested enough" can end it, which is what turns
        // a scattering of naps into a night. Six because that is where this
        // house's energy budget balances: 9 points lost per waking hour against
        // 27 net per sleeping hour puts the fixed point at six hours a day.
        minimumHours: 6,
        effects: { energy: 36, comfort: 5 },
        decayMultipliers: { hunger: 0.35, social: 0, fun: 0, hygiene: 0.4, comfort: 0 },
        tags: ['sleep'],
      },
    ],
  },
  {
    id: 'sofa',
    kind: 'object',
    roomId: 'living-room',
    interactions: [
      {
        id: 'nap',
        label: 'nap on the sofa',
        durationHours: 1.5,
        // Two beds, four characters. This is what the losers get, and what
        // anyone gets when there is not enough day left to justify seven hours.
        effects: { energy: 12, comfort: 14 },
        decayMultipliers: { hunger: 0.6, fun: 0.5 },
        tags: ['sleep', 'comfort'],
      },
    ],
  },
  {
    id: 'shower',
    kind: 'object',
    roomId: 'bathroom',
    interactions: [
      {
        id: 'shower',
        label: 'take a shower',
        durationHours: 0.5,
        effects: { hygiene: 120, comfort: 6, energy: 4 },
        tags: ['hygiene'],
      },
    ],
  },
  {
    id: 'tv',
    kind: 'object',
    roomId: 'living-room',
    interactions: [
      {
        id: 'watch',
        label: 'watch television',
        durationHours: 1.5,
        // Comfortable, faintly sociable, and only mildly fun. The default for
        // someone who wants to be near people and not exert themselves — and
        // deliberately *not* the best fun in the house, or nothing else here
        // would ever get used.
        effects: { fun: 10, comfort: 12, social: 10, energy: -3 },
        capacity: 2,
        tags: ['fun', 'social'],
      },
    ],
  },
  {
    id: 'bookshelf',
    kind: 'object',
    roomId: 'study',
    interactions: [
      {
        id: 'read',
        label: 'read a book',
        durationHours: 1,
        // Quiet fun. Better fun than television, no company at all.
        effects: { fun: 30, comfort: 6, energy: -8 },
        tags: ['fun'],
      },
    ],
  },
  {
    id: 'piano',
    kind: 'object',
    roomId: 'living-room',
    interactions: [
      {
        id: 'play',
        label: 'play the piano',
        durationHours: 0.75,
        // The best fun in the house by a distance, and it costs to get. Only a
        // character whose fun weight is high thinks that trade is worth making.
        effects: { fun: 48, energy: -14, comfort: -10 },
        tags: ['fun'],
      },
    ],
  },
  {
    id: 'armchair',
    kind: 'object',
    roomId: 'study',
    interactions: [
      {
        id: 'sit',
        label: 'sit in the armchair',
        durationHours: 1,
        // One thing, done well. Restless characters never touch it.
        effects: { comfort: 30, energy: 10 },
        tags: ['comfort'],
      },
    ],
  },
];
