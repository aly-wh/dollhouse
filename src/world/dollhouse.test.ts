/**
 * The house this repo ships, held to the criterion the whole issue turns on.
 *
 * These read `worlds/dollhouse.json` rather than a fixture on purpose. The
 * criterion is a claim about the *shipped content*, and a test that checks a
 * private copy of the content proves nothing about the file anybody edits. This
 * is the one place in the suite where that trade is worth making: rebalancing a
 * sofa may legitimately turn these red, and when it does, the balance is wrong
 * rather than the test.
 */

import { describe, expect, it } from 'vitest';

import { MOTIVE_IDS } from '../motives';
import { DEFAULT_SOCIAL_INTERACTION } from '../simulation';
import {
  auditMotiveSources,
  emptyPromises,
  generalists,
  STRONG_SOURCE_PER_HOUR,
  type AuditableOffer,
} from './audit';
import { House } from './house';
import { loadWorldFile } from './load';

const config = loadWorldFile();
const house = new House(config);

/** The house's own objects. What this issue is responsible for. */
const houseOffers: AuditableOffer[] = house.allOffers().map((offer) => ({
  advertiserId: offer.objectId,
  interaction: offer.interaction,
  consumes: offer.config.consumes,
  produces: offer.config.produces,
}));

/**
 * Everything a character can actually be offered, housemates included.
 *
 * Talking to each other is a real source of `social` with a real cost profile;
 * it simply is not an object, so it is not in the world file. Auditing without
 * it under-counts `social` and would let a house ship that had genuinely only
 * one way to be sociable.
 */
const allOffers: AuditableOffer[] = [
  ...houseOffers,
  { advertiserId: '(each other)', interaction: DEFAULT_SOCIAL_INTERACTION },
];

describe('the file loads and is a house', () => {
  it('has rooms, objects and things that run out', () => {
    expect(config.rooms.length).toBeGreaterThanOrEqual(5);
    expect(config.objects.length).toBeGreaterThanOrEqual(10);
    expect(config.resources.length).toBeGreaterThanOrEqual(2);
  });

  it('has at least one room with nothing in it', () => {
    // A landing is a room. Rooms are places, not containers, and a floor plan
    // that cannot express a corridor is not a floor plan.
    const occupied = new Set(config.objects.map((object) => object.room));
    expect(config.rooms.some((room) => !occupied.has(room.id))).toBe(true);
  });

  it('puts more than one object in some rooms, so staying put is sometimes an option', () => {
    const counts = new Map<string, number>();
    for (const object of config.objects) {
      counts.set(object.room, (counts.get(object.room) ?? 0) + 1);
    }
    expect([...counts.values()].some((count) => count > 1)).toBe(true);
  });
});

describe('every motive has at least two sources with different side-effects', () => {
  // The criterion. Not a style preference: at steady state a motive costs
  // decay divided by supply and no weight appears in it, so a motive with one
  // source is a motive on which personality cannot show. #4's house had exactly
  // that, and produced four characters who showered 5.1 to 5.2 per cent of the
  // time across an eightfold spread in how much they cared.
  const audits = auditMotiveSources(allOffers);

  for (const motive of MOTIVE_IDS) {
    it(`${motive} has two or more`, () => {
      const audit = audits.find((entry) => entry.motive === motive);
      expect(audit, motive).toBeDefined();
      expect(audit!.sources.length, `${motive} sources`).toBeGreaterThanOrEqual(2);
      expect(
        audit!.distinctSignatures.length,
        `${motive} sources differ only in name: ${audit!.distinctSignatures.join(' | ')}`,
      ).toBeGreaterThanOrEqual(2);
    });
  }

  it('and the sources really are different, not the same object twice', () => {
    // Two beds are one source wearing two hats. The check is on the cost
    // profile, not on the object count, and this asserts the check can tell.
    const sleep = audits.find((entry) => entry.motive === 'energy')!;
    const beds = sleep.sources.filter((source) => source.interactionId === 'sleep');
    expect(beds.length).toBe(2);
    expect(new Set(beds.map((source) => source.signature)).size).toBe(1);
  });
});

describe('no object is good at everything', () => {
  it('is a strong source of at most one motive', () => {
    // On #4's house a television paid fun and comfort and social at once. The
    // scores add, so it beat every specialist for every character, and four
    // people collapsed into one.
    expect(generalists(allOffers)).toEqual([]);
  });

  it('and the check has teeth', () => {
    const cheat: AuditableOffer = {
      advertiserId: 'wonder-chair',
      interaction: {
        id: 'lounge',
        label: 'the everything chair',
        durationHours: 1,
        effects: { fun: STRONG_SOURCE_PER_HOUR + 1, comfort: STRONG_SOURCE_PER_HOUR + 1 },
      },
    };
    expect(generalists([...allOffers, cheat])).toHaveLength(1);
  });
});

describe('no object promises more than it can deliver', () => {
  it('every positive effect in the house clears its decay rate', () => {
    // Scoring values an interaction at its advertised gain, and decay runs the
    // whole time it happens. The first version of this house had a sofa paying
    // twelve comfort an hour against a decay of nine: characters lay on it five
    // times a day and their comfort never moved.
    const weak = emptyPromises(houseOffers);
    expect(
      weak.map((entry) => `${entry.label}: ${entry.motive} +${entry.perHour}/h vs ${entry.effectiveDecay}/h`),
    ).toEqual([]);
  });

  it('and the check has teeth', () => {
    const cheat: AuditableOffer = {
      advertiserId: 'sad-sofa',
      interaction: {
        id: 'perch',
        label: 'perch',
        durationHours: 1,
        effects: { comfort: 10 },
      },
    };
    expect(emptyPromises([cheat])).toHaveLength(1);
  });

  it('counts a suspended decay rate as suspended', () => {
    // Sleep pays five comfort an hour and stops comfort decaying at all. Five an
    // hour against nothing is five an hour, and condemning it would be wrong.
    const sleeping = houseOffers.find((offer) => offer.interaction.id === 'sleep');
    expect(sleeping?.interaction.effects.comfort).toBeLessThan(9);
    expect(emptyPromises([sleeping!])).toEqual([]);
  });
});

describe('resources', () => {
  it('has at least one that nothing refills on its own', () => {
    // Something the house has to make for itself is what turns a resource into
    // a reason for somebody to do a chore.
    expect(config.resources.some((resource) => resource.regenPerHour === 0)).toBe(true);
  });

  it('has something that both spends and makes, so a chore exists', () => {
    const makers = house
      .allOffers()
      .filter((offer) => (offer.config.produces?.length ?? 0) > 0);
    expect(makers.length).toBeGreaterThan(0);
    for (const maker of makers) {
      expect(maker.config.consumes?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('has a fallback for every resource an interaction needs', () => {
    // If the only way to get clean needs hot water, an empty tank is a motive
    // with no source at all rather than a motive with an expensive source.
    for (const motive of MOTIVE_IDS) {
      const sources = auditMotiveSources(allOffers).find((entry) => entry.motive === motive)!.sources;
      if (sources.length === 0) continue;
      const free = sources.filter((source) => {
        const offer = allOffers.find(
          (candidate) =>
            candidate.advertiserId === source.advertiserId &&
            candidate.interaction.id === source.interactionId,
        );
        return (offer?.consumes?.length ?? 0) === 0;
      });
      expect(free.length, `${motive} has no source that survives an empty store`).toBeGreaterThan(0);
    }
  });
});
