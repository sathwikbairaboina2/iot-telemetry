import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { FleetStack } from '../lib/fleet-stack.js';

const app = new App();
new FleetStack(app, 'IotTelemetryFleet');
Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
