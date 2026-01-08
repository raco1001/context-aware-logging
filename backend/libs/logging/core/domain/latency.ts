import { LatencyBucket } from "../value-objects";

/**
 * Latency - Utility class for determining latency buckets.
 */
export class Latency {
  /**
   * Returns the appropriate LatencyBucket based on the duration in milliseconds.
   */
  static getBucket(durationMs?: number): LatencyBucket {
    if (durationMs === undefined || durationMs === null)
      return LatencyBucket.P_UNKNOWN;
    if (durationMs < 50) return LatencyBucket.P_SUB_50MS;
    if (durationMs < 200) return LatencyBucket.P_50_200MS;
    if (durationMs < 500) return LatencyBucket.P_200_500MS;
    if (durationMs < 1000) return LatencyBucket.P_500_1000MS;
    return LatencyBucket.P_OVER_1000MS;
  }
}
