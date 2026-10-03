import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iot from 'aws-cdk-lib/aws-iot';
import { Construct } from 'constructs';

export interface FleetTopicRuleProps {
  ruleName: string;
  sql: string;
  actions: iot.CfnTopicRule.ActionProperty[];
  /** Required by type and checked at runtime: a rule that fails silently loses data. */
  errorAction: iot.CfnTopicRule.ActionProperty;
  description?: string;
}

/** An IoT topic rule that cannot be created without an error action, plus an alarm on its Failure metric. */
export class FleetTopicRule extends Construct {
  readonly rule: iot.CfnTopicRule;
  readonly failureAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: FleetTopicRuleProps) {
    super(scope, id);
    if (!props.errorAction) throw new Error('errorAction is required');
    if (props.actions.length === 0) throw new Error('actions must not be empty');

    this.rule = new iot.CfnTopicRule(this, 'Rule', {
      ruleName: props.ruleName,
      topicRulePayload: {
        sql: props.sql,
        awsIotSqlVersion: '2016-03-23',
        ruleDisabled: false,
        description: props.description,
        actions: props.actions,
        errorAction: props.errorAction,
      },
    });

    this.failureAlarm = new cloudwatch.Alarm(this, 'FailureAlarm', {
      alarmDescription: `IoT rule ${props.ruleName} reported a failed action`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/IoT',
        metricName: 'Failure',
        dimensionsMap: { RuleName: props.ruleName },
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
