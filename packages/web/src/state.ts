// Type-only imports: the schema package pulls in Node modules, which must not end up in the browser bundle.
import type { Alert } from '@iot-telemetry/alert-core';
import type { Telemetry } from '@iot-telemetry/schema';

/** Minimal GeoJSON shape; MapLibre accepts it as source data. */
export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; properties: Record<string, unknown> | null; geometry: { type: string; coordinates: unknown } }>;
}

export interface VehicleView { telemetry: Telemetry; trail: Array<[number, number]>; online: boolean; lastSeenMs: number }
export interface FleetState {
  vehicles: Record<string, VehicleView>; alerts: Alert[]; geofences: GeoFeatureCollection | null;
  messages: number; selected: string | null;
}

export type FleetAction =
  | { type: 'telemetry'; telemetry: Telemetry; receivedMs: number }
  | { type: 'status'; vehicleId: string; online: boolean }
  | { type: 'alert'; alert: Alert }
  | { type: 'geofences'; geojson: GeoFeatureCollection }
  | { type: 'select'; vehicleId: string | null };

export const TRAIL_POINTS = 120;
export const MAX_ALERTS = 50;

export const initialFleetState: FleetState = { vehicles: {}, alerts: [], geofences: null, messages: 0, selected: null };

export function fleetReducer(state: FleetState, action: FleetAction): FleetState {
  switch (action.type) {
    case 'telemetry': {
      const t = action.telemetry;
      const prev = state.vehicles[t.vehicleId];
      // a replayed (older) message after a tunnel outage counts as traffic but must not move the marker
      if (prev && t.seq < prev.telemetry.seq) return { ...state, messages: state.messages + 1 };
      const trail = [...(prev?.trail ?? []), [t.lon, t.lat] as [number, number]].slice(-TRAIL_POINTS);
      return {
        ...state,
        messages: state.messages + 1,
        vehicles: { ...state.vehicles, [t.vehicleId]: { telemetry: t, trail, online: true, lastSeenMs: action.receivedMs } },
      };
    }
    case 'status': {
      const v = state.vehicles[action.vehicleId];
      if (!v) return state;
      return { ...state, vehicles: { ...state.vehicles, [action.vehicleId]: { ...v, online: action.online } } };
    }
    case 'alert': {
      if (state.alerts.some((a) => a.alertId === action.alert.alertId)) return state;
      return { ...state, alerts: [action.alert, ...state.alerts].slice(0, MAX_ALERTS) };
    }
    case 'geofences':
      return { ...state, geofences: action.geojson };
    case 'select':
      return { ...state, selected: action.vehicleId };
  }
}
