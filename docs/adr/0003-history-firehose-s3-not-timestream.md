# ADR 0003: History goes to Firehose -> S3 and latest position to DynamoDB, not Timestream

Date: 2026-10-04 · Status: accepted

## Context

The design picked Timestream for LiveAnalytics. While prototyping on 2026-10-04, `cdk synth` (aws-cdk-lib 2.272.0)
reported for `AWS::Timestream::Database` and `AWS::Timestream::Table`: "Resource type 'AWS::Timestream::Database' is
from a service in maintenance mode since 2025-06-20. Consider migrating to an alternative" (CloudFormation Validate
W3697). A portfolio stack that new accounts cannot deploy is not useful.

## Decision

Rule `telemetry_to_history` has two actions: Firehose (newline separator) into an S3 history bucket for Athena, and
`dynamoDBv2` into a `Latest` table keyed by `vehicleId`. Locally the pipeline writes the same NDJSON layout to
`var/history/dt=YYYY-MM-DD/hour=HH.ndjson` and keeps the latest position in memory.

## What I gave up

- **Time-series queries.** No `bin()` downsampling; track queries become Athena scans with minutes of latency
  (the read API is v0.2 anyway).
- **Ordered latest state.** The `dynamoDBv2` action overwrites unconditionally, so a tunnel replay can briefly set an
  older position as "latest". A conditional write needs a Lambda in the hot path; deferred.
- **Idempotent history.** QoS 1 redeliveries can appear twice in S3; consumers dedupe on `(vehicleId, seq)`.
