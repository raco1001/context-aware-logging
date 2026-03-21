import { QueryMetadata } from '../dtos/query-metadata';

/** Max buckets for short-window second-level series; coarser `binSize` when exceeded. */
export const MAX_SERIES_BUCKETS = 500;

/** MongoDB `$dateTrunc` unit + optional `binSize` + matching `$dateToString` format. */
export type SeriesTimeBucket = {
  unit: 'second' | 'minute' | 'hour' | 'day' | 'week';
  /** When set and greater than 1, passed to `$dateTrunc.binSize` (e.g. 5-second bins with `unit: 'second'`). */
  binSize?: number;
  dateToStringFormat: string;
};

export class AggregationHelper {
  /**
   * Picks a time bucket for ERROR_RATE (and similar) volume charts so the
   * point count stays bounded and readable:
   * - span ≤30m → `second` with `binSize` chosen so at most ~{@link MAX_SERIES_BUCKETS} buckets (per-bucket counts, not cumulative)
   * - span between 30m and 2h → `minute`
   * - ≤2d → `hour`, ≤60d → `day`, else `week`
   * When bounds are missing, defaults to hourly (legacy behaviour).
   */
  static resolveSeriesTimeBucket(
    startTime: Date | null | undefined,
    endTime: Date | null | undefined,
  ): SeriesTimeBucket {
    if (!startTime || !endTime) {
      return { unit: 'hour', dateToStringFormat: '%Y-%m-%dT%H:00:00.000Z' };
    }
    const start = new Date(startTime);
    const end = new Date(endTime);
    const ms = end.getTime() - start.getTime();
    if (!Number.isFinite(ms) || ms <= 0) {
      return { unit: 'hour', dateToStringFormat: '%Y-%m-%dT%H:00:00.000Z' };
    }
    const H = 60 * 60 * 1000;
    const D = 24 * H;
    const SHORT_WINDOW_MS = 30 * 60 * 1000;
    if (ms <= SHORT_WINDOW_MS) {
      const spanSeconds = Math.max(1, Math.ceil(ms / 1000));
      const binSize = Math.max(1, Math.ceil(spanSeconds / MAX_SERIES_BUCKETS));
      return {
        unit: 'second',
        binSize,
        dateToStringFormat: '%Y-%m-%dT%H:%M:%S.000Z',
      };
    }
    if (ms <= 2 * H) {
      return { unit: 'minute', dateToStringFormat: '%Y-%m-%dT%H:%M:00.000Z' };
    }
    if (ms <= 2 * D) {
      return { unit: 'hour', dateToStringFormat: '%Y-%m-%dT%H:00:00.000Z' };
    }
    if (ms <= 60 * D) {
      return { unit: 'day', dateToStringFormat: '%Y-%m-%dT00:00:00.000Z' };
    }
    return { unit: 'week', dateToStringFormat: '%Y-%m-%dT00:00:00.000Z' };
  }

  static buildMatchStage(metadata: QueryMetadata, extraFilters: any = {}): any {
    const match: any = { ...extraFilters };

    if (metadata.startTime || metadata.endTime) {
      match.timestamp = {};
      if (metadata.startTime)
        match.timestamp.$gte = new Date(metadata.startTime);
      if (metadata.endTime) match.timestamp.$lte = new Date(metadata.endTime);
    }

    if (metadata.service) {
      match.service = metadata.service;
    }

    if (metadata.route) {
      // DB stores routes as "METHOD /path" (e.g. "POST /payments").
      // If the metadata route already includes an HTTP method, use exact match.
      // If it is a path-only value (e.g. "/payments"), match any method prefix.
      if (/^(GET|POST|PUT|DELETE|PATCH)\s+/i.test(metadata.route)) {
        match.route = metadata.route;
      } else {
        // Escape special regex characters in the path, then prefix-match any HTTP method
        const escapedPath = metadata.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        match.route = { $regex: `^[A-Z]+\\s+${escapedPath}$`, $options: 'i' };
      }
    }

    if (metadata.errorCode) {
      match['error.code'] = metadata.errorCode;
    } else if (metadata.hasError !== undefined) {
      if (metadata.hasError) {
        match['error.code'] = { $exists: true, $ne: null };
      } else {
        match['error.code'] = null;
      }
    }

    return match;
  }
}
