/**
 * Shapes returned by `METRIC_TEMPLATES` Mongo aggregation pipelines.
 * Used for documentation and optional typing at `buildStatsPayload` boundaries.
 */
export interface ErrorRateAggregationRow {
  totalCount: number;
  errorCount: number;
  errorRate: number;
}

export interface TopErrorCodesAggregationRow {
  errorCode: string;
  count: number;
  examples?: unknown[];
}

export interface ErrorDistributionByRouteAggregationRow {
  route: string;
  count: number;
  errorCodes?: string[];
}

export interface LatencyPercentileAggregationRow {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  max: number;
}

export interface ErrorByServiceAggregationRow {
  service: string;
  count: number;
  topErrorCodes?: unknown[];
}
