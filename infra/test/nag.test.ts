import { expect, test } from 'vitest';
import { App, Validations } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AwsSolutionsChecks } from 'cdk-nag';
import { FleetStack } from '../lib/fleet-stack.js';

test('the stack passes cdk-nag AwsSolutions (an unacknowledged finding makes synth throw)', () => {
  const app = new App();
  new FleetStack(app, 'T', { alertCode: lambda.Code.fromInline('export const handler = async () => {}') });
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  expect(() => app.synth()).not.toThrow();
});
