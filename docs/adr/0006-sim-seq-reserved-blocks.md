# ADR 0006: Simulator `seq` is allocated in persisted blocks

Date: 2026-10-04 · Status: accepted

## Decision

Each vehicle's `seq` must be strictly increasing across restarts. The simulator persists a high-water mark per
vehicle in `var/sim/seq.json`, reserving 1 000 numbers at a time (write to a temp file, then rename). After a restart
or crash it continues from the persisted mark.

## What I gave up

- **Contiguity across restarts.** A restart skips up to 999 numbers. Gap detection downstream must treat gaps after a
  restart as normal. Within one run, including tunnel replays, `seq` has no gaps.
