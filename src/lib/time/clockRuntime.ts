class ClockRuntime {
  private timeMs = Date.now();
  private initialized = false;

  initialize(initialTimeMs: number): void {
    if (this.initialized) return;
    if (!Number.isFinite(initialTimeMs)) return;
    this.timeMs = initialTimeMs;
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getTimeMs(): number {
    return this.timeMs;
  }

  setTimeMs(nextTimeMs: number): void {
    if (!Number.isFinite(nextTimeMs)) return;
    this.timeMs = nextTimeMs;
    this.initialized = true;
  }

  tick(deltaSeconds: number, multiplier: number): number {
    const deltaMs = deltaSeconds * multiplier * 1000;
    if (!Number.isFinite(deltaMs) || deltaMs === 0) {
      return this.timeMs;
    }
    this.timeMs += deltaMs;
    this.initialized = true;
    return this.timeMs;
  }
}

export const clockRuntime = new ClockRuntime();
