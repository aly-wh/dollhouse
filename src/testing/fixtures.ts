/**
 * A house and a cast owned by the tests.
 *
 * These deliberately duplicate the shape of `src/demo/` rather than importing
 * it. The demo house and demo cast are placeholders that #5 and #6 will replace
 * with real content, and unit tests that reach into them would start failing the
 * moment someone renames a character or rebalances a sofa — a test suite that
 * breaks when unrelated content changes teaches people to ignore it.
 *
 * So: the demo exists to be *watched* and to be replaced. This exists to be
 * asserted against and to stay still. When #5 lands a real world, nothing in
 * this file needs to change.
 *
 * The one place a test still reaches into `src/demo/` is the cross-process
 * determinism check, which runs `src/demo/cli.ts` as a subprocess on purpose —
 * the point of that check is to exercise the actual shipped entry point, and a
 * private copy of it would not.
 */

import type { Advertiser } from '../advertisement';
import type { CharacterSpec } from '../simulation';

/**
 * Ten interactions across nine objects, with genuine trade-offs: two ways to
 * eat, two ways to sleep, two ways to have fun with opposing cost profiles.
 * Rich enough that seeds diverge and that the speed test is representative of a
 * real house rather than of one fridge.
 */
export const TEST_HOUSE: readonly Advertiser[] = [
  {
    id: 'fridge',
    kind: 'object',
    roomId: 'kitchen',
    interactions: [
      {
        id: 'raid',
        label: 'raid the fridge',
        durationHours: 0.5,
        effects: { hunger: 110, comfort: -6 },
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
        effects: { hunger: 100, fun: 10, hygiene: -10, comfort: -6 },
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
        minimumHours: 6,
        effects: { energy: 36, comfort: 5 },
        decayMultipliers: { hunger: 0.35, social: 0, fun: 0, hygiene: 0.4, comfort: 0 },
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
        minimumHours: 6,
        effects: { energy: 36, comfort: 5 },
        decayMultipliers: { hunger: 0.35, social: 0, fun: 0, hygiene: 0.4, comfort: 0 },
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
        effects: { energy: 12, comfort: 14 },
        decayMultipliers: { hunger: 0.6, fun: 0.5 },
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
        effects: { fun: 10, comfort: 12, social: 10, energy: -3 },
        capacity: 2,
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
        effects: { fun: 48, energy: -14, comfort: -10 },
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
        effects: { comfort: 30, energy: 10 },
      },
    ],
  },
];

/** Five characters spread across the trait space, all starting identically. */
export const TEST_CAST: readonly CharacterSpec[] = [
  {
    id: 'one',
    name: 'One',
    traits: { neat: 0.95, outgoing: 0.7, active: 0.8, playful: 0.15, nice: 0.8 },
    motives: { hunger: 50, energy: 50, social: 50, fun: 50, hygiene: 50, comfort: 50 },
  },
  {
    id: 'two',
    name: 'Two',
    traits: { neat: 0.05, outgoing: 0.35, active: 0.4, playful: 0.95, nice: 0.5 },
    motives: { hunger: 50, energy: 50, social: 50, fun: 50, hygiene: 50, comfort: 50 },
  },
  {
    id: 'three',
    name: 'Three',
    traits: { neat: 0.5, outgoing: 0.95, active: 0.5, playful: 0.5, nice: 0.9 },
    motives: { hunger: 50, energy: 50, social: 50, fun: 50, hygiene: 50, comfort: 50 },
  },
  {
    id: 'four',
    name: 'Four',
    traits: { neat: 0.6, outgoing: 0.05, active: 0.15, playful: 0.3, nice: 0.3 },
    motives: { hunger: 50, energy: 50, social: 50, fun: 50, hygiene: 50, comfort: 50 },
  },
  {
    id: 'five',
    name: 'Five',
    traits: { neat: 0.4, outgoing: 0.5, active: 0.9, playful: 0.6, nice: 0.6 },
    motives: { hunger: 50, energy: 50, social: 50, fun: 50, hygiene: 50, comfort: 50 },
  },
];
