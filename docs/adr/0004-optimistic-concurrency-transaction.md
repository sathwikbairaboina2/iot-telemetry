# ADR 0004: Version-conditioned transaction for alert state; SNS after commit

Date: 2026-10-04 · Status: accepted

## Decision

The adapter loads the pair's state item and `version`, runs `step()`, and commits one `TransactWriteItems`: the state
item conditioned on `version = :expected` (or `attribute_not_exists(pk)` when new) plus one alert item per emitted
alert conditioned on `attribute_not_exists(pk)`. A `TransactionCanceledException` means another invocation won; the
adapter reloads and re-steps, up to 5 attempts. Only after a successful commit does it publish to SNS. Late and
duplicate events that change nothing skip the write.

## What I gave up

- **Exactly-once notifications.** Alert *records* cannot be duplicated (the alert key is deterministic and
  conditioned), but a crash between commit and publish loses that SNS message, and a retry after a publish error can
  send it twice. Notifications are at-least-once with `alertId` for consumer dedupe. An outbox via DynamoDB Streams is v0.2.
- **Throughput on a hot pair.** Every event for a pair is a read plus a transaction. Fine at geofence-event rates.
