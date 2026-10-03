# ADR 0001: A pure alert core with a debounced, device-time state machine

Date: 2026-10-04 · Status: accepted

## Context

Amazon Location geofence events are noisy. The AWS docs say "the same event may be delivered more than one time" and
recommend de-duplicating by event id. Vehicles also loiter on a geofence edge, and buffered devices replay old positions
after an outage. Alerts must still be exactly one per real crossing.

## Decision

`packages/alert-core` is a pure TypeScript function `step(state, event, config)`. Time arrives only as `deviceTs` on
events and TICKs. The confirmed state follows the raw inside/outside signal debounced by two thresholds: `dwellMs` to
confirm an entry and `minExitMs` to confirm an exit. Events older than the last applied event are dropped as late.
Redeliveries are caught by keeping only the ids applied at the latest timestamp (`idsAtLastTs`), which is enough
because anything older is already late. A separate reference model in the tests defines "real crossing" from segments,
and property tests compare the two. ESLint bans `Date`, `Math.random`, `node:*` and `@aws-sdk/*` in the package.

## What I gave up

- **Completeness under reordering.** A late ENTER/EXIT is dropped, not merged. Under shuffled delivery the core stays
  safe (alternating alerts, no duplicates) but can miss a crossing. The bench reports those misses. A bounded reorder
  buffer is v0.2.
- **Retraction.** Once a TICK confirms ENTERED, a later-arriving EXIT that happened before the dwell ended cannot
  retract it. Ticks do not advance `lastEventTs`, so such an EXIT is still applied, but the alert already went out.
- **Wall-clock thresholds.** Dwell is measured in device time. A device with a skewed clock skews its own dwell.
