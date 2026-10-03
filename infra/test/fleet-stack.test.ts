import { beforeAll, describe, expect, test } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { INVALID_TO_QUARANTINE_SQL, POSITION_TO_LOCATION_SQL, TELEMETRY_TO_HISTORY_SQL } from '@iot-telemetry/schema';
import { FleetStack } from '../lib/fleet-stack.js';

let t: Template;
beforeAll(() => {
  const stack = new FleetStack(new App(), 'T', { alertCode: lambda.Code.fromInline('export const handler = async () => {}') });
  t = Template.fromStack(stack);
});

describe('FleetStack', () => {
  test('three IoT rules, each with an error action, using the shared SQL', () => {
    t.resourceCountIs('AWS::IoT::TopicRule', 3);
    const rules = Object.values(t.findResources('AWS::IoT::TopicRule')) as Array<{ Properties: { TopicRulePayload: { Sql: string; ErrorAction: unknown } } }>;
    for (const r of rules) expect(r.Properties.TopicRulePayload.ErrorAction).toBeDefined();
    expect(rules.map((r) => r.Properties.TopicRulePayload.Sql).sort()).toEqual(
      [TELEMETRY_TO_HISTORY_SQL, POSITION_TO_LOCATION_SQL, INVALID_TO_QUARANTINE_SQL].sort(),
    );
  });

  test('no Timestream resources (ADR 0003)', () => {
    for (const type of Object.values(t.toJSON().Resources as Record<string, { Type: string }>).map((r) => r.Type)) {
      expect(type.startsWith('AWS::Timestream::')).toBe(false);
    }
  });

  test('Location tracker, geofence collection and consumer', () => {
    t.resourceCountIs('AWS::Location::Tracker', 1);
    t.resourceCountIs('AWS::Location::GeofenceCollection', 1);
    t.resourceCountIs('AWS::Location::TrackerConsumer', 1);
  });

  test('EventBridge: geofence events and a one-minute sweep', () => {
    t.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: { source: ['aws.geo'], 'detail-type': ['Location Geofence Event'] },
    });
    t.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 minute)',
      Targets: [Match.objectLike({ Input: '{"source":"iot-telemetry.sweep"}' })],
    });
  });

  test('AlertState has the sparse pending-index GSI', () => {
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'pending-index' })],
    });
  });

  test('the Lambda has its four settings and a one-month log group', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Handler: 'index.handler',
      Environment: { Variables: Match.objectLike({
        TABLE_NAME: Match.anyValue(), TOPIC_ARN: Match.anyValue(), DWELL_SECONDS: '60', MIN_EXIT_SECONDS: '30',
      }) },
    });
    t.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 30 });
  });

  test('one alarm per rule', () => {
    t.resourceCountIs('AWS::CloudWatch::Alarm', 3);
  });

  test('the rule role has no wildcard action or resource', () => {
    const policies = Object.values(t.findResources('AWS::IAM::Policy')) as Array<{ Properties: { PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown }> } } }>;
    for (const p of policies) {
      for (const s of p.Properties.PolicyDocument.Statement) {
        expect(s.Action).not.toBe('*');
        expect(s.Resource).not.toBe('*');
      }
    }
  });

  test('buckets enforce TLS and block public access', () => {
    t.allResourcesProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, RestrictPublicBuckets: true }),
    });
  });
});
