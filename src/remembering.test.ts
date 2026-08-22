/**
 * Memory changing a decision, which is the acceptance criterion of #6 and the
 * one claim about memory that a store-level unit test cannot make.
 *
 * Each scenario here is built so that the *same* character, in the *same* world,
 * on the *same* seed, does something different depending only on what has
 * already happened to them. The control in every case is `memory: null`, which
 * is the engine exactly as it stood before this issue — so a scenario that would
 * have gone the same way regardless shows up as two identical runs.
 */

import { describe, expect, it } from 'vitest';

import type { Advertiser, CharacterView, WorldAdapter } from './advertisement';
import type { ActionStartedEvent, PlanBlockedEvent, RememberedEvent, SimEvent } from './events';
import { runSimulation, type CharacterSpec, type CharacterState, type SimulationResult } from './simulation';

const meanMotive = (character: CharacterState, motive: 'hunger'): number =>
  character.motiveHourSums[motive] / character.accumulatedHours;

const blockedAt = (events: readonly SimEvent[], advertiserId: string): PlanBlockedEvent[] =>
  events.filter(
    (event): event is PlanBlockedEvent =>
      event.kind === 'plan_blocked' && event.advertiserId === advertiserId,
  );

const startsOf = (events: readonly SimEvent[], label: string): ActionStartedEvent[] =>
  events.filter(
    (event): event is ActionStartedEvent => event.kind === 'action_started' && event.label === label,
  );

const rememberedAbout = (events: readonly SimEvent[], targetId: string): RememberedEvent[] =>
  events.filter(
    (event): event is RememberedEvent => event.kind === 'remembered' && event.targetId === targetId,
  );

// ---------------------------------------------------------------------------
// A larder that is always empty by the time you get there
// ---------------------------------------------------------------------------

/**
 * Two ways to eat and a reason to keep coming home.
 *
 * The larder across the hall is twice the meal the bowl in the hall is, and it
 * is withdrawn on alternate ticks — so a character who sets off for it on the
 * tick it was advertised arrives, one tick later, to find it gone. Every single
 * time. That is deliberately the extreme of the shipped house's real case, the
 * last portion going while somebody was walking to the kitchen, because the
 * question under test is what the *walker* learns and an intermittent larder
 * would mix learning with luck. The shipped-house version, where the same
 * mechanism runs against a real cast and a real hot-water tank, is
 * `src/cast/dollhouse.test.ts`.
 *
 * The cot is what makes the scenario repeat. Without something in the hall that
 * only the hall can give, a character who once reached the store would simply
 * live there, and there would be one journey in the whole run to have an opinion
 * about.
 *
 * Written as a toggle rather than a second character on purpose: a housemate
 * competing for the larder would put *their* decisions inside the measurement.
 */
class FlakyLarder implements WorldAdapter {
  private ticks = 0;

  private readonly bowl: Advertiser = {
    id: 'bowl',
    kind: 'object',
    roomId: 'hall',
    interactions: [
      { id: 'pick', label: 'pick at the bowl', durationHours: 0.5, effects: { hunger: 74 } },
    ],
  };

  private readonly cot: Advertiser = {
    id: 'cot',
    kind: 'object',
    roomId: 'hall',
    interactions: [{ id: 'rest', label: 'lie down', durationHours: 1, effects: { energy: 70 } }],
  };

  private readonly larder: Advertiser = {
    id: 'larder',
    kind: 'object',
    roomId: 'store',
    interactions: [
      { id: 'raid', label: 'raid the larder', durationHours: 0.5, effects: { hunger: 150 } },
    ],
  };

  listAdvertisers(): readonly Advertiser[] {
    return this.ticks % 2 === 0
      ? [this.bowl, this.cot, this.larder]
      : [this.bowl, this.cot];
  }

  travelHours(character: CharacterView, advertiser: Advertiser): number {
    return character.roomId === advertiser.roomId ? 0 : 0.25;
  }

  advance(): void {
    this.ticks += 1;
  }
}

const eater: CharacterSpec = {
  id: 'a',
  name: 'A',
  roomId: 'hall',
  motives: { hunger: 40, energy: 40, social: 100, fun: 100, hygiene: 100, comfort: 100 },
  // Two motives and no more, so the run is about one question.
  decayRates: { hunger: 25, energy: 14, social: 0, fun: 0, hygiene: 0, comfort: 0 },
};

function runLarder(memory: null | undefined): SimulationResult {
  return runSimulation({
    seed: 'larder',
    world: new FlakyLarder(),
    characters: [eater],
    days: 12,
    socialInteraction: null,
    snapshotEveryTicks: 0,
    memory,
  });
}

describe('a character who keeps finding the larder empty', () => {
  const withMemory = runLarder(undefined);
  const without = runLarder(null);

  it('walks over there and is disappointed, to begin with', () => {
    expect(blockedAt(withMemory.events, 'larder').length).toBeGreaterThan(10);
  });

  it('wastes half as many journeys on it as the same character with no memory', () => {
    // The claim, in one comparison: same seed, same world, same character. The
    // only difference is whether what happened to them yesterday is allowed to
    // reach today's score.
    const learned = blockedAt(withMemory.events, 'larder').length;
    const blind = blockedAt(without.events, 'larder').length;
    expect(learned, `wasted trips: ${learned} with memory, ${blind} without`).toBeLessThan(
      blind * 0.65,
    );
  });

  it('and is better fed for it, not worse', () => {
    // A grudge that made somebody go hungry would be a bug dressed as a
    // personality. The hours not spent walking to an empty larder are hours
    // spent eating out of the bowl, so the cautious version of this character is
    // measurably better off than the one that never learns.
    expect(startsOf(withMemory.events, 'pick at the bowl').length).toBeGreaterThan(100);
    expect(meanMotive(withMemory.characters[0]!, 'hunger')).toBeGreaterThan(
      meanMotive(without.characters[0]!, 'hunger'),
    );
  });

  it('carries the opinion across ticks rather than recomputing it', () => {
    const trail = rememberedAbout(withMemory.events, 'larder');
    expect(trail.length).toBeGreaterThan(6);

    // Persistence, stated as a property of the log. Each reported value is the
    // running total, so within a run of bad luck it deepens across ticks that
    // are hours apart. Nothing recomputed from the current tick could do this.
    let deepened = false;
    for (let index = 1; index < trail.length; index += 1) {
      const previous = trail[index - 1]!;
      const current = trail[index]!;
      if (current.value < previous.value && current.tick > previous.tick) deepened = true;
    }
    expect(deepened, 'an opinion that got worse on a later tick').toBe(true);

    // And forgetting, from the same trail: a later grudge that starts shallower
    // than the deepest one already reached is a character who had got over it.
    const deepest = Math.min(...trail.map((event) => event.value));
    const lastIndex = trail.findIndex((event) => event.value === deepest);
    expect(deepest).toBeLessThan(-0.35);
    expect(trail.slice(lastIndex + 1).some((event) => event.value > deepest + 0.1)).toBe(true);
  });

  it('never loses a disappointment out of the log', () => {
    // Every wasted journey leaves a line, whatever the arithmetic did. A grudge
    // that happens to land back on the last reported value is still a grudge,
    // and a log that quietly drops it tells a story with a hole in it.
    const blocked = blockedAt(withMemory.events, 'larder');
    const written = rememberedAbout(withMemory.events, 'larder').filter(
      (event) => event.cause === 'unavailable',
    );
    expect(written.length).toBe(blocked.length);
  });

  it('changes nothing at all when memory is switched off', () => {
    expect(without.events.some((event) => event.kind === 'remembered')).toBe(false);
    // And the control really is a different run, not the same one relabelled.
    expect(JSON.stringify(without.events)).not.toBe(JSON.stringify(withMemory.events));
  });
});

// ---------------------------------------------------------------------------
// Who you would rather talk to
// ---------------------------------------------------------------------------

/** One room, nothing in it. The only thing anybody can do here is talk. */
const emptyRoom: WorldAdapter = {
  listAdvertisers: () => [],
  travelHours: () => 0,
};

/** The same room, with something in it worth breaking off a conversation for. */
const roomWithAFridge: WorldAdapter = {
  listAdvertisers: () => [
    {
      id: 'fridge',
      kind: 'object',
      roomId: 'parlour',
      interactions: [
        { id: 'eat', label: 'eat', durationHours: 0.5, effects: { hunger: 150 } },
      ],
    },
  ],
  travelHours: () => 0,
};

const talker = (
  id: string,
  relationships?: readonly (readonly [string, number])[],
): CharacterSpec => ({
  id,
  name: id,
  roomId: 'parlour',
  motives: { hunger: 100, energy: 100, social: -20, fun: 100, hygiene: 100, comfort: 100 },
  decayRates: { hunger: 0, energy: 0, fun: 0, hygiene: 0, comfort: 0 },
  traits: { outgoing: 0.8, nice: 0.5 },
  relationships,
});

function runParlour(memory: null | undefined): SimulationResult {
  return runSimulation({
    seed: 'parlour',
    world: emptyRoom,
    // B and C are identical in every respect except what A already thinks of
    // them, so nothing but the relationship can decide which one A turns to.
    characters: [talker('a', [['b', 0.6], ['c', -0.6]]), talker('b'), talker('c')],
    days: 6,
    snapshotEveryTicks: 0,
    memory,
  });
}

const conversationsWith = (events: readonly SimEvent[], partnerId: string): number =>
  events.filter(
    (event) =>
      event.kind === 'conversation_started' &&
      event.initiatorId === 'a' &&
      event.partnerId === partnerId,
  ).length;

describe('a relationship decides who gets talked to', () => {
  const withMemory = runParlour(undefined);
  const without = runParlour(null);

  it('sends the character to the housemate they like', () => {
    const liked = conversationsWith(withMemory.events, 'b');
    const disliked = conversationsWith(withMemory.events, 'c');
    expect(liked, `${liked} with the one she likes, ${disliked} with the one she does not`)
      .toBeGreaterThan(disliked * 2);
  });

  it('and with memory off the same two are indistinguishable', () => {
    const liked = conversationsWith(without.events, 'b');
    const disliked = conversationsWith(without.events, 'c');
    const ratio = Math.max(liked, disliked) / Math.max(1, Math.min(liked, disliked));
    expect(ratio, `split between two identical housemates: ${liked} / ${disliked}`).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Relationships move, and they move both ways
// ---------------------------------------------------------------------------

describe('being walked out on', () => {
  /**
   * B is ravenous and the fridge is in the room, so B keeps breaking off
   * conversations the moment hunger crosses into distress. A, who never gets
   * hungry, is left standing there each time.
   *
   * The pair still talk a great deal — B is sociable and keeps coming back — so
   * this is not a scenario where the bond simply falls. It is one where the same
   * bond is being pushed up by the conversations that land and down by the ones
   * that do not, which is the only honest way to check that both directions
   * work.
   */
  const abandoned = runSimulation({
    seed: 'walkout',
    world: roomWithAFridge,
    characters: [
      talker('a'),
      {
        ...talker('b'),
        motives: { hunger: -60, energy: 100, social: -20, fun: 100, hygiene: 100, comfort: 100 },
        decayRates: { hunger: 120, energy: 0, fun: 0, hygiene: 0, comfort: 0 },
      },
    ],
    days: 6,
    snapshotEveryTicks: 4,
  });

  /** A's opinion of B, hour by hour, straight out of the log. */
  const series: number[] = [];
  for (const event of abandoned.events) {
    if (event.kind !== 'snapshot') continue;
    const a = event.characters.find((character) => character.id === 'a');
    const bond = a?.bonds.find(([id]) => id === 'b');
    if (bond) series.push(bond[1]);
  }

  it('is remembered against the person who did it, not against the conversation', () => {
    const grudges = rememberedAbout(abandoned.events, 'b').filter(
      (event) => event.characterId === 'a' && event.cause === 'walked_out',
    );
    expect(grudges.length).toBeGreaterThan(0);
    for (const grudge of grudges) expect(grudge.delta).toBeLessThan(0);
  });

  it('moves the same bond down as well as up, over one run', () => {
    // The criterion, stated in the plainest terms available: read one number out
    // of the log for six simulated days and check it goes both ways. A model
    // that only ever improves produces no drama, and this is what rules it out.
    expect(series.length).toBeGreaterThan(20);
    let rose = 0;
    let fell = 0;
    for (let index = 1; index < series.length; index += 1) {
      if (series[index]! > series[index - 1]!) rose += 1;
      if (series[index]! < series[index - 1]!) fell += 1;
    }
    expect(rose, 'hours on which A thought better of B').toBeGreaterThan(0);
    expect(fell, 'hours on which A thought worse of B').toBeGreaterThan(0);
  });

  it('leaves the two of them holding different opinions of each other', () => {
    // The reason a bond is stored per direction rather than per pair. A minds;
    // B has not noticed. A model with one number could not say that.
    const [a, b] = abandoned.characters;
    expect(b!.memory!.bondWith('a')).toBeGreaterThan(a!.memory!.bondWith('b') + 0.2);
  });
});

describe('a conversation that runs its course', () => {
  const friendly = runSimulation({
    seed: 'friendly',
    world: emptyRoom,
    characters: [talker('a'), talker('b')],
    days: 4,
    snapshotEveryTicks: 0,
  });

  it('moves the bond upwards, so a relationship is not a one-way ratchet down', () => {
    const [a, b] = friendly.characters;
    expect(a!.memory!.bondWith('b')).toBeGreaterThan(0);
    expect(b!.memory!.bondWith('a')).toBeGreaterThan(0);
    expect(
      friendly.events.some(
        (event) => event.kind === 'remembered' && event.cause === 'talked' && event.value > 0,
      ),
    ).toBe(true);
  });

  it('credits each side by how pleasant the other one is', () => {
    // `nice` is read off the partner, so the charming one is liked more than
    // they like. This is the only place a trait acts on somebody else's model.
    const mixed = runSimulation({
      seed: 'friendly',
      world: emptyRoom,
      characters: [
        { ...talker('a'), traits: { outgoing: 0.8, nice: 0.95 } },
        { ...talker('b'), traits: { outgoing: 0.8, nice: 0.05 } },
      ],
      days: 4,
      snapshotEveryTicks: 0,
    });
    const [a, b] = mixed.characters;
    expect(b!.memory!.bondWith('a')).toBeGreaterThan(a!.memory!.bondWith('b'));
  });
});

describe('the memory a run ends with', () => {
  it('is in the log as well as in the state, so a recorded run can be read alone', () => {
    const run = runSimulation({
      seed: 'friendly',
      world: emptyRoom,
      characters: [talker('a'), talker('b')],
      days: 2,
      snapshotEveryTicks: 4,
    });
    const snapshots = run.events.filter((event) => event.kind === 'snapshot');
    const last = snapshots[snapshots.length - 1]!;
    expect(last.kind).toBe('snapshot');
    if (last.kind !== 'snapshot') return;
    expect(last.characters[0]!.bonds.length).toBeGreaterThan(0);
    expect(last.characters[0]!.bonds[0]![0]).toBe('b');
  });

  it('is absent from the log when the run had no memory', () => {
    const run = runSimulation({
      seed: 'friendly',
      world: emptyRoom,
      characters: [talker('a'), talker('b')],
      days: 2,
      snapshotEveryTicks: 4,
      memory: null,
    });
    for (const event of run.events) {
      if (event.kind === 'snapshot') expect(event.characters[0]!.bonds).toEqual([]);
    }
  });
});

describe('configuration', () => {
  it('refuses a relationship with somebody who is not in the house', () => {
    expect(() =>
      runSimulation({
        seed: 'x',
        world: emptyRoom,
        characters: [talker('a', [['nobody', 0.5]])],
        ticks: 1,
      }),
    ).toThrow(/unknown character: nobody/);
  });

  it('refuses a relationship with oneself', () => {
    expect(() =>
      runSimulation({
        seed: 'x',
        world: emptyRoom,
        characters: [talker('a', [['a', 0.5]])],
        ticks: 1,
      }),
    ).toThrow(/relationship with themselves/);
  });
});
