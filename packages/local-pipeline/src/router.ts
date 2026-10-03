import { classifyTelemetry, validateTelemetry, type Telemetry } from '@iot-telemetry/schema';

export type RouteResult =
  | { kind: 'valid'; telemetry: Telemetry; schemaErrors: string[] }
  | { kind: 'quarantine'; reason: 'invalid_json' | 'rule_sql'; raw: unknown };

/**
 * Routes by the same rule SQL as the cloud. Nothing is dropped: a message is either valid (and may still carry ajv
 * errors, which are counted) or quarantined with the raw payload.
 */
export function routeMessage(topic: string, payload: string | Uint8Array): RouteResult {
  const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'quarantine', reason: 'invalid_json', raw: text };
  }
  if (classifyTelemetry(topic, parsed) === 'quarantine') return { kind: 'quarantine', reason: 'rule_sql', raw: parsed };
  const v = validateTelemetry(parsed);
  return { kind: 'valid', telemetry: parsed as Telemetry, schemaErrors: v.ok ? [] : v.errors };
}
