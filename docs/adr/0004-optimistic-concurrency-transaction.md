# ADR 0004: Version-conditioned transaction for alert state; SNS after commit

Date: 2026-10-04 · Status: accepted

## Decision

The adapter loads the pair's state item and `version`, runs `step()`, and commits one `TransactWriteItems`: the state
item conditioned on `version = :expected` (or `attribute_not_exists(pk)` when new) plus one alert item per emitted
alert conditioned on `attribute_not_exists(pk)`. A `TransactionCanceledException` means another invocation won; the
adapter reloads and re-steps, up to 5 attempts. Only after a successful commit does it publish to SNS. Late and
duplicate events that change nothing skip the write.

## What I gave up

- **Reliable notifications.** Alert *records* cannot be duplicated (the alert key is deterministic and
  conditioned), but notifications are at-most-once. A crash between commit and publish, or a publish error, loses that
  SNS message: a retry reloads the state, finds the event already applied (`duplicate` or `late_ignored`) and publishes
  nothing. The alert record stays in DynamoDB. An outbox via DynamoDB Streams in v0.2 would make delivery at-least-once
  (consumers would dedupe on `alertId`).
- **Throughput on a hot pair.** Every event for a pair is a read plus a transaction. Fine at geofence-event rates.
