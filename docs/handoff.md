
## 2026-10-04 - Claude (Sonnet builder) - main

What changed (v0.1, 24 plan tasks, one local commit each, nothing pushed):
- `packages/schema`: telemetry type and JSON Schema (ajv), fixtures, topic helpers, the three rule SQL constants and an IoT SQL WHERE-subset interpreter.
- `packages/alert-core`: pure `step`/`run` state machine, independent reference model, property tests, publishable package (LICENSE, README, dist only).
- `packages/sim`: seeded fleet simulator, crash-safe `seq` blocks, loiter and tunnel scenarios, MQTT sink with Last Will, NDJSON record/replay, CLI.
- `packages/alert-lambda`: Location event mapping, optimistic-concurrency handler, in-memory and DynamoDB repositories, SNS publisher, Lambda entry with 1-minute sweep, esbuild bundle.
- `packages/local-pipeline`: geofence stub, shared-SQL router, pipeline core, golden scenarios, MQTT wiring.
- `packages/web`: Vite + React + MapLibre live map, Playwright e2e, `docs/media/map.png`.
- `infra`: CDK `FleetStack`, `FleetTopicRule`, device policy, cdk-nag AwsSolutions gate.
- `bench`: latency and alert-correctness benchmark; results in `bench/results/latest.json`.
- Docker compose stack on ports 5370-5373, CI workflow, README, LICENSE.

What is left (v0.2): real AWS deploy, certificates and provisioning, read API, Cognito, geofence editor, `cmd` topic, Device Shadow, clock-skew scenario, InfluxDB, cloud load test, reorder buffer in the alert core, SNS publish retry after commit, README/DEVDOCS polish by the lead.

How to verify: the Gates block in the README "Development" section, then `docker compose up -d --build` and open http://localhost:5373. For the e2e: `docker compose --profile e2e run --rm e2e`. For the benchmark: `docker compose --profile bench run --rm bench`.

Measured headline (bench/results/latest.json, compose, 2026-10-03T23:43:55Z): 200 vehicles at 1 Hz, sent 12000, received 12000, p99 8.8154296875 ms. 1000 timelines: naive 7497 vs core 4223 = reference 4223, duplicates 0, missed 0. Reorder within 10 s: 0 invariant violations, 183 late drops, 42 crossings missed.
