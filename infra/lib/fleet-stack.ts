import { fileURLToPath } from 'node:url';
import { Duration, Stack, Validations, type CfnElement, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as iot from 'aws-cdk-lib/aws-iot';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as location from 'aws-cdk-lib/aws-location';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import {
  INVALID_TO_QUARANTINE_SQL, POSITION_TO_LOCATION_SQL, TELEMETRY_TO_HISTORY_SQL, TS_PATTERN,
} from '@iot-telemetry/schema';
import { DevicePolicy } from './device-policy.js';
import { FleetTopicRule } from './fleet-topic-rule.js';

export interface FleetStackProps extends StackProps {
  /** Default: the esbuild bundle in packages/alert-lambda/dist-lambda (run `pnpm synth`, which bundles first). */
  alertCode?: lambda.Code;
  dwellSeconds?: number;
  minExitSeconds?: number;
}

const bucket = (scope: Construct, id: string, accessLogs?: s3.Bucket): s3.Bucket =>
  new s3.Bucket(scope, id, {
    enforceSSL: true,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    ...(accessLogs ? { serverAccessLogsBucket: accessLogs } : {}),
  });

export class FleetStack extends Stack {
  constructor(scope: Construct, id: string, props: FleetStackProps = {}) {
    super(scope, id, props);

    Validations.of(this).acknowledge({
      id: 'CloudFormation-Validate::W7001',
      reason: 'The unused Mappings entry (Firehose CIDR blocks) is emitted by the CDK Firehose construct, not by this stack.',
    });

    // storage
    const accessLogs = bucket(this, 'AccessLogs');
    Validations.of(accessLogs).acknowledge({
      id: 'AwsSolutions-S1',
      reason: 'This bucket is the target for the server access logs of the other buckets; logging it to itself adds nothing.',
    });
    const history = bucket(this, 'History', accessLogs);
    const quarantine = bucket(this, 'Quarantine', accessLogs);
    const ruleErrors = bucket(this, 'RuleErrors', accessLogs);

    const historyStream = new firehose.DeliveryStream(this, 'HistoryStream', {
      destination: new firehose.S3Bucket(history, { dataOutputPrefix: 'telemetry/', bufferingInterval: Duration.seconds(60) }),
      encryption: firehose.StreamEncryption.awsOwnedKey(),
    });

    const latest = new dynamodb.TableV2(this, 'Latest', {
      partitionKey: { name: 'vehicleId', type: dynamodb.AttributeType.STRING },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    const alertState = new dynamodb.TableV2(this, 'AlertState', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      globalSecondaryIndexes: [{
        indexName: 'pending-index',
        partitionKey: { name: 'pending', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      }],
    });

    // Amazon Location
    const tracker = new location.CfnTracker(this, 'Tracker', {
      trackerName: 'fleet', positionFiltering: 'DistanceBased', eventBridgeEnabled: false,
    });
    const geofences = new location.CfnGeofenceCollection(this, 'Geofences', { collectionName: 'fleet-geofences' });
    const consumer = new location.CfnTrackerConsumer(this, 'TrackerConsumer', {
      trackerName: tracker.trackerName, consumerArn: geofences.attrArn,
    });
    consumer.node.addDependency(tracker);

    // IoT rules
    const ruleRole = new iam.Role(this, 'RuleRole', { assumedBy: new iam.ServicePrincipal('iot.amazonaws.com') });
    historyStream.grantPutRecords(ruleRole);
    latest.grantWriteData(ruleRole);
    quarantine.grantPut(ruleRole);
    ruleErrors.grantPut(ruleRole);
    ruleRole.addToPolicy(new iam.PolicyStatement({ actions: ['geo:BatchUpdateDevicePosition'], resources: [tracker.attrArn] }));

    const arnOf = (b: s3.Bucket) => `<${this.getLogicalId(b.node.defaultChild as CfnElement)}.Arn>/*`;
    const iam5 = (target: Construct, findings: string[], reason: string) => {
      for (const f of findings) Validations.of(target).acknowledge({ id: `AwsSolutions-IAM5[${f}]`, reason });
    };
    iam5(ruleRole, ['Action::s3:Abort*', `Resource::${arnOf(quarantine)}`, `Resource::${arnOf(ruleErrors)}`],
      'CDK grantPut scopes the rule role to objects (bucket/*) in the Quarantine and RuleErrors buckets only; keys are generated per message, and s3:Abort* is part of the grantPut action set.');
    iam5(historyStream, ['Action::s3:GetObject*', 'Action::s3:GetBucket*', 'Action::s3:List*', 'Action::s3:DeleteObject*', 'Action::s3:Abort*', `Resource::${arnOf(history)}`],
      'The Firehose delivery role is generated by CDK and limited to the History bucket; Firehose creates objects with generated keys, so object-level wildcards on that one bucket are required.');

    const errorAction = (ruleName: string): iot.CfnTopicRule.ActionProperty => ({
      s3: { bucketName: ruleErrors.bucketName, key: `${ruleName}/\${timestamp()}-\${newuuid()}.json`, roleArn: ruleRole.roleArn },
    });

    new FleetTopicRule(this, 'TelemetryToHistory', {
      ruleName: 'telemetry_to_history',
      sql: TELEMETRY_TO_HISTORY_SQL,
      description: 'Valid telemetry to the S3 history (Firehose) and the latest-position table',
      actions: [
        { firehose: { deliveryStreamName: historyStream.deliveryStreamName, roleArn: ruleRole.roleArn, separator: '\n' } },
        { dynamoDBv2: { putItem: { tableName: latest.tableName }, roleArn: ruleRole.roleArn } },
      ],
      errorAction: errorAction('telemetry_to_history'),
    });
    new FleetTopicRule(this, 'PositionToLocation', {
      ruleName: 'position_to_location',
      sql: POSITION_TO_LOCATION_SQL,
      description: 'Valid positions to the Amazon Location tracker, which evaluates the geofences',
      actions: [{
        location: {
          trackerName: tracker.trackerName,
          deviceId: '${vehicleId}',
          latitude: '${lat}',
          longitude: '${lon}',
          timestamp: { value: `\${time_to_epoch(ts, "${TS_PATTERN}")}`, unit: 'MILLISECONDS' },
          roleArn: ruleRole.roleArn,
        },
      }],
      errorAction: errorAction('position_to_location'),
    });
    new FleetTopicRule(this, 'InvalidToQuarantine', {
      ruleName: 'invalid_to_quarantine',
      sql: INVALID_TO_QUARANTINE_SQL,
      description: 'Messages that fail the validity predicate, kept for inspection',
      actions: [{ s3: { bucketName: quarantine.bucketName, key: '${topic()}/${timestamp()}.json', roleArn: ruleRole.roleArn } }],
      errorAction: errorAction('invalid_to_quarantine'),
    });

    new DevicePolicy(this, 'DevicePolicy');

    // alerting
    const topic = new sns.Topic(this, 'FleetAlerts', {
      topicName: 'fleet-alerts',
      enforceSSL: true,
      masterKey: kms.Alias.fromAliasName(this, 'SnsKey', 'alias/aws/sns'),
    });

    const logGroup = new logs.LogGroup(this, 'AlertFnLogs', { retention: logs.RetentionDays.ONE_MONTH });
    const fnRole = new iam.Role(this, 'AlertFnRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    logGroup.grantWrite(fnRole);
    const alertFn = new lambda.Function(this, 'AlertFn', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: props.alertCode ?? lambda.Code.fromAsset(fileURLToPath(new URL('../../packages/alert-lambda/dist-lambda', import.meta.url))),
      memorySize: 256,
      timeout: Duration.seconds(30),
      role: fnRole,
      logGroup,
      environment: {
        TABLE_NAME: alertState.tableName,
        TOPIC_ARN: topic.topicArn,
        DWELL_SECONDS: String(props.dwellSeconds ?? 60),
        MIN_EXIT_SECONDS: String(props.minExitSeconds ?? 30),
      },
    });
    alertState.grantReadWriteData(alertFn);
    iam5(fnRole, [`Resource::<${this.getLogicalId(alertState.node.defaultChild as CfnElement)}.Arn>/index/*`],
      'The AlertState grant covers the table indexes; the pending sweep queries the sparse pending-index GSI.');
    topic.grantPublish(alertFn);

    new events.Rule(this, 'GeofenceEvents', {
      description: 'Amazon Location geofence ENTER/EXIT events to the alert Lambda',
      eventPattern: { source: ['aws.geo'], detailType: ['Location Geofence Event'] },
      targets: [new targets.LambdaFunction(alertFn)],
    });
    new events.Rule(this, 'PendingSweep', {
      description: 'Once a minute, confirm pending dwell and exit timers',
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(alertFn, { event: events.RuleTargetInput.fromObject({ source: 'iot-telemetry.sweep' }) })],
    });
  }
}
