import { describe, expect, test } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as iot from 'aws-cdk-lib/aws-iot';
import { FleetTopicRule } from '../lib/fleet-topic-rule.js';

const errorAction: iot.CfnTopicRule.ActionProperty = { s3: { bucketName: 'errs', key: 'k', roleArn: 'arn:aws:iam::123456789012:role/r' } };
const actions: iot.CfnTopicRule.ActionProperty[] = [{ s3: { bucketName: 'b', key: 'k', roleArn: 'arn:aws:iam::123456789012:role/r' } }];
const props = { ruleName: 'my_rule', sql: "SELECT * FROM 'fleet/+/telemetry'", actions, errorAction };

describe('FleetTopicRule', () => {
  test('synthesizes a rule with an error action and SQL version, plus a Failure alarm', () => {
    const stack = new Stack(new App());
    new FleetTopicRule(stack, 'R', props);
    const t = Template.fromStack(stack);
    t.hasResourceProperties('AWS::IoT::TopicRule', {
      TopicRulePayload: { AwsIotSqlVersion: '2016-03-23', ErrorAction: { S3: { BucketName: 'errs', Key: 'k', RoleArn: 'arn:aws:iam::123456789012:role/r' } }, Sql: props.sql },
    });
    t.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Failure', Namespace: 'AWS/IoT', Dimensions: [{ Name: 'RuleName', Value: 'my_rule' }],
    });
  });

  test('refuses a missing error action at runtime', () => {
    const stack = new Stack(new App());
    expect(() => new FleetTopicRule(stack, 'R', { ...props, errorAction: undefined as never })).toThrow('errorAction is required');
  });

  test('refuses an empty action list', () => {
    const stack = new Stack(new App());
    expect(() => new FleetTopicRule(stack, 'R', { ...props, actions: [] })).toThrow('actions');
  });

  test('the type requires errorAction', () => {
    const stack = new Stack(new App());
    // @ts-expect-error errorAction is a required property
    const make = () => new FleetTopicRule(stack, 'R', { ruleName: 'x', sql: 's', actions });
    expect(make).toThrow('errorAction is required');
  });
});
