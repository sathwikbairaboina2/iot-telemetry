export type PairStatus = 'OUTSIDE' | 'PENDING_IN' | 'INSIDE' | 'PENDING_OUT';
export interface PairState {
  readonly status: PairStatus;
  readonly since: number | null;
  readonly lastEventTs: number | null;
  readonly idsAtLastTs: readonly string[];
}
export interface GeofenceEvent { kind: 'ENTER' | 'EXIT'; eventId: string; vehicleId: string; geofenceId: string; deviceTs: number }
export interface TickEvent { kind: 'TICK'; vehicleId: string; geofenceId: string; deviceTs: number }
export type CoreEvent = GeofenceEvent | TickEvent;
export interface AlertConfig { dwellMs: number; minExitMs: number }
export type AlertType = 'ENTERED' | 'EXITED';
export interface Alert { alertId: string; type: AlertType; vehicleId: string; geofenceId: string; confirmedAt: number; triggerEventId: string | null }
export type StepOutcome = 'applied' | 'redundant' | 'duplicate' | 'late_ignored' | 'tick';
export interface StepResult { state: PairState; emitted: Alert[]; outcome: StepOutcome }
export const DEFAULT_CONFIG: AlertConfig = { dwellMs: 60_000, minExitMs: 30_000 };
export const initialState: PairState = Object.freeze({ status: 'OUTSIDE', since: null, lastEventTs: null, idsAtLastTs: Object.freeze([]) as readonly string[] });
export const isPending = (s: PairState): boolean => s.status === 'PENDING_IN' || s.status === 'PENDING_OUT';
