import { ArnFormat, Stack } from 'aws-cdk-lib';
import * as iot from 'aws-cdk-lib/aws-iot';
import { Construct } from 'constructs';

// Single quotes on purpose: this is an IoT policy variable, not a template literal.
const THING = '${iot:Connection.Thing.ThingName}';

/** Least privilege: a device may connect as itself and publish only to its own telemetry and status topics. */
export function devicePolicyDocument(stack: Stack): Record<string, unknown> {
  const arn = (resource: string, resourceName: string) =>
    stack.formatArn({ service: 'iot', resource, resourceName, arnFormat: ArnFormat.SLASH_RESOURCE_NAME });
  return {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: 'iot:Connect', Resource: arn('client', THING) },
      {
        Effect: 'Allow',
        Action: 'iot:Publish',
        Resource: [arn('topic', `fleet/${THING}/telemetry`), arn('topic', `fleet/${THING}/status`)],
      },
    ],
  };
}

export class DevicePolicy extends Construct {
  readonly policy: iot.CfnPolicy;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.policy = new iot.CfnPolicy(this, 'Policy', {
      policyName: 'fleet-device-policy',
      policyDocument: devicePolicyDocument(Stack.of(this)),
    });
  }
}
