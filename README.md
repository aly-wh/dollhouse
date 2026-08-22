# DollHouse

A cutaway house full of agents who don't know you're watching.

**Status: pre-MVP.** Nothing here runs yet.

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

Node 20+, then `npm install`.

```
npm test          # unit tests
npm run typecheck # tsc --noEmit
npm run demo      # run the demo house and print what happened
```

The demo takes `--seed`, `--days`, and `--format text|summary|timeline|json`.
`--format json` writes the raw event log to stdout and is byte-stable for a
given seed, so two runs can be diffed; timing goes to stderr to keep it out of
the diff.

```
npm run demo -- --seed alpha --days 10 --format summary
npm run demo -- --seed alpha --days 2 --format timeline --characters dez
```

Characters choose what to do by arithmetic over motives — no model is called
anywhere in the simulation loop, and a test enforces it. Dialogue is the only
place inference is ever spent, and it is not built yet.

## Contributing notes

This repository is currently private. Every rule below is written as though it were public,
because visibility is a toggle and history is not: anything committed now survives a flip back.
Assume that whatever is merged is published.

- Never commit API keys, tokens, or anything from `.env`.
- `.env.example` is the one member of the `.env` family that is committable. **Placeholders only —
  never real values.**
- Generated runs land in `runs/` and are gitignored. Read one end to end before adding it: a log
  may contain agent output nobody has looked at.
