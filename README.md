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

## Contributing notes

This repository is public.

- Never commit API keys, tokens, or anything from `.env`.
- Generated runs land in `runs/` and are gitignored. Read one before adding it — a log may contain
  agent output nobody has looked at.
