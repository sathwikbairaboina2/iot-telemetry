export const TELEMETRY_FILTER = 'fleet/+/telemetry';
export const STATUS_FILTER = 'fleet/+/status';
export const ALERTS_TOPIC = 'fleet/alerts';
export const GEOFENCES_TOPIC = 'fleet/geofences';

export const telemetryTopic = (id: string): string => `fleet/${id}/telemetry`;
export const statusTopic = (id: string): string => `fleet/${id}/status`;

/** Vehicle id of a `fleet/{id}/telemetry` topic, or null for any other topic. */
export function parseTelemetryTopic(topic: string): string | null {
  const parts = topic.split('/');
  if (parts.length !== 3 || parts[0] !== 'fleet' || parts[2] !== 'telemetry') return null;
  const id = parts[1];
  return id ? id : null;
}
