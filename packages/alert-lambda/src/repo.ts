import type { Alert, PairState } from '@iot-telemetry/alert-core';

/** `version` 0 means the pair has never been written. */
export interface StoredState { state: PairState; version: number }
export type CommitResult = 'ok' | 'conflict';
export interface PairRef { vehicleId: string; geofenceId: string }

export interface AlertStateRepo {
  load(vehicleId: string, geofenceId: string): Promise<StoredState>;
  /** Writes the new state and the alerts together, only if the stored version still equals `expectedVersion`. */
  commit(vehicleId: string, geofenceId: string, expectedVersion: number, next: PairState, alerts: readonly Alert[]): Promise<CommitResult>;
  listPending(): Promise<PairRef[]>;
}

export interface AlertPublisher { publish(alert: Alert): Promise<void> }
