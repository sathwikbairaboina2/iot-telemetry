# ADR 0007: Host Node 24 + pnpm workspace, TypeScript 6.0, cdk-nag v3, Docker only for services

Date: 2026-10-04 · Status: accepted

## Decision

- The host has Node v24.18.0 and pnpm 9.12.0 (checked 2026-10-04); all packages build and test on the host. Docker
  runs Mosquitto, DynamoDB Local, the demo stack and Playwright (`mcr.microsoft.com/playwright:v1.63.0-noble`).
- One pnpm workspace: `packages/*`, `infra`, `bench`. ESM everywhere. Workspace packages export a `source` condition
  pointing at `src/index.ts`, so tests, typecheck and Vite work without building dependencies first; Node at runtime
  uses `dist/`.
- TypeScript is pinned to **6.0.3**. TypeScript 7.0.2 exists, but `typescript-eslint@8.71.0` peers on
  `typescript >=4.8.4 <6.1.0`, and the purity rules depend on typescript-eslint.
- cdk-nag **3.0.2** uses CDK policy validation: `Validations.of(app).addPlugins(new AwsSolutionsChecks(app))`. The v2
  form `Aspects.of(app).add(...)` fails at synth with "aspectApplication.aspect.visit is not a function" (seen in a
  prototype on 2026-10-04). Any unacknowledged AwsSolutions finding makes synth throw, so the synth test is the nag gate.

## What I gave up

- **TypeScript 7 speed** until typescript-eslint supports it.
- **Hermetic builds.** Host Node means a contributor needs Node 24; CI pins the same versions.
