# ADR 0005: Dwell ticks come from telemetry locally and from a 1-minute sweep in the cloud

Date: 2026-10-04 · Status: accepted

## Context

Location only emits ENTER and EXIT. A vehicle that enters and stays produces no further event, so something must
advance PENDING_IN to INSIDE once the dwell has passed.

## Decision

- Local: every valid telemetry message is a TICK at its `ts` for that vehicle's pending pairs. Deterministic and
  testable with recorded sessions.
- Cloud: an EventBridge `rate(1 minute)` rule invokes the alert Lambda with `{"source":"iot-telemetry.sweep"}`. It
  queries the sparse GSI `pending-index` (attribute `pending` exists only while a pair is pending) and TICKs each pair
  at `Date.now()`, which happens in the adapter, never in the core.

## What I gave up

- **Prompt cloud alerts.** Confirmation can lag the true dwell end by up to 60 s. The alternative, sending every
  `Location Device Position Event` to the Lambda, puts a Lambda on the 1 Hz x N hot path. Per-pair EventBridge
  Scheduler one-shots would be precise but add create/delete churn; v0.2 can revisit.
- **Device-time purity in the cloud tick.** The sweep uses wall time; skewed devices can confirm early or late.
