import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import type { Alert } from '@iot-telemetry/alert-core';
import type { AlertPublisher } from './repo.js';

/** Publishes after the DynamoDB commit, so notifications are at-most-once: a publish failure drops that notification (the alert record stays in DynamoDB; see the README limits). */
export class SnsAlertPublisher implements AlertPublisher {
  constructor(private readonly client: SNSClient, private readonly topicArn: string) {}

  async publish(alert: Alert): Promise<void> {
    await this.client.send(new PublishCommand({
      TopicArn: this.topicArn,
      Message: JSON.stringify(alert),
      MessageAttributes: {
        alertId: { DataType: 'String', StringValue: alert.alertId },
        type: { DataType: 'String', StringValue: alert.type },
      },
    }));
  }
}
