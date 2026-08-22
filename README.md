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

The demo takes `--seed`, `--days`, `--world`, and
`--format text|summary|timeline|json|audit`. `--format json` writes the raw event
log to stdout and is byte-stable for a given seed, so two runs can be diffed;
timing goes to stderr to keep it out of the diff.

```
npm run demo -- --seed alpha --days 10 --format summary
npm run demo -- --seed alpha --days 2 --format timeline --characters dez
npm run demo -- --format audit
npm run demo -- --world worlds/dollhouse.json --days 4
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

Things run out. There is enough hot water for three showers and a bath before the
tank needs an hour to recover; the fridge holds what somebody last cooked, and
cooking is a seventy-five-minute chore that leaves the cook dirtier than they
started and the leftovers available to anybody. Who cooks, who raids, and who
waits is most of what there is to watch.

## Contributing notes

This repository is public. It was private when these rules were written, and they were written as
though it were public even then, because visibility is a toggle and history is not: anything
committed survives a flip either way.

- Never commit API keys, tokens, or anything from `.env`.
- `.env.example` is the one member of the `.env` family that is committable. **Placeholders only —
  never real values.**
- Generated runs land in `runs/` and are gitignored. Read one end to end before adding it: a log
  may contain agent output nobody has looked at.
