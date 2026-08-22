/**
 * The house as the engine sees it: a list of offers that changes, and a distance.
 */

import { describe, expect, it } from 'vitest';

import { House } from './house';
import { parseWorldConfig, type WorldConfig } from './config';

const CONFIG: WorldConfig = parseWorldConfig({
  id: 'test',
  name: 'Test house',
  entryRoom: 'hall',
  travel: { hoursPerHop: 0.1, discountPerHour: 3 },
  rooms: [
    { id: 'hall', name: 'Hall', exits: ['kitchen', 'bathroom'] },
    { id: 'kitchen', name: 'Kitchen', exits: [] },
    { id: 'bathroom', name: 'Bathroom', exits: [] },
  ],
  resources: [
    { id: 'food', label: 'food in the fridge', capacity: 6, initial: 2, regenPerHour: 0 },
    { id: 'water', label: 'hot water', capacity: 50, initial: 0, regenPerHour: 10 },
  ],
  objects: [
    {
      id: 'fridge',
      name: 'the fridge',
      room: 'kitchen',
      interactions: [
        {
          id: 'raid',
          label: 'raid the fridge',
          durationHours: 0.5,
          effects: [['hunger', 100]],
          consumes: [['food', 1]],
        },
      ],
    },
    {
      id: 'stove',
      name: 'the stove',
      room: 'kitchen',
      interactions: [
        {
          id: 'cook',
          label: 'cook',
          durationHours: 1,
          effects: [['hunger', 60]],
          produces: [['food', 3]],
        },
      ],
    },
    {
      id: 'shower',
      name: 'the shower',
      room: 'bathroom',
      interactions: [
        {
          id: 'wash',
          label: 'take a shower',
          durationHours: 0.5,
          effects: [['hygiene', 100]],
          consumes: [['water', 25]],
        },
      ],
    },
  ],
});

const house = (): House => new House(CONFIG);

function offered(subject: House): string[] {
  const ids: string[] = [];
  for (const advertiser of subject.listAdvertisers()) {
    for (const interaction of advertiser.interactions) ids.push(`${advertiser.id}#${interaction.id}`);
  }
  return ids.sort();
}

describe('what the house is offering', () => {
  it('leaves out anything it cannot pay for', () => {
    // The tank starts empty, so the shower is not in the house at all. The
    // engine is never offered something it would have to be refused.
    expect(offered(house())).toEqual(['fridge#raid', 'stove#cook']);
  });

  it('brings it back when the resource returns', () => {
    const subject = house();
    subject.advance(2.5);
    expect(offered(subject)).toContain('shower#wash');
  });

  it('takes an object off the list when its last interaction becomes unaffordable', () => {
    const subject = house();
    subject.onActionStarted({ characterId: 'a', advertiserId: 'fridge', interactionId: 'raid' });
    subject.onActionStarted({ characterId: 'b', advertiserId: 'fridge', interactionId: 'raid' });
    expect(subject.resources.value('food')).toBe(0);
    expect(offered(subject)).toEqual(['stove#cook']);
  });

  it('hands back the same array while nothing has changed', () => {
    // Called for every character on every tick; rebuilding it each time is the
    // most expensive thing the world could do.
    const subject = house();
    expect(subject.listAdvertisers()).toBe(subject.listAdvertisers());
    subject.advance(5);
    expect(subject.listAdvertisers()).not.toBe(offered(subject));
  });
});

describe('spending and making', () => {
  it('spends at the start, in full', () => {
    const subject = house();
    subject.onActionStarted({ characterId: 'a', advertiserId: 'fridge', interactionId: 'raid' });
    expect(subject.resources.value('food')).toBe(1);
  });

  it('does not put it back when the action is abandoned', () => {
    // You took it out of the fridge. Being dragged away does not un-take it.
    const subject = house();
    subject.onActionStarted({ characterId: 'a', advertiserId: 'fridge', interactionId: 'raid' });
    subject.onActionEnded({
      characterId: 'a',
      advertiserId: 'fridge',
      interactionId: 'raid',
      reason: 'interrupted',
    });
    expect(subject.resources.value('food')).toBe(1);
  });

  it('pays out only when the action ran to completion', () => {
    const subject = house();
    for (const reason of ['interrupted', 'satisfied', 'partner_left'] as const) {
      subject.onActionStarted({ characterId: 'a', advertiserId: 'stove', interactionId: 'cook' });
      subject.onActionEnded({ characterId: 'a', advertiserId: 'stove', interactionId: 'cook', reason });
    }
    expect(subject.resources.value('food')).toBe(2);

    subject.onActionStarted({ characterId: 'a', advertiserId: 'stove', interactionId: 'cook' });
    subject.onActionEnded({
      characterId: 'a',
      advertiserId: 'stove',
      interactionId: 'cook',
      reason: 'finished',
    });
    expect(subject.resources.value('food')).toBe(5);
  });

  it('ignores anything it did not advertise', () => {
    // Conversations and walks are the engine's inventions, and it hands them
    // over the same way. Ignoring them is deliberate, not defensive.
    const subject = house();
    expect(() => {
      subject.onActionStarted({ characterId: 'a', advertiserId: 'juno', interactionId: 'talk' });
      subject.onActionStarted({
        characterId: 'a',
        advertiserId: 'fridge',
        interactionId: 'walk:fridge#raid',
      });
    }).not.toThrow();
    expect(subject.resources.value('food')).toBe(2);
  });
});

describe('distance', () => {
  const subject = house();
  const fridge = { id: 'fridge', kind: 'object' as const, roomId: 'kitchen', interactions: [] };

  it('is free where you are standing', () => {
    expect(subject.travelHours({ id: 'a', roomId: 'kitchen' }, fridge)).toBe(0);
  });

  it('counts doorways', () => {
    expect(subject.travelHours({ id: 'a', roomId: 'bathroom' }, fridge)).toBeCloseTo(0.2, 10);
  });

  it('works for a person as well as for a piano', () => {
    const juno = { id: 'juno', kind: 'character' as const, roomId: 'bathroom', interactions: [] };
    expect(subject.travelHours({ id: 'a', roomId: 'kitchen' }, juno)).toBeCloseTo(0.2, 10);
  });

  it('offers its own view of how much distance should put people off', () => {
    expect(subject.scoringOverrides()).toEqual({ travelDiscountPerHour: 3 });
    const quiet = new House({ ...CONFIG, travel: { hoursPerHop: 0.1 } });
    expect(quiet.scoringOverrides()).toEqual({});
  });
});

describe('describing itself for the log', () => {
  it('names every room, object and resource', () => {
    const described = house().describe();
    expect(described.rooms.map((room) => room.id).sort()).toEqual(['bathroom', 'hall', 'kitchen']);
    expect(described.objects.map((object) => object.roomId).sort()).toEqual([
      'bathroom',
      'kitchen',
      'kitchen',
    ]);
    expect(described.resources.map((resource) => resource.id)).toEqual(['food', 'water']);
  });

  it('reports doors as the graph sees them, from both sides', () => {
    const described = house().describe();
    const kitchen = described.rooms.find((room) => room.id === 'kitchen');
    // The file only writes this door from the hall's side.
    expect(kitchen?.exits).toEqual(['hall']);
  });
});
