import { expect, test } from 'vitest';
import { parseTelemetryTopic, telemetryTopic, statusTopic } from '../src/index.js';

test('parseTelemetryTopic', () => {
  expect(parseTelemetryTopic('fleet/veh-0001/telemetry')).toBe('veh-0001');
  expect(parseTelemetryTopic('fleet/veh-0001/status')).toBeNull();
  expect(parseTelemetryTopic('fleet//telemetry')).toBeNull();
});
test('round trip', () => {
  expect(parseTelemetryTopic(telemetryTopic('veh-0042'))).toBe('veh-0042');
  expect(statusTopic('veh-0042')).toBe('fleet/veh-0042/status');
});
