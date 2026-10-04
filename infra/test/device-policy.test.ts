import { expect, test } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { DevicePolicy, devicePolicyDocument } from '../lib/device-policy.js';

const stack = new Stack(new App());
const doc = stack.resolve(devicePolicyDocument(stack)) as { Statement: Array<{ Action: string; Resource: unknown }> };

test('exactly three statements and no wildcard action', () => {
  expect(doc.Statement).toHaveLength(3);
  expect(doc.Statement.map((s) => s.Action)).toEqual(['iot:Connect', 'iot:Publish', 'iot:RetainPublish']);
  for (const s of doc.Statement) expect(s.Action).not.toBe('iot:*');
});

test('every resource is scoped by the thing-name policy variable', () => {
  for (const s of doc.Statement) {
    const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
    for (const r of resources) expect(JSON.stringify(r)).toContain('${iot:Connection.Thing.ThingName}');
  }
});

test('RetainPublish is limited to the status topic', () => {
  const s = doc.Statement.find((x) => x.Action === 'iot:RetainPublish')!;
  expect(Array.isArray(s.Resource)).toBe(false);
  expect(JSON.stringify(s.Resource)).toContain('fleet/');
  expect(JSON.stringify(s.Resource)).toContain('/status');
  expect(JSON.stringify(s.Resource)).not.toContain('telemetry');
});

test('no subscribe or receive permissions', () => {
  const text = JSON.stringify(doc);
  expect(text).not.toContain('iot:Subscribe');
  expect(text).not.toContain('iot:Receive');
});

test('the construct creates a policy named fleet-device-policy', () => {
  const s = new Stack(new App());
  const p = new DevicePolicy(s, 'P');
  expect(p.policy.policyName).toBe('fleet-device-policy');
});
