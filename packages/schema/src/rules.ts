import { evaluateWhere } from './iot-sql.js';

export const TS_PATTERN = "yyyy-MM-dd'T'HH:mm:ss.SSSX";
export const VALID_TELEMETRY_PREDICATE =
  `get_or_default(v = 1 AND vehicleId = topic(2) AND seq >= 0 AND lat >= -90 AND lat <= 90 ` +
  `AND lon >= -180 AND lon <= 180 AND time_to_epoch(ts, "${TS_PATTERN}") > 0, false)`;
export const TELEMETRY_TO_HISTORY_SQL =
  `SELECT *, time_to_epoch(ts, "${TS_PATTERN}") AS tsMs FROM 'fleet/+/telemetry' WHERE ${VALID_TELEMETRY_PREDICATE}`;
export const POSITION_TO_LOCATION_SQL =
  `SELECT vehicleId, lat, lon, ts FROM 'fleet/+/telemetry' WHERE ${VALID_TELEMETRY_PREDICATE}`;
export const INVALID_TO_QUARANTINE_SQL =
  `SELECT *, topic() AS topic, timestamp() AS receivedAt FROM 'fleet/+/telemetry' WHERE NOT ${VALID_TELEMETRY_PREDICATE}`;

/** Text after the first ` WHERE ` that is outside quotes. */
export function whereClause(sql: string): string {
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (sql.startsWith(' WHERE ', i)) {
      return sql.slice(i + ' WHERE '.length);
    }
  }
  throw new Error('no WHERE clause');
}

export function classifyTelemetry(topic: string, payload: unknown): 'valid' | 'quarantine' {
  return evaluateWhere(VALID_TELEMETRY_PREDICATE, payload, { topic }) ? 'valid' : 'quarantine';
}
