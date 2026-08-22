# DollHouse

A cutaway house full of agents who don't know you're watching.

**Status: pre-MVP.** The simulation engine and the house run; there is no replayer, no art, and
no dialogue yet.

## What it is

A small society of LLM-driven characters shares one house — names, distinct personalities, and
persistent memory of what happened to them. A generator runs the simulation offline and emits a
JSON event log. A static page replays that log in the browser, with each agent's reasoning
visible on screen.

## The question the first build exists to answer

> Will anyone watch this for more than ten minutes?

Agent societies have been built and they work. What none of them had was an audience. That's the
unproven part, so it's the only part the first build tests.

## Shape

- **Generator** — Node, runs offline, tick-based, writes a JSON event log.
- **Replayer** — static page with a timeline. No server, no runtime cost.
- **Graphics deliberately ugly.** Art is not what is being tested, and polishing it early would
  disguise a failed result as a promising one.

## Running the simulation engine

Node **20.19+**, **22.12+**, or **24+** — then `npm install`.

Check `node -v` first. If you use nvm, `nvm use` picks up the pinned version from
`.nvmrc` with no argument. If your Node is below the floor, `npm ci` will refuse
outright and name the version it needs — `.npmrc` sets `engine-strict` so that
`engines` is a gate rather than a suggestion.

The floor comes from the dependency tree, not from anything in `src/`: seventeen
lockfile packages require `^20.19.0 || >=22.12.0`, and below Node 20.12 `npm ci`
succeeds and `npm test` then dies with a missing `styleText` export nowhere near
the real cause. CI pins both floors, so the number above is exercised rather than
asserted — keep it in step with `engines` in `package.json`.

```
npm test          # unit tests
npm run typecheck # tsc --noEmit
npm run demo      # run the demo house and print what happened
```

The demo takes `--seed`, `--days`, `--world`, `--cast`, and
`--format text|summary|timeline|json|audit|behaviour`. `--format json` writes the
raw event log to stdout and is byte-stable for a given seed, so two runs can be
diffed; timing goes to stderr to keep it out of the diff.

```
npm run demo -- --seed alpha --days 10 --format summary
npm run demo -- --seed alpha --days 2 --format timeline --characters dez
npm run demo -- --format audit
npm run demo -- --days 30 --format behaviour
npm run demo -- --world worlds/dollhouse.json --cast casts/dollhouse.json --days 4
```

Characters choose what to do by arithmetic over motives — no model is called
anywhere in the simulation loop, and a test enforces it. Dialogue is the only
place inference is ever spent, and it is not built yet.

## The house

The world is data, not code: `worlds/dollhouse.json` holds the rooms, the doors
between them, the objects and what each one advertises, and the stores that run
out. Adding a room or an object is an edit to that file. `--world <path>` runs a
different one.

Three things about it are load-bearing, and all three were learned the hard way:

- **Every motive has at least two sources with different side-effects.** At
  steady state a motive costs decay divided by supply, and no personality weight
  appears anywhere in that. Weights decide *which* source somebody reaches for,
  so a motive with one source is a motive on which personality cannot show at
  all. `npm run demo -- --format audit` checks it, and so does the test suite.
- **No object is good at everything.** An object paying two motives strongly
  beats every specialist for every character, because the scores add. One of
  those quietly erases personality from the whole house.
- **Nothing may advertise less than it delivers.** Decay runs while an action
  runs, so an object paying twelve comfort an hour in a house where comfort falls
  nine an hour nets three. The audit reports those too.

Things run out. The tank holds two showers and a bath, and refills slowly enough
that whoever takes the bath is a decision the rest of the house pays for; the
fridge holds only what somebody last cooked, and cooking is a seventy-five-minute
chore you cannot walk away from, which leaves the cook dirtier than they started
and the leftovers available to anybody. Who cooks, who raids, and who ends up at
the basin is most of what there is to watch.

The supply side is calibrated against a **thirty-day** run, not a six-day one.
Six days is still the descent from the starting motives, and a house that looks
fine over six days can be losing ground on every axis at once for the next
twenty-four. `npm run demo -- --days 30 --format behaviour` is the check, and
`src/world/behaviour.test.ts` asserts it.

## The cast

The people are data too: `casts/dollhouse.json` holds five characters — traits,
starting motives, the room each wakes up in, and how each one feels about the
others. Adding a sixth is an entry in that file and nothing else. `--cast <path>`
runs a different one.

Two things in there are worth knowing before editing it.

**Relationships are directed.** `mara -> dez` and `dez -> mara` are separate
numbers, so the file can say she cannot stand him and he has not noticed. One
number per pair cannot express being wrong about somebody, and being wrong about
somebody is where most of the drama in a house comes from.

**Everybody remembers.** A wasted journey leaves a mark on the object it was for
and on whoever was already using it; a conversation that lands lifts both sides;
one that somebody walks out of costs them. Opinions sit on -1..+1, multiply the
score of anything they are about, and fade — so a grudge is a thing somebody gets
over rather than a permanent property. The dynamics live in the `memory` block of
the cast file, because how quickly somebody takes offence is as much a
personality as how much they mind being dirty. `"memory": null` gives you
characters with no memory at all, which is the engine as it stood before this
existed and is the control every memory test is written against.

**With people in it, thirty days is not long enough.** The house on its own settles
by day 20 and holds. Add five real personalities and memory and it is still
descending at day 30 — sixteen seeds put the mean motive at +16 around day 20 and
+19 from day 50 onward, so a thirty-day window measures the tail of the transient
and reports it as the equilibrium. That is the mistake #5's reviewer caught at six
days, one order of magnitude up. `src/cast/dollhouse.test.ts` runs ninety days and
compares days 40–60 with days 70–90.

### How to tell whether personality is working

`npm run demo -- --days 30 --format behaviour` prints the table, and the table
has to be read the right way round:

- **Time spent on a motive is not the signal.** At steady state it is decay
  divided by supply, with no weight anywhere in it, so two characters who are
  both keeping up wash for the same number of hours however differently they feel
  about it. **Roughly equal time is the correct answer.** A wide spread there is
  as likely to mean somebody has stopped keeping up. This has now caught four
  people, and there is a test asserting hygiene time stays roughly equal
  precisely so the next person to "fix" the missing signal argues with a red one.
- **Level is the signal.** What state each character *maintains*: the spreads in
  the top block of the table.
- **Source mix is the signal.** Which of the competing options they pick: the
  middle block. That is why every motive needs two sources with different
  side-effects.

## Contributing notes

This repository is public. It was private when these rules were written, and they were written as
though it were public even then, because visibility is a toggle and history is not: anything
committed survives a flip either way.

- Never commit API keys, tokens, or anything from `.env`.
- `.env.example` is the one member of the `.env` family that is committable. **Placeholders only —
  never real values.**
- Generated runs land in `runs/` and are gitignored. Read one end to end before adding it: a log
  may contain agent output nobody has looked at.
