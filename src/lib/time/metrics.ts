export interface TemporalMetrics {
  clock_drift_ms: number;
  late_response_dropped: number;
  time_authority_switch_count: number;
}

const metrics: TemporalMetrics = {
  clock_drift_ms: 0,
  late_response_dropped: 0,
  time_authority_switch_count: 0,
};

export const temporalMetrics = {
  recordDrift: (driftMs: number) => {
    metrics.clock_drift_ms = driftMs;
  },
  recordDroppedResponse: () => {
    metrics.late_response_dropped++;
  },
  recordAuthoritySwitch: () => {
    metrics.time_authority_switch_count++;
  },
  getSnapshot: (): TemporalMetrics => ({ ...metrics }),
};
