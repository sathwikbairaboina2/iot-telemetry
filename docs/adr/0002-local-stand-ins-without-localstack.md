# ADR 0002: Local stand-ins instead of LocalStack; the cloud stack is proven by synth and assertions

Date: 2026-10-04 · Status: accepted

## Context

LocalStack (since 2026-03-23) needs an auth token to start, and this machine has none. On the Hobby plan IoT Core is
paid anyway, Timestream is Ultimate-only, and Amazon Location is not listed. There are no AWS credentials either.

## Decision

- Mosquitto `eclipse-mosquitto:2.1.2-alpine` is the broker (TCP on host 5370, WebSockets on host 5371).
- `amazon/dynamodb-local:3.3.1` (no token) backs the alert adapter's integration tests and the compose demo
  (host 5372). Conditional `TransactWriteItems` was prototyped against it on 2026-10-04.
- The local pipeline applies the **same rule SQL strings** the CDK stack deploys, through a small interpreter of the
  WHERE subset that follows the AWS IoT SQL operator tables (Undefined semantics). A turf.js point-in-polygon stub emits
  ENTER/EXIT events in the EventBridge "Location Geofence Event" shape from the AWS docs.
- The CDK stack is checked by `cdk synth`, assertion tests and cdk-nag v3. Nothing is deployed.

## What I gave up

- **Deployment proof.** No test shows the stack deploys or that IoT Core accepts the rule SQL. The interpreter is an
  approximation of IoT SQL, documented as such.
- **Authorization proof.** Mosquitto runs with anonymous access; IoT policies are only checked as synthesized JSON.
- **Real Location behavior** (position filtering, event latency). The stub evaluates every position.
