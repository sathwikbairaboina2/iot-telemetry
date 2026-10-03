export interface Clock { now(): number; sleepUntil(ms: number): Promise<void> }

/** Time jumps instead of passing: `sleepUntil` advances the clock and resolves immediately. */
export class VirtualClock implements Clock {
  private t: number;
  constructor(startMs: number) { this.t = startMs; }
  now(): number { return this.t; }
  async sleepUntil(ms: number): Promise<void> {
    if (ms > this.t) this.t = ms;
  }
}

export class RealClock implements Clock {
  now(): number { return Date.now(); }
  sleepUntil(ms: number): Promise<void> {
    const wait = ms - Date.now();
    return wait <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, wait));
  }
}
